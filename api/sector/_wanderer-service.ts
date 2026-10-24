import { MAX_WILD_SECTOR, isPlayableWildSector } from '../../shared/sector-geo.js';
import { anchorRyoPerMinute } from '../../shared/economy-anchor.js';

export type WandererMerchantOffer = {
    cost: number;
    boneCharms: number;
};

export type WandererMedicOffer = {
    cost: number;
    missingHp: number;
    missingChakra: number;
    missingStamina: number;
};

export type WandererFavorReward = {
    ryo: number;
    boneCharms: number;
};

function clampInt(v: unknown, min: number, max: number): number {
    const n = Math.floor(Number(v) || 0);
    return Math.max(min, Math.min(max, n));
}

function hashString(input: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i += 1) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function wandererMerchantOffer(level: unknown, wandererId: string): WandererMerchantOffer {
    const lvl = clampInt(level, 1, 100);
    const h = hashString(`merchant:${wandererId}`);
    const boneCharms = 2 + (h % 4);
    const cost = 450 + lvl * 18 + boneCharms * 220 + (h % 180);
    return { cost, boneCharms };
}

export function wandererMedicOffer(
    level: unknown,
    hp: unknown,
    maxHp: unknown,
    chakra: unknown,
    maxChakra: unknown,
    stamina: unknown,
    maxStamina: unknown,
): WandererMedicOffer {
    const lvl = clampInt(level, 1, 100);
    const mhp = Math.max(0, Math.floor(Number(maxHp) || 0));
    const mch = Math.max(0, Math.floor(Number(maxChakra) || 0));
    const mst = Math.max(0, Math.floor(Number(maxStamina) || 0));
    const missingHp = Math.max(0, mhp - Math.max(0, Math.floor(Number(hp) || 0)));
    const missingChakra = Math.max(0, mch - Math.max(0, Math.floor(Number(chakra) || 0)));
    const missingStamina = Math.max(0, mst - Math.max(0, Math.floor(Number(stamina) || 0)));
    const raw = 160 + lvl * 10 + Math.ceil(missingHp * 0.08) + Math.ceil(missingChakra * 0.05) + missingStamina * 5;
    return { cost: Math.max(160, Math.min(25_000, raw)), missingHp, missingChakra, missingStamina };
}

/** A delivery target in any playable wild sector: 61-66 included, the Sunscar
 *  Festival sector (54) skipped. */
export function wandererFavorTargetSector(favorId: string, originSector: unknown, maxSector = MAX_WILD_SECTOR): number {
    const max = Math.max(2, Math.min(MAX_WILD_SECTOR, Math.floor(Number(maxSector) || MAX_WILD_SECTOR)));
    const from = clampInt(originSector, 1, max);
    const h = hashString(`favor:${favorId}:${from}`);
    const span = max - 1;
    let dest = 1 + (h % span);
    if (dest >= from) dest += 1;
    dest = Math.max(1, Math.min(max, dest));
    while (!isPlayableWildSector(dest) || dest === from) dest = (dest % max) + 1;
    return dest;
}

/** Wanderer favour pay (economy rebalance 2026-10, framework #19): two anchor
 *  minutes plus 10, which is 0.5 x (100 + 16 x min(L, 70)), plus a 0-95 spread
 *  per favour. Mean 178 / 338 / 498 / 658 at L10 / 30 / 50 / 70+, or 1.48x /
 *  1.21x / 1.13x / 1.10x the anchor at two minutes a favour, and it stops rising
 *  where A(L) does. Kill value (the old formula): 220 + 14L + (h % 160). */
export const FAVOR_RYO_ANCHOR_MINUTES = 2;
export const FAVOR_RYO_FLAT = 10;
export const FAVOR_RYO_SPREAD = 96;

export function wandererFavorReward(level: unknown, favorId: string): WandererFavorReward {
    const lvl = clampInt(level, 1, 100);
    const h = hashString(`favor-reward:${favorId}`);
    return {
        ryo: FAVOR_RYO_ANCHOR_MINUTES * anchorRyoPerMinute(lvl) + FAVOR_RYO_FLAT + (h % FAVOR_RYO_SPREAD),
        boneCharms: 1 + (h % 2),
    };
}
