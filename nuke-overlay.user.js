// ==UserScript==
// @name        Screeps nuke overlay
// @namespace   https://screeps.com/
// @version     0.1.0
// @author      Etienne Samson
// @description Draw in-flight nukes on the world map
// @run-at      document-ready
// @require     https://screepers.github.io/screeps-browser-ext/screeps-browser-core.js?v=1791414172498
// @require     https://screepers.github.io/screeps-browser-ext/screeps-alpha-map.js?v=1791414172498
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @include     /^http://[^/]*?\.localhost:[^/]*?/\(.*?\)/.*?$/
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @updateURL   https://screepers.github.io/screeps-browser-ext/nuke-overlay.user.js?v=1791414172498
// @downloadURL https://screepers.github.io/screeps-browser-ext/nuke-overlay.user.js?v=1791414172498
// ==/UserScript==



(() => {
    /** Official `NUKE_LAND_TIME`. The experimental nukes API does not include a launch tick. */
    const NUKE_LAND_TIME = 50000;
    const POLL_MS = 20000;
    /** How often to sample `game/time` for the shard's tick rate. */
    const TIME_POLL_MS = 5000;
    /** Samples older than this fall out of the rate window. */
    const RATE_WINDOW_MS = 2 * 60 * 1000;
    /** Need a real gap and at least two ticks before trusting a landing time. */
    const MIN_RATE_SPAN_MS = 4000;
    const MIN_RATE_TICKS = 2;
    const HOVER_PX = 10;
    /** Dash pattern `[dot, gap]`. One full period marches toward the target per `DASH_PERIOD_MS`. */
    const DASH = [0.01, 7];
    const DASH_PERIOD_MS = 500;

    /** Classic world map room size in CSS pixels, keyed by `WorldMap.zoom`. */
    const CLASSIC_ROOM_PIXELS = { 1: 20, 2: 50, 3: 150 };

    /** @type {Record<string, Nuke[]>} */
    let nukesByShard = {};

    /** @type {Record<string, number>} */
    let timeByShard = {};

    /**
     * Fresh `(tick, wall-clock)` pairs per shard, used to estimate ticks per millisecond.
     * @type {Record<string, { tick: number, at: number }[]>}
     */
    let timeSamples = {};

    let nukesLoaded = false;
    let nukesErrorLogged = false;
    let timeErrorLogged = false;
    let running = false;
    /** @type {number} */
    let pollTimer = 0;
    /** @type {number} */
    let timeTimer = 0;
    /** @type {number} */
    let raf = 0;
    /** @type {string | null} */
    let polledShard = null;

    const canvas = document.createElement("canvas");
    canvas.className = "nuke-overlay";

    const mouse = { x: 0, y: 0, inside: false };

    function nukesEnabled() {
        return ScreepsAdapter.getSetting("nukesEnabled", true);
    }

    /**
     * @param {boolean} enabled
     */
    function setNukesEnabled(enabled) {
        ScreepsAdapter.setSetting("nukesEnabled", enabled);
        const worldMap = ScreepsAdapter.getWorldMap();
        if (worldMap) {
            worldMap.displayOptions.nukes = enabled;
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
     * @param {string} shard
     * @param {number} tick
     */
    function pushTimeSample(shard, tick) {
        const now = Date.now();
        const samples = timeSamples[shard] ??= [];
        const last = samples[samples.length - 1];
        if (last && tick < last.tick) {
            samples.length = 0;
        }
        const current = samples[samples.length - 1];
        if (current && current.tick === tick) {
            current.at = now;
        } else {
            samples.push({ tick, at: now });
        }
        const cutoff = now - RATE_WINDOW_MS;
        while (samples.length > 2 && samples[0].at < cutoff) {
            samples.shift();
        }
    }

    /**
     * Wall-clock landing time for `landTime`, or null until the shard's rate is known.
     * Anchored to the newest sample so a stale remaining count does not drift the clock.
     * @param {string} shard
     * @param {number} landTime
     * @returns {number | null}
     */
    function landingWallTime(shard, landTime) {
        const samples = timeSamples[shard];
        if (!samples || samples.length < 2) {
            return null;
        }
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dt = last.at - first.at;
        const ticks = last.tick - first.tick;
        if (dt < MIN_RATE_SPAN_MS || ticks < MIN_RATE_TICKS) {
            return null;
        }
        const remaining = landTime - last.tick;
        if (remaining <= 0) {
            return null;
        }
        return last.at + remaining * (dt / ticks);
    }

    const DAY_MS = 24 * 60 * 60 * 1000;

    /**
     * @param {number} ms
     */
    function formatCountdown(ms) {
        const total = Math.max(0, Math.ceil(ms / 1000));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        const ss = String(seconds).padStart(2, "0");
        const mm = String(minutes).padStart(2, "0");
        if (hours > 0) {
            return `${hours}h ${mm}m ${ss}s`;
        }
        if (minutes > 0) {
            return `${minutes}m ${ss}s`;
        }
        return `${seconds}s`;
    }

    /**
     * Clock time when the landing is more than a day out, otherwise a countdown.
     * @param {number} at
     */
    function formatRemainingTime(at) {
        const remainingMs = at - Date.now();
        if (remainingMs > DAY_MS) {
            return new Date(at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
            });
        }
        return formatCountdown(remainingMs);
    }

    /**
     * @param {ParentNode} root
     * @param {Flight} flight
     */
    function fillPathInfo(root, flight) {
        const shard = currentShard();
        const title = root.querySelector(".nuke-path-title");
        const eta = root.querySelector(".nuke-path-eta");
        const landing = root.querySelector(".nuke-path-landing");
        const ticks = flight.remaining.toLocaleString();
        const at = shard ? landingWallTime(shard, flight.nuke.landTime) : null;
        if (title) {
            title.textContent = `Nuke ${flight.nuke.launchRoomName} → ${flight.nuke.room}`;
        }
        if (eta) {
            eta.textContent = at === null
                ? `ETA: ${ticks} ticks`
                : `ETA: ${ticks} ticks (~${formatRemainingTime(at)})`;
        }
        if (landing) {
            landing.textContent = `Landing at: ${flight.nuke.x}, ${flight.nuke.y}`;
        }
    }

    /**
     * @param {string} shard
     * @param {unknown} time
     * @param {boolean} [fresh] True for a response just received. The first map `gameTime` is often stale, so it only joins the rate window after a live sample exists.
     */
    function noteTime(shard, time, fresh = false) {
        const tick = Number(time);
        if (!shard || !Number.isFinite(tick) || tick <= 0) {
            return;
        }
        const prev = timeByShard[shard] ?? 0;
        if (tick < prev) {
            return;
        }
        const watched = (timeSamples[shard]?.length ?? 0) > 0;
        if (fresh || (tick > prev && watched)) {
            pushTimeSample(shard, tick);
        }
        if (tick > prev) {
            timeByShard[shard] = tick;
            pokeClassicInspector();
        }
    }

    async function refreshNukes() {
        try {
            const data = await ScreepsAdapter.Api.get("experimental/nukes");
            if (data?.ok && data.nukes && typeof data.nukes === "object") {
                nukesByShard = data.nukes;
                nukesLoaded = true;
                nukeEpoch++;
                pokeClassicInspector();
            }
        } catch (err) {
            if (!nukesErrorLogged) {
                nukesErrorLogged = true;
                console.warn("nuke overlay: failed to load /api/experimental/nukes", err);
            }
        }
    }

    /**
     * @param {string} shard
     */
    async function refreshTime(shard) {
        try {
            const data = await ScreepsAdapter.Api.get("game/time", { shard });
            if (data?.ok) {
                noteTime(shard, data.time, true);
            }
        } catch (err) {
            if (!timeErrorLogged) {
                timeErrorLogged = true;
                console.warn("nuke overlay: failed to load game time", err);
            }
        }
    }

    async function pollNukes() {
        if (document.hidden || !nukesEnabled()) {
            return;
        }
        const shard = currentShard();
        await refreshNukes();
        if (shard) {
            polledShard = shard;
            await refreshTime(shard);
        }
    }

    async function pollTime() {
        if (document.hidden || !running || !nukesEnabled()) {
            return;
        }
        const shard = currentShard();
        if (shard) {
            await refreshTime(shard);
        }
    }

    /**
     * Convert a room position into world coordinates.
     * @param {string} roomName
     * @param {number} tileX
     * @param {number} tileY
     * @returns {Point | null}
     */
    function worldPoint(roomName, tileX, tileY) {
        const xy = ScreepsAdapter.MapUtils.roomNameToXY(roomName);
        if (!xy) {
            return null;
        }
        const roomSize = ScreepsAdapter.AlphaMap.ROOM_SIZE;
        return {
            x: xy[0] + tileX / roomSize,
            y: xy[1] + tileY / roomSize,
        };
    }

    /**
     * @param {Nuke} nuke
     * @param {number | undefined} time
     * @returns {Flight | null}
     */
    function flightOf(nuke, time) {
        const roomSize = ScreepsAdapter.AlphaMap.ROOM_SIZE;
        const launch = worldPoint(nuke.launchRoomName, roomSize / 2, roomSize / 2);
        const impact = worldPoint(nuke.room, nuke.x + 0.5, nuke.y + 0.5);
        if (!launch || !impact || typeof nuke.landTime !== "number" || typeof time !== "number") {
            return null;
        }

        const remaining = nuke.landTime - time;
        if (remaining <= 0) {
            return null;
        }
        const progress = Math.min(1, Math.max(0, 1 - remaining / NUKE_LAND_TIME));

        const rocket = {
            x: launch.x + (impact.x - launch.x) * progress,
            y: launch.y + (impact.y - launch.y) * progress,
        };
        const dx = impact.x - launch.x;
        const dy = impact.y - launch.y;
        const angle = Math.hypot(dx, dy) < 1e-6 ? -Math.PI / 2 : Math.atan2(dy, dx);
        return { nuke, launch, impact, rocket, angle, remaining };
    }

    /** @type {Record<string, number>} */
    let incomingCountByRoom = {};
    let flightsKey = "";
    let nukeEpoch = 0;

    function ensureFlightIndex() {
        const shard = currentShard();
        const time = shard ? timeByShard[shard] : undefined;
        const key = `${shard}|${time}|${nukeEpoch}`;
        if (key === flightsKey) {
            return;
        }
        flightsKey = key;

        /** @type {Record<string, number>} */
        const counts = {};
        const nukes = shard ? nukesByShard[shard] : undefined;
        if (nukes) {
            for (const nuke of nukes) {
                if (!flightOf(nuke, time)) {
                    continue;
                }
                counts[nuke.room] = (counts[nuke.room] ?? 0) + 1;
            }
        }
        incomingCountByRoom = counts;
    }

    /**
     * One line for the classic room inspector. Empty when nothing is inbound.
     * @param {string} roomName
     * @returns {string}
     */
    function incomingNukeLabel(roomName) {
        if (!roomName) {
            return "";
        }
        ensureFlightIndex();
        const count = incomingCountByRoom[roomName] ?? 0;
        if (!count) {
            return "";
        }
        return count === 1 ? "1 nuke incoming" : `${count} nukes incoming`;
    }

    function pokeClassicInspector() {
        flightsKey = "";
        if (ScreepsAdapter.currentView === "top.game-world-map") {
            angular.element(".map-float-info").scope()?.$applyAsync();
        }
        if (ScreepsAdapter.currentView === "top.map2shard") {
            syncAlphaIncoming();
        }
    }

    const PATH_INFO_HTML = "\
<div class='nuke-path-info'>\
    <div class='nuke-path-title'></div>\
    <hr>\
    <div class='nuke-path-eta'></div>\
    <div class='nuke-path-landing'></div>\
</div>";

    /**
     * Show this flight in the room panel, or restore the room info when `flight` is null.
     * @param {Flight | null} flight
     */
    function setPathHover(flight) {
        const show = !!flight && nukesEnabled();
        const onClassic = ScreepsAdapter.currentView === "top.game-world-map";
        const onAlpha = ScreepsAdapter.currentView === "top.map2shard";
        const classic = document.querySelector(".map-float-info");
        const alpha = document.querySelector("app-world-tooltip");
        if (classic) {
            const classicShow = show && onClassic;
            classic.classList.toggle("nuke-path-hover", classicShow);
            if (classicShow && flight) {
                fillPathInfo(classic, flight);
            }
        }
        if (alpha) {
            const alphaShow = show && onAlpha;
            alpha.classList.toggle("nuke-path-hover", alphaShow);
            if (alphaShow && flight) {
                fillPathInfo(alpha, flight);
            }
        }
        if (onAlpha) {
            syncAlphaIncoming();
        }
    }

    /**
     * Room name currently shown in the alpha tooltip (`Room W1N1`).
     * @returns {string | null}
     */
    function alphaTooltipRoomName() {
        const text = document.querySelector("app-world-tooltip .__room-name")?.textContent ?? "";
        const match = text.trim().match(/^Room\s+(\S+)/);
        return match ? match[1] : null;
    }

    function syncAlphaIncoming() {
        const line = document.querySelector("app-world-tooltip .nuke-incoming");
        if (!line) {
            return;
        }
        const room = alphaTooltipRoomName();
        const label = room && nukesEnabled() ? incomingNukeLabel(room) : "";
        if (line.textContent !== label) {
            line.textContent = label;
        }
        line.toggleAttribute("hidden", !label);
    }

    function installAlphaNukeInspector() {
        const ui = document.querySelector("app-world-tooltip .--ui");
        if (!ui) {
            return;
        }
        ui.querySelectorAll(".nuke-incoming, .nuke-path-info").forEach((node) => node.remove());
        ui.insertAdjacentHTML("beforeend", `<div class="nuke-incoming" hidden></div>${PATH_INFO_HTML}`);
    }

    const NUKE_INSPECTOR = "\
<div class='nuke-incoming' \
    ng:if='WorldMap.displayOptions.nukes && WorldMap.incomingNukeLabel(MapFloatInfo.float.roomName)'>\
    {{WorldMap.incomingNukeLabel(MapFloatInfo.float.roomName)}}\
</div>" + PATH_INFO_HTML;

    function installNukeInspector() {
        const mapFloatElem = angular.element(".map-float-info");
        if (!mapFloatElem.length) {
            return;
        }
        mapFloatElem[0].querySelectorAll(".nuke-flights, .nuke-incoming, .nuke-path-info").forEach((node) => node.remove());
        mapFloatElem.append(DomHelper.generateCompiledElement(mapFloatElem, NUKE_INSPECTOR));
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
     * @param {Point} a
     * @param {Point} b
     * @param {number} px
     * @param {number} py
     */
    function distanceToSegment(a, b, px, py) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
        return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {Point} a
     * @param {Point} b
     * @param {boolean} hovered
     */
    function drawDottedLine(ctx, a, b, hovered) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.setLineDash(DASH);
        const period = DASH[0] + DASH[1];
        // A positive offset shifts the pattern backward along the stroke.
        ctx.lineDashOffset = -((Date.now() % DASH_PERIOD_MS) / DASH_PERIOD_MS) * period;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.lineWidth = hovered ? 4.5 : 3.5;
        ctx.stroke();
        ctx.strokeStyle = hovered ? "rgba(255, 214, 150, 0.95)" : "rgba(255, 112, 48, 0.9)";
        ctx.lineWidth = hovered ? 2.4 : 1.7;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x
     * @param {number} y
     * @param {number} angle
     */
    function drawRocket(ctx, x, y, angle) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.fillStyle = "#ffb020";
        ctx.strokeStyle = "#6a1d00";
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(2, 3.4);
        ctx.lineTo(-6, 3.4);
        ctx.lineTo(-6, -3.4);
        ctx.lineTo(2, -3.4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-2, 3.4);
        ctx.lineTo(-8, 6.4);
        ctx.lineTo(-6, 3.4);
        ctx.moveTo(-2, -3.4);
        ctx.lineTo(-8, -6.4);
        ctx.lineTo(-6, -3.4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ff5722";
        ctx.beginPath();
        ctx.moveTo(-6, 2.1);
        ctx.lineTo(-12, 0);
        ctx.lineTo(-6, -2.1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x
     * @param {number} y
     */
    function drawImpact(ctx, x, y) {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 80, 40, 0.95)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(255, 80, 40, 0.95)";
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function draw() {
        /** @type {Flight | null} */
        let pathHover = null;
        try {
            if (!ensureCanvas()) {
                return;
            }
            const ctx = prepareContext();
            const project = projectorForCurrentView();
            if (!ctx || !project) {
                return;
            }

            const shard = currentShard();
            if (!shard) return;
            if (ScreepsAdapter.currentView === "top.game-world-map") {
                noteTime(shard, ScreepsAdapter.getWorldMap()?.gameTime);
            }
            if (shard !== polledShard && nukesLoaded) {
                polledShard = shard;
                void refreshTime(shard);
            }

            const time = timeByShard[shard];
            const nukes = nukesByShard[shard];
            if (!nukes?.length) {
                return;
            }

            /** @type {Flight[]} */
            const flights = [];
            for (const nuke of nukes) {
                const flight = flightOf(nuke, time);
                if (flight) {
                    flights.push(flight);
                }
            }

            /** @type {Array<Flight & { launchPx: Point, impactPx: Point, rocketPx: Point }>} */
            const screen = [];
            for (const flight of flights) {
                const launchPx = project(flight.launch.x, flight.launch.y);
                const impactPx = project(flight.impact.x, flight.impact.y);
                const rocketPx = project(flight.rocket.x, flight.rocket.y);
                if (!launchPx || !impactPx || !rocketPx) {
                    continue;
                }
                screen.push({ ...flight, launchPx, impactPx, rocketPx });
            }

            let hovered = -1;
            if (mouse.inside) {
                let best = HOVER_PX;
                for (let i = 0; i < screen.length; i++) {
                    const dist = distanceToSegment(screen[i].launchPx, screen[i].impactPx, mouse.x, mouse.y);
                    if (dist < best) {
                        best = dist;
                        hovered = i;
                    }
                }
            }

            for (let i = 0; i < screen.length; i++) {
                if (i === hovered) {
                    continue;
                }
                drawDottedLine(ctx, screen[i].launchPx, screen[i].impactPx, false);
            }
            if (hovered >= 0) {
                drawDottedLine(ctx, screen[hovered].launchPx, screen[hovered].impactPx, true);
                pathHover = screen[hovered];
            }

            for (const flight of screen) {
                ctx.beginPath();
                ctx.arc(flight.launchPx.x, flight.launchPx.y, 2.2, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(255, 186, 90, 0.95)";
                ctx.fill();
                drawImpact(ctx, flight.impactPx.x, flight.impactPx.y);
            }

            for (const flight of screen) {
                drawRocket(ctx, flight.rocketPx.x, flight.rocketPx.y, flight.angle);
            }
        } finally {
            setPathHover(pathHover);
        }
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
        if (running || !nukesEnabled()) {
            return;
        }
        const view = ScreepsAdapter.currentView;
        if (view !== "top.game-world-map" && view !== "top.map2shard") {
            return;
        }
        running = true;
        window.addEventListener("mousemove", onMouseMove);
        void pollNukes();
        pollTimer = window.setInterval(() => {
            void pollNukes();
        }, POLL_MS);
        timeTimer = window.setInterval(() => {
            void pollTime();
        }, TIME_POLL_MS);
        raf = requestAnimationFrame(frame);
    }

    function stopOverlay() {
        running = false;
        mouse.inside = false;
        polledShard = null;
        window.removeEventListener("mousemove", onMouseMove);
        if (pollTimer) {
            window.clearInterval(pollTimer);
            pollTimer = 0;
        }
        if (timeTimer) {
            window.clearInterval(timeTimer);
            timeTimer = 0;
        }
        if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
        canvas.remove();
        document.querySelector(".map-float-info")?.classList.remove("nuke-path-hover");
        document.querySelector("app-world-tooltip")?.classList.remove("nuke-path-hover");
    }

    function bindClassicToggle() {
        const worldMap = ScreepsAdapter.getWorldMap();
        if (!worldMap) {
            return;
        }
        worldMap.displayOptions.nukes = nukesEnabled();
        worldMap.incomingNukeLabel = incomingNukeLabel;
        worldMap.toggleNukes = function () {
            setNukesEnabled(!worldMap.displayOptions.nukes);
        };
        installNukeInspector();
    }

    ScreepsAdapter.ready(() => {
        DomHelper.addStyle(`
            canvas.nuke-overlay {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                z-index: 2;
                pointer-events: none;
            }
            .nuke-incoming {
                color: #e8a070;
            }
            .nuke-path-info {
                display: none;
            }
            .nuke-path-info hr {
                border: 0;
                border-top: 1px solid #555;
                margin: 4px 0;
            }
            .nuke-path-title {
                font-weight: bold;
                margin-bottom: 2px;
            }
            .map-float-info.nuke-path-hover > :not(.nuke-path-info),
            app-world-tooltip.nuke-path-hover .--ui > :not(.nuke-path-info) {
                display: none !important;
            }
            .map-float-info.nuke-path-hover > .nuke-path-info,
            app-world-tooltip.nuke-path-hover .nuke-path-info {
                display: block;
            }
        `);

        ScreepsAdapter.registerMapButton({
            id: "nukes",
            tooltip: "Toggle nukes",
            content: "<i class='fa fa-rocket'></i>",
            ngClick: "WorldMap.toggleNukes()",
            ngClass: "'md-primary': WorldMap.displayOptions.nukes",
            zoomLevels: [1, 2, 3],
        });

        ScreepsAdapter.AlphaMap.registerPreferenceCheckbox({
            id: "nukes",
            label: "Show in-flight nukes",
            getValue: nukesEnabled,
            onChange: setNukesEnabled,
        });

        ScreepsAdapter.AlphaMap.ready(() => {
            installAlphaNukeInspector();
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
