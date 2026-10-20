import assert from "node:assert/strict";
import { test } from "node:test";
import type { DuelResult } from "../shinobij.client/src/lib/pet-duel-sim";
import type { Pet } from "../shinobij.client/src/types/pet";
import { rawPetPool } from "../shinobij.client/src/data/pet-pool";
import { balanceBuiltInPetTemplate } from "../shinobij.client/src/lib/pet-balance";
import { normalizePetGrowth } from '../api/pet/_growth';
import { petBattleJutsus } from '../shared/pet-battle-loadout';
import {
    aiRitePlan,
    deterministicRiteCounterMove,
    isValidRitePlan,
    runWarfrontRite,
    type RitePlan,
    type RiteSide,
} from "../shinobij.client/src/lib/pet-warfront-rite";

const POOL = rawPetPool
    .filter((pet) => pet.rarity !== "mythic")
    .map((pet) => balanceBuiltInPetTemplate(pet));

function band(seed: number, prefix: string, progression: boolean): Pet[] {
    const picked: Pet[] = [];
    for (let index = 0; picked.length < 4 && index < POOL.length * 2; index++) {
        const candidate = POOL[(seed * 31 + index * 17) % POOL.length];
        if (!picked.some((pet) => pet.id === candidate.id)) picked.push(candidate);
    }
    return picked.map((pet, slot) => {
        const owned = { ...pet, id: `${prefix}-${pet.id}-${slot}` };
        if (!progression) return { ...owned, battleLoadoutVersion: 'legacy-v1' as const };
        return normalizePetGrowth({ ...owned, templateId: pet.id, level: 75,
            growthBaseStats: { hp: pet.hp, attack: pet.attack, defense: pet.defense, speed: pet.speed },
            growthAllocation: { vitality: 0, power: 0, guard: 0, agility: 0 },
        } as unknown as Record<string, unknown>) as unknown as Pet;
    });
}

const holdPlan = (): RitePlan => ({
    formation: [0, 1, 2, 3],
    deployment: [3, 4, 7, 8],
    reformAfterClash: null,
    reform: null,
    reformDeployment: null,
    reforms: [],
});

function openingContact(result: DuelResult): string {
    // "Opening contact" is the literal first landed hit: who reached whom and
    // on which deterministic tick. Pre-contact target tells are intentionally
    // excluded so later transcript drift cannot inflate this gate.
    const firstHit = result.events.find((event) => event.type === "hit");
    return `${firstHit?.actorId ?? "none"}>${firstHit?.targetId ?? "none"}@${firstHit?.t ?? -1}`;
}

function counterCohort(progression: boolean) {
    let openingChanges = 0;
    let winnerFlips = 0;

    for (let seed = 1; seed <= 20; seed++) {
        const blue = band(seed, "blue", progression);
        if (progression) for (const pet of blue) {
            const kit = petBattleJutsus(pet, { forceProgression: true });
            assert.ok(kit.length > 0 && kit.every(move => !!move.abilityId && (move.unlockLevel ?? 1) <= pet.level));
        }
        const red = blue.map((pet, slot) => ({ ...pet, id: `red-${pet.id}-${slot}` }));
        const blueHold = holdPlan();
        const redHold: RitePlan = { ...aiRitePlan(red, seed), reforms: [] };
        const baseline = runWarfrontRite(blue, red, seed, blueHold, redHold);
        const openingWinner = baseline.clashes[0].winner;
        assert.ok(openingWinner === "blue" || openingWinner === "red", `seed ${seed} needs a losing side`);
        const loser: RiteSide = openingWinner === "blue" ? "red" : "blue";
        const move = deterministicRiteCounterMove(baseline.clashes[0], loser);
        assert.ok(move, `seed ${seed} produced no public-evidence counter`);

        const prior = loser === "blue" ? baseline.clashes[0].blue : baseline.clashes[0].red;
        const priorNodes = Array.from({ length: 4 }, (_, slot) => prior.find((entry) => entry.slot === slot)?.node);
        assert.deepEqual(move.formation, [...prior].sort((a, b) => a.lane - b.lane).map((entry) => entry.slot), `seed ${seed} counter reordered a second pet`);
        assert.equal(move.deployment.filter((node, slot) => node !== priorNodes[slot]).length, 1, `seed ${seed} must move exactly one pet`);
        assert.equal(new Set(move.deployment).size, 4, `seed ${seed} counter collided with an occupied cell`);

        const reform = { afterClash: 0, formation: move.formation, deployment: move.deployment };
        const bluePlan: RitePlan = loser === "blue" ? { ...blueHold, reforms: [reform] } : blueHold;
        const redPlan: RitePlan = loser === "red" ? { ...redHold, reforms: [reform] } : redHold;
        assert.ok(isValidRitePlan(bluePlan));
        assert.ok(isValidRitePlan(redPlan));
        const adapted = runWarfrontRite(blue, red, seed, bluePlan, redPlan);

        assert.deepEqual(adapted.clashes[0], baseline.clashes[0], `seed ${seed} rewrote public evidence after lock`);
        if (openingContact(adapted.clashes[1].result) !== openingContact(baseline.clashes[1].result)) openingChanges++;
        if (baseline.clashes[1].winner && adapted.clashes[1].winner
            && adapted.clashes[1].winner !== baseline.clashes[1].winner) winnerFlips++;
    }

    assert.ok(openingChanges >= 12, `${openingChanges}/20 losing-side counters changed opening contact; gate is 12`);
    assert.ok(winnerFlips >= 5, `${winnerFlips}/20 losing-side counters flipped the next-clash winner; gate is 5`);
    return { openingChanges, winnerFlips };
}

test('20 retained losing-side counters preserve their exact authored-kit cohort', () => {
    const { openingChanges, winnerFlips } = counterCohort(false);
    assert.equal(openingChanges, 17, "fixed retained cohort drifted; inspect the counter rather than weakening the gate");
    assert.equal(winnerFlips, 7, "fixed retained cohort drifted; inspect the counter rather than weakening the gate");
});

test('20 mature progression counters keep public evidence immutable and clear the same strategic floors', () => {
    counterCohort(true);
});
