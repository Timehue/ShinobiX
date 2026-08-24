import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    WEATHER_DAY_MS,
    WEATHER_ELEMENTS,
    biomeWeatherTables,
    resolveSectorWeather,
    scheduledSectorWeather,
    sectorWeatherElements,
    weatherDayBucket,
    type SectorWeather,
    type SectorWeatherBiome,
} from './sector-weather.js';

const BIOMES: SectorWeatherBiome[] = ['forest', 'snow', 'volcano', 'shadow', 'central'];
const DAY0 = Date.UTC(2026, 7, 22, 13, 0, 0); // an arbitrary fixed instant

describe('scheduledSectorWeather — one sky for everyone', () => {
    it('is deterministic: the same (biome, sector, day) gives the same weather on every call', () => {
        for (const biome of BIOMES) {
            for (let sector = 1; sector <= 60; sector++) {
                const day = weatherDayBucket(DAY0);
                const a = scheduledSectorWeather(biome, sector, day);
                const b = scheduledSectorWeather(biome, sector, day);
                assert.equal(a, b, `${biome} s${sector}`);
            }
        }
    });

    it('a "client" call on serverNow() and a "server" call on Date.now() agree for the same day', () => {
        // The client feeds serverNow() (local clock + offset), the server feeds
        // Date.now(). Any two instants in the same UTC day must resolve alike,
        // even with minutes of clock drift between the two machines.
        const serverInstant = Date.UTC(2026, 7, 22, 10, 0, 0);
        const clientInstant = serverInstant + 3 * 60_000; // 3 minutes of drift (the 183s symptom)
        for (const biome of BIOMES) {
            for (let sector = 1; sector <= 60; sector++) {
                assert.equal(
                    resolveSectorWeather(biome, sector, clientInstant),
                    resolveSectorWeather(biome, sector, serverInstant),
                    `${biome} s${sector}`,
                );
            }
        }
    });

    it('only ever picks from the biome table (and "clear" for an unknown biome)', () => {
        for (const biome of BIOMES) {
            const table = new Set<SectorWeather>(biomeWeatherTables[biome]);
            for (let sector = 1; sector <= 60; sector++) {
                for (let d = 0; d < 30; d++) {
                    assert.ok(table.has(scheduledSectorWeather(biome, sector, 20_000 + d)), `${biome} s${sector} d${d}`);
                }
            }
        }
        assert.equal(scheduledSectorWeather('lunar', 3, 5), 'clear');
        assert.equal(scheduledSectorWeather(undefined, 3, 5), 'clear');
    });

    it('changes from day to day — a sector is not stuck on one weather forever', () => {
        // Over a month every sector must show at least two distinct weathers, and
        // the whole world must not rotate in lockstep (different sectors differ
        // on the same day).
        for (const biome of BIOMES) {
            for (let sector = 1; sector <= 60; sector++) {
                const seen = new Set<SectorWeather>();
                for (let d = 0; d < 30; d++) seen.add(scheduledSectorWeather(biome, sector, 20_000 + d));
                assert.ok(seen.size >= 2, `${biome} s${sector} never changed in 30 days`);
            }
        }
        const sameDay = new Set<SectorWeather>();
        for (let sector = 1; sector <= 60; sector++) sameDay.add(scheduledSectorWeather('central', sector, 20_000));
        assert.ok(sameDay.size >= 2, 'every sector showed the same weather on one day');
    });

    it('is stable within a UTC day and rolls exactly at the UTC day boundary', () => {
        const dayStart = Math.floor(DAY0 / WEATHER_DAY_MS) * WEATHER_DAY_MS;
        assert.equal(weatherDayBucket(dayStart), weatherDayBucket(dayStart + WEATHER_DAY_MS - 1));
        assert.equal(weatherDayBucket(dayStart + WEATHER_DAY_MS), weatherDayBucket(dayStart) + 1);
        assert.equal(weatherDayBucket(Number.NaN), 0);
    });
});

describe('resolveSectorWeather — clan override precedence', () => {
    it('a holding clan\'s stamped weather beats the schedule', () => {
        const scheduled = resolveSectorWeather('forest', 7, DAY0);
        const override: SectorWeather = scheduled === 'ashfall' ? 'desertHaze' : 'ashfall';
        assert.equal(resolveSectorWeather('forest', 7, DAY0, { ownerClan: 'Storm', weather: override }), override);
    });

    it('a stamped weather on an UNOWNED sector is ignored (schedule applies)', () => {
        const scheduled = resolveSectorWeather('forest', 7, DAY0);
        assert.equal(resolveSectorWeather('forest', 7, DAY0, { ownerClan: '', weather: 'ashfall' }), scheduled);
        assert.equal(resolveSectorWeather('forest', 7, DAY0, { weather: 'ashfall' }), scheduled);
        assert.equal(resolveSectorWeather('forest', 7, DAY0, null), scheduled);
        assert.equal(resolveSectorWeather('forest', 7, DAY0, undefined), scheduled);
    });

    it('an owned sector with no or an invalid stamp falls back to the schedule', () => {
        const scheduled = resolveSectorWeather('snow', 30, DAY0);
        assert.equal(resolveSectorWeather('snow', 30, DAY0, { ownerClan: 'Storm' }), scheduled);
        assert.equal(resolveSectorWeather('snow', 30, DAY0, { ownerClan: 'Storm', weather: 'blizzard' }), scheduled);
        assert.equal(resolveSectorWeather('snow', 30, DAY0, { ownerClan: 'Storm', weather: 42 }), scheduled);
    });
});

describe('sectorWeatherElements', () => {
    it('maps every weather to its boosted / dampened element, clear to none', () => {
        assert.deepEqual(sectorWeatherElements('clear'), { positiveElement: '', negativeElement: '' });
        assert.deepEqual(sectorWeatherElements('rain'), { positiveElement: 'Water', negativeElement: 'Fire' });
        for (const w of Object.keys(WEATHER_ELEMENTS) as SectorWeather[]) {
            assert.deepEqual(sectorWeatherElements(w), WEATHER_ELEMENTS[w]);
        }
    });
});
