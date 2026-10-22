/*
 * Pure RNG + payout table for the Sunscar black-market gamble
 * (api/festival/black-market.ts). Split out so the odds + magnitudes are
 * unit-testable with a seeded rng and live in one reviewable place.
 *
 * Paid pulls are a ryo sink: expected ryo return is well under COST (~32%,
 * 24,100 ryo per 75,000 pull). Earned Broker certificates cover the stake for
 * a free pull using the same payout table and daily cap. Stake/certificate
 * debit and currency payout commit on one character object.
 */

// Sunscar is PERMANENT (owner ruling 2026-08-17), so this is standing economy,
// not event flavour, and its premium output has to be a number that was chosen
// rather than one that emerged. At 50,000 a pull it produced ~0.69 Fate Shards
// each — about 2,500 a year for someone pulling the daily cap — which made it
// quietly the largest uncontrolled premium faucet in the game.
//
// Re-costed to 75,000 (1.73 regular L90 days at 43,360 a day, and the deepest
// ryo sink available) with the premium tiers cut roughly 55%. It stays a
// genuine ryo sink by construction: expected ryo return is well under the cost,
// asserted by the colocated test, which also pins the Exchange FS break-even
// price above the 140k alarm. Guard dial (econ framework #40): the owner moves
// this AND shinobij.client/src/lib/black-market.ts to 90,000 when the admin
// snapshot's black-market loop product holds >= 0.93 for 7 days
// (api/_black-market-loop.ts). No env override: the client quotes its own copy.
import { brokerCertificateCount, type BrokerPayment } from '../../shared/sunscar/broker-certificates.js';
export type { BrokerCrateReward as BlackMarketReward } from '../../shared/sunscar/broker-certificates.js';
import type { BrokerCrateReward as BlackMarketReward } from '../../shared/sunscar/broker-certificates.js';

export const BLACK_MARKET_COST = 75_000; // ryo per paid pull
export const BLACK_MARKET_DAILY_CAP = 10;

// Inclusive integer in [min, max] from a [0,1) rng.
function randInt(rand: () => number, min: number, max: number): number {
    return min + Math.floor(rand() * (max - min + 1));
}

const EMPTY: Omit<BlackMarketReward, 'tier' | 'label'> = { ryo: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0 };

/**
 * Roll a single pull. `rand` is an injectable [0,1) source so tests can pin a
 * tier; production passes Math.random. The first rand() picks the tier, later
 * rand() calls size the payout.
 */
export function rollBlackMarket(rand: () => number): BlackMarketReward {
    const r = rand();
    if (r < 0.50) {
        return { ...EMPTY, tier: 'scraps', label: 'Scraps from the dust', ryo: randInt(rand, 8_000, 24_000) };
    }
    if (r < 0.72) {
        return { ...EMPTY, tier: 'trinket', label: 'A smuggled trinket', fateShards: 1 };
    }
    if (r < 0.87) {
        return { ...EMPTY, tier: 'haul', label: 'A tidy haul', ryo: randInt(rand, 44_000, 76_000) };
    }
    if (r < 0.95) {
        return { ...EMPTY, tier: 'relic', label: 'A relic cache', boneCharms: randInt(rand, 4, 8), auraStones: randInt(rand, 2, 4) };
    }
    if (r < 0.99) {
        return { ...EMPTY, tier: 'fortune', label: 'A desert fortune', ryo: randInt(rand, 110_000, 170_000) };
    }
    return { ...EMPTY, tier: 'jackpot', label: 'THE BLACK SUN JACKPOT', ryo: 150_000, fateShards: 10, boneCharms: 5, auraStones: 2 };
}

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

export type BlackMarketPullSettlement =
    | { ok: false; status: 429; body: { error: string; dailyUsed: number; dailyCap: number } }
    | { ok: false; status: 400; body: { error: string } }
    | { ok: true; cost: number; reward: BlackMarketReward; nextCharacter: Record<string, unknown>; nextUsed: number };

/**
 * Settle one pull. Pure: the handler owns every I/O step (lock, read, the two
 * writes) and this owns everything that MOVES MONEY, so the money path is
 * testable — under this repo's conventions a thin HTTP wrapper is not.
 *
 * `roll` is injected rather than rolled here so a test can pin the payout;
 * production passes rollBlackMarket(Math.random).
 *
 * The debit and every credit land on ONE character object, so a pull can never
 * charge without paying: the single save write carries both halves or neither
 * happens. The caller must co-write the daily usage and receipt on that same
 * character so an interrupted counter mirror cannot lose a counted pull.
 */
export function settleBlackMarketPull(input: {
    character: Record<string, unknown>;
    used: number;
    roll: BlackMarketReward;
    payment?: BrokerPayment;
}): BlackMarketPullSettlement {
    const { character, used, roll } = input;
    if (used >= BLACK_MARKET_DAILY_CAP) {
        return {
            ok: false,
            status: 429,
            body: {
                error: `The black market is done with you today (${BLACK_MARKET_DAILY_CAP}/${BLACK_MARKET_DAILY_CAP}). Return after midnight UTC.`,
                dailyUsed: used,
                dailyCap: BLACK_MARKET_DAILY_CAP,
            },
        };
    }
    const payment = input.payment ?? 'ryo';
    if (payment !== 'ryo' && payment !== 'certificate') return { ok: false, status: 400, body: { error: 'Choose ryo or a Broker certificate.' } };
    const certificates = brokerCertificateCount(character);
    if (payment === 'certificate' && certificates < 1) {
        return { ok: false, status: 400, body: { error: 'You do not have a Broker certificate.' } };
    }
    const cost = payment === 'certificate' ? 0 : BLACK_MARKET_COST;
    if (num(character.ryo) < cost) {
        return { ok: false, status: 400, body: { error: `Not enough ryo. A pull costs ${BLACK_MARKET_COST.toLocaleString()}.` } };
    }
    return {
        ok: true,
        cost,
        reward: roll,
        nextUsed: used + 1,
        nextCharacter: {
            ...character,
            ...(payment === 'certificate' ? { brokerCertificates: certificates - 1 } : {}),
            ryo: num(character.ryo) - cost + roll.ryo,
            fateShards: num(character.fateShards) + roll.fateShards,
            boneCharms: num(character.boneCharms) + roll.boneCharms,
            auraStones: num(character.auraStones) + roll.auraStones,
            mythicSeals: num(character.mythicSeals) + roll.mythicSeals,
        },
    };
}
