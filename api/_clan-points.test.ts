import test from 'node:test';
import assert from 'node:assert/strict';
import { awardClanPoints, clanPointWeekKey, CLAN_POINTS_WEEKLY_CAP } from './_clan-points.js';

test('awardClanPoints refuses characters outside a clan', () => {
    const result = awardClanPoints({ name: 'solo' }, 'clanMissionContribution', 50, {}, new Date('2026-01-01T12:00:00Z'));
    assert.equal(result.awarded, 0);
    assert.equal(result.reason, 'not-in-clan');
});

test('awardClanPoints rejects unsupported sources', () => {
    const result = awardClanPoints({ name: 'donor', clan: 'Leaf' }, 'donation' as never, 50, {}, new Date('2026-01-01T12:00:00Z'));
    assert.equal(result.awarded, 0);
    assert.equal(result.reason, 'invalid-source');
});

test('awardClanPoints applies an all-or-nothing weekly cap', () => {
    const weekKey = clanPointWeekKey(new Date('2026-01-01T12:00:00Z'));
    const result = awardClanPoints(
        { name: 'capper', clan: 'Leaf', clanPoints: 900, weeklyClanPoints: 990, weeklyClanPointsWeek: weekKey },
        'clanWarWin',
        25,
        {},
        new Date('2026-01-01T12:00:00Z'),
    );
    assert.equal(result.awarded, 0);
    assert.equal(result.reason, 'weekly-cap');
    assert.equal(result.weeklyEarned, 990);
});

test('awardClanPoints ignores duplicate event IDs', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const weekKey = clanPointWeekKey(now);
    const result = awardClanPoints(
        {
            name: 'retry',
            clan: 'Leaf',
            clanPoints: 100,
            weeklyClanPoints: 100,
            weeklyClanPointsWeek: weekKey,
            clanPointHistory: [{ id: 'mission:leaf:battle:claim:retry', ts: now.getTime(), source: 'clanMissionClaim', amount: 25, weekKey }],
        },
        'clanMissionClaim',
        25,
        { eventId: 'mission:leaf:battle:claim:retry' },
        now,
    );
    assert.equal(result.awarded, 0);
    assert.equal(result.reason, 'duplicate-event');
    assert.equal((result.character as Record<string, unknown>).clanPoints, 100);
    assert.equal(result.weeklyEarned, 100);
});

test('awardClanPoints resets the weekly meter on a new ISO week', () => {
    const oldWeek = clanPointWeekKey(new Date('2026-01-01T12:00:00Z'));
    const nextWeek = new Date('2026-01-08T12:00:00Z');
    const result = awardClanPoints(
        { name: 'reset', clan: 'Leaf', clanPoints: 75, weeklyClanPoints: CLAN_POINTS_WEEKLY_CAP, weeklyClanPointsWeek: oldWeek },
        'mentorMilestone',
        50,
        {},
        nextWeek,
    );
    assert.equal(result.awarded, 50);
    assert.equal(result.weeklyEarned, 50);
    assert.equal((result.character as Record<string, unknown>).clanPoints, 125);
    assert.equal((result.character as Record<string, unknown>).weeklyClanPointsWeek, clanPointWeekKey(nextWeek));
});
