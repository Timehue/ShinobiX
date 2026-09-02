import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { SettlementCard, SettlementItem } from './_catalog.js';
import { applyCardPackPurchase, applyItemPurchase, discountedShopCost, shopDiscountPercent } from './_settlement.js';
import { STORY_PROGRESSION_CARD_IDS } from '../card-clash/_progression-cards.js';

const item = (overrides: Partial<SettlementItem> = {}): SettlementItem => ({
    id: 'test-kunai', name: 'Test Kunai', slot: 'hand', rarity: 'common', cost: 100, ...overrides,
} as SettlementItem);
const character = (overrides: Record<string, unknown> = {}) => ({
    name: 'rill', level: 10, ryo: 1000, fateShards: 100, chroniclePoints: 250, inventory: [], itemStacks: [], tileCards: [], equipment: {}, ...overrides,
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

test('card packs draw only from the server rarity pool and debit only once', () => {
    const cards = new Map<string, SettlementCard>([
        ['common-a', { id: 'common-a', rarity: 'common' }],
        ['rare-a', { id: 'rare-a', rarity: 'rare' }],
        ['epic-a', { id: 'epic-a', rarity: 'epic' }],
    ]);
    const opened = applyCardPackPurchase(character(), cards, 'standard', 'cardpack00000001', 100, (length) => length - 1);
    assert.equal(opened.ok, true);
    if (!opened.ok || opened.value.kind !== 'card-pack') return;
    // The Basic pack debits Chronicle Points only; ryo is untouched.
    assert.equal(opened.character.chroniclePoints, 150);
    assert.equal(opened.character.ryo, 1000);
    assert.deepEqual(opened.value.drawn, ['rare-a', 'rare-a', 'rare-a', 'rare-a', 'rare-a']);
    const replay = applyCardPackPurchase(opened.character, cards, 'standard', 'cardpack00000001', 101, () => 0);
    assert.equal(replay.ok, true);
    if (replay.ok) {
        assert.equal(replay.character.chroniclePoints, 150);
        assert.equal(replay.character.ryo, 1000);
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
        assert.equal(at1195.character.chroniclePoints, 150);
        assert.equal(at1195.character.ryo, 1000);
        assert.equal((at1195.character.tileCards as string[]).length, 1_200 + STORY_PROGRESSION_CARD_IDS.length);
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
