import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fetchHuntCombatState, huntSessionForTower, submitHuntCombatAction } from './hunt-combat-api';
import type { SoloPveSession } from './solo-pve-api';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function session(status: 'active' | 'done' = 'active') {
    return { status, version: 7, huntCombat: { formation: { version: 1, kind: 'pack', count: 3 },
        battle: { runId: 'hunt-session', status, floor: 9501,
            log: ['--- Round 1 ---', 'Floor 9501 cleared!'],
            actors: [{ id: 'player' }, { id: 'hunt-enemy-2' }] } } } as unknown as SoloPveSession;
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('hunt actions preserve selected targets and replay the same move token after a lost response', async () => {
    const requests: Record<string, unknown>[] = [];
    globalThis.fetch = (async (url, init) => {
        assert.equal(url, '/api/solo-pve/action');
        requests.push(JSON.parse(String(init?.body)));
        if (requests.length === 1) throw new Error('response lost');
        return response({ applied: true, duplicate: true, session: session() });
    }) as typeof fetch;
    const result = await submitHuntCombatAction('hunt-session', 'Hunter', { type: 'attack', targetId: 'hunt-enemy-2' }, 6);
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(requests[0]?.expectedVersion, 6);
    assert.deepEqual(requests[0]?.action, { type: 'attack', targetId: 'hunt-enemy-2' });
    assert.equal(requests[0]?.type, 'huntAction');
    assert.equal(result.replayed, true);
    assert.equal(result.session.actionVersion, 7);
});

test('retreat uses the existing authoritative abandon transition', async () => {
    globalThis.fetch = (async (_url, init) => {
        assert.equal(JSON.parse(String(init?.body)).type, 'abandon');
        return response({ applied: true, session: session('done') });
    }) as typeof fetch;
    assert.equal((await submitHuntCombatAction('hunt-session', 'Hunter', { type: 'forfeit' }, 6)).session.status, 'done');
});

test('hunt projection keeps round markers and replaces the internal floor result', () => {
    const projected = huntSessionForTower(session('done'));
    assert.deepEqual(projected.log, ['--- Round 1 ---', 'Hunt encounter cleared!']);
});

test('expired hunts recover terminal state, while unauthorized state is rejected', async () => {
    globalThis.fetch = (async () => response({ session: session('done') }, 410)) as typeof fetch;
    assert.equal((await fetchHuntCombatState('hunt-session', 'Hunter')).status, 'done');
    globalThis.fetch = (async () => response({ error: 'Not your hunt' }, 403)) as typeof fetch;
    await assert.rejects(fetchHuntCombatState('hunt-session', 'Intruder'), /Not your hunt/);
    assert.throws(() => huntSessionForTower({} as SoloPveSession), /battlefield/);
});

test('stale action versions adopt the server state without resubmitting', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return response({ applied: false, reason: 'stale-version', session: session() }, 409); }) as typeof fetch;
    const result = await submitHuntCombatAction('hunt-session', 'Hunter', { type: 'wait' }, 6);
    assert.equal(calls, 1);
    assert.equal(result.applied, false);
    assert.equal(result.currentVersion, 7);
});
