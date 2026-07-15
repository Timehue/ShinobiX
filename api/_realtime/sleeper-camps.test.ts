import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sleeperCampForPresence } from './sleeper-camps.js';
import type { OnlinePlayer } from './types.js';

const NOW = 50_000;
function player(patch: Partial<OnlinePlayer> = {}): OnlinePlayer {
    return {
        name: 'rill', displayName: 'Rill', sector: 12, character: null,
        lastSeenAt: NOW, connectedAt: 1, pendingAttacker: null,
        ...patch,
    };
}

test('wild idle disconnect becomes an explicit sleeper camp', () => {
    assert.deepEqual(sleeperCampForPresence(player(), NOW), {
        name: 'rill', displayName: 'Rill', sector: 12, createdAt: NOW,
    });
});

test('safe-zone, traveling, and fighting disconnects do not mint camps', () => {
    assert.equal(sleeperCampForPresence(player({ sector: 0 }), NOW), null);
    assert.equal(sleeperCampForPresence(player({ travelingUntil: NOW + 1 }), NOW), null);
    assert.equal(sleeperCampForPresence(player({ inBattle: true }), NOW), null);
});
