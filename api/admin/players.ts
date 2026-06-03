import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { onlineStore } from '../_realtime/online-store.js';

const REGISTRY_KEY = 'player:registry';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Rate-limit admin endpoints: 30 requests / 5 minutes per IP.
    if (!enforceRateLimit(req, res, 'admin-players', 30, 5 * 60_000)) return;

    // Admin password now read from x-admin-password HEADER instead of the
    // request body. Bodies routinely land in request loggers / error
    // trackers / reverse-proxy buffers; headers are typically redacted.
    // (Two other admin endpoints — moderation.ts, migrate-kv.ts — already
    // used the header; players.ts/server-reset.ts/item-review.ts/
    // bloodline-review.ts now match.)
    // Full admin (Admin 1) only — content admin (Admin 2) does NOT have
    // access to player management.
    if (!isFullAdmin(req)) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }

    try {

        // Who is online right now — from the in-memory presence store.
        const onlineNames = new Set(onlineStore.list().map(p => p.name));

        // Primary source: persistent player registry (hset by heartbeat + save API)
        const rawRegistry = await kv.hgetall<Record<string, string>>(REGISTRY_KEY) ?? {};
        const players: { name: string; level: number; village: string; specialty: string; lastSeen: number; online: boolean }[] = [];

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
            } catch {
                // skip malformed entry
            }
        }

        // Scan all save:* keys — needed to catch accounts not yet in the registry
        // AND to collect player-submitted bloodlines.
        const saveKeys = await kv.keys('save:*');

        // Collect all bloodlines from all player saves in parallel
        type RawBloodline = Record<string, unknown>;
        type BloodlineEntry = {
            id: string;
            name: string;
            rank: string;
            image?: string;
            specialElement?: string;
            lore?: string;
            jutsus: unknown[];
            totalPoints: number;
            ownerName: string;
            ownerKey: string;
        };
        const bloodlineEntries: BloodlineEntry[] = [];

        // Single mget round-trip instead of N individual kv.get() calls
        // (audit #29: the old map+get pattern issued one KV request per player,
        // which scaled linearly and hammered the connection pool). mget returns
        // values positionally aligned to saveKeys.
        let saveValues: (Record<string, unknown> | null)[] = [];
        try {
            saveValues = saveKeys.length > 0
                ? await kv.mget<Record<string, unknown>[]>(...saveKeys)
                : [];
        } catch (err) {
            console.warn('[admin/players] save mget failed', err);
            saveValues = [];
        }
        const saveSnaps = saveKeys.map((key, i) => ({ key, snap: saveValues[i] ?? null }));

        for (const { key, snap } of saveSnaps) {
            const name = key.replace('save:', '');
            const char = snap?.character as Record<string, unknown> | undefined;

            // Add to player list if not already present from registry
            if (!players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
                players.push({
                    name: (char?.name as string) ?? name,
                    level: (char?.level as number) ?? 1,
                    village: (char?.village as string) ?? '',
                    specialty: (char?.specialty as string) ?? '',
                    lastSeen: 0,
                    online: onlineNames.has(name.toLowerCase()),
                });
            }

            // Collect bloodlines
            const rawBloodlines = snap?.savedBloodlines as RawBloodline[] | undefined;
            if (Array.isArray(rawBloodlines)) {
                const ownerName = (char?.name as string) ?? name;
                for (const bl of rawBloodlines) {
                    if (!bl?.id || !bl?.name) continue;
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
                const sharedImages = await kv.hgetall<Record<string, string>>('shared:imgfields:bloodline') ?? {};
                for (const bl of bloodlineEntries) {
                    if (!bl.image && sharedImages[`bloodline:${bl.id}`]) {
                        bl.image = sharedImages[`bloodline:${bl.id}`];
                    }
                }
            } catch {
                // non-fatal — images just won't be restored
            }
        }
        // If we skipped inline restore, strip any inline data-URLs the saves
        // happened to keep so the response stays compact. The admin UI can
        // fetch shared:imgfields:bloodline directly when it needs them.
        if (bloodlineEntries.length > INLINE_IMAGE_LIMIT) {
            for (const bl of bloodlineEntries) {
                if (bl.image && bl.image.startsWith('data:')) bl.image = undefined;
            }
        }

        // Sort: online first, then by lastSeen descending, then alphabetically
        players.sort((a, b) => {
            if (a.online !== b.online) return a.online ? -1 : 1;
            if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen;
            return a.name.localeCompare(b.name);
        });

        return res.status(200).json({ players, bloodlines: bloodlineEntries });
    } catch (err) {
        console.error('[admin/players]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
