import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { startBootGateWatchdog } from "./boot-gate-watchdog";

describe("boot gate watchdog", () => {
    it("falls through when no restore is running by the first tick", (t) => {
        mock.timers.enable({ apis: ["setInterval"] });
        t.after(() => mock.timers.reset());
        const fallThrough = mock.fn();
        const stop = startBootGateWatchdog({
            restoreStarted: { current: false },
            fallThrough,
            intervalMs: 20_000,
        });
        mock.timers.tick(19_999);
        assert.equal(fallThrough.mock.callCount(), 0, "must not fire before the interval");
        mock.timers.tick(1);
        assert.equal(fallThrough.mock.callCount(), 1, "an idle gate must fall through on the tick");
        stop();
    });

    it("stays quiet while a restore owns the gate, and catches a later orphan", (t) => {
        // The mid-restore orphan: a capability lease expiry retires the
        // in-flight restore and resets the started ref — the NEXT tick must
        // still catch it, which is why this is an interval and not a one-shot.
        mock.timers.enable({ apis: ["setInterval"] });
        t.after(() => mock.timers.reset());
        const restoreStarted = { current: true };
        const fallThrough = mock.fn();
        const stop = startBootGateWatchdog({ restoreStarted, fallThrough, intervalMs: 20_000 });
        mock.timers.tick(20_000);
        assert.equal(fallThrough.mock.callCount(), 0, "a running restore owns its own 12s backstop");
        restoreStarted.current = false;
        mock.timers.tick(20_000);
        assert.equal(fallThrough.mock.callCount(), 1, "an orphaned gate must be caught by a later tick");
        stop();
    });

    it("stops firing once disposed", (t) => {
        mock.timers.enable({ apis: ["setInterval"] });
        t.after(() => mock.timers.reset());
        const fallThrough = mock.fn();
        const stop = startBootGateWatchdog({
            restoreStarted: { current: false },
            fallThrough,
            intervalMs: 20_000,
        });
        stop();
        mock.timers.tick(60_000);
        assert.equal(fallThrough.mock.callCount(), 0, "a cleaned-up watchdog must never fire");
    });
});
