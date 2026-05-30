"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const REGISTRY_KEY = 'player:registry';
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Rate-limit admin endpoints: 30 requests / 5 minutes per IP.
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-players', 30, 5 * 60_000))
        return;
    // Admin password now read from x-admin-password HEADER instead of the
    // request body. Bodies routinely land in request loggers / error
    // trackers / reverse-proxy buffers; headers are typically redacted.
    // (Two other admin endpoints — moderation.ts, migrate-kv.ts — already
    // used the header; players.ts/server-reset.ts/item-review.ts/
    // bloodline-review.ts now match.)
    // Full admin (Admin 1) only — content admin (Admin 2) does NOT have
    // access to player management.
    if (!(0, _auth_js_1.isFullAdmin)(req)) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    try {
        // Pull presence keys to determine who is online right now
        const presenceKeys = await _storage_js_1.kv.keys('presence:*');
        const onlineNames = new Set(presenceKeys.map(k => k.replace('presence:', '').toLowerCase()));
        // Primary source: persistent player registry (hset by heartbeat + save API)
        const rawRegistry = await _storage_js_1.kv.hgetall(REGISTRY_KEY) ?? {};
        const players = [];
        for (const [, value] of Object.entries(rawRegistry)) {
            try {
                const entry = typeof value === 'string' ? JSON.parse(value) : value;
                players.push({
                    name: entry.name ?? '',
                    level: entry.level ?? 1,
                    village: entry.village ?? '',
                    specialty: entry.specialty ?? '',
                    lastSeen: entry.lastSeen ?? 0,
                    online: onlineNames.has((entry.name ?? '').toLowerCase()),
                });
            }
            catch {
                // skip malformed entry
            }
        }
        // Scan all save:* keys — needed to catch accounts not yet in the registry
        // AND to collect player-submitted bloodlines.
        const saveKeys = await _storage_js_1.kv.keys('save:*');
        const bloodlineEntries = [];
        // Single mget round-trip instead of N individual kv.get() calls
        // (audit #29: the old map+get pattern issued one KV request per player,
        // which scaled linearly and hammered the connection pool). mget returns
        // values positionally aligned to saveKeys.
        let saveValues = [];
        try {
            saveValues = saveKeys.length > 0
                ? await _storage_js_1.kv.mget(...saveKeys)
                : [];
        }
        catch (err) {
            console.warn('[admin/players] save mget failed', err);
            saveValues = [];
        }
        const saveSnaps = saveKeys.map((key, i) => ({ key, snap: saveValues[i] ?? null }));
        for (const { key, snap } of saveSnaps) {
            const name = key.replace('save:', '');
            const char = snap?.character;
            // Add to player list if not already present from registry
            if (!players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
                players.push({
                    name: char?.name ?? name,
                    level: char?.level ?? 1,
                    village: char?.village ?? '',
                    specialty: char?.specialty ?? '',
                    lastSeen: 0,
                    online: onlineNames.has(name.toLowerCase()),
                });
            }
            // Collect bloodlines
            const rawBloodlines = snap?.savedBloodlines;
            if (Array.isArray(rawBloodlines)) {
                const ownerName = char?.name ?? name;
                for (const bl of rawBloodlines) {
                    if (!bl?.id || !bl?.name)
                        continue;
                    bloodlineEntries.push({
                        id: String(bl.id),
                        name: String(bl.name),
                        rank: String(bl.rank ?? 'B Rank'),
                        image: bl.image ? String(bl.image) : undefined,
                        specialElement: bl.specialElement ? String(bl.specialElement) : undefined,
                        lore: bl.lore ? String(bl.lore) : undefined,
                        jutsus: Array.isArray(bl.jutsus) ? bl.jutsus : [],
                        totalPoints: Number(bl.totalPoints ?? 0),
                        ownerName,
                        ownerKey: name,
                    });
                }
            }
        }
        // Restore bloodline images from shared KV image store
        // (saveBloodline strips large data-urls on auto-save; they live in shared:imgfields:bloodline).
        //
        // Bandwidth guard: each data-URL can be 100-500 KB, so a moderately
        // populated registry inlining ALL of them could push the response past
        // function memory limits / make the admin tab unusable. If there are
        // more than INLINE_IMAGE_LIMIT bloodlines, skip the inline restore
        // and let the admin UI lazy-fetch the few it actually needs via the
        // shared image endpoint.
        const INLINE_IMAGE_LIMIT = 50;
        if (bloodlineEntries.length > 0 && bloodlineEntries.length <= INLINE_IMAGE_LIMIT) {
            try {
                const sharedImages = await _storage_js_1.kv.hgetall('shared:imgfields:bloodline') ?? {};
                for (const bl of bloodlineEntries) {
                    if (!bl.image && sharedImages[`bloodline:${bl.id}`]) {
                        bl.image = sharedImages[`bloodline:${bl.id}`];
                    }
                }
            }
            catch {
                // non-fatal — images just won't be restored
            }
        }
        // If we skipped inline restore, strip any inline data-URLs the saves
        // happened to keep so the response stays compact. The admin UI can
        // fetch shared:imgfields:bloodline directly when it needs them.
        if (bloodlineEntries.length > INLINE_IMAGE_LIMIT) {
            for (const bl of bloodlineEntries) {
                if (bl.image && bl.image.startsWith('data:'))
                    bl.image = undefined;
            }
        }
        // Sort: online first, then by lastSeen descending, then alphabetically
        players.sort((a, b) => {
            if (a.online !== b.online)
                return a.online ? -1 : 1;
            if (b.lastSeen !== a.lastSeen)
                return b.lastSeen - a.lastSeen;
            return a.name.localeCompare(b.name);
        });
        return res.status(200).json({ players, bloodlines: bloodlineEntries });
    }
    catch (err) {
        console.error('[admin/players]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
