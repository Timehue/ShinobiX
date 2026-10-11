import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-chat-post-reply-test-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Line = { author?: string; text?: string; system?: boolean };
let chat: Handler;
let blocks: Handler;
let issuePlayerToken: (name: string) => string | null;
let kv: typeof import('../_storage.js').kv;

function response() {
    const out: { statusCode: number; body?: unknown } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function request(player: string, method: string, body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) {
    return {
        method, body, query,
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(player)! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    chat = (await import('./chat.js')).default as unknown as Handler;
    blocks = (await import('../player/blocks.js')).default as unknown as Handler;
    for (const name of ['alicereply', 'bobreply']) {
        await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village: 'Frostfang', level: 10 } });
    }
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('the POST reply hides lines from players the poster blocks, exactly as GET does', async () => {
    const bobPost = response();
    await chat(request('bobreply', 'POST', { author: 'bobreply', text: 'line from bob' }, { village: 'Frostfang' }), bobPost.res);
    assert.equal(bobPost.out.statusCode, 200);

    const block = response();
    await blocks(request('alicereply', 'POST', { target: 'bobreply', blocked: true }), block.res);
    assert.equal(block.out.statusCode, 200);

    // A World Herald line, appended the way api/_announce.ts does. A block
    // never hides it.
    const key = 'chat:village:frostfang';
    const existing = await kv.get<Line[]>(key) ?? [];
    await kv.set(key, [...existing, { author: 'World Herald', text: 'herald line', ts: Date.now(), system: true }]);

    const alicePost = response();
    await chat(request('alicereply', 'POST', { author: 'alicereply', text: 'line from alice' }, { village: 'Frostfang' }), alicePost.res);
    assert.equal(alicePost.out.statusCode, 200);
    const reply = alicePost.out.body as Line[];
    assert.equal(reply.some((line) => line.author === 'bobreply'), false, 'the poster must not see a blocked author in the POST reply');
    assert.equal(reply.some((line) => line.author === 'alicereply' && line.text === 'line from alice'), true);
    assert.equal(reply.some((line) => line.system === true && line.text === 'herald line'), true);

    // The reply and the next GET agree, so the list does not flicker.
    const aliceRead = response();
    await chat(request('alicereply', 'GET', {}, { village: 'Frostfang' }), aliceRead.res);
    assert.deepEqual(aliceRead.out.body, reply);

    // The block is one-way: bob's own reply still carries every line.
    const bobAgain = response();
    await chat(request('bobreply', 'POST', { author: 'bobreply', text: 'bob again' }, { village: 'Frostfang' }), bobAgain.res);
    assert.equal(bobAgain.out.statusCode, 200);
    const bobView = bobAgain.out.body as Line[];
    assert.equal(bobView.some((line) => line.author === 'alicereply'), true);
    assert.equal(bobView.filter((line) => line.author === 'bobreply').length, 2);

    // And the stored transcript itself is untouched by the filter.
    const stored = await kv.get<Line[]>(key) ?? [];
    assert.equal(stored.some((line) => line.text === 'line from bob'), true);
});

test('a block list that cannot be read refuses the post before anything is stored', async () => {
    // The reply filter needs the poster's block list. Reading it AFTER the
    // write would answer 500 for a line already in the transcript, and the
    // player's retry would post it twice.
    const key = 'chat:village:frostfang';
    const before = JSON.stringify(await kv.get<Line[]>(key) ?? []);
    const realGet = kv.get.bind(kv);
    kv.get = (async (k: string) => {
        if (k.startsWith('player-blocks:')) throw new Error('injected block-list read failure');
        return realGet(k);
    }) as typeof kv.get;
    const post = response();
    try {
        await chat(request('alicereply', 'POST', { author: 'alicereply', text: 'never stored' }, { village: 'Frostfang' }), post.res);
    } finally {
        kv.get = realGet as typeof kv.get;
    }
    assert.equal(post.out.statusCode, 500);
    assert.equal(JSON.stringify(await kv.get<Line[]>(key) ?? []), before, 'a refused post must leave the transcript as it was');
});
