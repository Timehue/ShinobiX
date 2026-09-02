import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    TEBEX_CHECKOUT_API,
    cancelTebexSubscription,
    isRecurringReference,
    subscriptionReferenceFromSave,
} from './_cancel-subscription.js';

/*
 * Cancelling a deleted account's subscription.
 *
 * The failure this guards against is a billing one, not a crash: someone
 * deletes their account, the subscription keeps renewing, and they go on paying
 * monthly for a game they no longer have. Every branch below is about making
 * sure that either the charge stops or a human is told it did not.
 */

const REF = 'tbx-r-55fff4107740a1f40d844ff89607557f45bfafb3';
const ORIGINAL_KEY = process.env.TEBEX_CHECKOUT_API_KEY;

beforeEach(() => { process.env.TEBEX_CHECKOUT_API_KEY = 'test-api-key'; });
afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.TEBEX_CHECKOUT_API_KEY;
    else process.env.TEBEX_CHECKOUT_API_KEY = ORIGINAL_KEY;
});

/** Minimal fetch double that records what it was called with. */
function stubFetch(status: number, body = '') {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fn = (async (url: unknown, init: unknown) => {
        calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
        return {
            status,
            text: async () => body,
        } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fn, calls };
}

describe('finding the subscription on a save', () => {
    it('reads an active recurring reference', () => {
        const save = { character: { patreon: { active: true, userId: REF } } };
        assert.equal(subscriptionReferenceFromSave(save), REF);
    });

    it('ignores an inactive flag — there is nothing left to cancel', () => {
        assert.equal(subscriptionReferenceFromSave({ character: { patreon: { active: false, userId: REF } } }), null);
    });

    it('ignores an admin comp, which has no recurring payment behind it', () => {
        // Comps are granted by an operator and carry a non-reference userId;
        // sending that to Tebex would be a pointless 404 and a parked orphan.
        const comp = { character: { patreon: { active: true, userId: 'admin-grant', expiresAt: Date.now() + 1000 } } };
        assert.equal(subscriptionReferenceFromSave(comp), null);
    });

    it('survives every shape a missing save can take', () => {
        for (const value of [null, undefined, {}, { character: {} }, { character: { patreon: null } }, 'nope']) {
            assert.equal(subscriptionReferenceFromSave(value), null, JSON.stringify(value));
        }
    });

    it('recognises only real recurring references', () => {
        assert.equal(isRecurringReference(REF), true);
        assert.equal(isRecurringReference('tbx-r-'), false, 'prefix alone is not a reference');
        assert.equal(isRecurringReference('tbx-p-123'), false, 'a payment id is not a subscription');
        assert.equal(isRecurringReference(''), false);
        assert.equal(isRecurringReference(12345), false);
    });
});

describe('cancelling at Tebex', () => {
    it('sends a DELETE with Basic auth — api key as user, blank password', async () => {
        const { fn, calls } = stubFetch(204);
        const outcome = await cancelTebexSubscription(REF, fn);
        assert.equal(outcome.ok, true);

        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.url, `${TEBEX_CHECKOUT_API}/recurring-payments/${REF}`);
        assert.equal(calls[0]!.init.method, 'DELETE');
        const auth = String((calls[0]!.init.headers as Record<string, string>).Authorization);
        assert.match(auth, /^Basic /);
        assert.equal(Buffer.from(auth.slice(6), 'base64').toString(), 'test-api-key:', 'password must be blank');
    });

    it('treats 404 as success — already gone is the state we wanted', () => {
        // Reporting this as a failure would park a reference no human needs to
        // act on, which trains operators to ignore the orphan list.
        return stubFetchAssert(404, true);
    });

    it('reports a rejection with its status, so the log names the cause', async () => {
        const { fn } = stubFetch(403, 'forbidden');
        const outcome = await cancelTebexSubscription(REF, fn);
        assert.equal(outcome.ok, false);
        if (outcome.ok) return;
        assert.equal(outcome.reason, 'rejected');
        assert.equal(outcome.status, 403);
    });

    it('fails closed when the privileged key is unset', async () => {
        delete process.env.TEBEX_CHECKOUT_API_KEY;
        const { fn, calls } = stubFetch(204);
        const outcome = await cancelTebexSubscription(REF, fn);
        assert.equal(outcome.ok, false);
        if (outcome.ok) return;
        assert.equal(outcome.reason, 'unconfigured');
        assert.equal(calls.length, 0, 'must not call Tebex without credentials');
    });

    it('never throws when Tebex is unreachable — deletion must still proceed', async () => {
        const boom = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
        const outcome = await cancelTebexSubscription(REF, boom);
        assert.equal(outcome.ok, false);
        if (outcome.ok) return;
        assert.equal(outcome.reason, 'unreachable');
    });

    it('refuses a reference that is not a subscription', async () => {
        const { fn, calls } = stubFetch(204);
        const outcome = await cancelTebexSubscription('tbx-p-not-a-sub', fn);
        assert.equal(outcome.ok, false);
        assert.equal(calls.length, 0, 'must not send a request for a non-subscription id');
    });
});

async function stubFetchAssert(status: number, expectOk: boolean) {
    const { fn } = stubFetch(status);
    const outcome = await cancelTebexSubscription(REF, fn);
    assert.equal(outcome.ok, expectOk, `status ${status} should be ok=${expectOk}`);
}
