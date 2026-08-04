import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = process.cwd();
const read = (path: string) => readFile(resolve(root, path), 'utf8');

test('ANBU combat has no Tower runtime dependency and retires its custom action channel', async () => {
    const [encounter, store, handler, client, screen] = await Promise.all([
        read('api/_anbu-infiltration-encounter.ts'),
        read('api/_anbu-infiltration-store.ts'),
        read('api/village/anbu-infiltration.ts'),
        read('shinobij.client/src/lib/anbu-infiltration-api.ts'),
        read('shinobij.client/src/features/anbuInfiltration/AnbuVaultRaid.tsx'),
    ]);
    for (const [name, source] of Object.entries({ encounter, store, handler, client, screen })) {
        assert.doesNotMatch(source, /(?:from|import\()\s*['"][^'"]*(?:towers\/|towers-api|tower-arena-adapter)/i, `${name} still imports Tower combat`);
    }
    assert.match(handler, /case 'act': return res\.status\(410\)/);
    assert.match(handler, /hydrateCharacterFromSave\(char, \{\}, rec \?\? null/);
    assert.doesNotMatch(handler, /raiderLoadout|hostLoadout|sealTowerFighter|sealTowerItemCharges/);
    assert.doesNotMatch(client, /infiltrationAct|raiderLoadout|hostLoadout/);
    assert.match(screen, /transport=\{soloPveArenaTransport\}/);
    assert.doesNotMatch(screen, /infiltrationAct|towerSessionForArena|createTowerArenaTransport/);
});

test('combat runtime inventory records the participant-model decision', async () => {
    const inventory = await read('scripts/combat-runtime-inventory.mjs');
    assert.match(inventory, /mode: 'Anbu infiltration'[\s\S]*actionRoute: '\/solo-pve\/action'[\s\S]*current: 'solo-pve'[\s\S]*status: 'migrated'/);
});
