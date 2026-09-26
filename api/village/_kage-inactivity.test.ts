process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WAR_VILLAGES } from '../_war-map-sectors.js';
import type { Announcement } from '../_announce.js';

// Mirrors ANNOUNCEMENTS_KEY in api/_announce.ts (a value import would load
// _storage before the memory-KV env flag above is set).
const ANNOUNCEMENTS_KEY = 'game:announcements';

let kv: typeof import('../_storage.js').kv;
let mod: typeof import('./_kage-inactivity.js');
let settle: typeof import('./_kage-settle.js');
let notices: typeof import('../player/_offline-notices.js');

const DAY = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 7, 22, 3, 0, 0);
const VILLAGE = WAR_VILLAGES[0]; // Moonshadow Village

before(async () => {
    ({ kv } = await import('../_storage.js'));
    mod = await import('./_kage-inactivity.js');
    settle = await import('./_kage-settle.js');
    notices = await import('../player/_offline-notices.js');
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

beforeEach(async () => {
    for (const v of WAR_VILLAGES) await kv.del(settle.kageKey(v));
    await kv.del(ANNOUNCEMENTS_KEY);
    await kv.del('save:sleepy-kage');
    await kv.del(notices.offlineNoticesKey('sleepy-kage'));
});

function seated(kage = 'Sleepy-Kage', seatedAt = NOW - 40 * DAY) {
    return {
        kageSystemUnlocked: true,
        seatedKage: kage,
        firstLiberator: kage,
        unlockedAt: seatedAt,
        seatedAt,
        defenseCount: 2,
        history: [{ name: kage, village: VILLAGE, seatedAt, defenseCount: 2 }],
        challenge: null,
    };
}

async function announcements(): Promise<Announcement[]> {
    return (await kv.get<Announcement[]>(ANNOUNCEMENTS_KEY)) ?? [];
}

test('kageInactiveSince: pure threshold at exactly 10 days, fail-safe on unknown', () => {
    assert.equal(mod.KAGE_INACTIVITY_DAYS, 10);
    assert.equal(mod.kageInactiveSince(NOW - 10 * DAY, NOW), true);
    assert.equal(mod.kageInactiveSince(NOW - 11 * DAY, NOW), true);
    assert.equal(mod.kageInactiveSince(NOW - 10 * DAY + 1, NOW), false);
    assert.equal(mod.kageInactiveSince(NOW - 9 * DAY, NOW), false);
    assert.equal(mod.kageInactiveSince(0, NOW), false);
    assert.equal(mod.kageInactiveSince(NaN, NOW), false);
    assert.equal(mod.kageInactiveAt(NOW), NOW + 10 * DAY);
    assert.equal(mod.saveAtFromRecord({ _saveAt: 123.9 }), 123);
    assert.equal(mod.saveAtFromRecord({ character: {} }), null);
    assert.equal(mod.saveAtFromRecord(null), null);
});

test('pass dethrones a Kage absent for 10 days: seat open, reign closed inactive, announce + notice', async () => {
    await kv.set(settle.kageKey(VILLAGE), seated());
    await kv.set('save:sleepy-kage', { character: { name: 'Sleepy-Kage' }, _saveAt: NOW - 10 * DAY });

    const r = await mod.runKageInactivityPass(NOW);
    assert.deepEqual(r.dethroned, [VILLAGE]);
    assert.equal(r.processed, WAR_VILLAGES.length);

    const state = await kv.get<Record<string, unknown>>(settle.kageKey(VILLAGE));
    assert.equal(state?.kageSystemUnlocked, true, 'system stays unlocked');
    assert.equal(state?.seatedKage, undefined, 'seat is OPEN');
    assert.equal(state?.challenge, null);
    assert.equal(state?.firstLiberator, 'Sleepy-Kage', 'permanent brand preserved');
    const history = state?.history as Array<Record<string, unknown>>;
    assert.equal(history.length, 1);
    assert.equal(history[0].endedReason, 'inactive');
    assert.equal(history[0].endedAt, NOW);
    assert.equal(history[0].defenseCount, 2);

    const a = await announcements();
    assert.equal(a.length, 1);
    assert.equal(a[0].importance, 'high');
    assert.equal(a[0].title, 'The Seat Stands Empty');
    assert.equal(a[0].message, `Sleepy-Kage has not been seen in ${VILLAGE} for 10 days. The Kage seat is open to any challenger.`);
    assert.equal(a[0].receiptId, `kage-inactive:${VILLAGE}:${NOW - 40 * DAY}`);

    const inbox = await notices.takeOfflineNotices('sleepy-kage');
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].kind, 'kage-seat-lost');
    assert.equal(inbox[0].by, 'inactivity');
    assert.equal(inbox[0].village, VILLAGE);
    assert.equal(inbox[0].sector, 0);
});

test('pass does NOT dethrone at 9 days', async () => {
    await kv.set(settle.kageKey(VILLAGE), seated());
    await kv.set('save:sleepy-kage', { character: {}, _saveAt: NOW - 9 * DAY });

    const r = await mod.runKageInactivityPass(NOW);
    assert.deepEqual(r.dethroned, []);
    assert.equal(r.results.find((x) => x.village === VILLAGE)?.outcome, 'active');
    const state = await kv.get<Record<string, unknown>>(settle.kageKey(VILLAGE));
    assert.equal(state?.seatedKage, 'Sleepy-Kage');
    assert.equal((await announcements()).length, 0);
    assert.equal(await kv.get(notices.offlineNoticesKey('sleepy-kage')), null);
});

test('pass skips a vacant seat and a sealed village (no-op, no announce)', async () => {
    await kv.set(settle.kageKey(VILLAGE), { ...seated(), seatedKage: undefined });
    await kv.set(settle.kageKey(WAR_VILLAGES[1]), { kageSystemUnlocked: false });
    const r = await mod.runKageInactivityPass(NOW);
    assert.deepEqual(r.dethroned, []);
    assert.ok(r.results.every((x) => x.outcome === 'vacant'));
    assert.equal((await announcements()).length, 0);
});

test('pass never dethrones when the save is missing or has no _saveAt (fail safe)', async () => {
    await kv.set(settle.kageKey(VILLAGE), seated());
    // No save at all.
    let r = await mod.runKageInactivityPass(NOW);
    assert.deepEqual(r.dethroned, []);
    assert.equal(r.results.find((x) => x.village === VILLAGE)?.outcome, 'skipped-unreadable');
    // Save present but without a stamp.
    await kv.set('save:sleepy-kage', { character: { name: 'Sleepy-Kage' } });
    r = await mod.runKageInactivityPass(NOW);
    assert.deepEqual(r.dethroned, []);
    assert.equal(r.results.find((x) => x.village === VILLAGE)?.outcome, 'skipped-unreadable');
    // Save read throws.
    await kv.set('save:sleepy-kage', { _saveAt: NOW - 30 * DAY });
    const originalGet = kv.get.bind(kv);
    (kv as unknown as { get: unknown }).get = async (key: string) => {
        if (key === 'save:sleepy-kage') throw new Error('kv down');
        return originalGet(key);
    };
    try {
        r = await mod.runKageInactivityPass(NOW);
    } finally {
        (kv as unknown as { get: unknown }).get = originalGet;
    }
    assert.deepEqual(r.dethroned, []);
    assert.equal((await kv.get<Record<string, unknown>>(settle.kageKey(VILLAGE)))?.seatedKage, 'Sleepy-Kage');
    assert.equal((await announcements()).length, 0);
});

test('repeat runs are idempotent: the seat stays open and the herald posts exactly once', async () => {
    await kv.set(settle.kageKey(VILLAGE), seated());
    await kv.set('save:sleepy-kage', { _saveAt: NOW - 12 * DAY });
    await mod.runKageInactivityPass(NOW);
    const second = await mod.runKageInactivityPass(NOW + DAY);
    assert.deepEqual(second.dethroned, []);
    assert.equal(second.results.find((x) => x.village === VILLAGE)?.outcome, 'vacant');
    assert.equal((await announcements()).length, 1);
    const history = (await kv.get<Record<string, unknown>>(settle.kageKey(VILLAGE)))?.history as unknown[];
    assert.equal(history.length, 1, 'reign closed once, not re-closed');
    assert.equal((await notices.takeOfflineNotices('sleepy-kage')).length, 1);
});

test('a Kage who logs in between the outside read and the locked commit keeps the seat', async () => {
    await kv.set(settle.kageKey(VILLAGE), seated());
    await kv.set('save:sleepy-kage', { _saveAt: NOW - 15 * DAY });
    const originalGet = kv.get.bind(kv);
    let reads = 0;
    (kv as unknown as { get: unknown }).get = async (key: string) => {
        if (key === 'save:sleepy-kage' && ++reads === 2) {
            // Simulate an autosave landing right before the locked re-check.
            await kv.set('save:sleepy-kage', { _saveAt: NOW - 1 });
        }
        return originalGet(key);
    };
    let r;
    try {
        r = await mod.runKageInactivityPass(NOW);
    } finally {
        (kv as unknown as { get: unknown }).get = originalGet;
    }
    assert.deepEqual(r.dethroned, []);
    assert.equal((await kv.get<Record<string, unknown>>(settle.kageKey(VILLAGE)))?.seatedKage, 'Sleepy-Kage');
    assert.equal((await announcements()).length, 0);
});

test('a challenge open against the absent Kage is cleared, the stake refunded, no cooldown', async () => {
    await kv.set(settle.kageKey(VILLAGE), {
        ...seated(),
        challenge: { challengeId: 'c1', challenger: 'Eager-One', status: 'pending', createdAt: NOW - DAY, obligationRemainingMs: 1_800_000 },
    });
    await kv.set('save:sleepy-kage', { _saveAt: NOW - 12 * DAY });
    await kv.set('save:eager-one', { character: { name: 'Eager-One', ryo: 1_000 }, _saveVersion: 3, _saveAt: NOW - 1000, avatarImage: 'keep' });
    await kv.del(notices.offlineNoticesKey('eager-one'));

    const r = await mod.runKageInactivityPass(NOW);
    assert.deepEqual(r.dethroned, [VILLAGE]);
    const state = await kv.get<Record<string, unknown>>(settle.kageKey(VILLAGE));
    assert.equal(state?.challenge, null);
    assert.deepEqual(state?.challengerCooldowns ?? {}, {}, 'no cooldown for the blameless challenger');

    const save = await kv.get<Record<string, unknown>>('save:eager-one');
    assert.equal((save?.character as Record<string, unknown>).ryo, 251_000, 'stake credited back');
    assert.equal(save?._saveVersion, 4, 'save version bumped');
    assert.equal(save?.avatarImage, 'keep', 'images preserved');

    const inbox = await notices.takeOfflineNotices('eager-one');
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].kind, 'kage-challenge-refunded');
    assert.equal(inbox[0].village, VILLAGE);
    assert.equal(inbox[0].amount, 250_000);
});

test('a refund that cannot commit is PARKED as a durable compensation, never destroyed', async () => {
    // The dethrone drops the challenge row in the same CAS as the seat change,
    // so there is no second chance: an uncreditable stake used to be logged and
    // lost. It now waits on a queue the player's next heartbeat drains.
    await kv.set(settle.kageKey(VILLAGE), {
        ...seated(),
        challenge: { challengeId: 'c-lost', challenger: 'Ghost-One', status: 'pending', createdAt: NOW - DAY, obligationRemainingMs: 1_800_000 },
    });
    await kv.set('save:sleepy-kage', { _saveAt: NOW - 12 * DAY });
    await kv.del('save:ghost-one');                       // nothing to credit yet
    await kv.del(mod.kageStakeRefundKey('ghost-one'));
    await kv.del(notices.offlineNoticesKey('ghost-one'));

    const r = await mod.runKageInactivityPass(NOW);
    assert.deepEqual(r.dethroned, [VILLAGE]);

    const owed = await mod.readPendingKageStakeRefunds('ghost-one');
    assert.equal(owed.length, 1, 'the stake is still owed, not gone');
    assert.equal(owed[0].amount, 250_000);
    assert.equal(owed[0].village, VILLAGE);
    assert.equal(owed[0].id, `kage-stake:${VILLAGE}:c-lost`);
    assert.equal((await notices.takeOfflineNotices('ghost-one')).length, 0, 'nothing announced until it is actually paid');

    // The save shows up (a later load) and the next drain settles it.
    await kv.set('save:ghost-one', { character: { name: 'Ghost-One', ryo: 500 }, _saveVersion: 1, avatarImage: 'keep' });
    assert.equal(await mod.drainKageStakeRefunds('ghost-one', NOW), 250_000);
    const save = await kv.get<Record<string, unknown>>('save:ghost-one');
    assert.equal((save?.character as Record<string, unknown>).ryo, 250_500);
    assert.equal(save?._saveVersion, 2, 'save version bumped so a stale client refetches');
    assert.equal(save?.avatarImage, 'keep');
    assert.deepEqual(await mod.readPendingKageStakeRefunds('ghost-one'), [], 'queue cleared');

    const inbox = await notices.takeOfflineNotices('ghost-one');
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].kind, 'kage-challenge-refunded');
    assert.equal(inbox[0].amount, 250_000);

    // A second drain pays nothing — a refund can never be credited twice.
    assert.equal(await mod.drainKageStakeRefunds('ghost-one', NOW), 0);
    assert.equal(((await kv.get<Record<string, unknown>>('save:ghost-one'))?.character as Record<string, unknown>).ryo, 250_500);
});

test('parking the same challenge twice owes the stake once', async () => {
    await kv.del(mod.kageStakeRefundKey('dupe-one'));
    const entry = { id: 'kage-stake:V:c9', village: 'V', amount: 250_000, at: NOW };
    await mod.parkKageStakeRefund('dupe-one', entry);
    await mod.parkKageStakeRefund('dupe-one', { ...entry, at: NOW + 5 });
    assert.equal((await mod.readPendingKageStakeRefunds('dupe-one')).length, 1);
    await kv.del(mod.kageStakeRefundKey('dupe-one'));
});

async function owedOnce(slug: string, challengeId: string) {
    await kv.del(mod.kageStakeRefundKey(slug));
    await kv.del(notices.offlineNoticesKey(slug));
    await kv.set(`save:${slug}`, { character: { name: slug, ryo: 1_000 }, _saveVersion: 1 });
    await mod.parkKageStakeRefund(slug, { id: `kage-stake:${VILLAGE}:${challengeId}`, village: VILLAGE, amount: 250_000, at: NOW - 1 });
}

async function ryoOf(slug: string): Promise<number> {
    return Number(((await kv.get<Record<string, unknown>>(`save:${slug}`))?.character as Record<string, unknown>).ryo);
}

test('a refund credit that lands but reports an error is paid once, not re-parked and paid again', async () => {
    await owedOnce('landed-one', 'c-landed');
    const originalSet = kv.set.bind(kv);
    let armed = true;
    kv.set = (async (key: string, value: unknown, options?: unknown) => {
        const out = await originalSet(key, value, options as never);
        if (armed && key === 'save:landed-one') {
            armed = false;
            throw new Error('injected: the write committed but the reply was lost');
        }
        return out;
    }) as typeof kv.set;
    try {
        assert.equal(await mod.drainKageStakeRefunds('landed-one', NOW), 0, 'the drain could not tell whether it paid');
    } finally {
        kv.set = originalSet;
    }
    assert.equal(await ryoOf('landed-one'), 251_000, 'the credit landed');

    assert.equal(await mod.drainKageStakeRefunds('landed-one', NOW), 0, 'the next drain finds the receipt and pays nothing');
    assert.equal(await ryoOf('landed-one'), 251_000, 'before the fix this was 501,000: 250,000 ryo created');
    assert.deepEqual(await mod.readPendingKageStakeRefunds('landed-one'), [], 'the settled entry leaves the queue');
});

test('a drain that fails before paying leaves the debt queued even when the queue cannot be rewritten', async () => {
    // The old drain deleted the queue first and re-parked on failure; when the
    // re-park failed too, 250,000 ryo was destroyed with only a console line.
    await owedOnce('stranded-one', 'c-stranded');
    await kv.set('lock:save:stranded-one', 'another-writer', { nx: true, ex: 5 });
    const originalSet = kv.set.bind(kv);
    kv.set = (async (key: string, value: unknown, options?: unknown) => {
        if (key === mod.kageStakeRefundKey('stranded-one')) throw new Error('injected: queue write failed');
        return originalSet(key, value, options as never);
    }) as typeof kv.set;
    try {
        assert.equal(await mod.drainKageStakeRefunds('stranded-one', NOW), 0);
    } finally {
        kv.set = originalSet;
        await kv.del('lock:save:stranded-one');
    }
    assert.equal((await mod.readPendingKageStakeRefunds('stranded-one')).length, 1, 'the stake is still owed');
    assert.equal(await mod.drainKageStakeRefunds('stranded-one', NOW), 250_000);
    assert.equal(await ryoOf('stranded-one'), 251_000);
});

test('two drains racing pay a parked refund once', async () => {
    await owedOnce('racing-one', 'c-race');
    const paid = await Promise.all([mod.drainKageStakeRefunds('racing-one', NOW), mod.drainKageStakeRefunds('racing-one', NOW)]);
    assert.equal(paid[0] + paid[1], 250_000);
    assert.equal(await ryoOf('racing-one'), 251_000);
    assert.equal((await notices.takeOfflineNotices('racing-one')).length, 1, 'one notice for one payment');
});

test('a stake refund that cannot be parked leaves an audit entry to pay it from', async () => {
    await kv.set(settle.kageKey(VILLAGE), {
        ...seated(),
        challenge: { challengeId: 'c-unparked', challenger: 'Lost-One', status: 'pending', createdAt: NOW - DAY, obligationRemainingMs: 1_800_000 },
    });
    await kv.set('save:sleepy-kage', { _saveAt: NOW - 12 * DAY });
    await kv.set(`lock:${mod.kageStakeRefundKey('lost-one')}`, 'held', { nx: true, ex: 10 });
    try {
        const r = await mod.runKageInactivityPass(NOW);
        assert.deepEqual(r.dethroned, [VILLAGE]);
    } finally {
        await kv.del(`lock:${mod.kageStakeRefundKey('lost-one')}`);
    }
    const audit = (await kv.get<Array<Record<string, unknown>>>('audit:reward')) ?? [];
    const entry = audit.find((item) => item.action === 'kage-stake-refund.unparked' && item.entityId === 'lost-one');
    assert.ok(entry, 'the owed stake is recorded durably, not just logged');
    assert.equal((entry?.after as Record<string, unknown>).amount, 250_000);
});
