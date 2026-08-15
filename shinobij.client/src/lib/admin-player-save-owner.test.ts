import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    adminPlayerSaveUrl,
    canonicalAdminPlayerKey,
    createAdminPlayerMutationToken,
    isAdminPlayerLookupCurrent,
    isAdminPlayerMutationCurrent,
    prepareAdminPlayerSaveWrite,
    tagLoadedAdminPlayerSave,
} from "./admin-player-save-owner";

describe("admin player save owner identity", () => {
    it("uses the same canonical player-key rule as the server", () => {
        assert.equal(canonicalAdminPlayerKey(" Player.A_One-2 "), "playera_one-2");
        assert.equal(canonicalAdminPlayerKey("A".repeat(40)), "a".repeat(32));
        assert.equal(canonicalAdminPlayerKey(null), "");
    });

    it("derives a write route only from the tagged loaded owner", () => {
        const loaded = tagLoadedAdminPlayerSave("Player A", {
            _saveVersion: 7,
            character: { name: "Player A", ryo: 10 },
        });
        const checked = prepareAdminPlayerSaveWrite(loaded, "PLAYER A");

        assert.equal(checked.ok, true);
        if (!checked.ok) return;
        assert.equal(checked.write.ownerKey, "playera");
        assert.equal(adminPlayerSaveUrl(checked.write.ownerKey, true), "/api/save/playera?signal=1");
    });

    it("rejects an A snapshot after the mutable target changes to B", () => {
        const loadedA = tagLoadedAdminPlayerSave("Player A", {
            _saveVersion: 4,
            character: { name: "Player A" },
        });

        assert.deepEqual(
            prepareAdminPlayerSaveWrite(loadedA, "Player B"),
            { ok: false, reason: "target-changed" },
        );
    });

    it("rejects a payload whose character owner differs from the tagged owner", () => {
        const loadedA = tagLoadedAdminPlayerSave("Player A", {
            _saveVersion: 4,
            character: { name: "Player A" },
        });

        assert.deepEqual(
            prepareAdminPlayerSaveWrite(loadedA, "Player A", {
                _saveVersion: 4,
                character: { name: "Player B" },
            }),
            { ok: false, reason: "payload-owner-mismatch" },
        );
        assert.deepEqual(
            prepareAdminPlayerSaveWrite(loadedA, "Player A", { _saveVersion: 4 }),
            { ok: false, reason: "payload-owner-mismatch" },
        );
        for (const character of [null, "Player A", [{ name: "Player A" }], { name: "" }, new Date()]) {
            assert.deepEqual(
                prepareAdminPlayerSaveWrite(loadedA, "Player A", { _saveVersion: 4, character }),
                { ok: false, reason: "payload-owner-mismatch" },
            );
        }
    });

    it("does not install a loaded snapshot with a missing, malformed, or foreign owner", () => {
        for (const snapshot of [
            null,
            "Player A",
            [{ character: { name: "Player A" } }],
            {},
            { character: null },
            { character: "Player A" },
            { character: [{ name: "Player A" }] },
            { character: {} },
            { character: { name: "" } },
            { character: { name: "Player B" } },
        ]) {
            assert.equal(tagLoadedAdminPlayerSave("Player A", snapshot), null);
        }
    });

    it("captures a canonical mutation owner and makes stale completions no-ops", () => {
        const mutation = createAdminPlayerMutationToken(8, " Player.A ");
        assert.deepEqual(mutation, { ownerKey: "playera", epoch: 9 });
        assert.ok(mutation);
        assert.equal(isAdminPlayerMutationCurrent(mutation, 9), true);
        assert.equal(isAdminPlayerMutationCurrent(mutation, 10), false);
        assert.equal(createAdminPlayerMutationToken(9, "..."), null);
    });

    it("fences delayed lookups by both request epoch and current target", () => {
        assert.equal(isAdminPlayerLookupCurrent(3, 3, "playerb", "Player B"), true);
        assert.equal(isAdminPlayerLookupCurrent(2, 3, "playera", "Player A"), false);
        assert.equal(isAdminPlayerLookupCurrent(3, 3, "playera", "Player B"), false);
    });
});
