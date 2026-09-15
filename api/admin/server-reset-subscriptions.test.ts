/*
 * A full reset deletes every ordinary player's save, and the save holds the
 * only copy of a supporter's Tebex recurring-payment reference (issue #181).
 * Left alone, the subscription keeps billing, and its next renewal hands the
 * perks to whoever registers that name next.
 *
 * These drive the real handler over the in-memory store. They pin three things:
 * the dry run names the subscriptions without touching Tebex; the real reset
 * cancels each one while its save still exists; and a failed cancellation is
 * parked somewhere the reset does not delete, and reported.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'server-reset-subscription-test';
process.env.TEBEX_CHECKOUT_API_KEY = 'test-checkout-key';

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
type TebexCall = { url: string; method: string; saveStillThere: boolean };

const REF = 'tbx-r-55fff4107740a1f40d844ff89607557f45bfafb3';
const PROTECTED_REF = 'tbx-r-0000000000000000000000000000000000000001';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let orphanedKey: string;
const originalFetch = globalThis.fetch;
let requestSeq = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    orphanedKey = (await import('../tebex/_cancel-subscription.js')).ORPHANED_SUBSCRIPTIONS_KEY;
    handler = (await import('./server-reset.js')).default as unknown as Handler;
});

beforeEach(async () => {
    process.env.TEBEX_CHECKOUT_API_KEY = 'test-checkout-key';
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set('save:supporter', { character: { name: 'supporter', patreon: { active: true, userId: REF } } });
    // A comp has no payment behind it, so there is nothing at Tebex to cancel.
    await kv.set('save:comped', { character: { name: 'comped', patreon: { active: true, source: 'admin' } } });
    await kv.set('save:plainplayer', { character: { name: 'plainplayer' } });
    // A protected account keeps its save, so its subscription must be left alone.
    await kv.set('save:rill', { character: { name: 'rill', patreon: { active: true, userId: PROTECTED_REF } } });
});

after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.TEBEX_CHECKOUT_API_KEY;
});

/** Stand in for Tebex, recording whether the supporter's save existed at call time. */
function stubTebex(status: number): TebexCall[] {
    const calls: TebexCall[] = [];
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
        calls.push({
            url: String(url),
            method: String(init?.method),
            saveStillThere: (await kv.get('save:supporter')) !== null,
        });
        return { status, text: async () => '' } as unknown as Response;
    }) as typeof fetch;
    return calls;
}

async function reset(body: Record<string, unknown> = {}): Promise<ResponseOut> {
    const out: ResponseOut = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    const req = {
        method: 'POST',
        body,
        query: {},
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        // A fresh address per call: the reset is rate-limited to 5/hour per client.
        socket: { remoteAddress: `10.0.0.${++requestSeq}` },
    };
    await handler(req as never, res as never);
    return out;
}

async function orphanEntry(reference: string): Promise<Record<string, unknown> | null> {
    const hash = await kv.hgetall<Record<string, unknown>>(orphanedKey);
    const raw = hash?.[reference];
    if (raw === undefined || raw === null) return null;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
}

describe('full server reset and Tebex subscriptions', () => {
    it('the dry run names the paid subscriptions and never calls Tebex', async () => {
        const calls = stubTebex(204);
        const out = await reset({ dryRun: true });

        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body?.subscriptionsToCancel, ['supporter'],
            'only the paid subscription on a save being deleted: not the comp, not the protected account');
        assert.equal(out.body?.subscriptionCancelConfigured, true);
        assert.equal(calls.length, 0, 'a preview must not cancel anything');
        assert.notEqual(await kv.get('save:supporter'), null);
    });

    it('cancels a paid subscription while its save still exists, then deletes the save', async () => {
        const calls = stubTebex(204);
        const out = await reset();

        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body?.subscriptionsCancelled, ['supporter']);
        assert.deepEqual(out.body?.subscriptionsParked, []);
        assert.equal(calls.length, 1, 'one cancellation, and none for the protected account');
        assert.equal(calls[0]!.url.endsWith(`/recurring-payments/${REF}`), true);
        assert.equal(calls[0]!.method, 'DELETE');
        assert.equal(calls[0]!.saveStillThere, true, 'cancellation must run before the sweep');

        assert.equal(await kv.get('save:supporter'), null);
        assert.notEqual(await kv.get('save:rill'), null);
        assert.equal(await orphanEntry(REF), null, 'a successful cancellation parks nothing');
    });

    it('a failed cancellation is parked where the reset cannot delete it, and the reset completes', async () => {
        stubTebex(500);
        const out = await reset();

        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body?.subscriptionsCancelled, []);
        assert.deepEqual(out.body?.subscriptionsParked, [{ slug: 'supporter', reason: 'rejected' }]);
        const entry = await orphanEntry(REF);
        assert.equal(entry?.slug, 'supporter', 'the reference must outlive the save for a human to cancel');
        assert.equal(await kv.get('save:supporter'), null, 'fail-open: the reset still runs');
    });

    it('without the cancel key, the dry run says so and the reset parks every subscription', async () => {
        delete process.env.TEBEX_CHECKOUT_API_KEY;
        const calls = stubTebex(204);

        const preview = await reset({ dryRun: true });
        assert.equal(preview.body?.subscriptionCancelConfigured, false);

        const out = await reset();
        assert.deepEqual(out.body?.subscriptionsParked, [{ slug: 'supporter', reason: 'unconfigured' }]);
        assert.equal(calls.length, 0, 'no credentials, no request');
        assert.equal((await orphanEntry(REF))?.reason, 'unconfigured');
    });
});
