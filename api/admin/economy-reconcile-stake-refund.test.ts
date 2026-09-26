import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'economy-reconcile-stake-refund-admin';

/*
 * /api/admin/economy-reconcile for a stake whose handler could not open what
 * it paid for and whose own automatic refund failed too. The branch required
 * Honor Seals, so the Kage declaration's ryo stake (the only producer of its
 * kind) always answered "cannot be reconciled", and a refund that landed but
 * reported an error was paid again on the next click.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = 'stakedplayer';
const SAVE_KEY = `save:${PLAYER}`;

let kv: typeof import('../_storage.js').kv;
let reconcile: Handler;
let economyTx: typeof import('../_economy-tx.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    economyTx = await import('../_economy-tx.js');
    reconcile = (await import('./economy-reconcile.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: PLAYER, ryo: 1_000, honorSeals: 50 } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

async function stuckStake(kind: string, resource: string, amount: number): Promise<string> {
    const id = economyTx.makeEconomyTxId(kind);
    await economyTx.reserveEconomyTx({ id, kind, debitKey: SAVE_KEY, creditKey: 'village:kage:somewhere', resource, amount, meta: { playerName: PLAYER } });
    await economyTx.markEconomyTx(id, 'debit-applied');
    await economyTx.failEconomyTx(id, new Error('the state write and the automatic refund both failed'));
    return id;
}

async function post(body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.statusCode = code; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await reconcile({
        method: 'POST',
        body,
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.4' },
    } as never, res as never);
    return out;
}

async function wallet(): Promise<{ ryo: number; honorSeals: number }> {
    const character = (await kv.get<{ character: { ryo: number; honorSeals: number } }>(SAVE_KEY))!.character;
    return { ryo: character.ryo, honorSeals: character.honorSeals };
}

describe('admin reconciliation of failed stake refunds', { concurrency: false }, () => {
    test("a Kage declaration's ryo stake is refunded, and the journal completes", async () => {
        const txId = await stuckStake('kage-challenge-declare', 'ryo', 250_000);
        const first = await post({ txId });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.deepEqual(await wallet(), { ryo: 251_000, honorSeals: 50 });
        assert.equal((await kv.get<{ state: string }>(economyTx.economyTxKey(txId)))?.state, 'complete');

        const again = await post({ txId });
        assert.equal(again.statusCode, 200);
        assert.deepEqual(await wallet(), { ryo: 251_000, honorSeals: 50 }, 'a completed journal pays nothing again');
    });

    test('a refund that landed but reported an error is not paid again by the next click', async () => {
        const txId = await stuckStake('hollow-gate-unlock', 'honorSeals', 10_000);
        const originalSet = kv.set.bind(kv);
        let armed = true;
        kv.set = (async (key: string, value: unknown, options?: unknown) => {
            const out = await originalSet(key, value, options as never);
            if (armed && key === SAVE_KEY) {
                armed = false;
                throw new Error('injected: the refund committed but its reply was lost');
            }
            return out;
        }) as typeof kv.set;
        try {
            assert.equal((await post({ txId })).statusCode, 500);
        } finally {
            kv.set = originalSet;
        }
        assert.deepEqual(await wallet(), { ryo: 1_000, honorSeals: 10_050 }, 'the refund landed');

        const retry = await post({ txId });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.alreadyRefunded, true);
        assert.deepEqual(await wallet(), { ryo: 1_000, honorSeals: 10_050 }, 'before the fix this paid 10,000 Honor Seals twice');
    });

    test('a stake journal for the wrong currency is still refused', async () => {
        const txId = await stuckStake('kage-challenge-declare', 'honorSeals', 250_000);
        const refused = await post({ txId });
        assert.equal(refused.statusCode, 400);
        assert.deepEqual(await wallet(), { ryo: 1_000, honorSeals: 50 });
    });
});
