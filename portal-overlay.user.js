// ==UserScript==
// @name        Screeps portal overlay
// @namespace   https://screeps.com/
// @version     0.1.0
// @author      Etienne Samson
// @description Draw portal links on the world map
// @run-at      document-ready
// @grant       GM.xmlHttpRequest
// @connect     www.leagueofautomatednations.com
// @require     https://screepers.github.io/screeps-browser-ext/screeps-browser-core.js?v=1795811856503
// @require     https://screepers.github.io/screeps-browser-ext/screeps-game-time.js?v=1795811856503
// @require     https://screepers.github.io/screeps-browser-ext/screeps-alpha-map.js?v=1795811856503
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @include     /^http://[^/]*?\.localhost:[^/]*?/\(.*?\)/.*?$/
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @updateURL   https://screepers.github.io/screeps-browser-ext/portal-overlay.user.js?v=1795811856503
// @downloadURL https://screepers.github.io/screeps-browser-ext/portal-overlay.user.js?v=1795811856503
// ==/UserScript==



(() => {
    const LOAN_BASE = "https://www.leagueofautomatednations.com";
    /** Bump when the keep/drop rules change so a stored ETag is not reused. */
    const CACHE_VERSION = 1;
    const DB_NAME = "screeps-portal-overlay";
    const STORE = "shards";
    const HOVER_PX = 10;
    const MARKER_PX = 4;
    /** Map portal pixel, `p: [0, 200, 255]` in the client room-object colors. */
    const PORTAL_COLOR = "#00c8ff";
    /** Classic world map room size in CSS pixels, keyed by `WorldMap.zoom`. */
    const CLASSIC_ROOM_PIXELS = { 1: 20, 2: 50, 3: 150 };

    /** @type {Record<string, Portal[]>} */
    const portalsByShard = {};
    /** Shards already requested this page. A second call would invalidate the first response. */
    const requestedShards = new Set();

    let running = false;
    /** @type {number} */
    let timeTimer = 0;
    /** @type {number} */
    let raf = 0;
    let fetchErrorLogged = false;
    let cacheErrorLogged = false;
    /** @type {DrawnEnd | null} */
    let hoveredEnd = null;
    let cursorSet = false;

    const canvas = document.createElement("canvas");
    canvas.className = "portal-overlay";

    const mouse = { x: 0, y: 0, inside: false };

    const PORTAL_INFO_HTML = "\
<div class='portal-info'>\
    <div class='portal-info-title'></div>\
    <div class='portal-info-stable' hidden></div>\
    <div class='portal-info-decay' hidden></div>\
    <div class='portal-info-click' hidden></div>\
</div>";

    function portalsEnabled() {
        return ScreepsAdapter.getSetting("portalsEnabled", true);
    }

    /**
     * @param {boolean} enabled
     */
    function setPortalsEnabled(enabled) {
        ScreepsAdapter.setSetting("portalsEnabled", enabled);
        const worldMap = ScreepsAdapter.getWorldMap();
        if (worldMap) {
            worldMap.displayOptions.portals = enabled;
        }
        if (enabled) {
            startOverlay();
        } else {
            stopOverlay();
        }
    }

    function currentShard() {
        if (ScreepsAdapter.currentView === "top.map2shard") {
            return ScreepsAdapter.AlphaMap.getShard() ?? null;
        }
        const shard = ScreepsAdapter.getWorldMap()?.shard;
        return typeof shard === "string" ? shard : null;
    }

    /**
     * Room-name integers. `N0` is 0 here; `MapUtils` maps that room to y = -1.
     * @param {string} name
     * @returns {{ ew: number, ns: number, x: number, y: number } | null}
     */
    function roomAxes(name) {
        const match = /^([WE])(\d+)([NS])(\d+)$/.exec(name);
        if (!match) {
            return null;
        }
        const ew = Number(match[2]);
        const ns = Number(match[4]);
        return {
            ew,
            ns,
            x: match[1] === "E" ? ew : -ew,
            y: match[3] === "S" ? ns : -ns,
        };
    }

    /**
     * @param {string} name
     */
    function isHighwayRoom(name) {
        const axes = roomAxes(name);
        return !!axes && (axes.ew % 10 === 0 || axes.ns % 10 === 0);
    }

    /**
     * @param {string} origin
     * @param {string} dest
     */
    function isTenStep(origin, dest) {
        const from = roomAxes(origin);
        const to = roomAxes(dest);
        if (!from || !to) {
            return false;
        }
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        return (dx === 0 && Math.abs(dy) === 10) || (dy === 0 && Math.abs(dx) === 10);
    }

    /**
     * Shard0 portal wall: stable, same shard, highway origin, ±10 on one axis.
     * @param {Portal} portal
     * @param {string} shard
     */
    function isWallPortal(portal, shard) {
        const dest = portal.destination;
        if (dest.shard && dest.shard !== shard) {
            return false;
        }
        if (typeof portal.unstableDate === "number" || typeof portal.decayTime === "number") {
            return false;
        }
        return isHighwayRoom(portal.room) && isTenStep(portal.room, dest.room);
    }

    /**
     * @param {unknown} value
     * @returns {value is Record<string, unknown>}
     */
    function isRecord(value) {
        return !!value && typeof value === "object";
    }

    /**
     * @param {unknown} item
     * @returns {Portal | null}
     */
    function normalizePortal(item) {
        if (!isRecord(item)) {
            return null;
        }
        const id = item._id;
        const room = item.room;
        const x = item.x;
        const y = item.y;
        const dest = item.destination;
        const unstableDate = item.unstableDate;
        const decayTime = item.decayTime;
        if (typeof room !== "string" || typeof x !== "number" || typeof y !== "number" || !isRecord(dest)) {
            return null;
        }
        const destRoom = dest.room;
        if (typeof destRoom !== "string") {
            return null;
        }
        const destShard = dest.shard;
        const destX = dest.x;
        const destY = dest.y;
        /** @type {Portal} */
        const portal = {
            id: typeof id === "string" ? id : `${room}:${x}:${y}`,
            room,
            x,
            y,
            destination: { room: destRoom },
        };
        if (typeof destShard === "string") {
            portal.destination.shard = destShard;
        }
        if (typeof destX === "number") {
            portal.destination.x = destX;
        }
        if (typeof destY === "number") {
            portal.destination.y = destY;
        }
        if (typeof unstableDate === "number") {
            portal.unstableDate = unstableDate;
        }
        if (typeof decayTime === "number") {
            portal.decayTime = decayTime;
        }
        return portal;
    }

    /**
     * @param {string} text
     * @param {string} shard
     * @returns {Portal[]}
     */
    function parsePortals(text, shard) {
        const raw = JSON.parse(text);
        if (!Array.isArray(raw)) {
            return [];
        }
        /** @type {Portal[]} */
        const portals = [];
        for (const item of raw) {
            const portal = normalizePortal(item);
            if (portal && !isWallPortal(portal, shard)) {
                portals.push(portal);
            }
        }
        return portals;
    }

    /**
     * Bounding center of a 3×3 block. The Screeps core is the eight tiles around the empty center.
     * @param {[number, number][]} points
     * @returns {{ x: number, y: number } | null}
     */
    function coreCenter(points) {
        if (points.length !== 8 && points.length !== 9) {
            return null;
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const cells = new Set();
        for (const [x, y] of points) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            cells.add(`${x},${y}`);
        }
        if (maxX - minX !== 2 || maxY - minY !== 2 || cells.size !== points.length) {
            return null;
        }
        const x = minX + 1;
        const y = minY + 1;
        for (let tileX = minX; tileX <= maxX; tileX++) {
            for (let tileY = minY; tileY <= maxY; tileY++) {
                const present = cells.has(`${tileX},${tileY}`);
                const center = tileX === x && tileY === y;
                if (!center && !present) {
                    return null;
                }
                if (center && present !== (points.length === 9)) {
                    return null;
                }
            }
        }
        return { x, y };
    }

    /**
     * One arrow per 3×3 core. The eight tiles are the same link, offset onto each other.
     * @param {Portal[]} portals
     * @returns {Portal[]}
     */
    function collapseCores(portals) {
        /** @type {Map<string, Portal[]>} */
        const groups = new Map();
        /** @type {Portal[]} */
        const links = [];
        for (const portal of portals) {
            const dest = portal.destination;
            if (dest.shard || typeof dest.x !== "number" || typeof dest.y !== "number") {
                links.push(portal);
                continue;
            }
            const key = `${portal.room}\0${dest.room}`;
            const group = groups.get(key);
            if (group) {
                group.push(portal);
            } else {
                groups.set(key, [portal]);
            }
        }
        for (const members of groups.values()) {
            const origin = coreCenter(members.map((portal) => [portal.x, portal.y]));
            const destination = coreCenter(members.map((portal) => {
                const dest = portal.destination;
                return [/** @type {number} */ (dest.x), /** @type {number} */ (dest.y)];
            }));
            if (!origin || !destination) {
                links.push(...members);
                continue;
            }
            const sample = members[0];
            /** @type {Portal} */
            const link = {
                id: members.map((portal) => portal.id).sort().join(","),
                room: sample.room,
                x: origin.x,
                y: origin.y,
                destination: {
                    room: sample.destination.room,
                    x: destination.x,
                    y: destination.y,
                },
                core: true,
            };
            if (typeof sample.unstableDate === "number") {
                link.unstableDate = sample.unstableDate;
            }
            if (typeof sample.decayTime === "number") {
                link.decayTime = sample.decayTime;
            }
            links.push(link);
        }
        return links;
    }

    /**
     * @param {GM.Response<unknown>} response
     * @param {string} name
     */
    function responseHeader(response, name) {
        const match = response.responseHeaders.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
        return match?.[1]?.trim() ?? null;
    }

    /**
     * @param {string} url
     * @param {Record<string, string>} headers
     * @returns {Promise<GM.Response<unknown>>}
     */
    function gmGet(url, headers) {
        return new Promise((resolve, reject) => {
            GM.xmlHttpRequest({
                method: "GET",
                url,
                headers,
                timeout: 120000,
                onload: resolve,
                onerror() {
                    reject(new Error("portal overlay: request failed"));
                },
                ontimeout() {
                    reject(new Error("portal overlay: request timed out"));
                },
            });
        });
    }

    /** @type {Promise<IDBDatabase> | null} */
    let databasePromise = null;

    function openDatabase() {
        databasePromise ??= new Promise((resolve, reject) => {
            if (typeof indexedDB === "undefined") {
                reject(new Error("indexedDB unavailable"));
                return;
            }
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
        }).catch((err) => {
            databasePromise = null;
            throw err;
        });
        return databasePromise;
    }

    /**
     * @param {string} shard
     * @returns {Promise<PortalCache | null>}
     */
    async function readCache(shard) {
        try {
            const db = await openDatabase();
            return await new Promise((resolve, reject) => {
                const request = db.transaction(STORE, "readonly").objectStore(STORE).get(shard);
                request.onsuccess = () => {
                    const value = request.result;
                    if (!value || typeof value !== "object" || !Array.isArray(value.portals)) {
                        resolve(null);
                        return;
                    }
                    resolve(/** @type {PortalCache} */ (value));
                };
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            if (!cacheErrorLogged) {
                cacheErrorLogged = true;
                console.warn("portal overlay: cache unavailable", err);
            }
            return null;
        }
    }

    /**
     * @param {string} shard
     * @param {PortalCache} record
     */
    async function writeCache(shard, record) {
        try {
            const db = await openDatabase();
            await new Promise((resolve, reject) => {
                const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(record, shard);
                request.onsuccess = () => resolve(undefined);
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            if (!cacheErrorLogged) {
                cacheErrorLogged = true;
                console.warn("portal overlay: cache unavailable", err);
            }
        }
    }

    /**
     * @param {PortalCache | null} cached
     */
    function cacheIsCurrent(cached) {
        return !!cached && cached.revision === CACHE_VERSION && Array.isArray(cached.portals);
    }

    /**
     * @param {string} shard
     * @returns {Promise<Portal[]>}
     */
    async function loadShard(shard) {
        const cached = await readCache(shard);
        const current = cacheIsCurrent(cached) ? cached : null;
        /** @type {Record<string, string>} */
        const headers = {};
        if (current?.etag) {
            headers["If-None-Match"] = current.etag;
        }
        const url = `${LOAN_BASE}/scanner/${encodeURIComponent(shard)}.portals.json`;
        let response;
        try {
            response = await gmGet(url, headers);
        } catch (err) {
            if (current) {
                return collapseCores(current.portals);
            }
            throw err;
        }
        if (response.status === 304 && current) {
            return collapseCores(current.portals);
        }
        if (response.status < 200 || response.status >= 300) {
            if (current) {
                return collapseCores(current.portals);
            }
            throw new Error(`HTTP ${response.status}`);
        }
        let portals;
        try {
            portals = parsePortals(response.responseText, shard);
        } catch (err) {
            if (current) {
                return collapseCores(current.portals);
            }
            throw err;
        }
        const etag = responseHeader(response, "etag");
        if (etag) {
            await writeCache(shard, { revision: CACHE_VERSION, etag, portals });
        }
        return collapseCores(portals);
    }

    /**
     * @param {string} shard
     */
    function refreshShard(shard) {
        if (requestedShards.has(shard)) {
            return;
        }
        requestedShards.add(shard);
        void loadShard(shard).then((portals) => {
            portalsByShard[shard] = portals;
            console.info(`portal overlay: ${shard} ${portals.length} portals`);
        }).catch((err) => {
            portalsByShard[shard] = [];
            if (!fetchErrorLogged) {
                fetchErrorLogged = true;
                console.warn("portal overlay: failed to load portals", err);
            }
        });
    }

    function pollTime() {
        if (document.hidden || !running || !portalsEnabled()) {
            return;
        }
        const shard = currentShard();
        if (shard) {
            void ScreepsAdapter.GameTime.refresh(shard);
        }
    }

    /**
     * @param {string} roomName
     * @param {number} tileX
     * @param {number} tileY
     * @returns {Point | null}
     */
    function worldPoint(roomName, tileX, tileY) {
        try {
            const xy = ScreepsAdapter.MapUtils.roomNameToXY(roomName);
            const roomSize = ScreepsAdapter.AlphaMap.ROOM_SIZE;
            if (!xy || !roomSize) {
                return null;
            }
            return {
                x: xy[0] + tileX / roomSize,
                y: xy[1] + tileY / roomSize,
            };
        } catch {
            return null;
        }
    }

    /**
     * @param {Portal} portal
     * @param {string} shard
     */
    function sameShard(portal, shard) {
        const destShard = portal.destination.shard;
        return !destShard || destShard === shard;
    }

    /**
     * @param {Portal} portal
     * @param {string} shard
     */
    function portalAlive(portal, shard) {
        if (typeof portal.decayTime !== "number") {
            return true;
        }
        const time = ScreepsAdapter.GameTime.tick(shard);
        if (typeof time !== "number") {
            return true;
        }
        return portal.decayTime >= time;
    }

    /**
     * @returns {((x: number, y: number) => Point | null) | null}
     */
    function projectorForCurrentView() {
        if (ScreepsAdapter.currentView === "top.game-world-map") {
            return projectClassic;
        }
        if (ScreepsAdapter.currentView === "top.map2shard") {
            return projectAlpha;
        }
        return null;
    }

    /**
     * @param {number} worldX
     * @param {number} worldY
     * @returns {Point | null}
     */
    function projectClassic(worldX, worldY) {
        const worldMap = ScreepsAdapter.getWorldMap();
        const container = document.querySelector(".map-container");
        const roomPx = worldMap ? CLASSIC_ROOM_PIXELS[worldMap.zoom] : undefined;
        if (!roomPx || !container) {
            return null;
        }
        const pos = ScreepsAdapter.$location.search().pos;
        if (!pos) {
            return null;
        }
        const [centerX, centerY] = pos.split(",").map(Number);
        if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
            return null;
        }
        const viewportLeft = centerX * roomPx - container.clientWidth / 2;
        const viewportTop = centerY * roomPx - container.clientHeight / 2;
        return {
            x: worldX * roomPx - viewportLeft,
            y: worldY * roomPx - viewportTop,
        };
    }

    /**
     * @param {number} worldX
     * @param {number} worldY
     * @returns {Point | null}
     */
    function projectAlpha(worldX, worldY) {
        const map = ScreepsAdapter.AlphaMap.getMapContainer()?._map;
        if (!map) {
            return null;
        }
        const tile = ScreepsAdapter.AlphaMap.TILE_SIZE;
        return {
            x: (worldX * tile - map.pivot.x) * map.scale.x + map.position.x,
            y: (worldY * tile - map.pivot.y) * map.scale.y + map.position.y,
        };
    }

    /**
     * Screen size of one room tile, so a 3×3 core can be hovered from any of its tiles.
     */
    function tileScreenPixels() {
        const roomSize = ScreepsAdapter.AlphaMap.ROOM_SIZE || 50;
        if (ScreepsAdapter.currentView === "top.game-world-map") {
            const zoom = ScreepsAdapter.getWorldMap()?.zoom;
            const roomPx = zoom ? CLASSIC_ROOM_PIXELS[zoom] : undefined;
            return roomPx ? roomPx / roomSize : 1;
        }
        const map = ScreepsAdapter.AlphaMap.getMapContainer()?._map;
        if (!map) {
            return 1;
        }
        return Math.abs(ScreepsAdapter.AlphaMap.TILE_SIZE / roomSize * map.scale.x);
    }

    /**
     * @returns {HTMLElement | null}
     */
    function overlayParent() {
        if (ScreepsAdapter.currentView === "top.game-world-map") {
            return document.querySelector(".map-container");
        }
        if (ScreepsAdapter.currentView === "top.map2shard") {
            const view = ScreepsAdapter.AlphaMap.getMapContainer()?._renderer?.view;
            return view instanceof HTMLCanvasElement ? view.parentElement : null;
        }
        return null;
    }

    function ensureCanvas() {
        const parent = overlayParent();
        if (!parent) {
            return false;
        }
        if (canvas.parentElement !== parent || canvas.nextElementSibling) {
            parent.appendChild(canvas);
        }
        return true;
    }

    /**
     * @returns {CanvasRenderingContext2D | null}
     */
    function prepareContext() {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (width < 2 || height < 2) {
            return null;
        }
        const dpr = window.devicePixelRatio || 1;
        const bitmapW = Math.round(width * dpr);
        const bitmapH = Math.round(height * dpr);
        if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
            canvas.width = bitmapW;
            canvas.height = bitmapH;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return null;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        return ctx;
    }

    /**
     * @param {Point} point
     * @param {number} width
     * @param {number} height
     * @param {number} margin
     */
    function offscreen(point, width, height, margin) {
        return point.x < -margin || point.y < -margin || point.x > width + margin || point.y > height + margin;
    }

    /**
     * @param {Point} a
     * @param {Point} b
     * @param {number} width
     * @param {number} height
     */
    function segmentMisses(a, b, width, height) {
        return (a.x < 0 && b.x < 0)
            || (a.y < 0 && b.y < 0)
            || (a.x > width && b.x > width)
            || (a.y > height && b.y > height);
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {Point} point
     * @param {string} color
     * @param {boolean} intershard
     */
    function drawMarker(ctx, point, color, intershard) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, MARKER_PX, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (!intershard) {
            return;
        }
        ctx.beginPath();
        ctx.arc(point.x, point.y, MARKER_PX + 3, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    /**
     * Line from the rim of the origin marker to the rim of the destination marker.
     * Too short to show a head when the rooms sit on the same pixel.
     * @param {Point} from
     * @param {Point} to
     * @param {number} inset
     * @returns {{ from: Point, to: Point } | null}
     */
    function arrowShaft(from, to, inset) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy);
        if (len < inset * 2 + 6) {
            return null;
        }
        const ux = dx / len;
        const uy = dy / len;
        return {
            from: { x: from.x + ux * inset, y: from.y + uy * inset },
            to: { x: to.x - ux * inset, y: to.y - uy * inset },
        };
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {Point} from
     * @param {Point} to
     * @param {string} color
     */
    function drawArrow(ctx, from, to, color) {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        ctx.save();
        ctx.translate(to.x, to.y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-9, 3.5);
        ctx.lineTo(-9, -3.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    /**
     * @param {ParentNode} root
     * @param {string} selector
     * @param {string} text
     */
    function setInfoLine(root, selector, text) {
        const node = root.querySelector(selector);
        if (!(node instanceof HTMLElement)) {
            return;
        }
        if (node.textContent !== text) {
            node.textContent = text;
        }
        node.hidden = !text;
    }

    /**
     * @param {Element} root
     */
    function ensurePortalInfo(root) {
        const host = root.classList.contains("map-float-info")
            ? root
            : (root.querySelector(".--ui") ?? root);
        if (host.querySelector(":scope > .portal-info")) {
            return;
        }
        host.insertAdjacentHTML("beforeend", PORTAL_INFO_HTML);
    }

    /**
     * @param {DrawnEnd} end
     * @param {string} shard
     */
    function describeEnd(end, shard) {
        const portal = end.portal;
        const dest = portal.destination;
        const origin = portal.core ? portal.room : `${portal.room} ${portal.x}, ${portal.y}`;
        const intra = sameShard(portal, shard) && typeof dest.x === "number" && typeof dest.y === "number";
        const title = portal.core
            ? `${portal.room} → ${dest.room}`
            : intra
                ? `${origin} → ${dest.room} ${dest.x}, ${dest.y}`
                : dest.shard && dest.shard !== shard
                    ? `${origin} → ${dest.shard} ${dest.room}`
                    : `${origin} → ${dest.room}`;

        let stableText = "";
        if (typeof portal.unstableDate === "number") {
            if (portal.unstableDate > Date.now()) {
                stableText = `Stable until ${ScreepsAdapter.GameTime.formatRemainingTime(portal.unstableDate)}`;
            } else if (typeof portal.decayTime !== "number") {
                stableText = "Unstable";
            }
        }

        let decayText = "";
        if (typeof portal.decayTime === "number") {
            const time = ScreepsAdapter.GameTime.tick(shard);
            if (typeof time !== "number") {
                decayText = `Decays at tick ${portal.decayTime.toLocaleString()}`;
            } else {
                const remaining = portal.decayTime - time;
                const ticks = Math.max(0, Math.ceil(remaining)).toLocaleString();
                const at = ScreepsAdapter.GameTime.wallTime(shard, portal.decayTime);
                decayText = at === null
                    ? `Decays in ${ticks} ticks`
                    : `Decays in ${ticks} ticks (~${ScreepsAdapter.GameTime.formatRemainingTime(at)})`;
            }
        }

        /** @type {MapAction | null} */
        let action = null;
        if (sameShard(portal, shard)) {
            action = {
                shard,
                room: end.role === "origin" ? dest.room : portal.room,
                newTab: false,
            };
        } else if (dest.shard) {
            action = { shard: dest.shard, room: dest.room, newTab: true };
        }
        const clickText = !action
            ? ""
            : action.newTab
                ? `Click to open ${action.shard}`
                : `Click to center on ${action.room}`;
        return { title, stableText, decayText, action, clickText };
    }

    /**
     * @param {Element} root
     * @param {DrawnEnd} end
     * @param {string} shard
     */
    function fillPortalInfo(root, end, shard) {
        ensurePortalInfo(root);
        const described = describeEnd(end, shard);
        setInfoLine(root, ".portal-info-title", described.title);
        setInfoLine(root, ".portal-info-stable", described.stableText);
        setInfoLine(root, ".portal-info-decay", described.decayText);
        setInfoLine(root, ".portal-info-click", described.clickText);
    }

    /**
     * @param {DrawnEnd | null} end
     * @param {string | null} shard
     */
    function showPortalHover(end, shard) {
        const show = !!(end && shard && portalsEnabled());
        hoveredEnd = show && end ? end : null;
        const onClassic = ScreepsAdapter.currentView === "top.game-world-map";
        const onAlpha = ScreepsAdapter.currentView === "top.map2shard";
        const classic = document.querySelector(".map-float-info");
        const alpha = document.querySelector("app-world-tooltip");
        if (classic) {
            const classicShow = show && onClassic;
            classic.classList.toggle("portal-hover", classicShow);
            if (classicShow && end && shard) {
                fillPortalInfo(classic, end, shard);
            }
        }
        if (alpha) {
            const alphaShow = show && onAlpha;
            alpha.classList.toggle("portal-hover", alphaShow);
            if (alphaShow && end && shard) {
                fillPortalInfo(alpha, end, shard);
            }
        }
        const cursor = show ? "pointer" : "";
        if (!show && !cursorSet) {
            return;
        }
        cursorSet = show;
        const roomHover = document.querySelector(".map-container .room-hover");
        if (roomHover instanceof HTMLElement) {
            roomHover.style.cursor = onClassic ? cursor : "";
        }
        const view = ScreepsAdapter.AlphaMap.getMapContainer()?._renderer?.view;
        if (view instanceof HTMLElement) {
            view.style.cursor = onAlpha ? cursor : "";
        }
    }

    /** @type {{ x: number, y: number } | null} */
    let pressPoint = null;
    let swallowClick = false;

    /**
     * @param {MouseEvent} event
     */
    function portalClickTarget(event) {
        if (event.button !== 0 || !hoveredEnd || !running) {
            return false;
        }
        const target = event.target;
        if (target instanceof Element && target.closest("button, a, input, textarea, select")) {
            return false;
        }
        return true;
    }

    /**
     * @param {MouseEvent} event
     */
    function onPortalMouseDown(event) {
        pressPoint = portalClickTarget(event) ? { x: event.clientX, y: event.clientY } : null;
    }

    /**
     * Alpha treats mouseup-without-move as the room click, and that listener
     * runs before the click event. Classic uses the click event.
     * @param {MouseEvent} event
     */
    function onPortalMouseUp(event) {
        swallowClick = false;
        if (!pressPoint || !portalClickTarget(event)) {
            pressPoint = null;
            return;
        }
        const dragged = Math.hypot(event.clientX - pressPoint.x, event.clientY - pressPoint.y) > 4;
        pressPoint = null;
        if (dragged) {
            return;
        }
        swallowClick = true;
        event.preventDefault();
        event.stopPropagation();
        followHoveredPortal();
    }

    /**
     * @param {MouseEvent} event
     */
    function onPortalClick(event) {
        if (!swallowClick) {
            return;
        }
        swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
    }

    function followHoveredPortal() {
        const shard = currentShard();
        if (!hoveredEnd || !shard) {
            return;
        }
        const action = describeEnd(hoveredEnd, shard).action;
        if (!action) {
            return;
        }
        openMap(action.shard, action.room, action.newTab);
    }

    /**
     * @param {string} shard
     * @param {string} room
     * @param {boolean} newTab
     */
    function openMap(shard, room, newTab) {
        let pos;
        try {
            const [x, y] = ScreepsAdapter.MapUtils.roomNameToXY(room);
            pos = `${x + 0.5},${y + 0.5}`;
        } catch {
            return;
        }
        const onAlpha = ScreepsAdapter.currentView === "top.map2shard";
        const segment = onAlpha ? "top.map2shard" : "top.game-world-map";
        const base = ScreepsAdapter.$routeSegment.getSegmentUrl(segment, { shard });
        const params = new URLSearchParams();
        params.set("pos", pos);
        if (onAlpha) {
            const hash = window.location.hash;
            const queryAt = hash.indexOf("?");
            if (queryAt !== -1) {
                const current = new URLSearchParams(hash.slice(queryAt + 1));
                for (const key of ["display", "scale"]) {
                    const value = current.get(key);
                    if (value) {
                        params.set(key, value);
                    }
                }
            }
        }
        const url = `${base}?${params.toString()}`;
        if (!newTab) {
            ScreepsAdapter.$location.url(url);
            return;
        }
        const abs = ScreepsAdapter.$location.$$absUrl;
        const bang = abs.indexOf("#!");
        const prefix = bang === -1 ? `${location.origin}${location.pathname}#!` : abs.slice(0, bang + 2);
        window.open(`${prefix}${url}`, "_blank", "noopener");
    }

    function draw() {
        if (!ensureCanvas()) {
            return;
        }
        const ctx = prepareContext();
        const project = projectorForCurrentView();
        if (!ctx || !project) {
            showPortalHover(null, null);
            return;
        }
        const shard = currentShard();
        if (!shard) {
            showPortalHover(null, null);
            return;
        }
        if (ScreepsAdapter.currentView === "top.game-world-map") {
            ScreepsAdapter.GameTime.note(shard, ScreepsAdapter.getWorldMap()?.gameTime);
        }
        if (!Object.hasOwn(portalsByShard, shard)) {
            refreshShard(shard);
            showPortalHover(null, null);
            return;
        }

        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const coreHit = Math.max(HOVER_PX, tileScreenPixels() * 1.5);
        /** @type {DrawnEnd[]} */
        const ends = [];
        const portals = portalsByShard[shard] ?? [];
        for (const portal of portals) {
            if (!portalAlive(portal, shard)) {
                continue;
            }
            const originWorld = worldPoint(portal.room, portal.x + 0.5, portal.y + 0.5);
            if (!originWorld) {
                continue;
            }
            const origin = project(originWorld.x, originWorld.y);
            if (!origin) {
                continue;
            }
            const dest = portal.destination;
            const intra = sameShard(portal, shard) && typeof dest.x === "number" && typeof dest.y === "number";
            const destWorld = intra ? worldPoint(dest.room, /** @type {number} */ (dest.x) + 0.5, /** @type {number} */ (dest.y) + 0.5) : null;
            const destScreen = destWorld ? project(destWorld.x, destWorld.y) : null;
            const hit = portal.core ? coreHit : HOVER_PX;
            if (destScreen && !segmentMisses(origin, destScreen, width, height)) {
                const shaft = arrowShaft(origin, destScreen, MARKER_PX);
                if (shaft) {
                    drawArrow(ctx, shaft.from, shaft.to, PORTAL_COLOR);
                }
            }
            if (!offscreen(origin, width, height, hit)) {
                drawMarker(ctx, origin, PORTAL_COLOR, !intra);
                ends.push({ portal, role: "origin", screen: origin, hit });
            }
            if (destScreen && !offscreen(destScreen, width, height, hit)) {
                drawMarker(ctx, destScreen, PORTAL_COLOR, false);
                ends.push({ portal, role: "destination", screen: destScreen, hit });
            }
        }

        /** @type {DrawnEnd | null} */
        let hovered = null;
        if (mouse.inside) {
            let best = Infinity;
            for (const end of ends) {
                const distance = Math.hypot(mouse.x - end.screen.x, mouse.y - end.screen.y);
                if (distance <= end.hit && distance < best) {
                    best = distance;
                    hovered = end;
                }
            }
        }
        showPortalHover(hovered, shard);
    }

    function frame() {
        raf = requestAnimationFrame(frame);
        if (!running) {
            return;
        }
        draw();
    }

    /**
     * @param {MouseEvent} event
     */
    function onMouseMove(event) {
        if (!canvas.isConnected) {
            mouse.inside = false;
            return;
        }
        const rect = canvas.getBoundingClientRect();
        mouse.x = event.clientX - rect.left;
        mouse.y = event.clientY - rect.top;
        mouse.inside = mouse.x >= 0 && mouse.y >= 0 && mouse.x <= rect.width && mouse.y <= rect.height;
    }

    function startOverlay() {
        if (running || !portalsEnabled()) {
            return;
        }
        const view = ScreepsAdapter.currentView;
        if (view !== "top.game-world-map" && view !== "top.map2shard") {
            return;
        }
        running = true;
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mousedown", onPortalMouseDown, true);
        window.addEventListener("mouseup", onPortalMouseUp, true);
        window.addEventListener("click", onPortalClick, true);
        pollTime();
        timeTimer = window.setInterval(pollTime, ScreepsAdapter.GameTime.POLL_MS);
        raf = requestAnimationFrame(frame);
    }

    function stopOverlay() {
        running = false;
        mouse.inside = false;
        hoveredEnd = null;
        pressPoint = null;
        swallowClick = false;
        cursorSet = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mousedown", onPortalMouseDown, true);
        window.removeEventListener("mouseup", onPortalMouseUp, true);
        window.removeEventListener("click", onPortalClick, true);
        if (timeTimer) {
            window.clearInterval(timeTimer);
            timeTimer = 0;
        }
        if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
        document.querySelector(".map-float-info")?.classList.remove("portal-hover");
        document.querySelector("app-world-tooltip")?.classList.remove("portal-hover");
        const roomHover = document.querySelector(".map-container .room-hover");
        if (roomHover instanceof HTMLElement) {
            roomHover.style.cursor = "";
        }
        const view = ScreepsAdapter.AlphaMap.getMapContainer()?._renderer?.view;
        if (view instanceof HTMLElement) {
            view.style.cursor = "";
        }
        canvas.remove();
    }

    function bindClassicToggle() {
        const worldMap = ScreepsAdapter.getWorldMap();
        if (!worldMap) {
            return;
        }
        worldMap.displayOptions.portals = portalsEnabled();
        worldMap.togglePortals = function () {
            setPortalsEnabled(!worldMap.displayOptions.portals);
        };
    }

    ScreepsAdapter.ready(() => {
        DomHelper.addStyle(`
            canvas.portal-overlay {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                z-index: 2;
                pointer-events: none;
            }
            .portal-info {
                display: none;
            }
            .portal-info-title {
                font-weight: bold;
                margin-bottom: 2px;
            }
            .portal-info-click {
                color: #8fd0ff;
            }
            .map-float-info.portal-hover > :not(.portal-info),
            app-world-tooltip.portal-hover .--ui > :not(.portal-info) {
                display: none !important;
            }
            .map-float-info.portal-hover > .portal-info,
            app-world-tooltip.portal-hover .portal-info {
                display: block;
            }
            .portal-info [hidden] {
                display: none !important;
            }
        `);

        ScreepsAdapter.registerMapButton({
            id: "portals",
            tooltip: "Toggle portals",
            content: "<i class='fa fa-location-arrow'></i>",
            ngClick: "WorldMap.togglePortals()",
            ngClass: "'md-primary': WorldMap.displayOptions.portals",
            zoomLevels: [1, 2, 3],
        });

        ScreepsAdapter.AlphaMap.registerPreferenceCheckbox({
            id: "portals",
            label: "Show portals",
            getValue: portalsEnabled,
            onChange: setPortalsEnabled,
        });

        ScreepsAdapter.onViewChange((view) => {
            if (view === "top.game-world-map") {
                ScreepsAdapter.$timeout(() => {
                    bindClassicToggle();
                    startOverlay();
                });
                return;
            }
            if (view === "top.map2shard") {
                startOverlay();
                return;
            }
            if (view.startsWith("top.")) {
                stopOverlay();
            }
        });
    });
})();
