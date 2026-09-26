import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';

// Real handlers, token authentication, rate limits and locks; only the storage
// publication is faulted after its wallet debit has actually committed.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.ADMIN_PASSWORD;
delete process.env.ENABLE_LEGACY;
delete process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;

type Character = Record<string, unknown>;
type Save = { _saveVersion: number; character: Character };
type Handler = (req: never, res: never) => Promise<unknown>;
type Response = { status: number; body?: Record<string, unknown> };
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let credits: typeof import('./_external-credits.js');
let bounty: Handler;
let kage: Handler;
let unlock: Handler;

before(async () => {
    const storage = await import('../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa');
    kv = storage.kv;
    ({ issuePlayerToken } = await import('../_auth.js'));
    credits = await import('./_external-credits.js');
    bounty = (await import('../pvp/bounty.js')).default as unknown as Handler;
    kage = (await import('../village/kage-challenge.js')).default as unknown as Handler;
    unlock = (await import('../village/hollow-gate-unlock.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

async function call(handler: Handler, name: string, body: Record<string, unknown>): Promise<Response> {
    const token = issuePlayerToken(name);
    assert.ok(token);
    const result: Response = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { result.status = status; return res; },
        json: (response: Record<string, unknown>) => { result.body = response; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST', body: { ...body, playerName: name },
        headers: { 'x-player-name': name, 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return result;
}

const village = 'Frostfang Village';
const kageKey = 'village:kage:frostfang-village';

async function prepare(name: string) {
    const runToken = `hg-refund-${name}`;
    const before: Character = {
        name, village, level: 90, createdAt: Date.now() - 30 * 86_400_000,
        villageMerit: 500, ryo: 500_200, honorSeals: 20_200, hollowShards: 100,
        hp: 500, maxHp: 500, inventory: [], itemStacks: [],
        hollowGateRun: { runToken, currentFloor: 1 },
    };
    const character = credits.recordHollowGateExternalCredits(before, {
        ...before, ryo: Number(before.ryo) + 90, honorSeals: Number(before.honorSeals) + 17,
    });
    const save: Save = { _saveVersion: 10, character };
    const saveKey = `save:${name}`;
    await kv.set(saveKey, save);
    await kv.set(`hg-run:${name}:${runToken}`, {
        playerName: name, mintedAt: Date.now() - 240_000, floorDepth: 5, currentFloor: 1,
        seed: name, entryCurrencies: { ryo: 500_000, honorSeals: 20_000, hollowShards: 100 }, entryItems: {},
        offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
        rewardLedger: { currencies: { ryo: 200, honorSeals: 200 }, items: {}, sourceIds: ['prepared-server-reward'] },
    });
    return { name, save, saveKey, runToken };
}

for (const scenario of ['bounty', 'kage', 'unlock'] as const) {
    test(`${scenario} publication failure restores the charged wallet without minting Hollow Gate external credits`, async t => {
        const f = await prepare(`hgrefund${scenario}`);
        const resource = scenario === 'unlock' ? 'honorSeals' : 'ryo';
        const amount = scenario === 'bounty' ? 1000 : scenario === 'kage' ? 250_000 : 10_000;
        const failedKey = scenario === 'bounty' ? 'pvp:bounties'
            : scenario === 'kage' ? kageKey : 'game:village-state:frostfangvillage';
        if (scenario === 'bounty') {
            await kv.set('save:hgrefundtarget', { character: { name: 'hgrefundtarget', ryo: 100 } });
            await kv.set(failedKey, { bounties: [] });
        } else {
            await kv.set(kageKey, {
                seatedKage: scenario === 'unlock' ? f.name : 'hgrefundincumbent',
                kageSystemUnlocked: true, challenge: null,
            });
            if (scenario === 'unlock') await kv.set(failedKey, { hollowGateUnlockedUntil: 0 });
        }
        const originalPublication = await kv.get(failedKey);
        const originalSet = kv.set.bind(kv);
        let faults = 0;
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (args[0] === failedKey) {
                const charged = (await kv.get<Save>(f.saveKey))!;
                assert.equal(charged.character[resource], Number(f.save.character[resource]) - amount,
                    'the injected failure follows the real committed debit');
                faults++;
                throw new Error('injected HG refund publication failure');
            }
            return originalSet(...args);
        });
        const handler = scenario === 'bounty' ? bounty : scenario === 'kage' ? kage : unlock;
        const request = scenario === 'bounty' ? { action: 'place', target: 'hgrefundtarget', amount }
            : scenario === 'kage' ? { action: 'declare', village } : {};
        for (let attempt = 1; attempt <= 2; attempt++) {
            const response = await call(handler, f.name, request);
            // All three answer a retryable 503 after refunding. Bounty placement
            // used to answer 500; it now runs through the retry-safe saga
            // (api/_save-debit-saga.ts), whose refund reply matches the others.
            assert.equal(response.status, 503, String(response.body?.error));
            assert.equal(faults, attempt, 'authentication and eligibility reached the selected publication');
            const after = (await kv.get<Save>(f.saveKey))!;
            assert.equal(after.character.ryo, f.save.character.ryo);
            assert.equal(after.character.honorSeals, f.save.character.honorSeals);
            assert.equal(after._saveVersion, f.save._saveVersion + attempt * 2, 'both debit and refund commit');
            assert.deepEqual(after.character.hollowGateExternalCredits, f.save.character.hollowGateExternalCredits,
                'a reversal retains prior provenance and creates no additional external income');
            assert.deepEqual(credits.hollowGateExternalCredits(after.character, f.runToken), { ryo: 90, honorSeals: 17 });
            assert.deepEqual(await kv.get(failedKey), originalPublication, 'failed shared state was not published');
        }
    });
}

test('a real Sanctify between bounty debit and failed publication protects the refund under the new checkpoint', async t => {
    const f = await prepare('hgrefundcheckpoint');
    const bountyKey = 'pvp:bounties';
    await kv.set('save:hgrefundtarget', { character: { name: 'hgrefundtarget', ryo: 100 } });
    await kv.set(bountyKey, { bounties: [] });
    const sanctify = (await import('./use-consumable.js')).default as unknown as Handler;
    const settle = (await import('./settle.js')).default as unknown as Handler;
    const originalSet = kv.set.bind(kv);
    let checkpoint: Save | undefined;
    let faults = 0;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (args[0] === bountyKey) {
            const charged = (await kv.get<Save>(f.saveKey))!;
            assert.equal(charged.character.ryo, Number(f.save.character.ryo) - 1000);
            const response = await call(sanctify, f.name, {
                action: 'sanctify', token: f.runToken, requestId: 'hg-refund-checkpoint-consumable',
            });
            assert.equal(response.status, 200, String(response.body?.error));
            checkpoint = (await kv.get<Save>(f.saveKey))!;
            assert.deepEqual(credits.hollowGateExternalCredits(checkpoint.character, f.runToken), {});
            assert.deepEqual(credits.hollowGateCreditBasis(checkpoint.character), { runToken: f.runToken, checkpointVersion: 1 });
            assert.equal(credits.hollowGateRefundCurrencySource(charged.character, checkpoint.character), 'external');
            faults++;
            throw new Error('injected publication failure after Sanctify');
        }
        return originalSet(...args);
    });
    const response = await call(bounty, f.name, { action: 'place', target: 'hgrefundtarget', amount: 1000 });
    assert.equal(response.status, 503);
    assert.equal(response.body?.refunded, true);
    assert.equal(faults, 1);
    assert.ok(checkpoint, 'the actual checkpoint committed between debit and refund');
    const refunded = (await kv.get<Save>(f.saveKey))!;
    assert.equal(refunded._saveVersion, f.save._saveVersion + 3);
    assert.equal(refunded.character.ryo, f.save.character.ryo);
    assert.equal(refunded.character.hollowShards, 86, 'the real Sanctify cost remains charged');
    assert.deepEqual(credits.hollowGateExternalCredits(refunded.character, f.runToken), { ryo: 1000 });
    assert.equal(credits.hollowGateProtectedCurrencyBaseline(refunded.character, f.runToken, 'ryo', checkpoint.character.ryo), f.save.character.ryo);
    assert.deepEqual(await kv.get(bountyKey), { bounties: [] });
    const ended = await call(settle, f.name, { token: f.runToken, action: 'abandon' });
    assert.equal(ended.status, 200, String(ended.body?.error));
    const terminal = (await kv.get<Save>(f.saveKey))!;
    assert.equal(terminal.character.ryo, f.save.character.ryo, 'the refund is retained in full after terminal settlement');
    assert.equal(terminal.character.hollowGateExternalCredits, null);
});

test('refund basis distinguishes money charged before entry, in an earlier dive, and at the current checkpoint', () => {
    const current: Character = {
        ryo: 1000, hollowGateRun: { runToken: 'current-run' },
        hollowGateExternalCredits: { runToken: 'current-run', checkpointVersion: 2, currencies: { ryo: 90 } },
    };
    const restore = (charged: Character) => credits.recordHollowGateExternalCredits(current, { ...current, ryo: 1100 },
        credits.hollowGateRefundCurrencySource(charged, current));
    for (const charged of [
        { ryo: 1000 },
        { ...current, hollowGateRun: { runToken: 'earlier-run' } },
        { ...current, hollowGateExternalCredits: { runToken: 'current-run', checkpointVersion: 1, currencies: { ryo: 90 } } },
    ]) {
        assert.deepEqual(credits.hollowGateExternalCredits(restore(charged), 'current-run'), { ryo: 190 },
            'money omitted from the current entry/checkpoint remains protected when returned');
    }
    assert.deepEqual(credits.hollowGateExternalCredits(restore(structuredClone(current)), 'current-run'), { ryo: 90 },
        'a same-checkpoint reversal adds no income');
});
