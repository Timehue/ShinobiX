import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Pet } from "../types/pet";
import {
    TACTICAL_ARENA_PET_REQUIREMENT,
    availablePetBattleCount,
    canEnterTacticalArena,
} from "./pet";

const pet = (id: string, expeditionEndsAt?: number) => ({
    id,
    name: id,
    ...(expeditionEndsAt ? { expedition: { endsAt: expeditionEndsAt } } : {}),
}) as Pet;

describe("pet battle mode eligibility", () => {
    it("requires four available pets for the 4v4 Tactical Arena", () => {
        const roster = Array.from({ length: TACTICAL_ARENA_PET_REQUIREMENT }, (_, index) => pet(`pet-${index}`));
        assert.equal(canEnterTacticalArena(roster.slice(0, 3)), false);
        assert.equal(canEnterTacticalArena(roster), true);
    });

    it("does not count pets that are away on expeditions", () => {
        const future = Date.now() + 60_000;
        const roster = [pet("a"), pet("b"), pet("c"), pet("away", future)];
        assert.equal(availablePetBattleCount(roster), 3);
        assert.equal(canEnterTacticalArena(roster), false);
    });
});
