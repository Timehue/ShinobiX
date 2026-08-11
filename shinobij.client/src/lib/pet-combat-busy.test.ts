import assert from "node:assert/strict";
import test from "node:test";
import {
    activeClientBreedingParentIds,
    clientPetCombatBusyReason,
} from "./pet-combat-busy";

const pet = { id: "p1" };

test("client combat-busy mirror matches breeding timer boundaries", () => {
    const character = { petBreeding: { state: "breeding" as const, parentIds: ["p1", "p2"] as [string, string], readyAt: 100 } };
    assert.deepEqual([...activeClientBreedingParentIds(character, 99)], ["p1", "p2"]);
    assert.equal(clientPetCombatBusyReason(character, pet, 99), "pet-is-breeding");
    assert.equal(clientPetCombatBusyReason(character, pet, 100), null);
});

test("client combat-busy mirror preserves completed-but-unclaimed work", () => {
    assert.equal(
        clientPetCombatBusyReason({}, { ...pet, training: { type: "strength", endsAt: 1 } }, 100),
        "pet-is-training",
    );
    assert.equal(
        clientPetCombatBusyReason({}, { ...pet, expedition: { type: "scout", startedAt: 0, endsAt: 1, durationMs: 1 } }, 100),
        "pet-is-on-expedition",
    );
    assert.equal(clientPetCombatBusyReason({}, pet, 100), null);
});
