/*
 * rollEmissarySpawn — two spawn modes since the 2026-07 balance pass:
 *   • post-acceptance (category resolved): the trial-giver stands in ONE fixed
 *     sector for the 6h window (the Legacy panel hint points there, so the
 *     placement must be deterministic and caller-independent).
 *   • pre-acceptance (no category): a roaming harbinger that occasionally
 *     crosses the sector the player is actually in — gated per (player, slug,
 *     sector, window) so it is met organically but never omnipresent.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rollEmissarySpawn, emissaryForCategory, EMISSARY_DEFS, EMISSARY_MIN_LEVEL, EMISSARY_WANDERER_PREFIX } from "./legacy-emissaries";

const CATEGORY = EMISSARY_DEFS[0].categories[0];

/** A (player, bucket) pair whose window roll is active, so branch logic is testable. */
function activeWindow(): { name: string; bucket: number } {
    for (let bucket = 9000; bucket < 9400; bucket++) {
        if (rollEmissarySpawn("aki", 60, CATEGORY, bucket)) return { name: "aki", bucket };
    }
    throw new Error("no active emissary window found in the probe range");
}

describe("rollEmissarySpawn", () => {
    it("respects the level gate and empty names", () => {
        assert.equal(rollEmissarySpawn("", 60, CATEGORY, 9000), null);
        assert.equal(rollEmissarySpawn("aki", EMISSARY_MIN_LEVEL - 1, CATEGORY, 9000), null);
    });

    it("post-acceptance: fixed sector, deterministic, caller-independent", () => {
        const { name, bucket } = activeWindow();
        const a = rollEmissarySpawn(name, 60, CATEGORY, bucket);
        const b = rollEmissarySpawn(name, 60, CATEGORY, bucket, 7);      // currentSector must NOT matter
        const c = rollEmissarySpawn(name, 60, CATEGORY, bucket, 44);
        assert.ok(a && b && c);
        assert.equal(a.sector, b.sector);
        assert.equal(a.sector, c.sector);
        assert.ok(a.sector >= 1 && a.sector <= 59);
        assert.equal(a.def.slug, emissaryForCategory(CATEGORY)!.slug);
        assert.ok(a.wanderer.id.startsWith(EMISSARY_WANDERER_PREFIX));
    });

    it("is a WORLD roll: two players in the same sector/window see the same emissary", () => {
        const { bucket } = activeWindow();
        // Post-acceptance: the category emissary stands in the same sector for everyone.
        const a = rollEmissarySpawn("aki", 60, CATEGORY, bucket);
        const b = rollEmissarySpawn("someone-else", 77, CATEGORY, bucket);
        assert.ok(a && b);
        assert.equal(a.sector, b.sector);
        assert.deepEqual(a.wanderer, b.wanderer);
        // Pre-acceptance: the roaming harbinger's presence in a sector is keyed by
        // (slug, sector, window) — not by who is looking.
        for (let b2 = bucket; b2 < bucket + 40; b2++) {
            for (let sector = 1; sector <= 60; sector++) {
                assert.deepEqual(
                    rollEmissarySpawn("aki", 60, null, b2, sector),
                    rollEmissarySpawn("zed", 99, null, b2, sector),
                    `sector ${sector} / window ${b2}`,
                );
            }
        }
    });

    it("pre-acceptance: needs the current sector and only appears through the roam gate", () => {
        const { name, bucket } = activeWindow();
        // Without a current sector the roaming harbinger has nowhere to stand.
        assert.equal(rollEmissarySpawn(name, 60, null, bucket), null);

        let hits = 0;
        const windows = 40;
        for (let b = bucket; b < bucket + windows; b++) {
            for (let sector = 1; sector <= 60; sector++) {
                const spawn = rollEmissarySpawn(name, 60, null, b, sector);
                if (!spawn) continue;
                hits++;
                assert.equal(spawn.sector, sector, "roamer stands in the sector being viewed");
                // Deterministic: the same view rolls the same answer.
                assert.deepEqual(rollEmissarySpawn(name, 60, null, b, sector), spawn);
            }
        }
        // ~55% active windows × ~12% of sectors ≈ 6–7% of sector-views. Loose
        // deterministic bounds: present enough to be met, far from omnipresent.
        const rate = hits / (windows * 60);
        assert.ok(rate > 0.02, `roamer is actually encounterable (${rate.toFixed(3)})`);
        assert.ok(rate < 0.15, `roamer is not wallpaper (${rate.toFixed(3)})`);
    });
});
