import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A player's writes are stored in order, but their replies can land in any
// order. When a later write's save version is adopted first, an earlier reply's
// commit is refused as stale and returns false, yet the server has already paid
// it (lib/player-save-coordinator reads the stored save back). Claims and world
// rewards must finish their step on that refusal instead of returning.
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const missions = read("./Missions.tsx");
const hunterBoard = read("./HunterBoard.tsx");
const logbook = read("./Logbook.tsx");
const worldMap = read("./WorldMap.tsx");

function handler(source: string, name: string): string {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, `${name} is missing`);
    const end = source.slice(start + 1).search(/\n {4}(?:async )?function /);
    return end < 0 ? source.slice(start) : source.slice(start, start + 1 + end);
}

const REFUSAL_RETURNS = /!\s*onVersionedCharacter\([^()]*\)\)+\s*(?:return\b|\{\s*return\b)/;

test("a paid Mission Hall, Hunter Guild or Logbook claim finishes even when its commit is refused", () => {
    for (const [file, source] of [["Missions", missions], ["HunterBoard", hunterBoard], ["Logbook", logbook]] as const) {
        assert.match(handler(source, "applySuccessfulMissionClaim"), /\): void \{/, `${file}: the claim helper no longer reports the commit to its callers`);
        assert.doesNotMatch(source, /if \(!applySuccessfulMissionClaim\(/, `${file}: a refused commit must not stop the claim's step`);
    }
    // Each caller still clears the card and shows what was paid.
    assert.match(handler(missions, "claimFetchMission"), /applySuccessfulMissionClaim\(result\);\s*setAcceptedMissionIds\(/);
    assert.match(handler(hunterBoard, "claimHuntOnce"), /applySuccessfulMissionClaim\(result\);\s*setAcceptedMissionIds\(/);
    assert.match(handler(logbook, "claimMissionOnce"), /applySuccessfulMissionClaim\(result\);\s*setAcceptedMissionIds\(/);
});

test("a settled village-war mission spends its war-damage token even when its commit is refused", () => {
    const claim = handler(logbook, "claimWarMission");
    assert.doesNotMatch(claim, REFUSAL_RETURNS);
    assert.match(claim, /onVersionedCharacter\(settled\.character, settled\.saveVersion\);\s*const war = (?:await )?applyVillageWarMissionDamage\(settled\.character, settled\.warMissionToken\);/);
});

test("world rewards finish when their reply is refused as stale", () => {
    for (const name of ["claimAmbushReward", "claimWandererQuest", "abandonWandererQuest", "settleDiscoveredChest"]) {
        const body = handler(worldMap, name);
        assert.match(body, /onVersionedCharacter\(/, `${name} must still adopt the reply`);
        assert.doesNotMatch(body, REFUSAL_RETURNS, `${name} must not stop when its reply is refused as stale`);
    }
    // The ambush loot reports claimed (clearing the pending marker) and the chest opens.
    assert.match(handler(worldMap, "claimAmbushReward"), /onVersionedCharacter\(d\.character, d\._saveVersion\);[\s\S]*?return true;/);
    assert.match(handler(worldMap, "settleDiscoveredChest"), /onVersionedCharacter\(chest\.character, chest\.saveVersion\);(?: *\/\/[^\n]*)?\s*completeWorldRewardOperation\([\s\S]*?setActiveChest\(chest\.loot\);[\s\S]*?return "settled";/);
});
