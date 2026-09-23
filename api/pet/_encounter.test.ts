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
    it('keeps hit and rarity thresholds fixed under world weather', () => {
        const cases: Array<[number, string | null]> = [
            [0.001, 'mythic'], [0.002, 'mythic'], [0.007, 'legendary'],
            [0.01, 'rare'], [0.05, 'standard'], [0.050001, null],
        ];
        for (const [chance, rarity] of cases) {
            for (const weather of ['clear', 'rain', 'ashfall'] as const) {
                const values = [chance, 0.45, 0.1]; let i = 0;
                assert.equal(rollWildPet(() => values[i++] ?? 0, 123, { weather })?.rarity ?? null, rarity);
            }
        }
    });
    it('favors weather-matched elements only within the rolled rarity', () => {
        const counts = (weather: 'clear' | 'rain') => {
            const elements = new Map<string, number>();
            for (let index = 0; index < 1000; index += 1) {
                const values = [0.02, (index + 0.5) / 1000, 0.1]; let i = 0;
                const pet = rollWildPet(() => values[i++] ?? 0, 123, { weather });
                assert.equal(pet?.rarity, 'standard');
                const element = String(pet?.element);
                elements.set(element, (elements.get(element) ?? 0) + 1);
            }
            return elements;
        };
        const clear = counts('clear');
        const rain = counts('rain');
        assert.ok((rain.get('Water') ?? 0) > (clear.get('Water') ?? 0));
        assert.ok((rain.get('Fire') ?? 0) < (clear.get('Fire') ?? 0));
    });
    it('seals the trait at discovery and keeps it when the pet is granted', () => {
        const values = [0.02, 0, 0.21]; let i = 0;
        const pet = rollWildPet(() => values[i++] ?? 0, 123);
        assert.equal(pet?.trait, 'Aggressive');
        const result = grantWildPet({ pets: [] }, pet!, () => 0);
        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.pet.trait, pet?.trait);
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
