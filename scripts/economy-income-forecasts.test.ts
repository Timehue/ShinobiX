import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { economyIncomeForecasts, brokerExpectedNetRyo } from './_economy-income-forecasts.js';
import { applyMasteryInvestment } from '../api/_profession-mastery.js';
import { rallyBrokerCertificates, caravanBrokerCertificates } from '../shared/sunscar/broker-certificates.js';

test('expedition forecasts include legal mastery, claim limits, traits and per-return rounding', () => {
    const forecast = economyIncomeForecasts();
    const ruins = forecast.expeditions.filter(row => row.route === 'ruins');
    // At the 0.2 expedition ryo scale (owner ruling 2026-10-23).
    assert.deepEqual(ruins.map(row => row.secureRyoPerDay), [5_184, 7_776, 11_690, 23_380]);
    assert.deepEqual(ruins.map(row => row.dailyClaims), [12, 12, 14, 14]);
    const boon = ruins.at(-1)!;
    assert.equal(boon.requiredPetLevel, 80);
    assert.equal(boon.rewardMastery, 1.15);
    assert.equal(boon.sealedRyoPerClaim, 835);
    assert.equal(boon.secureRyoPerClaim, 1_670);
    assert.equal(boon.allInvestigationsSucceedRyoPerDay, 29_232);
    assert.equal(boon.investigateRyoExpectedPerDay, 23_150.4, 'round each outcome before applying probabilities and daily claims');
    assert.ok(boon.allInvestigationsSucceedRyoPerDay > boon.secureRyoPerDay);
    assert.ok(boon.investigateRyoExpectedPerDay < boon.secureRyoPerDay);
    assert.equal(forecast.activityAnchor.find(row => row.level === 90)?.standard90MinuteRyo, 27_000);

    let spec: Record<string, number> = {};
    for (const node of ['exp-rewards', 'exp-rewards', 'exp-rewards', 'exp-materials', 'exp-materials', 'exp-materials', 'caravan-master']) {
        const next = applyMasteryInvestment('petTamer', 32_850 + 150_000, spec, node);
        assert.ok(next, node + ' is a legal mastery investment'); spec = next;
    }
    assert.equal(spec['exp-rewards'], 3);
    assert.equal(spec['caravan-master'], 1);
});

test('Broker forecasts distinguish certificate issuance, redemption, paid debits and transfers', () => {
    const { broker } = economyIncomeForecasts();
    assert.equal(rallyBrokerCertificates(1), 2);
    assert.equal(rallyBrokerCertificates(2), 1);
    assert.equal(rallyBrokerCertificates(3), 0);
    assert.equal(caravanBrokerCertificates(true), 1);
    assert.equal(caravanBrokerCertificates(false), 0);
    assert.deepEqual(broker.expectedRewardPerPull, { ryo: 24_100, fateShards: .32, boneCharms: .53, auraStones: .26 });
    assert.equal(broker.paidPullCostRyo, 75_000);
    assert.equal(broker.certificatePullCostRyo, 37_500, 'a certificate covers half the stake');
    assert.equal(broker.paidPullNetRyo, -50_900);
    assert.equal(broker.certificatePullNetRyo, -13_400);
    assert.deepEqual(broker.dailySuccessScenario, { certificates: 3, expectedRedemptionRyo: 72_300, expectedRedemptionNetRyo: -40_200 });
    assert.equal(brokerExpectedNetRyo(1, 3), -91_100);
    assert.equal(brokerExpectedNetRyo(1, 3, 1_000), -92_100);
    assert.equal(brokerExpectedNetRyo(0, 0), 0, 'earning unredeemed certificates is not immediate ryo');
});

test('the checked-in economy handoff contains current forecasts and avoids counting certificate value twice', () => {
    const model = JSON.parse(readFileSync(new URL('../docs/generated/economy-model.json', import.meta.url), 'utf8'));
    assert.deepEqual(model.incomeForecasts, economyIncomeForecasts());
    const cash = model.faucets.filter((row: { id: string; currency: string }) => row.id === 'black-market-certificate-pull' && row.currency === 'ryo');
    assert.equal(cash.length, 1);
    assert.equal(cash[0].amount, 24_100);
    const awards = model.faucets.filter((row: { currency: string }) => row.currency === 'brokerCertificates');
    assert.deepEqual(awards.map((row: { amount: number }) => row.amount), [2, 1]);
    assert.ok(awards.every((row: { notes: string }) => /not immediate ryo|redemption value is modeled separately/.test(row.notes)));
    assert.equal(model.sinks.find((row: { id: string }) => row.id === 'black-market-pull').cadence, 'per paid ryo pull only');
    assert.equal(model.sinks.find((row: { id: string }) => row.id === 'black-market-certificate-pull').amount, 37_500);
});
