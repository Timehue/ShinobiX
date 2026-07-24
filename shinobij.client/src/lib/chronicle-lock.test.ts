import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { cardGameLockStatus, SCRIBE_MIN_LEVEL } from "./chronicle-lock";

describe("cardGameLockStatus", () => {
    it("below the scribe band: locked, message points at the level", () => {
        const s = cardGameLockStatus({ level: SCRIBE_MIN_LEVEL - 1 });
        assert.equal(s.locked, true);
        assert.match(s.body, new RegExp(`level ${SCRIBE_MIN_LEVEL}`), "tells the player when the scribes start looking");
    });

    it("in the band but unclaimed: locked, message points at Ihara on the world map", () => {
        const s = cardGameLockStatus({ level: SCRIBE_MIN_LEVEL });
        assert.equal(s.locked, true);
        assert.match(s.body, /Ihara/, "names the scribe so the player knows who to find");
        assert.match(s.body, /world map/i, "says where to look");
    });

    it("unlocked once the codex is claimed, at any level", () => {
        assert.equal(cardGameLockStatus({ level: 90, starterCardsClaimed: true }).locked, false);
        assert.equal(cardGameLockStatus({ level: SCRIBE_MIN_LEVEL, starterCardsClaimed: true }).locked, false);
    });
});
