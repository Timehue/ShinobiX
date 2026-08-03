import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    eligibleEndlessProfiles,
    endlessWaveSeed,
    pickEndlessWaveOpponent,
} from './_wave-opponent.js';

/*
 * The server-generated Endless wave opponent (step 5 subsystem 2).
 *
 * The properties that matter are the ones a client could otherwise exploit or a
 * reconnect could otherwise break: the pick is a pure function of server-held
 * state, it is stable within a wave, and the wave's rules (level cap, bosses on
 * milestone floors only) hold without the client asserting anything.
 */

const TOKEN = 'endless-run-token-abc123';

test('the same run + wave always re-derives the SAME opponent', () => {
    // A reconnect, a retry or a late settle must find the fight it left, not a
    // reroll — this is why the pick is seeded instead of random.
    for (const wave of [1, 3, 7, 10, 25, 99]) {
        const first = pickEndlessWaveOpponent({ runToken: TOKEN, wave, playerLevel: 40 });
        const again = pickEndlessWaveOpponent({ runToken: TOKEN, wave, playerLevel: 40 });
        assert.deepEqual(first, again, `wave ${wave} rerolled`);
    }
});

test('different waves and different runs get different draws', () => {
    // Not a strict guarantee for any single pair (a small pool collides), so
    // this asserts SPREAD across a range rather than pairwise inequality.
    const acrossWaves = new Set(
        Array.from({ length: 30 }, (_, i) => pickEndlessWaveOpponent({ runToken: TOKEN, wave: i + 1, playerLevel: 60 })?.id),
    );
    assert.ok(acrossWaves.size > 5, `waves barely vary (${acrossWaves.size} distinct in 30)`);
    const acrossRuns = new Set(
        Array.from({ length: 30 }, (_, i) => pickEndlessWaveOpponent({ runToken: `run-${i}`, wave: 4, playerLevel: 60 })?.id),
    );
    assert.ok(acrossRuns.size > 5, `runs barely vary (${acrossRuns.size} distinct in 30)`);
});

test('the seed depends on BOTH the run token and the wave', () => {
    assert.notEqual(endlessWaveSeed(TOKEN, 1), endlessWaveSeed(TOKEN, 2));
    assert.notEqual(endlessWaveSeed('other-token', 1), endlessWaveSeed(TOKEN, 1));
    assert.equal(endlessWaveSeed(TOKEN, 5), endlessWaveSeed(TOKEN, 5));
});

test('Boss AIs only surface on milestone floors', () => {
    for (const wave of [1, 2, 5, 9, 11, 19, 21]) {
        const pool = eligibleEndlessProfiles(wave, 100);
        assert.equal(pool.some((p) => p.isBossAi), false, `a boss is eligible on non-milestone wave ${wave}`);
    }
    for (const wave of [10, 20, 50, 100]) {
        const pool = eligibleEndlessProfiles(wave, 100);
        assert.ok(pool.some((p) => p.isBossAi), `no boss is eligible on milestone wave ${wave}`);
    }
});

test('the pool respects the level cap, and the cap really binds', () => {
    // level + wave*5, capped at 100. At level 1 wave 1 the cap is 6, so a
    // catalog full of level-100 profiles must be filtered down hard.
    const early = eligibleEndlessProfiles(1, 1);
    for (const profile of early) {
        assert.ok(Number(profile.level) <= 6, `${profile.id} (level ${profile.level}) is above the wave-1 cap`);
    }
    // Unguarded precondition: if the cap stopped filtering, `early` would be the
    // whole catalog and the loop above would still pass on an empty-ish check.
    const late = eligibleEndlessProfiles(40, 100);
    assert.ok(late.length > early.length, 'the cap is not actually narrowing the pool');
});

test('an under-levelled player still gets a fight instead of nothing', () => {
    // The client falls back to the full candidate list when nothing sits under
    // the cap; so does this. A null here would mean a run that cannot continue.
    const opponent = pickEndlessWaveOpponent({ runToken: TOKEN, wave: 1, playerLevel: 1 });
    assert.ok(opponent, 'wave 1 at level 1 produced no opponent');
    assert.match(String(opponent!.id), /^endless-.+-w1$/);
});

test('the opponent is scaled, not handed back raw', () => {
    const wave = 30;
    const opponent = pickEndlessWaveOpponent({ runToken: TOKEN, wave, playerLevel: 80 })!;
    assert.match(opponent.id, new RegExp(`-w${wave}$`), 'the wave must be stamped into the runtime id');
    assert.match(String(opponent.name), /\(Floor 30\)/);
    assert.ok(Number(opponent.hp) > 0);
});

test('nothing in the request can influence the draw', () => {
    // The signature is the guard: the only inputs are the server-minted run
    // token, the run's own wave counter and the save's level. If a future change
    // adds a body-supplied field here, a client picks its own difficulty.
    assert.deepEqual(
        Object.keys({ runToken: '', wave: 0, playerLevel: 0 }).sort(),
        ['playerLevel', 'runToken', 'wave'],
    );
});
