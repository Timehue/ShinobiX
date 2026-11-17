/*
 * Security audit 2026-11-16 (launch-readiness 3.A #1): a refund or a lost
 * chargeback takes back what the payment bought. Before this, both were only
 * logged, so a player could buy Shards, spend them, charge the payment back
 * and keep everything.
 *
 * Drives the real handler over the in-memory store, signed the way Tebex signs.
 */
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.TEBEX_WEBHOOK_SECRET = 'reversal-test-secret';
process.env.TEBEX_SUBSCRIPTION_PACKAGE_ID = '9000001';
delete process.env.TEBEX_CHECKOUT_API_KEY;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };

// 'shards-35' in shared/shard-packages.ts PROVIDER_PACKAGE_IDS.tebex.
const PACKAGE_35 = 7651603;
const SUPPORTER_PACKAGE = 9000001;
const PLAYER = 'kaito';
const TXN = 'tbx-reversal-0001';
const REFERENCE = 'tbx-r-supporter-0001';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let sign: typeof import('./_webhook-core.js').tebexExpectedSignature;
let reversal: typeof import('./_reversal.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ tebexExpectedSignature: sign } = await import('./_webhook-core.js'));
    reversal = await import('./_reversal.js');
    handler = (await import('./webhook.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const level of ['log', 'warn', 'error'] as const) mock.method(console, level, () => {});
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, fateShards: 0 } });
});

afterEach(() => { mock.restoreAll(); });

function payment(type = 'payment.completed', statusId = 1, extra: Record<string, unknown> = {}) {
    return {
        id: `wh-${type}-${TXN}`,
        type,
        date: '2026-11-16T00:00:00+00:00',
        subject: {
            transaction_id: TXN,
            status: { id: statusId, description: type },
            products: [{ id: PACKAGE_35, name: '35 Fate Shards', quantity: 1, username: { id: PLAYER, username: 'Kaito' } }],
            ...extra,
        },
    };
}

const refund = () => payment('payment.refunded', 2);
const chargeback = () => payment('payment.dispute.lost', 3);

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

async function character(): Promise<Record<string, unknown>> {
    const save = await kv.get<{ character: Record<string, unknown> }>(`save:${PLAYER}`);
    return save!.character;
}
const shards = async () => Number((await character()).fateShards ?? 0);

/** Change the balance the way a spend would, with a version bump. */
async function setShards(value: number): Promise<void> {
    const save = await kv.get<{ _saveVersion: number; character: Record<string, unknown> }>(`save:${PLAYER}`);
    await kv.set(`save:${PLAYER}`, { ...save, _saveVersion: save!._saveVersion + 1, character: { ...save!.character, fateShards: value } });
}

const record = () => kv.get<import('./_reversal.js').TebexReversalRecord>(reversal.tebexReversalKey(TXN));

describe('tebex refunds and chargebacks', { concurrency: false }, () => {
    it('a refund takes the purchased Shards back, with the currency ledger in the same commit', async () => {
        assert.equal((await deliver(payment())).body?.granted, true);
        await setShards(45); // 35 bought + 10 earned in play
        const out = await deliver(refund());
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.action, 'reversed');
        assert.equal(out.body?.shardsDebited, 35);
        assert.equal(out.body?.shortfall, 0);
        assert.equal(await shards(), 10, 'only the purchased Shards are taken');

        const ledger = await kv.get<{ balances: Record<string, number> }>(`ledger:currency:${PLAYER}`);
        assert.equal(ledger?.balances.fateShards, 10, 'the ledger row committed with the debit');
        const row = await record();
        assert.equal(row?.state, 'reversed');
        assert.equal(row?.kind, 'refund');
        assert.equal(row?.shardsGranted, 35);
        assert.equal(row?.shardsDebited, 35);
    });

    it('a lost chargeback takes the purchased Shards back', async () => {
        assert.equal((await deliver(payment())).body?.granted, true);
        const out = await deliver(chargeback());
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.shardsDebited, 35);
        assert.equal(await shards(), 0);
        assert.equal((await record())?.kind, 'chargeback');
    });

    it('a duplicate delivery takes nothing twice, nor does a second reversal of the same payment', async () => {
        assert.equal((await deliver(payment())).body?.granted, true);
        await setShards(100);
        assert.equal((await deliver(refund())).body?.shardsDebited, 35);
        assert.equal(await shards(), 65);

        const again = await deliver(refund());
        assert.equal(again.statusCode, 200);
        assert.equal(again.body?.replay, true);
        assert.equal(again.body?.shardsDebited, 0);
        const lost = await deliver(chargeback());
        assert.equal(lost.body?.replay, true, 'a chargeback after the refund is the same transaction');
        assert.equal(await shards(), 65);
    });

    it('Shards already spent never go negative: the rest is recorded as a debt for the owner', async () => {
        assert.equal((await deliver(payment())).body?.granted, true);
        await setShards(5); // spent 30 of the 35
        const out = await deliver(chargeback());
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.shardsDebited, 5);
        assert.equal(out.body?.shortfall, 30);
        assert.equal(await shards(), 0, 'the balance stops at zero');

        const listed = await reversal.listTebexReversals();
        assert.equal(listed.length, 1, 'the debt is listed for the Moderation panel');
        assert.equal(listed[0].playerName, PLAYER);
        assert.equal(listed[0].shortfall, 30);
        assert.equal(listed[0].balanceBefore, 5);

        // A redelivery neither takes more nor erases the debt.
        assert.equal((await deliver(chargeback())).body?.shardsDebited, 0);
        assert.equal((await record())?.shortfall, 30);
    });

    it('an opened dispute moves nothing; losing it then reverses the purchase', async () => {
        assert.equal((await deliver(payment())).body?.granted, true);
        const opened = await deliver(payment('payment.dispute.opened', 1));
        assert.equal(opened.body?.action, 'dispute-recorded');
        assert.equal(await shards(), 35);
        assert.equal((await record())?.state, 'dispute-open');

        const lost = await deliver(chargeback());
        assert.equal(lost.body?.shardsDebited, 35);
        assert.equal(await shards(), 0);
        const row = await record();
        assert.equal(row?.state, 'reversed');
        assert.deepEqual(row?.events.map((event) => event.kind), ['dispute-opened', 'chargeback']);
    });

    it('a won dispute closes the record without moving Shards', async () => {
        assert.equal((await deliver(payment())).body?.granted, true);
        await deliver(payment('payment.dispute.opened', 1));
        const won = await deliver(payment('payment.dispute.won', 1));
        assert.equal(won.body?.action, 'dispute-closed');
        assert.equal(await shards(), 35);
        assert.equal((await record())?.state, 'dispute-won');
    });

    it('a refund that arrives before its purchase was credited stops the late delivery paying', async () => {
        const early = await deliver(refund());
        assert.equal(early.statusCode, 200, JSON.stringify(early.body));
        assert.equal(early.body?.shardsDebited, 0);
        assert.equal(early.body?.shortfall, 0);

        const late = await deliver(payment());
        assert.equal(late.statusCode, 200);
        assert.equal(late.body?.granted, false);
        assert.equal(await shards(), 0);
    });

    it('a refund for an account that is gone is recorded with the whole grant as the shortfall', async () => {
        assert.equal((await deliver(payment())).body?.granted, true);
        await kv.del(`save:${PLAYER}`);
        const out = await deliver(refund());
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const row = await record();
        assert.equal(row?.note, 'no-save');
        assert.equal(row?.shortfall, 35);
    });

    it('never debits whoever registered the name after the paid account was deleted', async () => {
        await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, createdAt: 1_000, fateShards: 0 } });
        assert.equal((await deliver(payment())).body?.granted, true);
        // The account is deleted and a stranger registers the same name.
        await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, createdAt: 2_000, fateShards: 50 } });

        const out = await deliver(chargeback());
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.shardsDebited, 0);
        assert.equal(out.body?.shortfall, 35, 'the whole grant is the debt, recorded for the owner');
        assert.equal(await shards(), 50, "the stranger's Shards are untouched");
        assert.equal((await record())?.note, 'name-reassigned');
    });

    it('still debits the paid account once its id has rolled off the in-save list, by its createdAt', async () => {
        await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, createdAt: 1_000, fateShards: 0 } });
        assert.equal((await deliver(payment())).body?.granted, true);
        const save = await kv.get<{ _saveVersion: number; character: Record<string, unknown> }>(`save:${PLAYER}`);
        const rolled = Array.from({ length: 200 }, (_, i) => `tbx-newer-${i}`);
        await kv.set(`save:${PLAYER}`, { ...save, _saveVersion: save!._saveVersion + 1, character: { ...save!.character, redeemedTebexPurchases: rolled } });

        assert.equal((await deliver(refund())).body?.shardsDebited, 35);
        assert.equal(await shards(), 0);
    });

    describe('Supporter time', () => {
        const supporterPayment = (type: string, statusId: number) => ({
            ...payment(type, statusId, { recurring_payment_reference: REFERENCE }),
            subject: {
                transaction_id: TXN,
                status: { id: statusId },
                recurring_payment_reference: REFERENCE,
                products: [{ id: SUPPORTER_PACKAGE, quantity: 1, username: { id: PLAYER } }],
            },
        });

        beforeEach(async () => {
            await kv.set(`save:${PLAYER}`, {
                _saveVersion: 1,
                character: {
                    name: PLAYER,
                    fateShards: 12,
                    patreon: { userId: REFERENCE, tier: 'shinobi-supporter', active: true, entitledCents: 500, since: 1, updatedAt: 1 },
                },
            });
        });

        it('a refund of a Supporter payment ends the perks it paid for and leaves Shards alone', async () => {
            const out = await deliver(supporterPayment('payment.refunded', 2));
            assert.equal(out.statusCode, 200, JSON.stringify(out.body));
            assert.equal(out.body?.supporter, 'ended');
            const flag = (await character()).patreon as Record<string, unknown>;
            assert.equal(flag.active, false);
            assert.equal(await shards(), 12, 'a subscription payment credited no Shards');
            assert.equal(await kv.hgetall('tebex:orphaned-subscriptions'), null, 'a refund does not cancel billing');
        });

        it('a lost chargeback also stops the subscription billing again (parked when it cannot cancel)', async () => {
            const out = await deliver(supporterPayment('payment.dispute.lost', 3));
            assert.equal(out.statusCode, 200, JSON.stringify(out.body));
            assert.equal(((await character()).patreon as Record<string, unknown>).active, false);
            const row = await record();
            assert.equal(row?.supporter?.outcome, 'ended');
            assert.equal(row?.supporter?.cancel, 'parked', 'no checkout key here, so it is parked for a human');
            const parked = await kv.hgetall<Record<string, unknown>>('tebex:orphaned-subscriptions');
            assert.ok(parked && Object.prototype.hasOwnProperty.call(parked, REFERENCE));
        });

        it('a refund never ends a different subscription on the save', async () => {
            const save = await kv.get<{ _saveVersion: number; character: Record<string, unknown> }>(`save:${PLAYER}`);
            await kv.set(`save:${PLAYER}`, { ...save, character: { ...save!.character, patreon: { userId: 'tbx-r-someone-else', tier: 'shinobi-supporter', active: true, entitledCents: 500 } } });
            const out = await deliver(supporterPayment('payment.refunded', 2));
            assert.equal(out.body?.supporter, 'not-on-save');
            assert.equal(((await character()).patreon as Record<string, unknown>).active, true);
        });
    });
});
