/// <reference path="./screeps-alpha-map.d.ts" />

interface ShowDialogOptions {
    /** a plaintext title; if title and icon are omitted, an exclamation point icon is shown */
     title?: string;
     /** an icon/image URL; if title and icon are omitted, an exclamation point icon is shown */
     icon?: string;
     /** a plaintext message to show in the dialog body; if message and innerHTML */
     message?: string;
}

interface MapButtonOptions {
    /** Unique identifier; also used to avoid duplicate registration */
    id: string;
    tooltip: string;
    content: string;
    ngClick: string;
    /** Additional Angular visibility expression */
    ngIf?: string;
    /** Angular ng-class object expression, without outer braces */
    ngClass?: string;
    /** Zoom levels where the button is shown (1–3) */
    zoomLevels?: number[];
    /** Hides the native units button and takes its toolbar slot */
    replacesUnits?: boolean;
}

declare var ScreepsAdapter: {
    VERSION: string;
    loadId: string;

    /**
     * Polls every 50 milliseconds for a given condition
     */
    waitFor(condition: () => boolean, pollInterval = 50, timeoutAfter?: number): void;

    /** Execute a callback once Angular's ready */
    ready(cb: () => void): void;

    /** The current view */
    currentView: string | null;

    /**
     * Listen for changes to the main screeps view.
     * Examples: top.game-room, top.game-world-map, etc.
     *
     * For backward-compatibility purposes, the previous names used as view names are still
     * supported, but not recommended: roomEntered, scriptClick, consoleClick, worldMapEntered, gameLobby
     *
     * Those were actually tutorial events, and in some cases were meaningless or ambiguous.
     */
    onViewChange(callback: (newView: string, oldView: string) => void): void;


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
     */
    onHashChange(callback: (hash: string) => void): void

    /**
     * Trigger a callback when entering a room or switching from one view to another.
     */
    onRoomChange(callback: (roomName: string) => void): void;

    /**
     * Execute a callback when the selected object changes in a room.
     * By default waits until the inspector panel DOM is ready; pass
     * `{ immediate: true }` to run during the selection digest instead.
     */
    onSelectionChange(
        callback: (param: { object: unknown | null }) => void,
        options?: { immediate?: boolean }
    ): void;

    /**
     * Display a popup dialog
     */
    showDialog(data: ShowDialogOptions): void;

    registerMapButton(options: MapButtonOptions): void;

    /**
     * Read a persisted setting. Booleans, numbers, objects, and arrays are coerced
     * back from their stored string form automatically.
     */
    getSetting<T = string>(name: string, defaultValue?: T): T;

    /**
     * Persist a setting. Objects, arrays, and numbers are JSON-serialized automatically.
     */
    setSetting(name: string, value: unknown): void;

    $location: {
        get $$absUrl(): string;
        url(url: string): void;
    };
    $routeSegment: {
        name: string;
        $routeParams: Record<string, string>;
        getSegmentUrl(route: string, param?: any): string;
    };
    $timeout(callback: () => void, timeout: number = undefined);
    Api: {
        get(route: string, params?: Record<string, unknown>): Promise<any>;
        post(route: string, body: any): Promise<void>;
    };
    Connection: {
        sendConsoleCommand(line: string, userId: string): void;
        getMemoryByPath(userId: string | null, path: string): Promise<any>;
        setMemoryByPath(userId: string | null, path: string, value: any): Promise<void>;
        getRoomTerrain(): Promise<any>;
    };
    Console: {
        enabled: boolean;
        messages: { [userId: string]: { text?: string, error: boolean }[] };
    };
    MapUtils: {
        roomNameToXY(roomName: string): [x: number, y: number];
        getRoomNameFromXY(x: number, y: number): string;
    };
    Socket: {
        bindEventToScope(
            scope: angular.IScope,
            channel: string,
            callback: (data: any, event?: unknown) => void,
            onError?: (data: any, event?: unknown) => void,
        ): { remove(): void };
    };
    User: {
        _id: string;
    };
    AlphaMap: AlphaMap.AlphaMapAdapter;
};

declare var DomHelper: {
    addStyle(style: string): void;
    generateCompiledElement(parent: any, content: string): any;
};

type ExposedWindowKey = "ScreepsAdapter" | "DomHelper";

interface Window {
    ScreepsAdapter: typeof ScreepsAdapter;
    DomHelper: typeof DomHelper;
}
