import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'image-upload-limit-test-secret';
process.env.ADMIN_PASSWORD = 'image-upload-limit-admin';

let kv: typeof import('./_storage.js').kv;
let handler: (req: unknown, res: unknown) => Promise<unknown>;
let images: typeof import('./images.js');
let issueToken: typeof import('./_auth.js').issuePlayerToken;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

before(async () => {
    ({ kv } = await import('./_storage.js'));
    images = (await import('./images.js')) as unknown as typeof images;
    handler = images.default as unknown as typeof handler;
    issueToken = (await import('./_auth.js')).issuePlayerToken;
});

async function account(name: string) {
    await kv.set(`auth:${name}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
    return issueToken(name)!;
}

async function upload(headers: Record<string, string>, ip: string, id = `pet:${randomUUID()}`, image = PNG) {
    const out = { status: 200 };
    const res = {
        setHeader() { return res; },
        status(code: number) { out.status = code; return res; },
        json() { return res; },
        end() { return res; },
    };
    await handler({ method: 'POST', body: { id, image }, query: {}, headers, socket: { remoteAddress: ip } }, res);
    return out.status;
}

// One mock per test, moved by assignment (a second t.mock.method on Date.now leaks).
function mockClock(t: import('node:test').TestContext, start: number) {
    let now = start;
    t.mock.method(Date, 'now', () => now);
    return { advance(ms: number) { now += ms; } };
}

test('a player gets the burst allowance, then 429, and the day cap holds across windows', async (t) => {
    const clock = mockClock(t, Date.UTC(2031, 0, 5, 0, 0));
    const headers = { 'x-player-token': await account('uploader') };
    const ip = '10.60.0.1';
    for (let i = 0; i < images.IMAGE_UPLOAD_BURST_LIMIT; i++) assert.equal(await upload(headers, ip), 200, `upload ${i + 1}`);
    assert.equal(await upload(headers, ip), 429, 'burst over');

    // Two more burst windows bring the day total to 3 x 40 = 120, the daily cap.
    for (let w = 0; w < 2; w++) {
        clock.advance(images.IMAGE_UPLOAD_BURST_WINDOW_MS);
        for (let i = 0; i < images.IMAGE_UPLOAD_BURST_LIMIT; i++) assert.equal(await upload(headers, ip), 200);
    }
    assert.equal(images.IMAGE_UPLOAD_DAILY_LIMIT, 3 * images.IMAGE_UPLOAD_BURST_LIMIT, 'this test assumes the day cap is three bursts');
    clock.advance(images.IMAGE_UPLOAD_BURST_WINDOW_MS);
    assert.equal(await upload(headers, ip), 429, 'daily cap reached even in a fresh burst window');
});

test('rejected uploads do not spend the budget', async () => {
    const headers = { 'x-player-token': await account('careful') };
    const ip = '10.60.1.1';
    for (let i = 0; i < images.IMAGE_UPLOAD_BURST_LIMIT + 10; i++) {
        assert.equal(await upload(headers, ip, `pet:${randomUUID()}`, 'not-an-image'), 400);
    }
    assert.equal(await upload(headers, ip), 200, 'malformed requests never charged the budget');
});

test('new accounts on one address cannot each mint a fresh allowance', async () => {
    const ip = '10.60.2.1';
    let ok = 0;
    for (let a = 0; a < 4; a++) {
        const headers = { 'x-player-token': await account(`guestlike${a}`) };
        for (let i = 0; i < images.IMAGE_UPLOAD_BURST_LIMIT; i++) if (await upload(headers, ip) === 200) ok += 1;
    }
    assert.equal(ok, images.IMAGE_UPLOAD_BURST_LIMIT * 3, 'the address cap is three accounts\' worth per window');
});

test('admins are exempt', async () => {
    const headers = { 'x-admin-password': 'image-upload-limit-admin' };
    for (let i = 0; i < images.IMAGE_UPLOAD_BURST_LIMIT + 5; i++) assert.equal(await upload(headers, '10.60.3.1', `item:catalog-${i}`), 200);
});
