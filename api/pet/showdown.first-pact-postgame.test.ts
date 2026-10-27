import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import {
    createFirstPactProgress,
    FIRST_PACT_EXHIBITION_LENGTH,
    FIRST_PACT_EXHIBITION_ROUNDS,
    FIRST_PACT_EXHIBITION_STANDING,
    FIRST_PACT_UNBROKEN_ROUNDS,
    type FirstPactProgress,
} from '../../shared/first-pact-contract.js';
import type { ShowdownSession } from '../_pet-showdown/engine.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'first-pact-postgame-test-secret';

let PLAYER: string;
let caseIndex = 0;
const PET_IDS = ['own-a', 'own-b', 'own-c', 'own-d'];
let kv: typeof import('../_storage.js').kv;
let showdown: typeof import('./showdown.js').default;
let state: typeof import('../first-pact/state.js').default;
let token: string;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    showdown = (await import('./showdown.js')).default as unknown as typeof showdown;
    state = (await import('../first-pact/state.js')).default as unknown as typeof state;
});

beforeEach(async () => {
    PLAYER = `fppostgame${++caseIndex}`;
    token = (await import('../_auth.js')).issuePlayerToken(PLAYER)!;
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(`first-pact:${PLAYER}`, { ...createFirstPactProgress(), mainStep: 'complete' });
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: {
        name: PLAYER, level: 100,
        pets: PET_IDS.map(id => ({ id, name: id, element: 'Water', role: 'defender',
            rarity: 'standard', level: 90, hp: 800, attack: 120, defense: 95, speed: 105,
            jutsus: [{ name: 'Tide', power: 90, kind: 'damage' }] })),
    } });
});

async function call(handler: typeof showdown | typeof state, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader() { return res; }, status(status: number) { out.status = status; return res; },
        json(value: Record<string, any>) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body: { playerName: PLAYER, ...body },
        headers: { 'x-player-token': token }, socket: { remoteAddress: '127.0.0.95' } } as never, res as never);
    return out;
}
const pact = (body: Record<string, unknown>) => call(state, body);
const battle = (body: Record<string, unknown>) => call(showdown, body);
const progress = async () => (await kv.get<FirstPactProgress>(`first-pact:${PLAYER}`))!;

/** Seal a terminal result onto a started session, then claim it. Combat itself is covered elsewhere. */
async function finish(sessionId: string, outcome: 'win' | 'loss') {
    const key = `pet:showdown:${PLAYER}:${sessionId}`;
    const session = (await kv.get<ShowdownSession>(key))!;
    await kv.set(key, { ...session, finished: true, outcome }, { ex: 45 * 60 });
    const claimed = await battle({ action: 'turn', sessionId, commands: [] });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    return claimed.body;
}

async function draftRun() {
    const started = await pact({ action: 'exhibition-start' });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.exhibition.pool.length, 6);
    const ids = started.body.exhibition.pool.slice(0, 4).map((pet: { id: string }) => pet.id);
    const drafted = await pact({ action: 'exhibition-draft', petIds: ids });
    assert.equal(drafted.status, 200, JSON.stringify(drafted.body));
    return drafted.body.exhibition;
}

test('an Exhibition round fields the server\'s rentals, never pets the browser names', async () => {
    const run = await draftRun();
    const started = await battle({ action: 'first-pact', encounterId: FIRST_PACT_EXHIBITION_ROUNDS[0].id, petIds: PET_IDS });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const fielded = started.body.state.player.map((pet: { id: string }) => pet.id);
    assert.deepEqual(fielded, run.team.map((pet: { id: string }) => pet.id));
    assert.ok(fielded.every((id: string) => id.startsWith('rental-')));
    const skipped = await battle({ action: 'first-pact', encounterId: FIRST_PACT_EXHIBITION_ROUNDS[2].id });
    assert.equal(skipped.status, 409, 'rounds are fought in order');
});

test('a win offers one trade from the beaten stable; the trade swaps in place, once', async () => {
    await draftRun();
    const started = await battle({ action: 'first-pact', encounterId: FIRST_PACT_EXHIBITION_ROUNDS[0].id });
    const settled = await finish(String(started.body.state.sessionId), 'win');
    const view = settled.firstPact.exhibition;
    assert.equal(view.round, 1);
    assert.equal(view.offered.length, 4);
    const outgoing = view.team[1].id;
    const incoming = view.offered[0];
    const traded = await pact({ action: 'exhibition-swap', outPetId: outgoing, inPetId: incoming.id });
    assert.equal(traded.status, 200, JSON.stringify(traded.body));
    assert.equal(traded.body.exhibition.team[1].templateId, incoming.templateId, 'the recruit takes the traded slot');
    assert.equal(traded.body.exhibition.offered, null);
    assert.equal((await pact({ action: 'exhibition-swap', outPetId: view.team[0].id, inPetId: view.offered[1].id })).status, 409, 'one trade per win');
    assert.equal((await pact({ action: 'exhibition-swap', outPetId: 'own-a', inPetId: incoming.id })).status, 409);
});

test('a loss ends the run, keeps the best streak and pays nothing', async () => {
    await draftRun();
    const first = await battle({ action: 'first-pact', encounterId: FIRST_PACT_EXHIBITION_ROUNDS[0].id });
    await finish(String(first.body.state.sessionId), 'win');
    const second = await battle({ action: 'first-pact', encounterId: FIRST_PACT_EXHIBITION_ROUNDS[1].id });
    const lost = await finish(String(second.body.state.sessionId), 'loss');
    assert.equal(lost.firstPact.exhibition.status, 'lost');
    assert.equal((await progress()).exhibition.best, 1);
    assert.equal((await progress()).courtStanding, 0);
    assert.equal((await battle({ action: 'first-pact', encounterId: FIRST_PACT_EXHIBITION_ROUNDS[2].id })).status, 409);
});

test('a full run pays Court Standing once a day and credits Stable Champion', async () => {
    for (let pass = 0; pass < 2; pass++) {
        await draftRun();
        for (let index = 0; index < FIRST_PACT_EXHIBITION_LENGTH; index++) {
            const started = await battle({ action: 'first-pact', encounterId: FIRST_PACT_EXHIBITION_ROUNDS[index].id });
            assert.equal(started.status, 200, JSON.stringify(started.body));
            await finish(String(started.body.state.sessionId), 'win');
        }
    }
    const after = await progress();
    assert.equal(after.exhibition.clears, 2);
    assert.equal(after.courtStanding, FIRST_PACT_EXHIBITION_STANDING, 'the second clear the same day pays nothing');
    const read = await pact({ action: 'state' });
    assert.equal(read.status, 200, JSON.stringify(read.body));
    const save = await kv.get<{ character: { serverTitles?: string[] } }>(`save:${PLAYER}`);
    assert.ok(save?.character.serverTitles?.includes('Stable Champion'));
});

test('an Unbroken Hard replay fights stronger opponents and never touches the story record', async () => {
    const story = await progress();
    assert.equal((await pact({ action: 'replay-unbroken-start', hard: true })).status, 200);
    const round = FIRST_PACT_UNBROKEN_ROUNDS[0];
    const wrongSetting = await battle({ action: 'first-pact', encounterId: round.id, petIds: PET_IDS, replay: { hard: false, unbroken: true } });
    assert.equal(wrongSetting.status, 409, 'a Hard attempt is fought on Hard');
    const started = await battle({ action: 'first-pact', encounterId: round.id, petIds: PET_IDS, replay: { hard: true, unbroken: true } });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.ok(started.body.state.enemy.every((pet: { level: number }) => pet.level === 98), 'Hard opponents stand eight levels above the mirror');
    await finish(String(started.body.state.sessionId), 'win');
    const after = await progress();
    assert.deepEqual(after.replays.run, { hard: true, round: 1 });
    assert.deepEqual(after.finalTrial, story.finalTrial);
    assert.equal(after.courtStanding, story.courtStanding);
});

test('a replay needs the battle won first', async () => {
    const unanswered = await battle({ action: 'first-pact', encounterId: 'writ-audit', petIds: PET_IDS, replay: { hard: false, unbroken: false } });
    assert.equal(unanswered.status, 409);
});
