import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    bountySagaStampMatches,
    bountyTargetVersion,
    parseBountySagaCompletion,
    parseBountySagaJournal,
} from './_bounty-saga.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'bounty-saga-handler-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const BOUNTY_KEY = 'pvp:bounties';
const GATE_KEY = 'pvp:bounty-board-authority';
let handler: Handler;
let kv: typeof import('../_storage.js').kv;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./bounty.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of ['pvp:bounty*', 'audit:pvp-bounty:*', 'save:bountytest*', 'pvp:bountytest*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function post(body: Record<string, unknown>): Promise<Out> {
    const { res, out } = response();
    await handler({
        method: 'POST',
        body,
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res);
    return out;
}

async function seedPlayer(name: string, ryo: number) {
    await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, ryo } });
}

async function seedBounty(target: string, amount: number, updatedAt = Date.now()) {
    await kv.set(BOUNTY_KEY, {
        bounties: [{ target, amount, contributors: ['backer-a', 'backer-b'], updatedAt }],
    });
}

async function seedBattle(battleId: string, winner: string, loser: string) {
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: winner },
        p2: { name: loser },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'world',
        joined: { p1: true, p2: true },
        baseRewards: true,
        createdAt: Date.now(),
    });
}

async function wallet(name: string) {
    const record = await kv.get<Record<string, unknown>>(`save:${name}`);
    const character = record?.character as Record<string, unknown> | undefined;
    return {
        ryo: Number(character?.ryo),
        saveVersion: Number(record?._saveVersion),
        stamp: character?.bountySagaStamp as Record<string, unknown> | undefined,
    };
}

async function boardAmount(target: string): Promise<number> {
    const board = await kv.get<{ bounties?: Array<{ target?: string; amount?: number }> }>(BOUNTY_KEY);
    return Number(board?.bounties?.find((entry) => entry.target?.toLowerCase() === target.toLowerCase())?.amount ?? 0);
}

async function withSetFault(
    match: (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => boolean,
    mode: 'commit-then-throw' | 'throw-before-commit',
    run: () => Promise<Out>,
): Promise<Out> {
    const originalSet = kv.set.bind(kv);
    let fault = true;
    kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (fault && match(key, value, options)) {
            fault = false;
            if (mode === 'commit-then-throw') await originalSet(key, value, options);
            throw new Error(`injected ${mode} for ${key}`);
        }
        return originalSet(key, value, options);
    }) as typeof kv.set;
    try {
        return await run();
    } finally {
        kv.set = originalSet as typeof kv.set;
    }
}

async function withCompareSetFault(
    match: (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => boolean,
    mode: 'commit-then-throw' | 'throw-before-commit',
    run: () => Promise<Out>,
): Promise<Out> {
    const originalCompareSet = kv.compareSet.bind(kv);
    let fault = true;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (fault && match(key, expected, value, options)) {
            fault = false;
            if (mode === 'commit-then-throw') await originalCompareSet(key, expected, value, options);
            throw new Error(`injected CAS ${mode} for ${key}`);
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;
    try {
        return await run();
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
}

function stampedKind(value: unknown, kind: 'place' | 'claim'): boolean {
    const record = value as { character?: { bountySagaStamp?: { kind?: string } } };
    return record?.character?.bountySagaStamp?.kind === kind;
}

describe('bounty target authority fingerprint', () => {
    it('includes target, amount, updatedAt, and an order-independent contributor digest', () => {
        const a = bountyTargetVersion({ bounties: [{ target: 'Ken Ji', amount: 5000, updatedAt: 42, contributors: ['B', 'a'] }] }, 'kenji');
        const b = bountyTargetVersion({ bounties: [{ target: 'kenji', amount: 5000, updatedAt: 42, contributors: ['a', 'b', 'A'] }] }, 'Ken Ji');
        assert.deepEqual(a, b);
        assert.deepEqual(Object.keys(a), ['target', 'amount', 'updatedAt', 'contributorsDigest']);
        assert.match(a.contributorsDigest, /^[a-f0-9]{64}$/);
        assert.notEqual(
            a.contributorsDigest,
            bountyTargetVersion({ bounties: [{ target: 'Kenji', amount: 5000, updatedAt: 42, contributors: ['a'] }] }, 'kenji').contributorsDigest,
        );
    });

    it('rejects malformed journals, completions, transitions, and embedded stamps fail-closed', async () => {
        const actor = 'bountytestparseractor';
        const target = 'bountytestparserhead';
        await seedPlayer(actor, 10_000);
        await seedPlayer(target, 0);
        assert.equal((await post({
            action: 'place', playerName: actor, target, amount: 2_000, requestId: 'place-parser-contract-01',
        })).statusCode, 200);

        const journalKey = (await kv.keys('pvp:bounty-saga:*'))[0];
        const completionKey = (await kv.keys('pvp:bounty-completed:*'))[0];
        const journalRaw = await kv.get<string>(journalKey!);
        const completionRaw = await kv.get<string>(completionKey!);
        const journal = parseBountySagaJournal(journalRaw);
        assert.ok(journal, 'server-written journal passes the strict parser');
        assert.ok(parseBountySagaCompletion(completionRaw), 'server-written completion passes the strict parser');
        assert.equal(bountySagaStampMatches((await wallet(actor)).stamp, journal), true);

        const parsedJournal = JSON.parse(journalRaw!) as Record<string, unknown>;
        assert.equal(parseBountySagaJournal(JSON.stringify({ ...parsedJournal, unowned: true })), null);
        assert.equal(parseBountySagaJournal(JSON.stringify({ ...parsedJournal, sagaFingerprint: '0'.repeat(64) })), null);
        assert.equal(parseBountySagaJournal(JSON.stringify({
            ...parsedJournal,
            after: { ...(parsedJournal.after as Record<string, unknown>), amount: 9_999_999 },
        })), null);
        assert.equal(parseBountySagaJournal(JSON.stringify({
            ...parsedJournal,
            stamp: { ...(parsedJournal.stamp as Record<string, unknown>), amount: 2_001 },
        })), null);

        const parsedCompletion = JSON.parse(completionRaw!) as Record<string, unknown>;
        assert.equal(parseBountySagaCompletion(JSON.stringify({ ...parsedCompletion, amount: -1 })), null);
        assert.equal(parseBountySagaCompletion(JSON.stringify({ ...parsedCompletion, extra: true })), null);
        assert.equal(bountySagaStampMatches({ ...(await wallet(actor)).stamp, extra: true }, journal), false);
    });
});

describe('PLACE crash recovery', { concurrency: false }, () => {
    it('fails old clients closed with an explicit refresh-required contract', async () => {
        const actor = 'bountytestplacelegacy';
        const target = 'bountytesttargetlegacy';
        await seedPlayer(actor, 10_000);
        await seedPlayer(target, 0);
        const result = await post({ action: 'place', playerName: actor, target, amount: 2_000 });
        assert.equal(result.statusCode, 409);
        assert.equal(result.body?.code, 'CLIENT_REFRESH_REQUIRED');
        assert.equal((await wallet(actor)).ryo, 10_000);
        assert.equal(await boardAmount(target), 0);
    });

    it('binds one requestId to one immutable set of economic parameters', async () => {
        const actor = 'bountytestplaceconflict';
        const target = 'bountytesttargetconflict';
        await seedPlayer(actor, 10_000);
        await seedPlayer(target, 0);
        const requestId = 'place-parameter-bind-01';
        assert.equal((await post({ action: 'place', playerName: actor, target, amount: 2_000, requestId })).statusCode, 200);
        const conflict = await post({ action: 'place', playerName: actor, target, amount: 3_000, requestId });
        assert.equal(conflict.statusCode, 409);
        assert.equal((await wallet(actor)).ryo, 8_000);
        assert.equal(await boardAmount(target), 2_000);
    });

    it('recovers a committed debit whose save acknowledgement is lost', async () => {
        const actor = 'bountytestplaceack';
        const target = 'bountytesttargetack';
        await seedPlayer(actor, 10_000);
        await seedPlayer(target, 0);
        const result = await withCompareSetFault(
            (key, _expected, value) => key === `save:${actor}` && stampedKind(value, 'place'),
            'commit-then-throw',
            () => post({ action: 'place', playerName: actor, target, amount: 2_000, requestId: 'place-save-ack-01' }),
        );
        assert.equal(result.statusCode, 200);
        assert.deepEqual(await wallet(actor), {
            ryo: 8_000,
            saveVersion: 2,
            stamp: (await wallet(actor)).stamp,
        });
        assert.equal((await wallet(actor)).stamp?.kind, 'place');
        assert.equal(await boardAmount(target), 2_000);
        assert.equal(await kv.get(GATE_KEY), null);
        assert.equal(await kv.get(`pvp:bounty-active:${target}`), null);

        const replay = await post({ action: 'place', playerName: actor, target, amount: 2_000, requestId: 'place-save-ack-01' });
        assert.equal(replay.statusCode, 200);
        assert.equal((await wallet(actor)).ryo, 8_000);
        assert.equal(await boardAmount(target), 2_000);
    });

    it('recovers a committed board write whose acknowledgement is lost', async () => {
        const actor = 'bountytestplaceboardack';
        const target = 'bountytesttargetboardack';
        await seedPlayer(actor, 10_000);
        await seedPlayer(target, 0);
        const result = await withCompareSetFault(
            (key) => key === BOUNTY_KEY,
            'commit-then-throw',
            () => post({ action: 'place', playerName: actor, target, amount: 3_000, requestId: 'place-board-ack-01' }),
        );
        assert.equal(result.statusCode, 200);
        assert.equal((await wallet(actor)).ryo, 7_000);
        assert.equal(await boardAmount(target), 3_000);
        assert.equal(await kv.get(GATE_KEY), null);
    });

    it('resumes a definite precommit debit failure against the current wallet and settles once', async () => {
        const actor = 'bountytestplacereject';
        const target = 'bountytesttargetreject';
        await seedPlayer(actor, 10_000);
        await seedPlayer(target, 0);
        const body = { action: 'place', playerName: actor, target, amount: 2_500, requestId: 'place-save-reject-01' };
        const failed = await withCompareSetFault(
            (key, _expected, value) => key === `save:${actor}` && stampedKind(value, 'place'),
            'throw-before-commit',
            () => post(body),
        );
        assert.equal(failed.statusCode, 500);
        assert.equal((await wallet(actor)).ryo, 10_000);
        assert.equal(await boardAmount(target), 0);
        assert.ok(await kv.get(GATE_KEY), 'uncertain journal remains fail-closed until the retry proves no stamp');

        await kv.set(`save:${actor}`, { _saveVersion: 2, character: { name: actor, ryo: 9_000 } });

        const retry = await post(body);
        assert.equal(retry.statusCode, 200);
        assert.equal((await wallet(actor)).ryo, 6_500, 'recovery debits the current wallet, not its stale prepared snapshot');
        assert.equal(await boardAmount(target), 2_500);
        assert.equal((await post(body)).statusCode, 200);
        assert.equal((await wallet(actor)).ryo, 6_500);
    });

    it('finishes a definite board failure from the atomic debit stamp without refunding or debiting twice', async () => {
        const actor = 'bountytestplaceboardreject';
        const target = 'bountytesttargetboardreject';
        await seedPlayer(actor, 10_000);
        await seedPlayer(target, 0);
        const body = { action: 'place', playerName: actor, target, amount: 4_000, requestId: 'place-board-reject-01' };
        const failed = await withCompareSetFault(
            (key) => key === BOUNTY_KEY,
            'throw-before-commit',
            () => post(body),
        );
        assert.equal(failed.statusCode, 500);
        assert.equal((await wallet(actor)).ryo, 6_000, 'debit and recovery stamp committed together');
        assert.equal(await boardAmount(target), 0);
        assert.ok(await kv.get(`pvp:bounty-active:${target}`));

        const retry = await post(body);
        assert.equal(retry.statusCode, 200);
        assert.equal((await wallet(actor)).ryo, 6_000);
        assert.equal(await boardAmount(target), 4_000);
        assert.equal(await kv.get(`pvp:bounty-active:${target}`), null);
    });

    it('recovers target-authority acknowledgement loss and a definite completion-write failure', async () => {
        const actorA = 'bountytesttargetauthority';
        const targetA = 'bountytesttargetauthorityhead';
        await seedPlayer(actorA, 10_000);
        await seedPlayer(targetA, 0);
        const authorityAck = await withSetFault(
            (key) => key === `pvp:bounty-active:${targetA}`,
            'commit-then-throw',
            () => post({ action: 'place', playerName: actorA, target: targetA, amount: 2_000, requestId: 'place-target-authority-01' }),
        );
        assert.equal(authorityAck.statusCode, 200);
        assert.equal((await wallet(actorA)).ryo, 8_000);
        assert.equal(await boardAmount(targetA), 2_000);

        const actorB = 'bountytestcompletionreject';
        const targetB = 'bountytestcompletionhead';
        await seedPlayer(actorB, 10_000);
        await seedPlayer(targetB, 0);
        const body = { action: 'place', playerName: actorB, target: targetB, amount: 3_000, requestId: 'place-completion-reject-01' };
        const completionFailed = await withSetFault(
            (key) => key.startsWith('pvp:bounty-completed:'),
            'throw-before-commit',
            () => post(body),
        );
        assert.equal(completionFailed.statusCode, 500);
        assert.equal((await wallet(actorB)).ryo, 7_000);
        assert.equal(await boardAmount(targetB), 3_000);
        assert.ok(await kv.get(`pvp:bounty-active:${targetB}`), 'authority remains until completion evidence is durable');

        assert.equal((await post(body)).statusCode, 200);
        assert.equal((await wallet(actorB)).ryo, 7_000);
        assert.equal(await boardAmount(targetB), 3_000);
        assert.equal(await kv.get(`pvp:bounty-active:${targetB}`), null);
    });

    it('never releases durable gates until bounded completion/journal retention is confirmed', async () => {
        const actor = 'bountytestretentionactor';
        const target = 'bountytestretentionhead';
        await seedPlayer(actor, 10_000);
        await seedPlayer(target, 0);
        const body = { action: 'place', playerName: actor, target, amount: 2_000, requestId: 'place-retention-fail-a1' };
        const originalCompareSet = kv.compareSet.bind(kv);
        let failuresRemaining = 3;
        kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
            if (failuresRemaining > 0
                && key.startsWith('pvp:bounty-completed:')
                && typeof expected === 'string'
                && expected === value
                && !!options?.ex) {
                failuresRemaining -= 1;
                throw new Error('injected definite retention failure');
            }
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;

        let failed: Out;
        try {
            failed = await post(body);
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }
        assert.equal(failed.statusCode, 500);
        assert.equal((await wallet(actor)).ryo, 8_000);
        assert.equal(await boardAmount(target), 2_000);
        assert.ok(await kv.get(GATE_KEY), 'global authority stays attached while evidence TTL is unconfirmed');
        assert.ok(await kv.get(`pvp:bounty-active:${target}`), 'target authority stays attached while evidence TTL is unconfirmed');

        const retry = await post(body);
        assert.equal(retry.statusCode, 200);
        assert.equal((await wallet(actor)).ryo, 8_000);
        assert.equal(await boardAmount(target), 2_000);
        assert.equal(await kv.get(GATE_KEY), null);
        assert.equal(await kv.get(`pvp:bounty-active:${target}`), null);
    });

    it('atomically rejects a save CAS paused in the final read-to-write gap after a successor completes', async () => {
        const actor = 'bountyteststalesave';
        const target = 'bountyteststalesavehead';
        await seedPlayer(actor, 10_000);
        await seedPlayer(target, 0);
        const originalCompareSet = kv.compareSet.bind(kv);
        let releasePause!: () => void;
        let signalPaused!: () => void;
        const paused = new Promise<void>((resolve) => { signalPaused = resolve; });
        const resume = new Promise<void>((resolve) => { releasePause = resolve; });
        let intercepted = false;
        kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
            if (!intercepted && key === `save:${actor}` && stampedKind(value, 'place')) {
                intercepted = true;
                signalPaused();
                await resume;
            }
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;

        const firstBody = { action: 'place', playerName: actor, target, amount: 2_000, requestId: 'place-stale-save-a1' };
        const secondBody = { action: 'place', playerName: actor, target, amount: 2_000, requestId: 'place-stale-save-b2' };
        const firstPromise = post(firstBody);
        await paused;
        // A has already read the predecessor and is paused immediately before
        // the atomic compare+write. Expire both advisory leases; B helps A and
        // commits its own successor against the same wallet/target.
        await kv.del(`lock:${BOUNTY_KEY}`, `lock:save:${actor}`);

        let second: Out;
        let first: Out;
        try {
            second = await post(secondBody);
            releasePause();
            first = await firstPromise;
        } finally {
            releasePause();
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }
        assert.equal(second.statusCode, 200);
        assert.equal(first.statusCode, 200, 'stale CAS loses and replays its helper-written completion');
        assert.equal((await wallet(actor)).ryo, 6_000, 'stale predecessor cannot overwrite the successor debit');
        assert.equal((await wallet(actor)).saveVersion, 3);
        assert.equal(await boardAmount(target), 4_000);
    });

    it('atomically rejects a board CAS paused in the final read-to-write gap after a successor completes', async () => {
        const actor = 'bountyteststaleboard';
        const target = 'bountyteststaleboardhead';
        await seedPlayer(actor, 10_000);
        await seedPlayer(target, 0);
        const originalCompareSet = kv.compareSet.bind(kv);
        let releasePause!: () => void;
        let signalPaused!: () => void;
        const paused = new Promise<void>((resolve) => { signalPaused = resolve; });
        const resume = new Promise<void>((resolve) => { releasePause = resolve; });
        let intercepted = false;
        kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
            if (!intercepted && key === BOUNTY_KEY) {
                intercepted = true;
                signalPaused();
                await resume;
            }
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;

        const firstBody = { action: 'place', playerName: actor, target, amount: 2_000, requestId: 'place-stale-board-a1' };
        const secondBody = { action: 'place', playerName: actor, target, amount: 2_000, requestId: 'place-stale-board-b2' };
        const firstPromise = post(firstBody);
        await paused;
        await kv.del(`lock:${BOUNTY_KEY}`, `lock:save:${actor}`);

        let second: Out;
        let first: Out;
        try {
            second = await post(secondBody);
            releasePause();
            first = await firstPromise;
        } finally {
            releasePause();
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }
        assert.equal(second.statusCode, 200);
        assert.equal(first.statusCode, 200);
        assert.equal((await wallet(actor)).ryo, 6_000);
        assert.equal((await wallet(actor)).saveVersion, 3);
        assert.equal(await boardAmount(target), 4_000, 'stale board predecessor cannot erase the successor stake');
    });

    it('durably cancels an uncommitted escrow after intervening spend and releases the board for later work', async () => {
        const actor = 'bountytestcancelactor';
        const target = 'bountytestcancelhead';
        const helper = 'bountytestcancelhelper';
        const helperTarget = 'bountytestcancelhelperhead';
        await seedPlayer(actor, 5_000);
        await seedPlayer(target, 0);
        await seedPlayer(helper, 5_000);
        await seedPlayer(helperTarget, 0);
        const cancelledBody = { action: 'place', playerName: actor, target, amount: 4_000, requestId: 'place-cancel-spent-a1' };
        const failed = await withCompareSetFault(
            (key, _expected, value) => key === `save:${actor}` && stampedKind(value, 'place'),
            'throw-before-commit',
            () => post(cancelledBody),
        );
        assert.equal(failed.statusCode, 500);
        await kv.set(`save:${actor}`, { _saveVersion: 2, character: { name: actor, ryo: 1_000 } });

        const later = await post({
            action: 'place', playerName: helper, target: helperTarget, amount: 2_000, requestId: 'place-after-cancel-b2',
        });
        assert.equal(later.statusCode, 200, 'a later operation helps cancel the stale saga, then proceeds');
        assert.equal((await wallet(actor)).ryo, 1_000);
        assert.equal(await boardAmount(target), 0);
        assert.equal((await wallet(helper)).ryo, 3_000);
        assert.equal(await boardAmount(helperTarget), 2_000);
        assert.equal(await kv.get(GATE_KEY), null);
        assert.equal(await kv.get(`pvp:bounty-active:${target}`), null);

        const replay = await post(cancelledBody);
        assert.equal(replay.statusCode, 409);
        assert.equal(replay.body?.code, 'BOUNTY_PLACE_CANCELLED');
        assert.equal((await wallet(actor)).ryo, 1_000);
    });
});

describe('CLAIM crash recovery', { concurrency: false }, () => {
    it('recovers a committed payout whose save acknowledgement is lost', async () => {
        const winner = 'bountytestclaimack';
        const target = 'bountytestclaimtargetack';
        const battleId = 'bountytest-battle-save-ack';
        await seedPlayer(winner, 100);
        await seedPlayer(target, 0);
        await seedBounty(target, 5_000);
        await seedBattle(battleId, winner, target);
        const result = await withCompareSetFault(
            (key, _expected, value) => key === `save:${winner}` && stampedKind(value, 'claim'),
            'commit-then-throw',
            () => post({ action: 'claim', playerName: winner, battleId }),
        );
        assert.equal(result.statusCode, 200);
        assert.equal((await wallet(winner)).ryo, 5_100);
        assert.equal((await wallet(winner)).saveVersion, 2);
        assert.equal(await boardAmount(target), 0);
        assert.equal((await post({ action: 'claim', playerName: winner, battleId })).statusCode, 200);
        assert.equal((await wallet(winner)).ryo, 5_100);
    });

    it('keeps a precommit payout failure retryable and pays once', async () => {
        const winner = 'bountytestclaimreject';
        const target = 'bountytestclaimtargetreject';
        const battleId = 'bountytest-battle-save-reject';
        await seedPlayer(winner, 100);
        await seedPlayer(target, 0);
        await seedBounty(target, 6_000);
        await seedBattle(battleId, winner, target);
        const body = { action: 'claim', playerName: winner, battleId };
        const failed = await withCompareSetFault(
            (key, _expected, value) => key === `save:${winner}` && stampedKind(value, 'claim'),
            'throw-before-commit',
            () => post(body),
        );
        assert.equal(failed.statusCode, 500);
        assert.equal((await wallet(winner)).ryo, 100);
        assert.equal(await boardAmount(target), 6_000);

        await kv.set(`save:${winner}`, { _saveVersion: 2, character: { name: winner, ryo: 200 } });

        const retry = await post(body);
        assert.equal(retry.statusCode, 200);
        assert.equal((await wallet(winner)).ryo, 6_200, 'recovery credits the current wallet, not its stale prepared snapshot');
        assert.equal(await boardAmount(target), 0);
        await post(body);
        assert.equal((await wallet(winner)).ryo, 6_200);
    });

    it('recovers both committed and definitely rejected board writes from one payout stamp', async () => {
        for (const mode of ['commit-then-throw', 'throw-before-commit'] as const) {
            const suffix = mode === 'commit-then-throw' ? 'ack' : 'reject';
            const winner = `bountytestclaimboard${suffix}`;
            const target = `bountytestclaimtargetboard${suffix}`;
            const battleId = `bountytest-battle-board-${suffix}`;
            await seedPlayer(winner, 100);
            await seedPlayer(target, 0);
            await seedBounty(target, 7_000);
            await seedBattle(battleId, winner, target);
            const body = { action: 'claim', playerName: winner, battleId };
            const first = await withCompareSetFault((key) => key === BOUNTY_KEY, mode, () => post(body));
            assert.equal(first.statusCode, mode === 'commit-then-throw' ? 200 : 500);
            assert.equal((await wallet(winner)).ryo, 7_100);
            if (mode === 'throw-before-commit') assert.equal(await boardAmount(target), 7_000);

            const retry = await post(body);
            assert.equal(retry.statusCode, 200);
            assert.equal((await wallet(winner)).ryo, 7_100);
            assert.equal(await boardAmount(target), 0);
        }
    });

    it('a second claim helps finish the first target-version saga and cannot double-pay it', async () => {
        const winner = 'bountytestclaimhelper';
        const target = 'bountytestclaimtargethelper';
        const battleA = 'bountytest-battle-helper-a';
        const battleB = 'bountytest-battle-helper-b';
        await seedPlayer(winner, 100);
        await seedPlayer(target, 0);
        await seedBounty(target, 8_000);
        await seedBattle(battleA, winner, target);
        await seedBattle(battleB, winner, target);
        const failed = await withCompareSetFault(
            (key) => key === BOUNTY_KEY,
            'throw-before-commit',
            () => post({ action: 'claim', playerName: winner, battleId: battleA }),
        );
        assert.equal(failed.statusCode, 500);
        assert.equal((await wallet(winner)).ryo, 8_100);
        assert.equal(await boardAmount(target), 8_000);

        const helper = await post({ action: 'claim', playerName: winner, battleId: battleB });
        assert.equal(helper.statusCode, 200);
        assert.equal(helper.body?.amount, 0, 'the later battle consumes a durable no-bounty receipt');
        assert.equal((await wallet(winner)).ryo, 8_100);
        assert.equal(await boardAmount(target), 0);
        assert.equal(await kv.get(`pvp:bounty-active:${target}`), null);
    });

    it('an old battle completion cannot collect a later bounty; a future battle can collect it once', async () => {
        const winner = 'bountytestclaimfuture';
        const target = 'bountytestclaimtargetfuture';
        const placer = 'bountytestclaimplacerfuture';
        const firstBattle = 'bountytest-battle-future-a';
        const secondBattle = 'bountytest-battle-future-b';
        await seedPlayer(winner, 100);
        await seedPlayer(target, 0);
        await seedPlayer(placer, 10_000);
        await seedBounty(target, 5_000);
        await seedBattle(firstBattle, winner, target);
        assert.equal((await post({ action: 'claim', playerName: winner, battleId: firstBattle })).statusCode, 200);
        assert.equal((await wallet(winner)).ryo, 5_100);

        assert.equal((await post({
            action: 'place', playerName: placer, target, amount: 2_000, requestId: 'place-future-version-01',
        })).statusCode, 200);
        assert.equal(await boardAmount(target), 2_000);

        const oldReplay = await post({ action: 'claim', playerName: winner, battleId: firstBattle });
        assert.equal(oldReplay.statusCode, 200);
        assert.equal((await wallet(winner)).ryo, 5_100);
        assert.equal(await boardAmount(target), 2_000, 'old completion cannot consume the new target version');

        await seedBattle(secondBattle, winner, target);
        assert.equal((await post({ action: 'claim', playerName: winner, battleId: secondBattle })).statusCode, 200);
        assert.equal((await wallet(winner)).ryo, 7_100);
        assert.equal(await boardAmount(target), 0);
        await post({ action: 'claim', playerName: winner, battleId: secondBattle });
        assert.equal((await wallet(winner)).ryo, 7_100);
    });

    it('a valid no-bounty claim is durably consumed before a later bounty exists', async () => {
        const winner = 'bountytestclaimnoop';
        const target = 'bountytestclaimtargetnoop';
        const placer = 'bountytestclaimplacernoop';
        const battleId = 'bountytest-battle-noop';
        await seedPlayer(winner, 100);
        await seedPlayer(target, 0);
        await seedPlayer(placer, 10_000);
        await seedBattle(battleId, winner, target);
        const emptyClaim = await post({ action: 'claim', playerName: winner, battleId });
        assert.equal(emptyClaim.statusCode, 200);
        assert.equal(emptyClaim.body?.amount, 0);

        assert.equal((await post({
            action: 'place', playerName: placer, target, amount: 3_000, requestId: 'place-after-noop-claim-01',
        })).statusCode, 200);
        const staleClaim = await post({ action: 'claim', playerName: winner, battleId });
        assert.equal(staleClaim.statusCode, 200);
        assert.equal(staleClaim.body?.amount, 0);
        assert.equal((await wallet(winner)).ryo, 100);
        assert.equal(await boardAmount(target), 3_000);
    });
});
