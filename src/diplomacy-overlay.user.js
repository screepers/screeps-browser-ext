// ==UserScript==
// @name        Screeps diplomacy overlay
// @namespace   https://screeps.com/
// @version     0.3.0
// @author      James Cook
// @description Overlay diplomacy relations on the world map
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @match       http://*.localhost/(*)/*
// @run-at      document-ready
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @require     REPO_URL/screeps-browser-core.js
// @require     REPO_URL/screeps-alpha-map.js
// ==/UserScript==

// @ts-nocheck

/** @type {{ [userId: string]: RGBColor }} */
let colorMap = {
    2: [255, 150, 0],
    3: [255, 150, 0],
    w: [0, 0, 0],
    r: [60, 60, 60],
    pb: [255, 255, 255],
    m: [170, 170, 170],
    p: [0, 200, 255],
    k: [100, 0, 0],
    c: [80, 80, 80],
    s: [255, 242, 70]
};

/**
 *
 * @param {number} hue
 * @param {number} saturation
 * @param {number} lightness
 * @returns {RGBColor | undefined}
 */
function generateColor(hue, saturation, lightness) {
    for (let i = 0; i < 100; i++) {
        let color = hslToRGB(
            5 * Math.round(30 * Math.random() / 5) + hue,
            .1 * Math.round(.2 * Math.random() / .1) + saturation,
            .1 * Math.round(.2 * Math.random() / .1) + lightness
        );
        if (!_.some(colorMap, (existing) => _.eq(existing, color)))
            return color;
    }
}

/** @type {RGBColor} */
const userColor = [0, 255, 0];
/** @type {RGBColor} */
const zombieColor = [128, 128, 128];

/**
 *
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @returns {HSLColor}
 */
function hslToRGB(a, b, c) {
    0 > a && (a += 360);
    let d, e, f, g = (1 - Math.abs(2 * c - 1)) * b, h = a / 60, i = g * (1 - Math.abs(h % 2 - 1));
    void 0 === a || isNaN(a) || null === a ? d = e = f = 0 : h >= 0 && 1 > h ? (d = g,
    e = i,
    f = 0) : h >= 1 && 2 > h ? (d = i,
    e = g,
    f = 0) : h >= 2 && 3 > h ? (d = 0,
    e = g,
    f = i) : h >= 3 && 4 > h ? (d = 0,
    e = i,
    f = g) : h >= 4 && 5 > h ? (d = i,
    e = 0,
    f = g) : h >= 5 && 6 > h && (d = g,
    e = 0,
    f = i);
    let j, k, l, m = c - g / 2;
    return j = 255 * (d + m),
    k = 255 * (e + m),
    l = 255 * (f + m),
    j = Math.round(j),
    k = Math.round(k),
    l = Math.round(l),
    [j, k, l]
}

/**
 * @param {string} userid
 * @param {string} userName
 * @returns
 */
function generateAndSetColor(userid, userName) {
    let color;
    let diplomacyScore;
    if (diplomacyData.users && diplomacyData.users[userName]) {
        diplomacyScore = diplomacyData.users[userName].state;
    }

    switch (diplomacyScore) {
    case -1: color = generateColor(-15, .8, .4); break;
    case  1: color = generateColor(210, .8, .5); break;

    default:
    case  0: color = generateColor(40, .8, .35); break;
    }
    colorMap[userid] = color;

    return color;
}

/**
 * @param {string} type
 */
function getColor(type) {
    let color = colorMap[type];
    if (!color) {
        /** @type {{[type: string]: { username: string }}} */
        let userMap = {};
        if (angular.element(".world-map").length) {
            let worldMap = angular.element(".world-map").scope().WorldMap;
            userMap = worldMap.roomUsers;
        } else if (document.querySelector("app-world-map-base")) {
            userMap = alphaMapRoomUsers;
        } else {
            const roomScope = angular.element(".room").scope();
            userMap = roomScope?.Room?.users ?? {};
        }

        if (!userMap[type]) {
            return false;
        }

        let userName = userMap[type].username;
        color = generateAndSetColor(type, userName);
    }
    return color;
}

/**
 *
 * @param {any} image
 * @param {any[]} positions
 * @param {RGBColor} color
 * @param {number} mapScale
 */
function colorPositions(image, positions, color, mapScale) {
    if (positions && positions.length) {
        for (let e = 0; mapScale > e; e++) {
            for (let f = 0; mapScale > f; f++) {
                positions.forEach(function(pos) {
                    image.data[50 * mapScale * (mapScale * pos[1] + f) * 4 + 4 * (mapScale * pos[0] + e) + 0] = color[0];
                    image.data[50 * mapScale * (mapScale * pos[1] + f) * 4 + 4 * (mapScale * pos[0] + e) + 1] = color[1];
                    image.data[50 * mapScale * (mapScale * pos[1] + f) * 4 + 4 * (mapScale * pos[0] + e) + 2] = color[2];
                    image.data[50 * mapScale * (mapScale * pos[1] + f) * 4 + 4 * (mapScale * pos[0] + e) + 3] = 255;
                });
            }
        }
    }
}

/**
 * @type {{ users: Record<string, { state: number }> }}
 */
let diplomacyData;
/**
 *
 * @param {() => void} callback
 */
function ensureDiplomacyData(callback) {
    ScreepsAdapter.Connection.getMemoryByPath(ScreepsAdapter.User._id, "diplomacy").then((data) => {
        if (!data) {
            console.log("No diplomacy data available");
        } else {
            diplomacyData = data;
            colorMap[ScreepsAdapter.User._id] = userColor;
        }
        callback();
    });
}

/**
 *
 * @param {any} scope
 * @param {HTMLCanvasElement} element
 * @param {*} roomHandle
 * @param {*} mapScale
 */
function prepareRoomObjects(scope, element, roomHandle, mapScale) {
    let graphics = element.getContext("2d");
    element.listenerEvent = ScreepsAdapter.Socket.bindEventToScope(scope, `roomMap2:${roomHandle}`, function(objects) {
        let image = graphics.createImageData(50 * mapScale, 50 * mapScale);
        if (objects) {
            if (_.any(objects, (obj) => !getColor(obj.itemType)));
            _.forEach(objects, function(positions, itemType) {
                let color = getColor(itemType);
                if (!color) {
                    ScreepsAdapter.Api.get("user/find?id=" + itemType).then((data) => {
                        if (getColor(itemType)) return; // someone already loaded this

                        let userName = data.user.username;
                        generateAndSetColor(itemType, userName);
                    });
                    colorPositions(image, positions, zombieColor, mapScale);
                } else {
                    colorPositions(image, positions, color, mapScale);
                }
            });
        }
        graphics.putImageData(image, 0, 0);
    })

    element.roomHandle = roomHandle;
}

function recalculateWorldMapDiplomacyOverlay() {
    const content = document.createElement("canvas");
    content.className = "room-diplomacy-objects";
    content.height = 150;
    content.width = 150;
    content.setAttribute("map-scale", "3");

    let mapContainerElem = angular.element(".map-container");
    let worldMap = mapContainerElem.scope().WorldMap;

    let mapSectors = document.querySelectorAll(".map-sector");
    for (let i = 0; i < mapSectors.length; i++) {
        let sectorElem = angular.element(mapSectors[i]);
        let scope = sectorElem.scope();
        let sector = scope.$parent.sector;
        let roomHandle = worldMap.shard + "/" + sector.name;

        let element = sectorElem[0].querySelectorAll(".room-diplomacy-objects");
        if (element.length) {
            if (element[0].roomHandle !== roomHandle) {
                if (element[0].listenerEvent) {
                    element[0].listenerEvent.remove();
                    element[0].listenerEvent = null;
                }
                prepareRoomObjects(scope, element, roomHandle, 3);
            }
        } else {
            // create a new div
            element = sectorElem[0].appendChild(content.cloneNode());
            prepareRoomObjects(scope, element, roomHandle, 3);
        }
    }
}

let pendingWorldMapDiplomacyRedraws = 0;
function deferWorldMapDiplomacyRedraw() {
    let scope = angular.element(".map-container").scope();
    let worldMap = scope.WorldMap;

    const content = document.querySelectorAll(".room-diplomacy-objects");
    for (const elem of content) {
        elem.toggleAttribute("hidden", true);
        if (elem.listenerEvent) elem.listenerEvent.remove();
        elem.remove();
    }

    if (diplomacyData && worldMap.zoom === 3 && worldMap.displayOptions.diplomacyUnits) {
        pendingWorldMapDiplomacyRedraws++;
        setTimeout(() => {
            pendingWorldMapDiplomacyRedraws--;
            if (pendingWorldMapDiplomacyRedraws === 0) {
                recalculateWorldMapDiplomacyOverlay();
                content.forEach(e => e.toggleAttribute("hidden", false));
            }
        }, 500);
    }
}

function bindDiplomacyUnitsSetting() {
    let worldMap = angular.element(".map-container").scope().WorldMap;
    worldMap.displayOptions.diplomacyUnits = ScreepsAdapter.getSetting("diplomacyUnits", true);

    worldMap.toggleDiplomacyUnits = function () {
        worldMap.displayOptions.diplomacyUnits = !worldMap.displayOptions.diplomacyUnits;
        ScreepsAdapter.setSetting("diplomacyUnits", worldMap.displayOptions.diplomacyUnits);
        deferWorldMapDiplomacyRedraw();
    };
}

function bindWorldMapStatsMonitor() {
    let scope = angular.element(".map-container").scope();
    ensureDiplomacyData(() => {
        scope.$on("mapSectorsRecalced", deferWorldMapDiplomacyRedraw);
        scope.$on("mapStatsUpdated", deferWorldMapDiplomacyRedraw);
        deferWorldMapDiplomacyRedraw();
    });
}

function bindRoomStatsMonitor() {
    const content = document.createElement("canvas");
    content.className = "room-diplomacy-objects";
    content.height = 50;
    content.width = 50;
    content.setAttribute("map-scale", "1");
    document.querySelectorAll(".room-diplomacy-objects").forEach(e => e.remove());

    function deferredMinimapOverlay() {
        let minimapRoot = angular.element(".world-minimap");
        if (minimapRoot.length) {
            ensureDiplomacyData(() => {
                let roomOverlays = document.querySelectorAll(".world-minimap canvas.room-objects");
                for (let i = 0; i < roomOverlays.length; i++) {
                    let roomOverlayElem = angular.element(roomOverlays[i]);
                    let scope = roomOverlayElem.scope();
                    let roomHandle = roomOverlayElem[0].getAttribute("app:game-map-room-objects");

                    let element = roomOverlayElem.parent().find(".room-diplomacy-objects");
                    if (element.length) {
                        if (element[0].roomHandle !== roomHandle) {
                            if (element[0].listenerEvent) {
                                element[0].listenerEvent.remove();
                                element[0].listenerEvent = null;
                            }
                            prepareRoomObjects(scope, element, roomHandle, 1);
                        }
                    } else {
                        // create a new div
                        element = roomOverlayElem[0].parentNode.insertBefore(content.cloneNode(), roomOverlayElem[0]);
                        prepareRoomObjects(scope, element, roomHandle, 1);
                    }
                }
            });
        } else {
            setTimeout(deferredMinimapOverlay, 100);
        }
    }

    setTimeout(deferredMinimapOverlay, 100);
}

const DIPLOMACY_LAYER = "diplomacy-units";

/** @type {Record<string, { username: string }>} */
let alphaMapRoomUsers = {};

function diplomacyUnitsEnabled() {
    return ScreepsAdapter.getSetting("diplomacyUnits", true);
}

/**
 * @param {AlphaMap.MapBound} bound
 * @returns {string[]}
 */
function roomNamesInBound(bound) {
    const rooms = [];
    for (let dx = 0; dx < bound.width; dx++) {
        for (let dy = 0; dy < bound.height; dy++) {
            rooms.push(ScreepsAdapter.MapUtils.getRoomNameFromXY(bound.x + dx, bound.y + dy));
        }
    }
    return rooms;
}

/**
 * @param {AlphaMap.Layer} layer
 * @param {string} room
 */
function destroyDiplomacyRoomSprite(layer, room) {
    if (layer.hasRoom(room)) {
        layer.destroyRoomSprite(room, true);
    }
}

/**
 * @param {AlphaMap.Layer} layer
 * @param {string} room
 * @param {Record<string, [number, number][]>} objects
 */
async function drawDiplomacyRoom(layer, room, objects) {
    const { AlphaMap } = ScreepsAdapter;
    const pixi = AlphaMap.getPixi();
    if (!pixi) {
        return;
    }

    if (!objects || !_.some(objects, (positions) => positions?.length)) {
        destroyDiplomacyRoomSprite(layer, room);
        return;
    }

    const pixels = AlphaMap.drawRoomObjects(objects, (itemType) => {
        const color = getColor(itemType);
        if (!color) {
            ScreepsAdapter.Api.get("user/find?id=" + itemType).then((data) => {
                if (getColor(itemType)) {
                    return;
                }
                generateAndSetColor(itemType, data.user.username);
            });
            return zombieColor;
        }
        return color;
    });

    const texture = pixi.Texture.fromBuffer(pixels, AlphaMap.ROOM_SIZE, AlphaMap.ROOM_SIZE);
    destroyDiplomacyRoomSprite(layer, room);
    const sprite = layer.createRoomSprite(room, texture);
    sprite.blendMode = pixi.BLEND_MODES.ADD;
    layer.container.addChild(sprite);
    AlphaMap.markDirty();
}

/**
 * @param {{ room: string, user?: { _id?: string, username?: string } }[]} users
 */
function updateAlphaMapRoomUsers(users) {
    for (const { user } of users) {
        if (user?._id && user.username) {
            alphaMapRoomUsers[user._id] = { username: user.username };
        }
    }
}

function isUnitsZoomAllowed() {
    const restricted = ScreepsAdapter.AlphaMap.getBaseComponent()?._unitsRestrictedSbj?.getValue?.();
    return restricted === false;
}

function diplomacyAlphaMapDrawAllowed() {
    return diplomacyUnitsEnabled() && isUnitsZoomAllowed();
}

function applyAlphaMapDiplomacyUnits(enabled) {
    const { AlphaMap } = ScreepsAdapter;
    const base = AlphaMap.getBaseComponent();

    AlphaMap.toggleLayer(DIPLOMACY_LAYER, enabled && isUnitsZoomAllowed());

    if (enabled) {
        base?.hideUnits?.();
        const layer = AlphaMap.getMap()?.getLayer(DIPLOMACY_LAYER);
        const bound = (() => {
            const container = AlphaMap.getMapContainer();
            return container?.bound ?? container?.getBound?.();
        })();
        if (layer?.render && bound && diplomacyAlphaMapDrawAllowed()) {
            void layer.render(bound);
        }
    } else {
        const wantUnits = base?._unitsSbj?.getValue?.() ?? true;
        const restricted = base?._unitsRestrictedSbj?.getValue?.() ?? false;
        if (wantUnits && !restricted) {
            base?.showUnits?.();
        } else {
            base?.hideUnits?.();
        }
        AlphaMap.refresh();
    }
}

let alphaMapDiplomacyLayerInstalled = false;

function installAlphaMapDiplomacyLayer() {
    if (alphaMapDiplomacyLayerInstalled) {
        return;
    }
    alphaMapDiplomacyLayerInstalled = true;

    const { AlphaMap } = ScreepsAdapter;

    AlphaMap.registerPreferenceCheckbox({
        id: "diplomacy-units",
        label: "Diplomacy units overlay",
        getValue: diplomacyUnitsEnabled,
        onChange: (enabled) => {
            ScreepsAdapter.setSetting("diplomacyUnits", enabled);
            applyAlphaMapDiplomacyUnits(enabled);
        },
    });

    AlphaMap.ready(() => {
        ensureDiplomacyData(() => {
            const users$ = AlphaMap.getBaseComponent()?._drawMapUsersSbj.asObservable();
            users$?.subscribe((/** @type {{ user?: { _id?: string, username?: string } }[]} */ users) => {
                updateAlphaMapRoomUsers(users);
            });

            const Layer = AlphaMap.getLayerClass();

            class DiplomacyLayer extends Layer {
                static renderObservables = [() => AlphaMap.getMapContainer()?.bound$];

                constructor() {
                    super(DIPLOMACY_LAYER);
                    /** @type {Map<string, { remove(): void }>} */
                    this._roomSockets = new Map();
                    /** @type {AlphaMap.MapBound | undefined} */
                    this._lastBound = undefined;
                }

                _clearRoomSockets() {
                    for (const handle of this._roomSockets.values()) {
                        handle.remove();
                    }
                    this._roomSockets.clear();
                }

                /**
                 * @param {AlphaMap.MapBound} bound
                 */
                async render(bound) {
                    this._lastBound = bound;
                    if (!diplomacyAlphaMapDrawAllowed()) {
                        this._clearRoomSockets();
                        this.clear();
                        return;
                    }

                    if (!bound) {
                        return;
                    }

                    const shard = AlphaMap.getShard();
                    if (!shard) {
                        return;
                    }

                    const rooms = new Set(roomNamesInBound(bound));
                    const scope = angular.element(document.body).scope();

                    for (const [room, handle] of this._roomSockets) {
                        if (!rooms.has(room)) {
                            handle.remove();
                            this._roomSockets.delete(room);
                            destroyDiplomacyRoomSprite(this, room);
                        }
                    }

                    for (const room of rooms) {
                        if (this._roomSockets.has(room)) {
                            continue;
                        }

                        const handle = ScreepsAdapter.Socket.bindEventToScope(
                            scope,
                            `roomMap2:${shard}/${room}`,
                            (/** @type {Record<string, [number, number][]>} */ objects) => {
                                if (!diplomacyAlphaMapDrawAllowed() || !this.renderable) {
                                    return;
                                }
                                void drawDiplomacyRoom(this, room, objects);
                            },
                        );
                        this._roomSockets.set(room, handle);
                    }
                }
            }

            AlphaMap.registerCustomLayer(
                () => new DiplomacyLayer(),
                diplomacyUnitsEnabled(),
                { insertBefore: AlphaMap.LAYERS.users },
            );

            const mapContainer = AlphaMap.getMapContainer();
            const base = AlphaMap.getBaseComponent();
            if (mapContainer?.scale$ && base) {
                let zoomRedrawScheduled = false;
                const scaleSubscription = mapContainer.scale$.subscribe(() => {
                    if (!diplomacyUnitsEnabled() || zoomRedrawScheduled) {
                        return;
                    }
                    zoomRedrawScheduled = true;
                    ScreepsAdapter.$timeout(() => {
                        zoomRedrawScheduled = false;
                        const layer = AlphaMap.getMap()?.getLayer(DIPLOMACY_LAYER);
                        const container = AlphaMap.getMapContainer();
                        const bound = layer?._lastBound ?? container?.bound ?? container?.getBound?.();
                        if (layer?.render && bound) {
                            AlphaMap.toggleLayer(
                                DIPLOMACY_LAYER,
                                diplomacyAlphaMapDrawAllowed(),
                            );
                            void layer.render(bound);
                        }
                    });
                });
                base._destroySbj.subscribe(() => scaleSubscription.unsubscribe());
            }

            applyAlphaMapDiplomacyUnits(diplomacyUnitsEnabled());
        });
    });
}

// Entry point
ScreepsAdapter.ready(() => {
    ScreepsAdapter.registerMapButton({
        id: "diplomacy-units",
        tooltip: "Toggle units",
        content: "<i class='fa fa-eye'></i>",
        ngClick: "WorldMap.toggleDiplomacyUnits()",
        ngClass: "'md-primary': WorldMap.displayOptions.diplomacyUnits",
        zoomLevels: [3],
        replacesUnits: true,
    });

    DomHelper.addStyle(`
        .room-objects { display: none; }
    `);

    ScreepsAdapter.onViewChange(function(view) {
        if (view === "top.game-world-map") {
            ScreepsAdapter.$timeout(() => {
                bindDiplomacyUnitsSetting();
                bindWorldMapStatsMonitor();
            });
        }
    });

    ScreepsAdapter.onRoomChange(bindRoomStatsMonitor);
    installAlphaMapDiplomacyLayer();
});
