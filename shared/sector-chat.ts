/*
 * Sector chat — the rules client and server must agree on.
 *
 * Sector chat is the voice of the place you are standing in: everyone present
 * in the same wild sector hears it, nobody else does. It is deliberately
 * short-lived. A line fades after SECTOR_CHAT_LIFETIME_MS and the buffer keeps
 * only the newest SECTOR_CHAT_KEEP lines, so walking into a sector shows the
 * conversation that is happening there now, not a history of everyone who ever
 * passed through.
 */
import { isPlayableWildSector } from './sector-geo.js';

/** Death's Gate: a map-travel arena with its own board, so it has a voice too. */
const DEATHS_GATE_SECTOR = 99;

/** Shorter than the 500-character tavern limit: this is talk across a field. */
export const SECTOR_CHAT_MAX_CHARS = 240;
export const SECTOR_CHAT_KEEP = 40;
export const SECTOR_CHAT_LIFETIME_MS = 60 * 60 * 1000;
/** Posts per minute per player (the other chats allow 20; lines here are shorter and louder). */
export const SECTOR_CHAT_POSTS_PER_MINUTE = 15;
/** Socket event that tells a sector's room there is something new to fetch. */
export const SECTOR_CHAT_EVENT = 'sector:chat';

export type SectorChatMessage = {
    id: string;
    /** Display name, server-stamped from the author's authenticated presence. */
    name: string;
    text: string;
    ts: number;
    village?: string;
    level?: number;
};

/** The sectors that have a chat: every walkable wild board, plus Death's Gate. */
export function isSectorChatSector(sector: unknown): sector is number {
    return typeof sector === 'number' && Number.isInteger(sector)
        && (isPlayableWildSector(sector) || sector === DEATHS_GATE_SECTOR);
}

/** Lines still inside their lifetime at `now`, oldest first. */
export function freshSectorChat(messages: readonly SectorChatMessage[] | null | undefined, now: number): SectorChatMessage[] {
    if (!Array.isArray(messages)) return [];
    return messages.filter((m) => m && typeof m.ts === 'number' && now - m.ts < SECTOR_CHAT_LIFETIME_MS);
}

/** Lines strictly newer than `since`. A cursor of 0 or less returns everything. */
export function sectorChatSince(messages: readonly SectorChatMessage[], since: number): SectorChatMessage[] {
    if (!Number.isFinite(since) || since <= 0) return [...messages];
    return messages.filter((m) => m.ts > since);
}
