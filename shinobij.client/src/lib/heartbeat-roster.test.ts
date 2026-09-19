import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { PlayerRecord } from '../types/character';
import { ROSTER_MAX_AGE_MS, heartbeatRosterFields } from './heartbeat-roster.ts';
import { pushLiveSectorPlayers, resetLiveSectorPlayers, setLiveSectorContext } from './presence-store.ts';

// A beat skips the full sector roster only while the client already holds a
// current one for the sector it reports. The rule reads that state, so it can
// never be thrown off by a skipped or discarded beat.

const peer = (name: string, sector: number) => ({ name, currentSector: sector, level: 5 }) as unknown as PlayerRecord;
const visible = { socketLive: true, tabVisible: true };

beforeEach(() => resetLiveSectorPlayers());

test('without a live socket every beat asks for the roster', () => {
    setLiveSectorContext(12);
    pushLiveSectorPlayers([peer('ally', 12)], 12);
    assert.deepEqual(heartbeatRosterFields({ socketLive: false, sector: 12, tabVisible: true }), {});
});

test('before any roster for this sector, the beat asks for one', () => {
    assert.deepEqual(heartbeatRosterFields({ ...visible, sector: 12 }), {});
});

test('a current roster for the reported sector lets the beat skip it', () => {
    setLiveSectorContext(12);
    pushLiveSectorPlayers([peer('ally', 12)], 12);
    assert.deepEqual(heartbeatRosterFields({ ...visible, sector: 12 }), { socketLive: true });
});

test('arriving in a new sector asks at once, even if the socket\'s arrival snapshot was dropped', () => {
    setLiveSectorContext(12);
    pushLiveSectorPlayers([peer('ally', 12)], 12);
    // The destination snapshot landed while the client was still in 12 and was
    // rejected; the client then switched sector.
    pushLiveSectorPlayers([peer('stranger', 13)], 13);
    setLiveSectorContext(13);
    assert.deepEqual(heartbeatRosterFields({ ...visible, sector: 13 }), {});
    pushLiveSectorPlayers([peer('stranger', 13)], 13);
    assert.deepEqual(heartbeatRosterFields({ ...visible, sector: 13 }), { socketLive: true });
});

test('a beat reporting a different sector than the last roster asks, whatever the store saw', () => {
    setLiveSectorContext(12);
    pushLiveSectorPlayers([peer('ally', 12)], 12);
    assert.deepEqual(heartbeatRosterFields({ ...visible, sector: 14 }), {});
});

test('a visible tab refreshes a roster once it is a minute old; a hidden tab waits until shown', () => {
    setLiveSectorContext(12);
    pushLiveSectorPlayers([peer('ally', 12)], 12);
    const at = Date.now();
    assert.deepEqual(heartbeatRosterFields({ ...visible, sector: 12 }, at + ROSTER_MAX_AGE_MS - 1_000), { socketLive: true });
    assert.deepEqual(heartbeatRosterFields({ ...visible, sector: 12 }, at + ROSTER_MAX_AGE_MS + 1_000), {});
    assert.deepEqual(heartbeatRosterFields({ socketLive: true, tabVisible: false, sector: 12 }, at + 10 * ROSTER_MAX_AGE_MS), { socketLive: true });
});

test('a beat that never delivered its roster leaves the next beat still asking', () => {
    setLiveSectorContext(12);
    // Folded into an in-flight beat, refused, or its reply discarded: nothing
    // was adopted, so nothing changed.
    for (let beat = 0; beat < 10; beat++) assert.deepEqual(heartbeatRosterFields({ ...visible, sector: 12 }), {});
});

test('logging out forgets the roster', () => {
    setLiveSectorContext(12);
    pushLiveSectorPlayers([peer('ally', 12)], 12);
    resetLiveSectorPlayers();
    assert.deepEqual(heartbeatRosterFields({ ...visible, sector: 12 }), {});
});
