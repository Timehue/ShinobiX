import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import {
    ANTI_ALT_ACCOUNT_AGE_MS,
    PROFESSION_XP_BASELINE,
    PROFESSION_XP_HEALER,
    VANGUARD_DAILY_SEAL_CAP,
    VANGUARD_PER_TARGET_DAILY_CAP,
    VANGUARD_SEALS_PER_KILL,
} from "../constants/profession";
import {
    getProfessionRankForXp,
    petTamerClaimFirstExpeditionToday,
    petTamerExpeditionMult,
    petTamerPveMultiplier,
    petTamerTrainingSpeedPct,
    professionThresholds,
    vanguardSealsForKill,
    vanguardXpForKill,
} from "./profession-bonuses";

/*
 * Characterization tests for the profession bonus math drained out of App.tsx.
 *
 * These pin the CURRENT numbers, not preferred ones — they exist so the move
 * out of App is provably behaviour-preserving and so a later edit to these
 * multipliers is a deliberate, visible balance decision rather than a silent
 * drift. The logic had no direct coverage before the extraction: App.tsx
 * imports a .webp, so node:test could never load it.
 *
 * Every fixture omits `masterySpec`, so masteryBonus() contributes 0 and the
 * asserted values are the pure rank curves.
 */

const OLD_ACCOUNT = Date.now() - ANTI_ALT_ACCOUNT_AGE_MS - 1;

function character(over: Partial<Character>): Character {
    return { name: "tester", level: 40, createdAt: OLD_ACCOUNT, ...over } as unknown as Character;
}

describe("petTamerPveMultiplier", () => {
    it("is a no-op for a missing character or another profession", () => {
        assert.equal(petTamerPveMultiplier(null), 1);
        assert.equal(petTamerPveMultiplier(undefined), 1);
        assert.equal(petTamerPveMultiplier(character({ profession: "vanguard", professionRank: 10 })), 1);
    });

    it("pays +5% at unlock and +1.5% per rank, reaching +20% at rank 10", () => {
        const at = (professionRank: number) =>
            petTamerPveMultiplier(character({ profession: "petTamer", professionRank }));
        assert.equal(at(0), 1.05);
        assert.equal(at(1), 1.065);
        assert.equal(at(10), 1.2);
    });

    it("clamps rank into 0..10 rather than extrapolating", () => {
        const at = (professionRank: number) =>
            petTamerPveMultiplier(character({ profession: "petTamer", professionRank }));
        assert.equal(at(99), at(10));
        assert.equal(at(-5), at(0));
    });
});

describe("vanguardXpForKill", () => {
    it("pays 100 flat and +10 per opponent level above 30", () => {
        assert.equal(vanguardXpForKill(null), 0);
        assert.equal(vanguardXpForKill(character({ level: 30 })), 100);
        assert.equal(vanguardXpForKill(character({ level: 40 })), 200);
    });

    it("never pays less than the 100 floor for low-level opponents", () => {
        assert.equal(vanguardXpForKill(character({ level: 1 })), 100);
    });
});

describe("pet tamer training and expedition bonuses", () => {
    it("scales training speed 10% at unlock to 20% at rank 10", () => {
        assert.equal(petTamerTrainingSpeedPct(character({ profession: "healer" })), 0);
        assert.equal(petTamerTrainingSpeedPct(character({ profession: "petTamer", professionRank: 0 })), 10);
        assert.equal(petTamerTrainingSpeedPct(character({ profession: "petTamer", professionRank: 10 })), 20);
    });

    it("scales expedition rewards +10% at unlock to +25% at rank 10", () => {
        assert.equal(petTamerExpeditionMult(character({ profession: "healer" })), 1);
        assert.equal(petTamerExpeditionMult(character({ profession: "petTamer", professionRank: 0 })), 1.1);
        assert.equal(petTamerExpeditionMult(character({ profession: "petTamer", professionRank: 10 })), 1.25);
    });
});

describe("petTamerClaimFirstExpeditionToday", () => {
    it("flags only the first claim of a UTC day and counts every claim", () => {
        const tamer = character({ profession: "petTamer" });
        const first = petTamerClaimFirstExpeditionToday(tamer, "2026-09-01");
        assert.equal(first.isFirst, true);
        assert.equal(first.nextCharacter.expeditionsClaimedToday, 1);
        assert.equal(first.nextCharacter.lastExpeditionClaimDate, "2026-09-01");

        const second = petTamerClaimFirstExpeditionToday(first.nextCharacter, "2026-09-01");
        assert.equal(second.isFirst, false);
        assert.equal(second.nextCharacter.expeditionsClaimedToday, 2);
    });

    it("resets the count when the day rolls over", () => {
        const carried = character({
            profession: "petTamer",
            lastExpeditionClaimDate: "2026-08-31",
            expeditionsClaimedToday: 7,
        } as Partial<Character>);
        const next = petTamerClaimFirstExpeditionToday(carried, "2026-09-01");
        assert.equal(next.isFirst, true);
        assert.equal(next.nextCharacter.expeditionsClaimedToday, 1);
    });

    it("still counts claims for a non-tamer but never flags them first", () => {
        const other = petTamerClaimFirstExpeditionToday(character({ profession: "healer" }), "2026-09-01");
        assert.equal(other.isFirst, false);
        assert.equal(other.nextCharacter.expeditionsClaimedToday, 1);
    });
});

describe("vanguardSealsForKill", () => {
    const killer = (over: Partial<Character> = {}) =>
        character({ profession: "vanguard", level: 40, professionRank: 10, ...over });
    const victim = (over: Partial<Character> = {}) =>
        character({ name: "Victim", level: 40, ...over });

    it("pays nothing to a non-vanguard", () => {
        const out = vanguardSealsForKill(character({ profession: "petTamer" }), victim(), "d");
        assert.equal(out.amount, 0);
    });

    it("pays the rank seal value when it sits under the per-target cap", () => {
        // Rank 2 is worth 1 seal, well below the per-target cap, so the rank
        // value is what actually lands.
        const out = vanguardSealsForKill(killer({ professionRank: 2 }), victim(), "d");
        assert.equal(VANGUARD_SEALS_PER_KILL[2], 1);
        assert.equal(out.amount, 1);
        assert.equal(out.updatedByTarget.victim, 1);
    });

    it("clamps a top-rank kill to the per-target cap rather than the rank value", () => {
        // Worth recording: at rank 10 the per-target cap (3) binds BEFORE the
        // rank value (5), so no single target can ever pay a full rank-10 kill.
        assert.equal(VANGUARD_SEALS_PER_KILL[10], 5);
        const out = vanguardSealsForKill(killer(), victim(), "d");
        assert.equal(out.amount, VANGUARD_PER_TARGET_DAILY_CAP);
        assert.equal(out.updatedByTarget.victim, VANGUARD_PER_TARGET_DAILY_CAP);
    });

    it("refuses rewards for a brand-new account (anti-alt)", () => {
        const fresh = victim({ createdAt: Date.now() });
        assert.equal(vanguardSealsForKill(killer(), fresh, "d").amount, 0);
    });

    it("halves rewards 10-20 levels below and zeroes them beyond 20", () => {
        assert.equal(
            vanguardSealsForKill(killer({ level: 55 }), victim({ level: 40 }), "d").amount,
            Math.floor(VANGUARD_SEALS_PER_KILL[10] * 0.5),
        );
        assert.equal(vanguardSealsForKill(killer({ level: 70 }), victim({ level: 40 }), "d").amount, 0);
    });

    it("honours the per-target daily cap", () => {
        const capped = killer({
            vanguardDailyResetDate: "d",
            dailyHonorSealsByTarget: { victim: VANGUARD_PER_TARGET_DAILY_CAP },
        } as Partial<Character>);
        assert.equal(vanguardSealsForKill(capped, victim(), "d").amount, 0);
    });

    it("honours the account-wide daily cap", () => {
        const capped = killer({
            vanguardDailyResetDate: "d",
            dailyHonorSealsEarned: VANGUARD_DAILY_SEAL_CAP,
        } as Partial<Character>);
        assert.equal(vanguardSealsForKill(capped, victim(), "d").amount, 0);
    });

    it("ignores yesterday's totals once the reset date moves on", () => {
        const stale = killer({
            vanguardDailyResetDate: "yesterday",
            dailyHonorSealsEarned: VANGUARD_DAILY_SEAL_CAP,
            dailyHonorSealsByTarget: { victim: VANGUARD_PER_TARGET_DAILY_CAP },
        } as Partial<Character>);
        assert.equal(vanguardSealsForKill(stale, victim(), "today").amount, VANGUARD_PER_TARGET_DAILY_CAP);
    });
});

describe("profession XP curve", () => {
    it("gives healers the 1.5x thresholds and everyone else the baseline", () => {
        assert.deepEqual(professionThresholds("healer"), PROFESSION_XP_HEALER);
        assert.deepEqual(professionThresholds("vanguard"), PROFESSION_XP_BASELINE);
        assert.deepEqual(professionThresholds("petTamer"), PROFESSION_XP_BASELINE);
    });

    it("maps xp onto rank at the threshold boundaries", () => {
        assert.equal(getProfessionRankForXp("vanguard", 0), 1);
        assert.equal(getProfessionRankForXp("vanguard", 99), 1);
        assert.equal(getProfessionRankForXp("vanguard", PROFESSION_XP_BASELINE[1]), 2);
        assert.equal(getProfessionRankForXp("vanguard", PROFESSION_XP_BASELINE[9]), 10);
    });

    it("never exceeds the max rank however much xp is banked", () => {
        assert.equal(getProfessionRankForXp("vanguard", Number.MAX_SAFE_INTEGER), 10);
        assert.equal(getProfessionRankForXp("healer", Number.MAX_SAFE_INTEGER), 10);
    });

    it("keeps a healer behind a baseline profession at the same xp", () => {
        const xp = PROFESSION_XP_BASELINE[3];
        assert.ok(getProfessionRankForXp("healer", xp) <= getProfessionRankForXp("vanguard", xp));
    });
});
