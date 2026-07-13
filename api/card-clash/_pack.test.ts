import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CLASH } from '../clan/war/_card-catalog.js';
import { applyCardPackOpen, cardPackCost, cardPackDiscountPercent } from './_pack.js';

test('standard pack mirrors the village, elder, clan, and doctrine discount and grants five canonical cards', () => {
    const character = {
        ryo: 1_000,
        fateShards: 50,
        tileCards: ['tc-01'],
        villageUpgrades: { shop: 20 },       // 5%
        elderFocus: 'trade',                 // 5%
        clanUpgradeLevels: { blacksmith: 25 }, // 5%
        clanDoctrine: 'merchant',            // 5%
    };
    assert.equal(cardPackDiscountPercent(character, 'standard'), 20);
    assert.equal(cardPackCost(character, 'standard'), 200);
    const opened = applyCardPackOpen(character, 'standard', () => 0);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.cost, 200);
    assert.equal(opened.balance, 800);
    assert.equal(opened.cards.length, 5);
    assert.equal(opened.character.tileCards instanceof Array, true);
    for (const id of opened.cards) assert.ok(['common', 'rare'].includes(BUILTIN_CLASH[id].rarity));
});

test('premium packs debit Fate Shards and can only draw the purchased rarity', () => {
    const epic = applyCardPackOpen({ fateShards: 10, tileCards: [] }, 'epic', (max) => max - 1);
    assert.equal(epic.ok, true);
    if (epic.ok) {
        assert.equal(epic.balance, 0);
        assert.equal(epic.cards.length, 1);
        assert.equal(BUILTIN_CLASH[epic.cards[0]].rarity, 'epic');
    }
    const legendary = applyCardPackOpen({ fateShards: 29, tileCards: [], elderFocus: 'trade' }, 'legendary', () => 0);
    assert.equal(legendary.ok, true, '5% trade discount floors 30 to 28');
    if (legendary.ok) {
        assert.equal(legendary.cost, 28);
        assert.equal(legendary.balance, 1);
        assert.equal(BUILTIN_CLASH[legendary.cards[0]].rarity, 'legendary');
    }
});

test('pack opening fails closed for invalid type, insufficient balance, and collection cap', () => {
    assert.deepEqual(
        applyCardPackOpen({ ryo: 999, tileCards: [] }, 'forged', () => 0),
        { ok: false, status: 400, error: 'Invalid card pack.' },
    );
    assert.deepEqual(
        applyCardPackOpen({ fateShards: 9, tileCards: [] }, 'epic', () => 0),
        { ok: false, status: 409, error: 'Not enough fateShards.' },
    );
    const capped = applyCardPackOpen({ ryo: 999, tileCards: Array(1200).fill('tc-01') }, 'standard', () => 0);
    assert.deepEqual(capped, { ok: false, status: 409, error: 'Card collection is capped at 1200.' });
});
