import { createHash } from 'node:crypto';
import { bumpLegacyStats, legacyBootstrapBeforeCounterIncrement } from '../_legacy-track.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { creditFieldRaidProgress } from './_field-raid-progress.js';
import {
    settleRaidTerritoryDamage,
    type RaidTerritoryDamageResult,
    type SealedRaidTerritoryEvidence,
} from './_raid-territory.js';
import {
    professionXpAfterAward,
    reportMissionEvent,
    type CompletedMissionInfo,
} from './_progress.js';

const RANK_4_RAID_RYO = 250;
const RANK_10_RAID_SEALS = 1;
const RAID_CAP_TTL_SECONDS = 25 * 60 * 60;

/**
 * The shared 60-raids-per-day policy, owned here beside the settler that
 * enforces it.
 *
 * Every caller passes this as `dailyLimit` and they all reserve against the SAME
 * ledger (`raid-report-count-v2:<player>:<day>`), so a second definition does
 * not create a second cap — it creates two different opinions about one counter,
 * where the limit a raid is judged against depends on which endpoint reported
 * it. It lived three times over (pvp/claim-rewards, missions/report-raid, and
 * the PvP terminal barrier) until this became the single source.
 */
export const MAX_RAID_REPORTS_PER_DAY = 60;

export type RaidProgressionSettlement = {
    version: 1;
    proofId: string;
    proofAt: number;
    fetchMissionsCredited: string[];
    xpAwarded: number;
    missionsCompleted: CompletedMissionInfo[];
    bonusRyo: number;
    bonusSeals: number;
    territoryDamage: number;
    sector?: number;
    settledAt: number;
};

export function raidProgressionReceiptId(proofId: string): string {
    return `raid_${createHash('sha256').update(proofId).digest('hex')}`;
}

const receiptId = raidProgressionReceiptId;

function settlements(character: Record<string, unknown>): RaidProgressionSettlement[] {
    return Array.isArray(character.raidProgressionSettlements)
        ? (character.raidProgressionSettlements as unknown[]).filter((entry): entry is RaidProgressionSettlement => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
            const value = entry as Partial<RaidProgressionSettlement>;
            return value.version === 1 && typeof value.proofId === 'string';
        }).slice(-127)
        : [];
}

export function raidProgressionSettlement(
    character: Record<string, unknown> | null | undefined,
    proofId: string,
): RaidProgressionSettlement | null {
    if (!character || !proofId) return null;
    return settlements(character).find((entry) => entry.proofId === proofId) ?? null;
}

type RaidDailyAllowance = { version: 1; count: number; proofIds: string[] };

function raidCapProofKey(playerName: string, proofId: string): string {
    return `raid-report-capped:${playerName}:${createHash('sha256').update(proofId).digest('hex')}`;
}

async function reserveRaidDailyAllowance(
    playerName: string,
    proofId: string,
    eventAt: number,
    limit: number,
): Promise<{ capped: boolean; replayed: boolean }> {
    if (!Number.isSafeInteger(eventAt) || eventAt <= 0) throw new Error('invalid-raid-cap-event-time');
    const cappedKey = raidCapProofKey(playerName, proofId);
    if (await kv.get(cappedKey)) return { capped: true, replayed: true };
    const key = `raid-report-count-v2:${playerName}:${new Date(eventAt).toISOString().slice(0, 10)}`;
    return withKvLock(key, async () => {
        if (await kv.get(cappedKey)) return { capped: true, replayed: true };
        const raw = await kv.get<Partial<RaidDailyAllowance>>(key);
        const current: RaidDailyAllowance = {
            version: 1,
            count: Math.max(0, Math.floor(Number(raw?.count) || 0)),
            proofIds: Array.isArray(raw?.proofIds) ? raw!.proofIds!.map(String).slice(-limit) : [],
        };
        if (current.proofIds.includes(proofId)) return { capped: false, replayed: true };
        if (current.count >= limit) {
            await kv.set(cappedKey, true, { ex: RAID_CAP_TTL_SECONDS });
            return { capped: true, replayed: false };
        }
        await kv.set(key, {
            version: 1,
            count: current.count + 1,
            proofIds: [...current.proofIds, proofId].slice(-limit),
        }, { ex: RAID_CAP_TTL_SECONDS });
        return { capped: false, replayed: false };
    }, { failClosed: true });
}

export type CappedRaidProgressionResult = {
    capped: boolean;
    replayed: boolean;
    settlement: RaidProgressionSettlement | null;
    fetchMissionsCredited: string[];
    territoryDamage: number;
    territory: RaidTerritoryDamageResult;
    character: Record<string, unknown>;
    _saveVersion: number;
};

/** Shared 60/day policy used by both direct PvP reward settlement and report-raid recovery. */
export async function settleRaidProgressionWithDailyCap(params: {
    playerName: string;
    proofId: string;
    proofAt: number;
    sector: number;
    dailyLimit: number;
    territoryEvidence?: SealedRaidTerritoryEvidence;
}): Promise<CappedRaidProgressionResult> {
    const save = await kv.get<Record<string, unknown>>(`save:${params.playerName}`);
    const character = save?.character as Record<string, unknown> | undefined;
    if (!save || !character) throw new Error('raid-progression-save-missing');
    const prior = raidProgressionSettlement(character, params.proofId);
    const allowance = prior
        ? { capped: false, replayed: true }
        : await reserveRaidDailyAllowance(params.playerName, params.proofId, params.proofAt, params.dailyLimit);
    if (!allowance.capped) {
        const progressed = await settleRaidProgression(params);
        return {
            capped: false,
            replayed: progressed.replayed,
            settlement: progressed.settlement,
            fetchMissionsCredited: progressed.settlement.fetchMissionsCredited,
            territoryDamage: progressed.settlement.territoryDamage,
            territory: progressed.territory,
            character: progressed.character,
            _saveVersion: progressed._saveVersion,
        };
    }
    const [fetchMissionsCredited, territory] = await Promise.all([
        creditFieldRaidProgress({
            playerName: params.playerName,
            save,
            proofId: params.proofId,
            proofAt: params.proofAt,
            raidSector: params.sector,
        }),
        settleRaidTerritoryDamage({
            playerName: params.playerName,
            proofId: receiptId(params.proofId),
            sector: params.sector,
            eventAt: params.proofAt,
            evidence: params.territoryEvidence,
        }),
    ]);
    return {
        capped: true,
        replayed: allowance.replayed,
        settlement: null,
        fetchMissionsCredited,
        territoryDamage: territory.amount,
        territory,
        character,
        _saveVersion: Number(save._saveVersion ?? 0),
    };
}

/**
 * Complete the mission/profession/Legacy half of one sealed raid proof.
 *
 * Field receipts and the daily-mission event are proof-idempotent external
 * projections. Profession XP, rank perks, and the terminal receipt commit in
 * one save mutation. Any crash can therefore retry from the same proof and
 * help forward without incrementing a completed step twice.
 */
export async function settleRaidProgression(params: {
    playerName: string;
    proofId: string;
    proofAt: number;
    sector?: number;
    territoryEvidence?: SealedRaidTerritoryEvidence;
}): Promise<{
    settlement: RaidProgressionSettlement;
    character: Record<string, unknown>;
    _saveVersion: number;
    replayed: boolean;
    territory: RaidTerritoryDamageResult;
}> {
    const proofId = typeof params.proofId === 'string' ? params.proofId.trim().slice(0, 220) : '';
    const proofAt = Number(params.proofAt);
    if (!proofId || !Number.isSafeInteger(proofAt) || proofAt <= 0) throw new Error('invalid-raid-progression-proof');
    const eventReceiptId = receiptId(proofId);

    const before = await kv.get<Record<string, unknown>>(`save:${params.playerName}`);
    const beforeCharacter = before?.character as Record<string, unknown> | undefined;
    if (!before || !beforeCharacter) throw new Error('raid-progression-save-missing');
    const prior = settlements(beforeCharacter).find((entry) => entry.proofId === proofId);

    const fetchMissionsCredited = await creditFieldRaidProgress({
        playerName: params.playerName,
        save: before,
        proofId,
        proofAt,
        raidSector: Math.floor(Number(params.sector)),
    });

    let daily: { xpAwarded: number; missionsCompleted: CompletedMissionInfo[]; replayed?: boolean } = {
        xpAwarded: 0,
        missionsCompleted: [],
        replayed: false,
    };
    if (beforeCharacter.profession === 'vanguard') {
        daily = await reportMissionEvent({
            playerName: params.playerName,
            profession: 'vanguard',
            kind: 'vanguard-raids',
            receiptId: eventReceiptId,
            deferXpAward: true,
            now: new Date(proofAt),
        });
    }

    const result = await mutatePlayerSave<RaidProgressionSettlement>(params.playerName, ({ character }) => {
        const existing = settlements(character);
        const replay = existing.find((entry) => entry.proofId === proofId);
        if (replay) return {
            ok: true as const,
            character,
            value: replay,
            write: false as const,
        };
        const rank = Math.max(1, Math.floor(Number(character.professionRank) || 1));
        const completionCount = daily.missionsCompleted.length;
        const bonusRyo = rank >= 4 ? RANK_4_RAID_RYO * completionCount : 0;
        const bonusSeals = rank >= 10 ? RANK_10_RAID_SEALS * completionCount : 0;
        const xp = character.profession === 'vanguard'
            ? professionXpAfterAward('vanguard', character.professionXp, rank, daily.xpAwarded)
            : { xp: Math.max(0, Math.floor(Number(character.professionXp) || 0)), rank, granted: 0 };
        const settlement: RaidProgressionSettlement = {
            version: 1,
            proofId,
            proofAt,
            fetchMissionsCredited,
            xpAwarded: xp.granted,
            missionsCompleted: daily.missionsCompleted,
            bonusRyo,
            bonusSeals,
            territoryDamage: 0,
            ...(Number.isSafeInteger(params.sector) ? { sector: Math.floor(Number(params.sector)) } : {}),
            settledAt: Date.now(),
        };
        return {
            ok: true as const,
            character: {
                ...character,
                ...(character.profession === 'vanguard' ? {
                    professionXp: xp.xp,
                    professionRank: xp.rank,
                    ryo: Math.max(0, Number(character.ryo) || 0) + bonusRyo,
                    honorSeals: Math.max(0, Math.floor(Number(character.honorSeals) || 0)) + bonusSeals,
                } : {}),
                raidProgressionSettlements: [...existing, settlement],
            },
            value: settlement,
        };
    });
    if (!result.ok) throw new Error(result.error);

    const legacyComplete = await bumpLegacyStats(params.playerName, { raidsCompleted: 1, warContribution: 500 }, {
        characterForBootstrap: legacyBootstrapBeforeCounterIncrement(result.character, 'totalVillageRaids'),
        receiptId: eventReceiptId,
    });
    if (!legacyComplete) throw new Error('raid-legacy-progression-pending');
    const territory = await settleRaidTerritoryDamage({
        playerName: params.playerName,
        proofId: eventReceiptId,
        sector: params.sector,
        eventAt: proofAt,
        evidence: params.territoryEvidence,
    });
    let finalSettlement = result.value;
    let finalSaveVersion = result._saveVersion;
    if (territory.amount !== result.value.territoryDamage) {
        const patched = await mutatePlayerSave<RaidProgressionSettlement>(params.playerName, ({ character }) => {
            const existing = settlements(character);
            const index = existing.findIndex((entry) => entry.proofId === proofId);
            if (index < 0) return { ok: false as const, status: 409, error: 'raid-progression-receipt-missing' };
            const receipt = { ...existing[index], territoryDamage: territory.amount };
            const next = [...existing];
            next[index] = receipt;
            return {
                ok: true as const,
                character: { ...character, raidProgressionSettlements: next },
                value: receipt,
            };
        });
        if (!patched.ok) throw new Error(patched.error);
        finalSettlement = patched.value;
        finalSaveVersion = patched._saveVersion;
    }
    const authoritative = await kv.get<Record<string, unknown>>(`save:${params.playerName}`);
    const authoritativeCharacter = authoritative?.character as Record<string, unknown> | undefined;
    if (!authoritative || !authoritativeCharacter) throw new Error('raid-progression-save-missing-after-settlement');
    return {
        settlement: finalSettlement,
        character: authoritativeCharacter,
        _saveVersion: Number(authoritative._saveVersion ?? finalSaveVersion),
        replayed: Boolean(prior),
        territory,
    };
}
