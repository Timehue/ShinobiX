import type { Character } from '../types/character';
import { makeId } from './utils';

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
function requestId(): string {
    const raw = makeId().replace(/[^A-Za-z0-9_-]/g, '');
    return (raw.length >= 8 ? raw : `${raw}0000000000`).slice(0, 96);
}

export type ExploreCredit = 'full' | 'tile';

export type SectorExploreResult = {
    reward?: { sector: number; xp: number; ryo: number };
    character?: Character;
    saveVersion?: number;
    error?: string;
};

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
): Promise<SectorExploreResult> {
    try {
        const response = await fetch('/api/world/explore', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, sector, credit, requestId: requestId() }),
        });
        const data = await response.json().catch(() => null) as
            { reward?: { sector: number; xp: number; ryo: number }; character?: Character; _saveVersion?: number; error?: string } | null;
        if (!response.ok || !data?.character) return { error: data?.error || 'explore-failed' };
        return { reward: data.reward, character: data.character, saveVersion: data._saveVersion };
    } catch {
        return { error: 'offline' };
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
    error?: string;
};

/**
 * Roll AND commit an Ancient Chest. The server does both in one locked write,
 * so the chest is banked the moment it is found rather than on the claim click
 * — the reveal panel then shows what the player already owns instead of a
 * promise the save was about to throw away.
 */
export async function openAncientChest(playerName: string, sector: number): Promise<AncientChestResult> {
    try {
        const response = await fetch('/api/world/open-chest', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, sector, requestId: requestId() }),
        });
        const data = await response.json().catch(() => null) as
            { loot?: AncientChestLoot; character?: Character; _saveVersion?: number; error?: string } | null;
        if (!response.ok || !data?.loot || !data.character) return { error: data?.error || 'chest-failed' };
        return { loot: data.loot, character: data.character, saveVersion: data._saveVersion };
    } catch {
        return { error: 'offline' };
    }
}

export type WarMissionResult = {
    completed?: number;
    character?: Character;
    saveVersion?: number;
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
            { completed?: number; character?: Character; _saveVersion?: number; error?: string } | null;
        if (!response.ok || !data?.character) return { error: data?.error || 'war-mission-failed' };
        return { completed: data.completed, character: data.character, saveVersion: data._saveVersion };
    } catch {
        return { error: 'offline' };
    }
}
