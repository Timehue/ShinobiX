"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _name__js_1 = require("./[name].js");
const _jutsu_points_js_1 = require("../_jutsu-points.js");
const mkBloodline = (id = 'bl-forged', rank = 'S Rank') => ({
    id, name: 'Forged', rank, totalPoints: 99,
    // 5 jutsu x {Copy 3, Mirror 3, Stun 2} = 40 points.
    jutsus: Array.from({ length: 5 }, (_, i) => ({
        id: `${id}-${i}`, name: 'X', type: 'Ninjutsu', ap: 60, range: 4, effectPower: 50, cooldown: 7,
        tags: [{ name: 'Copy' }, { name: 'Mirror' }, { name: 'Stun' }],
    })),
});
const incoming = (bloodlines, extra = {}) => ({
    character: { name: 'Tester', level: 50 },
    savedBloodlines: bloodlines,
    ...extra,
});
const stored = (bloodlines = [], pendingBloodlineForges = []) => ({
    character: { name: 'Tester', level: 50 },
    savedBloodlines: bloodlines,
    pendingBloodlineForges,
});
const entitlement = (rank, id = '12345678-1234-1234-1234-123456789abc') => ({
    id, rank, issuedAt: 1_750_000_000_000,
});
(0, node_test_1.test)('new bloodline without a server forge entitlement is discarded', () => {
    const out = (0, _name__js_1.sanitizeCharacterSave)(incoming([mkBloodline()]), stored());
    strict_1.default.deepEqual(out.savedBloodlines, []);
});
(0, node_test_1.test)('incoming payload cannot forge its own pending entitlement', () => {
    const forged = entitlement('S Rank');
    const out = (0, _name__js_1.sanitizeCharacterSave)(incoming([mkBloodline()], { pendingBloodlineForges: [forged] }), stored());
    strict_1.default.deepEqual(out.savedBloodlines, []);
    strict_1.default.deepEqual(out.pendingBloodlineForges, []);
});
(0, node_test_1.test)('exact-rank server entitlement accepts one new bloodline, consumes purchase, and applies point budget', () => {
    const out = (0, _name__js_1.sanitizeCharacterSave)(incoming([mkBloodline('bl-paid', 'S Rank')]), stored([], [entitlement('S Rank')]));
    const bloodlines = out.savedBloodlines;
    strict_1.default.equal(bloodlines.length, 1);
    strict_1.default.equal(bloodlines[0].rank, 'S Rank');
    strict_1.default.ok((0, _jutsu_points_js_1.bloodlinePoints)(bloodlines[0].jutsus, 'S Rank') <= 11);
    strict_1.default.deepEqual(out.pendingBloodlineForges, []);
});
(0, node_test_1.test)('forge entitlement is rank-specific and remains pending after a mismatched attempt', () => {
    const pending = entitlement('A Rank');
    const out = (0, _name__js_1.sanitizeCharacterSave)(incoming([mkBloodline('bl-wrong-rank', 'S Rank')]), stored([], [pending]));
    strict_1.default.deepEqual(out.savedBloodlines, []);
    strict_1.default.deepEqual(out.pendingBloodlineForges, [pending]);
});
(0, node_test_1.test)('existing A-rank id is grandfathered but cannot self-promote to S', () => {
    const existing = mkBloodline('bl-existing', 'A Rank');
    const out = (0, _name__js_1.sanitizeCharacterSave)(incoming([mkBloodline('bl-existing', 'S Rank')]), stored([existing]));
    const bloodline = out.savedBloodlines[0];
    strict_1.default.equal(bloodline.rank, 'A Rank');
    strict_1.default.ok((0, _jutsu_points_js_1.bloodlinePoints)(bloodline.jutsus, 'A Rank') <= 10);
});
(0, node_test_1.test)('one entitlement cannot authorize two new bloodline ids', () => {
    const out = (0, _name__js_1.sanitizeCharacterSave)(incoming([mkBloodline('bl-one', 'B Rank'), mkBloodline('bl-two', 'B Rank')]), stored([], [entitlement('B Rank')]));
    strict_1.default.deepEqual(out.savedBloodlines.map((bl) => bl.id), ['bl-one']);
    strict_1.default.deepEqual(out.pendingBloodlineForges, []);
});
