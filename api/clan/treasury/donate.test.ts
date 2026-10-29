import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'clan-donate-retry-test-secret-32-bytes!';
process.env.ADMIN_PASSWORD = 'clan-donate-retry-test-admin-password';

/*
 * /api/clan/treasury/donate through the real handler and storage adapter
 * (issue #179). The same request id never debits the donor twice or credits
 * the treasury (or clan XP) twice; a donation whose clan-row write failed is
 * finished by the donor's retry or by admin reconciliation, never unwound.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const DONOR = 'clandonor';
const OUTSIDER = 'clanoutsider';
const CLAN_KEY = 'save:clan-mist';

let kv: typeof import('../../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;
let donate: Handler;
let reconcile: Handler;
let economyTxKey: typeof import('../../_economy-tx.js').economyTxKey;
let readEconomyTxSnapshot: typeof import('../../_economy-tx.js').readEconomyTxSnapshot;
let saveDebitTransactionId: typeof import('../../_save-debit-saga.js').saveDebitTransactionId;
let clanPointWeekKey: typeof import('../../_clan-points.js').clanPointWeekKey;
let expectedAfter1000Xp: { xp: number; level: number };

before(async () => {
    // 35,000 ryo / 35 = 1,000 clan XP, levelled exactly as the handler does.
    expectedAfter1000Xp = (await import('../_mission-catalog.js')).addClanXpServer(0, 1, 1_000);
    ({ kv } = await import('../../_storage.js'));
    ({ issuePlayerToken } = await import('../../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../../_ratelimit.js'));
    ({ economyTxKey, readEconomyTxSnapshot } = await import('../../_economy-tx.js'));
    ({ saveDebitTransactionId } = await import('../../_save-debit-saga.js'));
    ({ clanPointWeekKey } = await import('../../_clan-points.js'));
    donate = (await import('./donate.js')).default as unknown as Handler;
    reconcile = (await import('../../admin/economy-reconcile.js')).default as unknown as Handler;
});

beforeEach(async () => {
    resetRateLimits();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(CLAN_KEY, { name: 'Mist', founderName: DONOR, treasury: { ryo: 0, items: [] }, xp: 0, level: 1 });
    await kv.set(`save:${DONOR}`, {
        _saveVersion: 1,
        character: { name: DONOR, clan: 'Mist', level: 40, ryo: 100_000, inventory: [], itemStacks: [{ itemId: 'item-smoke-bomb', count: 5 }] },
    });
    await kv.set(`save:${OUTSIDER}`, { _saveVersion: 1, character: { name: OUTSIDER, clan: 'Other', level: 40, ryo: 100_000 } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const key of ['SHINOBIX_QA_MEMORY_KV', 'SESSION_SECRET', 'ADMIN_PASSWORD']) delete process.env[key];
});

function responder() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function call(body: Record<string, unknown>, as = DONOR): Promise<Out> {
    const { out, res } = responder();
    await donate({
        method: 'POST',
        body: { playerName: DONOR, clan: 'Mist', ...body },
        headers: { 'x-player-name': as, 'x-player-token': issuePlayerToken(as) ?? '' },
        socket: { remoteAddress: '127.0.3.1' },
    } as never, res);
    return out;
}

async function adminReconcile(body: Record<string, unknown>): Promise<Out> {
    const { out, res } = responder();
    await reconcile({
        method: 'POST',
        body,
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.3.2' },
    } as never, res);
    return out;
}

const donor = async () => (await kv.get<{ character: Record<string, unknown> }>(`save:${DONOR}`))!.character;
const clan = async () => (await kv.get<{ treasury: Record<string, unknown>; xp: number; level: number }>(CLAN_KEY))!;

test('a currency donation debits once, credits the treasury and clan XP once, and its retry replays', async () => {
    const first = await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-donate-replay-0001' });
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.equal((first.body?.treasury as { ryo: number }).ryo, 35_000);
    assert.deepEqual({ xp: first.body?.xp, level: first.body?.level }, expectedAfter1000Xp);
    assert.ok(expectedAfter1000Xp.level > 1, 'the grant is large enough that a second one would show');
    const retry = await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-donate-replay-0001' });
    assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    assert.equal(retry.body?.replayed, true);
    assert.equal((await donor()).ryo, 65_000, 'one debit');
    assert.equal((await clan()).treasury.ryo, 35_000, 'one credit');
    assert.deepEqual({ xp: (await clan()).xp, level: (await clan()).level }, expectedAfter1000Xp, 'clan XP granted once');
    assert.equal((await donor()).clanEventContrib, 35, 'monthly contribution counted once');
});

test('an item donation removes the items once and stocks the treasury once', async () => {
    const body = { itemId: 'item-smoke-bomb', count: 3, requestId: 'clan-donate-items-00001' };
    assert.equal((await call(body)).statusCode, 200);
    assert.equal((await call(body)).body?.replayed, true);
    assert.deepEqual((await donor()).itemStacks, [{ itemId: 'item-smoke-bomb', count: 2 }]);
    assert.deepEqual((await clan()).treasury.items, [{ itemId: 'item-smoke-bomb', count: 3 }]);
});

test('concurrent duplicates donate once', async () => {
    const outs = await Promise.all(Array.from({ length: 5 }, () => call({ currency: 'ryo', amount: 7_000, requestId: 'clan-donate-dupes-00001' })));
    for (const out of outs) assert.ok(out.statusCode === 200 || out.statusCode === 503, JSON.stringify(out));
    assert.equal((await donor()).ryo, 93_000);
    assert.equal((await clan()).treasury.ryo, 7_000);
});

test('a failed debit write moves nothing, and the retry donates once', async (t) => {
    const original = kv.compareSet.bind(kv);
    let fail = true;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        if (fail && args[0] === `save:${DONOR}`) { fail = false; throw new Error('injected save write failure'); }
        return original(...args);
    });
    const failed = await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-donate-debit-fail1' });
    assert.equal(failed.statusCode, 500, JSON.stringify(failed.body));
    assert.equal((await donor()).ryo, 100_000, 'nothing was debited');
    assert.equal((await clan()).treasury.ryo, 0, 'nothing was credited');
    assert.equal((await clan()).xp, 0, 'no clan XP');
    const retry = await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-donate-debit-fail1' });
    assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    assert.equal(retry.body?.replayed, undefined, 'the retry is the first time it settles');
    assert.equal((await donor()).ryo, 65_000);
    assert.equal((await clan()).treasury.ryo, 35_000);
    assert.deepEqual({ xp: (await clan()).xp, level: (await clan()).level }, expectedAfter1000Xp, 'clan XP once');
});

test('a failed clan-row write keeps the debit, lists the donation as stuck, and the retry finishes it once', async (t) => {
    const original = kv.set.bind(kv);
    let broken = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (broken && args[0] === CLAN_KEY) throw new Error('injected clan-row write failure');
        return original(...args);
    });
    const failed = await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-donate-stuck-00001' });
    assert.equal(failed.statusCode, 503, JSON.stringify(failed.body));
    assert.equal(failed.body?.pending, true);
    assert.equal((await donor()).ryo, 65_000, 'a donation is finished, not unwound');
    assert.equal((await clan()).treasury.ryo, 0);
    const txId = saveDebitTransactionId('clan-treasury-donate', DONOR, 'clan-donate-stuck-00001');
    assert.ok((await readEconomyTxSnapshot(50)).stuck.some((tx) => tx.id === txId), 'visible in /api/admin/economy');

    broken = false;
    const retry = await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-donate-stuck-00001' });
    assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    assert.equal((await donor()).ryo, 65_000, 'no second debit');
    assert.equal((await clan()).treasury.ryo, 35_000, 'the credit landed once');
    assert.deepEqual({ xp: (await clan()).xp, level: (await clan()).level }, expectedAfter1000Xp, 'clan XP once');
    assert.equal((await kv.get<{ state: string }>(economyTxKey(txId)))?.state, 'complete');
});

test('admin reconciliation finishes a stuck donation the donor never retried', async (t) => {
    const original = kv.set.bind(kv);
    let broken = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (broken && args[0] === CLAN_KEY) throw new Error('injected clan-row write failure');
        return original(...args);
    });
    assert.equal((await call({ currency: 'ryo', amount: 14_000, requestId: 'clan-donate-admin-00001' })).statusCode, 503);
    broken = false;
    const txId = saveDebitTransactionId('clan-treasury-donate', DONOR, 'clan-donate-admin-00001');
    const fixed = await adminReconcile({ txId });
    assert.equal(fixed.statusCode, 200, JSON.stringify(fixed.body));
    assert.equal(fixed.body?.status, 'completed');
    assert.equal((await clan()).treasury.ryo, 14_000);
    const again = await adminReconcile({ txId });
    assert.equal(again.body?.status, 'already-complete');
    assert.equal((await clan()).treasury.ryo, 14_000, 'reconciling twice credits once');
    // The donor's late retry is a plain replay.
    assert.equal((await call({ currency: 'ryo', amount: 14_000, requestId: 'clan-donate-admin-00001' })).body?.replayed, true);
    assert.equal((await donor()).ryo, 86_000);
    assert.equal((await clan()).treasury.ryo, 14_000);
});

test('non-members, forged identities, reused ids and short balances move nothing', async () => {
    const outsider = await call({ playerName: OUTSIDER, currency: 'ryo', amount: 1_000, requestId: 'clan-donate-outsider-01' }, OUTSIDER);
    assert.equal(outsider.statusCode, 403, JSON.stringify(outsider.body));
    const forged = await call({ currency: 'ryo', amount: 1_000, requestId: 'clan-donate-forged-0001' }, OUTSIDER);
    assert.ok(forged.statusCode === 401 || forged.statusCode === 403, JSON.stringify(forged));
    const poor = await call({ currency: 'ryo', amount: 150_000, requestId: 'clan-donate-too-poor-01' });
    assert.equal(poor.statusCode, 400);
    assert.equal((await call({ currency: 'ryo', amount: 1_000, requestId: 'clan-donate-reused-0001' })).statusCode, 200);
    const reused = await call({ currency: 'ryo', amount: 2_000, requestId: 'clan-donate-reused-0001' });
    assert.equal(reused.statusCode, 409);
    assert.equal((await donor()).ryo, 99_000);
    assert.equal((await clan()).treasury.ryo, 1_000);
    assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${OUTSIDER}`))?.character.ryo, 100_000);
});

// Clan XP from donations shares one budget per donor per ISO week (2,000) across
// every kind, ryo included (economy rebalance 2026-10, #39). Non-ryo donations
// also keep their 2,000-per-UTC-day cap, so donating one Mythic Seal and having
// an officer gift it straight back cannot loop clan XP. Ryo uses only its own
// weekly budget: it never had a daily cap or the daily audit.
const today = () => new Date().toISOString().slice(0, 10);
const thisWeek = () => clanPointWeekKey(new Date(Date.now()));
async function clanXpTotal(): Promise<number> {
    const { clanXpNeededServer } = await import('../_mission-catalog.js');
    const { xp, level } = await clan();
    let total = xp;
    for (let l = 1; l < level; l += 1) total += clanXpNeededServer(l);
    return total;
}

test('non-ryo donation clan XP stops at the daily cap, while the donation itself still lands', async () => {
    await kv.set(`save:${DONOR}`, { _saveVersion: 1, character: { name: DONOR, clan: 'Mist', level: 40, ryo: 0, fateShards: 20, inventory: [] } });
    for (let i = 0; i < 11; i += 1) {
        resetRateLimits();
        const out = await call({ currency: 'fateShards', amount: 1, requestId: `clan-donate-xpcap-${String(i).padStart(6, '0')}` });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    }
    assert.equal(await clanXpTotal(), 2_000, 'ten paying donations; the eleventh grants no XP');
    assert.equal((await clan()).treasury.fateShards, 11, 'every seal still reached the treasury');
    assert.equal((await donor()).fateShards, 9);
});

test('parallel non-ryo donations cannot read the same counter and overshoot the cap', async () => {
    await kv.set(`save:${DONOR}`, { _saveVersion: 1, character: { name: DONOR, clan: 'Mist', level: 40, ryo: 0, fateShards: 40, inventory: [] } });
    const burst = await Promise.all(Array.from({ length: 12 }, (_, i) =>
        call({ currency: 'fateShards', amount: 1, requestId: `clan-donate-burst-${String(i).padStart(6, '0')}` })));
    const landed = burst.filter((out) => out.statusCode === 200).length;
    assert.ok(landed >= 1, JSON.stringify(burst.map((out) => out.statusCode)));
    for (const out of burst) assert.ok(out.statusCode === 200 || out.statusCode === 503, `unexpected ${out.statusCode}: ${JSON.stringify(out.body)}`);
    assert.ok(await clanXpTotal() <= 2_000, `clan XP ${await clanXpTotal()} overshot the 2,000 cap`);
    assert.equal(await clanXpTotal(), Math.min(landed, 10) * 200, 'each landed donation granted its share, up to the cap');
});

async function seedSeals(seals = 40): Promise<void> {
    await kv.set(`save:${DONOR}`, { _saveVersion: 1, character: { name: DONOR, clan: 'Mist', level: 40, ryo: 100_000, fateShards: seals, inventory: [] } });
}
const sealDonation = (requestId: string, amount = 10) => ({ currency: 'fateShards', amount, requestId });
const quota = async () => (await donor()).clanDonationXp;

test('pending credits reserve XP before a new donation, and retry grants only the sealed amount', async (t) => {
    await seedSeals();
    const original = kv.set.bind(kv);
    let broken = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (broken && args[0] === CLAN_KEY) throw new Error('injected pending capped donation');
        return original(...args);
    });
    const first = await call(sealDonation('clan-xp-pending-first-01'));
    assert.equal(first.statusCode, 503, JSON.stringify(first.body));
    assert.deepEqual(await quota(), { day: today(), used: 2_000, week: thisWeek(), weekUsed: 2_000 });
    assert.equal((await donor()).fateShards, 30, 'quota and debit committed together');
    broken = false;
    assert.equal((await call(sealDonation('clan-xp-pending-second-1'))).statusCode, 200);
    assert.equal(await clanXpTotal(), 0, 'the pending donation already reserved the full cap');
    assert.equal((await call(sealDonation('clan-xp-pending-first-01'))).statusCode, 200);
    assert.equal(await clanXpTotal(), 2_000);
    assert.equal((await call(sealDonation('clan-xp-pending-first-01'))).body?.replayed, true);
    assert.equal(await clanXpTotal(), 2_000);
    assert.equal((await donor()).fateShards, 20);
    assert.equal((await clan()).treasury.fateShards, 20);
});

test('there is no secondary quota write to lose after a completed donation', async (t) => {
    await seedSeals();
    const original = kv.set.bind(kv);
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (args[0].startsWith('clan-donate-xp:')) throw new Error('obsolete post-credit quota write');
        return original(...args);
    });
    assert.equal((await call(sealDonation('clan-xp-no-late-write-01'))).statusCode, 200);
    assert.equal((await call(sealDonation('clan-xp-no-late-write-01'))).body?.replayed, true);
    assert.equal((await call(sealDonation('clan-xp-no-late-write-02'))).statusCode, 200);
    assert.equal(await clanXpTotal(), 2_000);
    assert.equal((await quota() as { used: number }).used, 2_000);
});

test('admin recovery uses the pending reserved XP without reopening quota', async (t) => {
    await seedSeals();
    const original = kv.set.bind(kv);
    let broken = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (broken && args[0] === CLAN_KEY) throw new Error('injected capped admin recovery');
        return original(...args);
    });
    const id = 'clan-xp-admin-pending-01';
    assert.equal((await call(sealDonation(id))).statusCode, 503);
    broken = false;
    assert.equal((await call(sealDonation('clan-xp-admin-new-donate'))).statusCode, 200);
    const txId = saveDebitTransactionId('clan-treasury-donate', DONOR, id);
    assert.equal((await adminReconcile({ txId })).body?.status, 'completed');
    assert.equal((await adminReconcile({ txId })).body?.status, 'already-complete');
    assert.equal((await call(sealDonation(id))).body?.replayed, true);
    assert.equal(await clanXpTotal(), 2_000);
    assert.equal((await quota() as { used: number }).used, 2_000);
});

test('a rejected donor commit consumes neither seals nor XP quota', async (t) => {
    await seedSeals();
    const original = kv.compareSet.bind(kv);
    let broken = true;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        if (broken && args[0] === `save:${DONOR}`) { broken = false; throw new Error('injected quota/debit commit failure'); }
        return original(...args);
    });
    const id = 'clan-xp-debit-failure-01';
    assert.equal((await call(sealDonation(id))).statusCode, 500);
    assert.equal((await donor()).fateShards, 40);
    assert.equal(await quota(), undefined);
    assert.equal(await clanXpTotal(), 0);
    assert.equal((await call(sealDonation(id))).statusCode, 200);
    assert.equal((await quota() as { used: number }).used, 2_000);
    assert.equal(await clanXpTotal(), 2_000);
});

test('ISO week rollover gives the next week its own quota and never charges an old pending retry again', async (t) => {
    // Sunday 23:59:59 UTC to Monday 00:00:01 UTC: the day and the ISO week roll together.
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-25T23:59:59.000Z') });
    await seedSeals();
    const original = kv.set.bind(kv);
    let broken = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (broken && args[0] === CLAN_KEY) throw new Error('injected midnight pending credit');
        return original(...args);
    });
    const old = 'clan-xp-midnight-old-01';
    assert.equal((await call(sealDonation(old))).statusCode, 503);
    assert.deepEqual(await quota(), { day: '2026-10-25', used: 2_000, week: '2026-W43', weekUsed: 2_000 });
    t.mock.timers.setTime(Date.parse('2026-10-26T00:00:01.000Z'));
    broken = false;
    assert.equal((await call(sealDonation('clan-xp-midnight-new-01'))).statusCode, 200);
    assert.deepEqual(await quota(), { day: '2026-10-26', used: 2_000, week: '2026-W44', weekUsed: 2_000 });
    assert.equal((await call(sealDonation(old))).statusCode, 200);
    assert.deepEqual(await quota(), { day: '2026-10-26', used: 2_000, week: '2026-W44', weekUsed: 2_000 });
    assert.equal((await call(sealDonation('clan-xp-midnight-zero-1'))).statusCode, 200);
    assert.equal(await clanXpTotal(), 4_000, '2,000 reserved in each of two ISO weeks');
});

test('a new UTC day inside the same ISO week grants no more XP once the weekly budget is spent', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T12:00:00.000Z') });
    await seedSeals();
    assert.equal((await call(sealDonation('clan-xp-week-binds-day1'))).statusCode, 200);
    assert.deepEqual(await quota(), { day: '2026-10-20', used: 2_000, week: '2026-W43', weekUsed: 2_000 });
    t.mock.timers.setTime(Date.parse('2026-10-21T12:00:00.000Z'));
    assert.equal((await call(sealDonation('clan-xp-week-binds-day2'))).statusCode, 200, 'the donation itself still lands');
    assert.deepEqual(await quota(), { day: '2026-10-21', used: 0, week: '2026-W43', weekUsed: 2_000 });
    assert.equal(await clanXpTotal(), 2_000, 'the daily cap refreshed, the weekly budget did not');
    assert.equal((await clan()).treasury.fateShards, 20);
});

test('crossing midnight during initialization keeps one admission day and leaves an unexpected new-day counter intact', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T23:59:59.000Z') });
    await seedSeals();
    await kv.set(`clan-donate-xp:${DONOR}:2026-10-21`, 1_500);
    const original = kv.get.bind(kv);
    t.mock.method(kv, 'get', async (...args: Parameters<typeof kv.get>) => {
        if (args[0] === `clan-donate-xp:${DONOR}:2026-10-20`) t.mock.timers.setTime(Date.parse('2026-10-21T00:00:01.000Z'));
        return original(...args);
    });
    assert.equal((await call(sealDonation('clan-xp-crossing-day-01'))).statusCode, 200);
    assert.deepEqual(await quota(), { day: '2026-10-20', used: 2_000, week: '2026-W43', weekUsed: 2_000 });
    const next = await call(sealDonation('clan-xp-crossing-day-02'));
    assert.equal(next.statusCode, 409, 'a partial rollout counter cannot prove the remaining quota');
    assert.equal(next.body?.review, true);
    assert.deepEqual(await quota(), { day: '2026-10-20', used: 2_000, week: '2026-W43', weekUsed: 2_000 });
    assert.equal((await donor()).fateShards, 30, 'review refusal takes nothing');
    assert.equal(await clanXpTotal(), 2_000);
    assert.equal(await kv.get(`clan-donate-xp:${DONOR}:2026-10-21`), 1_500, 'legacy counters are never overwritten');
});

test('an unexpected partial-rollout counter needs review without blocking an old pending credit', async (t) => {
    await seedSeals();
    const day = new Date().toISOString().slice(0, 10);
    assert.equal((await call(sealDonation('clan-xp-legacy-paid-01', 3))).statusCode, 200);
    const original = kv.set.bind(kv);
    let broken = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (broken && args[0] === CLAN_KEY) throw new Error('injected legacy pending donation');
        return original(...args);
    });
    const pendingId = 'clan-xp-legacy-pending-1';
    assert.equal((await call(sealDonation(pendingId, 2))).statusCode, 503);
    broken = false;
    const saved = (await kv.get<{ character: Record<string, unknown> }>(`save:${DONOR}`))!;
    delete saved.character.clanDonationXp;
    for (const receipt of saved.character.serverSettlementReceipts as Array<{ value: { plan: Record<string, unknown> } }>) delete receipt.value.plan.clanXpDay;
    await kv.set(`save:${DONOR}`, saved);
    await kv.set(`clan-donate-xp:${DONOR}:${day}`, 600);
    const next = await call(sealDonation('clan-xp-legacy-new-0001'));
    assert.equal(next.statusCode, 409);
    assert.equal(next.body?.review, true);
    assert.equal(await quota(), undefined);
    assert.equal((await donor()).fateShards, 35);
    assert.equal(await clanXpTotal(), 600);
    const txId = saveDebitTransactionId('clan-treasury-donate', DONOR, pendingId);
    assert.equal((await adminReconcile({ txId })).body?.status, 'completed');
    assert.equal(await clanXpTotal(), 1_000, 'the legacy obligation still finishes from its original sealed plan');
});

test('a new-protocol receipt with its co-written quota missing is held instead of opening another budget', async () => {
    await seedSeals();
    assert.equal((await call(sealDonation('clan-xp-legacy-no-key-01'))).statusCode, 200);
    const saved = (await kv.get<{ character: Record<string, unknown> }>(`save:${DONOR}`))!;
    delete saved.character.clanDonationXp;
    await kv.set(`save:${DONOR}`, saved);
    const next = await call(sealDonation('clan-xp-legacy-no-key-02'));
    assert.equal(next.statusCode, 409);
    assert.equal(next.body?.review, true);
    assert.equal(await clanXpTotal(), 2_000);
    assert.equal(await quota(), undefined);
    assert.equal((await donor()).fateShards, 30);
});

test('pre-cap donation receipts do not retroactively consume the introduced daily budget', async () => {
    await seedSeals();
    const saved = (await kv.get<{ character: Record<string, unknown> }>(`save:${DONOR}`))!;
    saved.character.serverSettlementReceipts = [{
        requestId: 'clan-xp-before-cap-0001', fingerprint: 'server-fingerprint', settledAt: Date.now(),
        value: { kind: 'clan-treasury-donate', plan: { treasury: { kind: 'currency', currency: 'fateShards', amount: 100 }, clanXp: 20_000 } },
    }];
    await kv.set(`save:${DONOR}`, saved);
    assert.equal((await call(sealDonation('clan-xp-first-cap-budget'))).statusCode, 200);
    assert.deepEqual(await quota(), { day: today(), used: 2_000, week: thisWeek(), weekUsed: 2_000 });
    assert.equal(await clanXpTotal(), 2_000, 'the first rollout introduces a fresh capped budget');
});

test('malformed/future quota or legacy history is an explicit review refusal before debit', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const badQuotas = [null, [], { day, used: -1 }, { day, used: '0' }, { day: '2026-02-30', used: 0 }, { day: '9999-01-01', used: 0 }];
    for (const [i, bad] of badQuotas.entries()) {
        await seedSeals();
        const saved = (await kv.get<{ character: Record<string, unknown> }>(`save:${DONOR}`))!;
        saved.character.clanDonationXp = bad;
        await kv.set(`save:${DONOR}`, saved);
        const out = await call(sealDonation(`clan-xp-malformed-${String(i).padStart(4, '0')}`));
        assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        assert.equal(out.body?.review, true);
        assert.equal((await donor()).fateShards, 40);
    }
    await seedSeals();
    await kv.set(`clan-donate-xp:${DONOR}:${day}`, 'unreadable');
    assert.equal((await call(sealDonation('clan-xp-malformed-legacy'))).statusCode, 409);
    assert.equal((await donor()).fateShards, 40);
    assert.equal((await call({ currency: 'ryo', amount: 1_000, requestId: 'clan-xp-ryo-unaffected-1' })).statusCode, 200, 'ryo uses its own weekly budget');
});

test('unrelated rolling receipt history does not prevent first-rollout initialization; saturated legacy quota permits gifts', async () => {
    await seedSeals();
    const saved = (await kv.get<{ character: Record<string, unknown> }>(`save:${DONOR}`))!;
    saved.character.serverSettlementReceipts = Array.from({ length: 50 }, (_, i) => ({
        requestId: `other-settlement-${String(i).padStart(4, '0')}`, fingerprint: 'server-fingerprint', value: { kind: 'other' }, settledAt: Date.now(),
    }));
    await kv.set(`save:${DONOR}`, saved);
    const out = await call(sealDonation('clan-xp-truncated-legacy'));
    assert.equal(out.statusCode, 200, 'initialization makes no claim that historical receipt lists are complete');
    assert.equal((await donor()).fateShards, 30);
    const after = (await kv.get<{ character: Record<string, unknown> }>(`save:${DONOR}`))!;
    delete after.character.clanDonationXp;
    await kv.set(`save:${DONOR}`, after);
    await kv.set(`clan-donate-xp:${DONOR}:${new Date().toISOString().slice(0, 10)}`, 2_000);
    assert.equal((await call(sealDonation('clan-xp-truncated-capped'))).statusCode, 200, 'known exhausted cap still permits the gift');
    assert.equal((await donor()).fateShards, 20);
    assert.equal(await clanXpTotal(), 2_000, 'the saturated legacy budget adds zero XP');
});

test('a legacy receipt window shortened by a refund cannot manufacture spare quota', async () => {
    await seedSeals();
    const saved = (await kv.get<{ character: Record<string, unknown> }>(`save:${DONOR}`))!;
    // A previous 200-XP donation was evicted when the list hit 50. Another
    // saga then refunded and removed its receipt, shortening the list to 49.
    // The counter covers 400 paid XP; the visible list covers only one of
    // those payments plus a different 200-XP pending credit. max(400, 400)
    // would miss that pending credit and incorrectly offer 1,600 more XP.
    saved.character.serverSettlementReceipts = Array.from({ length: 49 }, (_, i) => ({
        requestId: `refund-pruned-history-${String(i).padStart(4, '0')}`, fingerprint: 'server-fingerprint', settledAt: Date.now(),
        value: i < 2
            ? { kind: 'clan-treasury-donate', plan: { treasury: { kind: 'currency', currency: 'fateShards', amount: 1 }, clanXp: 200 } }
            : { kind: 'other' },
    }));
    await kv.set(`save:${DONOR}`, saved);
    await kv.set(`clan-donate-xp:${DONOR}:${new Date().toISOString().slice(0, 10)}`, 400);
    const out = await call(sealDonation('clan-xp-refund-pruned-01'));
    assert.equal(out.statusCode, 409);
    assert.equal(out.body?.review, true);
    assert.equal((await donor()).fateShards, 40);
});

test('malformed current protocol days need review, while clearly older malformed metadata does not block today', async () => {
    await seedSeals();
    const saved = (await kv.get<{ character: Record<string, unknown> }>(`save:${DONOR}`))!;
    saved.character.serverSettlementReceipts = [{
        requestId: 'clan-xp-legacy-bad-plan', fingerprint: 'server-fingerprint', value: { kind: 'clan-treasury-donate', plan: { clanXpDay: 'unreadable' } }, settledAt: Date.now(),
    }];
    await kv.set(`save:${DONOR}`, saved);
    assert.equal((await call(sealDonation('clan-xp-invalid-plan-01'))).statusCode, 409);
    assert.equal((await donor()).fateShards, 40);
    (saved.character.serverSettlementReceipts as Array<{ settledAt: number }>)[0].settledAt -= 86_400_000;
    await kv.set(`save:${DONOR}`, saved);
    assert.equal((await call(sealDonation('clan-xp-invalid-plan-02'))).statusCode, 200, 'clearly older malformed metadata does not consume or block today');
    assert.equal(await clanXpTotal(), 2_000);
});

test('an already-admitted donation still recovers when its quota later needs review', async (t) => {
    await seedSeals();
    const original = kv.set.bind(kv);
    let broken = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (broken && args[0] === CLAN_KEY) throw new Error('injected pre-review pending credit');
        return original(...args);
    });
    const id = 'clan-xp-recover-review-1';
    assert.equal((await call(sealDonation(id))).statusCode, 503);
    broken = false;
    const saved = (await kv.get<{ character: Record<string, unknown> }>(`save:${DONOR}`))!;
    saved.character.clanDonationXp = { day: 'unreadable', used: -1 };
    await kv.set(`save:${DONOR}`, saved);
    assert.equal((await call(sealDonation(id))).statusCode, 200, 'the sealed obligation is finished before fresh eligibility');
    assert.equal(await clanXpTotal(), 2_000);
    assert.equal((await donor()).fateShards, 30);
    assert.equal((await call(sealDonation('clan-xp-review-new-0001'))).statusCode, 409);
    assert.equal((await donor()).fateShards, 30, 'only new debit admission is held');
});

// ── The weekly budget covers ryo too (economy rebalance 2026-10, #39) ────────

async function seedRyo(ryo = 400_000, extra: Record<string, unknown> = {}): Promise<void> {
    await kv.set(`save:${DONOR}`, { _saveVersion: 1, character: { name: DONOR, clan: 'Mist', level: 40, ryo, fateShards: 40, inventory: [], ...extra } });
}

test('ryo donation clan XP stops at the weekly budget while the treasury still receives every ryo', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T12:00:00.000Z') });
    await seedRyo();
    for (const [i, expectedTotal] of [1_000, 2_000, 2_000].entries()) {
        resetRateLimits();
        const out = await call({ currency: 'ryo', amount: 35_000, requestId: `clan-xp-ryo-weekly-${String(i).padStart(5, '0')}` });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(await clanXpTotal(), expectedTotal);
    }
    assert.equal((await clan()).treasury.ryo, 105_000, 'the treasury is credited in full');
    assert.equal((await donor()).ryo, 400_000 - 105_000);
    assert.deepEqual(await quota(), { week: '2026-W43', weekUsed: 2_000 }, 'ryo never writes the daily fields');

    // The next ISO week opens a fresh budget.
    t.mock.timers.setTime(Date.parse('2026-10-27T12:00:00.000Z'));
    assert.equal((await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-xp-ryo-weekly-next1' })).statusCode, 200);
    assert.equal(await clanXpTotal(), 3_000);
    assert.deepEqual(await quota(), { week: '2026-W44', weekUsed: 1_000 });
});

test('ryo and non-ryo donations draw from one weekly budget and keep each other\'s fields', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T12:00:00.000Z') });
    await seedRyo();
    assert.equal((await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-xp-mixed-ryo-first1' })).statusCode, 200);
    assert.deepEqual(await quota(), { week: '2026-W43', weekUsed: 1_000 });
    // Ten seals ask for 2,000; only the 1,000 the week has left is granted.
    assert.equal((await call(sealDonation('clan-xp-mixed-seal-second'))).statusCode, 200);
    assert.deepEqual(await quota(), { day: '2026-10-20', used: 1_000, week: '2026-W43', weekUsed: 2_000 });
    assert.equal(await clanXpTotal(), 2_000);
    // A ryo donation after it carries the daily fields through untouched.
    assert.equal((await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-xp-mixed-ryo-third1' })).statusCode, 200);
    assert.deepEqual(await quota(), { day: '2026-10-20', used: 1_000, week: '2026-W43', weekUsed: 2_000 });
    assert.equal(await clanXpTotal(), 2_000);
    assert.equal((await clan()).treasury.ryo, 70_000);
    assert.equal((await clan()).treasury.fateShards, 10);
});

test('a malformed or future weekly stamp is a review refusal before any debit, for ryo and non-ryo alike', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T12:00:00.000Z') });
    const bad = [
        { week: '2026-W43' }, { weekUsed: 10 }, { week: '2026-43', weekUsed: 0 }, { week: '2026-W43', weekUsed: -1 },
        { week: '2026-W43', weekUsed: '0' }, { week: '2099-W01', weekUsed: 0 }, { day: '2026-10-20', used: 0, week: 'soon', weekUsed: 0 },
    ];
    for (const [i, quotaValue] of bad.entries()) {
        await seedRyo(400_000, { clanDonationXp: quotaValue });
        const ryo = await call({ currency: 'ryo', amount: 35_000, requestId: `clan-xp-bad-week-ryo-${String(i).padStart(3, '0')}` });
        assert.equal(ryo.statusCode, 409, `${JSON.stringify(quotaValue)}: ${JSON.stringify(ryo.body)}`);
        assert.equal(ryo.body?.review, true);
        const seal = await call(sealDonation(`clan-xp-bad-week-seal-${String(i).padStart(3, '0')}`));
        assert.equal(seal.statusCode, 409, JSON.stringify(quotaValue));
        assert.equal((await donor()).ryo, 400_000, 'nothing was debited');
        assert.equal((await donor()).fateShards, 40);
    }
    assert.equal((await clan()).treasury.ryo, 0);
});

test('a parallel burst of ryo donations cannot overshoot the weekly budget', async () => {
    await seedRyo(1_000_000);
    const burst = await Promise.all(Array.from({ length: 6 }, (_, i) =>
        call({ currency: 'ryo', amount: 35_000, requestId: `clan-xp-ryo-burst-${String(i).padStart(6, '0')}` })));
    for (const out of burst) assert.ok(out.statusCode === 200 || out.statusCode === 503, `unexpected ${out.statusCode}: ${JSON.stringify(out.body)}`);
    const landed = burst.filter((out) => out.statusCode === 200).length;
    assert.ok(landed >= 1);
    assert.equal(await clanXpTotal(), Math.min(landed, 2) * 1_000, 'each landed donation granted its share, up to the budget');
});

test('admin reconciliation of a stuck ryo donation pays its sealed XP without reserving again', async (t) => {
    await seedRyo();
    const original = kv.set.bind(kv);
    let broken = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (broken && args[0] === CLAN_KEY) throw new Error('injected stuck ryo donation');
        return original(...args);
    });
    const id = 'clan-xp-ryo-admin-stuck1';
    assert.equal((await call({ currency: 'ryo', amount: 35_000, requestId: id })).statusCode, 503);
    assert.equal((await quota() as { weekUsed: number }).weekUsed, 1_000, 'the pending credit reserved its XP with the debit');
    broken = false;
    const txId = saveDebitTransactionId('clan-treasury-donate', DONOR, id);
    assert.equal((await adminReconcile({ txId })).body?.status, 'completed');
    assert.equal(await clanXpTotal(), 1_000);
    assert.equal((await quota() as { weekUsed: number }).weekUsed, 1_000, 'reconciliation did not reserve a second time');
    assert.equal((await clan()).treasury.ryo, 35_000);
});

// ── Monthly contribution counts real value only (I-15, VCS-12) ───────────────

test('the monthly contribution counts whole thousands of ryo and currency units, never items', async () => {
    await seedRyo(100_000, { itemStacks: [{ itemId: 'item-smoke-bomb', count: 5 }] });
    assert.equal((await call({ currency: 'ryo', amount: 999, requestId: 'clan-contrib-ryo-0999-01' })).statusCode, 200);
    assert.equal((await donor()).clanEventContrib, 0, 'under 1,000 ryo no longer rounds up to one');
    assert.equal(await clanXpTotal(), 28, 'the donation still earns its clan XP inside the budget');
    assert.equal((await call({ currency: 'ryo', amount: 2_500, requestId: 'clan-contrib-ryo-2500-01' })).statusCode, 200);
    assert.equal((await donor()).clanEventContrib, 2);
    assert.equal((await call({ itemId: 'item-smoke-bomb', count: 3, requestId: 'clan-contrib-items-0001' })).statusCode, 200);
    assert.equal((await donor()).clanEventContrib, 2, 'an item can be gifted back untaxed, so it counts nothing');
    assert.equal((await call(sealDonation('clan-contrib-seals-00001', 3))).statusCode, 200);
    assert.equal((await donor()).clanEventContrib, 5, 'one per Fate Shard or Aura Stone');
});

// ── Clan Hall / Town Hall split (shared/treasury-donation-split.ts) ──────────

test('Bone Charms, Honor Seals and Mythic Seals are refused before anything moves', async () => {
    await seedRyo(0, { boneCharms: 5, honorSeals: 5, fateShards: 0 });
    for (const [currency, hint] of [['boneCharms', /Town Hall/], ['honorSeals', /Seal Pool/], ['mythicSeals', /cannot be donated/]] as const) {
        const out = await call({ currency, amount: 1, requestId: `clan-split-${currency}-0001` });
        assert.equal(out.statusCode, 400, JSON.stringify(out.body));
        assert.match(String(out.body?.error), hint);
    }
    assert.equal((await donor()).boneCharms, 5);
    assert.equal(await clanXpTotal(), 0);
});

test('item clan XP follows the item value instead of a flat 50 per call', async () => {
    const { clanItemDonationXp } = await import('./_donation-xp.js');
    const { npcUnitSaleValue } = await import('../../village/_donation-merit.js');
    // A junk item no shop buys earns nothing, so forty single donations no
    // longer fill the 2,000 weekly budget.
    const junk = 'item-smoke-bomb';
    assert.equal(clanItemDonationXp(junk, 1, null), Math.floor(npcUnitSaleValue(junk) / 35));
    assert.ok(clanItemDonationXp(junk, 1, null) < 50, 'a smoke bomb earned 50 before');
    // A stack earns per unit, so forty rations are not worth one.
    assert.equal(clanItemDonationXp('ration-pack', 40, { store: 'provisions' }), Math.floor(40 * 500 / 35));
    assert.equal(clanItemDonationXp('territory-control-scroll', 3, null), 60);

    await seedRyo(0, { itemStacks: [{ itemId: junk, count: 5 }] });
    assert.equal((await call({ itemId: junk, count: 5, requestId: 'clan-item-xp-value-0001' })).statusCode, 200);
    assert.equal(await clanXpTotal(), clanItemDonationXp(junk, 5, null));
});
