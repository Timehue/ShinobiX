import assert from 'node:assert/strict';
import test from 'node:test';
import { adoptRequestedFightPresentation, resumedEncounterNotice, sameAiFightIdentity } from './ai-fight-identity';
import type { AiFightRequest } from './ai-fight-request';

const explore = (receipt: string): AiFightRequest => ({ opponentId: 'builtin-ai-frost-sealer', opponentLevel: 40,
    battleKind: 'explore', opponentName: 'Frost Sealer', sector: 31, worldExploreRequestId: receipt });

test('two receipts using one template retain separate identity and completion callbacks', () => {
    assert.equal(sameAiFightIdentity(explore('first'), explore('second')), false);
    assert.match(resumedEncounterNotice(explore('first'), { ...explore('second'), opponentName: 'Tsukika' })!, /unfinished encounter with Frost Sealer.*before starting Tsukika/);
    assert.equal(resumedEncounterNotice(explore('first'), explore('first')), undefined);
});

test('the one successor slot treats retries as the same request but does not replace a queued wave', () => {
    const request: AiFightRequest = { opponentId: 'wanderer-ambush', opponentLevel: 50, battleKind: 'world', sector: 21,
        worldEncounter: { kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 21, stage: 1, chainId: 'chain_12345678' } };
    assert.equal(sameAiFightIdentity(request, structuredClone(request)), true);
    assert.equal(sameAiFightIdentity(request, { ...request, worldEncounter: { ...request.worldEncounter!, stage: 2 } }), false);
    assert.equal(sameAiFightIdentity(request, { ...request, worldEncounter: { ...request.worldEncounter!, chainId: 'other_chain' } }), false);
});

test('an omitted World stage matches the server-normalized first stage', () => {
    const request: AiFightRequest = { opponentId: 'crisis', opponentLevel: 75, battleKind: 'world', sector: 50,
        worldEncounter: { kind: 'world-crisis', sourceId: 'crisis', sector: 50 } };
    assert.equal(sameAiFightIdentity(request, { ...request, worldEncounter: { ...request.worldEncounter!, stage: 0 } }), true);
});

test('matching World starts preserve their screen and continuation, while unrelated resumes inherit neither', () => {
    const sealed: AiFightRequest = { opponentId: 'crisis', opponentName: 'Sealed name', opponentLevel: 75, battleKind: 'world', sector: 0,
        returnScreen: 'worldMap', worldEncounter: { kind: 'world-crisis', sourceId: 'crisis', sector: 0, stage: 0 } };
    const onResolved = () => {};
    const requested: AiFightRequest = { ...sealed, opponentName: 'Untrusted label', returnScreen: 'worldCrisis', enemyAvatar: '/portrait.webp', onResolved };
    const current = adoptRequestedFightPresentation(sealed, requested);
    assert.equal(current.returnScreen, 'worldCrisis');
    assert.equal(current.opponentName, 'Sealed name');
    assert.equal(current.onResolved, onResolved);
    const other = adoptRequestedFightPresentation(sealed, { ...requested, worldEncounter: { ...requested.worldEncounter!, sourceId: 'different' } });
    assert.equal(other.returnScreen, 'worldMap');
    assert.equal(other.onResolved, undefined);
    assert.equal(other.enemyAvatar, undefined);
});
