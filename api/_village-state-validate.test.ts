import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateVillageStateWrite } from './_village-state-validate.js';

// The village treasury is server-owned. Items arrive through the atomic
// /api/village/treasury/donate endpoint (audit #16) and leave through
// /api/village/treasury/transfer; currencies and the stores move only through
// their endpoints (#17). A non-admin save blob may only RE-ASSERT the treasury:
// it cannot raise it (a mint) or lower it (a stale re-assert that would erase a
// donation made after the client's last poll).
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

    it('blocks removing items through the blob (the transfer endpoint moves them)', async () => {
        // A villager whose last poll predates a donation re-asserts a list
        // without it. Accepting that would delete another villager's gift.
        const prev = stateWith([{ itemId: 'ration', count: 2 }, { itemId: 'gift', count: 1 }]);
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([{ itemId: 'ration', count: 1 }]), villager, null);
        assert.deepEqual(items(next), [{ itemId: 'ration', count: 2 }, { itemId: 'gift', count: 1 }]);
        assert.ok(suppressed.some((s) => s.includes('treasury.items removal [ration,gift]')));
    });

    it('blocks removing items even for the seated Kage', async () => {
        const prev = stateWith([{ itemId: 'gift', count: 1 }]);
        const { next } = await validateVillageStateWrite(prev, stateWith([]), villager, { seatedKage: 'rin' });
        assert.deepEqual(items(next), [{ itemId: 'gift', count: 1 }]);
    });

    it('lets admin remove items (bypass)', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 2 }]);
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([]), admin, null);
        assert.deepEqual(items(next), []);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), false);
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

describe('validateVillageStateWrite — currency lockdown (#17, step 1c)', () => {
    const admin = { callerName: '', isAdmin: true, village: 'Leaf' };

    it('blocks a non-admin village-treasury currency increase (credit-without-debit)', async () => {
        const prev = stateWith([], { ryo: 0 });
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([], { ryo: 1_000_000 }), villager, null);
        assert.equal((next.treasury as Record<string, number>).ryo, 0); // kept at prev, not credited
        assert.equal(suppressed.some((s) => s.includes('treasury.ryo increase via save blob blocked')), true);
    });

    it('blocks the agenda-style honorSeals increase too (now credited via the endpoint)', async () => {
        const prev = stateWith([], { honorSeals: 0 });
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([], { honorSeals: 15 }), villager, null);
        assert.equal((next.treasury as Record<string, number>).honorSeals, 0);
        assert.equal(suppressed.some((s) => s.includes('treasury.honorSeals increase via save blob blocked')), true);
    });

    it('allows a zero-delta re-assert (post-endpoint the client re-saves the credited value)', async () => {
        const prev = stateWith([], { ryo: 1500, honorSeals: 15 });
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([], { ryo: 1500, honorSeals: 15 }), villager, null);
        assert.equal((next.treasury as Record<string, number>).ryo, 1500);
        assert.equal(suppressed.some((s) => s.includes('increase via save blob blocked')), false);
    });

    it('allows an admin to increase village currency (admin bypass)', async () => {
        const prev = stateWith([], { ryo: 0 });
        const { next } = await validateVillageStateWrite(prev, stateWith([], { ryo: 1500 }), admin, null);
        assert.equal((next.treasury as Record<string, number>).ryo, 1500);
    });
});

describe('validateVillageStateWrite — Hollow Gate 30-day timed unlock', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const kage = { seatedKage: 'rin' };               // matches `villager.callerName`
    const notKage = { callerName: 'jin', isAdmin: false, village: 'Leaf' };

    it('requires the paid endpoint even for the seated Kage', async () => {
        const want = Date.now() + 30 * DAY;
        const { next, suppressed } = await validateVillageStateWrite({}, { hollowGateUnlockedUntil: want }, villager, kage);
        const until = next.hollowGateUnlockedUntil as number;
        assert.equal(until, 0);
        assert.equal(suppressed.some((s) => s.includes('paid unlock endpoint')), true);
    });

    it('rejects a tampered far-future expiry', async () => {
        const want = Date.now() + 3650 * DAY; // ~10 years
        const { next } = await validateVillageStateWrite({}, { hollowGateUnlockedUntil: want }, villager, kage);
        assert.equal(next.hollowGateUnlockedUntil, 0);
    });

    it('does not extend an active window through a generic write', async () => {
        const prevUntil = Date.now() + 10 * DAY;
        const prev = { hollowGateUnlockedUntil: prevUntil };
        const { next } = await validateVillageStateWrite(prev, { hollowGateUnlockedUntil: prevUntil + 30 * DAY }, villager, kage);
        const until = next.hollowGateUnlockedUntil as number;
        assert.equal(until, prevUntil);
    });

    it('blocks a non-Kage from extending (pins to prev)', async () => {
        const { next, suppressed } = await validateVillageStateWrite({}, { hollowGateUnlockedUntil: Date.now() + 30 * DAY }, notKage, kage);
        assert.equal(next.hollowGateUnlockedUntil, 0);
        assert.equal(suppressed.some((s) => s.includes('paid unlock endpoint')), true);
    });

    it('pins an active unlock when a non-admin write tries to lower it (immune to stale clobber)', async () => {
        const prevUntil = Date.now() + 20 * DAY;
        const { next, suppressed } = await validateVillageStateWrite({ hollowGateUnlockedUntil: prevUntil }, { hollowGateUnlockedUntil: 0 }, villager, kage);
        assert.equal(next.hollowGateUnlockedUntil, prevUntil);
        assert.equal(suppressed.some((s) => s.includes('paid unlock endpoint')), true);
    });

    it('lets an admin re-lock early (lower the expiry)', async () => {
        const { next, suppressed } = await validateVillageStateWrite({ hollowGateUnlockedUntil: Date.now() + 20 * DAY }, { hollowGateUnlockedUntil: 0 }, admin, kage);
        assert.equal(next.hollowGateUnlockedUntil, 0);
        assert.equal(suppressed.some((s) => s.includes('decrease')), false);
    });

    it('posts a one-time re-seal notice once the window lapses, then dedupes', async () => {
        const expired = Date.now() - 1000;
        const prev = { hollowGateUnlockedUntil: expired };
        const first = await validateVillageStateWrite(prev, { hollowGateUnlockedUntil: expired }, villager, null);
        const posts1 = (first.next.noticePosts ?? []) as Array<Record<string, unknown>>;
        assert.equal(posts1.filter((p) => String(p.id).startsWith('hg-reseal-')).length, 1);
        assert.equal(first.next.hollowGateExpiryNoticedFor, expired);

        // A second write after the marker is set must not post a duplicate.
        const second = await validateVillageStateWrite(first.next, { hollowGateUnlockedUntil: expired }, villager, null);
        const posts2 = (second.next.noticePosts ?? []) as Array<Record<string, unknown>>;
        assert.equal(posts2.filter((p) => String(p.id).startsWith('hg-reseal-')).length, 1);
    });

    it('does not post a re-seal notice after a paid reopening', async () => {
        const expired = Date.now() - 1000;
        const paidUntil = Date.now() + 30 * DAY;
        const { next } = await validateVillageStateWrite({ hollowGateUnlockedUntil: paidUntil }, { hollowGateUnlockedUntil: expired }, villager, kage);
        const posts = (next.noticePosts ?? []) as Array<Record<string, unknown>>;
        assert.equal(posts.filter((p) => String(p.id).startsWith('hg-reseal-')).length, 0);
    });
});

// War morale stamps are set ONLY by settleVillageWar. The two guards run in
// OPPOSITE directions: a debuff is dodged by shortening it, a buff is stolen by
// extending it.
describe('validateVillageStateWrite — war morale stamps', () => {
    const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
    const DAY = 24 * 60 * 60 * 1000;

    it('blocks a client EXTENDING its victory buff', async () => {
        const prev = { warWinBuffUntil: NOW + DAY };
        const { next, suppressed } = await validateVillageStateWrite(prev, { warWinBuffUntil: NOW + 400 * DAY }, villager, null);
        assert.equal(next.warWinBuffUntil, NOW + DAY, 'pinned to the server value');
        assert.ok(suppressed.some((s) => s.includes('warWinBuffUntil')));
    });

    it('blocks a client GRANTING itself a buff it never earned', async () => {
        const { next, suppressed } = await validateVillageStateWrite({}, { warWinBuffUntil: NOW + 30 * DAY }, villager, null);
        assert.equal(next.warWinBuffUntil, 0);
        assert.ok(suppressed.some((s) => s.includes('warWinBuffUntil')));
    });

    it('lets a client clear its own buff (harmless) and re-assert it unchanged', async () => {
        const prev = { warWinBuffUntil: NOW + DAY };
        const cleared = await validateVillageStateWrite(prev, { warWinBuffUntil: 0 }, villager, null);
        assert.equal(cleared.next.warWinBuffUntil, 0);
        const same = await validateVillageStateWrite(prev, { warWinBuffUntil: NOW + DAY }, villager, null);
        assert.equal(same.next.warWinBuffUntil, NOW + DAY);
        assert.equal(same.suppressed.some((s) => s.includes('warWinBuffUntil')), false);
    });

    it('still blocks a client SHORTENING its defeat debuff', async () => {
        const prev = { warLossDebuffUntil: NOW + 3 * DAY };
        const { next, suppressed } = await validateVillageStateWrite(prev, { warLossDebuffUntil: 0 }, villager, null);
        assert.equal(next.warLossDebuffUntil, NOW + 3 * DAY);
        assert.ok(suppressed.some((s) => s.includes('warLossDebuffUntil')));
    });

    it('admin may set either stamp (settlement / support tooling)', async () => {
        const prev = { warWinBuffUntil: NOW, warLossDebuffUntil: NOW + 3 * DAY };
        const { next } = await validateVillageStateWrite(prev, { warWinBuffUntil: NOW + 3 * DAY, warLossDebuffUntil: 0 }, admin, null);
        assert.equal(next.warWinBuffUntil, NOW + 3 * DAY);
        assert.equal(next.warLossDebuffUntil, 0);
    });
});

describe('validateVillageStateWrite - Village Stores (provisions / materialPoints)', () => {
    it('rejects a save-blob INCREASE of either store (keeps prev) for a villager', async () => {
        const prev = { treasury: { provisions: 10, materialPoints: 20 } };
        const { next, suppressed } = await validateVillageStateWrite(prev, { treasury: { provisions: 999, materialPoints: 999 } }, villager, null);
        assert.equal((next.treasury as Record<string, unknown>).provisions, 10);
        assert.equal((next.treasury as Record<string, unknown>).materialPoints, 20);
        assert.ok(suppressed.some((s) => s.includes('treasury.provisions increase')));
        assert.ok(suppressed.some((s) => s.includes('treasury.materialPoints increase')));
    });
    it('rejects a decrease from anyone but admin, the seated Kage included', async () => {
        const prev = { treasury: { provisions: 10, materialPoints: 20 } };
        const kage = { seatedKage: 'rin' };
        const villagerWrite = await validateVillageStateWrite(prev, { treasury: { provisions: 0 } }, { ...villager, callerName: 'someone' }, kage);
        assert.equal((villagerWrite.next.treasury as Record<string, unknown>).provisions, 10);
        assert.ok(villagerWrite.suppressed.some((s) => s.includes('treasury.provisions decrease')));
        const kageWrite = await validateVillageStateWrite(prev, { treasury: { provisions: 0, materialPoints: 5 } }, villager, kage);
        assert.equal((kageWrite.next.treasury as Record<string, unknown>).provisions, 10);
        assert.equal((kageWrite.next.treasury as Record<string, unknown>).materialPoints, 20);
        assert.ok(kageWrite.suppressed.some((s) => s.includes('treasury.materialPoints decrease')));
        const adminWrite = await validateVillageStateWrite(prev, { treasury: { provisions: 0, materialPoints: 5 } }, admin, kage);
        assert.equal((adminWrite.next.treasury as Record<string, unknown>).provisions, 0);
        assert.equal((adminWrite.next.treasury as Record<string, unknown>).materialPoints, 5);
    });
});

// The seated Kage's Town Hall re-posts the village blob after routine actions
// (a notice, an elder focus, a gift), built from a treasury it POLLED. If a
// villager donated after that poll, the blob is lower than the server — and
// the old seated-Kage withdrawal rule accepted it, erasing the donation.
describe('validateVillageStateWrite - a stale Kage re-assert cannot erase a donation', () => {
    it('keeps every currency, store and item a villager donated after the Kage last polled', async () => {
        const kage = { seatedKage: 'rin' };
        const afterDonation = { treasury: { ryo: 5_000, honorSeals: 201, fateShards: 2, boneCharms: 3, auraStones: 1, mythicSeals: 1, provisions: 41, materialPoints: 435, items: [{ itemId: 'gift', count: 1 }] } };
        const stalePoll = { treasury: { ryo: 1_000, honorSeals: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, provisions: 1, materialPoints: 15, items: [] } };
        const { next } = await validateVillageStateWrite(afterDonation, { ...stalePoll, notices: ['rin selected the war focus.'] }, villager, kage);
        assert.deepEqual(next.treasury, afterDonation.treasury);
        assert.deepEqual(next.notices, ['rin selected the war focus.'], 'the rest of the write still lands');
    });
});
