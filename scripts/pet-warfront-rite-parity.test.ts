import assert from "node:assert/strict";
import { test } from "node:test";
import {
    RITE_DOWNED_RETURN_HP,
    RITE_LOSER_REGROUP,
    RITE_MIN_ENTRY_HP,
    RITE_REGROUP,
    runWarfrontRite as clientRun,
    type RitePlan,
} from "../shinobij.client/src/lib/pet-warfront-rite";
import { riteTacticalReport } from "../shinobij.client/src/lib/pet-warfront-rite-presentation";
import { runWarfrontRite as serverRun } from "../api/_pet-sim/pet-warfront-rite";
import { rawPetPool } from "../shinobij.client/src/data/pet-pool";
import { balanceBuiltInPetTemplate } from "../shinobij.client/src/lib/pet-balance";
import type { Pet } from "../shinobij.client/src/types/pet";

const pool = rawPetPool
    .filter((pet) => pet.rarity !== "mythic")
    .map((pet) => balanceBuiltInPetTemplate(pet));
const cloneBand = (offset: number, prefix: string): Pet[] =>
    Array.from({ length: 4 }, (_, slot) => ({ ...pool[offset + slot], id: `${prefix}-${pool[offset + slot].id}` }));

const holdPlan = (): RitePlan => ({
    formation: [0, 1, 2, 3],
    deployment: [3, 4, 7, 8],
    reformAfterClash: null,
    reform: null,
    reformDeployment: null,
    reforms: [],
});

const durableBand = (prefix: string): Pet[] => {
    const roles = [
        { role: "defender", subRole: "tank", element: "Earth" },
        { role: "tracker", subRole: "kite", element: "Fire" },
        { role: "sage", subRole: "support", element: "Water" },
        { role: "assassin", subRole: "assassin", element: "Wind" },
    ] as const;
    return cloneBand(0, prefix).map((pet, slot) => ({
        ...pet,
        ...roles[slot],
        hp: 100_000,
        attack: 1,
        defense: 100,
        speed: 60 + slot * 12,
        jutsus: [{ name: "Tap", kind: "damage", power: 1, cooldown: 2, currentCooldown: 0 }],
    }));
};

const closeTo = (actual: number, expected: number, message: string) => {
    assert.ok(Math.abs(actual - expected) <= 1e-12, `${message}: expected ${expected}, got ${actual}`);
};

type RiteReplay = ReturnType<typeof clientRun>;

function assertCumulativeCarry(result: RiteReplay, label: string) {
    assert.equal(result.clashes.length, 3, `${label} fixture must reach the deciding clash`);
    const clash = result.clashes[1];
    const nextClash = result.clashes[2];
    const last = clash.result.snapshots.at(-1);
    assert.ok(last, `${label} rematch needs a final snapshot`);
    let sawUnequalEntry = false;

    for (const [side, team] of [["blue", "player"], ["red", "enemy"]] as const) {
        const share = clash.winner === null || clash.winner === side ? RITE_REGROUP : RITE_LOSER_REGROUP;
        for (const combatant of clash[side]) {
            const actor = last.actors.find((candidate) => candidate.team === team && candidate.slot === combatant.lane);
            assert.ok(actor, `${label} ${team}-${combatant.lane} is missing from the final snapshot`);
            const localExitRatio = actor.maxHp > 0 ? Math.max(0, Math.min(1, actor.hp / actor.maxHp)) : 0;
            const cumulativeExitHp = combatant.entryHp * localExitRatio;
            closeTo(combatant.exitHp, cumulativeExitHp, `${label} ${team}-${combatant.lane} cumulative exit health`);

            if (combatant.entryHp < 1 && localExitRatio > 0) {
                sawUnequalEntry = true;
                assert.notEqual(combatant.exitHp, localExitRatio, `${label} stored a clash-local ratio as base health`);
            }

            const next = nextClash[side].find((candidate) => candidate.slot === combatant.slot);
            assert.ok(next, `${label} slot ${combatant.slot} is missing from the next clash`);
            const carriedHealth = cumulativeExitHp > 0 ? Math.max(RITE_MIN_ENTRY_HP, cumulativeExitHp) : 0;
            const regroupBase = carriedHealth > 0 ? carriedHealth : RITE_DOWNED_RETURN_HP;
            const expectedNextEntry = Math.min(1, regroupBase + (1 - regroupBase) * share);
            closeTo(next.entryHp, expectedNextEntry, `${label} slot ${combatant.slot} next-clash entry health`);
        }
    }
    assert.ok(sawUnequalEntry, `${label} fixture did not exercise unequal carried health`);

    assert.equal(clash.blueStanding, clash.redStanding, `${label} fixture must reach the health tiebreak`);
    const cumulativeBlue = clash.blue.reduce((sum, combatant) => sum + combatant.exitHp, 0);
    const cumulativeRed = clash.red.reduce((sum, combatant) => sum + combatant.exitHp, 0);
    assert.ok(cumulativeBlue > cumulativeRed, `${label} cumulative-health fixture drifted`);
    assert.equal(clash.winner, "blue", `${label} did not settle the tiebreak from cumulative health`);

    const localTotal = (side: "blue" | "red", team: "player" | "enemy") => clash[side].reduce((sum, combatant) => {
        const actor = last.actors.find((candidate) => candidate.team === team && candidate.slot === combatant.lane);
        return sum + (actor && actor.maxHp > 0 ? Math.max(0, Math.min(1, actor.hp / actor.maxHp)) : 0);
    }, 0);
    assert.ok(localTotal("blue", "player") < localTotal("red", "enemy"), `${label} local-ratio counterfactual drifted`);
}

test("Rite multi-reform replay and deterministic enemy response are byte-identical on client and server", () => {
    const blue = cloneBand(0, "client");
    // Mirrored stats keep seed 2 alive for a deciding clash, so reform #2 is
    // executed rather than merely echoed in the returned plan.
    const red = cloneBand(0, "enemy");
    const plan: RitePlan = {
        formation: [0, 1, 2, 3],
        deployment: [3, 4, 7, 8],
        reformAfterClash: null,
        reform: null,
        reformDeployment: null,
        reforms: [
            { afterClash: 0, formation: [0, 1, 2, 3], deployment: [0, 4, 7, 8] },
            { afterClash: 1, formation: [0, 1, 2, 3], deployment: [0, 4, 6, 8] },
        ],
    };

    for (const seed of [2, 19, 909]) {
        const client = clientRun(blue, red, seed, plan);
        const server = serverRun(blue, red, seed, plan);
        assert.deepEqual(server, client, `Rite client/server replay drift at seed ${seed}`);
        assert.deepEqual(client.bluePlan.reforms, plan.reforms);
        assert.ok(client.clashes.length >= 2, "best-of-three must reach a rematch");
        assert.equal(client.winner, client.blueRounds > client.redRounds ? "blue" : client.redRounds > client.blueRounds ? "red" : null);
        if (seed === 2) {
            assert.equal(client.clashes.length, 3, "parity fixture must execute both re-form locks");
            assert.deepEqual(
                Array.from({ length: 4 }, (_, slot) => client.clashes[2].blue.find((entry) => entry.slot === slot)?.node),
                [0, 4, 6, 8],
                "second re-form was not applied to the deciding clash",
            );
        }
    }
});

test("Rite carry health stays cumulative across both mirrors, the next clash, and the health verdict", () => {
    const blue = durableBand("carry-blue");
    const red = durableBand("carry-red");
    const bluePlan = holdPlan();
    const redPlan = holdPlan();
    const client = clientRun(blue, red, 1, bluePlan, redPlan);
    const server = serverRun(blue, red, 1, bluePlan, redPlan);

    assert.equal(JSON.stringify(server), JSON.stringify(client), "Rite mirrors are not byte-identical");
    assertCumulativeCarry(client, "client");
    assertCumulativeCarry(server, "server");
    assert.equal(riteTacticalReport(client.clashes[1]).winner, "player", "report did not preserve the cumulative-health verdict");
});
