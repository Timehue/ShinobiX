import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditElderWinDeltas, creditElderWins, elderTermScore, ELDER_TERM_MS, selectEarnedElders } from './elder-elections.js';

const START = Date.UTC(2026, 8, 1);
const DAY = 86400000;

test('only wins credited within the term and for the village count, never lifetime totals', () => {
    let player = { village: 'Frostfang Village', totalAiKills: 5000, totalPvpKills: 1000 } as Record<string, unknown>;
    player = creditElderWins(player, 99, 99, START - DAY);
    player = creditElderWins(player, 3, 7, START);
    player = creditElderWins(player, 2, 4, START + ELDER_TERM_MS - 1);
    player = creditElderWins(player, 100, 100, START + ELDER_TERM_MS);
    player = creditElderWins({ ...player, village: 'Stormveil Village' }, 100, 100, START + ELDER_TERM_MS);
    assert.deepEqual(elderTermScore(player.elderWinDays, 'Frostfang Village', START, START + ELDER_TERM_MS), { pvp: 5, pve: 11 });
    assert.deepEqual(elderTermScore(player.elderWinDays, 'Frostfang Village', START + ELDER_TERM_MS, START + 2 * ELDER_TERM_MS), { pvp: 100, pve: 100 });
});

test('a server win delta is counted once; unrelated rewards, losses and unchanged counters add no wins', () => {
    const old = { village: 'Frostfang Village', totalAiKills: 5000, totalPvpKills: 1000 };
    const won = creditElderWinDeltas(old, { ...old, totalAiKills: 5001, totalPvpKills: 1001 }, START);
    assert.deepEqual(elderTermScore(won.elderWinDays, old.village, START, START + DAY), { pvp: 1, pve: 1 });
    assert.deepEqual(creditElderWinDeltas(won, { ...won }, START), won);
    assert.equal(old.hasOwnProperty('elderWinDays'), false);
    assert.equal(creditElderWinDeltas(old, { ...old, totalAiKills: 4999 }, START).hasOwnProperty('elderWinDays'), false);
});

test('ties are stable, a double winner takes PvP, and zero-win candidates leave AI seats', () => {
    const players = [{ name: 'Zed', pvp: 5, pve: 9 }, { name: 'Ada', pvp: 5, pve: 10 }, { name: 'Mei', pvp: 0, pve: 9 }];
    assert.deepEqual(selectEarnedElders(players), { seats: ['Ada', 'Mei'], scores: [5, 9] });
    assert.deepEqual(selectEarnedElders([...players].reverse()), selectEarnedElders(players));
    assert.deepEqual(selectEarnedElders([{ name: 'Idle', pvp: 0, pve: 0 }]), { seats: ['', ''], scores: [0, 0] });
    assert.deepEqual(selectEarnedElders([{ name: 'Ada', pvp: 1, pve: 9 }]), { seats: ['Ada', ''], scores: [1, 0] });
});

test('old win history is bounded and votes cannot follow a player into another village', () => {
    const player = creditElderWins({ village: 'Frostfang Village' }, 3, 4, START);
    const switched = creditElderWins({ ...player, village: 'Stormveil Village' }, 1, 2, START + DAY);
    assert.deepEqual(elderTermScore(switched.elderWinDays, 'Stormveil Village', START, START + ELDER_TERM_MS), { pvp: 1, pve: 2 });
    const aged = creditElderWins(switched, 1, 0, START + 100 * DAY);
    assert.equal(aged.elderWinDays.length, 1);
    assert.deepEqual(creditElderWins(aged, 1, 0, START, START + 100 * DAY), aged);
});
