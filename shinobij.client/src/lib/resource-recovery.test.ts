import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recoverResourceStatus } from './resource-recovery';
import { createPlayerSaveCoordinator } from './player-save-coordinator';
import { createCharacter } from './create-character';
import type { Character } from '../types/character';
import type { ResourceResponse } from './resource-api';

const character = () => createCharacter('GatherQA', 'Stormveil Village', 'Ninjutsu', 'Ashen Eyes');
function coordinator() {
    const initial = character(), characterRef = { current: initial as Character | null };
    const owner = createPlayerSaveCoordinator({
        characterRef, currentAccountNameRef: { current: initial.name }, saveSessionEpochRef: { current: 0 },
        pvpCreateScopeAbortRef: { current: new AbortController() },
        setCharacter: update => { characterRef.current = typeof update === 'function' ? update(characterRef.current) : update; },
        setSaveConflictDraft: () => {}, setSaveBlocked: () => {}, applyServerSnapshot: () => false,
        storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } as unknown as Storage,
    });
    owner.saveAuthority.scopeToAccount(initial.name);
    owner.latestSaveVersionRef.current = 1;
    // Isolate the gathering status exchange from the coordinator's independent
    // full-save readback; the production commit/version gate still runs here.
    owner.savePersistenceRef.current = null;
    return { owner, characterRef, initial };
}

test('an overtaken initial gathering status reads current authority once without rolling back a newer save', async () => {
    const f = coordinator(), bodies: Record<string, unknown>[] = [];
    const newer = { ...f.initial, ryo: f.initial.ryo + 100 };
    const recovered = await recoverResourceStatus({ playerName: f.initial.name, isCurrent: () => true,
        commit: f.owner.commitVersionedCharacter,
        request: async body => {
            bodies.push(body);
            if (bodies.length === 1) {
                assert.equal(f.owner.commitVersionedCharacter(newer, 2), true);
                return { ok: true, character: f.initial, _saveVersion: 1 };
            }
            assert.equal(f.characterRef.current?.ryo, newer.ryo, 'the stale reply must never be adopted');
            return { ok: true, character: newer, _saveVersion: 2 };
        } });
    assert.equal(recovered?.accepted, true);
    assert.deepEqual(bodies.map(body => body.action), ['status', 'status']);
    assert.equal(f.owner.latestSaveVersionRef.current, 2);
    assert.equal(f.characterRef.current?.ryo, newer.ryo);
});

test('a second rejected status stops and retains manual recovery', async () => {
    let calls = 0;
    const result = await recoverResourceStatus({ playerName: 'GatherQA', isCurrent: () => true, commit: () => false,
        request: async () => { calls++; return { ok: true, character: character(), _saveVersion: 1 }; } });
    assert.equal(calls, 2); assert.equal(result?.accepted, false);
});

test('service, authentication, missing-character and invalid-version failures are never automatically retried', async () => {
    const responses: ResourceResponse[] = [
        { ok: false, error: 'Service unavailable' }, { ok: false, error: 'Player authentication required.' },
        { ok: true }, { ok: true, character: character(), _saveVersion: 0 },
        { ok: true, character: character() }, { ok: true, character: { ...character(), name: 'Other' }, _saveVersion: 1 },
    ];
    for (const response of responses) {
        let calls = 0;
        const result = await recoverResourceStatus({ playerName: 'GatherQA', isCurrent: () => true, commit: () => false,
            request: async () => { calls++; return response; } });
        assert.equal(calls, 1); assert.equal(result?.accepted, false); assert.equal(result?.response, response);
    }
});

test('a stale status receipt keeps its attempt and node on the bounded readback', async () => {
    const bodies: Record<string, unknown>[] = [];
    const receipt = { id: 'recovered-attempt', activity: 'mining', outcome: 'cancelled', xp: 0, performance: 0, toolBroke: false } as const;
    const response: ResourceResponse = { ok: true, character: character(), _saveVersion: 2, receipt, nodeId: 'resource-13' };
    const result = await recoverResourceStatus({ playerName: 'GatherQA', isCurrent: () => true, commit: () => bodies.length === 2,
        request: async body => { bodies.push(body); return response; } });
    assert.equal(result?.accepted, true);
    assert.equal(bodies[1].requestId, receipt.id); assert.equal(bodies[1].nodeId, 'resource-13');
});

test('unmounted status work cannot commit or launch a follow-up', async () => {
    let current = true, commits = 0, calls = 0;
    const result = await recoverResourceStatus({ playerName: 'GatherQA', isCurrent: () => current,
        commit: () => { commits++; return false; }, request: async () => {
            calls++; current = false; return { ok: true, character: character(), _saveVersion: 1 };
        } });
    assert.equal(result, null); assert.equal(commits, 0); assert.equal(calls, 1);
});

test('manual recovery retains a receipt discovered before the bounded readback failed', async () => {
    const receipt = { id: 'settled-at-startup', activity: 'fishing', outcome: 'expired', xp: 0, performance: 0, toolBroke: false } as const;
    let calls = 0;
    const first = await recoverResourceStatus({ playerName: 'GatherQA', isCurrent: () => true, commit: () => false,
        request: async () => ++calls === 1
            ? { ok: true, character: character(), _saveVersion: 1, receipt, nodeId: 'resource-1' }
            : { ok: false, error: 'Connection interrupted.' } });
    assert.equal(first?.accepted, false);
    assert.deepEqual(first?.target, { id: receipt.id, nodeId: 'resource-1' });
    const retried = await recoverResourceStatus({ playerName: 'GatherQA', attempt: first?.target, isCurrent: () => true,
        commit: () => true, request: async body => {
            assert.equal(body.requestId, receipt.id); assert.equal(body.nodeId, 'resource-1');
            return { ok: true, character: character(), _saveVersion: 2, receipt, nodeId: 'resource-1' };
        } });
    assert.equal(retried?.accepted, true); assert.equal(retried?.response.receipt?.id, receipt.id);
});

test('unmount during the readback also ignores its newer response', async () => {
    let current = true, commits = 0, calls = 0;
    const result = await recoverResourceStatus({ playerName: 'GatherQA', isCurrent: () => current,
        commit: () => { commits++; return false; }, request: async () => {
            if (++calls === 2) current = false;
            return { ok: true, character: character(), _saveVersion: calls };
        } });
    assert.equal(result, null); assert.equal(commits, 1); assert.equal(calls, 2);
});
