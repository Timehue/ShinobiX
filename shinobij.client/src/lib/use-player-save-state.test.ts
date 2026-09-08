import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { Character } from "../types/character";
import type { CreatorEvent } from "../types/vn";
import type { PlayerSaveSnapshot } from "./player-save-types";
import { isContentAdminName, usePlayerSaveState } from "./use-player-save-state";

type State = ReturnType<typeof usePlayerSaveState>;
const character = (name = "Rookie") => ({ name, inventory: ["thrown-shuriken", "thrown-shuriken", "iron-sword-test"] }) as Character;
const event = (id: string, ryoReward = 0): CreatorEvent => ({
    id, name: id, biome: "forest", icon: "T", eventKind: "visualNovel",
    levelReq: 1, xpReward: 0, ryoReward, staminaReward: 0, dialogue: ["Hello"],
    vnPages: [{ title: "Page", scene: "", speaker: "Guide", dialogue: ["Hello"], choices: [] }],
});

// React's render-phase updates let this probe exercise successive hook states
// without a DOM or a mock dispatcher. Each mutating step must cause a render.
function transitions(...steps: ((state: State) => void)[]): void {
    let next = 0;
    function Probe() {
        const state = usePlayerSaveState();
        steps[next++]?.(state);
        return null;
    }
    renderToString(createElement(Probe));
    assert.equal(next, steps.length, "all state transitions were observed");
}

test("snapshot progress preserves travel, clears legacy AI before sector application, and records the clean signature", () => {
    const travel = { destinationSector: 42, arrivalAt: Date.now() + 60_000 };
    const snap = { character: character(), currentBiome: "forest", currentSector: 41,
        acceptedMissionIds: ["mission"], missionProgress: { mission: 2 }, triggeredEvents: ["event"], pendingTravel: travel } satisfies PlayerSaveSnapshot;
    const calls: string[] = [];
    transitions(
        state => state.applyProgressSnapshot(snap, {
            clearPendingAi: () => calls.push("clear-ai"),
            applySector: sector => { calls.push(`sector:${sector}`); state.setCurrentSector(sector); },
        }),
        state => {
            assert.deepEqual(calls, ["clear-ai", "sector:41"]);
            assert.equal(state.currentSector, 41);
            assert.deepEqual(state.pendingTravel, travel);
            assert.equal(state.travelingUntil, travel.arrivalAt);
            assert.equal(state.lastSnapshotMissionSigRef.current, JSON.stringify([["mission"], { mission: 2 }, ["event"], "forest", travel]));
        },
    );
});

test("an omitted progress field resets while omitted creator collections retain their current value", () => {
    const prior = [event("local")];
    transitions(
        state => { state.setCreatorEvents(prior); state.setAcceptedMissionIds(["old"]); state.setCurrentBiome("forest"); },
        state => {
            const snap = { character: character() };
            state.applyProgressSnapshot(snap, { clearPendingAi: () => {}, applySector: state.setCurrentSector });
            state.applyContentSnapshot(snap);
        },
        state => {
            assert.equal(state.creatorEvents, prior);
            assert.deepEqual(state.acceptedMissionIds, []);
            assert.deepEqual(state.missionProgress, {});
            assert.deepEqual(state.triggeredEvents, []);
            assert.equal(state.currentBiome, "central");
            assert.equal(state.currentSector, 40);
            assert.equal(state.pendingTravel, null);
            assert.equal(state.travelingUntil, 0);
            assert.equal(state.activeTraining, null);
            assert.equal(state.activeJutsuTraining, null);
        },
    );
});

for (const name of ["Rookie", "admin", "admin3", " admin 1 ", "ADMIN2"]) {
    test(`snapshot content filtering retains the existing allowlist for ${JSON.stringify(name)}`, () => {
        const safe = event("flavor"), unsafe = event("reward", 1);
        const missions = [{ id: "mission" }] as PlayerSaveSnapshot["creatorMissions"];
        const raids = [{ id: "raid" }] as PlayerSaveSnapshot["creatorRaids"];
        const expectedAdmin = name === " admin 1 " || name === "ADMIN2";
        assert.equal(isContentAdminName(name), expectedAdmin);
        transitions(
            state => state.applyContentSnapshot({ character: character(name), creatorEvents: [safe, unsafe], creatorMissions: missions, creatorRaids: raids }),
            state => {
                assert.deepEqual(state.creatorEvents, expectedAdmin ? [safe, unsafe] : [safe]);
                assert.deepEqual(state.creatorMissions, expectedAdmin ? missions : []);
                assert.deepEqual(state.creatorRaids, expectedAdmin ? raids : []);
            },
        );
    });
}

test("an empty creator collection clears it, but snapshot loading does not hydrate the legacy Gate configuration", () => {
    transitions(
        state => state.setCreatorEvents([event("old")]),
        state => state.applyContentSnapshot({ character: character(), creatorEvents: [], hollowGateEventConfig: { id: "ignored" } } as unknown as PlayerSaveSnapshot),
        state => { assert.deepEqual(state.creatorEvents, []); assert.equal(state.hollowGateEventConfig, null); },
    );
});

test("payload creation compacts inventory, preserves property order and overrides, and captures that render's fields", () => {
    const input = character();
    let oldBuilder!: State["buildPlayerSavePayload"];
    transitions(
        state => { oldBuilder = state.buildPlayerSavePayload; state.setCurrentBiome("forest"); },
        state => {
            const payload = state.buildPlayerSavePayload(input, { savedBloodlines: [] });
            assert.equal(oldBuilder(input).currentBiome, "central");
            assert.equal(payload.currentBiome, "forest");
            assert.deepEqual(payload.character.inventory, ["iron-sword-test"]);
            assert.deepEqual(payload.character.itemStacks, [{ itemId: "thrown-shuriken", count: 2 }]);
            assert.equal(input.inventory.length, 3);
            assert.deepEqual(Object.keys(payload), ["character", "currentBiome", "activeTraining", "activeJutsuTraining", "acceptedMissionIds", "missionProgress", "triggeredEvents", "currentSector", "pendingTravel", "savedBloodlines", "creatorJutsus", "creatorAis", "creatorEvents", "creatorMissions", "creatorRaids", "creatorCards", "creatorItems", "petEncounterVn", "ancientChestVn", "editablePets", "hollowGateEventConfig"]);
        },
    );
});
