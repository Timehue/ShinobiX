import type { Character } from '../types/character';
import { makeId } from './utils';
import { noteSectorPoolView, type SectorPoolView } from './sector-pool';

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
};

function worldRewardFailure(
    error: string,
    status?: number,
    options: { committedReward?: boolean } = {},
): { error: string; status?: number; retryable: boolean } {
    // Receipt replay happens before server presence/discovery validation. These
    // definitive 4xx responses therefore prove no payout committed and can be
    // retired; transport, auth-refresh, throttling, malformed success, and 5xx
    // remain parked on the same operation id.
    const pendingExternalDiscovery = error === "pending-pet-discovery" || error === "pending-dungeon-discovery";
    // `sector-depleted` is a TIME-BOXED refusal (the shared per-sector pool
    // resets at midnight UTC), so what it means depends on whether anything was
    // already committed:
    //   • Opening an ALREADY-DISCOVERED chest (`committedReward`) — the player
    //     owns that chest and already spent a daily chest slot on it. Retiring
    //     it threw the loot away while the server-side pending mirror kept
    //     re-importing the entry, so the "picked clean" toast looped all day
    //     over loot nobody could collect. Park it; tomorrow settles it.
    //   • An explore refused at the pool — nothing was reserved, nothing was
    //     written, and no receipt exists. Parking THAT would be the same
    //     soft-lock in a different costume: the outbox retries it on the next
    //     explore, the sector is still depleted, and every sector's exploring
    //     is blocked behind it until midnight. Retire it and let the player
    //     walk somewhere else.
    const parkedDepletion = options.committedReward === true && error === "sector-depleted";
    const definitive = !pendingExternalDiscovery && !parkedDepletion && (status === 400 || status === 403 || status === 404
        || status === 409 || status === 410 || status === 422);
    return { error, ...(typeof status === "number" ? { status } : {}), retryable: !definitive };
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
            { reward?: { sector: number; xp: number; ryo: number }; outcome?: SectorExploreOutcome; replayed?: boolean; character?: Character; fieldProgress?: FieldExploreProgress[]; _saveVersion?: number; sectorPool?: SectorPoolView; error?: string } | null;
        // Both the payout and a 'sector-depleted' refusal carry the live pool.
        if (data?.sectorPool) noteSectorPoolView(sector, data.sectorPool);
        if (!response.ok || !data?.character) {
            return worldRewardFailure(data?.error || 'explore-failed', response.ok ? undefined : response.status);
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
    try {
        const response = await fetch('/api/world/open-chest', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, sector, requestId: operationId, worldExploreRequestId }),
        });
        const data = await response.json().catch(() => null) as
            { loot?: AncientChestLoot; character?: Character; _saveVersion?: number; sectorPool?: SectorPoolView; error?: string } | null;
        if (data?.sectorPool) noteSectorPoolView(sector, data.sectorPool);
        if (!response.ok || !data?.loot || !data.character) {
            // The chest already exists — it was discovered, sealed, and charged
            // to the player's daily chest limit by /world/explore. A refusal here
            // is a delay, never a verdict, so this leg never retires a payout.
            return worldRewardFailure(data?.error || 'chest-failed', response.ok ? undefined : response.status, { committedReward: true });
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
