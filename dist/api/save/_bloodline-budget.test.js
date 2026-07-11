"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _name__js_1 = require("./[name].js");
const _jutsu_points_js_1 = require("../_jutsu-points.js");
const sanitizeChar = (incoming, existing) => (0, _name__js_1.sanitizeCharacterSave)({ character: incoming }, existing ? { character: existing } : null).character;
const mkForgedBloodline = () => ({
    id: 'bl-forged', name: 'Forged', rank: 'S Rank', totalPoints: 99,
    // 5 jutsu x {Copy 3, Mirror 3, Stun 2} = 40 pts, vs a B-rank budget of 7.
    jutsus: Array.from({ length: 5 }, (_, i) => ({
        id: `bf-${i}`, name: 'X', type: 'Ninjutsu', ap: 60, range: 4, effectPower: 50, cooldown: 7,
        tags: [{ name: 'Copy' }, { name: 'Mirror' }, { name: 'Stun' }],
    })),
});
const mkChar = () => ({ name: 'Tester', level: 50, savedBloodlines: [mkForgedBloodline()] });
/** Run with the retired env flags explicitly CLEARED — enforcement must not depend on them. */
function withFlagsCleared(fn) {
    const keys = ['BLOODLINE_RANK_ENTITLEMENT', 'BLOODLINE_BUDGET_SERVER'];
    const prev = keys.map((k) => process.env[k]);
    keys.forEach((k) => { delete process.env[k]; });
    try {
        fn();
    }
    finally {
        keys.forEach((k, i) => { if (prev[i] === undefined)
            delete process.env[k];
        else
            process.env[k] = prev[i]; });
    }
}
(0, node_test_1.test)('enforcement is permanent: env flags cleared, forged S-rank + over-budget tags are STILL clamped', () => {
    withFlagsCleared(() => {
        const bl = sanitizeChar(mkChar(), null).savedBloodlines[0];
        strict_1.default.equal(bl.rank, 'B Rank', 'forged rank must clamp even with the retired env flags unset');
        strict_1.default.ok((0, _jutsu_points_js_1.bloodlinePoints)(bl.jutsus, 'B Rank') <= 7, 'over-budget tags must strip even with the retired env flags unset');
    });
});
(0, node_test_1.test)('new bloodline clamps rank to B (entitlement) + strips tags to budget, never rejected', () => {
    withFlagsCleared(() => {
        const c = sanitizeChar(mkChar(), null);
        strict_1.default.ok(Array.isArray(c.savedBloodlines), 'save was not rejected');
        const bl = c.savedBloodlines[0];
        strict_1.default.equal(bl.rank, 'B Rank', 'forged S clamped to B (no prior entitlement)');
        strict_1.default.equal(bl.jutsus.length, 5, 'jutsu are never dropped — only tags');
        strict_1.default.ok((0, _jutsu_points_js_1.bloodlinePoints)(bl.jutsus, 'B Rank') <= 7, 'clamped within the B-rank budget');
    });
});
(0, node_test_1.test)('an existing A-rank entitlement is preserved (claimed S clamped DOWN to A)', () => {
    withFlagsCleared(() => {
        const existing = { savedBloodlines: [{ id: 'bl-forged', name: 'Forged', rank: 'A Rank', jutsus: [], totalPoints: 0 }] };
        const bl = sanitizeChar(mkChar(), existing).savedBloodlines[0];
        strict_1.default.equal(bl.rank, 'A Rank', 'rank only goes DOWN to the stored entitlement, never up to the claimed S');
        strict_1.default.ok((0, _jutsu_points_js_1.bloodlinePoints)(bl.jutsus, 'A Rank') <= 10, 'clamped within the A-rank budget');
    });
});
