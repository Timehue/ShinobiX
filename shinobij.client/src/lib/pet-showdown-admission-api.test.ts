import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { startArenaBout } from './pet-showdown-api';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

for (const resumed of [false, true]) test(`${resumed ? 'recovered' : 'fresh'} paid entry retains the committed consumable snapshot`, async () => {
    const state = { sessionId: 'paid-entry', player: [{ id: 'owned-pet' }] };
    const character = { name: 'Rin', pets: [{ id: 'owned-pet', loadout: {} }] };
    globalThis.fetch = async (_input, init) => {
        assert.deepEqual(JSON.parse(String(init?.body)), { action: 'arena', playerName: 'Rin', format: '1v1', petIds: ['owned-pet'] });
        return json({ state, character, _saveVersion: 8, dailyPetWins: 3, dailyCap: 100, resumed });
    };
    assert.deepEqual(await startArenaBout('Rin', '1v1', ['owned-pet']), { state, character, saveVersion: 8, dailyPetWins: 3, dailyCap: 100 });
});

test('older and incomplete entry responses retain the session without an unversioned snapshot', async () => {
    for (const extra of [{}, { character: {} }, { character: {}, _saveVersion: '8' }]) {
        globalThis.fetch = async () => json({ state: { sessionId: 'paid-entry' }, ...extra });
        const result = await startArenaBout('Rin', '1v1', ['owned-pet']);
        assert.ok('state' in result);
        assert.equal(Object.hasOwn(result, 'character'), false);
        assert.equal(Object.hasOwn(result, 'saveVersion'), false);
    }
});
