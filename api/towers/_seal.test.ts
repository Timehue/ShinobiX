import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sealTowerFighter, sealTowerItemCharges } from './_seal.js';

describe('Battle Towers fighter sealing (P1.B)', () => {
    it('clamps tampered stats + vitals to the hard caps', () => {
        const sealed = sealTowerFighter({
            name: 'Cheater', level: 50, specialty: 'Ninjutsu',
            stats: { taijutsuOffense: 999999, willpower: -50 },
            maxHp: 999999, maxChakra: 999999, bloodlineMult: 99,
        });
        const stats = sealed.stats as Record<string, number>;
        assert.equal(stats.taijutsuOffense, 2500);
        assert.equal(stats.willpower, 0);
        assert.equal(sealed.maxHp, 10000);
        assert.equal(sealed.maxChakra, 5000);
        assert.equal(sealed.bloodlineMult, 3);
        assert.equal(sealed.specialty, 'Ninjutsu');
    });

    it('sanitizes the jutsu loadout (caps effectPower)', () => {
        const sealed = sealTowerFighter({ stats: {}, jutsu: [{ id: 'j1', effectPower: 999999, type: 'Ninjutsu' }] });
        const jutsu = sealed.jutsu as Array<Record<string, unknown>>;
        assert.ok((jutsu[0].effectPower as number) <= 600, 'effectPower clamped by sanitizeJutsuList');
    });

    it('strips currencies + inventory + battleTower ledgers', () => {
        const sealed = sealTowerFighter({ name: 'A', ryo: 1e9, inventory: [1, 2, 3], battleTowerClearedFloors: [1, 2, 3], stats: {} });
        assert.ok(!('ryo' in sealed));
        assert.ok(!('inventory' in sealed));
        assert.ok(!('battleTowerClearedFloors' in sealed));
        assert.equal(sealed.name, 'A');
    });

    it('defaults an invalid specialty to Taijutsu', () => {
        const sealed = sealTowerFighter({ specialty: 'Hacking', stats: {} });
        assert.equal(sealed.specialty, 'Taijutsu');
    });

    it('RESOLVES the equipped loadout from equippedJutsuIds (the empty-jutsu-bar fix)', () => {
        // A real save has NO `jutsu` array — only equippedJutsuIds. The old direct
        // sanitizeJutsuList(saveChar.jutsu) produced an empty loadout (no castable jutsu).
        const sealed = sealTowerFighter(
            { name: 'Hero', stats: {}, equippedJutsuIds: ['ashen-eyes-blood-gaze'] },
            { character: { equippedJutsuIds: ['ashen-eyes-blood-gaze'] } },
        );
        const jutsu = sealed.jutsu as Array<Record<string, unknown>>;
        assert.ok(Array.isArray(jutsu) && jutsu.length === 1, 'equipped jutsu resolved from the catalog');
        assert.equal(jutsu[0].id, 'ashen-eyes-blood-gaze');
        assert.ok((jutsu[0].chakraCost as number) > 0, 'catalog jutsu carries its real chakra cost');
    });

    it('seals client-supplied pvpItems + equipment passives the save does NOT persist', () => {
        // pvpItems + bloodlineMult/armor/itemDamagePct are computed client-side at fight time
        // (the save lacks them) — the host sends them; the seal must fill + clamp them.
        const sealed = sealTowerFighter(
            { name: 'Hero', stats: {} },          // save character — no items / passives
            { character: {} },                    // save record
            { pvpItems: [{ id: 'kunai', name: 'Kunai', slot: 'thrown', weaponEp: 20 }], bloodlineMult: 2, armorRawDR: 0.8, itemDamagePct: 50 },
        );
        assert.equal(sealed.bloodlineMult, 2, 'client bloodlineMult sealed');
        assert.equal(sealed.itemDamagePct, 50, 'client itemDamagePct sealed');
        assert.ok((sealed.armorRawDR as number) > 0, 'client armorRawDR sealed');
        assert.ok(Array.isArray(sealed.pvpItems) && (sealed.pvpItems as unknown[]).length === 1, 'client pvpItems sealed');
    });

    it('seals a per-fight consumable budget capped by owned count', () => {
        const charges = sealTowerItemCharges({
            equipment: { thrown: 'shuriken', potion: 'rejuvenation-potion' },
            itemStacks: [{ itemId: 'shuriken', count: 5 }, { itemId: 'rejuvenation-potion', count: 9 }],
        });
        assert.equal(charges['shuriken'], 5, 'thrown weapon charges = owned count');
        assert.equal(charges['rejuvenation-potion'], 2, 'potion capped at 2/fight');
    });
});
