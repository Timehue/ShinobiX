import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { grantWildPet, rollWildPet } from './_encounter.js';

describe('wild pet encounter authority', () => {
    it('uses the canonical rarity thresholds and catalog', () => {
        assert.equal(rollWildPet(() => 0.5), null);
        const values = [0.001, 0]; let i = 0;
        const pet = rollWildPet(() => values[i++] ?? 0, 123);
        assert.equal(pet?.rarity, 'mythic');
        assert.match(String(pet?.id), /^mythic-\d+-123$/);
    });
    it('grants a server-rolled trait without imposing a total ownership cap', () => {
        const result = grantWildPet({ pets: [] }, { id: 'rare-1-123', rarity: 'rare', attack: 100, hp: 100, defense: 100, speed: 100 }, () => 0.2);
        assert.equal(result.ok, true);
        if (result.ok) assert.equal((result.character.pets as Array<Record<string, unknown>>)[0].trait, 'Aggressive');
        const overflow = grantWildPet(
            { pets: [{},{},{},{},{}] },
            { id: 'rare-1-456', rarity: 'rare', attack: 100, hp: 100, defense: 100, speed: 100 },
            () => 0,
        );
        assert.equal(overflow.ok, true);
        if (overflow.ok) assert.equal((overflow.character.pets as unknown[]).length, 6);
    });
});
