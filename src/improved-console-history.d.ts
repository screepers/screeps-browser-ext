
interface CommandRunnable {
    name: string;
    desc: string | [cmd: string, desc: string][];
    run: (args: string[]) => void;
}

interface CommandAlias {
    name: string;
    alias: string | string[];
}

type CommandDefinition = CommandRunnable | CommandAlias;


interface RoomHistoryEntry {
    server: string;
    shard: string;
    room: string;
}

declare function loadHistory(): void;
declare function clearHistory(): void;
declare function loadRoomHistory(): void;
declare function clearRoomHistory(): void;