import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHRONICLE_CARD_CATALOG } from '../../../shared/chronicle-duel.js';
import { isChronicleProgressionCardId } from '../../card-clash/_progression-cards.js';
import { BUILTIN_CLASH, MARKETPLACE_CARD_IDS, STOREFRONT_ADDITIONS, STOREFRONT_PINS } from './_card-catalog.js';

/**
 * The Grand Marketplace as it stood before the 2026-10-14 balance pass.
 *
 * The split is derived from live card stats, so a balance change can move a
 * card between the ryo Shop and the Fate Shard Marketplace without anyone
 * deciding to. If this fails after a stat change, either pin the moved cards in
 * STOREFRONT_PINS (balance must not reshuffle the storefronts) or, if the move
 * is a deliberate economy decision, update this list in the same change.
 */
const MARKETPLACE_SNAPSHOT = [
    'chronicle-abyssal-pitfall', 'chronicle-ancestral-muster', 'chronicle-avalanche-seal', 'chronicle-chakra-jammer', 'chronicle-deathless-recall', 'chronicle-dust-exile',
    'chronicle-executioners-mandate', 'chronicle-field-desert', 'chronicle-field-lightning-storm', 'chronicle-field-ocean', 'chronicle-field-sky', 'chronicle-field-volcano',
    'chronicle-final-bulwark', 'chronicle-final-trial-binding', 'chronicle-five-seal-denial', 'chronicle-forbidden-archive', 'chronicle-giant-felling-edict', 'chronicle-great-maw-seal',
    'chronicle-grounding-rod-script', 'chronicle-hearthfire-expulsion', 'chronicle-heavenfall-verdict', 'chronicle-hundred-shrine-benediction', 'chronicle-hundredfold-tempest', 'chronicle-imperial-silence-ward',
    'chronicle-kage-archive-lock', 'chronicle-kage-exile-command', 'chronicle-kage-judgment-seal', 'chronicle-mirage-displacement', 'chronicle-mirror-moon-rebuttal', 'chronicle-mirror-shell-counter',
    'chronicle-moonshadow-slip', 'chronicle-reapers-toll', 'chronicle-returning-cylinder-seal', 'chronicle-ringed-detonation', 'chronicle-saints-edge', 'chronicle-sand-coffin-counter',
    'chronicle-skyhook-snare', 'chronicle-sovereigns-decree', 'chronicle-stacked-scrolls', 'chronicle-storm-shear', 'chronicle-stormforged-senbon', 'chronicle-substitution-mirror',
    'chronicle-thunder-cage', 'chronicle-tideguard-mantle', 'chronicle-torrential-tag-field', 'chronicle-vacuum-prison', 'chronicle-war-camp-feast', 'chronicle-windless-edict',
    'tc-100', 'tc-101', 'tc-102', 'tc-103', 'tc-104', 'tc-105',
    'tc-106', 'tc-107', 'tc-108', 'tc-109', 'tc-110', 'tc-111',
    'tc-112', 'tc-113', 'tc-114', 'tc-115', 'tc-116', 'tc-117',
    'tc-118', 'tc-119', 'tc-120', 'tc-121', 'tc-122', 'tc-123',
    'tc-124', 'tc-125', 'tc-126', 'tc-127', 'tc-128', 'tc-129',
    'tc-130', 'tc-131', 'tc-132', 'tc-133', 'tc-134', 'tc-135',
    'tc-136', 'tc-137', 'tc-138', 'tc-139', 'tc-140', 'tc-141',
    'tc-142', 'tc-143', 'tc-144', 'tc-145', 'tc-146', 'tc-147',
    'tc-148', 'tc-149', 'tc-150', 'tc-24', 'tc-25', 'tc-29',
    'tc-30', 'tc-34', 'tc-35', 'tc-40', 'tc-41', 'tc-42',
    'tc-43', 'tc-44', 'tc-45', 'tc-46', 'tc-47', 'tc-48',
    'tc-49', 'tc-50', 'tc-75', 'tc-80', 'tc-85', 'tc-90',
    'tc-95', 'tc-96', 'tc-97', 'tc-98', 'tc-99',
];

test('card balance never moves a card between the Shop and the Marketplace', () => {
    const addedToMarketplace = Object.entries(STOREFRONT_ADDITIONS)
        .flatMap(([id, storefront]) => (storefront === 'marketplace' ? [id] : []));
    assert.deepEqual(
        [...MARKETPLACE_CARD_IDS].sort(),
        [...MARKETPLACE_SNAPSHOT, ...addedToMarketplace].sort(),
    );
    // A card added after the snapshot must be placed on purpose, not ranked in:
    // ranking it would move the median and push existing cards across it.
    const snapshotCards = new Set(MARKETPLACE_SNAPSHOT);
    const preSnapshotCount = 250;
    const unplaced = Object.keys(BUILTIN_CLASH).filter(
        (id) => !snapshotCards.has(id) && !(id in STOREFRONT_ADDITIONS),
    );
    assert.equal(
        unplaced.length,
        preSnapshotCount - MARKETPLACE_SNAPSHOT.length,
        'a new packable card needs an entry in STOREFRONT_ADDITIONS',
    );
    for (const id of Object.keys(STOREFRONT_ADDITIONS))
        assert.ok(BUILTIN_CLASH[id], `${id} is not a packable card`);
    const pins = Object.values(STOREFRONT_PINS);
    assert.equal(
        pins.filter((storefront) => storefront === 'marketplace').length,
        pins.filter((storefront) => storefront === 'shop').length,
        'pins must keep the split at exactly half',
    );
    for (const id of Object.keys(STOREFRONT_PINS)) assert.ok(BUILTIN_CLASH[id], `${id} is not a packable card`);
});

test('marketplace catalog derives only pack-eligible canonical Chronicle cards', () => {
    const packEligible = CHRONICLE_CARD_CATALOG.filter((card) => !isChronicleProgressionCardId(card.id));
    assert.equal(Object.keys(BUILTIN_CLASH).length, packEligible.length);
    for (const card of packEligible) {
        assert.equal(BUILTIN_CLASH[card.id]?.rarity, card.rarity === 'mythic' ? 'legendary' : card.rarity);
    }
    assert.equal(Object.keys(BUILTIN_CLASH).some((id) => isChronicleProgressionCardId(id)), false);
});
