import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The heartbeat re-delivers a challenge notice for its whole 180s lease unless
// the client dismisses it. A defender whose attacker fled (or whose fight ended
// quickly) was walked back into the finished battle by the stale notice, over
// and over. Pin that routing a sector attack also dismisses it.
test('the sector-attack router dismisses its notice locally and on the server before routing', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const start = app.indexOf('Sector-attack auto-routing');
    assert.ok(start > 0, 'sector-attack routing effect exists');
    const effect = app.slice(start, app.indexOf('Accepted-challenge routing', start));
    const dismiss = effect.indexOf('dismissChallengeLocally(incoming.id)');
    const server = effect.indexOf('clearChallengeOnServer(incoming)');
    const route = effect.indexOf('setPvpBattleId(incoming.battleId)');
    assert.ok(dismiss > 0 && server > 0, 'the notice is dismissed locally and cleared on the server');
    assert.ok(dismiss < route && server < route, 'dismissal happens before the battle is routed');
    assert.doesNotMatch(effect, /setDuelChallenges\(prev => prev\.filter\(c => c\.id !== incoming\.id\)\)/,
        'a local-only filter is resurrected by the next heartbeat');
});
