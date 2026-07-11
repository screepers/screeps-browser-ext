// ==UserScript==
// @name        Screeps Force Alpha map
// @namespace   https://screeps.com/
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @match       http://*.localhost/(*)/*
// @grant       none
// @version     0.0.4
// @author      -
// @description Always open the world map on the alpha map
// @run-at      document-ready
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @require     REPO_URL/screeps-browser-core.js
// @require     REPO_URL/screeps-alpha-map.js
// ==/UserScript==

(() => {
    const { AlphaMap } = ScreepsAdapter;

    function getCurrentRoom() {
        return angular.element(".room.ng-scope").scope()?.Room;
    }

    async function overrideRoom() {
        await ScreepsAdapter.waitFor(() => getCurrentRoom());
        const buttons = [...document.querySelectorAll("button")];
        const mapButton = buttons.find(b => b.getAttribute("ng-click=")?.startsWith("Room.goToMap"));
        if (mapButton) {
            mapButton.addEventListener("click", e => {
                getCurrentRoom().goToMap(e);
            }, true);
        }

        /**
         * @param {PointerEvent} e
         */
        getCurrentRoom().goToMap = function (e) {
            e ??= /** @type {PointerEvent} */ (window.event);
            const { $routeSegment, $location } = ScreepsAdapter;
            const roomCoords = ScreepsAdapter.MapUtils.roomNameToXY($routeSegment.$routeParams.room);

            const query = new URLSearchParams();
            query.set("pos", `${roomCoords[0] + .5},${roomCoords[1] + .5}`);
            query.set("units", AlphaMap.getSetting("units") ?? true);
            query.set("visual", AlphaMap.getSetting("visual") ?? true);
            query.set("claim", AlphaMap.getSetting("claim") ?? true);

            const newUrl = $routeSegment.getSegmentUrl("top.map2shard") + "?" + query.toString();
            if (e.ctrlKey || e.metaKey) {
                const prefix = $location.$$absUrl.substring(0, $location.$$absUrl.indexOf("#!") + 2);
                window.open(prefix + newUrl, "_blank");
            } else {
                ScreepsAdapter.$location.url(newUrl);
            }
        };
    }

    ScreepsAdapter.ready(() => {
        ScreepsAdapter.onViewChange((triggerName) => {
            if (triggerName === "top.game-room") {
                overrideRoom();
            } else if (triggerName === "top.game-world-map") {
                const hash = window.location.hash;
                const queryLoc = hash.indexOf("?");
                const queryStr = queryLoc !== -1 ? "?" + hash.substring(queryLoc) : "";
                const url = ScreepsAdapter.$routeSegment.getSegmentUrl("top.map2shard") + queryStr;
                ScreepsAdapter.$location.url(url);
            }
        });
    });
})();
