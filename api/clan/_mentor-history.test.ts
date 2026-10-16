import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'mentor-history-memory-only';

/* Real settlements supply the historical receipts below. Only the destroyed
 * pairing and missing ever-paid key are reconstructed to model a pre-#413
 * release; no balance or progress is treated as evidence of prior payment. */
type Json = Record<string, any>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Json };
let kv: typeof import('../_storage.js').kv;
let mentor: Handler;
let settlement: typeof import('./_mentor-settlement.js');
let history: typeof import('./_mentor-history.js');
let rewards: typeof import('./_mentor.js');
let original: { compareSet: typeof kv.compareSet; compareSetMany: typeof kv.compareSetMany };
const realNow = Date.now;
const START = Date.UTC(2026, 8, 16, 12);
const DAY = 86_400_000;
let time = START;
const SENSEI = 'historysensei';
const OTHER = 'historyothersensei';
const STUDENT = 'historystudent';
const PAID_KEY = `clan-mentor-paid:${STUDENT}`;
const STUDENT_KEY = `save:${STUDENT}`;
const RECORD_KEY = `clan-mentor:${SENSEI}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    mentor = (await import('./mentor.js')).default as unknown as Handler;
    settlement = await import('./_mentor-settlement.js');
    history = await import('./_mentor-history.js');
    rewards = await import('./_mentor.js');
    original = { compareSet: kv.compareSet.bind(kv), compareSetMany: kv.compareSetMany?.bind(kv) };
});

function restoreKv() {
    kv.compareSet = original.compareSet;
    kv.compareSetMany = original.compareSetMany;
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
    for (const sensei of [SENSEI, OTHER]) await kv.set(`save:${sensei}`, {
        _saveVersion: 3, _saveAt: time, _regenAt: time,
        character: character(sensei, {
            clan: 'History Hall', level: 60, honorSeals: 10, clanEventContrib: 2,
            clanPoints: 40, weeklyClanPoints: 0, lifetimeClanPoints: 40, ryo: 500, createdAt: START - 400 * DAY,
        }),
    });
    await kv.set(STUDENT_KEY, {
        _saveVersion: 2, _saveAt: time, _regenAt: time,
        character: character(STUDENT, { clan: 'History Hall', onboardingStep: 'done', rankedWins: 0, ryo: 100, createdAt: START - DAY }),
    });
    await kv.set(RECORD_KEY, { students: [{ studentSlug: STUDENT, studentName: STUDENT, startedAt: time - 1_000, claimed: {}, pairingId: 'history-original-pair' }] });
    await kv.set(`clan-mentor-of:${STUDENT}`, SENSEI);
});

afterEach(() => { restoreKv(); Date.now = realNow; });
after(() => { Date.now = realNow; });

async function action(actionName: string, sensei = SENSEI): Promise<Reply> {
    const out: Reply = { status: 200, body: {} };
    const res = {
        setHeader() { return res; },
        status(n: number) { out.status = n; return res; },
        json(payload: Json) { out.body = payload; return res; },
        end() { return res; },
    };
    await mentor({
        method: 'POST', body: { action: actionName, playerName: sensei, studentName: STUDENT }, query: {},
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! }, socket: { remoteAddress: '127.0.0.79' },
    } as never, res as never);
    return out;
}

const read = async (key: string) => (await kv.get<Json>(key))!;
const studentReceipts = (save: Json): Json[] => save.character.mentorRewardReceipts ?? [];
async function patchStudent(patch: Json) {
    const save = await read(STUDENT_KEY);
    await kv.set(STUDENT_KEY, { ...save, character: { ...save.character, ...patch } });
}
async function saves() {
    return Promise.all([SENSEI, OTHER, STUDENT].map((name) => read(`save:${name}`)));
}
async function paidAndReleasedBeforeDeployment() {
    const paid = await action('claim');
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.deepEqual(paid.body.milestones, ['academy']);
    const oldReceipt = structuredClone(studentReceipts(await read(STUDENT_KEY))[0]);
    assert.ok(oldReceipt, 'the real claim must have co-written a student receipt');
    const record = await read(RECORD_KEY);
    await kv.set(RECORD_KEY, { ...record, students: [] });
    await kv.del(PAID_KEY, `clan-mentor-of:${STUDENT}`);
    return oldReceipt;
}

describe('historical mentor payment repair', { concurrency: false }, () => {
    test('a pair released before #413 cannot replay its paid Academy reward after reassignment', async () => {
        const receipt = await paidAndReleasedBeforeDeployment();
        const before = await saves();
        assert.equal((await action('assign')).status, 200);
        const claimed = await action('claim');
        assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
        assert.deepEqual(claimed.body, { ok: true, claimed: 0 });
        assert.deepEqual(await kv.get(PAID_KEY), { academy: receipt.appliedAt });
        assert.deepEqual(await saves(), before, 'receipt harvesting must credit neither player again');
    });

    test('repeated releases and rejoins, including a different sensei, preserve the historical flag', async () => {
        await paidAndReleasedBeforeDeployment();
        const before = await saves();
        for (const sensei of [SENSEI, SENSEI, OTHER, SENSEI]) {
            assert.equal((await action('assign', sensei)).status, 200);
            assert.equal((await action('claim', sensei)).body.claimed, 0);
            assert.equal((await action('release', sensei)).status, 200);
        }
        assert.deepEqual(await saves(), before);
        assert.deepEqual(await kv.get(PAID_KEY), { academy: START });
    });

    test('a genuinely unpaid ranked milestone still pays once after historical Academy repair', async () => {
        await paidAndReleasedBeforeDeployment();
        assert.equal((await action('assign', OTHER)).status, 200);
        await patchStudent({ rankedWins: 1 });
        const before = await saves();
        const out = await action('claim', OTHER);
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body.claimed, 1);
        assert.deepEqual(out.body.milestones, ['rankedWin']);
        const after = await saves();
        const payout = rewards.mentorPayout(1);
        assert.deepEqual(after[0], before[0], 'the former sensei receives no further payment');
        assert.equal(after[1].character.honorSeals - before[1].character.honorSeals, payout.seals);
        assert.equal(after[1].character.clanEventContrib - before[1].character.clanEventContrib, payout.contrib);
        assert.equal(after[1].character.clanPoints - before[1].character.clanPoints, 25);
        assert.equal(after[2].character.ryo - before[2].character.ryo, payout.studentRyo);
        assert.deepEqual(await kv.get(PAID_KEY), { academy: START, rankedWin: START });
        assert.equal((await action('claim', OTHER)).body.claimed, 0);
        assert.deepEqual(await saves(), after);
    });

    test('recovery harvests a released pair receipt before a pre-deploy pending payment compacts it', async () => {
        await paidAndReleasedBeforeDeployment();
        assert.equal((await action('assign')).status, 200);
        await patchStudent({ rankedWins: 1 });
        const admission = await settlement.admitMentorClaim(SENSEI, STUDENT, time);
        assert.equal(admission.status, 'admitted');
        if (admission.status !== 'admitted') throw new Error('expected a pending ranked payment');
        assert.deepEqual(admission.settlement.milestones, ['rankedWin']);
        // An older worker admitted this new reward without carrying the old
        // receipt forward. Reconciliation has no new-claim admission to do so.
        await kv.del(PAID_KEY);
        assert.deepEqual(studentReceipts(await read(STUDENT_KEY)).map((r) => r.milestones), [['academy']]);
        const before = await saves();
        const recovered = await settlement.recoverPendingMentorSettlements({ now: time, discover: true });
        assert.deepEqual(recovered.completed, [admission.settlement.id]);
        assert.deepEqual(recovered.failures, []);
        assert.deepEqual(recovered.exceptions, []);
        assert.equal((await read(PAID_KEY)).academy, START, 'the historical proof survives receipt compaction');
        assert.equal((await read(STUDENT_KEY)).character.ryo - before[2].character.ryo, rewards.MENTOR_STUDENT_RYO);
        const after = await saves();
        assert.equal((await action('release')).status, 200);
        assert.equal((await action('assign', OTHER)).status, 200);
        assert.equal((await action('claim', OTHER)).body.claimed, 0);
        assert.deepEqual(await saves(), after);
    });

    test('recovery harvests the stored receipt while idle regeneration changes the callback snapshot', async () => {
        await paidAndReleasedBeforeDeployment();
        assert.equal((await action('assign')).status, 200);
        await patchStudent({ rankedWins: 1, hp: 50 });
        const admission = await settlement.admitMentorClaim(SENSEI, STUDENT, time);
        assert.equal(admission.status, 'admitted');
        if (admission.status !== 'admitted') throw new Error('expected a pending ranked payment');
        await kv.del(PAID_KEY);
        const before = await read(STUDENT_KEY);
        time += 10_000;
        const recovered = await settlement.recoverPendingMentorSettlements({ now: time, discover: true });
        assert.deepEqual(recovered.completed, [admission.settlement.id]);
        assert.deepEqual(recovered.failures, []);
        assert.deepEqual(recovered.exceptions, []);
        const after = await read(STUDENT_KEY);
        assert.ok(after.character.hp > before.character.hp, 'the mutation actually settled idle regeneration');
        assert.equal(after.character.ryo - before.character.ryo, rewards.MENTOR_STUDENT_RYO);
        assert.deepEqual(await kv.get(PAID_KEY), { academy: START });
        assert.ok(studentReceipts(after).some((receipt) => receipt.milestones.includes('rankedWin')));
    });

    test('repair unions existing flags without replacing timestamps or touching any player save', async () => {
        await paidAndReleasedBeforeDeployment();
        await kv.set(PAID_KEY, { academy: START - 7, level20: START - 5 });
        const before = await saves();
        const result = await settlement.repairMentorStudentPaid(STUDENT);
        assert.deepEqual(result.paid, { academy: START });
        assert.equal(result.evidence.length, 1);
        await settlement.repairMentorStudentPaid(STUDENT);
        assert.deepEqual(await kv.get(PAID_KEY), { academy: START - 7, level20: START - 5 });
        assert.deepEqual(await saves(), before);
    });

    test('newest-first historical receipts choose the earliest payment and match the dry-run proposal', async () => {
        const earliest = await paidAndReleasedBeforeDeployment();
        // Model the older server paying this milestone under a later pairing:
        // its ever-paid key and retained receipt were unavailable at admission.
        await patchStudent({ mentorRewardReceipts: [] });
        time += 1_000;
        assert.equal((await action('assign', OTHER)).status, 200);
        assert.equal((await action('claim', OTHER)).body.claimed, 1);
        const latest = studentReceipts(await read(STUDENT_KEY))[0];
        assert.notEqual(latest.pairingId, earliest.pairingId);
        assert.ok(latest.appliedAt > earliest.appliedAt);
        await patchStudent({ mentorRewardReceipts: [latest, earliest] });
        await kv.set(PAID_KEY, { rankedWin: START - 5 });
        const source = await read(STUDENT_KEY);
        const parsed = history.mentorHistoryFromStudentSave(STUDENT, source, time);
        assert.deepEqual(parsed.paid, { academy: START });
        assert.equal(parsed.evidence.length, 2);
        const { buildMentorHistoryReport } = await import('../../scripts/mentor-history-report.js');
        const report = buildMentorHistoryReport({ capturedAt: time, rows: [
            { key: STUDENT_KEY, value: { character: { createdAt: source.character.createdAt, mentorRewardReceipts: source.character.mentorRewardReceipts } } },
            { key: PAID_KEY, value: await kv.get(PAID_KEY) },
        ] }, time);
        assert.equal(report.proposedWrites.length, 1);
        assert.deepEqual(report.proposedWrites[0].next, { academy: START, rankedWin: START - 5 });
        const before = await saves();
        await settlement.repairMentorStudentPaid(STUDENT);
        assert.deepEqual(await kv.get(PAID_KEY), report.proposedWrites[0].next);
        assert.deepEqual(await saves(), before);
    });

    test('conflicting copies of one receipt require review while identical duplicates repair safely', async () => {
        const receipt = await paidAndReleasedBeforeDeployment();
        for (const conflict of [{ fingerprint: 'f'.repeat(64) }, { ryo: receipt.ryo + 1 }]) {
            await patchStudent({ mentorRewardReceipts: [receipt, { ...receipt, ...conflict }] });
            const source = await read(STUDENT_KEY);
            const parsed = history.mentorHistoryFromStudentSave(STUDENT, source, time);
            assert.deepEqual(parsed.paid, {}, JSON.stringify(conflict));
            assert.deepEqual(parsed.evidence, []);
            assert.ok(parsed.unresolved.some((item) => item.reason === 'conflicting-receipt-copies'));
            const before = await saves();
            await settlement.repairMentorStudentPaid(STUDENT);
            assert.equal(await kv.get(PAID_KEY), null, 'a valid-looking copy cannot override its conflicting sibling');
            assert.deepEqual(await saves(), before);
        }
        await patchStudent({ mentorRewardReceipts: [receipt, structuredClone(receipt)] });
        const identical = history.mentorHistoryFromStudentSave(STUDENT, await read(STUDENT_KEY), time);
        assert.deepEqual(identical.paid, { academy: START });
        assert.deepEqual(identical.unresolved, []);
        const before = await saves();
        await settlement.repairMentorStudentPaid(STUDENT);
        await settlement.repairMentorStudentPaid(STUDENT);
        assert.deepEqual(await kv.get(PAID_KEY), { academy: START });
        assert.deepEqual(await saves(), before);
    });

    test('a targeted approval only writes the approved subset of proven milestones', async () => {
        await patchStudent({ rankedWins: 1 });
        assert.equal((await action('claim')).body.claimed, 2);
        await kv.del(PAID_KEY);
        const before = await saves();
        await settlement.repairMentorStudentPaid(STUDENT, time, ['academy']);
        assert.deepEqual(await kv.get(PAID_KEY), { academy: START });
        assert.deepEqual(await saves(), before);
    });

    test('missing, malformed and count-only legacy evidence never fabricates paid flags', async () => {
        const source = await read(STUDENT_KEY);
        for (const legacy of [
            null, {}, { character: {} },
            { character: { ...source.character, mentorMilestones: 4, level: 45, rankedWins: 10 } },
            { character: { ...source.character, mentorRewardReceipts: { academy: START } } },
            { character: { ...source.character, mentorRewardReceipts: [null, { count: 4 }] } },
        ]) {
            if (legacy === null) await kv.del(STUDENT_KEY); else await kv.set(STUDENT_KEY, legacy);
            const before = await kv.get(STUDENT_KEY);
            const result = await settlement.repairMentorStudentPaid(STUDENT);
            assert.deepEqual(result.paid, {}, JSON.stringify(legacy));
            assert.equal(await kv.get(PAID_KEY), null);
            assert.deepEqual(await kv.get(STUDENT_KEY), before);
        }
        const ambiguous = history.mentorHistoryFromRecord(SENSEI, {
            students: [{ studentSlug: STUDENT, claimed: { academy: START } }],
            settledLog: [{ student: STUDENT, id: 'old-count-only', milestones: 4, seals: 200 }],
        }, new Map(), time);
        assert.deepEqual(ambiguous.paid, {});
        assert.ok(ambiguous.unresolved.some((r) => r.reason === 'claimed-is-a-reservation-not-proof-of-payment'));
        assert.ok(ambiguous.unresolved.some((r) => r.reason === 'completion-log-has-no-current-account-receipt'));
    });

    test('ambiguous legacy data leaves a legitimately unpaid Academy milestone claimable', async () => {
        await patchStudent({ mentorMilestones: 4, clanPointHistory: [{ amount: 25, source: 'mentorMilestone' }] });
        const repair = await settlement.repairMentorStudentPaid(STUDENT);
        assert.deepEqual(repair.paid, {});
        const before = (await read(STUDENT_KEY)).character.ryo;
        const out = await action('claim');
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.deepEqual(out.body.milestones, ['academy']);
        assert.equal((await read(STUDENT_KEY)).character.ryo - before, rewards.MENTOR_STUDENT_RYO);
    });

    test('malformed existing paid records are preserved and explicitly refuse new claims', async () => {
        for (const malformed of [{ academy: 'paid' }, { unknown: START }, [], { academy: -1 }]) {
            await kv.set(PAID_KEY, malformed);
            const before = await saves();
            const out = await action('claim');
            assert.equal(out.status, 409, JSON.stringify(out.body));
            assert.equal(out.body.review, true);
            assert.deepEqual(await kv.get(PAID_KEY), malformed);
            assert.deepEqual(await saves(), before);
        }
    });

    test('unavailable payment-history storage asks for retry instead of permanent review', async () => {
        const get = kv.get.bind(kv);
        kv.get = (async (key: string) => {
            if (key === PAID_KEY) throw new Error('injected transient history outage');
            return get(key);
        }) as typeof kv.get;
        try {
            const out = await action('claim');
            assert.equal(out.status, 503);
            assert.equal(out.body.retryable, true);
            assert.equal(out.body.review, undefined);
        } finally { kv.get = get; }
        assert.equal((await action('claim')).body.claimed, 1);
    });

    test('a committed repair with a lost acknowledgement is safe to retry', async () => {
        await paidAndReleasedBeforeDeployment();
        const before = await saves();
        let fired = false;
        kv.compareSet = async (key, expected, value, options) => {
            const result = await original.compareSet(key, expected, value, options);
            if (key === PAID_KEY && !fired) {
                fired = true;
                assert.equal(result, true);
                throw new Error('injected lost repair acknowledgement');
            }
            return result;
        };
        await assert.rejects(settlement.repairMentorStudentPaid(STUDENT), /lost repair acknowledgement/);
        assert.ok(fired);
        restoreKv();
        assert.deepEqual(await kv.get(PAID_KEY), { academy: START }, 'the repair really committed before the reply was lost');
        time += 399 * DAY;
        await settlement.repairMentorStudentPaid(STUDENT);
        await settlement.repairMentorStudentPaid(STUDENT);
        assert.deepEqual(await kv.get(PAID_KEY), { academy: START });
        time = START + 400 * DAY;
        assert.equal(await kv.get(PAID_KEY), null, 'retries must not restart the committed repair\'s retention period');
        assert.deepEqual(await saves(), before);
    });

    test('a stale ever-paid writer retries its CAS without erasing another milestone', async () => {
        await kv.set(PAID_KEY, { level20: START - 3 });
        let fired = false;
        kv.compareSet = async (key, expected, value, options) => {
            if (key === PAID_KEY && !fired) {
                fired = true;
                assert.equal(await original.compareSet(key, expected, { ...(expected as Json), rankedWin: START - 2 }), true);
            }
            return original.compareSet(key, expected, value, options);
        };
        await settlement.recordMentorStudentPaid(STUDENT, { academy: START });
        assert.ok(fired);
        assert.deepEqual(await kv.get(PAID_KEY), { level20: START - 3, rankedWin: START - 2, academy: START });
    });

    test('repair refuses stale source evidence when the student account changes before its transaction', async () => {
        await paidAndReleasedBeforeDeployment();
        assert.ok(original.compareSetMany);
        let fired = false;
        kv.compareSetMany = async (ops) => {
            if (ops.some((op) => op.op === 'cas' && op.key === PAID_KEY) && !fired) {
                fired = true;
                const source = await read(STUDENT_KEY);
                await kv.set(STUDENT_KEY, { ...source, character: { ...source.character, createdAt: START + 1, mentorRewardReceipts: [] } });
            }
            return original.compareSetMany!(ops);
        };
        await assert.rejects(settlement.repairMentorStudentPaid(STUDENT), /save changed/i);
        assert.ok(fired);
        assert.equal(await kv.get(PAID_KEY), null);
        restoreKv();
        assert.deepEqual((await settlement.repairMentorStudentPaid(STUDENT)).paid, {});
        assert.equal(await kv.get(PAID_KEY), null, 'a retry must inspect the recreated account instead of the old receipt');
    });

    test('valid receipts still prevent replay when an unchanged canonical key expires before admission rereads it', async () => {
        await paidAndReleasedBeforeDeployment();
        assert.equal((await action('assign')).status, 200);
        await kv.set(PAID_KEY, { academy: START }, { ex: 1 });
        const before = await saves();
        const get = kv.get.bind(kv);
        let paidReads = 0;
        kv.get = (async (key: string) => {
            const value = await get(key);
            if (key === PAID_KEY && ++paidReads === 1) {
                assert.deepEqual(value, { academy: START }, 'harvesting sees the existing flag and skips its unchanged write');
                time += 1_001;
            }
            return value;
        }) as typeof kv.get;
        try {
            const admission = await settlement.admitMentorClaim(SENSEI, STUDENT, START);
            assert.deepEqual(admission, { status: 'none' });
            assert.equal(paidReads, 2, 'the subsequent canonical read observes the expired key');
        } finally { kv.get = get; }
        assert.equal(await kv.get(PAID_KEY), null, 'receipt evidence excludes replay without forcing an expiry renewal');
        assert.deepEqual(await saves(), before, 'neither player receives the historical reward again');
        assert.deepEqual((await read(RECORD_KEY)).settlements ?? [], []);
    });

    test('a newly validated historical flag keeps the original 400-day retention', async () => {
        await paidAndReleasedBeforeDeployment();
        const before = await saves();
        await settlement.repairMentorStudentPaid(STUDENT);
        time = START + 400 * DAY - 1;
        assert.deepEqual(await kv.get(PAID_KEY), { academy: START });
        time += 1;
        assert.equal(await kv.get(PAID_KEY), null, 'historical repair must preserve #413\'s 400-day policy');
        assert.deepEqual(await saves(), before);
    });

    test('receiptless current or missing accounts do not renew an existing canonical record', async () => {
        const source = await read(STUDENT_KEY);
        for (const scenario of ['recreated', 'missing']) {
            time = START;
            if (scenario === 'missing') await kv.del(STUDENT_KEY);
            else await kv.set(STUDENT_KEY, { ...source, character: { ...source.character, createdAt: START - 1, mentorRewardReceipts: [] } });
            const paid = { academy: START - 20, level20: START - 10 };
            await kv.set(PAID_KEY, paid, { ex: 10 });
            const before = await saves();
            time += 5_000;
            const repaired = await settlement.repairMentorStudentPaid(STUDENT);
            assert.deepEqual(repaired.paid, {}, scenario);
            assert.deepEqual(repaired.evidence, [], 'there is no receipt left to reconstruct');
            assert.deepEqual(await kv.get(PAID_KEY), paid);
            time += 5_000;
            assert.equal(await kv.get(PAID_KEY), null, `${scenario} account must not renew unrelated canonical history`);
            await settlement.repairMentorStudentPaid(STUDENT);
            assert.equal(await kv.get(PAID_KEY), null, 'no evidence means no replacement after expiration');
            assert.deepEqual(await saves(), before);
        }
    });
});

describe('historical mentor receipt validation', { concurrency: false }, () => {
    test('accepts the actual student receipt and ignores a teacher receipt stored on the same player', async () => {
        await paidAndReleasedBeforeDeployment();
        const student = await read(STUDENT_KEY);
        const teacherReceipt = studentReceipts(await read(`save:${SENSEI}`))[0];
        const mixed = { ...student, character: { ...student.character, mentorRewardReceipts: [teacherReceipt, ...studentReceipts(student)] } };
        const result = history.mentorHistoryFromStudentSave(STUDENT, mixed, time);
        assert.deepEqual(result.paid, { academy: START });
        assert.equal(result.evidence.length, 1);
        assert.deepEqual(result.unresolved, []);
        const teacherOnly = history.mentorHistoryFromStudentSave(STUDENT, { ...student, character: { ...student.character, mentorRewardReceipts: [teacherReceipt] } }, time);
        assert.deepEqual(teacherOnly.paid, {}, 'a teacher receipt does not name a student payout');
    });

    test('invalid receipt amounts, milestones, identities and timestamps produce review cases without flags', async () => {
        await paidAndReleasedBeforeDeployment();
        const source = await read(STUDENT_KEY);
        const receipt = studentReceipts(source)[0];
        const corruptions: Json[] = [
            { ryo: receipt.ryo + 1 }, { ryo: '1000' }, { milestones: [] }, { milestones: ['academy', 'academy'] },
            { milestones: ['unknown'] }, { settlementId: 'mentor-invalid' }, { pairingId: '' }, { senseiSlug: '../foreign' },
            { fingerprint: 'bad' }, { appliedAt: 0 }, { appliedAt: START + 1 }, { appliedAt: Number.NaN },
            { role: 'unknown' }, { v: 2 },
        ];
        for (const patch of corruptions) {
            const save = { ...source, character: { ...source.character, mentorRewardReceipts: [{ ...receipt, ...patch }] } };
            const result = history.mentorHistoryFromStudentSave(STUDENT, save, time);
            assert.deepEqual(result.paid, {}, JSON.stringify(patch));
            assert.equal(result.evidence.length, 0);
            assert.equal(result.unresolved.length, 1, JSON.stringify(patch));
        }
        for (const createdAt of [undefined, 0, 'old', START + 1]) {
            const result = history.mentorHistoryFromStudentSave(STUDENT, { ...source, character: { ...source.character, createdAt } }, time);
            assert.deepEqual(result.paid, {});
            assert.equal(result.unresolved.length, 1);
        }
        assert.deepEqual(history.mentorHistoryFromStudentSave('../invalid-student', source, time).paid, {});
    });

    test('the paid-record parser refuses malformed data instead of silently dropping flags', () => {
        assert.deepEqual(history.parseMentorPaidRecord(null), {});
        assert.deepEqual(history.parseMentorPaidRecord({ academy: START }), { academy: START });
        for (const raw of [[], 'paid', { academy: 0 }, { academy: Number.POSITIVE_INFINITY }, { unknown: START }]) {
            assert.throws(() => history.parseMentorPaidRecord(raw), /needs review/);
        }
    });
});
