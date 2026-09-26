import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.ADMIN_PASSWORD;

/*
 * Three stakes that debit a player save and then open something on a shared
 * row: the Hollow Gate window (village row), a clan war (war-pair row) and a
 * Kage challenge (Kage row). Each wrote a plain debit and then a plain row
 * write. A row write that committed but reported an error was refunded
 * anyway (a free window or challenge); a debit whose row write failed before
 * committing was lost with no war (clan war), and pressing again charged a
 * second time. They now run through the save-debit saga with a request id.
 * Real handlers, token auth, locks and the memory store.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { status: number; body?: Record<string, unknown> };
type Save = { _saveVersion: number; character: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: () => void;
let unlock: Handler;
let declareWar: Handler;
let kage: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    unlock = (await import('./hollow-gate-unlock.js')).default as unknown as Handler;
    declareWar = (await import('../clan/war/declare.js')).default as unknown as Handler;
    kage = (await import('./kage-challenge.js')).default as unknown as Handler;
});

async function wipe() {
    resetRateLimits();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
}

beforeEach(wipe);
after(async () => {
    await wipe();
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function callAs(handler: Handler, tokenOwner: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { out.status = status; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body,
        headers: { 'x-player-name': tokenOwner, 'x-player-token': issuePlayerToken(tokenOwner) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

async function field(saveKey: string, name: string): Promise<number> {
    return Number((await kv.get<Save>(saveKey))!.character[name]);
}

/** The next write of `key` fails. `landed`: it reaches storage first, and its readback fails too. */
function failRowWriteOnce(key: string, landed: boolean): () => void {
    const originalSet = kv.set.bind(kv);
    const originalGet = kv.get.bind(kv);
    let armed = true;
    let blind = false;
    kv.set = (async (k: string, value: unknown, options?: unknown) => {
        if (!armed || k !== key) return originalSet(k, value, options as never);
        armed = false;
        if (landed) {
            await originalSet(k, value, options as never);
            blind = true;
        }
        throw new Error(`injected: ${key} write ${landed ? 'committed but reported an error' : 'failed'}`);
    }) as typeof kv.set;
    kv.get = (async (k: string) => {
        if (blind && k === key) {
            blind = false;
            throw new Error('injected: readback failed');
        }
        return originalGet(k);
    }) as typeof kv.get;
    return () => {
        kv.set = originalSet;
        kv.get = originalGet;
    };
}

// ── Hollow Gate unlock ────────────────────────────────────────────────────
const GATE_VILLAGE = 'Frostfang Village';
const GATE_KAGE = 'gatekage';
const GATE_SAVE = `save:${GATE_KAGE}`;
const GATE_ROW = 'game:village-state:frostfangvillage';
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function seatGateKage(seals = 30_000) {
    await kv.set('village:kage:frostfang-village', { kageSystemUnlocked: true, seatedKage: GATE_KAGE, challenge: null });
    await kv.set(GATE_SAVE, { _saveVersion: 1, character: { name: GATE_KAGE, village: GATE_VILLAGE, honorSeals: seals } });
    await kv.set(GATE_ROW, { hollowGateUnlockedUntil: 0 });
}

const gateUntil = async () => Number((await kv.get<Record<string, unknown>>(GATE_ROW))?.hollowGateUnlockedUntil) || 0;

describe('Hollow Gate unlock settles exactly once', { concurrency: false }, () => {
    test('one unlock charges once, and its retry returns the same window', async () => {
        await seatGateKage();
        const first = await callAs(unlock, GATE_KAGE, { playerName: GATE_KAGE, requestId: 'gate-unlock-once-000001' });
        assert.equal(first.status, 200, JSON.stringify(first.body));
        const until = await gateUntil();
        assert.ok(until > Date.now() + WINDOW_MS - 60_000);
        const retry = await callAs(unlock, GATE_KAGE, { playerName: GATE_KAGE, requestId: 'gate-unlock-once-000001' });
        assert.equal(retry.status, 200);
        assert.equal(retry.body?.hollowGateUnlockedUntil, until, 'a lost answer does not buy a second 30 days');
        assert.equal(await field(GATE_SAVE, 'honorSeals'), 20_000);
    });

    test('concurrent duplicates charge once', async () => {
        await seatGateKage();
        const answers = await Promise.all(Array.from({ length: 4 }, () => callAs(unlock, GATE_KAGE, { playerName: GATE_KAGE, requestId: 'gate-unlock-burst-00001' })));
        assert.ok(answers.some((a) => a.status === 200), JSON.stringify(answers));
        assert.equal(await field(GATE_SAVE, 'honorSeals'), 20_000);
        assert.ok(await gateUntil() < Date.now() + WINDOW_MS + 60_000, 'one window, not several');
    });

    test('a window write that committed but reported an error is not refunded; the retry finishes it', async () => {
        await seatGateKage();
        const restore = failRowWriteOnce(GATE_ROW, true);
        let failed: Out;
        try {
            failed = await callAs(unlock, GATE_KAGE, { playerName: GATE_KAGE, requestId: 'gate-unlock-landed-0001' });
        } finally {
            restore();
        }
        // Before the fix the handler refunded here: the window stayed open and
        // the seals came back.
        assert.equal(await field(GATE_SAVE, 'honorSeals'), 20_000, 'no refund of a window that opened');
        assert.ok(await gateUntil() > Date.now());
        assert.equal(failed.status, 503);
        const retry = await callAs(unlock, GATE_KAGE, { playerName: GATE_KAGE, requestId: 'gate-unlock-landed-0001' });
        assert.equal(retry.status, 200, JSON.stringify(retry.body));
        assert.equal(await field(GATE_SAVE, 'honorSeals'), 20_000);
    });

    test('short balances, forged identities and a non-Kage move nothing', async () => {
        await seatGateKage(9_999);
        assert.equal((await callAs(unlock, GATE_KAGE, { playerName: GATE_KAGE, requestId: 'gate-unlock-short-00001' })).status, 409);
        await kv.set('save:gateoutsider', { _saveVersion: 1, character: { name: 'gateoutsider', village: GATE_VILLAGE, honorSeals: 30_000 } });
        assert.equal((await callAs(unlock, 'gateoutsider', { playerName: GATE_KAGE, requestId: 'gate-unlock-forged-0001' })).status, 403);
        assert.equal((await callAs(unlock, 'gateoutsider', { playerName: 'gateoutsider', requestId: 'gate-unlock-notkage-001' })).status, 403);
        assert.equal(await field(GATE_SAVE, 'honorSeals'), 9_999);
        assert.equal(await field('save:gateoutsider', 'honorSeals'), 30_000);
        assert.equal(await gateUntil(), 0);
    });
});

// ── Clan war declaration ──────────────────────────────────────────────────
const OFFICER = 'waroffice';
const OFFICER_SAVE = `save:${OFFICER}`;
const PAIR = 'clan-war:ashwind-vs-emberfall';

async function twoClans(seals = 500) {
    await kv.set('save:clan-ashwind', { name: 'Ashwind', village: 'Frostfang Village', founderName: OFFICER, members: [{ name: OFFICER, isFounder: true }] });
    await kv.set('save:clan-emberfall', { name: 'Emberfall', village: 'Moonshadow Village', founderName: 'otherfounder', members: [{ name: 'otherfounder', isFounder: true }] });
    await kv.set(OFFICER_SAVE, { _saveVersion: 1, character: { name: OFFICER, clan: 'Ashwind', clanFounder: true, village: 'Frostfang Village', honorSeals: seals } });
}

const declare = (requestId: string, tokenOwner = OFFICER) => callAs(declareWar, tokenOwner, { toClan: 'Emberfall', requestId });
const activeWar = async () => {
    const war = await kv.get<Record<string, unknown>>(PAIR);
    return war && !war.endedAt ? war : null;
};

describe('clan war declaration settles exactly once', { concurrency: false }, () => {
    test('one declaration charges once, and its retry returns the same war', async () => {
        await twoClans();
        const first = await declare('clan-war-declare-000001');
        assert.equal(first.status, 200, JSON.stringify(first.body));
        const startedAt = (await activeWar())?.startedAt;
        assert.ok(startedAt);
        const retry = await declare('clan-war-declare-000001');
        assert.equal(retry.status, 200);
        assert.equal((await activeWar())?.startedAt, startedAt, 'the retry does not replace the war');
        assert.equal(await field(OFFICER_SAVE, 'honorSeals'), 400);
    });

    test('concurrent duplicates charge once', async () => {
        await twoClans();
        const answers = await Promise.all(Array.from({ length: 3 }, () => declare('clan-war-burst-0000001')));
        assert.ok(answers.some((a) => a.status === 200), JSON.stringify(answers));
        assert.equal(await field(OFFICER_SAVE, 'honorSeals'), 400);
    });

    test('a war write that fails refunds the seals, and pressing again charges once', async () => {
        await twoClans();
        const restore = failRowWriteOnce(PAIR, false);
        let failed: Out;
        try {
            failed = await declare('clan-war-rowfail-000001');
        } finally {
            restore();
        }
        // Before the fix: a 500, 100 seals gone, no war, no record of either.
        assert.equal(await field(OFFICER_SAVE, 'honorSeals'), 500, 'the seals came back');
        assert.equal(await activeWar(), null);
        assert.equal(failed.status, 503);
        assert.equal(failed.body?.refunded, true);
        resetRateLimits();
        assert.equal((await declare('clan-war-rowfail-000001')).status, 200);
        assert.ok(await activeWar());
        assert.equal(await field(OFFICER_SAVE, 'honorSeals'), 400, 'one war, one charge');
    });

    test('a war write whose outcome is unknown is finished by the retry, not charged twice', async () => {
        await twoClans();
        const restore = failRowWriteOnce(PAIR, true);
        try {
            assert.equal((await declare('clan-war-landed-0000001')).status, 503);
        } finally {
            restore();
        }
        assert.ok(await activeWar(), 'the war was written');
        resetRateLimits();
        assert.equal((await declare('clan-war-landed-0000001')).status, 200);
        assert.equal(await field(OFFICER_SAVE, 'honorSeals'), 400);
    });

    test('short balances and an existing war move nothing', async () => {
        await twoClans(99);
        assert.equal((await declare('clan-war-short-00000001')).status, 400);
        assert.equal(await field(OFFICER_SAVE, 'honorSeals'), 99);
        await twoClans();
        await kv.set(PAIR, { id: 'ashwind-vs-emberfall', clans: ['Ashwind', 'Emberfall'], startedAt: Date.now() - 1_000 });
        resetRateLimits();
        const refused = await declare('clan-war-exists-0000001');
        assert.equal(refused.status, 409);
        assert.equal(await field(OFFICER_SAVE, 'honorSeals'), 500);
    });
});

// ── Kage challenge declaration ────────────────────────────────────────────
const KAGE_VILLAGE = 'Frostfang Village';
const KAGE_ROW = 'village:kage:frostfang-village';
const CHALLENGER = 'stakechallenger';
const CHALLENGER_SAVE = `save:${CHALLENGER}`;

async function openSeat(ryo = 500_000) {
    await kv.set(KAGE_ROW, { kageSystemUnlocked: true, seatedKage: 'seatedincumbent', challenge: null });
    await kv.set(CHALLENGER_SAVE, {
        _saveVersion: 1,
        character: { name: CHALLENGER, village: KAGE_VILLAGE, level: 90, createdAt: Date.now() - 30 * 86_400_000, villageMerit: 500, ryo },
    });
}

const challenge = (requestId: string, tokenOwner = CHALLENGER, playerName = CHALLENGER) => callAs(kage, tokenOwner, { action: 'declare', village: KAGE_VILLAGE, playerName, requestId });
const openChallenge = async () => (await kv.get<{ challenge?: Record<string, unknown> | null }>(KAGE_ROW))?.challenge ?? null;

describe('Kage challenge declaration settles exactly once', { concurrency: false }, () => {
    test('one declaration stakes once, and its retry returns the same challenge', async () => {
        await openSeat();
        const first = await challenge('kage-declare-once-00001');
        assert.equal(first.status, 200, JSON.stringify(first.body));
        const id = (await openChallenge())?.challengeId;
        assert.ok(id);
        const retry = await challenge('kage-declare-once-00001');
        assert.equal(retry.status, 200);
        assert.equal((retry.body?.challenge as Record<string, unknown>)?.challengeId, id);
        assert.equal(await field(CHALLENGER_SAVE, 'ryo'), 250_000);
    });

    test('concurrent duplicates stake once', async () => {
        await openSeat();
        const answers = await Promise.all(Array.from({ length: 4 }, () => challenge('kage-declare-burst-0001')));
        assert.ok(answers.some((a) => a.status === 200), JSON.stringify(answers));
        assert.equal(await field(CHALLENGER_SAVE, 'ryo'), 250_000);
    });

    test('a challenge write that committed but reported an error is not refunded; the retry finishes it', async () => {
        await openSeat();
        const restore = failRowWriteOnce(KAGE_ROW, true);
        try {
            assert.equal((await challenge('kage-declare-landed-001')).status, 503);
        } finally {
            restore();
        }
        // Before the fix: the challenge stood AND the 250,000 ryo came back.
        assert.ok(await openChallenge(), 'the challenge opened');
        assert.equal(await field(CHALLENGER_SAVE, 'ryo'), 250_000, 'so the stake stays taken');
        assert.equal((await challenge('kage-declare-landed-001')).status, 200);
        assert.equal(await field(CHALLENGER_SAVE, 'ryo'), 250_000);
    });

    test('short balances, forged identities and an open challenge move nothing', async () => {
        await openSeat(249_999);
        assert.notEqual((await challenge('kage-declare-short-0001')).status, 200);
        await openSeat();
        await kv.set('save:stakeforger', { _saveVersion: 1, character: { name: 'stakeforger', village: KAGE_VILLAGE, ryo: 500_000 } });
        assert.equal((await challenge('kage-declare-forged-001', 'stakeforger', CHALLENGER)).status, 403);
        await kv.set(KAGE_ROW, { kageSystemUnlocked: true, seatedKage: 'seatedincumbent', challenge: { challengeId: 'someone-else', challenger: 'Other', status: 'pending', createdAt: Date.now() } });
        assert.notEqual((await challenge('kage-declare-taken-0001')).status, 200);
        assert.equal(await field(CHALLENGER_SAVE, 'ryo'), 500_000);
        assert.equal((await openChallenge())?.challengeId, 'someone-else');
    });
});
