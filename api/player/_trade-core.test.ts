import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrade, isTradeCurrency, TRADE_TAX_PCT, TRADE_CAPS, TRADE_MINS } from './_trade-core.js';

test('isTradeCurrency: only the four allowed currencies', () => {
    assert.equal(isTradeCurrency('ryo'), true);
    assert.equal(isTradeCurrency('fateShards'), true);
    assert.equal(isTradeCurrency('boneCharms'), true);
    assert.equal(isTradeCurrency('auraStones'), true);
    // Vanguard-locked / top-rarity / non-currency are rejected.
    assert.equal(isTradeCurrency('honorSeals'), false);
    assert.equal(isTradeCurrency('mythicSeals'), false);
    assert.equal(isTradeCurrency('auraDust'), false);
    assert.equal(isTradeCurrency('bankRyo'), false);
    assert.equal(isTradeCurrency(''), false);
    assert.equal(isTradeCurrency(undefined), false);
});

test('planTrade: burns the tax and credits the rest', () => {
    const plan = planTrade('ryo', 100_000, 500_000);
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.debit, 100_000);
    assert.equal(plan.credit, Math.floor(100_000 * (1 - TRADE_TAX_PCT)));
    assert.equal(plan.burned, 100_000 - plan.credit);
    // Recipient never gets more than the sender loses.
    assert.ok(plan.credit + plan.burned === plan.debit);
});

test('planTrade: tax floors so the burn absorbs the rounding remainder', () => {
    // 1001 ryo at 10% → credit floor(900.9)=900, burn=101 (>10% by the remainder).
    const plan = planTrade('ryo', 1001, 1001);
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.credit, 900);
    assert.equal(plan.burned, 101);
    assert.equal(plan.credit + plan.burned, plan.debit);
});

test('planTrade: rejects below minimum', () => {
    const plan = planTrade('ryo', TRADE_MINS.ryo - 1, 1_000_000);
    assert.equal(plan.ok, false);
});

test('planTrade: rejects above per-transfer cap', () => {
    const plan = planTrade('ryo', TRADE_CAPS.ryo + 1, 10_000_000);
    assert.equal(plan.ok, false);
});

test('planTrade: rejects insufficient balance', () => {
    const plan = planTrade('fateShards', 50, 49);
    assert.equal(plan.ok, false);
});

test('planTrade: accepts a fate-shard transfer at the floor', () => {
    const plan = planTrade('fateShards', 10, 10);
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.debit, 10);
    assert.equal(plan.credit, 9); // floor(10 * 0.9)
    assert.equal(plan.burned, 1);
});

test('planTrade: rejects a non-tradeable currency', () => {
    const plan = planTrade('honorSeals', 10, 10_000);
    assert.equal(plan.ok, false);
});

test('planTrade: rejects NaN / non-numeric amount', () => {
    assert.equal(planTrade('ryo', 'abc', 1_000_000).ok, false);
    assert.equal(planTrade('ryo', NaN, 1_000_000).ok, false);
});
