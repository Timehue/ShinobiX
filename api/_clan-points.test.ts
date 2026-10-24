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

test('awardClanPoints clamps an award that would cross the weekly cap to the headroom left', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const weekKey = clanPointWeekKey(now);
    const result = awardClanPoints(
        { name: 'capper', clan: 'Leaf', clanPoints: 900, weeklyClanPoints: 990, weeklyClanPointsWeek: weekKey, lifetimeClanPoints: 5_000 },
        'clanWarWin',
        25,
        { eventId: 'war:clamp' },
        now,
    );
    assert.equal(result.awarded, 10);
    assert.equal(result.requested, 25);
    assert.equal(result.reason, 'weekly-cap');
    assert.equal(result.weeklyEarned, CLAN_POINTS_WEEKLY_CAP);
    const character = result.character as Record<string, unknown>;
    assert.equal(character.clanPoints, 910);
    assert.equal(character.weeklyClanPoints, 1_000);
    assert.equal(character.lifetimeClanPoints, 5_010);
    assert.equal((character.clanPointHistory as Array<{ id: string; amount: number }>)[0].amount, 10, 'history records what was paid');
    // The partial decision is final: the same event is a duplicate, never topped up.
    const retry = awardClanPoints({ ...character, weeklyClanPoints: 0 }, 'clanWarWin', 25, { eventId: 'war:clamp' }, now);
    assert.equal(retry.awarded, 0);
    assert.equal(retry.reason, 'duplicate-event');
});

test('awardClanPoints pays nothing once the weekly cap is reached', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const result = awardClanPoints(
        { name: 'capped', clan: 'Leaf', clanPoints: 900, weeklyClanPoints: CLAN_POINTS_WEEKLY_CAP, weeklyClanPointsWeek: clanPointWeekKey(now) },
        'clanWarWin',
        25,
        {},
        now,
    );
    assert.equal(result.awarded, 0);
    assert.equal(result.reason, 'weekly-cap');
    assert.equal(result.weeklyEarned, CLAN_POINTS_WEEKLY_CAP);
    assert.equal((result.character as Record<string, unknown>).clanPoints, 900);
});

test('awardClanPoints pays an award that fits in full, with no cap reason', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const result = awardClanPoints(
        { name: 'fits', clan: 'Leaf', clanPoints: 0, weeklyClanPoints: 975, weeklyClanPointsWeek: clanPointWeekKey(now) },
        'clanWarWin',
        25,
        {},
        now,
    );
    assert.equal(result.awarded, 25);
    assert.equal(result.reason, undefined);
    assert.equal(result.weeklyEarned, CLAN_POINTS_WEEKLY_CAP);
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
