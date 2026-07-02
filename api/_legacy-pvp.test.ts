import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPvpLegacyDeltas, guardDefenseDeltas, rankBand } from './_legacy-pvp.js';

function fighter(name: string, opts: { hp?: number; maxHp?: number; level?: number; specialty?: string } = {}) {
    return {
        name,
        hp: opts.hp ?? 500,
        maxHp: opts.maxHp ?? 1000,
        character: { level: opts.level ?? 50, specialty: opts.specialty ?? 'Ninjutsu' },
    };
}

test('rank bands mirror the level thresholds', () => {
    assert.equal(rankBand(1), 0);   // Academy
    assert.equal(rankBand(15), 1);  // Genin
    assert.equal(rankBand(30), 2);  // Chunin
    assert.equal(rankBand(50), 3);  // Jonin
    assert.equal(rankBand(80), 4);  // Special Jonin
});

test('extract parses the battle log with exact move.ts line formats', () => {
    const session = {
        p1: fighter('Rill', { specialty: 'Genjutsu', level: 52 }),
        p2: fighter('Kazan', { specialty: 'Taijutsu', level: 55 }),
        log: [
            'Rill casts Moonlit Slash.',
            '250 damage to Kazan.',                 // Rill dealt 250
            'Heal: Rill restores 750 HP.',          // Rill healed 750
            'Shield: Kazan gains 750 shield.',      // Kazan: 1 shield cast
            '120 absorbed by Kazan\'s shield.',     // Kazan blocked 120
            '90 damage to Rill.',                   // Kazan dealt 90
            'Kazan bleeds 40 (Wound).',             // Rill's DoT: +40 to Rill's damage
        ],
    };
    const { winnerDeltas, loserDeltas } = extractPvpLegacyDeltas(session, 'Rill', 'Kazan');
    assert.equal(winnerDeltas.pvpWins, 1);
    assert.equal(winnerDeltas.pvpKills, 1);
    assert.equal(winnerDeltas.genjutsuKills, 1, 'style kill follows the winner specialty');
    assert.equal(winnerDeltas.genjutsuDamage, 290, '250 direct + 40 wound tick');
    assert.equal(winnerDeltas.healingDone, 750);
    assert.equal(winnerDeltas.higherLevelWins, undefined, 'gap of 3 is under the 5-level bar');
    assert.equal(winnerDeltas.sameRankWins, 1, 'both Jonin band');
    assert.equal(loserDeltas.pvpLosses, 1);
    assert.equal(loserDeltas.shieldsApplied, 1, 'loser banks their support play');
    assert.equal(loserDeltas.damageBlocked, 120);
    assert.equal(loserDeltas.taijutsuDamage, 90);
});

test('comeback, upset, and ranked flags', () => {
    const session = {
        p1: fighter('Underdog', { hp: 100, maxHp: 1000, level: 50 }),  // 10% HP left
        p2: fighter('Goliath', { level: 60 }),
        log: [],
        ranked: true,
    };
    const { winnerDeltas } = extractPvpLegacyDeltas(session, 'Underdog', 'Goliath');
    assert.equal(winnerDeltas.comebackWins, 1, 'won under 15% HP');
    assert.equal(winnerDeltas.higherLevelWins, 1, 'beat someone 10 levels up');
    assert.equal(winnerDeltas.rankedWins, 1, 'session.ranked flows through');
});

test('guardDefenseDeltas — queue-defense faucet (defender wins, attacker wins, no marker)', () => {
    // Names are pre-normalized (safeName) by the caller; compare literally.
    const marker = { defender: 'guard', attacker: 'raider' };
    // Defender (guard) won → held the line.
    assert.deepEqual(guardDefenseDeltas(marker, 'guard'), { defensiveWins: 1, sectorDefenses: 1 });
    // Attacker (raider) won → raided the village's guard.
    assert.deepEqual(guardDefenseDeltas(marker, 'raider'), { warPvpKills: 1 });
    // A winner who is neither (should never happen) gets nothing.
    assert.deepEqual(guardDefenseDeltas(marker, 'bystander'), {});
    // No marker / empty winner → no credit (best-effort skip).
    assert.deepEqual(guardDefenseDeltas(null, 'guard'), {});
    assert.deepEqual(guardDefenseDeltas(undefined, 'guard'), {});
    assert.deepEqual(guardDefenseDeltas(marker, ''), {});
    // Missing marker fields don't false-credit an empty winner name.
    assert.deepEqual(guardDefenseDeltas({}, 'guard'), {});
});
