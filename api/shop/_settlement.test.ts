import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { SettlementCard, SettlementItem } from './_catalog.js';
import { applyCardPackPurchase, applyItemPurchase, discountedShopCost, shopDiscountPercent } from './_settlement.js';
import { STORY_PROGRESSION_CARD_IDS } from '../card-clash/_progression-cards.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { cardPackBaseCost, cardPackCost, CARD_DUPLICATE_CONVERSION } from '../card-clash/_pack.js';
import { BUILTIN_CLASH, isMarketplaceCard } from '../clan/war/_card-catalog.js';
import type { PlayerCharacter } from '../save/_mutate-player-save.js';
import { VILLAGE_TRANSFER_COST, VILLAGE_TRANSFER_SCROLL_ID } from '../../shared/village-transfer.js';

const item = (overrides: Partial<SettlementItem> = {}): SettlementItem => ({
    id: 'test-kunai', name: 'Test Kunai', slot: 'hand', rarity: 'common', cost: 100, ...overrides,
} as SettlementItem);
const character = (overrides: Record<string, unknown> = {}) => ({
    name: 'rill', level: 10, ryo: 1000, fateShards: 100, chroniclePoints: 250, inventory: [], itemStacks: [], tileCards: [], equipment: {}, ...overrides,
});

test('profession scroll gates also apply to legacy shop settlements', () => {
    const scroll = ITEM_CATALOG['profession-change-approval'] as SettlementItem;
    for (const overrides of [{ level: 19, profession: 'vanguard' }, { level: 20 }, { level: 100, profession: 'invalid' }]) {
        const input = character({ fateShards: 500, ...overrides });
        const before = structuredClone(input);
        assert.equal(applyItemPurchase(input, scroll, 1, 'profession-scroll-test', 100).ok, false);
        assert.deepEqual(input, before);
    }
    const bought = applyItemPurchase(character({ level: 20, profession: 'healer', fateShards: 200 }), scroll, 1, 'profession-scroll-test', 100);
    assert.equal(bought.ok, true);
    if (bought.ok) {
        assert.equal(bought.character.fateShards, 0);
        assert.deepEqual(bought.character.inventory, ['profession-change-approval']);
    }
});

test('item purchase computes the authoritative discount, grants once, and replays safely', () => {
    const requestId = 'purchase00000001';
    const input = character({ villageUpgrades: { shop: 4 }, elderFocus: 'trade', clanUpgradeLevels: { blacksmith: 5 }, clanDoctrine: 'merchant' });
    assert.equal(shopDiscountPercent(input, 'ryo'), 12);
    assert.equal(discountedShopCost(100, 12), 88);
    const bought = applyItemPurchase(input, item(), 50, requestId, 100);
    assert.equal(bought.ok, true);
    if (!bought.ok) return;
    assert.equal(bought.character.ryo, 912);
    assert.deepEqual(bought.character.inventory, ['test-kunai']);
    const replay = applyItemPurchase(bought.character, item(), 50, requestId, 101);
    assert.equal(replay.ok, true);
    if (replay.ok) {
        assert.equal(replay.replayed, true);
        assert.equal(replay.character.ryo, 912);
        assert.deepEqual(replay.character.inventory, ['test-kunai']);
    }
});

test('stackable purchases clamp to the carry cap and reject forged catalog or balance state', () => {
    const bought = applyItemPurchase(character({ itemStacks: [{ itemId: 'pill', count: 49 }] }), item({ id: 'pill', slot: 'item', stackable: true, weaponEffect: 'damage' }), 20, 'purchase00000002', 100);
    assert.equal(bought.ok, true);
    if (bought.ok && bought.value.kind === 'item-purchase') {
        assert.equal(bought.value.quantity, 1);
        assert.equal((bought.character.itemStacks as Array<{ count: number }>)[0]!.count, 50);
    }
    assert.equal(applyItemPurchase(character(), item({ cost: 0 }), 1, 'purchase00000003', 100).ok, false);
    assert.equal(applyItemPurchase(character({ ryo: -1 }), item(), 1, 'purchase00000004', 100).ok, false);
    assert.equal(applyItemPurchase(character({ itemStacks: undefined }), item({ id: 'legacy-item' }), 1, 'purchase00000005', 100).ok, true);
});

test('Ancient Beast Seals use Fate Shards and remain stackable in the Grand Marketplace', () => {
    const ancient = item({ id: 'beast-seal-ancient', name: 'Ancient Beast Seal', slot: 'item', rarity: 'legendary', cost: 15, stackable: true, serviceItem: true, levelReq: 1 });
    const bought = applyItemPurchase(character({ level: 1, fateShards: 40 }), ancient, 2, 'ancientsealpurchase001', 100);
    assert.equal(bought.ok, true);
    if (!bought.ok || bought.value.kind !== 'item-purchase') return;
    assert.equal(bought.value.currency, 'fateShards');
    assert.equal(bought.value.quantity, 2);
    assert.equal(bought.character.fateShards, 10);
    assert.deepEqual(bought.character.itemStacks, [{ itemId: 'beast-seal-ancient', count: 2 }]);
});

test('settlement accepts a 99-seal order and counts an existing seal toward the carry limit', () => {
    const ancient = item({ id: 'beast-seal-ancient', name: 'Ancient Beast Seal', slot: 'item', rarity: 'legendary', cost: 15, stackable: true, serviceItem: true, levelReq: 1 });
    const input = character({ level: 1, fateShards: 1500, itemStacks: [{ itemId: ancient.id, count: 1 }] });
    const bought = applyItemPurchase(input, ancient, 99, 'ancientsealpurchase099', 100);
    assert.equal(bought.ok, true);
    if (!bought.ok || bought.value.kind !== 'item-purchase') return;
    assert.equal(bought.value.quantity, 98);
    assert.equal(bought.value.totalCost, 1470);
    assert.equal(bought.character.fateShards, 30);
    assert.deepEqual(bought.character.itemStacks, [{ itemId: ancient.id, count: 99 }]);
    assert.equal(applyItemPurchase(bought.character, ancient, 1, 'ancientsealpurchase100', 101).ok, false);
    assert.equal(applyItemPurchase(character(), item({ id: 'pill', slot: 'item', stackable: true, weaponEffect: 'damage' }), 51, 'regularbulkquantity51', 100).ok, false);
});

test('card packs draw only from the server rarity pool and debit only once', () => {
    const cards = new Map<string, SettlementCard>([
        ['common-a', { id: 'common-a', rarity: 'common' }],
        ['rare-a', { id: 'rare-a', rarity: 'rare' }],
        ['epic-a', { id: 'epic-a', rarity: 'epic' }],
    ]);
    const opened = applyCardPackPurchase(character(), cards, 'standard', 'cardpack00000001', 100, (length) => length - 1);
    assert.equal(opened.ok, true);
    if (!opened.ok || opened.value.kind !== 'card-pack') return;
    // The Basic pack debits Chronicle Points only; ryo is untouched. Five
    // `rare-a` pulls keep a playset of three; the other two convert (+5 each).
    assert.equal(opened.character.chroniclePoints, 160);
    assert.equal(opened.character.ryo, 1000);
    assert.deepEqual(opened.value.drawn, ['rare-a', 'rare-a', 'rare-a', 'rare-a', 'rare-a']);
    assert.deepEqual(opened.character.tileCards, ['rare-a', 'rare-a', 'rare-a']);
    assert.deepEqual(opened.value.converted?.map((entry) => entry.index), [3, 4]);
    assert.deepEqual(opened.value.refund, { chroniclePoints: 10, fateShards: 0 });
    const replay = applyCardPackPurchase(opened.character, cards, 'standard', 'cardpack00000001', 101, () => 0);
    assert.equal(replay.ok, true);
    if (replay.ok) {
        assert.equal(replay.replayed, true);
        assert.equal(replay.character.chroniclePoints, 160);
        assert.equal(replay.character.ryo, 1000);
        assert.deepEqual(replay.character.tileCards, ['rare-a', 'rare-a', 'rare-a']);
    }
});

test('legacy card packs convert copies past the playset exactly like the live Card Hall', () => {
    const cards = new Map<string, SettlementCard>();
    for (const [id, card] of Object.entries(BUILTIN_CLASH)) cards.set(id, { id, rarity: card.rarity as SettlementCard['rarity'] });
    for (const packId of ['epic', 'legendary'] as const) {
        const pool = [...cards.values()].filter((card) => isMarketplaceCard(card.id)
            && (packId === 'epic' ? card.rarity === 'rare' || card.rarity === 'epic' : card.rarity === 'legendary'));
        const owned = pool.flatMap((card) => [card.id, card.id, card.id]);
        const opened = applyCardPackPurchase(character({ fateShards: 100, chroniclePoints: 0, tileCards: owned }), cards, packId, `cardpack-dupe-${packId}-01`, 100, () => 0);
        assert.equal(opened.ok, true, packId);
        if (!opened.ok || opened.value.kind !== 'card-pack') continue;
        const drawn = cards.get(opened.value.drawn[0])!;
        const value = CARD_DUPLICATE_CONVERSION[drawn.rarity as keyof typeof CARD_DUPLICATE_CONVERSION];
        assert.deepEqual(opened.character.tileCards, owned, 'no fourth copy lands');
        assert.deepEqual(opened.value.refund, value);
        assert.equal(opened.character.fateShards, 100 - cardPackBaseCost(packId) + value.fateShards);
        assert.equal(opened.character.chroniclePoints, value.chroniclePoints);
    }
});

test('every shop pack enforces the shared 1,200 packable-card ceiling before charging', () => {
    const cards = new Map<string, SettlementCard>([
        ['common-a', { id: 'common-a', rarity: 'common' }],
    ]);
    const packables = (count: number) => Array.from({ length: count }, (_, index) => `owned-${index}`);
    const at1195 = applyCardPackPurchase(
        character({ tileCards: [...packables(1_195), ...STORY_PROGRESSION_CARD_IDS] }),
        cards,
        'standard',
        'cardpack-cap-1195',
        100,
        () => 0,
    );
    assert.equal(at1195.ok, true);
    if (at1195.ok) {
        // Five `common-a` pulls: three kept, two converted for 5 points each.
        assert.equal(at1195.character.chroniclePoints, 160);
        assert.equal(at1195.character.ryo, 1000);
        assert.equal((at1195.character.tileCards as string[]).length, 1_198 + STORY_PROGRESSION_CARD_IDS.length);
    }

    for (const count of [1_199, 1_200]) {
        const full = applyCardPackPurchase(
            character({ tileCards: [...packables(count), ...STORY_PROGRESSION_CARD_IDS] }),
            cards,
            'standard',
            `cardpack-cap-${count}`,
            100,
            () => 0,
        );
        assert.equal(full.ok, false);
        if (!full.ok) assert.equal(full.error, 'Your card collection is full.');
    }
});

test('shop route and client keep price, randomness, auth, and save locking server-side', () => {
    const route = readFileSync(join(process.cwd(), 'api', 'shop', 'settle.ts'), 'utf8');
    const helper = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'shop-settlement.ts'), 'utf8');
    const screen = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'components', 'Shop.tsx'), 'utf8');
    assert.match(route, /await authedPlayer\(req, playerName\)/);
    assert.match(route, /await mutatePlayerSave\(playerName/);
    assert.match(route, /strict: true/);
    assert.match(route, /randomInt/);
    assert.match(helper, /action: \{ type: 'purchase-item', itemId, quantity \}/);
    assert.doesNotMatch(screen, /Math\.random\(\)/);
    assert.match(screen, /onVersionedCharacter\(result\.character, result\._saveVersion\)/);
});

test('the village transfer scroll costs a flat 250 here too, with no trade-elder discount', () => {
    const scroll = ITEM_CATALOG[VILLAGE_TRANSFER_SCROLL_ID] as SettlementItem;
    assert.ok(scroll, 'the scroll is in the catalog');
    const bought = applyItemPurchase(character({ level: 100, storyProgress: 9, elderFocus: 'trade', fateShards: 300 }), scroll, 1, 'transfer-scroll-0001', 100);
    assert.equal(bought.ok, true, JSON.stringify(bought));
    if (!bought.ok || bought.value.kind !== 'item-purchase') return;
    assert.equal(bought.value.totalCost, VILLAGE_TRANSFER_COST);
    assert.equal(bought.value.totalCost, 250);
    assert.equal(bought.character.fateShards, 50);
});

test('the village transfer scroll keeps the Level 100 and story gate on this route', () => {
    const scroll = ITEM_CATALOG[VILLAGE_TRANSFER_SCROLL_ID] as SettlementItem;
    for (const overrides of [{ level: 100, storyProgress: 8 }, { level: 99, storyProgress: 9 }]) {
        const input = character({ fateShards: 1000, ...overrides });
        const before = structuredClone(input);
        const refused = applyItemPurchase(input, scroll, 1, 'transfer-scroll-0002', 100);
        assert.equal(refused.ok, false, JSON.stringify(overrides));
        assert.deepEqual(input, before);
    }
});

test('legacy card packs charge the live pack table price, with and without the trade elder', () => {
    const cards = new Map<string, SettlementCard>();
    for (const [id, card] of Object.entries(BUILTIN_CLASH)) cards.set(id, { id, rarity: card.rarity as SettlementCard['rarity'] });
    cards.set('common-a', { id: 'common-a', rarity: 'common' });
    for (const packId of ['standard', 'epic', 'legendary'] as const) {
        for (const elderFocus of [undefined, 'trade']) {
            const input = character({ fateShards: 1000, chroniclePoints: 1000, elderFocus });
            const opened = applyCardPackPurchase(input, cards, packId, `cardpack-live-${packId}-${elderFocus ?? 'none'}`, 100, () => 0);
            assert.equal(opened.ok, true, `${packId}: ${JSON.stringify(opened)}`);
            if (!opened.ok || opened.value.kind !== 'card-pack') continue;
            const expected = cardPackCost(input as PlayerCharacter, packId);
            assert.equal(opened.value.totalCost, expected, `${packId} with elder ${elderFocus}`);
            // A five-card draw of one card converts its 4th and 5th copies.
            const rebate = opened.value.refund?.[opened.value.currency as 'chroniclePoints' | 'fateShards'] ?? 0;
            assert.equal(opened.character[opened.value.currency], 1000 - expected + rebate);
        }
    }
    // The re-priced singles (economy rebalance 2026-10) reach this door too.
    const price = (packId: 'epic' | 'legendary', elderFocus?: string) => {
        const opened = applyCardPackPurchase(character({ fateShards: 100, elderFocus }), cards, packId, `cardpack-price-${packId}-${elderFocus ?? 'none'}`, 100, () => 0);
        return opened.ok && opened.value.kind === 'card-pack' ? opened.value.totalCost : null;
    };
    assert.deepEqual([price('epic'), price('epic', 'trade'), price('legendary'), price('legendary', 'trade')], [6, 5, 20, 19]);
    assert.ok([...cards.keys()].some(isMarketplaceCard), 'the marketplace half is drawn from the live catalog');
});

// 2026-10 item-use pass: the legacy settlement route shares the pet supply hold
// cap with /shop/purchase, so a held stack of treats or PvE gear tops up.
test('pet supplies top up a held stack on the settlement route, and unlocks stay single', () => {
    // Pet food keeps its own 9,999 stack (main's pet growth v2), so the 50 cap is
    // pinned on a PvE gear piece.
    const claw = { ...ITEM_CATALOG['pve-frenzy-claw'], cost: Number(ITEM_CATALOG['pve-frenzy-claw'].cost) } as SettlementItem;
    const bought = applyItemPurchase(character({ level: 100, ryo: 1_000_000, itemStacks: [{ itemId: 'pve-frenzy-claw', count: 45 }] }), claw, 20, 'pet-supply-settle-001', 100);
    assert.equal(bought.ok, true);
    if (bought.ok && bought.value.kind === 'item-purchase') {
        assert.equal(bought.value.quantity, 5, 'clamped to the 50 hold cap');
        assert.deepEqual(bought.character.itemStacks, [{ itemId: 'pve-frenzy-claw', count: 50 }]);
    }
    const collar = { ...ITEM_CATALOG['collar-crimson'], cost: Number(ITEM_CATALOG['collar-crimson'].cost) } as SettlementItem;
    const again = applyItemPurchase(character({ level: 70, fateShards: 1_000, inventory: ['collar-crimson'] }), collar, 1, 'pet-supply-settle-002', 100);
    assert.equal(again.ok, false, 'a collar is a one-off unlock');
});