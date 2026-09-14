/*
 * The inventory size cap must never DELETE items a player already holds.
 *
 * The cap exists so a tampered client cannot bloat the save with thousands of
 * items. It was enforced by truncation — `slice(0, 500)` — with no notice, no
 * error and no log. Only the shop refuses at acquisition time ("Your inventory
 * is full.", api/shop/_settlement.ts, same 500); roughly fifteen other grant
 * paths (war crates, the forge, events, dungeon runs, treasury transfers…)
 * append without checking, so for a player at the cap the save layer silently
 * ate the reward.
 *
 * The fix mirrors PET_CAP directly above it in the same file: the ceiling never
 * falls below what the server already stores, so persistence can only stop the
 * inventory GROWING past the cap.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeCharacterSave } from './[name].js';

const CAP = 500;
const items = (n: number, prefix = 'item') => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

function save(inventory: string[], extra: Record<string, unknown> = {}) {
    return {
        character: {
            name: 'capsubject', level: 40, village: 'Mist',
            hp: 100, maxHp: 100, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50,
            inventory, itemStacks: [], stats: {},
            ...extra,
        },
    };
}

const inventoryOf = (out: Record<string, unknown>) =>
    ((out.character as Record<string, unknown>).inventory ?? []) as string[];

describe('inventory cap — non-destructive, like PET_CAP', () => {
    it('still refuses a tampered save trying to bloat the inventory', () => {
        // Two defences stack here and the ownership guard (preserveOwnedItems,
        // which runs unconditionally just below the cap) is the stricter one: it
        // clamps the incoming array to the entitlement implied by what is
        // STORED, so 5,000 forged items collapse to the 10 actually owned. The
        // cap is the anti-bloat backstop behind it, not the primary defence.
        const out = sanitizeCharacterSave(save(items(5_000)), save(items(10)));
        assert.equal(inventoryOf(out).length, 10, 'a client cannot mint items through the save path');
        assert.ok(inventoryOf(out).length <= CAP);
    });

    it('does NOT delete items a player already holds above the cap', () => {
        // 620 stored: a veteran who accumulated past the cap through grant paths
        // that never checked it. Persistence must not be what removes them.
        const stored = items(620);
        const out = sanitizeCharacterSave(save(stored), save(stored));
        assert.equal(inventoryOf(out).length, 620, 'an over-cap holding round-trips intact');
        assert.deepEqual(inventoryOf(out), stored, 'and in the same order, item for item');
    });

    it('lets an over-cap player keep playing without shedding items each save', () => {
        // The regression this really guards: repeated autosaves must converge,
        // not erode the inventory by a few items every time.
        let record = save(items(620));
        for (let i = 0; i < 5; i += 1) record = sanitizeCharacterSave(record, record) as ReturnType<typeof save>;
        assert.equal(inventoryOf(record).length, 620, 'five round-trips shed nothing');
    });

    it('holds an over-cap player at their stored count rather than letting it climb', () => {
        const stored = items(620);
        const out = sanitizeCharacterSave(save([...stored, ...items(30, 'extra')]), save(stored));
        assert.equal(inventoryOf(out).length, 620, 'no growth past what was already stored');
    });

    it('leaves a normal inventory completely alone', () => {
        const normal = items(42);
        const out = sanitizeCharacterSave(save(normal), save(normal));
        assert.deepEqual(inventoryOf(out), normal);
    });

    it('does not ratchet an over-cap player down one save at a time', () => {
        // The exact live failure. A grant path (war crate, forge, event claim)
        // writes item 501+ through its own endpoint, bypassing this sanitizer.
        // The player's next ordinary autosave then arrived here at 501 and the
        // old truncation cut it back to 500 — destroying the reward. Worse, the
        // stored count was now 500, so the next grant repeated it forever.
        const granted = items(501);
        const first = sanitizeCharacterSave(save(granted), save(granted));
        assert.equal(inventoryOf(first).length, 501, 'the 501st item survives its first autosave');
        const second = sanitizeCharacterSave(first as ReturnType<typeof save>, first as ReturnType<typeof save>);
        assert.equal(inventoryOf(second).length, 501, 'and is not shaved off on the one after');
    });

    it('caps a first save (no existing record) at the base ceiling', () => {
        // Nothing is stored yet, so there is nothing to preserve and the plain
        // 500 applies — a brand-new save cannot arrive over-cap legitimately.
        const out = sanitizeCharacterSave(save(items(900)), null);
        assert.ok(inventoryOf(out).length <= CAP, 'a first save is held to the base cap');
    });
});
