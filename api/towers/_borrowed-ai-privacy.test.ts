import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { isDiscoverableTowerRun } from './my-run.js';
import type { TowerSession } from './_tower-session.js';

function session(ai: boolean): TowerSession {
    return {
        runId: 'tower-borrowed-privacy',
        towerId: 'celestial',
        floor: 1,
        seed: 1,
        partySize: 2,
        map: { width: 1, height: 1, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [{
            id: 'sq-bob', side: 'squad', ownerSlug: 'bob', name: 'Bob', ai,
            hp: 100, maxHp: 100, chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0,
            shield: 0, statuses: [], cooldowns: {}, pos: 0, character: {},
        }],
        turnQueue: ['sq-bob'], activeIndex: 0, round: 1, activeAp: 0, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-all', completed: false, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] }, status: 'active', winner: null,
        recentMoveTokens: [], rewardSettlementState: 'pending', log: [], createdAt: 1, lastActionAt: 1,
    };
}

describe('Tower borrowed-AI privacy and recovery boundary', () => {
    it('never treats an owned AI assist as an authoritative reconnect member', () => {
        assert.equal(isDiscoverableTowerRun(session(true), 'bob'), false);
        assert.equal(isDiscoverableTowerRun(session(false), 'bob'), true);
    });

    it('publishes recovery pointers and route access only for live human actors', () => {
        const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
        const start = source('api/towers/start.ts');
        const inviteWrites = start.match(/for \(const slug of towerBattleLeaseMembers\((?:existing|session)\)\)/g) ?? [];
        assert.equal(inviteWrites.length, 2, 'new and replay publication derive invitees from live lease members');
        assert.doesNotMatch(start, /for \(const slug of memberSlugs\).*setTowerInvite/);

        for (const file of ['api/towers/action.ts', 'api/towers/state.ts', 'api/towers/settle.ts', 'api/towers/join.ts']) {
            const text = source(file);
            assert.match(text, /side === 'squad'[\s\S]{0,100}ai === false[\s\S]{0,100}ownerSlug/, file);
        }
        assert.match(source('api/towers/settle.ts'), /settleAssistForAlly\(\{ session, slug \}\)/,
            'host settlement still credits the capped internal assist channel');
    });
});
