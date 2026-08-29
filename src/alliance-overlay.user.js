// ==UserScript==
// @name        Screeps alliance overlay
// @namespace   https://screeps.com/
// @version     0.3.4
// @author      James Cook
// @description Overlay alliance relations on the world map
// @run-at      document-ready
// @grant       GM.xmlHttpRequest
// @require     http://www.leagueofautomatednations.com/static/js/vendor/randomColor.js
// @require     REPO_URL/screeps-browser-core.js
// @require     REPO_URL/screeps-alpha-map.js
// @connect     www.leagueofautomatednations.com
// ==/UserScript==

const loanBaseUrl = "https://www.leagueofautomatednations.com";

/** modifyScale at which rooms are ~150px — legacy world map zoom 3 shows logos. */
const ALLIANCE_LOGO_MODIFY_SCALE = 3;
const ALLIANCE_LOGO_ROOM_FRACTION = 1 / 3;

/** @type {Map<string, Promise<any>>} */
const allianceLogoTextures = new Map();

/** Shared logo base textures — must not be destroyed with room sprites. */
/** @type {Set<any>} */
const allianceLogoTextureSet = new Set();

/**
 * @param {AlphaMap.Layer} layer
 * @param {string} room
 */
function destroyAllianceRoomSprite(layer, room) {
    if (!layer.hasRoom(room)) {
        return;
    }

    const sprite = layer.getRoomSprite(room);
    const baseTexture = sprite?.texture?.baseTexture;
    const keepBaseTexture = baseTexture && allianceLogoTextureSet.has(baseTexture);

    layer.destroyRoomSprite(room, keepBaseTexture
        ? { texture: true, baseTexture: false }
        : true);
}

/**
 * @param {any} baseTexture
 */
function waitForBaseTexture(baseTexture) {
    if (baseTexture.valid) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        baseTexture.once("loaded", resolve);
        baseTexture.once("error", reject);
    });
}

/**
 * @param {AlphaMap.Pixi} pixi
 * @param {string} allianceKey
 */
async function loadAllianceLogoBaseTexture(pixi, allianceKey) {
    const url = getAllianceLogo(allianceKey);
    if (!url) {
        return null;
    }

    if (!allianceLogoTextures.has(allianceKey)) {
        allianceLogoTextures.set(allianceKey, (async () => {
            try {
                const texture = pixi.Texture.from(url);
                const baseTexture = texture.baseTexture;
                await waitForBaseTexture(baseTexture);
                allianceLogoTextureSet.add(baseTexture);
                return baseTexture;
            } catch {
                return null;
            }
        })());
    }

    const baseTexture = await allianceLogoTextures.get(allianceKey);
    if (!baseTexture || baseTexture.destroyed || !baseTexture.valid) {
        allianceLogoTextures.delete(allianceKey);
        allianceLogoTextureSet.delete(baseTexture);
        return loadAllianceLogoBaseTexture(pixi, allianceKey);
    }

    return baseTexture;
}

/** @type {{ [allianceId: string]: { name: string, logo: string, members: string[] } }} */
let allianceData;

/** @type {{ [userName: string]: string }} */
let userAlliance;

/**
 * @param {string} allianceKey
 * @returns
 */
function getAllianceLogo(allianceKey) {
    const logo = allianceData?.[allianceKey]?.logo;
    if (!logo) {
        return undefined;
    }
    return loanBaseUrl + "/obj/" + logo;
}

/** @type {{ [allianceId: string]: { css: string, rgb: RGBColor, fromLogo?: boolean } }} */
let colorMap = {};

/** @type {Set<string>} */
const allianceColorResolvers = new Set();

/** @type {Record<string, { rgb: RGBColor, version?: string }> | null} */
let allianceLogoColorCache = null;

const ALLIANCE_LOGO_COLOR_CACHE_KEY = "alliances.logoColors";

let allianceColorRefreshScheduled = false;

/**
 * @returns {Record<string, { rgb: RGBColor, version?: string }>}
 */
function loadAllianceLogoColorCache() {
    if (!allianceLogoColorCache) {
        allianceLogoColorCache = ScreepsAdapter.getSetting(
            ALLIANCE_LOGO_COLOR_CACHE_KEY,
            {},
        );
    }
    return allianceLogoColorCache;
}

/**
 * @param {string} logoId
 * @param {{ rgb: RGBColor, version?: string }} entry
 */
function saveAllianceLogoColorCacheEntry(logoId, entry) {
    const cache = loadAllianceLogoColorCache();
    cache[logoId] = entry;
    ScreepsAdapter.setSetting(ALLIANCE_LOGO_COLOR_CACHE_KEY, cache);
}

/**
 * @param {{ responseHeaders: string }} response
 * @param {string} name
 */
function getResponseHeader(response, name) {
    const match = response.responseHeaders.match(
        new RegExp(`^${name}:\\s*(.+)$`, "im"),
    );
    return match?.[1]?.trim() ?? null;
}

/**
 * @param {{ responseHeaders: string }} response
 */
function getLogoVersionFromResponse(response) {
    return getResponseHeader(response, "etag")
        || getResponseHeader(response, "last-modified");
}

/**
 * @param {string} logoUrl
 * @returns {Promise<string | null>}
 */
function fetchLogoVersion(logoUrl) {
    return new Promise((resolve) => {
        GM.xmlHttpRequest({
            method: "HEAD",
            url: logoUrl,
            onload(response) {
                if (response.status < 200 || response.status >= 300) {
                    resolve(null);
                    return;
                }
                resolve(getLogoVersionFromResponse(response));
            },
            onerror() {
                resolve(null);
            },
        });
    });
}

/**
 * @param {string} allianceKey
 * @returns {RGBColor | null}
 */
function getCachedLogoColor(allianceKey) {
    const logoId = allianceData?.[allianceKey]?.logo;
    if (!logoId) {
        return null;
    }
    return loadAllianceLogoColorCache()[logoId]?.rgb ?? null;
}

/**
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {RGBColor}
 */
function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    /** @type {[number, number, number]} */
    let rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return [
        Math.round((rgb[0] + m) * 255),
        Math.round((rgb[1] + m) * 255),
        Math.round((rgb[2] + m) * 255),
    ];
}

/**
 * @param {RGBColor} rgb
 * @returns {{ css: string, rgb: RGBColor }}
 */
function makeAllianceColor(rgb) {
    return {
        css: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
        rgb,
    };
}

/**
 * @param {string} allianceKey
 * @returns {{ css: string, rgb: RGBColor }}
 */
function makeFallbackAllianceColor(allianceKey) {
    const alliance = allianceData?.[allianceKey];
    const seed = alliance?.name || allianceKey;
    const [hue, sat, lum] = randomColor({
        hue: "random",
        luminosity: "light",
        seed,
        format: "hslArray",
    });
    const lightness = lum / 2;
    return {
        css: `hsl(${hue},${sat}%,${lightness}%)`,
        rgb: hslToRgb(hue, sat, lightness),
    };
}

/**
 * @param {number} channel
 * @param {number} [bits=4]
 */
function quantizeChannel(channel, bits = 4) {
    const shift = 8 - bits;
    return (channel >> shift) << shift;
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 */
function shouldSkipPixel(r, g, b, a) {
    if (a < 128) {
        return true;
    }
    if (r > 240 && g > 240 && b > 240) {
        return true;
    }
    if (r < 15 && g < 15 && b < 15) {
        return true;
    }
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max - min < 20;
}

/**
 * @param {Uint8ClampedArray} data
 * @returns {RGBColor | null}
 */
function dominantColorFromImageData(data) {
    /** @type {Map<string, number>} */
    const counts = new Map();

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (shouldSkipPixel(r, g, b, a)) {
            continue;
        }
        const key = `${quantizeChannel(r)},${quantizeChannel(g)},${quantizeChannel(b)}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    let bestKey = null;
    let bestCount = 0;
    for (const [key, count] of counts) {
        if (count > bestCount) {
            bestCount = count;
            bestKey = key;
        }
    }

    if (!bestKey) {
        return null;
    }

    return /** @type {RGBColor} */ (bestKey.split(",").map(Number));
}

/**
 * @param {string} objectUrl
 * @returns {Promise<RGBColor | null>}
 */
function extractDominantColorFromObjectUrl(objectUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const size = 64;
                const canvas = document.createElement("canvas");
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    resolve(null);
                    return;
                }
                ctx.drawImage(img, 0, 0, size, size);
                const data = ctx.getImageData(0, 0, size, size).data;
                resolve(dominantColorFromImageData(data));
            } catch {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = objectUrl;
    });
}

/**
 * @param {string} logoUrl
 * @returns {Promise<{ rgb: RGBColor, version: string | null } | null>}
 */
function fetchAllianceLogoColor(logoUrl) {
    return new Promise((resolve) => {
        GM.xmlHttpRequest({
            method: "GET",
            url: logoUrl,
            responseType: "blob",
            async onload(response) {
                if (response.status < 200 || response.status >= 300) {
                    resolve(null);
                    return;
                }

                const objectUrl = URL.createObjectURL(response.response);
                try {
                    const rgb = await extractDominantColorFromObjectUrl(objectUrl);
                    if (!rgb) {
                        resolve(null);
                        return;
                    }
                    resolve({
                        rgb,
                        version: getLogoVersionFromResponse(response),
                    });
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            },
            onerror() {
                resolve(null);
            },
        });
    });
}

/**
 * @param {string} allianceKey
 * @param {RGBColor} rgb
 */
function setAllianceLogoColor(allianceKey, rgb) {
    const previous = colorMap[allianceKey];
    const next = { ...makeAllianceColor(rgb), fromLogo: true };
    const unchanged = previous?.fromLogo
        && previous.rgb[0] === next.rgb[0]
        && previous.rgb[1] === next.rgb[1]
        && previous.rgb[2] === next.rgb[2];
    colorMap[allianceKey] = next;
    applyAllianceColorStyle(allianceKey);
    if (!unchanged) {
        scheduleAllianceColorRefresh();
    }
}

/**
 * @param {string} allianceKey
 */
function applyAllianceColorStyle(allianceKey) {
    const color = colorMap[allianceKey];
    if (!color) {
        return;
    }
    DomHelper.addStyle(".alliance-" + allianceKey + " { background-color: " + color.css + " }");
}

function scheduleAllianceColorRefresh() {
    if (allianceColorRefreshScheduled) {
        return;
    }
    allianceColorRefreshScheduled = true;
    setTimeout(() => {
        allianceColorRefreshScheduled = false;
        recalculateAllianceOverlay();
        ScreepsAdapter.AlphaMap?.refresh();
    }, 100);
}

/**
 * @param {string} allianceKey
 */
async function resolveAllianceColorFromLogo(allianceKey) {
    const logoUrl = getAllianceLogo(allianceKey);
    const logoId = allianceData?.[allianceKey]?.logo;
    if (!logoUrl || !logoId) {
        return;
    }

    const cached = loadAllianceLogoColorCache()[logoId];
    if (cached?.rgb) {
        setAllianceLogoColor(allianceKey, cached.rgb);
    }

    const version = await fetchLogoVersion(logoUrl);
    if (cached?.rgb && version && cached.version === version) {
        return;
    }
    if (cached?.rgb && !version) {
        return;
    }

    const result = await fetchAllianceLogoColor(logoUrl);
    if (!result?.rgb) {
        return;
    }

    saveAllianceLogoColorCacheEntry(logoId, {
        rgb: result.rgb,
        version: version || result.version || undefined,
    });
    setAllianceLogoColor(allianceKey, result.rgb);
}

/**
 * @param {string} allianceKey
 */
function ensureAllianceColorResolved(allianceKey) {
    if (colorMap[allianceKey]?.fromLogo || allianceColorResolvers.has(allianceKey)) {
        return;
    }

    allianceColorResolvers.add(allianceKey);
    resolveAllianceColorFromLogo(allianceKey).finally(() => {
        allianceColorResolvers.delete(allianceKey);
    });
}

function ensureAllAllianceColors() {
    if (!allianceData) {
        return;
    }
    for (const allianceKey of Object.keys(allianceData)) {
        ensureAllianceColorResolved(allianceKey);
    }
}

/**
 * @param {string} allianceKey
 * @returns {{ css: string, rgb: RGBColor }}
 */
function getAllianceColor(allianceKey) {
    if (!colorMap[allianceKey]) {
        const cachedRgb = getCachedLogoColor(allianceKey);
        if (cachedRgb) {
            colorMap[allianceKey] = { ...makeAllianceColor(cachedRgb), fromLogo: true };
        } else {
            colorMap[allianceKey] = makeFallbackAllianceColor(allianceKey);
        }
        ensureAllianceColorResolved(allianceKey);
    }
    return colorMap[allianceKey];
}

/**
 * @param {string | undefined} username
 */
function getAllianceNameForUsername(username) {
    if (!username) {
        return "None";
    }
    if (!userAlliance) {
        return "Loading...";
    }
    const allianceKey = userAlliance[username];
    if (!allianceKey) {
        return "None";
    }
    return allianceData?.[allianceKey]?.name ?? "None";
}

/**
 * @param {RGBColor} rgb
 * @param {number} [alpha=102]
 */
function allianceRoomPixels(rgb, alpha = 102) {
    const {  ROOM_SIZE } = ScreepsAdapter.AlphaMap;
    const pixels = new Uint8Array(ROOM_SIZE * ROOM_SIZE * 4);
    for (let i = 0; i < ROOM_SIZE * ROOM_SIZE; i++) {
        pixels[i * 4 + 0] = rgb[0];
        pixels[i * 4 + 1] = rgb[1];
        pixels[i * 4 + 2] = rgb[2];
        pixels[i * 4 + 3] = alpha;
    }
    return pixels;
}

/**
 * @param {AlphaMap.Pixi} pixi
 * @param {string} allianceKey
 */
async function createAllianceLogoTexture(pixi, allianceKey) {
    const baseTexture = await loadAllianceLogoBaseTexture(pixi, allianceKey);
    if (!baseTexture?.valid) {
        return null;
    }
    return new pixi.Texture(baseTexture);
}

/**
 * @param {AlphaMap.Layer} layer
 * @param {string} room
 * @param {AlphaMap.Pixi} pixi
 * @param {string} allianceKey
 */
async function drawAllianceRoomTint(layer, room, pixi, allianceKey) {
    const { ROOM_SIZE } = ScreepsAdapter.AlphaMap;
    const pixels = allianceRoomPixels(getAllianceColor(allianceKey).rgb);
    if (pixels.length !== ROOM_SIZE * ROOM_SIZE * 4) {
        return;
    }
    const texture = pixi.Texture.fromBuffer(pixels, ROOM_SIZE, ROOM_SIZE);
    const sprite = layer.createRoomSprite(room, texture);
    layer.container.addChild(sprite);
}

/**
 * @param {AlphaMap.Layer} layer
 * @param {string} room
 * @param {string} allianceKey
 */
async function drawAllianceRoom(layer, room, allianceKey) {
    destroyAllianceRoomSprite(layer, room);

    const { AlphaMap } = ScreepsAdapter;
    const pixi = AlphaMap.getPixi();
    if (!pixi) {
        return;
    }

    if (AlphaMap.isZoomedIn(ALLIANCE_LOGO_MODIFY_SCALE) && getAllianceLogo(allianceKey)) {
        await drawAllianceRoomLogo(layer, room, pixi, allianceKey);
    } else {
        await drawAllianceRoomTint(layer, room, pixi, allianceKey);
    }
}

/**
 * @param {AlphaMap.Layer} layer
 * @param {string} room
 * @param {AlphaMap.Pixi} pixi
 * @param {string} allianceKey
 */
async function drawAllianceRoomLogo(layer, room, pixi, allianceKey) {
    const texture = await createAllianceLogoTexture(pixi, allianceKey);
    if (!texture?.baseTexture?.valid) {
        await drawAllianceRoomTint(layer, room, pixi, allianceKey);
        return;
    }

    const sprite = layer.createRoomSprite(room, texture);
    const { TILE_SIZE } = ScreepsAdapter.AlphaMap;
    const size = TILE_SIZE * ALLIANCE_LOGO_ROOM_FRACTION;
    sprite.width = size;
    sprite.height = size;
    sprite.alpha = 0.8;
    layer.container.addChild(sprite);
}

/**
 * query for alliance data from the LOAN site
 * @param {() => void} callback
 */
function ensureAllianceData(callback) {
    if (allianceData) {
        if (callback) callback();
        return;
    }

    GM.xmlHttpRequest({
        method: "GET",
        url: (loanBaseUrl + "/alliances.js"),
        onload: function(response) {
            allianceData = JSON.parse(response.responseText);
            userAlliance = {};

            for (let allianceKey in allianceData) {
                let alliance = allianceData[allianceKey];
                for (let userIndex in alliance.members) {
                    let userName = alliance.members[userIndex];
                    userAlliance[userName] = allianceKey;
                }
            }

            console.log("Alliance data loaded from LOAN.");
            ensureAllAllianceColors();
            if (callback) callback();
        }
    });
}

/**
 * @returns {any | null}
 */
function getClassicWorldMap() {
    for (const selector of [".map-container", ".world-map"]) {
        const elem = angular.element(selector);
        if (!elem.length) {
            continue;
        }
        const worldMap = elem.scope()?.WorldMap;
        if (worldMap) {
            return worldMap;
        }
    }
    return null;
}

/**
 * @returns {{ scope: any, worldMap: any, mapContainerElem: JQuery } | null}
 */
function getClassicWorldMapContext() {
    const mapContainerElem = angular.element(".map-container");
    if (!mapContainerElem.length) {
        return null;
    }

    const scope = mapContainerElem.scope();
    const worldMap = scope?.WorldMap;
    if (!scope || !worldMap) {
        return null;
    }

    return { scope, worldMap, mapContainerElem };
}

/**
 * Stuff references to the alliance data in the world map object. Not clear whether this is actually doing useful things.
 */
function exposeAllianceDataForAngular() {
    let $timeout = angular.element("body").injector().get("$timeout");

    $timeout(() => {
        const worldMap = getClassicWorldMap();
        if (!worldMap) {
            return;
        }

        worldMap.allianceData = allianceData;
        worldMap.userAlliance = userAlliance;

        recalculateAllianceOverlay();
    });

    for (let allianceKey in allianceData) {
        DomHelper.addStyle(".alliance-" + allianceKey + " { background-color: " + getAllianceColor(allianceKey).css + " }");
        DomHelper.addStyle(".alliance-logo-3.alliance-" + allianceKey + " { background-image: url('" + getAllianceLogo(allianceKey) + "') }");
    }
}

/**
 * Bind the WorldMap alliance display option to the persisted setting
 */
function bindAllianceSetting() {
    let alliancesEnabled = ScreepsAdapter.getSetting("alliancesEnabled", true);
    const worldMap = getClassicWorldMap();
    if (!worldMap) {
        return;
    }

    worldMap.displayOptions.alliances = alliancesEnabled;

    worldMap.toggleAlliances = function () {
        worldMap.displayOptions.alliances = !worldMap.displayOptions.alliances;
        setAlliancesEnabled(worldMap.displayOptions.alliances);

        if (worldMap.displayOptions.alliances && !worldMap.userAlliances) {
            ensureAllianceData(exposeAllianceDataForAngular);
        } else {
            document.querySelectorAll(".alliance-logo").forEach(n => n.remove());
        }
    };

    /**
     * @param {string} userId
     */
    worldMap.getAllianceName = function (userId) {
        return getAllianceNameForUsername(this.roomUsers[userId]?.username);
    };

    if (alliancesEnabled) {
        ensureAllianceData(exposeAllianceDataForAngular);
        recalculateAllianceOverlay();
    }
}

// Add an "alliance" row to the room info overlay
function addAllianceToInfoOverlay() {
    let content = "\
        <div class='owner' ng:if='WorldMap.displayOptions.alliances && WorldMap.roomStats[MapFloatInfo.float.roomName].own'>\
            <label>Alliance:</label>\
            <span>\
                {{WorldMap.getAllianceName(WorldMap.roomStats[MapFloatInfo.float.roomName].own.user)}}\
            </span>\
        </div>";

    let mapFloatElem = angular.element(".map-float-info");
    let compiledContent = DomHelper.generateCompiledElement(mapFloatElem, content);
    $(compiledContent).insertAfter($(mapFloatElem).children(".owner")[0]);
}

function recalculateAllianceOverlay() {
    const ctx = getClassicWorldMapContext();
    if (!ctx) {
        return;
    }

    const { worldMap, mapContainerElem } = ctx;
    if (!worldMap.displayOptions.alliances || !worldMap.allianceData) return;

    /**
     * @param {string} roomName
     * @param {number} left
     * @param {number} top
     */
    function drawRoomAllianceOverlay(roomName, left, top) {
        let roomDiv = $('<div class="alliance-logo" id="' + roomName + '"></div>');
        let roomStats = worldMap.roomStats[roomName];
        if (roomStats && roomStats.own) {
            let userName = worldMap.roomUsers[roomStats.own.user].username;
            let allianceKey = worldMap.userAlliance[userName];
            if (allianceKey) {
                $(roomDiv).addClass("alliance-" + allianceKey);

                $(roomDiv).removeClass("alliance-logo-1 alliance-logo-2 alliance-logo-3");
                $(roomDiv).css("left", left);
                $(roomDiv).css("top", top);
                $(roomDiv).addClass("alliance-logo-" + worldMap.zoom);

                $(mapContainerElem).append(roomDiv);
            }
        }
    }

    let $location = mapContainerElem.injector().get("$location");
    if ($location.search().pos) {
        let roomPixels;
        let roomsPerSectorEdge;
        switch (worldMap.zoom) {
        case 1: { roomPixels = 20;  roomsPerSectorEdge = 10; break; }
        case 2: { roomPixels = 50;  roomsPerSectorEdge =  4; break; }
        case 3: { roomPixels = 150; roomsPerSectorEdge =  1; break; }
        default: return;
        }

        let posStr = $location.search().pos;
        if (!posStr) return;

        //if (worldMap.zoom !== 3) return; // Alliance images are pretty ugly at high zoom.

        for (let u = 0; u < worldMap.sectors.length; u++) {
            let sector = worldMap.sectors[u];
            if (!sector || !sector.pos) continue;

            if (worldMap.zoom === 3) {
                // we're at zoom level 3, only render one room
                drawRoomAllianceOverlay(sector.name, sector.left, sector.top);
            } else if (sector.rooms) {
                // high zoom, render a bunch of rooms
                let rooms = sector.rooms.split(",");
                for (let x = 0; x < roomsPerSectorEdge; x++) {
                    for (let y = 0; y < roomsPerSectorEdge; y++) {
                        let roomName = rooms[x * roomsPerSectorEdge + y];
                        drawRoomAllianceOverlay(
                            roomName,
                            sector.left + x * roomPixels,
                            sector.top + y * roomPixels);
                    }
                }
            }
        }
    }
}

let pendingRedraws = 0;
function addSectorAllianceOverlay() {
    DomHelper.addStyle("\
        .alliance-logo { position: absolute; z-index: 2; opacity: 0.4 }\
        .alliance-logo-1 { width: 20px; height: 20px; }\
        .alliance-logo-2 { width: 50px; height: 50px; }\
        .alliance-logo-3 { width: 50px; height: 50px; background-size: 50px 50px; opacity: 0.8 }\
    ");

    const ctx = getClassicWorldMapContext();
    if (!ctx) {
        return;
    }

    const { scope } = ctx;

    let deferRecalculation = function () {
        // remove alliance logos during redraws
        document.querySelectorAll(".alliance-logo").forEach(n => n.remove());

        pendingRedraws++;
        setTimeout(() => {
            pendingRedraws--;
            if (pendingRedraws === 0) {
                recalculateAllianceOverlay();
            }
        }, 500);
    }
    scope.$on("mapSectorsRecalced", deferRecalculation);
    scope.$on("mapStatsUpdated", deferRecalculation);
}

function addAllianceColumnToLeaderboard() {
    function deferredLeaderboardLoad() {
        let leaderboardScope = angular.element(".leaderboard table").scope();
        if (leaderboardScope) {
            let rows = angular.element(".leaderboard table tr")
            let leaderboard = leaderboardScope.$parent.LeaderboardList;

            ensureAllianceData(() => {
                for (let i = 0; i < rows.length; i++) {
                    if (i === 0) {
                        let playerElem = $(rows[i]).children("th:nth-child(2)");
                        $("<th class='alliance-leaderboard'>Alliance</th>").insertAfter(playerElem);
                    } else {
                        let playerElem = $(rows[i]).children("td:nth-child(2)");
                        let userId = leaderboard.list[i - 1].user;
                        let userName = leaderboard.users[userId].username;
                        let allianceKey = userAlliance[userName];
                        let allianceName = (allianceKey ? allianceData[allianceKey].name : "");

                        $("<td class='alliance-leaderboard'>" + allianceName +" </td>").insertAfter(playerElem);
                    }
                }
            });
        } else {
            setTimeout(deferredLeaderboardLoad, 100);
        }
    }

    setTimeout(deferredLeaderboardLoad, 100);
}

const ALLIANCE_LAYER = "alliances";

function alliancesEnabled() {
    return ScreepsAdapter.getSetting("alliancesEnabled", true);
}

/**
 * @param {boolean} enabled
 */
function setAlliancesEnabled(enabled) {
    ScreepsAdapter.setSetting("alliancesEnabled", enabled);
}

let alphaMapTooltipAllianceInstalled = false;

/**
 * @param {HTMLElement} tooltipEl
 */
function ensureAlphaMapTooltipAllianceRow(tooltipEl) {
    const uiDiv = tooltipEl.querySelector(".--ui");
    if (!uiDiv) {
        return null;
    }

    let row = uiDiv.querySelector(".__alliance");
    if (row) {
        return row;
    }

    row = document.createElement("div");
    row.className = "__alliance";
    row.innerHTML = "<label>Alliance:</label><span></span>";

    const rcl = uiDiv.querySelector(".__rcl");
    if (rcl) {
        rcl.insertAdjacentElement("beforebegin", row);
    } else {
        const owners = uiDiv.querySelectorAll(".__owner");
        const lastOwner = owners[owners.length - 1];
        if (lastOwner) {
            lastOwner.insertAdjacentElement("afterend", row);
        } else {
            uiDiv.appendChild(row);
        }
    }
    return row;
}

/**
 * @param {HTMLElement} tooltipEl
 * @param {{ own?: { username?: string } }} data
 */
function updateAlphaMapTooltipAlliance(tooltipEl, data) {
    tooltipEl.querySelector(".alliance-tooltip-row")?.remove();

    if (!alliancesEnabled() || !data?.own?.username) {
        tooltipEl.querySelector(".__alliance")?.remove();
        return;
    }

    const row = ensureAlphaMapTooltipAllianceRow(tooltipEl);
    const span = row?.querySelector("span");
    if (!span) {
        return;
    }

    if (!userAlliance) {
        span.textContent = "Loading...";
        ensureAllianceData(() => {
            span.textContent = getAllianceNameForUsername(data.own?.username);
        });
        return;
    }

    span.textContent = getAllianceNameForUsername(data.own.username);
}

function installAlphaMapTooltipAlliance() {
    if (alphaMapTooltipAllianceInstalled) {
        return;
    }

    DomHelper.addStyle("\
        .__alliance label {\
            color: #888;\
            margin-right: 4px;\
        }\
    ");

    const { AlphaMap } = ScreepsAdapter;

    AlphaMap.ready(async () => {
        await ScreepsAdapter.waitFor(() => {
            const tooltipEl = document.querySelector("app-world-tooltip");
            const baseEl = document.querySelector("app-world-map-base");
            // @ts-expect-error ng is injected by the Screeps client
            return tooltipEl && baseEl && ng.probe(baseEl)?.componentInstance?.tooltipRef;
        });

        const tooltipEl = /** @type {HTMLElement} */ (document.querySelector("app-world-tooltip"));
        const baseEl = document.querySelector("app-world-map-base");
        // @ts-expect-error ng is injected by the Screeps client
        const tooltipRef = ng.probe(baseEl).componentInstance.tooltipRef;

        if (tooltipRef._allianceTooltipPatched) {
            alphaMapTooltipAllianceInstalled = true;
            return;
        }
        tooltipRef._allianceTooltipPatched = true;

        const origSetData = tooltipRef.setData.bind(tooltipRef);
        tooltipRef.setData = function (/** @type {{ own?: { username?: string } }} */ data) {
            origSetData(data);
            ScreepsAdapter.$timeout(() => {
                updateAlphaMapTooltipAlliance(tooltipEl, data);
            });
        };

        alphaMapTooltipAllianceInstalled = true;
    });
}

let alphaMapAllianceLayerInstalled = false;

function installAlphaMapAllianceLayer() {
    if (alphaMapAllianceLayerInstalled) {
        return;
    }
    alphaMapAllianceLayerInstalled = true;

    const { AlphaMap } = ScreepsAdapter;

    AlphaMap.registerPreferenceCheckbox({
        id: "alliances",
        label: "Show alliances",
        getValue: alliancesEnabled,
        onChange: (enabled) => {
            setAlliancesEnabled(enabled);
            AlphaMap.toggleLayer(ALLIANCE_LAYER, enabled);
        },
    });

    AlphaMap.ready(() => {
        ensureAllianceData(() => {
            const Layer = AlphaMap.getLayerClass();

            class AllianceLayer extends Layer {
                static renderObservables = [() => AlphaMap.getBaseComponent()?._drawMapUsersSbj.asObservable()];
                static renderOnScaleThreshold = ALLIANCE_LOGO_MODIFY_SCALE;

                constructor() {
                    super(ALLIANCE_LAYER);
                }

                /**
                 * @param {{ room: string, user?: { username?: string } }[]} users
                 */
                async render(users) {
                    for (const { room, user } of users) {
                        await this.draw(room, { username: user?.username });
                    }
                }

                /**
                 * @param {string} room
                 * @param {{ username?: string }} options
                 */
                async draw(room, { username }) {
                    if (!username || !alliancesEnabled()) {
                        destroyAllianceRoomSprite(this, room);
                        return;
                    }

                    const allianceKey = userAlliance[username];
                    if (!allianceKey || !allianceData?.[allianceKey]) {
                        destroyAllianceRoomSprite(this, room);
                        return;
                    }

                    await drawAllianceRoom(this, room, allianceKey);
                }
            }

            AlphaMap.registerCustomLayer(
                () => new AllianceLayer(),
                alliancesEnabled(),
            );

            AlphaMap.toggleLayer(ALLIANCE_LAYER, alliancesEnabled());
        });
    });
}

// Entry point
ScreepsAdapter.ready(() => {
    ScreepsAdapter.registerMapButton({
        id: "alliances",
        tooltip: "Toggle alliances",
        content: "<span>&#9733;</span>",
        ngClick: "WorldMap.toggleAlliances()",
        ngClass: "'md-primary': WorldMap.displayOptions.alliances",
        zoomLevels: [1, 2, 3],
    });
    installAlphaMapAllianceLayer();
    installAlphaMapTooltipAlliance();
    ScreepsAdapter.onViewChange((view) => {
        if (view === "top.game-world-map") {
            ScreepsAdapter.$timeout(() => {
                bindAllianceSetting();
                addAllianceToInfoOverlay();

                addSectorAllianceOverlay();
            });
        }
    });

    ScreepsAdapter.onHashChange((hash) => {
        let match = hash.match(/#!\/(.+?)\//);
        if (match && match.length > 1 && match[1] === "rank") {
            let app = angular.element(document.body);
            let search = app.injector().get("$location").search();
            if (search.page) addAllianceColumnToLeaderboard();
        }
    });
});
