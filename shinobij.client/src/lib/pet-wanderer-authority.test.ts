import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeModeById } from '../../../shared/runtime-mode-registry.js';

const root = process.cwd().endsWith('shinobij.client') ? join(process.cwd(), '..') : process.cwd();
const worldSource = readFileSync(join(root, 'shinobij.client', 'src', 'screens', 'WorldMap.tsx'), 'utf8');
const arenaSource = readFileSync(join(root, 'shinobij.client', 'src', 'screens', 'PetArena.tsx'), 'utf8');
const sessionSource = readFileSync(join(root, 'api', 'pet', '_wanderer-session.ts'), 'utf8');

function section(source: string, start: string, end: string): string {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `missing source section: ${start}`);
    return source.slice(from, to);
}

test('WorldMap sends exact natural context without pre-spending the cooldown', () => {
    const launch = section(worldSource, 'function startWandererPetDuel', 'function startWandererCardDuel');
    assert.doesNotMatch(launch, /coolWanderer\s*\(/);
    assert.match(launch, /wanderer:\s*\{\s*id:\s*w\.id,\s*sector:\s*selectedSector\s*\}/);
    assert.match(launch, /setPendingPetBattleOpponent/);
});

test('PetArena sends no competing opponent context and watches the sealed Showdown result', () => {
    // Bounded at `startBattle`, the function that now follows the mint. The old
    // boundary was `settleHollowGatePetBattle`, which is gone on purpose: Hollow
    // Gate settlement moved out of this screen entirely and into
    // HollowGatePetFight, and lib/hollow-gate-pet-fight-wiring.test.ts holds it
    // there. Bounding on a neighbour that was deliberately deleted would fail
    // this contract for a reason that has nothing to do with the wanderer.
    const mint = section(arenaSource, 'async function mintCasualPetBattleToken', 'async function startBattle');
    assert.match(mint, /opponent\.wanderer\s*\?\s*\{\s*wanderer:\s*opponent\.wanderer\s*\}/);
    assert.match(mint, /opponentName:[\s\S]*opponentPetIds/);
    assert.match(arenaSource, /<PetShowdownReplay[\s\S]*script=\{watchedDuel\.script\}/);
    assert.match(arenaSource, /Natural wanderer pet duel/);
    assert.match(arenaSource, /applyPetBattleSettlement\(data, battleScope, \[\]\)/);
});

test('only the natural pending context waits for a successful start path', () => {
    const effect = section(arenaSource, 'if (!pendingPetBattleOpponent || !selectedPet) return;', '// Challenger side:');
    assert.match(effect, /if \(!pendingPetBattleOpponent\.wanderer\) onPendingPetBattleStarted\?\.\(\)/);
    const start = section(arenaSource, 'async function startBattle', 'if (!pendingPetBattleOpponent || !selectedPet) return;');
    assert.match(start, /const finishStarted/);
    assert.match(start, /opponentOverride\?\.wanderer && pendingPetBattleOpponent\?\.wanderer/);
    assert.match(start, /onPendingPetBattleStarted\?\.\(\)/);
    assert.match(start, /return finishStarted\(\)/);
});

test('the immutable NX session is published before the wanderer cooldown claim', () => {
    const publish = sessionSource.indexOf('await kv.set(key, candidate, { nx: true');
    const claim = sessionSource.indexOf('await claimWandererUseCooldown(');
    assert.ok(publish >= 0 && claim > publish);
});

test('runtime registry names natural wanderer Showdown as no-progression', () => {
    const mode = runtimeModeById('pet-wanderer-showdown');
    assert.equal(mode?.authorityEngine, 'pet-showdown');
    assert.equal(mode?.rewardPolicy, 'none');
    assert.deepEqual(mode?.routes.map((route) => route.path), ['/pet/battle-start', '/pet/battle-result']);
});
