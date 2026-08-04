import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SoloPveSession } from '../solo-pve/_session.js';
import {
    createEndlessWaveBinding,
    endlessWaveVitals,
    settleEndlessWaveBinding,
    validateCompletedEndlessWave,
    validateTerminalEndlessWave,
    type EndlessWaveBinding,
} from './_wave-session.js';

const NOW = 1_700_000_000_000;
const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2';
const RUN_ID = 'endlesswave-11111111111111111111111111111111';
const OPPONENT = 'endless-builtin-ai-x-w7';

function makeBinding(over: Partial<EndlessWaveBinding> = {}): EndlessWaveBinding {
    return {
        ...createEndlessWaveBinding({
            runId: RUN_ID,
            playerName: 'hero',
            runToken: TOKEN,
            wave: 7,
            opponentId: OPPONENT,
            now: NOW,
        }),
        ...over,
    };
}

function makeSession(over: Partial<SoloPveSession> = {}): SoloPveSession {
    return {
        runtime: 'solo-pve',
        schemaVersion: 1,
        sessionId: RUN_ID,
        ownerSlug: 'hero',
        encounter: { kind: 'endless-wave', id: `${TOKEN}:7`, sourceId: OPPONENT, bindingId: RUN_ID },
        status: 'done',
        winner: 'player',
        outcome: 'win',
        settlementState: 'pending',
        player: { hp: 412, chakra: 300, stamina: 250 },
        ...over,
    } as SoloPveSession;
}

function validate(over: {
    binding?: EndlessWaveBinding | null;
    session?: SoloPveSession | null;
    playerName?: string;
    runToken?: string;
    expectedWave?: number;
} = {}) {
    return validateCompletedEndlessWave({
        binding: over.binding === undefined ? makeBinding() : over.binding,
        session: over.session === undefined ? makeSession() : over.session,
        playerName: over.playerName ?? 'hero',
        runToken: over.runToken ?? TOKEN,
        expectedWave: over.expectedWave ?? 7,
        now: NOW + 1000,
    });
}

test('a completed, winning, run-bound solo wave validates', () => {
    assert.equal(validate().ok, true);
});

test('a wave sealed at a different wave cannot be redeemed', () => {
    assert.deepEqual(validate({ binding: makeBinding({ wave: 1 }), expectedWave: 40 }), { ok: false, reason: 'wrong-wave' });
    assert.deepEqual(validate({ binding: makeBinding({ wave: 40 }), expectedWave: 7 }), { ok: false, reason: 'wrong-wave' });
});

test('another run, player, encounter, or opponent cannot settle this wave', () => {
    assert.deepEqual(validate({ runToken: 'ffffffffffffffffffffffff' }), { ok: false, reason: 'wrong-run' });
    assert.deepEqual(validate({ playerName: 'mallory' }), { ok: false, reason: 'wrong-player' });
    assert.deepEqual(validate({ session: makeSession({ ownerSlug: 'someone-else' }) }), { ok: false, reason: 'not-a-member' });
    assert.deepEqual(validate({ session: makeSession({ sessionId: 'endlesswave-other' }) }), { ok: false, reason: 'invalid-binding' });
    assert.deepEqual(validate({ session: makeSession({ encounter: { ...makeSession().encounter, sourceId: 'forged' } }) }), { ok: false, reason: 'invalid-binding' });
});

test('terminal loss, draw, and flee validate for run-ending settlement but never as wins', () => {
    for (const outcome of ['loss', 'draw', 'fled'] as const) {
        const winner = outcome === 'draw' ? 'draw' : 'enemy';
        const session = makeSession({ outcome, winner });
        const terminal = validateTerminalEndlessWave({
            binding: makeBinding(), session, playerName: 'hero', runToken: TOKEN, expectedWave: 7, now: NOW + 1000,
        });
        assert.equal(terminal.ok, true, outcome);
        assert.deepEqual(validate({ session }), { ok: false, reason: 'not-won' });
    }
    assert.deepEqual(validate({ session: makeSession({ status: 'active', outcome: null, winner: null }) }), { ok: false, reason: 'not-complete' });
});

test('expiry, replay and missing records are refused', () => {
    assert.deepEqual(validate({ binding: makeBinding({ expiresAt: NOW - 1 }) }), { ok: false, reason: 'expired' });
    assert.deepEqual(validate({ binding: makeBinding({ settledAt: NOW }) }), { ok: false, reason: 'already-settled' });
    assert.deepEqual(validate({ binding: makeBinding({ status: 'won' }) }), { ok: false, reason: 'already-settled' });
    assert.deepEqual(validate({ binding: null }), { ok: false, reason: 'invalid-binding' });
    assert.deepEqual(validate({ session: null }), { ok: false, reason: 'invalid-binding' });
});

test('settling a binding is one-way and records non-wins as spent', () => {
    const won = settleEndlessWaveBinding(makeBinding(), NOW);
    assert.equal(won.status, 'won');
    assert.deepEqual(settleEndlessWaveBinding(won, NOW + 5_000), won);
    const lost = settleEndlessWaveBinding(makeBinding(), NOW, false);
    assert.equal(lost.status, 'spent');
});

test('vitals come from the solo session player', () => {
    assert.deepEqual(endlessWaveVitals(makeSession(), 'hero'), { hp: 412, chakra: 300, stamina: 250 });
});

test('the handler accepts only the wave session id and reads wave/vitals from server state', () => {
    const handler = readFileSync('api/endless/run.ts', 'utf8');
    const settle = handler.slice(handler.indexOf("if (!waveRunId)"), handler.indexOf("if (!result.ok)"));
    assert.match(settle, /expectedWave:\s*Math\.max\(1,\s*Math\.floor\(Number\(run\.wave\)/);
    assert.match(settle, /endlessWaveVitals\(session!/);
    assert.doesNotMatch(settle, /body\.wave|body\.hp|body\.chakra|body\.stamina|aiFightToken/);
    assert.match(handler, /action === 'settle' \? waveRunId : runToken/);
});
