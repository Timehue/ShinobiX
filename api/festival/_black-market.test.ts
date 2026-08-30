import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    rollBlackMarket,
    settleBlackMarketPull,
    BLACK_MARKET_COST,
    BLACK_MARKET_DAILY_CAP,
    type BlackMarketReward,
} from './_black-market.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    assert.ok(scraps.ryo >= 8_000 && scraps.ryo <= 24_000);
    const scrapsMax = rollBlackMarket(seeded(0.0, 0.999));
    assert.ok(scrapsMax.ryo >= 8_000 && scrapsMax.ryo <= 24_000);

    const haul = rollBlackMarket(seeded(0.8, 0.999));
    assert.ok(haul.ryo >= 44_000 && haul.ryo <= 76_000);

    const relic = rollBlackMarket(seeded(0.9, 0.999));
    assert.equal(rollBlackMarket(seeded(0.6, 0.999)).fateShards, 1, 'trinket tier is a flat single shard');
    assert.ok(relic.boneCharms >= 4 && relic.boneCharms <= 8);
    assert.ok(relic.auraStones >= 2 && relic.auraStones <= 4);

    const jackpot = rollBlackMarket(seeded(0.999));
    assert.equal(jackpot.ryo, 150_000);
    // Premium output cut ~55% on 2026-08-17: Sunscar is permanent, so the pull
    // is standing economy and its Fate Shard yield had to be a chosen number
    // rather than an emergent one (~2,518/yr at the daily cap -> ~1,168).
    assert.equal(jackpot.fateShards, 10);
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

test('the displayed price matches the charged price', () => {
    // A client/server price split is silent and player-facing: the pull quotes
    // one number and the server debits another. Same class of bug the Fate Dice
    // and Kage-challenge costs each had.
    const client = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'black-market.ts'), 'utf8');
    const match = /export const BLACK_MARKET_COST = ([\d_]+);/.exec(client);
    assert.ok(match, 'client BLACK_MARKET_COST not found');
    assert.equal(Number(match![1].replace(/_/g, '')), BLACK_MARKET_COST);
});

/*
 * Settlement tests. The odds tests above cover WHAT a pull pays; these cover
 * whether the player is charged correctly for it. This is a live ryo gamble, so
 * the property that matters most is that a pull can never take the stake without
 * handing back the roll.
 */

const PAYOUT: BlackMarketReward = {
    tier: 'haul', label: 'test haul',
    ryo: 30_000, fateShards: 2, boneCharms: 3, auraStones: 4, mythicSeals: 5,
};

const player = (over: Record<string, unknown> = {}) => ({
    name: 'Kaze', ryo: 200_000, fateShards: 1, boneCharms: 1,
    auraStones: 1, mythicSeals: 1, level: 40, ...over,
});

test('a pull debits the stake and credits the roll on ONE character object', () => {
    const before = player();
    const settled = settleBlackMarketPull({ character: before, used: 0, roll: PAYOUT });
    assert.equal(settled.ok, true);
    if (!settled.ok) return;

    // Charge and payout are inseparable: both land on the object the caller
    // writes once, so a pull can never bill without paying.
    assert.equal(settled.nextCharacter.ryo, 200_000 - BLACK_MARKET_COST + PAYOUT.ryo);
    assert.equal(settled.nextCharacter.fateShards, 1 + PAYOUT.fateShards);
    assert.equal(settled.nextCharacter.boneCharms, 1 + PAYOUT.boneCharms);
    assert.equal(settled.nextCharacter.auraStones, 1 + PAYOUT.auraStones);
    assert.equal(settled.nextCharacter.mythicSeals, 1 + PAYOUT.mythicSeals);
    assert.equal(settled.nextUsed, 1, 'exactly one pull is counted');

    // The input is untouched, so a caller that discards the result on a failed
    // write leaves the player exactly as they were.
    assert.equal(before.ryo, 200_000);
    assert.equal(before.fateShards, 1);
});

test('a pull preserves every unrelated field on the save', () => {
    const settled = settleBlackMarketPull({ character: player({ nindo: 'never retreat' }), used: 3, roll: PAYOUT });
    assert.equal(settled.ok, true);
    if (!settled.ok) return;
    assert.equal(settled.nextCharacter.name, 'Kaze');
    assert.equal(settled.nextCharacter.level, 40);
    assert.equal(settled.nextCharacter.nindo, 'never retreat');
});

test('the daily cap refuses at the boundary and charges nothing', () => {
    const atCap = settleBlackMarketPull({ character: player(), used: BLACK_MARKET_DAILY_CAP, roll: PAYOUT });
    assert.equal(atCap.ok, false);
    if (atCap.ok) return;
    assert.equal(atCap.status, 429);
    assert.equal(atCap.body.dailyUsed, BLACK_MARKET_DAILY_CAP);
    assert.equal(atCap.body.dailyCap, BLACK_MARKET_DAILY_CAP);
    assert.equal('nextCharacter' in atCap, false, 'a refused pull hands back no save to write');

    // One below the cap is still allowed: the cap must not be off by one.
    const lastPull = settleBlackMarketPull({ character: player(), used: BLACK_MARKET_DAILY_CAP - 1, roll: PAYOUT });
    assert.equal(lastPull.ok, true);
    if (!lastPull.ok) return;
    assert.equal(lastPull.nextUsed, BLACK_MARKET_DAILY_CAP);
});

test('an unaffordable pull is refused without mutation, exactly at the boundary', () => {
    const broke = settleBlackMarketPull({ character: player({ ryo: BLACK_MARKET_COST - 1 }), used: 0, roll: PAYOUT });
    assert.equal(broke.ok, false);
    if (broke.ok) return;
    assert.equal(broke.status, 400);
    assert.equal('nextCharacter' in broke, false);

    // Exactly the cost is affordable, and spends down to just the payout.
    const exact = settleBlackMarketPull({ character: player({ ryo: BLACK_MARKET_COST }), used: 0, roll: PAYOUT });
    assert.equal(exact.ok, true);
    if (!exact.ok) return;
    assert.equal(exact.nextCharacter.ryo, PAYOUT.ryo);
});

test('a losing roll still only ever costs the advertised stake', () => {
    const nothing: BlackMarketReward = {
        tier: 'scraps', label: 'dust', ryo: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0,
    };
    const settled = settleBlackMarketPull({ character: player(), used: 0, roll: nothing });
    assert.equal(settled.ok, true);
    if (!settled.ok) return;
    assert.equal(settled.nextCharacter.ryo, 200_000 - BLACK_MARKET_COST);
    assert.equal(settled.nextCharacter.fateShards, 1, 'a losing roll credits nothing');
});

test('a missing or malformed balance never reads as free money', () => {
    for (const bad of [undefined, null, 'lots', NaN, {}]) {
        const settled = settleBlackMarketPull({ character: player({ ryo: bad }), used: 0, roll: PAYOUT });
        assert.equal(settled.ok, false, `ryo=${String(bad)} must not afford a pull`);
        if (settled.ok) return;
        assert.equal(settled.status, 400);
    }
    // A junk secondary balance counts as zero rather than poisoning the credit.
    const settled = settleBlackMarketPull({ character: player({ fateShards: 'many' }), used: 0, roll: PAYOUT });
    assert.equal(settled.ok, true);
    if (!settled.ok) return;
    assert.equal(settled.nextCharacter.fateShards, PAYOUT.fateShards);
});
