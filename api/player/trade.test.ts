process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'trade-handler-test-secret-32-bytes-long';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * /api/player/trade — F15, driven through the mounted handler.
 *
 * The nonce used to be checked BEFORE the save locks and its NX claim result
 * was ignored, so two attempts of the same nonce could both debit. The claim is
 * now re-checked and honored under both locks, and the nonce carries a payload
 * fingerprint so the same id cannot be reused for a different transfer.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let handler: Handler;
let PET_BREEDING_MIGRATION_VERSION: number;

const SENDER = 'tradesender';
const RECIPIENT = 'traderecipient';
let ipSeed = 0;

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function send(body: Json) {
    const token = issuePlayerToken(SENDER);
    const ip = `10.40.0.${++ipSeed}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { playerName: SENDER, toPlayer: RECIPIENT, currency: 'ryo', amount: 5_000, ...body },
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': SENDER, 'x-player-token': token, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

async function balances() {
    const sender = (await kv.get<Json>(`save:${SENDER}`))?.character as Json;
    const recipient = (await kv.get<Json>(`save:${RECIPIENT}`))?.character as Json;
    return { sender: Number(sender.ryo), recipient: Number(recipient.ryo) };
}

/** The one trade journal record this test wrote. */
async function journal(): Promise<Json> {
    const keys = await kv.keys('economy-tx:player-trade:*');
    assert.equal(keys.length, 1, `one trade journal record: ${JSON.stringify(keys)}`);
    return (await kv.get<Json>(keys[0]!))!;
}

/**
 * The next write of `save:<slug>` commits and then throws, as if its reply was
 * lost on the way back. With `readBackFails`, the read that follows fails too,
 * so the handler cannot tell whether it landed.
 */
async function withLostReply<T>(slug: string, readBackFails: boolean, run: () => Promise<T>): Promise<T> {
    const originalSet = kv.set;
    const originalGet = kv.get;
    let replyLost = false;
    let readBroken = false;
    (kv as { set: unknown }).set = async (key: string, value: unknown, opts?: unknown) => {
        const out = await (originalSet as (k: string, v: unknown, o?: unknown) => Promise<unknown>).call(kv, key, value, opts);
        if (!replyLost && key === `save:${slug}`) { replyLost = true; throw new Error('reply-lost'); }
        return out;
    };
    (kv as { get: unknown }).get = async (key: string) => {
        if (readBackFails && replyLost && !readBroken && key === `save:${slug}`) { readBroken = true; throw new Error('read-back-down'); }
        return (originalGet as (k: string) => Promise<unknown>).call(kv, key);
    };
    try {
        return await run();
    } finally {
        (kv as { set: unknown }).set = originalSet;
        (kv as { get: unknown }).get = originalGet;
        assert.ok(replyLost, 'the lost reply was injected');
    }
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    handler = (await import('./trade.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set(`save:${SENDER}`, { _saveVersion: 1, character: { name: SENDER, level: 20, ryo: 50_000, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION } });
    await kv.set(`save:${RECIPIENT}`, { _saveVersion: 1, character: { name: RECIPIENT, level: 20, ryo: 0, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION } });
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('player trade — exactly-once under a shared nonce', { concurrency: false }, () => {
    it('two concurrent attempts of the same nonce move the money exactly once', async () => {
        const [a, b] = await Promise.all([send({ nonce: 'intent-0001' }), send({ nonce: 'intent-0001' })]);
        const statuses = [a.statusCode, b.statusCode].sort();
        assert.ok(statuses[0] === 200, `one attempt must commit: ${JSON.stringify([a.body, b.body])}`);
        const committed = [a, b].filter((r) => r.statusCode === 200 && r.body?.ok === true && !r.body?.duplicate);
        assert.equal(committed.length, 1, 'exactly one real commit');
        const other = [a, b].find((r) => r !== committed[0])!;
        assert.ok(other.body?.duplicate === true || other.body?.pending === true, `the other attempt replays or reports pending: ${JSON.stringify(other.body)}`);

        const { sender, recipient } = await balances();
        assert.equal(sender, 45_000, 'one debit');
        assert.equal(recipient, 4_500, 'one net credit (10% burned)');
    });

    it('a replay of the committed nonce returns the same receipt without a second debit', async () => {
        const first = await send({ nonce: 'intent-0002' });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        const replay = await send({ nonce: 'intent-0002' });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.duplicate, true);
        assert.equal(replay.body?.debit, first.body?.debit);
        const { sender, recipient } = await balances();
        assert.equal(sender, 45_000);
        assert.equal(recipient, 4_500);
    });

    it('the same nonce with a different payload is refused, not reinterpreted', async () => {
        const first = await send({ nonce: 'intent-0003' });
        assert.equal(first.statusCode, 200);
        const changed = await send({ nonce: 'intent-0003', amount: 20_000 });
        assert.equal(changed.statusCode, 409, JSON.stringify(changed.body));
        assert.equal(changed.body?.nonceConflict, true);
        assert.equal((await balances()).sender, 45_000, 'nothing else moved');
    });

    it('a pre-debit write failure rolls the marker back so the SAME nonce can run for real', async () => {
        const originalSet = kv.set;
        let failOnce = true;
        (kv as { set: unknown }).set = async (key: string, value: unknown, opts?: unknown) => {
            if (failOnce && key === `save:${SENDER}`) { failOnce = false; throw new Error('debit-write-down'); }
            return (originalSet as (k: string, v: unknown, o?: unknown) => Promise<unknown>).call(kv, key, value, opts);
        };
        let failed;
        try {
            failed = await send({ nonce: 'intent-0004' });
        } finally {
            (kv as { set: unknown }).set = originalSet;
        }
        assert.equal(failed.statusCode, 502, JSON.stringify(failed.body));
        assert.deepEqual(await balances(), { sender: 50_000, recipient: 0 }, 'nothing moved');

        const retry = await send({ nonce: 'intent-0004' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 });
    });

    it('a debit that committed but lost its reply finishes the transfer instead of debiting again', async () => {
        // The old catch assumed a thrown debit wrote nothing: it deleted the
        // pending marker, so the client's retry of the same nonce ran again and
        // took the money a second time.
        const first = await withLostReply(SENDER, false, () => send({ nonce: 'intent-0005' }));
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 });
        assert.equal((await journal()).state, 'complete');

        const retry = await send({ nonce: 'intent-0005' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.duplicate, true, 'the retry replays the committed transfer');
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 }, 'never debited twice');
    });

    it('a debit whose outcome cannot be read back keeps the pending marker, so no retry debits twice', async () => {
        const first = await withLostReply(SENDER, true, () => send({ nonce: 'intent-0006' }));
        assert.equal(first.statusCode, 502, JSON.stringify(first.body));
        assert.match(String(first.body?.error), /do not resend/i);
        assert.equal((await journal()).state, 'needs-reconcile', 'the unconfirmed debit is on the reconcile trail');
        assert.equal((await balances()).sender, 45_000, 'the debit did land');

        const retry = await send({ nonce: 'intent-0006' });
        assert.equal(retry.statusCode, 409, JSON.stringify(retry.body));
        assert.equal(retry.body?.pending, true);
        assert.equal((await balances()).sender, 45_000, 'never debited twice');
    });

    it('a credit that committed but lost its reply completes the transfer rather than flagging it', async () => {
        // Journalled as a failed credit, a landed one invites a second credit
        // when someone reconciles it by hand.
        const first = await withLostReply(RECIPIENT, false, () => send({ nonce: 'intent-0007' }));
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 });
        assert.equal((await journal()).state, 'complete');
    });

    it('F15: a request without a nonce is refused with a reload hint and moves nothing', async () => {
        const out = await send({});
        assert.equal(out.statusCode, 400, JSON.stringify(out.body));
        assert.equal(out.body?.reason, 'nonce-required');
        assert.deepEqual(await balances(), { sender: 50_000, recipient: 0 });
        assert.deepEqual(await kv.keys('trade:nonce:*'), [], 'no replay identity was minted for it either');
    });

    it('F15: the legacy kill switch re-admits a nonce-less body (no replay identity)', async () => {
        process.env.ALLOW_NONCELESS_TRANSFERS = '1';
        try {
            const out = await send({});
            assert.equal(out.statusCode, 200, JSON.stringify(out.body));
            assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 });
        } finally {
            delete process.env.ALLOW_NONCELESS_TRANSFERS;
        }
    });
});
