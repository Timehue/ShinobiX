"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _seal_js_1 = require("./_seal.js");
(0, node_test_1.describe)('Battle Towers fighter sealing (P1.B)', () => {
    (0, node_test_1.it)('clamps tampered stats + vitals to the hard caps', () => {
        const sealed = (0, _seal_js_1.sealTowerFighter)({
            name: 'Cheater', level: 50, specialty: 'Ninjutsu',
            stats: { taijutsuOffense: 999999, willpower: -50 },
            maxHp: 999999, maxChakra: 999999, bloodlineMult: 99,
        });
        const stats = sealed.stats;
        node_assert_1.strict.equal(stats.taijutsuOffense, 2500);
        node_assert_1.strict.equal(stats.willpower, 0);
        node_assert_1.strict.equal(sealed.maxHp, 10000);
        node_assert_1.strict.equal(sealed.maxChakra, 5000);
        node_assert_1.strict.equal(sealed.bloodlineMult, 3);
        node_assert_1.strict.equal(sealed.specialty, 'Ninjutsu');
    });
    (0, node_test_1.it)('sanitizes the jutsu loadout (caps effectPower)', () => {
        const sealed = (0, _seal_js_1.sealTowerFighter)({ stats: {}, jutsu: [{ id: 'j1', effectPower: 999999, type: 'Ninjutsu' }] });
        const jutsu = sealed.jutsu;
        node_assert_1.strict.ok(jutsu[0].effectPower <= 600, 'effectPower clamped by sanitizeJutsuList');
    });
    (0, node_test_1.it)('strips currencies + inventory + battleTower ledgers', () => {
        const sealed = (0, _seal_js_1.sealTowerFighter)({ name: 'A', ryo: 1e9, inventory: [1, 2, 3], battleTowerClearedFloors: [1, 2, 3], stats: {} });
        node_assert_1.strict.ok(!('ryo' in sealed));
        node_assert_1.strict.ok(!('inventory' in sealed));
        node_assert_1.strict.ok(!('battleTowerClearedFloors' in sealed));
        node_assert_1.strict.equal(sealed.name, 'A');
    });
    (0, node_test_1.it)('defaults an invalid specialty to Taijutsu', () => {
        const sealed = (0, _seal_js_1.sealTowerFighter)({ specialty: 'Hacking', stats: {} });
        node_assert_1.strict.equal(sealed.specialty, 'Taijutsu');
    });
});
