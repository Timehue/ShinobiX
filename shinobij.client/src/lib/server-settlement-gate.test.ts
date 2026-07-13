import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    SERVER_SETTLEMENT_STATUS,
    requireServerSettlement,
    type PendingServerSettlementAction,
} from "./server-settlement-gate.ts";

function source(relativeUrl: string): string {
    return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

function functionSlice(fileSource: string, name: string): string {
    const start = fileSource.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `${name} must exist`);
    const next = fileSource.indexOf("\n    function ", start + 12);
    return fileSource.slice(start, next === -1 ? fileSource.length : next);
}

function assertGuardBefore(
    fileSource: string,
    functionName: string,
    action: PendingServerSettlementAction,
    firstMutation: string,
): void {
    const body = functionSlice(fileSource, functionName);
    const guard = body.indexOf(`requireServerSettlement("${action}")`);
    const mutation = body.indexOf(firstMutation);
    assert.notEqual(guard, -1, `${functionName} must use the ${action} release gate`);
    assert.notEqual(mutation, -1, `${functionName} mutation marker must remain covered`);
    assert.ok(guard < mutation, `${functionName} must gate before ${firstMutation}`);
}

describe("server settlement policy", () => {
    test("every protected action has a completed server settlement", () => {
        const expected: PendingServerSettlementAction[] = [
            "profileStatRespec",
            "profileFateShardTitle",
            "shopPurchase",
            "shopCardPack",
            "inventorySale",
            "warCrateOpen",
            "clientWarCrateGrant",
            "fieldHuntMissions",
            "hollowGatePetBefriend",
            "hollowGateRun",
            "petTraining",
            "hollowGateAttunement",
            "hollowGateKeyForge",
            "creatorItemCraft",
            "timedJutsuTraining",
            "timedJutsuTrainingQueue",
            "bankDeposit",
            "rankedPvp",
            "pvpSession",
        ];
        assert.deepEqual(Object.keys(SERVER_SETTLEMENT_STATUS).sort(), expected.sort());
        for (const action of expected) {
            assert.equal(SERVER_SETTLEMENT_STATUS[action], true, `${action} readiness`);
        }

        let notice = "";
        assert.equal(requireServerSettlement("fieldHuntMissions", (message) => { notice = message; }), true);
        assert.equal(notice, "");
    });

    test("profile, shops, inventory, pets, attunement, and crafting gate before local writes", () => {
        const profile = source("../screens/Profile.tsx");
        assertGuardBefore(profile, "respecStats", "profileStatRespec", "runPaidProfileAction(");
        assertGuardBefore(profile, "purchaseTitle", "profileFateShardTitle", "runPaidProfileAction(");
        assert.ok((profile.match(/requireServerSettlement\("profileFateShardTitle"\)/g) ?? []).length >= 3);

        const shop = source("../components/Shop.tsx");
        assertGuardBefore(shop, "buy", "shopPurchase", "updateCharacter(");
        assertGuardBefore(shop, "openPack", "shopCardPack", "updateCharacter(");

        const inventory = source("../screens/Inventory.tsx");
        assertGuardBefore(inventory, "consumeItem", "warCrateOpen", "openWarCrate(");
        assertGuardBefore(inventory, "sellSelectedItem", "inventorySale", "updateCharacter(");

        const app = source("../App.tsx");
        assertGuardBefore(app, "enterHollowGateShrine", "hollowGateRun", "setHollowGateRun(");
        const befriendGuard = app.indexOf('requireServerSettlement("hollowGatePetBefriend")');
        const befriendWrite = app.indexOf("const updated = { ...character, pets:", befriendGuard);
        assert.ok(befriendGuard >= 0 && befriendWrite > befriendGuard, "Hollow Gate befriend must gate before adding a pet");

        const petYard = source("../screens/PetYard.tsx");
        assertGuardBefore(petYard, "startTraining", "petTraining", "updateCharacter(");
        assertGuardBefore(petYard, "collectTraining", "petTraining", "updateCharacter(");

        const attunement = source("../components/HollowGateAttunement.tsx");
        assertGuardBefore(attunement, "buy", "hollowGateAttunement", "buyHollowGateAttunementServer(");
        assertGuardBefore(attunement, "forge", "hollowGateKeyForge", "forgeHollowGateKey(");

        const hub = source("../screens/CentralHub.tsx");
        assertGuardBefore(hub, "forgeNamedWeapon", "creatorItemCraft", "setCreatorItems(");
        assertGuardBefore(hub, "forgeNamedArmor", "creatorItemCraft", "setCreatorItems(");
        assertGuardBefore(hub, "craftExistingWeapon", "creatorItemCraft", "updateCharacter(");
        assertGuardBefore(hub, "craftExistingArmor", "creatorItemCraft", "updateCharacter(");
        assertGuardBefore(hub, "craftRecipe", "creatorItemCraft", "updateCharacter(");
        assertGuardBefore(hub, "craftHollowGateKeyWithDungeonKeys", "creatorItemCraft", "updateCharacter(");
        assertGuardBefore(hub, "craftHollowGateKeyWithFateShards", "creatorItemCraft", "updateCharacter(");
        assertGuardBefore(hub, "forgeRelicFromFragments", "creatorItemCraft", "updateCharacter(");

        const missions = source("../screens/Missions.tsx");
        assertGuardBefore(missions, "acceptFetchMission", "fieldHuntMissions", "setAcceptedMissionIds(");
        assertGuardBefore(missions, "claimFetchMission", "fieldHuntMissions", "postClaimMission(");
        assertGuardBefore(missions, "startCreatorMissionBattle", "fieldHuntMissions", "setPendingAiProfileId(");

        const hunter = source("../screens/HunterBoard.tsx");
        assertGuardBefore(hunter, "rankUp", "fieldHuntMissions", "updateCharacter(");
        assertGuardBefore(hunter, "acceptHunt", "fieldHuntMissions", "setAcceptedMissionIds(");
        assertGuardBefore(hunter, "claimHunt", "fieldHuntMissions", "postClaimMission(");

        const bank = source("../screens/Bank.tsx");
        assertGuardBefore(bank, "moveRyo", "bankDeposit", "fetch(\"/api/bank/transfer\"");

        const arena = source("../screens/Arena.tsx");
        assertGuardBefore(arena, "joinRankedQueue", "rankedPvp", "setRankedQueueActive(");
        assertGuardBefore(arena, "acceptChallenge", "pvpSession", "setDuelChallenges(");
        const rankedServer = source("../../../api/pvp/ranked-queue.ts");
        assert.match(rankedServer, /rankedPvpActionAllowedDuringSettlement\(action\)/);
        assert.doesNotMatch(rankedServer, /Ranked PvP is temporarily unavailable/);

        const appPvp = source("../App.tsx");
        assertGuardBefore(appPvp, "acceptChallengeGlobal", "pvpSession", "setProcessingChallengeIds(");
        const sectorAttack = appPvp.indexOf("sectorAttackPlayer={async (opponent) => {");
        const sectorGuard = appPvp.indexOf('requireServerSettlement("pvpSession")', sectorAttack);
        const sectorFetch = appPvp.indexOf("fetch('/api/pvp/session'", sectorAttack);
        assert.ok(sectorAttack >= 0 && sectorGuard > sectorAttack && sectorFetch > sectorGuard, "sector player attacks must gate before session creation");

        const worldMap = source("../screens/WorldMap.tsx");
        assertGuardBefore(worldMap, "startPvpRaid", "pvpSession", "setCurrentSector(");
        const guardRaid = worldMap.indexOf("const guard = territoryGuards[0]");
        const guardGate = worldMap.lastIndexOf('requireServerSettlement("pvpSession")', guardRaid);
        assert.ok(guardRaid >= 0 && guardGate >= 0 && guardGate < guardRaid, "village-guard PvP must gate before session creation");

        const pvpSessionServer = source("../../../api/pvp/session.ts");
        assert.match(pvpSessionServer, /pvpSessionCreationAllowedDuringSettlement\(isAdmin: boolean\): boolean \{[\s\S]*return true;/);
        assert.doesNotMatch(pvpSessionServer, /PvP sessions are temporarily unavailable/);
    });

    test("timed jutsu training and background queue settlement cannot mutate locally", () => {
        const training = source("../screens/Training.tsx");
        assertGuardBefore(training, "startPaidJutsuTraining", "timedJutsuTraining", "updateCharacter(");
        assertGuardBefore(training, "completePaidJutsuTraining", "timedJutsuTraining", "updateCharacter(");
        assertGuardBefore(training, "cancelPaidJutsuTraining", "timedJutsuTraining", "updateCharacter(");
        assertGuardBefore(training, "finishWithRyo", "timedJutsuTraining", "updateCharacter(");
        assertGuardBefore(training, "queueNextJutsuTraining", "timedJutsuTrainingQueue", "updateCharacter(");
        assertGuardBefore(training, "cancelQueuedJutsuTraining", "timedJutsuTrainingQueue", "updateCharacter(");

        const queue = source("./jutsu-training-queue.ts");
        const gate = queue.indexOf('isServerSettlementReady("timedJutsuTrainingQueue")');
        const serverAdvance = queue.indexOf('mutateJutsuRyoTraining(playerName, "advance"', gate);
        assert.ok(gate >= 0 && serverAdvance > gate, "the background runner must gate before server reconciliation");
        assert.doesNotMatch(queue.slice(gate), /applyJutsuTrainingLevel\(/, "the runtime runner must not grant mastery locally");
    });

    test("war rewards settle on the server and fail closed with no network fallback", () => {
        const world = source("./world-state.ts");
        const pending = functionSlice(world, "claimPendingWarCrates");
        assert.ok(
            pending.indexOf('isServerSettlementReady("clientWarCrateGrant")') < pending.indexOf("const claimed ="),
            "cached war rewards must return before deriving a local payout",
        );

        const claimStart = world.indexOf("export async function claimServerWarCrates");
        const claimEnd = world.indexOf("export function applyWarCrateGrants", claimStart);
        const claim = world.slice(claimStart, claimEnd);
        assert.match(claim, /if \(!r\.ok\) continue;/);
        assert.doesNotMatch(claim, /if \(!r\.ok\)[^\n]*granted\.push/);
        assert.doesNotMatch(claim, /catch\s*\{[^}]*granted\.push/s);
        assert.match(world, /fetch\("\/api\/war\/claim-reward"/);
        assert.match(world, /export async function claimServerWarRewards/);

        const flag = source("./war-crate-flag.ts");
        assert.match(flag, /warCrateServerAuthEnabled\(\): boolean \{\s*return true;/);
        assert.doesNotMatch(flag, /localStorage|getItem|setItem/);

        const app = source("../App.tsx");
        assert.match(app, /villageWarRaid\.warCrate && !warCrateServerAuthEnabled\(\)/);
        const villageWar = source("../screens/VillageWarScreen.tsx");
        assert.match(villageWar, /fetch\("\/api\/village\/claim-war-crate"/);
        assert.doesNotMatch(villageWar, /inventory:\s*\[\.\.\.character\.inventory,\s*LEGENDARY_WAR_CRATE_ID\]/);
    });
});
