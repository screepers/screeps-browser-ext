interface PortalDest {
    room: string;
    shard?: string;
    x?: number;
    y?: number;
}

interface Portal {
    id: string;
    room: string;
    x: number;
    y: number;
    destination: PortalDest;
    unstableDate?: number;
    decayTime?: number;
    /** A 3×3 ring, drawn once between the two empty centers. */
    core?: boolean;
}

interface PortalCache {
    revision: number;
    etag: string;
    portals: Portal[];
}

interface Point {
    x: number;
    y: number;
}

interface DrawnEnd {
    portal: Portal;
    role: "origin" | "destination";
    screen: Point;
    hit: number;
}

interface MapAction {
    shard: string;
    room: string;
    newTab: boolean;
}
