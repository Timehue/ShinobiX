import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CLASH, isMarketplaceCard } from '../clan/war/_card-catalog.js';
import { CHRONICLE_STARTER_GRANT_IDS, deckLimitForCard, getChronicleCard } from '../../shared/chronicle-duel.js';
import { applyCardPackOpen, cardPackCost, cardPackDiscountPercent, parseCardPackType, CARD_PACK_TYPES } from './_pack.js';
import { sanitizeCardsAndHistory } from '../save/_sanitize-cards-history.js';

test('each elemental Basic pack draws five matching Monsters for 100 Chronicle Points', () => {
    for (const element of ['fire', 'water', 'earth', 'wind', 'lightning'] as const) {
        assert.equal(parseCardPackType(element), element);
        const character = { chroniclePoints: 100, ryo: 1000, fateShards: 50, tileCards: [] };
        assert.equal(cardPackCost(character, element), 100);
        const opened = applyCardPackOpen(character, element, (max) => max - 1);
        assert.equal(opened.ok, true, element);
        if (!opened.ok) continue;
        assert.equal(opened.cards.length, 5);
        assert.equal(opened.balance, 0);
        assert.equal(opened.character.ryo, 1000);
        assert.equal(opened.character.fateShards, 50);
        for (const id of opened.cards) {
            const card = getChronicleCard(id);
            assert.equal(card?.cardClass, 'monster');
            if (card?.cardClass === 'monster') assert.equal(card.element.toLowerCase(), element);
            assert.ok(['common', 'rare'].includes(BUILTIN_CLASH[id].rarity));
            assert.equal(isMarketplaceCard(id), false);
        }
    }
});

test('the Random Pack keeps neutral Jutsu and Snares in its mixed Basic pool', () => {
    const pool = Object.entries(BUILTIN_CLASH)
        .filter(([id, card]) => ['common', 'rare'].includes(card.rarity) && !isMarketplaceCard(id))
        .map(([id]) => id);
    const supportIndex = pool.findIndex((id) => getChronicleCard(id)?.cardClass !== 'monster');
    assert.ok(supportIndex >= 0);
    const opened = applyCardPackOpen({ chroniclePoints: 100, tileCards: [] }, 'standard', () => supportIndex);
    assert.equal(opened.ok, true);
    if (opened.ok) assert.notEqual(getChronicleCard(opened.cards[0])?.cardClass, 'monster');
});

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
    // Basic pack draws Commons and Rares outside the premium pool.
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

test('premium packs debit Fate Shards and draw only Marketplace cards', () => {
    const epic = applyCardPackOpen({ fateShards: 10, tileCards: [] }, 'epic', (max) => max - 1);
    assert.equal(epic.ok, true);
    if (epic.ok) {
        assert.equal(epic.balance, 0);
        assert.equal(epic.cards.length, 1);
        // Elite pack: a Marketplace Rare or Epic.
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

for (const [type, rarity, cost] of [['epic-five', 'epic', 35], ['legendary-five', 'legendary', 100]] as const) {
    test(`${type}: five random cards of the guaranteed rarity cost ${cost} Fate Shards`, () => {
        assert.equal(parseCardPackType(type), type);
        const character = { fateShards: cost, chroniclePoints: 500, ryo: 1234, tileCards: [] };
        const opened = applyCardPackOpen(character, type, (max) => max - 1);
        assert.equal(opened.ok, true);
        if (!opened.ok) return;
        assert.equal(opened.currency, 'fateShards');
        assert.equal(opened.cost, cost);
        assert.equal(opened.balance, 0);
        assert.equal(opened.cards.length, 5);
        assert.deepEqual(opened.character.tileCards, opened.cards);
        assert.equal(opened.character.ryo, 1234);
        assert.equal(opened.character.chroniclePoints, 500);
        for (const id of opened.cards) {
            assert.equal(BUILTIN_CLASH[id].rarity, rarity);
            assert.equal(isMarketplaceCard(id), true);
        }
        assert.deepEqual(character.tileCards, []);
        assert.equal(character.fateShards, cost);
        assert.equal(cardPackCost({ elderFocus: 'trade' }, type), Math.floor(cost * .95));
    });

    test(`${type}: insufficient shards or inventory room spends nothing`, () => {
        const short = { fateShards: cost - 1, tileCards: [] };
        assert.deepEqual(applyCardPackOpen(short, type, () => 0), {
            ok: false, status: 409, error: 'Not enough Fate Shards.',
        });
        assert.equal(short.fateShards, cost - 1);
        const full = { fateShards: cost, tileCards: Array(1196).fill('tc-142') };
        assert.deepEqual(applyCardPackOpen(full, type, () => 0), {
            ok: false, status: 409, error: 'Card collection is capped at 1200.',
        });
        assert.equal(full.fateShards, cost);
    });
}

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

test('owning every Legendary at its deck limit still allows Legendary pack purchases', () => {
    const legendaryPool = Object.entries(BUILTIN_CLASH)
        .filter(([, card]) => card.rarity === 'legendary')
        .map(([id]) => id);
    const completedLegendaryTier = legendaryPool.flatMap((id) =>
        Array(deckLimitForCard(id)).fill(id),
    );
    const opened = applyCardPackOpen(
        { fateShards: 999, tileCards: completedLegendaryTier },
        'legendary',
        () => 0,
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.balance, 969);
    assert.equal(opened.cards.length, 1);
    assert.ok(completedLegendaryTier.includes(opened.cards[0]));
});

for (const type of CARD_PACK_TYPES) {
    test(`${type}: every eligible card occupies exactly one random index`, () => {
        const premium = ['epic', 'legendary', 'epic-five', 'legendary-five'].includes(type);
        const rarities = type === 'epic' ? ['rare', 'epic'] : type === 'epic-five' ? ['epic']
            : type.startsWith('legendary') ? ['legendary'] : ['common', 'rare'];
        const expected = Object.entries(BUILTIN_CLASH).filter(([id, card]) => {
            if (!rarities.includes(card.rarity) || isMarketplaceCard(id) !== premium) return false;
            const source = getChronicleCard(id);
            if (['fire', 'water', 'earth', 'wind', 'lightning'].includes(type)) {
                return source?.cardClass === 'monster' && source.element.toLowerCase() === type;
            }
            if (type === 'snare') return source?.cardClass === 'trap';
            if (type === 'jutsu') return source?.cardClass === 'magic';
            return true;
        }).map(([id]) => id);
        assert.ok(expected.length > 1, 'the fixture must exercise a nontrivial pool');
        const seen: string[] = [];
        for (let index = 0; index < expected.length; index++) {
            const opened = applyCardPackOpen({ fateShards: 1000, chroniclePoints: 1000, tileCards: [] }, type, (max) => {
                assert.equal(max, expected.length, 'random range must include each eligible card once');
                return index;
            });
            assert.ok(opened.ok);
            seen.push(opened.cards[0]);
            assert.deepEqual(opened.cards, Array(opened.cards.length).fill(opened.cards[0]), 'every draw uses the same full pool');
        }
        // A weighted pool, omitted card, duplicate index, or tier-first draw
        // fails deterministically; there is no flaky statistical sampling.
        assert.deepEqual(seen.sort(), expected.sort());
    });

    test(`${type}: draws independently with replacement even beyond owned deck limits`, () => {
        const character = { fateShards: 1000, chroniclePoints: 1000, tileCards: [] };
        const poolSizes: number[] = [];
        const first = applyCardPackOpen(character, type, (max) => { poolSizes.push(max); return 0; });
        assert.equal(first.ok, true);
        if (!first.ok) return;
        assert.ok(poolSizes[0] > 1, `${type} needs a real random pool`);
        assert.equal(poolSizes.length, first.cards.length, 'each card gets its own random draw');
        assert.ok(poolSizes.every((size) => size === poolSizes[0]), 'pulls must not shrink the eligible pool');
        assert.deepEqual(first.cards, Array(first.cards.length).fill(first.cards[0]));
        const owned = Array(deckLimitForCard(first.cards[0]) + 5).fill(first.cards[0]);
        const second = applyCardPackOpen({ ...character, tileCards: owned }, type, (max) => {
            assert.equal(max, poolSizes[0], 'ownership must not affect draw odds');
            return 0;
        });
        assert.equal(second.ok, true);
        if (second.ok) {
            assert.deepEqual(second.cards, first.cards);
            assert.deepEqual(second.character.tileCards, [...owned, ...first.cards]);
        }
        const different = applyCardPackOpen(character, type, (max) => max - 1);
        assert.equal(different.ok, true);
        if (different.ok) {
            assert.notEqual(different.cards[0], first.cards[0], 'random index determines the awarded card');
            const premium = ['epic', 'legendary', 'epic-five', 'legendary-five'].includes(type);
            const rarities = type === 'epic' ? ['rare', 'epic'] : type === 'epic-five' ? ['epic']
                : type.startsWith('legendary') ? ['legendary'] : ['common', 'rare'];
            for (const id of [...first.cards, ...different.cards]) {
                assert.ok(rarities.includes(BUILTIN_CLASH[id].rarity), `${type} rarity restriction`);
                assert.equal(isMarketplaceCard(id), premium, `${type} storefront restriction`);
                const source = getChronicleCard(id);
                if (['fire', 'water', 'earth', 'wind', 'lightning'].includes(type)) {
                    assert.equal(source?.cardClass, 'monster');
                    if (source?.cardClass === 'monster') assert.equal(source.element.toLowerCase(), type);
                }
                if (type === 'snare') assert.equal(source?.cardClass, 'trap');
                if (type === 'jutsu') assert.equal(source?.cardClass, 'magic');
            }
        }
    });
}

test('five duplicate Legendary pulls survive a later generic character save', () => {
    const first = applyCardPackOpen({ fateShards: 200, tileCards: [] }, 'legendary-five', () => 0);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = applyCardPackOpen(first.character, 'legendary-five', () => 0);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.deepEqual(second.character.tileCards, Array(10).fill(first.cards[0]));
    const laterSave = structuredClone(second.character);
    sanitizeCardsAndHistory(laterSave, second.character);
    assert.deepEqual(laterSave.tileCards, second.character.tileCards);
});
