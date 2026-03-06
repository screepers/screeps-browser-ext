interface ShowDialogOptions {
    /** a plaintext title; if title and icon are omitted, an exclamation point icon is shown */
     title?: string;
     /** an icon/image URL; if title and icon are omitted, an exclamation point icon is shown */
     icon?: string;
     /** a plaintext message to show in the dialog body; if message and innerHTML */
     message?: string;
}

declare var ScreepsAdapter: {
    VERSION: string;

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
     * @param {({ object: any })} callback
     */
    onSelectionChange(callback: (object: any) => void): void;

    /**
     * Display a popup dialog
     */
    showDialog(data: ShowDialogOptions): void;

    $location: {
        url(url: string): void;
    };
    $routeSegment: {
        name: string;
        $routeParams: Record<string, string>;
        getSegmentUrl(route: string, param?: any): string;
    };
    $timeout(callback: () => void, timeout: number = undefined);
    Api: {
        get(route: string): Promise<any>;
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
        bindEventToScope(unk: AnyTlsaRecord, scopeName: string, callback: (...args: any[]) => void): {
            remove(): void;
        };
    };
    User: {
        _id: string;
    };
};

declare var DomHelper: {
    addStyle(style: string): void;
    generateCompiledElement(parent: any, content: string): any;
};