import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'mentor-settlement-memory-only';
process.env.SESSION_SECRET = 'mentor-settlement-test-secret-32-bytes';

/*
 * Crash-recoverable mentor milestone settlement (api/clan/_mentor-settlement.ts).
 *
 * Every test drives the real handler (or the real reconciler) against the
 * in-memory KV and asserts on economic state, the co-written receipts, and
 * the pending/finalized authority in `clan-mentor:<sensei>` — not just on
 * HTTP status. Faults are injected at the exact storage call they name:
 * "before" throws without writing, "after" writes and then throws, and
 * "ambiguous" writes and then reports failure.
 */

type Json = Record<string, any>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Json };

let kv: typeof import('../_storage.js').kv;
let mentor: Handler;
let saveHandler: Handler;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let settlement: typeof import('./_mentor-settlement.js');
let fireSettlementReconciliation: typeof import('../cron/_scheduler.js').fireSettlementReconciliation;
let awardClanPointsToPlayerSave: typeof import('../_clan-points.js').awardClanPointsToPlayerSave;
let clanPointWeekKey: typeof import('../_clan-points.js').clanPointWeekKey;
let rewards: typeof import('./_mentor.js');
let original: { set: typeof kv.set; compareSet: typeof kv.compareSet; get: typeof kv.get };

const realNow = Date.now;
const START = Date.UTC(2026, 8, 16, 12, 0, 0); // Wednesday of ISO week 2026-W38
let time = START;

const SENSEI = 'mentorsensei';
const STUDENT = 'mentorstudent';
const OTHER_SENSEI = 'othersensei';
const SENSEI_KEY = `save:${SENSEI}`;
const STUDENT_KEY = `save:${STUDENT}`;
const RECORD_KEY = `clan-mentor:${SENSEI}`;
const POINTER_KEY = `clan-mentor-pending:${SENSEI}`;
const SENSEI_CREATED = START - 400 * 86_400_000;
const STUDENT_CREATED = START - 86_400_000;
const BASE = { seals: 10, contrib: 2, clanPoints: 40, weekly: 0, lifetime: 40, studentRyo: 100 };

before(async () => {
    ({ kv } = await import('../_storage.js'));
    mentor = (await import('./mentor.js')).default as unknown as Handler;
    saveHandler = (await import('../save/[name].js')).default as unknown as Handler;
    ({ issuePlayerToken } = await import('../_auth.js'));
    settlement = await import('./_mentor-settlement.js');
    ({ fireSettlementReconciliation } = await import('../cron/_scheduler.js'));
    ({ awardClanPointsToPlayerSave, clanPointWeekKey } = await import('../_clan-points.js'));
    rewards = await import('./_mentor.js');
    original = { set: kv.set.bind(kv), compareSet: kv.compareSet.bind(kv), get: kv.get.bind(kv) };
});

function restoreKv() {
    kv.set = original.set;
    kv.compareSet = original.compareSet;
    kv.get = original.get;
}

function character(name: string, extra: Json): Json {
    return {
        name, level: 1, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        stats: {}, inventory: [], itemStacks: [], equipment: {}, pets: [], tileCards: [], ...extra,
    };
}

beforeEach(async () => {
    restoreKv();
    time = START;
    Date.now = () => time;
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set(SENSEI_KEY, { _saveVersion: 3, _saveAt: time, _regenAt: time, character: character(SENSEI, {
        clan: 'Mentor Hall', level: 60, honorSeals: BASE.seals, clanEventContrib: BASE.contrib,
        clanPoints: BASE.clanPoints, weeklyClanPoints: BASE.weekly, lifetimeClanPoints: BASE.lifetime, ryo: 500, createdAt: SENSEI_CREATED,
    }) });
    await kv.set(STUDENT_KEY, { _saveVersion: 2, _saveAt: time, _regenAt: time, character: character(STUDENT, {
        clan: 'Mentor Hall', onboardingStep: 'done', rankedWins: 0, ryo: BASE.studentRyo, createdAt: STUDENT_CREATED,
    }) });
    await kv.set(RECORD_KEY, { students: [{ studentSlug: STUDENT, studentName: 'MentorStudent', startedAt: time - 1_000, claimed: {}, pairingId: 'pairing-original' }] });
    await kv.set(`clan-mentor-of:${STUDENT}`, SENSEI);
});

afterEach(() => { restoreKv(); Date.now = realNow; });
after(() => { delete process.env.SESSION_SECRET; });

async function call(method: string, body: Json | undefined, opts: { as?: string; query?: Json; admin?: boolean } = {}): Promise<Reply> {
    const out: Reply = { status: 200, body: {} };
    const res = {
        setHeader() { return res; },
        status(n: number) { out.status = n; return res; },
        json(payload: Json) { out.body = payload; return res; },
        end() { return res; },
    };
    const headers: Record<string, string> = opts.as
        ? { 'x-player-name': opts.as, 'x-player-token': issuePlayerToken(opts.as)! }
        : { 'x-admin-password': process.env.ADMIN_PASSWORD! };
    await mentor({ method, body: body ? JSON.parse(JSON.stringify(body)) : undefined, query: opts.query ?? {}, headers, socket: { remoteAddress: '127.0.0.77' } } as never, res as never);
    return out;
}

const claim = (extra: Json = {}, opts: { as?: string } = {}) => call('POST', { action: 'claim', playerName: SENSEI, studentName: STUDENT, ...extra }, opts);
const view = (player = SENSEI) => call('GET', undefined, { query: { player } });
const read = async (key: string) => (await kv.get<Json>(key))!;

async function economy() {
    const s = (await read(SENSEI_KEY)).character;
    const t = (await read(STUDENT_KEY)).character;
    return { seals: s.honorSeals, contrib: s.clanEventContrib, clanPoints: s.clanPoints, weekly: s.weeklyClanPoints, lifetime: s.lifetimeClanPoints, studentRyo: t.ryo };
}

function paid(milestones: number, clanPointsAwarded: number) {
    const payout = rewards.mentorPayout(milestones);
    return {
        seals: BASE.seals + payout.seals,
        contrib: BASE.contrib + payout.contrib,
        clanPoints: BASE.clanPoints + clanPointsAwarded,
        weekly: BASE.weekly + clanPointsAwarded,
        lifetime: BASE.lifetime + clanPointsAwarded,
        studentRyo: BASE.studentRyo + payout.studentRyo,
    };
}

async function setStudent(patch: Json) {
    const record = await read(STUDENT_KEY);
    record.character = { ...record.character, ...patch };
    await kv.set(STUDENT_KEY, record);
}

async function pending(): Promise<Json[]> {
    return (await read(RECORD_KEY)).settlements ?? [];
}

type Boundary = 'before' | 'after' | 'ambiguous';

/** Fail the next storage write to `key` that matches `when`, at the named boundary. */
function fault(key: string, boundary: Boundary, opts: { method?: 'set' | 'compareSet'; when?: (value: Json) => boolean; failReadback?: boolean } = {}) {
    let hit = false;
    let readbackArmed = false;
    const matches = (k: string, value: unknown) => k === key && !hit && (!opts.when || opts.when(value as Json));
    const method = opts.method ?? 'compareSet';
    if (method === 'compareSet') {
        kv.compareSet = async (k, expected, value, options) => {
            if (!matches(k, value)) return original.compareSet(k, expected, value, options);
            hit = true;
            readbackArmed = !!opts.failReadback;
            if (boundary === 'before') throw new Error(`injected failure before ${k}`);
            const committed = await original.compareSet(k, expected, value, options);
            assert.equal(committed, true, 'the injected write must really commit');
            if (boundary === 'ambiguous') return false;
            throw new Error(`injected lost acknowledgement after ${k}`);
        };
    } else {
        kv.set = async (k, value, options) => {
            if (!matches(k, value)) return original.set(k, value, options);
            hit = true;
            readbackArmed = !!opts.failReadback;
            if (boundary === 'before') throw new Error(`injected failure before ${k}`);
            await original.set(k, value, options);
            throw new Error(`injected lost acknowledgement after ${k}`);
        };
    }
    kv.get = (async (k: string) => {
        if (readbackArmed && k === key) { readbackArmed = false; throw new Error(`injected readback failure for ${k}`); }
        return original.get(k);
    }) as typeof kv.get;
    return () => { assert.ok(hit, `fault on ${key} never fired`); restoreKv(); };
}

function receipts(record: Json): Json[] { return record.character.mentorRewardReceipts ?? []; }

// ── 1–4: the ordinary contract ──────────────────────────────────────────────

describe('mentor claim economics', { concurrency: false }, () => {
    test('1) one valid milestone pays both participants exactly the canonical rewards', async () => {
        const out = await claim();
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.deepEqual(await economy(), paid(1, 25));
        assert.equal(out.body.claimed, 1);
        assert.deepEqual(out.body.milestones, ['academy']);
        assert.equal(out.body.seals, rewards.MENTOR_REWARD_SEALS);
        assert.equal(out.body.contrib, rewards.MENTOR_REWARD_CONTRIB);
        assert.equal(out.body.studentRyo, rewards.MENTOR_STUDENT_RYO);

        const record = await read(RECORD_KEY);
        assert.deepEqual(record.settlements, [], 'nothing left pending');
        const [id] = out.body.settlementIds;
        assert.equal(record.students[0].settledBy.academy, id, 'new-protocol completion is recorded, distinct from legacy claims');
        assert.equal(record.students[0].pairingId, 'pairing-original');
        const teacher = receipts(await read(SENSEI_KEY));
        const student = receipts(await read(STUDENT_KEY));
        assert.equal(teacher.length, 1);
        assert.equal(teacher[0].settlementId, id);
        assert.deepEqual(teacher[0].clanPoints, { requested: 25, awarded: 25, weekKey: '2026-W38', reason: null });
        assert.equal(student[0].settlementId, id);
        assert.equal(student[0].ryo, rewards.MENTOR_STUDENT_RYO);
    });

    test('2) a multi-milestone batch keeps per-milestone amounts and one full-batch Clan Points request', async () => {
        await setStudent({ level: 45, rankedWins: 2 });
        const four = await claim();
        assert.equal(four.status, 200);
        assert.deepEqual(four.body.milestones, ['academy', 'level20', 'level40', 'rankedWin']);
        assert.deepEqual(await economy(), paid(4, 100), 'min(100, 4 × 25) — capped per batch as before');
    });

    test('2b) three milestones request 75 Clan Points in one award, never split', async () => {
        await setStudent({ level: 25, rankedWins: 1 });
        assert.equal((await claim()).status, 200);
        assert.deepEqual(await economy(), paid(3, 75));
        const history = (await read(SENSEI_KEY)).character.clanPointHistory;
        assert.equal(history.length, 1, 'one award, not one per milestone');
        assert.equal(history[0].amount, 75);
        assert.equal(history[0].source, 'mentorMilestone');
    });

    test('2c) a batch that would cross the weekly cap is refused whole, exactly as awardClanPoints decides', async () => {
        const sensei = await read(SENSEI_KEY);
        sensei.character.weeklyClanPoints = 950;
        sensei.character.weeklyClanPointsWeek = clanPointWeekKey(new Date(time));
        await kv.set(SENSEI_KEY, sensei);
        await setStudent({ level: 25, rankedWins: 1 });
        assert.equal((await claim()).status, 200);
        const after = await economy();
        assert.equal(after.clanPoints, BASE.clanPoints, '950 + 75 > 1000 → the whole batch earns 0');
        assert.equal(after.weekly, 950);
        assert.equal(after.seals, paid(3, 0).seals, 'the other rewards are unaffected');
        assert.equal(after.studentRyo, paid(3, 0).studentRyo);
        assert.deepEqual(receipts(await read(SENSEI_KEY))[0].clanPoints, { requested: 75, awarded: 0, weekKey: '2026-W38', reason: 'weekly-cap' });
    });

    test('3) no eligible milestone fabricates nothing', async () => {
        await setStudent({ onboardingStep: 'training' });
        const before = { sensei: await read(SENSEI_KEY), student: await read(STUDENT_KEY), record: await read(RECORD_KEY) };
        const out = await claim();
        assert.equal(out.status, 200);
        assert.deepEqual(out.body, { ok: true, claimed: 0 });
        assert.deepEqual({ sensei: await read(SENSEI_KEY), student: await read(STUDENT_KEY), record: await read(RECORD_KEY) }, before);
        assert.equal(await kv.get(POINTER_KEY), null, 'no discovery pointer for work that was never admitted');
    });

    test('4) repeated identical claims — with no request ID, or a made-up one — pay once', async () => {
        assert.equal((await claim()).status, 200);
        const settled = { sensei: await read(SENSEI_KEY), student: await read(STUDENT_KEY), record: await read(RECORD_KEY) };
        for (const extra of [{}, {}, { requestId: 'client-invented-request-id-000001' }]) {
            const again = await claim(extra);
            assert.equal(again.status, 200);
            assert.equal(again.body.claimed, 0);
        }
        assert.deepEqual({ sensei: await read(SENSEI_KEY), student: await read(STUDENT_KEY), record: await read(RECORD_KEY) }, settled,
            'a completed replay manufactures no reward and no save version');
    });
});

// ── 5–10: concurrency, faults, lost acknowledgements ───────────────────────

describe('mentor claim interruption and replay', { concurrency: false }, () => {
    test('5) concurrent claims for the same pairing settle one batch once', async () => {
        await setStudent({ level: 25 });
        const replies = await Promise.all([claim(), claim(), claim()]);
        for (const reply of replies) assert.ok([200, 503].includes(reply.status), JSON.stringify(reply.body));
        assert.equal(replies.reduce((n, r) => n + (r.status === 200 ? Number(r.body.claimed) : 0), 0), 2);
        assert.deepEqual(await economy(), paid(2, 50));
        assert.equal((await read(RECORD_KEY)).settledLog.length, 1, 'exactly one batch');
    });

    test('5b) racing admissions without the lock cannot reserve overlapping milestones twice', async () => {
        const [a, b] = await Promise.all([
            settlement.admitMentorClaim(SENSEI, STUDENT, time),
            settlement.admitMentorClaim(SENSEI, STUDENT, time),
        ]);
        assert.deepEqual([a.status, b.status].sort(), ['admitted', 'retry'], 'the exact CAS admits exactly one batch');
        assert.equal((await pending()).length, 1);

        // While that batch is pending, its milestones are reserved: a later
        // admission sees only what is genuinely new.
        assert.equal((await settlement.admitMentorClaim(SENSEI, STUDENT, time)).status, 'none');
        await setStudent({ level: 21 });
        const next = await settlement.admitMentorClaim(SENSEI, STUDENT, time);
        assert.equal(next.status, 'admitted');
        assert.deepEqual(next.status === 'admitted' && next.settlement.milestones, ['level20']);

        assert.equal((await claim()).status, 200);
        assert.deepEqual(await economy(), paid(2, 50));
    });

    test('5c) two workers driving the same admitted batch at once credit each side once', { timeout: 20_000 }, async () => {
        const admitted = await settlement.admitMentorClaim(SENSEI, STUDENT, time);
        assert.equal(admitted.status, 'admitted');
        const batch = admitted.status === 'admitted' ? admitted.settlement : null!;
        // Worker A is held between its teacher credit and its student credit,
        // so the batch stays pending. Worker B read the teacher save before A
        // committed, then waited on the save lock: once inside, only the
        // receipt it finds there can stop it from paying the teacher again.
        let releaseA!: () => void;
        const aHeld = new Promise<void>((resolve) => { releaseA = resolve; });
        let held = false;
        kv.compareSet = async (k, expected, value, options) => {
            if (k === STUDENT_KEY && !held) { held = true; await aHeld; }
            return original.compareSet(k, expected, value, options);
        };
        const a = settlement.settleMentorSettlement(batch);
        const b = settlement.settleMentorSettlement(batch);
        const bResult = await b;
        releaseA();
        const aResult = await a;
        restoreKv();
        assert.equal(aResult.status, 'completed');
        assert.equal(bResult.status, 'retry', 'B could not take the student lock while A held it — it must not pretend otherwise');
        assert.deepEqual(await economy(), paid(1, 25));
        assert.equal(receipts(await read(SENSEI_KEY)).length, 1);
        assert.equal(receipts(await read(STUDENT_KEY)).length, 1);
    });

    test('6a) a failure before the admission write leaves nothing owed and nothing reserved', async () => {
        const restore = fault(RECORD_KEY, 'before');
        const first = await claim();
        restore();
        assert.ok(first.status >= 500);
        assert.deepEqual(await pending(), []);
        assert.deepEqual((await read(RECORD_KEY)).students[0].claimed, {}, 'no milestone reserved');
        assert.deepEqual(await economy(), BASE);
        assert.equal((await claim()).status, 200);
        assert.deepEqual(await economy(), paid(1, 25));
    });

    test('6b) an admission that committed but lost its acknowledgement is resumed, not replaced', async () => {
        const restore = fault(RECORD_KEY, 'after', { failReadback: true });
        const first = await claim();
        restore();
        assert.ok(first.status >= 500, 'the outcome was unknown to the request');
        const [admitted] = await pending();
        assert.ok(admitted, 'the batch is durably admitted');
        assert.deepEqual(await economy(), BASE);
        const retry = await claim();
        assert.equal(retry.status, 200);
        assert.deepEqual(retry.body.settlementIds, [admitted.id], 'the retry finishes the SAME entitlement');
        assert.deepEqual(await economy(), paid(1, 25));
        assert.equal((await read(RECORD_KEY)).settledLog.length, 1);
    });

    test('6c) a failed discovery-pointer publish stops admission before anything is reserved', async () => {
        const restore = fault(POINTER_KEY, 'before', { method: 'set' });
        assert.ok((await claim()).status >= 500);
        restore();
        assert.deepEqual(await pending(), []);
        assert.equal((await claim()).status, 200);
        assert.deepEqual(await economy(), paid(1, 25));
    });

    test('7a) a failure before the teacher write leaves the claim pending and retryable', async () => {
        const restore = fault(SENSEI_KEY, 'before');
        const first = await claim();
        restore();
        assert.equal(first.status, 503);
        assert.equal(first.body.retryable, true);
        assert.deepEqual(await economy(), BASE);
        const [owed] = await pending();
        assert.equal(owed.step, 'teacher');
        assert.equal(owed.attempts, 1);
        assert.equal(await kv.get(POINTER_KEY) !== null, true, 'discoverable by the server');
        assert.equal((await claim()).status, 200);
        assert.deepEqual(await economy(), paid(1, 25));
    });

    test('7b) a teacher write whose acknowledgement is lost is recognized from its receipt', async () => {
        const restore = fault(SENSEI_KEY, 'after');
        const first = await claim();
        restore();
        assert.equal(first.status, 200, 'readback proves the commit');
        assert.deepEqual(await economy(), paid(1, 25));
        assert.equal((await claim()).body.claimed, 0);
        assert.deepEqual(await economy(), paid(1, 25));
    });

    test('8) teacher paid, student write interrupted: recovery pays only the student', async () => {
        const restore = fault(STUDENT_KEY, 'before');
        const first = await claim();
        restore();
        assert.equal(first.status, 503);
        assert.equal((await pending())[0].step, 'student');
        const teacherPaid = await economy();
        assert.deepEqual(teacherPaid, { ...paid(1, 25), studentRyo: BASE.studentRyo });
        const retry = await claim();
        assert.equal(retry.status, 200);
        assert.deepEqual(await economy(), paid(1, 25));
        assert.equal(receipts(await read(SENSEI_KEY)).length, 1, 'no second teacher receipt');
    });

    for (const variant of ['before', 'after-unreadable'] as const) {
        test(`9) both paid, finalization interrupted (${variant}): recovery finalizes without another credit`, async () => {
            const restore = fault(RECORD_KEY, variant === 'before' ? 'before' : 'after', {
                when: (value) => Array.isArray(value.settledLog) && value.settledLog.length > 0,
                failReadback: variant !== 'before',
            });
            const first = await claim();
            restore();
            // "before": the metadata write never happened, so the claim is
            // honestly still pending. "after": it landed and one more read
            // proves it, so the claim is honestly complete.
            assert.equal(first.status, variant === 'before' ? 503 : 200);
            assert.deepEqual(await economy(), paid(1, 25));
            const versions = [(await read(SENSEI_KEY))._saveVersion, (await read(STUDENT_KEY))._saveVersion];
            const retry = await claim();
            assert.equal(retry.status, 200);
            if (variant === 'before') {
                assert.equal(retry.body.claimed, 1, 'the finishing request reports the batch');
                assert.equal(retry.body.replayed, true, 'but credited nothing itself');
            } else {
                assert.equal(retry.body.claimed, 0);
            }
            assert.deepEqual(await economy(), paid(1, 25));
            assert.deepEqual([(await read(SENSEI_KEY))._saveVersion, (await read(STUDENT_KEY))._saveVersion], versions,
                'finalizing metadata does not rewrite either save');
            assert.deepEqual(await pending(), []);
        });
    }

    test('10a) a save write that commits and then reports failure never pays twice', async () => {
        const restore = fault(SENSEI_KEY, 'ambiguous');
        const first = await claim();
        restore();
        assert.equal(first.status, 200, 'the committed receipt is found on readback');
        assert.deepEqual(await economy(), paid(1, 25));
        assert.equal((await claim()).body.claimed, 0);
        assert.deepEqual(await economy(), paid(1, 25));
    });

    test('10b) lost acknowledgement plus newer player activity: the receipt is recognized inside the newer save', async () => {
        kv.compareSet = async (k, expected, value, options) => {
            if (k !== STUDENT_KEY) return original.compareSet(k, expected, value, options);
            restoreKv();
            assert.equal(await original.compareSet(k, expected, value, options), true);
            // The player trains right after the credit commits, before the
            // reward writer reads back — the save it finds is newer than the
            // one it wrote.
            const newer = await read(STUDENT_KEY);
            newer.character.stats = { ...(newer.character.stats ?? {}), strength: 9 };
            newer._saveVersion = Number(newer._saveVersion) + 1;
            await original.set(k, newer);
            throw new Error('injected lost acknowledgement');
        };
        const first = await claim();
        assert.equal(first.status, 200);
        const student = (await read(STUDENT_KEY)).character;
        assert.equal(student.ryo, paid(1, 25).studentRyo, 'credited once');
        assert.equal(student.stats.strength, 9, 'the newer activity is preserved, not rolled back');
        assert.equal((await claim()).body.claimed, 0);
        assert.equal((await read(STUDENT_KEY)).character.ryo, paid(1, 25).studentRyo);
    });
});

// ── 11–12: restart and stale writers ───────────────────────────────────────

describe('mentor settlement recovery without the browser', { concurrency: false }, () => {
    test('11) the scheduled reconciliation finishes a claim the original request abandoned', async () => {
        const restore = fault(STUDENT_KEY, 'before');
        assert.equal((await claim()).status, 503);
        restore();
        // No further claim from the browser. Time passes beyond the backoff
        // and the leased reconciliation tick runs.
        time += 6 * 60_000;
        await fireSettlementReconciliation(false);
        assert.deepEqual(await economy(), paid(1, 25));
        assert.deepEqual(await pending(), []);
        assert.equal(await kv.get(POINTER_KEY), null, 'the discovery pointer is retired once nothing is owed');
        const status = await kv.get<Json>(settlement.MENTOR_RECOVERY_STATUS_KEY);
        assert.equal(status?.completed.length, 1);
    });

    test('11b) a pending claim whose pointer was lost is rediscovered by the boot pass', async () => {
        const restore = fault(STUDENT_KEY, 'before');
        await claim();
        restore();
        await kv.del(POINTER_KEY);
        time += 6 * 60_000;
        await fireSettlementReconciliation(true);
        assert.deepEqual(await economy(), paid(1, 25));
    });

    test('12a) a writer suspended past its lease cannot overwrite the successor or pay twice', { timeout: 20_000 }, async () => {
        let release!: () => void;
        let announce!: () => void;
        const resumed = new Promise<void>((resolve) => { release = resolve; });
        const paused = new Promise<void>((resolve) => { announce = resolve; });
        let held = false;
        kv.compareSet = async (k, expected, value, options) => {
            if (k === SENSEI_KEY && !held) { held = true; announce(); await resumed; }
            return original.compareSet(k, expected, value, options);
        };
        const first = claim();
        await paused;
        time += 6_000; // every 5 s lease the first writer holds has expired
        let second: Reply;
        try { second = await claim(); } finally { release(); }
        const firstReply = await first;
        restoreKv();
        assert.equal(second.status, 200);
        assert.equal(firstReply.status, 200, 'the resumed writer recognizes the successor\'s receipt');
        assert.deepEqual(await economy(), paid(1, 25));
        assert.equal(receipts(await read(SENSEI_KEY)).length, 1);
        assert.equal((await read(RECORD_KEY)).settledLog.length, 1);
    });

    test('12b) a release suspended past its lease cannot erase a pending settlement', { timeout: 20_000 }, async () => {
        let release!: () => void;
        let announce!: () => void;
        const resumed = new Promise<void>((resolve) => { release = resolve; });
        const paused = new Promise<void>((resolve) => { announce = resolve; });
        let held = false;
        kv.compareSet = async (k, expected, value, options) => {
            if (k === RECORD_KEY && !held && Array.isArray((value as Json).students) && (value as Json).students.length === 0) {
                held = true; announce(); await resumed;
            }
            return original.compareSet(k, expected, value, options);
        };
        const releasing = call('POST', { action: 'release', playerName: SENSEI, studentName: STUDENT });
        await paused;
        time += 6_000;
        let claimed: Reply;
        try { claimed = await claim(); } finally { release(); }
        const released = await releasing;
        restoreKv();
        assert.equal(claimed.status, 200);
        assert.equal(released.status, 503, 'the stale release is refused rather than overwriting');
        assert.deepEqual(await economy(), paid(1, 25));
        assert.equal((await read(RECORD_KEY)).students.length, 1, 'the pairing is unchanged');
    });

    test('12c) an old settlement replayed after finalization and receipt compaction pays nothing', async () => {
        const restore = fault(STUDENT_KEY, 'before');
        await claim();
        restore();
        const stale = settlement.readMentorRecord(await read(RECORD_KEY)).settlements[0];
        assert.equal((await claim()).status, 200);
        const settled = await economy();

        // A second pairing's payment compacts the first teacher receipt,
        // because its settlement has left the mentor record.
        await kv.set('save:secondstudent', { _saveVersion: 1, character: character('secondstudent', { clan: 'Mentor Hall', onboardingStep: 'done', ryo: 0, createdAt: STUDENT_CREATED }) });
        const record = await read(RECORD_KEY);
        record.students.push({ studentSlug: 'secondstudent', studentName: 'Second', startedAt: time, claimed: {}, pairingId: 'pairing-second' });
        await kv.set(RECORD_KEY, record);
        assert.equal((await call('POST', { action: 'claim', playerName: SENSEI, studentName: 'secondstudent' })).status, 200);
        assert.deepEqual(receipts(await read(SENSEI_KEY)).map((r) => r.settlementId).includes(stale.id), false, 'the finalized receipt was compacted');

        const replay = await settlement.settleMentorSettlement(stale);
        assert.equal(replay.status, 'gone');
        const now = await economy();
        assert.equal(now.studentRyo, settled.studentRyo);
        assert.equal(now.seals, settled.seals + rewards.MENTOR_REWARD_SEALS, 'only the second pairing was paid');
    });
});

// ── 13–14: weekly cap, rollover, eviction ──────────────────────────────────

describe('mentor Clan Points and durable replay protection', { concurrency: false }, () => {
    test('13a) a capped zero outcome is final: a retry next week does not grant the points', async () => {
        const sensei = await read(SENSEI_KEY);
        sensei.character.weeklyClanPoints = 950;
        sensei.character.weeklyClanPointsWeek = '2026-W38';
        await kv.set(SENSEI_KEY, sensei);
        await setStudent({ level: 25, rankedWins: 1 });
        const restore = fault(STUDENT_KEY, 'before');
        assert.equal((await claim()).status, 503);
        restore();
        time += 8 * 86_400_000; // next ISO week
        await settlement.recoverPendingMentorSettlements({ now: time });
        const after = await economy();
        assert.equal(after.clanPoints, BASE.clanPoints, 'the recorded weekly-cap decision stands');
        assert.equal(after.studentRyo, paid(3, 0).studentRyo);
        assert.deepEqual(receipts(await read(SENSEI_KEY))[0].clanPoints, { requested: 75, awarded: 0, weekKey: '2026-W38', reason: 'weekly-cap' });
    });

    test('13b) recovery in a later week never resets that week\'s accumulated Clan Points', async () => {
        const restore = fault(STUDENT_KEY, 'before');
        assert.equal((await claim()).status, 503);
        restore();
        time += 8 * 86_400_000;
        const earned = await awardClanPointsToPlayerSave(SENSEI, 'clanBossDefeat', 200, { eventId: 'boss:w39' });
        assert.equal(earned.awarded, 200);
        const before = (await read(SENSEI_KEY)).character;
        await settlement.recoverPendingMentorSettlements({ now: time });
        const after = (await read(SENSEI_KEY)).character;
        assert.equal(after.weeklyClanPoints, 200);
        assert.equal(after.weeklyClanPointsWeek, '2026-W39');
        assert.equal(after.clanPoints, before.clanPoints);
        assert.equal((await read(STUDENT_KEY)).character.ryo, paid(1, 25).studentRyo);
    });

    test('13c) a teacher first paid in a later week is awarded in THAT week, on top of its accumulation', async () => {
        const restore = fault(SENSEI_KEY, 'before');
        assert.equal((await claim()).status, 503);
        restore();
        time += 8 * 86_400_000;
        assert.equal((await awardClanPointsToPlayerSave(SENSEI, 'clanBossDefeat', 200, { eventId: 'boss:w39' })).awarded, 200);
        await settlement.recoverPendingMentorSettlements({ now: time });
        const teacher = (await read(SENSEI_KEY)).character;
        assert.equal(teacher.weeklyClanPointsWeek, '2026-W39');
        assert.equal(teacher.weeklyClanPoints, 225, 'the award joins the current week, never resets it');
        assert.equal(teacher.clanPoints, BASE.clanPoints + 200 + 25);
        assert.equal(receipts(await read(SENSEI_KEY))[0].clanPoints.weekKey, '2026-W39');
    });

    test('14) full display histories and rolling receipt lists never make a paid milestone payable again', async () => {
        assert.equal((await claim()).status, 200);
        const sensei = await read(SENSEI_KEY);
        sensei.character.clanPointHistory = Array.from({ length: 40 }, (_, i) => ({ id: `later-${i}`, ts: time, source: 'guardDuty', amount: 1, weekKey: '2026-W38' }));
        sensei.character.serverSettlementReceipts = Array.from({ length: 60 }, (_, i) => ({ requestId: `unrelated-request-${String(i).padStart(4, '0')}`, fingerprint: 'x', value: {}, settledAt: time }));
        await kv.set(SENSEI_KEY, sensei);
        const record = await read(RECORD_KEY);
        record.settledLog = Array.from({ length: 40 }, (_, i) => ({ id: `noise-${i}` }));
        await kv.set(RECORD_KEY, record);
        const before = await economy();
        for (let i = 0; i < 3; i++) assert.equal((await claim()).body.claimed, 0);
        assert.deepEqual(await economy(), before);
        assert.equal((await read(RECORD_KEY)).students[0].claimed.academy > 0, true);
    });

    test('14b) compaction never drops the receipt of a batch that is still pending', async () => {
        // Batch A: teacher paid, student write fails — A stays pending.
        const restoreA = fault(STUDENT_KEY, 'before');
        assert.equal((await claim()).status, 503);
        restoreA();
        const [batchA] = await pending();

        // Batch B for a second student settles completely. Its teacher write
        // compacts the teacher's receipt list while A is still open.
        await kv.set('save:secondstudent', { _saveVersion: 1, character: character('secondstudent', { clan: 'Mentor Hall', onboardingStep: 'done', ryo: 0, createdAt: STUDENT_CREATED }) });
        const record = await read(RECORD_KEY);
        record.students.push({ studentSlug: 'secondstudent', studentName: 'Second', startedAt: time, claimed: {}, pairingId: 'pairing-second' });
        await kv.set(RECORD_KEY, record);
        assert.equal((await call('POST', { action: 'claim', playerName: SENSEI, studentName: 'secondstudent' })).status, 200);
        assert.ok(receipts(await read(SENSEI_KEY)).some((r) => r.settlementId === batchA.id), 'A\'s teacher receipt survives');

        assert.equal((await claim()).status, 200);
        const teacher = (await read(SENSEI_KEY)).character;
        assert.equal(teacher.honorSeals, BASE.seals + 2 * rewards.MENTOR_REWARD_SEALS, 'two batches, two credits — never three');
        assert.equal((await read(STUDENT_KEY)).character.ryo, paid(1, 25).studentRyo);
    });
});

// ── 15–17: pairing lifecycle, legacy records, broken recipients ────────────

describe('mentor pairing lifecycle and legacy safety', { concurrency: false }, () => {
    test('15) release and reassignment keep the owed reward without touching the newer pairing', async () => {
        const restore = fault(STUDENT_KEY, 'before');
        assert.equal((await claim()).status, 503);
        restore();
        const [owed] = await pending();

        assert.equal((await call('POST', { action: 'release', playerName: SENSEI, studentName: STUDENT })).status, 200);
        assert.equal(await kv.get(`clan-mentor-of:${STUDENT}`), null, 'the marker pointed here, so release cleared it');
        assert.equal((await pending())[0].id, owed.id, 'release does not delete the obligation');

        await kv.set(`save:${OTHER_SENSEI}`, { _saveVersion: 1, character: character(OTHER_SENSEI, { clan: 'Mentor Hall', honorSeals: 0, createdAt: SENSEI_CREATED }) });
        const assigned = await call('POST', { action: 'assign', playerName: OTHER_SENSEI, studentName: STUDENT });
        assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
        const newer = await read(`clan-mentor:${OTHER_SENSEI}`);

        time += 6 * 60_000;
        const summary = await settlement.recoverPendingMentorSettlements({ now: time });
        assert.deepEqual(summary.completed, [owed.id]);
        assert.deepEqual(await economy(), paid(1, 25));
        assert.deepEqual(await read(`clan-mentor:${OTHER_SENSEI}`), newer, 'the newer pairing is untouched');
        assert.equal(await kv.get(`clan-mentor-of:${STUDENT}`), OTHER_SENSEI, 'the newer assignment stands');
        assert.deepEqual((await read(RECORD_KEY)).students, [], 'the released pairing is not resurrected');
        assert.deepEqual((await view()).body.asSensei.students, []);
    });

    test('15b) release only clears a marker that still names this sensei', async () => {
        await kv.set(`clan-mentor-of:${STUDENT}`, OTHER_SENSEI);
        assert.equal((await call('POST', { action: 'release', playerName: SENSEI, studentName: STUDENT })).status, 200);
        assert.equal(await kv.get(`clan-mentor-of:${STUDENT}`), OTHER_SENSEI);
    });

    test('16) legacy claimed milestones are never repaid; later milestones pay once with a backfilled, stable pairing id', async () => {
        await kv.set(RECORD_KEY, { students: [{ studentSlug: STUDENT, studentName: 'MentorStudent', startedAt: time - 1_000, claimed: { academy: time - 500 } }] });
        const nothing = await claim();
        assert.deepEqual(nothing.body, { ok: true, claimed: 0 }, 'a legacy claimed stamp is not proof of non-payment');
        assert.deepEqual(await economy(), BASE);
        assert.equal((await read(RECORD_KEY)).students[0].pairingId, undefined, 'reads never mint identity');

        await setStudent({ level: 21 });
        const later = await claim();
        assert.deepEqual(later.body.milestones, ['level20']);
        assert.deepEqual(await economy(), paid(1, 25));
        const entry = (await read(RECORD_KEY)).students[0];
        assert.ok(entry.pairingId, 'backfilled once, in the admission write');
        assert.equal(entry.settledBy.level20, later.body.settlementIds[0]);
        assert.equal(entry.settledBy.academy, undefined, 'academy stays legacy/unknown, distinct from verified');

        await setStudent({ level: 41 });
        assert.equal((await claim()).status, 200);
        assert.equal((await read(RECORD_KEY)).students[0].pairingId, entry.pairingId, 'the identity never changes');
    });

    test('17a) a deleted student is an exception held for review, never a silent completion', async () => {
        const restore = fault(STUDENT_KEY, 'before');
        await claim();
        restore();
        await kv.del(STUDENT_KEY);
        const out = await claim();
        assert.equal(out.status, 409);
        assert.equal(out.body.review, true);
        const [owed] = await pending();
        assert.equal(owed.exception, 'recipient-missing');

        assert.ok(owed.nextAttemptAt - time >= 60 * 60_000, 'an exception backs off for at least an hour');
        time = owed.nextAttemptAt + 1;
        const first = await settlement.recoverPendingMentorSettlements({ now: time });
        assert.equal(first.exceptions.length, 1);
        const again = await settlement.recoverPendingMentorSettlements({ now: time + 60_000 });
        assert.equal(again.exceptions.length, 0, 'backed off, not hammered');
        assert.equal(again.deferred, 1);
        assert.equal((await read(SENSEI_KEY)).character.honorSeals, paid(1, 25).seals, 'the teacher side is not repaid');
    });

    test('17b) a new account that reused the student\'s name is never credited', async () => {
        const restore = fault(STUDENT_KEY, 'before');
        await claim();
        restore();
        await kv.set(STUDENT_KEY, { _saveVersion: 1, character: character(STUDENT, { clan: 'Mentor Hall', ryo: 0, createdAt: START + 1 }) });
        const out = await claim();
        assert.equal(out.status, 409);
        assert.equal((await pending())[0].exception, 'identity-mismatch');
        assert.equal((await read(STUDENT_KEY)).character.ryo, 0);
    });

    test('17c) a malformed receipt list blocks payment instead of being overwritten', async () => {
        await setStudent({ mentorRewardReceipts: 'corrupted' });
        const out = await claim();
        assert.equal(out.status, 409);
        assert.equal((await pending())[0].exception, 'receipts-malformed');
        assert.equal((await read(STUDENT_KEY)).character.mentorRewardReceipts, 'corrupted');
        assert.equal((await read(STUDENT_KEY)).character.ryo, BASE.studentRyo);
    });

    test('17d) a pending settlement edited after admission cannot authorize any payment', async () => {
        const restore = fault(SENSEI_KEY, 'before');
        await claim();
        restore();
        const record = await read(RECORD_KEY);
        record.settlements[0].student.ryo = 999_999;
        await kv.set(RECORD_KEY, record);
        const out = await claim();
        assert.equal(out.status, 409);
        assert.deepEqual(await economy(), BASE);
    });

    test('17e) a missing sensei save is refused before anything is admitted', async () => {
        await kv.del(SENSEI_KEY);
        const out = await claim();
        assert.equal(out.status, 404);
        assert.deepEqual(await pending(), []);
    });
});

// ── 18–21: save integrity, concurrent activity, new milestones, client ────

describe('mentor settlement save integrity and compatibility', { concurrency: false }, () => {
    test('18a) forged claim fields are ignored — amounts come only from the server', async () => {
        const out = await claim({ seals: 1e6, contrib: 1e6, studentRyo: 1e9, milestones: ['level40', 'rankedWin'], settlementId: 'forged', character: { honorSeals: 1e9 } });
        assert.equal(out.status, 200);
        assert.deepEqual(out.body.milestones, ['academy']);
        assert.deepEqual(await economy(), paid(1, 25));
    });

    test('18b) stale and forging autosaves cannot erase or invent mentor receipts', async () => {
        const stale = await read(STUDENT_KEY);
        assert.equal((await claim()).status, 200);
        const credited = await read(STUDENT_KEY);

        const autosave = async (record: Json, character: Json) => {
            const out: Reply = { status: 200, body: {} };
            const res = { setHeader() { return res; }, status(n: number) { out.status = n; return res; }, json(b: Json) { out.body = b; return res; }, end() { return res; } };
            await saveHandler({ method: 'POST', query: { name: STUDENT }, body: JSON.parse(JSON.stringify({ ...record, character, _baseSaveVersion: record._saveVersion })), headers: { 'x-player-name': STUDENT, 'x-player-token': issuePlayerToken(STUDENT)! }, socket: { remoteAddress: '127.0.0.78' } } as never, res as never);
            return out;
        };
        assert.equal((await autosave(stale, stale.character)).status, 409, 'a pre-reward tab cannot roll the credit back');
        const forged = [{ v: 1, settlementId: 'mentor-forged', role: 'student', fingerprint: 'client', senseiSlug: SENSEI, pairingId: 'x', milestones: ['level40'], appliedAt: time, ryo: 1 }];
        const current = await autosave(credited, { ...credited.character, mentorRewardReceipts: forged });
        assert.equal(current.status, 200, JSON.stringify(current.body));
        const stored = (await read(STUDENT_KEY)).character;
        assert.deepEqual(stored.mentorRewardReceipts, credited.character.mentorRewardReceipts, 'the stored receipts win');
        assert.equal(stored.ryo, credited.character.ryo);
    });

    test('19) concurrent unrelated player changes survive the reward write', async () => {
        let raced = false;
        kv.compareSet = async (k, expected, value, options) => {
            if ((k === SENSEI_KEY || k === STUDENT_KEY) && !raced) {
                raced = true;
                // Another legitimate server write lands first.
                const other = await read(k);
                other.character = { ...other.character, ryo: Number(other.character.ryo) + 777, stats: { speed: 4 } };
                other._saveVersion = Number(other._saveVersion) + 1;
                await original.set(k, other);
            }
            return original.compareSet(k, expected, value, options);
        };
        const first = await claim();
        restoreKv();
        assert.equal(first.status, 503, 'the stale write is refused, not forced');
        assert.equal((await claim()).status, 200);
        const sensei = (await read(SENSEI_KEY)).character;
        assert.equal(sensei.ryo, 500 + 777, 'the concurrent change is preserved');
        assert.deepEqual(sensei.stats, { speed: 4 });
        assert.deepEqual(await economy(), paid(1, 25));
    });

    test('20) milestones reached while a batch is pending are admitted separately; the old batch is unchanged', async () => {
        const restore = fault(STUDENT_KEY, 'before');
        assert.equal((await claim()).status, 503);
        restore();
        const [old] = await pending();
        await setStudent({ level: 22 });

        const listed = (await view()).body.asSensei.students[0];
        assert.deepEqual(listed.claimable, ['academy', 'level20'], 'owed + newly reached both stay claimable');
        assert.deepEqual(listed.pending, ['academy']);
        assert.deepEqual(listed.claimed, []);

        // Server recovery finishes only what was admitted.
        time += 6 * 60_000;
        await settlement.recoverPendingMentorSettlements({ now: time });
        assert.deepEqual(await economy(), paid(1, 25));
        assert.deepEqual((await view()).body.asSensei.students[0].claimable, ['level20']);

        const next = await claim();
        assert.equal(next.status, 200);
        assert.deepEqual(next.body.milestones, ['level20']);
        assert.notEqual(next.body.settlementIds[0], old.id);
        assert.deepEqual(await economy(), { ...paid(2, 50) });
        const log = (await read(RECORD_KEY)).settledLog;
        assert.deepEqual(log.map((e: Json) => e.milestones), [['level20'], ['academy']], 'no overlap between the batches');
    });

    test('20b) the claim path finishes the old batch unchanged, then admits the new one', async () => {
        const restore = fault(STUDENT_KEY, 'before');
        await claim();
        restore();
        const [old] = await pending();
        await setStudent({ level: 22 });
        const out = await claim();
        assert.equal(out.status, 200);
        assert.deepEqual(out.body.settlementIds[0], old.id);
        assert.deepEqual(out.body.milestones, ['academy', 'level20']);
        assert.equal(out.body.seals, 2 * rewards.MENTOR_REWARD_SEALS);
        assert.deepEqual(await economy(), paid(2, 50));
    });

    test('21) the current client applies each committed snapshot once, and a retry is harmless', async () => {
        const clientPath = '../../shinobij.client/src/lib/clan-mentor.js';
        const client = await import(clientPath) as {
            claimMentor: (p: string, s: string) => Promise<{ ok: boolean; claimed: number; seals: number; character?: Json; _saveVersion?: number; error?: string }>;
            fetchMentorView: (p: string) => Promise<Json>;
        };
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async (input: string, init?: { method?: string; body?: string }) => {
            const url = new URL(String(input), 'http://local');
            const out: Reply = init?.method === 'POST'
                ? await call('POST', JSON.parse(String(init.body)))
                : await call('GET', undefined, { query: Object.fromEntries(url.searchParams) });
            return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        try {
            const restore = fault(STUDENT_KEY, 'before');
            const partial = await client.claimMentor(SENSEI, STUDENT);
            restore();
            assert.equal(partial.ok, false, 'a partial settlement is not reported as success');
            assert.equal(partial.character, undefined, 'and hands the caller nothing to apply');
            assert.match(String(partial.error), /retry/i);
            const shown = await client.fetchMentorView(SENSEI);
            assert.deepEqual(shown.asSensei.students[0].claimable, ['academy'], 'the Claim button stays available');

            const done = await client.claimMentor(SENSEI, STUDENT);
            const stored = await read(SENSEI_KEY);
            assert.equal(done.ok, true);
            assert.equal(done.claimed, 1);
            assert.deepEqual(done.character, stored.character, 'character and version describe one record');
            assert.equal(done._saveVersion, stored._saveVersion);

            const retry = await client.claimMentor(SENSEI, STUDENT);
            assert.equal(retry.claimed, 0, 'the client takes its "nothing new" branch');
            assert.equal(retry.character, undefined, 'no second snapshot to apply');
            assert.deepEqual(await economy(), paid(1, 25));
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    test('auth, rate-limit identity and anti-alt still gate new claims; admitted work still finishes', async () => {
        assert.equal((await mentorNoAuth()).status, 401);
        assert.equal((await claim({}, { as: STUDENT })).status, 403, 'a player cannot claim as someone else');

        const restore = fault(STUDENT_KEY, 'before');
        assert.equal((await claim({}, { as: SENSEI })).status, 503);
        restore();
        await kv.set(`player-ip:${SENSEI}:10.9.9.9`, 1);
        await kv.set(`player-ip:${STUDENT}:10.9.9.9`, 1);
        await setStudent({ level: 22 });
        const out = await claim({}, { as: SENSEI });
        assert.equal(out.status, 200, 'the batch vetted at admission is finished');
        assert.deepEqual(out.body.milestones, ['academy']);
        const blocked = await claim({}, { as: SENSEI });
        assert.equal(blocked.status, 403, 'the newly reached milestone is voided for a shared connection');
        assert.deepEqual(await pending(), []);
        assert.deepEqual(await economy(), paid(1, 25));
    });
});

async function mentorNoAuth(): Promise<Reply> {
    const out: Reply = { status: 200, body: {} };
    const res = { setHeader() { return res; }, status(n: number) { out.status = n; return res; }, json(b: Json) { out.body = b; return res; }, end() { return res; } };
    await mentor({ method: 'POST', body: { action: 'claim', playerName: SENSEI, studentName: STUDENT }, query: {}, headers: {}, socket: { remoteAddress: '127.0.0.79' } } as never, res as never);
    return out;
}

test('Teacher credited; process interrupted before student credit; fresh worker resumes from persistent state; student credited once; teacher\'s Honor Seals, clanEventContrib, and clan points are not credited again. (in-process)', async () => {
    restoreKv();
    time = START;
    Date.now = () => time;
    const restore = fault(STUDENT_KEY, 'before');
    assert.equal((await claim()).status, 503);
    restore();
    const teacherAfterCrash = (await read(SENSEI_KEY)).character;
    time += 6 * 60_000;
    await fireSettlementReconciliation(false);
    const teacher = (await read(SENSEI_KEY)).character;
    assert.equal((await read(STUDENT_KEY)).character.ryo, paid(1, 25).studentRyo);
    for (const field of ['honorSeals', 'clanEventContrib', 'clanPoints', 'weeklyClanPoints', 'lifetimeClanPoints']) {
        assert.equal(teacher[field], teacherAfterCrash[field], `${field} is not credited again`);
    }
    Date.now = realNow;
});
