import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'warfront-forfeit-handler-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };
let handler: Handler;
let startHandler: Handler;
let resultHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

const playerName = 'forfeit-tester';
const saveKey = `save:${playerName}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./warfront-forfeit.js')).default as unknown as Handler;
    startHandler = (await import('./warfront-start.js')).default as unknown as Handler;
    resultHandler = (await import('./battle-result.js')).default as unknown as Handler;
    ({ issuePlayerToken } = await import('../_auth.js'));
});

beforeEach(async () => {
    for (const pattern of [
        `pet:battle-token:${playerName}:*`,
        `pet:warfront-active:${playerName}`,
        `pet:warfront-council:${playerName}:*`,
        `pet:warfront-prepared:${playerName}`,
    ]) {
        for (const key of await kv.keys(pattern)) await kv.del(key);
    }
    await kv.set(saveKey, {
        _saveVersion: 4,
        character: {
            name: playerName,
            ryo: 750,
            totalPetWins: 9,
            dailyPetWins: 2,
            lastDailyReset: new Date().toISOString().slice(0, 10),
            redeemedPetBattleTokens: [],
            warfrontSettlementReceipts: [],
        },
    });
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200 };
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
    await handler({
        method: 'POST',
        body,
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res);
    return out;
}

async function prepare(): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    await startHandler({
        method: 'POST',
        body: { playerName, action: 'prepare' },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res);
    return out;
}

async function mint(token: string, reportKey: string, mode = 'warfront', notBefore = Date.now() + 60_000) {
    await kv.set(`pet:battle-token:${playerName}:${token}`, { playerName, reportKey, mode, notBefore });
    await kv.set(`pet:warfront-active:${playerName}`, token);
}

describe('Warfront immediate forfeit settlement', { concurrency: false }, () => {
    it('commits a durable zero-value loss before replacing the token lease with a reroll cooldown', async () => {
        const token = 'forfeitToken000000000001';
        const reportKey = '101:tactical';
        await mint(token, reportKey);

        const first = await post({ playerName, battleToken: token, reportKey });
        assert.equal(first.statusCode, 200);
        assert.equal(first.body?.outcome, 'loss');
        assert.equal(first.body?.forfeited, true);
        assert.equal(first.body?.reward, 0);
        assert.equal(first.body?.reason, 'warfront-forfeit');
        assert.equal(first.body?.idempotentReplay, false);
        assert.equal((first.body?.coachMastery as { earned?: number })?.earned, 0);
        assert.equal(await kv.get(`pet:battle-token:${playerName}:${token}`), null);
        assert.match(String(await kv.get(`pet:warfront-active:${playerName}`)), /^forfeit-cooldown:/);
        assert.ok(Number(first.body?.retryAfterSeconds) > 0);

        const blockedPrepare = await prepare();
        assert.equal(blockedPrepare.statusCode, 409);
        assert.equal(blockedPrepare.body?.code, 'warfront-forfeit-cooldown');
        assert.ok(Number(blockedPrepare.body?.retryAfterSeconds) > 0);
        assert.equal(await kv.get(`pet:warfront-prepared:${playerName}`), null,
            'forfeit cooldown must block a fresh searchable seed before it is minted');

        const saved = await kv.get<{ character?: Record<string, unknown> }>(saveKey);
        assert.equal(saved?.character?.ryo, 750);
        assert.equal(saved?.character?.totalPetWins, 9);
        assert.equal(saved?.character?.dailyPetWins, 2);
        const receipts = saved?.character?.warfrontSettlementReceipts as Array<Record<string, unknown>>;
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0].battleToken, token);
        assert.equal(receipts[0].forfeited, true);

        const replay = await post({ playerName, battleToken: token, reportKey });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.forfeited, true);
        assert.equal(replay.body?.idempotentReplay, true);
        assert.equal(((await kv.get<{ character?: { warfrontSettlementReceipts?: unknown[] } }>(saveKey))?.character?.warfrontSettlementReceipts ?? []).length, 1);
    });

    it('binds the forfeit to the exact report and never consumes another mode token', async () => {
        const token = 'forfeitToken000000000002';
        await mint(token, '202:tactical');
        const mismatch = await post({ playerName, battleToken: token, reportKey: 'forged:tactical' });
        assert.equal(mismatch.statusCode, 403);
        assert.ok(await kv.get(`pet:battle-token:${playerName}:${token}`));
        assert.equal(await kv.get(`pet:warfront-active:${playerName}`), token);

        const other = 'forfeitToken000000000003';
        await kv.set(`pet:battle-token:${playerName}:${other}`, { playerName, reportKey: '303:tactical', mode: 'arena' });
        const wrongMode = await post({ playerName, battleToken: other, reportKey: '303:tactical' });
        assert.equal(wrongMode.statusCode, 403);
        assert.ok(await kv.get(`pet:battle-token:${playerName}:${other}`));
    });

    it('returns an explicit safe exit after the held Council token and lease have expired', async () => {
        const token = 'expiredCouncilToken0000006';
        const reportKey = '606:tactical';

        // Model a Council held beyond both one-hour TTLs: neither the
        // redeemable token nor its active lease remains.
        const expired = await post({ playerName, battleToken: token, reportKey });
        assert.equal(expired.statusCode, 200);
        assert.deepEqual(expired.body, {
            ok: true,
            outcome: 'loss',
            reward: 0,
            forfeited: true,
            safeToExit: true,
            expiredAuthorization: true,
            settlementReceipt: null,
            reason: 'warfront-authorization-expired',
            idempotentReplay: true,
        });
        const saved = await kv.get<{ character?: { warfrontSettlementReceipts?: unknown[] } }>(saveKey);
        assert.equal(saved?.character?.warfrontSettlementReceipts?.length, 0,
            'an expired authorization is an exit acknowledgement, not a fabricated settlement');
    });

    it('clears only the exact stale active lease for an expired Council token', async () => {
        const token = 'expiredCouncilToken0000007';
        const reportKey = '707:tactical';
        await kv.set(`pet:warfront-active:${playerName}`, token);

        const expired = await post({ playerName, battleToken: token, reportKey });
        assert.equal(expired.statusCode, 200);
        assert.equal(expired.body?.safeToExit, true);
        assert.equal(await kv.get(`pet:warfront-active:${playerName}`), null);
    });

    it('fails closed when an expired Council request encounters a different active lease', async () => {
        const token = 'expiredCouncilToken0000008';
        const reportKey = '808:tactical';
        const newerLease = 'newerWarfrontToken00000009';
        await kv.set(`pet:warfront-active:${playerName}`, newerLease);

        const conflict = await post({ playerName, battleToken: token, reportKey });
        assert.equal(conflict.statusCode, 409);
        assert.equal(conflict.body?.code, 'warfront-active-authorization-mismatch');
        assert.equal(conflict.body?.safeToExit, false);
        assert.equal(await kv.get(`pet:warfront-active:${playerName}`), newerLease,
            'an expired request must never clear a newer match lease');
    });

    it('serializes concurrent exits into one receipt and one first response', async () => {
        const token = 'forfeitToken000000000004';
        const reportKey = '404:tactical';
        await mint(token, reportKey);
        const results = await Promise.all(Array.from({ length: 6 }, () => post({ playerName, battleToken: token, reportKey })));
        assert.ok(results.every((result) => result.statusCode === 200));
        assert.equal(results.filter((result) => result.body?.idempotentReplay === false).length, 1);
        const saved = await kv.get<{ character?: { warfrontSettlementReceipts?: Array<Record<string, unknown>> } }>(saveKey);
        assert.equal(saved?.character?.warfrontSettlementReceipts?.length, 1);
        assert.equal(saved?.character?.warfrontSettlementReceipts?.[0]?.reward, 0);
    });

    it('result recovery cannot clear the forfeit cooldown before the forfeit response swaps the marker', async () => {
        const token = 'forfeitRaceToken00000005';
        const reportKey = '505:tactical';
        const settledAt = Date.now();
        const leaseHeldUntil = settledAt + 60_000;

        // Model the adversarial interleaving precisely: forfeit has committed
        // its receipt and deleted the redeemable token, but has not yet changed
        // the active token into a cooldown marker. Result recovery arrives now.
        const save = await kv.get<{ _saveVersion?: number; character?: Record<string, unknown> }>(saveKey);
        assert.ok(save?.character);
        await kv.set(saveKey, {
            ...save,
            character: {
                ...save.character,
                redeemedPetBattleTokens: [token],
                warfrontSettlementReceipts: [{
                    battleToken: token,
                    reportKey,
                    outcome: 'loss',
                    reward: 0,
                    firstWinOfDay: false,
                    firstWinBonus: 0,
                    capped: false,
                    rewardEligible: false,
                    forfeited: true,
                    leaseHeldUntil,
                    totalPetWins: 9,
                    dailyPetWins: 2,
                    settledAt,
                }],
            },
        });
        await kv.set(`pet:warfront-active:${playerName}`, token);
        await kv.del(`pet:battle-token:${playerName}:${token}`);

        process.env.SESSION_SECRET = 'warfront-forfeit-race-session-secret';
        try {
            const playerToken = issuePlayerToken(playerName);
            assert.ok(playerToken);
            const { res, out } = fakeRes();
            await resultHandler({
                method: 'POST',
                body: { playerName, battleToken: token, reportKey, outcome: 'win' },
                headers: { 'x-player-token': playerToken },
                socket: { remoteAddress: '127.0.0.1' },
            } as never, res);
            assert.equal(out.statusCode, 200);
            assert.equal(out.body?.forfeited, true);
            assert.equal(out.body?.outcome, 'loss');
            assert.equal(out.body?.rerollLockedUntil, leaseHeldUntil);
            assert.ok(Number(out.body?.retryAfterSeconds) > 0);
        } finally {
            delete process.env.SESSION_SECRET;
        }

        assert.match(String(await kv.get(`pet:warfront-active:${playerName}`)),
            new RegExp(`^forfeit-cooldown:${reportKey}:`));
        const blockedPrepare = await prepare();
        assert.equal(blockedPrepare.statusCode, 409);
        assert.equal(blockedPrepare.body?.code, 'warfront-forfeit-cooldown');
        assert.equal(await kv.get(`pet:warfront-prepared:${playerName}`), null);
    });

    it('shares the report-key first-committer rule with normal result settlement', () => {
        const forfeitSource = readFileSync(join(process.cwd(), 'api', 'pet', 'warfront-forfeit.ts'), 'utf8');
        const resultSource = readFileSync(join(process.cwd(), 'api', 'pet', 'battle-result.ts'), 'utf8');
        const forfeitLock = forfeitSource.indexOf('withKvLock(saveKey');
        const forfeitDedupe = forfeitSource.indexOf('findWarfrontSettlementReceiptByReportKey(character, reportKey)', forfeitLock);
        const forfeitWrite = forfeitSource.indexOf('writeSaveProjected(saveKey, updated, record)', forfeitDedupe);
        const normalLock = resultSource.indexOf('withKvLock(saveKey');
        const normalDedupe = resultSource.indexOf('findWarfrontSettlementReceiptByReportKey(char, reportKey)', normalLock);
        const normalWrite = resultSource.lastIndexOf('writeSaveProjected(saveKey, updated, record)');
        assert.ok(forfeitLock >= 0 && forfeitDedupe > forfeitLock && forfeitWrite > forfeitDedupe);
        assert.ok(normalLock >= 0 && normalDedupe > normalLock && normalWrite > normalDedupe);
    });
});
