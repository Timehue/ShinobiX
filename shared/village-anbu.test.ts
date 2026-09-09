import assert from 'node:assert/strict';
import { test } from 'node:test';
import { earnedAnbuCandidates, normalizeAnbuSeats } from './village-anbu.js';

test('appointed seats preserve three slots and deduplicate player identity', () => {
    assert.deepEqual(normalizeAnbuSeats([' Rin ', 'r in', 'Mei', 'overflow']), ['Rin', '', 'Mei']);
    assert.deepEqual(normalizeAnbuSeats(null), ['', '', '']);
});

test('earned seats require current-month kills and exclude appointed players and other villages', () => {
    const candidates = [
        { name: 'appointed', village: 'Leaf', monthlyPvpKills: 99, pvpKillMonth: '2026-09' },
        { name: 'outsider', village: 'Mist', monthlyPvpKills: 99, pvpKillMonth: '2026-09' },
        { name: 'old', village: 'Leaf', monthlyPvpKills: 99, pvpKillMonth: '2026-08' },
        { name: 'zero', village: 'Leaf', monthlyPvpKills: 0, pvpKillMonth: '2026-09' },
        ...Array.from({ length: 9 }, (_, i) => ({ name: `p${i}`, village: 'Leaf', monthlyPvpKills: 9 - i, pvpKillMonth: '2026-09' })),
    ];
    assert.deepEqual(earnedAnbuCandidates(candidates, 'Leaf', ['appointed'], '2026-09').map(p => p.name), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    assert.deepEqual(earnedAnbuCandidates(candidates, 'Leaf', ['appointed'], '2026-10'), []);
});

test('ties use lifetime kills, then level, then stable player name', () => {
    const candidates = [
        { name: 'z', totalPvpKills: 5, level: 40 },
        { name: 'b', totalPvpKills: 5, level: 50 },
        { name: 'a', totalPvpKills: 5, level: 50 },
        { name: 'c', totalPvpKills: 6, level: 1 },
    ].map(p => ({ ...p, village: 'Leaf', monthlyPvpKills: 2, pvpKillMonth: '2026-09' }));
    assert.deepEqual(earnedAnbuCandidates(candidates, 'Leaf', [], '2026-09').map(p => p.name), ['c', 'a', 'b', 'z']);
});
