import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTowerRouteChoice, parseTowerRouteChoice, towerRouteScoreMultiplier } from './_route-choice.js';
import type { TowerSession } from './_tower-session.js';

function fixture(): TowerSession {
    const actor = (id: string, side: 'squad' | 'enemy') => ({
        id,
        side,
        name: id,
        ownerSlug: side === 'squad' ? 'rill' : null,
        ai: side === 'enemy',
        hp: 1000,
        maxHp: 1000,
        chakra: 100,
        maxChakra: 100,
        stamina: 100,
        maxStamina: 100,
        shield: 0,
        statuses: [],
        cooldowns: {},
        pos: side === 'squad' ? 0 : 1,
        character: { towerDmgScale: 1 },
    });
    return {
        towerId: 'celestial-spire', runId: 'route-test', floor: 2, seed: 1, partySize: 1,
        map: { width: 2, height: 1, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [actor('rill', 'squad'), actor('bandit', 'enemy')],
        turnQueue: [], activeIndex: 0, round: 0, activeAp: 0, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-all', completed: false, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] }, status: 'active', winner: null,
        recentMoveTokens: [], rewardSettlementState: 'pending', log: [], createdAt: 0, lastActionAt: 0,
    };
}

test('route parser fails closed to the Rest Shrine', () => {
    assert.equal(parseTowerRouteChoice('not-a-route'), 'rest-shrine');
});

test('Rest Shrine seals a barrier without changing score', () => {
    const session = fixture();
    applyTowerRouteChoice(session, 'rest-shrine');
    assert.equal(session.actors[0]?.shield, 120);
    assert.equal(towerRouteScoreMultiplier(session), 1);
});

test('Focused Assault grants only the squad a bounded opening buff', () => {
    const session = fixture();
    applyTowerRouteChoice(session, 'focused-assault');
    assert.deepEqual(session.actors[0]?.statuses[0], {
        name: 'Increase Damage Given', source: 'Focused Assault', rounds: 3,
        activeRound: 1, percent: 10, kind: 'positive',
    });
    assert.equal(session.actors[1]?.statuses.length, 0);
});

test('Elite Shortcut raises enemy pressure and seals its score multiplier', () => {
    const session = fixture();
    applyTowerRouteChoice(session, 'elite-shortcut');
    assert.equal(session.actors[1]?.maxHp, 1180);
    assert.equal(session.actors[1]?.hp, 1180);
    assert.equal(session.actors[1]?.character.towerDmgScale, 1.1);
    assert.equal(towerRouteScoreMultiplier(session), 1.25);
    session.routeChoice!.scoreMultiplier = 2;
    assert.equal(towerRouteScoreMultiplier(session), 1.25, 'settlement derives the multiplier from the sealed route id');
});
