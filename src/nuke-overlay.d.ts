interface Nuke {
    _id: string;
    room: string;
    x: number;
    y: number;
    landTime: number;
    launchRoomName: string;
}

interface Point {
    x: number;
    y: number;
}

interface Flight {
    nuke: Nuke;
    launch: Point;
    impact: Point;
    rocket: Point;
    angle: number;
    remaining: number;
}