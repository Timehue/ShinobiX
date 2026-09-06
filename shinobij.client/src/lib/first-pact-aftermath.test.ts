import assert from "node:assert/strict";
import test from "node:test";
import { createFirstPactProgress, normalizeFirstPactProgress } from "../../../shared/first-pact-contract.js";
import {
    firstPactAftermathForNpc,
    firstPactAftermathScene,
    firstPactCompanionCourtLines,
    firstPactCompanionEverydayLines,
    firstPactEpilogueCompanionCopy,
    resolveFirstPactCompanions,
} from "./first-pact-aftermath.js";
import { activeCarriedPetIds } from "./entitlements.js";
import { activeClientBreedingParentIds } from "./pet-breeding.js";
import { isPetAvailableForColosseum } from "./pet.js";
import type { Character } from "../types/game.js";
import type { Pet } from "../types/pet.js";

const pets = [
    { id: "a", name: "Kumo", nickname: "Cloud", role: "defender" },
    { id: "b", name: "Tora", role: "assassin" },
    { id: "c", name: "Mori", role: "sage" },
    { id: "d", name: "Suzu", role: "tracker" },
] as Pet[];

function progress() {
    return normalizeFirstPactProgress({
        ...createFirstPactProgress(1),
        mainStep: "return-to-threshold",
        chapter: 4,
        mainQuest: {
            omens: ["bell", "aqueduct", "gardens"],
            battleProofs: [],
            pactVow: "kept-future",
            pactCompanionIds: ["a", "b", "c", "d"],
            pactCompanionNames: ["Cloud", "Tora", "Mori", "Suzu"],
        },
        finalTrial: { wins: 4, battleProofs: ["1", "2", "3", "4"] },
        writs: ["writ-silencing", "writ-audit", "writ-pruning", "writ-impound"],
        findings: ["writ-silencing", "writ-audit", "writ-pruning", "writ-impound"],
        stableQuest: { status: "complete", tournamentWins: 3, battleProofs: ["s1", "s2", "s3"] },
    });
}

test("sealed companion ids resolve current pets while retaining names from the vow", () => {
    const resolved = resolveFirstPactCompanions(progress(), pets);
    assert.deepEqual(resolved.map(({ id, historicalName, currentName, role, available }) => ({ id, historicalName, currentName, role, available })), [
        { id: "a", historicalName: "Cloud", currentName: "Cloud", role: "defender", available: true },
        { id: "b", historicalName: "Tora", currentName: "Tora", role: "assassin", available: true },
        { id: "c", historicalName: "Mori", currentName: "Mori", role: "sage", available: true },
        { id: "d", historicalName: "Suzu", currentName: "Suzu", role: "tracker", available: true },
    ]);
});

test("renames affect present movement while archival copy keeps the vow names", () => {
    const renamed = pets.map((pet) => pet.id === "a" ? { ...pet, nickname: "Cirrus" } : pet);
    const resolved = resolveFirstPactCompanions(progress(), renamed);
    const copy = firstPactEpilogueCompanionCopy(resolved);
    assert.match(copy, /Cirrus.*cross with you/);
    assert.match(copy, /Vey's copy keeps Cloud, Tora, Mori, and Suzu/);
});

test("removed companions retain sealed archival names without present-day movement", () => {
    const resolved = resolveFirstPactCompanions(progress(), pets.slice(0, 2));
    const copy = firstPactEpilogueCompanionCopy(resolved);
    assert.match(copy, /Cloud and Tora cross with you/);
    assert.match(copy, /Vey's copy keeps Cloud, Tora, Mori, and Suzu/);
    assert.doesNotMatch(copy, /Mori (?:cross|backs|waits|moves)/);
});

test("busy and non-carried companions remain archival without physical actions", () => {
    const future = Date.now() + 60_000;
    const owned = [
        { ...pets[0], expedition: { type: "scout", risk: "safe", startedAt: 1, endsAt: future } },
        { ...pets[1], training: { type: "strength", endsAt: future } },
        pets[2],
        { ...pets[0], id: "filler-x", nickname: "X" },
        { ...pets[0], id: "filler-y", nickname: "Y" },
        pets[3],
    ] as Pet[];
    const character = {
        pets: owned,
        activePetId: "a",
        activePetId2v2: "b",
        petBreeding: { state: "breeding", parentIds: ["c", "other"], readyAt: future },
    } as unknown as Character;
    const breeding = activeClientBreedingParentIds(character);
    const carried = new Set(activeCarriedPetIds(character));
    const present = new Set(owned
        .filter((pet) => carried.has(pet.id) && isPetAvailableForColosseum(pet, breeding))
        .map((pet) => pet.id));
    // A is away, B is training, C is breeding, and D falls beyond the carried
    // projection. All remain in the historical record without acting on screen.
    const resolved = resolveFirstPactCompanions(progress(), owned, present);
    assert.deepEqual(resolved.map((entry) => entry.available), [false, false, false, false]);
    assert.deepEqual(resolved.map((entry) => entry.historicalName), ["Cloud", "Tora", "Mori", "Suzu"]);
    const copy = firstPactEpilogueCompanionCopy(resolved);
    assert.doesNotMatch(copy, /cross with you/i);
    assert.match(copy, /Vey's copy keeps Cloud, Tora, Mori, and Suzu/);
    assert.doesNotMatch(firstPactAftermathScene("writ-silencing", progress(), resolved).lines.join(" "),
        /Cloud|Tora|Mori|Suzu/);
});

test("the explicit presence set permits only a carried nonbusy sealed companion", () => {
    const resolved = resolveFirstPactCompanions(progress(), pets, new Set(["c"]));
    assert.deepEqual(resolved.map((entry) => entry.available), [false, false, true, false]);
    const copy = firstPactEpilogueCompanionCopy(resolved);
    assert.match(copy, /Mori crosses with you/);
    assert.doesNotMatch(copy.split("Vey's copy")[0], /Cloud|Tora|Suzu/);
    assert.match(copy, /Vey's copy keeps Cloud, Tora, Mori, and Suzu/);
});

test("an old id-only save uses current names for presence but leaves history unknown", () => {
    const old = normalizeFirstPactProgress({
        ...progress(),
        mainQuest: { ...progress().mainQuest, pactCompanionNames: undefined },
    });
    const resolved = resolveFirstPactCompanions(old, pets);
    assert.deepEqual(resolved.map((entry) => entry.historicalName), [null, null, null, null]);
    const copy = firstPactEpilogueCompanionCopy(resolved);
    assert.match(copy, /Cloud, Tora, Mori, and Suzu cross with you/);
    assert.match(copy, /cannot recover the names/);
});

test("unavailable sealed companions are never assigned present-day movement", () => {
    const current = progress();
    const unavailable = resolveFirstPactCompanions(current, []);
    const scene = firstPactAftermathScene("writ-silencing", current, unavailable);
    assert.doesNotMatch(scene.lines.join(" "), /undefined|companion (?:backs|stays|stops|passes|waits)/i);
    assert.equal(firstPactCompanionEverydayLines("keeper-sena", current, unavailable).length, 0);
    assert.match(firstPactCompanionCourtLines({ ...current, mainStep: "challenge-court-echo" }, unavailable)[0], /Vey's copy names Cloud, Tora, Mori, and Suzu/i);
});

test("every proven result has a distinct inspectable return scene", () => {
    const current = progress();
    const resolved = resolveFirstPactCompanions(current, pets);
    const npcIds = ["bellwarden-isu", "market-rho", "garden-keeper", "kennel-hand", "keeper-sena"];
    const scenes = npcIds.map((npcId) => firstPactAftermathForNpc(npcId, current, resolved));
    assert.equal(scenes.every(Boolean), true);
    assert.equal(new Set(scenes.map((scene) => scene?.id)).size, 5);
    for (const scene of scenes) {
        assert.ok(scene);
        assert.equal(scene.lines.length, 3);
    }
    assert.match(firstPactAftermathScene("writ-audit", current, resolved).lines[0], /stock book/i);
});

test("the recorded vow changes recurring companion behavior without giving creatures speech", () => {
    for (const vow of ["open-road", "shared-reason", "kept-future"] as const) {
        const current = normalizeFirstPactProgress({
            ...progress(),
            mainQuest: { ...progress().mainQuest, pactVow: vow },
            mainStep: "challenge-court-echo",
            finalTrial: { wins: 2, battleProofs: ["1", "2"] },
        });
        const lines = firstPactCompanionCourtLines(current, resolveFirstPactCompanions(current, pets));
        assert.equal(lines.length, 2);
        assert.match(lines.join(" "), /Cloud/);
        assert.doesNotMatch(lines.join(" "), /“Cloud|Cloud says|Cloud tells/);
        const sena = firstPactCompanionEverydayLines("keeper-sena", current, resolveFirstPactCompanions(current, pets));
        assert.equal(sena.length, 1);
        assert.match(sena[0], /Cloud/);
        assert.doesNotMatch(sena[0], /Cloud says|Cloud tells/);
    }
});
