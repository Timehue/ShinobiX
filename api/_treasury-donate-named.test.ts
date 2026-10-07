import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyTreasuryDonation, type DonationRules } from './_treasury-donate.js';
import { NAMED_GEAR_DONATE_BLOCK_MESSAGE } from '../shared/named-gear-rules.js';

const RULES: DonationRules = { allowedCurrencies: ['ryo'], currencyCaps: { ryo: 1_000_000 }, itemCountCap: 99 };
const worn = 'named-weapon-123456781234123412341234567890ab';
const fresh = 'named-armor-223456781234123412341234567890ab';
const donor = (extra: Record<string, unknown> = {}) => ({ name: 'donor', inventory: [worn, fresh, 'training-katana'], itemStacks: [], equipment: {}, ...extra });
const give = (character: Record<string, unknown>, itemId: string) => applyTreasuryDonation({}, character, { kind: 'item', itemId, count: 1 }, RULES);

// Without this, a worn named piece could be donated to a clan or village treasury and gifted on to a
// member whose account never recorded wearing it, who could then list it at the Sunscar Exchange.
describe('treasury donation and worn named gear', () => {
    it('refuses a named piece that has been equipped, and changes nothing', () => {
        const character = donor({ equippedNamedGear: [worn] });
        const out = give(character, worn);
        assert.equal(out.ok, false);
        if (!out.ok) {
            assert.equal(out.status, 400);
            assert.equal(out.error, NAMED_GEAR_DONATE_BLOCK_MESSAGE);
        }
        assert.deepEqual(character.inventory, [worn, fresh, 'training-katana']);
    });

    it('accepts a named piece that was never equipped', () => {
        const out = give(donor({ equippedNamedGear: [worn] }), fresh);
        assert.ok(out.ok);
        if (out.ok) {
            assert.deepEqual(out.nextDonorChar.inventory, [worn, 'training-katana']);
            assert.deepEqual(out.nextTreasury.items, [{ itemId: fresh, count: 1 }]);
        }
    });

    it('does not touch ordinary gear, and a mixed case record still blocks the piece', () => {
        assert.ok(give(donor({ equippedNamedGear: [worn] }), 'training-katana').ok);
        assert.equal(give(donor({ equippedNamedGear: [worn.toUpperCase().replace('NAMED-WEAPON-', 'named-weapon-')] }), worn).ok, false);
    });

    it('currency donations are unaffected', () => {
        const out = applyTreasuryDonation({}, donor({ ryo: 500, equippedNamedGear: [worn] }), { kind: 'currency', currency: 'ryo', amount: 100 }, RULES);
        assert.ok(out.ok);
    });
});
