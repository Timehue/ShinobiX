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
    (0, node_test_1.it)('RESOLVES the equipped loadout from equippedJutsuIds (the empty-jutsu-bar fix)', () => {
        // A real save has NO `jutsu` array — only equippedJutsuIds. The old direct
        // sanitizeJutsuList(saveChar.jutsu) produced an empty loadout (no castable jutsu).
        const sealed = (0, _seal_js_1.sealTowerFighter)({ name: 'Hero', stats: {}, equippedJutsuIds: ['ashen-eyes-blood-gaze'] }, { character: { equippedJutsuIds: ['ashen-eyes-blood-gaze'] } });
        const jutsu = sealed.jutsu;
        node_assert_1.strict.ok(Array.isArray(jutsu) && jutsu.length === 1, 'equipped jutsu resolved from the catalog');
        node_assert_1.strict.equal(jutsu[0].id, 'ashen-eyes-blood-gaze');
        node_assert_1.strict.ok(jutsu[0].chakraCost > 0, 'catalog jutsu carries its real chakra cost');
    });
    (0, node_test_1.it)('seals client-supplied pvpItems + equipment passives the save does NOT persist', () => {
        // pvpItems + bloodlineMult/armor/itemDamagePct are computed client-side at fight time
        // (the save lacks them) — the host sends them; the seal must fill + clamp them.
        const sealed = (0, _seal_js_1.sealTowerFighter)({ name: 'Hero', stats: {} }, // save character — no items / passives
        { character: {} }, // save record
        { pvpItems: [{ id: 'kunai', name: 'Kunai', slot: 'thrown', weaponEp: 20 }], bloodlineMult: 2, armorRawDR: 0.8, itemDamagePct: 50 });
        node_assert_1.strict.equal(sealed.bloodlineMult, 2, 'client bloodlineMult sealed');
        node_assert_1.strict.equal(sealed.itemDamagePct, 50, 'client itemDamagePct sealed');
        node_assert_1.strict.ok(sealed.armorRawDR > 0, 'client armorRawDR sealed');
        node_assert_1.strict.ok(Array.isArray(sealed.pvpItems) && sealed.pvpItems.length === 1, 'client pvpItems sealed');
    });
    (0, node_test_1.it)('seals a per-fight consumable budget capped by owned count', () => {
        const charges = (0, _seal_js_1.sealTowerItemCharges)({
            equipment: { thrown: 'shuriken', potion: 'rejuvenation-potion' },
            itemStacks: [{ itemId: 'shuriken', count: 5 }, { itemId: 'rejuvenation-potion', count: 9 }],
        });
        node_assert_1.strict.equal(charges['shuriken'], 5, 'thrown weapon charges = owned count');
        node_assert_1.strict.equal(charges['rejuvenation-potion'], 2, 'potion capped at 2/fight');
    });
});
