import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { projectClanBossContributions, recordClanBossContribution, scoreClanBossContribution, snapshotContributionState } from './_contribution.js';
import type { TowerSession } from '../towers/_tower-session.js';

function session(): TowerSession {
    return {
        towerId: 'cboss-x', runId: 'cboss-x', floor: 9001, seed: 1, partySize: 2,
        map: { width: 2, height: 2, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [
            { id: 'sq-0', side: 'squad', name: 'A', ownerSlug: 'a', ai: false, hp: 80, maxHp: 100, chakra: 10, maxChakra: 10, stamina: 10, maxStamina: 10, shield: 0, statuses: [{ name: 'Burn', rounds: 2, kind: 'negative' }], cooldowns: {}, pos: 0, character: {} },
            { id: 'sq-1', side: 'squad', name: 'B', ownerSlug: 'b', ai: false, hp: 100, maxHp: 100, chakra: 10, maxChakra: 10, stamina: 10, maxStamina: 10, shield: 0, statuses: [], cooldowns: {}, pos: 1, character: {} },
            { id: 'boss', side: 'enemy', name: 'Boss', ownerSlug: null, ai: true, hp: 1_000, maxHp: 1_000, chakra: 10, maxChakra: 10, stamina: 10, maxStamina: 10, shield: 0, statuses: [], cooldowns: {}, pos: 2, character: {} },
        ],
        turnQueue: ['sq-0'], activeIndex: 0, round: 1, activeAp: 100, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'boss', completed: false, failed: false }, phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] },
        status: 'active', winner: null, recentMoveTokens: [], rewardSettlementState: 'pending', log: [], createdAt: 1, lastActionAt: 1,
    };
}

describe('Clan Boss contribution projection', () => {
    it('credits server-observed damage, healing, shielding, cleanse, and objective change to the acting owner', () => {
        const value = session();
        const before = snapshotContributionState(value);
        value.actors[0]!.hp = 95;
        value.actors[0]!.shield = 25;
        value.actors[0]!.statuses = [];
        value.actors[2]!.hp = 700;
        value.objectiveState.completed = true;
        recordClanBossContribution(value, 'sq-0', before);
        assert.deepEqual(value.clanBossContributions?.a, { actions: 1, damage: 300, healing: 15, shielding: 25, cleanses: 1, objective: 1 });
    });

    it('recognizes support and caps action spam while zero-action participants remain inactive', () => {
        const support = scoreClanBossContribution({ actions: 4, healing: 2_000, shielding: 1_000, cleanses: 2, objective: 1, damage: 0 }, true);
        assert.equal(support.active, true);
        assert.ok(support.score >= 220);
        const spam = scoreClanBossContribution({ actions: 10_000, damage: 0, healing: 0, shielding: 0, cleanses: 0, objective: 0 }, false);
        assert.equal(spam.score, 200);
        assert.equal(scoreClanBossContribution(undefined, true).active, false);
    });

    it('projects every accepted squad actor separately', () => {
        const value = session();
        value.clanBossContributions = { a: { actions: 2, damage: 500, healing: 0, shielding: 0, cleanses: 0, objective: 0 } };
        const output = projectClanBossContributions(value);
        assert.equal(output.a.actions, 2);
        assert.equal(output.b.active, false);
    });
});

