import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    adminPlayerSaveUrl,
    canonicalAdminPlayerKey,
    isAdminPlayerLookupCurrent,
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

    it("fences delayed lookups by both request epoch and current target", () => {
        assert.equal(isAdminPlayerLookupCurrent(3, 3, "playerb", "Player B"), true);
        assert.equal(isAdminPlayerLookupCurrent(2, 3, "playera", "Player A"), false);
        assert.equal(isAdminPlayerLookupCurrent(3, 3, "playera", "Player B"), false);
    });
});
