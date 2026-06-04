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

describe('validateClanSaveWrite — warHistory same-length content (#16 secondary)', () => {
    const founder = { callerName: 'kaze', isAdmin: false }; // matches founderName below
    function clanHist(hist: Record<string, unknown>[]) {
        return { name: 'Storm', founderName: 'Kaze', warHistory: hist };
    }
    function hist(next: { warHistory?: unknown }) {
        return next.warHistory;
    }

    it('allows a verbatim re-assert of warHistory by a regular member', () => {
        const prev = clanHist([{ id: 'w1', result: 'Lost', warCrateId: '' }]);
        const { next, suppressed } = validateClanSaveWrite(prev, clanHist([{ id: 'w1', result: 'Lost', warCrateId: '' }]), member);
        assert.deepEqual(hist(next), [{ id: 'w1', result: 'Lost', warCrateId: '' }]);
        assert.equal(suppressed.some((s) => s.includes('warHistory')), false);
    });

    it('blocks a regular member rewriting an entry (mint) and reverts to prev', () => {
        const prev = clanHist([{ id: 'w1', result: 'Lost', warCrateId: '' }]);
        const { next, suppressed } = validateClanSaveWrite(
            prev,
            clanHist([{ id: 'w1', result: 'Won', warCrateId: 'crate-1' }]),
            member,
        );
        assert.deepEqual(hist(next), [{ id: 'w1', result: 'Lost', warCrateId: '' }]);
        assert.equal(suppressed.some((s) => s.includes('warHistory in-place content edit')), true);
    });

    it('allows the Founder (admin-role) to change an entry at the same length (war-end at cap)', () => {
        const prev = clanHist([{ id: 'w1', result: 'Lost' }]);
        const { next, suppressed } = validateClanSaveWrite(prev, clanHist([{ id: 'w2', result: 'Won', warCrateId: 'c2' }]), founder);
        assert.deepEqual(hist(next), [{ id: 'w2', result: 'Won', warCrateId: 'c2' }]);
        assert.equal(suppressed.some((s) => s.includes('warHistory in-place content edit')), false);
    });

    it('allows a full admin to change warHistory content', () => {
        const prev = clanHist([{ id: 'w1', result: 'Lost' }]);
        const { next } = validateClanSaveWrite(prev, clanHist([{ id: 'w9', result: 'Won' }]), admin);
        assert.deepEqual(hist(next), [{ id: 'w9', result: 'Won' }]);
    });
});

describe('validateClanSaveWrite — bootstrap (first clan write, #2)', () => {
    it('keeps founderName + self-membership when the founder creates the clan', () => {
        const ctx = { callerName: 'akira', isAdmin: false };
        const incoming = {
            name: 'Storm', village: 'Leaf', founderName: 'Akira', createdAt: 123,
            members: [{ name: 'Akira', isFounder: true }],
        };
        const { next, suppressed } = validateClanSaveWrite(null, incoming, ctx);
        assert.equal(next.founderName, 'Akira');
        assert.deepEqual(next.members, [{ name: 'Akira', isFounder: true }]);
        assert.equal(next.createdAt, 123);
        assert.equal(suppressed.some((s) => s.includes('founderName')), false);
        assert.equal(suppressed.some((s) => s.includes('members illegal')), false);
    });

    it('matches a multi-word founder via safeName (Aka Ito → akaito)', () => {
        const ctx = { callerName: 'akaito', isAdmin: false };
        const incoming = { name: 'Storm', village: 'Leaf', founderName: 'Aka Ito', members: [{ name: 'Aka Ito', isFounder: true }] };
        const { next, suppressed } = validateClanSaveWrite(null, incoming, ctx);
        assert.equal(next.founderName, 'Aka Ito');
        assert.deepEqual(next.members, [{ name: 'Aka Ito', isFounder: true }]);
        assert.equal(suppressed.length, 0);
    });

    it('does NOT let a non-founder bootstrap someone else as founder', () => {
        const ctx = { callerName: 'mallory', isAdmin: false };
        const incoming = { name: 'Storm', village: 'Leaf', founderName: 'Akira', members: [{ name: 'Akira', isFounder: true }] };
        const { next, suppressed } = validateClanSaveWrite(null, incoming, ctx);
        assert.notEqual(next.founderName, 'Akira');
        assert.equal(suppressed.some((s) => s.includes('founderName')), true);
    });

    it('still pins founderName on an EXISTING clan (no bootstrap)', () => {
        const prev = { name: 'Storm', founderName: 'Kaze' };
        const ctx = { callerName: 'akira', isAdmin: false };
        const { next, suppressed } = validateClanSaveWrite(prev, { name: 'Storm', founderName: 'Akira' }, ctx);
        assert.equal(next.founderName, 'Kaze');
        assert.equal(suppressed.some((s) => s.includes('founderName')), true);
    });

    it('recognizes a stored multi-word founder on later writes (callerRole via safeName)', () => {
        // Founder "Aka Ito" kicks a member on a later (non-bootstrap) write.
        // Under the old lower() comparison "aka ito" !== slug "akaito", so the
        // founder was unrecognized and the kick reverted.
        const prev = { name: 'Storm', founderName: 'Aka Ito', members: [{ name: 'Aka Ito' }, { name: 'Grunt' }] };
        const ctx = { callerName: 'akaito', isAdmin: false };
        const { next, suppressed } = validateClanSaveWrite(prev, { ...prev, members: [{ name: 'Aka Ito' }] }, ctx);
        assert.deepEqual(next.members, [{ name: 'Aka Ito' }]);
        assert.equal(suppressed.some((s) => s.includes('members illegal')), false);
    });

    it('does not relax treasury minting on bootstrap (war crate / currency stay locked)', () => {
        const ctx = { callerName: 'akira', isAdmin: false };
        const incoming = {
            name: 'Storm', village: 'Leaf', founderName: 'Akira',
            members: [{ name: 'Akira', isFounder: true }],
            treasury: { ryo: 999999, items: [{ itemId: 'legendary-blade', count: 1 }] },
        };
        const { next, suppressed } = validateClanSaveWrite(null, incoming, ctx);
        assert.equal((next.treasury as Record<string, number>).ryo, 0);
        assert.deepEqual((next.treasury as Record<string, unknown>).items, []);
        assert.equal(suppressed.some((s) => s.includes('treasury')), true);
    });
});

describe('validateClanSaveWrite — currency lockdown (#17, step 1a)', () => {
    it('blocks a non-admin clan ryo increase via the save blob (credit-without-debit)', () => {
        const prev = clanWith([], { ryo: 0 });
        const { next, suppressed } = validateClanSaveWrite(prev, clanWith([], { ryo: 1_000_000 }), member);
        assert.equal((next.treasury as Record<string, number>).ryo, 0); // kept at prev, NOT credited
        assert.equal(suppressed.some((s) => s.includes('treasury.ryo increase via save blob blocked')), true);
    });

    it('blocks a non-admin special-currency increase too (e.g. fateShards)', () => {
        const prev = clanWith([], { fateShards: 3 });
        const { next, suppressed } = validateClanSaveWrite(prev, clanWith([], { fateShards: 99 }), member);
        assert.equal((next.treasury as Record<string, number>).fateShards, 3);
        assert.equal(suppressed.some((s) => s.includes('treasury.fateShards increase via save blob blocked')), true);
    });

    it('allows a zero-delta re-assert (post-donate the client re-saves the credited value)', () => {
        const prev = clanWith([], { ryo: 5000, fateShards: 2 });
        const { next, suppressed } = validateClanSaveWrite(prev, clanWith([], { ryo: 5000, fateShards: 2 }), member);
        assert.equal((next.treasury as Record<string, number>).ryo, 5000);
        assert.equal(suppressed.some((s) => s.includes('increase via save blob blocked')), false);
    });

    it('allows an admin to increase clan currency (admin bypass)', () => {
        const prev = clanWith([], { ryo: 0 });
        const { next } = validateClanSaveWrite(prev, clanWith([], { ryo: 5000 }), admin);
        assert.equal((next.treasury as Record<string, number>).ryo, 5000);
    });

    it('blocks a warSupply increase too (collected via /api/clan/territory/collect-supply, step 1b)', () => {
        const prev = clanWith([], { warSupply: 10 });
        const { next, suppressed } = validateClanSaveWrite(prev, clanWith([], { warSupply: 60 }), member);
        assert.equal((next.treasury as Record<string, number>).warSupply, 10); // kept at prev, not credited
        assert.equal(suppressed.some((s) => s.includes('treasury.warSupply increase via save blob blocked')), true);
    });

    it('allows an admin warSupply increase + a member decrease (spend) unchanged', () => {
        const prevAdmin = clanWith([], { warSupply: 0 });
        assert.equal((validateClanSaveWrite(prevAdmin, clanWith([], { warSupply: 500 }), admin).next.treasury as Record<string, number>).warSupply, 500);
        const prevSpend = clanWith([], { warSupply: 100 });
        const founderCtx = { callerName: 'kaze', isAdmin: false }; // founderName 'Kaze' → admin-role
        assert.equal((validateClanSaveWrite(prevSpend, clanWith([], { warSupply: 0 }), founderCtx).next.treasury as Record<string, number>).warSupply, 0);
    });
});
