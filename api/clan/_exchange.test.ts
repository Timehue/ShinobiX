import test from 'node:test';
import assert from 'node:assert/strict';
import { buyClanExchangeItem, eligibleCacheItems } from './_exchange.js';
import type { CatalogItem } from '../pvp/_item-catalog.js';

function clan(level = 10) {
    return { name: 'Storm Clan', level, xp: 0, treasury: { warSupply: 10 } };
}

function character(points = 10_000) {
    return { name: 'aya', clan: 'Storm Clan', clanPoints: points, ryo: 0, inventory: [] as string[], itemStacks: [] as unknown[] };
}

const testCatalog: Record<string, CatalogItem> = {
    epicBlade: { id: 'epicBlade', name: 'Epic Blade', slot: 'hand', rarity: 'epic', weaponEp: 33 },
    legendarySpear: { id: 'legendarySpear', name: 'Legendary Spear', slot: 'weapon', rarity: 'legendary', weaponEp: 55 },
    mythicBlade: { id: 'mythicBlade', name: 'Mythic Blade', slot: 'weapon', rarity: 'mythic', weaponEp: 100 },
    epicHelm: { id: 'epicHelm', name: 'Epic Helm', slot: 'head', rarity: 'epic' },
    legendaryArmor: { id: 'legendaryArmor', name: 'Legendary Armor', slot: 'body', rarity: 'legendary' },
    epicGloves: { id: 'epicGloves', name: 'Epic Gloves', slot: 'gloves', rarity: 'epic' },
};

test('buyClanExchangeItem spends personal Clan Points and grants currency', () => {
    const result = buyClanExchangeItem({ character: character(500), clanData: clan(1), itemId: 'smallRyoPouch' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.character.clanPoints, 400);
    assert.equal(result.character.ryo, 2500);
    assert.equal((result.clanData.treasury as Record<string, unknown>).warSupply, 10);
});

test('buyClanExchangeItem can credit clan treasury without using treasury as cost', () => {
    const result = buyClanExchangeItem({ character: character(1000), clanData: clan(5), itemId: 'warSupplyGrant' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.character.clanPoints, 250);
    assert.equal((result.clanData.treasury as Record<string, unknown>).warSupply, 510);
});

test('buyClanExchangeItem enforces weekly purchase limits', () => {
    let c = character(2000);
    for (let i = 0; i < 5; i += 1) {
        const result = buyClanExchangeItem({ character: c, clanData: clan(1), itemId: 'smallRyoPouch', now: new Date('2026-01-01T12:00:00Z') });
        assert.equal(result.ok, true);
        if (result.ok) c = result.character as ReturnType<typeof character>;
    }
    const blocked = buyClanExchangeItem({ character: c, clanData: clan(1), itemId: 'smallRyoPouch', now: new Date('2026-01-01T12:00:00Z') });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, 'limit-reached');
});

test('eligibleCacheItems uses only epic/legendary weapons and armor from the catalog', () => {
    const weapons = eligibleCacheItems(testCatalog, 'weapon');
    const armor = eligibleCacheItems(testCatalog, 'armor');
    assert.deepEqual(weapons.all.map((item) => item.id).sort(), ['epicBlade', 'legendarySpear']);
    assert.deepEqual(armor.all.map((item) => item.id).sort(), ['epicHelm', 'legendaryArmor']);
});

test('weapon and armor caches roll eligible catalog items', () => {
    const weapon = buyClanExchangeItem({ character: character(7000), clanData: clan(10), itemId: 'weaponCache', itemCatalog: testCatalog, rng: () => 0 });
    assert.equal(weapon.ok, true);
    if (weapon.ok) {
        assert.equal(weapon.reveal?.itemId, 'epicBlade');
        assert.deepEqual(weapon.character.inventory, ['epicBlade']);
    }

    const armor = buyClanExchangeItem({ character: character(9000), clanData: clan(10), itemId: 'armorCache', itemCatalog: testCatalog, rng: () => 0.99 });
    assert.equal(armor.ok, true);
    if (armor.ok) {
        assert.equal(armor.reveal?.itemId, 'legendaryArmor');
        assert.deepEqual(armor.character.inventory, ['legendaryArmor']);
    }
});

test('locked and empty exchange items fail closed', () => {
    const locked = buyClanExchangeItem({ character: character(1000), clanData: clan(1), itemId: 'clanBannerFrame' });
    assert.equal(locked.ok, false);
    if (!locked.ok) assert.equal(locked.code, 'coming-soon');

    const empty = buyClanExchangeItem({ character: character(7000), clanData: clan(10), itemId: 'weaponCache', itemCatalog: {}, rng: () => 0 });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.code, 'empty-cache');
});
