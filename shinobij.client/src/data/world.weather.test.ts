import { test } from 'node:test';
import assert from 'node:assert/strict';
import { biomeWeatherTables, weatherEffects } from './world.js';
import { WEATHER_ELEMENTS, biomeWeatherTables as sharedTables } from '../../../shared/sector-weather.js';

test('client weatherEffects elements match the shared server-side weather element map', () => {
    for (const [weather, elements] of Object.entries(WEATHER_ELEMENTS)) {
        const fx = weatherEffects[weather as keyof typeof weatherEffects];
        assert.ok(fx, `client has no weatherEffects entry for ${weather}`);
        assert.equal(fx.positiveElement ?? '', elements.positiveElement, `${weather} positive`);
        assert.equal(fx.negativeElement ?? '', elements.negativeElement, `${weather} negative`);
    }
    assert.deepEqual(Object.keys(weatherEffects).sort(), Object.keys(WEATHER_ELEMENTS).sort());
});

test('the biome weather tables the client renders from ARE the shared tables', () => {
    assert.equal(biomeWeatherTables, sharedTables);
});
