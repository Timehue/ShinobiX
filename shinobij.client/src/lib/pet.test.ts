import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Pet } from "../types/pet";
import {
    TACTICAL_ARENA_PET_REQUIREMENT,
    availablePetBattleCount,
    availableWarfrontPetCount,
    canEnterTacticalArena,
    colosseumPetBusyReason,
    isPetAvailableForColosseum,
    isPetAvailableForWarfront,
    pickArenaTeam,
    resolveAvailablePetBattlePair,
    warfrontPetBusyReason,
} from "./pet";

const pet = (id: string, expeditionEndsAt?: number) => ({
    id,
    name: id,
    ...(expeditionEndsAt ? { expedition: { type: "scout", startedAt: expeditionEndsAt - 1_000, endsAt: expeditionEndsAt, durationMs: 1_000 } } : {}),
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

    it("mirrors the server Warfront busy contract for unclaimed work and breeding", () => {
        const past = Date.now() - 60_000;
        const training = pet("training");
        training.training = { type: "strength", endsAt: past };
        const expedition = pet("expedition", past);
        const breeding = pet("breeding");
        const breedingPetIds = new Set([breeding.id]);

        assert.equal(warfrontPetBusyReason(training, breedingPetIds), "training");
        assert.equal(warfrontPetBusyReason(expedition, breedingPetIds), "expedition");
        assert.equal(warfrontPetBusyReason(breeding, breedingPetIds), "breeding");
        assert.equal(isPetAvailableForWarfront(training, breedingPetIds), false);
        assert.equal(isPetAvailableForWarfront(expedition, breedingPetIds), false);
        assert.equal(isPetAvailableForWarfront(breeding, breedingPetIds), false);
    });

    it("treats breeding lineage as history while blocking only active Colosseum work", () => {
        const now = Date.now();
        const bredOffspring = pet("bred-offspring");
        bredOffspring.breedingSessionId = "completed-breeding-session";
        const activeParent = pet("active-parent");
        const training = pet("training");
        training.training = { type: "strength", endsAt: now + 60_000 };
        const expedition = pet("expedition", now + 60_000);
        const completedTraining = pet("completed-training");
        completedTraining.training = { type: "strength", endsAt: now - 60_000 };
        const completedExpedition = pet("completed-expedition", now - 60_000);
        const breedingPetIds = new Set([activeParent.id]);

        assert.equal(colosseumPetBusyReason(bredOffspring, breedingPetIds, now), null);
        assert.equal(isPetAvailableForColosseum(bredOffspring, breedingPetIds, now), true);
        assert.equal(colosseumPetBusyReason(activeParent, breedingPetIds, now), "breeding");
        assert.equal(colosseumPetBusyReason(training, breedingPetIds, now), "training");
        assert.equal(colosseumPetBusyReason(expedition, breedingPetIds, now), "expedition");
        assert.equal(colosseumPetBusyReason(completedTraining, breedingPetIds, now), null);
        assert.equal(colosseumPetBusyReason(completedExpedition, breedingPetIds, now), null);
    });

    it("excludes every server-busy pet from Warfront counts and suggested squads", () => {
        const past = Date.now() - 60_000;
        const training = pet("training");
        training.training = { type: "strength", endsAt: past };
        const expedition = pet("expedition", past);
        const breeding = pet("breeding");
        const ready = [pet("ready-low"), pet("ready-high"), pet("ready-mid"), pet("ready-fourth")];
        ready[0].level = 1;
        ready[1].level = 50;
        ready[2].level = 25;
        ready[3].level = 10;
        const roster = [...ready, training, expedition, breeding];
        const breedingPetIds = new Set([breeding.id]);

        assert.equal(availableWarfrontPetCount(roster, breedingPetIds), 4);
        assert.equal(canEnterTacticalArena(roster, breedingPetIds), true);
        assert.deepEqual(
            pickArenaTeam(roster, 4, "ready-low", breedingPetIds).map((entry) => entry.id),
            ["ready-low", "ready-high", "ready-mid", "ready-fourth"],
        );
    });

    it("keeps a deployed Yard pet at the front of the suggested Warfront squad", () => {
        const roster = [pet("low"), pet("high"), pet("mid"), pet("fourth")];
        roster[0].level = 1;
        roster[1].level = 50;
        roster[2].level = 25;
        roster[3].level = 10;
        assert.deepEqual(pickArenaTeam(roster, 4, "low").map((entry) => entry.id), ["low", "high", "mid", "fourth"]);
    });

    it("resolves an exact pair of distinct available pets", () => {
        const roster = [pet("lead"), pet("reserve")];
        assert.deepEqual(resolveAvailablePetBattlePair(roster, ["reserve", "lead"]), [roster[1], roster[0]]);
    });

    it("rejects malformed or unavailable pet pairs", () => {
        const roster = [pet("lead"), pet("reserve"), pet("third"), pet("away", Date.now() + 60_000)];
        assert.equal(resolveAvailablePetBattlePair(roster, ["lead"]), null);
        assert.equal(resolveAvailablePetBattlePair(roster, ["lead", "reserve", "third"]), null);
        assert.equal(resolveAvailablePetBattlePair(roster, ["lead", "lead"]), null);
        assert.equal(resolveAvailablePetBattlePair(roster, ["lead", "missing"]), null);
        assert.equal(resolveAvailablePetBattlePair(roster, ["lead", "away"]), null);
    });
});
