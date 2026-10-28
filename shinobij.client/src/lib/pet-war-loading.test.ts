import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { clanWarPetState, clanWarPetWatch } from './clan-war-pet-api';
import { sectorPetState, sectorPetWatch } from './village-war-map';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function response(status: number, body: unknown) {
    globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

for (const [host, state, watch] of [
    ['clan', () => clanWarPetState('war', 'challenge'), () => clanWarPetWatch('war', 'challenge')],
    ['sector', () => sectorPetState('player', 'war'), () => sectorPetWatch('player', 'war')],
] as const) {
    test(`${host}: an unopened pet table permits selection, but a failed read stays retryable`, async () => {
        response(404, { error: 'No pet battle session yet.' });
        assert.equal((await state()).session ?? null, null);
        response(503, { error: 'Temporarily unavailable' });
        await assert.rejects(state(), /Temporarily unavailable/);
        response(403, { error: 'Only participants may read this battle.' });
        await assert.rejects(state(), /Only participants/);
    });
    test(`${host}: a temporary replay failure is distinct from a retired replay`, async () => {
        response(503, { error: 'Replay service is recovering' });
        await assert.rejects(watch(), /Replay service is recovering/);
        response(409, { error: 'This pet battle has not been decided yet.' });
        await assert.rejects(watch(), /not been decided/);
        response(409, { error: 'This battle predates the new arena and cannot be replayed.' });
        const result = await watch();
        assert.equal(result && 'script' in result ? result.script : result, null);
    });
}

test('sector reads preserve the open battle identity and garrison flag', async () => {
    const calls: Record<string, unknown>[] = [];
    globalThis.fetch = async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ session: null, script: { events: [] } }));
    };
    await sectorPetState('defender', 'war-a', false, 'open-a');
    await sectorPetWatch('attacker', 'war-b', true);
    assert.deepEqual(calls, [
        { action: 'state', playerName: 'defender', sectorWarId: 'war-a', engageId: 'open-a' },
        { action: 'watch', playerName: 'attacker', sectorWarId: 'war-b', garrison: true },
    ]);
});
