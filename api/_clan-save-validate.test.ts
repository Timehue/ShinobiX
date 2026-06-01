import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateClanSaveWrite } from './_clan-save-validate.js';

// Audit #16 lockdown: net-new treasury.items must come from the atomic
// /api/clan/treasury/donate endpoint (which verifies ownership). The save blob
// may only RE-ASSERT the current items (migrated client re-saves the
// endpoint-credited treasury verbatim) or REMOVE them (withdrawals/sends).
// Currency caps are unchanged defense-in-depth and are spot-checked so the
// lockdown can't be confused with a currency-credit change (war/agenda/
// warSupply rewards still legitimately credit currencies via the save blob).

const member = { callerName: 'akira', isAdmin: false };
const admin = { callerName: '', isAdmin: true };

function clanWith(items: unknown, currency: Record<string, number> = {}) {
    return { name: 'Storm', founderName: 'Kaze', treasury: { ...currency, items } };
}
function items(next: { treasury?: Record<string, unknown> }) {
    return (next.treasury as Record<string, unknown>).items;
}

describe('validateClanSaveWrite — treasury.items lockdown (#16)', () => {
    it('allows a verbatim re-assert of the existing items (zero delta)', () => {
        const prev = clanWith([{ itemId: 'kunai', count: 3 }]);
        const { next, suppressed } = validateClanSaveWrite(prev, clanWith([{ itemId: 'kunai', count: 3 }]), member);
        assert.deepEqual(items(next), [{ itemId: 'kunai', count: 3 }]);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });

    it('allows removing/withdrawing items (counts only go down)', () => {
        const prev = clanWith([{ itemId: 'kunai', count: 3 }, { itemId: 'scroll', count: 1 }]);
        const { next, suppressed } = validateClanSaveWrite(prev, clanWith([{ itemId: 'kunai', count: 1 }]), member);
        assert.deepEqual(items(next), [{ itemId: 'kunai', count: 1 }]);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });

    it('rejects a brand-new itemId (mint) and reverts to prev', () => {
        const prev = clanWith([{ itemId: 'kunai', count: 1 }]);
        const { next, suppressed } = validateClanSaveWrite(
            prev,
            clanWith([{ itemId: 'kunai', count: 1 }, { itemId: 'legendary-blade', count: 1 }]),
            member,
        );
        assert.deepEqual(items(next), [{ itemId: 'kunai', count: 1 }]);
        assert.equal(suppressed.some((s) => s.includes('legendary-blade')), true);
    });

    it('rejects raising the count of an existing item (mint) and reverts', () => {
        const prev = clanWith([{ itemId: 'kunai', count: 1 }]);
        const { next, suppressed } = validateClanSaveWrite(prev, clanWith([{ itemId: 'kunai', count: 99 }]), member);
        assert.deepEqual(items(next), [{ itemId: 'kunai', count: 1 }]);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), true);
    });

    it('lets admin add items (bypass)', () => {
        const prev = clanWith([{ itemId: 'kunai', count: 1 }]);
        const { next, suppressed } = validateClanSaveWrite(
            prev,
            clanWith([{ itemId: 'kunai', count: 1 }, { itemId: 'gift', count: 2 }]),
            admin,
        );
        assert.deepEqual(items(next), [{ itemId: 'kunai', count: 1 }, { itemId: 'gift', count: 2 }]);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });
});

describe('validateClanSaveWrite — currency caps unchanged by the lockdown', () => {
    it('still caps a ryo increase at the per-write ceiling (not hard-blocked)', () => {
        const prev = clanWith([], { ryo: 0 });
        const { next } = validateClanSaveWrite(prev, clanWith([], { ryo: 1_000_000 }), member);
        assert.equal((next.treasury as Record<string, number>).ryo, 50_000); // before(0) + cap(50_000)
    });

    it('still allows a warSupply increase within cap (war-earned, save-blob path)', () => {
        const prev = clanWith([], { warSupply: 10 });
        const { next } = validateClanSaveWrite(prev, clanWith([], { warSupply: 60 }), member);
        assert.equal((next.treasury as Record<string, number>).warSupply, 60); // +50 within cap 100
    });
});
