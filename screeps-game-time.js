(() => {
    "use strict";

    const VERSION = "0.1.0";

    if (!window.ScreepsAdapter) {
        throw new Error("screeps-game-time.js requires screeps-browser-core.js to be loaded first");
    }

    if (window.ScreepsAdapter.GameTime?.VERSION) {
        return;
    }

    /** Samples older than this fall out of the rate window. */
    const RATE_WINDOW_MS = 2 * 60 * 1000;
    /** Need a real gap and at least two ticks before trusting a wall-clock estimate. */
    const MIN_RATE_SPAN_MS = 4000;
    const MIN_RATE_TICKS = 2;
    const DAY_MS = 24 * 60 * 60 * 1000;

    /** @type {GameTime.GameTimeAdapter} */
    const GameTime = {};

    GameTime.VERSION = VERSION;
    /** How often to sample `game/time` for the shard's tick rate. */
    GameTime.POLL_MS = 5000;

    /** @type {Record<string, number>} */
    const timeByShard = {};

    /**
     * Fresh `(tick, wall-clock)` pairs per shard, used to estimate ticks per millisecond.
     * @type {Record<string, { tick: number, at: number }[]>}
     */
    const timeSamples = {};

    /** @type {Record<string, Promise<boolean> | undefined>} */
    const inflight = {};

    let timeErrorLogged = false;

    /**
     * @param {string} shard
     * @param {number} tick
     */
    function pushTimeSample(shard, tick) {
        const now = Date.now();
        const samples = timeSamples[shard] ??= [];
        const last = samples[samples.length - 1];
        if (last && tick < last.tick) {
            samples.length = 0;
        }
        const current = samples[samples.length - 1];
        if (current && current.tick === tick) {
            current.at = now;
        } else {
            samples.push({ tick, at: now });
        }
        const cutoff = now - RATE_WINDOW_MS;
        while (samples.length > 2 && samples[0].at < cutoff) {
            samples.shift();
        }
    }

    /**
     * @param {string} shard
     * @param {number | undefined} time
     * @param {boolean} [fresh] True for a response just received. The first map `gameTime` is often stale, so it only joins the rate window after a live sample exists.
     * @returns {boolean}
     */
    GameTime.note = function (shard, time, fresh = false) {
        if (!shard || typeof time !== "number" || !Number.isFinite(time) || time <= 0) {
            return false;
        }
        const prev = timeByShard[shard] ?? 0;
        if (time < prev) {
            return false;
        }
        const watched = (timeSamples[shard]?.length ?? 0) > 0;
        if (fresh || (time > prev && watched)) {
            pushTimeSample(shard, time);
        }
        if (time > prev) {
            timeByShard[shard] = time;
            return true;
        }
        return false;
    };

    /**
     * @param {string} shard
     * @returns {number | undefined}
     */
    GameTime.tick = function (shard) {
        return timeByShard[shard];
    };

    /**
     * Wall-clock time for an absolute tick, or null until the shard's rate is known.
     * Anchored to the newest sample so a stale remaining count does not drift the clock.
     * @param {string} shard
     * @param {number} tick
     * @returns {number | null}
     */
    GameTime.wallTime = function (shard, tick) {
        const samples = timeSamples[shard];
        if (!samples || samples.length < 2) {
            return null;
        }
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dt = last.at - first.at;
        const ticks = last.tick - first.tick;
        if (dt < MIN_RATE_SPAN_MS || ticks < MIN_RATE_TICKS) {
            return null;
        }
        const remaining = tick - last.tick;
        if (remaining <= 0) {
            return null;
        }
        return last.at + remaining * (dt / ticks);
    };

    /**
     * @param {number} ms
     */
    GameTime.formatCountdown = function (ms) {
        const total = Math.max(0, Math.ceil(ms / 1000));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        const ss = String(seconds).padStart(2, "0");
        const mm = String(minutes).padStart(2, "0");
        if (hours > 0) {
            return `${hours}h ${mm}m ${ss}s`;
        }
        if (minutes > 0) {
            return `${minutes}m ${ss}s`;
        }
        return `${seconds}s`;
    };

    /**
     * Clock time when the instant is more than a day out, otherwise a countdown.
     * @param {number} at
     */
    GameTime.formatRemainingTime = function (at) {
        const remainingMs = at - Date.now();
        if (remainingMs > DAY_MS) {
            return new Date(at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
            });
        }
        return GameTime.formatCountdown(remainingMs);
    };

    /**
     * @param {string} shard
     * @returns {Promise<boolean>}
     */
    async function fetchTime(shard) {
        try {
            const data = await ScreepsAdapter.Api.get("game/time", { shard });
            if (data?.ok && typeof data.time === "number") {
                return GameTime.note(shard, data.time, true);
            }
        } catch (err) {
            if (!timeErrorLogged) {
                timeErrorLogged = true;
                console.warn("game time: failed to load", err);
            }
        }
        return false;
    }

    /**
     * @param {string} shard
     * @returns {Promise<boolean>}
     */
    GameTime.refresh = function (shard) {
        const pending = inflight[shard];
        if (pending) {
            return pending;
        }
        const request = fetchTime(shard).finally(() => {
            delete inflight[shard];
        });
        inflight[shard] = request;
        return request;
    };

    ScreepsAdapter.GameTime = GameTime;
})();
