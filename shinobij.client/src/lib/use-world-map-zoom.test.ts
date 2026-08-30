import assert from "node:assert/strict";
import test from "node:test";
import { isWorldMapControlTarget } from "./use-world-map-zoom";

test("world-map controls retain their pointer so taps can activate them", () => {
    let selectorSeen = "";
    const nestedButtonChild = {
        closest(selector: string) {
            selectorSeen = selector;
            return { tagName: "BUTTON" };
        },
    };

    assert.equal(isWorldMapControlTarget(nestedButtonChild as unknown as EventTarget), true);
    assert.match(selectorSeen, /button/);
    assert.match(selectorSeen, /\[role='button'\]/);
});

test("world-map background remains a pan gesture target", () => {
    const background = { closest: () => null };
    assert.equal(isWorldMapControlTarget(background as unknown as EventTarget), false);
    assert.equal(isWorldMapControlTarget(null), false);
});
