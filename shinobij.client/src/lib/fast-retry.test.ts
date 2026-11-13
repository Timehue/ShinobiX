import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createFastRetry } from "./fast-retry";

test("walks the ladder, then hands back to the regular poll", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
        let runs = 0;
        const retry = createFastRetry(() => { runs++; }, [2_000, 5_000]);
        assert.equal(retry.failed(), true);
        mock.timers.tick(1_999);
        assert.equal(runs, 0);
        mock.timers.tick(1);
        assert.equal(runs, 1);
        assert.equal(retry.failed(), true);
        mock.timers.tick(5_000);
        assert.equal(runs, 2);
        assert.equal(retry.failed(), false, "ladder spent");
        mock.timers.tick(60_000);
        assert.equal(runs, 2);
    } finally { mock.timers.reset(); }
});

test("a success restarts the ladder and drops a pending retry", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
        let runs = 0;
        const retry = createFastRetry(() => { runs++; }, [2_000, 5_000]);
        retry.failed();
        retry.succeeded();
        assert.equal(retry.pending, false);
        mock.timers.tick(10_000);
        assert.equal(runs, 0);
        retry.failed();
        mock.timers.tick(2_000);
        assert.equal(runs, 1, "first rung again after a success");
    } finally { mock.timers.reset(); }
});

test("cancel stops a pending retry", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
        let runs = 0;
        const retry = createFastRetry(() => { runs++; });
        retry.failed();
        retry.cancel();
        mock.timers.tick(20_000);
        assert.equal(runs, 0);
    } finally { mock.timers.reset(); }
});
