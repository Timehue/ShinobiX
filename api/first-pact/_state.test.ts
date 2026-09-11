import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import {
    createFirstPactProgress, FIRST_PACT_DISTRICT_WRITS, FIRST_PACT_FINDING_COST,
    FIRST_PACT_STANDING_COURT_ROUNDS, type FirstPactProgress,
} from '../../shared/first-pact-contract.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let state: typeof import('./_state.js');
let player: string;
let key: string;
let sequence = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    state = await import('./_state.js');
});

beforeEach(async () => {
    player = `first-pact-state-cas-${++sequence}`;
    key = `first-pact:${player}`;
    await kv.set(key, { ...createFirstPactProgress(), mainStep: 'complete' });
});

test('a checkpoint delayed beyond its lease rebases without erasing a Standing Court clear or its proof', async t => {
    const initial = (await kv.get<FirstPactProgress>(key))!;
    await kv.set(key, { ...initial, standingCourt: { ...initial.standingCourt, round: 4, best: 4 } });
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    let release!: () => void;
    let entered!: () => void;
    const reachedWrite = new Promise<void>(resolve => { entered = resolve; });
    const delayedWrite = new Promise<void>(resolve => { release = resolve; });
    const set = kv.set.bind(kv);
    const compareSet = kv.compareSet.bind(kv);
    let held = false;
    const delayFirstProgressWrite = async (writeKey: string) => {
        if (writeKey === key && !held) {
            held = true;
            entered();
            await delayedWrite;
        }
    };
    // Hold either storage primitive so this also fails with the original
    // unconditional set, rather than hanging while waiting for a CAS call.
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        await delayFirstProgressWrite(args[0]);
        return set(...args);
    });
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        await delayFirstProgressWrite(args[0]);
        return compareSet(...args);
    });

    const position = { x: 68, y: 46, district: 'gateworks' as const };
    const checkpoint = state.checkpointFirstPact(player, position);
    try {
        await reachedWrite;
        now += 6_000;
        const won = await state.settleFirstPactStandingCourtBattle(
            player, FIRST_PACT_STANDING_COURT_ROUNDS[4].id, 'win', 'showdown:finishing-win',
        );
        assert.equal(won.advanced, true);
        assert.equal(won.progress.courtStanding, 400);
    } finally {
        release();
    }
    const result = await checkpoint;
    const stored = (await kv.get<FirstPactProgress>(key))!;
    assert.equal(result.checkpointed, true);
    assert.equal(stored.courtStanding, 400);
    assert.equal(stored.standingCourt.round, 0);
    assert.equal(stored.standingCourt.clears, 1);
    assert.deepEqual(stored.standingCourt.battleProofs, ['showdown:finishing-win']);
    assert.deepEqual(stored.lastPosition, position);
    assert.deepEqual(result.progress, stored);
});

test('a finding write with a lost acknowledgement is preserved and its retry does not spend twice', async t => {
    const writId = FIRST_PACT_DISTRICT_WRITS[0].id;
    await kv.set(key, { ...createFirstPactProgress(), mainStep: 'complete',
        courtStanding: 2 * FIRST_PACT_FINDING_COST, writs: [writId] });
    const compareSet = kv.compareSet.bind(kv);
    let lostReply = false;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        const swapped = await compareSet(...args);
        if (args[0] === key && swapped && !lostReply) {
            lostReply = true;
            throw new Error('injected committed write acknowledgement loss');
        }
        return swapped;
    });

    await assert.rejects(state.enterFirstPactFindingForPlayer(player, writId), /acknowledgement loss/);
    const committed = (await kv.get<FirstPactProgress>(key))!;
    assert.equal(committed.courtStanding, FIRST_PACT_FINDING_COST);
    assert.deepEqual(committed.findings, [writId]);
    const retry = await state.enterFirstPactFindingForPlayer(player, writId);
    assert.equal(retry.entered, false);
    assert.equal(retry.progress.courtStanding, FIRST_PACT_FINDING_COST);
    assert.deepEqual(retry.progress.findings, [writId]);
});

test('a definite CAS conflict re-evaluates finding affordability against the latest progress', async t => {
    const writId = FIRST_PACT_DISTRICT_WRITS[0].id;
    await kv.set(key, { ...createFirstPactProgress(), mainStep: 'complete',
        courtStanding: FIRST_PACT_FINDING_COST, writs: [writId] });
    const compareSet = kv.compareSet.bind(kv);
    let raced = false;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        if (args[0] === key && !raced) {
            raced = true;
            const current = (await kv.get<FirstPactProgress>(key))!;
            await kv.set(key, { ...current, courtStanding: 0 });
        }
        return compareSet(...args);
    });

    const result = await state.enterFirstPactFindingForPlayer(player, writId);
    assert.equal(result.entered, false);
    assert.equal(result.progress.courtStanding, 0);
    assert.deepEqual(result.progress.findings, []);
});

test('repeated CAS rejection is bounded and never falls through to an unconditional progress write', async t => {
    const before = await kv.get(key);
    let attempts = 0;
    t.mock.method(kv, 'compareSet', async () => { attempts++; return false; });
    await assert.rejects(state.enterFirstPact(player), /first-pact-progress-conflict/);
    assert.equal(attempts, 5);
    assert.deepEqual(await kv.get(key), before);
});
