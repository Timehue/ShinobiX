/*
 * An `ended` webhook revokes only the subscription it names.
 *
 * Renewal and ended webhooks find their player by the name sealed into the
 * ORIGINAL basket, not by any save, and a name outlives its account. After a
 * deletion or a full reset, whoever registers the name next can hold a
 * subscription of their own, or an admin comp. A late `ended` for the old
 * reference used to overwrite their flag with an inactive one, revoking perks
 * they pay for. With no save at all it answered 500, so Tebex kept retrying
 * until someone registered the name.
 *
 * These drive the real handler over the in-memory store, signed the way Tebex
 * signs, so every gate in front of the subscription branch runs for real. None
 * of these references is parked; webhook-parked-subscription.test.ts covers
 * those.
 */
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.TEBEX_WEBHOOK_SECRET = 'ended-ownership-test-secret';
process.env.TEBEX_SUBSCRIPTION_PACKAGE_ID = '9001';

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
type Save = { character: Record<string, unknown> } | null;

/** The deleted account's subscription. Its `ended` arrives late. */
const OLD_REF = 'tbx-r-55fff4107740a1f40d844ff89607557f45bfafb3';
/** The subscription of whoever holds the name now. */
const NEW_REF = 'tbx-r-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
const NOT_ON_SAVE = { ok: true, action: 'ignored', reason: 'subscription-not-on-save' };
const ADMIN_COMP = { ok: true, action: 'ignored', reason: 'admin-comp-on-save' };
const NO_SAVE = { ok: true, action: 'ignored', reason: 'no-save' };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let comp: typeof import('../_subscription.js').applyAdminSubscription;
let sign: typeof import('./_webhook-core.js').tebexExpectedSignature;
let logged: Array<{ level: 'log' | 'warn' | 'error'; text: string }> = [];

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ applyAdminSubscription: comp } = await import('../_subscription.js'));
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

/** A live paid flag, as applyEntitlementToSave writes it. */
function supporter(userId: string, extra: Record<string, unknown> = {}) {
    return { userId, tier: 'shinobi-supporter', active: true, entitledCents: 500, since: 1_000, updatedAt: 1_000, ...extra };
}

async function flagOf(name: string): Promise<Record<string, unknown> | undefined> {
    return (await kv.get<Save>(`save:${name}`))?.character.patreon as Record<string, unknown> | undefined;
}

describe('tebex webhook: ended revokes only the subscription it names', () => {
    it('a stale ended for an old reference leaves the new owner\'s live subscription intact', async () => {
        await kv.set('save:kaito', { character: { name: 'kaito', patreon: supporter(NEW_REF) } });
        const saveBefore = await kv.get('save:kaito');

        const out = await deliver(subscriptionWebhook('recurring-payment.ended', OLD_REF));

        assert.equal(out.statusCode, 200, '200 so Tebex stops retrying');
        assert.deepEqual(out.body, NOT_ON_SAVE);
        assert.deepEqual(await kv.get('save:kaito'), saveBefore, 'not written, not even a version bump');

        const line = logged.find((entry) => entry.level === 'warn' && entry.text.includes('[tebex] subscription ended — flag left alone'));
        assert.ok(line, 'an operator-visible warning');
        assert.match(line.text, new RegExp(`"reference":"${OLD_REF}"`));
        assert.match(line.text, new RegExp(`"heldBy":"${NEW_REF}"`));
        assert.match(line.text, /"reason":"subscription-not-on-save"/);

        // The new owner's own subscription still ends normally when its turn comes.
        const own = await deliver(subscriptionWebhook('recurring-payment.ended', NEW_REF));
        assert.deepEqual(own.body, { ok: true, action: 'entitled', active: false });
        assert.equal((await flagOf('kaito'))?.active, false);
    });

    it('a stale ended writes nothing to a save with no flag, or with another subscription\'s lapsed flag', async () => {
        const characters: Array<Record<string, unknown>> = [
            { name: 'kaito' },
            { name: 'kaito', patreon: supporter(NEW_REF, { active: false }) },
        ];
        for (const character of characters) {
            await kv.set('save:kaito', { character });
            const saveBefore = await kv.get('save:kaito');

            const out = await deliver(subscriptionWebhook('recurring-payment.ended', OLD_REF));

            assert.equal(out.statusCode, 200, JSON.stringify(character));
            assert.deepEqual(out.body, NOT_ON_SAVE, JSON.stringify(character));
            assert.deepEqual(await kv.get('save:kaito'), saveBefore, 'an ended never introduces a reference to a save');
        }
    });

    it('ended for the subscription the save holds still revokes it, and a re-delivery is free', async () => {
        await kv.set('save:kaito', { character: { name: 'kaito', patreon: supporter(OLD_REF, { since: 1_234 }) } });

        const out = await deliver(subscriptionWebhook('recurring-payment.ended', OLD_REF));

        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body, { ok: true, action: 'entitled', active: false });
        const flag = await flagOf('kaito');
        assert.equal(flag?.userId, OLD_REF);
        assert.equal(flag?.active, false);
        assert.equal(flag?.tier, 'shinobi-supporter');
        assert.equal(flag?.since, 1_234, 'the original since survives the lapse');

        const saveAfter = await kv.get('save:kaito');
        const again = await deliver(subscriptionWebhook('recurring-payment.ended', OLD_REF));
        assert.deepEqual(again.body, { ok: true, action: 'entitled', active: false });
        assert.deepEqual(await kv.get('save:kaito'), saveAfter, 'a redelivered ended does not bump the version');
    });

    it('an ended with no save is acknowledged, and a later registrant is safe from the retry', async () => {
        const out = await deliver(subscriptionWebhook('recurring-payment.ended', OLD_REF));

        assert.equal(out.statusCode, 200, 'no retry: there is nothing to revoke');
        assert.deepEqual(out.body, NO_SAVE);
        assert.equal(await kv.get('save:kaito'), null, 'nothing was created for the name');
        assert.ok(logged.some((entry) => entry.level === 'log'
            && entry.text.includes('[tebex] subscription ended with no save')
            && entry.text.includes(OLD_REF)));
        assert.ok(!logged.some((entry) => entry.level === 'error'), 'the normal tail of a deletion is not an error');

        // Tebex redelivers anyway, after someone has registered the name and subscribed.
        await kv.set('save:kaito', { character: { name: 'kaito', patreon: supporter(NEW_REF) } });
        const saveBefore = await kv.get('save:kaito');
        const retry = await deliver(subscriptionWebhook('recurring-payment.ended', OLD_REF));
        assert.deepEqual(retry.body, NOT_ON_SAVE);
        assert.deepEqual(await kv.get('save:kaito'), saveBefore);
    });

    it('a renewal with no save still asks Tebex to retry', async () => {
        for (const type of ['recurring-payment.started', 'recurring-payment.renewed', 'recurring-payment.cancellation.aborted']) {
            const out = await deliver(subscriptionWebhook(type, NEW_REF));
            assert.equal(out.statusCode, 500, type);
            assert.deepEqual(out.body, { error: 'No save to entitle; will retry.' }, type);
        }
    });

    it('a live admin comp survives ended, even one made over that same subscription', async () => {
        // A comp made from scratch carries no reference.
        await kv.set('save:kaito', { character: { name: 'kaito' } });
        await comp('kaito', { active: true, days: 30 });
        // A comp made over a paying subscriber keeps their reference as userId.
        await kv.set('save:hana', { character: { name: 'hana', patreon: supporter(OLD_REF) } });
        await comp('hana', { active: true, days: 30 });
        assert.equal((await flagOf('hana'))?.userId, OLD_REF, 'the comp keeps the paid reference');

        for (const name of ['kaito', 'hana']) {
            const saveBefore = await kv.get(`save:${name}`);
            const out = await deliver(subscriptionWebhook('recurring-payment.ended', OLD_REF, name));
            assert.equal(out.statusCode, 200, name);
            assert.deepEqual(out.body, ADMIN_COMP, name);
            assert.deepEqual(await kv.get(`save:${name}`), saveBefore, `${name}'s comp is untouched`);
        }
    });

    it('a lapsed admin comp over the same subscription is revoked as usual', async () => {
        await kv.set('save:kaito', {
            character: { name: 'kaito', patreon: supporter(OLD_REF, { source: 'admin', expiresAt: Date.now() - 60_000 }) },
        });

        const out = await deliver(subscriptionWebhook('recurring-payment.ended', OLD_REF));

        assert.deepEqual(out.body, { ok: true, action: 'entitled', active: false });
        const flag = await flagOf('kaito');
        assert.equal(flag?.userId, OLD_REF);
        assert.equal(flag?.active, false);
    });

    it('renewals are never refused: a new subscription entitles over a lapsed flag or a live comp', async () => {
        // Their old subscription ended; they subscribe again.
        await kv.set('save:kaito', { character: { name: 'kaito', patreon: supporter(OLD_REF, { active: false }) } });
        const started = await deliver(subscriptionWebhook('recurring-payment.started', NEW_REF));
        assert.deepEqual(started.body, { ok: true, action: 'entitled', active: true });
        assert.equal((await flagOf('kaito'))?.userId, NEW_REF);
        assert.equal((await flagOf('kaito'))?.active, true);

        // A comped player starts paying: the paid flag replaces the comp.
        await kv.set('save:hana', { character: { name: 'hana' } });
        await comp('hana', { active: true, days: 30 });
        const renewed = await deliver(subscriptionWebhook('recurring-payment.renewed', NEW_REF, 'hana'));
        assert.deepEqual(renewed.body, { ok: true, action: 'entitled', active: true });
        const flag = await flagOf('hana');
        assert.equal(flag?.userId, NEW_REF);
        assert.equal(flag?.active, true);
        assert.equal(flag?.expiresAt, undefined);
    });

    it('a redelivered renewal for the subscription the save holds is still a free no-op', async () => {
        await kv.set('save:kaito', { character: { name: 'kaito', patreon: supporter(NEW_REF) } });
        const saveBefore = await kv.get('save:kaito');

        const out = await deliver(subscriptionWebhook('recurring-payment.renewed', NEW_REF));

        assert.deepEqual(out.body, { ok: true, action: 'entitled', active: true });
        assert.deepEqual(await kv.get('save:kaito'), saveBefore);
    });
});
