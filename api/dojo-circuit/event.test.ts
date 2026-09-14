import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'dojo-test-full';
process.env.ADMIN_CONTENT_PASSWORD = 'dojo-test-content';
process.env.SESSION_SECRET = 'dojo-test-session-secret-at-least-32-characters';
let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./event.js').default;
let store: typeof import('./_store.js');
let tokens: Record<string, string>;
const admin = { 'x-admin-password': 'dojo-test-full' };
const player = (name = 'akira') => ({ 'x-player-token': tokens[name], 'x-player-name': name });
async function request(body?: Record<string, unknown>, headers: Record<string, string> = admin, query = {}, target = handler) {
    const out = { status: 200, body: {} as any };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: unknown) { out.body = value; return res; }, end() { return res; } };
    await target({ method: body ? 'POST' : 'GET', body, headers, query, socket: { remoteAddress: '127.0.0.91' } } as never, res as never);
    return out;
}
before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./event.js')).default as unknown as typeof handler;
    store = await import('./_store.js');
    const { issuePlayerToken } = await import('../_auth.js');
    tokens = Object.fromEntries(['akira', 'ren'].map(name => [name, issuePlayerToken(name)!]));
});
let clockWindow = 0;
beforeEach(async context => {
    // Isolate both in-process and KV rate windows without weakening production limits.
    if (!('mock' in context)) throw new Error('Circuit fixtures require a per-test clock.');
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() + (++clockWindow) * 60_001 });
    const keys = await kv.keys('game:dojo-circuit:*');
    if (keys.length) await kv.del(...keys);
    for (const name of ['akira', 'ren']) await kv.set(`save:${name}`, { character: { name, village: name === 'akira' ? 'Stormveil Village' : 'Frostfang Village', level: 25, starterCardsClaimed: true, pets: [{ id: 'pet-a' }], cardClashWins: 5, totalPetWins: 7, totalAiKills: 11 } });
});
async function create() {
    assert.equal((await request({ action: 'toggle', enabled: true })).status, 200);
    const result = await request({ action: 'schedule', name: 'The Lantern Gathering', startsAt: Date.now() - 100, days: 7, featured: 'combat' });
    assert.equal(result.status, 200);
    const eventId = result.body.event.id;
    assert.equal((await request({ action: 'join', eventId }, player())).status, 200);
    return eventId;
}
test('authentication, full-admin controls, input validation and upcoming admission', async () => {
    assert.equal((await request(undefined, {})).status, 401);
    assert.equal((await request({ action: 'toggle', enabled: true }, { 'x-admin-password': 'dojo-test-content' })).status, 403);
    assert.equal((await request({ action: 'toggle', enabled: true }, player())).status, 403);
    assert.equal((await request({ action: 'toggle', enabled: 'true' })).status, 400);
    assert.equal((await request({ action: 'schedule', name: 'bad', startsAt: Date.now(), days: 99, featured: 'combat' })).status, 400);
    await request({ action: 'toggle', enabled: true });
    const upcoming = await request({ action: 'schedule', name: 'Tomorrow', startsAt: Date.now() + 86400_000, days: 7, featured: 'cards' });
    assert.equal((await request({ action: 'join', eventId: upcoming.body.event.id }, player())).status, 409);
});
test('joining is explicit and idempotent; only new authoritative victories earn a seal', async () => {
    const eventId = await create();
    await request({ action: 'join', eventId }, player());
    assert.equal((await request()).body.event.entrants.length, 1);
    const opened = await request({ action: 'begin', eventId, discipline: 'cards' }, player());
    assert.equal((await request({ action: 'check', eventId, winner: true, wins: 100 }, player())).status, 409);
    const save = await kv.get<any>('save:akira');
    save.character.cardClashWins++;
    await kv.set('save:akira', save);
    const resumed = await request({ action: 'begin', eventId, discipline: 'cards' }, player());
    assert.equal(resumed.body.attempt.openedAt, opened.body.attempt.openedAt);
    assert.equal((await request({ action: 'check', eventId }, player())).status, 409, 'counter changes alone are not match proof');
    await store.recordCircuitPendingVictory('akira', 'cards', { matchId: 'verified-card', startedAt: resumed.body.attempt.openedAt, finishedAt: Date.now() });
    const result = await request({ action: 'check', eventId }, player());
    assert.equal(result.status, 200);
    assert.equal(result.body.event.entrants[0].seals.length, 1);
    assert.equal((await request({ action: 'check', eventId }, player())).status, 409);
    assert.equal((await request()).body.event.entrants[0].seals.length, 1);
    assert.equal((await request(undefined, player('ren'))).body.attempt, null);
    assert.equal((await request({ action: 'begin', eventId, discipline: 'pets' }, player('ren'))).status, 409);
});
test('off blocks admission and invalidates unfinished trials without deleting earned seals', async () => {
    const eventId = await create();
    await request({ action: 'begin', eventId, discipline: 'cards' }, player());
    await request({ action: 'toggle', enabled: true });
    assert.ok((await request(undefined, player())).body.attempt, 'idempotent toggle preserves an active trial');
    await request({ action: 'toggle', enabled: false });
    assert.equal((await request({ action: 'check', eventId }, player())).status, 409);
    assert.equal((await request()).body.event.entrants.length, 1);
    await request({ action: 'toggle', enabled: true });
    assert.equal((await request(undefined, player())).body.attempt, null);
});
test('sealed combat evidence earns exactly one seal; old sessions and deadline violations do not', async () => {
    const eventId = await create();
    const start = await request({ action: 'begin', eventId, discipline: 'combat' }, player());
    const opened = start.body.attempt.openedAt;
    await store.recordCircuitCombatVictory('akira', opened - 100, opened + 100);
    assert.equal((await request()).body.event.entrants[0].seals.length, 0);
    await store.recordCircuitCombatVictory('akira', opened + 1, start.body.event.endsAt + 1);
    assert.equal((await request()).body.event.entrants[0].seals.length, 0);
    await store.recordCircuitCombatVictory('akira', opened + 1, opened + 10);
    await store.recordCircuitCombatVictory('akira', opened + 1, opened + 10);
    assert.equal((await request()).body.event.entrants[0].seals.length, 1);
});
test('closing rejects activity; honours require a finisher; rollover preserves the complete archive', async () => {
    const eventId = await create();
    const state = await store.readCircuit();
    state.event!.entrants[0].seals = ['combat', 'cards', 'pets'].map(d => ({ discipline: d as never, earnedAt: Date.now() }));
    await kv.set(store.CIRCUIT_KEY, state);
    assert.equal((await request({ action: 'champion', eventId, championId: 'akira' })).status, 409);
    await request({ action: 'end', eventId });
    assert.equal((await request({ action: 'join', eventId }, player('ren'))).status, 409);
    assert.equal((await request({ action: 'champion', eventId, championId: 'ren' })).status, 400);
    assert.equal((await request({ action: 'champion', eventId, championId: 'akira' })).status, 200);
    const next = await request({ action: 'schedule', name: 'Second Gathering', startsAt: Date.now(), days: 7, featured: 'pets' });
    assert.equal(next.status, 200);
    assert.equal(next.body.history[0].champion, 'akira');
    const archived = await request(undefined, player(), { eventId });
    assert.equal(archived.body.event.entrants[0].seals.length, 3);
    assert.equal(archived.body.event.championId, 'akira');
    assert.equal((await request({ action: 'begin', eventId, discipline: 'cards' }, player())).status, 409);
});
test('a real sealed practice settlement records Circuit credit without adding normal combat rewards', async () => {
    const eventId = await create();
    const previous = await kv.get<any>('save:akira');
    await kv.set('save:akira', { ...previous, _saveVersion: 1, currentSector: 1, savedBloodlines: [], creatorJutsus: [], acceptedMissionIds: [], missionProgress: {}, character: {
        ...previous.character, specialty: 'Ninjutsu', rankTitle: 'Genin', hp: 600, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, ryo: 500, inventory: [], itemStacks: [], pets: [], equippedJutsuIds: ['starter-universal-flicker'],
        stats: { strength: 100, speed: 100, intelligence: 140, willpower: 120, ninjutsuOffense: 300, ninjutsuDefense: 250, taijutsuOffense: 100, taijutsuDefense: 100, bukijutsuOffense: 100, bukijutsuDefense: 100, genjutsuOffense: 100, genjutsuDefense: 100 },
    } });
    await request({ action: 'begin', eventId, discipline: 'combat' }, player());
    const start = (await import('../missions/ai-fight-start.js')).default as unknown as typeof handler;
    const report = (await import('../missions/report-ai-fight.js')).default as unknown as typeof handler;
    const started = await request({ playerName: 'akira', battleKind: 'practice', opponentId: 'builtin-ai-exam-proctor', opponentLevel: 25 }, player(), {}, start);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const { readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js');
    const session = await readSoloPveSession(started.body.sessionId);
    assert.ok(session);
    // This fixture supplies a server terminal result; the HTTP caller supplies no winner.
    await writeSoloPveSession({ ...session, status: 'done', winner: 'player', outcome: 'win', settlementState: 'pending', version: session.version + 1,
        enemy: { ...session.enemy, hp: 0 }, terminalEvidence: { finishedAt: Date.now(), finalMoveToken: 'dojo-terminal', finalVersion: session.version + 1, finalEventSeq: session.eventSeq, winner: 'player', outcome: 'win', itemsUsed: {}, settlementState: 'pending' } });
    const settled = await request({ playerName: 'akira', aiFightToken: started.body.token }, player(), {}, report);
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    const saved = await kv.get<any>('save:akira');
    assert.equal(saved.character.totalAiKills, 11);
    assert.equal(saved.character.ryo, 500);
    assert.deepEqual((await request()).body.event.entrants[0].seals.map((s: any) => s.discipline), ['combat']);
    assert.equal((await request({ playerName: 'akira', aiFightToken: started.body.token }, player(), {}, report)).status, 200);
    assert.equal((await request()).body.event.entrants[0].seals.length, 1);
});

test('the real player-card host records qualified victories once and rejects forfeits and old matches', async () => {
    const eventId = await create();
    await request({ action: 'begin', eventId, discipline: 'cards' }, player());
    const now = Date.now();
    const circuit = await store.readCircuit();
    circuit.event!.startsAt = now - 120_000;
    circuit.attempts['player:akira'].openedAt = now - 90_000;
    await kv.set(store.CIRCUIT_KEY, circuit);
    const match = (await import('../card-clash/match.js')).default as unknown as typeof handler;
    const { createMatch, CHRONICLE_RULES_VERSION } = await import('../../shared/chronicle-duel.js');
    const { CHRONICLE_AI_DECKS } = await import('../card-clash/_ai-engine.js');
    const state = createMatch('akira', [...CHRONICLE_AI_DECKS.hard], 'ren', [...CHRONICLE_AI_DECKS.medium], () => .5, now - 60_000);
    state.status = 'complete'; state.winner = 'p1'; state.turnNumber = 3;
    const matchId = '55555555-5555-4555-8555-555555555555';
    const session = { matchId, rulesVersion: CHRONICLE_RULES_VERSION, p1Name: 'akira', p2Name: 'ren', state, status: 'done', createdAt: now - 60_000, updatedAt: now,
        participation: { startedAt: now - 60_000, p1Actions: 3, p2Actions: 3, endedBy: 'forfeit' } };
    await kv.set(`cc-freeplay:${matchId}`, session);
    assert.equal((await request({ action: 'state', matchId }, player(), {}, match)).status, 200);
    assert.equal((await store.readCircuit()).event!.entrants[0].seals.length, 0, 'a forfeit does not qualify');
    await kv.set(`cc-freeplay:${matchId}`, { ...session, participation: { ...session.participation, startedAt: now - 100_000, endedBy: 'play' } });
    assert.equal((await request({ action: 'state', matchId }, player(), {}, match)).status, 200);
    assert.equal((await store.readCircuit()).event!.entrants[0].seals.length, 0, 'a match started before the trial does not qualify');
    await kv.set(`cc-freeplay:${matchId}`, { ...session, participation: { ...session.participation, endedBy: 'play' } });
    assert.equal((await request({ action: 'state', matchId }, player(), {}, match)).status, 200);
    assert.deepEqual((await store.readCircuit()).event!.entrants[0].seals.map(s => s.discipline), ['cards']);
    assert.equal((await request({ action: 'state', matchId }, player(), {}, match)).status, 200);
    assert.equal((await store.readCircuit()).event!.entrants[0].seals.length, 1);
});

test('spotlight rotates once per event day and freezes at closing; all four villages are explicit', async () => {
    const { circuitFeatured, CIRCUIT_VILLAGES } = await import('../../shared/dojo-circuit.js');
    await create();
    const event = (await store.readCircuit()).event!;
    assert.equal(CIRCUIT_VILLAGES.length, 4);
    event.featured = 'cards';
    assert.equal(circuitFeatured(event, event.startsAt - 1), 'cards');
    assert.equal(circuitFeatured(event, event.startsAt + 86400_000 - 1), 'cards');
    assert.equal(circuitFeatured(event, event.startsAt + 86400_000), 'pets');
    assert.equal(circuitFeatured(event, event.startsAt + 2 * 86400_000), 'combat');
    event.endedAt = event.startsAt + 2 * 86400_000;
    assert.equal(circuitFeatured(event, event.endsAt + 86400_000), 'pets');
});

test('companion check-in requires host proof instead of lifetime counters and enforces unlocks', async () => {
    const eventId = await create();
    const save = await kv.get<any>('save:akira');
    await kv.set('save:akira', { ...save, character: { ...save.character, starterCardsClaimed: false, pets: [] } });
    assert.equal((await request({ action: 'begin', eventId, discipline: 'cards' }, player())).status, 409);
    assert.equal((await request({ action: 'begin', eventId, discipline: 'pets' }, player())).status, 409);
    await kv.set('save:akira', save);
    await request({ action: 'begin', eventId, discipline: 'pets' }, player());
    save.character.cardClashWins++;
    await kv.set('save:akira', save);
    assert.equal((await request({ action: 'check', eventId, discipline: 'cards', totalPetWins: 100 }, player())).status, 409);
    save.character.totalPetWins++;
    await kv.set('save:akira', save);
    assert.equal((await request({ action: 'check', eventId }, player())).status, 409);
    const attempt = (await request(undefined, player())).body.attempt;
    await store.recordCircuitPendingVictory('akira', 'pets', { matchId: 'verified-pet', startedAt: attempt.openedAt, finishedAt: Date.now() });
    const result = await request({ action: 'check', eventId }, player());
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.event.entrants[0].seals.map((s: any) => s.discipline), ['pets']);
});

test('old combat and spoofed proof cannot bypass validation via lifetime-counter check-in', async () => {
    const eventId = await create();
    const opened = await request({ action: 'begin', eventId, discipline: 'combat' }, player());
    await store.recordCircuitCombatVictory('akira', opened.body.attempt.openedAt - 1, Date.now());
    const save = await kv.get<any>('save:akira'); save.character.totalAiKills++; await kv.set('save:akira', save);
    const checked = await request({ action: 'check', eventId, verifiedVictory: { matchId: 'fake', startedAt: opened.body.attempt.openedAt, finishedAt: Date.now() } }, player());
    assert.equal(checked.status, 409);
    assert.equal((await store.readCircuit()).event!.entrants[0].seals.length, 0);
});

test('pending proof rejects old matches, deadlines, wrong disciplines and is discarded by leave/off', async () => {
    const eventId = await create();
    const result = await request({ action: 'begin', eventId, discipline: 'cards' }, player());
    const openedAt = result.body.attempt.openedAt;
    await store.recordCircuitPendingVictory('akira', 'cards', { matchId: 'old', startedAt: openedAt - 1, finishedAt: Date.now() });
    await store.recordCircuitPendingVictory('akira', 'cards', { matchId: 'late', startedAt: openedAt, finishedAt: result.body.event.endsAt });
    await store.recordCircuitPendingVictory('akira', 'pets', { matchId: 'wrong', startedAt: openedAt, finishedAt: Date.now() });
    assert.equal((await request({ action: 'check', eventId }, player())).status, 409);
    await store.recordCircuitPendingVictory('akira', 'cards', { matchId: 'valid', startedAt: openedAt, finishedAt: Date.now() });
    assert.equal((await request({ action: 'begin', eventId, discipline: 'cards' }, player())).body.attempt.verifiedVictory.matchId, 'valid');
    await request({ action: 'leaveTrial', eventId }, player());
    await request({ action: 'begin', eventId, discipline: 'cards' }, player());
    assert.equal((await request({ action: 'check', eventId }, player())).status, 409);
    await request({ action: 'toggle', enabled: false });
    await store.recordCircuitPendingVictory('akira', 'cards', { matchId: 'disabled', startedAt: openedAt, finishedAt: Date.now() });
    await request({ action: 'toggle', enabled: true });
    assert.equal((await request(undefined, player())).body.attempt, null);
});

test('real card-AI settlement stages check-in proof and replays without duplicate credit', async context => {
    const eventId = await create();
    await request({ action: 'begin', eventId, discipline: 'cards' }, player());
    const { createAiMatch, CHRONICLE_AI_DECKS } = await import('../card-clash/_ai-engine.js');
    const matchId = '66666666-6666-4666-8666-666666666666';
    const session = createAiMatch(matchId, 'akira', [...CHRONICLE_AI_DECKS.medium], 'medium', Date.now(), () => .5);
    session.status = 'done'; session.winner = 'player'; session.state.status = 'complete'; session.state.winner = 'p1';
    await kv.set(`cc-ai:${matchId}`, session);
    context.mock.timers.tick(20_000);
    const ai = (await import('../card-clash/ai-move.js')).default as unknown as typeof handler;
    const originalSet = kv.set;
    (kv as any).set = async (...args: any[]) => {
        if (args[0] === store.CIRCUIT_KEY) throw new Error('injected Circuit proof write failure');
        return Reflect.apply(originalSet, kv, args);
    };
    try { assert.equal((await request({ action: 'state', matchId }, player(), {}, ai)).status, 500); }
    finally { kv.set = originalSet; }
    assert.ok((await kv.get<any>(`cc-ai:${matchId}`)).settledAt, 'terminal settlement survives a Circuit outage');
    assert.equal((await request({ action: 'state', matchId }, player(), {}, ai)).status, 200);
    assert.equal((await request(undefined, player())).body.attempt.verifiedVictory.matchId, `cc-ai:${matchId}`);
    assert.equal((await request({ action: 'check', eventId }, player())).status, 200);
    assert.equal((await request({ action: 'state', matchId }, player(), {}, ai)).status, 200);
    assert.deepEqual((await store.readCircuit()).event!.entrants[0].seals.map(s => s.discipline), ['cards']);
});

test('real paid companion settlement stages proof; practice and capped wins do not', async context => {
    const eventId = await create();
    await request({ action: 'begin', eventId, discipline: 'pets' }, player());
    const { createShowdownSession } = await import('../_pet-showdown/engine.js');
    const showdown = (await import('../pet/showdown.js')).default as unknown as typeof handler;
    const pet = (id: string) => ({ id, name: id, element: 'Fire', role: 'assassin', rarity: 'standard', level: 25, hp: 400, attack: 50, defense: 30, speed: 35, jutsus: [{ name: 'Ember Jab', power: 90, kind: 'damage' }] }) as any;
    const startedAt = Date.now(); context.mock.timers.tick(20_000);
    for (const variant of ['practice', 'capped', 'paid'] as const) {
        const save = await kv.get<any>('save:akira');
        save.character.dailyPetWins = variant === 'capped' ? 10000 : 0;
        save.character.lastDailyReset = new Date().toISOString().slice(0, 10);
        await kv.set('save:akira', save);
        const session = { ...createShowdownSession({ sessionId: `CircuitPet${variant}`, playerName: 'akira', format: '1v1', tier: 'scrapper', seed: 17, playerPets: [pet('p1')], enemyPets: [pet('e1')], enemyTeamName: 'Foes', rewardEligible: variant !== 'practice' }), createdAt: startedAt, finished: true, outcome: 'win', circuitFinishedAt: Date.now() };
        await kv.set(`pet:showdown:akira:${session.sessionId}`, session);
        if (variant === 'paid') {
            const originalSet = kv.set;
            (kv as any).set = async (...args: any[]) => {
                if (args[0] === store.CIRCUIT_KEY) throw new Error('injected Circuit proof write failure');
                return Reflect.apply(originalSet, kv, args);
            };
            try { assert.equal((await request({ action: 'turn', playerName: 'akira', sessionId: session.sessionId, commands: [] }, player(), {}, showdown)).status, 500); }
            finally { kv.set = originalSet; }
        }
        const result = await request({ action: 'turn', playerName: 'akira', sessionId: session.sessionId, commands: [] }, player(), {}, showdown);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        const pending = (await request(undefined, player())).body.attempt;
        if (variant !== 'paid') assert.equal(pending.verifiedVictory, undefined);
        else {
            assert.equal(pending.verifiedVictory.matchId, session.sessionId);
            assert.equal((await request({ action: 'check', eventId }, player())).status, 200);
            assert.equal((await request({ action: 'turn', playerName: 'akira', sessionId: session.sessionId, commands: [] }, player(), {}, showdown)).status, 200);
            assert.deepEqual((await store.readCircuit()).event!.entrants[0].seals.map(s => s.discipline), ['pets']);
        }
    }
});
