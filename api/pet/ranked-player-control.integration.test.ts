import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { tacticsPreset } from '../../shared/pet-tactics-roster.js';
import { tacticsPlayerKey, tacticsRoomKey, type TacticsSession } from '../_pet-tactics/session.js';
import { PET_ARENA_RANKED_CONTROL, isRankedPetMatchToken, type RankedPetMatchToken } from './_ranked-authority.js';
import { resolveRankedPetDuel } from './_ranked-duel.js';
import { rankedArenaDependencies, rankedArenaQueue, rankedArenaWinner } from '../_pet-tactics/ranked.js';

process.env.NODE_ENV = 'test'; process.env.SHINOBIX_QA_MEMORY_KV = '1'; process.env.SESSION_SECRET = 'pet-arena-player-control-test-secret';
type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv, issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let queue: Handler, commands: Handler, watch: Handler, settle: Handler;
before(async () => {
    ({ kv } = await import('../_storage.js')); ({ issuePlayerToken } = await import('../_auth.js'));
    queue = (await import('../pvp/pet-ranked-queue.js')).default as unknown as Handler;
    commands = (await import('./tactics.js')).default as unknown as Handler;
    watch = (await import('./ranked-watch.js')).default as unknown as Handler;
    settle = (await import('./battle-result.js')).default as unknown as Handler;
});
async function call(handler: Handler, name: string, body: Record<string, unknown>) {
    const output = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status: (n: number) => { output.status = n; return res; },
        json: (body: Record<string, any>) => { output.body = body; return res; }, end: () => res };
    await handler({ method: 'POST', body, headers: { 'x-player-token': issuePlayerToken(name) }, socket: { remoteAddress: '203.0.113.147' } } as never, res as never);
    return output;
}
const builds = () => ['starter-fire', 'starter-water', 'starter-lightning', 'starter-earth'].map(id => tacticsPreset(id));
async function pair(prefix: string) {
    const a = `${prefix}a`, b = `${prefix}b`;
    for (const name of [a, b]) await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, level: 40, ryo: 500, petRankedRating: 1000, pets: [] } });
    const first = await call(queue, a, { action: 'join', builds: builds() }); assert.equal(first.body.state, 'queued');
    const second = await call(queue, b, { action: 'join', builds: builds() }); assert.equal(second.body.state, 'active');
    assert.equal(second.body.control, PET_ARENA_RANKED_CONTROL);
    return { a, b, roomId: second.body.roomId as string, matchToken: second.body.matchToken as string };
}

test('ranked pairs into private preview, waits for both human locks, and forbids the AI resolver', async () => {
    const { a, b, roomId, matchToken } = await pair('commandrank');
    const token = await kv.get<RankedPetMatchToken>(`pet:ranked-token:${matchToken}`); assert.ok(isRankedPetMatchToken(token));
    assert.throws(() => resolveRankedPetDuel(token!), /AI resolution is forbidden/);
    const view = (await call(commands, a, { action: 'poll', roomId })).body;
    assert.equal(view.phase, 'preview'); assert.equal(view.round, 0); assert.equal(view.result, null); assert.ok(view.ranked);
    assert.equal((await call(watch, a, { matchToken })).body.arena.phase, 'preview');
    assert.equal((await call(watch, 'outside', { matchToken })).status, 403);
    await call(commands, a, { action: 'leads', roomId, leads: [0, 1] }); await call(commands, b, { action: 'leads', roomId, leads: [0, 1] });
    const orders = [{ actorId: 'b-0', kind: 'move', moveId: 'fire-pulse', targetSlot: 0 }, { actorId: 'b-1', kind: 'rest' }];
    await call(commands, a, { action: 'orders', roomId, round: 1, orders });
    const before = (await call(commands, b, { action: 'poll', roomId })).body;
    assert.equal(before.round, 0); assert.equal(before.ready.opponent, true); assert.equal(before.ownOrders, null);
    const own = [{ actorId: 'a-0', kind: 'guard' }, { actorId: 'a-1', kind: 'rest' }];
    const responses = await Promise.all(Array.from({ length: 6 }, () => call(commands, b, { action: 'orders', roomId, round: 1, orders: own })));
    assert.ok(responses.every(r => r.status === 200));
    const saved = await kv.get<TacticsSession>(tacticsRoomKey(roomId)); assert.equal(saved?.battle?.round, 1); assert.equal(saved?.transcript.length, 1);
    assert.equal((await kv.get<any>(`save:${a}`)).character.petRankedRating, 1000);
});

test('premature reports cannot rate a match; terminal concession rates both saves once and recovers after proof retirement', async () => {
    const { a, b, roomId, matchToken } = await pair('settlerank');
    const report = { ranked: true, matchToken, outcome: 'win', playerName: a, opponentName: b, reportKey: `${matchToken}:ranked` };
    const refused = await call(settle, a, report); assert.equal(refused.status, 409);
    assert.equal(await kv.get(`pet:ranked-intent:${matchToken}`), null);
    assert.equal((await kv.get<any>(`save:${a}`)).character.petRankedRating, 1000);
    await call(commands, b, { action: 'concede', roomId });
    await new Promise(resolve => setTimeout(resolve, 5010)); // Preserve the production result burst limit.
    const accepted = await call(settle, a, report); assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const sa = await kv.get<any>(`save:${a}`), sb = await kv.get<any>(`save:${b}`);
    assert.ok(sa.character.petRankedRating > 1000); assert.ok(sb.character.petRankedRating < 1000);
    assert.equal(sa.character.petRankedRating + sb.character.petRankedRating, 2000);
    assert.equal(sa.character.ryo, 500); assert.deepEqual(sa.character.pets, []);
    const peerReplay = await call(settle, b, { ...report, playerName: b, opponentName: a, outcome: 'win' });
    assert.equal(peerReplay.status, 200); assert.equal(peerReplay.body.outcome, 'loss');
    const retries = await Promise.all(Array.from({ length: 4 }, () => call(settle, a, report)));
    assert.ok(retries.every(r => r.status === 200 || r.status === 429)); assert.equal((await kv.get<any>(`save:${a}`)).character.petRankedRating, sa.character.petRankedRating);
    assert.equal((await call(watch, b, { matchToken })).body.arena.result, 'loss');
    const recovered = (await call(queue, b, { action: 'poll' })).body; assert.equal(recovered.state, 'completed');
    assert.equal((await call(queue, b, { action: 'acknowledge', matchToken })).body.state, 'idle');
    assert.equal(await kv.get(tacticsPlayerKey(b)), null);
});

test('active ranked reservations recover rather than opening another room, and foreign commands cannot touch them', async () => {
    const { a, b, roomId, matchToken } = await pair('reserverank');
    const duplicate = await call(queue, a, { action: 'join', builds: builds() }); assert.equal(duplicate.body.matchToken, matchToken);
    assert.equal((await call(commands, 'outsider', { action: 'orders', roomId, round: 1, orders: [] })).status, 403);
    assert.equal((await call(queue, b, { action: 'acknowledge', matchToken })).body.state, 'active');
    assert.equal((await call(commands, a, { action: 'create', builds: builds() })).body.roomId, roomId);
});

test('a failed half-admission repairs from durable intent and never resets accepted commands', async () => {
    const a = 'repairranka', b = 'repairrankb';
    for (const name of [a, b]) await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, level: 40, petRankedRating: 1000, pets: [] } });
    await rankedArenaQueue(a, 'join', { builds: builds() });
    let failed = false;
    const faulty = { ...rankedArenaDependencies, store: { ...kv, set: async (...args: Parameters<typeof kv.set>) => {
        if (args[0] === tacticsPlayerKey(a) && !failed) { failed = true; throw new Error('Injected second-seat pointer write failure'); }
        return kv.set(...args);
    } } };
    await assert.rejects(() => rankedArenaQueue(b, 'join', { builds: builds() }, faulty), /Injected/);
    const intent = await kv.get<any>('pet:tactics:ranked:admission'); assert.ok(intent);
    const repaired = await rankedArenaQueue(a, 'poll', {}); assert.equal(repaired.roomId, intent.session.roomId);
    assert.equal(await kv.get('pet:tactics:ranked:admission'), null);
    const roomId = intent.session.roomId;
    await call(commands, a, { action: 'leads', roomId, leads: [0, 1] }); await call(commands, b, { action: 'leads', roomId, leads: [0, 1] });
    const orders = [{ actorId: 'b-0', kind: 'guard' }, { actorId: 'b-1', kind: 'rest' }];
    assert.equal((await call(commands, a, { action: 'orders', roomId, round: 1, orders })).status, 200);
    // Simulate a lost admission-cleanup acknowledgement after the room started.
    await kv.set('pet:tactics:ranked:admission', intent);
    await rankedArenaQueue(a, 'poll', {});
    const saved = await kv.get<TacticsSession>(tacticsRoomKey(roomId));
    assert.deepEqual(saved?.orders.b, orders); assert.equal(saved?.phase, 'planning'); assert.equal(saved?.seed, intent.session.seed);
});

test('expiry of an old reservation cannot admit a second ranked match or invent an AI winner', async () => {
    const { a, roomId, matchToken } = await pair('expiryrank');
    const now = Date.now() + 3 * 60 * 60_000;
    const recovered = await rankedArenaQueue(a, 'join', { builds: builds() }, { ...rankedArenaDependencies, now: () => now });
    assert.equal(recovered.matchToken, matchToken); assert.equal(recovered.roomId, roomId);
    const token = await kv.get<RankedPetMatchToken>(`pet:ranked-token:${matchToken}`); assert.ok(token);
    await assert.rejects(() => rankedArenaWinner(token!), /must finish/);
    assert.equal((await kv.get<any>(`save:${a}`)).character.petRankedRating, 1000);
});
