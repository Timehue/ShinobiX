import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shinobiTileCards } from '../../../shinobij.client/src/data/tile-cards.js';
import { deriveCardClashCard } from '../../../shinobij.client/src/lib/card-clash.js';
import { BUILTIN_CLASH, deriveClashStats, type TileBase } from './_card-catalog.js';

// Drift guard (audit #8): the server's canonical card stats MUST match the
// client's live derivation. The handler overrides every submitted card's stats
// with these, so a divergence here would silently alter LEGIT cards in the
// clan-war duel. Both the generated BUILTIN_CLASH table and the runtime
// deriveClashStats port (used for creator cards) are checked against the client.

const expected = (id: string) => {
    const card = shinobiTileCards.find((c) => c.id === id)!;
    const c = deriveCardClashCard(card);
    return { element: c.element, rarity: c.rarity, cost: c.cost, power: c.power, ability: c.abilityType };
};

test('BUILTIN_CLASH matches the client deriveCardClashCard for every built-in card', () => {
    assert.equal(Object.keys(BUILTIN_CLASH).length, shinobiTileCards.length, 'row count matches the catalog');
    for (const card of shinobiTileCards) {
        const server = BUILTIN_CLASH[card.id];
        assert.ok(server, `${card.id} present in BUILTIN_CLASH`);
        assert.deepEqual(server, expected(card.id), `${card.id} canonical stats match the client`);
    }
});

test('deriveClashStats (the creator-card port) matches the client derivation for every catalog card', () => {
    for (const card of shinobiTileCards) {
        const base: TileBase = {
            id: card.id, name: card.name, element: card.element, rarity: card.rarity,
            top: card.top, right: card.right, bottom: card.bottom, left: card.left,
        };
        assert.deepEqual(deriveClashStats(base), expected(card.id), `${card.id} port matches the client`);
    }
});
