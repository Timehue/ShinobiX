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
    /** Stable internal settlement identity used to make retries exact-once. */
    receiptId?: string;
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

type HallEntryInput = Omit<HallEntry, 'id' | 'ts' | 'status'>;

export const ANNOUNCEMENTS_KEY = 'game:announcements';
const ANNOUNCEMENTS_SEQ = 'game:announcements-seq';
const ANNOUNCEMENTS_CAP = 100;

export const HALL_KEY = 'hall:entries';
const HALL_SEQ = 'hall:entries-seq';
const HALL_CAP = 500;
type HallNxMarker = '1' | {
    status: 'pending' | 'done';
    entryId?: number;
    player?: string;
    /** The first claimant's payload. A later retry can finish that exact Hall
     * entry without letting a different caller steal a server-first claim. */
    entry?: HallEntryInput;
    updatedAt: number;
};

const DAY_SECONDS = 25 * 60 * 60;
const dateKeyUTC = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Post an announcement. Below-'high' importance is rate-limited to 3 per
 * (type, player) per UTC day so repeatable moments can't spam the feed;
 * high/mythic always land (they are already structurally rare). Best-effort:
 * never throws into the game action that triggered it.
 */
export async function announce(
    a: Omit<Announcement, 'id' | 'ts' | 'receiptId'>,
    opts?: { receiptId?: string },
): Promise<Announcement | null> {
    try {
        const receiptId = opts?.receiptId?.trim().slice(0, 200) || undefined;
        let full: Announcement | null = null;
        let created = false;
        await withKvLock(ANNOUNCEMENTS_KEY, async () => {
            const list = (await kv.get<Announcement[]>(ANNOUNCEMENTS_KEY)) ?? [];
            const current = Array.isArray(list) ? list : [];
            if (receiptId) {
                const existing = current.find((item) => item.receiptId === receiptId);
                if (existing) { full = existing; return; }
            }
            if (a.importance === 'low' || a.importance === 'medium') {
                const rlKey = `announce-rl:${a.type}:${a.player ?? 'server'}:${dateKeyUTC()}`;
                const count = await kv.incr(rlKey, { ex: DAY_SECONDS });
                if (count > 3) return;
            }
            const id = await kv.incr(ANNOUNCEMENTS_SEQ);
            full = { id, ts: Date.now(), ...a, ...(receiptId ? { receiptId } : {}) };
            created = true;
            await kv.set(ANNOUNCEMENTS_KEY, [full, ...(Array.isArray(list) ? list : [])].slice(0, ANNOUNCEMENTS_CAP));
        }, { failClosed: true });
        if (!full) return null;
        // Delivery breadth (handoff §Server Announcements): high/mythic events
        // also land as a system line in every village chat, and mythic events
        // fire the optional Discord webhook. Both best-effort.
        if (a.importance === 'high' || a.importance === 'mythic') {
            if (!(await broadcastToVillageChats(full, receiptId))) return null;
        }
        if (a.importance === 'mythic' && created) {
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
async function broadcastToVillageChats(a: Announcement, receiptId?: string): Promise<boolean> {
    const line = {
        author: '📜 World Herald',
        text: `${a.title} — ${a.message}`.slice(0, 480),
        ts: a.ts,
        rank: 'Herald',
        ...(receiptId ? { receiptId } : {}),
        // `system` marks server-authored lines; api/village/chat.ts constructs
        // player messages from derived fields only, so it can't be forged, and
        // the tavern styles system lines distinctly — a player named to mimic
        // "World Herald" won't get the herald treatment.
        system: true,
    };
    let delivered = true;
    for (const key of VILLAGE_CHAT_KEYS) {
        try {
            await withKvLock(key, async () => {
                const existing = (await kv.get<unknown[]>(key)) ?? [];
                if (receiptId && existing.some((item) => (
                    item && typeof item === 'object' && (item as { receiptId?: unknown }).receiptId === receiptId
                ))) return;
                const next = [...(Array.isArray(existing) ? existing : []), line].slice(-CHAT_MAX_MESSAGES);
                await kv.set(key, next, { ex: 30 * 24 * 60 * 60 });
            }, { failClosed: true });
        } catch { delivered = false; }
    }
    return delivered;
}

/**
 * A proud herald line posted into ONE village's chat — for local, village-
 * scoped celebration (a favored Legacy awakening in its affinity village) that
 * shouldn't spam the global feed. `villageName` is the canonical full form
 * ("Moonshadow Village"); an unknown name is a no-op. Best-effort — never
 * throws into the game action that triggered it.
 */
export async function postVillageHerald(
    villageName: string,
    title: string,
    message: string,
    opts?: { receiptId?: string },
): Promise<boolean> {
    const key = `chat:village:${villageName.toLowerCase().replace(/\s+/g, '-')}`;
    if (!VILLAGE_CHAT_KEYS.includes(key)) return true;
    const receiptId = opts?.receiptId?.trim().slice(0, 200) || undefined;
    const line = {
        author: '📜 World Herald',
        text: `${title} — ${message}`.slice(0, 480),
        ts: Date.now(),
        rank: 'Herald',
        ...(receiptId ? { receiptId } : {}),
        system: true, // server-authored; the tavern can't be tricked into forging it
    };
    try {
        await withKvLock(key, async () => {
            const existing = (await kv.get<unknown[]>(key)) ?? [];
            if (receiptId && existing.some((item) => (
                item && typeof item === 'object' && (item as { receiptId?: unknown }).receiptId === receiptId
            ))) return;
            const next = [...(Array.isArray(existing) ? existing : []), line].slice(-CHAT_MAX_MESSAGES);
            await kv.set(key, next, { ex: 30 * 24 * 60 * 60 });
        }, { failClosed: true });
        return true;
    } catch { return false; }
}

/** Optional Discord relay for mythic moments. Env-gated, fire-and-forget.
 *  Rich embed (importance-colored strip, event-type footer) rather than plain
 *  text, so mythic moments land properly in a community server. */
const DISCORD_EMBED_COLORS: Record<AnnouncementImportance, number> = {
    low: 0x9aa3b2, medium: 0x60a5fa, high: 0xf59e0b, mythic: 0xc084fc,
};
const DISCORD_WEBHOOK_HOSTS = new Set(['discord.com', 'www.discord.com', 'discordapp.com']);
const DISCORD_WEBHOOK_PATH = /^\/api\/webhooks\/\d{10,30}\/[A-Za-z0-9._-]{20,200}$/;

export function validatedDiscordWebhookUrl(raw: string): string | null {
    let parsed: URL;
    try { parsed = new URL(raw); } catch { return null; }
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !DISCORD_WEBHOOK_HOSTS.has(hostname)) return null;
    if (parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (!DISCORD_WEBHOOK_PATH.test(parsed.pathname)) return null;
    return `https://${hostname}${parsed.pathname}`;
}

async function postDiscordWebhook(a: Announcement): Promise<void> {
    const configured = process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;
    const url = configured ? validatedDiscordWebhookUrl(configured) : null;
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
    entry: HallEntryInput,
    opts?: { nxKey?: string },
): Promise<HallEntry | null> {
    try {
        // The pending marker is a durable mini-outbox. It preserves the first
        // claimant's exact payload before the Hall write, then flips to done
        // only after the entry exists. A crash at either write is recoverable,
        // and a later caller cannot steal a server-first claim.
        let full: HallEntry | null = null;
        await withKvLock(HALL_KEY, async () => {
            const list = (await kv.get<HallEntry[]>(HALL_KEY)) ?? [];
            const current = Array.isArray(list) ? list : [];
            let settledEntry = entry;
            if (opts?.nxKey) {
                const markerKey = `hall:nx:${opts.nxKey}`;
                const marker = await kv.get<HallNxMarker>(markerKey);
                if (marker === '1' || (marker && marker.status === 'done')) return;
                const existing = current.find((item) => item.meta?.hallNxKey === opts.nxKey);
                if (existing) {
                    await kv.set(markerKey, {
                        status: 'done', entryId: existing.id, player: existing.player, updatedAt: Date.now(),
                    } satisfies HallNxMarker);
                    return;
                }
                if (!marker) {
                    const claimed = await kv.set(
                        markerKey,
                        {
                            status: 'pending',
                            player: entry.player,
                            entry,
                            updatedAt: Date.now(),
                        } satisfies HallNxMarker,
                        { nx: true },
                    );
                    if (claimed !== 'OK') return;
                } else {
                    // New markers preserve the first claimant's complete
                    // payload. A legacy pending marker can only be recovered by
                    // that same player, so a server-first cannot be stolen.
                    if (marker.entry) settledEntry = marker.entry;
                    else if (marker.player !== undefined && marker.player !== entry.player) return;
                }
            }
            const id = await kv.incr(HALL_SEQ);
            full = {
                id,
                ts: Date.now(),
                status: 'active',
                ...settledEntry,
                ...(opts?.nxKey ? { meta: { ...(settledEntry.meta ?? {}), hallNxKey: opts.nxKey } } : {}),
            };
            await kv.set(HALL_KEY, [full, ...current].slice(0, HALL_CAP));
            if (opts?.nxKey) {
                await kv.set(
                    `hall:nx:${opts.nxKey}`,
                    {
                        status: 'done',
                        entryId: id,
                        player: settledEntry.player,
                        updatedAt: Date.now(),
                    } satisfies HallNxMarker,
                );
            }
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
