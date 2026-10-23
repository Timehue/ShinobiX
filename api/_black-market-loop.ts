import { BLACK_MARKET_COST, rollBlackMarket } from './festival/_black-market.js';
import { EXCHANGE_FEE_PERCENT } from '../shared/sunscar-exchange.js';

/*
 * The ryo -> black market -> Exchange -> ryo loop (2026-10 economy rebalance,
 * #40). A pull pays ryo plus Fate Shards, Bone Charms and Aura Stones, and all
 * three resources sell for ryo on the Sunscar Exchange. While the loop product
 *
 *   L = (EV ryo + (1 - fee) x (EV FS x P_FS + EV BC x P_BC + EV AS x P_AS)) / cost
 *
 * stays below 1 the black market is a net ryo sink; above 1 it prints ryo. The
 * admin economy snapshot evaluates L daily on the measured Exchange medians, and
 * the owner raises the pull to 90,000 when it holds at or above 0.93 for seven
 * days (0.93 is the point an FS median of about 141k reaches at the fallback
 * Bone Charm and Aura Stone prices). The dial is a deliberate deploy rather than
 * an env override: the client quotes its own copy of the price, and a
 * server-only change would split the quoted and charged price.
 */

export type BlackMarketPullEv = { ryo: number; fateShards: number; boneCharms: number; auraStones: number };

const EV_GRID = 10_000;
let cachedEv: BlackMarketPullEv | null = null;

/**
 * The exact expected payout of one pull. The first rand() picks the tier and is
 * swept over the midpoints of a fine grid of [0, 1); every later rand() is 0.5,
 * where randInt returns the exact midpoint of its range. Tier boundaries are
 * multiples of 0.01, so each tier receives exactly its probability share.
 */
export function blackMarketPullEv(): BlackMarketPullEv {
    if (cachedEv) return cachedEv;
    const total = { ryo: 0, fateShards: 0, boneCharms: 0, auraStones: 0 };
    for (let i = 0; i < EV_GRID; i++) {
        const first = (i + 0.5) / EV_GRID;
        let tierPicked = false;
        const reward = rollBlackMarket(() => {
            if (tierPicked) return 0.5;
            tierPicked = true;
            return first;
        });
        total.ryo += reward.ryo;
        total.fateShards += reward.fateShards;
        total.boneCharms += reward.boneCharms;
        total.auraStones += reward.auraStones;
    }
    cachedEv = {
        ryo: total.ryo / EV_GRID,
        fateShards: total.fateShards / EV_GRID,
        boneCharms: total.boneCharms / EV_GRID,
        auraStones: total.auraStones / EV_GRID,
    };
    return cachedEv;
}

/**
 * Ryo values used for Bone Charms and Aura Stones until the Exchange reports a
 * median for them. 690 is roughly what the wanderer merchant charges per Bone
 * Charm; 10,000 per Aura Stone makes the pull's 0.53 BC + 0.26 AS worth about
 * 3,000 ryo, the framework's valuation of that bundle.
 */
export const BLACK_MARKET_LOOP_FALLBACK_RYO = { boneCharms: 690, auraStones: 10_000 } as const;
export const BLACK_MARKET_DIAL_LOOP_THRESHOLD = 0.93;
export const BLACK_MARKET_DIAL_DAYS = 7;
/** The price the dial moves the pull to (econ framework #40). */
export const BLACK_MARKET_DIAL_COST = 90_000;

export type BlackMarketLoopPrices = { fateShards: number | null; boneCharms?: number | null; auraStones?: number | null };
export type BlackMarketLoop = { product: number; assumed: Array<'boneCharms' | 'auraStones'> };

function measured(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** L for the given Exchange unit prices, or null without an FS price. */
export function blackMarketLoopProduct(prices: BlackMarketLoopPrices, cost: number = BLACK_MARKET_COST): BlackMarketLoop | null {
    if (!measured(prices.fateShards) || !(cost > 0)) return null;
    const ev = blackMarketPullEv();
    const assumed: BlackMarketLoop['assumed'] = [];
    let bc: number = BLACK_MARKET_LOOP_FALLBACK_RYO.boneCharms;
    if (measured(prices.boneCharms)) bc = prices.boneCharms;
    else assumed.push('boneCharms');
    let as: number = BLACK_MARKET_LOOP_FALLBACK_RYO.auraStones;
    if (measured(prices.auraStones)) as = prices.auraStones;
    else assumed.push('auraStones');
    const keep = 1 - EXCHANGE_FEE_PERCENT / 100;
    const resaleRyo = keep * (ev.fateShards * prices.fateShards + ev.boneCharms * bc + ev.auraStones * as);
    return { product: (ev.ryo + resaleRyo) / cost, assumed };
}
