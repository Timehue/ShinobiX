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
    const lineStart = fileSource.lastIndexOf("\n", start) + 1;
    const indentation = fileSource.slice(lineStart, start).match(/^\s*/)?.[0] ?? "";
    const escapedIndentation = indentation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const remainder = fileSource.slice(start + 12);
    const nextMatch = remainder.match(new RegExp(`\\n${escapedIndentation}(?:async\\s+)?function\\s+`));
    const next = nextMatch?.index == null ? fileSource.length : start + 12 + nextMatch.index;
    return fileSource.slice(start, next);
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
        assertGuardBefore(shop, "buy", "shopPurchase", "fetch('/api/shop/purchase'");
        assertGuardBefore(shop, "openPack", "shopCardPack", "openCardPack(");

        const inventory = source("../screens/Inventory.tsx");
        assertGuardBefore(inventory, "consumeItem", "warCrateOpen", "openWarCrate(");
        assertGuardBefore(inventory, "sellSelectedItem", "inventorySale", "settleInventorySale(");

        const app = source("../App.tsx");
        assertGuardBefore(app, "enterHollowGateShrine", "hollowGateRun", "setHollowGateRun(");
        // The tile resolver was drained out of App.tsx into lib/hollow-gate-tile.ts
        // (2026-07-28) as a verbatim move, so the befriend guard now lives there. The
        // invariant is unchanged — only the file it has to hold in did.
        const hollowTile = source("./hollow-gate-tile.ts");
        const befriendGuard = hollowTile.indexOf('requireServerSettlement("hollowGatePetBefriend")');
        const befriendRequest = hollowTile.indexOf("befriendHollowGatePetServer(", befriendGuard);
        assert.ok(befriendGuard >= 0 && befriendRequest > befriendGuard, "Hollow Gate befriend must gate before requesting the server mutation");
        assert.doesNotMatch(hollowTile, /const updated = \{ \.\.\.character, pets:/, "Hollow Gate befriend must never mint a pet locally");

        const petYard = source("../screens/PetYard.tsx");
        assertGuardBefore(petYard, "startTraining", "petTraining", "runPetProgress(");
        assertGuardBefore(petYard, "collectTraining", "petTraining", "runPetProgress(");

        const attunement = source("../components/HollowGateAttunement.tsx");
        assertGuardBefore(attunement, "buy", "hollowGateAttunement", "buyHollowGateAttunementServer(");
        assertGuardBefore(attunement, "forge", "hollowGateKeyForge", "forgeHollowGateKey(");

        const hub = source("../screens/CentralHub.tsx");
        assertGuardBefore(hub, "forgeNamedWeapon", "creatorItemCraft", "setCreatorItems(");
        assertGuardBefore(hub, "forgeNamedArmor", "creatorItemCraft", "setCreatorItems(");
        assertGuardBefore(hub, "craftExistingWeapon", "creatorItemCraft", "forgeServer(");
        assertGuardBefore(hub, "craftExistingArmor", "creatorItemCraft", "forgeServer(");
        assertGuardBefore(hub, "craftRecipe", "creatorItemCraft", "forgeServer(");
        assertGuardBefore(hub, "craftHollowGateKeyWithDungeonKeys", "creatorItemCraft", "forgeHollowGateKeyServer(");
        assertGuardBefore(hub, "craftHollowGateKeyWithFateShards", "creatorItemCraft", "forgeHollowGateKeyServer(");
        assertGuardBefore(hub, "forgeRelicFromFragments", "creatorItemCraft", "forgeServer(");

        const missions = source("../screens/Missions.tsx");
        assertGuardBefore(missions, "acceptFetchMission", "fieldHuntMissions", "postFieldTrail(");
        const fieldTrailAdoptionStart = missions.indexOf("const adoptFieldTrail = useCallback");
        const fieldTrailAdoption = missions.slice(fieldTrailAdoptionStart, missions.indexOf("const acceptedFieldMissionKey", fieldTrailAdoptionStart));
        assert.match(fieldTrailAdoption, /!result\.character \|\| !onVersionedCharacter\(result\.character, result\._saveVersion\)/,
            "field contracts must adopt the versioned character before projecting acceptance");
        assert.match(fieldTrailAdoption, /result\.acceptedMissionIds[\s\S]*setAcceptedMissionIds\(result\.acceptedMissionIds\)/);
        assert.match(fieldTrailAdoption, /result\.missionProgress[\s\S]*setMissionProgress\(result\.missionProgress\)/);
        const fieldAccept = functionSlice(missions, "acceptFetchMission");
        const fieldAcceptRequest = fieldAccept.indexOf("await postFieldTrail(");
        const fieldAcceptAdoption = fieldAccept.indexOf("adoptFieldTrail(result)");
        const fieldAcceptSuccessBranches = fieldAccept.indexOf("if (!result.ok)");
        assert.ok(fieldAcceptRequest >= 0 && fieldAcceptAdoption > fieldAcceptRequest && fieldAcceptSuccessBranches > fieldAcceptAdoption,
            "field acceptance must adopt authoritative state before any success or reason branch");
        assertGuardBefore(missions, "claimFetchMission", "fieldHuntMissions", "postClaimMission(");
        const missionStart = functionSlice(missions, "startMissionBattle");
        const missionServerStart = missionStart.indexOf('fetch("/api/missions/combat-start"');
        const missionMount = missionStart.indexOf("setAuthoritativeFight(");
        assert.ok(missionServerStart >= 0 && missionMount > missionServerStart, "combat missions must receive a sealed server session before mounting a fight");
        assert.doesNotMatch(missionStart, /setPendingAiProfileId\(/, "combat missions must not fall back to the local AI profile path");

        const hunter = source("../screens/HunterBoard.tsx");
        assertGuardBefore(hunter, "rankUp", "fieldHuntMissions", "rankUpHunterServer(");
        assert.match(hunter, /onVersionedCharacter\(result\.character, result\._saveVersion\)/, "Hunter Rank must atomically adopt the versioned mutation");
        const hunterApi = source("./hunter-rank-api.ts");
        assert.match(hunterApi, /return \{ character: data\.character, _saveVersion: data\._saveVersion \}/, "the Hunter client must preserve the server save receipt");
        assertGuardBefore(hunter, "acceptHunt", "fieldHuntMissions", "setAcceptedMissionIds(");
        assert.match(functionSlice(hunter, "claimHunt"), /await claimHuntOnce\(mission\)/,
            "the single-flight Claim button must delegate to the guarded settlement");
        assertGuardBefore(hunter, "claimHuntOnce", "fieldHuntMissions", "postClaimMission(");

        const bank = source("../screens/Bank.tsx");
        assertGuardBefore(bank, "moveRyo", "bankDeposit", "fetch(\"/api/bank/transfer\"");

        // joinRankedQueue moved with the rest of the ranked queue lifecycle into
        // the Arena hook; the rankedPvp release gate must still precede the first
        // local mutation there.
        const rankedQueueHook = source("../features/arena/hooks/use-ranked-queue.ts");
        assertGuardBefore(rankedQueueHook, "joinRankedQueue", "rankedPvp", "setRankedQueueActive(");
        const rankedServer = source("../../../api/pvp/ranked-queue.ts");
        assert.match(rankedServer, /rankedPvpActionAllowedDuringSettlement\(action\)/);
        assert.doesNotMatch(rankedServer, /Ranked PvP is temporarily unavailable/);

        const appPvp = source("../App.tsx");
        assertGuardBefore(appPvp, "acceptChallengeGlobal", "pvpSession", "setProcessingChallengeIds(");
        assert.match(appPvp, /onAcceptChallenge=\{\(challenge\) => \{ void acceptChallengeGlobal\(challenge\); \}\}/,
            "the Arena lobby must delegate PvP acceptance to the guarded App handler");
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
        assertGuardBefore(training, "startPaidJutsuTraining", "timedJutsuTraining", "mutateJutsuRyoTraining(");
        assertGuardBefore(training, "completePaidJutsuTraining", "timedJutsuTraining", "mutateJutsuRyoTraining(");
        assertGuardBefore(training, "cancelPaidJutsuTraining", "timedJutsuTraining", "mutateJutsuRyoTraining(");
        assertGuardBefore(training, "finishWithRyo", "timedJutsuTraining", "mutateJutsuRyoTraining(");
        assertGuardBefore(training, "queueNextJutsuTraining", "timedJutsuTrainingQueue", "mutateJutsuRyoTraining(");
        assertGuardBefore(training, "cancelQueuedJutsuTraining", "timedJutsuTrainingQueue", "mutateJutsuRyoTraining(");

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
