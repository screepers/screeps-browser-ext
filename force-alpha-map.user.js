// ==UserScript==
// @name        Screeps Force Alpha map
// @namespace   https://screeps.com/
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @match       http://*.localhost:*/(*)/#!/*
// @grant       none
// @version     0.0.2
// @author      -
// @description Always open the world map on the alpha map
// @run-at      document-ready
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @require     https://screepers.github.io/screeps-browser-ext/screeps-browser-core.js?v=1773232591772
// @downloadUrl https://screepers.github.io/screeps-browser-ext/force-alpha-map.js?v=1773232591772
// ==/UserScript==



(() => {
    const MAP_LAYERS = {
        rooms: "rooms",
        safeMode: "safe-mode",
        units: "units",
        users: "users",
        stats: "stats",
        minerals: "minerals",
        visual: "visual",
        decorations: "decorations",
    };

    /**
     * @param {string} setting
     */
    function getSetting(setting) {
        const item = window.localStorage.getItem(`screeps.alpha-map.${setting}`);
        return item !== null ? JSON.parse(item) : null;
    }

    /**
     *
     * @param {string} setting
     * @param {any} value
     */
    function setSetting(setting, value) {
        window.localStorage.setItem(`screeps.alpha-map.${setting}`, value);
    }

    function getMapComponent() {
        // @ts-expect-error
        return ng.probe(document.querySelector("app-world-map-map"))?.componentInstance;
    }

    function getCurrentRoom() {
        return angular.element('.room.ng-scope').scope()?.Room;
    }

    async function overrideRoom() {
        await ScreepsAdapter.waitFor(() => getCurrentRoom());
        getCurrentRoom().goToMap = function () {
            const router = ScreepsAdapter.$routeSegment;
            const roomCoords = ScreepsAdapter.MapUtils.roomNameToXY(router.$routeParams.room);

            const query = new URLSearchParams();
            query.set("pos", `${roomCoords[0] + .5},${roomCoords[1] + .5}`);
            query.set("units", getSetting("units") ?? true);
            query.set("visual", getSetting("visual") ?? true);
            query.set("claim", getSetting("claim") ?? true);

            ScreepsAdapter.$location.url(router.getSegmentUrl("top.map2shard") + "?" + query.toString());
        }
    }

    async function overrideMap() {
        await ScreepsAdapter.waitFor(() => getMapComponent());
        const map = getMapComponent().screepsMap._mapContainer;
        if (map._toggleLayer) return;
        map._toggleLayer = map.toggleLayer;
        /**
         *
         * @param {keyof typeof MAP_LAYERS} layer
         * @param {boolean} state
         */
        map.toggleLayer = function (layer, state) {
            if (layer === MAP_LAYERS.units) {
                setSetting("units", state);
            }
            if (layer === MAP_LAYERS.visual) {
                setSetting("visual", state);
            }
            if (layer === MAP_LAYERS.stats) {
                setSetting("claim", state);
            }
            map._toggleLayer(layer, state);
        }
        /**
         * @param {boolean} state
         */
        map.toggleUnitsLayer = function (state) {
            map.toggleLayer(MAP_LAYERS.units, state);
        }
        /**
         * @param {boolean} state
         */
        map.toggleStatsLayer = function (state) {
            map.toggleLayer(MAP_LAYERS.stats, state);
        }
        /**
         * @param {boolean} state
         */
        map.toggleUsersLayer = function (state) {
            map.toggleLayer(MAP_LAYERS.users, state);
        }
    }

    ScreepsAdapter.ready(async () =>{
        console.warn("AlphaMap: Loaded");

        ScreepsAdapter.onViewChange(async (triggerName) => {
            if (triggerName === "top.game-room") {
                overrideRoom();
            } else if (triggerName === "top.game-world-map") {
                const hash = window.location.hash;
                const queryLoc = hash.indexOf("?");
                const queryStr = queryLoc !== -1 ? "?" + hash.substring(queryLoc) : "";
                const url = ScreepsAdapter.$routeSegment.getSegmentUrl("top.map2shard") + queryStr;
                console.warn('AlphaMap: redirecting to', url);
                ScreepsAdapter.$location.url(url);
            } else if (triggerName === "top.map2shard") {
                // Restore alpha map settings; not sure why it's not doing that automatically but hey
                await ScreepsAdapter.waitFor(() => getMapComponent());
                overrideMap();
                getMapComponent().toggleLayer(MAP_LAYERS.units, getSetting("units") ?? true)
                getMapComponent().toggleLayer(MAP_LAYERS.visual, getSetting("visual") ?? true)
                getMapComponent().toggleLayer(MAP_LAYERS.stats, getSetting("claim") ?? true)
            }
        });
    });
})();
