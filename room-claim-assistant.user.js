// ==UserScript==
// @name        Screeps room claim assistant
// @namespace   https://screeps.com/
// @version     0.2.1
// @author      James Cook
// @description Assist with room claiming by showing claim stats on the map
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @match       http://*.localhost/(*)/*
// @run-at      document-ready
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @require     https://screepers.github.io/screeps-browser-ext/screeps-browser-core.js?v=1785672067940
// @require     https://screepers.github.io/screeps-browser-ext/screeps-alpha-map.js?v=1785672067940
// @grant       GM.getValue
// @grant       GM.setValue
// @updateURL   https://screepers.github.io/screeps-browser-ext/room-claim-assistant.user.js?v=1785672067940
// @downloadURL https://screepers.github.io/screeps-browser-ext/room-claim-assistant.user.js?v=1785672067940
// ==/UserScript==



async function bindIgnoreSignsSetting() {
    let mapContainerElem = angular.element(".map-container");
    let worldMap = mapContainerElem.scope().WorldMap;

    worldMap.displayOptions.ignoreSigns = false;
    const ignoreSigns = await GM.getValue("ignoreSigns", false)
    worldMap.displayOptions.ignoreSigns = ignoreSigns;

    worldMap.toggleIgnoreSigns = function () {
        worldMap.displayOptions.ignoreSigns = !worldMap.displayOptions.ignoreSigns;
        GM.setValue("ignoreSigns", worldMap.displayOptions.ignoreSigns);
        mapContainerElem.scope().$broadcast("recalcMapSectors");
    };
}

/**
 * @typedef {Record<AlphaMap.ObjectType, any[]>} RoomObjectCounts
 */

/** @type {Record<string, RoomObjectCounts>} */
let roomObjectCounts = {};

/**
 *
 * @param {string} shardName
 * @param {string} roomName
 * @param {(counts: RoomObjectCounts) => void} callback
 */
function getRoomObjectCounts(shardName, roomName, callback) {
    let scope = angular.element(document.body).scope();
    if (roomObjectCounts[roomName]) {
        callback(roomObjectCounts[roomName]);
    } else {
        //console.log("Bind socket event", roomName)
        let eventFunc = ScreepsAdapter.Socket.bindEventToScope(scope, `roomMap2:${shardName}/${roomName}`,
            /**
             * @param {RoomObjectCounts} objectCounts
             */
            function(objectCounts) {
                roomObjectCounts[roomName] = objectCounts;
                eventFunc.remove();
                // console.log("Data loaded", roomName);
                callback(objectCounts);
            }
        );
    }
}

let interceptingApiPost = false;
function interceptClaim0StatsRequest() {
    if (interceptingApiPost) return;
    interceptingApiPost = true;

    let api = ScreepsAdapter.Api;
    let post = api.post;
    api.post = (uri, body) => {
        //console.log("interceptClaim0StatsRequest", uri, body);
        if (uri === "game/map-stats" && body.statName === "claim0") {
            body.statName = "minerals0";
        }
        return post(uri, body);
    }
}

function recalculateClaimOverlay() {
    // console.log("recalculateClaimOverlay");
    let user = angular.element(document.body).scope().Me();
    let mapContainerElem = angular.element(".map-container");
    let worldMap = mapContainerElem.scope().WorldMap;

    let mapSectors = document.querySelectorAll(".map-sector");
    for (let i = 0; i < mapSectors.length; i++) {
        let sectorElem = angular.element(mapSectors[i]);
        let scope = sectorElem.scope();
        let sector = scope.$parent.sector;
        let roomName = sector.name;
        if (roomName) {
            let roomStats = worldMap.roomStats[roomName];
            if (!roomStats || roomStats.status === "out of borders") {
                // can't get the room objects for this, don't bother rendering anything
                continue;
            }

            getRoomObjectCounts(worldMap.shard, roomName, (counts) => {
                if (!counts) return;
                if (!counts.s) {
                    console.log("Bad object list for", roomName, counts);
                    return;
                }

                let userOwned = (roomStats.own && roomStats.own.user === user._id);
                let invaderOwned = (roomStats.own && roomStats.own.user === "2"); // 2 is the hardcoded ID for Invader

                // show minerals if:
                let showMinerals =
                    (userOwned && roomStats.own.level > 0) || //  user has claimed it OR
                    counts.s.length > 1; // it has 2+ sources

                let state = "not-recommended";
                if (userOwned && roomStats.own.level > 0) {
                    state = "owned";
                } else if (roomStats.own && !userOwned && !invaderOwned) {
                    state = "prohibited"; // rooms reserved or claimed by anyone except the user or Invader
                } else if (!worldMap.displayOptions.ignoreSigns && roomStats.sign && !userOwned && roomStats.sign.user !== user._id) {
                    state = "signed";
                } else if (counts.c.length === 0) {
                    state = "unclaimable";
                } else if (counts.s.length >= 2 &&
                    (!roomStats.own || (userOwned && roomStats.own.level === 0) || invaderOwned)) {
                    // recommend if it has two sources and a controller, nobody else owns it,
                    // and user hasn't already claimed
                    state = "recommended";
                }

                /** @type {HTMLDivElement | null} */
                let claimAssistDiv = sectorElem[0].querySelector(".claim-assist");
                if (!claimAssistDiv) {
                    claimAssistDiv = document.createElement("div");
                    sectorElem[0].appendChild(claimAssistDiv);
                }

                let claimRoom = claimAssistDiv.getAttribute("room");
                if (claimRoom !== roomName) {
                    if (showMinerals && roomStats.minerals0) {
                        claimAssistDiv.innerHTML = `
                            <div class='room-mineral-type room-mineral-type-${roomStats.minerals0.type} room-mineral-density-${roomStats.minerals0.density}'>
                                ${roomStats.minerals0.type}
                            </div>`;
                    } else {
                        claimAssistDiv.innerHTML = "";
                    }

                    claimAssistDiv.classList.add("room-stats", "claim-assist", state);
                }

                claimAssistDiv.setAttribute("room", roomName);
            });
        }
    }
}

let pendingClaimRedraws = 0;
function bindMapStatsMonitor() {
    let mapContainerElem = angular.element(".map-container");
    let scope = mapContainerElem.scope();
    let worldMap = scope.WorldMap;

    let deferRecalculation = function () {
        document.querySelectorAll(".claim-assist").forEach(e => e.remove());

        if (worldMap.displayOptions.layer === "claim0") {
            if (worldMap.zoom === 3) {
                pendingClaimRedraws++;
                setTimeout(() => {
                    pendingClaimRedraws--;
                    if (pendingClaimRedraws === 0) {
                        recalculateClaimOverlay();
                        document.querySelectorAll(".claim-assist").forEach(e => e.toggleAttribute("hidden", false));
                    }
                }, 500);
            }
        }
    }
    scope.$on("mapSectorsRecalced", deferRecalculation);
    scope.$on("mapStatsUpdated", deferRecalculation);
}

const CLAIM_LAYER = "claim-assist";

/** @type {Record<string, [number, number, number, number]>} */
const CLAIM_STATE_COLORS = {
    "not-recommended": [192, 192, 50, 76],
    recommended: [25, 255, 25, 51],
    owned: [50, 50, 255, 51],
    signed: [255, 128, 0, 89],
    prohibited: [255, 50, 50, 51],
    unclaimable: [128, 128, 128, 51],
};

/** @type {Record<string, unknown>} */
const claimStateTextures = {};

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
 * @param {unknown} data
 * @returns {data is { room: string, stat: any }[]}
 */
function isStatsPayload(data) {
    return Array.isArray(data) && (data.length === 0 || Object.hasOwn(data[0] ?? {}, "stat"));
}

/**
 * @param {unknown} data
 * @returns {data is AlphaMap.MapBound}
 */
function isBoundPayload(data) {
    return !!data && typeof /** @type {AlphaMap.MapBound} */ (data).width === "number";
}

/**
 * @param {any} roomStats
 * @param {RoomObjectCounts | undefined} counts
 * @param {string} userId
 * @param {boolean} ignoreSigns
 */
function computeClaimState(roomStats, counts, userId, ignoreSigns) {
    if (!counts?.s) {
        return "not-recommended";
    }

    const userOwned = roomStats.own && roomStats.own.user === userId;
    const invaderOwned = roomStats.own && roomStats.own.user === "2";

    if (userOwned && roomStats.own.level > 0) {
        return "owned";
    }
    if (roomStats.own && !userOwned && !invaderOwned) {
        return "prohibited";
    }
    if (!ignoreSigns && roomStats.sign && !userOwned && roomStats.sign.user !== userId) {
        return "signed";
    }
    if (counts.c.length === 0) {
        return "unclaimable";
    }
    if (
        counts.s.length >= 2 &&
        (!roomStats.own || (userOwned && roomStats.own.level === 0) || invaderOwned)
    ) {
        return "recommended";
    }
    return "not-recommended";
}

/**
 * @param {[number, number, number, number]} color
 */
function claimRoomPixels(color) {
    const { AlphaMap } = ScreepsAdapter;
    const pixels = new Uint8Array(AlphaMap.ROOM_SIZE * AlphaMap.ROOM_SIZE * 4);
    for (let i = 0; i < AlphaMap.ROOM_SIZE * AlphaMap.ROOM_SIZE; i++) {
        const offset = i * 4;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = color[3] ?? 255;
    }
    return pixels;
}

/**
 * Shared claim textures are destroyed when the map layer is cleared/destroyed
 * (e.g. enter a room, then return). Recreate if the cached texture is dead.
 *
 * @param {string} state
 */
function getClaimStateTexture(state) {
    const { AlphaMap } = ScreepsAdapter;
    const color = CLAIM_STATE_COLORS[state];
    const pixi = AlphaMap.getPixi();
    if (!color || !pixi) {
        return undefined;
    }

    const cached = /** @type {{ baseTexture?: { valid?: boolean } } | undefined} */ (
        claimStateTextures[state]
    );
    if (cached?.baseTexture?.valid) {
        return cached;
    }

    claimStateTextures[state] = pixi.Texture.fromBuffer(
        claimRoomPixels(color),
        AlphaMap.ROOM_SIZE,
        AlphaMap.ROOM_SIZE,
    );

    return claimStateTextures[state];
}

/**
 * @param {AlphaMap.Layer} layer
 * @param {string} room
 */
function destroyClaimRoomSprite(layer, room) {
    if (layer.hasRoom(room)) {
        // Keep shared claimStateTextures — Layer.clear()/destroy() use destroy(true).
        layer.destroyRoomSprite(room, false);
    }
}

/**
 * Clear room sprites without destroying shared claim state textures.
 * Layer.clear() calls destroy(true), which would invalidate claimStateTextures.
 *
 * @param {AlphaMap.Layer} layer
 */
function clearClaimAssistSprites(layer) {
    const cache = /** @type {{ _cache?: Record<string, unknown> }} */ (layer)._cache;
    if (!cache) {
        layer.clear();
        return;
    }

    for (const room of Object.keys(cache)) {
        destroyClaimRoomSprite(layer, room);
    }
}

/**
 * @param {AlphaMap.Layer} layer
 * @param {string} room
 * @param {string} state
 */
function drawClaimRoom(layer, room, state) {
    const texture = getClaimStateTexture(state);
    if (!texture) {
        destroyClaimRoomSprite(layer, room);
        return;
    }

    destroyClaimRoomSprite(layer, room);
    const sprite = layer.createRoomSprite(room, texture);
    layer.container.addChild(sprite);
}

function claimAssistActive() {
    return ScreepsAdapter.AlphaMap.getDisplayLayer() === "claim0";
}

/**
 * @param {AlphaMap.Layer | undefined} layer
 */
function clearClaimAssistLayerState(layer) {
    const claimLayer = /** @type {{ _clearRoomSockets?(): void } | undefined} */ (layer);
    claimLayer?._clearRoomSockets?.();
    if (layer) {
        clearClaimAssistSprites(layer);
    }
}

function syncClaimAssistLayer() {
    const { AlphaMap } = ScreepsAdapter;
    const enabled = claimAssistActive();
    const layer = AlphaMap.getMap()?.getLayer(CLAIM_LAYER);

    AlphaMap.toggleLayer(CLAIM_LAYER, enabled);
    if (enabled) {
        AlphaMap.refresh();
    } else {
        clearClaimAssistLayerState(layer);
        AlphaMap.markDirty();
    }
}

let alphaMapClaimLayerInstalled = false;
let ignoreSignsEnabled = false;

function installAlphaMapClaimLayer() {
    if (alphaMapClaimLayerInstalled) {
        return;
    }
    alphaMapClaimLayerInstalled = true;

    const { AlphaMap } = ScreepsAdapter;

    AlphaMap.registerDisplayOption({ name: "Claimable", value: "claim0" });

    void GM.getValue("ignoreSigns", false).then((value) => {
        ignoreSignsEnabled = value;
    });

    AlphaMap.registerPreferenceCheckbox({
        id: "ignore-signs",
        label: "Claimability ignores room signs",
        getValue: () => ignoreSignsEnabled,
        onChange: (enabled) => {
            ignoreSignsEnabled = enabled;
            GM.setValue("ignoreSigns", enabled);
            AlphaMap.refresh();
        },
    });

    AlphaMap.ready(() => {
        const Layer = AlphaMap.getLayerClass();

        class ClaimAssistLayer extends Layer {
            static renderObservables = [
                () => AlphaMap.getBaseComponent()?._drawMapStatsSbj.asObservable(),
                () => AlphaMap.getMapContainer()?.bound$,
            ];

            constructor() {
                super(CLAIM_LAYER);
                /** @type {Map<string, { remove(): void }>} */
                this._roomSockets = new Map();
                /** @type {Map<string, any>} */
                this._statsByRoom = new Map();
                /** @type {Map<string, RoomObjectCounts>} */
                this._countsByRoom = new Map();
            }

            _clearRoomSockets() {
                for (const handle of this._roomSockets.values()) {
                    handle.remove();
                }
                this._roomSockets.clear();
            }

            _deactivate() {
                this._clearRoomSockets();
                this._statsByRoom.clear();
                this._countsByRoom.clear();
                clearClaimAssistSprites(this);
            }

            /**
             * @param {string} room
             */
            _drawRoom(room) {
                const stat = this._statsByRoom.get(room);
                if (!room || !stat || stat.status === "out of borders") {
                    destroyClaimRoomSprite(this, room);
                    return;
                }

                const counts = this._countsByRoom.get(room);
                if (!counts?.s) {
                    return;
                }

                const state = computeClaimState(
                    stat,
                    counts,
                    ScreepsAdapter.User._id,
                    ignoreSignsEnabled,
                );
                drawClaimRoom(this, room, state);
            }

            /**
             * @param {AlphaMap.MapBound | undefined} bound
             */
            _syncRoomSockets(bound) {
                if (!bound || !claimAssistActive()) {
                    this._clearRoomSockets();
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
                        this._countsByRoom.delete(room);
                        destroyClaimRoomSprite(this, room);
                    }
                }

                for (const room of rooms) {
                    if (this._roomSockets.has(room)) {
                        continue;
                    }

                    if (roomObjectCounts[room]) {
                        this._countsByRoom.set(room, roomObjectCounts[room]);
                        this._drawRoom(room);
                    }

                    const handle = ScreepsAdapter.Socket.bindEventToScope(
                        scope,
                        `roomMap2:${shard}/${room}`,
                        (/** @type {RoomObjectCounts} */ counts) => {
                            if (!claimAssistActive() || !this.renderable) {
                                return;
                            }

                            roomObjectCounts[room] = counts;
                            this._countsByRoom.set(room, counts);
                            this._drawRoom(room);
                            AlphaMap.markDirty();
                        },
                    );
                    this._roomSockets.set(room, handle);
                }
            }

            /**
             * @param {{ room: string, stat: any }[]} stats
             */
            _applyStats(stats) {
                for (const { room, stat } of stats) {
                    if (room) {
                        this._statsByRoom.set(room, stat);
                    }
                }
            }

            _redrawVisibleRooms() {
                for (const room of this._statsByRoom.keys()) {
                    this._drawRoom(room);
                }
                AlphaMap.markDirty();
            }

            /**
             * @param {{ room: string, stat: any }[] | AlphaMap.MapBound} data
             */
            async render(data) {
                if (!claimAssistActive()) {
                    this._deactivate();
                    return;
                }

                if (isStatsPayload(data)) {
                    this._applyStats(data);
                    this._redrawVisibleRooms();
                    return;
                }

                if (isBoundPayload(data)) {
                    this._syncRoomSockets(data);
                    this._redrawVisibleRooms();
                }
            }
        }

        AlphaMap.registerCustomLayer(
            () => new ClaimAssistLayer(),
            claimAssistActive(),
            { insertBefore: AlphaMap.LAYERS.users },
        );

        syncClaimAssistLayer();

        const display$ = AlphaMap.getDisplayLayer$();
        const base = AlphaMap.getBaseComponent();
        if (display$ && base) {
            const displaySubscription = display$.subscribe(() => {
                syncClaimAssistLayer();
            });
            base._destroySbj.subscribe(() => {
                displaySubscription.unsubscribe();
            });
        }
    });
}

// Entry point
ScreepsAdapter.ready(() => {
    ScreepsAdapter.registerMapButton({
        id: "ignore-signs",
        tooltip: "Ignore signs",
        content: "<i class='fa fa-map-signs'></i>",
        ngClick: "WorldMap.toggleIgnoreSigns()",
        ngIf: "WorldMap.displayOptions.layer == 'claim0'",
        ngClass: "'md-primary': WorldMap.displayOptions.ignoreSigns",
        zoomLevels: [3],
    });

    DomHelper.addStyle(`
        .claim-assist { pointer-events: none; }
        .claim-assist.not-recommended { background: rgba(192, 192, 50, 0.3); }
        .claim-assist.recommended { background: rgba(25, 255, 25, 0.2); }
        .claim-assist.owned { background: rgba(50, 50, 255, 0.2); }
        .claim-assist.signed { background: rgba(255, 128, 0, 0.35); }
        .claim-assist.prohibited { background: rgba(255, 50, 50, 0.2); }
        .room-prohibited { display: none; }
    `);

    ScreepsAdapter.onViewChange(function(view) {
        if (view === "top.map2shard") {
            void (async () => {
                await ScreepsAdapter.waitFor(() => ScreepsAdapter.AlphaMap.registerDisplayOption({
                    name: "Claimable",
                    value: "claim0",
                }));
            })();
        }
        if (view === "top.game-world-map") {
            interceptClaim0StatsRequest();
            ScreepsAdapter.$timeout(async () => {
                await bindIgnoreSignsSetting();
                bindMapStatsMonitor();
            });
        }
    });

    installAlphaMapClaimLayer();
});
