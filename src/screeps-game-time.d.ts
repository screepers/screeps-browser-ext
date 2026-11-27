declare namespace GameTime {
    interface GameTimeAdapter {
        VERSION: string;

        /** How often to sample `game/time` for the shard's tick rate. */
        POLL_MS: number;

        /**
         * Record a game tick.
         * The first map `gameTime` is often stale, so it only joins the rate window after a live sample exists.
         * @returns True when the stored tick advanced.
         */
        note(shard: string, time: number | undefined, fresh?: boolean): boolean;

        /** Latest known game tick for `shard`. */
        tick(shard: string): number | undefined;

        /**
         * Wall-clock time for an absolute tick, or null until the shard's rate is known.
         * Anchored to the newest sample so a stale remaining count does not drift the clock.
         */
        wallTime(shard: string, tick: number): number | null;

        formatCountdown(ms: number): string;

        /** Clock time when the instant is more than a day out, otherwise a countdown. */
        formatRemainingTime(at: number): string;

        /**
         * Fetch `game/time` for `shard` and record it as a fresh sample.
         * @returns True when the stored tick advanced.
         */
        refresh(shard: string): Promise<boolean>;
    }
}
