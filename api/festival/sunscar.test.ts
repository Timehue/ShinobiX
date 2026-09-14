import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { beginDurableSettlement, getDurableSettlement, listPendingDurableSettlements, settlementFingerprint, settlementTransactionId } from '../_durable-settlement.js';

// In-memory KV + admin auth so we can drive the real handler (lock, mutate,
// token consume) without a database. Admin auth bypasses the per-player name
// check and the rate limit, so the tests exercise the settlement logic directly.
// The memory-kv backend is gated on NODE_ENV=test (see _storage.ts) and forces
// the disk overlay off, so save:* lives in the isolated in-process store.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'sunscar-handler-test-admin';
delete process.env.SESSION_SECRET;

type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
type Handler = (req: never, res: never) => Promise<unknown>;

let handler: Handler;
let kv: typeof import('../_storage.js').kv;

const PLAYER = 'miraatester';
const SAVE_KEY = `save:${PLAYER}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./sunscar.js')).default as unknown as Handler;
});

beforeEach(async () => {
    // Fresh save with a known ryo balance before each test.
    await kv.set(SAVE_KEY, { character: { name: PLAYER, ryo: 1000 }, _saveVersion: 1 });
    // Clear any leftover wager tokens / daily counters.
    for (const key of await kv.keys('miraa-token:*')) await kv.del(key);
    for (const key of await kv.keys('miraa-wager-count:*')) await kv.del(key);
    for (const key of await kv.keys('economy-settlement:*')) await kv.del(key);
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeReq(body: Record<string, unknown>) {
    return {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

function fakeRes() {
    const out: ResponseOut = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function post(body: Record<string, unknown>): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    await handler(fakeReq(body), res);
    return out;
}

async function ryo(): Promise<number> {
    const rec = await kv.get<{ character?: { ryo?: number } }>(SAVE_KEY);
    return Number(rec?.character?.ryo ?? NaN);
}

/*
 * Seed a wager that was ALREADY OPEN when the removal shipped: a durable
 * miraa-start journal, the short-lived client token, and the ryo escrow the old
 * start endpoint took. `miraa-start` itself is retired (410), so this is the
 * only way such a wager can exist — and it is exactly the state a live player
 * could have been in at deploy time.
 */
async function seedInFlightWager(bet: number, token = 'seededwagertoken'): Promise<string> {
    const txId = settlementTransactionId('miraa-start', `${PLAYER}:${token}`);
    const fp = settlementFingerprint({ operation: 'miraa-start', playerName: PLAYER, bet });
    await beginDurableSettlement({
        transactionId: txId,
        idempotencyKey: token,
        operationType: 'miraa-start',
        fingerprint: fp,
        actorIds: [PLAYER],
        resource: 'ryo',
        amount: bet,
        meta: { playerName: PLAYER, bet, token },
    }, { kv });
    await kv.set(`miraa-token:${PLAYER}:${token}`, { playerName: PLAYER, bet, transactionId: txId, mintedAt: Date.now() }, { ex: 900 });
    const rec = await kv.get<Record<string, unknown>>(SAVE_KEY);
    const character = (rec?.character ?? {}) as Record<string, unknown>;
    await kv.set(SAVE_KEY, { ...rec, character: { ...character, ryo: 1000 - bet } });
    return token;
}

describe('sunscar Miraa handler — wager retired, in-flight stakes refunded', () => {
    it('retires the client-attested kind:"miraa" mint (no payout, ryo unchanged)', async () => {
        const before = await ryo();
        const out = await post({ kind: 'miraa', playerName: PLAYER, bet: 500, outcome: 'win' });
        assert.equal(out.statusCode, 410, 'legacy client-attested path is gone');
        assert.equal(await ryo(), before, 'a claimed win mints nothing');
    });

    it('REFUSES to open a new wager — miraa-start is retired', async () => {
        const before = await ryo();
        const out = await post({ kind: 'miraa-start', playerName: PLAYER, bet: 500 });
        assert.equal(out.statusCode, 410, 'no new wager may be opened');
        assert.equal(await ryo(), before, 'nothing is escrowed');
        assert.equal((await kv.keys('miraa-token:*')).length, 0, 'no token is minted');
    });

    it('refunds an in-flight stake IN FULL — player ends net zero', async () => {
        const token = await seedInFlightWager(500);
        assert.equal(await ryo(), 500, 'escrow was taken before the removal');

        const out = await post({ kind: 'miraa-report', playerName: PLAYER, token });
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.outcome, 'refund');
        assert.equal(out.body?.credit, 500);
        assert.equal(await ryo(), 1000, 'the whole stake comes back');
    });

    it('ignores a client-claimed outcome — a "win" cannot pay more than the stake', async () => {
        const token = await seedInFlightWager(500);
        const out = await post({ kind: 'miraa-report', playerName: PLAYER, token, outcome: 'win', forfeit: false });
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.outcome, 'refund');
        assert.equal(await ryo(), 1000, 'never 2x — the wager is gone, this is a refund');
    });

    it('refunds a forfeited wager too — bailing no longer costs the stake', async () => {
        const token = await seedInFlightWager(250);
        const out = await post({ kind: 'miraa-report', playerName: PLAYER, token, forfeit: true });
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.credit, 250);
        assert.equal(await ryo(), 1000);
    });

    it('token is single-use — a replayed report cannot double-refund', async () => {
        const token = await seedInFlightWager(500);
        const first = await post({ kind: 'miraa-report', playerName: PLAYER, token });
        assert.equal(first.statusCode, 200);
        assert.equal(await ryo(), 1000);

        const replay = await post({ kind: 'miraa-report', playerName: PLAYER, token });
        assert.equal(replay.statusCode, 200, 'replay is idempotent, not an error');
        assert.equal(replay.body?.credit, 500, 'replay echoes the sealed receipt');
        assert.equal(await ryo(), 1000, 'balance is unchanged by the replay');
    });

    it('recovers the sealed stake after the short-lived client token expires', async () => {
        const token = await seedInFlightWager(500);
        // The client token TTLs out; the durable start journal outlives it.
        for (const key of await kv.keys('miraa-token:*')) await kv.del(key);

        const out = await post({ kind: 'miraa-report', playerName: PLAYER, token });
        assert.equal(out.statusCode, 200, 'an expired token must not strand the refund');
        assert.equal(out.body?.credit, 500);
        assert.equal(await ryo(), 1000);
    });

    it('rejects a report with a missing / malformed token', async () => {
        assert.equal((await post({ kind: 'miraa-report', playerName: PLAYER })).statusCode, 400);
        assert.equal((await post({ kind: 'miraa-report', playerName: PLAYER, token: '../etc' })).statusCode, 400);
    });

    it('leaves no pending settlement behind after a refund', async () => {
        const token = await seedInFlightWager(500);
        await post({ kind: 'miraa-report', playerName: PLAYER, token });
        const pending = await listPendingDurableSettlements({ kv });
        assert.equal(pending.filter((r) => r.operationType === 'miraa-report').length, 0);
    });
});

describe('sunscar Fate Dice handler — the daily cap survives generic saves', () => {
    // The handler and the save sanitizer both read the UTC day from Date. Freeze
    // it so a run that crosses midnight cannot split the draws across two days.
    before(() => mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 8, 14, 12, 0, 0) }));
    after(() => mock.timers.reset());

    /*
     * Apply a generic autosave the way POST /api/save/:name does before it
     * writes: sanitize the incoming payload against the stored record, then
     * merge it over that record. `overrides` is what the stale or modified
     * client sends on top of an otherwise faithful copy of the character.
     */
    async function genericSave(overrides: Record<string, unknown>): Promise<void> {
        const { sanitizeCharacterSave } = await import('../save/[name].js');
        const { mergePreservingImages } = await import('../_utils.js');
        const stored = await kv.get<Record<string, unknown>>(SAVE_KEY);
        const storedCharacter = (stored?.character ?? {}) as Record<string, unknown>;
        const safe = sanitizeCharacterSave({ character: { ...storedCharacter, ...overrides } }, stored ?? null);
        const merged = mergePreservingImages(safe, stored) as Record<string, unknown>;
        await kv.set(SAVE_KEY, { ...merged, _saveVersion: Number(stored?._saveVersion ?? 0) + 1 });
    }

    it('refuses the sixth draw of the day even after saves that lower the count or blank the day stamp', async () => {
        for (let draw = 1; draw <= 5; draw++) {
            const out = await post({ kind: 'dice', playerName: PLAYER });
            assert.equal(out.statusCode, 200, `draw ${draw} of 5 is allowed`);
            assert.equal(out.body?.dailyUsed, draw);
        }
        assert.equal((await post({ kind: 'dice', playerName: PLAYER })).statusCode, 429, 'the sixth draw is refused');

        for (const overrides of [
            { dailyFateSpins: 0 },
            { dailyFateSpins: 0, lastDailyReset: '' },
            { dailyFateSpins: 'x' },
        ]) {
            await genericSave(overrides);
            const out = await post({ kind: 'dice', playerName: PLAYER });
            assert.equal(out.statusCode, 429, `still refused after a save carrying ${JSON.stringify(overrides)}`);
        }
        const rec = await kv.get<{ character?: Record<string, unknown> }>(SAVE_KEY);
        assert.equal(rec?.character?.dailyFateSpins, 5);
    });
});
