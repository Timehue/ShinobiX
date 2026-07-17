"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const session_js_1 = require("./session.js");
// Regression for #1A: a non-admin browser must never (a) turn a fight against a
// fabricated no-save NPC into a base-reward battle, nor (b) self-assign the
// Death's Gate (sector 99) 2× multiplier from the request body. sealBaseRewardStamp
// is the extracted, server-side decision that seals the session's base-reward
// policy. `deathsGateVerified` is set by the handler ONLY when presence confirms
// both fighters are actually at sector 99.
const PVP = { isAdmin: false, p1HasSave: true, p2HasSave: true, deathsGateVerified: false };
(0, node_test_1.describe)('sealBaseRewardStamp — base-reward authorization', () => {
    (0, node_test_1.it)('does not stamp base rewards when they were not requested', () => {
        const r = (0, session_js_1.sealBaseRewardStamp)({ ...PVP, baseRewards: false, rewardSector: 5 });
        strict_1.default.deepEqual(r, { stamp: {}, denied: false });
    });
    (0, node_test_1.it)('DENIES base rewards against a fabricated no-save NPC opponent (non-admin)', () => {
        // Attacker is p1 (has save); p2 is an invented NPC with no save.
        const r = (0, session_js_1.sealBaseRewardStamp)({ ...PVP, baseRewards: true, rewardSector: 5, p2HasSave: false });
        strict_1.default.deepEqual(r.stamp, {}, 'no base rewards stamped');
        strict_1.default.equal(r.denied, true, 'flagged as denied so the handler logs it (not silent)');
    });
    (0, node_test_1.it)('honors base rewards for a real player-vs-player fight, preserving a normal sector', () => {
        const r = (0, session_js_1.sealBaseRewardStamp)({ ...PVP, baseRewards: true, rewardSector: 12 });
        strict_1.default.deepEqual(r.stamp, { baseRewards: true, rewardSector: 12 });
        strict_1.default.equal(r.denied, false);
    });
    (0, node_test_1.it)('neutralizes an UNVERIFIED Death’s Gate (99) to 0 for a non-admin (no 2×)', () => {
        const r = (0, session_js_1.sealBaseRewardStamp)({ ...PVP, baseRewards: true, rewardSector: 99, deathsGateVerified: false });
        strict_1.default.deepEqual(r.stamp, { baseRewards: true, rewardSector: 0 }, 'unverified 99 → no Death’s Gate 2×');
    });
    (0, node_test_1.it)('HONORS Death’s Gate (99) when the server verified both fighters are there', () => {
        const r = (0, session_js_1.sealBaseRewardStamp)({ ...PVP, baseRewards: true, rewardSector: 99, deathsGateVerified: true });
        strict_1.default.deepEqual(r.stamp, { baseRewards: true, rewardSector: 99 }, 'verified 99 → 2× restored');
    });
    (0, node_test_1.it)('neutralizes an unverified 99 supplied as a string, too', () => {
        const r = (0, session_js_1.sealBaseRewardStamp)({ ...PVP, baseRewards: true, rewardSector: '99', deathsGateVerified: false });
        strict_1.default.equal(r.stamp.rewardSector, 0);
    });
    (0, node_test_1.it)('coerces a non-finite sector to 0', () => {
        const r = (0, session_js_1.sealBaseRewardStamp)({ ...PVP, baseRewards: true, rewardSector: 'not-a-number' });
        strict_1.default.equal(r.stamp.rewardSector, 0);
    });
    (0, node_test_1.it)('admin may create a reward-bearing NPC test fight and keep sector 99 unverified', () => {
        // Admin override: no-save opponent allowed, and the full sector value
        // (incl. Death's Gate) preserved for test flows without presence.
        const r = (0, session_js_1.sealBaseRewardStamp)({ baseRewards: true, rewardSector: 99, isAdmin: true, p1HasSave: true, p2HasSave: false, deathsGateVerified: false });
        strict_1.default.deepEqual(r.stamp, { baseRewards: true, rewardSector: 99 });
        strict_1.default.equal(r.denied, false);
    });
    (0, node_test_1.it)('denies when the ATTACKER-as-p2 fights a no-save p1 NPC (order-independent)', () => {
        const r = (0, session_js_1.sealBaseRewardStamp)({ ...PVP, baseRewards: true, rewardSector: 5, p1HasSave: false });
        strict_1.default.deepEqual(r.stamp, {});
        strict_1.default.equal(r.denied, true);
    });
});
