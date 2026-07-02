"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HALL_KEY = exports.ANNOUNCEMENTS_KEY = void 0;
exports.announce = announce;
exports.recentAnnouncements = recentAnnouncements;
exports.addHallEntry = addHallEntry;
exports.readHallEntries = readHallEntries;
exports.updateHallEntry = updateHallEntry;
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
const _storage_js_1 = require("./_storage.js");
const _lock_js_1 = require("./_lock.js");
exports.ANNOUNCEMENTS_KEY = 'game:announcements';
const ANNOUNCEMENTS_SEQ = 'game:announcements-seq';
const ANNOUNCEMENTS_CAP = 100;
exports.HALL_KEY = 'hall:entries';
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
async function announce(a) {
    try {
        if (a.importance === 'low' || a.importance === 'medium') {
            const rlKey = `announce-rl:${a.type}:${a.player ?? 'server'}:${dateKeyUTC()}`;
            const count = await _storage_js_1.kv.incr(rlKey, { ex: DAY_SECONDS });
            if (count > 3)
                return null;
        }
        const id = await _storage_js_1.kv.incr(ANNOUNCEMENTS_SEQ);
        const full = { id, ts: Date.now(), ...a };
        await (0, _lock_js_1.withKvLock)(exports.ANNOUNCEMENTS_KEY, async () => {
            const list = (await _storage_js_1.kv.get(exports.ANNOUNCEMENTS_KEY)) ?? [];
            await _storage_js_1.kv.set(exports.ANNOUNCEMENTS_KEY, [full, ...(Array.isArray(list) ? list : [])].slice(0, ANNOUNCEMENTS_CAP));
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
    }
    catch (err) {
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
async function broadcastToVillageChats(a) {
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
            await (0, _lock_js_1.withKvLock)(key, async () => {
                const existing = (await _storage_js_1.kv.get(key)) ?? [];
                const next = [...(Array.isArray(existing) ? existing : []), line].slice(-CHAT_MAX_MESSAGES);
                await _storage_js_1.kv.set(key, next, { ex: 30 * 24 * 60 * 60 });
            });
        }
        catch { /* best-effort per village */ }
    }
}
/** Optional Discord relay for mythic moments. Env-gated, fire-and-forget. */
async function postDiscordWebhook(a) {
    const url = process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;
    if (!url)
        return;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: `**${a.title}**\n${a.message}`,
                username: 'World Herald',
            }),
        });
    }
    catch (err) {
        console.error('[announce] discord webhook failed:', err instanceof Error ? err.message : err);
    }
}
async function recentAnnouncements(limit = 20, sinceId = 0) {
    try {
        const list = (await _storage_js_1.kv.get(exports.ANNOUNCEMENTS_KEY)) ?? [];
        const arr = Array.isArray(list) ? list : [];
        const filtered = sinceId > 0 ? arr.filter((a) => a.id > sinceId) : arr;
        return filtered.slice(0, Math.max(1, Math.min(limit, ANNOUNCEMENTS_CAP)));
    }
    catch {
        return [];
    }
}
/**
 * Mint a permanent Hall of Legends entry. `nxKey` makes server-first style
 * entries idempotent: the first caller wins, every retry/replay is a no-op
 * (the same trick as ranked:season:rewarded markers).
 */
async function addHallEntry(entry, opts) {
    try {
        // The NX claim and the list write commit together under a fail-closed
        // lock — claiming first and then failing the (previously fail-open)
        // write would permanently lose a "permanent" entry (verification
        // finding). Lock contention throws to the catch: callers are
        // best-effort and the NX stays unclaimed for the retry.
        let full = null;
        await (0, _lock_js_1.withKvLock)(exports.HALL_KEY, async () => {
            if (opts?.nxKey) {
                const claimed = await _storage_js_1.kv.set(`hall:nx:${opts.nxKey}`, '1', { nx: true });
                if (claimed !== 'OK')
                    return;
            }
            const id = await _storage_js_1.kv.incr(HALL_SEQ);
            full = { id, ts: Date.now(), status: 'active', ...entry };
            const list = (await _storage_js_1.kv.get(exports.HALL_KEY)) ?? [];
            await _storage_js_1.kv.set(exports.HALL_KEY, [full, ...(Array.isArray(list) ? list : [])].slice(0, HALL_CAP));
        }, { failClosed: true });
        return full;
    }
    catch (err) {
        console.error('[hall] add failed:', err instanceof Error ? err.message : err);
        return null;
    }
}
async function readHallEntries(opts) {
    try {
        const list = (await _storage_js_1.kv.get(exports.HALL_KEY)) ?? [];
        const arr = Array.isArray(list) ? list : [];
        const visible = opts?.includeHidden ? arr : arr.filter((e) => e.status !== 'hidden');
        return visible.slice(0, Math.max(1, Math.min(opts?.limit ?? 200, HALL_CAP)));
    }
    catch {
        return [];
    }
}
/** Admin correction: never deletes — flips status / annotates, keeps history. */
async function updateHallEntry(id, patch) {
    let updated = null;
    await (0, _lock_js_1.withKvLock)(exports.HALL_KEY, async () => {
        const list = (await _storage_js_1.kv.get(exports.HALL_KEY)) ?? [];
        const arr = Array.isArray(list) ? list : [];
        const idx = arr.findIndex((e) => e.id === id);
        if (idx < 0)
            return;
        updated = { ...arr[idx], ...patch };
        arr[idx] = updated;
        await _storage_js_1.kv.set(exports.HALL_KEY, arr);
    }, { failClosed: true });
    return updated;
}
