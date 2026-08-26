import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const aiFightStart = readFileSync(
    join(__dirname, 'missions', 'ai-fight-start.ts'),
    'utf8',
);
const pvpSession = readFileSync(
    join(__dirname, 'pvp', 'session.ts'),
    'utf8',
);

test('versioned empty recovery probes return successful no-content responses', () => {
    assert.match(aiFightStart, /const noContentRecoveryProbe = Number\(body\.recoveryProbeVersion\) >= 2/);
    assert.match(aiFightStart, /noContentRecoveryProbe[\s\S]*status: 204, body: \{ error: 'No active World encounter\.'/);
    assert.match(aiFightStart, /noContentRecoveryProbe[\s\S]*status: 204, body: \{ error: 'No active AI encounter\.'/);
    assert.match(aiFightStart, /response\.status === 204\) return res\.status\(204\)\.end\(\)/);
    assert.match(aiFightStart, /genericResponse\.status === 204\) return res\.status\(204\)\.end\(\)/);
    assert.match(pvpSession, /req\.query\.recoveryProbeVersion[\s\S]*return res\.status\(204\)\.end\(\)/);
});

test('unversioned probes retain the legacy contract for cached clients', () => {
    assert.match(aiFightStart, /status: 404, body: \{ error: 'No active World encounter\.'/);
    assert.match(aiFightStart, /status: 404, body: \{ error: 'No active AI encounter\.'/);
    assert.match(pvpSession, /return res\.status\(404\)\.json\(\{ error: 'No pending PvP session\.' \}\)/);
});

test('real missing resources remain distinguishable from empty probes', () => {
    assert.match(aiFightStart, /status: 404, body: \{ error: 'Player save not found\.'/);
    assert.match(aiFightStart, /status: 404, body: \{ error: 'AI opponent is not published on the server\.'/);
    assert.match(pvpSession, /res\.status\(404\)\.json\(\{ error: 'Session not found' \}\)/);
});
