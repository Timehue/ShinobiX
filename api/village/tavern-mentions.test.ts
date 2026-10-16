/*
 * Tavern mentions: tagging a player ("@Name", or replying to their line) leaves
 * them a small notice and kicks their heartbeat. Only a player who could read
 * the line hears about it. Real handler, in-memory KV.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-tavern-mention-test-secret-32b!';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { status: number; body: unknown };
type Notice = { kind: string; by: string; village?: string; sector: number; at: number; text?: string };

let villageChat: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let setRealtimeEmitter: typeof import('../_realtime/notify.js').setRealtimeEmitter;
let authKey: typeof import('../player-auth.js').authKey;
let mentions: typeof import('./_tavern-mentions.js');
let notices: typeof import('../player/_offline-notices.js');
const emitted: { room: string; event: string; payload: unknown }[] = [];
let ipCounter = 0;

const VILLAGE = 'Frostfang Village';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ setRealtimeEmitter } = await import('../_realtime/notify.js'));
    ({ authKey } = await import('../player-auth.js'));
    mentions = await import('./_tavern-mentions.js');
    notices = await import('../player/_offline-notices.js');
    villageChat = (await import('./chat.js')).default as unknown as Handler;
});

beforeEach(async () => {
    emitted.length = 0;
    setRealtimeEmitter((room, event, payload) => { emitted.push({ room, event, payload }); });
    for (const pattern of ['chat:village:*', 'auth:*', 'save:*', 'offline-notices:*', 'tavern-mention-cd:*', 'player-blocks:*']) {
        for (const key of await kv.keys(pattern)) await kv.del(key);
    }
    await kv.set('save:speaker', { _saveVersion: 1, character: { name: 'Speaker', village: VILLAGE, level: 12 } });
    await kv.set('save:friend', { _saveVersion: 1, character: { name: 'Friend', village: VILLAGE, level: 12 } });
    await kv.set('save:other', { _saveVersion: 1, character: { name: 'Other', village: VILLAGE, level: 12 } });
    await kv.set('save:rival', { _saveVersion: 1, character: { name: 'Rival', village: 'Moonshadow Village', level: 12 } });
    await kv.set('save:guest', { _saveVersion: 1, character: { name: 'Guest', village: VILLAGE, level: 2 } });
    await kv.set(authKey('guest'), { guest: true });
});

after(() => {
    setRealtimeEmitter(null);
    for (const key of ['SHINOBIX_QA_MEMORY_KV', 'SESSION_SECRET']) delete process.env[key];
});

async function post(player: string, text: string, replyTo?: { author: string; text: string }): Promise<Out> {
    const out: Out = { status: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (status: number) => { out.status = status; return res; },
        json: (payload: unknown) => { out.body = payload; return res; },
        end: () => res,
    };
    await villageChat({
        method: 'POST',
        query: { village: VILLAGE },
        body: { author: player, text, ...(replyTo ? { replyTo } : {}) },
        headers: { 'content-type': 'application/json', 'x-player-name': player, 'x-player-token': issuePlayerToken(player)! },
        socket: { remoteAddress: `10.7.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` },
    } as never, res as never);
    return out;
}

const inbox = async (player: string) => (await kv.get<Notice[]>(`offline-notices:${player}`)) ?? [];
const kicked = () => emitted.filter((e) => e.event === 'presence:kick').map((e) => e.room);

describe('tavern mentions', () => {
    it('tells a tagged villager who tagged them, with a snippet', async () => {
        assert.equal((await post('Speaker', 'Meet at the gate, @Friend.')).status, 200);
        const got = await inbox('friend');
        assert.equal(got.length, 1);
        assert.equal(got[0].kind, 'tavern-mention');
        assert.equal(got[0].by, 'Speaker');
        assert.equal(got[0].village, VILLAGE);
        assert.equal(got[0].text, 'Meet at the gate, @Friend.');
        assert.deepEqual(kicked(), ['user:friend']);
        assert.deepEqual(await inbox('speaker'), [], 'the author gets nothing');
    });

    it('treats a reply as a tag', async () => {
        await post('Speaker', 'Anyone seen the Kage?', { author: 'Friend', text: 'The rain will not stop.' });
        assert.equal((await inbox('friend')).length, 1);
    });

    it('skips players who could not read the line', async () => {
        await post('Speaker', '@Rival @Guest @Speaker @Nobody hello');
        assert.deepEqual(await inbox('rival'), [], 'another village');
        assert.deepEqual(await inbox('guest'), [], 'an unclaimed guest');
        assert.deepEqual(await inbox('speaker'), [], 'yourself');
        assert.deepEqual(kicked(), []);
    });

    it('skips a player who blocked the author, or whom the author blocked', async () => {
        await kv.set('player-blocks:friend', ['speaker']);
        await kv.set('player-blocks:speaker', ['other']);
        await post('Speaker', '@Friend @Other hi');
        assert.deepEqual(await inbox('friend'), []);
        assert.deepEqual(await inbox('other'), []);
    });

    it('pings one player once a minute per author', async () => {
        await post('Speaker', '@Friend one');
        await post('Speaker', '@Friend two');
        assert.equal((await inbox('friend')).length, 1);
        await post('Other', '@Friend three');
        assert.equal((await inbox('friend')).length, 2, 'a different author still gets through');
    });

    it('tags a name with spaces, preferring the longest real name', async () => {
        await kv.set('save:stormwalker', { _saveVersion: 1, character: { name: 'Storm Walker', village: VILLAGE, level: 12 } });
        await kv.set('save:storm', { _saveVersion: 1, character: { name: 'Storm', village: VILLAGE, level: 12 } });
        await post('Speaker', 'Thanks @Storm Walker, see you there.');
        assert.equal((await inbox('stormwalker')).length, 1, 'the spaced name is reached');
        assert.deepEqual(await inbox('storm'), [], 'a shorter name is not pinged by mistake');
        await post('Other', '@Storm, you too.');
        assert.equal((await inbox('storm')).length, 1, 'a tag followed by words still finds the short name');
    });

    it('caps the name a notice prints', async () => {
        const padded = `Speaker${'!'.repeat(80)}`;
        await post(padded, '@Friend look');
        const [notice] = await inbox('friend');
        assert.ok(notice.by.length <= 32, `notice name is capped (${notice.by.length})`);
    });

    it('never lets mentions push other reports out of the inbox', async () => {
        await notices.pushOfflineNotice('friend', { kind: 'bounty-placed', by: 'Anonymous shinobi', sector: 0, at: 1, amount: 1000, total: 1000 });
        for (let i = 0; i < notices.TAVERN_MENTION_NOTICES_CAP + 4; i += 1) {
            await notices.pushOfflineNotice('friend', { kind: 'tavern-mention', by: `Caller${i}`, village: VILLAGE, sector: 0, at: 10 + i, text: 'hi' });
        }
        const got = await inbox('friend');
        assert.equal(got.filter((n) => n.kind === 'bounty-placed').length, 1);
        assert.equal(got.filter((n) => n.kind === 'tavern-mention').length, notices.TAVERN_MENTION_NOTICES_CAP);
    });
});

describe('mentionedSlugs', () => {
    it('reads @tags but not an @ inside a word', () => {
        assert.deepEqual(mentions.mentionedSlugs('@Rill and @storm-walker, mail me at a@b.com'), ['rill', 'storm-walker']);
        assert.deepEqual(mentions.mentionedSlugs('(@Kenji) @Kenji'), ['kenji']);
        assert.deepEqual(mentions.mentionedSlugs('no tags @ all'), []);
    });
});
