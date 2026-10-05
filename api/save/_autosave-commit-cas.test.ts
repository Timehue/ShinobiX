import assert from 'node:assert/strict';
import { before, test, type TestContext } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'autosave-commit-cas-test-secret';
process.env.ENABLE_LEGACY = '0';

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let token: string;
const NAME = 'casplayer';
const SAVE_KEY = `save:${NAME}`;

function character(): Record<string, unknown> {
    return {
        name: NAME, level: 1, xp: 0, experience: 0, ryo: 0,
        rank: 'Academy Student', rankTitle: 'Academy Student', village: '',
        stats: {}, inventory: [], itemStacks: [], pets: [], equipment: {},
        earnedTitles: [], serverTitles: [],
    };
}

async function post(body: Record<string, unknown>) {
    const out = { status: 200, body: undefined as Record<string, unknown> | undefined };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.status = code; return res; },
        json: (value: Record<string, unknown>) => { out.body = value; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST', query: { name: NAME }, body,
        headers: { 'x-player-name': NAME, 'x-player-token': token, 'content-type': 'application/json' },
        socket: { remoteAddress: '203.0.113.71' },
    } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./[name].js')).default as unknown as Handler;
    await kv.set(`auth:${NAME}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
    token = (await import('../_auth.js')).issuePlayerToken(NAME)!;
});

// One mock per test, moved by assignment (a second mock of Date.now leaks).
function mockClock(t: TestContext, start: number) {
    let now = start;
    t.mock.method(Date, 'now', () => now);
    return { advance(ms: number) { now += ms; } };
}

test('an autosave whose lock expired cannot overwrite a reward committed in the meantime', async (t) => {
    // Start at the real time: the session token is minted with a 24h expiry.
    const clock = mockClock(t, Date.now());
    const created = await post({ character: character(), _baseSaveVersion: 0 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const baseVersion = Number(created.body?._saveVersion);
    clock.advance(10_000); // past the one-save-per-window burst limit

    // Pause the autosave inside its critical section (its gains-window write runs
    // just before the commit) and let a second writer commit there — exactly what
    // happens when a database stall outlives the 5s save-lock TTL and a reward
    // settlement takes the lock.
    const realSet = kv.set.bind(kv);
    let concurrentWriteDone = false;
    t.mock.method(kv, 'set', async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (!concurrentWriteDone && key === `ratelimit:save:${NAME}:gains`) {
            concurrentWriteDone = true;
            const stored = await kv.get<Record<string, any>>(SAVE_KEY);
            await realSet(SAVE_KEY, {
                ...stored,
                _saveVersion: Number(stored!._saveVersion) + 1,
                character: { ...stored!.character, ryo: 1000 },
            });
        }
        return realSet(key, value, options);
    });

    const autosave = await post({ character: { ...character(), xp: 5, experience: 5 }, _baseSaveVersion: baseVersion });
    assert.equal(concurrentWriteDone, true, 'the test must actually interleave the concurrent writer');
    assert.equal(autosave.status, 409, 'the stale autosave is refused, not committed over the newer row');
    const after = await kv.get<Record<string, any>>(SAVE_KEY);
    assert.equal(after!.character.ryo, 1000, 'the reward committed in between survives');
    assert.equal(Number(autosave.body?.currentVersion), Number(after!._saveVersion), 'the 409 names the current version so the client can recover');
});

test('an uncontested autosave still commits', async (t) => {
    const clock = mockClock(t, Date.now() + 60_000);
    const read = await kv.get<Record<string, any>>(SAVE_KEY);
    clock.advance(10_000);
    const autosave = await post({ character: { ...character(), ryo: Number(read!.character.ryo), xp: 7, experience: 7 }, _baseSaveVersion: Number(read!._saveVersion) });
    assert.equal(autosave.status, 200, JSON.stringify(autosave.body));
    assert.equal(Number(autosave.body?._saveVersion), Number(read!._saveVersion) + 1);
});
