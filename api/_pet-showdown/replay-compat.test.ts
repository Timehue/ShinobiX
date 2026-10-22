import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWarDuel, type WarDuelInput } from './war-duel.js';
import { PET_CATALOG } from '../pet/_catalog.js';
import { resolvePvpPetDuel, isPvpPetDuelSeal, type PvpPetDuelSeal } from '../pet/_pvp-duel.js';
import { clanWarPetDuelScript, normalizeClanWarPetSession } from '../clan/war/_pet-duel.js';
import { createShowdownSession, resolveShowdownRound, showdownStateView } from './engine.js';
import { resolveShowdownHeadless } from './headless.js';
import type { Pet } from '../_pet-sim/pet-types.js';

const pet = (species: string, id: string, level: number): Pet => ({ ...structuredClone(PET_CATALOG[species]), id, templateId: species, level }) as unknown as Pet;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Captured by running the original engine, AI, numeric contract, growth and
// loadout sources from the pre-progression revision, including full state/logs.
const historicalCases: Array<{ input: WarDuelInput; sha256: string }> = [
    { input: { sessionId: 'retained-proof-early', seed: 727, fromName: 'A', toName: 'B', fromPets: [pet('standard-0', 'a', 1)], toPets: [pet('standard-1', 'b', 1)] }, sha256: 'ed46340eed1b02c742c6384371c5857868d6e1bbc315055cdcb9e5427d104a35' },
    { input: { sessionId: 'retained-proof-team', seed: 991, fromName: 'A', toName: 'B', fromPets: [pet('rare-0', 'a', 75), pet('standard-0', 'c', 50)], toPets: [pet('rare-1', 'b', 75), pet('standard-1', 'd', 50)], terrain: 'forest' }, sha256: 'e240188f1c97899c571ca06df55ec4ecd11740ee9eb54ce358c20b987d9f3479' },
];

for (const { input, sha256 } of historicalCases) test(`historical input-only ${input.sessionId} retains the exact original state, log and verdict`, () => {
    assert.equal(digest(resolveWarDuel(input)), sha256);
    assert.equal(digest(resolveWarDuel({ ...input, rulesetVersion: 'legacy-v2' })), sha256);
});

test('new headless proofs seal progression kits and replay deterministically', () => {
    const input: WarDuelInput = { ...historicalCases[0].input, rulesetVersion: 'progression-v3' };
    const first = resolveWarDuel(input);
    assert.deepEqual(resolveWarDuel(structuredClone(input)), first);
    assert.equal(first.script.initialState.damageRules, 'response-v2');
    assert.equal(first.script.initialState.player[0].moves[0].name, 'Tackle');
    assert.equal(first.script.initialState.player[0].moves.filter(move => !move.signature).length, 2, 'level one has Tackle and the restrained species art');
    assert.notEqual(digest(first), historicalCases[0].sha256);
});

test('PvP proof stamp survives reconstruction; absent stamp keeps original kits', () => {
    const seal: PvpPetDuelSeal = { challengeId: 'retained', a: 'A', b: 'B', aPets: [pet('standard-0', 'a', 1)], bPets: [pet('standard-1', 'b', 1)], format: '1v1', seed: 727, sealedAt: 1 };
    const old = resolvePvpPetDuel(seal);
    assert.deepEqual(resolvePvpPetDuel({ ...seal, rulesetVersion: 'legacy-v2' }), old);
    const fresh = resolvePvpPetDuel({ ...seal, rulesetVersion: 'progression-v3' });
    assert.deepEqual(resolvePvpPetDuel(JSON.parse(JSON.stringify({ ...seal, rulesetVersion: 'progression-v3' }))), fresh);
    assert.equal(fresh.script.initialState.player[0].moves.filter(move => !move.signature).length, 2);
    assert.equal(isPvpPetDuelSeal({ ...seal, rulesetVersion: 'unrecognized' }), false);
});

test('clan stored session normalization preserves its sealed ruleset without upgrading historical inputs', () => {
    const old = { warId: 'war', challengeId: 'battle', mode: 'pet1v1' as const, seed: 727, from: [{ name: 'A', pet: pet('standard-0', 'a', 1) }], to: [{ name: 'B', pet: pet('standard-1', 'b', 1) }], status: 'done' as const, createdAt: 1, updatedAt: 1 };
    const normalized = normalizeClanWarPetSession(old)!;
    assert.equal(normalized.rulesetVersion, undefined);
    assert.deepEqual(clanWarPetDuelScript(normalized), clanWarPetDuelScript({ ...normalized, rulesetVersion: 'legacy-v2' }));
    const fresh = normalizeClanWarPetSession({ ...old, rulesetVersion: 'progression-v3' })!;
    assert.equal(fresh.rulesetVersion, 'progression-v3');
    assert.equal(clanWarPetDuelScript(fresh).initialState.player[0].moves.filter(move => !move.signature).length, 2);
});

test('resumed active legacy sessions do not acquire progression move gates', () => {
    const input = { sessionId: 'resume', playerName: 'A', seed: 42, format: '1v1' as const, tier: 'warrior' as const, playerPets: [pet('standard-0', 'a', 1)], enemyPets: [pet('standard-1', 'b', 1)], enemyTeamName: 'B', rewardEligible: false, rulesetVersion: 'legacy-v2' as const, damageRules: 'response-v2' as const };
    const explicit = createShowdownSession(input);
    const historical = structuredClone(explicit);
    delete historical.rulesetVersion;
    assert.deepEqual(resolveShowdownRound(historical, [{ kind: 'guard', petId: 'a' }], [{ kind: 'guard', petId: 'b' }]), resolveShowdownRound(explicit, [{ kind: 'guard', petId: 'a' }], [{ kind: 'guard', petId: 'b' }]));
    assert.equal(historical.player[0].moves.some(move => move.abilityId === 'universal:tackle'), false);
});


test('retained response-v2 sessions keep the exact original full headless replay', () => {
    const session = createShowdownSession({ sessionId: 'retained-response-v2', playerName: 'A', seed: 7171, format: '1v1', tier: 'warrior', playerPets: [pet('legendary-0', 'a', 50)], enemyPets: [pet('legendary-1', 'b', 50)], enemyTeamName: 'B', rewardEligible: false, damageRules: 'response-v2', rulesetVersion: 'legacy-v2' });
    delete session.rulesetVersion;
    const initialState = structuredClone(showdownStateView(session));
    const result = resolveShowdownHeadless(session);
    assert.equal(digest({ initialState, finalState: showdownStateView(session), ...result }), '88c135eb8f6c26349213f8a0ede96888e8bad846ec455903848fa9e9d5e04097');
});
