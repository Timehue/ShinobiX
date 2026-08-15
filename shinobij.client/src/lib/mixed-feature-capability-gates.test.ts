import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

function between(text: string, start: string, end: string): string {
    const from = text.indexOf(start);
    assert.notEqual(from, -1, `missing source boundary: ${start}`);
    const to = text.indexOf(end, from + start.length);
    assert.notEqual(to, -1, `missing source boundary: ${end}`);
    return text.slice(from, to);
}

describe("mixed-feature public capability wiring", () => {
    it("fails Clan Boss core closed while retaining party-off solo and recovery paths", () => {
        const hall = source("../screens/ClanHall.tsx");
        const boss = source("../screens/ClanBoss.tsx");
        const api = source("./clan-boss-api.ts");

        assert.match(hall, /const bossTabAvailability = useCapabilityViewAvailability\("clanBoss"\)/);
        assert.match(hall, /const bossTabEnabled = bossTabAvailability === "available"/);
        assert.match(hall, /bossTabAvailability === "unavailable" && view === "boss"[\s\S]*setView\("exchange"\)/);
        assert.match(hall, /\{bossTabEnabled && <button[\s\S]*>Boss<\/button>\}/);
        assert.match(hall, /view === "boss" && bossTabAvailability !== "unavailable" && <ClanBoss/);
        assert.doesNotMatch(api, /clanBoss\.v1|clanBossEnabled/);

        assert.match(boss, /useCapabilityViewAvailability\("clanBoss"\)/);
        assert.match(boss, /useCapabilityViewAvailability\("clanBossParties"\)/);
        assert.match(boss, /useCapabilityMutationAvailability\("clanBoss"\)/);
        assert.match(boss, /useCapabilityMutationAvailability\("clanBossParties"\)/);
        assert.match(boss, /partiesAvailable \? fetchClanBossParty\(character\.name\) : Promise\.resolve\(null\)/);
        const partyPoll = between(boss, "useEffect(() => {\n        if (!clanBossAvailable || !partiesUsable) return;", "}, [character.name, clanBossAvailable, partiesUsable]);");
        assert.match(partyPoll, /fetchClanBossParty/);
        const recoveryPoll = between(boss, "useEffect(() => {\n        if (!clanBossAvailable || fight) return;", "}, [character.name, clanBossAvailable, fight]);");
        assert.match(recoveryPoll, /fetchMyRun/);
        assert.doesNotMatch(recoveryPoll, /partiesAvailable/);
        assert.match(boss, /partyState\?\.errorCode === "parties-disabled"/);
        assert.match(boss, /const soloCompatibility = !partiesUsable/);
        assert.match(boss, /const party = partiesUsable \? partyState\?\.party : undefined/);
        assert.match(boss, /if \(fight && !clanBossActionsAvailable\)/);
        assert.match(boss, /Status and accepted-operation recovery remain available/);
    });

    it("gates breeding starts separately while keeping session reads and hatch recovery visible", () => {
        const home = source("../screens/Home.tsx");
        const barn = source("../components/PetBreedingBarn.tsx");

        assert.match(home, /<PetBreedingBarn/);
        assert.match(barn, /useCapabilityViewAvailability\(\)/);
        assert.match(barn, /useCapabilityMutationAvailability\("petBreedingStarts"\)/);
        assert.match(barn, /useCapabilityMutationAvailability\(\)/);
        assert.match(barn, /const canStart = breedingStartsAvailable && pairingEligible/);
        const confirmStart = between(barn, "async function confirmStart()", "async function hatch()");
        assert.ok(confirmStart.indexOf("!breedingStartsAvailable") < confirmStart.indexOf("startPetBreeding("));
        assert.ok(confirmStart.indexOf('mutationAvailability("petBreedingStarts")') < confirmStart.indexOf("startPetBreeding("));
        const hatch = between(barn, "async function hatch()", "const complete =");
        assert.match(hatch, /hatchPetBreeding/);
        assert.doesNotMatch(hatch, /breedingStartsAvailable/);
        assert.ok(hatch.indexOf("breedingRecoveryActionsAvailable") < hatch.indexOf("hatchPetBreeding("));
        assert.ok(hatch.indexOf("mutationAvailability()") < hatch.indexOf("hatchPetBreeding("));
        assert.match(barn, /if \(!breedingReadAvailable\) return;[\s\S]*window\.setTimeout\(\(\) => void refresh\(controller\.signal\), 0\)/, "one initial reconciliation read remains available for stale or cross-device sessions");
        assert.match(barn, /if \(!breedingReadAvailable \|\| !trackedSessionId\) return;[\s\S]*window\.setInterval/);
        assert.match(barn, /BreedingCountdown[\s\S]*onElapsed=\{\(\) => void refresh\(\)\}/);
        assert.match(barn, /Hatching is paused, but this egg and its bond progress remain safe and visible/);
    });

    it("uses the shared Legacy capability without probing definitions for availability", () => {
        const legacy = source("./legacy.ts");
        const hall = source("../screens/HallOfLegends.tsx");
        const briefing = source("../components/DailyBriefingModal.tsx");
        const profile = source("../screens/Profile.tsx");
        const tavern = source("../screens/VillageTavern.tsx");
        const userView = source("../screens/UserView.tsx");

        assert.match(legacy, /useCapabilityViewAvailability\("legacy"\)/);
        assert.match(legacy, /useCapabilityMutationAvailability\("legacy"\)/);
        assert.match(legacy, /capabilityViewAvailability\(liveCapabilitiesStore\.getSnapshot\(\), "legacy"\)/);
        assert.match(legacy, /capabilityMutationAvailability\(liveCapabilitiesStore\.getSnapshot\(\), "legacy"\)/);
        assert.doesNotMatch(legacy, /legacyProbe|legacyAvailabilityListeners|fetchLegacyDefinitions\(\)\.then/);

        assert.match(hall, /LEGACY_HALL_TABS = new Set<LbTab>\(\["legends", "news", "eras"\]\)/);
        assert.match(hall, /!legacyAvailable && LEGACY_HALL_TABS\.has\(selectedTab\) \? "ranked" : selectedTab/);
        assert.match(hall, /if \(!legacyAvailable \|\| \(tab !== "legends"/);
        for (const tab of ["ranked", "kills", "weeklyBoss", "professions"]) {
            assert.match(hall, new RegExp(`\\{ id: "${tab}"`));
        }

        assert.match(briefing, /if \(!shouldShow \|\| !legacyAvailable\) return;/);
        assert.match(briefing, /\{legacyAvailable && activeEra/);
        assert.match(briefing, /\{legacyAvailable && worldNews\.length/);
        assert.match(briefing, /\{legacyAvailable && rumor/);

        assert.doesNotMatch(profile, /isLegacyServerLive/);
        assert.match(profile, /const legacyLive = legacyAvailable/);
        assert.match(profile, /const legacyActionsAvailable = useLegacyMutationAvailability\(\)/);
        const stylePurchase = between(profile, "async function purchaseTitleStyle", "async function purchaseTitleIcon");
        assert.ok(stylePurchase.indexOf('mutationAvailability("legacy")') < stylePurchase.indexOf("purchase-title-style"));
        assert.match(stylePurchase, /gameConfirm[\s\S]*mutationAvailability\("legacy"\)[\s\S]*purchase-title-style/);
        assert.match(profile, /disabled=\{profileMutationBusy \|\| !legacyActionsAvailable\}/);
        assert.match(profile, /Legacy title purchases are temporarily paused\. Your current title remains visible/);
        assert.doesNotMatch(tavern, /isLegacyServerLive/);
        assert.match(tavern, /const legacyAvailable = useLegacyAvailability\(\)/);
        assert.match(userView, /if \(!legacyAvailable \|\| !viewedLegacyId\) return;/);
    });

    it("presents Weekly Boss guard-cycle status without gating the core fight", () => {
        const arena = source("../screens/WeeklyBossArena.tsx");
        assert.match(arena, /useCapabilityViewAvailability\("weeklyBossGuardCycle"\)/);
        assert.match(arena, /useCapabilityViewAvailability\(\)/);
        assert.match(arena, /useCapabilityMutationAvailability\(\)/);
        assert.match(arena, /guard cycle is temporarily disabled\. The core fight remains available/);
        const launch = between(arena, "async function launchAuthoritativeFight()", "async function recoverAuthoritativeFight");
        const recovery = between(arena, "async function recoverAuthoritativeFight()", "async function settleAuthoritativeFight");
        assert.match(launch, /kind: "startFight"/);
        assert.ok(launch.indexOf("weeklyBossActionsAvailable") < launch.indexOf('kind: "startFight"'));
        assert.ok(launch.indexOf("mutationAvailability()") < launch.indexOf('kind: "startFight"'));
        assert.match(launch, /kind: "startFight", weekKey: bossState\?\.weekKey/);
        assert.doesNotMatch(launch, /guardCycleAvailability/);
        assert.match(recovery, /capabilityAdmissionAllowed\(viewAvailability\(\)\)[\s\S]*recoverFight=1&weekKey=/);
        assert.match(recovery, /weekly-boss-recovery-needs-finalization[\s\S]*capabilityAdmissionAllowed\(mutationAvailability\(\)\)[\s\S]*kind: "resumeFight"/);
        assert.doesNotMatch(arena, /if \(fight && !weeklyBossActionsAvailable\)/, "a mutation freeze must not unmount the accepted fight");
        assert.match(arena, /if \(fight\)[\s\S]*!weeklyBossActionsAvailable[\s\S]*accepted fight stays mounted[\s\S]*<WeeklyBossFight/);
        assert.match(arena, /const acceptedFightRecoveryNeeded = lockedOut \|\| staminaBlocked \|\| !weeklyBossActionsAvailable/);
        assert.match(arena, /acceptedFightRecoveryNeeded && \([\s\S]*disabled=\{startingFight \|\| !weeklyBossViewOpen\}[\s\S]*Check for interrupted fight/);
        assert.doesNotMatch(arena, />Resume accepted fight</, "the probe must not claim a run exists before the server confirms it");
        assert.match(arena, /disabled=\{startingFight \|\| !weeklyBossActionsAvailable \|\| expired \|\| lockedOut \|\| contributionDisabled \|\| staminaBlocked\}/);
    });

    it("keeps cached World Map operations visible but blocks fresh Village War, ANBU, and Legacy mutations", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        const sageModal = source("../components/SageOfferModal.tsx");
        const wandererDialog = source("../components/WorldWandererDialog.tsx");

        assert.match(worldMap, /useCapabilityViewAvailability\("villageWar"\)/);
        assert.match(worldMap, /useCapabilityMutationAvailability\("villageWar"\)/);
        assert.match(worldMap, /useCapabilityViewAvailability\("anbuInfiltration"\)/);
        assert.match(worldMap, /useCapabilityMutationAvailability\("anbuInfiltration"\)/);
        const mercenaryAdmission = between(worldMap, "async function engageRoamingMerc", "function dismissWandererDialog");
        assert.ok(mercenaryAdmission.indexOf('mutationAvailability("villageWar")') < mercenaryAdmission.indexOf("engageMerc("));
        assert.match(worldMap, /mutationAvailability\("anbuInfiltration"\)[\s\S]*setVaultRaid\(vaultPrompt\)/);
        assert.match(worldMap, /vaultRaid && createPortal\([\s\S]*anbuAdmissionOpen \? \([\s\S]*<AnbuVaultRaid[\s\S]*ANBU operation paused[\s\S]*vault run remains recoverable/);
        assert.match(worldMap, /if \(legacyAvailable\) return;[\s\S]*setSageOffer\(null\);[\s\S]*setSageVnEvent\(null\);[\s\S]*setSageChoiceOpen\(false\)/);
        assert.match(worldMap, /legacyAvailable && sageChoiceOpen && sageOffer/);
        assert.match(worldMap, /const wandererLegacyTrial = legacyAvailable && character\.legacy && wandererDialogEmissary/);
        assert.match(worldMap, /legacyTrial=\{wandererLegacyTrial\}/);
        assert.doesNotMatch(wandererDialog, /\b(?:legacyAvailable|mutationAvailability|capabilityAdmissionAllowed|EmissaryTrialPanel)\b/);
        assert.match(worldMap, /actionsAllowed=\{legacyActionsAvailable\}/);
        assert.match(worldMap, /canMutate=\{\(\) => capabilityAdmissionAllowed\(mutationAvailability\("legacy"\)\)\}/);
        assert.match(sageModal, /if \(!actionsAllowed \|\| !canMutate\(\)\)/);
    });
});
