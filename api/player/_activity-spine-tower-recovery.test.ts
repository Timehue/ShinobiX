import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { TowerBattleLock } from '../towers/_battle-lease.js';
import type { TowerActor, TowerSession } from '../towers/_tower-session.js';
import {
    discoverActivityTowerRecovery,
    isOwnedRecoverableTowerSession,
    type ActivityTowerRecoveryReaders,
} from './_activity-spine-tower-recovery.js';

function human(slug = 'hero', over: Partial<TowerActor> = {}): TowerActor {
    return {
        id: 'sq-0', side: 'squad', name: slug, ownerSlug: slug, ai: false,
        hp: 100, maxHp: 100, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, shield: 0, statuses: [], cooldowns: {},
        pos: 0, character: {},
        ...over,
    };
}

function towerSession(
    runId: string,
    kind: 'story' | 'spire' | 'clan-boss' | 'embedded' = 'story',
    over: Partial<TowerSession> = {},
): TowerSession {
    const spire = kind === 'spire';
    return {
        towerId: spire ? 'endless-spire' : kind === 'story' ? 'celestial' : 'embedded',
        runId,
        floor: spire ? 3 : kind === 'story' ? 1 : 9_001,
        seed: 1,
        partySize: 1,
        map: { width: 3, height: 3, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [human()],
        turnQueue: ['sq-0'],
        activeIndex: 0,
        round: 1,
        activeAp: 3,
        actionsThisTurn: 0,
        groundEffects: [],
        objectiveState: { kind: 'defeat', completed: false, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status: 'active',
        winner: null,
        recentMoveTokens: [],
        rewardSettlementState: 'pending',
        log: [],
        createdAt: 1,
        lastActionAt: 1,
        ...(spire ? { ascensionTier: 3 } : {}),
        ...(kind === 'embedded' || kind === 'clan-boss'
            ? { encounterFloor: { id: 9_001 } as TowerSession['encounterFloor'] }
            : {}),
        ...over,
    };
}

function lease(runId: string, mode?: 'mpvp'): TowerBattleLock {
    return {
        battleId: runId,
        kind: 'battleTowers',
        screen: 'battleTowers',
        startedAt: 1,
        meta: { runId, ...(mode ? { mode } : {}) },
    };
}

function readers(over: Partial<ActivityTowerRecoveryReaders> = {}): ActivityTowerRecoveryReaders {
    return {
        readLease: async () => null,
        readClanBossMarker: async () => null,
        readInvite: async () => null,
        readSession: async () => null,
        ...over,
    };
}

describe('Activity Spine Tower recovery discovery', () => {
    it('routes an owned Story lease to Battle Towers', async () => {
        const runId = 'tower-story-1';
        const seen: string[] = [];
        const recovery = await discoverActivityTowerRecovery('Hero', readers({
            readLease: async slug => {
                assert.equal(slug, 'hero');
                return lease(runId);
            },
            readSession: async candidate => {
                seen.push(candidate);
                return towerSession(candidate, 'story');
            },
        }));
        assert.deepEqual(seen, [runId]);
        assert.deepEqual(recovery, {
            runId,
            title: 'Resume your Battle Towers run',
            screen: 'battleTowers',
            runtimeModeId: 'battle-towers',
            context: 'towers',
        });
    });

    it('routes an owned Spire lease through the exact Spire capability', async () => {
        const runId = 'spire-run-1';
        const recovery = await discoverActivityTowerRecovery('hero', readers({
            readLease: async () => lease(runId),
            readSession: async () => towerSession(runId, 'spire'),
        }));
        assert.equal(recovery?.runtimeModeId, 'endless-spire');
        assert.equal(recovery?.title, 'Resume your Endless Spire run');
    });

    it('discovers a fresh solo Clan Boss session from the host invite', async () => {
        const runId = 'cboss-fresh-solo';
        const recovery = await discoverActivityTowerRecovery('hero', readers({
            readInvite: async () => runId,
            readSession: async () => towerSession(runId, 'clan-boss'),
        }));
        assert.deepEqual(recovery, {
            runId,
            title: 'Resume your Clan Boss assault',
            screen: 'clan',
            runtimeModeId: 'clan-boss',
            context: 'clan-boss',
        });
    });

    it('discovers Clan Boss after its invite expires from the durable battle marker', async () => {
        const runId = 'cboss-marker-recovery';
        const recovery = await discoverActivityTowerRecovery('hero', readers({
            readClanBossMarker: async () => ({
                kind: 'clanBoss', requestId: 'request_1234', runId, startedAt: 1,
            }),
            readSession: async () => towerSession(runId, 'clan-boss'),
        }));
        assert.equal(recovery?.runId, runId);
        assert.equal(recovery?.runtimeModeId, 'clan-boss');
    });

    it('includes terminal unsettled evidence but excludes settled sessions', async () => {
        const runId = 'tower-unsettled';
        const base = readers({ readLease: async () => lease(runId) });
        const pending = await discoverActivityTowerRecovery('hero', {
            ...base,
            readSession: async () => towerSession(runId, 'story', { status: 'done', winner: 'squad', rewardSettlementState: 'pending' }),
        });
        assert.equal(pending?.runId, runId);

        const settled = await discoverActivityTowerRecovery('hero', {
            ...base,
            readSession: async () => towerSession(runId, 'story', { status: 'done', winner: 'squad', rewardSettlementState: 'settled' }),
        });
        assert.equal(settled, null);
    });

    it('requires exact live-human squad ownership', async () => {
        const runId = 'tower-owned';
        assert.equal(isOwnedRecoverableTowerSession(towerSession(runId), 'hero'), true);
        for (const actor of [
            human('other'),
            human('hero', { ai: true }),
            human('hero', { side: 'enemy' }),
            human('hero', { ownerSlug: null }),
        ]) {
            const recovery = await discoverActivityTowerRecovery('hero', readers({
                readLease: async () => lease(runId),
                readSession: async () => towerSession(runId, 'story', { actors: [actor] }),
            }));
            assert.equal(recovery, null);
        }
    });

    it('never treats an MPvP lease or an unrelated embedded session as PvE recovery', async () => {
        let sessionReads = 0;
        const pvp = await discoverActivityTowerRecovery('hero', readers({
            readLease: async () => lease('tower-pvp-match', 'mpvp'),
            readInvite: async () => 'tower-stale-invite',
            readSession: async () => {
                sessionReads += 1;
                return towerSession('tower-stale-invite');
            },
        }));
        assert.equal(pvp, null);
        assert.equal(sessionReads, 0);

        const embeddedRun = 'mission-tower-engine';
        const embedded = await discoverActivityTowerRecovery('hero', readers({
            readLease: async () => lease(embeddedRun),
            readSession: async () => towerSession(embeddedRun, 'embedded'),
        }));
        assert.equal(embedded, null);
    });

    it('fails closed on pointer or session storage uncertainty', async () => {
        await assert.rejects(
            discoverActivityTowerRecovery('hero', readers({
                readLease: async () => { throw new Error('lease store unavailable'); },
            })),
            /lease store unavailable/,
        );

        const runId = 'tower-read-error';
        await assert.rejects(
            discoverActivityTowerRecovery('hero', readers({
                readLease: async () => lease(runId),
                readSession: async () => { throw new Error('session store unavailable'); },
            })),
            /session store unavailable/,
        );
    });

    it('rejects malformed pointers without probing arbitrary storage keys', async () => {
        let reads = 0;
        const recovery = await discoverActivityTowerRecovery('hero', readers({
            readClanBossMarker: async () => ({ kind: 'clanBoss', requestId: 'short', runId: 'cboss-ok', startedAt: 1 }),
            readInvite: async () => '../not-a-run',
            readSession: async () => { reads += 1; return null; },
        }));
        assert.equal(recovery, null);
        assert.equal(reads, 0);
    });
});
