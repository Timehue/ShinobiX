import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { maxLoadout, maxPets } from './_entitlements.js';

describe('competitive entitlement caps', () => {
    it('gives free and supporter players the same 15-jutsu PvP loadout cap', () => {
        assert.equal(maxLoadout({}), 15);
        assert.equal(maxLoadout({ patreon: { active: true } }), 15);
    });

    it('lets a free player carry the four pets required by Tactical mode', () => {
        assert.equal(maxPets({}), 4);
        assert.equal(maxPets({ patreon: { active: true } }), 5);
    });
});
