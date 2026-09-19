import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { activityDestination, openActivityDestination, readActivitySection } from './activity-spine-navigation';
import { activitySourceKey } from './activity-spine-source';
import type { Character } from '../types/character';
import type { ActivitySpineItem } from '../../../shared/activity-spine';

test('every section hint selects the promised existing screen and rejects unknown destinations', () => {
    const data = new Map<string, string>();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) } });
    try {
        for (const [screen, section, key, value] of [
            ['clan', 'clan-boss', 'clan.initialView', 'boss'], ['clan', 'clan-goals', 'clan.initialView', 'missions'],
            ['profile', 'legacy', 'profile.initialTab', 'legacy'],
            ['profile', 'stats', 'profile.initialTab', 'stats'], ['shinobiTiles', 'card-deck', 'cardHall.initialTab', 'deck'],
            ['shinobiTiles', 'card-play', 'cardHall.initialTab', 'play'], ['centralHub', 'crafter', 'centralHub.initialPanel', 'crafter'],
        ]) {
            const destinations: string[] = [];
            assert.equal(openActivityDestination({ screen, section } as ActivitySpineItem, s => destinations.push(s)), true);
            assert.deepEqual(destinations, [screen]);
            assert.equal(data.get(key), value);
            assert.equal(readActivitySection(key, [value, 'default'], 'default'), value);
            // Reading twice must survive StrictMode's double initializer.
            assert.equal(readActivitySection(key, [value, 'default'], 'default'), value);
        }
        assert.equal(activityDestination('not-a-screen'), null);
        assert.equal(activityDestination('arenaDistrict'), 'arenaDistrict');
        for (const activity of [{ screen: 'unknown' }, { screen: 'missions', section: 'legacy' },
            // A section only its own destination understands is refused rather
            // than navigating somewhere that cannot honour it.
            { screen: 'profile', section: 'clan-goals' }, { screen: 'clan', section: 'stats' }, { screen: 'clan', section: 'not-a-section' }]) {
            assert.equal(openActivityDestination(activity as ActivitySpineItem, () => assert.fail('invalid navigation')), false);
        }
        // A clan recommendation with no section keeps the Clan Hall's own entry view.
        const plainClan: string[] = [];
        assert.equal(openActivityDestination({ screen: 'clan' } as ActivitySpineItem, s => plainClan.push(s)), true);
        assert.deepEqual(plainClan, ['clan']);
        assert.equal(readActivitySection('clan.initialView', ['boss', 'missions', 'exchange'], 'exchange'), 'missions',
            'the last explicit hint is what a fresh Clan Hall reads');
    } finally {
        if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
        else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
});

test('source invalidation tracks meaningful readiness and training boundaries, not regenerating vitals', () => {
    const character = { name: 'guide', level: 55, hp: 10, stamina: 10, chakra: 10, pets: [], storyProgress: 4 } as unknown as Character;
    const key = activitySourceKey(character);
    assert.equal(activitySourceKey({ ...character, hp: 11, stamina: 11, chakra: 11 }), key);
    for (const change of [{ storyProgress: 5 }, { statPoints: 1 }, { hospitalized: true }, { cardClashDeck: ['tc-01'] },
        { inventory: ['hunt-shadow-pelt'] }, { profession: 'healer' }, { clan: 'new' }, { name: 'other' },
        { patreon: { expiresAt: 100 } }, { village: 'Stormveil Village' }, { pets: [{ id: 'a', training: { endsAt: 100 } }] }]) {
        assert.notEqual(activitySourceKey({ ...character, ...change } as Character), key);
    }
    assert.notEqual(activitySourceKey(character, 'training-ready'), key);
});
