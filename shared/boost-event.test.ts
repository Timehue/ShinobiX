import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BOOST_MAX_MULTIPLIER,
    boostMultiplierAt,
    buildBoostEvent,
    formatBoostTimeLeft,
    isBoostEventActive,
    sanitizeBoostEvent,
} from './boost-event.ts';

const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;

function event(overrides: Record<string, unknown> = {}) {
    return sanitizeBoostEvent({ id: 'b1', multiplier: 2, targets: ['training'], startsAt: T0, endsAt: T0 + HOUR, ...overrides });
}

test('an event boosts only its targets, only while it runs', () => {
    const e = event({ targets: ['training', 'jutsu'] });
    assert.equal(boostMultiplierAt(e, 'training', T0), 2);
    assert.equal(boostMultiplierAt(e, 'jutsu', T0 + HOUR - 1), 2);
    assert.equal(boostMultiplierAt(e, 'growth', T0), 1, 'untargeted');
    assert.equal(boostMultiplierAt(e, 'training', T0 - 1), 1, 'before start');
    assert.equal(boostMultiplierAt(e, 'training', T0 + HOUR), 1, 'ends exactly at endsAt');
    assert.equal(boostMultiplierAt(null, 'training', T0), 1);
});

test('malformed or out-of-range rows never boost anything', () => {
    for (const bad of [
        null, 'x', [], {},
        { multiplier: 1, targets: ['training'], startsAt: T0, endsAt: T0 + HOUR },
        { multiplier: 5, targets: ['training'], startsAt: T0, endsAt: T0 + HOUR },
        { multiplier: 2, targets: [], startsAt: T0, endsAt: T0 + HOUR },
        { multiplier: 2, targets: ['ryo'], startsAt: T0, endsAt: T0 + HOUR },
        { multiplier: 2, targets: ['training'], startsAt: T0, endsAt: T0 },
        { multiplier: 'NaN', targets: ['training'], startsAt: T0, endsAt: T0 + HOUR },
    ]) {
        assert.equal(sanitizeBoostEvent(bad), null, JSON.stringify(bad));
    }
    assert.equal(boostMultiplierAt(sanitizeBoostEvent({ multiplier: 9 }), 'training', T0), 1);
});

test('unknown targets are dropped and duplicates collapse', () => {
    const e = event({ targets: ['training', 'training', 'ryo', 'growth'] });
    assert.deepEqual(e?.targets, ['training', 'growth']);
});

test('buildBoostEvent accepts only the offered multipliers and a 1-72h window', () => {
    const ok = buildBoostEvent({ multiplier: 1.5, targets: ['growth'], hours: 6, nowMs: T0 });
    assert.ok(ok.ok);
    if (ok.ok) {
        assert.equal(ok.event.endsAt - ok.event.startsAt, 6 * HOUR);
        assert.equal(ok.event.title, '1.5× Battle & mission growth');
        assert.ok(isBoostEventActive(ok.event, T0));
    }
    assert.equal(buildBoostEvent({ multiplier: 3, targets: ['growth'], hours: 6, nowMs: T0 }).ok, false);
    assert.equal(buildBoostEvent({ multiplier: 2, targets: ['growth'], hours: 0, nowMs: T0 }).ok, false);
    assert.equal(buildBoostEvent({ multiplier: 2, targets: ['growth'], hours: 73, nowMs: T0 }).ok, false);
    assert.equal(buildBoostEvent({ multiplier: 2, targets: [], hours: 6, nowMs: T0 }).ok, false);
    assert.equal(buildBoostEvent({ multiplier: 2, targets: ['growth', 'ryo'], hours: 6, nowMs: T0 }).ok, false);
});

test('the cap stays within the training seal ceiling', () => {
    // 8h tier base 72 × aggregate 2.5 × rookie peak 5 × cap must stay under
    // MAX_SEALED_STAT_GAIN (2,500) in api/training/_session.ts.
    assert.ok(72 * 2.5 * 5 * BOOST_MAX_MULTIPLIER < 2500);
});

test('time-left text', () => {
    assert.equal(formatBoostTimeLeft(T0 + 90 * 60_000, T0), '1h 30m left');
    assert.equal(formatBoostTimeLeft(T0 + 2 * HOUR, T0), '2h left');
    assert.equal(formatBoostTimeLeft(T0 + 59_000, T0), '1m left');
    assert.equal(formatBoostTimeLeft(T0 - 1, T0), '0m left');
});
