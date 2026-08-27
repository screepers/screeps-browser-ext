// ==UserScript==
// @name        Migrate room to simulator
// @namespace   https://screeps.com/
// @version     1.4.3
// @author      Mark Bertels, Esryok
// @description Migrate room to simulator
// @run-at      context-menu
// @grant       none
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @include     /^http://[^/]*?\.localhost:[^/]*?/\(.*?\)/.*?$/
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @updateURL   https://screepers.github.io/screeps-browser-ext/migrate-screeps-room.user.js?v=1787872416682
// @downloadURL https://screepers.github.io/screeps-browser-ext/migrate-screeps-room.user.js?v=1787872416682
// ==/UserScript==



/**
 * @param {any[]} terrain
 */
function applyTerrain(terrain) {
    let roomElement = angular.element("section.room");
    let room = roomElement.scope().Room;
    let injector = roomElement.injector();

    let memory = injector.get("MemoryStorage");
    let terrainObj = memory.get("rooms.terrain");

    let roomTerrainData = _.find(terrainObj, { room: "sim" });
    roomTerrainData.terrain = terrain;

    ScreepsAdapter.Connection.getRoomTerrain().then((data) => {
        room.terrain = data;
    });
}

/**
 *
 * @param {any} roomData
 * @returns
 */
function adjustRoomDataForCustomMode(roomData) {
    let gameElement = angular.element(document.body);

    let currentTime = angular.element("section.room").scope().Room.gameTime;
    console.log("current time is", currentTime);

    let forceUser = gameElement.injector().get("Auth").Me;

    for (let index in roomData.objects) {
        let object = roomData.objects[index];
        if (object.nextRegenerationTime)
            object.nextRegenerationTime = Math.max(1, object.nextRegenerationTime - currentTime);

        if (object.cooldownTime)
            object.cooldownTime = Math.max(1, object.cooldownTime - currentTime);

        if (object.nextDecayTime)
            object.nextDecayTime = Math.max(1, object.nextDecayTime - currentTime);

        if (object.ageTime)
            object.ageTime = Math.max(1, object.ageTime - currentTime);
        console.log(object.name, object.ageTime);

        if (object.user)
            object.user = forceUser._id;
    }

    return roomData;
}

function migrateRoomToSimulation() {
    let open = window.open;
    // @ts-expect-error
    window.open = () => {
        return {
            document: {
                write: function (savedRoomText) {
                    window.open = open;

                    console.log("Room data cached");
                    let roomData = adjustRoomDataForCustomMode(JSON.parse(savedRoomText));

                    let gameElement = angular.element(document.body);
                    let memory = gameElement.injector().get("MemoryStorage");
                    let destroyWatcher = gameElement.scope().$watch(function () {
                        return (memory.get("gametime")); 
                    }, function (newVal, oldVal) {
                        console.log("game time changed", oldVal, "=>", newVal);
                        if (newVal === 1) {
                            console.log("Sim room ready");
                            try {
                                let roomScope1 = angular.element("section.room").scope();
                                let room1 = roomScope1.Room;
                                console.log("Applying terrain...");
                                applyTerrain(roomData.terrain[0].terrain);
                                console.log("Restoring...");
                                room1.restoreData = JSON.stringify(roomData);
                                room1.restore();
                            } catch (e) {
                                console.log("Migration failed", e);
                            }
                            destroyWatcher();
                        }
                    });

                    location.href = "https://screeps.com/a/#!/sim/custom";
                }
            }
        };
    };

    let roomScope = angular.element("section.room").scope();
    let room = roomScope.Room;
    room.save();
}

ScreepsAdapter.ready(() => {
    // push the load to the end of the event queue
    setTimeout(migrateRoomToSimulation);
});
