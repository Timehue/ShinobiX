import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    weekIndex, weekKey, weekEndsAt, pickWeeklyBoard, computeProgress, snapshotCounters,
    WEEKLY_CATALOG, WEEKLY_BOARD_SIZE, WEEK_EPOCH_MS, WEEK_MS, WEEKLY_COUNTERS,
} from './_weekly-board.js';

test('weekKey is stable within a week and advances across the Monday boundary', () => {
    const base = WEEK_EPOCH_MS + WEEK_MS * 100; // some Monday 00:00 UTC
    assert.equal(weekIndex(base), 100);
    assert.equal(weekIndex(base + WEEK_MS - 1), 100);   // last ms of the week
    assert.equal(weekIndex(base + WEEK_MS), 101);       // next week
    assert.equal(weekKey(base), 'w100');
    assert.equal(weekEndsAt(base), base + WEEK_MS);
});

test('pickWeeklyBoard is deterministic per week and the right size', () => {
    const a = pickWeeklyBoard('w42');
    const b = pickWeeklyBoard('w42');
    assert.equal(a.length, WEEKLY_BOARD_SIZE);
    assert.deepEqual(a.map((m) => m.id), b.map((m) => m.id));
});

test('pickWeeklyBoard returns distinct missions', () => {
    const ids = pickWeeklyBoard('w7').map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('different weeks generally yield different boards', () => {
    const w1 = pickWeeklyBoard('w1').map((m) => m.id).join(',');
    const w2 = pickWeeklyBoard('w2').map((m) => m.id).join(',');
    assert.notEqual(w1, w2);
});

test('every board mission references a real tracked counter', () => {
    for (const m of WEEKLY_CATALOG) {
        assert.ok((WEEKLY_COUNTERS as string[]).includes(m.counter), `${m.id} has untracked counter ${m.counter}`);
        assert.ok(m.target > 0);
        const r = m.reward;
        assert.ok((r.ryo ?? 0) + (r.fateShards ?? 0) + (r.boneCharms ?? 0) > 0, `${m.id} has no reward`);
        // No aura stones anywhere (owner constraint).
        assert.ok(!('auraStones' in r));
    }
});

test('computeProgress diffs current vs baseline, floored at 0', () => {
    const mission = WEEKLY_CATALOG.find((m) => m.counter === 'rankedWins')!;
    assert.equal(computeProgress(mission, { rankedWins: 10 }, { rankedWins: 13 }), 3);
    assert.equal(computeProgress(mission, { rankedWins: 10 }, { rankedWins: 10 }), 0);
    // a counter that went DOWN (shouldn't happen) never yields negative progress
    assert.equal(computeProgress(mission, { rankedWins: 10 }, { rankedWins: 4 }), 0);
    // missing fields treated as 0
    assert.equal(computeProgress(mission, {}, { rankedWins: 5 }), 5);
});

test('snapshotCounters captures exactly the tracked counters as numbers', () => {
    const snap = snapshotCounters({ rankedWins: 5, totalAiKills: 9, ryo: 99999, junk: 'x' });
    assert.equal(snap.rankedWins, 5);
    assert.equal(snap.totalAiKills, 9);
    assert.equal(snap.totalPetWins, 0); // absent → 0
    assert.equal(Object.keys(snap).length, WEEKLY_COUNTERS.length);
    assert.ok(!('ryo' in snap));
});
