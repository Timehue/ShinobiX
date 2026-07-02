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
        return full;
    }
    catch (err) {
        console.error('[announce] failed:', err instanceof Error ? err.message : err);
        return null;
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
        if (opts?.nxKey) {
            const claimed = await _storage_js_1.kv.set(`hall:nx:${opts.nxKey}`, '1', { nx: true });
            if (claimed !== 'OK')
                return null;
        }
        const id = await _storage_js_1.kv.incr(HALL_SEQ);
        const full = { id, ts: Date.now(), status: 'active', ...entry };
        await (0, _lock_js_1.withKvLock)(exports.HALL_KEY, async () => {
            const list = (await _storage_js_1.kv.get(exports.HALL_KEY)) ?? [];
            await _storage_js_1.kv.set(exports.HALL_KEY, [full, ...(Array.isArray(list) ? list : [])].slice(0, HALL_CAP));
        });
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
