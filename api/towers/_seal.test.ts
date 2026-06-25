import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sealTowerFighter, sealTowerItemCharges, clampTowerLoadout } from './_seal.js';

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

    it('DERIVES equipment passives + pvpItems from the save (server-authoritative; ignores client-claimed values)', () => {
        // bloodlineMult / armor* / item*Pct + the equipped-weapon loadout are now
        // DERIVED server-side from the save's equipped bloodline rank + equipped
        // armor/items (api/pvp/_multipliers.ts) — the host's client no longer
        // dictates them. A tampered client claiming inflated passives is ignored.
        const sealed = sealTowerFighter(
            {
                name: 'Hero', stats: {},
                equippedBloodlineId: 'custom-bl-1',
                // legendary-crown (head) + legendary-chest (body): Legendary armor
                // (0.07 DR each) granting damagePercent:1 each; ashen-dragon-katana (hand).
                equipment: { head: 'legendary-crown', body: 'legendary-chest', hand: 'ashen-dragon-katana' },
            },
            {
                character: {},
                savedBloodlines: [{ id: 'custom-bl-1', rank: 'S Rank', jutsus: [] }],
                creatorItems: [],
            },
            // client claims inflated passives + a bogus weapon — ALL must be ignored.
            { pvpItems: [{ id: 'kunai', name: 'Kunai', slot: 'thrown', weaponEp: 999999 }], bloodlineMult: 3, armorRawDR: 1.5, itemDamagePct: 200 },
        );
        assert.equal(sealed.bloodlineMult, 1.2, 'bloodlineMult derived from the S-Rank bloodline, not client 3');
        assert.ok(Math.abs((sealed.armorRawDR as number) - 0.14) < 1e-9, 'armorRawDR derived from the two Legendary pieces (0.07+0.07), not client 1.5');
        assert.equal(sealed.itemDamagePct, 2, 'itemDamagePct derived from equipped armor bonuses (1+1), not client 200');
        const pvpItems = sealed.pvpItems as Array<Record<string, unknown>>;
        const katana = pvpItems.find((i) => i.id === 'ashen-dragon-katana');
        assert.ok(katana, 'equipped weapon resolved from the catalog, not the client-claimed kunai');
        assert.equal(katana!.weaponEp, 30, 'resolved weapon carries its authoritative catalog weaponEp');
        assert.ok(!pvpItems.some((i) => i.id === 'kunai'), 'client-claimed weapon is ignored');
    });

    it('clampTowerLoadout clamps tampered passives + sanitizes pvpItems (present fields only)', () => {
        const out = clampTowerLoadout({ bloodlineMult: 99, armorRawDR: 9, itemDamagePct: 9999, pvpItems: [{ id: 'x', name: 'X', slot: 'hand', weaponEp: 999999 }] });
        assert.equal(out.bloodlineMult, 3);
        assert.equal(out.armorRawDR, 1.5);
        assert.equal(out.itemDamagePct, 200);
        assert.ok(Array.isArray(out.pvpItems));
        assert.ok(!('armorFactor' in out), 'absent input fields stay absent (merge-safe)');
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
