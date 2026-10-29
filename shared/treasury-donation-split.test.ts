import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BONE_CHARM_DONATION_RYO_VALUE,
    CLAN_DONATION_CURRENCIES,
    VILLAGE_DONATION_CURRENCIES,
    clanDonationCurrencyRefusal,
    villageCurrencyDonationRyoValue,
    villageDonationCurrencyRefusal,
} from './treasury-donation-split.js';
import { preparationTreasuryCost } from './war-preparations.js';

test('each currency has one hall, except ryo, which both spend', () => {
    const shared = VILLAGE_DONATION_CURRENCIES.filter((c) => (CLAN_DONATION_CURRENCIES as readonly string[]).includes(c));
    assert.deepEqual(shared, ['ryo']);
    for (const c of ['fateShards', 'auraStones']) assert.match(villageDonationCurrencyRefusal(c) ?? '', /clan treasury/);
    assert.match(clanDonationCurrencyRefusal('boneCharms') ?? '', /Town Hall/);
    assert.match(clanDonationCurrencyRefusal('honorSeals') ?? '', /Seal Pool/);
    for (const c of VILLAGE_DONATION_CURRENCIES) assert.equal(villageDonationCurrencyRefusal(c), null);
    for (const c of CLAN_DONATION_CURRENCIES) assert.equal(clanDonationCurrencyRefusal(c), null);
});

test('Mythic Seals go to neither hall', () => {
    assert.match(villageDonationCurrencyRefusal('mythicSeals') ?? '', /cannot be donated/);
    assert.match(clanDonationCurrencyRefusal('mythicSeals') ?? '', /cannot be donated/);
});

test('a Bone Charm is worth the treasury ryo a war preparation charges beside it', () => {
    const tier = preparationTreasuryCost(0);
    assert.ok(tier.boneCharms > 0);
    assert.equal(BONE_CHARM_DONATION_RYO_VALUE, tier.ryo / tier.boneCharms);
    assert.equal(villageCurrencyDonationRyoValue('boneCharms', 2), 1_000);
});

test('Honor Seals now earn merit: 16 seals are 1,000 ryo of value', () => {
    assert.equal(villageCurrencyDonationRyoValue('honorSeals', 16), 1_000);
    assert.equal(villageCurrencyDonationRyoValue('honorSeals', 1), 62);
    assert.equal(villageCurrencyDonationRyoValue('ryo', 1_234), 1_234);
    assert.equal(villageCurrencyDonationRyoValue('fateShards', 10), 0, 'a refused currency carries no value');
});
