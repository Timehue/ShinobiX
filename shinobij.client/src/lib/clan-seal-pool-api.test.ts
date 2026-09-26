import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { hasPendingSealDistribution, hasPendingSealDonation, postSealDistribution, postSealDonation } from './clan-seal-pool-api';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalFetch = globalThis.fetch;
let sent: Array<Record<string, unknown>> = [];
let answers: Array<() => Response> = [];
let sequence = 0;

beforeEach(() => {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, value); },
        removeItem: (key: string) => { entries.delete(key); },
    } });
    sent = [];
    answers = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        const next = answers.shift();
        if (!next) throw new Error('no answer queued');
        return next();
    }) as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
});

const json = (status: number, body: Record<string, unknown>) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const lost = () => { throw new TypeError('Failed to fetch'); };

test('a donation whose answer was lost is resent with the same id until the server answers finally', async () => {
    const donor = `vanguard${++sequence}`;
    answers.push(lost, json(503, { error: 'Donation is busy', retryable: true }), json(200, { ok: true, donated: 10 }));
    await assert.rejects(() => postSealDonation(donor, 'Ashwind', 10));
    assert.equal(hasPendingSealDonation(donor, 'Ashwind', 10), true, 'the local cap check must let the retry through');
    assert.equal((await postSealDonation(donor, 'Ashwind', 10)).ok, false);
    assert.equal((await postSealDonation(donor, 'Ashwind', 10)).ok, true);
    assert.equal(new Set(sent.map((body) => body.requestId)).size, 1, 'one donation, one id, three sends');
    assert.equal(hasPendingSealDonation(donor, 'Ashwind', 10), false);

    answers.push(json(200, { ok: true, donated: 10 }));
    await postSealDonation(donor, 'Ashwind', 10);
    assert.notEqual(sent[3].requestId, sent[0].requestId, 'the next donation is a new one');
});

test('a gift keeps its id through a 500 and releases it on a refusal', async () => {
    const founder = `founder${++sequence}`;
    answers.push(json(500, { error: 'Internal server error.' }), json(400, { error: 'Not enough Seals in the clan pool.' }));
    assert.equal((await postSealDistribution(founder, 'Ashwind', 'Kaya', 30)).ok, false);
    assert.equal(hasPendingSealDistribution(founder, 'ashwind', 'kaya', 30), true);
    assert.equal((await postSealDistribution(founder, 'Ashwind', 'Kaya', 30)).ok, false);
    assert.equal(sent[0].requestId, sent[1].requestId);
    assert.equal(hasPendingSealDistribution(founder, 'Ashwind', 'Kaya', 30), false, 'a refusal is final');
    assert.deepEqual(Object.keys(sent[0]).sort(), ['amount', 'leaderName', 'recipientName', 'requestId']);
});

test('an administrator-pending gift keeps its id, so pressing again repeats that answer', async () => {
    const founder = `founder${++sequence}`;
    answers.push(json(409, { error: 'An administrator must reconcile it.', reconcile: true }), json(409, { error: 'An administrator must reconcile it.', reconcile: true }));
    await postSealDistribution(founder, 'Ashwind', 'Kaya', 30);
    await postSealDistribution(founder, 'Ashwind', 'Kaya', 30);
    assert.equal(sent[0].requestId, sent[1].requestId);
    assert.equal(hasPendingSealDistribution(founder, 'Ashwind', 'Kaya', 30), true);
});
