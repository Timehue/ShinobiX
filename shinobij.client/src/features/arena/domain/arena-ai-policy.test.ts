import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeJutsu } from "../../../lib/jutsu";
import type { Jutsu } from "../../../types/combat";
import type { AiCondition, AiRule } from "../../../types/creator-ai";
import type { ArenaCombatStatus } from "../types";
import {
    arenaActivePlayerDotDamage,
    buildArenaSmartJutsuPool,
    matchesArenaAiRule,
    pickArenaAiJutsu,
    type ArenaAiPolicySnapshot,
    type ArenaAiRuleSnapshot,
} from "./arena-ai-policy";

function jutsu(id: string, patch: Partial<Jutsu> = {}): Jutsu {
    const tags = patch.tags ?? [];
    const base = makeJutsu(
        id,
        patch.name ?? id,
        patch.type ?? "Ninjutsu",
        patch.ap ?? 40,
        patch.range ?? 4,
        patch.effectPower ?? 40,
        patch.cooldown ?? 1,
        patch.chakraCost ?? 0,
        patch.staminaCost ?? 0,
        tags,
        patch.element ?? "Fire",
    );
    return {
        ...base,
        ...patch,
        type: patch.type ?? "Ninjutsu",
        tags,
    };
}

function status(
    name: string,
    kind: ArenaCombatStatus["kind"],
    patch: Partial<ArenaCombatStatus> = {},
): ArenaCombatStatus {
    return { name, kind, rounds: 2, ...patch };
}

function rule(condition: AiCondition, value = 0): AiRule {
    return { id: `rule-${condition}`, condition, value, action: "use_basic_attack" };
}

const baseStrike = jutsu("strike", { ap: 40, effectPower: 40 });

function policySnapshot(patch: Partial<ArenaAiPolicySnapshot> = {}): ArenaAiPolicySnapshot {
    return {
        allJutsus: [baseStrike],
        enemyAiJutsus: [baseStrike],
        opponentLevel: 50,
        usesSmartScorer: true,
        enemyChakra: 1_000,
        enemyStamina: 1_000,
        enemyJutsuCooldowns: {},
        availableAp: 100,
        distanceToPlayer: 1,
        turn: 3,
        isStandardPve: false,
        enemyHp: 1_000,
        enemyMaxHp: 1_000,
        playerHp: 1_000,
        playerMaxHp: 1_000,
        playerShield: 0,
        playerAp: 100,
        playerArmorFactor: 1,
        playerStatuses: [],
        enemyStatuses: [],
        combatResourcesV2: true,
        estimateDamage: (candidate) => candidate.effectPower,
        ...patch,
    };
}

describe("matchesArenaAiRule", () => {
    const snapshot: ArenaAiRuleSnapshot = {
        distanceToPlayer: 3,
        turn: 4,
        enemyHp: 25,
        enemyMaxHp: 100,
        playerHp: 40,
        playerMaxHp: 200,
        playerShield: 1,
        playerAp: 49,
        activePlayerStatuses: [status("Focus", "positive"), status("Guard", "positive")],
        activeEnemyStatuses: [status("Wound", "negative")],
    };

    it("preserves every supported condition and its strict threshold", () => {
        assert.equal(matchesArenaAiRule(rule("always"), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("specific_round", 4), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("specific_round", 3), snapshot), false);
        assert.equal(matchesArenaAiRule(rule("distance_lower_than", 3), snapshot), false);
        assert.equal(matchesArenaAiRule(rule("distance_lower_than", 4), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("distance_higher_than", 3), snapshot), false);
        assert.equal(matchesArenaAiRule(rule("distance_higher_than", 2), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("hp_lower_than", 25), snapshot), false);
        assert.equal(matchesArenaAiRule(rule("hp_lower_than", 26), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("player_hp_lower_than", 20), snapshot), false);
        assert.equal(matchesArenaAiRule(rule("player_hp_lower_than", 21), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("player_has_shield"), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("player_has_buff", 2), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("player_has_buff", 3), snapshot), false);
        assert.equal(matchesArenaAiRule(rule("self_has_debuff", 1), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("self_has_debuff", 2), snapshot), false);
        assert.equal(matchesArenaAiRule(rule("player_low_ap", 49), snapshot), false);
        assert.equal(matchesArenaAiRule(rule("player_low_ap", 50), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("self_resource_lower_than", 100), snapshot), false);
    });

    it("retains the zero-value low-AP fallback and minimum status count", () => {
        assert.equal(matchesArenaAiRule(rule("player_low_ap", 0), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("player_has_buff", 0), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("self_has_debuff", 0), snapshot), true);
        assert.equal(matchesArenaAiRule(rule("player_has_buff", 0), {
            ...snapshot,
            activePlayerStatuses: [],
        }), false);
    });
});

describe("arenaActivePlayerDotDamage", () => {
    const statuses = [
        status("Wound", "negative", { amount: 10, activeRound: 99 }),
        status("Drain", "negative"),
        status("Poison", "negative", { percent: 10 }),
    ];

    it("reads the raw status list and excludes passive Poison under resources v2", () => {
        assert.equal(arenaActivePlayerDotDamage(statuses, 1_000, true), 60);
        assert.equal(arenaActivePlayerDotDamage(statuses, 1_000, false), 160);
    });
});

describe("buildArenaSmartJutsuPool", () => {
    it("filters the catalog but always merges equipped jutsus in stable order", () => {
        const allowed = jutsu("allowed", { ap: 60, element: "Fire" });
        const catalogDuplicate = jutsu("duplicate", { ap: 60, element: "Fire", effectPower: 10 });
        const equippedDuplicate = jutsu("duplicate", { ap: 60, element: "Fire", effectPower: 99 });
        const equippedOnly = jutsu("equipped-only", { ap: 60, element: "Fire" });
        const tooStrong = jutsu("too-strong", { ap: 80, element: "Fire" });
        const bloodlineLocked = jutsu("bloodline", { ap: 60, element: "Fire", bloodlineRank: "A Rank" });
        const tooHungry = jutsu("hungry", { ap: 60, element: "Fire", chakraCost: 101 });
        const wrongElement = jutsu("wrong-element", { ap: 60, element: "Water" });
        const allJutsus = [allowed, catalogDuplicate, tooStrong, bloodlineLocked, tooHungry, wrongElement];
        const loadout = [equippedDuplicate, equippedOnly];
        const allOrder = allJutsus.map((candidate) => candidate.id);
        const loadoutOrder = loadout.map((candidate) => candidate.id);

        const pool = buildArenaSmartJutsuPool({
            allJutsus,
            enemyAiJutsus: loadout,
            opponentLevel: 30,
            enemyChakra: 100,
            enemyStamina: 100,
        });

        assert.deepEqual(pool.map((candidate) => candidate.id), ["allowed", "duplicate", "equipped-only"]);
        assert.equal(pool[1], equippedDuplicate, "the equipped definition must overwrite the catalog value");
        assert.deepEqual(allJutsus.map((candidate) => candidate.id), allOrder);
        assert.deepEqual(loadout.map((candidate) => candidate.id), loadoutOrder);
    });
});

describe("pickArenaAiJutsu", () => {
    it("preserves easy-band burst hold without changing the basic scorer", () => {
        const burst = jutsu("burst", { ap: 60, effectPower: 100 });
        const control = jutsu("control", { ap: 40, effectPower: 80, tags: [{ name: "Stun", percent: 30 }] });
        const base = policySnapshot({
            allJutsus: [burst, control],
            enemyAiJutsus: [burst, control],
            opponentLevel: 10,
            usesSmartScorer: false,
            isStandardPve: true,
            turn: 1,
        });

        assert.equal(pickArenaAiJutsu(base)?.id, "control");
        assert.equal(pickArenaAiJutsu({ ...base, turn: 3 })?.id, "burst");
    });

    it("selects the cheapest lethal and keeps the easy-band lethal-intent gate", () => {
        const cheapLethal = jutsu("cheap-lethal", { ap: 40, effectPower: 1 });
        const costlyLethal = jutsu("costly-lethal", { ap: 60, effectPower: 1 });
        const nonLethal = jutsu("non-lethal", { ap: 40, effectPower: 100 });
        const estimateDamage = (candidate: Jutsu) => ({
            "cheap-lethal": 110,
            "costly-lethal": 200,
            "non-lethal": 0,
        })[candidate.id] ?? 0;
        const unrestricted = policySnapshot({
            allJutsus: [costlyLethal, cheapLethal, nonLethal],
            enemyAiJutsus: [costlyLethal, cheapLethal, nonLethal],
            playerHp: 100,
            playerShield: 10,
            estimateDamage,
        });
        assert.equal(pickArenaAiJutsu(unrestricted)?.id, "cheap-lethal");

        const easy = {
            ...unrestricted,
            opponentLevel: 10,
            isStandardPve: true,
            turn: 3,
            playerHp: 50,
            playerMaxHp: 100,
            playerShield: 0,
        };
        assert.equal(pickArenaAiJutsu(easy)?.id, "non-lethal");
        assert.equal(pickArenaAiJutsu({ ...easy, playerHp: 20 })?.id, "cheap-lethal");
    });

    it("takes the first usable sustain jutsu below forty percent HP", () => {
        const heal = jutsu("heal", { target: "SELF", tags: [{ name: "Heal", percent: 30 }], effectPower: 0 });
        const attack = jutsu("attack", { effectPower: 100 });
        const picked = pickArenaAiJutsu(policySnapshot({
            allJutsus: [heal, attack],
            enemyAiJutsus: [heal, attack],
            enemyHp: 399,
            enemyMaxHp: 1_000,
            estimateDamage: () => 0,
        }));
        assert.equal(picked?.id, "heal");
    });

    it("scores raw deferred statuses, player AP, and Pierce exactly as before", () => {
        const poison = jutsu("poison", { effectPower: 55, tags: [{ name: "Poison", percent: 30 }] });
        const plain = jutsu("plain", { effectPower: 50 });
        const poisonSnapshot = policySnapshot({
            allJutsus: [poison, plain],
            enemyAiJutsus: [poison, plain],
            playerStatuses: [status("Poison", "negative", { activeRound: 99 })],
            estimateDamage: () => 0,
        });
        assert.equal(pickArenaAiJutsu(poisonSnapshot)?.id, "plain");
        assert.equal(pickArenaAiJutsu({ ...poisonSnapshot, playerStatuses: [] })?.id, "poison");

        const lag = jutsu("lag", { effectPower: 60, tags: [{ name: "Lag", percent: 20 }] });
        const steady = jutsu("steady", { effectPower: 55 });
        const lagSnapshot = policySnapshot({
            allJutsus: [lag, steady],
            enemyAiJutsus: [lag, steady],
            playerAp: 49,
            availableAp: 100,
            estimateDamage: () => 0,
        });
        assert.equal(pickArenaAiJutsu(lagSnapshot)?.id, "steady");
        assert.equal(pickArenaAiJutsu({ ...lagSnapshot, playerAp: 50 })?.id, "lag");

        const pierce = jutsu("pierce", { effectPower: 5, tags: [{ name: "Pierce", percent: 30 }] });
        const armored = policySnapshot({
            allJutsus: [pierce, plain],
            enemyAiJutsus: [pierce, plain],
            playerArmorFactor: 0.5,
            playerShield: 1,
            estimateDamage: () => 0,
        });
        assert.equal(pickArenaAiJutsu(armored)?.id, "pierce");
    });

    it("keeps cooldown, AP, range, tie order, repeated estimates, and inputs intact", () => {
        const first = jutsu("first", { ap: 40, range: 2, effectPower: 50 });
        const tied = jutsu("tied", { ap: 40, range: 2, effectPower: 50 });
        const cooling = jutsu("cooling", { ap: 40, range: 2, effectPower: 500 });
        const tooFar = jutsu("too-far", { ap: 40, range: 1, effectPower: 500 });
        const tooCostly = jutsu("too-costly", { ap: 80, range: 2, effectPower: 500 });
        const loadout = [first, tied, cooling, tooFar, tooCostly];
        const originalOrder = loadout.map((candidate) => candidate.id);
        let estimateCalls = 0;
        const picked = pickArenaAiJutsu(policySnapshot({
            allJutsus: loadout,
            enemyAiJutsus: loadout,
            enemyJutsuCooldowns: { cooling: 1 },
            availableAp: 60,
            distanceToPlayer: 2,
            estimateDamage: () => {
                estimateCalls += 1;
                return 0;
            },
        }));

        assert.equal(picked?.id, "first");
        assert.ok(estimateCalls > 2, "the comparator must keep estimating instead of silently memoizing");
        assert.deepEqual(loadout.map((candidate) => candidate.id), originalOrder);
    });
});
