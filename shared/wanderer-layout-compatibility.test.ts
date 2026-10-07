import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rollNightWanderer, rollWanderers, type Wanderer } from './wanderer-roster.js';
import { isWalkableTile } from './sector-walk-mask.js';
const baselines = JSON.parse(readFileSync(new URL('./wanderer-layout-baseline.json', import.meta.url), 'utf8'));
const identity = ({ id, name, archetype, level, greeting }: Wanderer) => ({ id, name, archetype, level, greeting });
test('placing wanderers on safe terrain preserves the original deterministic encounter rolls', () => {
    for (const baseline of baselines) {
        const cast = rollWanderers(baseline.sector, baseline.bucket);
        const night = rollNightWanderer(baseline.sector, baseline.nightIndex, baseline.bucket);
        assert.deepEqual(cast.map(identity), baseline.cast);
        assert.deepEqual(night ? identity(night) : null, baseline.night);
        for (const w of [...cast, ...(night ? [night] : [])]) {
            assert.ok(isWalkableTile(baseline.sector, w.homeTile));
            w.waypoints.forEach(tile => assert.ok(isWalkableTile(baseline.sector, tile)));
        }
    }
});
