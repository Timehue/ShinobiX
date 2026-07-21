import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { CreatorAi } from "../types/creator-ai";
import {
    HUNT_CORNERED_HP_MULT,
    HUNT_ENRAGED_STAT_BONUS,
    HUNT_PACK_STAGES,
    HUNT_QUALITY_MAX,
    HUNT_QUALITY_MIN,
    applyHuntOpening,
    clampHuntQuality,
    huntOpeningFor,
    huntPackMember,
    huntQualityTier,
    huntSignFor,
    rollHuntAmbush,
} from "./hunt-encounter";

const mission = { id: "hunt-frost-wolf" };

const beast: CreatorAi = {
    id: "hunt-ai-frost-wolf",
    name: "Frost Wolf",
    icon: "🐺",
    level: 40,
    village: "Wilds",
    hp: 5000,
    chakra: 100,
    stamina: 100,
    stats: { ninjutsu: 50, taijutsu: 50, bukijutsu: 50, genjutsu: 50, strength: 50, speed: 50, intelligence: 50, willpower: 50 } as CreatorAi["stats"],
    jutsuIds: [],
    rules: [],
};

describe("hunt quality", () => {
    it("clamps to the documented range", () => {
        assert.equal(clampHuntQuality(99), HUNT_QUALITY_MAX);
        assert.equal(clampHuntQuality(-99), HUNT_QUALITY_MIN);
        assert.equal(clampHuntQuality(1), 1);
        assert.equal(clampHuntQuality(Number.NaN), 0);
    });

    it("maps to tiers at the documented thresholds", () => {
        assert.equal(huntQualityTier(3), "cornered");
        assert.equal(huntQualityTier(2), "cornered");
        assert.equal(huntQualityTier(1), "even");
        assert.equal(huntQualityTier(0), "even");
        assert.equal(huntQualityTier(-1), "even");
        assert.equal(huntQualityTier(-2), "enraged");
        assert.equal(huntQualityTier(-3), "enraged");
    });

    it("surfaces a player-readable effect line per tier", () => {
        for (const q of [2, 0, -2]) {
            const opening = huntOpeningFor(q, "Frost Wolf");
            assert.ok(opening.kicker.length > 0);
            assert.ok(opening.prose.includes("Frost Wolf"));
            assert.ok(opening.effect.length > 0);
        }
    });
});

describe("hunt opening applied to the beast", () => {
    it("NEVER changes the ai id — the server keys the kill receipt on it", () => {
        for (const q of [3, 2, 1, 0, -1, -2, -3]) {
            assert.equal(applyHuntOpening(beast, q).id, beast.id, `id drifted at quality ${q}`);
        }
    });

    it("cornered weakens HP and sets hpFloorExempt so the floor can't undo it", () => {
        const cornered = applyHuntOpening(beast, 2);
        assert.equal(cornered.hp, Math.floor(5000 * HUNT_CORNERED_HP_MULT));
        assert.ok(cornered.hp < beast.hp);
        // Without this flag makeBuiltinAi/normalizeAiProfile raise sub-curve hp back up.
        assert.equal(cornered.hpFloorExempt, true);
        // Stats untouched — cornered is a shorter fight, not a weaker beast.
        assert.deepEqual(cornered.stats, beast.stats);
    });

    it("enraged raises every stat and leaves HP alone", () => {
        const enraged = applyHuntOpening(beast, -2);
        assert.equal(enraged.hp, beast.hp, "enraged must not become an HP sponge");
        for (const key of Object.keys(beast.stats) as (keyof typeof beast.stats)[]) {
            assert.equal(enraged.stats[key], (beast.stats[key] as number) + HUNT_ENRAGED_STAT_BONUS, `stat ${String(key)}`);
        }
    });

    it("even returns the beast untouched", () => {
        const even = applyHuntOpening(beast, 0);
        assert.equal(even.hp, beast.hp);
        assert.deepEqual(even.stats, beast.stats);
        assert.equal(even.hpFloorExempt, undefined);
    });

    it("does not mutate the shared catalog profile", () => {
        const hpBefore = beast.hp;
        const statsBefore = { ...beast.stats };
        applyHuntOpening(beast, 2);
        applyHuntOpening(beast, -2);
        assert.equal(beast.hp, hpBefore);
        assert.deepEqual(beast.stats, statsBefore);
    });
});

describe("hunt signs", () => {
    it("is stable for a (mission, stage, hunter) triple", () => {
        const a = huntSignFor(mission, 1, "Rin");
        const b = huntSignFor(mission, 1, "Rin");
        assert.equal(a.id, b.id);
    });

    it("varies across stages so a hunt isn't the same prompt repeated", () => {
        const ids = new Set([0, 1, 2, 3, 4, 5].map((s) => huntSignFor(mission, s, "Rin").id));
        assert.ok(ids.size > 1, "every stage produced the same sign");
    });

    it("every sign offers at least two choices, each with a coherent outcome", () => {
        for (const stage of [0, 1, 2, 3, 4, 5]) {
            const sign = huntSignFor(mission, stage, "Rin");
            assert.ok(sign.choices.length >= 2, `${sign.id} has too few choices`);
            assert.ok(sign.prose.length > 0 && sign.kicker.length > 0);
            for (const choice of sign.choices) {
                assert.ok(choice.label.length > 0 && choice.detail.length > 0, `${sign.id}/${choice.id} missing copy`);
                assert.ok(choice.outcome.ambushChance >= 0 && choice.outcome.ambushChance <= 1, `${sign.id}/${choice.id} bad chance`);
                assert.ok(Number.isInteger(choice.outcome.quality), `${sign.id}/${choice.id} non-integer quality`);
            }
        }
    });

    it("offers at least one route that neither risks an ambush nor loses quality", () => {
        // A hunt must always be completable by a cautious player.
        for (const stage of [0, 1, 2, 3, 4, 5]) {
            const sign = huntSignFor(mission, stage, "Rin");
            const safe = sign.choices.some((c) => c.outcome.ambushChance === 0 && c.outcome.quality >= 0);
            assert.ok(safe, `${sign.id} has no safe line`);
        }
    });

    it("any choice that risks an ambush pays for it with quality or an explicit warning", () => {
        for (const stage of [0, 1, 2, 3, 4, 5]) {
            for (const choice of huntSignFor(mission, stage, "Rin").choices) {
                if (choice.outcome.ambushChance > 0) {
                    assert.ok(choice.risk.length > 0, `${choice.id} risks an ambush with no warning copy`);
                }
            }
        }
    });
});

describe("ambush roll", () => {
    it("never fires at chance 0 and always fires at chance 1", () => {
        assert.equal(rollHuntAmbush(0, () => 0), false);
        assert.equal(rollHuntAmbush(1, () => 0.999), true);
    });

    it("respects the threshold", () => {
        assert.equal(rollHuntAmbush(0.35, () => 0.34), true);
        assert.equal(rollHuntAmbush(0.35, () => 0.35), false);
        assert.equal(rollHuntAmbush(0.35, () => 0.90), false);
    });
});

describe("pack members", () => {
    it("never reuse the contract beast's id", () => {
        for (let stage = 0; stage < HUNT_PACK_STAGES; stage += 1) {
            const member = huntPackMember(mission, "Frost Wolf", stage);
            assert.notEqual(member.id, beast.id, "a pack mook would stamp the kill receipt");
            assert.ok(member.id.startsWith("hunt-pack-"));
        }
    });

    it("gives each stage a distinct identity", () => {
        const ids = new Set<string>();
        const names = new Set<string>();
        for (let stage = 0; stage < HUNT_PACK_STAGES; stage += 1) {
            const member = huntPackMember(mission, "the Frost Wolf", stage);
            ids.add(member.id);
            names.add(member.name);
            assert.ok(!/^the /i.test(member.name), `leading article survived: ${member.name}`);
        }
        assert.equal(ids.size, HUNT_PACK_STAGES);
        assert.equal(names.size, HUNT_PACK_STAGES);
    });
});
