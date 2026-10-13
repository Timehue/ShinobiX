import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'messages-thread-read-test-secret-32b';

import type { DmMessage, InboxEntry } from './messages.js';

type Handler = (req: never, res: never) => Promise<unknown>;

let handler: Handler;
let threadKey: typeof import('./messages.js').threadKey;
let kv: typeof import('./_storage.js').kv;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;

const ME = 'reader';
const INBOX = `dm:inbox:${ME}`;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    const messages = await import('./messages.js');
    handler = messages.default as unknown as Handler;
    threadKey = messages.threadKey;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function get(query: Record<string, string>): Promise<{ status: number; body: unknown }> {
    const out = { status: 200, body: undefined as unknown };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.status = code; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        end: () => res,
    };
    await handler({
        method: 'GET', query, body: {},
        headers: { 'x-player-name': ME, 'x-player-token': issuePlayerToken(ME)! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

const thread: DmMessage[] = [
    { from: 'bob', to: ME, text: 'before', ts: 100 } as DmMessage,
    { from: 'bob', to: ME, text: 'after', ts: 300 } as DmMessage,
];

beforeEach(async () => {
    await kv.set(INBOX, [
        { with: 'bob', lastTs: 300, lastText: 'after', unread: 2 },
        { with: 'cara', lastTs: 50, lastText: 'hey', unread: 1 },
    ] satisfies InboxEntry[]);
    await kv.set(threadKey(ME, 'bob'), thread);
    await kv.del(`dm:deleted-at:${ME}|bob`);
});

describe('GET /api/messages?with=', { concurrency: false }, () => {
    it('returns the thread and clears only that partner\'s unread badge', async () => {
        const out = await get({ with: 'bob' });
        assert.equal(out.status, 200);
        assert.deepEqual((out.body as DmMessage[]).map((m) => m.text), ['before', 'after']);
        const inbox = await kv.get<InboxEntry[]>(INBOX);
        assert.equal(inbox?.find((e) => e.with === 'bob')?.unread, 0);
        assert.equal(inbox?.find((e) => e.with === 'cara')?.unread, 1);
    });

    it('still hides messages from before this player deleted the conversation', async () => {
        await kv.set(`dm:deleted-at:${ME}|bob`, 200);
        const out = await get({ with: 'bob' });
        assert.deepEqual((out.body as DmMessage[]).map((m) => m.text), ['after']);
    });

    it('does not take the inbox lock or rewrite the inbox when nothing is unread', async () => {
        await get({ with: 'bob' });
        const originalSet = kv.set.bind(kv);
        const writes: string[] = [];
        kv.set = (async (key: string, ...rest: unknown[]) => {
            writes.push(key);
            return (originalSet as (...a: unknown[]) => unknown)(key, ...rest);
        }) as typeof kv.set;
        try {
            const out = await get({ with: 'bob' });
            assert.equal(out.status, 200);
        } finally {
            kv.set = originalSet as typeof kv.set;
        }
        assert.deepEqual(writes.filter((key) => key.includes('dm:inbox')), []);
    });
});
