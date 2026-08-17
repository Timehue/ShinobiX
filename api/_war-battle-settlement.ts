import { isDeepStrictEqual } from "node:util";
import type { KvLike } from "./_storage.js";

type SettlementStore = Pick<KvLike, "get" | "compareSet">;

export type WarBattleSettlementCommit<T> =
    | { status: "committed"; row: T }
    | { status: "conflict"; row: T | null };

/**
 * Publish battle damage and its embedded receipt against the exact war row they
 * were derived from. The advisory lock only reduces contention; this CAS is the
 * stale-lease correctness boundary.
 */
export async function commitWarBattleSettlement<T>(
    store: SettlementStore,
    key: string,
    expected: T | null,
    desired: T,
): Promise<WarBattleSettlementCommit<T>> {
    const next = JSON.parse(JSON.stringify(desired)) as T;
    try {
        if (await store.compareSet(key, expected, next)) return { status: "committed", row: next };
    } catch (error) {
        const recovered = await store.get<T>(key).catch(() => null);
        if (isDeepStrictEqual(recovered, next)) return { status: "committed", row: next };
        throw error;
    }
    const current = await store.get<T>(key);
    if (isDeepStrictEqual(current, next)) return { status: "committed", row: next };
    return { status: "conflict", row: current };
}

export interface PvpVillageWarSettlementRow {
    id: string;
    villages: [string, string];
    hp: Record<string, number>;
    warGroundSector: number;
    warGroundHp: number;
    startedAt: number;
    updatedAt: number;
    pendingUntil?: number;
    declarationGeneration?: number;
    capturedBy?: string;
    capturedAt?: number;
    winnerVillage?: string;
    endedAt?: number;
    /** Greatest immutable PvP terminal timestamp already applied to this row. */
    lastPvpBattleEndedAt?: number;
    warCrateId?: string;
    contributions?: Record<string, {
        damage: number;
        raids: number;
        pvpKills: number;
        side: string;
        name: string;
    }>;
    mvpByVillage?: Record<string, string>;
    loserCrateId?: string;
    [key: string]: unknown;
}

export interface PvpVillageWarProjection {
    actorName: string;
    actorDisplayName: string;
    actorVillage: string;
    loserVillage: string;
    /** Server-derived role swing for the ordinary sanctioned PvP win. */
    pvpDamage: number;
    /** Server-derived role damage for a sealed World raid at the war ground. */
    raidDamage: number;
    /** Whether the authoritative territory row permits a ground flip. */
    captureAuthorized: boolean;
    /** Immutable terminal time from the PvP session. */
    terminalAt: number;
    /** One safe server clock captured for this settlement attempt. */
    settlementAt: number;
}

export interface PvpVillageWarProjectionResult<T> {
    row: T;
    enemyDamage: number;
    groundDamage: number;
    captured: boolean;
    ended: boolean;
}

const WAR_GROUND_RESET_HP = 500;
const WAR_GROUND_CAPTURE_DAMAGE = 100;

function villageWarGenerationToken(war: PvpVillageWarSettlementRow): string {
    const generation = Math.floor(Number(war.declarationGeneration));
    return Number.isSafeInteger(generation) && generation > 0
        ? `${war.id}-g${generation}`
        : war.id;
}

function boundedDamage(value: unknown): number {
    const n = Math.floor(Number(value));
    return Number.isSafeInteger(n) && n > 0 ? Math.min(400, n) : 0;
}

/**
 * Apply a sealed PvP delta to the CURRENT war row. No client-provided absolute
 * row is read here: a CAS retry can therefore recompute against a successor row
 * without healing HP, erasing a receipt, or changing the battle's timestamp.
 *
 * An already-ended row is deliberately a no-op. The caller still validates the
 * battle and stamps its receipt into that row, allowing an earlier continuation
 * overtaken by the ending blow to finish without altering the winner/HP.
 */
export function projectPvpVillageWarSettlement<T extends PvpVillageWarSettlementRow>(
    current: T,
    projection: PvpVillageWarProjection,
): PvpVillageWarProjectionResult<T> {
    if (current.endedAt) {
        return { row: { ...current }, enemyDamage: 0, groundDamage: 0, captured: false, ended: false };
    }

    const terminalAt = Math.max(1, Math.floor(Number(projection.terminalAt) || 0));
    const settlementAt = Math.max(1, Math.floor(Number(projection.settlementAt) || 0));

    const actorVillage = String(projection.actorVillage ?? '').trim();
    const loserVillage = String(projection.loserVillage ?? '').trim();
    if (!actorVillage || !loserVillage
        || actorVillage === loserVillage
        || !current.villages.includes(actorVillage)
        || !current.villages.includes(loserVillage)) {
        return { row: { ...current }, enemyDamage: 0, groundDamage: 0, captured: false, ended: false };
    }

    const pvpDamage = boundedDamage(projection.pvpDamage);
    const raidDamage = boundedDamage(projection.raidDamage);
    const previousEnemyHp = Math.max(0, Math.floor(Number(current.hp?.[loserVillage]) || 0));
    const previousGroundHp = Math.max(0, Math.floor(Number(current.warGroundHp) || 0));
    const groundDamage = Math.min(previousGroundHp, raidDamage);
    let nextGroundHp = previousGroundHp - groundDamage;
    let captured = false;
    let captureDamage = 0;
    if (raidDamage > 0
        && nextGroundHp <= 0
        && current.capturedBy !== actorVillage
        && projection.captureAuthorized) {
        captured = true;
        captureDamage = WAR_GROUND_CAPTURE_DAMAGE;
        nextGroundHp = WAR_GROUND_RESET_HP;
    }

    const requestedEnemyDamage = Math.min(400, pvpDamage + raidDamage + captureDamage);
    const enemyDamage = Math.min(previousEnemyHp, requestedEnemyDamage);
    const nextEnemyHp = previousEnemyHp - enemyDamage;
    // Exact-CAS publication order is the war's ordering authority. terminalAt
    // proves overlap with the war lifetime; it does not reorder continuations
    // that arrive later. Capture/end chronology is the settlement commit clock.
    const eventAt = settlementAt;
    const ended = nextEnemyHp <= 0 && previousEnemyHp > 0;
    const generationToken = villageWarGenerationToken(current);
    const contributionKey = String(projection.actorName ?? '').trim().toLowerCase();
    const contributions = { ...(current.contributions ?? {}) };
    if (contributionKey && enemyDamage + groundDamage > 0) {
        const prior = contributions[contributionKey];
        // The battle seals the actor's village, but a war can outlive a player
        // transfer. Never move historical damage between sides merely because a
        // later battle for the same name arrives from the other village.
        if (prior && prior.side !== actorVillage) {
            // Damage still settles; only ambiguous attribution is suppressed.
        } else {
        const stablePrior = prior ?? {
            damage: 0,
            raids: 0,
            pvpKills: 0,
            side: actorVillage,
            name: String(projection.actorDisplayName || projection.actorName),
        };
        contributions[contributionKey] = {
            damage: Math.max(0, Math.floor(Number(stablePrior.damage) || 0)) + enemyDamage + groundDamage,
            raids: Math.max(0, Math.floor(Number(stablePrior.raids) || 0)) + (raidDamage > 0 ? 1 : 0),
            pvpKills: Math.max(0, Math.floor(Number(stablePrior.pvpKills) || 0)) + (pvpDamage > 0 ? 1 : 0),
            side: actorVillage,
            name: String(projection.actorDisplayName || stablePrior.name || projection.actorName),
        };
        }
    }

    const row: PvpVillageWarSettlementRow = {
        ...current,
        hp: { ...current.hp, [loserVillage]: nextEnemyHp },
        warGroundHp: nextGroundHp,
        contributions,
        updatedAt: Math.max(Math.floor(Number(current.updatedAt) || 0), eventAt),
        ...(captured ? { capturedBy: actorVillage, capturedAt: eventAt } : {}),
        ...(ended ? {
            winnerVillage: actorVillage,
            endedAt: eventAt,
            warCrateId: current.warCrateId ?? `war-crate-${generationToken}`,
        } : {}),
    };

    if (ended) {
        const mvpByVillage: Record<string, string> = {};
        for (const village of current.villages) {
            const candidates = Object.values(contributions)
                .filter(entry => entry.side === village)
                .sort((a, b) => b.damage - a.damage);
            if (candidates[0]?.name) mvpByVillage[village] = candidates[0].name;
        }
        row.mvpByVillage = mvpByVillage;
        row.loserCrateId = `loser-crate-${generationToken}`;
    }

    return { row: row as T, enemyDamage, groundDamage, captured, ended };
}
