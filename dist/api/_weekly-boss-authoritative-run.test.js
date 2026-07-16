"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _weekly_boss_authoritative_run_js_1 = require("./_weekly-boss-authoritative-run.js");
const run = {
    runId: 'weekly-1', playerName: 'player', weekKey: '2026-W29', aiId: 'oni',
    bossStartedAt: 100, initialBossHp: 99_999_999, createdAt: 101,
};
const session = {
    status: 'done',
    phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] },
    actors: [
        { id: 'sq-0', side: 'squad', ownerSlug: 'player' },
        { id: 'boss', side: 'enemy', ownerSlug: null, hp: 99_998_765 },
    ],
};
const boss = { weekKey: '2026-W29', aiId: 'oni', startedAt: 100 };
function reasonOf(result) {
    node_assert_1.strict.equal(result.ok, false);
    return result.ok ? 'unexpected-success' : result.reason;
}
(0, node_test_1.describe)('authoritative Weekly Boss run validation', () => {
    (0, node_test_1.it)('derives contribution only from server session HP', () => {
        node_assert_1.strict.deepEqual((0, _weekly_boss_authoritative_run_js_1.validateAuthoritativeWeeklyBossRun)({ run, session, playerName: 'player', boss }), { ok: true, damage: 1234 });
    });
    (0, node_test_1.it)('rejects wrong accounts, unfinished sessions, stale bosses, and replay', () => {
        node_assert_1.strict.equal(reasonOf((0, _weekly_boss_authoritative_run_js_1.validateAuthoritativeWeeklyBossRun)({ run, session, playerName: 'other', boss })), 'wrong-player');
        node_assert_1.strict.equal(reasonOf((0, _weekly_boss_authoritative_run_js_1.validateAuthoritativeWeeklyBossRun)({ run, session: { ...session, status: 'active' }, playerName: 'player', boss })), 'not-finished');
        node_assert_1.strict.equal(reasonOf((0, _weekly_boss_authoritative_run_js_1.validateAuthoritativeWeeklyBossRun)({ run, session, playerName: 'player', boss: { ...boss, startedAt: 999 } })), 'stale-boss');
        node_assert_1.strict.equal(reasonOf((0, _weekly_boss_authoritative_run_js_1.validateAuthoritativeWeeklyBossRun)({ run: { ...run, settledAt: 200 }, session, playerName: 'player', boss })), 'already-settled');
    });
    (0, node_test_1.it)('rejects membership and boss-actor mismatches', () => {
        node_assert_1.strict.equal(reasonOf((0, _weekly_boss_authoritative_run_js_1.validateAuthoritativeWeeklyBossRun)({ run, session: { ...session, actors: session.actors.filter((a) => a.side !== 'squad') }, playerName: 'player', boss })), 'not-a-member');
        node_assert_1.strict.equal(reasonOf((0, _weekly_boss_authoritative_run_js_1.validateAuthoritativeWeeklyBossRun)({ run, session: { ...session, actors: session.actors.filter((a) => a.id !== 'boss') }, playerName: 'player', boss })), 'missing-boss');
    });
});
