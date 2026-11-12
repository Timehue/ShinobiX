import assert from "node:assert/strict";
import test from "node:test";
import { isPlayerModel, starterModel } from "./player-model";

test("the persisted starter choice wins when the visible portrait is a shared URL", () => {
    assert.equal(starterModel("/api/img?id=avatar:rill", "starter-two"), "starter-two");
    assert.equal(starterModel("/api/img?id=avatar:rill", "starter-one"), "starter-one");
    assert.equal(starterModel("/starter-avatar-two.webp?v=2"), "starter-two");
    assert.equal(starterModel("/api/img?id=avatar:rill", "kuroto"), "starter-one");
});

test("only a pinned, server-issued sprite reference resolves to a player art folder", () => {
    const ref = { assetId: "ab".repeat(16), version: "cd".repeat(32) };
    assert.equal(isPlayerModel(ref), true);
    for (const invalid of [null, {}, { ...ref, version: 1 }, { ...ref, version: "" },
        { ...ref, assetId: "../patrol" }, { ...ref, assetId: "https://example.org/asset" },
        { ...ref, version: ref.version + "/foreign" }]) {
        assert.equal(isPlayerModel(invalid), false);
    }
});
