import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    WEATHER_BLOCK_WINDOWS,
    WEATHER_ELEMENTS,
    WEATHER_WINDOWS_PER_DAY,
    WEATHER_WINDOW_MS,
    biomeWeatherTables,
    TERRITORY_BREACH_DURATION_MS,
    resolveSectorWeather,
    scheduledSectorWeather,
    sectorForecast,
    sectorWeatherElements,
    weatherFromElements,
    weatherWindowAt,
    weatherWindowStartMs,
    type SectorWeather,
    type SectorWeatherBiome,
} from './sector-weather.js';
import { WORLD_DAY_MS } from './world-clock.js';

const BIOMES: SectorWeatherBiome[] = ['forest', 'snow', 'volcano', 'shadow', 'central'];
const DAY0 = Date.UTC(2026, 7, 22, 13, 0, 0); // an arbitrary fixed instant

describe('scheduledSectorWeather — one sky for everyone', () => {
    it('is deterministic: the same (biome, sector, day) gives the same weather on every call', () => {
        for (const biome of BIOMES) {
            for (let sector = 1; sector <= 60; sector++) {
                const day = weatherWindowAt(DAY0);
                const a = scheduledSectorWeather(biome, sector, day);
                const b = scheduledSectorWeather(biome, sector, day);
                assert.equal(a, b, `${biome} s${sector}`);
            }
        }
    });

    it('a "client" call on serverNow() and a "server" call on Date.now() agree for the same instant', () => {
        // The client feeds serverNow() (local clock + the measured offset) and the
        // server feeds Date.now(). What makes them agree is that both name the
        // SAME INSTANT — not that the bucket is wide enough to absorb a bad clock.
        //
        // That distinction used to be invisible, because a window was a whole UTC
        // day and minutes of drift landed inside it regardless. A window is 40 real
        // minutes now, so this asserts the property that is actually true: the
        // resolver is a pure function of the instant, and serverNow()'s deadband
        // (1s, lib/server-clock) is what keeps the two machines naming the same one.
        const serverInstant = Date.UTC(2026, 7, 22, 10, 0, 0);
        for (const drift of [0, 250, 999]) { // inside the server-clock deadband
            const clientInstant = serverInstant + drift;
            for (const biome of BIOMES) {
                for (let sector = 1; sector <= 60; sector++) {
                    assert.equal(
                        resolveSectorWeather(biome, sector, clientInstant),
                        resolveSectorWeather(biome, sector, serverInstant),
                        `${biome} s${sector} at +${drift}ms`,
                    );
                }
            }
        }
    });

    it('holds one sky for the whole window, and only turns on the boundary', () => {
        // The honest statement of the limit above: two instants agree because they
        // share a window, and a window is 40 real minutes. A fight sealed within a
        // second of a rollover may therefore be sealed the NEXT sky — which is
        // correct (api/pvp/session.ts seals from the server's own clock at creation),
        // and is why the plate re-reads every 15s rather than every minute.
        const start = weatherWindowStartMs(weatherWindowAt(DAY0) + 1);
        for (const biome of BIOMES) {
            for (let sector = 1; sector <= 30; sector++) {
                const atStart = resolveSectorWeather(biome, sector, start);
                for (const offset of [0, 1, WEATHER_WINDOW_MS / 2, WEATHER_WINDOW_MS - 1]) {
                    assert.equal(
                        resolveSectorWeather(biome, sector, start + offset),
                        atStart,
                        `${biome} s${sector} changed ${offset}ms into its own window`,
                    );
                }
                assert.equal(
                    resolveSectorWeather(biome, sector, start + WEATHER_WINDOW_MS),
                    scheduledSectorWeather(biome, sector, weatherWindowAt(start) + 1),
                    `${biome} s${sector} did not hand over on the boundary`,
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

    it('is stable within a window and rolls exactly at the window boundary', () => {
        const start = weatherWindowStartMs(weatherWindowAt(DAY0));
        assert.equal(weatherWindowAt(start), weatherWindowAt(start + WEATHER_WINDOW_MS - 1));
        assert.equal(weatherWindowAt(start + WEATHER_WINDOW_MS), weatherWindowAt(start) + 1);
        assert.equal(weatherWindowAt(Number.NaN), 0);
    });

    // The reason the cadence moved off the real day: sector-contracts could not
    // ask for a weather because a sector's sky was a fixed fact for 24 hours.
    it('turns within an in-world day, three times over, not once per real day', () => {
        assert.equal(WEATHER_WINDOWS_PER_DAY, 3);
        assert.equal(WEATHER_WINDOW_MS, WORLD_DAY_MS / 3);
        assert.equal(WEATHER_WINDOW_MS, 40 * 60_000, 'one sky should last 40 real minutes');
        const seen = new Set<SectorWeather>();
        const start = weatherWindowStartMs(weatherWindowAt(DAY0));
        for (let i = 0; i < 36; i++) seen.add(scheduledSectorWeather('central', 21, weatherWindowAt(start + i * WEATHER_WINDOW_MS)));
        assert.ok(seen.size >= 2, 'a real day of windows never changed the sky');
    });
});

// A fresh independent draw per window made the sky teleport: clear, tornado,
// clear again inside two hours. The chain is what makes it read as weather.
describe('weather moves in patterns, not in jumps', () => {
    const SEVERITY: Record<SectorWeather, number> = {
        clear: 0, desertHaze: 1, rain: 1, ashfall: 1, tornado: 2, thunderstorm: 2,
    };
    // Stay inside one block: the anchor re-seed is the documented seam.
    const ANCHOR = 30 * WEATHER_BLOCK_WINDOWS;

    it('never steps more than one rung of the calm-to-severe ladder inside a block', () => {
        for (const biome of BIOMES) {
            for (let sector = 1; sector <= 60; sector += 7) {
                let prev = scheduledSectorWeather(biome, sector, ANCHOR);
                for (let i = 1; i < WEATHER_BLOCK_WINDOWS; i++) {
                    const next = scheduledSectorWeather(biome, sector, ANCHOR + i);
                    assert.ok(
                        Math.abs(SEVERITY[next] - SEVERITY[prev]) <= 1,
                        `${biome} s${sector} jumped ${prev} to ${next}`,
                    );
                    prev = next;
                }
            }
        }
    });

    // A front should last about a session: long enough that checking the forecast
    // is worth doing, short enough that a bad sky is never a whole evening. This
    // is the assertion that stops a WEATHER_HOLD_IN_256 retune from quietly
    // turning the weather back into the fixed label it used to be.
    it('holds a sky for roughly one session - fronts last, and they still break', () => {
        for (const biome of BIOMES) {
            let runs = 0;
            let windows = 0;
            let prev: SectorWeather | null = null;
            for (let w = 0; w < 4_000; w++) {
                const sky = scheduledSectorWeather(biome, 7, 40_000 + w);
                if (sky !== prev) { runs++; prev = sky; }
                windows++;
            }
            const realMinutes = (windows / runs) * (WEATHER_WINDOW_MS / 60_000);
            assert.ok(
                realMinutes > 45 && realMinutes < 150,
                `${biome} fronts average ${realMinutes.toFixed(0)} real minutes`,
            );
        }
    });

    // The per-biome tables are AUTHORED CONTENT and every non-clear sky carries a
    // combat modifier, so how often each one is up is a balance fact. A chain that
    // shifted those frequencies would be a balance change nobody asked for — and
    // an earlier "pick among the adjacent skies" step did exactly that, pushing
    // shadow's `clear` from 25% to 13%. Propose-and-reject keeps the authored
    // weights as the exact stationary distribution; this measures it.
    it('leaves each biome\'s authored climate exactly where the table put it', () => {
        for (const biome of BIOMES) {
            const table = biomeWeatherTables[biome];
            const authored = new Map<SectorWeather, number>();
            for (const w of table) authored.set(w, (authored.get(w) ?? 0) + 1 / table.length);

            const seen = new Map<SectorWeather, number>();
            let n = 0;
            for (let sector = 1; sector <= 40; sector++) {
                for (let w = 0; w < 600; w++) {
                    const sky = scheduledSectorWeather(biome, sector, 40_000 + w);
                    seen.set(sky, (seen.get(sky) ?? 0) + 1);
                    n++;
                }
            }
            for (const [sky, want] of authored) {
                const got = (seen.get(sky) ?? 0) / n;
                assert.ok(
                    Math.abs(got - want) < 0.03,
                    `${biome} ${sky}: authored ${(want * 100).toFixed(1)}% but realised ${(got * 100).toFixed(1)}%`,
                );
            }
        }
    });

    it('still only ever shows a sky the biome actually has', () => {
        for (const biome of BIOMES) {
            const table = new Set<SectorWeather>(biomeWeatherTables[biome]);
            for (let sector = 1; sector <= 60; sector += 5) {
                for (let w = 0; w < 200; w++) {
                    assert.ok(table.has(scheduledSectorWeather(biome, sector, 50_000 + w)), `${biome} s${sector} w${w}`);
                }
            }
        }
    });

    it('replaying the chain is stateless - the same window answers the same, in any order', () => {
        const forwards: SectorWeather[] = [];
        for (let w = 0; w < 150; w++) forwards.push(scheduledSectorWeather('central', 33, 90_000 + w));
        for (let w = 149; w >= 0; w--) {
            assert.equal(
                scheduledSectorWeather('central', 33, 90_000 + w),
                forwards[w],
                `window ${w} answered differently out of order`,
            );
        }
    });
});

describe('sectorForecast - a deterministic sky is only useful if it can be read', () => {
    it('leads with the sky that is actually up, and lays the next ones end to end', () => {
        const rows = sectorForecast('forest', 7, DAY0, 4);
        assert.equal(rows.length, 4);
        assert.equal(rows[0].weather, resolveSectorWeather('forest', 7, DAY0));
        assert.ok(rows[0].startsAt <= DAY0 && rows[0].endsAt > DAY0, 'the first row must contain now');
        for (let i = 1; i < rows.length; i++) {
            assert.equal(rows[i].startsAt, rows[i - 1].endsAt, 'a gap or overlap between windows');
            assert.equal(rows[i].endsAt - rows[i].startsAt, WEATHER_WINDOW_MS);
            assert.equal(
                rows[i].weather,
                resolveSectorWeather('forest', 7, rows[i].startsAt),
                'the forecast promised a sky the resolver will not serve',
            );
        }
        assert.ok(rows.every((r) => r.stamped === false));
    });

    it('a clan stamped sky is reported as standing, never counted down', () => {
        const rows = sectorForecast('forest', 7, DAY0, 4, { ownerClan: 'Storm', weather: 'ashfall' });
        assert.deepEqual(rows.map((r) => r.weather), ['ashfall']);
        assert.equal(rows[0].stamped, true);
        assert.equal(rows[0].endsAt, Number.POSITIVE_INFINITY);
    });

    it('a suspended holding forecasts the schedule again, matching the resolver', () => {
        const breached = { ownerClan: 'Storm', weather: 'ashfall' as const, breachedAt: DAY0 - 1_000, hp: 0 };
        const rows = sectorForecast('forest', 7, DAY0, 2, breached);
        assert.equal(rows[0].stamped, false);
        assert.equal(rows[0].weather, resolveSectorWeather('forest', 7, DAY0, breached));
    });

    it('refuses to be talked into an unbounded or empty forecast', () => {
        assert.equal(sectorForecast('forest', 7, DAY0, 0).length, 1);
        assert.equal(sectorForecast('forest', 7, DAY0, -5).length, 1);
        assert.equal(sectorForecast('forest', 7, DAY0, 9_999).length, 24);
        assert.equal(sectorForecast('forest', 7, Number.NaN, 2).length, 2);
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

// A fight seals the ELEMENTS, so naming the sealed sky means coming back through
// the inverse. If this is not a true inverse, the battle screen puts the wrong
// label beside the right damage numbers.
describe('weatherFromElements — naming a sealed sky', () => {
    it('round-trips every weather through its element pair', () => {
        for (const weather of Object.keys(WEATHER_ELEMENTS) as SectorWeather[]) {
            const { positiveElement, negativeElement } = sectorWeatherElements(weather);
            assert.equal(weatherFromElements(positiveElement, negativeElement), weather);
        }
    });

    it('needs every pair to be distinct, or the round trip is a coincidence', () => {
        const pairs = new Set(
            (Object.keys(WEATHER_ELEMENTS) as SectorWeather[])
                .map((w) => `${WEATHER_ELEMENTS[w].positiveElement}|${WEATHER_ELEMENTS[w].negativeElement}`),
        );
        assert.equal(pairs.size, Object.keys(WEATHER_ELEMENTS).length);
    });

    it('falls back to clear on an unrecognised or absent pair rather than guessing', () => {
        assert.equal(weatherFromElements('', ''), 'clear');
        assert.equal(weatherFromElements(undefined, undefined), 'clear');
        assert.equal(weatherFromElements('Water', 'Water'), 'clear');
        assert.equal(weatherFromElements('Shadow', 'Fire'), 'clear');
    });
});

describe('a suspended holding stops supplying weather', () => {
    // Weather is a COMBAT MODIFIER and the holding clan picks it to favour its
    // own element, so this is not cosmetic: without the gate, a clan whose
    // garrison has been breached keeps fighting at home advantage while the
    // Clan Hall and the sector plate both say "bonuses suspended".
    const NOW = 1_760_000_000_000;
    const scheduled = resolveSectorWeather('forest', 12, NOW, null);
    // Derived, not hardcoded: the stamp has to differ from the schedule, or every
    // fallback case below would pass without the gate doing anything. Pinning a
    // literal here made this test go red the moment the schedule was retuned.
    const stamp: SectorWeather = scheduled === 'rain' ? 'ashfall' : 'rain';
    const held = { ownerClan: 'Ashen Vanguard', weather: stamp };

    it('an unbreached holding still wins', () => {
        assert.notEqual(scheduled, stamp);
        assert.equal(resolveSectorWeather('forest', 12, NOW, held), stamp);
    });

    it('falls back to the scheduled sky while breached', () => {
        const breached = { ...held, breachedAt: NOW - 1_000, hp: 8_000 };
        assert.equal(resolveSectorWeather('forest', 12, NOW, breached), scheduled);
    });

    it('a razed holding (hp 0) is suspended even past the breach window', () => {
        const razed = { ...held, breachedAt: NOW - TERRITORY_BREACH_DURATION_MS - 1, hp: 0 };
        assert.equal(resolveSectorWeather('forest', 12, NOW, razed), scheduled);
    });

    it('the sky returns once the breach window closes with hp intact', () => {
        const healed = { ...held, breachedAt: NOW - TERRITORY_BREACH_DURATION_MS - 1, hp: 12_000 };
        assert.equal(resolveSectorWeather('forest', 12, NOW, healed), stamp);
    });

    it('a dormant clan (rewardSuspendedAt) is suspended too', () => {
        const dormant = { ...held, rewardSuspendedAt: NOW - 5_000 };
        assert.equal(resolveSectorWeather('forest', 12, NOW, dormant), scheduled);
    });
});
