/*
 * Forged gear must never become shared admin content.
 *
 * `Admin 1` / `Admin 2` are ordinary player saves that double as the
 * shared-content store, so a client still holding a personal `creatorItems`
 * state when it saved as an admin published that forged item to everyone — every
 * client merges shared admin content into its own array and persists it. That is
 * how ONE forged weapon ended up mirrored into 88 unrelated saves.
 *
 * Three gates, because the item can arrive by more than one path:
 *   - the player write path (sanitizeCharacterSave) strips on an admin slot;
 *   - the shared-content projection strips on the way out, which also
 *     neutralizes copies already stored on a slot with no data migration;
 *   - the combat catalog refuses to serve one as an authored definition.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { stripForgedItems, sanitizeCharacterSave, buildPublicSaveDTO } from './[name].js';
import { buildAdminItemCatalog } from '../_admin-item-catalog.js';

const FORGED = 'named-weapon-0f07ac79-66d2-4f4f-a4b4-3c9b6eb74527';
const FORGED_ARMOR = 'named-armor-3a61ce4f7cf74b0f97c24049643f5f54';
const forgedItem = { id: FORGED, name: 'Unnamed Blade', slot: 'hand', rarity: 'legendary' };
const authored = { id: 'custom-storm-tanto', name: 'Storm Tanto', slot: 'hand', rarity: 'legendary' };

describe('stripForgedItems', () => {
    it('removes both forged weapons and forged armor, keeping everything else', () => {
        const out = stripForgedItems([
            forgedItem,
            authored,
            { id: FORGED_ARMOR, name: 'Forged Plate' },
            { id: 'rustfang-kunai' },
        ]);
        assert.deepEqual((out as Array<{ id: string }>).map((i) => i.id), ['custom-storm-tanto', 'rustfang-kunai']);
    });

    it('tolerates malformed input', () => {
        assert.deepEqual(stripForgedItems(undefined), []);
        assert.deepEqual(stripForgedItems('nope'), []);
        assert.deepEqual(stripForgedItems([null, 42]), [null, 42]);
    });
});

describe('shared-content projection', () => {
    it('never serves a forged item from an admin slot', () => {
        const dto = buildPublicSaveDTO(
            { character: { name: 'Admin 1' }, creatorItems: [forgedItem, authored] },
            { combat: false, sharedContent: true },
        );
        const ids = (dto.creatorItems as Array<{ id: string }>).map((i) => i.id);
        assert.deepEqual(ids, ['custom-storm-tanto'], 'forged gear must not reach other clients');
    });

    it('leaves a non-shared projection alone', () => {
        const dto = buildPublicSaveDTO(
            { character: { name: 'Someone' }, creatorItems: [forgedItem] },
            { combat: false, sharedContent: false },
        );
        assert.equal(dto.creatorItems, undefined, 'creatorItems is not public for ordinary saves');
    });
});

describe('admin-slot write path', () => {
    const stored = {
        character: { name: 'Admin 1', level: 30 },
        creatorItems: [forgedItem, authored],
    };

    function saveAsAdminSlot(incomingItems: unknown[]) {
        const previous = process.env.STRICT_RAW_SAVE_LEDGER;
        delete process.env.STRICT_RAW_SAVE_LEDGER;
        try {
            return sanitizeCharacterSave(
                { character: { name: 'Admin 1', level: 30 }, creatorItems: incomingItems },
                stored,
                { adminContentSlot: true },
            );
        } finally {
            if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previous;
        }
    }

    it('strips forged gear an admin client tried to publish', () => {
        const out = saveAsAdminSlot([forgedItem, authored]);
        const ids = (out.creatorItems as Array<{ id: string }>).map((i) => i.id);
        assert.ok(!ids.includes(FORGED), `forged item was published: ${JSON.stringify(ids)}`);
        assert.ok(ids.includes('custom-storm-tanto'), 'authored content must survive');
    });

    it('does NOT revive a stored forged item on an admin slot', () => {
        // preserveForgedItems would normally re-attach it; on an admin slot that
        // would silently undo the fix and re-publish the leak.
        const out = saveAsAdminSlot([authored]);
        const ids = (out.creatorItems as Array<{ id: string }>).map((i) => i.id);
        assert.ok(!ids.includes(FORGED), `forged item was revived: ${JSON.stringify(ids)}`);
    });
});

describe('combat catalog', () => {
    it('refuses to serve forged gear as an authored definition', () => {
        const catalog = buildAdminItemCatalog([{ creatorItems: [forgedItem, authored] }]);
        assert.equal(catalog.has(FORGED), false, 'forged gear must not be an authored definition');
        assert.equal(catalog.has('custom-storm-tanto'), true);
    });
});
