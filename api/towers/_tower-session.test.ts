import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    createTowerSession,
    getActor,
    actorsOnSide,
    livingOnSide,
    isSideAlive,
    activeActor,
    type TowerActor,
    type TowerMap,
    type CreateTowerSessionParams,
} from './_tower-session.js';

function actor(id: string, side: TowerActor['side'], over: Partial<TowerActor> = {}): TowerActor {
    return {
        id, side, name: id, ownerSlug: side === 'squad' ? `slug-${id}` : null,
        ai: side !== 'squad', hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, shield: 0, statuses: [], cooldowns: {}, pos: 0,
        character: {}, ...over,
    };
}

const MAP: TowerMap = { width: 20, height: 16, blockedTiles: [], hazardTiles: [], objectiveTiles: [] };

function baseParams(over: Partial<CreateTowerSessionParams> = {}): CreateTowerSessionParams {
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

describe('Battle Towers session model (P1.A1)', () => {
    it('builds a valid active session with sane defaults', () => {
        const s = createTowerSession(baseParams());
        assert.equal(s.status, 'active');
        assert.equal(s.winner, null);
        assert.equal(s.round, 1);
        assert.equal(s.activeIndex, 0);
        assert.equal(s.activeAp, 0);
        assert.equal(s.actionsThisTurn, 0);
        assert.deepEqual(s.turnQueue, []);
        assert.equal(s.rewardSettlementState, 'pending');
        assert.deepEqual(s.recentMoveTokens, []);
        assert.equal(s.partySize, 4);
        assert.equal(s.createdAt, 1_700_000_000_000);
        assert.equal(s.lastActionAt, s.createdAt);
    });

    it('is N-actor (not p1/p2) and sides partition the roster', () => {
        const s = createTowerSession(baseParams());
        assert.equal(s.actors.length, 4);
        assert.equal(actorsOnSide(s, 'squad').length, 2);
        assert.equal(actorsOnSide(s, 'enemy').length, 2);
        assert.equal(getActor(s, 'boss')?.maxHp, 5000);
        assert.equal(getActor(s, 'missing'), undefined);
    });

    it('sorts boss phases descending (highest threshold pops first)', () => {
        const s = createTowerSession(baseParams());
        assert.deepEqual(s.phaseState.pendingPhases, [66, 33]);
        assert.deepEqual(s.phaseState.triggeredPhases, []);
        assert.equal(s.phaseState.bossId, 'boss');
    });

    it('marks npcAlive only when the roster has an npc', () => {
        const noNpc = createTowerSession(baseParams());
        assert.equal(noNpc.objectiveState.npcAlive, undefined);
        const withNpc = createTowerSession(baseParams({
            objectiveKind: 'protect-npc',
            actors: [actor('sq-1', 'squad'), actor('npc-1', 'npc'), actor('en-1', 'enemy')],
        }));
        assert.equal(withNpc.objectiveState.npcAlive, true);
    });

    it('living/side helpers reflect downed actors', () => {
        const s = createTowerSession(baseParams());
        assert.ok(isSideAlive(s, 'squad'));
        assert.ok(isSideAlive(s, 'enemy'));
        // down the whole squad
        for (const a of actorsOnSide(s, 'squad')) a.hp = 0;
        assert.equal(livingOnSide(s, 'squad').length, 0);
        assert.equal(isSideAlive(s, 'squad'), false);
        assert.ok(isSideAlive(s, 'enemy'), 'enemies still up');
    });

    it('activeActor reads the head of the turn queue', () => {
        const s = createTowerSession(baseParams());
        assert.equal(activeActor(s), undefined, 'no queue yet → no active actor');
        s.turnQueue = ['sq-1', 'en-1', 'sq-2', 'boss'];
        s.activeIndex = 0;
        assert.equal(activeActor(s)?.id, 'sq-1');
        s.activeIndex = 3;
        assert.equal(activeActor(s)?.id, 'boss');
    });

    it('the factory is pure w.r.t. time (now is a param, not Date.now)', () => {
        const a = createTowerSession(baseParams({ now: 42 }));
        const b = createTowerSession(baseParams({ now: 42 }));
        assert.equal(a.createdAt, 42);
        assert.equal(JSON.stringify(a), JSON.stringify(b), 'same inputs → identical session');
    });
});
