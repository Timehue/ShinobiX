import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { blocksClanWarAutoLaunch, visibleClanWarChallengeId } from './battle-flow-screen';

test('a restored visible clan host records its challenge before a stale list can reopen it', () => {
    for (const screen of ['clanWarPet', 'clanWar2v2', 'tilecardsDuel'] as const)
        assert.equal(visibleClanWarChallengeId(screen, () => '{"challengeId":"already-viewed"}'), 'already-viewed');
    assert.equal(visibleClanWarChallengeId('clan', () => '{"challengeId":"already-viewed"}'), null);
    assert.equal(visibleClanWarChallengeId('sectorPet', () => '{"challengeId":"already-viewed"}'), null);
    assert.equal(visibleClanWarChallengeId('clanWarPet', () => '{'), null);
    assert.equal(visibleClanWarChallengeId('clanWarPet', () => '{"challengeId":12}'), null);
    assert.equal(visibleClanWarChallengeId('clanWarPet', () => { throw new Error('Storage unavailable'); }), null);
});

test('pet replay routes retain their battle binding until the viewer exits', () => {
    for (const screen of ['clanWarPet', 'sectorPet'] as const)
        assert.equal(blocksClanWarAutoLaunch(screen, false, false), true);
});

test('the shared PvP host remembers only its actual clan duel, not an unrelated stale stash', () => {
    const staleStash = () => '{"challengeId":"unrelated"}';
    assert.equal(visibleClanWarChallengeId('pvpBattle', staleStash, { mode: 'clanWar1v1', clanWarChallengeId: 'viewed-duel' }), 'viewed-duel');
    assert.equal(visibleClanWarChallengeId('pvpBattle', staleStash, { mode: 'ranked' }), null);
    assert.equal(visibleClanWarChallengeId('pvpBattle', staleStash, { mode: 'standard' }), null);
    assert.equal(visibleClanWarChallengeId('pvpBattle', staleStash, { mode: 'clanWar1v1' }), null);
});

test('mixed lobbies remain launchable while their active fights remain protected', () => {
    for (const screen of ['petArena', 'petColiseum', 'petLadder'] as const) {
        assert.equal(blocksClanWarAutoLaunch(screen, false, false), false);
        assert.equal(blocksClanWarAutoLaunch(screen, true, false), true);
    }
    for (const screen of ['battleTowers', 'arenaDistrict'] as const) {
        assert.equal(blocksClanWarAutoLaunch(screen, false, false), false);
        assert.equal(blocksClanWarAutoLaunch(screen, false, true), true);
    }
});

test('other battle hosts stay protected and ordinary destinations admit the accepted match', () => {
    for (const screen of ['pvpBattle', 'clanWar2v2', 'tilecardsDuel', 'sectorCard', 'cardClashFreePlay'] as const)
        assert.equal(blocksClanWarAutoLaunch(screen, false, false), true);
    for (const screen of ['clan', 'worldMap', 'profile'] as const)
        assert.equal(blocksClanWarAutoLaunch(screen, false, false), false);
});

test('the automatic accepted-match launcher uses the shared battle guard', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    assert.match(app, /if \(blocksClanWarAutoLaunch\(screen, petBattleActive \|\| !!pendingPetBattleOpponent, hasActiveTowerFight\(\)\)\) return;/);
});
