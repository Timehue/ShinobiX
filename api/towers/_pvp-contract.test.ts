import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTowerPvpMatch, type TowerPvpFighterSeed } from './_pvp-session.js';
import { isPublicTowerRun, isSpireRun } from './_tower-store.js';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function fighter(slug: string): TowerPvpFighterSeed {
    return {
        slug,
        displayName: slug,
        skill: 1,
        character: { maxHp: 100, maxChakra: 50, maxStamina: 50, stats: {}, specialty: 'Taijutsu', jutsu: [] },
    };
}

describe('Tower MPvP additive isolation contract', () => {
    it('can never satisfy Story or Spire reward identity', () => {
        const match = createTowerPvpMatch({
            matchId: `tpvp-${'d'.repeat(32)}`,
            fighters: ['a', 'b', 'c', 'd'].map(fighter),
            seed: 1,
            now: 1,
        });
        assert.equal(isPublicTowerRun(match.combat), false);
        assert.equal(isSpireRun(match.combat), false);
        assert.equal(match.combat.rewardSettlementState, 'settled');
    });

    it('mounts all four isolated production routes', () => {
        const server = source('server.ts');
        for (const route of ['pvp-queue', 'pvp-state', 'pvp-action', 'pvp-settle']) {
            assert.match(server, new RegExp(`route\\('/towers/${route}'`));
            assert.match(server, new RegExp(`api/towers/${route}\\.js`));
        }
    });

    it('keeps progression/reward writers out of MPvP modules', () => {
        const combined = [
            '_pvp-session.ts', '_pvp-store.ts', '_pvp-action.ts', '_pvp-lifecycle.ts',
            'pvp-queue.ts', 'pvp-state.ts', 'pvp-action.ts', 'pvp-settle.ts',
        ].map(file => source(`api/towers/${file}`)).join('\n');
        for (const forbidden of [
            'settleFloorForMember', 'settleAssistForAlly', 'settleSpireForMember',
            'battleTowerBestFloor', 'battleTowerAscension', 'battleTowerRating',
            'firstClearKey', 'spireRewardKey', 'gainXp', 'writeSaveProjected',
        ]) assert.doesNotMatch(combined, new RegExp(forbidden), forbidden);
    });

    it('routes every match response through the viewer projection', () => {
        for (const file of ['pvp-queue.ts', 'pvp-state.ts', 'pvp-action.ts', 'pvp-settle.ts']) {
            assert.match(source(`api/towers/${file}`), /projectTowerPvpMatchForViewer/,
                `${file} must not return the amber authority frame raw`);
        }
    });

    it('protects ordinary Tower recovery from deleting an MPvP lease', () => {
        const myRun = source('api/towers/my-run.ts');
        const pvpBranch = myRun.indexOf("battleLease?.meta.mode === 'mpvp'");
        const towerRead = myRun.indexOf('const session = await readSession(runId)');
        assert.ok(pvpBranch > 0 && pvpBranch < towerRead);
        assert.match(myRun, /pvpMatchId: battleLease\.battleId/);
    });

    it('publishes non-sensitive realtime revision hints for the full lifecycle', () => {
        const notify = source('api/_realtime/notify.ts');
        const realtime = source('api/towers/_pvp-realtime.ts');
        assert.match(notify, /channel: 'pvp'/);
        for (const reason of ['queued', 'matched', 'ready', 'action', 'settled', 'closed']) {
            assert.match(notify, new RegExp(`'${reason}'`));
        }
        assert.doesNotMatch(realtime, /combat|character|inviteCode/,
            'socket payloads must stay revision-only');
    });

    it('exports a typed exact-2v2 client contract', () => {
        const contract = source('shared/tower-pvp.ts');
        assert.match(contract, /TOWER_PVP_TEAM_SIZE = 2/);
        assert.match(contract, /TOWER_PVP_MATCH_SIZE = 4/);
        assert.match(contract, /TowerPvpMatchView/);
        assert.match(contract, /viewer: \{ teamId: TowerPvpTeamId; actorId: string \}/);
        assert.match(contract, /policy: 'no-progression-v1'/);
        assert.match(contract, /'forfeit'/);
    });
});
