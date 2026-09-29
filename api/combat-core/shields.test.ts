import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { expireShield, timeShieldGain, timeStartingShield } from './shields.js';

test('shield survives two rounds, expires before the third, and a new grant refreshes it', () => {
    const starting = timeStartingShield<{ shield: number; shieldExpiresAtRound?: number }>({ shield: 300 });
    assert.equal(starting.shieldExpiresAtRound, 3);
    assert.equal(expireShield(starting, 2).shield, 300);
    assert.equal(expireShield(starting, 3).shield, 0);

    const refreshed = timeShieldGain({ ...starting, shield: 450 }, 300, 2);
    assert.equal(refreshed.shieldExpiresAtRound, 4);
    assert.equal(expireShield(refreshed, 3).shield, 450);
    assert.equal(expireShield(refreshed, 4).shield, 0);
    assert.equal(timeShieldGain(refreshed, 450, 3).shieldExpiresAtRound, 4,
        'a capped or zero gain does not extend the timer');
});
