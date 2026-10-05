import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { grantWildPet, rollWildPet, rollWildPetLevel } from './_encounter.js';
import { PET_CATALOG } from './_catalog.js';
import { NIGHT_ONLY_WILD_PET_IDS } from '../../shared/night-pets.js';

describe('wild pet encounter authority', () => {
    it('rolls every level in the inclusive companion-minus-20 range uniformly', () => {
        for (const level of [1, 10, 20, 21, 50, 100]) {
            const min = Math.max(1, level - 20);
            const count = level - min + 1;
            assert.equal(rollWildPetLevel(level, () => 0), min);
            assert.equal(rollWildPetLevel(level, () => 0.999999999), level);
            for (let index = 0; index < count; index += 1) {
                assert.equal(rollWildPetLevel(level, () => (index + 0.5) / count), min + index);
            }
        }
        for (const level of [undefined, NaN, Infinity, -10, 0]) {
            assert.equal(rollWildPetLevel(level, () => 0.5), 1);
        }
    });

    it('resets a captured pet to level 1 with base stats and its trait applied once', () => {
        const template = PET_CATALOG['standard-0'];
        const result = grantWildPet({ pets: [] }, { ...template, level: 80, trait: 'Battleborn' }, () => 0);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.pet.level, 1);
        assert.equal(result.pet.xp, 0);
        assert.equal(result.pet.growthPoints, 0);
        for (const stat of ['hp', 'attack', 'defense', 'speed']) {
            assert.equal(result.pet[stat], Math.round(Number(template[stat]) * 1.1));
        }
    });

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
    it('a guaranteed (tracker trail) roll always hits with the Explore hit rarity mix', () => {
        // The first roll is scaled into the 0..0.05 hit band, so each rarity
        // keeps exactly its share of an Explore HIT: 4/6/10/80 percent.
        const cases: Array<[number, string]> = [
            [0, 'mythic'], [0.039, 'mythic'], [0.0401, 'legendary'], [0.139, 'legendary'],
            [0.1401, 'rare'], [0.199, 'rare'], [0.2001, 'standard'], [0.999999, 'standard'],
        ];
        for (const [unit, rarity] of cases) {
            const values = [unit, 0.45, 0.1]; let i = 0;
            assert.equal(rollWildPet(() => values[i++] ?? 0, 123, { weather: 'clear' }, { guaranteed: true })?.rarity, rarity, `unit ${unit}`);
        }
        // Without the flag the same high roll is still an ordinary miss.
        assert.equal(rollWildPet(() => 0.999999, 123), null);
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
    it('night-only pets appear only after dark, and are favored at night', () => {
        // World day = 2 real hours; t = 0 is in-world midnight, +1h real is noon.
        const MIDNIGHT = 0 + 1;
        const NOON = 60 * 60 * 1000;
        const sweep = (now: number, band: number) => {
            const ids = new Map<string, number>();
            for (let index = 0; index < 2000; index += 1) {
                const values = [band, (index + 0.5) / 2000, 0.1]; let i = 0;
                const pet = rollWildPet(() => values[i++] ?? 0, now);
                const template = String(pet?.id).replace(/-\d+$/, '');
                ids.set(template, (ids.get(template) ?? 0) + 1);
            }
            return ids;
        };
        for (const band of [0.02, 0.009, 0.005]) { // standard, rare, legendary
            const day = sweep(NOON, band);
            const night = sweep(MIDNIGHT, band);
            const nightOnlyByDay = [...day.keys()].filter((id) => NIGHT_ONLY_WILD_PET_IDS.has(id));
            assert.deepEqual(nightOnlyByDay, [], `band ${band}: night pets met at noon`);
            const nightOnlyAtNight = [...night.keys()].filter((id) => NIGHT_ONLY_WILD_PET_IDS.has(id));
            assert.ok(nightOnlyAtNight.length > 0, `band ${band}: no night pet at midnight`);
            // Favored: a night pet outdraws the average day pet at night.
            const perNightPet = nightOnlyAtNight.reduce((s, id) => s + night.get(id)!, 0) / nightOnlyAtNight.length;
            const dayIds = [...night.keys()].filter((id) => !NIGHT_ONLY_WILD_PET_IDS.has(id));
            const perDayPet = dayIds.reduce((s, id) => s + night.get(id)!, 0) / dayIds.length;
            assert.ok(perNightPet > perDayPet * 1.5, `band ${band}: night pets are not favored at night`);
        }
    });
    it('night gating never changes the hit or rarity roll', () => {
        for (const now of [1, 60 * 60 * 1000]) {
            for (const [chance, rarity] of [[0.001, 'mythic'], [0.007, 'legendary'], [0.01, 'rare'], [0.05, 'standard'], [0.050001, null]] as const) {
                const values = [chance, 0.45, 0.1]; let i = 0;
                assert.equal(rollWildPet(() => values[i++] ?? 0, now)?.rarity ?? null, rarity);
            }
        }
    });
    it('every night-only pet is a real wild template', () => {
        for (const id of NIGHT_ONLY_WILD_PET_IDS) {
            const pet = PET_CATALOG[id as keyof typeof PET_CATALOG] as { wildSpawnable?: boolean } | undefined;
            assert.ok(pet, `${id} is not in the pet catalog`);
            assert.notEqual(pet.wildSpawnable, false, `${id} never spawns wild anyway`);
        }
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
