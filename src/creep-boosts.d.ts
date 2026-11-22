interface BodyPart {
    type?: string;
    hits?: number;
    boost?: string;
}

type CreepBody = BodyPart[] | Record<string, BodyPart>;

interface SelectedCreep {
    type?: string;
    body?: CreepBody;
}

interface BoostGraphic {
    alpha: number;
    destroyed: boolean;
    parent: unknown;
    lineStyle(width: number, color: number, alpha: number): void;
    arc(x: number, y: number, radius: number, start: number, end: number, anticlockwise?: boolean): void;
    destroy(): void;
}

interface BoostParent {
    addChild(child: BoostGraphic): void;
}

interface BoostScope {
    bodySprites?: BoostGraphic[];
    [id: string]: BoostParent | BoostGraphic[] | undefined;
}

interface BoostDrawParams {
    scope?: BoostScope;
    state?: { body?: CreepBody };
    rootContainer?: BoostParent;
    payload?: { parentId?: string };
}

interface BoostWorld {
    app?: { ticker?: { __creepBoostPulse?: boolean, add: (fn: () => void) => void } };
    gameObjects?: Record<string, { scope?: BoostScope, state?: { body?: CreepBody }, rootContainer?: BoostParent }>;
}

interface BoostRenderer {
    world?: BoostWorld;
}

interface BoostRendererCtor {
    prototype: {
        applyState(this: BoostRenderer, state: unknown, tickDuration?: number): unknown;
    };
}

interface BoostWorldProto {
    runProcessor(meta: { type?: string, name?: string }, params: BoostDrawParams): unknown;
}
