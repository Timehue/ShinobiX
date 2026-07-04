/**
 * Clan-boss assault: server-trusted result extraction from a finished tower
 * session, plus the cross-module consistency pin (CLAN_BOSSES ↔ CLAN_BOSS_FLOORS ↔
 * enemy templates) so a boss can never reference a missing floor or template.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { TowerSession } from '../towers/_tower-session.js';
import { extractAssaultResult } from './_assault.js';
import { CLAN_BOSSES } from './_storage.js';
import { CLAN_BOSS_FLOORS } from '../towers/_floor-catalog.js';
import { hasEnemyTemplate } from '../towers/_enemy-templates.js';

function mkSession(opts: {
    bossHp: number; bossMaxHp: number; squadHps: number[];
    winner: TowerSession['winner']; round: number;
}): TowerSession {
    const actors = [
        { id: 'boss', side: 'enemy', hp: opts.bossHp, maxHp: opts.bossMaxHp },
        ...opts.squadHps.map((hp, i) => ({ id: `sq-${i}`, side: 'squad', hp, maxHp: 1000 })),
    ];
    return {
        phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] },
        actors, winner: opts.winner, round: opts.round,
    } as unknown as TowerSession;
}

describe('extractAssaultResult', () => {
    it('a clean kill banks full boss HP, no wipe, clean=true', () => {
        const r = extractAssaultResult(mkSession({ bossHp: 0, bossMaxHp: 5000, squadHps: [800, 700, 900], winner: 'squad', round: 15 }));
        assert.deepEqual(r, { won: true, damage: 5000, rounds: 15, wiped: false, clean: true });
    });
    it('a timeout (squad alive, boss not dead) banks partial damage, not a wipe, not clean', () => {
        const r = extractAssaultResult(mkSession({ bossHp: 2000, bossMaxHp: 5000, squadHps: [100, 0, 300], winner: 'enemy', round: 25 }));
        assert.equal(r.won, false);
        assert.equal(r.damage, 3000);
        assert.equal(r.wiped, false);   // someone is still standing
        assert.equal(r.clean, false);
    });
    it('a full wipe (whole party down) is a wipe', () => {
        const r = extractAssaultResult(mkSession({ bossHp: 3000, bossMaxHp: 5000, squadHps: [0, 0, 0], winner: 'enemy', round: 12 }));
        assert.equal(r.won, false);
        assert.equal(r.damage, 2000);
        assert.equal(r.wiped, true);
    });
    it('a win with a downed member is NOT clean', () => {
        const r = extractAssaultResult(mkSession({ bossHp: 0, bossMaxHp: 5000, squadHps: [500, 0, 400], winner: 'squad', round: 18 }));
        assert.equal(r.won, true);
        assert.equal(r.clean, false);
    });
});

describe('clan-boss content consistency', () => {
    it('CLAN_BOSSES and CLAN_BOSS_FLOORS are index-aligned by floorId + mechanic', () => {
        assert.equal(CLAN_BOSSES.length, CLAN_BOSS_FLOORS.length);
        CLAN_BOSSES.forEach((b, i) => {
            const floor = CLAN_BOSS_FLOORS[i]!;
            assert.equal(b.floorId, floor.id, `${b.id} floorId`);
            assert.equal(b.mechanic, floor.boss?.mechanic, `${b.id} mechanic`);
        });
    });
    it('every clan-boss floor references real enemy/boss/summon templates', () => {
        for (const floor of CLAN_BOSS_FLOORS) {
            assert.ok(hasEnemyTemplate(floor.boss!.aiId), `boss template ${floor.boss!.aiId}`);
            for (const pod of floor.enemies) assert.ok(hasEnemyTemplate(pod.aiId), `enemy template ${pod.aiId}`);
            if (floor.boss?.summonAiId) assert.ok(hasEnemyTemplate(floor.boss.summonAiId), `summon template ${floor.boss.summonAiId}`);
        }
    });
});
