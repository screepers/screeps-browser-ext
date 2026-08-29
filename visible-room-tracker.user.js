// ==UserScript==
// @name        Screeps visible room tracker
// @namespace   https://screeps.com/
// @version     0.1.5
// @author      James Cook
// @description Track which rooms are currently visible in the viewport
// @run-at      document-ready
// @require     https://screepers.github.io/screeps-browser-ext/screeps-browser-core.js?v=1788044347626
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @include     /^http://[^/]*?\.localhost:[^/]*?/\(.*?\)/.*?$/
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @updateURL   https://screepers.github.io/screeps-browser-ext/visible-room-tracker.user.js?v=1788044347626
// @downloadURL https://screepers.github.io/screeps-browser-ext/visible-room-tracker.user.js?v=1788044347626
// ==/UserScript==



// Entry point
ScreepsAdapter.ready(() => {
    let monitorRunning = false;
    ScreepsAdapter.onRoomChange(function (roomName) {
        console.log("Visible room changed to:", roomName);

        function notifyCurrentRoomVisibility() {
            let roomElem = angular.element(".room");
            let roomScope = roomElem.scope();

            let tick = roomScope.Room.gameTime;
            if (tick !== undefined && roomScope.historyTimestamp === undefined) {
                ScreepsAdapter.Connection.setMemoryByPath(
                    null,
                    "rooms." + roomScope.Room.roomName + ".lastViewed",
                    roomScope.Room.gameTime
                );
            }
        }

        function ensureRoomMonitor() {
            let roomElem = angular.element(".room");
            if (!roomElem || roomElem.length === 0) {
                setTimeout(ensureRoomMonitor, 250);
                return;
            }

            notifyCurrentRoomVisibility();

            if (monitorRunning)
                return;

            let roomScope = roomElem.scope();
            roomScope.$watch(() => roomScope.Room.gameTime, notifyCurrentRoomVisibility);
            monitorRunning = true;
        }

        if (roomName && roomName !== "sim") {
            ScreepsAdapter.Connection.getMemoryByPath(null, "rooms." + roomName).then(
                /**
                 * @param {any} baseRoomData
                 */
                (baseRoomData) => {
                    if (!baseRoomData) {
                        ScreepsAdapter.Connection.setMemoryByPath(
                            null,
                            "rooms." + roomName,
                            {}
                        ).then(ensureRoomMonitor);
                    } else {
                        ensureRoomMonitor();
                    }
                }
            );
        } else {
            monitorRunning = false;
        }
    });
});
