"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const presence_gating_js_1 = require("./presence-gating.js");
const NOW = 1_000_000;
function player(over = {}) {
    return {
        name: 'target', displayName: 'Target', sector: 40, character: null,
        lastSeenAt: NOW, connectedAt: NOW, pendingAttacker: null,
        ...over,
    };
}
(0, node_test_1.test)('attackBlock: offline target → 404', () => {
    strict_1.default.deepEqual((0, presence_gating_js_1.attackBlock)(null, NOW), { status: 404, error: 'Target not online.' });
});
(0, node_test_1.test)('attackBlock: online & idle → allowed', () => {
    strict_1.default.equal((0, presence_gating_js_1.attackBlock)(player(), NOW), null);
});
(0, node_test_1.test)('attackBlock: traveling → 409', () => {
    const b = (0, presence_gating_js_1.attackBlock)(player({ travelingUntil: NOW + 5_000 }), NOW);
    strict_1.default.equal(b?.status, 409);
    strict_1.default.match(b.error, /traveling/i);
});
(0, node_test_1.test)('attackBlock: expired travel window does NOT block', () => {
    strict_1.default.equal((0, presence_gating_js_1.attackBlock)(player({ travelingUntil: NOW - 1 }), NOW), null);
});
(0, node_test_1.test)('attackBlock: already has pendingAttacker → 409', () => {
    strict_1.default.equal((0, presence_gating_js_1.attackBlock)(player({ pendingAttacker: { name: 'x' } }), NOW)?.status, 409);
});
(0, node_test_1.test)('attackBlock: inBattle → 409', () => {
    strict_1.default.equal((0, presence_gating_js_1.attackBlock)(player({ inBattle: true }), NOW)?.status, 409);
});
(0, node_test_1.test)('attackBlock: sub-Genin (level < 15) → 403 Academy protection', () => {
    const b = (0, presence_gating_js_1.attackBlock)(player({ character: { level: 10 } }), NOW);
    strict_1.default.equal(b?.status, 403);
    strict_1.default.match(b.error, /Academy/i);
});
(0, node_test_1.test)('attackBlock: Genin (level 15) is NOT Academy-protected', () => {
    strict_1.default.equal((0, presence_gating_js_1.attackBlock)(player({ character: { level: 15 } }), NOW), null);
});
(0, node_test_1.test)('attackBlock: unknown level (0 / missing) does NOT block', () => {
    strict_1.default.equal((0, presence_gating_js_1.attackBlock)(player({ character: { level: 0 } }), NOW), null);
    strict_1.default.equal((0, presence_gating_js_1.attackBlock)(player({ character: {} }), NOW), null);
});
(0, node_test_1.test)('challengeBlock: offline target is NOT blocked (queued)', () => {
    strict_1.default.equal((0, presence_gating_js_1.challengeBlock)(null, undefined, NOW), null);
});
(0, node_test_1.test)('challengeBlock: idle online → allowed', () => {
    strict_1.default.equal((0, presence_gating_js_1.challengeBlock)(player(), undefined, NOW), null);
});
(0, node_test_1.test)('challengeBlock: traveling / inBattle / engaged → 409 with reason', () => {
    const travel = (0, presence_gating_js_1.challengeBlock)(player({ travelingUntil: NOW + 1 }), undefined, NOW);
    strict_1.default.equal(travel?.status, 409);
    strict_1.default.match(travel.error, /traveling/i);
    const battle = (0, presence_gating_js_1.challengeBlock)(player({ inBattle: true }), undefined, NOW);
    strict_1.default.equal(battle?.status, 409);
    strict_1.default.match(battle.error, /battle/i);
    const engaged = (0, presence_gating_js_1.challengeBlock)(player({ pendingAttacker: {} }), undefined, NOW);
    strict_1.default.equal(engaged?.status, 409);
    strict_1.default.match(engaged.error, /engaged/i);
});
(0, node_test_1.test)('challengeBlock: sub-Genin (level < 15), no/ladder mode → 403 Academy protection', () => {
    // Default (no mode) and competitive ladders keep the sub-Genin gate.
    for (const mode of [undefined, 'ranked', 'clanWar1v1', 'clanWar2v2']) {
        const b = (0, presence_gating_js_1.challengeBlock)(player({ character: { level: 10 } }), mode, NOW);
        strict_1.default.equal(b?.status, 403, `mode=${mode} should still 403`);
        strict_1.default.match(b.error, /Academy/i);
    }
});
(0, node_test_1.test)('challengeBlock: sub-Genin + spar/pet modes → allowed (consensual, exempt)', () => {
    // Spars and pet battles bypass Academy protection at any level.
    for (const mode of ['standard', 'clanWarPet', 'rankedPet']) {
        strict_1.default.equal((0, presence_gating_js_1.challengeBlock)(player({ character: { level: 1 } }), mode, NOW), null, `mode=${mode} should be allowed`);
    }
});
(0, node_test_1.test)('challengeBlock: travel/battle 409 still applies even for exempt spar/pet modes', () => {
    // The mode exemption only skips the Academy gate — it never overrides the
    // traveling / in-battle / engaged 409s.
    const travel = (0, presence_gating_js_1.challengeBlock)(player({ character: { level: 1 }, travelingUntil: NOW + 1 }), 'standard', NOW);
    strict_1.default.equal(travel?.status, 409);
    const battle = (0, presence_gating_js_1.challengeBlock)(player({ character: { level: 1 }, inBattle: true }), 'clanWarPet', NOW);
    strict_1.default.equal(battle?.status, 409);
});
(0, node_test_1.test)('challengeBlock: Genin (level 15) is NOT Academy-protected', () => {
    strict_1.default.equal((0, presence_gating_js_1.challengeBlock)(player({ character: { level: 15 } }), 'ranked', NOW), null);
});
(0, node_test_1.test)('sessionOpponentBlock: offline opponent → allowed (optimistic / queued)', () => {
    strict_1.default.equal((0, presence_gating_js_1.sessionOpponentBlock)(null, 'me', NOW), null);
});
(0, node_test_1.test)('sessionOpponentBlock: idle online opponent → allowed', () => {
    strict_1.default.equal((0, presence_gating_js_1.sessionOpponentBlock)(player(), 'me', NOW), null);
});
(0, node_test_1.test)('sessionOpponentBlock: traveling → 409', () => {
    const b = (0, presence_gating_js_1.sessionOpponentBlock)(player({ travelingUntil: NOW + 5_000 }), 'me', NOW);
    strict_1.default.equal(b?.status, 409);
    strict_1.default.match(b.error, /traveling/i);
});
(0, node_test_1.test)('sessionOpponentBlock: already in a battle → 409', () => {
    strict_1.default.equal((0, presence_gating_js_1.sessionOpponentBlock)(player({ inBattle: true }), 'me', NOW)?.status, 409);
});
(0, node_test_1.test)('sessionOpponentBlock: engaged by ANOTHER player → 409', () => {
    const b = (0, presence_gating_js_1.sessionOpponentBlock)(player({ pendingAttacker: { name: 'Rival' } }), 'me', NOW);
    strict_1.default.equal(b?.status, 409);
    strict_1.default.match(b.error, /engaged/i);
});
(0, node_test_1.test)('sessionOpponentBlock: engaged by the CALLER themselves → allowed (attack→session flow)', () => {
    // caller display "Aka Ito" → slug "akaito"; pendingAttacker stores the display name.
    strict_1.default.equal((0, presence_gating_js_1.sessionOpponentBlock)(player({ pendingAttacker: { name: 'Aka Ito' } }), 'akaito', NOW), null);
});
(0, node_test_1.test)('sessionOpponentBlock: no Academy gate — sub-Genin opponent allowed', () => {
    strict_1.default.equal((0, presence_gating_js_1.sessionOpponentBlock)(player({ character: { level: 3 } }), 'me', NOW), null);
});
