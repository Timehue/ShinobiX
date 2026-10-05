/*
 * Handler integration for /api/sector/chat: the real handler, auth, presence
 * gate, moderation, rate limit, block list, release flag and socket hint, run
 * against the in-memory KV backend (no database, no secrets).
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_CHAT_KEEP, SECTOR_CHAT_LIFETIME_MS, SECTOR_CHAT_MAX_CHARS, SECTOR_CHAT_POSTS_PER_MINUTE } from '../../shared/sector-chat.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sector-chat-handler-test-secret-32-bytes!!';
process.env.ADMIN_PASSWORD = 'sector-chat-handler-test-admin';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { status: number; body: Record<string, unknown> };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let setRealtimeEmitter: typeof import('../_realtime/notify.js').setRealtimeEmitter;
const emitted: { room: string; event: string; payload: unknown }[] = [];

const SECTOR = 12;
const SPEAKER = 'kaze';
const LISTENER = 'mira';
const PLAYERS = [SPEAKER, LISTENER, 'rin', 'faraway'];
let ipCounter = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ setRealtimeEmitter } = await import('../_realtime/notify.js'));
    handler = (await import('./chat.js')).default as unknown as Handler;
});

beforeEach(async () => {
    emitted.length = 0;
    setRealtimeEmitter((room, event, payload) => { emitted.push({ room, event, payload }); });
    delete process.env.DISABLE_SECTOR_CHAT;
    for (const key of await kv.keys('chat:sector:*')) await kv.del(key);
    for (const key of await kv.keys('player-blocks:*')) await kv.del(key);
    for (const key of await kv.keys('mod:silence:*')) await kv.del(key);
    for (const name of PLAYERS) onlineStore.remove(name);
    onlineStore.upsert({ name: 'Kaze', sector: SECTOR, character: { name: 'Kaze', village: 'Ashen Leaf Village', level: 42 } });
    onlineStore.upsert({ name: 'Mira', sector: SECTOR, character: { name: 'Mira', village: 'Stormveil Village', level: 30 } });
    onlineStore.upsert({ name: 'faraway', sector: SECTOR + 1, character: null });
});

after(() => {
    setRealtimeEmitter(null);
    for (const name of PLAYERS) onlineStore.remove(name);
    for (const key of ['SHINOBIX_QA_MEMORY_KV', 'SESSION_SECRET', 'ADMIN_PASSWORD', 'DISABLE_SECTOR_CHAT']) delete process.env[key];
});

function headersFor(who: string | 'admin' | null): Record<string, string> {
    if (who === null) return {};
    if (who === 'admin') return { 'x-admin-password': process.env.ADMIN_PASSWORD! };
    return { 'x-player-name': who, 'x-player-token': issuePlayerToken(who)! };
}

async function call(method: 'GET' | 'POST', who: string | 'admin' | null, payload: Record<string, unknown>, ip?: string): Promise<Out> {
    return invoke(handler, method, who, payload, ip);
}

async function invoke(target: Handler, method: 'GET' | 'POST', who: string | 'admin' | null, payload: Record<string, unknown>, ip?: string): Promise<Out> {
    const out: Out = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (status: number) => { out.status = status; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    await target({
        method,
        query: method === 'GET' ? payload : {},
        body: method === 'POST' ? payload : undefined,
        headers: { 'content-type': 'application/json', ...headersFor(who) },
        // A fresh address per call keeps the per-address backstop out of tests
        // that are not about rate limiting.
        socket: { remoteAddress: ip ?? `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` },
    } as never, res as never);
    return out;
}

const say = (who: string, text: string, sector = SECTOR) => call('POST', who, { sector, text });
const hear = (who: string | 'admin', since = 0, sector = SECTOR) => call('GET', who, { sector: String(sector), since: String(since) });
const texts = (out: Out) => ((out.body.messages ?? []) as { text: string }[]).map((m) => m.text);

describe('/api/sector/chat', () => {
    it('round-trips a line, stamping the author from presence and never from the body', async () => {
        const posted = await call('POST', SPEAKER, { sector: SECTOR, text: '  Anyone heading north?  ', name: 'TheKage', village: 'Fake' });
        assert.equal(posted.status, 200);
        const message = posted.body.message as Record<string, unknown>;
        assert.equal(message.name, 'Kaze');
        assert.equal(message.village, 'Ashen Leaf Village');
        assert.equal(message.level, 42);
        assert.equal(message.text, 'Anyone heading north?');

        const heard = await hear(LISTENER);
        assert.equal(heard.status, 200);
        assert.deepEqual(texts(heard), ['Anyone heading north?']);
    });

    it('hints the sector room to refetch, without putting the text on the socket', async () => {
        await say(SPEAKER, 'Ready when you are.');
        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].room, `sector:${SECTOR}`);
        assert.equal(emitted[0].event, 'sector:chat');
        assert.equal(JSON.stringify(emitted[0].payload).includes('Ready'), false);
    });

    it('requires live presence in the sector to hear anything or to speak', async () => {
        await say(SPEAKER, 'Only for those standing here.');
        const elsewhere = await hear('faraway');
        assert.equal(elsewhere.status, 200, 'out of earshot reads as silence, not an error');
        assert.deepEqual(texts(elsewhere), []);
        assert.equal(elsewhere.body.away, 'sector-mismatch');
        const noPresence = await hear('rin');
        assert.deepEqual(texts(noPresence), []);
        assert.equal(noPresence.body.away, 'no-presence');
        assert.deepEqual(texts(await hear(LISTENER)), ['Only for those standing here.']);
        assert.equal((await say('faraway', 'Hello?')).status, 409);
    });

    it('refuses places with no sector chat, and anonymous callers', async () => {
        for (const sector of [0, 54, 98, 1000]) assert.equal((await say(SPEAKER, 'hi', sector)).status, 400, `sector ${sector}`);
        assert.equal((await call('GET', null, { sector: String(SECTOR) })).status, 401);
    });

    it('lets an admin read for moderation but not speak without a player identity', async () => {
        await say(SPEAKER, 'For the record.');
        const read = await hear('admin');
        assert.equal(read.status, 200);
        assert.deepEqual(texts(read), ['For the record.']);
        assert.equal((await say('admin', 'Hello')).status, 403);
    });

    it('rejects empty or blocked text and caps long lines', async () => {
        assert.equal((await say(SPEAKER, '    ')).status, 400);
        const long = await say(SPEAKER, 'y'.repeat(SECTOR_CHAT_MAX_CHARS + 100));
        assert.equal(long.status, 200);
        assert.equal(((long.body.message as { text: string }).text).length, SECTOR_CHAT_MAX_CHARS);
    });

    it('silences a silenced player on this surface too', async () => {
        await kv.set(`mod:silence:${SPEAKER}`, { until: Date.now() + 60_000, reason: 'test', by: 'admin' });
        const out = await say(SPEAKER, 'Can anyone hear me?');
        assert.equal(out.status, 403);
        assert.equal(out.body.error, 'You are silenced.');
    });

    it('hides lines from authors the reader has blocked', async () => {
        await say(SPEAKER, 'You cannot see me.');
        await kv.set(`player-blocks:${LISTENER}`, [SPEAKER]);
        assert.deepEqual(texts(await hear(LISTENER)), []);
        assert.deepEqual(texts(await hear(SPEAKER)), ['You cannot see me.']);
    });

    it('serves only lines past the cursor, and drops expired lines', async () => {
        const now = Date.now();
        await kv.set(`chat:sector:${SECTOR}`, [
            { id: 'old', name: 'Ghost', text: 'long ago', ts: now - SECTOR_CHAT_LIFETIME_MS - 1000 },
            { id: 'mid', name: 'Kaze', text: 'a minute ago', ts: now - 60_000 },
        ]);
        assert.deepEqual(texts(await hear(LISTENER)), ['a minute ago']);
        const posted = await say(SPEAKER, 'right now');
        assert.deepEqual(texts(await hear(LISTENER, now - 30_000)), ['right now']);
        assert.equal((posted.body.message as { ts: number }).ts >= now, true);
    });

    it('keeps only the newest lines', async () => {
        const now = Date.now();
        await kv.set(`chat:sector:${SECTOR}`, Array.from({ length: SECTOR_CHAT_KEEP }, (_, i) => ({ id: `s${i}`, name: 'Kaze', text: `seed ${i}`, ts: now - 10_000 + i })));
        await say(SPEAKER, 'newest');
        const heard = texts(await hear(LISTENER));
        assert.equal(heard.length, SECTOR_CHAT_KEEP);
        assert.equal(heard.at(-1), 'newest');
        assert.equal(heard[0], 'seed 1');
    });

    it('rate limits each speaker', async () => {
        const statuses: number[] = [];
        for (let i = 0; i <= SECTOR_CHAT_POSTS_PER_MINUTE; i++) statuses.push((await call('POST', LISTENER, { sector: SECTOR, text: `line ${i}` }, '10.9.9.9')).status);
        assert.deepEqual(statuses.slice(0, SECTOR_CHAT_POSTS_PER_MINUTE), Array(SECTOR_CHAT_POSTS_PER_MINUTE).fill(200));
        assert.equal(statuses.at(-1), 429);
    });

    it('a report on a line keeps a server copy of what was said, which outlives the line', async () => {
        const report = (await import('../report.js')).default as unknown as Handler;
        const posted = await say(SPEAKER, 'Something worth reporting.');
        const id = (posted.body.message as { id: string }).id;
        const filed = await invoke(report, 'POST', LISTENER, {
            targetType: 'message', category: 'harassment', targetName: 'Kaze', targetId: id,
            context: `sector-chat:${SECTOR}`, note: 'Quoting from memory: something else entirely.',
        });
        assert.equal(filed.status, 200);
        // A forged id earns no copy: the evidence comes from storage, never the reporter.
        await invoke(report, 'POST', LISTENER, { targetType: 'message', category: 'spam', targetId: 'forged', context: `sector-chat:${SECTOR}` });
        await kv.del(`chat:sector:${SECTOR}`); // the line fades...
        const queue = Object.values(await kv.hgetall<Record<string, { targetId: string; evidence?: { name: string; text: string } }>>('reports:queue') ?? {});
        const kept = queue.find((r) => r.targetId === id);
        assert.deepEqual(kept?.evidence && { name: kept.evidence.name, text: kept.evidence.text }, { name: 'Kaze', text: 'Something worth reporting.' });
        assert.equal(queue.find((r) => r.targetId === 'forged')?.evidence, undefined);
    });

    it('goes quiet behind its incident valve', async () => {
        process.env.DISABLE_SECTOR_CHAT = '1';
        const read = await hear(LISTENER);
        assert.equal(read.status, 404);
        assert.equal(read.body.disabled, true);
        assert.equal((await say(SPEAKER, 'hello')).status, 404);
    });
});
