import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { beginDurableSettlement, getDurableSettlement, settlementFingerprint, settlementTransactionId, updateDurableSettlement } from '../../_durable-settlement.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'village-transfer-handler-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
let handler: Handler;
let kv: typeof import('../../_storage.js').kv;
const VILLAGE_KEY = 'game:village-state:leaf';
const RECIPIENT_KEY = 'save:recipient';

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    handler = (await import('./transfer.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.set(VILLAGE_KEY, { treasury: { ryo: 100 } });
    await kv.set(RECIPIENT_KEY, { _saveVersion: 1, character: { name: 'Recipient', village: 'Leaf', ryo: 10 } });
    for (const key of await kv.keys('economy-settlement:*')) await kv.del(key);
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeReq(body: Record<string, unknown>) {
    return { method: 'POST', body, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! }, socket: { remoteAddress: '127.0.0.1' } } as never;
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

describe('village treasury transfer settlement', () => {
    it('debits and credits exactly once on replay', { concurrency: false }, async () => {
        const body = { village: 'Leaf', recipientName: 'Recipient', currency: 'ryo', amount: 25, requestId: 'village-transfer-replay-01' };
        const first = await post(body);
        const replay = await post(body);
        assert.equal(first.statusCode, 200);
        assert.equal(replay.statusCode, 200);
        assert.equal((await kv.get<{ treasury?: { ryo?: number } }>(VILLAGE_KEY))?.treasury?.ryo, 75);
        const recipient = await kv.get<{ _saveVersion?: number; character?: { ryo?: number } }>(RECIPIENT_KEY);
                // Gift tax (api/_treasury-gift-tax.ts, 2026-08-17): the pool loses the
        // full 25, the recipient receives 22 and 3 is BURNED. 10 + 22 = 32.
        assert.equal(recipient?.character?.ryo, 32);
        // A caller's client adopts any top-level _saveVersion as its own save's
        // version, so the recipient's never goes back to anyone but the recipient.
        assert.equal('_saveVersion' in (first.body ?? {}), false, 'a fresh transfer must not echo the recipient version');
        assert.equal('_saveVersion' in (replay.body ?? {}), false, 'nor may the durable replay of its stored result');
        assert.ok(Number(recipient?._saveVersion) > 1, 'the recipient save was committed with a new version');
    });

    it('keeps the idle recovery the recipient earned since their last save', { concurrency: false }, async () => {
        // A gift's recipient is rarely the one who sent it, and is often
        // offline. The credit's version write fenced their regeneration cursor
        // to now and discarded every point of HP, chakra and stamina recovered.
        const at = Date.now() - 30_000;
        await kv.set(RECIPIENT_KEY, {
            _saveVersion: 1, _saveAt: at, _regenAt: at,
            character: { name: 'Recipient', village: 'Leaf', ryo: 10, hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100 },
        });
        const reply = await post({ village: 'Leaf', recipientName: 'Recipient', currency: 'ryo', amount: 25, requestId: 'village-transfer-rested-01' });
        assert.equal(reply.statusCode, 200, JSON.stringify(reply.body));
        const saved = await kv.get<Record<string, any>>(RECIPIENT_KEY);
        assert.equal(saved?.character.ryo, 32, 'the gift was still credited');
        assert.ok(saved?.character.hp >= 40, `hp ${saved?.character.hp} lost the idle recovery`);
        assert.ok(saved?.character.chakra >= 50, `chakra ${saved?.character.chakra} lost the idle recovery`);
        assert.ok(saved?.character.stamina >= 30, `stamina ${saved?.character.stamina} lost the idle recovery`);
        // The credit moves no vital, so the write carries the settled cursor.
        assert.ok(Number(saved?._regenAt) >= at + 30_000 - 1_000, `cursor ${saved?._regenAt} fell behind the recovery`);
        assert.equal((Number(saved?._regenAt) - at) % 1_000, 0, `cursor ${saved?._regenAt} was fenced to the write, not carried`);
    });

    it('retries after recipient persistence fails without duplicating the debit', { concurrency: false }, async () => {
        const originalCompareSet = kv.compareSet.bind(kv);
        let failRecipient = true;
        kv.compareSet = async (key, expected, value, options) => {
            if (failRecipient && key === RECIPIENT_KEY) throw new Error('injected recipient write failure');
            return originalCompareSet(key, expected, value, options);
        };
        const body = { village: 'Leaf', recipientName: 'Recipient', currency: 'ryo', amount: 25, requestId: 'village-transfer-fault-01' };
        try {
            assert.equal((await post(body)).statusCode, 500);
            assert.equal((await kv.get<{ treasury?: { ryo?: number } }>(VILLAGE_KEY))?.treasury?.ryo, 75);
            assert.equal((await getDurableSettlement(
                settlementTransactionId('village-treasury-transfer', 'village-transfer-fault-01'),
                { kv },
            ))?.state, 'reconciliation-required');
            failRecipient = false;
            assert.equal((await post(body)).statusCode, 200);
        } finally {
            kv.compareSet = originalCompareSet;
        }
        assert.equal((await kv.get<{ treasury?: { ryo?: number } }>(VILLAGE_KEY))?.treasury?.ryo, 75);
        assert.equal((await kv.get<{ character?: { ryo?: number } }>(RECIPIENT_KEY))?.character?.ryo, 32);
    });

    it('leaves the item in the treasury when the recipient bag is full', { concurrency: false }, async () => {
        // The saga debits the source and WRITES it before creditRecipient runs,
        // and a throw after that write is unrecoverable — it marks the journal
        // reconciliation-required and never rolls back. So a capacity check in
        // creditRecipient destroys the gift instead of delaying it. This asserts
        // the check lives in validateRecipient, which runs before the debit.
        await kv.set(VILLAGE_KEY, { treasury: { ryo: 100, items: [{ itemId: 'rustfang-kunai', count: 1 }] } });
        await kv.set(RECIPIENT_KEY, {
            _saveVersion: 1,
            character: { name: 'Recipient', village: 'Leaf', ryo: 10, inventory: Array.from({ length: 500 }, (_, i) => `hunt-torn-hide-${i}`) },
        });

        const refused = await post({ village: 'Leaf', recipientName: 'Recipient', itemId: 'rustfang-kunai' });
        assert.equal(refused.statusCode, 409);
        assert.match(String(refused.body?.error), /inventory is full/i);
        assert.match(String(refused.body?.error), /^Recipient/, "names the blocked party, not the sender");

        const treasury = (await kv.get<{ treasury?: { items?: Array<{ itemId: string; count: number }> } }>(VILLAGE_KEY))?.treasury;
        assert.deepEqual(treasury?.items, [{ itemId: 'rustfang-kunai', count: 1 }], 'the gift must survive the refusal');
        const bag = (await kv.get<{ character?: { inventory?: string[] } }>(RECIPIENT_KEY))?.character?.inventory ?? [];
        assert.equal(bag.length, 500);
        assert.equal(bag.includes('rustfang-kunai'), false);
    });

    it('delivers a hunt material into the recipient stack even when the bag is full (owner ruling A12)', { concurrency: false }, async () => {
        await kv.set(VILLAGE_KEY, { treasury: { ryo: 100, items: [{ itemId: 'hunt-legendary-material', count: 1 }] } });
        await kv.set(RECIPIENT_KEY, {
            _saveVersion: 1,
            character: { name: 'Recipient', village: 'Leaf', ryo: 10,
                inventory: [...Array.from({ length: 499 }, (_, i) => `gear-${i}`), 'hunt-legendary-material'],
                itemStacks: [{ itemId: 'hunt-legendary-material', count: 2 }] },
        });
        const sent = await post({ village: 'Leaf', recipientName: 'Recipient', itemId: 'hunt-legendary-material', requestId: 'village-transfer-stack-01' });
        assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
        const saved = (await kv.get<{ character?: { inventory?: string[]; itemStacks?: Array<{ itemId: string; count: number }> } }>(RECIPIENT_KEY))?.character;
        assert.equal(saved?.inventory?.length, 499, 'the legacy copy folded out of inventory[] and no slot was used');
        assert.deepEqual(saved?.itemStacks, [{ itemId: 'hunt-legendary-material', count: 4 }], '2 stacked + 1 legacy + 1 gifted');
        assert.deepEqual((await kv.get<{ treasury?: { items?: unknown[] } }>(VILLAGE_KEY))?.treasury?.items, []);
    });

    it('refuses a 1-unit Fate Shard gift and moves nothing (I-16)', { concurrency: false }, async () => {
        await kv.set(VILLAGE_KEY, { treasury: { ryo: 100, fateShards: 10 } });
        await kv.set(RECIPIENT_KEY, { _saveVersion: 1, character: { name: 'Recipient', village: 'Leaf', ryo: 10, fateShards: 0 } });
        const refused = await post({ village: 'Leaf', recipientName: 'Recipient', currency: 'fateShards', amount: 1, requestId: 'village-transfer-one-fs-01' });
        assert.equal(refused.statusCode, 400);
        assert.match(String(refused.body?.error), /^Gift at least 2 Fate Shards/);
        assert.equal((await kv.get<{ treasury?: { fateShards?: number } }>(VILLAGE_KEY))?.treasury?.fateShards, 10);
        assert.equal((await kv.get<{ character?: { fateShards?: number } }>(RECIPIENT_KEY))?.character?.fateShards, 0);
        // Two units clear the minimum and burn exactly one.
        const sent = await post({ village: 'Leaf', recipientName: 'Recipient', currency: 'fateShards', amount: 2, requestId: 'village-transfer-two-fs-01' });
        assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
        assert.equal(sent.body?.burned, 1);
        assert.equal((await kv.get<{ treasury?: { fateShards?: number } }>(VILLAGE_KEY))?.treasury?.fateShards, 8);
        assert.equal((await kv.get<{ character?: { fateShards?: number } }>(RECIPIENT_KEY))?.character?.fateShards, 1);
    });

    it('still finishes a 1-unit gift that was debited before the minimum shipped', { concurrency: false }, async () => {
        // A gift journaled and debited by the old build, then interrupted, must
        // complete on retry: refusing it would strand the treasury debit.
        const requestId = 'village-transfer-legacy-one-fs-01';
        const operationType = 'village-treasury-transfer';
        const transactionId = settlementTransactionId(operationType, requestId);
        const fingerprint = settlementFingerprint({ operation: operationType, village: 'leaf', recipientName: 'recipient', currency: 'fateShards', itemId: '', amount: 1 });
        await beginDurableSettlement({ transactionId, idempotencyKey: requestId, operationType, fingerprint, actorIds: ['admin', 'leaf', 'recipient'], resource: 'fateShards', amount: 1, meta: { sourceKey: VILLAGE_KEY, recipientKey: RECIPIENT_KEY } }, { kv });
        await updateDurableSettlement(transactionId, { state: 'debit-applied' }, { kv });
        await kv.set(VILLAGE_KEY, { treasury: { ryo: 100, fateShards: 9 }, settlementReceipts: [{ transactionId, fingerprint, resource: 'fateShards', amount: 1, appliedAt: Date.now() }] });
        await kv.set(RECIPIENT_KEY, { _saveVersion: 1, character: { name: 'Recipient', village: 'Leaf', ryo: 10, fateShards: 0 } });

        const resumed = await post({ village: 'Leaf', recipientName: 'Recipient', currency: 'fateShards', amount: 1, requestId });
        assert.equal(resumed.statusCode, 200, JSON.stringify(resumed.body));
        assert.equal((await kv.get<{ treasury?: { fateShards?: number } }>(VILLAGE_KEY))?.treasury?.fateShards, 9, 'debited once, never again');
        assert.equal((await kv.get<{ character?: { fateShards?: number } }>(RECIPIENT_KEY))?.character?.fateShards, 1, 'the stranded unit is delivered');
        assert.equal((await getDurableSettlement(transactionId, { kv }))?.state, 'completed');
    });

    it('refuses a Mythic Seal gift and moves nothing (I-8)', { concurrency: false }, async () => {
        await kv.set(VILLAGE_KEY, { treasury: { ryo: 100, mythicSeals: 7 } });
        await kv.set(RECIPIENT_KEY, { _saveVersion: 1, character: { name: 'Recipient', village: 'Leaf', ryo: 10, mythicSeals: 0 } });
        for (const amount of [1, 2, 50]) {
            const refused = await post({ village: 'Leaf', recipientName: 'Recipient', currency: 'mythicSeals', amount, requestId: `village-transfer-seal-${String(amount).padStart(4, '0')}` });
            assert.equal(refused.statusCode, 400, JSON.stringify(refused.body));
            assert.match(String(refused.body?.error), /Mythic Seals cannot be gifted/);
        }
        assert.equal((await kv.get<{ treasury?: { mythicSeals?: number } }>(VILLAGE_KEY))?.treasury?.mythicSeals, 7, 'the treasury keeps its seals');
        const recipient = await kv.get<{ _saveVersion?: number; character?: { mythicSeals?: number } }>(RECIPIENT_KEY);
        assert.equal(recipient?.character?.mythicSeals, 0);
        assert.equal(recipient?._saveVersion, 1, 'the recipient save was never written');
    });

    it('still finishes a Mythic Seal gift that was debited before the rule shipped', { concurrency: false }, async () => {
        const requestId = 'village-transfer-legacy-seal-01';
        const operationType = 'village-treasury-transfer';
        const transactionId = settlementTransactionId(operationType, requestId);
        const fingerprint = settlementFingerprint({ operation: operationType, village: 'leaf', recipientName: 'recipient', currency: 'mythicSeals', itemId: '', amount: 3 });
        await beginDurableSettlement({ transactionId, idempotencyKey: requestId, operationType, fingerprint, actorIds: ['admin', 'leaf', 'recipient'], resource: 'mythicSeals', amount: 3, meta: { sourceKey: VILLAGE_KEY, recipientKey: RECIPIENT_KEY } }, { kv });
        await updateDurableSettlement(transactionId, { state: 'debit-applied' }, { kv });
        await kv.set(VILLAGE_KEY, { treasury: { ryo: 100, mythicSeals: 4 }, settlementReceipts: [{ transactionId, fingerprint, resource: 'mythicSeals', amount: 3, appliedAt: Date.now() }] });
        await kv.set(RECIPIENT_KEY, { _saveVersion: 1, character: { name: 'Recipient', village: 'Leaf', ryo: 10, mythicSeals: 0 } });

        const resumed = await post({ village: 'Leaf', recipientName: 'Recipient', currency: 'mythicSeals', amount: 3, requestId });
        assert.equal(resumed.statusCode, 200, JSON.stringify(resumed.body));
        assert.equal((await kv.get<{ treasury?: { mythicSeals?: number } }>(VILLAGE_KEY))?.treasury?.mythicSeals, 4, 'debited once, never again');
        assert.ok(Number((await kv.get<{ character?: { mythicSeals?: number } }>(RECIPIENT_KEY))?.character?.mythicSeals) > 0, 'the stranded seals are delivered');
        assert.equal((await getDurableSettlement(transactionId, { kv }))?.state, 'completed');
    });

    it('delivers the same gift once the recipient makes room', { concurrency: false }, async () => {
        await kv.set(VILLAGE_KEY, { treasury: { ryo: 100, items: [{ itemId: 'rustfang-kunai', count: 1 }] } });
        await kv.set(RECIPIENT_KEY, {
            _saveVersion: 1,
            character: { name: 'Recipient', village: 'Leaf', ryo: 10, inventory: Array.from({ length: 499 }, (_, i) => `hunt-torn-hide-${i}`) },
        });
        const sent = await post({ village: 'Leaf', recipientName: 'Recipient', itemId: 'rustfang-kunai' });
        assert.equal(sent.statusCode, 200);
        assert.deepEqual((await kv.get<{ treasury?: { items?: unknown[] } }>(VILLAGE_KEY))?.treasury?.items, []);
        assert.equal(
            ((await kv.get<{ character?: { inventory?: string[] } }>(RECIPIENT_KEY))?.character?.inventory ?? []).includes('rustfang-kunai'),
            true,
        );
    });
});
