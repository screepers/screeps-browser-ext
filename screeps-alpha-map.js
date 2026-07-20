(() => {
    "use strict";

    const VERSION = "0.1.1";

    if (!window.ScreepsAdapter) {
        throw new Error("screeps-alpha-map.js requires screeps-browser-core.js to be loaded first");
    }

    if (window.ScreepsAdapter.AlphaMap?.VERSION) {
        return;
    }

    /** @type {AlphaMap.AlphaMapAdapter} */
    const AlphaMap = {};

    AlphaMap.VERSION = VERSION;

    // --- Constants ---

    /** From @screeps/map constants.js */
    AlphaMap.ROOM_SIZE = 50;
    AlphaMap.TILE_SIZE = 128;
    AlphaMap.MIN_SCALE = 0.3;
    AlphaMap.MAX_SCALE = 5;

    /** Built-in @screeps/map layer names. */
    AlphaMap.LAYERS = {
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
     * Stock default display layer (`DISPLAY_OPTIONS[1]` before any custom options/sort).
     * Do not use array index after sorting the picker list.
     */
    AlphaMap.DEFAULT_DISPLAY = "owner0";

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function hasQueryValue(value) {
        return value !== null && value !== undefined && value !== "";
    }

    /** From Screeps client utils.js — default colors for map object types. */
    AlphaMap.COLORS = {
        "2": [255, 150, 0],
        "3": [255, 150, 0],
        w: [0, 0, 0],
        r: [60, 60, 60],
        pb: [255, 255, 255],
        m: [170, 170, 170],
        p: [0, 200, 255],
        k: [100, 0, 0],
        c: [80, 80, 80],
        s: [255, 242, 70],
    };

    // --- Component accessors ---

    /**
     * Get the map component for the alpha map.
     * @returns {AlphaMap.MapComponent | undefined}
     */
    AlphaMap.getMapComponent = function () {
        // @ts-expect-error ng is injected by the Screeps client
        return ng.probe(document.querySelector("app-world-map-map"))?.componentInstance;
    };

    /**
     * Get the base component for the alpha map.
     * @returns {AlphaMap.BaseComponent | undefined}
     */
    AlphaMap.getBaseComponent = function () {
        // @ts-expect-error ng is injected by the Screeps client
        return ng.probe(document.querySelector("app-world-map-base"))?.componentInstance;
    };

    /**
     * Get the map component for the alpha map.
     * @returns {AlphaMap.Map | undefined}
     */
    AlphaMap.getMap = function () {
        return AlphaMap.getMapComponent()?.screepsMap;
    };

    /**
     * Get the map container for the alpha map.
     * @returns {AlphaMap.MapContainer | undefined}
     */
    AlphaMap.getMapContainer = function () {
        return AlphaMap.getMapComponent()?.screepsMap._mapContainer;
    };

    /**
     * @returns {string | undefined}
     */
    AlphaMap.getShard = function () {
        const base = AlphaMap.getBaseComponent();
        return base?.settingsForm?.value?.shard ?? base?.settingsForm?.controls?.shard?.value;
    };

    /**
     * @returns {string | undefined}
     */
    AlphaMap.getDisplayLayer = function () {
        const base = AlphaMap.getBaseComponent();
        return (
            base?.settingsForm?.value?.display ??
            base?.settingsForm?.controls?.display?.value ??
            base?._displaySbj?.getValue?.()
        );
    };

    /**
     * @returns {AlphaMap.Observable<AlphaMap.DisplayLayerId> | undefined}
     */
    AlphaMap.getDisplayLayer$ = function () {
        const base = AlphaMap.getBaseComponent();
        if (base?._displaySbj) {
            return base._displaySbj.asObservable();
        }
        return base?.settingsForm?.controls?.display?.valueChanges;
    };

    /**
     * Request a map render on the next animation frame.
     */
    AlphaMap.markDirty = function () {
        const mapContainer = AlphaMap.getMapContainer();
        if (mapContainer) {
            mapContainer._dirty = true;
        }
    };

    /**
     * Resolve the PIXI namespace used by @screeps/map (v5.3.12).
     * window.PIXI is the room renderer (v7.4.3) and must not be used on the alpha map.
     * @returns {AlphaMap.Pixi | undefined}
     */
    AlphaMap.getPixi = function () {
        const container = AlphaMap.getMapContainer();
        if (!container) {
            return undefined;
        }

        if (container._pixiCache) {
            return container._pixiCache;
        }

        const Container = container._map.constructor;
        let Sprite = null;
        let Texture = null;

        for (const layer of Object.values(container.layers)) {
            const child = /** @type {AlphaMap.MapSprite | undefined} */ (layer.container.children[0]);
            if (child?.texture) {
                Sprite = child.constructor;
                Texture = child.texture.constructor;
                break;
            }
        }

        if (!Texture) {
            const refLayer = container.layers.rooms ?? Object.values(container.layers)[0];
            const probeRoom = "W0N0";
            const sprite = refLayer.createRoomSprite(probeRoom);
            Texture = sprite.texture.constructor;
            Sprite = sprite.constructor;
            refLayer.destroyRoomSprite(probeRoom, true);
        }

        /** @type {AlphaMap.Pixi} */
        const pixi = {
            Texture,
            Container,
            Sprite,
            BLEND_MODES: {
                NORMAL: 0,
                ADD: 1,
            },
        };
        container._pixiCache = pixi;
        return pixi;
    };

    /**
     * Get the layer class for the alpha map.
     *
     * Used as the base class for custom layers.
     * @returns {new (name: string) => AlphaMap.Layer}
     */
    AlphaMap.getLayerClass = function () {
        const container = AlphaMap.getMapContainer();
        const refLayer = container?.layers.units ?? Object.values(container?.layers ?? {})[0];
        return /** @type {new (name: string) => AlphaMap.Layer} */ (
            Object.getPrototypeOf(Object.getPrototypeOf(refLayer)).constructor
        );
    };

    // --- Settings ---

    /**
     * Get an alpha map setting.
     *
     * Booleans, numbers, objects, and arrays are coerced back automatically.
     * @param {string} setting
     * @param {any} [defaultValue]
     */
    AlphaMap.getSetting = function (setting, defaultValue) {
        return ScreepsAdapter.getSetting(`screeps.alpha-map.${setting}`, defaultValue);
    };

    /**
     * Save an alpha map setting. Objects, arrays, and numbers are JSON-serialized automatically.
     * @param {string} setting
     * @param {any} value
     */
    AlphaMap.setSetting = function (setting, value) {
        ScreepsAdapter.setSetting(`screeps.alpha-map.${setting}`, value);
    };

    // --- Zoom ---

    AlphaMap.getZoomLevel = function () {
        const container = AlphaMap.getMapContainer();
        const scale = container?._scaleSbj?.getValue?.() ?? AlphaMap.MIN_SCALE;
        const span = AlphaMap.MAX_SCALE - AlphaMap.MIN_SCALE;
        const x = scale - AlphaMap.MIN_SCALE;
        return AlphaMap.MAX_SCALE - Math.sqrt(span * span - x * x);
    };

    /**
     * @param {number} modifyScaleThreshold
     */
    AlphaMap.isZoomedIn = function (modifyScaleThreshold) {
        return AlphaMap.getZoomLevel() >= modifyScaleThreshold;
    };

    // --- Room rendering ---

    /**
     * Build RGBA pixel buffer with a per-type color resolver (for arbitrary object keys).
     * @param {Record<string, AlphaMap.Coord[] | undefined>} objects
     * @param {(type: string) => RGBColor | false | null | undefined} resolveColor
     * @returns {Uint8Array}
    */
    AlphaMap.drawRoomObjects = function (objects, resolveColor) {
        const BIT_DEPTH = 4;
        const pixels = new Uint8Array(AlphaMap.ROOM_SIZE * AlphaMap.ROOM_SIZE * BIT_DEPTH);
        for (const type in objects) {
            const positions = objects[type];
            if (!positions?.length) {
                continue;
            }
            const color = resolveColor(type);
            if (!color) {
                continue;
            }
            for (const [x, y] of positions) {
                const offset = BIT_DEPTH * x + AlphaMap.ROOM_SIZE * BIT_DEPTH * y;
                pixels[offset] = color[0];
                pixels[offset + 1] = color[1];
                pixels[offset + 2] = color[2];
                pixels[offset + 3] = 255;
            }
        }
        return pixels;
    };

    // --- Display options ---

    /** @type {AlphaMap.DisplayOption[]} */
    const _displayOptionRegistrations = [];

    /**
     * @returns {boolean} Whether options were applied to the active base component.
     */
    function applyDisplayOptions() {
        const base = AlphaMap.getBaseComponent();
        if (!base?.DISPLAY_OPTIONS) {
            return false;
        }

        for (const option of _displayOptionRegistrations) {
            if (!base.DISPLAY_OPTIONS.some((existing) => existing.value === option.value)) {
                base.DISPLAY_OPTIONS.push({ ...option });
            }
        }

        base.DISPLAY_OPTIONS.sort((a, b) => {
            if (a.value === "none0") {
                return -1;
            }
            if (b.value === "none0") {
                return 1;
            }
            return a.name.localeCompare(b.name);
        });

        const current = base._displaySbj?.getValue?.();
        if (current && _displayOptionRegistrations.some((option) => option.value === current)) {
            base._displaySbj?.next?.(current);
        }

        return true;
    }

    /**
     * Register an extra display layer option for the alpha map picker.
     * @param {AlphaMap.DisplayOption} option
     * @returns {boolean}
     */
    AlphaMap.registerDisplayOption = function (option) {
        if (!_displayOptionRegistrations.some((existing) => existing.value === option.value)) {
            _displayOptionRegistrations.push(option);
        }
        return applyDisplayOptions();
    };

    // --- Layers ---

    /**
     * Toggle the visibility of a layer.
     * @param {string} layerName
     * @param {boolean} renderable
     */
    AlphaMap.toggleLayer = function (layerName, renderable) {
        AlphaMap.getMapContainer()?.toggleLayer(layerName, renderable);
    };

    /**
     * @param {AlphaMap.MapContainer} mapContainer
     * @param {AlphaMap.Layer} layer
     * @param {string} beforeLayerName
     * @param {boolean} renderable
     */
    function insertLayerBefore(mapContainer, layer, beforeLayerName, renderable) {
        const beforeLayer = mapContainer.getLayer(beforeLayerName);
        layer.renderable = renderable;
        layer.setRenderer(mapContainer._renderer);
        mapContainer.layers[layer.name] = layer;

        if (beforeLayer && beforeLayer.container.parent === mapContainer._map) {
            const beforeIndex = mapContainer._map.getChildIndex(beforeLayer.container);
            mapContainer._map.addChildAt(layer.container, beforeIndex);
        } else {
            mapContainer._map.addChild(layer.container);
        }
    }

    /**
     * Re-fetch map stats and re-emit all wired layer sources.
     */
    AlphaMap.refresh = function () {
        AlphaMap.getBaseComponent()?._updateStatsSbj.next();
    };

    /**
     * @param {AlphaMap.Layer} layer
     * @returns {(() => AlphaMap.Observable<any> | undefined)[]}
     */
    function getRenderObservables(layer) {
        const LayerClass = /** @type {AlphaMap.LayerConstructor} */ (layer.constructor);
        return LayerClass.renderObservables ?? [];
    }

    /**
     * @param {AlphaMap.Layer} layer
     * @returns {number | undefined}
     */
    function getRenderOnScaleThreshold(layer) {
        const LayerClass = /** @type {AlphaMap.LayerConstructor} */ (layer.constructor);
        return LayerClass.renderOnScaleThreshold;
    }

    /**
     * @param {AlphaMap.CustomLayerEntry} entry
     * @param {any} data
     */
    async function invokeEntryRender(entry, data) {
        const map = AlphaMap.getMap();
        const mapContainer = AlphaMap.getMapContainer();
        if (!map || !mapContainer) {
            return;
        }

        entry.lastRenderData = data;

        const layer = map.getLayer(entry.name);
        if (!layer?.render) {
            return;
        }

        await layer.render(data);
        if (layer.renderable) {
            mapContainer._dirty = true;
        }
    }

    /**
     * @param {AlphaMap.CustomLayerEntry} entry
     */
    function wireCustomLayerEntry(entry) {
        if (entry._subscriptionsWired) {
            return;
        }

        const base = AlphaMap.getBaseComponent();
        if (!base) {
            return;
        }

        const probe = entry.create();
        const observables = getRenderObservables(probe);
        if (!observables.length || !probe.render) {
            return;
        }

        entry._subscriptionsWired = true;
        entry._subscriptions = [];

        for (const getObservable of observables) {
            const observable = getObservable();
            if (!observable) {
                continue;
            }

            const subscription = observable.subscribe((/** @type {any} */ data) => {
                void invokeEntryRender(entry, data);
            });
            entry._subscriptions.push(subscription);
        }

        const destroySubscription = base._destroySbj.subscribe(() => {
            for (const subscription of entry._subscriptions ?? []) {
                subscription.unsubscribe();
            }
            entry._subscriptions = [];
            entry._subscriptionsWired = false;
            destroySubscription.unsubscribe();
        });
    }

    /**
     * Re-render custom layers from cached observable data when zoom changes.
     */
    function ensureScaleRerender() {
        const mapContainer = AlphaMap.getMapContainer();
        const base = AlphaMap.getBaseComponent();
        if (!mapContainer || !base || mapContainer._scaleRerenderWired || !mapContainer.scale$) {
            return;
        }
        mapContainer._scaleRerenderWired = true;

        let scaleRedrawScheduled = false;
        const scaleSubscription = mapContainer.scale$.subscribe(() => {
            if (scaleRedrawScheduled) {
                return;
            }
            scaleRedrawScheduled = true;
            ScreepsAdapter.$timeout(() => {
                scaleRedrawScheduled = false;

                for (const entry of mapContainer._customLayerEntries ?? []) {
                    if (entry.lastRenderData === undefined) {
                        continue;
                    }

                    const map = AlphaMap.getMap();
                    const layer = map?.getLayer(entry.name);
                    if (!layer?.renderable || !layer.render) {
                        continue;
                    }

                    if (entry.renderOnScaleThreshold !== undefined) {
                        const zoomedIn = AlphaMap.isZoomedIn(entry.renderOnScaleThreshold);
                        if (zoomedIn === entry._scaleZoomedIn) {
                            continue;
                        }
                        entry._scaleZoomedIn = zoomedIn;
                    }

                    void invokeEntryRender(entry, entry.lastRenderData);
                }
            });
        });

        const destroySubscription = base._destroySbj.subscribe(() => {
            scaleSubscription.unsubscribe();
            destroySubscription.unsubscribe();
            mapContainer._scaleRerenderWired = false;
        });
    }

    /**
     * Register a custom layer with the alpha map.
     *
     * This handles recreating the layer when the map is reloaded on a view change.
     * Layers may declare renderObservables and render(data) for observable-driven rendering.
     *
     * @param {() => AlphaMap.Layer} createLayer
     * @param {boolean} [renderable=true]
     * @param {{ insertBefore?: string }} [options]
     * @returns {AlphaMap.Layer}
     */
    AlphaMap.registerCustomLayer = function (createLayer, renderable = true, options = {}) {
        const mapContainer = AlphaMap.getMapContainer();
        if (!mapContainer) {
            throw new Error("AlphaMap.getMapContainer() unavailable");
        }
        mapContainer._customLayerEntries ??= [];

        if (!mapContainer._createLayersPatched) {
            mapContainer._createLayersPatched = true;
            const origCreateLayers = mapContainer.createLayers.bind(mapContainer);
            mapContainer.createLayers = function (settings = {}) {
                origCreateLayers(settings);
                for (const entry of this._customLayerEntries ?? []) {
                    if (entry.insertBefore) {
                        insertLayerBefore(this, entry.create(), entry.insertBefore, entry.renderable);
                    } else {
                        this.addLayer(entry.create(), entry.renderable);
                    }
                }
            };
        }

        const layer = createLayer();
        const renderOnScaleThreshold = getRenderOnScaleThreshold(layer);
        let entry = mapContainer._customLayerEntries.find((candidate) => candidate.name === layer.name);
        if (!entry) {
            entry = {
                name: layer.name,
                create: createLayer,
                renderable,
                renderOnScaleThreshold,
                insertBefore: options.insertBefore,
            };
            if (entry.renderOnScaleThreshold !== undefined) {
                entry._scaleZoomedIn = AlphaMap.isZoomedIn(entry.renderOnScaleThreshold);
            }
            mapContainer._customLayerEntries.push(entry);
            if (entry.insertBefore) {
                insertLayerBefore(mapContainer, layer, entry.insertBefore, renderable);
            } else {
                mapContainer.addLayer(layer, renderable);
            }
        } else {
            entry.renderable = renderable;
            entry.insertBefore = options.insertBefore ?? entry.insertBefore;
            mapContainer.toggleLayer(layer.name, renderable);
        }

        wireCustomLayerEntry(entry);
        ensureScaleRerender();

        return layer;
    };

    /**
     * Patch the map container's toggleLayer method to refresh the map when a custom layer is toggled.
     */
    function ensureWiredLayerToggle() {
        const mapContainer = AlphaMap.getMapContainer();
        if (!mapContainer || mapContainer._alphaMapToggleLayerPatched) {
            return;
        }
        mapContainer._alphaMapToggleLayerPatched = true;

        const origToggleLayer = mapContainer.toggleLayer.bind(mapContainer);
        mapContainer.toggleLayer = function (layerName, renderable) {
            const layer = mapContainer.getLayer(layerName);
            const wasRenderable = layer?.renderable;

            origToggleLayer(layerName, renderable);

            const entry = mapContainer._customLayerEntries?.find((candidate) => candidate.name === layerName);
            if (renderable && !wasRenderable && entry?._subscriptionsWired) {
                AlphaMap.refresh();
            }
        };
    }

    /**
     * Patch the map container's toggleLayer method to persist layer settings.
     */
    function patchToggleLayer() {
        const mapContainer = AlphaMap.getMapContainer();
        if (!mapContainer || mapContainer._toggleLayer) {
            return;
        }

        // The default implementation updates query parameters but not layer settings.
        mapContainer._toggleLayer = mapContainer.toggleLayer;

        /**
         * @param {string} layer
         * @param {boolean} state
         */
        mapContainer.toggleLayer = function (layer, state) {
            if (layer === AlphaMap.LAYERS.visual) {
                AlphaMap.setSetting("visual", state);
            }
            if (layer === AlphaMap.LAYERS.stats) {
                AlphaMap.setSetting("claim", state);
            }
            if (layer === AlphaMap.LAYERS.units) {
                AlphaMap.setSetting("units", state);
                const unitsSbj = AlphaMap.getBaseComponent()?._unitsSbj;
                if (unitsSbj && unitsSbj.getValue() !== state) {
                    unitsSbj.next(state);
                }
            }
            mapContainer._toggleLayer?.(layer, state);
        };

        mapContainer.toggleUnitsLayer = (state) => {
            mapContainer.toggleLayer(AlphaMap.LAYERS.units, state);
        };
        mapContainer.toggleStatsLayer = (state) => {
            mapContainer.toggleLayer(AlphaMap.LAYERS.stats, state);
        };
        mapContainer.toggleUsersLayer = (state) => {
            mapContainer.toggleLayer(AlphaMap.LAYERS.users, state);
        };
    }

    /**
     * Stock preferences push units/claim/visual into `_updateRouteData` as if they
     * were URL params. Drop them from the query string and apply via toggleLayer
     * (persistence + units subject live there).
     * @param {Record<string, unknown>} queryParams
     */
    function saveSettingsFromQuery(queryParams) {
        /**
         * Stock URL semantics: absent/`null` means on; only explicit false disables.
         * @param {unknown} value
         * @returns {boolean}
         */
        function isEnabled(value) {
            return value !== false && value !== "false";
        }

        if ("units" in queryParams) {
            AlphaMap.toggleLayer(AlphaMap.LAYERS.units, isEnabled(queryParams.units));
        }
        if ("claim" in queryParams) {
            AlphaMap.toggleLayer(AlphaMap.LAYERS.stats, isEnabled(queryParams.claim));
        }
        if ("visual" in queryParams) {
            AlphaMap.toggleLayer(AlphaMap.LAYERS.visual, isEnabled(queryParams.visual));
        }
    }

    /** Stock preference keys that must not live in the alpha map URL. */
    const SETTINGS_QUERY_KEYS = new Set(["units", "claim", "visual", "color", "decor"]);

    /**
     * @param {Record<string, unknown>} queryParams
     * @returns {boolean}
     */
    function isSettingsOnlyUpdate(queryParams) {
        const keys = Object.keys(queryParams);
        return keys.length > 0 && keys.every((key) => SETTINGS_QUERY_KEYS.has(key));
    }

    /**
     * Keep view settings out of the alpha map URL
     */
    function patchUpdateRouteData() {
        const base = AlphaMap.getBaseComponent();
        if (!base || base.__updateRouteData) {
            return;
        }

        base.__updateRouteData = base._updateRouteData;

        /**
         * @param {string[]} data
         * @param {Record<string, unknown>} [queryParams]
         * @this {AlphaMap.BaseComponent}
         */
        base._updateRouteData = function (data, queryParams = {}) {
            saveSettingsFromQuery(queryParams);

            // Merge like stock, but drop preference/settings keys from the query string.
            /** @type {Record<string, unknown>} */
            const next = {
                ...this._route?.snapshot?.queryParams,
                ...this._queryParams,
                ...queryParams,
            };
            for (const key of SETTINGS_QUERY_KEYS) {
                delete next[key];
            }

            // Keep display/scale across room ↔ map (URL is wiped on room views).
            const displaySource = hasQueryValue(queryParams.display)
                ? queryParams.display
                : hasQueryValue(next.display)
                    ? next.display
                    : AlphaMap.getSetting("display", AlphaMap.DEFAULT_DISPLAY);
            next.display = displaySource;
            AlphaMap.setSetting("display", next.display);

            if (hasQueryValue(queryParams.scale)) {
                next.scale = queryParams.scale;
                AlphaMap.setSetting("scale", next.scale);
            } else if (!hasQueryValue(next.scale)) {
                const savedScale = AlphaMap.getSetting("scale");
                if (savedScale !== undefined) {
                    next.scale = savedScale;
                }
            } else {
                AlphaMap.setSetting("scale", next.scale);
            }

            this._queryParams = next;

            // Preference-only updates are applied above; do not navigate or the
            // missing URL keys would re-emit stock defaults and clobber restore.
            if (isSettingsOnlyUpdate(queryParams)) {
                return;
            }

            setTimeout(() => {
                this._router?.navigate(["..", ...data], {
                    queryParams: this._queryParams,
                    relativeTo: this._route,
                    replaceUrl: true,
                });
                // Stock subscriptions treat missing units/claim/visual as defaults;
                // re-assert localStorage after the queryParams emission.
                setTimeout(() => restoreMapSettings(), 0);
            });
        };
    }

    /**
     * Restore preference toggles from localStorage (stock client used URL query params).
     * Also re-apply saved display/scale when the URL lacks them (e.g. after a room view).
     */
    function restoreMapSettings() {
        const base = AlphaMap.getBaseComponent();
        const mapContainer = AlphaMap.getMapContainer();
        if (!mapContainer) {
            return;
        }

        mapContainer.toggleLayer(AlphaMap.LAYERS.units, AlphaMap.getSetting("units", true));
        mapContainer.toggleLayer(AlphaMap.LAYERS.visual, AlphaMap.getSetting("visual", true));
        mapContainer.toggleLayer(AlphaMap.LAYERS.stats, AlphaMap.getSetting("claim", true));

        if (!base) {
            return;
        }

        const snapshot = base._route?.snapshot?.queryParams ?? {};
        if (hasQueryValue(snapshot.display)) {
            AlphaMap.setSetting("display", snapshot.display);
        }
        if (hasQueryValue(snapshot.scale)) {
            AlphaMap.setSetting("scale", snapshot.scale);
        }

        const display = hasQueryValue(snapshot.display)
            ? /** @type {string} */ (snapshot.display)
            : AlphaMap.getSetting("display", AlphaMap.DEFAULT_DISPLAY);
        if (!snapshot.display) {
            base._displaySbj?.next?.(display);
            base.onChangeDisplayType?.(display);
            // emitEvent updates the URL via the stock display$ → _updateRouteData pipe
            base.settingsForm?.patchValue?.({ display });
        }

        const savedScale = AlphaMap.getSetting("scale");
        if (savedScale !== undefined && !hasQueryValue(snapshot.scale)) {
            base.onChangeScalePercent?.(Number(savedScale));
        }
    }

    // --- Preferences ---

    /** @type {AlphaMap.PreferenceCheckboxOptions[]} */
    const _preferenceCheckboxes = [];

    /**
     * @param {AlphaMap.PreferenceCheckboxOptions} options
     */
    AlphaMap.registerPreferenceCheckbox = function (options) {
        if (_preferenceCheckboxes.some((pref) => pref.id === options.id)) {
            return;
        }
        _preferenceCheckboxes.push(options);
    };

    /**
     * @param {HTMLFormElement} form
     * @returns {string | undefined}
     */
    function getPreferencesNgContentAttr(form) {
        const fieldset = form.querySelector("fieldset");
        if (!fieldset) {
            return undefined;
        }
        return [...fieldset.attributes].find((attr) => attr.name.startsWith("_ngcontent-"))?.name;
    }

    function injectPreferenceCheckboxes() {
        const form = /** @type {HTMLFormElement | null} */ (
            document.querySelector("app-world-preferences form")
        );
        if (!form) {
            return;
        }

        syncPreferencesFormFromSettings();

        const ngContentAttr = getPreferencesNgContentAttr(form);

        for (const pref of _preferenceCheckboxes) {
            if (form.querySelector(`[data-alpha-pref="${pref.id}"]`)) {
                continue;
            }

            const fieldset = document.createElement("fieldset");
            fieldset.className = "--flex --column";
            fieldset.dataset.alphaPref = pref.id;
            if (ngContentAttr) {
                fieldset.setAttribute(ngContentAttr, "");
            }

            fieldset.innerHTML = `
                <label class="__props-display">\
                    <input type="checkbox">\
                    <span class="--color-text">${pref.label}</span>\
                </label>`;

            const checkbox = /** @type {HTMLInputElement | null} */ (fieldset.querySelector("input"));
            if (!checkbox) {
                continue;
            }

            checkbox.checked = pref.getValue();
            checkbox.addEventListener("change", () => {
                pref.onChange(checkbox.checked);
            });

            form.appendChild(fieldset);
        }
    }

    /**
     * Stock preferences read units/claim/visual from the URL; point them at localStorage instead.
     */
    function syncPreferencesFormFromSettings() {
        const el = document.querySelector("app-world-preferences");
        if (!el) {
            return;
        }
        // @ts-expect-error ng is injected by the Screeps client
        const prefs = ng.probe(el)?.componentInstance;
        if (!prefs?.paramsForm?.patchValue) {
            return;
        }
        prefs.paramsForm.patchValue(
            {
                units: AlphaMap.getSetting("units", true),
                visual: AlphaMap.getSetting("visual", true),
                claim: AlphaMap.getSetting("claim", true),
            },
            { emitEvent: false },
        );
    }

    /**
     * Patch the base component's showWorldPreferences method to inject custom alpha map settings.
     */
    function patchShowWorldPreferences() {
        const base = AlphaMap.getBaseComponent();
        if (!base || base._alphaMapPreferencesPatched) {
            return;
        }
        base._alphaMapPreferencesPatched = true;
        const origShowWorldPreferences = base.showWorldPreferences.bind(base);
        base.showWorldPreferences = function () {
            origShowWorldPreferences();
            ScreepsAdapter.$timeout(() => {
                injectPreferenceCheckboxes();
            });
        };
    }

    // --- Lifecycle ---

    /**
     * Install core alpha-map patches each time the view is active.
     */
    function installCorePatches() {
        applyDisplayOptions();
        ensureWiredLayerToggle();
        patchToggleLayer();
        patchUpdateRouteData();
        restoreMapSettings();
        patchShowWorldPreferences();
    }

    /**
     * Run callback each time the alpha map view is active. Do not retain map handles
     * from the callback — use AlphaMap getters at point of use instead.
     * @param {() => void | Promise<void>} callback
     */
    AlphaMap.ready = function (callback) {
        ScreepsAdapter.ready(() => {
            ScreepsAdapter.onViewChange(async (triggerName) => {
                if (triggerName !== "top.map2shard") {
                    return;
                }
                await ScreepsAdapter.waitFor(() => !!AlphaMap.getMapComponent());
                await callback();
            });
        });
    };

    AlphaMap.ready(() => {
        installCorePatches();
    });

    ScreepsAdapter.AlphaMap = AlphaMap;
})();
