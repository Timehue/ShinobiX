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

const SECTOR_COUNT = 60;

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

export function wandererFavorTargetSector(favorId: string, originSector: unknown, maxSector = SECTOR_COUNT): number {
    const max = Math.max(2, Math.floor(Number(maxSector) || SECTOR_COUNT));
    const from = clampInt(originSector, 1, max);
    const h = hashString(`favor:${favorId}:${from}`);
    const span = max - 1;
    let dest = 1 + (h % span);
    if (dest >= from) dest += 1;
    return Math.max(1, Math.min(max, dest));
}

export function wandererFavorReward(level: unknown, favorId: string): WandererFavorReward {
    const lvl = clampInt(level, 1, 100);
    const h = hashString(`favor-reward:${favorId}`);
    return {
        ryo: 220 + lvl * 14 + (h % 160),
        boneCharms: 1 + (h % 2),
    };
}
