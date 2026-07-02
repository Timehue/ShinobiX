/*
 * Server announcements + Hall of Legends stores (docs/legacy-system-plan.md
 * §12-13). Announcements are a capped newest-first list the client reads via
 * GET /api/announcements (and, later, a piggyback field on the world-state
 * poll). Hall entries are permanent server history: append-only, never
 * hard-deleted — admin corrections flip `status` and leave a trail.
 *
 * Importance matrix (design handoff): basic/rare legacy moments never announce
 * globally; legendary completions are 'high'; mythic acceptance/completion,
 * era unlocks, and server-firsts are 'mythic' and also mint a Hall entry.
 */
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';

export type AnnouncementImportance = 'low' | 'medium' | 'high' | 'mythic';

export type Announcement = {
    id: number;
    ts: number;
    type: string;              // 'legacy_awakening' | 'mythic_legacy' | 'era_unlock' | 'server_first' | ...
    importance: AnnouncementImportance;
    title: string;
    message: string;
    player?: string;
    village?: string;
    legacyId?: string;
    meta?: Record<string, unknown>;
};

export type HallEntry = {
    id: number;
    ts: number;
    entryType: string;         // 'mythic_legacy' | 'legendary_legacy' | 'era_unlock' | 'server_first' | ...
    title: string;
    description: string;
    player?: string;
    village?: string;
    legacyId?: string;
    rarity?: string;
    status: 'active' | 'corrected' | 'revoked' | 'hidden';
    correctionNote?: string;
    meta?: Record<string, unknown>;
};

export const ANNOUNCEMENTS_KEY = 'game:announcements';
const ANNOUNCEMENTS_SEQ = 'game:announcements-seq';
const ANNOUNCEMENTS_CAP = 100;

export const HALL_KEY = 'hall:entries';
const HALL_SEQ = 'hall:entries-seq';
const HALL_CAP = 500;

const DAY_SECONDS = 25 * 60 * 60;
const dateKeyUTC = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Post an announcement. Below-'high' importance is rate-limited to 3 per
 * (type, player) per UTC day so repeatable moments can't spam the feed;
 * high/mythic always land (they are already structurally rare). Best-effort:
 * never throws into the game action that triggered it.
 */
export async function announce(a: Omit<Announcement, 'id' | 'ts'>): Promise<Announcement | null> {
    try {
        if (a.importance === 'low' || a.importance === 'medium') {
            const rlKey = `announce-rl:${a.type}:${a.player ?? 'server'}:${dateKeyUTC()}`;
            const count = await kv.incr(rlKey, { ex: DAY_SECONDS });
            if (count > 3) return null;
        }
        const id = await kv.incr(ANNOUNCEMENTS_SEQ);
        const full: Announcement = { id, ts: Date.now(), ...a };
        await withKvLock(ANNOUNCEMENTS_KEY, async () => {
            const list = (await kv.get<Announcement[]>(ANNOUNCEMENTS_KEY)) ?? [];
            await kv.set(ANNOUNCEMENTS_KEY, [full, ...(Array.isArray(list) ? list : [])].slice(0, ANNOUNCEMENTS_CAP));
        });
        return full;
    } catch (err) {
        console.error('[announce] failed:', err instanceof Error ? err.message : err);
        return null;
    }
}

export async function recentAnnouncements(limit = 20, sinceId = 0): Promise<Announcement[]> {
    try {
        const list = (await kv.get<Announcement[]>(ANNOUNCEMENTS_KEY)) ?? [];
        const arr = Array.isArray(list) ? list : [];
        const filtered = sinceId > 0 ? arr.filter((a) => a.id > sinceId) : arr;
        return filtered.slice(0, Math.max(1, Math.min(limit, ANNOUNCEMENTS_CAP)));
    } catch {
        return [];
    }
}

/**
 * Mint a permanent Hall of Legends entry. `nxKey` makes server-first style
 * entries idempotent: the first caller wins, every retry/replay is a no-op
 * (the same trick as ranked:season:rewarded markers).
 */
export async function addHallEntry(
    entry: Omit<HallEntry, 'id' | 'ts' | 'status'>,
    opts?: { nxKey?: string },
): Promise<HallEntry | null> {
    try {
        if (opts?.nxKey) {
            const claimed = await kv.set(`hall:nx:${opts.nxKey}`, '1', { nx: true });
            if (claimed !== 'OK') return null;
        }
        const id = await kv.incr(HALL_SEQ);
        const full: HallEntry = { id, ts: Date.now(), status: 'active', ...entry };
        await withKvLock(HALL_KEY, async () => {
            const list = (await kv.get<HallEntry[]>(HALL_KEY)) ?? [];
            await kv.set(HALL_KEY, [full, ...(Array.isArray(list) ? list : [])].slice(0, HALL_CAP));
        });
        return full;
    } catch (err) {
        console.error('[hall] add failed:', err instanceof Error ? err.message : err);
        return null;
    }
}

export async function readHallEntries(opts?: { includeHidden?: boolean; limit?: number }): Promise<HallEntry[]> {
    try {
        const list = (await kv.get<HallEntry[]>(HALL_KEY)) ?? [];
        const arr = Array.isArray(list) ? list : [];
        const visible = opts?.includeHidden ? arr : arr.filter((e) => e.status !== 'hidden');
        return visible.slice(0, Math.max(1, Math.min(opts?.limit ?? 200, HALL_CAP)));
    } catch {
        return [];
    }
}

/** Admin correction: never deletes — flips status / annotates, keeps history. */
export async function updateHallEntry(
    id: number,
    patch: Partial<Pick<HallEntry, 'status' | 'correctionNote' | 'title' | 'description' | 'player' | 'village'>>,
): Promise<HallEntry | null> {
    let updated: HallEntry | null = null;
    await withKvLock(HALL_KEY, async () => {
        const list = (await kv.get<HallEntry[]>(HALL_KEY)) ?? [];
        const arr = Array.isArray(list) ? list : [];
        const idx = arr.findIndex((e) => e.id === id);
        if (idx < 0) return;
        updated = { ...arr[idx], ...patch };
        arr[idx] = updated;
        await kv.set(HALL_KEY, arr);
    }, { failClosed: true });
    return updated;
}
