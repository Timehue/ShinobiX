import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openAncientChest } from './world-reward-api';

for (const replayed of [false, true]) {
    test(`chest results retain replayed=${replayed} and the exact saved balances`, async () => {
        const originalFetch = globalThis.fetch;
        const ryo = replayed ? 75_062 : 75_407;
        const auraDust = replayed ? 105 : 115;
        globalThis.fetch = (async () => new Response(JSON.stringify({
            loot: { xp: 0, ryo: 345, itemId: 'rustfang-kunai', auraDust: 10 },
            character: { name: 'ChestNinja', ryo, auraDust }, _saveVersion: 42, replayed,
        }))) as typeof fetch;
        try {
            const result = await openAncientChest('ChestNinja', 1, `chestmetadata${replayed}`, 'chestdiscovery001');
            assert.equal(result.replayed, replayed);
            assert.equal(result.character?.ryo, ryo);
            assert.equal(result.character?.auraDust, auraDust);
            assert.equal(result.saveVersion, 42);
        } finally { globalThis.fetch = originalFetch; }
    });
}
