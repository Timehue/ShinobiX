/*
 * Depth + contract guard for the pre-50 Legacy rumor arcs.
 *
 * Locks the AAA-depth properties: every legacy category has a complete 5-beat
 * arc with >=2 in-voice variants per beat, the shown line is deterministic per
 * (player, category, milestone, tier) but VARIES across players (no shared/
 * replayed sequence), and there is never a dead "no rumor" beat.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    RUMOR_MILESTONE_LEVELS, RUMOR_CATEGORIES, rumorArc, rumorForCategory,
    tavernGossipLine, TAVERN_GOSSIP_COUNT,
} from "./legacy-rumors";

// Must match the legacy categories in api/_legacy-defs.ts (LegacyCategory).
const EXPECTED_CATEGORIES = [
    "ninjutsu", "genjutsu", "taijutsu", "bukijutsu",
    "pvp", "pve", "village", "support", "explorer",
    "pets", "cards", "war", "mythic",
];

describe("rumor arcs — coverage + depth", () => {
    it("every legacy category has an authored arc (no gaps)", () => {
        for (const c of EXPECTED_CATEGORIES) {
            assert.ok(RUMOR_CATEGORIES.includes(c), `missing rumor arc for category "${c}"`);
        }
        assert.equal(RUMOR_CATEGORIES.length, EXPECTED_CATEGORIES.length, "unexpected extra/missing rumor category");
    });

    it("each arc has one slot per milestone, >=2 distinct token-free variants", () => {
        for (const c of EXPECTED_CATEGORIES) {
            const arc = rumorArc(c);
            assert.ok(arc, `no arc for ${c}`);
            assert.equal(arc!.length, RUMOR_MILESTONE_LEVELS.length, `${c}: arc must have ${RUMOR_MILESTONE_LEVELS.length} beats`);
            for (let i = 0; i < arc!.length; i++) {
                const variants = arc![i];
                assert.ok(variants.length >= 2, `${c} beat ${i}: needs >=2 variants (got ${variants.length})`);
                assert.equal(new Set(variants).size, variants.length, `${c} beat ${i}: duplicate variant`);
                for (const line of variants) {
                    assert.ok(line.length > 20, `${c} beat ${i}: variant too short`);
                    assert.ok(!/%user|%target/.test(line), `${c} beat ${i}: rumors are token-free`);
                }
            }
        }
    });
});

describe("rumorForCategory — determinism + variety", () => {
    it("returns a real line for every category x milestone", () => {
        for (const c of EXPECTED_CATEGORIES) {
            for (const m of RUMOR_MILESTONE_LEVELS) {
                const line = rumorForCategory(c, m, { playerName: "Aoi" });
                assert.ok(typeof line === "string" && line.length > 20, `${c}@${m}: empty rumor`);
            }
        }
    });

    it("is deterministic for the same (player, category, milestone, tier)", () => {
        const a = rumorForCategory("ninjutsu", 30, { playerName: "Kaze", tier: "strong" });
        const b = rumorForCategory("ninjutsu", 30, { playerName: "Kaze", tier: "strong" });
        assert.equal(a, b, "same inputs must yield the same line (stable on revisit)");
    });

    it("varies across players — no two players are guaranteed the same sequence", () => {
        // Over the full arc, at least one beat must differ between two players,
        // for at least one category. (Proves the per-player pick is live.)
        let anyDiff = false;
        for (const c of EXPECTED_CATEGORIES) {
            for (const m of RUMOR_MILESTONE_LEVELS) {
                const p1 = rumorForCategory(c, m, { playerName: "Player-One" });
                const p2 = rumorForCategory(c, m, { playerName: "Player-Two" });
                if (p1 !== p2) { anyDiff = true; break; }
            }
            if (anyDiff) break;
        }
        assert.ok(anyDiff, "two different players should diverge somewhere in the arc");
    });

    it("never yields a dead beat for an unknown/empty category (fallback)", () => {
        for (const m of RUMOR_MILESTONE_LEVELS) {
            const line = rumorForCategory(undefined, m, { playerName: "x" });
            assert.ok(typeof line === "string" && line.length > 20, `fallback@${m}: empty`);
            const line2 = rumorForCategory("not-a-category", m, { playerName: "x" });
            assert.ok(typeof line2 === "string" && line2.length > 20, `unknown@${m}: empty`);
        }
    });
});

describe("tavern gossip", () => {
    it("has a real pool and returns a non-empty line", () => {
        assert.ok(TAVERN_GOSSIP_COUNT >= 10, `gossip pool should be substantial (got ${TAVERN_GOSSIP_COUNT})`);
        assert.ok(tavernGossipLine("Aoi", 20000).length > 20);
    });
    it("is stable per (player, day) but rotates across days", () => {
        assert.equal(tavernGossipLine("Aoi", 20000), tavernGossipLine("Aoi", 20000), "same day/player is stable");
        const days = new Set(Array.from({ length: 30 }, (_, i) => tavernGossipLine("Aoi", 20000 + i)));
        assert.ok(days.size >= 4, `30 days should surface several distinct lines (got ${days.size})`);
    });
});
