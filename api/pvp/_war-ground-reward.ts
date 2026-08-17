import {
    embedPvpSettlementReceipt,
    inspectPvpCredit,
    pvpSettlementId,
} from './_reward-settlement.js';

export const PVP_WAR_GROUND_BOUNTY_RYO = 500;
export const PVP_WAR_GROUND_BOUNTY_FATE_SHARDS = 1;
export const PVP_WAR_GROUND_DAILY_RAID_LIMIT = 6;
export const PVP_VILLAGE_WAR_MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export interface PvpWarGroundRewardResult {
    character: Record<string, unknown>;
    fresh: boolean;
    writeRequired: boolean;
    bountyCredited: boolean;
    raidProgress: number;
}

function utcDateKey(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

function validDateKey(value: unknown): string {
    const key = String(value ?? '');
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
}

/**
 * Credit the server-sealed World raid's village-war daily progress and bounty.
 * The battle-derived receipt is embedded in the SAME character object as the
 * currency/progress mutation; the caller publishes that object as one versioned
 * save write. A crash can therefore expose neither marker-before-body nor
 * body-before-marker gaps.
 */
export function creditPvpWarGroundReward(
    character: Record<string, unknown>,
    battleId: string,
    now: number,
): PvpWarGroundRewardResult {
    const settlementId = pvpSettlementId('war-ground', battleId);
    const fingerprint = 'war-ground-v1';
    const decision = inspectPvpCredit(character, settlementId, fingerprint);
    const today = utcDateKey(now);
    const missionDay = validDateKey(character.villageWarMissionDate);
    const bountyDay = validDateKey(character.warGroundBountyDate);
    const sameMissionDay = missionDay === today;
    const newerMissionDay = missionDay > today;
    const newerKnownDay = missionDay > today || bountyDay > today;
    const storedProgress = Math.max(0, Math.floor(Number(character.villageWarRaidProgress) || 0));
    const currentProgress = sameMissionDay || newerMissionDay ? storedProgress : 0;
    if (!decision.fresh) {
        return {
            character: decision.needsBackfill
                ? embedPvpSettlementReceipt(character, decision.receipts, settlementId, fingerprint, now)
                : character,
            fresh: false,
            writeRequired: decision.needsBackfill,
            bountyCredited: false,
            raidProgress: currentProgress,
        };
    }

    const bountyCredited = !newerKnownDay && bountyDay !== today;
    const raidProgress = newerMissionDay
        ? currentProgress
        : Math.min(PVP_WAR_GROUND_DAILY_RAID_LIMIT, currentProgress + 1);
    const credited = {
        ...character,
        ...(!newerMissionDay ? {
            villageWarMissionDate: today,
            villageWarRaidProgress: raidProgress,
            villageWarMissionsCompleted: sameMissionDay
                ? Math.max(0, Math.floor(Number(character.villageWarMissionsCompleted) || 0))
                : 0,
        } : {}),
        ...(bountyCredited ? {
            warGroundBountyDate: today,
            ryo: Math.max(0, Math.floor(Number(character.ryo) || 0)) + PVP_WAR_GROUND_BOUNTY_RYO,
            fateShards: Math.max(0, Math.floor(Number(character.fateShards) || 0)) + PVP_WAR_GROUND_BOUNTY_FATE_SHARDS,
        } : {}),
    };
    return {
        character: embedPvpSettlementReceipt(
            credited,
            decision.receipts,
            settlementId,
            fingerprint,
            now,
        ),
        fresh: true,
        writeRequired: true,
        bountyCredited,
        raidProgress,
    };
}

export interface PvpWarGroundEligibilityWar {
    villages: readonly string[];
    warGroundSector: number;
    startedAt: number;
    pendingUntil?: number;
    endedAt?: number;
}

function norm(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

/** Exact timestamp/sector/village gate for the in-save reward above. */
export function pvpWarGroundRewardEligible(args: {
    actorVillage: string;
    loserVillage: string;
    rewardSector: number;
    battleCreatedAt: number;
    battleEndedAt: number;
    war: PvpWarGroundEligibilityWar | null | undefined;
}): boolean {
    const war = args.war;
    if (!war) return false;
    const actorVillage = norm(args.actorVillage);
    const loserVillage = norm(args.loserVillage);
    const villages = war.villages.map(norm);
    if (!actorVillage || !loserVillage || actorVillage === loserVillage
        || villages.length !== 2
        || !villages.includes(actorVillage)
        || !villages.includes(loserVillage)) return false;
    if (!Number.isSafeInteger(args.rewardSector) || args.rewardSector !== Math.floor(Number(war.warGroundSector))) return false;
    const battleAt = Number(args.battleCreatedAt);
    const battleEndedAt = Number(args.battleEndedAt);
    const effectiveStart = Number(war.pendingUntil ?? war.startedAt);
    if (!Number.isSafeInteger(battleAt) || battleAt <= 0
        || !Number.isSafeInteger(battleEndedAt) || battleEndedAt < battleAt
        || !Number.isSafeInteger(effectiveStart) || effectiveStart <= 0
        || battleAt < effectiveStart) return false;
    const maxLifetimeEnd = effectiveStart + PVP_VILLAGE_WAR_MAX_DURATION_MS;
    if (!Number.isSafeInteger(maxLifetimeEnd)) return false;
    let effectiveEnd = maxLifetimeEnd;
    if (war.endedAt !== undefined) {
        const endedAt = Number(war.endedAt);
        if (!Number.isSafeInteger(endedAt) || endedAt < effectiveStart) return false;
        effectiveEnd = Math.min(effectiveEnd, endedAt);
    }
    if (battleEndedAt > effectiveEnd) return false;
    return true;
}
