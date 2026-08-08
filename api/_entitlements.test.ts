import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { canCustomAvatar, maxLoadout, maxPets, maxStoredBloodlines } from './_entitlements.js';

describe('supporter entitlement caps', () => {
    it('keeps three additional jutsu slots as a supporter perk', () => {
        assert.equal(maxLoadout({}), 12);
        assert.equal(maxLoadout({ patreon: { active: true } }), 15);
    });

    it('keeps two additional carried pets as a supporter perk', () => {
        assert.equal(maxPets({}), 3);
        assert.equal(maxPets({ patreon: { active: true } }), 5);
    });

    it('keeps custom avatars and a second stored bloodline as supporter perks', () => {
        assert.equal(canCustomAvatar({}), false);
        assert.equal(canCustomAvatar({ patreon: { active: true } }), true);
        assert.equal(maxStoredBloodlines({}), 1);
        assert.equal(maxStoredBloodlines({ patreon: { active: true } }), 2);
    });
});
