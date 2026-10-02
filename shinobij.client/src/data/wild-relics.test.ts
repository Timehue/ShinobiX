/** Every obtainable relic must remain PvE-only, unbuyable and illustrated. */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { starterItems } from './starter-items';
import { eventItems } from './event-items';
import { PVE_SPECIALIST_FIELDS, RELIC_ROSTER } from '../../../shared/relics';

const relics = [...starterItems, ...eventItems].filter(item => item.slot === 'relic');
describe('equippable relic roster', () => {
    it('matches all 20 canonical relics, including the four village rewards', () => {
        assert.deepEqual(relics.map(item => item.id).sort(), RELIC_ROSTER.map(item => item.id).sort());
        assert.equal(relics.length, 20);
    });
    it('grants only PvE percentages, with no flat stats or PvP passives', () => {
        const allowed = new Set<string>(['pveDamagePercent', ...PVE_SPECIALIST_FIELDS]);
        for (const relic of relics) {
            assert.ok(Object.keys(relic.bonuses ?? {}).length > 0);
            for (const field of Object.keys(relic.bonuses ?? {})) assert.ok(allowed.has(field), `${relic.id}: ${field}`);
            assert.equal(relic.cost, 0, `${relic.id} must not be purchasable`);
        }
    });
    it('ships artwork for every relic, including event items', () => {
        for (const relic of relics) {
            assert.ok(relic.image, `${relic.id} has no image`);
            const path = String(relic.image).replace(/^\//, '');
            assert.ok(existsSync(join(process.cwd(), 'shinobij.client', 'public', path))
                || existsSync(join(process.cwd(), 'public', path)), `${relic.id}: missing artwork`);
        }
    });
});
