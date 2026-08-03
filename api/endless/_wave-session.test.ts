import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TowerSession } from '../towers/_tower-session.js';
import {
    createEndlessWaveBinding,
    endlessWaveVitals,
    settleEndlessWaveBinding,
    validateCompletedEndlessWave,
    type EndlessWaveBinding,
} from './_wave-session.js';

/*
 * The sealed Endless wave (step 5 subsystem 2).
 *
 * The old win proof was an AiFightToken whose opponentId ended in `-w<wave>`,
 * which proves a wave-N fight was STARTED and nothing more. These tests cover
 * what the sealed channel has to add: the fight was actually WON, it belongs to
 * THIS run, and it is the wave the save is actually on — because the per-wave
 * payout scales with the wave number, so redeeming a cheap early wave against a
 * deep one is the whole attack.
 */

const NOW = 1_700_000_000_000;
const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2';

function makeBinding(over: Partial<EndlessWaveBinding> = {}): EndlessWaveBinding {
    return {
        ...createEndlessWaveBinding({
            runId: 'endlesswave-1', playerName: 'hero', runToken: TOKEN, wave: 7,
            opponentId: 'endless-builtin-ai-x-w7', now: NOW,
        }),
        ...over,
    };
}

function makeSession(over: Partial<TowerSession> = {}): TowerSession {
    return {
        runId: 'endlesswave-1',
        status: 'done',
        winner: 'squad',
        actors: [
            { side: 'squad', ownerSlug: 'hero', hp: 412, chakra: 300, stamina: 250 } as unknown as TowerSession['actors'][number],
            { side: 'enemy', ownerSlug: null, hp: 0 } as unknown as TowerSession['actors'][number],
        ],
        ...over,
    } as TowerSession;
}

function validate(over: {
    binding?: EndlessWaveBinding | null;
    session?: TowerSession | null;
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

test('a completed, winning, run-bound wave validates', () => {
    assert.equal(validate().ok, true);
});

test('a wave sealed at a DIFFERENT wave cannot be redeemed — the payout scales', () => {
    // Seal wave 1 (cheap), hand it in while the save sits on wave 40 (several
    // times the ryo). expectedWave comes off the save, so this must fail.
    assert.deepEqual(validate({ binding: makeBinding({ wave: 1 }), expectedWave: 40 }), { ok: false, reason: 'wrong-wave' });
    // …and the reverse: a deep sealed wave against a shallow run.
    assert.deepEqual(validate({ binding: makeBinding({ wave: 40 }), expectedWave: 7 }), { ok: false, reason: 'wrong-wave' });
});

test('a wave sealed on ANOTHER run cannot pay this one', () => {
    // Start a run, seal a wave, abandon, start a fresh run — the old sealed wave
    // must not carry over into the new run's ledger.
    assert.deepEqual(validate({ runToken: 'ffffffffffffffffffffffff' }), { ok: false, reason: 'wrong-run' });
    assert.deepEqual(validate({ binding: makeBinding({ runToken: '' }) }), { ok: false, reason: 'wrong-run' });
});

test('an unwon or unfinished wave pays nothing', () => {
    assert.deepEqual(validate({ session: makeSession({ winner: 'enemy' }) }), { ok: false, reason: 'not-won' });
    assert.deepEqual(validate({ session: makeSession({ status: 'active' }) }), { ok: false, reason: 'not-complete' });
});

test("a stranger's winning session cannot be handed in", () => {
    assert.deepEqual(validate({ playerName: 'mallory' }), { ok: false, reason: 'wrong-player' });
    assert.deepEqual(
        validate({ session: makeSession({ actors: [{ side: 'squad', ownerSlug: 'someone-else', hp: 9 } as unknown as TowerSession['actors'][number]] }) }),
        { ok: false, reason: 'not-a-member' },
    );
});

test('expiry, replay and mismatched sessions are refused', () => {
    assert.deepEqual(validate({ binding: makeBinding({ expiresAt: NOW - 1 }) }), { ok: false, reason: 'expired' });
    assert.deepEqual(validate({ binding: makeBinding({ settledAt: NOW }) }), { ok: false, reason: 'already-settled' });
    assert.deepEqual(validate({ binding: makeBinding({ status: 'won' }) }), { ok: false, reason: 'already-settled' });
    assert.deepEqual(validate({ session: makeSession({ runId: 'endlesswave-other' }) }), { ok: false, reason: 'invalid-binding' });
    assert.deepEqual(validate({ binding: null }), { ok: false, reason: 'invalid-binding' });
    assert.deepEqual(validate({ session: null }), { ok: false, reason: 'invalid-binding' });
});

test('settling a binding is one-way', () => {
    const settled = settleEndlessWaveBinding(makeBinding(), NOW);
    assert.equal(settled.status, 'won');
    assert.equal(settled.settledAt, NOW);
    // Re-settling must not move the timestamp — that is what keeps a replay from
    // looking like a fresh win.
    assert.deepEqual(settleEndlessWaveBinding(settled, NOW + 5_000), settled);
});

test('vitals come off the SESSION, and a missing actor reads as zero', () => {
    assert.deepEqual(endlessWaveVitals(makeSession(), 'hero'), { hp: 412, chakra: 300, stamina: 250 });
    assert.deepEqual(endlessWaveVitals(makeSession(), 'nobody'), { hp: 0, chakra: 0, stamina: 0 });
});

test('a re-submitted sealed win finds its own replay receipt', () => {
    // The sealed win banks a receipt keyed by the WAVE RUN ID. If the replay
    // lookup only ever tried the AiFightToken, a retry after a lost response
    // would miss that receipt, fall through to the sealed branch, find the
    // binding already spent and 409 — telling the player the tower "could not
    // verify this victory" for a wave it had already paid.
    const handler = readFileSync('api/endless/run.ts', 'utf8');
    const lookup = handler.slice(handler.indexOf('const requestedKey'), handler.indexOf('const replay ='));
    assert.match(lookup, /cleanWaveRunId\(body\.waveRunId\)/, 'the replay key must try the wave run id first');
    assert.match(handler, /key: waveRunId, action/, 'and the sealed receipt must be keyed by it');
});

test('the handler reads the wave from the SAVE, never from the request body', () => {
    // The single most important line in the sealed channel: expectedWave must be
    // derived from the run record. A grep, because the alternative is standing up
    // the whole HTTP + KV surface to assert one argument.
    //
    // Anchored INSIDE the branch on purpose. The line that opens it reads
    // `body.waveRunId` — the run id, not a wave number — so a slice starting one
    // line earlier makes the "no client wave" assertion below unsatisfiable.
    // Read relative to the repo root (scripts/run-tests.mjs runs from there).
    // `import.meta.url` is unavailable here: api/ type-checks to CommonJS output,
    // which is also why the spar's equivalent guards live under the client.
    const handler = readFileSync('api/endless/run.ts', 'utf8');
    const open = handler.indexOf('if (waveRunId) {');
    const close = handler.indexOf('Legacy token channel');
    assert.ok(open > 0 && close > open, 'the sealed branch is no longer recognisable — re-anchor this guard');
    const sealed = handler.slice(open, close);
    assert.match(sealed, /expectedWave:\s*Math\.max\(1,\s*Math\.floor\(Number\(run\.wave\)/, 'expectedWave must come off run.wave');
    assert.doesNotMatch(sealed, /body\.wave/, 'the sealed channel must never read a client wave');
    assert.doesNotMatch(sealed, /body\.hp|body\.chakra|body\.stamina/, 'the sealed channel must never read client vitals');
    assert.match(sealed, /endlessWaveVitals\(/, 'vitals must come from the session');
});
