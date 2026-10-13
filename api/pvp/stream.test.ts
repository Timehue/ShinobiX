import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PvpFighter, PvpSession } from './session.js';
import { PVP_TURN_GRACE_MS, PVP_TURN_MS } from '../../shared/pvp-turn.js';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'x';
process.env.SESSION_SECRET = 'pvp-stream-test-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

/*
 * GET /api/pvp/stream — the SSE projection of a live PvP session.
 *
 * The behaviour under test is the server-authoritative turn expiry on the SSE
 * TICK. Both other readers of the deadline (the session poll and every move)
 * already had coverage; the stream did not — and it is the one that matters
 * most, because a match whose only live connection is this stream has nobody
 * else polling to advance a lapsed turn. A closed tab would freeze the fight.
 */

const store = new Map<string, unknown>();
const clone = <T>(v: T): T => (v === undefined || v === null) ? null as T : JSON.parse(JSON.stringify(v));

type Handler = (req: never, res: never) => Promise<unknown>;
let streamHandler: Handler;

before(async () => {
    const storage = await import('../_storage.js');
    const kv = storage.kv;
    kv.get = async <T,>(key: string) => clone(store.get(key)) as T | null;
    kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.compareSet = async (key: string, expected: unknown, value: unknown) => {
        const current = store.has(key) ? clone(store.get(key)) : null;
        if (JSON.stringify(current) !== JSON.stringify(clone(expected))) return false;
        store.set(key, clone(value));
        return true;
    };
    kv.del = async (...keys: string[]) => keys.reduce((n, key) => n + (store.delete(key) ? 1 : 0), 0);
    kv.delIfEqual = async (key: string, expected: string) => {
        if (store.get(key) !== expected) return false;
        store.delete(key);
        return true;
    };
    kv.incr = async (key: string) => {
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
    };
    kv.keys = async (pattern: string) => {
        const prefix = pattern.replace(/\*.*$/, '');
        return [...store.keys()].filter((key) => key.startsWith(prefix));
    };
    kv.mget = async (...keys: string[]) => keys.map((key) => clone(store.get(key))) as never;

    streamHandler = (await import('./stream.js')).default as unknown as Handler;
});

beforeEach(() => { store.clear(); });

const stats = Object.fromEntries([
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
].map((k) => [k, 500]));

function fighter(name: string, pos: number): PvpFighter {
    return {
        name, hp: 5000, maxHp: 5000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
        shield: 0, statuses: [],
        character: { name, level: 100, specialty: 'Ninjutsu', stats, jutsu: [], jutsuMastery: [] },
        pos,
    };
}

function session(battleId: string, patch: Partial<PvpSession> = {}): PvpSession {
    const now = Date.now();
    return {
        battleId,
        p1: fighter('alice', 0),
        p2: fighter('bob', 1),
        round: 1,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: ['Battle begins.'],
        status: 'active',
        winner: null,
        rewardAuthority: 'challenge',
        joined: { p1: true, p2: true },
        createdAt: now - 10_000,
        lastMoveAt: now - 10_000,
        turnStartedAt: now,
        ...patch,
    };
}

const stored = (id: string) => store.get(`pvp:${id}`) as PvpSession;
const LAPSED = PVP_TURN_MS + PVP_TURN_GRACE_MS + 500;

type StreamRun = {
    /** Resolves when the handler has torn the connection down. */
    done: Promise<unknown>;
    /** Simulate the client going away (tab close / navigation). */
    close: () => void;
    statusCode: number;
    body: unknown;
    headers: Record<string, unknown>;
    chunks: string[];
    /** Parsed `event: <name>` / `data: <json>` pairs, in order. */
    events: Array<{ event: string; data: unknown }>;
};

function openStream(battleId: string, ip = '10.4.0.1'): StreamRun {
    let onClose: () => void = () => undefined;
    const run: StreamRun = {
        done: Promise.resolve(),
        close: () => onClose(),
        statusCode: 200,
        body: undefined,
        headers: {},
        chunks: [],
        events: [],
    };
    const res = {
        setHeader: (key: string, value: unknown) => { run.headers[key] = value; return res; },
        status: (code: number) => { run.statusCode = code; return res; },
        json: (body: unknown) => { run.body = body; return res; },
        write: (chunk: string) => { run.chunks.push(chunk); return true; },
        end: () => res,
    };
    const req = {
        method: 'GET',
        query: { id: battleId },
        headers: { 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
        on: (event: string, cb: () => void) => { if (event === 'close') onClose = cb; },
    };
    run.done = streamHandler(req as never, res as never).then((value) => {
        // The SSE frames are `event: <name>\n` then `data: <json>\n\n`.
        for (let i = 0; i < run.chunks.length - 1; i++) {
            const name = /^event: (.+)\n$/.exec(run.chunks[i]);
            const data = /^data: ([\s\S]*)\n\n$/.exec(run.chunks[i + 1] ?? '');
            if (name && data) run.events.push({ event: name[1], data: JSON.parse(data[1]) });
        }
        return value;
    });
    return run;
}

/** Poll the fake store until `predicate` holds, then close the stream. */
async function untilThenClose(run: StreamRun, predicate: () => boolean, timeoutMs = 4_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let hit = false;
    while (Date.now() < deadline) {
        if (predicate()) { hit = true; break; }
        await new Promise<void>((r) => setTimeout(r, 25));
    }
    run.close();
    await run.done;
    return hit;
}

test('a bad battle id is refused before the connection is ever upgraded to SSE', async () => {
    const run = openStream('nope');
    await run.done;
    assert.equal(run.statusCode, 404);
    assert.deepEqual(run.body, { error: 'Session not found' });
    assert.equal(run.chunks.length, 0, 'nothing was streamed');
    assert.equal(run.headers['Content-Type'], undefined, 'the SSE headers were never sent');
});

test('the stream pushes the session immediately on connect', async () => {
    store.set('pvp:hello', clone(session('hello')));
    const run = openStream('hello');
    await untilThenClose(run, () => run.chunks.length >= 2);
    assert.equal(run.headers['Content-Type'], 'text/event-stream');
    assert.equal(run.headers['X-Accel-Buffering'], 'no');
    assert.equal(run.events[0].event, 'session');
    assert.equal((run.events[0].data as PvpSession).battleId, 'hello');
});

test('THE SSE TICK ENFORCES THE TURN DEADLINE: a lapsed turn is auto-waited with nobody else polling', async () => {
    store.set('pvp:sse-lapse', clone(session('sse-lapse', { turnStartedAt: Date.now() - LAPSED })));
    const run = openStream('sse-lapse');
    // The CI shard runs hundreds of files concurrently and can starve this
    // timer for several seconds. This contract is eventual SSE enforcement,
    // not a four-second runner-speed SLA, so leave enough scheduling headroom.
    const advanced = await untilThenClose(run, () => stored('sse-lapse').activePlayer === 'p2', 8_000);

    assert.ok(advanced, 'the stream tick never advanced the lapsed turn');
    const row = stored('sse-lapse');
    assert.equal(row.activePlayer, 'p2', 'alice\'s lapsed turn passed to bob');
    assert.equal(row.consecAutoWait?.p1, 1, 'the idle skip is counted exactly as the poll path counts it');
    assert.ok(row.log.some((line) => /ran out of time/.test(line)));
    assert.equal(store.has('pvp:sse-lapse:lock'), false, 'the move lock is released');

    // The change was PUSHED, not merely persisted — the whole point of the tick.
    const pushed = run.events.filter((e) => e.event === 'session').map((e) => e.data as PvpSession);
    assert.ok(pushed.some((s) => s.activePlayer === 'p2'), 'the advanced turn was streamed to the client');
});

test('a fresh turn is never advanced by the tick, and the stream stays quiet', async () => {
    store.set('pvp:sse-fresh', clone(session('sse-fresh')));
    const run = openStream('sse-fresh');
    await untilThenClose(run, () => run.chunks.length >= 6, 700);
    assert.equal(stored('sse-fresh').activePlayer, 'p1', 'a present player is never timed out');
    assert.equal(stored('sse-fresh').consecAutoWait, undefined);
    // Only the on-connect push; an unchanged row emits no further `session` events.
    assert.equal(run.events.filter((e) => e.event === 'session').length, 1);
});

test('a lock held by another writer leaves the tick a no-op instead of racing it', async () => {
    store.set('pvp:sse-contended', clone(session('sse-contended', { turnStartedAt: Date.now() - LAPSED })));
    store.set('pvp:sse-contended:lock', 'someone-else');
    const run = openStream('sse-contended');
    await untilThenClose(run, () => run.chunks.length >= 4, 600);
    assert.equal(stored('sse-contended').activePlayer, 'p1', 'the stream did not double-apply the auto-wait');
    assert.equal(store.get('pvp:sse-contended:lock'), 'someone-else', 'a foreign lock is never released');
});

test('the stream winds itself down once the fight is over', async () => {
    store.set('pvp:sse-done', clone(session('sse-done', { status: 'done', winner: 'p1' })));
    const run = openStream('sse-done');
    await run.done;   // resolves on its own: `status: 'done'` breaks the loop
    assert.deepEqual(run.events.at(-1), { event: 'end', data: { reason: 'session-done' } });
});

test('a session that vanishes mid-stream ends the connection instead of hanging', async () => {
    store.set('pvp:sse-gone', clone(session('sse-gone')));
    const run = openStream('sse-gone');
    // Wait for the connect push, so the row disappears mid-stream rather than
    // before the handler's own 404 pre-check.
    while (!run.chunks.length) await new Promise<void>((r) => setTimeout(r, 5));
    store.delete('pvp:sse-gone');
    await run.done;
    assert.deepEqual(run.events.at(-1), { event: 'end', data: { reason: 'session-expired' } });
});

test('a write to the session wakes the stream at once instead of waiting for a poll', async () => {
    const { signalKeyWritten } = await import('../_kv-write-signal.js');
    store.set('pvp:sse-wake', clone(session('sse-wake')));
    const run = openStream('sse-wake');
    while (!run.chunks.length) await new Promise<void>((r) => setTimeout(r, 5));
    const before = run.chunks.length;
    store.set('pvp:sse-wake', clone({ ...session('sse-wake'), log: ['Alice threw a kunai.'] }));
    const writtenAt = Date.now();
    signalKeyWritten('pvp:sse-wake');
    while (run.chunks.length === before && Date.now() - writtenAt < 900) await new Promise<void>((r) => setTimeout(r, 5));
    const latency = Date.now() - writtenAt;
    run.close();
    await run.done;
    assert.ok(latency < 500, `the write reached the client in ${latency}ms, well inside the 1s safety poll`);
    assert.ok(run.events.some((e) => e.event === 'session' && (e.data as PvpSession).log.includes('Alice threw a kunai.')));
});

test('a quiet stream reads its session about once a second, not ten times', async () => {
    store.set('pvp:sse-quiet', clone(session('sse-quiet')));
    const { kv } = await import('../_storage.js');
    const original = kv.get;
    let reads = 0;
    kv.get = (async (key: string) => { if (key === 'pvp:sse-quiet') reads += 1; return original(key); }) as typeof kv.get;
    try {
        const run = openStream('sse-quiet');
        await new Promise<void>((r) => setTimeout(r, 1_300));
        run.close();
        await run.done;
    } finally {
        kv.get = original;
    }
    // One read before the upgrade plus about one safety poll; the old loop did ~13.
    assert.ok(reads <= 4, `a quiet stream read its session ${reads} times in 1.3s`);
});

test('the wake delay honours the turn clock and never drops below the old 100 ms cadence', async () => {
    const { streamWakeDelayMs } = await import('./stream.js');
    const now = Date.now();
    assert.equal(streamWakeDelayMs(session('d', { status: 'done' }), now), 1_000, 'no clock: the safety poll');
    const dueIn300 = streamWakeDelayMs(session('d', { turnStartedAt: now - (PVP_TURN_MS + PVP_TURN_GRACE_MS) + 300 }), now);
    assert.ok(dueIn300 >= 300 && dueIn300 <= 320, `wakes right after the lapse (${dueIn300}ms)`);
    assert.equal(streamWakeDelayMs(session('d', { turnStartedAt: now - LAPSED }), now), 100, 'an overdue turn retries at the old cadence');
    assert.equal(streamWakeDelayMs(session('d', { turnStartedAt: now }), now), 1_000, 'a far-off lapse still gets the safety poll');
});

test('a move that lands while the stream is still connecting is streamed at once', async () => {
    const { signalKeyWritten } = await import('../_kv-write-signal.js');
    const { kv } = await import('../_storage.js');
    store.set('pvp:sse-race', clone(session('sse-race')));
    const original = kv.get;
    let movedAt = 0;
    kv.get = (async (key: string) => {
        const value = await original(key);
        if (key === 'pvp:sse-race' && !movedAt) {
            // Bob's move commits just after the stream's first read took its
            // snapshot. A stream that subscribed only after that read would
            // not hear it and would sit on the stale frame until the safety poll.
            store.set('pvp:sse-race', clone({ ...session('sse-race'), log: ['Bob struck first.'] }));
            movedAt = Date.now();
            signalKeyWritten('pvp:sse-race');
        }
        return value;
    }) as typeof kv.get;
    try {
        const run = openStream('sse-race');
        while (!movedAt) await new Promise<void>((r) => setTimeout(r, 1));
        while (!run.chunks.some((chunk) => chunk.includes('Bob struck first.')) && Date.now() - movedAt < 1_500) {
            await new Promise<void>((r) => setTimeout(r, 5));
        }
        const latency = Date.now() - movedAt;
        run.close();
        await run.done;
        assert.ok(latency < 500, `the connect-time move reached the client in ${latency}ms, well inside the 1s safety poll`);
    } finally {
        kv.get = original;
    }
});

test('a fight that is already over is answered at once, without waiting for a poll', async () => {
    store.set('pvp:sse-over', clone(session('sse-over', { status: 'done', winner: 'p2' })));
    const startedAt = Date.now();
    const run = openStream('sse-over');
    await run.done;
    const elapsed = Date.now() - startedAt;
    assert.deepEqual(run.events.map((e) => e.event), ['session', 'end']);
    assert.deepEqual(run.events.at(-1), { event: 'end', data: { reason: 'session-done' } });
    assert.ok(elapsed < 500, `a finished fight held the connection for ${elapsed}ms`);
});

// ── Seamless reconnects (2026-10-12): a planned end says `reconnect`, never a silent cut ──

test('a deploy hands every open stream to the new server with `reconnect`, and refuses new ones fast', async () => {
    const handoff = await import('./_stream-handoff.js');
    try {
        store.set('pvp:sse-handoff', clone(session('sse-handoff')));
        const run = openStream('sse-handoff', '10.4.9.1');
        while (!run.chunks.length) await new Promise<void>((r) => setTimeout(r, 5));
        const startedAt = Date.now();
        assert.equal(handoff.handOffLiveStreams(), 1, 'the open stream was registered for handoff');
        await run.done;
        assert.ok(Date.now() - startedAt < 500, 'the stream ended at once, not at the next poll or the drain budget');
        assert.deepEqual(run.events.at(-1), { event: 'reconnect', data: { reason: 'server-restart' } });

        const late = openStream('sse-handoff', '10.4.9.2');
        await late.done;
        assert.equal(late.statusCode, 503, 'a stream arriving at a draining server is sent back at once');
        assert.equal(late.headers['Retry-After'], '1');
        assert.equal(late.chunks.length, 0);
    } finally {
        handoff.__resetStreamHandoffForTest();
    }
});

test('server shutdown hands PvP streams off before it starts draining HTTP', async () => {
    const { readFileSync } = await import('node:fs');
    const server = readFileSync('server.ts', 'utf8');
    assert.match(server, /import \{ handOffLiveStreams \} from '\.\/api\/pvp\/_stream-handoff\.js';/);
    const shutdown = server.slice(server.indexOf('function gracefulShutdown('));
    const handOffAt = shutdown.indexOf('handOffLiveStreams()');
    assert.ok(handOffAt > 0, 'gracefulShutdown hands the streams off');
    assert.ok(handOffAt < shutdown.indexOf('drainRuntime('), 'before the HTTP drain waits on them');
});

test('the 13-minute renewal says `reconnect`, so the client never reads it as an error', async () => {
    store.set('pvp:sse-renew', clone(session('sse-renew')));
    const realNow = Date.now;
    const run = openStream('sse-renew', '10.4.9.3');
    try {
        while (!run.chunks.length) await new Promise<void>((r) => setTimeout(r, 5));
        const skew = 14 * 60 * 1000;
        Date.now = () => realNow() + skew;
        await run.done;
    } finally {
        Date.now = realNow;
    }
    assert.deepEqual(run.events.at(-1), { event: 'reconnect', data: { reason: 'renew' } });
});

test('a viewer who leaves gets no `reconnect`, and the finished fight still gets `end`', async () => {
    store.set('pvp:sse-leave', clone(session('sse-leave')));
    const run = openStream('sse-leave', '10.4.9.4');
    while (!run.chunks.length) await new Promise<void>((r) => setTimeout(r, 5));
    run.close();
    await run.done;
    assert.equal(run.events.some((e) => e.event === 'reconnect'), false);
    const handoff = await import('./_stream-handoff.js');
    try {
        assert.equal(handoff.handOffLiveStreams(), 0, 'a closed stream unregisters its handoff');
    } finally {
        handoff.__resetStreamHandoffForTest();
    }
});

// ── 2026-10-13 audit hardening ──

test('a stream registering after the handoff already ran is handed off at once, not stranded', async () => {
    const handoff = await import('./_stream-handoff.js');
    try {
        handoff.handOffLiveStreams(); // shutdown began while this stream waited on the rate limit
        let handedOff = false;
        const unregister = handoff.registerStreamHandoff(() => { handedOff = true; });
        await Promise.resolve();
        assert.equal(handedOff, true);
        unregister();
    } finally {
        handoff.__resetStreamHandoffForTest();
    }
});

test('a failed session read is a missed tick: the stream keeps serving its viewers', async () => {
    const storage = await import('../_storage.js');
    const original = storage.kv.get;
    let failNext = 0;
    storage.kv.get = (async (key: string) => {
        if (key === 'pvp:sse-flaky' && failNext > 0) { failNext -= 1; throw new Error('statement timeout'); }
        return original(key);
    }) as typeof original;
    const warn = console.warn;
    console.warn = () => undefined;
    try {
        store.set('pvp:sse-flaky', clone(session('sse-flaky')));
        const run = openStream('sse-flaky', '10.4.9.5');
        while (!run.chunks.length) await new Promise<void>((r) => setTimeout(r, 5));
        failNext = 2; // two consecutive failed ticks, under the cap
        await new Promise<void>((r) => setTimeout(r, 2_600));
        store.set('pvp:sse-flaky', clone(session('sse-flaky', { round: 2 })));
        const delivered = await untilThenClose(run, () => run.chunks.some((chunk) => chunk.includes('"round":2')), 4_000);
        assert.ok(delivered, 'the stream survived the failed reads and pushed the next change');
        assert.equal(run.events.some((e) => e.event === 'end'), false, 'a read failure is not the end of the battle');
    } finally {
        storage.kv.get = original;
        console.warn = warn;
    }
});

test('every viewer of a lapsed turn shares one deadline enforcement', async () => {
    store.set('pvp:sse-crowd', clone(session('sse-crowd', { turnStartedAt: Date.now() - LAPSED })));
    const storage = await import('../_storage.js');
    const originalSet = storage.kv.set;
    let lockAttempts = 0;
    storage.kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (key === 'pvp:sse-crowd:lock') lockAttempts += 1;
        return originalSet(key, value, options as never);
    }) as typeof originalSet;
    try {
        const runs = [0, 1, 2, 3].map((i) => openStream('sse-crowd', `10.4.9.${10 + i}`));
        const deadline = Date.now() + 8_000;
        while (stored('sse-crowd').activePlayer !== 'p2' && Date.now() < deadline) await new Promise<void>((r) => setTimeout(r, 25));
        for (const run of runs) { run.close(); await run.done; }
        assert.equal(stored('sse-crowd').activePlayer, 'p2', 'the lapsed turn was advanced');
        assert.ok(lockAttempts <= 2, `${lockAttempts} lock attempts for one lapse across four viewers`);
    } finally {
        storage.kv.set = originalSet;
    }
});
