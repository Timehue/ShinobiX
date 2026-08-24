process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WAR_VILLAGES } from '../_war-map-sectors.js';
import { canClaimVacantSeat, KAGE_MIN_ACCOUNT_AGE_MS, type KageStateLike } from './_kage-challenge.js';
import type { Announcement } from '../_announce.js';

// Mirrors ANNOUNCEMENTS_KEY in api/_announce.ts (a value import would load
// _storage before the memory-KV env flag above is set).
const ANNOUNCEMENTS_KEY = 'game:announcements';

let kv: typeof import('../_storage.js').kv;
let mod: typeof import('./_kage-claim.js');
let settle: typeof import('./_kage-settle.js');

const DAY = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);
const VILLAGE = WAR_VILLAGES[1]; // Stormveil Village

before(async () => {
    ({ kv } = await import('../_storage.js'));
    mod = await import('./_kage-claim.js');
    settle = await import('./_kage-settle.js');
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function vacant(): KageStateLike {
    return {
        kageSystemUnlocked: true,
        firstLiberator: 'Old-Kage',
        unlockedAt: NOW - 60 * DAY,
        defenseCount: 0,
        history: [{ name: 'Old-Kage', village: VILLAGE, seatedAt: NOW - 60 * DAY, endedAt: NOW - DAY, endedReason: 'inactive', defenseCount: 0 }],
        challenge: null,
    };
}

function eligible(name: string, overrides: Record<string, unknown> = {}) {
    return { character: { name, village: VILLAGE, level: 95, createdAt: NOW - 30 * DAY, villageMerit: 400, ryo: 0, ...overrides }, _saveVersion: 1 };
}

async function announcements(): Promise<Announcement[]> {
    return (await kv.get<Announcement[]>(ANNOUNCEMENTS_KEY)) ?? [];
}

beforeEach(async () => {
    await kv.del(settle.kageKey(VILLAGE));
    await kv.del(ANNOUNCEMENTS_KEY);
    for (const s of ['alpha', 'beta', 'outsider', 'rookie']) await kv.del(`save:${s}`);
});

test('canClaimVacantSeat (pure): vacant + unlocked + villager gates, no ryo gate', () => {
    const base = { now: NOW, state: vacant(), challengerName: 'Alpha', challengerLevel: 95, challengerAccountCreatedAt: NOW - 30 * DAY, challengerMerit: 400, isMember: true };
    assert.deepEqual(canClaimVacantSeat(base), { ok: true });
    assert.equal(canClaimVacantSeat({ ...base, state: { ...vacant(), seatedKage: 'Someone' } }).ok, false);
    assert.equal(canClaimVacantSeat({ ...base, state: { kageSystemUnlocked: false } }).ok, false);
    assert.equal(canClaimVacantSeat({ ...base, isMember: false }).ok, false);
    assert.equal(canClaimVacantSeat({ ...base, challengerLevel: 89 }).ok, false);
    assert.equal(canClaimVacantSeat({ ...base, challengerAccountCreatedAt: NOW - KAGE_MIN_ACCOUNT_AGE_MS + 1 }).ok, false);
    assert.equal(canClaimVacantSeat({ ...base, challengerMerit: 249 }).ok, false);
    assert.equal(canClaimVacantSeat({ ...base, state: { ...vacant(), challengerCooldowns: { alpha: NOW + 1 } } }).ok, false);
});

test('an eligible villager claims the vacant seat: reign opened, grace set, herald once', async () => {
    await kv.set(settle.kageKey(VILLAGE), vacant());
    await kv.set('save:alpha', eligible('Alpha'));

    const r = await mod.claimVacantKageSeat(VILLAGE, 'Alpha', NOW);
    assert.equal(r.ok, true);
    const state = await kv.get<Record<string, unknown>>(settle.kageKey(VILLAGE));
    assert.equal(state?.seatedKage, 'Alpha');
    assert.equal(state?.seatedAt, NOW);
    assert.equal(state?.firstLiberator, 'Old-Kage', 'permanent brand untouched');
    assert.ok(Number(state?.postDefenseGraceUntil) > NOW);
    const history = state?.history as Array<Record<string, unknown>>;
    assert.equal(history.length, 2);
    assert.equal(history[1].name, 'Alpha');
    assert.equal(history[1].endedAt, undefined);

    const a = await announcements();
    assert.equal(a.length, 1);
    assert.equal(a[0].importance, 'high');
    assert.equal(a[0].title, 'A New Kage Rises');
    assert.equal(a[0].message, `Alpha has claimed the empty Kage seat of ${VILLAGE}.`);
    assert.equal(a[0].receiptId, `kage-claimed:${VILLAGE}:${NOW}`);

    // A retry of the same claim is refused (seat taken) and does not re-herald.
    const again = await mod.claimVacantKageSeat(VILLAGE, 'Alpha', NOW);
    assert.equal(again.ok, false);
    assert.equal((await announcements()).length, 1);
});

test('claim is refused for a seated seat, a sealed village, a wrong-village player and an ineligible villager', async () => {
    await kv.set('save:alpha', eligible('Alpha'));
    await kv.set('save:outsider', eligible('Outsider', { village: WAR_VILLAGES[2] }));
    await kv.set('save:rookie', eligible('Rookie', { level: 40 }));

    await kv.set(settle.kageKey(VILLAGE), { ...vacant(), seatedKage: 'Someone', seatedAt: NOW - DAY });
    let r = await mod.claimVacantKageSeat(VILLAGE, 'Alpha', NOW);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 409);

    await kv.set(settle.kageKey(VILLAGE), { kageSystemUnlocked: false });
    r = await mod.claimVacantKageSeat(VILLAGE, 'Alpha', NOW);
    assert.equal(r.ok, false);

    await kv.set(settle.kageKey(VILLAGE), vacant());
    r = await mod.claimVacantKageSeat(VILLAGE, 'Outsider', NOW);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error, 'You are not a member of this village.');
    r = await mod.claimVacantKageSeat(VILLAGE, 'Rookie', NOW);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 403);
    r = await mod.claimVacantKageSeat(VILLAGE, 'no-such-player', NOW);
    assert.equal(!r.ok && r.status, 404);

    assert.equal((await kv.get<Record<string, unknown>>(settle.kageKey(VILLAGE)))?.seatedKage, undefined, 'seat still vacant');
    assert.equal((await announcements()).length, 0);
});

test('two simultaneous claims seat exactly one Kage and herald exactly once', async () => {
    await kv.set(settle.kageKey(VILLAGE), vacant());
    await kv.set('save:alpha', eligible('Alpha'));
    await kv.set('save:beta', eligible('Beta'));

    const [a, b] = await Promise.all([
        mod.claimVacantKageSeat(VILLAGE, 'Alpha', NOW),
        mod.claimVacantKageSeat(VILLAGE, 'Beta', NOW),
    ]);
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1, 'exactly one winner');
    const state = await kv.get<Record<string, unknown>>(settle.kageKey(VILLAGE));
    assert.ok(state?.seatedKage === 'Alpha' || state?.seatedKage === 'Beta');
    assert.equal((state?.history as unknown[]).length, 2, 'one reign opened');
    assert.equal((await announcements()).length, 1);
});
