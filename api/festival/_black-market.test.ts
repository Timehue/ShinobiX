import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollBlackMarket, BLACK_MARKET_COST } from './_black-market.js';

// A deterministic rng that yields a fixed first value (tier pick) then mid-range
// values for the payout sizing calls.
function seeded(first: number, rest = 0.5): () => number {
    let used = false;
    return () => { if (!used) { used = true; return first; } return rest; };
}

test('tier boundaries map to the documented odds', () => {
    assert.equal(rollBlackMarket(seeded(0.00)).tier, 'scraps');
    assert.equal(rollBlackMarket(seeded(0.49)).tier, 'scraps');
    assert.equal(rollBlackMarket(seeded(0.50)).tier, 'trinket');
    assert.equal(rollBlackMarket(seeded(0.71)).tier, 'trinket');
    assert.equal(rollBlackMarket(seeded(0.72)).tier, 'haul');
    assert.equal(rollBlackMarket(seeded(0.86)).tier, 'haul');
    assert.equal(rollBlackMarket(seeded(0.87)).tier, 'relic');
    assert.equal(rollBlackMarket(seeded(0.94)).tier, 'relic');
    assert.equal(rollBlackMarket(seeded(0.95)).tier, 'fortune');
    assert.equal(rollBlackMarket(seeded(0.98)).tier, 'fortune');
    assert.equal(rollBlackMarket(seeded(0.99)).tier, 'jackpot');
    assert.equal(rollBlackMarket(seeded(0.999)).tier, 'jackpot');
});

test('payouts stay within their advertised ranges', () => {
    const scraps = rollBlackMarket(seeded(0.0, 0.0));
    assert.ok(scraps.ryo >= 4_000 && scraps.ryo <= 12_000);
    const scrapsMax = rollBlackMarket(seeded(0.0, 0.999));
    assert.ok(scrapsMax.ryo >= 4_000 && scrapsMax.ryo <= 12_000);

    const haul = rollBlackMarket(seeded(0.8, 0.999));
    assert.ok(haul.ryo >= 22_000 && haul.ryo <= 38_000);

    const relic = rollBlackMarket(seeded(0.9, 0.999));
    assert.ok(relic.boneCharms >= 4 && relic.boneCharms <= 8);
    assert.ok(relic.auraStones >= 2 && relic.auraStones <= 4);

    const jackpot = rollBlackMarket(seeded(0.999));
    assert.equal(jackpot.ryo, 50_000);
    assert.equal(jackpot.fateShards, 25);
    assert.equal(jackpot.boneCharms, 5);
    assert.equal(jackpot.auraStones, 2);
    assert.equal(jackpot.mythicSeals, 0);
});

test('is a net ryo sink: expected ryo return is well under cost', () => {
    // Monte-Carlo with a simple LCG so the average is stable and deterministic.
    let s = 123456789;
    const rng = () => { s = (1103515245 * s + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const N = 200_000;
    let ryoOut = 0;
    for (let i = 0; i < N; i++) ryoOut += rollBlackMarket(rng).ryo;
    const avgRyo = ryoOut / N;
    // Expected ryo payout should be clearly below the 25k cost (it's a sink).
    assert.ok(avgRyo < BLACK_MARKET_COST * 0.7, `avg ryo ${avgRyo} should be < ${BLACK_MARKET_COST * 0.7}`);
});
