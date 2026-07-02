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
        // Delivery breadth (handoff §Server Announcements): high/mythic events
        // also land as a system line in every village chat, and mythic events
        // fire the optional Discord webhook. Both best-effort.
        if (a.importance === 'high' || a.importance === 'mythic') {
            await broadcastToVillageChats(full);
        }
        if (a.importance === 'mythic') {
            void postDiscordWebhook(full);
        }
        return full;
    } catch (err) {
        console.error('[announce] failed:', err instanceof Error ? err.message : err);
        return null;
    }
}

/** Canonical village names (data/sectors.ts) → chat keys, matching
 *  api/village/chat.ts's chatKey() format exactly. */
const VILLAGE_CHAT_KEYS = [
    'Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village',
].map((v) => `chat:village:${v.toLowerCase().replace(/\s+/g, '-')}`);
const CHAT_MAX_MESSAGES = 30; // mirror api/village/chat.ts MAX_MESSAGES

/** System line in every village chat for high/mythic world moments. */
async function broadcastToVillageChats(a: Announcement): Promise<void> {
    const line = {
        author: '📜 World Herald',
        text: `${a.title} — ${a.message}`.slice(0, 480),
        ts: a.ts,
        rank: 'Herald',
        // `system` marks server-authored lines; api/village/chat.ts constructs
        // player messages from derived fields only, so it can't be forged, and
        // the tavern styles system lines distinctly — a player named to mimic
        // "World Herald" won't get the herald treatment.
        system: true,
    };
    for (const key of VILLAGE_CHAT_KEYS) {
        try {
            await withKvLock(key, async () => {
                const existing = (await kv.get<unknown[]>(key)) ?? [];
                const next = [...(Array.isArray(existing) ? existing : []), line].slice(-CHAT_MAX_MESSAGES);
                await kv.set(key, next, { ex: 30 * 24 * 60 * 60 });
            });
        } catch { /* best-effort per village */ }
    }
}

/** Optional Discord relay for mythic moments. Env-gated, fire-and-forget.
 *  Rich embed (importance-colored strip, event-type footer) rather than plain
 *  text, so mythic moments land properly in a community server. */
const DISCORD_EMBED_COLORS: Record<AnnouncementImportance, number> = {
    low: 0x9aa3b2, medium: 0x60a5fa, high: 0xf59e0b, mythic: 0xc084fc,
};
async function postDiscordWebhook(a: Announcement): Promise<void> {
    const url = process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;
    if (!url) return;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'World Herald',
                embeds: [{
                    title: a.title,
                    description: a.message,
                    color: DISCORD_EMBED_COLORS[a.importance] ?? DISCORD_EMBED_COLORS.mythic,
                    footer: { text: [a.player, a.village, a.type.replace(/_/g, ' ')].filter(Boolean).join(' · ') },
                    timestamp: new Date(a.ts).toISOString(),
                }],
            }),
        });
    } catch (err) {
        console.error('[announce] discord webhook failed:', err instanceof Error ? err.message : err);
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
        // The NX claim and the list write commit together under a fail-closed
        // lock — claiming first and then failing the (previously fail-open)
        // write would permanently lose a "permanent" entry (verification
        // finding). Lock contention throws to the catch: callers are
        // best-effort and the NX stays unclaimed for the retry.
        let full: HallEntry | null = null;
        await withKvLock(HALL_KEY, async () => {
            if (opts?.nxKey) {
                const claimed = await kv.set(`hall:nx:${opts.nxKey}`, '1', { nx: true });
                if (claimed !== 'OK') return;
            }
            const id = await kv.incr(HALL_SEQ);
            full = { id, ts: Date.now(), status: 'active', ...entry };
            const list = (await kv.get<HallEntry[]>(HALL_KEY)) ?? [];
            await kv.set(HALL_KEY, [full, ...(Array.isArray(list) ? list : [])].slice(0, HALL_CAP));
        }, { failClosed: true });
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
