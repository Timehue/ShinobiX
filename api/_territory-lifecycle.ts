export const TERRITORY_BREACH_DURATION_MS = 12 * 60 * 60 * 1_000;
export const TERRITORY_REWARD_SUSPEND_MS = 14 * 24 * 60 * 60 * 1_000;
export const TERRITORY_INACTIVE_RELEASE_MS = 30 * 24 * 60 * 60 * 1_000;
export const TERRITORY_HP_MAX = 20_000;

export type TerritoryLifecycleRow = Record<string, unknown> & {
    sector?: number;
    ownerClan?: string;
    ownerVillage?: string;
    backgroundImage?: string;
    controlScore?: number;
    hp?: number;
    weather?: string;
    terrainBuffStat?: string;
    guards?: string[];
    warSupply?: number;
    lastSupplyAt?: number;
    updatedAt?: number;
    rebuiltAt?: number;
    breachedAt?: number;
    breachEndsAt?: number;
    rewardSuspendedAt?: number;
    inactiveReleaseAt?: number;
    releaseReason?: string;
};

function finiteTimestamp(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function territoryBreachDeadline(row: Record<string, unknown>): number | undefined {
    const startedAt = finiteTimestamp(row.breachedAt);
    if (!startedAt) return undefined;
    return finiteTimestamp(row.breachEndsAt) ?? startedAt + TERRITORY_BREACH_DURATION_MS;
}

export function territoryIsBreached(row: Record<string, unknown>, now = Date.now()): boolean {
    if (!row.ownerClan || !finiteTimestamp(row.breachedAt)) return false;
    const deadline = territoryBreachDeadline(row);
    return !!deadline && (now < deadline || Math.max(0, Number(row.hp) || 0) <= 0);
}

/** Benefits are suspended during a breach and after verified clan inactivity. */
export function territoryRewardsSuspended(row: Record<string, unknown>, now = Date.now()): boolean {
    return territoryIsBreached(row, now) || !!finiteTimestamp(row.rewardSuspendedAt);
}

export function beginTerritoryBreach(
    row: TerritoryLifecycleRow,
    now: number,
    bankedWarSupply?: number,
): TerritoryLifecycleRow {
    const existingStart = finiteTimestamp(row.breachedAt);
    const breachedAt = existingStart ?? now;
    const breachEndsAt = existingStart
        ? territoryBreachDeadline(row) ?? breachedAt + TERRITORY_BREACH_DURATION_MS
        : breachedAt + TERRITORY_BREACH_DURATION_MS;
    const storedWarSupply = Math.max(0, Math.floor(Number(row.warSupply) || 0));
    const materializedWarSupply = bankedWarSupply === undefined
        ? storedWarSupply
        : Math.max(0, Math.floor(bankedWarSupply));
    return {
        ...row,
        hp: 0,
        // A dormant territory returns zero from collectTerritorySupply. Never
        // let entering breach erase supply that was already banked before the
        // suspension; materialization may only increase the stored balance.
        warSupply: Math.max(storedWarSupply, materializedWarSupply),
        lastSupplyAt: now,
        breachedAt,
        breachEndsAt,
        updatedAt: now,
    };
}

export function releaseTerritory(
    row: TerritoryLifecycleRow,
    now: number,
    reason: 'breached' | 'clan-inactive' | 'clan-missing' | 'clan-dissolved',
): TerritoryLifecycleRow {
    const released: TerritoryLifecycleRow = {
        ...row,
        ownerClan: undefined,
        // Clan control and village-map control are separate layers. A clan can
        // forfeit its banner without silently undoing a village's sector-war
        // victory; only the sector-war authority may change ownerVillage.
        ownerVillage: row.ownerVillage,
        backgroundImage: undefined,
        controlScore: 0,
        hp: TERRITORY_HP_MAX,
        weather: undefined,
        terrainBuffStat: 'bukijutsuOffense',
        guards: [],
        warSupply: 0,
        lastSupplyAt: undefined,
        rebuiltAt: now,
        updatedAt: now,
        breachedAt: undefined,
        breachEndsAt: undefined,
        rewardSuspendedAt: undefined,
        inactiveReleaseAt: undefined,
        releaseReason: reason,
    };
    return released;
}

export type BreachSettlement = {
    row: TerritoryLifecycleRow;
    changed: boolean;
    outcome: 'none' | 'recovered' | 'released';
};

/**
 * A repaired sector survives when its fixed 12-hour breach deadline expires.
 * A sector still at 0 HP is released. Repairing never moves the deadline.
 */
export function settleExpiredTerritoryBreach(
    row: TerritoryLifecycleRow,
    now: number,
): BreachSettlement {
    const deadline = territoryBreachDeadline(row);
    if (!deadline || now < deadline) return { row, changed: false, outcome: 'none' };
    if (Math.max(0, Number(row.hp) || 0) <= 0) {
        return { row: releaseTerritory(row, now, 'breached'), changed: true, outcome: 'released' };
    }
    return {
        row: {
            ...row,
            breachedAt: undefined,
            breachEndsAt: undefined,
            updatedAt: now,
        },
        changed: true,
        outcome: 'recovered',
    };
}

export function clearTerritoryLifecycleForCapture(
    row: TerritoryLifecycleRow,
): TerritoryLifecycleRow {
    return {
        ...row,
        rebuiltAt: undefined,
        breachedAt: undefined,
        breachEndsAt: undefined,
        rewardSuspendedAt: undefined,
        inactiveReleaseAt: undefined,
        releaseReason: undefined,
    };
}
