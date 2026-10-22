import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { descendHollowGateRun } from './hollow-gate-combat-api';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
test('descent adopts the exact committed character/version and follows the server floor on a replay', async () => {
    const character = { name: 'Diver', hp: 1587, hollowGateRun: { runToken: 'token', floor: 3 } };
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, floor: 3,
        alreadyAdvanced: true, character, _saveVersion: 19 }), { status: 200 })) as typeof fetch;
    const adopted: unknown[] = [];
    const floor = await descendHollowGateRun({ playerName: 'Diver', token: 'token', fromFloor: 1 },
        (value, version) => { adopted.push(value, version); return true; });
    assert.equal(floor, 3);
    assert.deepEqual(adopted, [character, 19]);
});
test('a refused descent never adopts or invents progress', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Finish the encounter first.' }), { status: 409 })) as typeof fetch;
    let adopted = false;
    await assert.rejects(descendHollowGateRun({ playerName: 'Diver', token: 'token', fromFloor: 1 },
        () => { adopted = true; return true; }), /Finish the encounter/);
    assert.equal(adopted, false);
});
