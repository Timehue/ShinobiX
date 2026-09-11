import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchRankedPetCharacter, petRankedQueue, settleRankedPetMatch } from './pet-ranked-queue-api';

const input = { playerName: 'alpha', opponentName: 'bravo', matchToken: '11111111-1111-4111-8111-111111111111', outcome: 'win' as const };
const snapshot = { character: { name: 'Alpha', petRankedRating: 1012, petRankedWins: 1, pets: [{ id: 'mine', loadout: {} }] }, _saveVersion: 8 };

test('ranked settlement surfaces HTTP/network/invalid-body failures so the panel can retry', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Please retry settlement.' }), { status: 503 }));
    await assert.rejects(settleRankedPetMatch(input), /Please retry settlement/);
    fetchMock.mock.mockImplementation(async () => { throw new Error('connection lost'); });
    await assert.rejects(settleRankedPetMatch(input), /connection lost/);
    fetchMock.mock.mockImplementation(async () => new Response('<html>proxy</html>', { status: 200 }));
    await assert.rejects(settleRankedPetMatch(input), /could not be recorded/);
    fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await assert.rejects(settleRankedPetMatch(input), /updated character/);
    fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, ...snapshot }), { status: 200 }));
    assert.deepEqual(await settleRankedPetMatch(input), snapshot);
});

test('ranked settlement rejects another account or an unversioned character before adoption', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: true, ...snapshot, character: { name: 'bravo' } })));
    await assert.rejects(settleRankedPetMatch(input), /updated character/);
    for (const version of [undefined, 0, -1, '8', 1.5]) {
        fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, ...snapshot, _saveVersion: version })));
        await assert.rejects(settleRankedPetMatch(input), /updated character/);
    }
});

test('completed ranked discovery reads the current owner snapshot without submitting another result', async (t) => {
    const calls: string[] = [];
    const latest = { ...snapshot, _saveVersion: 12, character: { ...snapshot.character, petRankedRating: 1024 } };
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push(String(url));
        assert.equal(options?.method ?? 'GET', 'GET');
        return new Response(JSON.stringify(latest));
    });
    assert.deepEqual(await fetchRankedPetCharacter('Alpha'), latest);
    assert.deepEqual(calls, ['/api/save/Alpha']);
    fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ error: 'Read unavailable' }), { status: 503 }));
    await assert.rejects(fetchRankedPetCharacter('Alpha'), /Read unavailable/);
    fetchMock.mock.mockImplementation(async () => new Response('<html>proxy</html>', { status: 200 }));
    await assert.rejects(fetchRankedPetCharacter('Alpha'), /updated character/);
    fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ ...latest, character: { name: 'bravo' } })));
    await assert.rejects(fetchRankedPetCharacter('Alpha'), /updated character/);
});

test('completed-match acknowledgment carries the exact token and preserves the returned state', async (t) => {
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
        assert.deepEqual(JSON.parse(String(options?.body)), { action: 'acknowledge', name: input.playerName, matchToken: input.matchToken });
        return new Response(JSON.stringify({ state: 'idle' }));
    });
    assert.deepEqual(await petRankedQueue('acknowledge', input.playerName, input.matchToken), { state: 'idle' });
});
