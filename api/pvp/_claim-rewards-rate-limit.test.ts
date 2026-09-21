import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('PvP reward settlement is account-scoped and has claim/ACK recovery headroom', () => {
    const source = readFileSync(join(process.cwd(), 'api/pvp/claim-rewards.ts'), 'utf8');
    const auth = source.indexOf('const identity = await authedPlayerOrAdmin(req, playerName);');
    const limit = source.indexOf("'pvp-claim-rewards'");

    assert.ok(auth >= 0, 'claim settlement must authenticate the requesting player');
    assert.ok(limit > auth, 'the per-player limiter must run after authentication');
    assert.match(source, /const PVP_REWARD_CLAIM_RATE_LIMIT = 120;/);
    assert.match(source, /PVP_REWARD_CLAIM_RATE_WINDOW_MS = 60_000/);
    assert.match(source, /const rateLimitIdentity = identity\.admin \? playerName : identity\.name;/);
    assert.match(source, /PVP_REWARD_CLAIM_RATE_WINDOW_MS,\s*rateLimitIdentity,/s);
});
