import assert from 'node:assert/strict';
import test from 'node:test';
import {
    hasVersionedPvpClaimSnapshot,
    preloadPvpChallengeModules,
    pvpChallengeAcceptanceMessage,
} from './pvp-session';

test('challenge preload starts both chunks while respecting data saver and failed warmups', async () => {
    const started: string[] = [];
    const create = () => { started.push('create'); return Promise.resolve({ ready: true }); };
    const screen = () => { started.push('screen'); return Promise.reject(new Error('warmup failed')); };
    const ready = preloadPvpChallengeModules(false, create, screen);
    assert.deepEqual(started, ['screen', 'create']);
    assert.deepEqual(await ready, { ready: true });
    assert.equal(await preloadPvpChallengeModules(true, create, screen), null);
    assert.deepEqual(started, ['screen', 'create']);
});

test('completion shortcut requires a versioned server snapshot', () => {
    assert.equal(hasVersionedPvpClaimSnapshot(undefined), false);
    assert.equal(hasVersionedPvpClaimSnapshot({ character: {}, _saveVersion: 0 }), false);
    assert.equal(hasVersionedPvpClaimSnapshot({ character: {}, _saveVersion: 1 }), true);
});

test('challenge errors preserve actionable gear failures', () => {
    assert.equal(pvpChallengeAcceptanceMessage(new Error('Equipped named gear could not be loaded. Retry the battle.'), 'Sora'),
        'Equipped named gear could not be loaded. Retry the battle.');
    assert.match(pvpChallengeAcceptanceMessage(new Error('network down'), 'Sora'), /Sora's challenge could not be accepted/);
});
