import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanOrdinaryPveEncounter, ordinaryPveDifficulty, ordinaryPveLevel, rollOrdinaryPveEncounter } from './ordinary-pve-encounter.js';
import { ordinaryWandererEncounter, rollWanderers } from './wanderer-roster.js';

describe('ordinary PvE encounter roll', () => {
    it('keeps the exact 35/45/15/5 combat-only starting distribution', () => {
        const counts = { weaker: 0, standard: 0, dangerous: 0, elite: 0 };
        for (let n = 0; n < 10000; n += 1) counts[ordinaryPveDifficulty((n + .5) / 10000)] += 1;
        assert.deepEqual(counts, { weaker: 3500, standard: 4500, dangerous: 1500, elite: 500 });
    });

    it('rolls genuine weaker enemies and keeps early roads easy as players grow', () => {
        for (const level of [10, 25, 50, 75, 100]) {
            for (const fraction of [0, .5, .999]) {
                const weak = ordinaryPveLevel(level, 66, 'weaker', fraction);
                assert.ok(weak >= Math.floor(level * .65) && weak <= Math.floor(level * .85));
                assert.ok(ordinaryPveLevel(level, 1, 'elite', fraction) <= 7);
                for (const difficulty of ['weaker', 'standard', 'dangerous', 'elite'] as const) {
                    if (level <= 15) assert.ok(ordinaryPveLevel(level, 66, difficulty, fraction) <= level);
                }
            }
        }
        assert.ok(ordinaryPveLevel(25, 66, 'standard', .5) <= 30, 'remote danger is bounded to five levels above a post-onboarding player');
    });

    it('is repeatable, validates sealed data, and preserves exact authored identity', () => {
        const input = { sourceId: 'explore-sealed01', playerLevel: 75, sector: 66, seed: 'same receipt', reward: { xp: 125, ryo: 75, trait: 'Swift' } };
        const encounter = rollOrdinaryPveEncounter(input);
        assert.deepEqual(rollOrdinaryPveEncounter(input), encounter);
        assert.deepEqual(cleanOrdinaryPveEncounter(encounter), encounter);
        assert.equal(cleanOrdinaryPveEncounter({ ...encounter, level: 101 }), null);
        assert.equal(cleanOrdinaryPveEncounter({ ...encounter, profileId: 'forged' }), null);
        const named = rollOrdinaryPveEncounter({ ...input, displayName: 'Tsukika', portraitKey: 'nightblade', portraitImage: '/art/tsukika.webp' });
        assert.equal(named.displayName, 'Tsukika');
        assert.equal(named.portraitImage, '/art/tsukika.webp');
    });

    it('leaves noncombat and patrol roster entries outside the ordinary roll', () => {
        let combatSeen = false, otherSeen = false;
        for (let bucket = 5000; bucket < 5010; bucket += 1) {
            for (let sector = 1; sector <= 66; sector += 1) {
                for (const wanderer of rollWanderers(sector, bucket)) {
                    const descriptor = ordinaryWandererEncounter(wanderer, 100, sector);
                    if (wanderer.archetype === 'bandit') {
                        combatSeen = true;
                        assert.equal(descriptor?.displayName, wanderer.name);
                        assert.equal(descriptor?.sourceId, wanderer.id);
                        assert.equal(descriptor?.portraitKey, descriptor?.archetype, 'ordinary bandits show the role they actually fight with');
                        assert.ok(descriptor!.level <= Math.round(6 + sector * 1.4));
                    } else {
                        otherSeen = true;
                        assert.equal(descriptor, null);
                    }
                }
            }
        }
        assert.ok(combatSeen && otherSeen);
    });
});
