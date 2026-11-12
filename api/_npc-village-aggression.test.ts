import test from 'node:test';
import assert from 'node:assert/strict';
import {
    NPC_AGGRESSION_PAIR_COOLDOWN_MS, NPC_AGGRESSION_QUIET_MS, aggressionBand, applyAggressionWin, decayAggression, emptyAggression,
} from './_npc-village-aggression.js';

const NOW = Date.UTC(2026, 10, 8, 12);
const win = (over: Partial<Parameters<typeof applyAggressionWin>[1]> = {}) =>
    ({ village: 'Frostfang Village', player: 'Alice', npcId: 'npc-a', npcRank: 'genin' as const, now: NOW, ...over });

test('bands follow the concept thresholds', () => {
    assert.deepEqual([0, 24, 25, 49, 50, 74, 75, 100].map(aggressionBand),
        ['peaceful', 'peaceful', 'watchful', 'watchful', 'hostile', 'hostile', 'war-ready', 'war-ready']);
});

test('a win raises only the winner\'s village, by rank', () => {
    let s = emptyAggression(NOW);
    s = applyAggressionWin(s, win()).state;
    s = applyAggressionWin(s, win({ npcId: 'npc-b', npcRank: 'elite' })).state;
    s = applyAggressionWin(s, win({ npcId: 'npc-k', npcRank: 'kage', player: 'Bob' })).state;
    assert.equal(s.byVillage['Frostfang Village'], 1 + 2 + 5);
    assert.equal(s.byVillage['Stormveil Village'], 0);
});

test('the same player against the same NPC counts once per six hours', () => {
    const first = applyAggressionWin(emptyAggression(NOW), win());
    const again = applyAggressionWin(first.state, win({ now: NOW + 60_000 }));
    assert.equal(again.gained, 0);
    assert.equal(again.reason, 'pair-cooldown');
    const later = applyAggressionWin(first.state, win({ now: NOW + NPC_AGGRESSION_PAIR_COOLDOWN_MS }));
    assert.equal(later.gained, 1);
});

test('one player adds at most five a day and one village at most ten', () => {
    let s = emptyAggression(NOW);
    for (let i = 0; i < 10; i++) s = applyAggressionWin(s, win({ npcId: `npc-${i}`, npcRank: 'elite' })).state;
    assert.equal(s.byVillage['Frostfang Village'], 5, 'player cap');
    for (const player of ['B', 'C', 'D', 'E']) {
        for (let i = 0; i < 5; i++) s = applyAggressionWin(s, win({ player, npcId: `npc-${i}`, npcRank: 'elite' })).state;
    }
    assert.equal(s.byVillage['Frostfang Village'], 10, 'village cap');
    const tomorrow = applyAggressionWin(s, win({ player: 'F', now: NOW + 24 * 3600_000 }));
    assert.equal(tomorrow.gained, 1, 'the daily counters reset at UTC midnight');
});

test('Cinderhold itself and unknown villages never gain', () => {
    assert.equal(applyAggressionWin(emptyAggression(NOW), win({ village: 'Cinderhold Village' })).reason, 'not-a-player-village');
});

test('quiet villages cool by two once per day, and never below zero', () => {
    let s = emptyAggression(NOW);
    s = applyAggressionWin(s, win({ npcRank: 'kage' })).state;                 // Frostfang 5
    const tomorrow = NOW + NPC_AGGRESSION_QUIET_MS;
    s = decayAggression(s, tomorrow);
    assert.equal(s.byVillage['Frostfang Village'], 3);
    assert.equal(decayAggression(s, tomorrow + 1000).byVillage['Frostfang Village'], 3, 'once per day');
    assert.equal(s.byVillage['Moonshadow Village'], 0);
});
