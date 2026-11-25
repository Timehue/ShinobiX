import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCardPackOpen, type CardPackType } from '../../../api/card-clash/_pack';
import { resolveChronicleDeckMutation } from '../../../api/card-clash/_deck';
import { sanitizeCardsAndHistory } from '../../../api/save/_sanitize-cards-history';
import { CHRONICLE_FIXED_FALLBACK_DECK, createMatch } from '../../../shared/chronicle-duel';
import { CHRONICLE_VILLAGE_MONSTERS } from '../../../shared/chronicle-village-monsters';
import { CHRONICLE_VILLAGE_SUPPORT } from '../../../shared/chronicle-village-support';
import { buildChronicleDeck, canAddChronicleCard, chronicleInventoryCatalog, displayCardsById, ownedChronicleCounts } from './chronicle-duel';

test('every village card and Crimson Weaver can travel from its specialty pack into a saved duel deck', () => {
    const expected = new Map<string, CardPackType>();
    for (const card of CHRONICLE_VILLAGE_MONSTERS) expected.set(card.id, card.element.toLowerCase() as CardPackType);
    for (const card of CHRONICLE_VILLAGE_SUPPORT) expected.set(card.id, card.cardClass === 'magic' ? 'jutsu' : 'snare');
    expected.set('chronicle-crimson-weaver', 'epic-five');
    const handCatalog = displayCardsById([]);
    const backpack = new Map(chronicleInventoryCatalog([]).map(card => [card.id, card]));
    const checked = new Set<string>();
    const starter = [...CHRONICLE_FIXED_FALLBACK_DECK];
    for (const type of new Set(expected.values())) {
        let size = 1;
        for (let index = 0; index < size; index++) {
            const buyer = { chroniclePoints: 100, fateShards: 21, tileCards: starter };
            const purchase = applyCardPackOpen(buyer, type, poolSize => { size = poolSize; return index; });
            if (!purchase.ok) assert.fail(purchase.error);
            const id = purchase.cards[0];
            if (expected.get(id) !== type) continue;
            assert.equal(purchase.cards.length, 3, id);
            const owned = purchase.character.tileCards as string[];
            assert.equal(ownedChronicleCounts(owned).get(id), 3, id);
            const displayed = handCatalog[id];
            assert.ok(displayed?.image, id);
            assert.equal(backpack.get(id)?.name, displayed.name, id);
            assert.equal(backpack.get(id)?.image, displayed.image, id);

            const rest = starter.slice(1);
            assert.equal(canAddChronicleCard(rest, id, ownedChronicleCounts(owned)), null, id);
            const deck = [id, ...rest];
            const saved = { ...purchase.character, cardClashDeck: deck };
            sanitizeCardsAndHistory(saved, purchase.character);
            assert.deepEqual(buildChronicleDeck(saved.cardClashDeck, owned), deck, id);
            const resolved = resolveChronicleDeckMutation(saved, []);
            if (!resolved.ok) assert.fail(resolved.error);
            assert.deepEqual(resolved.value.deck, deck, id);
            const duel = createMatch('First', resolved.value.deck, 'Second', starter, () => 0.999);
            assert.equal(duel.p1.hand[0], id);
            checked.add(id);
        }
    }
    assert.deepEqual(checked, new Set(expected.keys()));
});
