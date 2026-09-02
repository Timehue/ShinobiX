import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CLASH, isMarketplaceCard } from '../clan/war/_card-catalog.js';
import { CHRONICLE_STARTER_GRANT_IDS, deckLimitForCard } from '../../shared/chronicle-duel.js';
import { applyCardPackOpen, cardPackCost, cardPackDiscountPercent } from './_pack.js';

test('the Basic pack costs exactly 100 Chronicle Points, ignores ryo-economy discounts, and never touches ryo', () => {
    const character = {
        ryo: 1_000,
        fateShards: 50,
        chroniclePoints: 150,
        tileCards: ['tc-01'],
        villageUpgrades: { shop: 20 },       // would be 5% on a ryo pack
        elderFocus: 'trade',                 // would be 5%
        clanUpgradeLevels: { blacksmith: 25 }, // would be 5%
        clanDoctrine: 'merchant',            // would be 5%
    };
    // Chronicle Points sit outside the ryo economy: no discount ever applies.
    assert.equal(cardPackDiscountPercent(character, 'standard'), 0);
    assert.equal(cardPackCost(character, 'standard'), 100);
    const opened = applyCardPackOpen(character, 'standard', () => 0);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.currency, 'chroniclePoints');
    assert.equal(opened.cost, 100);
    assert.equal(opened.balance, 50);
    assert.equal(opened.character.chroniclePoints, 50);
    // The debit and the grant ride one atomic character write; ryo and Fate
    // Shards are byte-identical before and after.
    assert.equal(opened.character.ryo, 1_000);
    assert.equal(opened.character.fateShards, 50);
    assert.equal(opened.cards.length, 5);
    assert.equal(opened.character.tileCards instanceof Array, true);
    // Shop pack draws only the weaker half: Commons + non-marketplace Rares.
    for (const id of opened.cards) {
        assert.ok(['common', 'rare'].includes(BUILTIN_CLASH[id].rarity));
        assert.equal(isMarketplaceCard(id), false);
    }
});

test('a player with exactly 100 Chronicle Points can buy the Basic pack; 99 cannot, and nothing is spent', () => {
    const exact = applyCardPackOpen({ chroniclePoints: 100, tileCards: [] }, 'standard', () => 0);
    assert.equal(exact.ok, true);
    if (exact.ok) assert.equal(exact.balance, 0);
    const character = { chroniclePoints: 99, ryo: 999_999, fateShards: 999, tileCards: [] };
    const short = applyCardPackOpen(character, 'standard', () => 0);
    assert.equal(short.ok, false);
    if (!short.ok) assert.equal(short.status, 409);
    // Refusal spends nothing anywhere — ryo can never be a fallback.
    assert.equal(character.chroniclePoints, 99);
    assert.equal(character.ryo, 999_999);
    assert.equal(character.fateShards, 999);
});

test('premium packs debit Fate Shards and draw only best-50% Marketplace cards', () => {
    const epic = applyCardPackOpen({ fateShards: 10, tileCards: [] }, 'epic', (max) => max - 1);
    assert.equal(epic.ok, true);
    if (epic.ok) {
        assert.equal(epic.balance, 0);
        assert.equal(epic.cards.length, 1);
        // Elite pack: a best-50% Rare or Epic.
        assert.ok(['rare', 'epic'].includes(BUILTIN_CLASH[epic.cards[0]].rarity));
        assert.equal(isMarketplaceCard(epic.cards[0]), true);
    }
    const legendary = applyCardPackOpen({ fateShards: 29, tileCards: [], elderFocus: 'trade' }, 'legendary', () => 0);
    assert.equal(legendary.ok, true, '5% trade discount floors 30 to 28');
    if (legendary.ok) {
        assert.equal(legendary.cost, 28);
        assert.equal(legendary.balance, 1);
        assert.equal(BUILTIN_CLASH[legendary.cards[0]].rarity, 'legendary');
        assert.equal(isMarketplaceCard(legendary.cards[0]), true);
    }
});

test('pack opening fails closed for invalid type, insufficient balance, and collection cap', () => {
    assert.deepEqual(
        applyCardPackOpen({ ryo: 999, tileCards: [] }, 'forged', () => 0),
        { ok: false, status: 400, error: 'Invalid card pack.' },
    );
    assert.deepEqual(
        applyCardPackOpen({ fateShards: 9, tileCards: [] }, 'epic', () => 0),
        { ok: false, status: 409, error: 'Not enough Fate Shards.' },
    );
    // A ryo fortune buys nothing from the Basic pack: it trades only in
    // Chronicle Points, and the shortage message says where to earn them.
    const ryoRich = applyCardPackOpen({ ryo: 999_999, tileCards: [] }, 'standard', () => 0);
    assert.equal(ryoRich.ok, false);
    if (!ryoRich.ok) assert.match(ryoRich.error, /Chronicle Points.*Echoes of War/);
    const capped = applyCardPackOpen({ chroniclePoints: 999, tileCards: Array(1200).fill('tc-01') }, 'standard', () => 0);
    assert.deepEqual(capped, { ok: false, status: 409, error: 'Card collection is capped at 1200.' });
});

test('earned Chronicle records never consume the 1200-card pack inventory budget', () => {
    assert.equal(BUILTIN_CLASH['story-wandering-sage'], undefined);
    assert.equal(BUILTIN_CLASH['legacy-first-flame'], undefined);
    assert.equal(BUILTIN_CLASH['pet-witness-fire'], undefined);
    const opened = applyCardPackOpen({
        chroniclePoints: 999,
        tileCards: [
            ...Array(1195).fill('tc-01'),
            'story-wandering-sage',
            'legacy-first-flame',
            'pet-witness-fire',
            'pet-witness-water',
            'pet-witness-earth',
        ],
    }, 'standard', () => 0);
    assert.equal(opened.ok, true);
    if (opened.ok) assert.equal((opened.character.tileCards as unknown[]).length, 1205);
});

test('the fixed Traveler codex floor never consumes purchasable collection capacity', () => {
    const opened = applyCardPackOpen({
        chroniclePoints: 999,
        tileCards: [...CHRONICLE_STARTER_GRANT_IDS, ...Array(1195).fill('tc-142')],
    }, 'standard', () => 0);
    assert.equal(opened.ok, true);
    if (opened.ok) assert.equal((opened.character.tileCards as unknown[]).length, CHRONICLE_STARTER_GRANT_IDS.length + 1200);
});

test('packs prefer useful second and third deck copies and protect completed tiers', () => {
    const standardPool = Object.entries(BUILTIN_CLASH)
        .filter(([id, card]) => ['common', 'rare'].includes(card.rarity) && !isMarketplaceCard(id))
        .map(([id]) => id);
    const cappedId = standardPool[0];
    const opened = applyCardPackOpen(
        { chroniclePoints: 999, tileCards: [cappedId, cappedId, cappedId] },
        'standard',
        () => 0,
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.notEqual(opened.cards[0], cappedId);

    const legendaryPool = Object.entries(BUILTIN_CLASH)
        .filter(([, card]) => card.rarity === 'legendary')
        .map(([id]) => id);
    const completedLegendaryTier = legendaryPool.flatMap((id) =>
        Array(deckLimitForCard(id)).fill(id),
    );
    const protectedOpen = applyCardPackOpen(
        { fateShards: 999, tileCards: completedLegendaryTier },
        'legendary',
        () => 0,
    );
    assert.deepEqual(protectedOpen, {
        ok: false,
        status: 409,
        error: 'This pack tier cannot provide another playable card. No currency was spent.',
    });
});
