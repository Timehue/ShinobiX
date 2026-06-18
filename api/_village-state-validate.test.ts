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

    it('lets the seated Kage open the gate (~30 days, clamped)', async () => {
        const want = Date.now() + 30 * DAY;
        const { next, suppressed } = await validateVillageStateWrite({}, { hollowGateUnlockedUntil: want }, villager, kage);
        const until = next.hollowGateUnlockedUntil as number;
        assert.ok(until >= Date.now() + 29 * DAY && until <= Date.now() + 31 * DAY, `until=${until}`);
        assert.equal(suppressed.some((s) => s.includes('hollowGateUnlockedUntil')), false);
    });

    it('clamps a tampered far-future expiry to ~31 days', async () => {
        const want = Date.now() + 3650 * DAY; // ~10 years
        const { next } = await validateVillageStateWrite({}, { hollowGateUnlockedUntil: want }, villager, kage);
        assert.ok((next.hollowGateUnlockedUntil as number) <= Date.now() + 32 * DAY);
    });

    it('stacks another 30 days onto an already-active window (extend across writes)', async () => {
        const prevUntil = Date.now() + 10 * DAY;
        const prev = { hollowGateUnlockedUntil: prevUntil };
        const { next } = await validateVillageStateWrite(prev, { hollowGateUnlockedUntil: prevUntil + 30 * DAY }, villager, kage);
        const until = next.hollowGateUnlockedUntil as number;
        assert.ok(until >= prevUntil + 29 * DAY && until <= prevUntil + 31 * DAY, `until=${until}`);
    });

    it('blocks a non-Kage from extending (pins to prev)', async () => {
        const { next, suppressed } = await validateVillageStateWrite({}, { hollowGateUnlockedUntil: Date.now() + 30 * DAY }, notKage, kage);
        assert.equal(next.hollowGateUnlockedUntil, 0);
        assert.equal(suppressed.some((s) => s.includes('only seatedKage may unlock')), true);
    });

    it('pins an active unlock when a non-admin write tries to lower it (immune to stale clobber)', async () => {
        const prevUntil = Date.now() + 20 * DAY;
        const { next, suppressed } = await validateVillageStateWrite({ hollowGateUnlockedUntil: prevUntil }, { hollowGateUnlockedUntil: 0 }, villager, kage);
        assert.equal(next.hollowGateUnlockedUntil, prevUntil);
        assert.equal(suppressed.some((s) => s.includes('decrease (admin only)')), true);
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

    it('does not post a re-seal notice when the Kage re-opens on the same write', async () => {
        const expired = Date.now() - 1000;
        const { next } = await validateVillageStateWrite({ hollowGateUnlockedUntil: expired }, { hollowGateUnlockedUntil: Date.now() + 30 * DAY }, villager, kage);
        const posts = (next.noticePosts ?? []) as Array<Record<string, unknown>>;
        assert.equal(posts.filter((p) => String(p.id).startsWith('hg-reseal-')).length, 0);
    });
});
