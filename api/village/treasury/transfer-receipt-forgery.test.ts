import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { settlementFingerprint, settlementTransactionId } from '../../_durable-settlement.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-receipt-forgery-test-secret-32b';

/*
 * The village treasury transfer (api/_cross-key-settlement.ts) treats a
 * `settlementReceipts` entry on the village row as proof that the treasury was
 * ALREADY debited for that transaction, and on that proof skips the treasury
 * balance check, the recipient checks (membership, shared connection, the
 * Kage's 24h send budget) and the debit itself, then credits the recipient.
 *
 * That proof is only sound if nothing but the server can write it. The clan
 * save validator pins the field as server-owned; the village-state blob write
 * (POST /api/game-state kind 'villageState') merged `{ ...prev, ...incoming }`
 * without pinning it. So a seated Kage could plant a matching receipt through
 * an ordinary village-state save and then gift ryo the treasury does not hold:
 * minted currency, repeatable once per request id.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const VILLAGE = 'Leaf';
const VILLAGE_KEY = 'game:village-state:leaf';
const KAGE = 'forgerykage';
const ALT = 'forgeryalt';

let kv: typeof import('../../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let gameState: Handler;
let transfer: Handler;

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ issuePlayerToken } = await import('../../_auth.js'));
    gameState = (await import('../../game-state.js')).default as unknown as Handler;
    transfer = (await import('./transfer.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set('village:kage:leaf', { kageSystemUnlocked: true, seatedKage: KAGE });
    await kv.set(VILLAGE_KEY, { village: VILLAGE, treasury: { ryo: 0 } });
    await kv.set(`save:${KAGE}`, { _saveVersion: 1, character: { name: KAGE, village: VILLAGE, level: 60, ryo: 0 } });
    await kv.set(`save:${ALT}`, { _saveVersion: 1, character: { name: ALT, village: VILLAGE, level: 60, ryo: 0 } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function call(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body,
        query: {},
        headers: { 'x-player-name': playerName, 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: '127.0.0.9' },
    } as never, res as never);
    return out;
}

test('a village-state save cannot plant the receipt that lets a treasury gift skip its debit', async () => {
    const requestId = 'forged-receipt-transfer-0001';
    const amount = 1_000;
    const transactionId = settlementTransactionId('village-treasury-transfer', requestId);
    const fingerprint = settlementFingerprint({
        operation: 'village-treasury-transfer', village: 'leaf', recipientName: ALT, currency: 'ryo', itemId: '', amount,
    });

    // 1. An ordinary village-state save that also carries a forged
    //    "this transfer already debited the treasury" receipt.
    const planted = await call(gameState, KAGE, {
        kind: 'villageState',
        village: VILLAGE,
        state: {
            village: VILLAGE,
            treasury: { ryo: 0 },
            settlementReceipts: [{ transactionId, fingerprint, resource: 'ryo', amount, appliedAt: Date.now() }],
        },
    });
    assert.equal(planted.statusCode, 200, JSON.stringify(planted.body));
    const row = await kv.get<Record<string, unknown>>(VILLAGE_KEY);
    assert.equal(row?.settlementReceipts, undefined, 'a client save must not be able to write settlement receipts');

    // 2. The Kage gifts ryo the treasury does not hold.
    const gift = await call(transfer, KAGE, { village: VILLAGE, recipientName: ALT, currency: 'ryo', amount, requestId });
    assert.equal(gift.statusCode, 400, JSON.stringify(gift.body));
    assert.match(String(gift.body?.error), /Insufficient treasury ryo/);
    assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${ALT}`))?.character.ryo, 0, 'no ryo may be minted');
    assert.equal((await kv.get<{ treasury: { ryo: number } }>(VILLAGE_KEY))?.treasury.ryo, 0);
});

test('a village-state save cannot erase the agenda receipts that stop a second treasury tithe', async () => {
    // The daily agenda credits the VILLAGE treasury once per player per UTC
    // day, gated only by `agendaClaimReceipts` on the same row. A blob that
    // resets that list must not let the same villager claim the tithe again.
    const agenda = (await import('../claim-daily-agenda.js')).default as unknown as Handler;
    for (let sector = 1; sector <= 10; sector++) {
        await kv.set(`world:territory:${sector}`, { sector, ownerVillage: VILLAGE });
    }
    const first = await call(agenda, ALT, { playerName: ALT, village: VILLAGE });
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.equal(first.body?.treasuryAlreadyClaimed, false);
    const afterFirst = (await kv.get<{ treasury: Record<string, number> }>(VILLAGE_KEY))!.treasury;
    assert.ok(afterFirst.honorSeals > 0, 'the tithe landed');

    const reset = await call(gameState, ALT, {
        kind: 'villageState',
        village: VILLAGE,
        state: { village: VILLAGE, treasury: afterFirst, agendaClaimReceipts: [] },
    });
    assert.equal(reset.statusCode, 200, JSON.stringify(reset.body));

    const second = await call(agenda, ALT, { playerName: ALT, village: VILLAGE });
    assert.equal(second.statusCode, 200, JSON.stringify(second.body));
    assert.equal(second.body?.treasuryAlreadyClaimed, true, 'the tithe is once per player per day');
    // The village-state save normalizes the treasury (zero-valued keys), so
    // compare the tithe's own currencies.
    const afterSecond = (await kv.get<{ treasury: Record<string, number> }>(VILLAGE_KEY))!.treasury;
    for (const currency of ['ryo', 'honorSeals', 'boneCharms']) {
        assert.equal(afterSecond[currency], afterFirst[currency], `no second ${currency} tithe`);
    }
});

test('receipts the server wrote survive a later village-state save', async () => {
    // A real gift writes its receipt on the row; a stale client re-save that
    // omits or rewrites the field must not erase that proof.
    await kv.set(VILLAGE_KEY, { village: VILLAGE, treasury: { ryo: 500 } });
    const gift = await call(transfer, KAGE, { village: VILLAGE, recipientName: ALT, currency: 'ryo', amount: 100, requestId: 'genuine-transfer-00001' });
    assert.equal(gift.statusCode, 200, JSON.stringify(gift.body));
    const receipts = (await kv.get<Record<string, unknown>>(VILLAGE_KEY))?.settlementReceipts;
    assert.ok(Array.isArray(receipts) && receipts.length === 1, 'the genuine gift is receipted on the row');

    for (const settlementReceipts of [[], undefined, [{ transactionId: 'x', fingerprint: 'y' }]]) {
        const resave = await call(gameState, KAGE, {
            kind: 'villageState',
            village: VILLAGE,
            state: { village: VILLAGE, treasury: { ryo: 400 }, ...(settlementReceipts === undefined ? {} : { settlementReceipts }) },
        });
        assert.equal(resave.statusCode, 200, JSON.stringify(resave.body));
        assert.deepEqual((await kv.get<Record<string, unknown>>(VILLAGE_KEY))?.settlementReceipts, receipts);
    }
});
