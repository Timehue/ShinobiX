import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _makeMemoryKv } from './_storage.js';
import { FORGED_ITEM_ID, forgedItemKey, recordForgedItem, augmentSaveWithForgedDefs } from './_forged-item-registry.js';
import { FORGED_ITEM_ID as SAVE_FORGED_ITEM_ID } from './save/[name].js';

/*
 * P0-3: durable forged-item registry (the named-weapon drop fix gating
 * STRICT_RAW_SAVE_LEDGER=1). Mint-time recording + seal-time recovery.
 */

const FORGED = 'named-weapon-00000000-0000-4000-8000-00000000aaaa';
const kv = _makeMemoryKv();
const opts = { kv };

describe('forged-item registry', () => {
    it('keeps its id pattern in sync with the save handler', () => {
        assert.equal(FORGED_ITEM_ID.source, SAVE_FORGED_ITEM_ID.source);
        assert.equal(FORGED_ITEM_ID.flags, SAVE_FORGED_ITEM_ID.flags);
    });

    it('records only genuine forged ids', async () => {
        await recordForgedItem({ id: 'mythic-battle-plate', name: 'nope' }, opts);
        assert.equal(await kv.get(forgedItemKey('mythic-battle-plate')), null);
        await recordForgedItem({ id: FORGED, name: 'Soulrender', slot: 'hand' }, opts);
        const stored = await kv.get<Record<string, unknown>>(forgedItemKey(FORGED));
        assert.equal(stored?.name, 'Soulrender');
    });

    it('grafts a missing equipped forged definition back into creatorItems', async () => {
        await recordForgedItem({ id: FORGED, name: 'Soulrender', slot: 'hand' }, opts);
        const save = {
            character: { name: 'Probe', equipment: { hand: FORGED } },
            creatorItems: [{ id: 'admin-blade', name: 'Admin Blade' }],
        };
        const augmented = await augmentSaveWithForgedDefs(save, opts);
        const items = augmented!.creatorItems as Array<Record<string, unknown>>;
        assert.ok(items.some((i) => i.id === FORGED), 'the registry definition is grafted');
        assert.ok(items.some((i) => i.id === 'admin-blade'), 'existing entries kept');
        assert.ok(!(save.creatorItems as unknown[]).some((i) => (i as Record<string, unknown>).id === FORGED), 'input not mutated');
    });

    it('returns the same record untouched when nothing is missing', async () => {
        const save = {
            character: { name: 'Probe', equipment: { hand: FORGED } },
            creatorItems: [{ id: FORGED, name: 'Soulrender' }],
        };
        assert.equal(await augmentSaveWithForgedDefs(save, opts), save, 'no copy when the save already has the definition');
        const bare = { character: { name: 'Probe', equipment: { hand: 'rustfang-kunai' } }, creatorItems: [] };
        assert.equal(await augmentSaveWithForgedDefs(bare, opts), bare, 'no forged ids equipped → untouched');
        assert.equal(await augmentSaveWithForgedDefs(null, opts), null);
    });

    it('leaves the save unchanged when the registry has no entry (drop still logged downstream)', async () => {
        const ghost = 'named-armor-00000000-0000-4000-8000-00000000bbbb';
        const save = { character: { name: 'Probe', equipment: { body: ghost } }, creatorItems: [] };
        const augmented = await augmentSaveWithForgedDefs(save, opts);
        assert.equal((augmented!.creatorItems as unknown[]).length, 0);
    });
});

describe('mint-time recording is wired', () => {
    it('craft/named.ts records the minted definition post-commit', () => {
        const src = readFileSync(join(process.cwd(), 'api', 'craft', 'named.ts'), 'utf8');
        assert.match(src, /recordForgedItem\(/);
    });

    it('every fighter-sealing entry point grafts recovered definitions', () => {
        for (const rel of [
            'pvp/session.ts', 'towers/start.ts', 'clan-boss/assault-start.ts',
            'village/anbu-infiltration.ts', '_anbu-infiltration-store.ts',
            '_merc-auto.ts', 'missions/combat-start.ts', 'story/boss-start.ts',
            'weekly-boss.ts',
        ]) {
            const src = readFileSync(join(process.cwd(), 'api', rel), 'utf8');
            assert.match(src, /augmentSaveWithForgedDefs\(/, `${rel} must recover forged definitions before sealing`);
        }
    });
});
