import test from 'node:test';
import assert from 'node:assert/strict';
import { findSectorSpectatorBattle } from './sector-spectate';
import { projectSectorPlayers } from './sector-player-roster';
import type { PlayerRecord } from '../types/character';

function mockRequest(session: unknown, feed = [{ battleId: 'live-id', fighters: [' Opponent ', 'Rival'], startedAt: 2 }]) {
    const calls: string[] = [];
    const request: typeof fetch = async (input, options) => {
        calls.push(String(input));
        assert.equal(options?.method, undefined, 'spectator lookup must remain read only');
        return Response.json(calls.length === 1 ? { arenaActiveFights: feed } : session);
    };
    return { calls, request };
}
const fighter = (name: string, pos: number) => ({ name, pos, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, shield: 0, statuses: [], character: { name } });
const active = { battleId: 'live-id', stateRevision: 1, status: 'active', p1: fighter('Opponent', 0), p2: fighter('Rival', 1), round: 1, activePlayer: 'p1', ap: { p1: 100, p2: 100 }, actionsThisTurn: 0, cooldowns: { p1: {}, p2: {} }, log: [], winner: null };

test('spectating resolves the canonical account and verifies its active session', async () => {
    const { request, calls } = mockRequest(active);
    assert.equal(await findSectorSpectatorBattle('OPPONENT', 'Viewer', request), 'live-id');
    assert.deepEqual(calls, ['/api/game-state', '/api/pvp/session?id=live-id']);
});
test('a server slug in the public feed resolves a fighter with a spaced display name', async () => {
    const session = { ...active, p1: fighter('Shadow Fox',0) };
    const {request}=mockRequest(session,[{battleId:'live-id',fighters:['shadowfox','Rival'],startedAt:2}]);
    assert.equal(await findSectorSpectatorBattle('Shadow Fox','Viewer',request),'live-id');
    await assert.rejects(findSectorSpectatorBattle('Shadow Fox','shadowfox',mockRequest(session,[{battleId:'live-id',fighters:['shadowfox','Rival'],startedAt:2}]).request),/participant/);
});

test('unbroadcast, ended, unrelated and own fights never open a spectator session', async () => {
    for (const session of [{ ...active, status: 'done' }, { ...active, p1: fighter('SomeoneElse', 0) }, { ...active, battleId: 'wrong' }])
        await assert.rejects(findSectorSpectatorBattle('Opponent', 'Viewer', mockRequest(session).request), /ended|unavailable|available/);
    await assert.rejects(findSectorSpectatorBattle('Opponent', 'Rival', mockRequest(active).request), /participant/);
    await assert.rejects(findSectorSpectatorBattle('Opponent', 'Viewer', mockRequest(active, []).request), /not available to spectate/);
});

test('spectating uses the battle screen validator for malformed and terminal projections', async () => {
    for (const session of [
        { ...active, p1: { name: 'Opponent' } },
        { ...active, version: 'player-ranked-session-close-tombstone-v1' },
        { ...active, playerRankedAuthorityVersion: 2, rankedKind: 'player', rankedMatchId: 'match', rankedSeasonId: 'season', rankedSeasonEpoch: 1,
            rankedCloseFence: { version: 'player-ranked-session-close-fence-v1', matchId: 'match', seasonId: 'season', seasonEpoch: 1, transitionId: 'closed', fencedAt: 1 } },
    ]) await assert.rejects(findSectorSpectatorBattle('Opponent', 'Viewer', mockRequest(session).request), /ended|available/);
});

test('lookup failures remain retryable', async () => {
    const request: typeof fetch = async () => new Response('', { status: 503 });
    await assert.rejects(findSectorSpectatorBattle('Opponent', 'Viewer', request), /Try again/);
});

test('watching bypasses no attack gate and requires current presence', () => {
    const player = { name: 'Opponent', level: 40, inBattle: true } as PlayerRecord;
    const options = { sector: 22, village: 'Stormveil Village', images: {}, contest: null, blockedReason: 'Mutations paused' };
    const [row] = projectSectorPlayers([player], options);
    assert.equal(row.actionDisabled, true);
    assert.equal(row.spectateDisabled, false);
    assert.equal(projectSectorPlayers([player], { ...options, spectateBlockedReason: 'Reconnecting' })[0].spectateDisabled, true);
});
