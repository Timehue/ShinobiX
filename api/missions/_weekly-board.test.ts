import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    weekIndex, weekKey, weekEndsAt, pickWeeklyBoard, pickWeeklyBoardForPlayer, computeProgress, snapshotCounters, resolveWeeklyBoardForRecord,
    WEEKLY_CATALOG, WEEKLY_CLAIMABLE_CATALOG, WEEKLY_BOARD_SIZE, WEEK_EPOCH_MS, WEEK_MS, WEEKLY_COUNTERS,
} from './_weekly-board.js';
import { canPlayerReceiveMission } from './_eligibility.js';
import { RESOURCE_ATTEMPT_MS, resourceSkillLevel, resourceSuccessRate } from '../../shared/resource-gathering.js';
import { RANKED_MIN_LEVEL } from '../../shared/ranked-eligibility.js';

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

test('adding resource missions preserves this week and expands the next rotation', () => {
    assert.deepEqual(pickWeeklyBoardForPlayer('w147', { level: 20 }).map((m) => m.id), [
        'wk-missions-25', 'wk-missions-10', 'wk-ranked-3', 'wk-safe-missions-15',
    ]);
    assert.deepEqual(pickWeeklyBoardForPlayer('w147', { level: 20 }).map((m) => m.target), [25, 10, 3, 15]);
    assert.equal(weekKey(Date.UTC(2026, 10, 2)), 'w148');
    for (let week = 140; week < 148; week++) {
        assert.equal(pickWeeklyBoardForPlayer(`w${week}`, { level: 1 }).some((m) =>
            m.counter === 'fishingXp' || m.counter === 'miningXp'), false);
    }
    const expanded = pickWeeklyBoardForPlayer('w148', { level: 100 }, WEEKLY_CLAIMABLE_CATALOG.length, { systems: { hollowGate: true } });
    assert.ok(expanded.some((m) => m.counter === 'fishingXp'));
    assert.ok(expanded.some((m) => m.counter === 'miningXp'));
    assert.ok(expanded.some((m) => m.counter === 'totalMissionsCompleted'));
    assert.ok(expanded.some((m) => m.counter === 'rankedWins'));
});

test('expanded boards keep four eligible slots and favor distinct activities', () => {
    for (let week = 148; week < 348; week++) {
        for (const level of [1, 10, 11, 20, 100]) {
            const board = pickWeeklyBoardForPlayer(`w${week}`, { level }, undefined, { systems: { hollowGate: level === 100 } });
            assert.equal(board.length, 4);
            assert.equal(new Set(board.map((m) => m.id)).size, 4);
            assert.equal(new Set(board.map((m) => `${m.counter}:${m.target}`)).size, 4, 'no identical objectives under different names');
            assert.equal(new Set(board.map((m) => m.counter)).size, level < RANKED_MIN_LEVEL ? 3 : 4);
        }
    }
});

test('Alpha requires level 100, village membership and an open Hollow Gate', () => {
    const mission = WEEKLY_CATALOG.find((m) => m.counter === 'hollowGateWardenKills')!;
    for (const level of [1, 10, 50, 99]) {
        assert.equal(canPlayerReceiveMission({ level, village: 'Frostfang Village' }, mission, { systems: { hollowGate: true } }).ok, false);
    }
    assert.equal(canPlayerReceiveMission({ level: 100 }, mission, { systems: { hollowGate: true } }).ok, false);
    assert.equal(canPlayerReceiveMission({ level: 100, village: 'Frostfang Village' }, mission, { systems: { hollowGate: false } }).ok, false);
    assert.equal(canPlayerReceiveMission({ level: 100, village: 'Frostfang Village' }, mission, { systems: { hollowGate: true } }).ok, true);
});

test('completed missions retain their slots as activity access changes', () => {
    const novice = { level: 1 };
    const claimed = pickWeeklyBoardForPlayer('w151', novice).map((m) => m.id);
    const advanced = pickWeeklyBoardForPlayer('w151', { level: 100, village: 'Frostfang Village' }, undefined,
        { systems: { hollowGate: true, ranked: true } }, claimed);
    assert.equal(advanced.length, 4);
    assert.deepEqual(new Set(advanced.map((m) => m.id)), new Set(claimed));
});

test('stored assignments preserve unfinished work on level-up and replace only unavailable incomplete goals', () => {
    const novice = { level: 10, rankedWins: 0, hollowGateWardenKills: 0 };
    const baseline = snapshotCounters(novice);
    const original = pickWeeklyBoardForPlayer('w151', novice);
    const record = { baseline, claimed: [], missionIds: original.map((m) => m.id) };
    const advanced = resolveWeeklyBoardForRecord('w151', { ...novice, level: 11 }, record);
    assert.deepEqual(advanced.map((m) => m.id), record.missionIds);
    assert.equal(advanced.some((m) => m.counter === 'rankedWins'), false);

    const eligible = { level: 100, village: 'Frostfang Village', hollowGateWardenKills: 0 };
    const context = { systems: { ranked: true, hollowGate: true } };
    const endgame = pickWeeklyBoardForPlayer('w151', eligible, undefined, context);
    assert.ok(endgame.some((m) => m.id === 'wk-hollow-warden'));
    const assigned = { baseline: snapshotCounters(eligible), claimed: [], missionIds: endgame.map((m) => m.id) };
    const closed = { systems: { ranked: true, hollowGate: false } };
    const replacement = resolveWeeklyBoardForRecord('w151', eligible, assigned, closed);
    assert.equal(replacement.length, 4);
    assert.equal(replacement.some((m) => m.id === 'wk-hollow-warden'), false);
    for (const mission of endgame.filter((m) => m.id !== 'wk-hollow-warden')) assert.ok(replacement.some((m) => m.id === mission.id));
    const target = endgame.find((m) => m.id === 'wk-hollow-warden')!.target;
    const earned = resolveWeeklyBoardForRecord('w151', { ...eligible, hollowGateWardenKills: target }, assigned, closed);
    assert.deepEqual(earned.map((m) => m.id), assigned.missionIds, 'completed work remains earned after access closes');
});

test('weekly goals fit moderate sessions alongside normal progression', () => {
    function expectedCommonNodeAttempts(goal: number): number {
        const attempts = Array<number>(goal + 10).fill(0);
        for (let xp = goal - 1; xp >= 0; xp--) {
            const success = resourceSuccessRate(resourceSkillLevel(xp), 1, 0) / 100;
            attempts[xp] = 1 + success * attempts[xp + 10] + (1 - success) * attempts[xp + 3];
        }
        return attempts[0];
    }
    const resources = WEEKLY_CATALOG.filter((m) => m.counter === 'fishingXp' || m.counter === 'miningXp');
    for (const mission of resources) {
        const attempts = expectedCommonNodeAttempts(mission.target);
        assert.ok(attempts >= 60 && attempts <= 100, `${mission.name} fits roughly 9–14 common-node attempts per day`);
    }
    const fishing = Math.max(...resources.filter((m) => m.counter === 'fishingXp').map((m) => m.target));
    const mining = Math.max(...resources.filter((m) => m.counter === 'miningXp').map((m) => m.target));
    const totalAttempts = expectedCommonNodeAttempts(fishing) + expectedCommonNodeAttempts(mining);
    // Gathering no longer has a daily action cap. Keep an explicit workload
    // bound rather than depending on the removed shared-action allowance.
    assert.ok(totalAttempts < 200, `both hardest resource goals need under 200 attempts per week: about ${totalAttempts.toFixed(1)}`);
    assert.ok(totalAttempts * RESOURCE_ATTEMPT_MS / 7 < 45 * 60_000, 'both hardest goals fit under 45 minutes of gathering per day');
    for (const mission of WEEKLY_CLAIMABLE_CATALOG.filter((m) => m.counter === 'totalMissionsCompleted')) {
        assert.ok(mission.target >= 45 && mission.target <= 80, 'mission goals fit several ordinary sessions without requiring full daily clears');
    }
});

test('different weeks generally yield different boards', () => {
    const w1 = pickWeeklyBoard('w1').map((m) => m.id).join(',');
    const w2 = pickWeeklyBoard('w2').map((m) => m.id).join(',');
    assert.notEqual(w1, w2);
});

test('every board mission references a real tracked counter', () => {
    for (const m of WEEKLY_CLAIMABLE_CATALOG) {
        assert.ok((WEEKLY_COUNTERS as string[]).includes(m.counter), `${m.id} has untracked counter ${m.counter}`);
        assert.ok(m.target > 0);
        const r = m.reward;
        assert.ok((r.ryo ?? 0) + (r.fateShards ?? 0) + (r.boneCharms ?? 0) > 0, `${m.id} has no reward`);
        // No aura stones anywhere (owner constraint).
        assert.ok(!('auraStones' in r));
    }
});

test('low-level players are never assigned Hollow Gate Warden missions', () => {
    const lowLevel = { level: 20, village: 'Leaf', rankTitle: 'Genin' };
    for (let i = 0; i < 100; i += 1) {
        const board = pickWeeklyBoardForPlayer(`w${i}`, lowLevel, WEEKLY_BOARD_SIZE, { systems: { hollowGate: false } });
        assert.equal(board.some((mission) => mission.id === 'wk-hollow-warden' || /hollow gate warden/i.test(mission.name)), false, `w${i} assigned Warden`);
        for (const mission of board) assert.equal(canPlayerReceiveMission(lowLevel, mission, { systems: { hollowGate: false } }).ok, true, `${mission.id} should be eligible`);
    }
});

test('low-level players get eligible weekly replacements and fallbacks', () => {
    const wk = Array.from({ length: 100 }, (_, i) => `w${i}`).find((key) => pickWeeklyBoard(key).some((mission) => mission.id === 'wk-hollow-warden'));
    assert.ok(wk, 'test needs a week whose raw board includes Warden');
    const lowLevel = { level: 5, village: 'Leaf', rankTitle: 'Academy Student' };
    const board = pickWeeklyBoardForPlayer(wk, lowLevel, WEEKLY_BOARD_SIZE, { systems: { hollowGate: false, ranked: false } });
    assert.equal(board.length, WEEKLY_BOARD_SIZE);
    assert.equal(board.some((mission) => mission.id === 'wk-hollow-warden'), false);
    assert.ok(board.some((mission) => !pickWeeklyBoard(wk).some((raw) => raw.id === mission.id)), 'expected an eligible replacement');
    for (const mission of board) assert.equal(canPlayerReceiveMission(lowLevel, mission, { systems: { hollowGate: false, ranked: false } }).ok, true);
});

test('level 100 players can see Hollow Gate Warden if Hollow Gate is unlocked', () => {
    const board = pickWeeklyBoardForPlayer(
        'w-endgame',
        { level: 100, village: 'Leaf', rankTitle: 'Kage' },
        WEEKLY_CLAIMABLE_CATALOG.length,
        { systems: { hollowGate: true, ranked: true } },
    );
    assert.ok(board.some((mission) => mission.id === 'wk-hollow-warden'));
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
    assert.equal(snap.totalMissionsCompleted, 0);
    assert.ok(!('totalAiKills' in snap));
    assert.equal(Object.keys(snap).length, WEEKLY_COUNTERS.length);
    assert.ok(!('ryo' in snap));
});

test('fishing and mining rotate and score only their server-owned skill XP since opening', () => {
    for (const counter of ['fishingXp', 'miningXp'] as const) {
        const mission = WEEKLY_CATALOG.find((m) => m.counter === counter)!;
        assert.ok(mission);
        const baseline = snapshotCounters({ resourceGathering: { [counter]: 3200 } });
        assert.equal(computeProgress(mission, baseline, { resourceGathering: { [counter]: 3250 } }), 50);
        assert.equal(computeProgress(mission, baseline, { [counter]: 999999, resourceGathering: { [counter]: 3200 } }), 0);
        assert.equal(computeProgress(mission, {}, { resourceGathering: { [counter]: 3200 } }), 0, 'legacy boards need a baseline first');
        assert.equal(computeProgress(mission, baseline, { resourceGathering: { [counter]: 0 } }), 0);
        assert.ok(Array.from({ length: 100 }, (_, i) => pickWeeklyBoardForPlayer(`w${148 + i}`, { level: 1 }))
            .some((board) => board.some((m) => m.id === mission.id)), `${counter} reaches beginner boards`);
    }
});
