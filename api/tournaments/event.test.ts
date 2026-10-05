import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import type { Tournament } from '../../shared/tournaments.js';
import { openBracket, advanceBracket } from './_bracket.js';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'tournament-admin-test';
process.env.ADMIN_CONTENT_PASSWORD = 'tournament-content-test';
process.env.SESSION_SECRET = 'tournament-session-test-secret-at-least-32';
let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./event.js').default;
let store: typeof import('./_store.js');
let tokens: Record<string, string>;
const players = ['akira', 'ren', 'sora', 'yuki', 'ken'];
const admin = { 'x-admin-password': 'tournament-admin-test' };
const auth = (id: string) => ({ 'x-player-token': tokens[id], 'x-player-name': id });
async function request(body?: Record<string, unknown>, headers: Record<string, string> = admin) {
    const output = { status: 200, body: {} as any };
    const res = { setHeader() { return res; }, status(code: number) { output.status = code; return res; }, json(body: unknown) { output.body = body; return res; }, end() { return res; } };
    await handler({ method: body ? 'POST' : 'GET', body, headers, query: {}, socket: { remoteAddress: '127.0.0.89' } } as never, res as never);
    return output;
}
before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./event.js')).default as unknown as typeof handler;
    store = await import('./_store.js');
    const { issuePlayerToken } = await import('../_auth.js');
    tokens = Object.fromEntries(players.map(p => [p, issuePlayerToken(p)!]));
});
let testClock = 0;
beforeEach(async context => {
    if (!('mock' in context)) throw new Error('Tournament fixtures require a test clock.');
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() + (++testClock) * 60_001 });
    for (const prefix of ['game:tournaments:*', 'tower-pvp:*', 'battle-lock:*', 'lock:*']) {
        const keys = await kv.keys(prefix); if (keys.length) await kv.del(...keys);
    }
    for (const name of players) await kv.set(`save:${name}`, { character: { name, level: 30, hp: 1000, maxHp: 1000,
        maxChakra: 100, maxStamina: 100, stats: { strength: 50, speed: 50, defense: 50, intelligence: 50, agility: 50 },
        pets: [{ id: `${name}-pet`, name: `${name}'s pet`, level: 30, rarity: 'standard', hp: 800, attack: 120, defense: 90, speed: 60, element: 'Fire', role: 'tracker', unlockedForPve: true, jutsus: [] }],
        activePetIds: [`${name}-pet`], jutsus: [], equipment: {}, inventory: [] } });
});
const config = { action: 'create', name: 'Test Cup', mode: 'standard', signupMinutes: 1, maxEntries: 8, readySeconds: 120, petFormat: '1v1', notes: '' };
async function create(mode = 'standard') {
    const response = await request({ ...config, mode }); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.event as Tournament;
}
async function join(event: Tournament, id: string, extra = {}) {
    const response = await request({ action: 'join', eventId: event.id, ...extra }, auth(id));
    assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.event as Tournament;
}
async function start(context: { mock: { timers: { tick(ms: number): void } } }, event: Tournament) {
    context.mock.timers.tick(60_000);
    await store.tickTournaments();
    const state = (await store.readTournament())!; assert.equal(state.id, event.id); return state;
}
test('admin authority, bounded configuration, stale events, and server identity', async () => {
    assert.equal((await request(undefined, {})).status, 401);
    assert.equal((await request(config, auth('akira'))).status, 403);
    assert.equal((await request(config, { 'x-admin-password': 'tournament-content-test' })).status, 403);
    for (const invalid of [{ signupMinutes: 0 }, { signupMinutes: Infinity }, { maxEntries: 100 }, { mode: 'fake' }, { readySeconds: 10 }, { notes: 'x'.repeat(1001) }]) {
        assert.equal((await request({ ...config, ...invalid })).status, 400);
    }
    const event = await create();
    assert.equal(event.endsAt - event.signupEndsAt, 3600_000);
    assert.equal((await request(config)).status, 409);
    assert.equal((await request({ action: 'join', eventId: 'old' }, auth('akira'))).status, 409);
    const joined = await join(event, 'akira', { playerId: 'ren' });
    assert.equal(joined.entries[0]!.members[0]!.id, 'akira');
    await join(event, 'akira');
    assert.equal((await store.readTournament())!.entries.length, 1);
    assert.equal((await request({ action: 'champion', eventId: event.id, winner: 'akira' }, auth('akira'))).status, 400);
});
test('2v2 partners explicitly accept, cannot be duplicated, and incomplete pairs are excluded', async context => {
    const event = await create('2v2');
    await join(event, 'akira', { partner: 'ren' });
    assert.equal((await request({ action: 'join', eventId: event.id, partner: 'ren' }, auth('sora'))).status, 409);
    await join(event, 'sora', { partner: 'yuki' });
    const accepted = await request({ action: 'accept', eventId: event.id }, auth('ren'));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.event.entries[0].members.every((m: any) => m.accepted), true);
    const closed = await start(context, event);
    assert.equal(closed.status, 'cancelled');
    assert.equal((await request({ action: 'accept', eventId: event.id }, auth('yuki'))).status, 409);
});
test('solo matches publish once, keep tournament recovery leases, and advance only from combat', async context => {
    const event = await create(); await join(event, 'akira'); await join(event, 'ren');
    const live = await start(context, event), match = live.matches[0]!;
    assert.equal(live.status, 'live');
    assert.equal((await request({ action: 'join', eventId: event.id }, auth('sora'))).status, 409);
    assert.equal((await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth('sora'))).status, 403);
    for (const id of ['akira', 'ren']) assert.equal((await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth(id))).status, 200);
    const first = await request({ action: 'battle', eventId: event.id, matchId: match.id }, auth('akira'));
    const second = await request({ action: 'battle', eventId: event.id, matchId: match.id }, auth('ren'));
    assert.equal(first.body.match.matchId, second.body.match.matchId);
    assert.equal(first.body.match.roster.length, 2);
    assert.equal(first.body.match.rules.consumables, 'disabled');
    assert.equal((await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth('ren'))).status, 200, 'lost ready responses can be retried after publication');
    assert.equal((await kv.get<any>('battle-lock:akira')).meta.mode, 'tournament');
    assert.equal((await request({ action: 'settle', eventId: event.id, matchId: match.id, winner: 'akira' }, auth('akira'))).status, 409);
    const { withTowerPvpMatchMutation, writeTowerPvpMatch } = await import('../towers/_pvp-store.js');
    await withTowerPvpMatchMutation(match.battleId, async battle => {
        battle!.status = 'done'; battle!.winner = 'amber'; battle!.combat.status = 'done'; battle!.combat.winner = 'squad';
        await writeTowerPvpMatch(battle!);
    });
    context.mock.timers.tick(3001);
    await store.tickTournaments();
    assert.equal((await store.readTournament())!.champion, match.a);
    assert.equal(await kv.get('battle-lock:akira'), null);
    const replacement = await create('ranked'); assert.notEqual(replacement.id, event.id);
    // Viewing an old result cannot overwrite the new event.
    assert.equal((await request({ action: 'settle', eventId: event.id, matchId: match.id }, auth('akira'))).status, 200);
    assert.equal((await store.readTournament())!.id, replacement.id);
});
test('hospitalization prevents tournament readiness and closes the ready-to-publication race', async context => {
    const event = await create(); await join(event, 'akira'); await join(event, 'ren');
    const live = await start(context, event), match = live.matches[0]!;
    const save = await kv.get<any>('save:akira');
    await kv.set('save:akira', { ...save, character: { ...save.character, hp: 0, hospitalized: true,
        hospitalizedAt: Date.now(), hospitalizedUntil: Date.now() + 60_000 } });
    assert.equal((await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth('akira'))).status, 409);
    assert.equal(await kv.get(`tower-pvp:match:${match.battleId}`), null);

    await kv.set('save:akira', { ...save, character: { ...save.character, hp: 1000 } });
    assert.equal((await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth('akira'))).status, 200);
    const readySave = await kv.get<any>('save:akira');
    await kv.set('save:akira', { ...readySave, character: { ...readySave.character, hp: 0, hospitalized: true,
        hospitalizedAt: Date.now(), hospitalizedUntil: Date.now() + 60_000 } });
    assert.equal((await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth('ren'))).status, 200);
    assert.equal(await kv.get(`tower-pvp:match:${match.battleId}`), null, 'publication must recheck every fighter');
    assert.deepEqual((await store.readTournament())!.matches[0]!.ready, ['ren']);
    assert.equal((await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth('akira'))).status, 409);
});
test('fixed 2v2 pairs enter four-human combat with no team reshuffle', async context => {
    const event = await create('2v2'); await join(event, 'akira', { partner: 'ren' }); await join(event, 'sora', { partner: 'yuki' });
    for (const id of ['ren', 'yuki']) assert.equal((await request({ action: 'accept', eventId: event.id }, auth(id))).status, 200);
    const live = await start(context, event), match = live.matches[0]!;
    for (const id of players.slice(0, 4)) await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth(id));
    const opened = await request({ action: 'battle', eventId: event.id, matchId: match.id }, auth('akira'));
    assert.equal(opened.body.match.roster.length, 4);
    const team = (id: string) => opened.body.match.roster.find((m: any) => m.slug === id).teamId;
    assert.equal(team('akira'), team('ren')); assert.equal(team('sora'), team('yuki')); assert.notEqual(team('akira'), team('sora'));
    await request({ action: 'cancel', eventId: event.id });
    const cancelled = await request({ action: 'battle', eventId: event.id, matchId: match.id }, auth('akira'));
    assert.equal(cancelled.body.match.status, 'cancelled');
    assert.ok(cancelled.body.match.version > opened.body.match.version);
    for (const id of players.slice(0, 4)) assert.equal(await kv.get(`battle-lock:${id}`), null);
});
test('round deadline rejects late actions and records the authoritative health winner', async context => {
    const event = await create('ranked'); await join(event, 'akira'); await join(event, 'ren');
    const live = await start(context, event), match = live.matches[0]!;
    for (const id of ['akira', 'ren']) await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth(id));
    const { withTowerPvpMatchMutation, writeTowerPvpMatch, readTowerPvpMatch } = await import('../towers/_pvp-store.js');
    await withTowerPvpMatchMutation(match.battleId, async battle => {
        battle!.combat.actors.find(a => a.side === 'squad')!.hp = 1;
        await writeTowerPvpMatch(battle!);
    });
    context.mock.timers.tick(3600_000);
    const before = (await readTowerPvpMatch(match.battleId))!;
    const { applyTowerPvpCommand } = await import('../towers/_pvp-action.js');
    const result = await applyTowerPvpCommand({ matchId: match.battleId, slug: before.roster[0]!.slug, type: 'wait', moveToken: 'tournament_late_action_12345', expectedVersion: before.version });
    assert.equal(result.applied, false); assert.equal(result.match!.status, 'done'); assert.equal(result.match!.winner, 'violet');
    await store.tickTournaments();
    assert.equal((await store.readTournament())!.champion, match.b);
});
test('an interrupted admin cancellation persists its intent and the clock finishes cleanup', async context => {
    const event = await create(); await join(event, 'akira'); await join(event, 'ren');
    const live = await start(context, event), match = live.matches[0]!;
    for (const id of ['akira', 'ren']) await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth(id));
    const read = kv.get.bind(kv);
    const failure = context.mock.method(kv, 'get', async (key: string) => {
        if (key === `tower-pvp:match:${match.battleId}`) throw new Error('simulated storage outage');
        return read(key);
    });
    assert.equal((await request({ action: 'cancel', eventId: event.id })).status, 500);
    failure.mock.restore();
    assert.equal((await store.readTournament())!.cancelRequested, true);
    context.mock.timers.tick(3001); await store.tickTournaments();
    assert.equal((await store.readTournament())!.status, 'cancelled');
    assert.equal(await kv.get('battle-lock:akira'), null);
    assert.equal(await kv.get('battle-lock:ren'), null);
});
test('no-shows and a server restart beyond the one-hour window cannot stall the bracket', async context => {
    const event = await create(); for (const id of players) await join(event, id);
    const live = await start(context, event);
    assert.equal(live.rounds, 3); assert.equal(live.matches.filter(m => m.reason === 'Bye').length, 3);
    const match = live.matches.find(m => m.status === 'waiting')!;
    const player = live.entries.find(e => e.id === match.a)!.members[0]!.id;
    await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth(player));
    context.mock.timers.tick(120_000); await store.tickTournaments();
    assert.equal((await store.readTournament())!.matches.find(m => m.id === match.id)!.winner, match.a);
    context.mock.timers.tick(3600_000); await store.tickTournaments();
    const ended = (await store.readTournament())!; assert.equal(ended.status, 'complete'); assert.equal(ended.champion, null);
});
test('pet entrants select owned pets and both owners get the same server replay and winner', async context => {
    const event = await create('pet');
    assert.equal((await request({ action: 'join', eventId: event.id, petIds: ['ren-pet'] }, auth('akira'))).status, 409);
    await join(event, 'akira', { petIds: ['akira-pet'] }); await join(event, 'ren', { petIds: ['ren-pet'] });
    const live = await start(context, event), match = live.matches[0]!;
    for (const id of ['akira', 'ren']) assert.equal((await request({ action: 'ready', eventId: event.id, matchId: match.id }, auth(id))).status, 200);
    const a = await request({ action: 'battle', eventId: event.id, matchId: match.id }, auth('akira'));
    const b = await request({ action: 'battle', eventId: event.id, matchId: match.id }, auth('ren'));
    assert.ok(a.body.script); assert.deepEqual(a.body.script, b.body.script);
    assert.equal((await store.readTournament())!.status, 'complete');
    assert.equal((await request({ action: 'battle', eventId: event.id, matchId: match.id }, auth('sora'))).status, 403);
});
test('every bracket size through 64 eliminates to exactly one champion with fair byes', () => {
    for (let size = 2; size <= 64; size++) {
        const event: Tournament = { id: 'size-test', name: 'Cup', mode: 'standard', notes: '', createdAt: 0, signupEndsAt: 1,
            endsAt: 3600_001, status: 'signup', maxEntries: 64, readySeconds: 120, petFormat: '1v1',
            entries: Array.from({ length: size }, (_, i) => ({ id: `e${i}`, members: [{ id: `p${i}`, name: `P${i}`, accepted: true }] })),
            matches: [], round: 0, rounds: 0, champion: null };
        openBracket(event, 1, upper => upper - 1);
        assert.equal(new Set(event.matches.flatMap(m => [m.a, m.b]).filter(Boolean)).size, size);
        while (event.status === 'live') {
            event.matches.filter(m => m.status !== 'done').forEach(m => { m.status = 'done'; m.winner = m.a; });
            advanceBracket(event, 10);
        }
        assert.ok(event.champion); assert.equal(event.matches.filter(m => m.a && m.b).length, size - 1);
        assert.ok(event.matches.every(m => m.endsAt <= event.endsAt));
    }
});
