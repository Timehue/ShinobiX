import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeModeById } from '../../../shared/runtime-mode-registry.js';

/*
 * A road beast has exactly one fight: the Colosseum duel that fields the
 * species the World Map showed (shared/wanderer-beast.ts, api/pet/_wanderer-
 * showdown.ts). Pet Arena's older wanderer duel through battle-start is
 * retired, and these pin every client door that could reach it shut.
 */

const root = process.cwd().endsWith('shinobij.client') ? join(process.cwd(), '..') : process.cwd();
const worldSource = readFileSync(join(root, 'shinobij.client', 'src', 'screens', 'WorldMap.tsx'), 'utf8');
const arenaSource = readFileSync(join(root, 'shinobij.client', 'src', 'screens', 'PetArena.tsx'), 'utf8');
const showdownSource = readFileSync(join(root, 'shinobij.client', 'src', 'screens', 'PetShowdown.tsx'), 'utf8');
const dialogSource = readFileSync(join(root, 'shinobij.client', 'src', 'components', 'WorldWandererDialog.tsx'), 'utf8');
const appSource = readFileSync(join(root, 'shinobij.client', 'src', 'App.tsx'), 'utf8');

function section(source: string, start: string, end: string): string {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `missing source section: ${start}`);
    return source.slice(from, to);
}

test('WorldMap sends exact natural context, under the beast\'s own name, without pre-spending the cooldown', () => {
    const launch = section(worldSource, 'function startWandererPetDuel', 'function startWandererCardDuel');
    assert.doesNotMatch(launch, /coolWanderer\s*\(/);
    assert.match(launch, /wanderer:\s*\{\s*id:\s*w\.id,\s*sector:\s*selectedSector\s*\}/);
    assert.match(launch, /owner:\s*w\.name/);
    assert.match(launch, /setPendingPetBattleOpponent/);
    assert.match(launch, /setScreen\("petColiseum"\)/);
});

test('a pending road beast reaches the Colosseum and never the Pet Arena', () => {
    // A failed Colosseum start leaves the beast pending, and Pet Arena
    // auto-starts any pending opponent on mount, so a detour through Pet Home
    // must not hand it the beast.
    const arena = section(appSource, 'screen === "petArena" && character && <PetArena', '/>}');
    assert.match(arena, /pendingPetBattleOpponent=\{pendingPetBattleOpponent\?\.wanderer \? null : pendingPetBattleOpponent\}/);
    const coliseum = section(appSource, 'screen === "petColiseum" && character && <PetShowdown', '/>}');
    assert.match(coliseum, /pendingWanderer=\{pendingPetBattleOpponent\?\.wanderer \? pendingPetBattleOpponent : null\}/);
    // And Pet Arena itself refuses one, should anything else ever pass it.
    assert.match(arenaSource, /if \(!pendingPetBattleOpponent \|\| pendingPetBattleOpponent\.wanderer \|\| !selectedPet\) return;/);
});

test('Pet Arena no longer has a wanderer duel of its own', () => {
    const mint = section(arenaSource, 'async function mintCasualPetBattleToken', 'async function startBattle');
    assert.doesNotMatch(mint, /wanderer/i);
    assert.match(mint, /opponentName:[\s\S]*opponentPetIds/);
    assert.doesNotMatch(arenaSource, /Natural wanderer pet duel|Roaming AI|finishStarted/);
});

test('the Colosseum chip names the beast, not a stand-in label', () => {
    // enemyTeamName is the server's own name for the beast; a road fight
    // passes no eventLabel, so the chip falls through to it.
    assert.match(showdownSource, /eventLabel=\{!roadChallenge && rememberedCircuitTrial/);
    assert.doesNotMatch(showdownSource, /roadOpponentName|Roaming AI/);
});

test('a wild beast does not offer to talk about the road', () => {
    const beast = section(dialogSource, 'wandererDialog.w.verb === "petDuel" ? (', ') : !wandererDialog.msg && wandererDialog.w.verb === "gamble"');
    assert.match(beast, /startWandererPetDuel/);
    assert.doesNotMatch(beast, /askRoadRumor/);
});

test('runtime registry names the natural wanderer fight as the Colosseum, with no rewards', () => {
    const mode = runtimeModeById('pet-wanderer-showdown');
    assert.equal(mode?.authorityEngine, 'pet-showdown');
    assert.equal(mode?.rewardPolicy, 'none');
    assert.deepEqual(mode?.routes.map((route) => route.path), ['/pet/showdown']);
});
