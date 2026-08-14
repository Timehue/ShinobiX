import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlayerRecord } from "../types/character";
import { publicEligiblePets } from "./public-pet-roster";

test("uses only the server-projected public combat roster", () => {
    const eligiblePets = [{ id: "carried-1" }, { id: "carried-2" }];
    const record = {
        eligiblePets,
        character: { pets: [...eligiblePets, { id: "private-overflow" }] },
    } as unknown as PlayerRecord;

    assert.deepEqual(publicEligiblePets(record), eligiblePets);
});

test("fails closed when the server projection is missing", () => {
    const record = {
        character: { pets: [{ id: "untrusted-raw-pet" }] },
    } as unknown as PlayerRecord;

    assert.deepEqual(publicEligiblePets(record), []);
    assert.deepEqual(publicEligiblePets(undefined), []);
});
