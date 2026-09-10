/**
 * Sealed-environment authority (api/pvp/session.ts `sealedSessionBiome`).
 *
 * The biome is a damage input twice over: terrainMultiplier grants +10% to the
 * matching school, and the biome selects which rotation table the sky is drawn
 * from (shared/sector-weather). It used to be read straight from the request
 * body on every casual fight, so a tampered client could stand in a forest and
 * claim a volcano — buying +10% Ninjutsu and a Fire-friendly sky at once.
 *
 * These pin the three grounds: ranked is neutral, a wild sector is the server's
 * own fact, and everything else keeps the client-chosen environment because
 * there is no ground truth to appeal to.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sealedSessionBiome } from './session.js';
import { sectorBiomeOf, isWildSector, MAX_WILD_SECTOR, FESTIVAL_SECTOR } from '../../shared/sector-geo.js';

describe('sealedSessionBiome', () => {
    it('seals a wild sector to the ground the world map paints, whatever the body says', () => {
        for (let sector = 1; sector <= MAX_WILD_SECTOR; sector++) {
            const truth = sectorBiomeOf(sector);
            for (const claimed of ['volcano', 'forest', 'snow', 'shadow', 'central']) {
                assert.equal(
                    sealedSessionBiome(sector, claimed, false),
                    truth,
                    `sector ${sector}: a client claiming "${claimed}" must still be sealed ${truth}`,
                );
            }
        }
    });

    it('refuses the two damage edges a claimed biome used to buy', () => {
        // Pick a sector that is NOT volcano, then claim volcano — the classic
        // grab: +10% Ninjutsu from terrain, plus an ashfall-capable sky.
        const sector = Array.from({ length: MAX_WILD_SECTOR }, (_, i) => i + 1)
            .find((s) => sectorBiomeOf(s) !== 'volcano');
        assert.ok(sector, 'fixture needs at least one non-volcano wild sector');
        assert.notEqual(sealedSessionBiome(sector, 'volcano', false), 'volcano');
        assert.equal(sealedSessionBiome(sector, 'volcano', false), sectorBiomeOf(sector));
    });

    it('is unchanged for an honest client, which sends the sector biome anyway', () => {
        for (let sector = 1; sector <= MAX_WILD_SECTOR; sector += 7) {
            const truth = sectorBiomeOf(sector);
            assert.equal(sealedSessionBiome(sector, truth, false), truth);
        }
    });

    it('keeps ranked on neutral ground regardless of sector or claim', () => {
        assert.equal(sealedSessionBiome(12, 'volcano', true), 'central');
        assert.equal(sealedSessionBiome(0, 'shadow', true), 'central');
        assert.equal(sealedSessionBiome(undefined, 'snow', true), 'central');
    });

    it('keeps the client-chosen environment where there is no ground truth', () => {
        // Arena / direct challenges / story backdrops send no wild rewardSector.
        for (const noSector of [0, -1, undefined, null, NaN, 'nope']) {
            assert.equal(sealedSessionBiome(noSector, 'volcano', false), 'volcano');
            assert.equal(sealedSessionBiome(noSector, 'snow', false), 'snow');
        }
        // Death's Gate (99) is not a wild sector and keeps its themed biome.
        assert.equal(isWildSector(99), false);
        assert.equal(sealedSessionBiome(99, 'volcano', false), 'volcano');
    });

    it('still normalises a junk claim rather than sealing it', () => {
        assert.equal(sealedSessionBiome(0, 'lavaworld', false), 'central');
        assert.equal(sealedSessionBiome(0, 42, false), 'central');
        assert.equal(sealedSessionBiome(0, undefined, false), 'central');
    });

    // The Sunscar Festival paints sector 54 as volcano for theming while the
    // sector's real biome is central. The festival screen runs no combat, so
    // nothing legitimate needs a themed biome sealed into a fight there — but if
    // that ever changes, this is the assertion that will say so out loud.
    it('seals the festival sector to its REAL biome, not its theming', () => {
        assert.equal(sealedSessionBiome(FESTIVAL_SECTOR, 'volcano', false), sectorBiomeOf(FESTIVAL_SECTOR));
    });

    it('never returns anything but a real biome', () => {
        const valid = new Set(['forest', 'snow', 'volcano', 'shadow', 'central']);
        for (const sector of [1, 33, MAX_WILD_SECTOR, 99, 0, -5, NaN]) {
            for (const claimed of ['volcano', 'nonsense', undefined, 7]) {
                for (const ranked of [true, false]) {
                    assert.ok(valid.has(sealedSessionBiome(sector, claimed, ranked)));
                }
            }
        }
    });
});
