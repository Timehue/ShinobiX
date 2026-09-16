import type { Character } from '../types/character';
import { makeId } from './utils';
import { noteSectorPoolView, type SectorPoolView } from './sector-pool';
import { bumpSectorContractRevision } from './sector-contract';
import { runSingleFlight } from './single-flight';

/**
 * World-map reward settlement.
 *
 * Exploring a tile and opening an Ancient Chest both used to be computed in the
 * browser and pushed through the generic save. The save sanitizer owns every
 * field they touch — tile cards and all six premium currencies are rejected
 * outright, inventory is clamped to one net-new item per save, and
 * `totalTilesExplored` has a per-save delta of zero — so most of the reward was
 * discarded and the player saw it vanish on the next reload.
 *
 * `/api/world/explore` and `/api/world/open-chest` were already built, routed,
 * and tested for exactly this; they were simply never called. Both commit
 * through `mutatePlayerSave` (under lock:save:<name>, bypassing the sanitizer)
 * and carry a `requestId` receipt so a retry pays once.
 */

// The receipt id both endpoints dedupe on. They accept /^[A-Za-z0-9_-]{8,96}$/,
// and makeId()'s non-randomUUID fallback contains a '.', so strip and pad here
// rather than let a fallback-path request 400.
export function newWorldRewardRequestId(): string {
    const raw = makeId().replace(/[^A-Za-z0-9_-]/g, '');
    return (raw.length >= 8 ? raw : `${raw}0000000000`).slice(0, 96);
}

export type ExploreCredit = 'full' | 'tile';
export type ExternalExploreProof = { kind: 'dungeon' | 'pet'; token: string };
export type SectorExploreOutcome =
    | { kind: 'chest' }
    | { kind: 'battle' }
    | { kind: 'none' }
    | { kind: 'external'; source: 'dungeon' | 'pet' };

export type FieldExploreProgress = {
    missionId: string;
    runId: string;
    exploreCount: number;
    replayed: boolean;
};

export type SectorExploreResult = {
    reward?: { sector: number; xp: number; ryo: number };
    outcome?: SectorExploreOutcome;
    replayed?: boolean;
    character?: Character;
    fieldProgress?: FieldExploreProgress[];
    saveVersion?: number;
    sectorPool?: SectorPoolView;
    error?: string;
    status?: number;
    retryable?: boolean;
    reason?: string;
    /** `pending-battle-discovery`: the ambush this player already rolled and must fight first. */
    pendingBattle?: { requestId: string; sector: number };
};

type WorldRewardFailure = { error?: string; status?: number; retryable?: boolean; reason?: string };

function worldRewardFailure(
    error: string,
    status?: number,
    options: { committedReward?: boolean; reason?: string } = {},
): WorldRewardFailure & { error: string; retryable: boolean } {
    const reason = options.reason ?? error;
    const pendingDiscovery = reason === "pending-pet-discovery" || reason === "pending-dungeon-discovery";
    // These refusals prove an ordinary exploration never committed. An already
    // discovered chest is different: even a daily-limit/4xx refusal must keep
    // its receipt, because the payout is still owed. Retiring it only makes
    // the server's pending mirror re-import the same unpaid chest later.
    const definitive = !options.committedReward && !pendingDiscovery && reason !== "no-presence"
        && (status === 400 || status === 403 || status === 404 || status === 409 || status === 410 || status === 422);
    return {
        error,
        ...(typeof status === "number" ? { status } : {}),
        ...(options.reason ? { reason: options.reason } : {}),
        retryable: !definitive,
    };
}

export function worldRewardFailureMessage(result: WorldRewardFailure, kind: 'explore' | 'chest' = 'explore'): string {
    const reason = result.reason ?? result.error;
    const recovery = kind === 'chest'
        ? 'Your discovered chest remains saved. Reopen the map to recover it.'
        : 'Try exploring again; the same saved attempt will be reused.';
    if (reason === 'daily-limit') return kind === 'chest'
        ? 'Daily chest limit reached. Resets at midnight UTC. Your discovered chest remains saved for recovery.'
        : 'Daily tile exploration limit reached (150/150). Resets at midnight UTC.';
    if (reason === 'sector-depleted') return kind === 'chest'
        ? 'This sector has been picked clean for today. Your discovered chest remains saved for recovery.'
        : 'This sector has been picked clean for today. Try another sector.';
    if (result.status === 401) return 'Your session needs to reconnect. Sign in again. ' + recovery;
    if (result.status === 429) return 'Too many exploration requests. Wait a moment. ' + recovery;
    if (reason === 'no-presence') return 'Your world connection is still reconnecting. ' + recovery;
    if (kind === 'chest' && reason === 'missing-chest-discovery') return 'The server could not confirm this discovered chest yet. ' + recovery;
    if (reason === 'sector-mismatch') return 'You are no longer in that sector. Return there before exploring.';
    if (reason === 'hospitalized') return 'Recover in the hospital before exploring again.';
    if (reason === 'battle-active' || reason === 'pending-battle-discovery') return 'Finish or resume your active battle before exploring again.';
    if (reason === 'pending-pet-choice') return 'Finish your pending wild-pet encounter before exploring again.';
    if (reason === 'pending-pet-discovery') return 'Your previous wild-pet discovery needs to be recovered first. ' + recovery;
    if (reason === 'pending-dungeon-discovery') return 'Your previous dungeon discovery needs to be recovered first. ' + recovery;
    if (kind === 'explore' && (reason === 'missing-pet-discovery' || reason === 'missing-dungeon-discovery'
        || reason === 'pet-discovery-already-used' || reason === 'dungeon-discovery-already-used')) {
        return 'That discovery is no longer available. Explore the sector again to make a new attempt.';
    }
    if (result.error && !['offline', 'explore-failed', 'chest-failed'].includes(result.error)
        && result.status !== undefined && result.status < 500) {
        return result.error + (kind === 'chest' || result.retryable ? ' ' + recovery : '');
    }
    return (kind === 'chest' ? 'The chest reward could not be confirmed right now. ' : 'The exploration could not be confirmed right now. ') + recovery;
}

const pendingExplorations = new Map<string, Promise<SectorExploreResult>>();
const pendingChests = new Map<string, Promise<AncientChestResult>>();

async function retryWorldReward<T extends WorldRewardFailure>(request: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        const result = await request();
        // All retries replay the identical receipt. A daily limit, throttle,
        // auth refusal, or pending choice needs a later action, not a burst.
        const transient = result.error && result.retryable
            && (result.status === undefined || result.status >= 500 || result.status === 408
                || result.status === 425 || result.reason === 'no-presence');
        if (!transient || attempt >= 2) return result;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
}

/**
 * Count an explored tile, and pay the explore ryo when the tile produced no
 * other outcome (`credit: 'full'`). A tile that turned up a chest, a wild pet,
 * the dungeon, or an ambush passes 'tile': it counts toward the daily total and
 * `totalTilesExplored`, but has never paid the ryo line on top.
 */
export async function recordSectorExplore(
    playerName: string,
    sector: number,
    credit: ExploreCredit,
    operationId: string = newWorldRewardRequestId(),
    options: { resolveOutcome?: boolean; externalOutcomeProof?: ExternalExploreProof } = {},
): Promise<SectorExploreResult> {
    const key = JSON.stringify([playerName, sector, credit, operationId, options.resolveOutcome === true,
        options.externalOutcomeProof?.kind ?? '', options.externalOutcomeProof?.token ?? '']);
    return runSingleFlight(pendingExplorations, key,
        () => retryWorldReward(() => requestSectorExplore(playerName, sector, credit, operationId, options)));
}

async function requestSectorExplore(
    playerName: string,
    sector: number,
    credit: ExploreCredit,
    operationId: string,
    options: { resolveOutcome?: boolean; externalOutcomeProof?: ExternalExploreProof },
): Promise<SectorExploreResult> {
    try {
        const response = await fetch('/api/world/explore', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerName,
                sector,
                credit,
                requestId: operationId,
                ...(options.resolveOutcome ? { resolveOutcome: true } : {}),
                ...(options.externalOutcomeProof ? { externalOutcomeProof: options.externalOutcomeProof } : {}),
            }),
        });
        const data = await response.json().catch(() => null) as
            { reward?: { sector: number; xp: number; ryo: number }; outcome?: SectorExploreOutcome; replayed?: boolean; character?: Character; fieldProgress?: FieldExploreProgress[]; _saveVersion?: number; sectorPool?: SectorPoolView; error?: string; reason?: string; requestId?: string; sector?: number } | null;
        // Both the payout and a 'sector-depleted' refusal carry the live pool.
        if (data?.sectorPool) noteSectorPoolView(sector, data.sectorPool);
        // The server ticks contract progress off this same explore receipt, so
        // the card in the panel is stale the moment this lands. Bump here rather
        // than at the call site: every explore path funnels through this
        // response, and a replayed one is safe to re-read (it did not tick).
        bumpSectorContractRevision();
        if (!response.ok || !data?.character) {
            const failure = worldRewardFailure(data?.error || 'explore-failed', response.ok ? undefined : response.status, { reason: data?.reason });
            const pendingBattle = data?.error === 'pending-battle-discovery'
                && typeof data.requestId === 'string' && data.requestId
                && Number.isFinite(Number(data.sector))
                ? { requestId: data.requestId, sector: Math.floor(Number(data.sector)) }
                : null;
            return pendingBattle ? { ...failure, pendingBattle } : failure;
        }
        const fieldProgress = Array.isArray(data.fieldProgress)
            ? data.fieldProgress.filter((entry): entry is FieldExploreProgress => Boolean(entry)
                && typeof entry.missionId === 'string' && typeof entry.runId === 'string'
                && Number.isFinite(entry.exploreCount) && typeof entry.replayed === 'boolean')
            : undefined;
        return {
            reward: data.reward,
            outcome: data.outcome,
            replayed: data.replayed === true,
            character: data.character,
            fieldProgress,
            saveVersion: data._saveVersion,
            ...(data.sectorPool ? { sectorPool: data.sectorPool } : {}),
        };
    } catch {
        return worldRewardFailure('offline');
    }
}

export type AncientChestLoot = {
    xp: number; ryo?: number; itemId?: string; cardId?: string;
    fateShards?: number; boneCharms?: number; auraStones?: number; auraDust?: number;
};

export type AncientChestResult = {
    loot?: AncientChestLoot;
    character?: Character;
    saveVersion?: number;
    sectorPool?: SectorPoolView;
    error?: string;
    status?: number;
    retryable?: boolean;
    reason?: string;
};

/**
 * Roll AND commit an Ancient Chest. The server does both in one locked write,
 * so the chest is banked the moment it is found rather than on the claim click
 * — the reveal panel then shows what the player already owns instead of a
 * promise the save was about to throw away.
 */
export async function openAncientChest(
    playerName: string,
    sector: number,
    operationId: string,
    worldExploreRequestId: string,
): Promise<AncientChestResult> {
    const key = JSON.stringify([playerName, sector, operationId, worldExploreRequestId]);
    return runSingleFlight(pendingChests, key,
        () => retryWorldReward(() => requestAncientChest(playerName, sector, operationId, worldExploreRequestId)));
}

async function requestAncientChest(
    playerName: string,
    sector: number,
    operationId: string,
    worldExploreRequestId: string,
): Promise<AncientChestResult> {
    try {
        const response = await fetch('/api/world/open-chest', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, sector, requestId: operationId, worldExploreRequestId }),
        });
        const data = await response.json().catch(() => null) as
            { loot?: AncientChestLoot; character?: Character; _saveVersion?: number; sectorPool?: SectorPoolView; error?: string; reason?: string } | null;
        if (data?.sectorPool) noteSectorPoolView(sector, data.sectorPool);
        if (!response.ok || !data?.loot || !data.character) {
            // The chest already exists — it was discovered, sealed, and charged
            // to the player's daily chest limit by /world/explore. A refusal here
            // is a delay, never a verdict, so this leg never retires a payout.
            return worldRewardFailure(data?.error || 'chest-failed', response.ok ? undefined : response.status, { committedReward: true, reason: data?.reason });
        }
        return { loot: data.loot, character: data.character, saveVersion: data._saveVersion, ...(data.sectorPool ? { sectorPool: data.sectorPool } : {}) };
    } catch {
        return worldRewardFailure('offline', undefined, { committedReward: true });
    }
}

export type WarMissionResult = {
    completed?: number;
    character?: Character;
    saveVersion?: number;
    /** Single-use token authorizing this mission's village-war HP damage. */
    warMissionToken?: string;
    error?: string;
};

/**
 * Claim one village-war daily mission. Every field the reward touches
 * (villageWarMissionsCompleted, clanMissionContrib, totalMissionsCompleted) is
 * frozen by the sanitizer, so the old inline claim burned the day's stamp and
 * paid nothing — and since the completed counter never advanced, mission 0 was
 * the only mission reachable.
 */
export async function claimWarMissionServer(playerName: string, missionIndex: number): Promise<WarMissionResult> {
    try {
        const response = await fetch('/api/village/war-mission', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, missionIndex }),
        });
        const data = await response.json().catch(() => null) as
            { completed?: number; character?: Character; _saveVersion?: number; warMissionToken?: string; error?: string } | null;
        if (!response.ok || !data?.character) return { error: data?.error || 'war-mission-failed' };
        // Single-use token authorizing the mission's war-HP damage on the
        // world-state write (the server won't accept unbacked war damage).
        return { completed: data.completed, character: data.character, saveVersion: data._saveVersion, warMissionToken: data.warMissionToken };
    } catch {
        return { error: 'offline' };
    }
}
