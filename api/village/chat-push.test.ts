/*
 * Socket hints from every writer of the tavern and clan chat: the player POSTs,
 * both World Herald writers and the moderation delete. Each must hint the
 * right room after its write lands, never carry the text, and stay silent
 * when the write was refused or skipped. Real handlers, in-memory KV.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_PUSH_EVENT, chatPushRoom } from '../../shared/chat-push.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-chat-push-test-secret-32-bytes!!';
process.env.ADMIN_PASSWORD = 'village-chat-push-test-admin';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { status: number; body: unknown };

let villageChat: Handler;
let clanSend: Handler;
let moderation: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let setRealtimeEmitter: typeof import('../_realtime/notify.js').setRealtimeEmitter;
let announce: typeof import('../_announce.js');
let authKey: typeof import('../player-auth.js').authKey;
const emitted: { room: string; event: string; payload: unknown }[] = [];
let ipCounter = 0;

const VILLAGE = 'Frostfang Village';
const ROOM = chatPushRoom('village', 'frostfang-village');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ setRealtimeEmitter } = await import('../_realtime/notify.js'));
    ({ authKey } = await import('../player-auth.js'));
    announce = await import('../_announce.js');
    villageChat = (await import('./chat.js')).default as unknown as Handler;
    clanSend = (await import('../clan/chat/send.js')).default as unknown as Handler;
    moderation = (await import('../admin/moderation.js')).default as unknown as Handler;
});

beforeEach(async () => {
    emitted.length = 0;
    setRealtimeEmitter((room, event, payload) => { emitted.push({ room, event, payload }); });
    for (const pattern of ['chat:village:*', 'clan-chat:*', 'auth:*', 'save:*', 'mod:silence:*']) {
        for (const key of await kv.keys(pattern)) await kv.del(key);
    }
    await kv.set('save:pushspeaker', { _saveVersion: 1, character: { name: 'pushspeaker', village: VILLAGE, clan: 'Storm Clan', level: 12 } });
    await kv.set('save:pushrival', { _saveVersion: 1, character: { name: 'pushrival', village: 'Moonshadow Village', level: 12 } });
    await kv.set('save:pushguest', { _saveVersion: 1, character: { name: 'pushguest', village: VILLAGE, level: 2 } });
    await kv.set(authKey('pushguest'), { guest: true });
});

after(() => {
    setRealtimeEmitter(null);
    for (const key of ['SHINOBIX_QA_MEMORY_KV', 'SESSION_SECRET', 'ADMIN_PASSWORD']) delete process.env[key];
});

async function invoke(target: Handler, method: 'GET' | 'POST', headers: Record<string, string>, query: Record<string, unknown>, body?: unknown): Promise<Out> {
    const out: Out = { status: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (status: number) => { out.status = status; return res; },
        json: (payload: unknown) => { out.body = payload; return res; },
        end: () => res,
    };
    await target({
        method, query, body,
        headers: { 'content-type': 'application/json', ...headers },
        socket: { remoteAddress: `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` },
    } as never, res as never);
    return out;
}

const as = (player: string) => ({ 'x-player-name': player, 'x-player-token': issuePlayerToken(player)! });
const post = (player: string, text: string, village = VILLAGE) =>
    invoke(villageChat, 'POST', as(player), { village }, { author: player, text });
const chatHints = () => emitted.filter((e) => e.event === CHAT_PUSH_EVENT);

describe('tavern chat push hints', () => {
    it('hints the village room once a post is stored, without the text', async () => {
        const out = await post('pushspeaker', 'Lanterns are lit tonight.');
        assert.equal(out.status, 200);
        const hints = chatHints();
        assert.equal(hints.length, 1);
        assert.equal(hints[0].room, ROOM);
        const payload = hints[0].payload as { channel: string; key: string; ts: number };
        assert.equal(payload.channel, 'village');
        assert.equal(payload.key, 'frostfang-village');
        const stored = (await kv.get<Array<{ ts: number }>>('chat:village:frostfang-village'))!;
        assert.equal(payload.ts, stored[stored.length - 1].ts, 'the hint names the stored line');
        assert.equal(JSON.stringify(payload).includes('Lanterns'), false, 'the text never rides the socket');
    });

    it('stays silent when the post is refused', async () => {
        assert.equal((await post('pushrival', 'Hello, rivals.')).status, 403, 'not a member');
        assert.equal((await post('pushguest', 'Hi all')).status, 403, 'unclaimed guest');
        await kv.set('mod:silence:pushspeaker', { until: Date.now() + 60_000, reason: 'test' });
        const silenced = await post('pushspeaker', 'Can anyone hear me?');
        assert.equal(silenced.status, 403, 'silenced');
        await kv.del('mod:silence:pushspeaker');
        assert.equal((await invoke(villageChat, 'POST', {}, { village: VILLAGE }, { author: 'pushspeaker', text: 'anon' })).status, 401);
        assert.deepEqual(chatHints(), []);
    });

    it('hints every village for a broadcast herald line, once per receipt', async () => {
        const villages = ['stormveil-village', 'ashen-leaf-village', 'frostfang-village', 'moonshadow-village'];
        const first = await announce.announce({ type: 'test_event', title: 'Omen', message: 'The sky splits.', importance: 'high' } as never);
        assert.ok(first, 'the announcement was created');
        assert.deepEqual(chatHints().map((h) => h.room).sort(), villages.map((v) => chatPushRoom('village', v)).sort());
    });

    it('hints one village for a local herald line, and not again for a replayed receipt', async () => {
        assert.equal(await announce.postVillageHerald(VILLAGE, 'Awakening', 'A legacy stirs.', { receiptId: 'push-r1' }), true);
        assert.deepEqual(chatHints().map((h) => h.room), [ROOM]);
        emitted.length = 0;
        assert.equal(await announce.postVillageHerald(VILLAGE, 'Awakening', 'A legacy stirs.', { receiptId: 'push-r1' }), true);
        assert.deepEqual(chatHints(), [], 'a deduplicated write changed nothing to fetch');
    });

    it('hints the village when a moderator deletes a line', async () => {
        await post('pushspeaker', 'something to remove');
        const stored = (await kv.get<Array<{ author: string; ts: number }>>('chat:village:frostfang-village'))!;
        emitted.length = 0;
        const out = await invoke(moderation, 'POST', { 'x-admin-password': process.env.ADMIN_PASSWORD! }, {},
            { kind: 'delete-chat-message', village: VILLAGE, author: stored[0].author, ts: stored[0].ts });
        assert.equal(out.status, 200);
        assert.deepEqual(chatHints().map((h) => h.room), [ROOM]);
    });
});

describe('clan chat push hints', () => {
    const send = (player: string, clan: string, text: string) =>
        invoke(clanSend, 'POST', as(player), {}, { playerName: player, clan, text });

    it('hints the clan room once a message is stored, without the text', async () => {
        const out = await send('pushspeaker', 'Storm Clan', 'Rally at the gate.');
        assert.equal(out.status, 200);
        const hints = chatHints();
        assert.equal(hints.length, 1);
        assert.equal(hints[0].room, chatPushRoom('clan', 'stormclan'));
        assert.equal(JSON.stringify(hints[0].payload).includes('Rally'), false);
    });

    it('stays silent when the message is refused', async () => {
        assert.equal((await send('pushrival', 'Storm Clan', 'let me in')).status, 403, 'not a member');
        assert.equal((await send('pushspeaker', 'Storm Clan', '   ')).status, 400, 'empty');
        assert.deepEqual(chatHints(), []);
    });
});
