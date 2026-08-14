import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDiscoverableTowerRun } from './my-run.js';
import type { TowerActor, TowerSession } from './_tower-session.js';

function actor(slug: string, hp: number): TowerActor {
    return {
        id: `sq-${slug}`,
        side: 'squad',
        ownerSlug: slug,
        name: slug,
        ai: false,
        hp,
        maxHp: 100,
        chakra: 0,
        maxChakra: 0,
        stamina: 0,
        maxStamina: 0,
        shield: 0,
        statuses: [],
        cooldowns: {},
        pos: 0,
        character: {},
    };
}

function session(status: TowerSession['status'] = 'active'): TowerSession {
    return {
        towerId: 'celestial',
        runId: 'tower-reconnect',
        floor: 1,
        seed: 1,
        partySize: 2,
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [actor('alive', 100), actor('ko', 0)],
        turnQueue: [],
        activeIndex: 0,
        round: 2,
        activeAp: 0,
        actionsThisTurn: 0,
        groundEffects: [],
        objectiveState: { kind: 'defeat-all', completed: false, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status,
        winner: status === 'done' ? 'enemy' : null,
        recentMoveTokens: [],
        rewardSettlementState: 'pending',
        log: [],
        createdAt: 1,
        lastActionAt: 1,
    };
}

describe('Tower active-run discovery', () => {
    it('keeps a KO live member discoverable for reconnect/spectate', () => {
        assert.equal(isDiscoverableTowerRun(session(), 'ko'), true);
    });

    it('rejects non-members, keeps pending settlement discoverable, and retires settled runs', () => {
        assert.equal(isDiscoverableTowerRun(session(), 'stranger'), false);
        const pending = session('done');
        assert.equal(isDiscoverableTowerRun(pending, 'ko'), true);
        pending.rewardSettlementState = 'settled';
        assert.equal(isDiscoverableTowerRun(pending, 'ko'), false);
        assert.equal(isDiscoverableTowerRun(null, 'ko'), false);
    });
});
