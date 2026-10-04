/*
 * Sector chat storage helpers (IO-free, unit-testable).
 *
 * One capped KV row per sector (`chat:sector:<n>`). Text only, never images,
 * and short-lived: the row's TTL is refreshed on every post, and readers drop
 * lines past SECTOR_CHAT_LIFETIME_MS, so a sector that goes quiet empties on
 * its own instead of holding storage.
 */
import { isCleanText, sanitizeUserText } from '../_text-moderation.js';
import { safeName } from '../_utils.js';
import {
    SECTOR_CHAT_KEEP,
    SECTOR_CHAT_LIFETIME_MS,
    SECTOR_CHAT_MAX_CHARS,
    type SectorChatMessage,
} from '../../shared/sector-chat.js';

/** The row outlives the newest line by a margin, then garbage-collects itself. */
export const SECTOR_CHAT_TTL_SEC = Math.ceil((SECTOR_CHAT_LIFETIME_MS * 2) / 1000);

export function sectorChatKey(sector: number): string {
    return `chat:sector:${sector}`;
}

/**
 * Moderate one incoming line the same way the other chats do: refuse anything
 * the blocklist rejects outright, then trim, cap and mask. Null when nothing
 * usable is left.
 */
export function cleanSectorChatText(input: unknown): string | null {
    if (typeof input !== 'string' || !isCleanText(input)) return null;
    return sanitizeUserText(input, SECTOR_CHAT_MAX_CHARS) || null;
}

/** Append to the ring, dropping expired lines and anything past the cap. */
export function appendSectorChat(
    existing: SectorChatMessage[] | null | undefined,
    message: SectorChatMessage,
    now: number,
): SectorChatMessage[] {
    const live = Array.isArray(existing) ? existing.filter((m) => m && now - m.ts < SECTOR_CHAT_LIFETIME_MS) : [];
    live.push(message);
    return live.length > SECTOR_CHAT_KEEP ? live.slice(live.length - SECTOR_CHAT_KEEP) : live;
}

/** Hide lines whose author this reader has blocked. */
export function withoutBlockedAuthors(messages: SectorChatMessage[], blocked: readonly string[]): SectorChatMessage[] {
    if (!blocked.length) return messages;
    const hidden = new Set(blocked);
    return messages.filter((m) => !hidden.has(safeName(m.name)));
}
