import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { ROSTER_RESYNC_EVERY_BEATS, __resetHeartbeatRosterForTest, heartbeatRosterFields } from './heartbeat-roster.ts';

beforeEach(() => __resetHeartbeatRosterForTest());

test('without a live socket every beat asks for the roster', () => {
    for (let i = 0; i < 20; i++) assert.deepEqual(heartbeatRosterFields(false), {});
});

test('with a live socket only every Nth beat asks for the roster, as a resync', () => {
    const asks = Array.from({ length: ROSTER_RESYNC_EVERY_BEATS * 3 }, () => !heartbeatRosterFields(true).socketLive);
    assert.equal(asks.filter(Boolean).length, 3);
    assert.equal(asks[ROSTER_RESYNC_EVERY_BEATS - 1], true);
});

test('a socket drop resets the cycle so the first beat back asks again after the full interval', () => {
    heartbeatRosterFields(true);
    heartbeatRosterFields(true);
    assert.deepEqual(heartbeatRosterFields(false), {});
    const next = Array.from({ length: ROSTER_RESYNC_EVERY_BEATS }, () => heartbeatRosterFields(true).socketLive === true);
    assert.deepEqual(next, [...Array(ROSTER_RESYNC_EVERY_BEATS - 1).fill(true), false]);
});
