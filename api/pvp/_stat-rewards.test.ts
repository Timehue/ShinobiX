import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pvpStatPointsForWin } from './_stat-rewards.js';

test('PvP rolls cover 1–6 uniformly and stay fixed across retries, with and without a secret', t => {
    const previous = process.env.SESSION_SECRET;
    t.after(() => {
        if (previous === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = previous;
    });
    for (const secret of [undefined, 'pvp-stat-roll-test-secret']) {
        if (secret === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = secret;
        const counts = [0, 0, 0, 0, 0, 0];
        for (let i = 0; i < 6000; i++) {
            const battleId = `battle-${i}`;
            const points = pvpStatPointsForWin('rin', battleId);
            assert.ok(Number.isInteger(points) && points >= 1 && points <= 6);
            assert.equal(pvpStatPointsForWin('rin', battleId), points);
            counts[points - 1]++;
        }
        for (const count of counts) assert.ok(count > 850 && count < 1150, String(counts));
    }
});
