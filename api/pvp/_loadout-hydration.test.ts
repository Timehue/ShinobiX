import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hydrateCharacterFromSave, resolveEquippedLoadout } from './session.js';

const equippedOrder = [
    'starter-tai-fire-2',
    'custom-moon-thread',
    'missing-stale-jutsu',
    'starter-nin-fire-1',
    'starter-tai-fire-2',
];

const customJutsu = {
    id: 'custom-moon-thread',
    name: 'Moon Thread',
    type: 'Genjutsu',
    element: 'None',
    ap: 60,
    range: 4,
    effectPower: 36,
    cooldown: 7,
    chakraCost: 250,
    staminaCost: 250,
    target: 'OPPONENT',
    method: 'SINGLE',
    tags: [{ name: 'Wound', percent: 30 }],
};

describe('authoritative equipped-jutsu hydration', () => {
    const save = { savedBloodlines: [], creatorJutsus: [customJutsu] };
    const saveCharacter = {
        equippedJutsuIds: equippedOrder,
        jutsuMastery: [],
        stats: {},
        maxHp: 100,
        maxChakra: 100,
        maxStamina: 100,
        equipment: {},
    };

    it('resolves built-in and creator jutsu in saved slot order', () => {
        const resolved = resolveEquippedLoadout(saveCharacter, save, {}) as Array<{ id: string }>;
        assert.deepEqual(resolved.map((jutsu) => jutsu.id), [
            'starter-tai-fire-2',
            'custom-moon-thread',
            'starter-nin-fire-1',
        ]);
    });

    it('places that resolved loadout on the sealed combat character', () => {
        const hydrated = hydrateCharacterFromSave(saveCharacter, {}, save);
        assert.deepEqual((hydrated.jutsu as Array<{ id: string }>).map((jutsu) => jutsu.id), [
            'starter-tai-fire-2',
            'custom-moon-thread',
            'starter-nin-fire-1',
        ]);
    });
});
