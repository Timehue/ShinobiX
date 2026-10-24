import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CLASH, isMarketplaceCard } from '../clan/war/_card-catalog.js';
import { CHRONICLE_STARTER_GRANT_IDS, deckLimitForCard, getChronicleCard } from '../../shared/chronicle-duel.js';
import {
    applyCardPackOpen, cardPackBaseCost, cardPackCost, cardPackDiscountPercent, parseCardPackType,
    splitSurplusCardCopies, CARD_DUPLICATE_CONVERSION, CARD_PACK_TYPES, CARD_PLAYSET_COPIES, type CardPackType,
} from './_pack.js';
import { sanitizeCardsAndHistory } from '../save/_sanitize-cards-history.js';

/** A draw that never repeats a card inside one pack (every pool has more than
 *  five cards), so a fixture's numbers are not moved by the duplicate rule. */
const distinct = () => { let i = 0; return (max: number) => (i++) % max; };

/** The exact eligible pool a pack draws from, in draw-index order. */
function poolOf(type: CardPackType): string[] {
    const ids: string[] = [];
    let size = 1;
    for (let index = 0; index < size; index++) {
        const opened = applyCardPackOpen({ fateShards: 1000, chroniclePoints: 1000, tileCards: [] }, type, (max) => { size = max; return index; });
        assert.equal(opened.ok, true, type);
        if (opened.ok) ids.push(opened.cards[0]);
    }
    return ids;
}

test('each elemental Basic pack draws five matching Monsters for 100 Chronicle Points', () => {
    for (const element of ['fire', 'water', 'earth', 'wind', 'lightning'] as const) {
        assert.equal(parseCardPackType(element), element);
        const character = { chroniclePoints: 100, ryo: 1000, fateShards: 50, tileCards: [] };
        assert.equal(cardPackCost(character, element), 100);
        const opened = applyCardPackOpen(character, element, distinct());
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

test('Summoning Calls, their Monsters and Shadow Clone come from the Legendary packs', () => {
    // Owner ruling 2026-10-14: all eleven are Legendary and Legendary-pack-only.
    const added = [
        'chronicle-call-of-the-cinderhorn', 'summon-cinderhorn-qilin',
        'chronicle-call-of-the-rimetide', 'summon-rimetide-leviathan',
        'chronicle-call-of-the-ironroot', 'summon-ironroot-tortoise',
        'chronicle-call-of-the-galewing', 'summon-galewing-tengu',
        'chronicle-call-of-the-stormcrown', 'summon-stormcrown-raiju',
        'chronicle-shadow-clone',
    ];
    const legendaryPool = new Set<string>();
    let poolSize = 1;
    for (let index = 0; index < poolSize; index++) {
        const opened = applyCardPackOpen({ fateShards: 30, tileCards: [] }, 'legendary', (max) => {
            poolSize = max;
            return index;
        });
        assert.equal(opened.ok, true);
        if (opened.ok) legendaryPool.add(opened.cards[0]);
    }
    for (const id of added) {
        assert.equal(getChronicleCard(id)?.rarity, 'legendary', id);
        assert.equal(isMarketplaceCard(id), true, `${id} sells in the Grand Marketplace`);
        assert.ok(legendaryPool.has(id), `${id} drops from the Legendary pack`);
    }
    // And never from the Basic (Chronicle Point) packs.
    const basicPool = Object.entries(BUILTIN_CLASH)
        .filter(([id, card]) => ['common', 'rare'].includes(card.rarity) && !isMarketplaceCard(id))
        .map(([id]) => id);
    for (const id of added) assert.equal(basicPool.includes(id), false, id);
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
    const opened = applyCardPackOpen(character, 'standard', distinct());
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
    const exact = applyCardPackOpen({ chroniclePoints: 100, tileCards: [] }, 'standard', distinct());
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
    const epic = applyCardPackOpen({ fateShards: 6, tileCards: [] }, 'epic', (max) => max - 1);
    assert.equal(epic.ok, true);
    if (epic.ok) {
        assert.equal(epic.balance, 0);
        assert.equal(epic.cards.length, 1);
        // Elite pack: a Marketplace Rare or Epic.
        assert.ok(['rare', 'epic'].includes(BUILTIN_CLASH[epic.cards[0]].rarity));
        assert.equal(isMarketplaceCard(epic.cards[0]), true);
    }
    const legendary = applyCardPackOpen({ fateShards: 19, tileCards: [], elderFocus: 'trade' }, 'legendary', () => 0);
    assert.equal(legendary.ok, true, '5% trade discount floors 20 to 19');
    if (legendary.ok) {
        assert.equal(legendary.cost, 19);
        assert.equal(legendary.balance, 0);
        assert.equal(BUILTIN_CLASH[legendary.cards[0]].rarity, 'legendary');
        assert.equal(isMarketplaceCard(legendary.cards[0]), true);
    }
});

for (const [type, rarity, cost] of [['epic-five', 'epic', 35], ['legendary-five', 'legendary', 100]] as const) {
    test(`${type}: five random cards of the guaranteed rarity cost ${cost} Fate Shards`, () => {
        assert.equal(parseCardPackType(type), type);
        const character = { fateShards: cost, chroniclePoints: 500, ryo: 1234, tileCards: [] };
        const opened = applyCardPackOpen(character, type, distinct());
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
        applyCardPackOpen({ fateShards: 5, tileCards: [] }, 'epic', () => 0),
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
    // Five pulls of one card: copies past the third convert instead of landing.
    if (opened.ok) assert.equal((opened.character.tileCards as unknown[]).length, 1205 - opened.converted.length);
});

test('the fixed Traveler codex floor never consumes purchasable collection capacity', () => {
    const opened = applyCardPackOpen({
        chroniclePoints: 999,
        tileCards: [...CHRONICLE_STARTER_GRANT_IDS, ...Array(1195).fill('tc-142')],
    }, 'standard', () => 0);
    assert.equal(opened.ok, true);
    if (opened.ok) {
        assert.equal((opened.character.tileCards as unknown[]).length,
            CHRONICLE_STARTER_GRANT_IDS.length + 1200 - opened.converted.length);
    }
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
    assert.equal(opened.cards.length, 1);
    assert.ok(completedLegendaryTier.includes(opened.cards[0]));
    // A card held at a full 3-copy playset converts; a deck-limit-1 or -2 card
    // held at its limit is still kept as a tradeable copy.
    const convertsAtLimit = deckLimitForCard(opened.cards[0]) >= CARD_PLAYSET_COPIES;
    assert.equal(opened.refund.fateShards, convertsAtLimit ? CARD_DUPLICATE_CONVERSION.legendary.fateShards : 0);
    assert.equal(opened.balance, 999 - 20 + opened.refund.fateShards);
});

for (const type of CARD_PACK_TYPES) {
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
            // The same draw happens; every copy past the playset converts.
            assert.deepEqual(second.cards, first.cards);
            assert.deepEqual(second.character.tileCards, owned);
            assert.equal(second.converted.length, second.cards.length);
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

test('Legendary pulls beyond the playset convert, and the kept copies survive a later generic character save', () => {
    const first = applyCardPackOpen({ fateShards: 200, tileCards: [] }, 'legendary-five', () => 0);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.converted.length, 2, 'three copies kept, two converted');
    const second = applyCardPackOpen(first.character, 'legendary-five', () => 0);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.converted.length, 5);
    assert.deepEqual(second.cards, Array(5).fill(first.cards[0]), 'the reveal still lists every pull');
    assert.deepEqual(second.character.tileCards, Array(CARD_PLAYSET_COPIES).fill(first.cards[0]));
    // 200 - 2 x 100 spent, 7 surplus Legendaries x 3 back.
    assert.equal(second.character.fateShards, 21);
    const laterSave = structuredClone(second.character);
    sanitizeCardsAndHistory(laterSave, second.character);
    assert.deepEqual(laterSave.tileCards, second.character.tileCards);
});

test('Grand Marketplace singles cost Elite 6 and Legendary 20 Fate Shards; the trade elder pays 5 and 19', () => {
    assert.equal(cardPackBaseCost('epic'), 6);
    assert.equal(cardPackBaseCost('legendary'), 20);
    assert.equal(cardPackCost({}, 'epic'), 6);
    assert.equal(cardPackCost({ elderFocus: 'trade' }, 'epic'), 5);
    assert.equal(cardPackCost({}, 'legendary'), 20);
    assert.equal(cardPackCost({ elderFocus: 'trade' }, 'legendary'), 19);
    // Per card, a single now matches its Quintet: 20 per Legendary, 35 / 5 = 7 per Epic.
    assert.equal(cardPackBaseCost('legendary'), cardPackBaseCost('legendary-five') / 5);
    assert.equal(cardPackBaseCost('epic-five'), 35);
});

test('a pulled copy beyond the third converts by rarity; the draw itself is unchanged', () => {
    const basic = poolOf('standard');
    const elite = poolOf('epic');
    const legendary = poolOf('legendary');
    const first = (pool: string[], rarity: string) => {
        const index = pool.findIndex((id) => BUILTIN_CLASH[id].rarity === rarity);
        assert.ok(index >= 0, `the pool holds a ${rarity}`);
        return { index, id: pool[index] };
    };
    const cases = [
        { type: 'standard', pick: first(basic, 'common'), chroniclePoints: 5, fateShards: 0 },
        { type: 'standard', pick: first(basic, 'rare'), chroniclePoints: 5, fateShards: 0 },
        { type: 'epic', pick: first(elite, 'epic'), chroniclePoints: 0, fateShards: 1 },
        { type: 'epic', pick: first(elite, 'rare'), chroniclePoints: 5, fateShards: 0 },
        { type: 'legendary', pick: first(legendary, 'legendary'), chroniclePoints: 0, fateShards: 3 },
    ] as const;
    for (const { type, pick, chroniclePoints, fateShards } of cases) {
        const owned = Array(CARD_PLAYSET_COPIES).fill(pick.id);
        const opened = applyCardPackOpen({ chroniclePoints: 500, fateShards: 500, tileCards: owned }, type, () => pick.index);
        assert.equal(opened.ok, true, `${type} ${pick.id}`);
        if (!opened.ok) continue;
        const count = opened.cards.length;
        assert.deepEqual(opened.cards, Array(count).fill(pick.id), 'cards still lists the draw');
        assert.deepEqual(opened.character.tileCards, owned, 'no fourth copy joins the collection');
        assert.deepEqual(opened.refund, { chroniclePoints: chroniclePoints * count, fateShards: fateShards * count });
        assert.deepEqual(opened.converted.map((entry) => entry.index), [...Array(count).keys()]);
        assert.ok(opened.converted.every((entry) => entry.cardId === pick.id
            && entry.chroniclePoints === chroniclePoints && entry.fateShards === fateShards));
        const cost = cardPackCost({}, type);
        const spentCp = opened.currency === 'chroniclePoints' ? cost : 0;
        const spentFs = opened.currency === 'fateShards' ? cost : 0;
        assert.equal(opened.character.chroniclePoints, 500 - spentCp + chroniclePoints * count);
        assert.equal(opened.character.fateShards, 500 - spentFs + fateShards * count);
        assert.equal(opened.balance, opened.character[opened.currency]);
    }
});

test('copies kept earlier in the same pack count toward the playset', () => {
    const [id] = poolOf('standard');
    const opened = applyCardPackOpen({ chroniclePoints: 100, tileCards: [id] }, 'standard', () => 0);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.deepEqual(opened.character.tileCards, [id, id, id], 'two of the five pulls are kept');
    assert.deepEqual(opened.converted.map((entry) => entry.index), [2, 3, 4], 'the later three convert, in draw order');
    assert.equal(opened.refund.chroniclePoints, 3 * CARD_DUPLICATE_CONVERSION.common.chroniclePoints);
    assert.equal(opened.balance, 15);
});

test('starter-codex copies count toward the playset', () => {
    const basic = poolOf('standard');
    const starterCounts = new Map<string, number>();
    for (const id of CHRONICLE_STARTER_GRANT_IDS) starterCounts.set(id, (starterCounts.get(id) ?? 0) + 1);
    const index = basic.findIndex((id) => (starterCounts.get(id) ?? 0) >= CARD_PLAYSET_COPIES);
    assert.ok(index >= 0, 'the codex holds a full playset of some Basic-pool card');
    const opened = applyCardPackOpen({ chroniclePoints: 100, tileCards: [...CHRONICLE_STARTER_GRANT_IDS] }, 'standard', () => index);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.converted.length, 5, 'a codex playset converts the very first pull');
    assert.deepEqual(opened.character.tileCards, [...CHRONICLE_STARTER_GRANT_IDS]);
});

test('a refused open spends, draws, converts and refunds nothing', () => {
    const [id] = poolOf('legendary');
    const short = { fateShards: 19, tileCards: Array(CARD_PLAYSET_COPIES).fill(id) };
    const before = structuredClone(short);
    let draws = 0;
    assert.deepEqual(applyCardPackOpen(short, 'legendary', () => { draws++; return 0; }),
        { ok: false, status: 409, error: 'Not enough Fate Shards.' });
    assert.deepEqual(short, before);
    const full = { chroniclePoints: 999, tileCards: Array(1200).fill('tc-01') };
    assert.deepEqual(applyCardPackOpen(full, 'standard', () => { draws++; return 0; }),
        { ok: false, status: 409, error: 'Card collection is capped at 1200.' });
    assert.equal(full.chroniclePoints, 999);
    assert.equal(full.tileCards.length, 1200);
    assert.equal(draws, 0, 'a refused open never draws');
});

test('the duplicate rebate never reaches the price, so packs cannot fund themselves', () => {
    for (const type of CARD_PACK_TYPES) {
        const pool = poolOf(type);
        const owned = pool.flatMap((id) => Array(CARD_PLAYSET_COPIES).fill(id));
        const tradeCost = cardPackCost({ elderFocus: 'trade' }, type);
        let worst = 0;
        let currency = '';
        for (let index = 0; index < pool.length; index++) {
            const opened = applyCardPackOpen({ chroniclePoints: 1000, fateShards: 1000, tileCards: owned, elderFocus: 'trade' }, type, () => index);
            assert.equal(opened.ok, true, type);
            if (!opened.ok) continue;
            assert.equal(opened.converted.length, opened.cards.length, `${type}: a full playset converts every pull`);
            currency = opened.currency;
            worst = Math.max(worst, opened.refund[opened.currency as 'chroniclePoints' | 'fateShards']);
        }
        // Rebate in the pack's own currency, at the cheapest (trade-elder) price.
        const share = worst / tradeCost;
        const ceiling = currency === 'chroniclePoints' ? 0.25 : 0.2;
        assert.ok(share > 0 && share <= ceiling, `${type} rebates ${share} of its price (ceiling ${ceiling})`);
    }
});

test('a card with no known rarity is always kept, never silently converted', () => {
    const split = splitSurplusCardCopies(['mystery', 'mystery', 'mystery'], ['mystery', 'tc-01'], (id) => id === 'tc-01' ? 'common' : undefined);
    assert.deepEqual(split.kept, ['mystery', 'tc-01']);
    assert.deepEqual(split.converted, []);
    assert.deepEqual(split.refund, { chroniclePoints: 0, fateShards: 0 });
    const proto = splitSurplusCardCopies(Array(3).fill('x'), ['x'], () => 'toString');
    assert.deepEqual(proto.kept, ['x'], 'inherited object keys are not a rarity');
});
