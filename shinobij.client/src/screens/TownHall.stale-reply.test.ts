import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A player's writes are stored in order, but their replies can land in any
// order. When a later write's save version is adopted first, an earlier reply's
// commit is refused as stale and returns false, yet the server has already
// settled it (lib/player-save-coordinator reads the stored save back). These
// Town Hall and Clan Hall actions must finish their step on that refusal: an
// early return left "Open Gate", "Declare" and the claim buttons live, so a
// second press paid again, and dropped the confirmation the action had earned.
const townHall = readFileSync(new URL("./TownHall.tsx", import.meta.url), "utf8");
const clanHall = readFileSync(new URL("./ClanHall.tsx", import.meta.url), "utf8");

function handler(source: string, name: string): string {
    const start = source.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} is missing`);
    const end = source.slice(start + 1).search(/\n {4}(?:async )?function /);
    return end < 0 ? source.slice(start) : source.slice(start, start + 1 + end);
}

const REFUSAL_RETURNS = /!\s*onVersionedCharacter\([^()]*\)\)+\s*(?:return\b|\{\s*return\b)/;

test("Town Hall finishes a settled action when its reply is refused as stale", () => {
    for (const name of ["purchaseHollowGateUnlock", "donateVillageRyo", "donateVillageSpecial", "donateVillageItem",
        "sendVillageCurrency", "sendVillageItem", "declareChallenge", "supportVillageFocus"]) {
        const body = handler(townHall, name);
        assert.match(body, /onVersionedCharacter\(/, `${name} must still adopt the reply`);
        assert.doesNotMatch(body, REFUSAL_RETURNS, `${name} must not return when its settled reply is refused as stale`);
    }
    // The gate is open whatever the commit returns, so its button flips to Extend.
    assert.match(handler(townHall, "purchaseHollowGateUnlock"),
        /onVersionedCharacter\(data\.character, data\._saveVersion\);\s*updateVillageState\(addNotice\(notice, \{ \.\.\.state, hollowGateUnlockedUntil: until/);
    // A stale donation reply logs the donation but keeps the treasury already shown.
    for (const name of ["donateVillageRyo", "donateVillageSpecial", "donateVillageItem"]) {
        assert.match(handler(townHall, name), /treasury: current \? cleanVillageTreasury\(result\.treasury as Partial<VillageTreasury>\) : state\.treasury/);
    }
});

test("Clan Hall finishes a settled action when its reply is refused as stale", () => {
    for (const name of ["claimClanMission", "doClaimMentor", "leaveClan", "donateClanItem", "donateClanRations",
        "donateAllTerritoryScrollsToClan", "sendClanCurrency", "sendClanItem"]) {
        const body = handler(clanHall, name);
        assert.match(body, /onVersionedCharacter\(/, `${name} must still adopt the reply`);
        assert.doesNotMatch(body, REFUSAL_RETURNS, `${name} must not return when its settled reply is refused as stale`);
    }
    // A stale claim reply marks the mission claimed without dropping a newer claim,
    // and leaves the clan totals already shown (the Clan Exchange precedent).
    const claim = handler(clanHall, "claimClanMission");
    assert.match(claim, /setClaimedClanMissions\(\(prev\) => current \? result\.claimed : Array\.from\(new Set\(\[\.\.\.prev, \.\.\.result\.claimed\]\)\)\)/);
    assert.match(claim, /if \(current\) setClanData\(/);
    assert.match(claim, /alert\(`Clan mission reward claimed!/);
    // Leaving clears the local clan whatever the commit returns.
    assert.match(handler(clanHall, "leaveClan"), /if \(left\.character\) onVersionedCharacter\([\s\S]*?setClanData\(null\);/);
});
