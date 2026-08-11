import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const arena = source("../screens/Arena.tsx");
const app = source("../App.tsx");
const dungeon = source("../screens/Dungeon.tsx");
const coop = source("../components/ArenaCoopLobby.tsx");
const clanWar = source("../screens/ClanWarPetBattle.tsx");
const sectorWar = source("../screens/SectorWarPetBattle.tsx");
const petArena = source("../screens/PetArena.tsx");
const petYard = source("../screens/PetYard.tsx");
const loadout = source("../components/JutsuLoadoutPanel.tsx");
const profile = source("../screens/Profile.tsx");
const profileCss = source("../styles/profile-skin.css");
const petYardCss = source("../styles/index/05-pet-yard.css");

test("local Arena combat consumes only active jutsu and carried pets", () => {
    const actionList = arena.slice(arena.indexOf("const equippedJutsus"), arena.indexOf("const combatItemSlots"));
    assert.match(actionList, /activeJutsuLoadoutIds\(character\)/);
    assert.doesNotMatch(actionList, /character\.equippedJutsuIds/);
    assert.match(arena, /const activeBattlePet = combatEligiblePets\.find/);

    const challenge = arena.slice(arena.indexOf("async function challengePlayer"), arena.indexOf("function declineChallenge"));
    assert.match(challenge, /availablePetBattleCount\(combatEligiblePets\)/);
    assert.match(challenge, /publicEligiblePets\(knownPetTarget\)/);
    assert.doesNotMatch(challenge, /knownPetTarget\.character\.pets/);
});

test("local and shared pet pickers consume the active carried projection", () => {
    assert.match(dungeon, /const eligiblePets = activeCarriedPets<Pet>\(character\)/);
    assert.doesNotMatch(dungeon, /character\.pets/);
    assert.match(coop, /activeCarriedPets\(character\)\.filter/);
    assert.match(clanWar, /pets=\{activeCarriedPets\(character\)\}/);
    assert.match(sectorWar, /pets=\{activeCarriedPets\(character\)\}/);

    const accept = app.slice(app.indexOf("async function acceptPetChallengeGlobal"), app.indexOf("async function acceptChallengeGlobal"));
    assert.match(accept, /const myEligiblePets = activeCarriedPets<Pet>\(character\)/);
    assert.doesNotMatch(accept, /character\.pets\.find|character\.pets\.filter/);
});

test("rewarded Warfront waits for and settles the server-issued battle seal", () => {
    const start = petArena.slice(
        petArena.indexOf("async function startRewardedWarfrontMatch"),
        petArena.indexOf("async function redeemTacticalArenaResult"),
    );
    const bodyStart = start.indexOf("body: JSON.stringify({");
    const bodyEnd = start.indexOf("}),", bodyStart);
    assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, "Warfront start request body must remain inspectable");
    const requestBody = start.slice(bodyStart, bodyEnd);
    assert.doesNotMatch(requestBody, /\bseed\b|\breportKey\b/, "the client must never choose a rewarded seed or report key");
    assert.match(start, /typeof data\?\.token !== "string"/);
    assert.match(start, /typeof data\?\.reportKey !== "string"/);
    assert.match(start, /Number\.isSafeInteger\(seed\)/);
    assert.match(start, /warfrontRewardSeal\.current = \{ token: data\.token, reportKey: data\.reportKey, seed \}/);

    const redeem = petArena.slice(
        petArena.indexOf("async function redeemTacticalArenaResult"),
        petArena.indexOf("async function sendArenaChallenge"),
    );
    assert.match(redeem, /outcome,/);
    assert.match(redeem, /reportKey: seal\.reportKey/);
    assert.match(redeem, /battleToken: seal\.token/);
    assert.match(petArena, /winner === "blue" \? "win" : winner === "red" \? "loss" : "draw"/);
    assert.match(petArena, /allowReseed=\{false\}/);
});

test("Pet Arena ships only the active continuous-duel presentation", () => {
    assert.match(petArena, /const PetColiseumDuel = lazyWithRetry/);
    assert.doesNotMatch(petArena, /const PetColiseum =|battleFrames|petFramePace/);
});

test("pet selection, expedition claim, and loadout ordering remain keyboard-sized", () => {
    const roster = petYard.slice(petYard.indexOf('<div className="pet-slots-row">'), petYard.indexOf("{selectedPet ?"));
    assert.match(roster, /<button[\s\S]*?className=\{`pet-slot-card/);
    assert.match(roster, /aria-pressed=/);
    assert.doesNotMatch(roster, /pet-ready-tag" onClick=/);
    assert.match(petYardCss, /\.pet-slot-card:focus-visible\s*\{[^}]*outline:/s);
    assert.match(petYardCss, /\.pet-yard-screen \.training-complete button\s*\{[^}]*min-height:\s*var\(--touch-target-min\)/s);

    assert.match(loadout, /className="jutsu-slot-order-controls"/);
    assert.match(loadout, /jutsu-loadout-reorder-help/);
    assert.match(loadout, /jutsu-dormant-bulk-copy/);
    assert.match(profileCss, /\.jutsu-slot-order-controls button\s*\{[^}]*min-width:\s*var\(--touch-target-min\)[^}]*min-height:\s*var\(--touch-target-min\)/s);
    assert.match(profile, /activeJutsuLoadoutIds\(character\)\.length/);
    assert.match(profile, /dormant Supporter preference/);
});
