/**
 * A short retry ladder for a request whose regular poll is long.
 *
 * `failed()` schedules `run` after the next delay in the ladder and returns
 * true, or returns false once the ladder is spent (the caller's regular poll
 * takes over). `succeeded()` and `cancel()` stop any pending retry and start
 * the ladder again from the first delay.
 */
export function createFastRetry(run: () => void, delays: readonly number[] = [2_000, 5_000, 15_000]) {
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    return {
        failed(): boolean {
            stop();
            const delay = delays[failures];
            if (delay === undefined) return false;
            failures++;
            timer = setTimeout(() => { timer = undefined; run(); }, delay);
            return true;
        },
        succeeded() { stop(); failures = 0; },
        cancel() { stop(); failures = 0; },
        get pending() { return timer !== undefined; },
    };
}
