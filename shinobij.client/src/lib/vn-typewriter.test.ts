import assert from "node:assert/strict";
import test from "node:test";
import { advanceVnTypewriter } from "./vn-typewriter";

test("a queued typewriter tick cannot hide text after tap-to-reveal completes the line", () => {
    const completed = { key: "scene:0:0", count: 42 };
    const afterStaleTick = advanceVnTypewriter(completed, "scene:0:0", 8, 42);

    assert.equal(afterStaleTick, completed);
    assert.equal(afterStaleTick.count, 42);
});

test("typewriter progress remains monotonic within a line and resets for a new line", () => {
    assert.deepEqual(
        advanceVnTypewriter({ key: "scene:0:0", count: 18 }, "scene:0:0", 12, 42),
        { key: "scene:0:0", count: 18 },
    );
    assert.deepEqual(
        advanceVnTypewriter({ key: "scene:0:0", count: 42 }, "scene:0:1", 2, 30),
        { key: "scene:0:1", count: 2 },
    );
});
