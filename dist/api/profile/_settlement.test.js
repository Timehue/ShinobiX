"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const _settlement_js_1 = require("./_settlement.js");
function character(overrides = {}) {
    return {
        name: 'rill',
        fateShards: 100,
        unspentStats: 5,
        stats: Object.fromEntries(_settlement_js_1.PROFILE_STAT_KEYS.map((key) => [key, 10])),
        ...overrides,
    };
}
(0, node_test_1.default)('stat respec refunds only allocated points and debits the stored shard balance', () => {
    const input = character({
        stats: { ...character().stats, strength: 25, speed: 13 },
    });
    const out = (0, _settlement_js_1.applyProfileSettlement)(input, { type: 'respec-stats' });
    strict_1.default.equal(out.ok, true);
    if (!out.ok)
        return;
    strict_1.default.equal(out.cost, 50);
    strict_1.default.equal(out.character.fateShards, 50);
    strict_1.default.equal(out.character.unspentStats, 23);
    strict_1.default.deepEqual(out.character.stats, Object.fromEntries(_settlement_js_1.PROFILE_STAT_KEYS.map((key) => [key, 10])));
    strict_1.default.equal(input.stats.strength, 25, 'input remains immutable');
});
(0, node_test_1.default)('stat respec fails closed for malformed state, base stats, and insufficient shards', () => {
    strict_1.default.deepEqual((0, _settlement_js_1.applyProfileSettlement)(character({ stats: { strength: 20 } }), { type: 'respec-stats' }), { ok: false, status: 409, error: 'Stored stats are invalid. Contact support.' });
    const base = (0, _settlement_js_1.applyProfileSettlement)(character(), { type: 'respec-stats' });
    strict_1.default.equal(base.ok, false);
    if (!base.ok)
        strict_1.default.equal(base.status, 400);
    const poor = (0, _settlement_js_1.applyProfileSettlement)(character({
        fateShards: 49,
        stats: { ...character().stats, strength: 11 },
    }), { type: 'respec-stats' });
    strict_1.default.equal(poor.ok, false);
    if (!poor.ok)
        strict_1.default.match(poor.error, /50 Fate Shards/);
});
(0, node_test_1.default)('paid title text is moderated, capped, idempotent, and server-debited', () => {
    const bought = (0, _settlement_js_1.applyProfileSettlement)(character(), { type: 'purchase-title', title: '  Shadow Walker Long Name  ' });
    strict_1.default.equal(bought.ok, true);
    if (!bought.ok)
        return;
    strict_1.default.equal(bought.character.customTitle, 'Shadow Walker L');
    strict_1.default.equal(bought.character.fateShards, 90);
    const replay = (0, _settlement_js_1.applyProfileSettlement)(bought.character, { type: 'purchase-title', title: 'Shadow Walker L' });
    strict_1.default.equal(replay.ok, true);
    if (replay.ok) {
        strict_1.default.equal(replay.changed, false);
        strict_1.default.equal(replay.cost, 0);
        strict_1.default.equal(replay.character.fateShards, 90);
    }
    const reserved = (0, _settlement_js_1.applyProfileSettlement)(character(), { type: 'purchase-title', title: 'Server Admin' });
    strict_1.default.equal(reserved.ok, false);
    const earned = (0, _settlement_js_1.applyProfileSettlement)(character(), { type: 'purchase-title', title: 'Warlord' });
    strict_1.default.equal(earned.ok, false);
});
(0, node_test_1.default)('paid title style and icon accept only canonical non-default values', () => {
    const styled = (0, _settlement_js_1.applyProfileSettlement)(character(), { type: 'purchase-title-style', styleId: 'frost' });
    strict_1.default.equal(styled.ok, true);
    if (!styled.ok)
        return;
    strict_1.default.equal(styled.character.fateShards, 60);
    strict_1.default.equal(styled.character.customTitleStyle, 'frost');
    const icon = (0, _settlement_js_1.applyProfileSettlement)(character(), { type: 'purchase-title-icon', icon: '⭐' });
    strict_1.default.equal(icon.ok, true);
    if (icon.ok)
        strict_1.default.equal(icon.character.fateShards, 75);
    strict_1.default.equal((0, _settlement_js_1.applyProfileSettlement)(character(), { type: 'purchase-title-style', styleId: '' }).ok, false);
    strict_1.default.equal((0, _settlement_js_1.applyProfileSettlement)(character(), { type: 'purchase-title-icon', icon: 'not-an-icon' }).ok, false);
});
(0, node_test_1.default)('request parser rejects incomplete and unknown actions', () => {
    strict_1.default.deepEqual((0, _settlement_js_1.parseProfileSettlementAction)({ type: 'respec-stats', title: 'ignored' }), { type: 'respec-stats' });
    strict_1.default.equal((0, _settlement_js_1.parseProfileSettlementAction)({ type: 'purchase-title' }), null);
    strict_1.default.equal((0, _settlement_js_1.parseProfileSettlementAction)({ type: 'unknown' }), null);
    strict_1.default.equal((0, _settlement_js_1.parseProfileSettlementAction)(null), null);
});
(0, node_test_1.default)('handler and client preserve the locked authoritative boundary', () => {
    const handler = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'profile', 'settle.ts'), 'utf8');
    const client = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'shinobij.client', 'src', 'lib', 'profile-settlement.ts'), 'utf8');
    const screen = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'shinobij.client', 'src', 'screens', 'Profile.tsx'), 'utf8');
    strict_1.default.match(handler, /await authedPlayer\(req, playerName\)/);
    strict_1.default.match(handler, /await mutatePlayerSave\(playerName/);
    strict_1.default.match(handler, /enforceRateLimitKv[\s\S]+strict: true/);
    strict_1.default.match(client, /fetch\('\/api\/profile\/settle'/);
    strict_1.default.match(screen, /updateCharacter\(result\.character\)/);
    strict_1.default.doesNotMatch(screen, /stats: baseStats\(\)/);
});
