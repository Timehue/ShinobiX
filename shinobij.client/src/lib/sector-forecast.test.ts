import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WEATHER_WINDOW_MS, resolveSectorWeather } from "../../../shared/sector-weather.js";
import { FORECAST_REFRESH_MS, sectorSkyLine, shortDuration } from "./sector-forecast.js";

const NOW = Date.UTC(2026, 7, 26, 13, 7, 30);

describe("shortDuration", () => {
    test("prints the coarsest true unit, and nothing at all for no time left", () => {
        assert.equal(shortDuration(18 * 60_000), "18m");
        assert.equal(shortDuration(80 * 60_000), "1h 20m");
        assert.equal(shortDuration(120 * 60_000), "2h");
        assert.equal(shortDuration(30_000), "1m", "rounds up: a countdown must never read 0m and linger");
    });

    test("says nothing rather than something wrong for a non-duration", () => {
        for (const ms of [0, -1, Number.NaN, Infinity]) assert.equal(shortDuration(ms), "");
    });
});

describe("sectorSkyLine", () => {
    test("names the sky the resolver is actually serving", () => {
        for (let sector = 1; sector <= 40; sector += 3) {
            const line = sectorSkyLine(sector, "forest", NOW);
            assert.equal(line.now, resolveSectorWeather("forest", sector, NOW),
                `sector ${sector}: the plate would name a different sky than the fight seals`);
            assert.ok(line.nowName.length > 0);
        }
    });

    // The chain holds a front for several windows on purpose, so "next: Rainstorm"
    // while it is already raining would be a countdown to nothing happening.
    test("only ever forecasts a sky that DIFFERS from the one overhead", () => {
        for (const biome of ["forest", "snow", "volcano", "shadow", "central"] as const) {
            for (let sector = 1; sector <= 60; sector += 4) {
                const line = sectorSkyLine(sector, biome, NOW);
                if (line.next === null) continue;
                assert.notEqual(line.next, line.now, `${biome} s${sector} forecast its own weather`);
                assert.ok(line.inMs > 0, `${biome} s${sector} promised a change with no time to it`);
                assert.ok(line.inLabel.length > 0);
            }
        }
    });

    test("the promised change lands on the promised sky at the promised moment", () => {
        let checked = 0;
        for (let sector = 1; sector <= 60; sector++) {
            const line = sectorSkyLine(sector, "central", NOW);
            if (line.next === null) continue;
            assert.equal(resolveSectorWeather("central", sector, NOW + line.inMs), line.next,
                `sector ${sector}: the forecast promised a sky the resolver will not serve`);
            checked++;
        }
        assert.ok(checked > 0, "no sector had a change to check — the fixture proves nothing");
    });

    test("a settled spell reads as settled, not as a missing answer", () => {
        // Whatever the horizon holds, the shape is always renderable: either a
        // named change with a label, or no change and no half-filled fields.
        for (let sector = 1; sector <= 60; sector++) {
            const line = sectorSkyLine(sector, "volcano", NOW);
            if (line.next === null) {
                assert.equal(line.nextName, "");
                assert.equal(line.inLabel, "");
                assert.equal(line.inMs, 0);
            }
        }
    });

    test("re-reads far faster than a window turns, so the plate never names a stale sky", () => {
        assert.ok(FORECAST_REFRESH_MS > 0 && FORECAST_REFRESH_MS <= WEATHER_WINDOW_MS);
        // The bound that matters is not the countdown's minute resolution but how
        // long the plate may disagree with the sky the server would seal into a
        // fight started right now.
        assert.ok(FORECAST_REFRESH_MS <= 15_000, "the plate may name a stale sky for too long");
        assert.ok(FORECAST_REFRESH_MS >= 5_000, "a sub-5s repaint is churn, not freshness");
    });
});
