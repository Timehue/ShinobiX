import type { LifeSceneView } from '../../../shared/sector-life';
import { noteServerTime } from './server-clock';
import type { Character } from '../types/character';

export type LifeReply = { ok: boolean; view?: LifeSceneView; error?: string; changed?: boolean; reward?: {ryo:number}; character?: Character; _saveVersion?: number };
/** A prefetched read is only used when it is this recent: the scene advances on its own. */
export const SECTOR_LIFE_PREFETCH_FRESH_MS = 15_000;
let prefetched: { player: string; sector: number; at: number; reply: Promise<LifeReply> } | undefined;

/**
 * Read a sector's road activity ahead of arrival (during the travel wait), so its
 * people can appear the moment the sector does. The read is the same GET the
 * sector polls; the arriving view takes it instead of asking again.
 */
export function prefetchSectorLife(playerName: string, sector: number, now = Date.now()): Promise<LifeReply> {
    const reply = requestSectorLife(playerName, sector);
    prefetched = { player: playerName, sector, at: now, reply };
    return reply;
}

/** The prefetched read for this player and sector, once, while fresh. */
export function takePrefetchedSectorLife(playerName: string, sector: number, now = Date.now()): Promise<LifeReply> | undefined {
    const entry = prefetched;
    if (!entry || entry.player !== playerName || entry.sector !== sector) return undefined;
    prefetched = undefined;
    return now - entry.at < SECTOR_LIFE_PREFETCH_FRESH_MS ? entry.reply : undefined;
}

export async function requestSectorLife(playerName: string, sector: number, signal?: AbortSignal, action?: { window: number; step: number }): Promise<LifeReply> {
    const sentAt = Date.now();
    try {
        const response = await fetch(action ? '/api/sector/life' : `/api/sector/life?${new URLSearchParams({ playerName, sector: String(sector) })}`, action
            ? { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, sector, ...action }) }
            : { signal });
        const data = await response.json();
        noteServerTime(data.serverNow, sentAt);
        const unavailable='The road activity could not be loaded.';
        if (!response.ok) return { ok: false, error: data.error ?? unavailable };
        if (!data.ok || !data.view || data.view.sector !== sector || !['active','aftermath','unattended'].includes(data.view.phase)) return { ok: false, error: unavailable };
        return data;
    } catch (error) {
        if (signal?.aborted) throw error;
        return { ok: false, error: 'The connection was interrupted. Check the activity again.' };
    }
}
