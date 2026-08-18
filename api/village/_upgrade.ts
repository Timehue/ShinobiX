/*
 * Village upgrades — SHARED village infrastructure (owner ruling 2026-08-17).
 *
 * ── What changed and why ────────────────────────────────────────────────────
 * These used to live on `character.villageUpgrades`, bought with the buyer's own
 * Honor Seals. Despite the name, nothing about them was shared: the seated Kage
 * spent their personal seals and only the Kage received the bonus. That made the
 * Vanguard — whose whole purpose is to be the best at PvP FOR THEIR VILLAGE —
 * the best at PvP for themselves, because seals bought nobody else anything.
 *
 * Now the levels live on the village-state blob and are paid for out of the
 * village TREASURY seal pool, which is what Vanguards donate into. The loop the
 * design always described is finally the loop the code runs:
 *
 *     Vanguard wins PvP -> Honor Seals -> village treasury -> Kage buys an
 *     upgrade -> EVERY member of the village gets the bonus.
 *
 * `character.villageUpgrades` survives as a server-validated MIRROR of
 * `state.upgrades` so the ~21 existing read sites (bank interest, mission
 * rewards, shop discount, training rate, hospital, jutsu speed, pet yard, town
 * defense) keep working unchanged — the same mirror pattern clan upgrades use.
 */

export const VILLAGE_UPGRADE_KEYS = ['training', 'jutsuTraining', 'shop', 'townDefense', 'petYard', 'bank', 'missionHall', 'hospital'] as const;
export type Key = typeof VILLAGE_UPGRADE_KEYS[number];
export const VILLAGE_UPGRADE_MAX_LEVEL = 50;

const BASE: Record<Key, number> = { training: 10, jutsuTraining: 12, shop: 12, townDefense: 14, petYard: 12, bank: 16, missionHall: 14, hospital: 12 };

export function villageUpgradeCostServer(key: Key, currentLevel: number) {
    return Math.floor(BASE[key] + currentLevel * 4 + Math.pow(currentLevel, 1.25) * 2);
}

const num = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

/** The village's upgrade levels, normalized. Unknown keys dropped, levels clamped. */
export function readVillageUpgrades(state: Record<string, unknown> | null | undefined): Record<string, number> {
    const raw = (state?.upgrades && typeof state.upgrades === 'object' && !Array.isArray(state.upgrades))
        ? state.upgrades as Record<string, unknown>
        : {};
    const out: Record<string, number> = {};
    for (const key of VILLAGE_UPGRADE_KEYS) {
        const level = Math.min(VILLAGE_UPGRADE_MAX_LEVEL, num(raw[key]));
        if (level > 0) out[key] = level;
    }
    return out;
}

export type VillageUpgradePurchase =
    | { ok: true; cost: number; level: number; upgrades: Record<string, number>; nextSeals: number }
    | { ok: false; reason: 'unknown-village-upgrade' | 'village-upgrade-max' | 'insufficient-treasury-seals' };

/**
 * Buy one level of a village upgrade out of the village treasury's Honor Seals.
 * Pure: the caller holds the village-state lock and writes the result.
 */
export function purchaseVillageUpgrade(state: Record<string, unknown> | null | undefined, keyRaw: unknown): VillageUpgradePurchase {
    const key = typeof keyRaw === 'string' && (VILLAGE_UPGRADE_KEYS as readonly string[]).includes(keyRaw) ? keyRaw as Key : null;
    if (!key) return { ok: false, reason: 'unknown-village-upgrade' };

    const upgrades = readVillageUpgrades(state);
    const level = upgrades[key] ?? 0;
    if (level >= VILLAGE_UPGRADE_MAX_LEVEL) return { ok: false, reason: 'village-upgrade-max' };

    const treasury = (state?.treasury && typeof state.treasury === 'object') ? state.treasury as Record<string, unknown> : {};
    const seals = num(treasury.honorSeals);
    const cost = villageUpgradeCostServer(key, level);
    if (seals < cost) return { ok: false, reason: 'insufficient-treasury-seals' };

    return { ok: true, cost, level: level + 1, upgrades: { ...upgrades, [key]: level + 1 }, nextSeals: seals - cost };
}
