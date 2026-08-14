import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { huntTrailSector } from "./hunt-trail";
import { huntSignFor } from "./hunt-encounter";
import { playerSlug } from "./utils";
import { wandererFightPresentationFromContext, worldFightNeedsDurableFollowUp } from "./wanderer-fight";
import { serverHuntSign, serverHuntTrailSector } from "../../../api/missions/_hunt-trail";

const mission = {
    id: "hunt-punctuated-name",
    targetSector: 41,
    exploreCount: 4,
};

test("punctuated display names hash to the same hunt trail and sign as safeName", () => {
    const displayName = "Rill O'Neil!";
    const safe = playerSlug(displayName);
    assert.equal(safe, "rilloneil");
    for (let progress = 0; progress < mission.exploreCount; progress += 1) {
        assert.equal(
            huntTrailSector(mission as never, progress, safe),
            serverHuntTrailSector(mission as never, progress, safe),
        );
        const clientSign = huntSignFor(mission as never, progress, safe);
        const serverSign = serverHuntSign(mission.id, progress, safe);
        assert.equal(clientSign.id, serverSign.id);
        assert.deepEqual(
            clientSign.choices.map(({ id, outcome }) => ({ id, outcome })),
            serverSign.choices.map(({ id, outcome }) => ({ id, outcome })),
            `choice ids/outcomes drifted for ${clientSign.id}`,
        );
    }
});

test("hunt leads stay on authored contract ground while general World encounters retain sectors 61-66", () => {
    const candidates = Array.from({ length: 20 }, (_, progress) => huntTrailSector(
        { ...mission, exploreCount: 21 } as never,
        progress,
        "rill",
    ));
    assert.ok(candidates.every((sector) => sector >= 1 && sector <= 60));
    const serverWorld = readFileSync(new URL("../../../api/missions/_world-ai-fight.ts", import.meta.url), "utf8");
    assert.match(serverWorld, /const MAX_WORLD_SECTOR = MAX_WILD_SECTOR/,
        "general World encounter validation must retain the full shared 1..66 range");
    assert.match(serverWorld, /finiteInt\(value\.sector, 1, MAX_WORLD_SECTOR\)/);
});

test("server-sealed context reconstructs private-mode callback presentation", () => {
    const presentation = wandererFightPresentationFromContext("Rill", {
        kind: "hunt-pack",
        sourceId: "hunt-wolf",
        missionId: "hunt-wolf",
        sector: 17,
        stage: 2,
        chainId: "chain_12345678",
        decisionId: "hunt_decision",
        displayName: "Wolf Packmate",
        finalStage: true,
    });
    assert.deepEqual(
        {
            playerName: presentation.playerName,
            mode: presentation.mode,
            sourceId: presentation.sourceId,
            missionId: presentation.missionId,
            sector: presentation.sector,
            stage: presentation.stage,
        },
        {
            playerName: "Rill",
            mode: "huntPack",
            sourceId: "hunt-wolf",
            missionId: "hunt-wolf",
            sector: 17,
            stage: 2,
        },
    );
});

test("server-proved progression callbacks retain a post-report recovery marker", () => {
    const base = { outcome: "win" as const, character: null };
    assert.equal(worldFightNeedsDurableFollowUp({ ...base, worldContext: {
        kind: "questbook-boss", sourceId: "qb-caravan", sector: 20, stage: 1,
        displayName: "Captain Goro — Wave 1", finalStage: true,
    } }), true);
    assert.equal(worldFightNeedsDurableFollowUp({ ...base, worldContext: {
        kind: "story-reckoning", sourceId: "reckoning-rill", sector: 20, stage: 0,
        displayName: "Rill's Reckoning", finalStage: true,
    } }), true);
    assert.equal(worldFightNeedsDurableFollowUp({ ...base, worldContext: {
        kind: "wanderer-ambush", sourceId: "wanderer-ambush", sector: 20, stage: 3,
        displayName: "Bandit Warlord", finalStage: true, chainId: "chain_12345678",
    } }), true);
    assert.equal(worldFightNeedsDurableFollowUp({ outcome: "loss", character: null, worldContext: {
        kind: "questbook-boss", sourceId: "qb-caravan", sector: 20, stage: 1,
        displayName: "Captain Goro — Wave 1", finalStage: true,
    } }), false);
});

test("hunt calls always slug deterministic display-name hashes and honor authoritative sectors", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const board = readFileSync(new URL("../screens/HunterBoard.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(worldMap, /hunt(?:TrailSector|SignFor)\([^\n]*,\s*character\.name\s*\)/);
    assert.doesNotMatch(board, /huntTrailSector\([^\n]*,\s*character\.name\s*\)/);
    assert.match(worldMap, /huntTrailSector\([^\n]*playerSlug\(character\.name\)\)/);
    assert.match(board, /result\.state\?\.sector \?\? result\.nextSector/);
});

test("accepted legacy hunts reconcile through authoritative state before any sign or fight", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const hunt = worldMap.slice(worldMap.indexOf("async function huntSector"), worldMap.indexOf("async function resolveHuntChoice"));
    assert.match(hunt, /action: "state"/);
    assert.match(hunt, /authoritative\.acceptedMissionIds/);
    assert.match(hunt, /authoritative\.missionProgress/);
    assert.match(hunt, /authoritative\.migrated/);
    assert.match(hunt, /Trail recalibrated/);
});

test("WorldMap markers adopt the authoritative pending-pack decision sector across refresh", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    assert.match(worldMap, /const \[authoritativeHuntStates, setAuthoritativeHuntStates\]/);
    assert.match(worldMap, /sector: authoritative\?\.sector \?\? huntTrailSector/);
    assert.match(worldMap, /action: "state"/);
    assert.match(worldMap, /setAuthoritativeHuntStates\(next\)/);
    assert.match(worldMap, /trailState\.packPending && !trailState\.packSettled/);
    assert.match(worldMap, /launchHuntPackStage\(activeHuntMission, huntAi, 0, sector/);
});

test("sealed hunt target win unlocks explicit Guild turn-in while loss remains rematchable", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const target = worldMap.slice(worldMap.indexOf('if (p.mode === "huntTarget")'), worldMap.indexOf('if (p.mode === "questboss")'));
    assert.match(target, /if \(won && mission\)/);
    assert.match(target, /\[mission\.id\]: mission\.exploreCount/);
    assert.match(target, /Return to the Hunter Guild and turn in the contract/);
    assert.match(target, /else if \(!won\)/);
    assert.match(target, /final trail stays hot for a rematch/);
    const board = readFileSync(new URL("../screens/HunterBoard.tsx", import.meta.url), "utf8");
    assert.match(board, /progress < mission\.exploreCount/);
    assert.match(board, /postClaimMission\(character\.name, "hunt", mission\.id\)/);
});

test("pack settlement syncs the next authoritative lead and cannot replay a settled decision", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const pack = worldMap.slice(worldMap.indexOf('if (p.mode === "huntPack")'), worldMap.indexOf('if (p.mode === "huntTarget")'));
    assert.match(pack, /!won[\s\S]{0,180}syncHuntTrailAfterPack\(missionId\)/);
    assert.match(pack, /Guild still has the trail/);
    assert.match(pack, /last of the pack[\s\S]{0,280}trail reopens/);
    const choice = worldMap.slice(worldMap.indexOf("async function resolveHuntChoice"), worldMap.indexOf("function advanceHuntTrail"));
    assert.match(choice, /decision\.state\?\.packPending && !decision\.state\.packSettled/);
});

test("three-win quest boss stages expose each server-proved next wave", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const quest = worldMap.slice(worldMap.indexOf('if (p.mode === "questboss")'), worldMap.indexOf('if (p.mode === "storyReckoning")'));
    assert.match(quest, /worldAiContextWins/);
    assert.match(quest, /entry\.sealVersion === context\.sealVersion/);
    assert.match(quest, /waveWins < Math\.max\(1, stage\.count\)/);
    assert.match(quest, /Boss wave recorded:/);
    assert.match(quest, /clearPendingWorldFollowUp\(context\)/);
});

test("creator-event VN combat uses canonical practice without a second generic payout", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const start = worldMap.indexOf("function launchCreatorEventFight");
    const launch = worldMap.slice(start, worldMap.indexOf("if (activePetEncounter", start));
    assert.match(launch, /requestAiFight\(/);
    assert.match(launch, /battleKind: "practice"/);
    assert.doesNotMatch(launch, /battleKind: "world"|setScreen\(["']arena["']\)/);
});
