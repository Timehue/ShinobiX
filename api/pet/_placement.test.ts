import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { petAcquisitionDestination } from './_placement.js';

describe('pet acquisition placement', () => {
    it('uses four carried slots for a base player and routes all overflow to Sanctuary', () => {
        assert.equal(petAcquisitionDestination({ pets: [{}, {}, {}] }), 'roster');
        assert.equal(petAcquisitionDestination({ pets: [{}, {}, {}, {}] }), 'sanctuary');
        assert.equal(petAcquisitionDestination({ pets: Array.from({ length: 100 }) }), 'sanctuary');
    });

    it('preserves six carried slots for a Shinobi Supporter', () => {
        const supporter = { patreon: { active: true, tier: 'Shinobi Supporter' } };
        assert.equal(petAcquisitionDestination({ ...supporter, pets: [{}, {}, {}, {}, {}] }), 'roster');
        assert.equal(petAcquisitionDestination({ ...supporter, pets: [{}, {}, {}, {}, {}, {}] }), 'sanctuary');
    });
});
