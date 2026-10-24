import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { RELIC_ROSTER, VILLAGE_RELICS, RETIRED_RELIC_IDS, grantRelic, migrateRelicRoster, pveSpecialistDamagePercent } from './relics.js';
import { starterItems } from '../shinobij.client/src/data/starter-items.js';
import { eventItems } from '../shinobij.client/src/data/event-items.js';
import { STORY_RECKONINGS } from '../api/sector/_story-reckoning.js';

test('exactly 20 equippable relics, one equal story reward per village, all art present', () => {
    const equipped = [...starterItems, ...eventItems].filter(item => item.slot === 'relic');
    assert.equal(equipped.length, 20);
    assert.equal(new Set(equipped.map(item => item.id)).size, 20);
    assert.deepEqual(equipped.map(item => item.id).sort(), RELIC_ROSTER.map(item => item.id).sort());
    assert.equal(Object.keys(VILLAGE_RELICS).length, 4);
    for (const item of RELIC_ROSTER) {
        assert.ok(Object.keys(item.bonuses).every(key => key.startsWith('pve') && key.endsWith('DamagePercent')));
        assert.ok(existsSync(`shinobij.client/public${item.image}`), item.id);
        assert.equal(item.cost, 0);
    }
    for (const [village, id] of Object.entries(VILLAGE_RELICS)) {
        const item = equipped.find(item => item.id === id)!;
        assert.deepEqual(item.bonuses, { pveDamagePercent: 3 });
        assert.equal(item.levelReq, 58);
        const quests = Object.values(STORY_RECKONINGS).filter(quest => quest.village === village && equipped.some(item => item.id === quest.dropItemId));
        assert.equal(quests.length, 1, village);
        assert.equal(quests[0].levelReq, 58);
        assert.equal(quests[0].ownProgress, 5);
        assert.equal(quests[0].target, 1);
    }
    assert.ok(RETIRED_RELIC_IDS.every(id => eventItems.find(item => item.id === id)?.slot === 'item'));
});

test('a worn duplicate pays shards without minting a second copy', () => {
    const id = 'relic-zenith-lotus';
    const result = grantRelic({ inventory: [], equipment: { relic: id }, fateShards: 4 }, id);
    assert.equal(result.fateShards, 15);
    assert.equal(result.character.fateShards, 19);
    assert.deepEqual(result.character.inventory, []);
});

test('specialist damage matches the attack, not the character or weather', () => {
    const bonuses = { pveFireDamagePercent: 6, pveBukijutsuDamagePercent: 10 };
    assert.equal(pveSpecialistDamagePercent(bonuses, { type: 'Bukijutsu', element: 'Fire' }), 16);
    assert.equal(pveSpecialistDamagePercent(bonuses, { type: 'Ninjutsu', element: 'Fire' }), 6);
    assert.equal(pveSpecialistDamagePercent(bonuses, { type: 'Bukijutsu', element: 'Water' }), 10);
    assert.equal(pveSpecialistDamagePercent(bonuses, { type: 'Taijutsu', element: 'Water' }), 0);
    assert.equal(pveSpecialistDamagePercent(bonuses), 0);
});

test('retired equipped and stored relics convert once and leave unfinished quest proof intact', () => {
    const before = { village: 'Ashen Leaf Village', inventory: ['event-forged-die'], equipment: { relic: 'event-unsworn-page', waist: 'event-struck-warmth-token' } };
    const migrated = migrateRelicRoster(before);
    assert.equal(migrated.changed, true);
    const inv = migrated.character.inventory as string[];
    for (const id of ['event-struck-nameplate', 'event-sealed-file', 'event-struck-warmth-token', 'event-unsworn-page']) assert.ok(inv.includes(id), id);
    assert.deepEqual(migrated.character.equipment, {});
    assert.equal(migrateRelicRoster(migrated.character).changed, false);
    assert.deepEqual(before.equipment, { relic: 'event-unsworn-page', waist: 'event-struck-warmth-token' });
});

// 2026-10 item-use pass: one relic slot, so a relic is dead if another gives the
// same kind of bonus, at least as large, from the same or a lower level. The
// Drownstone Compass (+8% Wind, Lv70) lost to the Skybreak Prism (+12% Wind,
// Lv70) until it became the late Water relic.
test('no relic is strictly beaten by another in the one relic slot', () => {
    const single = RELIC_ROSTER.map(item => {
        const entries = Object.entries(item.bonuses);
        assert.equal(entries.length, 1, `${item.id} carries one bonus`);
        return { id: item.id, field: entries[0][0], value: Number(entries[0][1]), level: item.levelReq };
    });
    for (const a of single) {
        for (const b of single) {
            if (a.id === b.id || a.field !== b.field) continue;
            const dominated = b.value >= a.value && b.level <= a.level && (b.value > a.value || b.level < a.level);
            assert.ok(!dominated, `${a.id} (+${a.value}% at Lv${a.level}) is beaten by ${b.id} (+${b.value}% at Lv${b.level})`);
        }
    }
    const compass = RELIC_ROSTER.find(item => item.id === 'relic-drownstone-compass')!;
    assert.deepEqual(compass.bonuses, { pveWaterDamagePercent: 8 });
    assert.equal(compass.levelReq, 70);
    assert.match(compass.description, /\+8% Water damage against PvE enemies/);
});