/*
 * A paid renewal replaces an admin comp; it never leaves the comp's expiry in
 * charge of perks the player is paying for.
 *
 * applyAdminSubscription keeps the previous `userId`, so a comp made over a
 * paying Tebex subscriber carries their reference, plus `expiresAt` and
 * `source: 'admin'`. applyEntitlementToSave used to treat a renewal at the same
 * price as already matching that flag and skip the write. The comp's expiry
 * then survived every renewal, and once it passed the player kept paying with
 * no perks, until the price changed or an admin intervened.
 *
 * These drive the real handler over the in-memory store, signed the way Tebex
 * signs, and make the comps with the real applyAdminSubscription. Every
 * assertion reads the STORED flag, so a change to how the save is merged back
 * cannot quietly bring the comp's expiry back.
 */
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.TEBEX_WEBHOOK_SECRET = 'admin-comp-renewal-test-secret';
process.env.TEBEX_SUBSCRIPTION_PACKAGE_ID = '9001';

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
type Save = { character: Record<string, unknown> } | null;

const REF = 'tbx-r-7c1e9a2b3d4f5e6a7b8c9d0e1f2a3b4c5d6e7f8a';
const ENTITLED = { ok: true, action: 'entitled', active: true };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let comp: typeof import('../_subscription.js').applyAdminSubscription;
let isSubscriber: typeof import('../_entitlements.js').isPatreonSubscriber;
let sign: typeof import('./_webhook-core.js').tebexExpectedSignature;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ applyAdminSubscription: comp } = await import('../_subscription.js'));
    ({ isPatreonSubscriber: isSubscriber } = await import('../_entitlements.js'));
    ({ tebexExpectedSignature: sign } = await import('./_webhook-core.js'));
    handler = (await import('./webhook.js')).default as unknown as Handler;
});

beforeEach(async () => {
    // The handler logs every event; keep the test output readable.
    for (const level of ['log', 'warn', 'error'] as const) mock.method(console, level, () => {});
    for (const key of await kv.keys('*')) await kv.del(key);
});

afterEach(() => { mock.restoreAll(); });

/** Tebex's recurring envelope for our package, bought by `playerName`. */
function subscriptionWebhook(type: string, reference: string, playerName = 'kaito') {
    const product = { id: 9001, name: 'Shinobi Supporter', custom: { playerName } };
    return {
        id: `wh-${type}-${reference}`,
        type,
        date: '2026-09-14T00:00:00+00:00',
        subject: {
            reference,
            price: { amount: 5, currency: 'USD' },
            initial_payment: { transaction_id: 'tbx-p-1', products: [product] },
            last_payment: { transaction_id: 'tbx-p-2', products: [product] },
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
    const req = {
        method: 'POST',
        headers: { 'x-signature': sign(rawBody, process.env.TEBEX_WEBHOOK_SECRET!) },
        rawBody: Buffer.from(rawBody, 'utf8'),
        // One of Tebex's published addresses, so the unlisted-IP warning stays quiet.
        socket: { remoteAddress: '18.209.80.3' },
    };
    await handler(req as never, res as never);
    return out;
}

async function characterOf(name: string): Promise<Record<string, unknown>> {
    return (await kv.get<Save>(`save:${name}`))?.character ?? {};
}

async function flagOf(name: string): Promise<Record<string, unknown>> {
    return ((await characterOf(name)).patreon ?? {}) as Record<string, unknown>;
}

/** Move a comp's expiry into the past, the way time would. */
async function lapse(name: string): Promise<void> {
    const save = await kv.get<{ character: { patreon: Record<string, unknown> } }>(`save:${name}`);
    assert.ok(save, `save:${name} exists`);
    save.character.patreon.expiresAt = Date.now() - 60_000;
    await kv.set(`save:${name}`, save);
}

/** A paying subscriber whom an admin then comps, as happens in production. */
async function compedSubscriber(name = 'kaito'): Promise<number> {
    await kv.set(`save:${name}`, { character: { name } });
    assert.deepEqual((await deliver(subscriptionWebhook('recurring-payment.started', REF, name))).body, ENTITLED);
    const since = Number((await flagOf(name)).since);
    await comp(name, { active: true, days: 30 });
    const flag = await flagOf(name);
    assert.equal(flag.userId, REF, 'the comp keeps the paid reference');
    assert.equal(flag.source, 'admin');
    assert.equal(typeof flag.expiresAt, 'number');
    return since;
}

function assertPlainPaidFlag(flag: Record<string, unknown>, since: number): void {
    assert.equal(flag.userId, REF);
    assert.equal(flag.active, true);
    assert.equal(flag.tier, 'shinobi-supporter');
    assert.equal(flag.entitledCents, 500);
    assert.equal(flag.since, since, 'the original since survives');
    assert.ok(!('expiresAt' in flag), 'the comp expiry is gone from the stored flag');
    assert.ok(!('source' in flag), 'the admin marker is gone from the stored flag');
}

describe('tebex webhook: a paid renewal replaces an admin comp', () => {
    it('a comp over a paying subscriber, once lapsed, is restored by their next same-price renewal', async () => {
        const since = await compedSubscriber();
        await lapse('kaito');
        assert.equal(isSubscriber(await characterOf('kaito')), false, 'the stranded state: paying, but no perks');

        const out = await deliver(subscriptionWebhook('recurring-payment.renewed', REF));

        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body, ENTITLED);
        assertPlainPaidFlag(await flagOf('kaito'), since);
        assert.equal(isSubscriber(await characterOf('kaito')), true);

        // From here it is an ordinary subscription: a redelivery is a free no-op again.
        const saveBefore = await kv.get('save:kaito');
        await deliver(subscriptionWebhook('recurring-payment.renewed', REF));
        assert.deepEqual(await kv.get('save:kaito'), saveBefore, 'no version bump');
    });

    it('a live comp over a paying subscriber becomes a plain paid flag at their next renewal', async () => {
        const since = await compedSubscriber();

        const out = await deliver(subscriptionWebhook('recurring-payment.renewed', REF));

        assert.deepEqual(out.body, ENTITLED);
        assertPlainPaidFlag(await flagOf('kaito'), since);

        // The trade-off, pinned on purpose: once payment has replaced the comp,
        // the subscription's own `ended` revokes it, even with comp days left.
        const ended = await deliver(subscriptionWebhook('recurring-payment.ended', REF));
        assert.deepEqual(ended.body, { ok: true, action: 'entitled', active: false });
        assert.equal((await flagOf('kaito')).active, false);
    });

    it('a same-reference, same-price event over a plain paid flag is still a free no-op', async () => {
        await kv.set('save:kaito', { character: { name: 'kaito' } });
        await deliver(subscriptionWebhook('recurring-payment.started', REF));
        const saveBefore = await kv.get('save:kaito');

        for (const type of ['recurring-payment.started', 'recurring-payment.renewed', 'recurring-payment.cancellation.aborted']) {
            const out = await deliver(subscriptionWebhook(type, REF));
            assert.deepEqual(out.body, ENTITLED, type);
            assert.deepEqual(await kv.get('save:kaito'), saveBefore, `${type}: not written, no version bump`);
        }
    });

    it('an admin comp with no payment behind it still lapses on its own', async () => {
        await kv.set('save:hana', { character: { name: 'hana' } });
        await comp('hana', { active: true, days: 30 });
        assert.equal(isSubscriber(await characterOf('hana')), true);

        await lapse('hana');

        assert.equal(isSubscriber(await characterOf('hana')), false);
        const flag = await flagOf('hana');
        assert.equal(flag.source, 'admin', 'still a comp: nothing converted it');
        assert.equal(flag.active, true, 'the stored flag is untouched; the expiry alone ends the perks');
    });
});
