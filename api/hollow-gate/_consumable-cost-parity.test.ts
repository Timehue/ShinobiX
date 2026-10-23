import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOLLOW_GATE_CONSUMABLE_COSTS } from './use-consumable.js';
import { KEY_FORGE_COSTS } from './_forge-key.js';

// The api/ and shinobij.client/ build roots are separate module systems, so the
// client prices are read as TEXT (the same cross-build rule as _run-token.test.ts).
const clientLib = (file: string) => readFileSync(join('shinobij.client', 'src', 'lib', file), 'utf8');

test('the server charges the 2026-10 Hollow Shard prices (rebalance #26)', () => {
    assert.deepEqual({ ...HOLLOW_GATE_CONSUMABLE_COSTS }, {
        reignite: 10, 'skeleton-key': 15, 'hollow-ward': 25, 'diviner-eye': 25, sanctify: 40, 'arm-second-wind': 60,
    });
});

test('every client shard consumable shows the price the server charges', () => {
    const shards = clientLib('hollow-gate-shards.ts');
    const serverIdFor: Record<string, keyof typeof HOLLOW_GATE_CONSUMABLE_COSTS> = {
        reignite: 'reignite',
        'skeleton-key': 'skeleton-key',
        'hollow-ward': 'hollow-ward',
        'diviner-eye': 'diviner-eye',
        sanctify: 'sanctify',
        'second-wind': 'arm-second-wind',
    };
    for (const [clientId, serverId] of Object.entries(serverIdFor)) {
        const cost = HOLLOW_GATE_CONSUMABLE_COSTS[serverId];
        assert.match(shards, new RegExp(`id: "${clientId}",[^}]*cost: ${cost},`), `client ${clientId} must cost ${cost}`);
    }
    const listed = [...shards.matchAll(/\{ id: "([a-z-]+)", label:/g)].map((match) => match[1]).sort();
    assert.deepEqual(listed, Object.keys(serverIdFor).sort(), 'the client lists exactly the server consumables');
});

test('the client key-forge prices default to the server forge costs (rebalance #27)', () => {
    assert.match(clientLib('hollow-gate-prices.ts'), new RegExp(`HOLLOW_GATE_KEY_FATE_SHARD_COST = ${KEY_FORGE_COSTS.fateShards};`));
    assert.match(clientLib('hollow-gate-prices.ts'), new RegExp(`HOLLOW_GATE_KEY_DUNGEON_KEY_COST = ${KEY_FORGE_COSTS.dungeonKeys};`));
    assert.match(clientLib('hollow-gate-attunement.ts'), new RegExp(`KEY_FORGE_COST = ${KEY_FORGE_COSTS.hollowShards};`));
});
