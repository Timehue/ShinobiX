import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { bloodlinePoints } from '../_jutsu-points.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { applySoloPveAction } from '../solo-pve/_engine.js';
import { assertSoloPveLoadoutCompatible } from '../solo-pve/_compatibility.js';
import { sealTowerFighter } from '../towers/_seal.js';
import { applyJutsu } from '../pvp/move.js';
import {
    hydrateCharacterFromSave,
    resolveEquippedLoadout,
    type PvpFighter,
} from '../pvp/session.js';

const NOW = 1_800_000_000_000;

type BloodlineRank = 'B Rank' | 'A Rank' | 'S Rank';

function awakenedSave(rank: BloodlineRank, percent: number) {
    const jutsu = {
        id: `crystal-venom-${rank.charAt(0).toLowerCase()}`,
        name: 'Crystal Venom',
        type: 'Ninjutsu',
        element: 'Crystal',
        weatherElement: 'Fire',
        ap: 60,
        range: 4,
        effectPower: 40,
        cooldown: 7,
        chakraCost: 100,
        staminaCost: 100,
        target: 'OPPONENT',
        method: 'SINGLE',
        tags: [{ name: 'Poison', percent }],
        visualEffect: 'shadow',
        battleDescription: '%user crystallizes the air around %target.',
    };
    const bloodline = {
        id: `awakened-crystal-${rank.charAt(0).toLowerCase()}`,
        name: 'Awakened Crystal Vein',
        rank,
        specialElement: 'Crystal',
        jutsus: [jutsu],
        totalPoints: 999_999,
    };
    const character = {
        name: 'Alice',
        level: 50,
        specialty: 'Ninjutsu',
        bloodline: 'Ashen Eyes',
        hp: 2_000,
        maxHp: 2_000,
        chakra: 1_000,
        maxChakra: 1_000,
        stamina: 1_000,
        maxStamina: 1_000,
        stats: {
            ninjutsuOffense: 800,
            ninjutsuDefense: 500,
            willpower: 400,
            speed: 400,
        },
        equippedBloodlineId: bloodline.id,
        equippedJutsuIds: [jutsu.id],
        jutsuMastery: [{ jutsuId: jutsu.id, level: 50, xp: 0 }],
        equipment: {},
        inventory: [],
    };
    return {
        jutsu,
        bloodline,
        character,
        save: {
            character,
            savedBloodlines: [bloodline],
            creatorJutsus: [],
            creatorItems: [],
        },
    };
}

function opponent(name = 'Combat Dummy'): PvpFighter {
    return {
        name,
        hp: 5_000,
        maxHp: 5_000,
        chakra: 1_000,
        maxChakra: 1_000,
        stamina: 1_000,
        maxStamina: 1_000,
        shield: 0,
        statuses: [],
        pos: 63,
        character: {
            name,
            level: 50,
            specialty: 'Ninjutsu',
            stats: { ninjutsuDefense: 500, willpower: 400, speed: 400 },
            jutsuMastery: [],
            jutsu: [],
            pvpItems: [],
            equipment: {},
        },
    };
}

describe('awakened bloodline combat integration', () => {
    it('server-seals the B/A/S rank, creator percentage, budget, weather affinity, and VFX', () => {
        const contracts = [
            { rank: 'B Rank', percent: 30, pointLimit: 7, multiplier: 1.10 },
            { rank: 'A Rank', percent: 30, pointLimit: 10, multiplier: 1.15 },
            { rank: 'S Rank', percent: 35, pointLimit: 11, multiplier: 1.20 },
        ] as const;

        for (const contract of contracts) {
            const fixture = awakenedSave(contract.rank, contract.percent);
            const hydrated = hydrateCharacterFromSave(fixture.character, {}, fixture.save);
            const sealed = (hydrated.jutsu as Array<Record<string, unknown>>)[0];

            assert.ok(sealed, `${contract.rank} custom technique reaches combat`);
            assert.equal(sealed.id, fixture.jutsu.id);
            assert.equal(sealed.bloodlineRank, contract.rank);
            assert.equal(sealed.element, 'Crystal');
            assert.equal(sealed.weatherElement, 'Fire');
            assert.equal(sealed.visualEffect, 'shadow');
            assert.equal(sealed.target, 'OPPONENT');
            assert.equal(sealed.method, 'SINGLE');
            assert.deepEqual(sealed.tags, [{ name: 'Poison', percent: contract.percent }]);
            assert.equal(hydrated.bloodlineMult, contract.multiplier);
            assert.ok(
                bloodlinePoints(hydrated.jutsu as Array<Record<string, unknown>>, contract.rank) <= contract.pointLimit,
                `${contract.rank} combat loadout remains inside its authorized point total`,
            );
        }
    });

    it('executes the authoritative awakened technique in PvP with mastery-scaled damage and status', () => {
        const fixture = awakenedSave('S Rank', 35);
        const character = hydrateCharacterFromSave(fixture.character, {}, fixture.save);
        const sealed = (character.jutsu as Array<Record<string, unknown>>)[0];
        const self: PvpFighter = {
            name: 'Alice',
            hp: 2_000,
            maxHp: 2_000,
            chakra: 1_000,
            maxChakra: 1_000,
            stamina: 1_000,
            maxStamina: 1_000,
            shield: 0,
            statuses: [],
            pos: 62,
            character,
        };

        const result = applyJutsu(
            self,
            opponent(),
            sealed as Parameters<typeof applyJutsu>[2],
            1,
            'central',
            1,
        );

        assert.ok(result.metadata.damage > 0);
        assert.ok(result.opponent.hp < result.opponent.maxHp);
        const poison = result.opponent.statuses.find((status) => status.name === 'Poison');
        assert.ok(poison, 'the authored Poison tag is active in PvP');
        assert.equal(poison.percent, 35, 'S-rank creator percentage reaches the resolver unchanged');
    });

    it('executes the same sealed technique in PvE with weather, cooldown, status, log, and VFX', () => {
        const fixture = awakenedSave('S Rank', 35);
        const profile = {
            id: 'bloodline-combat-dummy',
            name: 'Combat Dummy',
            level: 50,
            hp: 5_000,
            chakra: 1_000,
            stamina: 1_000,
            stats: { ninjutsuDefense: 500, willpower: 400, speed: 400 },
            jutsuIds: [],
        };
        const build = (sessionId: string, positiveWeather?: string) => buildSoloPveAiEncounter({
            sessionId,
            playerName: 'alice',
            save: fixture.save,
            profile,
            now: NOW,
            admin: null,
            difficultyMode: false,
            environment: {
                biome: 'central',
                weatherPositiveElement: positiveWeather,
                blockedTiles: [],
            },
        });
        const neutral = build('custom-bloodline-neutral');
        const boosted = build('custom-bloodline-fire-weather', 'Fire');
        neutral.enemy.pos = 63;
        boosted.enemy.pos = 63;

        assertSoloPveLoadoutCompatible(boosted.player.character);
        const sealed = (boosted.player.character.jutsu as Array<Record<string, unknown>>)[0];
        assert.equal(sealed.id, fixture.jutsu.id);
        assert.equal(sealed.bloodlineRank, 'S Rank');

        const neutralResult = applySoloPveAction(neutral, { type: 'jutsu', jutsuId: fixture.jutsu.id });
        const boostedResult = applySoloPveAction(boosted, { type: 'jutsu', jutsuId: fixture.jutsu.id });

        assert.equal(boostedResult.applied, true);
        assert.ok(boostedResult.session.enemy.hp < boostedResult.session.enemy.maxHp);
        assert.ok(
            boostedResult.session.enemy.hp < neutralResult.session.enemy.hp,
            'the custom Fire weather affinity increases its PvE damage in positive Fire weather',
        );
        assert.equal(boostedResult.session.cooldowns.player[fixture.jutsu.id], 7);
        const poison = boostedResult.session.enemy.statuses.find((status) => status.name === 'Poison');
        assert.ok(poison, 'the authored Poison tag is active in PvE');
        assert.equal(poison.percent, 35);
        assert.ok(boostedResult.session.log.some((line) => line.includes('Crystal Venom')));
        assert.equal(boostedResult.event?.kind, 'action');
        if (boostedResult.event?.kind === 'action') {
            assert.ok(boostedResult.event.vfx.some((event) => event.key === 'shadow'));
        }
    });

    it('seals the same authoritative awakened technique into Battle Towers', () => {
        const fixture = awakenedSave('S Rank', 35);
        const tower = sealTowerFighter(fixture.character, fixture.save, {}, null);
        const canonical = hydrateCharacterFromSave(fixture.character, {}, fixture.save);
        const sealed = (tower.jutsu as Array<Record<string, unknown>>)[0];

        assert.deepEqual(tower, canonical, 'Tower sealing must remain identical to the shared PvP/PvE hydrator');
        assert.equal(sealed.id, fixture.jutsu.id);
        assert.equal(sealed.bloodlineRank, 'S Rank');
        assert.equal(sealed.weatherElement, 'Fire');
        assert.equal(sealed.visualEffect, 'shadow');
        assert.deepEqual(sealed.tags, [{ name: 'Poison', percent: 35 }]);
    });

    it('does not load techniques from a stored bloodline that is not currently carried', () => {
        const fixture = awakenedSave('S Rank', 35);
        const save = {
            ...fixture.save,
            savedBloodlines: [
                fixture.bloodline,
                { id: 'equipped-empty-bloodline', name: 'Empty', rank: 'B Rank', jutsus: [] },
            ],
        };
        const character = {
            ...fixture.character,
            equippedBloodlineId: 'equipped-empty-bloodline',
        };
        const loadout = resolveEquippedLoadout(character, save, {}) as unknown[];

        assert.deepEqual(loadout, []);
    });
});
