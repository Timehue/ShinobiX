"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _card_catalog_js_1 = require("../clan/war/_card-catalog.js");
const _pack_js_1 = require("./_pack.js");
(0, node_test_1.test)('standard pack mirrors the village, elder, clan, and doctrine discount and grants five canonical cards', () => {
    const character = {
        ryo: 1_000,
        fateShards: 50,
        tileCards: ['tc-01'],
        villageUpgrades: { shop: 20 }, // 5%
        elderFocus: 'trade', // 5%
        clanUpgradeLevels: { blacksmith: 25 }, // 5%
        clanDoctrine: 'merchant', // 5%
    };
    strict_1.default.equal((0, _pack_js_1.cardPackDiscountPercent)(character, 'standard'), 20);
    strict_1.default.equal((0, _pack_js_1.cardPackCost)(character, 'standard'), 200);
    const opened = (0, _pack_js_1.applyCardPackOpen)(character, 'standard', () => 0);
    strict_1.default.equal(opened.ok, true);
    if (!opened.ok)
        return;
    strict_1.default.equal(opened.cost, 200);
    strict_1.default.equal(opened.balance, 800);
    strict_1.default.equal(opened.cards.length, 5);
    strict_1.default.equal(opened.character.tileCards instanceof Array, true);
    for (const id of opened.cards)
        strict_1.default.ok(['common', 'rare'].includes(_card_catalog_js_1.BUILTIN_CLASH[id].rarity));
});
(0, node_test_1.test)('premium packs debit Fate Shards and can only draw the purchased rarity', () => {
    const epic = (0, _pack_js_1.applyCardPackOpen)({ fateShards: 10, tileCards: [] }, 'epic', (max) => max - 1);
    strict_1.default.equal(epic.ok, true);
    if (epic.ok) {
        strict_1.default.equal(epic.balance, 0);
        strict_1.default.equal(epic.cards.length, 1);
        strict_1.default.equal(_card_catalog_js_1.BUILTIN_CLASH[epic.cards[0]].rarity, 'epic');
    }
    const legendary = (0, _pack_js_1.applyCardPackOpen)({ fateShards: 29, tileCards: [], elderFocus: 'trade' }, 'legendary', () => 0);
    strict_1.default.equal(legendary.ok, true, '5% trade discount floors 30 to 28');
    if (legendary.ok) {
        strict_1.default.equal(legendary.cost, 28);
        strict_1.default.equal(legendary.balance, 1);
        strict_1.default.equal(_card_catalog_js_1.BUILTIN_CLASH[legendary.cards[0]].rarity, 'legendary');
    }
});
(0, node_test_1.test)('pack opening fails closed for invalid type, insufficient balance, and collection cap', () => {
    strict_1.default.deepEqual((0, _pack_js_1.applyCardPackOpen)({ ryo: 999, tileCards: [] }, 'forged', () => 0), { ok: false, status: 400, error: 'Invalid card pack.' });
    strict_1.default.deepEqual((0, _pack_js_1.applyCardPackOpen)({ fateShards: 9, tileCards: [] }, 'epic', () => 0), { ok: false, status: 409, error: 'Not enough fateShards.' });
    const capped = (0, _pack_js_1.applyCardPackOpen)({ ryo: 999, tileCards: Array(1200).fill('tc-01') }, 'standard', () => 0);
    strict_1.default.deepEqual(capped, { ok: false, status: 409, error: 'Card collection is capped at 1200.' });
});
