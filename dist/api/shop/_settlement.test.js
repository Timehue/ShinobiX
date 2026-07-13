"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const _settlement_js_1 = require("./_settlement.js");
const item = (overrides = {}) => ({
    id: 'test-kunai', name: 'Test Kunai', slot: 'hand', rarity: 'common', cost: 100, ...overrides,
});
const character = (overrides = {}) => ({
    name: 'rill', level: 10, ryo: 1000, fateShards: 100, inventory: [], itemStacks: [], tileCards: [], equipment: {}, ...overrides,
});
(0, node_test_1.default)('item purchase computes the authoritative discount, grants once, and replays safely', () => {
    const requestId = 'purchase00000001';
    const input = character({ villageUpgrades: { shop: 4 }, elderFocus: 'trade', clanUpgradeLevels: { blacksmith: 5 }, clanDoctrine: 'merchant' });
    strict_1.default.equal((0, _settlement_js_1.shopDiscountPercent)(input, 'ryo'), 12);
    strict_1.default.equal((0, _settlement_js_1.discountedShopCost)(100, 12), 88);
    const bought = (0, _settlement_js_1.applyItemPurchase)(input, item(), 50, requestId, 100);
    strict_1.default.equal(bought.ok, true);
    if (!bought.ok)
        return;
    strict_1.default.equal(bought.character.ryo, 912);
    strict_1.default.deepEqual(bought.character.inventory, ['test-kunai']);
    const replay = (0, _settlement_js_1.applyItemPurchase)(bought.character, item(), 50, requestId, 101);
    strict_1.default.equal(replay.ok, true);
    if (replay.ok) {
        strict_1.default.equal(replay.replayed, true);
        strict_1.default.equal(replay.character.ryo, 912);
        strict_1.default.deepEqual(replay.character.inventory, ['test-kunai']);
    }
});
(0, node_test_1.default)('stackable purchases clamp to the carry cap and reject forged catalog or balance state', () => {
    const bought = (0, _settlement_js_1.applyItemPurchase)(character({ itemStacks: [{ itemId: 'pill', count: 49 }] }), item({ id: 'pill', slot: 'item', stackable: true, weaponEffect: 'damage' }), 20, 'purchase00000002', 100);
    strict_1.default.equal(bought.ok, true);
    if (bought.ok && bought.value.kind === 'item-purchase') {
        strict_1.default.equal(bought.value.quantity, 1);
        strict_1.default.equal(bought.character.itemStacks[0].count, 50);
    }
    strict_1.default.equal((0, _settlement_js_1.applyItemPurchase)(character(), item({ cost: 0 }), 1, 'purchase00000003', 100).ok, false);
    strict_1.default.equal((0, _settlement_js_1.applyItemPurchase)(character({ ryo: -1 }), item(), 1, 'purchase00000004', 100).ok, false);
    strict_1.default.equal((0, _settlement_js_1.applyItemPurchase)(character({ itemStacks: undefined }), item({ id: 'legacy-item' }), 1, 'purchase00000005', 100).ok, true);
});
(0, node_test_1.default)('card packs draw only from the server rarity pool and debit only once', () => {
    const cards = new Map([
        ['common-a', { id: 'common-a', rarity: 'common' }],
        ['rare-a', { id: 'rare-a', rarity: 'rare' }],
        ['epic-a', { id: 'epic-a', rarity: 'epic' }],
    ]);
    const opened = (0, _settlement_js_1.applyCardPackPurchase)(character(), cards, 'standard', 'cardpack00000001', 100, (length) => length - 1);
    strict_1.default.equal(opened.ok, true);
    if (!opened.ok || opened.value.kind !== 'card-pack')
        return;
    strict_1.default.equal(opened.character.ryo, 750);
    strict_1.default.deepEqual(opened.value.drawn, ['rare-a', 'rare-a', 'rare-a', 'rare-a', 'rare-a']);
    const replay = (0, _settlement_js_1.applyCardPackPurchase)(opened.character, cards, 'standard', 'cardpack00000001', 101, () => 0);
    strict_1.default.equal(replay.ok, true);
    if (replay.ok)
        strict_1.default.equal(replay.character.ryo, 750);
});
(0, node_test_1.default)('shop route and client keep price, randomness, auth, and save locking server-side', () => {
    const route = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'shop', 'settle.ts'), 'utf8');
    const helper = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'shinobij.client', 'src', 'lib', 'shop-settlement.ts'), 'utf8');
    const screen = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'shinobij.client', 'src', 'components', 'Shop.tsx'), 'utf8');
    strict_1.default.match(route, /await authedPlayer\(req, playerName\)/);
    strict_1.default.match(route, /await mutatePlayerSave\(playerName/);
    strict_1.default.match(route, /strict: true/);
    strict_1.default.match(route, /randomInt/);
    strict_1.default.match(helper, /action: \{ type: 'purchase-item', itemId, quantity \}/);
    strict_1.default.doesNotMatch(screen, /Math\.random\(\)/);
    strict_1.default.match(screen, /updateCharacter\(result\.character\)/);
});
