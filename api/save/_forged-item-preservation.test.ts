/*
 * A forged named weapon/armor definition lives ONLY in the owner's top-level
 * `creatorItems` — no ITEM_CATALOG entry, not on the admin slots. The normal save
 * path replaces that array with the client's copy, so a POST from a client that
 * had not yet seen the forge used to erase the definition while its id stayed in
 * `character.equipment`, leaving gear that resolves to nothing in every fight.
 *
 * These pin the narrow revival rule: server-minted ids only, absent-from-incoming
 * only, everything else keeps replace-semantics.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { preserveForgedItems, FORGED_ITEM_ID, sanitizeCharacterSave } from './[name].js';

// The dashed form every forged item in the live DB actually uses...
const DASHED = 'named-weapon-0f07ac79-66d2-4f4f-a4b4-3c9b6eb74527';
// ...and the stripped form buildNamedItem mints today.
const STRIPPED = 'named-armor-3a61ce4f7cf74b0f97c24049643f5f54';

describe('FORGED_ITEM_ID', () => {
    it('matches both the dashed (legacy, live) and stripped (current) uuid forms', () => {
        assert.ok(FORGED_ITEM_ID.test(DASHED), 'dashed form must match — all live gear uses it');
        assert.ok(FORGED_ITEM_ID.test(STRIPPED), 'stripped form must match — buildNamedItem mints it');
    });

    it('does not match ordinary or spoofable ids', () => {
        for (const id of [
            'rustfang-kunai',
            'named-weapon-',
            'named-weapon-not-a-uuid',
            'named-potion-0f07ac7966d24f4fa4b43c9b6eb74527',
            'custom-blade',
        ]) {
            assert.ok(!FORGED_ITEM_ID.test(id), `${id} must not be treated as server-forged`);
        }
    });
});

describe('preserveForgedItems', () => {
    const forged = { id: DASHED, name: 'Ashfall', slot: 'hand' };

    it('revives a forged item the incoming save dropped', () => {
        const out = preserveForgedItems([{ id: 'rustfang-kunai' }], [forged, { id: 'rustfang-kunai' }], 500);
        assert.deepEqual((out as Array<{ id: string }>).map((i) => i.id), [DASHED, 'rustfang-kunai']);
    });

    it('does not duplicate one the incoming save still carries', () => {
        const out = preserveForgedItems([forged, { id: 'rustfang-kunai' }], [forged], 500);
        assert.equal((out as unknown[]).length, 2);
        assert.equal((out as Array<{ id: string }>).filter((i) => i.id === DASHED).length, 1);
    });

    it('leaves non-forged removals alone (admin deletions still take effect)', () => {
        // 'custom-blade' vanished from the incoming array — it is NOT server-minted,
        // so replace-semantics stand and it must stay gone.
        const out = preserveForgedItems([{ id: 'rustfang-kunai' }], [{ id: 'custom-blade' }], 500);
        assert.deepEqual((out as Array<{ id: string }>).map((i) => i.id), ['rustfang-kunai']);
    });

    it('keeps forged items when the cap truncates', () => {
        const filler = Array.from({ length: 500 }, (_, i) => ({ id: `filler-${i}` }));
        const out = preserveForgedItems(filler, [forged], 500) as Array<{ id: string }>;
        assert.equal(out.length, 500);
        assert.equal(out[0].id, DASHED, 'the forged piece must survive truncation');
    });

    it('passes non-array input straight through', () => {
        assert.equal(preserveForgedItems(undefined, [forged], 500), undefined);
        assert.deepEqual(preserveForgedItems([{ id: 'a' }], undefined, 500), [{ id: 'a' }]);
    });
});

// The unit tests above pass even if the helper is never CALLED. This one goes
// through the real save path, so it fails if the wiring in sanitizeCharacterSave
// is removed — which is the regression that actually matters.
describe('sanitizeCharacterSave wiring', () => {
    const forged = { id: DASHED, name: 'Ashfall', slot: 'hand', rarity: 'legendary' };
    const stored = {
        character: { name: 'Tester', level: 30, equipment: { hand: DASHED } },
        creatorItems: [forged, { id: 'rustfang-kunai' }],
        _saveVersion: 4,
    };

    it('keeps a forged item a stale client POST omitted', () => {
        const previous = process.env.STRICT_RAW_SAVE_LEDGER;
        delete process.env.STRICT_RAW_SAVE_LEDGER; // the replace-semantics path
        try {
            const incoming = {
                character: { name: 'Tester', level: 30, equipment: { hand: DASHED } },
                creatorItems: [{ id: 'rustfang-kunai' }], // forge not yet seen by this client
            };
            const out = sanitizeCharacterSave(incoming, stored);
            const ids = (out.creatorItems as Array<{ id: string }>).map((i) => i.id);
            assert.ok(ids.includes(DASHED), `forged item was erased: ${JSON.stringify(ids)}`);
        } finally {
            if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previous;
        }
    });
});
