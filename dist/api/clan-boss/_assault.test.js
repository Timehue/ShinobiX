"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Clan-boss assault: server-trusted result extraction from a finished tower
 * session, plus the cross-module consistency pin (CLAN_BOSSES ↔ CLAN_BOSS_FLOORS ↔
 * enemy templates) so a boss can never reference a missing floor or template.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _assault_js_1 = require("./_assault.js");
const _storage_js_1 = require("./_storage.js");
const _floor_catalog_js_1 = require("../towers/_floor-catalog.js");
const _enemy_templates_js_1 = require("../towers/_enemy-templates.js");
function mkSession(opts) {
    const actors = [
        { id: 'boss', side: 'enemy', hp: opts.bossHp, maxHp: opts.bossMaxHp },
        ...opts.squadHps.map((hp, i) => ({ id: `sq-${i}`, side: 'squad', hp, maxHp: 1000 })),
    ];
    return {
        phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] },
        actors, winner: opts.winner, round: opts.round,
    };
}
(0, node_test_1.describe)('extractAssaultResult', () => {
    (0, node_test_1.it)('a clean kill banks full boss HP, no wipe, clean=true', () => {
        const r = (0, _assault_js_1.extractAssaultResult)(mkSession({ bossHp: 0, bossMaxHp: 5000, squadHps: [800, 700, 900], winner: 'squad', round: 15 }));
        node_assert_1.strict.deepEqual(r, { won: true, damage: 5000, rounds: 15, wiped: false, clean: true });
    });
    (0, node_test_1.it)('a timeout (squad alive, boss not dead) banks partial damage, not a wipe, not clean', () => {
        const r = (0, _assault_js_1.extractAssaultResult)(mkSession({ bossHp: 2000, bossMaxHp: 5000, squadHps: [100, 0, 300], winner: 'enemy', round: 25 }));
        node_assert_1.strict.equal(r.won, false);
        node_assert_1.strict.equal(r.damage, 3000);
        node_assert_1.strict.equal(r.wiped, false); // someone is still standing
        node_assert_1.strict.equal(r.clean, false);
    });
    (0, node_test_1.it)('a full wipe (whole party down) is a wipe', () => {
        const r = (0, _assault_js_1.extractAssaultResult)(mkSession({ bossHp: 3000, bossMaxHp: 5000, squadHps: [0, 0, 0], winner: 'enemy', round: 12 }));
        node_assert_1.strict.equal(r.won, false);
        node_assert_1.strict.equal(r.damage, 2000);
        node_assert_1.strict.equal(r.wiped, true);
    });
    (0, node_test_1.it)('a win with a downed member is NOT clean', () => {
        const r = (0, _assault_js_1.extractAssaultResult)(mkSession({ bossHp: 0, bossMaxHp: 5000, squadHps: [500, 0, 400], winner: 'squad', round: 18 }));
        node_assert_1.strict.equal(r.won, true);
        node_assert_1.strict.equal(r.clean, false);
    });
});
(0, node_test_1.describe)('clan-boss content consistency', () => {
    (0, node_test_1.it)('CLAN_BOSSES and CLAN_BOSS_FLOORS are index-aligned by floorId + mechanic', () => {
        node_assert_1.strict.equal(_storage_js_1.CLAN_BOSSES.length, _floor_catalog_js_1.CLAN_BOSS_FLOORS.length);
        _storage_js_1.CLAN_BOSSES.forEach((b, i) => {
            const floor = _floor_catalog_js_1.CLAN_BOSS_FLOORS[i];
            node_assert_1.strict.equal(b.floorId, floor.id, `${b.id} floorId`);
            node_assert_1.strict.equal(b.mechanic, floor.boss?.mechanic, `${b.id} mechanic`);
        });
    });
    (0, node_test_1.it)('every clan-boss floor references real enemy/boss/summon templates', () => {
        for (const floor of _floor_catalog_js_1.CLAN_BOSS_FLOORS) {
            node_assert_1.strict.ok((0, _enemy_templates_js_1.hasEnemyTemplate)(floor.boss.aiId), `boss template ${floor.boss.aiId}`);
            for (const pod of floor.enemies)
                node_assert_1.strict.ok((0, _enemy_templates_js_1.hasEnemyTemplate)(pod.aiId), `enemy template ${pod.aiId}`);
            if (floor.boss?.summonAiId)
                node_assert_1.strict.ok((0, _enemy_templates_js_1.hasEnemyTemplate)(floor.boss.summonAiId), `summon template ${floor.boss.summonAiId}`);
        }
    });
});
