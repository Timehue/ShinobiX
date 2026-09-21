import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('PvP win reports use authenticated player limits with recovery headroom', () => {
    const source = readFileSync(join(process.cwd(), 'api/missions/report-pvp-win.ts'), 'utf8');
    const auth = source.indexOf('const identity = await authedPlayerOrAdmin(req, playerName);');
    const limit = source.indexOf("'report-pvp-win'");

    assert.ok(auth >= 0, 'win reports must authenticate the requesting player');
    assert.ok(limit > auth, 'the player limiter must run after authentication');
    assert.match(source, /const PVP_WIN_REPORT_RATE_LIMIT = 120;/);
    assert.match(source, /PVP_WIN_REPORT_RATE_WINDOW_MS = 60_000/);
    assert.match(source, /const rateLimitIdentity = identity\.admin \? playerName : identity\.name;/);
    assert.match(source, /PVP_WIN_REPORT_RATE_WINDOW_MS,\s*rateLimitIdentity,/s);
});
