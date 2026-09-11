import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateClanSaveWrite } from './_clan-save-validate.js';

// The clan treasury is server-owned. Items arrive through the atomic
// /api/clan/treasury/donate endpoint (audit #16, verifies ownership) and leave
// through /api/clan/treasury/transfer; currencies move only through their
// endpoints (#17). A non-admin save blob may only RE-ASSERT the treasury: it
// cannot raise it (a mint) or lower it (a stale re-assert from a Clan Hall copy
// loaded before another member's donation).

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

    it('blocks removing items through the blob (the transfer endpoint moves them)', () => {
        // A member whose Clan Hall copy predates a donation re-asserts a list
        // without it. Accepting that would delete another member's gift.
        const prev = clanWith([{ itemId: 'kunai', count: 3 }, { itemId: 'scroll', count: 1 }]);
        const { next, suppressed } = validateClanSaveWrite(prev, clanWith([{ itemId: 'kunai', count: 1 }]), member);
        assert.deepEqual(items(next), [{ itemId: 'kunai', count: 3 }, { itemId: 'scroll', count: 1 }]);
        assert.ok(suppressed.some((s) => s.includes('treasury.items removal [kunai,scroll]')));
    });

    it('blocks removing items even for the Founder', () => {
        const prev = clanWith([{ itemId: 'scroll', count: 1 }]);
        const { next } = validateClanSaveWrite(prev, clanWith([]), { callerName: 'kaze', isAdmin: false });
        assert.deepEqual(items(next), [{ itemId: 'scroll', count: 1 }]);
    });

    it('lets admin remove items (bypass)', () => {
        const prev = clanWith([{ itemId: 'kunai', count: 3 }]);
        const { next, suppressed } = validateClanSaveWrite(prev, clanWith([]), admin);
        assert.deepEqual(items(next), []);
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

describe('validateClanSaveWrite — non-member join requests', () => {
    // The save-handler membership gate lets a non-member's write through ONLY
    // when it's a bona-fide self-join-request; the validator below is the
    // second layer that enforces a non-member can add ONLY their own entry.
    function clanWithReqs(reqs: Record<string, unknown>[], members: Record<string, unknown>[] = [{ name: 'Kaze' }]) {
        return { name: 'Storm', founderName: 'Kaze', members, joinRequests: reqs };
    }

    it('lets a non-member add their OWN join request', () => {
        const ctx = { callerName: 'newbie', isAdmin: false };
        const prev = clanWithReqs([]);
        const { next, suppressed } = validateClanSaveWrite(prev, clanWithReqs([{ name: 'Newbie' }]), ctx);
        assert.deepEqual(next.joinRequests, [{ name: 'Newbie' }]);
        assert.equal(suppressed.some((s) => s.includes('joinRequest')), false);
    });

    it('recognizes a multi-word requester via safeName ("Aka Ito" → akaito)', () => {
        const ctx = { callerName: 'akaito', isAdmin: false };
        const prev = clanWithReqs([]);
        const { next, suppressed } = validateClanSaveWrite(prev, clanWithReqs([{ name: 'Aka Ito' }]), ctx);
        assert.deepEqual(next.joinRequests, [{ name: 'Aka Ito' }]);
        assert.equal(suppressed.some((s) => s.includes('joinRequest')), false);
    });

    it('blocks a non-member adding SOMEONE ELSE as a requester (reverts to prev)', () => {
        const ctx = { callerName: 'mallory', isAdmin: false };
        const prev = clanWithReqs([]);
        const { next, suppressed } = validateClanSaveWrite(prev, clanWithReqs([{ name: 'Victim' }]), ctx);
        assert.deepEqual(next.joinRequests, []);
        assert.equal(suppressed.some((s) => s.includes('joinRequest illegal add')), true);
    });

    it('does not let a non-member delete another pending request (admin-role only)', () => {
        const ctx = { callerName: 'newbie', isAdmin: false };
        const prev = clanWithReqs([{ name: 'Other' }]);
        // Non-member tries to add self AND wipe the existing request.
        const { next, suppressed } = validateClanSaveWrite(prev, clanWithReqs([{ name: 'Newbie' }]), ctx);
        assert.deepEqual(next.joinRequests, [{ name: 'Other' }]);
        assert.equal(suppressed.some((s) => s.includes('joinRequest illegal remove')), true);
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

    it('allows an admin warSupply change, but not a decrease from the Founder', () => {
        const prevAdmin = clanWith([], { warSupply: 0 });
        assert.equal((validateClanSaveWrite(prevAdmin, clanWith([], { warSupply: 500 }), admin).next.treasury as Record<string, number>).warSupply, 500);
        const prevSpend = clanWith([], { warSupply: 100 });
        const founderCtx = { callerName: 'kaze', isAdmin: false }; // founderName 'Kaze' → admin-role
        const founderWrite = validateClanSaveWrite(prevSpend, clanWith([], { warSupply: 0 }), founderCtx);
        assert.equal((founderWrite.next.treasury as Record<string, number>).warSupply, 100);
        assert.ok(founderWrite.suppressed.some((s) => s.includes('treasury.warSupply decrease via save blob blocked')));
        assert.equal((validateClanSaveWrite(prevSpend, clanWith([], { warSupply: 0 }), admin).next.treasury as Record<string, number>).warSupply, 0);
    });
});

// The Clan Hall saves the whole clan document from a copy it loaded when the
// hall opened — minutes old — for routine leadership actions (recruitment text,
// a notice, a role change). If a member donated since, that copy is lower than
// the server, and the old leadership-withdrawal rule accepted it.
describe('validateClanSaveWrite — a stale leadership re-assert cannot erase a donation', () => {
    it('keeps every currency and item a member donated after the Founder loaded the hall', () => {
        const afterDonation = clanWith([{ itemId: 'gift', count: 1 }], { ryo: 5_000, fateShards: 2, boneCharms: 3, auraStones: 1, mythicSeals: 1, warSupply: 40, provisions: 12 });
        const staleCopy = clanWith([], { ryo: 1_000, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, warSupply: 0, provisions: 0 });
        const { next } = validateClanSaveWrite(afterDonation, { ...staleCopy, recruitment: 'Recruiting strong genin.' }, { callerName: 'kaze', isAdmin: false });
        assert.deepEqual(next.treasury, afterDonation.treasury);
        assert.equal(next.recruitment, 'Recruiting strong genin.', 'the rest of the write still lands');
    });
});

describe('validateClanSaveWrite — clan xp/level lockdown (server-credited only)', () => {
    function clanXp(level: number, xp: number) {
        return { name: 'Storm', founderName: 'Kaze', level, xp };
    }
    it('blocks a non-admin clan LEVEL jump via the save blob (would forge the hall-tier gate)', () => {
        const { next, suppressed } = validateClanSaveWrite(clanXp(3, 100), clanXp(100, 100), member);
        assert.equal(next.level, 3); // kept at prev, NOT forged to 100
        assert.equal(suppressed.some((s) => s.includes('clan level change via save blob blocked')), true);
    });
    it('blocks a non-admin clan XP increase via the save blob', () => {
        const { next, suppressed } = validateClanSaveWrite(clanXp(3, 100), clanXp(3, 999_999), member);
        assert.equal(next.xp, 100);
        assert.equal(suppressed.some((s) => s.includes('clan xp change via save blob blocked')), true);
    });
    it('reverts a STALE lower xp to prev (no XP lost when a stale client re-saves)', () => {
        // A concurrent server credit moved xp to 500; a stale client posts 100.
        const { next } = validateClanSaveWrite(clanXp(5, 500), clanXp(5, 100), member);
        assert.equal(next.xp, 500); // server value preserved, stale client value ignored
    });
    it('allows a zero-delta re-assert of xp/level (client re-saves the credited value)', () => {
        const { next, suppressed } = validateClanSaveWrite(clanXp(5, 250), clanXp(5, 250), member);
        assert.equal(next.level, 5);
        assert.equal(next.xp, 250);
        assert.equal(suppressed.some((s) => s.includes('via save blob blocked')), false);
    });
    it('lets admin set xp/level (bypass)', () => {
        const { next } = validateClanSaveWrite(clanXp(3, 100), clanXp(50, 4_000), admin);
        assert.equal(next.level, 50);
        assert.equal(next.xp, 4_000);
    });
    it('allows a fresh clan bootstrap at level 1 / xp 0', () => {
        const { next, suppressed } = validateClanSaveWrite(
            null,
            { name: 'New', founderName: 'Akira', level: 1, xp: 0 },
            { callerName: 'akira', isAdmin: false },
        );
        assert.equal(next.level, 1);
        assert.equal(next.xp, 0);
        assert.equal(suppressed.some((s) => s.includes('via save blob blocked')), false);
    });
});
