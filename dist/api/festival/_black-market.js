"use strict";
/*
 * Pure RNG + payout table for the Sunscar black-market gamble
 * (api/festival/black-market.ts). Split out so the odds + magnitudes are
 * unit-testable with a seeded rng and live in one reviewable place.
 *
 * This is a SINK, not a faucet: the expected ryo return is well under the
 * COST (~45%), so over many pulls the economy loses ryo. The upside tiers keep
 * it exciting without making it +EV. All currency payouts only — no inventory
 * mutation — so the handler stays a simple currency read-modify-write.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLACK_MARKET_DAILY_CAP = exports.BLACK_MARKET_COST = void 0;
exports.rollBlackMarket = rollBlackMarket;
exports.BLACK_MARKET_COST = 25_000; // ryo per pull
exports.BLACK_MARKET_DAILY_CAP = 10;
// Inclusive integer in [min, max] from a [0,1) rng.
function randInt(rand, min, max) {
    return min + Math.floor(rand() * (max - min + 1));
}
const EMPTY = { ryo: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0 };
/**
 * Roll a single pull. `rand` is an injectable [0,1) source so tests can pin a
 * tier; production passes Math.random. The first rand() picks the tier, later
 * rand() calls size the payout.
 */
function rollBlackMarket(rand) {
    const r = rand();
    if (r < 0.50) {
        return { ...EMPTY, tier: 'scraps', label: 'Scraps from the dust', ryo: randInt(rand, 4_000, 12_000) };
    }
    if (r < 0.72) {
        return { ...EMPTY, tier: 'trinket', label: 'A smuggled trinket', fateShards: randInt(rand, 1, 3) };
    }
    if (r < 0.87) {
        return { ...EMPTY, tier: 'haul', label: 'A tidy haul', ryo: randInt(rand, 22_000, 38_000) };
    }
    if (r < 0.95) {
        return { ...EMPTY, tier: 'relic', label: 'A relic cache', boneCharms: randInt(rand, 4, 8), auraStones: randInt(rand, 2, 4) };
    }
    if (r < 0.99) {
        return { ...EMPTY, tier: 'fortune', label: 'A desert fortune', ryo: randInt(rand, 55_000, 85_000) };
    }
    return { ...EMPTY, tier: 'jackpot', label: 'THE BLACK SUN JACKPOT', ryo: 50_000, fateShards: 10, mythicSeals: 1 };
}
