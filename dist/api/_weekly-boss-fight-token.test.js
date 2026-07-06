"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _weekly_boss_fight_token_js_1 = require("./_weekly-boss-fight-token.js");
const token = {
    playerName: 'Player',
    weekKey: '2026-W27',
    aiId: 'ashen-dragon',
    bossStartedAt: 123,
    maxDamage: 5000,
    perHitCap: 100,
    maxHits: 10,
    mintedAt: 456,
};
function reasonOf(result) {
    node_assert_1.strict.equal(result.ok, false);
    return result.reason;
}
(0, node_test_1.describe)('_weekly-boss-fight-token', () => {
    (0, node_test_1.it)('cleans and keys token ids', () => {
        node_assert_1.strict.equal((0, _weekly_boss_fight_token_js_1.cleanWeeklyBossFightToken)(' abc123 '), 'abc123');
        node_assert_1.strict.equal((0, _weekly_boss_fight_token_js_1.cleanWeeklyBossFightToken)('bad-token'), '');
        node_assert_1.strict.equal((0, _weekly_boss_fight_token_js_1.weeklyBossFightTokenKey)('Player', '2026-W27', 'abc123'), 'weekly-boss-fight:2026-W27:Player:abc123');
    });
    (0, node_test_1.it)('accepts claims inside the sealed ceiling', () => {
        node_assert_1.strict.deepEqual((0, _weekly_boss_fight_token_js_1.validateWeeklyBossFightClaim)(token, {
            playerName: 'player',
            weekKey: '2026-W27',
            aiId: 'ashen-dragon',
            bossStartedAt: 123,
        }, 4999.9), { ok: true, damage: 4999 });
    });
    (0, node_test_1.it)('cleans and validates per-hit damage proof events', () => {
        node_assert_1.strict.deepEqual((0, _weekly_boss_fight_token_js_1.cleanWeeklyBossDamageEvents)([
            { turn: 1, amount: 199.9, source: 'jutsu:fire' },
            { turn: 2, amount: 30, source: '<bad>' },
            { turn: 3, amount: 0 },
        ]), [
            { turn: 1, amount: 199, source: 'jutsu:fire' },
            { turn: 2, amount: 30 },
        ]);
        node_assert_1.strict.deepEqual((0, _weekly_boss_fight_token_js_1.validateWeeklyBossFightClaim)(token, {
            playerName: 'player',
            weekKey: '2026-W27',
            aiId: 'ashen-dragon',
            bossStartedAt: 123,
        }, 9999, [
            { turn: 1, amount: 200, source: 'open' },
            { turn: 2, amount: 30, source: 'guarded' },
        ]), { ok: true, damage: 230 });
    });
    (0, node_test_1.it)('rejects wrong player, stale boss, and over-ceiling damage', () => {
        node_assert_1.strict.equal(reasonOf((0, _weekly_boss_fight_token_js_1.validateWeeklyBossFightClaim)(token, { playerName: 'Other', weekKey: '2026-W27', aiId: 'ashen-dragon', bossStartedAt: 123 }, 1)), 'wrong-player-weekly-boss-token');
        node_assert_1.strict.equal(reasonOf((0, _weekly_boss_fight_token_js_1.validateWeeklyBossFightClaim)(token, { playerName: 'Player', weekKey: '2026-W28', aiId: 'ashen-dragon', bossStartedAt: 123 }, 1)), 'stale-weekly-boss-token');
        node_assert_1.strict.equal(reasonOf((0, _weekly_boss_fight_token_js_1.validateWeeklyBossFightClaim)(token, { playerName: 'Player', weekKey: '2026-W27', aiId: 'ashen-dragon', bossStartedAt: 123 }, 5001)), 'weekly-boss-damage-exceeds-token');
        node_assert_1.strict.equal(reasonOf((0, _weekly_boss_fight_token_js_1.validateWeeklyBossFightClaim)(token, { playerName: 'Player', weekKey: '2026-W27', aiId: 'ashen-dragon', bossStartedAt: 123 }, 1, [{ turn: 2, amount: 31 }])), 'weekly-boss-proof-hit-exceeds-cap');
    });
});
