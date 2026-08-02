import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sealTowerFighter, sealTowerItemCharges } from './_seal.js';
import type { AdminCombatContent } from '../_admin-content.js';
import { COMBAT_RESOURCES_V2 } from '../_xp-engine.js';

describe('Battle Towers fighter sealing (P1.B)', () => {
    it('clamps tampered stats + vitals to the hard caps', () => {
        const sealed = sealTowerFighter({
            name: 'Cheater', level: 50, specialty: 'Ninjutsu',
            stats: { taijutsuOffense: 999999, willpower: -50 },
            maxHp: 999999, maxChakra: 999999, bloodlineMult: 99,
        }, null, {}, null);
        const stats = sealed.stats as Record<string, number>;
        assert.equal(stats.taijutsuOffense, 2500);
        assert.equal(stats.willpower, 0);
        assert.equal(sealed.maxHp, 10000);
        assert.equal(sealed.maxChakra, COMBAT_RESOURCES_V2 ? 10000 : 5000); // v2 raises the pool cap
        assert.equal(sealed.bloodlineMult, 3);
        assert.equal(sealed.specialty, 'Ninjutsu');
    });

    it('sanitizes the jutsu loadout (caps effectPower)', () => {
        const sealed = sealTowerFighter({ stats: {}, jutsu: [{ id: 'j1', effectPower: 999999, type: 'Ninjutsu' }] }, null, {}, null);
        const jutsu = sealed.jutsu as Array<Record<string, unknown>>;
        assert.ok((jutsu[0].effectPower as number) <= 600, 'effectPower clamped by sanitizeJutsuList');
    });

    it('strips currencies + inventory + battleTower ledgers', () => {
        const sealed = sealTowerFighter({ name: 'A', ryo: 1e9, inventory: [1, 2, 3], battleTowerClearedFloors: [1, 2, 3], stats: {} }, null, {}, null);
        assert.ok(!('ryo' in sealed));
        assert.ok(!('inventory' in sealed));
        assert.ok(!('battleTowerClearedFloors' in sealed));
        assert.equal(sealed.name, 'A');
    });

    // Admin-authored jutsu live ONLY on save:admin1/admin2 (`creatorJutsus` is a
    // SERVER_LEDGER_TOPLEVEL_FIELD), so the save the sealer reads can never supply
    // one. These callers mostly pass no client body either, so before the admin
    // parameter an equipped authored id matched nothing and was DROPPED — the player
    // entered Towers / Clan Boss / PvE / Anbu / merc fights a jutsu short.
    it('seals an equipped admin-authored jutsu from the authored catalog', () => {
        const authored = { id: 'starter-universal-blitz', name: 'Overload', type: 'Ninjutsu', ap: 40, effectPower: 36 };
        const saveChar = { stats: {}, equippedJutsuIds: ['starter-tai-fire-2', 'starter-universal-blitz'] };

        const without = sealTowerFighter(saveChar, { savedBloodlines: [], creatorJutsus: [] }, {}, null);
        assert.deepEqual((without.jutsu as Array<{ id: string }>).map((j) => j.id), ['starter-tai-fire-2']);

        const admin: AdminCombatContent = { jutsu: new Map([[authored.id, authored]]), items: new Map() };
        const withAuthored = sealTowerFighter(saveChar, { savedBloodlines: [], creatorJutsus: [] }, {}, admin);
        const ids = (withAuthored.jutsu as Array<{ id: string }>).map((j) => j.id);
        assert.deepEqual(ids, ['starter-tai-fire-2', 'starter-universal-blitz']);
        assert.equal((withAuthored.jutsu as Array<Record<string, unknown>>)[1].effectPower, 36);
    });

    // Gear half of the same gap (the seal path gained the admin item catalog in
    // 9a7980971 but no seal-level test): these callers pass no client body, so
    // without the catalog an equipped authored item resolves to nothing and the
    // fighter is disarmed for the whole run.
    it('seals equipped admin-authored gear from the authored catalog', () => {
        const authored = { id: 'custom-storm-tanto', name: 'Storm Tanto', slot: 'hand', rarity: 'legendary', weaponEp: 40 };
        const saveChar = { stats: {}, equipment: { hand: 'custom-storm-tanto' } };
        const save = { creatorItems: [] };

        const without = sealTowerFighter(saveChar, save, {}, null);
        assert.deepEqual((without.pvpItems as Array<{ id: string }>).map((i) => i.id), []);

        const admin: AdminCombatContent = { jutsu: new Map(), items: new Map([[authored.id, authored]]) };
        const withGear = sealTowerFighter(saveChar, save, {}, admin);
        assert.deepEqual((withGear.pvpItems as Array<{ id: string }>).map((i) => i.id), ['custom-storm-tanto']);
        assert.equal((withGear.pvpItems as Array<{ name: string }>)[0].name, 'Storm Tanto');
    });

    it('defaults an invalid specialty to Taijutsu', () => {
        const sealed = sealTowerFighter({ specialty: 'Hacking', stats: {} }, null, {}, null);
        assert.equal(sealed.specialty, 'Taijutsu');
    });

    it('RESOLVES the equipped loadout from equippedJutsuIds (the empty-jutsu-bar fix)', () => {
        // A real save has NO `jutsu` array — only equippedJutsuIds. The old direct
        // sanitizeJutsuList(saveChar.jutsu) produced an empty loadout (no castable jutsu).
        // The fighter carries Ashen Eyes: the bloodline gate (api/pvp/_bloodline-gate.ts)
        // drops the bloodline kit from any save that doesn't.
        const sealed = sealTowerFighter(
            { name: 'Hero', stats: {}, bloodline: 'Ashen Eyes', equippedJutsuIds: ['ashen-eyes-blood-gaze'] },
            { character: { equippedJutsuIds: ['ashen-eyes-blood-gaze'] } },
            {},
            null,
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
            null,
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

    it('seals a per-fight consumable budget capped by owned count', () => {
        const charges = sealTowerItemCharges({
            equipment: { thrown: 'shuriken', potion: 'rejuvenation-potion' },
            itemStacks: [{ itemId: 'shuriken', count: 5 }, { itemId: 'rejuvenation-potion', count: 9 }],
        });
        assert.equal(charges['shuriken'], 5, 'thrown weapon charges = owned count');
        assert.equal(charges['rejuvenation-potion'], 2, 'potion capped at 2/fight');
    });
});
