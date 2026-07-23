// Tests for the server-authoritative replay of a player-controlled coliseum duel
// (docs/pet-coliseum-player-control-plan.md §9.6).
//
// The client-side parity assertion — "a replayed log reproduces the fight the
// player played" — lives in shinobij.client/src/lib/pet-duel-live.test.ts, next
// to the rewind path that produces the log. What is covered HERE is the part the
// client cannot be trusted with: rejecting a log that a modified client wrote by
// hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPetDuelCinematic } from '../_pet-sim/pet-duel-cinematic.js';
import { DUEL_TPS } from '../_pet-sim/pet-duel-sim.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import {
    parseDuelInputLog, replayCasualPetDuel,
    MAX_INPUT_LOG, MAX_COMMANDS_PER_SECOND,
} from './_duel-replay.js';
import type { SealedDuelParams } from './_duel-replay.js';

function pet(id: string, element: string): Pet {
    return {
        id, name: id, species: id, level: 20,
        hp: 820, attack: 92, defense: 44, speed: 96,
        element, trait: 'Swift',
        jutsus: [
            { name: 'Fang Strike', kind: 'damage', power: 104, cooldown: 1 },
            { name: 'Ember Coil', kind: 'burn', power: 88, cooldown: 3 },
            { name: 'Stone Ward', kind: 'shield', power: 60, cooldown: 4 },
            { name: 'Slipstream', kind: 'move', power: 10, cooldown: 3 },
            { name: 'Ruin Fang', kind: 'crush', power: 182, cooldown: 6, signature: true },
        ],
    } as unknown as Pet;
}

const PARAMS: SealedDuelParams = {
    mode: '1v1', seed: 5, damageMult: 1, hpMult: 1, revive: false,
    applyItems: true, accuracy: true, terrain: null,
};

const P = () => pet('P', 'Fire');
const Q = () => pet('Q', 'Water');

test('an empty log resolves the uncommanded AI fight', () => {
    // battle-start seals its baseline through exactly this path, so it must agree
    // with the one-shot engine the coliseum renders for a watch-only duel.
    for (let seed = 1; seed <= 4; seed++) {
        const replayed = replayCasualPetDuel([P()], [Q()], { ...PARAMS, seed }, []);
        const oneShot = runPetDuelCinematic(P(), Q(), seed, 1, 1, false, true, true, null, false);
        assert.equal(replayed.outcome, oneShot.result, `seed ${seed} baseline diverged`);
        assert.equal(replayed.applied, 0);
    }
});

test('parseDuelInputLog accepts a well-formed log and normalises it', () => {
    const parsed = parseDuelInputLog([
        { t: 0, cmd: { kind: 'ability', actorId: 'player-0', idx: 2 } },
        { t: 30, cmd: { kind: 'stance', actorId: 'player-0', stance: 2 } },
        { t: 31, cmd: { kind: 'auto', actorId: 'player-0', on: true } },
        { t: 90, cmd: { kind: 'break', actorId: 'player-0' } },
    ]);
    assert.ok(parsed);
    assert.equal(parsed.length, 4);
    assert.deepEqual(parsed[0].cmd, { kind: 'ability', actorId: 'player-0', idx: 2 });
});

test('parseDuelInputLog treats a missing log as empty, not as an error', () => {
    // A watch-only duel and every pre-replay client post no log at all. Those must
    // still settle, on the sealed baseline.
    assert.deepEqual(parseDuelInputLog(undefined), []);
    assert.deepEqual(parseDuelInputLog(null), []);
});

test('parseDuelInputLog rejects a hand-written log', () => {
    // Each of these is a shape only a modified client produces. Rejecting returns
    // null so the caller falls back to the sealed baseline rather than paying out.
    const bad: unknown[] = [
        'not-an-array',
        [{ t: 5, cmd: { kind: 'ability', actorId: 'player-0', idx: 0 } }, { t: 4, cmd: { kind: 'break', actorId: 'player-0' } }], // out of order
        [{ t: -1, cmd: { kind: 'break', actorId: 'player-0' } }],                       // negative tick
        [{ t: 1.5, cmd: { kind: 'break', actorId: 'player-0' } }],                       // fractional tick
        [{ t: 0, cmd: { kind: 'teleport', actorId: 'player-0' } }],                       // unknown command
        [{ t: 0, cmd: { kind: 'ability', actorId: 'player-0', idx: 999 } }],              // out-of-range slot
        [{ t: 0, cmd: { kind: 'ability', actorId: '', idx: 0 } }],                        // no actor
        [{ t: 0, cmd: { kind: 'auto', actorId: 'player-0', on: 'yes' } }],                // wrong type
        [{ t: 0 }],                                                                       // no command
        Array.from({ length: MAX_INPUT_LOG + 1 }, (_, i) => ({ t: i, cmd: { kind: 'break', actorId: 'player-0' } })),
    ];
    for (const raw of bad) {
        assert.equal(parseDuelInputLog(raw), null, `should have rejected: ${JSON.stringify(raw).slice(0, 80)}`);
    }
});

test('an unpaid Bond Break is rejected', () => {
    // Bond Break is the one command the engine does NOT gate itself — it accepts
    // unconditionally and zeroes the signature cooldown. Without the meter check a
    // modified client fires the signature on demand.
    const log = parseDuelInputLog(
        Array.from({ length: 20 }, (_, i) => ({ t: i * 5, cmd: { kind: 'break', actorId: 'player-0' } })),
    );
    assert.ok(log);
    const res = replayCasualPetDuel([P()], [Q()], PARAMS, log);
    assert.equal(res.applied, 0, 'no Break should land — the meter starts empty and spamming never fills it');
    assert.ok(res.rejected > 0, 'the unpaid Breaks must be counted as rejected');
    // And the fight therefore resolves as the uncommanded one.
    assert.equal(res.outcome, runPetDuelCinematic(P(), Q(), PARAMS.seed, 1, 1, false, true, true, null, false).result);
});

test('commands are rate-capped per second', () => {
    // Every command on the same tick, far above any human tapping rate.
    const log = parseDuelInputLog(
        Array.from({ length: 60 }, () => ({ t: 10, cmd: { kind: 'ability', actorId: 'player-0', idx: 0 } })),
    );
    assert.ok(log);
    const res = replayCasualPetDuel([P()], [Q()], PARAMS, log);
    assert.equal(res.applied, MAX_COMMANDS_PER_SECOND, 'exactly the per-second budget should land');
    assert.equal(res.rateLimited, 60 - MAX_COMMANDS_PER_SECOND);
});

test('the rate cap is a sliding window, not a hard total', () => {
    // Orders spread a second apart are ordinary play and must all land.
    const log = parseDuelInputLog(
        Array.from({ length: 10 }, (_, i) => ({ t: i * DUEL_TPS, cmd: { kind: 'ability', actorId: 'player-0', idx: i % 4 } })),
    );
    assert.ok(log);
    const res = replayCasualPetDuel([P()], [Q()], PARAMS, log);
    assert.equal(res.rateLimited, 0, 'one command per second must never be throttled');
    assert.equal(res.applied, 10);
});

test('commands aimed at the enemy fighter are refused', () => {
    // Only player-side fighters are `controlled`, so applyDuelCommand refuses these.
    const log = parseDuelInputLog([
        { t: 5, cmd: { kind: 'ability', actorId: 'enemy-0', idx: 0 } },
        { t: 6, cmd: { kind: 'auto', actorId: 'enemy-0', on: false } },
    ]);
    assert.ok(log);
    const res = replayCasualPetDuel([P()], [Q()], PARAMS, log);
    assert.equal(res.applied, 0);
    assert.equal(res.rejected, 2);
});

test('an ordered move that is on cooldown still lands, and waits', () => {
    // Deliberate: the engine refuses to EXECUTE an unaffordable or on-cooldown
    // move but keeps the order queued, and the command deck dims rather than
    // disables those buttons. Rejecting them here would break replay parity and
    // punish legitimate early queuing.
    // Slot 3 is the signature: the longest cooldown (270 ticks) and the priciest
    // (40 stamina), so ordering it twice in the opening seconds is precisely the
    // "not ready yet" case.
    const log = parseDuelInputLog([
        { t: 2, cmd: { kind: 'ability', actorId: 'player-0', idx: 3 } },
        { t: 3, cmd: { kind: 'ability', actorId: 'player-0', idx: 3 } },
    ]);
    assert.ok(log);
    const res = replayCasualPetDuel([P()], [Q()], PARAMS, log);
    assert.equal(res.applied, 2, 'queuing the signature early is legal play');
    assert.equal(res.rejected, 0);
});
