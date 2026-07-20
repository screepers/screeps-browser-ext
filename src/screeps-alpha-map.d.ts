/// <reference types="pixi.js" />

declare namespace AlphaMap {

    type ObjectType =
        | 'w'   // Wall (constructedWall)
        | 'r'   // Road
        | 'pb'  // PowerBank / Dropped Power
        | 'p'   // Portal
        | 's'   // Sources
        | 'c'   // Controller
        | 'm'   // Mineral / Deposit
        | 'k'   // Keeper Lair
        | '2'   // Invader (user id)
        | '3';  // Source Keeper (user id)

    type Coord = [x: number, y: number];

    type ObjectList = { [type in ObjectType]?: Coord[] };

    /** Client uses RxJS 6 (Angular 8); keep ambient via import() like global.d.ts. */
    type Observable<T> = import('rxjs').Observable<T>;
    type Subject<T> = import('rxjs').Subject<T>;
    type BehaviorSubject<T> = import('rxjs').BehaviorSubject<T>;

    /** Runtime sprite probed from a map layer container child. */
    interface MapSprite {
        texture?: { constructor: Function };
        constructor: Function;
        blendMode?: number;
    }

    /** PIXI namespace from @screeps/map (v5.3.12), not window.PIXI (v7.4.3). */
    type Pixi = Pick<PIXI, 'Texture' | 'Container' | 'Sprite' | 'BLEND_MODES'>;

    interface MapBound {
        x: number;
        y: number;
        width: number;
        height: number;
    }

    /** Display layer id from the alpha map picker (e.g. owner0, claim0). */
    type DisplayLayerId = string;

    interface DisplayOption {
        name: string;
        value: DisplayLayerId;
        interval?: boolean;
    }

    /** Constructor shape for custom layer subclasses. */
    interface LayerConstructor {
        renderObservables?: (() => Observable<any> | undefined)[];
        renderOnScaleThreshold?: number;
        new (name: string): Layer;
    }

    declare class Layer {
        name: string;
        container: PIXI.Container;

        constructor(name: string);

        /**
         * Define the observables that will cause the layer to be rendered.
         */
        static renderObservables?: (() => Observable<any> | undefined)[];
        /**
         * The zoom level at which the layer will be rendered.
         *
         * Used to change the layer's contents based on the zoom level.
         */
        static renderOnScaleThreshold?: number;

        get renderable(): boolean;
        set renderable(val: boolean): void;

        destroy(): void;
        clear(): void;

        setRenderer(renderer: any): void;

        hasRoom(room: string): boolean;
        getRoomSprite(room: string): PIXI.Sprite;

        createRoomSprite(room: string, texture?: PIXI.Texture): PIXI.Sprite;
        destroyRoomSprite(room: string, options?: boolean | null | { texture?: boolean; baseTexture?: boolean }): void;

        render?(data: any): void | Promise<void>;

        draw(...args: any[]): void | Promise<void>;
    }

    interface CustomLayerEntry {
        name: string;
        create: () => Layer;
        renderable: boolean;
        renderOnScaleThreshold?: number;
        insertBefore?: string;
        lastRenderData?: unknown;
        /** @internal */
        _scaleZoomedIn?: boolean;
        /** @internal */
        _subscriptionsWired?: boolean;
        /** @internal */
        _subscriptions?: { unsubscribe(): void }[];
    }


    interface MapContainer {
        _pixiCache?: Pixi;
        _map: PIXI.Container;
        _renderer: PIXI.Renderer;
        _dirty: boolean;

        /** @internal patched by screeps-alpha-map.js */
        _customLayerEntries?: CustomLayerEntry[];
        _createLayersPatched?: boolean;
        _scaleRerenderWired?: boolean;
        _toggleLayer?: (layer: string, state: boolean) => void;
        _alphaMapToggleLayerPatched?: boolean;
        /** @internal alpha map zoom (0.3–5) */
        _scaleSbj?: BehaviorSubject<number>;
        scale$?: Observable<number>;
        bound$?: Observable<any>;
        bound?: MapBound;
        getBound?(): MapBound;

        get layers(): Record<string, Layer>;

        createLayers(settings?: Record<string, boolean>): void;
        getLayer(name: string): Layer | undefined;
        addLayer(layer: Layer, renderable: boolean): void;
        render(): void;
        toggleLayer(layer: string, state: boolean): void;
        toggleUnitsLayer(state: boolean): void;
        toggleStatsLayer(state: boolean): void;
        toggleUsersLayer(state: boolean): void;
    }

    interface Map {
        _mapContainer: MapContainer;
        getLayer(name: string): Layer | undefined;
        render(): void;
        toggleLayer(layer: string, state: boolean): void;
    }

    interface MapComponent {
        screepsMap: Map;
    }

    interface PreferenceCheckboxOptions {
        id: string;
        label: string;
        getValue(): boolean;
        onChange(enabled: boolean): void;
    }

    interface BaseComponent {
        /** @internal patched by screeps-alpha-map.js */
        _alphaMapPreferencesPatched?: boolean;
        DISPLAY_OPTIONS?: DisplayOption[];
        showWorldPreferences(): void;
        isUnitsVisible?: boolean;
        hideUnits?(): void;
        showUnits?(): void;
        onChangeDisplayType?(type: string): void;
        onChangeScalePercent?(percent: number): void;
        /** @internal stock client route sync; patched to remove settings keys */
        _updateRouteData?(data: string[], queryParams?: Record<string, unknown>): void;
        /** @internal original method */
        __updateRouteData?(data: string[], queryParams?: Record<string, unknown>): void;
        _queryParams?: Record<string, unknown>;
        _route?: { snapshot?: { queryParams?: Record<string, unknown> } };
        _router?: { navigate(commands: unknown[], extras?: Record<string, unknown>): void };
        settingsForm?: {
            value?: { shard?: string; display?: string };
            patchValue?(value: Record<string, unknown>, options?: { emitEvent?: boolean }): void;
            controls?: {
                shard?: { value?: string };
                display?: { value?: string; valueChanges: Observable<string> };
            };
        };

        _unitsSbj?: BehaviorSubject<boolean>;
        _unitsRestrictedSbj?: BehaviorSubject<boolean>;
        _scaleSbj?: BehaviorSubject<number>;
        _drawMapUsersSbj: Subject<any>;
        _drawMapStatsSbj: Subject<any>;
        _displaySbj?: BehaviorSubject<string>;
        _updateStatsSbj: Subject<void>;
        _destroySbj: Subject<void>;
    }

    interface AlphaMapAdapter {
        VERSION: string;

        // --- Constants ---

        ROOM_SIZE: number;
        TILE_SIZE: number;
        MIN_SCALE: number;
        MAX_SCALE: number;
        LAYERS: {
            rooms: string;
            safeMode: string;
            units: string;
            users: string;
            stats: string;
            minerals: string;
            visual: string;
            decorations: string;
        };
        /** Stock default display layer id (`owner0`); not tied to picker sort order. */
        DEFAULT_DISPLAY: DisplayLayerId;
        COLORS: Record<string, RGBColor> & Partial<Record<ObjectType, RGBColor>>;

        // --- Component accessors ---

        getMapComponent(): MapComponent | undefined;
        getBaseComponent(): BaseComponent | undefined;
        getMap(): Map | undefined;
        getMapContainer(): MapContainer | undefined;
        getShard(): string | undefined;
        getDisplayLayer(): DisplayLayerId | undefined;
        getDisplayLayer$(): Observable<DisplayLayerId> | undefined;
        markDirty(): void;
        getPixi(): Pixi | undefined;
        getLayerClass(): new (name: string) => Layer;

        // --- Settings ---

        getSetting<T = string>(name: string, defaultValue?: T): T;
        setSetting(name: string, value: unknown): void;

        // --- Zoom ---

        getZoomLevel(): number;
        isZoomedIn(modifyScaleThreshold: number): boolean;

        // --- Room rendering ---

        drawRoomObjects(
            objects: Record<string, Coord[] | undefined>,
            resolveColor: (type: string) => RGBColor | false | null | undefined,
        ): Uint8Array;

        // --- Display options ---

        registerDisplayOption(option: DisplayOption): boolean;

        // --- Layers ---

        toggleLayer(layerName: string, renderable: boolean): void;
        refresh(): void;
        registerCustomLayer(
            createLayer: () => Layer,
            renderable?: boolean,
            options?: {
                insertBefore?: string;
            },
        ): Layer;

        // --- Preferences ---

        registerPreferenceCheckbox(options: PreferenceCheckboxOptions): void;

        // --- Lifecycle ---

        ready(callback: () => void | Promise<void>): void;
    }
}

interface Window {
    mapComponent?: AlphaMap.MapComponent;
    map?: AlphaMap.Map;
    mapContainer?: AlphaMap.MapContainer;
}
