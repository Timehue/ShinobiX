import assert from "node:assert/strict";
import test from "node:test";
import { shouldPreemptGameSfxChannel } from "./game-audio";

test("exclusive combat audio keeps stronger punctuation and lets priority replace it", () => {
    assert.equal(shouldPreemptGameSfxChannel(30, 60), false, "tell cannot cut off a contact");
    assert.equal(shouldPreemptGameSfxChannel(60, 60), true, "new equal-priority contact stays timely");
    assert.equal(shouldPreemptGameSfxChannel(80, 70), true, "ultimate replaces a critical hit");
    assert.equal(shouldPreemptGameSfxChannel(100, 80), true, "KO always replaces an ultimate");
});
