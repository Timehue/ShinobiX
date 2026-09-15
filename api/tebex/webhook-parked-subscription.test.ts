/*
 * A renewal for a PARKED subscription must entitle nobody.
 *
 * A reference is parked in tebex:orphaned-subscriptions when its account was
 * deleted (or wiped by a full reset) and cancelling it at Tebex failed.
 * Renewals find their player by the name sealed into the original basket, so
 * without a check the next renewal hands the Supporter perks to whoever
 * registered that name afterwards, while the original customer keeps paying.
 * With no save yet, the old 500 kept Tebex retrying until someone did.
 *
 * These drive the real handler over the in-memory store, signed the way Tebex
 * signs, so every gate in front of the subscription branch runs for real. The
 * references are parked by the real writer, recordOrphanedSubscription.
 */
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.TEBEX_WEBHOOK_SECRET = 'parked-subscription-test-secret';
process.env.TEBEX_SUBSCRIPTION_PACKAGE_ID = '9001';

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
type Save = { character: Record<string, unknown> } | null;

const PARKED_REF = 'tbx-r-55fff4107740a1f40d844ff89607557f45bfafb3';
const LIVE_REF = 'tbx-r-9f3c1d0a7b6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a';
const NEW_OWNER_REF = 'tbx-r-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
const IGNORED_PARKED = { ok: true, action: 'ignored', reason: 'parked-subscription' };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let orphanedKey: string;
let park: typeof import('./_cancel-subscription.js').recordOrphanedSubscription;
let sign: typeof import('./_webhook-core.js').tebexExpectedSignature;
let logged: Array<{ level: 'log' | 'warn' | 'error'; text: string }> = [];

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ ORPHANED_SUBSCRIPTIONS_KEY: orphanedKey, recordOrphanedSubscription: park } = await import('./_cancel-subscription.js'));
    ({ tebexExpectedSignature: sign } = await import('./_webhook-core.js'));
    handler = (await import('./webhook.js')).default as unknown as Handler;
});

beforeEach(async () => {
    logged = [];
    for (const level of ['log', 'warn', 'error'] as const) {
        mock.method(console, level, (...args: unknown[]) => { logged.push({ level, text: args.map(String).join(' ') }); });
    }
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

async function parkedEntry(reference: string): Promise<Record<string, unknown> | null> {
    const hash = await kv.hgetall<Record<string, unknown>>(orphanedKey);
    const raw = hash?.[reference];
    if (raw === undefined || raw === null) return null;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
}

describe('tebex webhook and parked subscriptions', () => {
    it('a renewal for a parked reference entitles nobody, not even the new owner of the name', async () => {
        await park('kaito', PARKED_REF, 'unreachable');
        // Someone registered the name after the original account was deleted.
        await kv.set('save:kaito', { character: { name: 'kaito' } });
        const saveBefore = await kv.get('save:kaito');

        const out = await deliver(subscriptionWebhook('recurring-payment.renewed', PARKED_REF));

        assert.equal(out.statusCode, 200, '200 so Tebex stops retrying');
        assert.deepEqual(out.body, IGNORED_PARKED);
        assert.deepEqual(await kv.get('save:kaito'), saveBefore, 'the new owner\'s save is not touched');

        const line = logged.find((entry) => entry.level === 'error' && entry.text.includes('[tebex] renewal for PARKED subscription'));
        assert.ok(line, 'an operator-visible error line');
        assert.match(line.text, new RegExp(PARKED_REF));
        assert.match(line.text, /"parkedSlug":"kaito"/);
        assert.match(line.text, /"type":"recurring-payment\.renewed"/);

        const entry = await parkedEntry(PARKED_REF);
        assert.equal(entry?.slug, 'kaito', 'the original entry survives');
        assert.equal(entry?.reason, 'unreachable');
        assert.equal(entry?.lastRenewalType, 'recurring-payment.renewed');
        assert.equal(typeof entry?.lastRenewalAt, 'string', 'the operator can see it is still billing');
    });

    it('a parked reference with no save answers 200 for every live event, so no later registration can catch a retry', async () => {
        await park('kaito', PARKED_REF, 'rejected');

        for (const type of ['recurring-payment.started', 'recurring-payment.renewed', 'recurring-payment.cancellation.aborted']) {
            const out = await deliver(subscriptionWebhook(type, PARKED_REF));
            assert.equal(out.statusCode, 200, type);
            assert.deepEqual(out.body, IGNORED_PARKED, type);
            assert.equal((await parkedEntry(PARKED_REF))?.lastRenewalType, type);
        }
        assert.equal(await kv.get('save:kaito'), null, 'nothing was created for the name');
    });

    it('an ended webhook for a parked reference leaves the new owner\'s own subscription alone', async () => {
        await park('kaito', PARKED_REF, 'unconfigured');
        // Left to run, `ended` would overwrite this with an inactive flag for the
        // parked reference, revoking perks the new owner is paying for.
        await kv.set('save:kaito', {
            character: {
                name: 'kaito',
                patreon: { userId: NEW_OWNER_REF, tier: 'shinobi-supporter', active: true, entitledCents: 500, since: 1, updatedAt: 1 },
            },
        });
        const saveBefore = await kv.get('save:kaito');

        const out = await deliver(subscriptionWebhook('recurring-payment.ended', PARKED_REF));

        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body, IGNORED_PARKED);
        assert.deepEqual(await kv.get('save:kaito'), saveBefore);
        assert.ok(logged.some((entry) => entry.level === 'warn' && entry.text.includes('PARKED subscription ended')));
        const entry = await parkedEntry(PARKED_REF);
        assert.equal(typeof entry?.endedAt, 'string', 'the operator can see Tebex stopped billing');
        assert.equal(entry?.lastRenewalAt, undefined, 'an ending is not a renewal');
    });

    it('a renewal for a reference that is not parked still entitles, and ended still revokes', async () => {
        // Some other account's reference is parked, so the hash exists.
        await park('someone-else', PARKED_REF, 'unreachable');
        const otherEntryBefore = await parkedEntry(PARKED_REF);
        await kv.set('save:kaito', { character: { name: 'kaito' } });

        const renewed = await deliver(subscriptionWebhook('recurring-payment.renewed', LIVE_REF));
        assert.equal(renewed.statusCode, 200);
        assert.deepEqual(renewed.body, { ok: true, action: 'entitled', active: true });
        const flag = ((await kv.get<Save>('save:kaito'))?.character.patreon ?? {}) as Record<string, unknown>;
        assert.equal(flag.userId, LIVE_REF);
        assert.equal(flag.active, true);
        assert.equal(flag.tier, 'shinobi-supporter');
        assert.equal(flag.entitledCents, 500);

        const ended = await deliver(subscriptionWebhook('recurring-payment.ended', LIVE_REF));
        assert.deepEqual(ended.body, { ok: true, action: 'entitled', active: false });
        assert.equal(((await kv.get<Save>('save:kaito'))?.character.patreon as Record<string, unknown>).active, false);

        assert.deepEqual(await parkedEntry(PARKED_REF), otherEntryBefore, 'another reference\'s entry is not stamped');
        assert.equal(await parkedEntry(LIVE_REF), null);
    });

    it('a reference that is not parked and has no save still asks Tebex to retry', async () => {
        const out = await deliver(subscriptionWebhook('recurring-payment.renewed', LIVE_REF));
        assert.equal(out.statusCode, 500);
        assert.deepEqual(out.body, { error: 'No save to entitle; will retry.' });
    });

    it('when the parked list cannot be read, it entitles nobody and asks for a retry', async (t) => {
        await kv.set('save:kaito', { character: { name: 'kaito' } });
        const hgetall = kv.hgetall.bind(kv);
        t.mock.method(kv, 'hgetall', async (key: string) => {
            if (key === orphanedKey) throw new Error('injected storage outage');
            return hgetall(key);
        });

        const out = await deliver(subscriptionWebhook('recurring-payment.renewed', LIVE_REF));

        assert.equal(out.statusCode, 500);
        assert.deepEqual(out.body, { error: 'Could not check the subscription; will retry.' });
        assert.equal((await kv.get<Save>('save:kaito'))?.character.patreon, undefined);
    });

    it('a parked entry that no longer parses is still parked, and the stamp keeps it', async () => {
        await kv.hset(orphanedKey, { [PARKED_REF]: 'cancelled by hand? check' });
        await kv.set('save:kaito', { character: { name: 'kaito' } });

        const out = await deliver(subscriptionWebhook('recurring-payment.renewed', PARKED_REF));

        assert.deepEqual(out.body, IGNORED_PARKED);
        assert.equal((await kv.get<Save>('save:kaito'))?.character.patreon, undefined);
        const entry = await parkedEntry(PARKED_REF);
        assert.equal(entry?.raw, 'cancelled by hand? check');
        assert.equal(entry?.lastRenewalType, 'recurring-payment.renewed');
    });

    it('a stamp that cannot be written does not change the answer', async (t) => {
        await park('kaito', PARKED_REF, 'unreachable');
        await kv.set('save:kaito', { character: { name: 'kaito' } });
        const hset = kv.hset.bind(kv);
        t.mock.method(kv, 'hset', async (key: string, fields: Record<string, unknown>) => {
            if (key === orphanedKey) throw new Error('injected write failure');
            return hset(key, fields);
        });

        const out = await deliver(subscriptionWebhook('recurring-payment.renewed', PARKED_REF));

        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body, IGNORED_PARKED);
        assert.equal((await kv.get<Save>('save:kaito'))?.character.patreon, undefined);
        assert.ok(logged.some((entry) => entry.level === 'error' && entry.text.includes('could not be stamped')));
    });
});
