import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mutateJutsuRyoTraining } from './jutsu-ryo-api';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('jutsu ryo client mutation', () => {
    it('retries a transient save-lock response with the same idempotency key', async () => {
        const bodies: string[] = [];
        let calls = 0;
        globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
            calls += 1;
            bodies.push(String(init?.body ?? ''));
            if (calls === 1) {
                return new Response(JSON.stringify({ error: 'Your save is being updated. Retrying is safe.' }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ character: { name: 'Tester' }, activeJutsuTraining: null, _saveVersion: 4 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }) as typeof fetch;

        const result = await mutateJutsuRyoTraining('Tester', 'complete', { serverToken: 'token' });

        assert.equal(calls, 2);
        assert.equal(bodies[0], bodies[1], 'retry must reuse the original requestId');
        assert.equal(result.character?.name, 'Tester');
        assert.equal(result._saveVersion, 4);
    });

    it('does not retry a permanent validation rejection', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            return new Response(JSON.stringify({ error: 'jutsu-at-training-cap' }), {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
            });
        }) as typeof fetch;

        const result = await mutateJutsuRyoTraining('Tester', 'start', { jutsuId: 'fireball' });

        assert.equal(calls, 1);
        assert.equal(result.error, 'jutsu-at-training-cap');
    });

    it('waits out a short rate-limit hint before its one retry', async () => {
        const sentAt: number[] = [];
        globalThis.fetch = (async () => {
            sentAt.push(Date.now());
            return sentAt.length === 1
                ? new Response(JSON.stringify({ error: 'Rate limit exceeded.', retryAfterMs: 400 }), { status: 429 })
                : new Response(JSON.stringify({ character: { name: 'Tester' }, _saveVersion: 2 }), { status: 200 });
        }) as typeof fetch;

        const result = await mutateJutsuRyoTraining('Tester', 'advance', { serverToken: 'token' });

        assert.equal(sentAt.length, 2);
        assert.ok(sentAt[1] - sentAt[0] >= 400, `retried after ${sentAt[1] - sentAt[0]}ms, inside the window`);
        assert.equal(result.character?.name, 'Tester');
    });

    it('does not burn a retry on a long rate-limit hint and never shows the raw limiter text', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            return new Response(JSON.stringify({ error: 'Rate limit exceeded.', retryAfterMs: 42_000 }), { status: 429 });
        }) as typeof fetch;

        const result = await mutateJutsuRyoTraining('Tester', 'start', { jutsuId: 'fireball' });

        assert.equal(calls, 1);
        assert.equal(result.error, 'Jutsu training is busy. Try again in 42s.');
    });
});
