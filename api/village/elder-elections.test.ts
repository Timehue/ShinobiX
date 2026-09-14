import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { creditElderWins, elderTermScore, ELDER_TERM_MS } from '../../shared/elder-elections.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'elder-elections-integration-secret';
let kv: typeof import('../_storage.js').kv;
let read: typeof import('./_elder-council.js').readElderCouncil;
let handler: typeof import('./elder-focus.js').default;
let orderHandler: typeof import('./orders.js').default;
let token: typeof import('../_auth.js').issuePlayerToken;
const START = Date.UTC(2026, 8, 1);
const village = 'Frostfang Village';
const key = 'village:elder-council:frostfangvillage';
const stateKey = 'game:village-state:frostfangvillage';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    read = (await import('./_elder-council.js')).readElderCouncil;
    handler = (await import('./elder-focus.js')).default as unknown as typeof handler;
    orderHandler = (await import('./orders.js')).default as unknown as typeof handler;
    token = (await import('../_auth.js')).issuePlayerToken;
});

async function player(name: string, pvp = 0, pve = 0, at = START, home = village) {
    const character = creditElderWins({ name, village: home, totalAiKills: 10000, totalPvpKills: 10000,
        level: 90, examsPassed: ['genin', 'chunin', 'jonin'], pets: [] }, pvp, pve, at);
    await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: at, character });
    // Election scoring uses the save even if the public ranking row is stale.
    await kv.hset('player:registry', { [name]: {} });
}

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    (await import('../_proc-cache.js')).__clearProcCache();
    for (const name of ['kage', 'first', 'pvp', 'pve', 'idle']) await player(name);
    await kv.set('village:kage:frostfang-village', { seatedKage: 'kage', kageSystemUnlocked: true });
    await kv.set(stateKey, { elderAppointees: ['first', 'pvp', 'pve'], treasury: { ryo: 123 } });
});

async function request(name: string, body: Record<string, unknown>, endpoint = handler) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; },
        json(value: Record<string, any>) { out.body = value; return res; }, end() { return res; } };
    await endpoint({ method: 'POST', query: {}, body: { playerName: name, focus: 'war', ...body },
        headers: { 'x-player-token': token(name) }, socket: { remoteAddress: '127.0.0.97' },
    } as never, res as never);
    return out;
}

test('migration preserves only the Kage seat and starts a real 30-day competition', async () => {
    const council = await read(village, undefined, START + 12345);
    assert.deepEqual(council.seats, ['first', '', '']);
    assert.equal(council.startedAt, START);
    assert.equal(council.nextSelectionAt, START + ELDER_TERM_MS);
    assert.deepEqual(council.winningScores, [0, 0]);
});

test('generic saves cannot invent, replace or erase election wins and ranked receipts', async () => {
    const { sanitizeProgression } = await import('../save/_sanitize-progression.js');
    const forged = { elderWinDays: [{ day: '2026-09-01', village: 'frostfangvillage', pvp: 999, pve: 999 }],
        elderRankedWinReceipts: [{ id: 'forged', at: START }] };
    for (const firstSave of [true, false]) {
        const incoming: Record<string, unknown> = { ...forged };
        sanitizeProgression(incoming, {}, incoming, firstSave ? null : { character: {} }, firstSave, { now: START });
        assert.equal(incoming.elderWinDays, undefined);
        assert.equal(incoming.elderRankedWinReceipts, undefined);
    }
    const legitimate = { elderWinDays: [{ day: '2026-09-01', village: 'frostfangvillage', pvp: 1, pve: 2 }],
        elderRankedWinReceipts: [{ id: 'real-battle', at: START }] };
    for (const patch of [forged, {}]) {
        const incoming: Record<string, unknown> = { ...patch };
        sanitizeProgression(incoming, legitimate, incoming, { character: legitimate }, false, { now: START });
        assert.deepEqual(incoming.elderWinDays, legitimate.elderWinDays);
        assert.deepEqual(incoming.elderRankedWinReceipts, legitimate.elderRankedWinReceipts);
    }
});

test('exact rollover elects last-term winners, expires the Kage seat and holds winners for the next term', async () => {
    await read(village, undefined, START);
    await player('pvp', 20, 100);
    await player('pve', 5, 30);
    await player('outsider', 900, 900, START, 'Stormveil Village');
    assert.deepEqual((await read(village, undefined, START + ELDER_TERM_MS - 1)).seats, ['first', '', '']);
    const council = await read(village, undefined, START + ELDER_TERM_MS);
    assert.deepEqual(council.seats, ['', 'pvp', 'pve']);
    assert.deepEqual(council.winningScores, [20, 30]);
    await player('idle', 999, 999, START + ELDER_TERM_MS);
    assert.deepEqual((await read(village, undefined, START + ELDER_TERM_MS + 86400000)).seats, council.seats);
    assert.deepEqual((await read(village, undefined, START + 2 * ELDER_TERM_MS)).seats, ['', 'idle', '']);
});

test('an offline village catches up using only the latest completed term, with no fabricated carryover', async () => {
    await read(village, undefined, START);
    await player('pvp', 500, 500, START);
    await player('pve', 0, 3, START + 2 * ELDER_TERM_MS);
    const council = await read(village, undefined, START + 3 * ELDER_TERM_MS + 1234);
    assert.equal(council.startedAt, START + 3 * ELDER_TERM_MS);
    assert.equal(council.nextSelectionAt, START + 4 * ELDER_TERM_MS);
    assert.deepEqual(council.seats, ['', '', 'pve']);
});

test('concurrent readers run a single election and cannot erase a new Kage appointment', async t => {
    t.mock.method(Date, 'now', () => START);
    await read(village);
    await player('pvp', 9, 0);
    await player('pve', 0, 8);
    t.mock.method(Date, 'now', () => START + ELDER_TERM_MS);
    const [elected, appointed, concurrent] = await Promise.all([
        read(village), request('kage', { action: 'appoint', appointee: 'first' }), read(village),
    ]);
    assert.deepEqual(elected.seats.slice(1), ['pvp', 'pve']);
    assert.deepEqual(concurrent.seats.slice(1), ['pvp', 'pve']);
    assert.equal(appointed.status, 200);
    assert.deepEqual((await read(village)).seats, ['first', 'pvp', 'pve']);
    assert.equal((await read(village)).nextSelectionAt, START + 2 * ELDER_TERM_MS);
    assert.equal((await kv.get<any>(stateKey)).treasury.ryo, 123);
});

test('Kage cannot appoint or clear earned seats, duplicate an elected player or extend the term', async t => {
    t.mock.method(Date, 'now', () => START);
    await read(village);
    await player('pvp', 3, 0);
    await player('pve', 0, 2);
    t.mock.method(Date, 'now', () => START + ELDER_TERM_MS);
    await read(village);
    for (const focus of ['trade', 'training']) for (const action of ['appoint', 'clear']) {
        assert.equal((await request('kage', { action, focus, appointee: 'idle' })).status, 403);
    }
    assert.equal((await request('kage', { action: 'appoint', appointee: 'pvp' })).status, 409);
    assert.equal((await request('idle', { action: 'appoint', appointee: 'idle' })).status, 403);
    t.mock.method(Date, 'now', () => START + ELDER_TERM_MS + 3 * 86400000);
    assert.equal((await request('kage', { action: 'appoint', appointee: 'idle' })).status, 200);
    assert.equal((await read(village)).nextSelectionAt, START + 2 * ELDER_TERM_MS);
});

test('election results drive orders, exams, war roles and focus without trusting old village blobs', async t => {
    t.mock.method(Date, 'now', () => START);
    await read(village);
    await player('pvp', 3, 0);
    await player('pve', 0, 2);
    t.mock.method(Date, 'now', () => START + ELDER_TERM_MS);
    const roles = await import('../_war-role.js');
    const exam = (await import('../exams/pass.js')).default as unknown as typeof handler;
    const order = { action: 'post', id: 'elected-order', type: 'general', title: 'Rally', body: 'Defend the gate.' };
    assert.equal((await request('first', order, orderHandler)).status, 403, 'expired first seat has no orders');
    assert.equal((await request('pvp', order, orderHandler)).status, 200);
    assert.deepEqual(await roles.sectorWarRoleOf('pve', village), roles.ROLE_ELDER);
    assert.deepEqual(await roles.sectorWarRoleOf('first', village), roles.ROLE_VILLAGER);
    assert.equal((await request('pve', { examKey: 'specialJonin' }, exam)).status, 200);
    assert.equal((await request('idle', { action: 'select', focus: 'training' })).status, 200);
    assert.equal((await request('idle', { action: 'select', focus: 'war' })).status, 403);
    await player('pve', 0, 2, START, 'Stormveil Village');
    assert.equal((await request('pve', { ...order, id: 'foreign-order' }, orderHandler)).status, 403);
    assert.equal((await request('idle', { action: 'select', focus: 'training' })).status, 403);
    const { reconcileElderFocus } = await import('./_elders.js');
    assert.equal((await reconcileElderFocus({ village, elderFocus: 'training' })).elderFocus, undefined);
});

test('Endless Tower counts a verified wave once; losses and cashing out add no council win', async () => {
    const endpoint = (await import('../endless/run.js')).default as unknown as typeof handler;
    const { createEndlessWaveBinding, endlessWaveBindingKey } = await import('../endless/_wave-session.js');
    const { soloPveSessionKey } = await import('../solo-pve/_store.js');
    for (const [index, outcome] of ['win', 'loss'].entries()) {
        const name = `wave${index}`;
        const runToken = '1234567890abcdef';
        const waveRunId = `endlesswave-${String(index).repeat(32)}`;
        await player(name);
        const record = await kv.get<any>(`save:${name}`);
        await kv.set(`save:${name}`, { ...record, character: { ...record.character,
            hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            endlessTowerRun: { runToken, wave: 1, bankedRyo: 0, bankedXp: 0, startedAt: Date.now() },
        } });
        await kv.set(endlessWaveBindingKey(waveRunId), createEndlessWaveBinding({ runId: waveRunId, playerName: name, runToken, wave: 1, opponentId: 'wave-foe' }));
        await kv.set(soloPveSessionKey(waveRunId), { runtime: 'solo-pve', schemaVersion: 1, version: 2,
            sessionId: waveRunId, ownerSlug: name, status: 'done', outcome, winner: outcome === 'win' ? 'player' : 'opponent',
            encounter: { kind: 'endless-wave', id: `${runToken}:1`, sourceId: 'wave-foe', bindingId: waveRunId },
            player: { name, hp: outcome === 'win' ? 50 : 0, chakra: 50, stamina: 50 },
            itemsUsed: {}, terminalEvidence: { settlementState: 'pending' }, settlementState: 'pending',
        });
        for (let i = 0; i < 2; i++) {
            const result = await request(name, { action: 'settle', runToken, waveRunId }, endpoint);
            assert.equal(result.status, 200, JSON.stringify(result.body));
            assert.equal(result.body.character.elderWinDays?.[0]?.pve ?? 0, outcome === 'win' ? 1 : 0);
        }
        if (outcome === 'win') {
            const cashed = await request(name, { action: 'cashout', runToken }, endpoint);
            assert.equal(cashed.status, 200);
            assert.equal(cashed.body.character.elderWinDays[0].pve, 1);
        }
    }
});

test('Hollow Gate banks the player victory and its council win once across settlement replays', async () => {
    const endpoint = (await import('../hollow-gate/combat-settle.js')).default as unknown as typeof handler;
    const { createHollowGateCombatBinding, hollowGateCombatBindingKey } = await import('../hollow-gate/_combat-session.js');
    const { hollowGateRunKey } = await import('../hollow-gate/_run-token.js');
    const { soloPveSessionKey } = await import('../solo-pve/_store.js');
    const name = 'idle', runToken = 'elderhollowrun01', runId = 'hgcombat-elder-election-test';
    const binding = createHollowGateCombatBinding({ playerName: name, token: runToken, floor: 1, nodeId: 'floor:1:tile:7', kind: 'battle', combatMode: 'solo-pve', runId });
    const activeEncounter = { runId, nodeId: binding.nodeId, floor: 1, kind: binding.kind, enemyProfileId: binding.enemyProfileId, createdAt: binding.createdAt };
    await kv.set(hollowGateCombatBindingKey(runId), binding);
    await kv.set(hollowGateRunKey(name, runToken), { playerName: name, mintedAt: Date.now(), currentFloor: 1, floorDepth: 1,
        seed: 'elder-gate-seed', activeEncounter, resolvedEncounterIds: [], keys: 0, torch: 10, threat: 0 });
    const record = await kv.get<any>(`save:${name}`);
    await kv.set(`save:${name}`, { ...record, character: { ...record.character, hp: 100, maxHp: 100,
        chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, hollowGateRun: { runToken, floor: 1, activeCombat: { ...activeEncounter, mode: 'solo-pve' } },
    } });
    await kv.set(soloPveSessionKey(runId), { runtime: 'solo-pve', schemaVersion: 1, version: 2, sessionId: runId,
        ownerSlug: name, status: 'done', winner: 'player', outcome: 'win', player: { name, hp: 50 }, itemsUsed: {},
        terminalEvidence: { settlementState: 'pending' }, settlementState: 'pending', encounter: { kind: 'hollow-gate', bindingId: runId,
            sourceId: binding.enemyProfileId, metadata: { floor: 1, nodeId: binding.nodeId, combatKind: binding.kind } },
    });
    for (let i = 0; i < 2; i++) {
        const result = await request(name, { token: runToken, runId }, endpoint);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.character.elderWinDays[0].pve, 1);
    }
});


test('a ranked settlement recovered after rollover counts once in its crediting term without changing the elected council', async () => {
    const { creditRankedElderWin } = await import('./_elder-ranked-win.js');
    await read(village, undefined, START);
    const rollover = START + ELDER_TERM_MS;
    const elected = await read(village, undefined, rollover);
    const lock = async <T>(_key: string, run: () => Promise<T>) => run();
    await creditRankedElderWin(kv, lock, 'pvp', 'late-ranked-match', rollover - 1000, rollover + 1000);
    await creditRankedElderWin(kv, lock, 'pvp', 'late-ranked-match', rollover - 1000, rollover + 86400000);
    const days = (await kv.get<any>('save:pvp')).character.elderWinDays;
    assert.deepEqual(elderTermScore(days, village, START, rollover), { pvp: 0, pve: 0 });
    assert.deepEqual(elderTermScore(days, village, rollover, rollover + ELDER_TERM_MS), { pvp: 1, pve: 0 });
    assert.deepEqual((await read(village, undefined, rollover + 86400000)).seats, elected.seats);
});
