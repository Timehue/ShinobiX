import { after, before, beforeEach, describe, it } from 'node:test';
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
