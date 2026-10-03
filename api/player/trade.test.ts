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
let resetRateLimits: typeof import('../_ratelimit.js').__resetRateLimitsForTest;
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
 * The next compare-and-set of `save:<slug>` commits and then throws, as if its
 * reply was lost on the way back. With `readBackFails`, the read that follows
 * fails too, so the shared writer cannot tell whether it landed.
 */
async function withLostReply<T>(slug: string, readBackFails: boolean, run: () => Promise<T>): Promise<T> {
    const originalCompareSet = kv.compareSet;
    const originalGet = kv.get;
    let replyLost = false;
    let readBroken = false;
    kv.compareSet = async (key, expected, value, options) => {
        const out = await originalCompareSet.call(kv, key, expected, value, options);
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
        kv.compareSet = originalCompareSet;
        (kv as { get: unknown }).get = originalGet;
        assert.ok(replyLost, 'the lost reply was injected');
    }
}

/** Answer every compare-and-set of `save:<slug>` with `write` while `run` executes. */
async function withSaveWrite<T>(
    slug: string,
    write: (original: () => Promise<boolean>) => Promise<boolean>,
    run: () => Promise<T>,
): Promise<T> {
    const originalCompareSet = kv.compareSet;
    kv.compareSet = (key, expected, value, options) => key === `save:${slug}`
        ? write(() => originalCompareSet.call(kv, key, expected, value, options))
        : originalCompareSet.call(kv, key, expected, value, options);
    try {
        return await run();
    } finally {
        kv.compareSet = originalCompareSet;
    }
}

/** Every trade journal record this test wrote. */
async function journals(): Promise<Json[]> {
    return (await Promise.all((await kv.keys('economy-tx:player-trade:*')).map((key) => kv.get<Json>(key)))) as Json[];
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    handler = (await import('./trade.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    // The 20-a-minute trade limit keeps an in-process burst window too.
    resetRateLimits();
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
        let failOnce = true;
        const failed = await withSaveWrite(SENDER, async (write) => {
            if (!failOnce) return write();
            failOnce = false;
            throw new Error('debit-write-down');
        }, () => send({ nonce: 'intent-0004' }));
        assert.equal(failed.statusCode, 502, JSON.stringify(failed.body));
        assert.match(String(failed.body?.error), /Nothing was sent/);
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

    it('both players keep the recovery earned since their last save', async () => {
        // The raw writes fenced each regeneration cursor and erased every point
        // of HP, chakra and stamina recovered since that player's last save.
        const at = Date.now() - 30_000;
        for (const [name, ryo] of [[SENDER, 50_000], [RECIPIENT, 0]] as const) {
            await kv.set(`save:${name}`, {
                _saveVersion: 1, _saveAt: at, _regenAt: at,
                character: {
                    name, level: 20, ryo, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
                    hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100,
                },
            });
        }
        const out = await send({ nonce: 'intent-0008' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 });
        for (const name of [SENDER, RECIPIENT]) {
            const character = (await kv.get<Json>(`save:${name}`))?.character as Json;
            assert.ok(Number(character.hp) >= 40, `${name}: hp ${character.hp} lost the idle recovery`);
            assert.ok(Number(character.chakra) >= 50, `${name}: chakra ${character.chakra} lost the idle recovery`);
            assert.ok(Number(character.stamina) >= 30, `${name}: stamina ${character.stamina} lost the idle recovery`);
        }
    });

    it("returns the sender's committed version so the open tab can adopt it", async () => {
        const out = await send({ nonce: 'intent-0009' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const stored = Number((await kv.get<Json>(`save:${SENDER}`))?._saveVersion);
        assert.equal(stored, 2, 'the debit bumped the sender once');
        assert.equal(out.body?._saveVersion, stored, 'the reply carries the version that landed');
        assert.equal(out.body?.senderBalance, 45_000);
    });

    it('a debit that loses its compare-and-set once runs again and moves the money once', async () => {
        let lose = true;
        const out = await withSaveWrite(SENDER, async (write) => {
            if (!lose) return write();
            lose = false;
            return false;
        }, () => send({ nonce: 'intent-0010' }));
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 });
        const records = await journals();
        assert.equal(records.length, 2, 'one journal record per attempt');
        const lost = records.find((record) => record.state === 'needs-reconcile');
        assert.match(String(lost?.note), /no funds moved/, 'the losing attempt is journalled as moving nothing');
        assert.ok(records.some((record) => record.state === 'complete'), 'the second attempt completed');
    });

    it('a debit that keeps losing its compare-and-set moves nothing and frees the nonce', async () => {
        const out = await withSaveWrite(SENDER, async () => false, () => send({ nonce: 'intent-0011' }));
        assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        assert.equal(out.body?.errorCode, 'save-version-conflict');
        assert.notEqual(out.body?.pending, true, 'not the "still settling" answer: nothing is settling');
        assert.deepEqual(await balances(), { sender: 50_000, recipient: 0 });
        assert.equal(await kv.get(`trade:nonce:${SENDER}:intent-0011`), null, 'the nonce is free again');

        const retry = await send({ nonce: 'intent-0011' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 });
    });

    it('a credit that fails after the debit keeps the pending marker and flags the journal', async () => {
        const failed = await withSaveWrite(RECIPIENT, async () => false, () => send({ nonce: 'intent-0012' }));
        assert.equal(failed.statusCode, 502, JSON.stringify(failed.body));
        assert.match(String(failed.body?.error), /interrupted after the debit.*do not resend/i);
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 0 }, 'loss-direction, never a mint');
        const record = await journal();
        assert.equal(record.state, 'needs-reconcile');
        assert.match(String(record.note), /debited 5000 ryo; recipient credit failed/);
        assert.equal(failed.body?.txId, record.id);

        const retry = await send({ nonce: 'intent-0012' });
        assert.equal(retry.statusCode, 409, JSON.stringify(retry.body));
        assert.equal(retry.body?.pending, true);
        assert.equal((await balances()).sender, 45_000, 'never debited twice');
    });

    it("a sender whose save is gone is told so, and nothing moves", async () => {
        await kv.del(`save:${SENDER}`);
        const out = await send({ nonce: 'intent-0013' });
        assert.equal(out.statusCode, 404, JSON.stringify(out.body));
        assert.equal(out.body?.error, 'Your save was not found.');
        assert.equal(Number(((await kv.get<Json>(`save:${RECIPIENT}`))?.character as Json).ryo), 0);
    });

    it('a duplicate found under the locks records the burn and the audit row only once', async () => {
        // The pre-lock check can miss a receipt that the locked re-check then
        // finds. That reply is a 200 too, and used to rewrite the receipt and
        // log the audit row and the 10% burn a second time, so the economy
        // ledger counted one transfer's burn twice.
        const first = await send({ nonce: 'intent-0014' });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        const nonceKey = `trade:nonce:${SENDER}:intent-0014`;
        const originalGet = kv.get;
        let fastPathMissed = false;
        (kv as { get: unknown }).get = async (key: string) => {
            if (key === nonceKey && !fastPathMissed) { fastPathMissed = true; return null; }
            return (originalGet as (k: string) => Promise<unknown>).call(kv, key);
        };
        let replay;
        try {
            replay = await send({ nonce: 'intent-0014' });
        } finally {
            (kv as { get: unknown }).get = originalGet;
        }
        assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
        assert.equal(replay.body?.duplicate, true, 'the locked re-check found the receipt');
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 });
        const burns = ((await kv.get<Json[]>('econ:txns')) ?? []).filter((txn) => txn.source === 'trade.burn');
        assert.equal(burns.length, 1, 'one transfer, one burn');
        assert.equal((await kv.keys('audit:player-trade:*')).length, 1, 'one transfer, one audit row');
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
