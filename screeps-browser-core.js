(() => {
    "use strict";

    const VERSION = "0.5.0";

    /**
     * @param {string} a
     * @param {string} b
     */
    function compareVersion(a, b) {
        const partsA = a.split(".");
        const partsB = b.split(".");
        while (partsA.length < partsB.length) partsA.push("0");
        while (partsA.length > partsB.length) partsB.push("0");
        return partsA.reduce((cmp, current, idx) => {
            if (cmp !== 0) return cmp;
            if (current !== partsB[idx])
                return Math.sign(Number(current) - Number(partsB[idx]));
            return 0;
        }, 0);
    }

    const pageWindow = (typeof unsafeWindow !== "undefined") ? unsafeWindow : window;

    /**
     * @template {ExposedWindowKey} T
     * @param {T} key
     * @param {unknown} object
     */
    function expose(key, object) {
        window[key] = /** @type {(typeof window)[T]} */ (object);
        if (typeof unsafeWindow !== "undefined") {
            unsafeWindow[key] = /** @type {(typeof window)[T]} */ (object);
        }
    }

    if (pageWindow.ScreepsAdapter?.VERSION && compareVersion(pageWindow.ScreepsAdapter.VERSION, VERSION) >= 0) {
        expose("ScreepsAdapter", pageWindow.ScreepsAdapter);
        expose("DomHelper", pageWindow.DomHelper);
        return;
    }

    /**
     * Polls every 50 milliseconds for a given condition
     * @param {() => boolean} condition
     * @param {number} [pollInterval=50]
     * @param {number} [timeoutAfter]
     */
    async function waitFor(condition, pollInterval = 50, timeoutAfter) {
        // Track the start time for timeout purposes
        const startTime = Date.now();

        while (true) {
            if (typeof(timeoutAfter) === "number" && Date.now() > startTime + timeoutAfter) {
                throw new Error("Condition not met before timeout");
            }

            const result = await condition();
            if (result) {
                return result;
            }

            await new Promise(r => setTimeout(r, pollInterval));
        }
    }

    async function waitForAngular() {
        await waitFor(() => !!angular.element(document.body).injector())
    }

    const DomHelper = {};
    /**
     * @param {string} css
     */
    DomHelper.addStyle = function (css) {
        let head = document.head;
        if (!head) return;

        let style = document.createElement("style");
        style.type = "text/css";
        style.innerHTML = css;

        head.appendChild(style);
    }

    /**
     * @param {any} parent
     * @param {string} content
     */
    DomHelper.generateCompiledElement = function(parent, content) {
        let $scope = parent.scope();
        let $compile = parent.injector().get("$compile");
        return $compile(content)($scope);
    }
    expose("DomHelper", DomHelper);

    const ScreepsAdapter = {};
    ScreepsAdapter.VERSION = VERSION;
    ScreepsAdapter.loadId = Math.random().toString(36).slice(2, 8);

    /**
     * @param {string[]} message
     */
    // eslint-disable-next-line no-unused-vars
    function log(...message) {
        // console.log(`[ScreepsAdapter:${ScreepsAdapter.loadId}]`, ...message);
    }

    log(`v${VERSION} loaded`);

    /**
     * Polls every 50 milliseconds for a given condition
     * @param {() => boolean} condition
     * @param {number} [pollInterval=50]
     * @param {number} timeoutAfter
     */
    ScreepsAdapter.waitFor = waitFor;

    /**
     * Execute a callback once Angular's ready
     * @param {() => void} callback - A callback to execute
     */
    ScreepsAdapter.ready = function(callback) {
        waitForAngular().then(() => callback());
    }

    /** @type {string | null} */
    ScreepsAdapter.currentView = null;

    /**
     * @param {string} newViewName
     * @param {string} oldViewName
     * @returns
     */
    function notifyViewWatchers(newViewName, oldViewName) {
        /**
        * Compatibility with the old Tutorial-based interception.
        * Tutorial trigger names:
        * - "sendConsole": ({command})
        * - "consoleClick"
        * - "scriptClick"
        * - "submitScript": ({modules})
        * - "survivalModeStarted"
        * - "customModeStarted"
        * - "gameLobby"
        * - "controllerDowngrade": ({controller})
        * - "objectsStart"
        *   - "creep": ({creep})
        *   - "controller": ({controller})
        *   - "road": ({road})
        *   - "constructionSite": : ({constructionSite})
        * - "objectsEnd": ({objects})
        * - "roomEntered"
        * - "view": ({object})
        * - "worldMapEntered"
        * @type {Record<string, string>}
        */
        const compatViews = {
            "top.game-room": "roomEntered",
            "top.game-world-map": "worldMapEntered",
            "top.game-lobby-world.list": "gameLobby",
            "top.game-lobby-power.list": "gameLobby",
            "top.sim-survival": "survivalModeStarted",
            "top.sim-custom": "customModeStarted",
        };
        let rootScope = angular.element(document.body).scope();
        if (!rootScope.viewChangeCallbacks) return;

        ScreepsAdapter.currentView = newViewName;

        for (let i in rootScope.viewChangeCallbacks) {
            try {

                if (compatViews[newViewName]) {
                    rootScope.viewChangeCallbacks[i](compatViews[newViewName]);
                }
                rootScope.viewChangeCallbacks[i](newViewName, oldViewName);
            } catch (e) {
                console.error(e);
            }
        }
    }

    /**
     * Listen for changes to the main screeps view.
     * Examples: top.game-room, top.game-world-map, etc.
     *
     * For backward-compatibility purposes, the previous names used as view names are still
     * supported, but not recommended: roomEntered, scriptClick, consoleClick, worldMapEntered, gameLobby
     *
     * Those were actually tutorial events, and in some cases were meaningless or ambiguous.
     *
     * @param {(newView: string, oldView: string) => void} callback
     */
    ScreepsAdapter.onViewChange = function (callback) {
        waitForAngular().then(() => {
            let rootScope = angular.element(document.body).scope();
            if (!rootScope.viewChangeCallbacks) {
                const injector = angular.element(document.body).injector();

                const $routeSegment = injector.get("$routeSegment");
                rootScope.$watch(() => $routeSegment.name,
                    /**
                     * @param {string} newName
                     * @param {string} oldName
                     */
                    (newName, oldName) => {
                        notifyViewWatchers(newName, oldName);
                    }
                );


                rootScope.viewChangeCallbacks = [];
            }

            rootScope.viewChangeCallbacks.push(callback);
        });
    };

    /**
     * Trigger a callback when the hash component of the browser's URI changes (`window.location.hash`).
     * In the Screeps client, the hash is used to discriminate between different views.
     *
     * Examples:
     * - `#!/room/shard0/N12W34`: view for Room N12W34 on shard0
     * - `#!/map/shard3?pos=-18.5,-33.5`: view for WorldMap on shard3,
     *     centered at X/Y room coordinates; these coordinates can be converted to
     *     a room name using an algorithm in the Screeps engine source code
     * - `#!/market/history`: current player's market transaction history
     * - `#!/market/my`: current player's open market orders
     * - `#!/market/all`: all market active orders / prices for all tradeable resources
     * - `#!/inventory`: manage intershard resource inventory and decorations
     * - `#!/profile/PlayerName`: public profile page for PlayerName
     * - `#!/overview`: current player's overview page
     * - `#!/overview/power`: power creep management view
     *
     * @param {(hash: string) => void} callback - the new value of `window.location.hash`
     */
    ScreepsAdapter.onHashChange = function (callback) {
        waitForAngular().then(() => {
            const rootScope = angular.element(document.body).scope();
            if (!rootScope.hashChangeCallbacks) {
                rootScope.$watch(() => window.location.hash,
                    function() {
                        try {

                            for (let i in rootScope.hashChangeCallbacks) {
                                rootScope.hashChangeCallbacks[i](window.location.hash);
                            }
                        } catch (e) {
                            console.error(e);
                        }
                    }
                );

                rootScope.hashChangeCallbacks = [];
            }

            rootScope.hashChangeCallbacks.push(callback);
        });
    };

    /**
     * Trigger a callback when entering a room or switching from one view to another.
     *
     * @param {(roomName: string) => void} callback - the name of the new room
     */
    ScreepsAdapter.onRoomChange = function (callback) {
        ScreepsAdapter.onHashChange(() => {
            let rootScope = angular.element(document.body).scope();
            let $routeParams = angular.element(document.body).injector().get("$routeParams");
            let room = $routeParams.room;
            if (room !== rootScope.lastRoom) {
                try {
                    callback(room);
                } catch (e) {
                    console.error(e);
                }
                rootScope.lastRoom = room;
            }
        });
    };

    /** @type {angular.IScope | null} */
    let currentRoomScope = null;
    /** @type {(() => void) | null} */
    let unwatchSelectedObject = null;

    /**
     *
     * @param {(oldVal: string, newVal: string) => void} callback
     * @returns
     */
    async function watchSelectedObject(callback) {
        // We need a room
        await waitFor(() => !!angular.element(".room.ng-scope").scope())

        const scope = angular.element(".room.ng-scope").scope();
        if (scope && scope !== currentRoomScope) {
            // If we had an old watcher, remove it.
            if (unwatchSelectedObject) {
                unwatchSelectedObject();
                unwatchSelectedObject = null;
            }

            // Attach the watcher
            unwatchSelectedObject = scope.$watch(
                () => scope.Room?.selectedObject,
                /**
                 * @param {string} newVal
                 * @param {string} oldVal
                 */
                (newVal, oldVal) => {
                    if (newVal !== oldVal) {
                        callback(newVal, oldVal);
                    }
                }
            );

            currentRoomScope = scope;
        }

        return unwatchSelectedObject;
    }

    /**
     * @param {any} object
     */
    function notifySelectionWatchers(object) {
        const rootScope = angular.element(document.body).scope();
        for (const callback of rootScope.objectSelectionCallbacks) {
            try {
                callback({ object });
            } catch (e) {
                console.log(e);
            }
        }
    }

    /** @type {(() => void) | null} */
    let watch;

    /**
     * Execute a callback when the selected object changes in a room.
     * @param {({ object: any})} callback
     */
    ScreepsAdapter.onSelectionChange = function(callback) {
        waitForAngular().then(() => {
            const rootScope = angular.element(document.body).scope();
            if (!rootScope.objectSelectionCallbacks) {
                rootScope.objectSelectionCallbacks = [];
                ScreepsAdapter.onViewChange((viewName, oldView) => {
                    const roomViews = ["top.game-room", "top.sim-custom", "top.sim-survival", "top.sim-tutorial"];
                    if (watch) watch();
                    if (roomViews.includes(viewName)) {
                        watchSelectedObject((newObj) => {
                            notifySelectionWatchers(newObj);
                        }).then((watcher) => watch = watcher);
                    }
                    if (roomViews.includes(oldView)) {
                        // We notify here so listeners can deselect their stuff
                        notifySelectionWatchers(null);
                    }
                });
            }
            rootScope.objectSelectionCallbacks.push(callback);
        })
    }

    /**
     * Display a popup dialog
     *
     * @param {object} data an object containing the following fields
     * @param {string} [data.title] - a plaintext title; if title and icon are omitted, an exclamation point icon is shown
     * @param {string} [data.icon] - an icon/image URL; if title and icon are omitted, an exclamation point icon is shown
     * @param {string} [data.message] - a plaintext message to show in the dialog body; if message and innerHTML
     * TODO: Document other data properties:
     *   buttonOkLabel
     *   buttonCancelLabel
     *
     * For additional parameters and context, search the following terms
     * in the debugger:
     * - dlg-alert.component.pug
     * - DlgAlertComponent
     * - AlertService
     */
    ScreepsAdapter.showDialog = function(data) {
        angular.element("body").injector().get("AlertService").show({ data });
    };

    /** @type {MapButtonOptions[]} */
    const mapButtons = [];
    const MAP_BUTTON_SPACING = 40;
    const MAP_BUTTON_BASE_RIGHT = 10;
    /** @type {HTMLStyleElement | null} */
    let mapButtonStyleElem = null;

    /** @type {(() => void)[]} */
    let mapButtonLayoutUnwatchers = [];
    /** @type {any} */
    let mapButtonSetupTimeout = null;

    function ensureMapButtonBaseStyles() {
        if (!mapButtonStyleElem) {
            mapButtonStyleElem = document.createElement("style");
            mapButtonStyleElem.id = "screeps-map-buttons-style";
            mapButtonStyleElem.textContent = "\
section.world-map .map-container .btn-units.map-ext-btn { font-size: 16px; padding: 4px; } \
section.world-map .map-container.map-ext-replaces-units > .btn-units:not(.map-ext-btn) { display: none !important; } \
section.world-map .map-container .map-ext-btn-bar { display: contents; } \
section.world-map .map-container .layer-select ~ .layer-select { display: none !important; }";
            document.head.appendChild(mapButtonStyleElem);
        }
    }

    /**
     * @returns {any}
     */
    function getMapScope() {
        return angular.element(".map-container").scope();
    }

    /**
     * @returns {any}
     */
    function getWorldMap() {
        return getMapScope().WorldMap;
    }

    /**
     * @param {string} content
     */
    function compileMapButton(content) {
        const mapContainerElem = angular.element(".map-container");
        const $compile = mapContainerElem.injector().get("$compile");
        return $compile(content)(getMapScope());
    }

    /**
     * @param {HTMLElement} mapContainer
     */
    function ensureMapButtonBarContainer(mapContainer) {
        let bar = mapContainer.querySelector(".map-ext-btn-bar");
        if (bar) {
            return bar;
        }

        bar = document.createElement("div");
        bar.className = "map-ext-btn-bar";
        const anchor = mapContainer.querySelector(".room-search");
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(bar, anchor);
        } else {
            mapContainer.appendChild(bar);
        }
        return bar;
    }

    /**
     * @param {HTMLElement} mapContainer
     */
    function clearMapButtonBar(mapContainer) {
        log("clearing button bar");
        const bar = mapContainer.querySelector(".map-ext-btn-bar");
        if (bar) {
            bar.innerHTML = "";
        }
        document.querySelectorAll("section.world-map .map-ext-btn").forEach((elem) => elem.remove());
    }

    /**
     * @param {HTMLElement} mapContainer
     */
    function mapButtonBarNeedsRecreate(mapContainer) {
        for (const button of mapContainer.querySelectorAll(".map-ext-btn")) {
            const ngStyle = button.getAttribute("ng-style") || "";
            if (!ngStyle.includes("getMapExtButtonRight")) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param {HTMLElement} mapContainer
     */
    function ensureMapButtonsExist(mapContainer) {
        const bar = ensureMapButtonBarContainer(mapContainer);
        /** @type {string[]} */
        const created = [];

        for (const options of mapButtons) {
            if (mapContainer.querySelector(`.map-ext-btn-${options.id}`)) {
                continue;
            }

            $(compileMapButton(buildMapButtonContent(options))).appendTo(bar);
            created.push(options.id);
        }

        if (created.length) {
            log(`created buttons: ${created.join(", ")}`);
        }
    }

    /**
     * @param {MapButtonOptions} options
     */
    function buildMapButtonVisibilityExpr(options) {
        const parts = [];
        if (options.zoomLevels && options.zoomLevels.length > 0) {
            parts.push(`(${options.zoomLevels.map((z) => `WorldMap.zoom == ${z}`).join(" || ")})`);
        }
        if (options.ngIf) {
            parts.push(`(${options.ngIf})`);
        }
        return parts.length ? parts.join(" && ") : "";
    }

    /**
     * @param {MapButtonOptions} options
     */
    function isMapButtonVisible(options) {
        const expr = buildMapButtonVisibilityExpr(options);
        if (!expr) {
            return true;
        }
        const $parse = angular.element(document.body).injector().get("$parse");
        return !!$parse(expr)(getMapScope());
    }

    function getVisibleMapButtons() {
        return mapButtons.filter((btn) => isMapButtonVisible(btn));
    }

    /**
     * @param {HTMLElement} mapContainer
     */
    function hasButtonReplacingNativeUnits(mapContainer) {
        return mapButtons.some((btn) => {
            if (!btn.replacesUnits || !isMapButtonVisible(btn)) {
                return false;
            }
            return !!mapContainer.querySelector(`.map-ext-btn-${btn.id}`);
        });
    }

    /**
     * @param {HTMLElement | null | undefined} mapContainer
     */
    function applyNativeUnitsVisibility(mapContainer) {
        const worldMap = getWorldMap();
        if (!mapButtons.some((btn) => btn.replacesUnits)) {
            return;
        }
        const replacingVisible = mapContainer
            ? hasButtonReplacingNativeUnits(mapContainer)
            : false;
        worldMap.displayOptions.units = !replacingVisible;
        if (mapContainer) {
            mapContainer.classList.toggle("map-ext-replaces-units", replacingVisible);
        }
    }

    /**
     * @param {HTMLElement} mapContainer
     */
    function getToolbarMapButtons(mapContainer) {
        return getVisibleMapButtons().filter(
            (btn) => !!mapContainer.querySelector(`.map-ext-btn-${btn.id}`),
        );
    }

    /**
     * @param {HTMLElement} mapContainer
     */
    function getMapButtonBaseSlot(mapContainer) {
        if (hasButtonReplacingNativeUnits(mapContainer)) {
            return 0;
        }
        // Native units button is always in the toolbar at zoom 3.
        if (getWorldMap().zoom == 3) { // eslint-disable-line eqeqeq
            return 1;
        }
        return 0;
    }

    /**
     * @param {HTMLElement | null | undefined} mapContainer
     */
    function assignButtonSlots(mapContainer) {
        applyNativeUnitsVisibility(mapContainer);
        if (!mapContainer) {
            return { slots: {}, nextSlot: 0 };
        }
        const visible = getToolbarMapButtons(mapContainer);
        /** @type {Record<string, number>} */
        const slots = {};
        let slot = getMapButtonBaseSlot(mapContainer);

        for (const btn of visible) {
            if (btn.replacesUnits) {
                slots[btn.id] = slot++;
            }
        }
        for (const btn of visible) {
            if (!btn.replacesUnits) {
                slots[btn.id] = slot++;
            }
        }

        return { slots, nextSlot: slot };
    }

    /**
     * @param {any} worldMap
     * @param {HTMLElement} mapContainer
     */
    function installMapButtonLayoutHelpers(worldMap, mapContainer) {
        delete worldMap.mapExtButtonStyles;
        delete worldMap.mapExtLayerSelectStyle;
        worldMap.getMapExtButtonRight = function(/** @type {string} */ id) {
            const { slots } = assignButtonSlots(mapContainer);
            if (!(id in slots)) {
                return {};
            }
            return {
                right: `${MAP_BUTTON_BASE_RIGHT + slots[id] * MAP_BUTTON_SPACING}px`,
            };
        };
        worldMap.getMapExtLayerSelectStyle = function() {
            const { nextSlot } = assignButtonSlots(mapContainer);
            const style = {
                right: `${MAP_BUTTON_BASE_RIGHT + nextSlot * MAP_BUTTON_SPACING}px`,
            };
            for (const layerSelect of mapContainer.querySelectorAll(".layer-select")) {
                /** @type {HTMLElement} */ (layerSelect).style.right = style.right;
            }
            return style;
        };
    }

    function syncLayerSelectPositions() {
        const worldMap = getWorldMap();
        if (typeof worldMap.getMapExtLayerSelectStyle === "function") {
            worldMap.getMapExtLayerSelectStyle();
        }
    }

    /**
     * @param {any} mapContainerElem
     */
    function bindMapButtonLayoutWatcher(mapContainerElem) {
        for (const unwatch of mapButtonLayoutUnwatchers) {
            unwatch();
        }
        mapButtonLayoutUnwatchers = [];

        const scope = getMapScope();
        const worldMap = getWorldMap();
        const $timeout = mapContainerElem.injector().get("$timeout");
        const digest = () => scope.$evalAsync(() => {
            syncLayerSelectPositions();
        });

        syncLayerSelectPositions();
        digest();
        $timeout(digest);

        mapButtonLayoutUnwatchers.push(
            scope.$watch(() => worldMap.zoom, digest),
            scope.$watch(() => worldMap.displayOptions.layer, digest),
            scope.$watch(
                () => getVisibleMapButtons().map((btn) => btn.id).join(","),
                digest,
            ),
            scope.$on("mapStatsUpdated", digest),
            scope.$on("mapSectorsRecalced", digest),
        );
    }


    /**
     * @param {MapButtonOptions} options
     */
    function buildMapButtonContent(options) {
        const expr = buildMapButtonVisibilityExpr(options);
        const ngIf = expr ? `ng:if="${expr}"` : "";
        const ngClass = options.ngClass ? `ng:class="{${options.ngClass}}"` : "";
        return `\
<md:button \
    app-stop-click-propagation app-stop-propagation='mouseout mouseover mousemove' \
    class='md-raised btn-units map-ext-btn map-ext-btn-${options.id}' \
    ${ngIf} ${ngClass} \
    ng:style="WorldMap.getMapExtButtonRight('${options.id}')" \
    ng:click='${options.ngClick}' \
    tooltip-placement='bottom' uib-tooltip='${options.tooltip}'>\
        ${options.content}\
</md:button>`;
    }

    function scheduleMapButtonBarSetup() {
        log("scheduling button bar setup");
        waitForAngular().then(() => {
            const $timeout = angular.element(document.body).injector().get("$timeout");
            if (mapButtonSetupTimeout) {
                $timeout.cancel(mapButtonSetupTimeout);
                log("debounced pending button bar setup");
            }
            mapButtonSetupTimeout = $timeout(() => {
                mapButtonSetupTimeout = null;
                setupMapButtonBar();
            });
        });
    }

    function setupMapButtonBar() {
        const mapContainer = /** @type {HTMLElement | null} */ (document.querySelector(".map-container"));
        if (!mapContainer) {
            log("setup skipped (no .map-container)");
            return;
        }
        if (mapButtons.length === 0) {
            log("setup skipped (no buttons registered)");
            return;
        }

        const registered = mapButtons.map((btn) => btn.id).join(", ");
        log(`setup started (${registered})`);

        const mapContainerElem = angular.element(mapContainer);
        installMapButtonLayoutHelpers(getWorldMap(), mapContainer);
        ensureMapButtonBaseStyles();

        if (mapButtonBarNeedsRecreate(mapContainer)) {
            log("recreating button bar (stale template)");
            clearMapButtonBar(mapContainer);
        }

        ensureMapButtonsExist(mapContainer);
        bindMapButtonLayoutWatcher(mapContainerElem);

        const present = [...mapContainer.querySelectorAll(".map-ext-btn")].map(
            (btn) => [...btn.classList].find((c) => c.startsWith("map-ext-btn-"))?.slice("map-ext-btn-".length),
        ).filter(Boolean);
        log(`setup done (in DOM: ${present.join(", ") || "none"})`);
    }

    /**
     * Register a toggle button for the world map toolbar. Registration persists
     * across view changes; buttons are created when the world map is shown.
     *
     * @param {MapButtonOptions} options
     */
    ScreepsAdapter.registerMapButton = function(options) {
        if (mapButtons.some((btn) => btn.id === options.id)) {
            log(`registerMapButton ${options.id} skipped (duplicate)`);
            return;
        }

        const index = mapButtons.findIndex((btn) => btn.id.localeCompare(options.id) > 0);
        if (index === -1) {
            mapButtons.push(options);
        } else {
            mapButtons.splice(index, 0, options);
        }

        log(`registerMapButton ${options.id} (${mapButtons.length} registered)`);
        ensureMapButtonBaseStyles();
        scheduleMapButtonBarSetup();
    };

    ScreepsAdapter.onViewChange((view) => {
        if (view === "top.game-world-map") {
            scheduleMapButtonBarSetup();
        }
    });

    /**
     * Build a localStorage key, prefixing for PTR or season servers.
     * @param {string} name
     */
    function buildSettingKey(name) {
        const isPtr = angular.element(document.body).scope()?.ptr;
        const isSeason = /\/season/.test(window.location.pathname);
        return `${isPtr ? "ptr:" : isSeason ? "season:" : ""}${name}`;
    }

    /**
     * Read a persisted setting. Booleans stored as "true"/"false" are coerced back.
     * Pass `{ json: true }` to parse/store structured values.
     * @param {string} name
     * @param {any} [defaultValue]
     * @param {{ json?: boolean }} [options]
     */
    ScreepsAdapter.getSetting = function(name, defaultValue, options) {
        const raw = localStorage.getItem(buildSettingKey(name));
        if (raw === null) return defaultValue;
        if (options?.json) {
            return JSON.parse(raw);
        }
        if (raw === "true") return true;
        if (raw === "false") return false;
        return raw;
    };

    /**
     * Persist a setting. Pass `{ json: true }` to JSON-serialize objects and arrays.
     * @param {string} name
     * @param {any} value
     * @param {{ json?: boolean }} [options]
     */
    ScreepsAdapter.setSetting = function(name, value, options) {
        const stored = options?.json ? JSON.stringify(value) : String(value);
        return localStorage.setItem(buildSettingKey(name), stored);
    };

    // aliases to angular services
    Object.defineProperty(ScreepsAdapter, "User", {
        get: function() {
            delete this.User;
            Object.defineProperty(this, "User", {
                value: angular.element(document.body).scope().Me()
            });
            return this.User;
        },
        configurable: true
    });

    // Define a couple properties for quick access
    ["$timeout", "$routeSegment", "$location", "Api", "Connection", "Console", "MapUtils", "Socket"].forEach((key) => {
        Object.defineProperty(ScreepsAdapter, key, {
            get: function() {
                return angular.element(document.body).injector().get(key)
            },
            configurable: true
        });
    });

    expose("ScreepsAdapter", ScreepsAdapter);
})();
