import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import {
    createFirstPactProgress, FIRST_PACT_STANDING_COURT_ROUNDS,
    type FirstPactProgress,
} from '../../shared/first-pact-contract.js';
import type { ShowdownSession } from '../_pet-showdown/engine.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'standing-court-settlement-test-secret';

let PLAYER: string;
let PROGRESS_KEY: string;
let caseIndex = 0;
const PET_IDS = ['court-a', 'court-b', 'court-c', 'court-d'];
let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./showdown.js').default;
let receiptKey: typeof import('../first-pact/_state.js').standingCourtReceiptKey;
let token: string;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./showdown.js')).default as unknown as typeof handler;
    receiptKey = (await import('../first-pact/_state.js')).standingCourtReceiptKey;
});

beforeEach(async () => {
    // The rate limiter also has a process-local bucket; give each independent
    // case its own real player identity rather than bypassing those checks.
    PLAYER = `standingcourttest${++caseIndex}`;
    PROGRESS_KEY = `first-pact:${PLAYER}`;
    token = (await import('../_auth.js')).issuePlayerToken(PLAYER)!;
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(PROGRESS_KEY, { ...createFirstPactProgress(), mainStep: 'complete' });
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: {
        name: PLAYER, level: 100,
        pets: PET_IDS.map(id => ({ id, name: id, element: 'Fire', role: 'assassin',
            rarity: 'standard', level: 100, hp: 800, attack: 120, defense: 95, speed: 105,
            jutsus: [{ name: 'Court Flame', power: 90, kind: 'damage' }] })),
    } });
});

async function post(body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader() { return res; }, status(status: number) { out.status = status; return res; },
        json(value: Record<string, any>) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body: { playerName: PLAYER, ...body },
        headers: { 'x-player-token': token }, socket: { remoteAddress: '127.0.0.94' },
    } as never, res as never);
    return out;
}

const progress = async () => (await kv.get<FirstPactProgress>(PROGRESS_KEY))!;

async function startRound() {
    const round = FIRST_PACT_STANDING_COURT_ROUNDS[(await progress()).standingCourt.round];
    const started = await post({ action: 'first-pact', encounterId: round.id, petIds: PET_IDS });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    return String(started.body.state.sessionId);
}

// Seed the engine's terminal output, as in showdown.first-pact.test.ts. These
// cases test settlement and recovery through the real handler, not combat AI.
async function terminalWin() {
    const id = await startRound();
    const key = `pet:showdown:${PLAYER}:${id}`;
    const session = (await kv.get<ShowdownSession>(key))!;
    await kv.set(key, { ...session, finished: true, outcome: 'win' }, { ex: 45 * 60 });
    return id;
}

const claim = (sessionId: string) => post({ action: 'turn', sessionId, commands: [] });

async function settleWins(count: number) {
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
        const id = await terminalWin();
        const result = await claim(id);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.firstPact.advanced, true);
        ids.push(id);
    }
    return ids;
}

test('forfeiting a Standing Court sitting resets it once, including turn and forfeit retries', async () => {
    const initial = await progress();
    await kv.set(PROGRESS_KEY, { ...initial, courtStanding: 750,
        standingCourt: { ...initial.standingCourt, round: 3, best: 3 } });
    const sessionId = await startRound();
    const conceded = await post({ action: 'forfeit', sessionId });
    assert.equal(conceded.status, 200);
    assert.equal(conceded.body.state.outcome, 'loss');
    assert.equal(conceded.body.firstPact.advanced, true);
    assert.equal((await progress()).standingCourt.round, 0);
    assert.equal((await progress()).courtStanding, 750);
    assert.equal((await progress()).standingCourt.best, 3);

    await settleWins(1);
    const retries = await Promise.all([claim(sessionId), post({ action: 'forfeit', sessionId })]);
    for (const retry of retries) {
        assert.equal(retry.status, 200);
        assert.equal(retry.body.firstPact.advanced, false);
    }
    assert.equal((await progress()).standingCourt.round, 1, 'an old concession cannot reset the next run');
});

test('retained terminal sessions cannot repay after two clears churn the eight-proof history', async () => {
    const ids = await settleWins(10);
    const before = await progress();
    assert.equal(before.standingCourt.clears, 2);
    assert.equal(before.courtStanding, 800);
    assert.equal(before.standingCourt.battleProofs.length, 8);
    assert.ok(await kv.get(receiptKey(PLAYER, `showdown:${ids[0]}`)));
    for (const id of ids.slice(0, 5)) {
        const replay = await claim(id);
        assert.equal(replay.status, 200);
        assert.equal(replay.body.firstPact.advanced, false);
    }
    assert.deepEqual(await progress(), before);
});

test('concurrent claims of the finishing sitting award one clear and one standing payout', async () => {
    await settleWins(4);
    const id = await terminalWin();
    const results = await Promise.all([claim(id), claim(id), claim(id)]);
    assert.ok(results.every(result => result.status === 200));
    assert.equal(results.filter(result => result.body.firstPact.advanced).length, 1);
    assert.equal((await progress()).standingCourt.clears, 1);
    assert.equal((await progress()).courtStanding, 400);
});

test('a failed proof archive preserves the old proof and leaves the new win retryable', async t => {
    const ids = await settleWins(8);
    const nextId = await terminalWin();
    const before = await progress();
    const set = kv.set.bind(kv);
    let failed = false;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (args[0] === receiptKey(PLAYER, `showdown:${ids[0]}`) && !failed) {
            failed = true;
            throw new Error('injected receipt archive failure');
        }
        return set(...args);
    });
    assert.equal((await claim(nextId)).status, 500);
    assert.deepEqual(await progress(), before, 'no proof may be evicted before its archive succeeds');
    const retried = await claim(nextId);
    assert.equal(retried.status, 200);
    assert.equal(retried.body.firstPact.advanced, true);
    assert.equal((await progress()).standingCourt.round, 4);
    assert.equal((await claim(nextId)).body.firstPact.advanced, false);
});

test('an archive that commits before a lost reply does not consume the unpaid new win', async t => {
    const ids = await settleWins(8);
    const nextId = await terminalWin();
    const before = await progress();
    const set = kv.set.bind(kv);
    let failed = false;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        const result = await set(...args);
        if (args[0] === receiptKey(PLAYER, `showdown:${ids[0]}`) && !failed) {
            failed = true;
            throw new Error('injected lost archive acknowledgement');
        }
        return result;
    });
    assert.equal((await claim(nextId)).status, 500);
    assert.deepEqual(await progress(), before);
    assert.ok(await kv.get(receiptKey(PLAYER, `showdown:${ids[0]}`)));
    const retried = await claim(nextId);
    assert.equal(retried.status, 200);
    assert.equal(retried.body.firstPact.advanced, true);
    assert.equal((await progress()).standingCourt.round, 4);
});

test('a lost progress-write reply remains exactly once through later receipt churn', async t => {
    const ids = await settleWins(4);
    const finalId = await terminalWin();
    const compareSet = kv.compareSet.bind(kv);
    let failed = false;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        const result = await compareSet(...args);
        if (args[0] === PROGRESS_KEY && result && !failed) {
            failed = true;
            throw new Error('injected lost progress acknowledgement');
        }
        return result;
    });
    assert.equal((await claim(finalId)).status, 500);
    assert.equal((await progress()).courtStanding, 400);
    const retry = await claim(finalId);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.firstPact.advanced, false);
    await settleWins(5);
    const before = await progress();
    for (const id of [...ids, finalId]) assert.equal((await claim(id)).body.firstPact.advanced, false);
    assert.deepEqual(await progress(), before);
    assert.equal(before.courtStanding, 800);
});

test('a rejected progress CAS leaves a terminal win available for retry', async t => {
    await settleWins(4);
    const finalId = await terminalWin();
    const compareSet = kv.compareSet.bind(kv);
    let failed = false;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        if (args[0] === PROGRESS_KEY && !failed) { failed = true; return false; }
        return compareSet(...args);
    });
    assert.equal((await claim(finalId)).status, 500);
    assert.equal((await progress()).courtStanding, 0);
    const retry = await claim(finalId);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.firstPact.advanced, true);
    assert.equal((await progress()).courtStanding, 400);
});
