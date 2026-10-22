import test from 'node:test';
import assert from 'node:assert/strict';
import { buyClanExchangeItem, eligibleCacheItems, refundClanExchangeTreasuryPurchase,CLAN_EXCHANGE_ITEMS } from './_exchange.js';
import { ITEM_CATALOG, type CatalogItem } from '../pvp/_item-catalog.js';

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
    const result = buyClanExchangeItem({ character: character(1000), clanData: clan(15), itemId: 'warSupplyGrant' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.character.clanPoints, 250);
    assert.equal((result.clanData.treasury as Record<string, unknown>).warSupply, 510);
});

test('refundClanExchangeTreasuryPurchase restores points and purchase limit', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const purchased = buyClanExchangeItem({ character: character(4000), clanData: clan(25), itemId: 'greaterWarSupplyGrant', now });
    assert.equal(purchased.ok, true);
    if (!purchased.ok) return;

    const blocked = buyClanExchangeItem({ character: purchased.character, clanData: clan(25), itemId: 'greaterWarSupplyGrant', now });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, 'limit-reached');

    const refunded = refundClanExchangeTreasuryPurchase({ character: purchased.character, itemId: 'greaterWarSupplyGrant', now });
    assert.equal(refunded.clanPoints, 4000);

    const retry = buyClanExchangeItem({ character: refunded, clanData: clan(25), itemId: 'greaterWarSupplyGrant', now });
    assert.equal(retry.ok, true);
});

test('hall-tier level gate blocks stronger offerings until the clan levels up', () => {
    // Fortress/Citadel offerings require Lv 25 / 40 — a Camp-tier clan is locked out.
    const lockedFortress = buyClanExchangeItem({ character: character(9000), clanData: clan(10), itemId: 'weaponCache' });
    assert.equal(lockedFortress.ok, false);
    if (!lockedFortress.ok) assert.equal(lockedFortress.code, 'level-locked');

    const lockedCitadel = buyClanExchangeItem({ character: character(9000), clanData: clan(39), itemId: 'kageCoffer' });
    assert.equal(lockedCitadel.ok, false);
    if (!lockedCitadel.ok) assert.equal(lockedCitadel.code, 'level-locked');
});

test('kageCoffer citadel capstone pays ryo at Lv 40', () => {
    const result = buyClanExchangeItem({ character: character(5000), clanData: clan(40), itemId: 'kageCoffer' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.character.clanPoints, 3500);
    assert.equal(result.character.ryo, 50_000);
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

// 2026-10 item-use pass: the Ranked Seal pieces are the Ranked Format's loaned kit
// (no passive, cost 0, unsellable), so a Vault copy was always a worse legendary.
test('the Vault of the Fallen never rolls a Ranked Seal piece, and every piece it rolls has a set passive', () => {
    const armor = eligibleCacheItems(ITEM_CATALOG, 'armor');
    assert.ok(armor.all.length >= 30, `${armor.all.length} armor pieces in the pool`);
    for (const item of armor.all) {
        assert.ok(!item.id.startsWith('ranked-format-'), `${item.id} is the ranked kit`);
        const bonuses = (item.bonuses ?? {}) as Record<string, unknown>;
        const passive = ['damagePercent', 'pveDamagePercent', 'absorbPercent', 'lifeStealPercent', 'shield', 'reflectPercent']
            .some((field) => Number(bonuses[field]) > 0);
        assert.ok(passive, `${item.id} carries a set passive`);
    }
    assert.ok(Object.keys(ITEM_CATALOG).some((id) => id.startsWith('ranked-format-')), 'the ranked kit itself is still in the catalog');
});

test('weapon and armor caches roll eligible catalog items', () => {
    const weapon = buyClanExchangeItem({ character: character(7000), clanData: clan(25), itemId: 'weaponCache', itemCatalog: testCatalog, rng: () => 0 });
    assert.equal(weapon.ok, true);
    if (weapon.ok) {
        assert.equal(weapon.reveal?.itemId, 'epicBlade');
        assert.deepEqual(weapon.character.inventory, ['epicBlade']);
    }

    const armor = buyClanExchangeItem({ character: character(9000), clanData: clan(40), itemId: 'armorCache', itemCatalog: testCatalog, rng: () => 0.99 });
    assert.equal(armor.ok, true);
    if (armor.ok) {
        assert.equal(armor.reveal?.itemId, 'legendaryArmor');
        assert.deepEqual(armor.character.inventory, ['legendaryArmor']);
    }
});

// The cache draws, in order: rarity, pool index, then the gear step roll, then its pick.
const draws = (...values: number[]) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };

test('one cache in five pays a gear step drop of its own kind, using the real catalog', () => {
    const weapon = buyClanExchangeItem({ character: character(7000), clanData: clan(25), itemId: 'weaponCache', rng: draws(0.9, 0, 0.1, 0) });
    assert.equal(weapon.ok, true);
    if (weapon.ok) {
        assert.match(String(weapon.reveal?.itemId), /-s[1-5]$/);
        assert.equal(weapon.reveal?.slot, 'hand');
        assert.deepEqual(weapon.character.inventory, [weapon.reveal?.itemId]);
    }
    const armor = buyClanExchangeItem({ character: character(9000), clanData: clan(40), itemId: 'armorCache', rng: draws(0.9, 0, 0.1, 0) });
    assert.equal(armor.ok, true);
    if (armor.ok) {
        assert.match(String(armor.reveal?.itemId), /-s[1-5]$/);
        assert.notEqual(armor.reveal?.slot, 'hand');
    }
});

test('the other four caches in five still pay an Epic or Legendary piece', () => {
    const weapon = buyClanExchangeItem({ character: character(7000), clanData: clan(25), itemId: 'weaponCache', rng: draws(0.9, 0, 0.5, 0) });
    assert.equal(weapon.ok, true);
    if (weapon.ok) {
        assert.doesNotMatch(String(weapon.reveal?.itemId), /-s[1-5]$/);
        assert.equal(weapon.reveal?.rarity, 'legendary');
    }
});

test('empty exchange caches fail closed', () => {
    const empty = buyClanExchangeItem({ character: character(7000), clanData: clan(25), itemId: 'weaponCache', itemCatalog: {}, rng: () => 0 });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.code, 'empty-cache');
});
test('the clan crest cosmetic is a permanent, once-only unlock with no combat or treasury payout',()=>{
    const first=buyClanExchangeItem({character:character(1000),clanData:clan(1),itemId:'clanBannerFrame'});assert.equal(first.ok,true);
    if(!first.ok)return;
    assert.equal(first.character.clanPoints,500);assert.deepEqual(first.clanData,clan(1));
    assert.equal((first.character.clanExchangePurchases as {oneTime:Record<string,boolean>}).oneTime.clanBannerFrame,true);
    const second=buyClanExchangeItem({character:first.character,clanData:clan(1),itemId:'clanBannerFrame'});assert.equal(second.ok,false);
    if(!second.ok)assert.equal(second.code,'limit-reached');
});
test('the balanced premium shelves give better bulk value and attainable cache savings under the shared weekly cap',()=>{
    const get=(id:string)=>CLAN_EXCHANGE_ITEMS.find(item=>item.id===id)!;
    const small=get('smallRyoPouch'),large=get('largeRyoPouch'),coffer=get('kageCoffer');
    assert.ok(large.cost/10000<small.cost/2500);assert.ok(coffer.cost/50000<large.cost/10000);
    assert.ok(get('weaponCache').cost<=2*1000);assert.ok(get('armorCache').cost<=3*1000);
    assert.equal(get('weaponCache').requiredClanLevel,25);assert.equal(get('armorCache').requiredClanLevel,40);
});
test('the Aura Stone shelves sell 5 stones for 400 CP and a 12-stone trove at bulk value (economy rebalance 2026-10)',()=>{
    const get=(id:string)=>CLAN_EXCHANGE_ITEMS.find(item=>item.id===id)!;
    const stone=get('auraStone'),trove=get('auraStoneBundle');
    assert.equal(stone.cost,400);assert.deepEqual(stone.reward,{kind:'currency',currency:'auraStones',amount:5});
    assert.deepEqual(stone.limit,{kind:'weekly',count:2});assert.equal(stone.requiredClanLevel,7);assert.equal(stone.hall,'dojo');
    assert.equal(trove.cost,900);assert.deepEqual(trove.reward,{kind:'currency',currency:'auraStones',amount:12});
    assert.deepEqual(trove.limit,{kind:'weekly',count:1});assert.equal(trove.requiredClanLevel,40);assert.equal(trove.hall,'citadel');
    assert.ok(trove.cost/12<stone.cost/5,'the trove is the cheaper stone');
    const bought=buyClanExchangeItem({character:character(1000),clanData:clan(7),itemId:'auraStone'});
    assert.equal(bought.ok,true);if(bought.ok){assert.equal(bought.character.clanPoints,600);assert.equal(bought.character.auraStones,5);}
});
test('a server-sealed paid recovery keeps its original catalog terms after a price rebalance',()=>{
    const original={...CLAN_EXCHANGE_ITEMS.find(item=>item.id==='weaponCache')!,cost:6000};
    const replay=buyClanExchangeItem({character:character(7000),clanData:clan(25),itemId:'weaponCache',definition:original,rng:()=>0.9});
    assert.equal(replay.ok,true);if(replay.ok){assert.equal(replay.character.clanPoints,1000);assert.equal(replay.item.cost,6000);}
});
