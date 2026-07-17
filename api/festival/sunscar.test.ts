import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

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

// Force resolveMiraaWager's server roll (which reads Math.random) to a fixed
// value for the duration of one call, then restore it.
async function withRoll<T>(value: number, fn: () => Promise<T>): Promise<T> {
    const real = Math.random;
    Math.random = () => value;
    try {
        return await fn();
    } finally {
        Math.random = real;
    }
}

describe('sunscar Miraa handler — server-authoritative wager', () => {
    it('retires the client-attested kind:"miraa" mint (no payout, ryo unchanged)', async () => {
        const before = await ryo();
        const out = await post({ kind: 'miraa', playerName: PLAYER, bet: 500, outcome: 'win' });
        assert.equal(out.statusCode, 410, 'legacy client-attested path is gone');
        assert.equal(await ryo(), before, 'a claimed win mints nothing');
    });

    it('miraa-start deducts (escrows) the stake and mints a single-use token', async () => {
        const out = await post({ kind: 'miraa-start', playerName: PLAYER, bet: 500 });
        assert.equal(out.statusCode, 200);
        assert.equal(typeof out.body?.token, 'string');
        assert.equal(out.body?.balanceRyo, 500, 'stake debited immediately');
        assert.equal(await ryo(), 500, 'escrow is written to the save');

        // The sealed token carries the bet the report will pay from.
        const token = out.body!.token as string;
        const sealed = await kv.get<{ playerName?: string; bet?: number }>(`miraa-token:${PLAYER}:${token}`);
        assert.equal(sealed?.bet, 500);
        assert.equal(sealed?.playerName, PLAYER);
    });

    it('rejects an off-ladder wager and never escrows', async () => {
        const out = await post({ kind: 'miraa-start', playerName: PLAYER, bet: 75 });
        assert.equal(out.statusCode, 400);
        assert.equal(await ryo(), 1000, 'balance untouched');
    });

    it('refuses to escrow more than the player can afford', async () => {
        await kv.set(SAVE_KEY, { character: { name: PLAYER, ryo: 100 }, _saveVersion: 1 });
        const out = await post({ kind: 'miraa-start', playerName: PLAYER, bet: 500 });
        assert.equal(out.statusCode, 400);
        assert.equal(await ryo(), 100, 'balance untouched');
    });

    it('pays a server-rolled WIN from the sealed bet (net +bet), ignoring client outcome', async () => {
        const start = await post({ kind: 'miraa-start', playerName: PLAYER, bet: 500 });
        const token = start.body!.token as string;
        assert.equal(await ryo(), 500); // escrowed

        // Force a win (roll 0.1 < 0.40). A hostile body.outcome:'loss' must NOT
        // suppress the legit win — the server ignores it entirely.
        const rep = await withRoll(0.1, () => post({ kind: 'miraa-report', playerName: PLAYER, token, outcome: 'loss' }));
        assert.equal(rep.statusCode, 200);
        assert.equal(rep.body?.outcome, 'win');
        assert.equal(rep.body?.credit, 1000, 'win credits 2×bet back');
        assert.equal(rep.body?.balanceRyo, 1500);
        assert.equal(await ryo(), 1500, 'net +500 over the pre-wager 1000');
    });

    it('keeps the stake on a server-rolled LOSS even when the client claims a win', async () => {
        const start = await post({ kind: 'miraa-start', playerName: PLAYER, bet: 500 });
        const token = start.body!.token as string;

        // Force a loss (roll 0.9 >= 0.40). The client asserting outcome:'win'
        // mints nothing — the escrowed stake stays with the house.
        const rep = await withRoll(0.9, () => post({ kind: 'miraa-report', playerName: PLAYER, token, outcome: 'win' }));
        assert.equal(rep.statusCode, 200);
        assert.equal(rep.body?.outcome, 'loss');
        assert.equal(rep.body?.credit, 0);
        assert.equal(await ryo(), 500, 'net −500 (stake lost)');
    });

    it('forfeit (left mid-match) is an automatic loss with no roll', async () => {
        const start = await post({ kind: 'miraa-start', playerName: PLAYER, bet: 250 });
        const token = start.body!.token as string;
        // Roll forced to a "win" value, but forfeit short-circuits before the roll.
        const rep = await withRoll(0.0, () => post({ kind: 'miraa-report', playerName: PLAYER, token, forfeit: true }));
        assert.equal(rep.body?.outcome, 'forfeit');
        assert.equal(rep.body?.credit, 0);
        assert.equal(await ryo(), 750, 'stake forfeited, net −250');
    });

    it('token is single-use — a replayed report cannot double-pay', async () => {
        const start = await post({ kind: 'miraa-start', playerName: PLAYER, bet: 500 });
        const token = start.body!.token as string;

        const first = await withRoll(0.1, () => post({ kind: 'miraa-report', playerName: PLAYER, token }));
        assert.equal(first.body?.outcome, 'win');
        assert.equal(await ryo(), 1500);

        // Replaying the same token forces a win roll again but must be rejected.
        const replay = await withRoll(0.1, () => post({ kind: 'miraa-report', playerName: PLAYER, token }));
        assert.equal(replay.statusCode, 409, 'consumed token is gone');
        assert.equal(await ryo(), 1500, 'no second payout');
    });

    it('rejects a report with a missing / malformed token', async () => {
        const bad = await post({ kind: 'miraa-report', playerName: PLAYER, token: 'not a real token!' });
        assert.equal(bad.statusCode, 400);
        const missing = await post({ kind: 'miraa-report', playerName: PLAYER });
        assert.equal(missing.statusCode, 400);
    });
});
