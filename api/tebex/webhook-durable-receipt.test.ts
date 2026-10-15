/*
 * L12 (security audit 2026-10-15): a shard purchase pays exactly once, even
 * when Tebex (or anyone holding a captured signed body) re-sends it after the
 * in-save `redeemedTebexPurchases` list has rolled past it (that list keeps
 * only the last 200 ids). The durable `tebex:txn:<id>` row has no cap.
 *
 * Drives the real handler over the in-memory store, signed the way Tebex signs.
 */
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.TEBEX_WEBHOOK_SECRET = 'durable-receipt-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };

// 'shards-35' in shared/shard-packages.ts PROVIDER_PACKAGE_IDS.tebex.
const PACKAGE_35 = 7651603;
const PLAYER = 'kaito';
const TXN = 'tbx-durable-0001';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let sign: typeof import('./_webhook-core.js').tebexExpectedSignature;
let txnKey: typeof import('./webhook.js').tebexTransactionKey;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ tebexExpectedSignature: sign } = await import('./_webhook-core.js'));
    const mod = await import('./webhook.js');
    handler = mod.default as unknown as Handler;
    txnKey = mod.tebexTransactionKey;
});

beforeEach(async () => {
    for (const level of ['log', 'warn', 'error'] as const) mock.method(console, level, () => {});
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, fateShards: 0 } });
});

afterEach(() => { mock.restoreAll(); });

function payment(transactionId = TXN) {
    return {
        id: `wh-${transactionId}`,
        type: 'payment.completed',
        date: '2026-10-15T00:00:00+00:00',
        subject: {
            transaction_id: transactionId,
            status: { id: 1, description: 'Complete' },
            products: [{ id: PACKAGE_35, name: '35 Fate Shards', quantity: 1, username: { id: PLAYER, username: 'Kaito' } }],
        },
    };
}

async function deliver(payload: unknown): Promise<ResponseOut> {
    const rawBody = JSON.stringify(payload);
    const out: ResponseOut = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        headers: { 'x-signature': sign(rawBody, process.env.TEBEX_WEBHOOK_SECRET!) },
        rawBody: Buffer.from(rawBody, 'utf8'),
        socket: { remoteAddress: '18.209.80.3' },
    } as never, res as never);
    return out;
}

async function shards(): Promise<number> {
    const save = await kv.get<{ character: { fateShards?: number } }>(`save:${PLAYER}`);
    return Number(save?.character.fateShards ?? 0);
}

describe('tebex durable transaction receipt', { concurrency: false }, () => {
    it('a grant writes the durable receipt, and a redelivery pays nothing', async () => {
        const first = await deliver(payment());
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.equal(first.body?.granted, true);
        assert.equal(await shards(), 35);
        const receipt = await kv.get<{ playerName: string; shards: number }>(txnKey(TXN));
        assert.equal(receipt?.playerName, PLAYER);
        assert.equal(receipt?.shards, 35);

        const again = await deliver(payment());
        assert.equal(again.statusCode, 200);
        assert.equal(again.body?.granted, false);
        assert.equal(await shards(), 35);
    });

    it('an old delivery whose id rolled off the 200-entry in-save list still pays nothing', async () => {
        assert.equal((await deliver(payment())).body?.granted, true);
        // 200 newer purchases push the id off the capped in-save list.
        const save = await kv.get<{ _saveVersion: number; character: Record<string, unknown> }>(`save:${PLAYER}`);
        const rolled = Array.from({ length: 200 }, (_, i) => `tbx-newer-${i}`);
        await kv.set(`save:${PLAYER}`, { ...save, character: { ...save!.character, redeemedTebexPurchases: rolled } });

        const replay = await deliver(payment());
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.granted, false, 'the durable receipt refuses the re-sent delivery');
        assert.equal(await shards(), 35);
    });

    it('a crash between the grant and the durable receipt is caught by the in-save receipt and backfilled', async () => {
        assert.equal((await deliver(payment())).body?.granted, true);
        await kv.del(txnKey(TXN)); // the durable write never landed
        const replay = await deliver(payment());
        assert.equal(replay.body?.granted, false);
        assert.equal(await shards(), 35);
        assert.ok(await kv.get(txnKey(TXN)), 'the retry backfills the durable receipt');
    });

    it('a failed durable write does not fail or undo a committed grant', async () => {
        const originalSet = kv.set.bind(kv);
        kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
            if (key.startsWith('tebex:txn:')) throw new Error('storage down');
            return originalSet(key, value, options);
        }) as typeof kv.set;
        try {
            const first = await deliver(payment());
            assert.equal(first.statusCode, 200);
            assert.equal(first.body?.granted, true);
        } finally {
            kv.set = originalSet as typeof kv.set;
        }
        assert.equal(await shards(), 35);
        assert.equal((await deliver(payment())).body?.granted, false, 'the in-save receipt still covers the redelivery');
    });

    it('the key is the plain id, or a hash for anything that is not a plain token', () => {
        assert.equal(txnKey('tbx-abc_1.2'), 'tebex:txn:tbx-abc_1.2');
        assert.match(txnKey('tbx:../x y'), /^tebex:txn:[0-9a-f]{64}$/);
    });
});
