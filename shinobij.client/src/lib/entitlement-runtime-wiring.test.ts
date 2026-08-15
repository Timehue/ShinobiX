import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const app = source("../App.tsx");
const arena = source("../screens/Arena.tsx");
const petArena = source("../screens/PetArena.tsx");
const dungeon = source("../screens/Dungeon.tsx");
const coop = source("../components/ArenaCoopLobby.tsx");
const clanWar = source("../screens/ClanWarPetBattle.tsx");
const sectorWar = source("../screens/SectorWarPetBattle.tsx");
const storyBoss = source("../screens/StoryBoss.tsx");
const petLadder = source("../screens/PetLadder.tsx");

test("outgoing and public Arena pet challenges consume entitlement-projected pets", () => {
    assert.match(arena, /const combatEligiblePets = activeCarriedPets<Pet>\(character\)/);

    const challenge = arena.slice(arena.indexOf("async function challengePlayer"), arena.indexOf("function startTournament"));
    assert.match(challenge, /availablePetBattleCount\(combatEligiblePets\)/);
    assert.match(challenge, /publicEligiblePets\(knownPetTarget\)/);
    assert.doesNotMatch(challenge, /knownPetTarget\.character\.pets/);

    assert.match(petArena, /const combatEligiblePets = activeCarriedPets<Pet>\(character\)/);
    assert.match(petArena, /publicEligiblePets\(targetRecord\)/);
    assert.match(petArena, /publicEligiblePets\(player\)\.filter/);
});

test("shared pet combat entry points consume the active carried projection", () => {
    assert.match(dungeon, /const eligiblePets = activeCarriedPets<Pet>\(character\)/);
    assert.doesNotMatch(dungeon, /character\.pets/);
    assert.match(coop, /activeCarriedPets\(character\)\.filter/);
    assert.match(clanWar, /pets=\{activeCarriedPets\(character\)\}/);
    assert.match(sectorWar, /pets=\{activeCarriedPets\(character\)\}/);
    assert.match(storyBoss, /const activeBattlePet = activeCarriedPets<Pet>\(character\)\.find/);
    assert.match(petLadder, /const available = activeCarriedPets<Pet>\(character\)\.filter/);
});

test("global pet challenge acceptance never selects from raw ownership", () => {
    const accept = app.slice(app.indexOf("async function acceptPetChallengeGlobal"), app.indexOf("async function acceptChallengeGlobal"));
    assert.match(accept, /const myEligiblePets = activeCarriedPets<Pet>\(character\)/);
    assert.doesNotMatch(accept, /character\.pets\.(?:find|filter)/);
});
