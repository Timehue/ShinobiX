"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const _exchange_js_1 = require("./_exchange.js");
function clan(level = 10) {
    return { name: 'Storm Clan', level, xp: 0, treasury: { warSupply: 10 } };
}
function character(points = 10_000) {
    return { name: 'aya', clan: 'Storm Clan', clanPoints: points, ryo: 0, inventory: [], itemStacks: [] };
}
const testCatalog = {
    epicBlade: { id: 'epicBlade', name: 'Epic Blade', slot: 'hand', rarity: 'epic', weaponEp: 33 },
    legendarySpear: { id: 'legendarySpear', name: 'Legendary Spear', slot: 'weapon', rarity: 'legendary', weaponEp: 55 },
    mythicBlade: { id: 'mythicBlade', name: 'Mythic Blade', slot: 'weapon', rarity: 'mythic', weaponEp: 100 },
    epicHelm: { id: 'epicHelm', name: 'Epic Helm', slot: 'head', rarity: 'epic' },
    legendaryArmor: { id: 'legendaryArmor', name: 'Legendary Armor', slot: 'body', rarity: 'legendary' },
    epicGloves: { id: 'epicGloves', name: 'Epic Gloves', slot: 'gloves', rarity: 'epic' },
};
(0, node_test_1.default)('buyClanExchangeItem spends personal Clan Points and grants currency', () => {
    const result = (0, _exchange_js_1.buyClanExchangeItem)({ character: character(500), clanData: clan(1), itemId: 'smallRyoPouch' });
    strict_1.default.equal(result.ok, true);
    if (!result.ok)
        return;
    strict_1.default.equal(result.character.clanPoints, 400);
    strict_1.default.equal(result.character.ryo, 2500);
    strict_1.default.equal(result.clanData.treasury.warSupply, 10);
});
(0, node_test_1.default)('buyClanExchangeItem can credit clan treasury without using treasury as cost', () => {
    const result = (0, _exchange_js_1.buyClanExchangeItem)({ character: character(1000), clanData: clan(15), itemId: 'warSupplyGrant' });
    strict_1.default.equal(result.ok, true);
    if (!result.ok)
        return;
    strict_1.default.equal(result.character.clanPoints, 250);
    strict_1.default.equal(result.clanData.treasury.warSupply, 510);
});
(0, node_test_1.default)('refundClanExchangeTreasuryPurchase restores points and purchase limit', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const purchased = (0, _exchange_js_1.buyClanExchangeItem)({ character: character(4000), clanData: clan(25), itemId: 'greaterWarSupplyGrant', now });
    strict_1.default.equal(purchased.ok, true);
    if (!purchased.ok)
        return;
    const blocked = (0, _exchange_js_1.buyClanExchangeItem)({ character: purchased.character, clanData: clan(25), itemId: 'greaterWarSupplyGrant', now });
    strict_1.default.equal(blocked.ok, false);
    if (!blocked.ok)
        strict_1.default.equal(blocked.code, 'limit-reached');
    const refunded = (0, _exchange_js_1.refundClanExchangeTreasuryPurchase)({ character: purchased.character, itemId: 'greaterWarSupplyGrant', now });
    strict_1.default.equal(refunded.clanPoints, 4000);
    const retry = (0, _exchange_js_1.buyClanExchangeItem)({ character: refunded, clanData: clan(25), itemId: 'greaterWarSupplyGrant', now });
    strict_1.default.equal(retry.ok, true);
});
(0, node_test_1.default)('hall-tier level gate blocks stronger offerings until the clan levels up', () => {
    // Fortress/Citadel offerings require Lv 25 / 40 — a Camp-tier clan is locked out.
    const lockedFortress = (0, _exchange_js_1.buyClanExchangeItem)({ character: character(9000), clanData: clan(10), itemId: 'weaponCache' });
    strict_1.default.equal(lockedFortress.ok, false);
    if (!lockedFortress.ok)
        strict_1.default.equal(lockedFortress.code, 'level-locked');
    const lockedCitadel = (0, _exchange_js_1.buyClanExchangeItem)({ character: character(9000), clanData: clan(39), itemId: 'kageCoffer' });
    strict_1.default.equal(lockedCitadel.ok, false);
    if (!lockedCitadel.ok)
        strict_1.default.equal(lockedCitadel.code, 'level-locked');
});
(0, node_test_1.default)('kageCoffer citadel capstone pays ryo at Lv 40', () => {
    const result = (0, _exchange_js_1.buyClanExchangeItem)({ character: character(5000), clanData: clan(40), itemId: 'kageCoffer' });
    strict_1.default.equal(result.ok, true);
    if (!result.ok)
        return;
    strict_1.default.equal(result.character.clanPoints, 1000);
    strict_1.default.equal(result.character.ryo, 50_000);
});
(0, node_test_1.default)('buyClanExchangeItem enforces weekly purchase limits', () => {
    let c = character(2000);
    for (let i = 0; i < 5; i += 1) {
        const result = (0, _exchange_js_1.buyClanExchangeItem)({ character: c, clanData: clan(1), itemId: 'smallRyoPouch', now: new Date('2026-01-01T12:00:00Z') });
        strict_1.default.equal(result.ok, true);
        if (result.ok)
            c = result.character;
    }
    const blocked = (0, _exchange_js_1.buyClanExchangeItem)({ character: c, clanData: clan(1), itemId: 'smallRyoPouch', now: new Date('2026-01-01T12:00:00Z') });
    strict_1.default.equal(blocked.ok, false);
    if (!blocked.ok)
        strict_1.default.equal(blocked.code, 'limit-reached');
});
(0, node_test_1.default)('eligibleCacheItems uses only epic/legendary weapons and armor from the catalog', () => {
    const weapons = (0, _exchange_js_1.eligibleCacheItems)(testCatalog, 'weapon');
    const armor = (0, _exchange_js_1.eligibleCacheItems)(testCatalog, 'armor');
    strict_1.default.deepEqual(weapons.all.map((item) => item.id).sort(), ['epicBlade', 'legendarySpear']);
    strict_1.default.deepEqual(armor.all.map((item) => item.id).sort(), ['epicHelm', 'legendaryArmor']);
});
(0, node_test_1.default)('weapon and armor caches roll eligible catalog items', () => {
    const weapon = (0, _exchange_js_1.buyClanExchangeItem)({ character: character(7000), clanData: clan(25), itemId: 'weaponCache', itemCatalog: testCatalog, rng: () => 0 });
    strict_1.default.equal(weapon.ok, true);
    if (weapon.ok) {
        strict_1.default.equal(weapon.reveal?.itemId, 'epicBlade');
        strict_1.default.deepEqual(weapon.character.inventory, ['epicBlade']);
    }
    const armor = (0, _exchange_js_1.buyClanExchangeItem)({ character: character(9000), clanData: clan(40), itemId: 'armorCache', itemCatalog: testCatalog, rng: () => 0.99 });
    strict_1.default.equal(armor.ok, true);
    if (armor.ok) {
        strict_1.default.equal(armor.reveal?.itemId, 'legendaryArmor');
        strict_1.default.deepEqual(armor.character.inventory, ['legendaryArmor']);
    }
});
(0, node_test_1.default)('locked and empty exchange items fail closed', () => {
    const locked = (0, _exchange_js_1.buyClanExchangeItem)({ character: character(1000), clanData: clan(1), itemId: 'clanBannerFrame' });
    strict_1.default.equal(locked.ok, false);
    if (!locked.ok)
        strict_1.default.equal(locked.code, 'coming-soon');
    const empty = (0, _exchange_js_1.buyClanExchangeItem)({ character: character(7000), clanData: clan(25), itemId: 'weaponCache', itemCatalog: {}, rng: () => 0 });
    strict_1.default.equal(empty.ok, false);
    if (!empty.ok)
        strict_1.default.equal(empty.code, 'empty-cache');
});
