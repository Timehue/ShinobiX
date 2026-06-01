import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateVillageStateWrite } from './_village-state-validate.js';

// Audit #16 lockdown (village twin): net-new treasury.items must come from the
// atomic /api/village/treasury/donate endpoint. The save blob may only
// RE-ASSERT the current items or REMOVE them (Kage withdrawals/sends).
// Currency caps are unchanged — daily-agenda / other gameplay rewards still
// credit currencies via the save blob, so currencies are NOT hard-blocked.
//
// Treasury-only writes with kageState=null exercise no IO (the notice/silence
// and KV paths are gated behind other incoming fields).

const villager = { callerName: 'rin', isAdmin: false, village: 'Leaf' };
const admin = { callerName: '', isAdmin: true, village: 'Leaf' };

function stateWith(items: unknown, currency: Record<string, number> = {}) {
    return { treasury: { ...currency, items } };
}
function items(next: { treasury?: Record<string, unknown> }) {
    return (next.treasury as Record<string, unknown>).items;
}

describe('validateVillageStateWrite — treasury.items lockdown (#16)', () => {
    it('allows a verbatim re-assert of the existing items', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 2 }]);
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([{ itemId: 'ration', count: 2 }]), villager, null);
        assert.deepEqual(items(next), [{ itemId: 'ration', count: 2 }]);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });

    it('allows withdrawing items (counts only go down)', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 2 }]);
        const { next } = await validateVillageStateWrite(prev, stateWith([]), villager, null);
        assert.deepEqual(items(next), []);
    });

    it('rejects a brand-new itemId (mint) and reverts to prev', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 1 }]);
        const { next, suppressed } = await validateVillageStateWrite(
            prev,
            stateWith([{ itemId: 'ration', count: 1 }, { itemId: 'forbidden-scroll', count: 1 }]),
            villager,
            null,
        );
        assert.deepEqual(items(next), [{ itemId: 'ration', count: 1 }]);
        assert.equal(suppressed.some((s) => s.includes('forbidden-scroll')), true);
    });

    it('rejects raising an existing item count (mint) and reverts', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 1 }]);
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([{ itemId: 'ration', count: 50 }]), villager, null);
        assert.deepEqual(items(next), [{ itemId: 'ration', count: 1 }]);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), true);
    });

    it('lets admin add items (bypass)', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 1 }]);
        const { next, suppressed } = await validateVillageStateWrite(
            prev,
            stateWith([{ itemId: 'ration', count: 1 }, { itemId: 'gift', count: 1 }]),
            admin,
            null,
        );
        assert.deepEqual(items(next), [{ itemId: 'ration', count: 1 }, { itemId: 'gift', count: 1 }]);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });
});

describe('validateVillageStateWrite — currency caps unchanged by the lockdown', () => {
    it('still caps a ryo increase at the per-write ceiling (not hard-blocked)', async () => {
        const prev = stateWith([], { ryo: 0 });
        const { next } = await validateVillageStateWrite(prev, stateWith([], { ryo: 1_000_000 }), villager, null);
        assert.equal((next.treasury as Record<string, number>).ryo, 20_000); // before(0) + cap(20_000)
    });

    it('still allows agenda-style honorSeals credits within cap (save-blob reward path)', async () => {
        const prev = stateWith([], { honorSeals: 0 });
        const { next } = await validateVillageStateWrite(prev, stateWith([], { honorSeals: 15 }), villager, null);
        assert.equal((next.treasury as Record<string, number>).honorSeals, 15); // +15 within cap 25
    });
});
