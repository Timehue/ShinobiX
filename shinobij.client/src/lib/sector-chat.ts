/*
 * Sector chat — client-side shaping (pure, node-tested).
 *
 * The server owns what is said and who said it (api/sector/chat.ts); this only
 * merges what arrives, decides how lines group on screen, and words the
 * timestamps. Network calls live in lib/sector-chat-api.ts.
 */
import { SECTOR_CHAT_KEEP, type SectorChatMessage } from '../../../shared/sector-chat';

export type SectorChatLine = SectorChatMessage & {
    /** Same speaker as the line above, close in time: drawn without a header. */
    continued: boolean;
    own: boolean;
};

/** Lines within this gap from the same speaker read as one burst. */
const GROUP_GAP_MS = 3 * 60 * 1000;

/**
 * How the chat fits the room the HUD gives the nearby column:
 * - `roomy`: docked open at the foot of the column, under the roster.
 * - `compact`: a bar at the foot of the column; it opens as a sheet over the
 *   board, the way Sector Info does, because the column cannot hold a usable
 *   log and composer.
 * - `tight`: the column cannot even hold the bar below the roster heading, so
 *   the bar moves to the top of the column where it stays reachable.
 */
export type SectorChatLayout = 'roomy' | 'compact' | 'tight';

/**
 * Pick the layout for a column of `height` px. The first call uses the plain
 * thresholds; after that each boundary has a dead band, so the content that
 * arrives after the first layout (the explores line, the roster) cannot flap
 * the chat open and shut.
 */
export function sectorChatLayoutFor(height: number, previous: SectorChatLayout | null): SectorChatLayout {
    const roomy = previous === 'roomy' ? height >= 330 : previous ? height >= 390 : height >= 360;
    if (roomy) return 'roomy';
    const tight = previous === 'tight' ? height < 110 : previous ? height < 90 : height < 100;
    return tight ? 'tight' : 'compact';
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Merge a fetch into what is on screen: deduped by id, oldest first, capped. */
export function mergeSectorChat(
    current: readonly SectorChatMessage[],
    incoming: readonly SectorChatMessage[],
    keep = SECTOR_CHAT_KEEP,
): SectorChatMessage[] {
    if (!incoming.length) return current as SectorChatMessage[];
    const byId = new Map(current.map((m) => [m.id, m]));
    for (const m of incoming) if (m && typeof m.id === 'string') byId.set(m.id, m);
    const merged = [...byId.values()].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    return merged.length > keep ? merged.slice(merged.length - keep) : merged;
}

/** The cursor for the next fetch: the newest line we hold. */
export function sectorChatCursor(messages: readonly SectorChatMessage[]): number {
    return messages.length ? messages[messages.length - 1].ts : 0;
}

/** Mark ownership and grouping for display. */
export function shapeSectorChat(messages: readonly SectorChatMessage[], selfName: string): SectorChatLine[] {
    return messages.map((m, i) => {
        const prev = messages[i - 1];
        return {
            ...m,
            own: !!selfName && sameName(m.name, selfName),
            continued: !!prev && sameName(prev.name, m.name) && m.ts - prev.ts < GROUP_GAP_MS,
        };
    });
}

/** Lines from other people that arrived after `seenTs`. */
export function unreadSectorChat(messages: readonly SectorChatMessage[], seenTs: number, selfName: string): number {
    return messages.reduce((n, m) => n + (m.ts > seenTs && !(selfName && sameName(m.name, selfName)) ? 1 : 0), 0);
}

/** "now", "4m", "1h": short enough to sit beside a name. */
export function sectorChatAge(ts: number, now: number): string {
    const seconds = Math.max(0, Math.floor((now - ts) / 1000));
    if (seconds < 45) return 'now';
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
}

/** The same moment, spelled out for the tooltip and screen readers. */
export function sectorChatClock(ts: number): string {
    try {
        return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
        return '';
    }
}
