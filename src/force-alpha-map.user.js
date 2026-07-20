// ==UserScript==
// @name        Screeps Force Alpha map
// @namespace   https://screeps.com/
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @match       http://*.localhost/(*)/*
// @grant       none
// @version     0.0.5
// @author      -
// @description Always open the world map on the alpha map
// @run-at      document-ready
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @require     REPO_URL/screeps-browser-core.js
// @require     REPO_URL/screeps-alpha-map.js
// ==/UserScript==

(() => {
    function getCurrentRoom() {
        return angular.element(".room.ng-scope").scope()?.Room;
    }

    /**
     * Alpha map preference toggles live in localStorage; pos/scale/display stay in the URL.
     * @param {string} [pos]
     */
    function alphaMapUrl(pos) {
        const base = ScreepsAdapter.$routeSegment.getSegmentUrl("top.map2shard");
        if (!pos) {
            return base;
        }
        const query = new URLSearchParams();
        query.set("pos", pos);
        return `${base}?${query.toString()}`;
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
            const room =
                getCurrentRoom()?.roomName ||
                $routeSegment.$routeParams.room;
            const roomCoords = ScreepsAdapter.MapUtils.roomNameToXY(room);
            const pos = `${roomCoords[0] + .5},${roomCoords[1] + .5}`;
            const newUrl = alphaMapUrl(pos);

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
                let pos;
                if (queryLoc !== -1) {
                    pos = new URLSearchParams(hash.substring(queryLoc + 1)).get("pos") ?? undefined;
                }
                ScreepsAdapter.$location.url(alphaMapUrl(pos));
            }
        });
    });
})();
