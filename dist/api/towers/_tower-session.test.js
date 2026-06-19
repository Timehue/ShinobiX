"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _tower_session_js_1 = require("./_tower-session.js");
function actor(id, side, over = {}) {
    return {
        id, side, name: id, ownerSlug: side === 'squad' ? `slug-${id}` : null,
        ai: side !== 'squad', hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, shield: 0, statuses: [], cooldowns: {}, pos: 0,
        character: {}, ...over,
    };
}
const MAP = { width: 20, height: 16, blockedTiles: [], hazardTiles: [], objectiveTiles: [] };
function baseParams(over = {}) {
    return {
        towerId: 'celestial', runId: 'tower-abc', floor: 5, seed: 12345, partySize: 4,
        map: MAP,
        actors: [
            actor('sq-1', 'squad'), actor('sq-2', 'squad'),
            actor('en-1', 'enemy'), actor('boss', 'enemy', { hp: 5000, maxHp: 5000 }),
        ],
        objectiveKind: 'defeat-boss', bossId: 'boss', bossPhases: [33, 66], now: 1_700_000_000_000,
        ...over,
    };
}
(0, node_test_1.describe)('Battle Towers session model (P1.A1)', () => {
    (0, node_test_1.it)('builds a valid active session with sane defaults', () => {
        const s = (0, _tower_session_js_1.createTowerSession)(baseParams());
        node_assert_1.strict.equal(s.status, 'active');
        node_assert_1.strict.equal(s.winner, null);
        node_assert_1.strict.equal(s.round, 1);
        node_assert_1.strict.equal(s.activeIndex, 0);
        node_assert_1.strict.equal(s.activeAp, 0);
        node_assert_1.strict.equal(s.actionsThisTurn, 0);
        node_assert_1.strict.deepEqual(s.turnQueue, []);
        node_assert_1.strict.equal(s.rewardSettlementState, 'pending');
        node_assert_1.strict.deepEqual(s.recentMoveTokens, []);
        node_assert_1.strict.equal(s.partySize, 4);
        node_assert_1.strict.equal(s.createdAt, 1_700_000_000_000);
        node_assert_1.strict.equal(s.lastActionAt, s.createdAt);
    });
    (0, node_test_1.it)('is N-actor (not p1/p2) and sides partition the roster', () => {
        const s = (0, _tower_session_js_1.createTowerSession)(baseParams());
        node_assert_1.strict.equal(s.actors.length, 4);
        node_assert_1.strict.equal((0, _tower_session_js_1.actorsOnSide)(s, 'squad').length, 2);
        node_assert_1.strict.equal((0, _tower_session_js_1.actorsOnSide)(s, 'enemy').length, 2);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'boss')?.maxHp, 5000);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'missing'), undefined);
    });
    (0, node_test_1.it)('sorts boss phases descending (highest threshold pops first)', () => {
        const s = (0, _tower_session_js_1.createTowerSession)(baseParams());
        node_assert_1.strict.deepEqual(s.phaseState.pendingPhases, [66, 33]);
        node_assert_1.strict.deepEqual(s.phaseState.triggeredPhases, []);
        node_assert_1.strict.equal(s.phaseState.bossId, 'boss');
    });
    (0, node_test_1.it)('marks npcAlive only when the roster has an npc', () => {
        const noNpc = (0, _tower_session_js_1.createTowerSession)(baseParams());
        node_assert_1.strict.equal(noNpc.objectiveState.npcAlive, undefined);
        const withNpc = (0, _tower_session_js_1.createTowerSession)(baseParams({
            objectiveKind: 'protect-npc',
            actors: [actor('sq-1', 'squad'), actor('npc-1', 'npc'), actor('en-1', 'enemy')],
        }));
        node_assert_1.strict.equal(withNpc.objectiveState.npcAlive, true);
    });
    (0, node_test_1.it)('living/side helpers reflect downed actors', () => {
        const s = (0, _tower_session_js_1.createTowerSession)(baseParams());
        node_assert_1.strict.ok((0, _tower_session_js_1.isSideAlive)(s, 'squad'));
        node_assert_1.strict.ok((0, _tower_session_js_1.isSideAlive)(s, 'enemy'));
        // down the whole squad
        for (const a of (0, _tower_session_js_1.actorsOnSide)(s, 'squad'))
            a.hp = 0;
        node_assert_1.strict.equal((0, _tower_session_js_1.livingOnSide)(s, 'squad').length, 0);
        node_assert_1.strict.equal((0, _tower_session_js_1.isSideAlive)(s, 'squad'), false);
        node_assert_1.strict.ok((0, _tower_session_js_1.isSideAlive)(s, 'enemy'), 'enemies still up');
    });
    (0, node_test_1.it)('activeActor reads the head of the turn queue', () => {
        const s = (0, _tower_session_js_1.createTowerSession)(baseParams());
        node_assert_1.strict.equal((0, _tower_session_js_1.activeActor)(s), undefined, 'no queue yet → no active actor');
        s.turnQueue = ['sq-1', 'en-1', 'sq-2', 'boss'];
        s.activeIndex = 0;
        node_assert_1.strict.equal((0, _tower_session_js_1.activeActor)(s)?.id, 'sq-1');
        s.activeIndex = 3;
        node_assert_1.strict.equal((0, _tower_session_js_1.activeActor)(s)?.id, 'boss');
    });
    (0, node_test_1.it)('the factory is pure w.r.t. time (now is a param, not Date.now)', () => {
        const a = (0, _tower_session_js_1.createTowerSession)(baseParams({ now: 42 }));
        const b = (0, _tower_session_js_1.createTowerSession)(baseParams({ now: 42 }));
        node_assert_1.strict.equal(a.createdAt, 42);
        node_assert_1.strict.equal(JSON.stringify(a), JSON.stringify(b), 'same inputs → identical session');
    });
});
