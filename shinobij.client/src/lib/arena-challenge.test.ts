import assert from "node:assert/strict";
import test from "node:test";
import type { Pet } from "../types/pet";
import {
    buildAcceptedArenaMatch,
    parseWarfrontChallengePlan,
    type WarfrontChallengePlan,
} from "./arena-challenge";

const pet = (id: string): Pet => ({ id, name: id } as Pet);
const challengerPlan: WarfrontChallengePlan = { buyPolicy: "offense", stance: "jungle", doctrine: "warden-pact" };
const responderPlan: WarfrontChallengePlan = { buyPolicy: "defense", stance: "turtle", doctrine: "bulwark" };

test("accepted Warfront challenges reconstruct the same asymmetric plans for both clients", () => {
    const blue = [1, 2, 3, 4].map((index) => pet(`blue-${index}`));
    const red = [1, 2, 3, 4].map((index) => pet(`red-${index}`));
    const match = buildAcceptedArenaMatch({
        arenaSize: 4,
        challengerTeamIds: blue.map(({ id }) => id),
        challenger: { pets: blue },
        responderTeam: red,
        petBattleSeed: 7319,
        challengerWarfrontPlan: challengerPlan,
        responderWarfrontPlan: responderPlan,
    });

    assert.deepEqual(match, { blue, red, size: 4, seed: 7319, plans: { blue: challengerPlan, red: responderPlan } });
});

test("Warfront plan parsing fails closed for incomplete or interactive network plans", () => {
    assert.deepEqual(parseWarfrontChallengePlan(challengerPlan), challengerPlan);
    assert.equal(parseWarfrontChallengePlan({ ...challengerPlan, buyPolicy: "off" }), null);
    assert.equal(parseWarfrontChallengePlan({ buyPolicy: "offense", stance: "jungle" }), null);
    assert.equal(buildAcceptedArenaMatch({
        challengerTeamIds: ["blue-1"], challenger: { pets: [pet("blue-1")] }, responderTeam: [pet("red-1")],
    }), null);
});
