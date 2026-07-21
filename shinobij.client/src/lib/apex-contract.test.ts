import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { builtinHuntMissions } from "../data/missions";
import { builtinAis } from "./combat-ai";
import {
    APEX_MIN_HUNTER_RANK,
    APEX_ROSTER,
    apexBeastForWeek,
    apexClaimedThisWeek,
    canTakeApex,
    isoWeekKey,
} from "./apex-contract";

describe("isoWeekKey", () => {
    it("matches known ISO-8601 week numbers", () => {
        // Mid-year sanity: 2026-07-21 is a Tuesday in ISO week 30.
        assert.equal(isoWeekKey(new Date(Date.UTC(2026, 6, 21))), "2026-W30");
        // 2026-01-01 is a Thursday → ISO week 1 of 2026.
        assert.equal(isoWeekKey(new Date(Date.UTC(2026, 0, 1))), "2026-W01");
    });

    it("rolls the ISO week-year at the new-year boundary", () => {
        // 29 Dec 2025 is a Monday whose Thursday (1 Jan 2026) lands in 2026,
        // so ISO calls it 2026-W01 — NOT 2025-W53. This is the exact case a
        // naive getUTCFullYear() implementation gets wrong.
        assert.equal(isoWeekKey(new Date(Date.UTC(2025, 11, 29))), "2026-W01");
        // And 28 Dec 2025 (Sunday) is still the last week of 2025.
        assert.equal(isoWeekKey(new Date(Date.UTC(2025, 11, 28))), "2025-W52");
    });

    it("is stable across a week and changes on Monday", () => {
        // Mon 2026-07-20 .. Sun 2026-07-26 must all be one key.
        const days = [20, 21, 22, 23, 24, 25, 26].map((d) => isoWeekKey(new Date(Date.UTC(2026, 6, d))));
        assert.equal(new Set(days).size, 1, `week not stable: ${days.join(",")}`);
        // The following Monday must differ.
        assert.notEqual(isoWeekKey(new Date(Date.UTC(2026, 6, 27))), days[0]);
    });
});

describe("apex rotation", () => {
    it("is deterministic for a given week", () => {
        assert.equal(apexBeastForWeek("2026-W30").apexAiId, apexBeastForWeek("2026-W30").apexAiId);
    });

    it("advances every week and cycles the whole roster", () => {
        const seen = APEX_ROSTER.map((_, i) => apexBeastForWeek(`2026-W${String(30 + i).padStart(2, "0")}`).apexAiId);
        assert.equal(new Set(seen).size, APEX_ROSTER.length, "roster did not fully cycle");
    });

    it("carries the rotation across a year boundary without repeating", () => {
        const a = apexBeastForWeek("2025-W52").apexAiId;
        const b = apexBeastForWeek("2026-W01").apexAiId;
        assert.notEqual(a, b, "consecutive weeks produced the same beast across the year roll");
    });
});

describe("apex roster integrity", () => {
    it("NEVER reuses a hunt contract's beast id", () => {
        // report-ai-fight matches a sealed opponentId to an accepted hunt via
        // huntMissionByAiProfileId. An Apex kill must not satisfy a contract.
        const huntAiIds = new Set(builtinHuntMissions.map((m) => m.aiProfileId));
        for (const apex of APEX_ROSTER) {
            assert.ok(huntAiIds.has(apex.baseAiId), `${apex.baseAiId} is not a real hunt beast`);
            assert.ok(!huntAiIds.has(apex.apexAiId), `${apex.apexAiId} collides with a hunt contract beast`);
            assert.notEqual(apex.apexAiId, apex.baseAiId);
        }
    });

    it("only rotates apex-tier bosses, never the low-level beasts", () => {
        // Every rostered base must be one of the four hand-tuned, hpFloorExempt
        // bosses — a level-5 Wild Boar Apex would be meaningless at Rank 5.
        for (const apex of APEX_ROSTER) {
            assert.ok(apex.level >= 85, `${apex.apexAiId} is only level ${apex.level}`);
        }
    });

    it("caps HP at the hardest normal hunt — the wall is lethality, not a bigger bar", () => {
        // With +165..+235 on every stat these beasts are already lethal. More HP
        // would only make the fight LONGER, which is the exact failure this
        // codebase keeps tuning back out (combat-ai.ts:409). 12,500 is the
        // Worldstorm base hunt's already-proven-fair pool.
        for (const apex of APEX_ROSTER) {
            assert.ok(apex.hp <= 12_500, `${apex.apexAiId} at ${apex.hp} exceeds the 12,500 ceiling — longer, not harder`);
            assert.ok(apex.hp >= 11_000, `${apex.apexAiId} at ${apex.hp} makes that week a pushover`);
        }
    });

    it("keeps every Apex week comparably hard", () => {
        // Guards the bug a flat per-beast multiplier introduced: the base spread
        // (8.5k-12.5k) made an Apex Ember Drake softer than a NORMAL Worldstorm
        // hunt, so how hard Apex felt depended on which beast rotated in.
        const hps = APEX_ROSTER.map((a) => a.hp);
        const spread = (Math.max(...hps) - Math.min(...hps)) / Math.max(...hps);
        assert.ok(spread <= 0.15, `HP spread ${(spread * 100).toFixed(1)}% — Apex difficulty swings by rotation`);
    });

    it("spends its difficulty budget on stats, not health", () => {
        for (const apex of APEX_ROSTER) {
            assert.ok(apex.statBonus >= 165, `${apex.apexAiId} statBonus ${apex.statBonus} is below apex tier`);
        }
    });

    it("has unique ids and names", () => {
        assert.equal(new Set(APEX_ROSTER.map((a) => a.apexAiId)).size, APEX_ROSTER.length);
        assert.equal(new Set(APEX_ROSTER.map((a) => a.name)).size, APEX_ROSTER.length);
    });
});

describe("apex builtin AI profiles", () => {
    // Runtime parity, not source-matching: this proves the AIs the Arena will
    // actually load carry the roster's tuning AFTER makeBuiltinAi has run.
    it("exists as a real builtin for every rostered beast", () => {
        for (const beast of APEX_ROSTER) {
            const ai = builtinAis.find((a) => a.id === beast.apexAiId);
            assert.ok(ai, `no builtin AI for ${beast.apexAiId} — the Arena could not resolve the fight`);
            assert.equal(ai.level, beast.level, `${beast.apexAiId} level`);
        }
    });

    it("keeps its authored HP — proving hpFloorExempt actually took effect", () => {
        // This is the real regression guard. Drop the flag and makeBuiltinAi
        // floors hp at aiHpForLevel(level), silently inflating these into the
        // ~11k-18k grind band; hp would then NOT equal the roster value.
        for (const beast of APEX_ROSTER) {
            const ai = builtinAis.find((a) => a.id === beast.apexAiId)!;
            assert.equal(ai.hp, beast.hp, `${beast.apexAiId} hp was re-inflated by the level curve`);
            assert.equal(ai.hpFloorExempt, true, `${beast.apexAiId} lost hpFloorExempt`);
        }
    });

    it("carries the stat bonus — the wall is lethality", () => {
        for (const beast of APEX_ROSTER) {
            const ai = builtinAis.find((a) => a.id === beast.apexAiId)!;
            const lowest = Math.min(...(Object.values(ai.stats) as number[]));
            assert.ok(lowest >= beast.statBonus, `${beast.apexAiId} lowest stat ${lowest} < bonus ${beast.statBonus}`);
        }
    });

    it("never collides with the base hunt beast's profile", () => {
        for (const beast of APEX_ROSTER) {
            const apexAi = builtinAis.find((a) => a.id === beast.apexAiId)!;
            const baseAi = builtinAis.find((a) => a.id === beast.baseAiId);
            assert.ok(baseAi, `base beast ${beast.baseAiId} vanished`);
            assert.notEqual(apexAi.id, baseAi.id);
            assert.ok(apexAi.level >= baseAi.level, `${beast.apexAiId} is not an escalation of its base`);
        }
    });
});

describe("apex gating", () => {
    it("requires max hunter rank AND the S-tier level floor", () => {
        assert.equal(canTakeApex({ hunterRank: APEX_MIN_HUNTER_RANK, level: 70 }), true);
        assert.equal(canTakeApex({ hunterRank: APEX_MIN_HUNTER_RANK - 1, level: 100 }), false);
        assert.equal(canTakeApex({ hunterRank: APEX_MIN_HUNTER_RANK, level: 69 }), false);
        assert.equal(canTakeApex(null), false);
        assert.equal(canTakeApex({}), false);
    });

    it("tracks the weekly claim by ISO week key", () => {
        assert.equal(apexClaimedThisWeek({ apexWeekClaimed: "2026-W30" }, "2026-W30"), true);
        assert.equal(apexClaimedThisWeek({ apexWeekClaimed: "2026-W29" }, "2026-W30"), false);
        assert.equal(apexClaimedThisWeek({}, "2026-W30"), false);
        assert.equal(apexClaimedThisWeek({ apexWeekClaimed: 30 as unknown as string }, "2026-W30"), false);
    });
});
