import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAnnouncement } from './announcements.js';
import { publicHallEntry } from './hall-of-legends.js';

test('public Legacy announcement projection hides tier classifications', () => {
    const projected = publicAnnouncement({
        id: 1,
        ts: 2,
        type: 'mythic_legacy',
        importance: 'mythic',
        title: 'A MYTHIC LEGACY AWAKENS',
        message: 'A legendary path has reached its summit.',
        player: 'Kakashi',
        legacyId: 'hundred-storms',
        meta: { rarity: 'mythic', stage: 2 },
    });

    assert.equal(projected.type, 'legacy_milestone');
    assert.equal(projected.importance, 'high');
    assert.doesNotMatch(`${projected.title} ${projected.message}`, /mythic|legendary/i);
    assert.equal(projected.meta?.rarity, undefined);
    assert.equal(projected.meta?.stage, 2);
});

test('public Hall projection hides old tier fields, types, and copy', () => {
    const projected = publicHallEntry({
        id: 1,
        ts: 2,
        entryType: 'mythic_legacy_claim',
        title: 'Mythic Legacy — Claimed',
        description: 'The first legendary path was chosen.',
        player: 'Kakashi',
        legacyId: 'hundred-storms',
        rarity: 'mythic',
        status: 'active',
        meta: { rarity: 'mythic', stage: 1 },
    });

    assert.equal(projected.entryType, 'legacy_milestone');
    assert.doesNotMatch(`${projected.title} ${projected.description}`, /mythic|legendary/i);
    assert.equal('rarity' in projected, false);
    assert.equal(projected.meta?.rarity, undefined);
    assert.equal(projected.meta?.stage, 1);
});

test('non-Legacy world records preserve their public importance and wording', () => {
    const projected = publicAnnouncement({
        id: 3,
        ts: 4,
        type: 'world_crisis_awakened',
        importance: 'mythic',
        title: 'Mythic storm',
        message: 'The world is changing.',
    });

    assert.equal(projected.type, 'world_crisis_awakened');
    assert.equal(projected.importance, 'mythic');
    assert.equal(projected.title, 'Mythic storm');
});
