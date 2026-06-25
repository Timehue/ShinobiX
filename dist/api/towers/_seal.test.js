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
    (0, node_test_1.it)('DERIVES equipment passives + pvpItems from the save (server-authoritative; ignores client-claimed values)', () => {
        // bloodlineMult / armor* / item*Pct + the equipped-weapon loadout are now
        // DERIVED server-side from the save's equipped bloodline rank + equipped
        // armor/items (api/pvp/_multipliers.ts) — the host's client no longer
        // dictates them. A tampered client claiming inflated passives is ignored.
        const sealed = (0, _seal_js_1.sealTowerFighter)({
            name: 'Hero', stats: {},
            equippedBloodlineId: 'custom-bl-1',
            // legendary-crown (head) + legendary-chest (body): Legendary armor
            // (0.07 DR each) granting damagePercent:1 each; ashen-dragon-katana (hand).
            equipment: { head: 'legendary-crown', body: 'legendary-chest', hand: 'ashen-dragon-katana' },
        }, {
            character: {},
            savedBloodlines: [{ id: 'custom-bl-1', rank: 'S Rank', jutsus: [] }],
            creatorItems: [],
        }, 
        // client claims inflated passives + a bogus weapon — ALL must be ignored.
        { pvpItems: [{ id: 'kunai', name: 'Kunai', slot: 'thrown', weaponEp: 999999 }], bloodlineMult: 3, armorRawDR: 1.5, itemDamagePct: 200 });
        node_assert_1.strict.equal(sealed.bloodlineMult, 1.2, 'bloodlineMult derived from the S-Rank bloodline, not client 3');
        node_assert_1.strict.ok(Math.abs(sealed.armorRawDR - 0.14) < 1e-9, 'armorRawDR derived from the two Legendary pieces (0.07+0.07), not client 1.5');
        node_assert_1.strict.equal(sealed.itemDamagePct, 2, 'itemDamagePct derived from equipped armor bonuses (1+1), not client 200');
        const pvpItems = sealed.pvpItems;
        const katana = pvpItems.find((i) => i.id === 'ashen-dragon-katana');
        node_assert_1.strict.ok(katana, 'equipped weapon resolved from the catalog, not the client-claimed kunai');
        node_assert_1.strict.equal(katana.weaponEp, 30, 'resolved weapon carries its authoritative catalog weaponEp');
        node_assert_1.strict.ok(!pvpItems.some((i) => i.id === 'kunai'), 'client-claimed weapon is ignored');
    });
    (0, node_test_1.it)('clampTowerLoadout clamps tampered passives + sanitizes pvpItems (present fields only)', () => {
        const out = (0, _seal_js_1.clampTowerLoadout)({ bloodlineMult: 99, armorRawDR: 9, itemDamagePct: 9999, pvpItems: [{ id: 'x', name: 'X', slot: 'hand', weaponEp: 999999 }] });
        node_assert_1.strict.equal(out.bloodlineMult, 3);
        node_assert_1.strict.equal(out.armorRawDR, 1.5);
        node_assert_1.strict.equal(out.itemDamagePct, 200);
        node_assert_1.strict.ok(Array.isArray(out.pvpItems));
        node_assert_1.strict.ok(!('armorFactor' in out), 'absent input fields stay absent (merge-safe)');
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
