import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'social-authority-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
let chat: Handler;
let messages: Handler;
let blocks: Handler;
let friends: Handler;
let issuePlayerToken: (name: string) => string | null;
let kv: typeof import('./_storage.js').kv;

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
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    chat = (await import('./village/chat.js')).default as unknown as Handler;
    messages = (await import('./messages.js')).default as unknown as Handler;
    blocks = (await import('./player/blocks.js')).default as unknown as Handler;
    friends = (await import('./player/friends.js')).default as unknown as Handler;
    for (const [name, village] of [['alicechat', 'Frostfang'], ['bobchat', 'Frostfang'], ['carachat', 'Moonshadow']]) {
        await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, level: 10 } });
    }
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('village membership and player blocks are enforced across chat and direct messages', async () => {
    const rivalRead = response();
    await chat(request('carachat', 'GET', {}, { village: 'Frostfang' }), rivalRead.res);
    assert.equal(rivalRead.out.statusCode, 403);

    const post = response();
    await chat(request('bobchat', 'POST', { author: 'bobchat', text: 'hello village' }, { village: 'Frostfang' }), post.res);
    assert.equal(post.out.statusCode, 200);

    const beforeBlock = response();
    await chat(request('alicechat', 'GET', {}, { village: 'Frostfang' }), beforeBlock.res);
    assert.equal(beforeBlock.out.statusCode, 200);
    assert.equal((beforeBlock.out.body as Array<{ author?: string }>).some((entry) => entry.author === 'bobchat'), true);

    const block = response();
    await blocks(request('alicechat', 'POST', { target: 'bobchat', blocked: true }), block.res);
    assert.equal(block.out.statusCode, 200);

    const afterBlock = response();
    await chat(request('alicechat', 'GET', {}, { village: 'Frostfang' }), afterBlock.res);
    assert.equal((afterBlock.out.body as Array<{ author?: string }>).some((entry) => entry.author === 'bobchat'), false);

    const dm = response();
    await messages(request('bobchat', 'POST', { to: 'alicechat', text: 'bypass attempt' }), dm.res);
    assert.equal(dm.out.statusCode, 403);
});

test('explicit friends stay separate from the backwards-compatible following list', async () => {
    const follow = response();
    await friends(request('alicechat', 'POST', { playerName: 'alicechat', targetName: 'bobchat' }), follow.res);
    assert.equal(follow.out.statusCode, 200);
    assert.deepEqual((follow.out.body as { following: string[] }).following, ['bobchat']);

    const addFriend = response();
    await friends(request('alicechat', 'POST', { playerName: 'alicechat', targetName: 'carachat', list: 'friends' }), addFriend.res);
    assert.equal(addFriend.out.statusCode, 200);
    assert.deepEqual((addFriend.out.body as { friends: string[] }).friends, ['carachat']);

    const read = response();
    await friends(request('alicechat', 'GET', {}, { playerName: 'alicechat' }), read.res);
    assert.equal(read.out.statusCode, 200);
    assert.deepEqual(read.out.body, { following: ['bobchat'], friends: ['carachat'] });

    const removeFriend = response();
    await friends(request('alicechat', 'DELETE', { playerName: 'alicechat', targetName: 'carachat', list: 'friends' }), removeFriend.res);
    assert.equal(removeFriend.out.statusCode, 200);
    assert.deepEqual((removeFriend.out.body as { friends: string[] }).friends, []);
});
