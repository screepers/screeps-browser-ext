// ==UserScript==
// @name        Screeps creep boosts
// @namespace   https://screeps.com/
// @version     0.1.0
// @author      Etienne Samson
// @description Show which creep parts are boosted, on the room view and in the inspector
// @run-at      document-ready
// @grant       none
// @require     REPO_URL/screeps-browser-core.js
// ==/UserScript==

/// <reference path="./creep-boosts.d.ts" />

(() => {

    /**
     * Geometry copied from the client renderer (`creepBuildBody`). The border is a
     * thin stroke just outside the official arc, whose outer edge is radius 50.
     * Tough is a 120px sprite rather than an arc.
     */
    const ANGLE_SHIFT = -Math.PI / 2;
    const PART_ANGLE = Math.PI / 50;
    const MAX_PART_HITS = 100;
    const BORDER_WIDTH = 3;
    const BORDER_RADIUS = 50 + BORDER_WIDTH / 2;
    const TOUGH_RADIUS = 60 + BORDER_WIDTH / 2;
    const BORDER_COLOR = 0xffffff;

    /** Part types the client draws as colored arcs. `move` sits on the back half. */
    const ARC_TYPES = new Set(["move", "work", "attack", "ranged_attack", "heal", "claim"]);

    const ROOM_VIEWS = ["top.game-room", "top.game-room-history", "top.sim-custom", "top.sim-survival", "top.sim-tutorial"];

    const PIP_STYLE = `
section.room aside .object-properties .body .bodypart[data-boost-tier] {
    border: none;
    width: 13px;
    height: 13px;
    margin-right: 5px;
    margin-left: 0;
    top: 0;
    border-radius: 0;
    filter: drop-shadow(0 0 1px #fff);
}
section.room aside .object-properties .body .bodypart[data-boost-tier="1"] {
    clip-path: polygon(50% 4%, 96% 96%, 4% 96%);
}
section.room aside .object-properties .body .bodypart[data-boost-tier="2"] {
    clip-path: none;
}
section.room aside .object-properties .body .bodypart[data-boost-tier="3"] {
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}
section.room aside .object-properties .body .bodypart[data-boost-tier] .dead-overlay {
    border-radius: 0;
}
`;

    /** @type {Set<BoostGraphic>} */
    const pulsing = new Set();

    let worldPatched = false;
    /** @type {ReturnType<typeof setInterval> | 0} */
    let rendererPoll = 0;
    /** @type {ReturnType<typeof setInterval> | 0} */
    let boostWatchPoll = 0;
    /** @type {WeakSet<object>} */
    const watchedScopes = new WeakSet();

    /**
     * Body order used by the renderer: arrays stay put, object keys sort as strings.
     * @param {CreepBody | null | undefined} body
     * @returns {BodyPart[]}
     */
    function rendererBody(body) {
        if (!body) return [];
        if (Array.isArray(body)) return body;
        return Object.keys(body).sort().map((key) => body[key]);
    }

    /**
     * Body order used by the inspector (`orderByNameNumerically`): arrays stay put,
     * object keys sort numerically.
     * @param {CreepBody | null | undefined} body
     * @returns {BodyPart[]}
     */
    function inspectorBody(body) {
        if (!body) return [];
        if (Array.isArray(body)) return body;
        return Object.keys(body)
            .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
            .map((key) => body[key]);
    }

    /**
     * @param {BodyPart | null | undefined} part
     */
    function livingHits(part) {
        const hits = part?.hits;
        return typeof hits === "number" ? hits : 0;
    }

    /**
     * @param {string | undefined} compound
     * @returns {0 | 1 | 2 | 3}
     */
    function boostTier(compound) {
        if (!compound) return 0;
        if (compound.startsWith("X")) return 3;
        if (compound.length === 2) return 1;
        return 2;
    }

    /**
     * @returns {(new () => BoostGraphic) | null}
     */
    function Graphics() {
        const pixi = /** @type {{ Graphics?: new () => BoostGraphic } | undefined} */ (
        /** @type {any} */ (window).PIXI
        );
        return pixi?.Graphics ?? null;
    }

    function pulse() {
        const wave = 0.5 + 0.5 * Math.sin(Date.now() / 280);
        const alpha = 0.35 + 0.65 * wave;
        for (const graphic of pulsing) {
            if (graphic.destroyed || !graphic.parent) {
                pulsing.delete(graphic);
                if (!graphic.destroyed) graphic.destroy();
                continue;
            }
            graphic.alpha = alpha;
        }
    }

    /**
     * @param {BoostWorld} world
     */
    function ensurePulse(world) {
        const ticker = world.app?.ticker;
        if (!ticker || ticker.__creepBoostPulse) return;
        ticker.__creepBoostPulse = true;
        ticker.add(pulse);
    }

    /**
     * @param {BoostParent} parent
     * @param {BoostGraphic[]} bodySprites
     * @param {number} radius
     * @param {number} startAngle
     * @param {number} endAngle
     * @param {boolean} anticlockwise
     */
    function addBorder(parent, bodySprites, radius, startAngle, endAngle, anticlockwise) {
        const Ctor = Graphics();
        if (!Ctor) return;
        const graphic = new Ctor();
        graphic.lineStyle(BORDER_WIDTH, BORDER_COLOR, 1);
        graphic.arc(
            0,
            0,
            radius,
            ANGLE_SHIFT + startAngle,
            ANGLE_SHIFT + endAngle,
            anticlockwise,
        );
        parent.addChild(graphic);
        bodySprites.push(graphic);
        pulsing.add(graphic);
    }

    /**
     * @param {BoostDrawParams} params
     */
    function drawBoostBorders(params) {
        const scope = params.scope;
        const body = params.state?.body;
        if (!scope || !Array.isArray(scope.bodySprites) || !body) return;

        const parentId = params.payload?.parentId;
        const parent = parentId ? scope[parentId] : params.rootContainer;
        if (!parent || typeof /** @type {BoostParent} */ (parent).addChild !== "function") return;
        const container = /** @type {BoostParent} */ (parent);

        const parts = rendererBody(body);
        /** @type {Set<string>} */
        const boosted = new Set();
        let toughBoosted = false;
        for (const part of parts) {
            if (!part || livingHits(part) <= 0 || !part.boost || !part.type) continue;
            if (part.type === "tough") toughBoosted = true;
            else if (ARC_TYPES.has(part.type)) boosted.add(part.type);
        }
        if (!toughBoosted && boosted.size === 0) return;

        /** @type {Record<string, { type: string, hits: number }>} */
        const grouped = {};
        for (const part of parts) {
            const hits = livingHits(part);
            if (!part?.type || part.type === "tough" || part.type === "carry" || hits <= 0) continue;
            if (!ARC_TYPES.has(part.type)) continue;
            const existing = grouped[part.type];
            if (existing) existing.hits += hits;
            else grouped[part.type] = { type: part.type, hits };
        }
        const arcs = Object.values(grouped).sort((a, b) => {
            if (a.hits < b.hits) return -1;
            if (a.hits > b.hits) return 1;
            return 0;
        });

        let frontAngle = 0;
        let backAngle = Math.PI;
        for (const arc of arcs) {
            const backSide = arc.type === "move";
            const startAngle = backSide ? backAngle : frontAngle;
            const angle = PART_ANGLE * (arc.hits / MAX_PART_HITS);
            if (boosted.has(arc.type)) {
                addBorder(container, scope.bodySprites, BORDER_RADIUS, startAngle, startAngle + angle, false);
                addBorder(container, scope.bodySprites, BORDER_RADIUS, -startAngle, -(startAngle + angle), true);
            }
            if (backSide) backAngle += angle;
            else frontAngle += angle;
        }

        if (toughBoosted) {
            addBorder(container, scope.bodySprites, TOUGH_RADIUS, 0, Math.PI * 2, false);
        }
    }

    /**
     * @param {BoostWorld} world
     */
    function paintExisting(world) {
        const objects = world.gameObjects;
        if (!objects) return;
        for (const obj of Object.values(objects)) {
            if (!obj.scope?.bodySprites || !obj.state?.body) continue;
            drawBoostBorders({
                scope: obj.scope,
                state: obj.state,
                rootContainer: obj.rootContainer,
                payload: { parentId: "mainContainer" },
            });
        }
    }

    /**
     * @param {BoostWorld} world
     */
    function patchWorld(world) {
        ensurePulse(world);
        if (worldPatched) return;

        const proto = /** @type {BoostWorldProto} */ (Object.getPrototypeOf(world));
        if (!proto || typeof proto.runProcessor !== "function") return;

        const runProcessor = proto.runProcessor;
        proto.runProcessor = function runProcessorWithBoosts(meta, params) {
            const result = runProcessor.call(this, meta, params);
            const type = meta?.type || meta?.name;
            if (type === "creepBuildBody") drawBoostBorders(params);
            return result;
        };
        worldPatched = true;
        paintExisting(world);
    }

    /**
     * @returns {boolean} true once `GameRenderer` is hooked
     */
    function installRendererHook() {
        const GameRenderer = /** @type {BoostRendererCtor | undefined} */ (
        /** @type {any} */ (window).GameRenderer
        );
        const proto = GameRenderer?.prototype;
        if (!proto || typeof proto.applyState !== "function") return false;
        if (/** @type {{ __creepBoost?: boolean }} */ (proto.applyState).__creepBoost) return true;

        const applyState = proto.applyState;
        /**
         * @this {BoostRenderer}
         * @param {unknown} state
         * @param {number} [tickDuration]
         */
        function applyStateWithBoosts(state, tickDuration) {
            if (this.world) patchWorld(this.world);
            return applyState.call(this, state, tickDuration);
        }
        applyStateWithBoosts.__creepBoost = true;
        proto.applyState = applyStateWithBoosts;
        return true;
    }

    function watchRenderer() {
        if (installRendererHook() || rendererPoll) return;
        rendererPoll = setInterval(() => {
            if (installRendererHook()) {
                clearInterval(rendererPoll);
                rendererPoll = 0;
            }
        }, 200);
    }

    /**
     * @param {unknown} object
     * @returns {SelectedCreep | null}
     */
    function asCreep(object) {
        if (!object || typeof object !== "object") return null;
        const creep = /** @type {SelectedCreep} */ (object);
        if (creep.type !== "creep" || !creep.body) return null;
        return creep;
    }

    /**
     * @param {SelectedCreep | null} creep
     */
    function boostSignature(creep) {
        if (!creep?.body) return "";
        return inspectorBody(creep.body).map((part) => part?.boost || "").join("\n");
    }

    /**
     * @param {SelectedCreep | null} creep
     */
    function stampPips(creep) {
        if (!creep?.body) return;
        const parts = inspectorBody(creep.body);
        const pips = document.querySelectorAll("section.room aside .object-properties .body .bodypart");
        if (pips.length !== parts.length) return;
        pips.forEach((node, index) => {
            const pip = /** @type {HTMLElement} */ (node);
            const tier = boostTier(parts[index]?.boost);
            if (tier) pip.dataset.boostTier = String(tier);
            else delete pip.dataset.boostTier;
        });
    }

    /**
     * @returns {angular.IScope | null}
     */
    function roomScope() {
        const el = document.querySelector(".room.ng-scope");
        if (!el) return null;
        return angular.element(el).scope() ?? null;
    }

    /**
     * @param {angular.IScope} scope
     */
    function attachBoostWatch(scope) {
        if (watchedScopes.has(scope)) return;
        watchedScopes.add(scope);
        const roomScopeRef = /** @type {angular.IScope & { Room?: { selectedObject?: unknown } }} */ (scope);
        scope.$watch(
            () => boostSignature(asCreep(roomScopeRef.Room?.selectedObject)),
            () => {
                setTimeout(() => {
                    stampPips(asCreep(roomScopeRef.Room?.selectedObject));
                }, 0);
            },
        );
    }

    function bindBoostWatch() {
        if (boostWatchPoll) return;
        let tries = 0;
        boostWatchPoll = setInterval(() => {
            const scope = roomScope();
            tries += 1;
            if (scope || tries > 50) {
                clearInterval(boostWatchPoll);
                boostWatchPoll = 0;
                if (scope) attachBoostWatch(scope);
            }
        }, 100);
    }

    DomHelper.addStyle(PIP_STYLE);
    watchRenderer();
    ScreepsAdapter.ready(() => {
        bindBoostWatch();
        ScreepsAdapter.onViewChange((view) => {
            if (ROOM_VIEWS.includes(view)) bindBoostWatch();
        });
        ScreepsAdapter.onSelectionChange(({ object }) => {
            stampPips(asCreep(object));
        });
    });

})();
