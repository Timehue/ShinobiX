import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import type { WorldBossEventRecord, WorldBossMatchRecord, WorldBossQueueRecord } from './_event';
import type { KvCasOp } from '../_storage';

let kv: typeof import('../_storage.js')['kv'];
type AtomicKv = typeof kv & { compareSetMany: NonNullable<typeof kv.compareSetMany> };
let eventStore: typeof import('./_event.js');
let queue: typeof import('./_queue.js');
// Typed loosely: TS resolves '../world-boss-event.js' to the sibling directory.
let statusHandler: (req: never, res: never) => Promise<unknown>;

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.ADMIN_PASSWORD = 'world-boss-queue-coalesce-test';
    ({ kv } = await import('../_storage.js'));
    eventStore = await import('./_event.js');
    queue = await import('./_queue.js');
    statusHandler = ((await import('../world-boss-event.js')) as unknown as { default: typeof statusHandler }).default;
});

beforeEach(() => queue.resetWorldBossQueueTickCoalescing());

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A roaming event with one live (active) match on the queue, as a mid-event poll sees it. */
async function seedEvent(id: string, tickets: WorldBossQueueRecord['tickets'] = [], paused = tickets.length > 0) {
    const now = Date.now();
    const event: WorldBossEventRecord = {
        version: 1, eventId: `queue-coalesce-${id}`, bossId: 'hollow-maze-minotaur', bossName: 'Test Boss',
        status: 'roaming', startedAt: now - 60_000, roamEndsAt: now + 48 * 60 * 60 * 1000,
        endsAt: now + 72 * 60 * 60 * 1000, endedAt: null, hpMax: 600_000, hp: 600_000,
        participants: {}, settledMatchIds: [], updatedAt: now,
        ...(paused ? { movementPausedAt: now - 1_000 } : {}),
    };
    const match: WorldBossMatchRecord = {
        eventId: event.eventId, matchId: `live-${id}`, runId: `wbe-live-${id}`, status: 'active',
        members: [{ slug: `fighter-${id}`, name: `fighter-${id}`, village: '', clan: '' }],
        createdAt: now, startedAt: now, matchHp: 28_000,
    };
    await eventStore.writeWorldBossEvent(event);
    await eventStore.writeWorldBossMatch(match);
    await eventStore.writeWorldBossQueue(event.eventId, { tickets, activeMatchIds: [match.matchId], updatedAt: now });
    await kv.set(eventStore.WORLD_BOSS_ACTIVE_KEY, event.eventId);
    return { event, match, matchKey: eventStore.worldBossMatchKey(event.eventId, match.matchId) };
}

function ticket(slug: string, joinedAt = Date.now()) {
    return { ticketId: `wbt_${slug}`, slug, name: slug, joinedAt, village: '', clan: '' };
}

async function getStatus(query: Record<string, unknown>) {
    let status = 200;
    let body: any;
    const res = {
        setHeader() { return res; },
        status(code: number) { status = code; return res; },
        json(value: unknown) { body = value; return res; },
        end() { return res; },
    };
    await statusHandler({
        method: 'GET', body: {}, query,
        headers: query.playerName ? { 'x-admin-password': process.env.ADMIN_PASSWORD } : {},
        socket: { remoteAddress: '127.0.0.92' },
    } as never, res as never);
    return { status, body };
}

/** Count reads of one key: each queue tick reads every active match once, nothing else on these paths does. */
function countReads(t: { mock: { method: Function } }, key: string) {
    const counter = { reads: 0 };
    const originalGet = kv.get.bind(kv);
    t.mock.method(kv, 'get', async (...args: unknown[]) => {
        if (args[0] === key) counter.reads++;
        return (originalGet as (...a: unknown[]) => unknown)(...args);
    });
    return counter;
}

test('concurrent anonymous status polls share one queue tick', async t => {
    const { event, matchKey } = await seedEvent('anon', [ticket('waiting-anon')]);
    const counter = countReads(t, matchKey);
    const responses = await Promise.all(Array.from({ length: 25 }, () => getStatus({})));
    for (const response of responses) {
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.event.eventId, event.eventId);
        assert.deepEqual(response.body.queue, { waitingCount: 1 });
    }
    assert.equal(counter.reads, 1, 'only one of the 25 polls may run the tick');

    // Polls inside the window serve the committed queue without ticking.
    const later = await getStatus({});
    assert.deepEqual(later.body.queue, { waitingCount: 1 });
    assert.equal(counter.reads, 1);
});

test('concurrent player status polls share one tick and still report their own ticket', async t => {
    const { matchKey } = await seedEvent('players', [ticket('poller-a')]);
    const counter = countReads(t, matchKey);
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        getStatus({ playerName: index % 2 === 0 ? 'poller-a' : 'poller-b' })));
    responses.forEach((response, index) => {
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.queue.waitingCount, 1);
        assert.equal(response.body.queue.queued, index % 2 === 0, 'the view still reflects each player\'s own ticket');
        assert.equal(response.body.queue.match, null);
    });
    assert.equal(counter.reads, 1, 'only one of the 20 polls may run the tick');
});

test('a tick with nothing to change takes no lock and rewrites neither the queue nor the event', async t => {
    const { event } = await seedEvent('steady', [ticket('steady-waiter')]);
    const queueKey = eventStore.worldBossQueueKey(event.eventId);
    const eventKey = eventStore.worldBossEventKey(event.eventId);
    const writes: string[] = [];
    const originalSet = kv.set.bind(kv);
    t.mock.method(kv, 'set', async (...args: unknown[]) => {
        writes.push(String(args[0]));
        return (originalSet as (...a: unknown[]) => unknown)(...args);
    });
    const before = await eventStore.readWorldBossQueue(event.eventId);
    for (let round = 0; round < 3; round++) {
        const result = await queue.tickWorldBossQueue(event.eventId);
        assert.deepEqual(result.tickets, before.tickets);
        assert.deepEqual(result.activeMatchIds, before.activeMatchIds);
    }
    assert.deepEqual(writes.filter(key => key === queueKey || key === eventKey || key.startsWith('lock:')), [],
        'a steady-state tick must not lock or write');
    assert.deepEqual(await eventStore.readWorldBossQueue(event.eventId), before);
});

test('a tick that has work still writes: finished matches are dropped and the clock resumes', async t => {
    const { event, match } = await seedEvent('changed', [], true);
    await eventStore.writeWorldBossMatch({ ...match, status: 'settled', settledAt: Date.now() });
    const queueKey = eventStore.worldBossQueueKey(event.eventId);
    const eventKey = eventStore.worldBossEventKey(event.eventId);
    const writes: string[] = [];
    const originalSet = kv.set.bind(kv);
    t.mock.method(kv, 'set', async (...args: unknown[]) => {
        writes.push(String(args[0]));
        return (originalSet as (...a: unknown[]) => unknown)(...args);
    });
    const result = await queue.tickWorldBossQueue(event.eventId);
    assert.deepEqual(result.activeMatchIds, []);
    assert.deepEqual((await eventStore.readWorldBossQueue(event.eventId)).activeMatchIds, []);
    assert.equal(writes.filter(key => key === queueKey).length, 1);
    // The empty queue releases the roaming pause exactly once.
    assert.equal(writes.filter(key => key === eventKey).length, 1);
    const resumed = (await eventStore.readWorldBossEvent(event.eventId))!;
    assert.equal(resumed.movementPausedAt, null);
    assert.ok((resumed.movementPausedTotalMs ?? 0) > 0);
    writes.length = 0;
    await queue.tickWorldBossQueue(event.eventId);
    assert.deepEqual(writes.filter(key => key === queueKey || key === eventKey), [], 'the next tick has nothing left to write');
});

test('inside the window, a player poll still ticks when a tick is due; an anonymous poll never does', async () => {
    const { event } = await seedEvent('due', [], false);
    const first = await queue.tickWorldBossQueueCoalesced(event.eventId, Date.now(), { allowDueTick: true });
    assert.equal(first.ticked, true);
    // A player joins without the pause landing (as if the join's own pause write lost a race).
    await eventStore.writeWorldBossQueue(event.eventId, {
        tickets: [ticket('due-joiner')], activeMatchIds: [`live-due`], updatedAt: Date.now(),
    });
    await sleep(300);

    const anonymous = await queue.tickWorldBossQueueCoalesced(event.eventId, Date.now());
    assert.equal(anonymous.ticked, false, 'anonymous polls only tick once per window');
    assert.equal(anonymous.queue.tickets.length, 1, 'a skipped tick still serves the committed queue');
    assert.equal((await eventStore.readWorldBossEvent(event.eventId))!.movementPausedAt ?? null, null);

    const player = await queue.tickWorldBossQueueCoalesced(event.eventId, Date.now(), { allowDueTick: true });
    assert.equal(player.ticked, true, 'a due pause flip is applied on the same poll, as before');
    assert.notEqual((await eventStore.readWorldBossEvent(event.eventId))!.movementPausedAt ?? null, null);

    // Nothing is due any more, so the next player poll inside the window is a plain read.
    await sleep(300);
    const steady = await queue.tickWorldBossQueueCoalesced(event.eventId, Date.now(), { allowDueTick: true });
    assert.equal(steady.ticked, false);
    assert.equal(steady.queue.tickets.length, 1);
});

test('inside the window, a full trio is still formed on the very next player poll', async t => {
    t.mock.method(console, 'error', () => {});
    const { event } = await seedEvent('trio', [], false);
    await queue.tickWorldBossQueueCoalesced(event.eventId, Date.now(), { allowDueTick: true });
    await eventStore.writeWorldBossQueue(event.eventId, {
        tickets: [ticket('trio-a'), ticket('trio-b'), ticket('trio-c')], activeMatchIds: [`live-trio`], updatedAt: Date.now(),
    });
    await sleep(300);
    const polled = await queue.tickWorldBossQueueCoalesced(event.eventId, Date.now(), { allowDueTick: true });
    assert.equal(polled.ticked, true);
    assert.deepEqual(polled.queue.tickets, []);
    const pointer = await eventStore.readWorldBossPlayerPointer(event.eventId, 'trio-a');
    assert.ok(pointer?.matchId, 'the trio was assigned a match');
});

test('after the window passes, any poll ticks again', async t => {
    const { event, matchKey } = await seedEvent('window', []);
    const counter = countReads(t, matchKey);
    assert.equal((await queue.tickWorldBossQueueCoalesced(event.eventId)).ticked, true);
    assert.equal((await queue.tickWorldBossQueueCoalesced(event.eventId)).ticked, false);
    await sleep(queue.WORLD_BOSS_TICK_COALESCE_MS + 50);
    assert.equal((await queue.tickWorldBossQueueCoalesced(event.eventId)).ticked, true);
    assert.equal(counter.reads, 2);
});

test('a coalesced due tick publishes queue, team and pointers in one recoverable transaction', async t => {
    const { event } = await seedEvent('atomic-due', [], false);
    await queue.tickWorldBossQueueCoalesced(event.eventId);
    const queued = { tickets: [ticket('atomic-a'), ticket('atomic-b'), ticket('atomic-c')], activeMatchIds: ['live-atomic-due'], updatedAt: Date.now() };
    await eventStore.writeWorldBossQueue(event.eventId, queued);
    const beforeMatches = await kv.keys(`${eventStore.worldBossEventKey(event.eventId)}:match:*`);
    let publications = 0;
    assert.ok(kv.compareSetMany);
    const atomic = kv as AtomicKv;
    const original = atomic.compareSetMany.bind(atomic);
    t.mock.method(atomic, 'compareSetMany', async (operations: KvCasOp[]) => {
        if (operations.some(operation => operation.key.includes(':match:'))) {
            publications++;
            assert.ok(operations.some(operation => operation.key === eventStore.worldBossQueueKey(event.eventId)));
            assert.equal(operations.filter(operation => operation.key.includes(':player:')).length, 3);
            return false;
        }
        return original(operations);
    });
    await sleep(300);
    await assert.rejects(queue.tickWorldBossQueueCoalesced(event.eventId, Date.now(), { allowDueTick: true }), /publication is pending/);
    assert.equal(publications, 1);
    assert.deepEqual(await eventStore.readWorldBossQueue(event.eventId), queued);
    assert.deepEqual(await kv.keys(`${eventStore.worldBossEventKey(event.eventId)}:match:*`), beforeMatches);
    for (const member of queued.tickets) assert.equal(await eventStore.readWorldBossPlayerPointer(event.eventId, member.slug), null);
});

test('the optimized formation path excludes duplicate tickets and an already-seated player', async t => {
    const tickets = [ticket('seated'), ticket('free-a'), ticket('free-a'), ticket('free-b'), ticket('free-c')];
    const { event, match } = await seedEvent('atomic-unique', tickets);
    const seatedPointer = { matchId: match.matchId, status: 'active' as const, updatedAt: Date.now() };
    await eventStore.writeWorldBossPlayerPointer(event.eventId, 'seated', seatedPointer);
    let members: string[] = [];
    assert.ok(kv.compareSetMany);
    const atomic = kv as AtomicKv;
    const original = atomic.compareSetMany.bind(atomic);
    t.mock.method(atomic, 'compareSetMany', async (operations: KvCasOp[]) => {
        const publication = operations.find(operation => operation.key.includes(':match:'));
        if (publication && publication.op === 'cas') {
            members = (publication.value as WorldBossMatchRecord).members.map(member => member.slug);
            assert.ok(!operations.some(operation => operation.key === eventStore.worldBossPlayerKey(event.eventId, 'seated')));
            return false;
        }
        return original(operations);
    });
    await assert.rejects(queue.tickWorldBossQueue(event.eventId), /publication is pending/);
    assert.deepEqual(members, ['free-a', 'free-b', 'free-c']);
    assert.deepEqual(await eventStore.readWorldBossPlayerPointer(event.eventId, 'seated'), seatedPointer);
    assert.deepEqual((await eventStore.readWorldBossQueue(event.eventId)).tickets, tickets);
});

for (const waiting of [false, true]) test(`a fresh seated ticket is repaired before the fast path (${waiting ? 'one other player waiting' : 'alone'})`, async () => {
    const tickets = [ticket('seated-fast'), ...(waiting ? [ticket('waiting-fast')] : [])];
    const { event, match } = await seedEvent(`fast-repair-${waiting}`, tickets);
    const pointer = { matchId: match.matchId, status: 'active' as const, updatedAt: Date.now() };
    await eventStore.writeWorldBossPlayerPointer(event.eventId, 'seated-fast', pointer);
    const result = await queue.tickWorldBossQueue(event.eventId);
    assert.deepEqual(result.tickets.map(member => member.slug), waiting ? ['waiting-fast'] : []);
    assert.deepEqual(result.activeMatchIds, [match.matchId]);
    assert.deepEqual(await eventStore.readWorldBossPlayerPointer(event.eventId, 'seated-fast'), pointer);
});
