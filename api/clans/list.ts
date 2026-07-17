import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { cachedFor } from '../_proc-cache.js';

// Process-local cache for the clan list build. `kv.keys('save:clan-*')` routes
// to the DISK overlay, and the disk/proxy keys() implementation walks the
// ENTIRE storage tree (every player save + image file on the cPanel box) no
// matter how narrow the pattern is — so before this cache, every player opening
// the Clan hall triggered a full remote tree walk (the response cache below is
// `private`, per-client, so concurrent players didn't share it). 15s here
// bounds that to at most 4 walks/min per process regardless of player count;
// clan create/disband latency grows by ≤15s on a list that already tolerated
// 30s client-side staleness.
const CLANS_LIST_TTL_MS = 15_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    // Require auth, matching every other GET (spectate / messages / save). The
    // clan browser is only reached by a logged-in player or admin, and the
    // global fetch interceptor attaches their credentials to this call — so
    // gating it changes nothing for real clients but stops an unauthenticated
    // client from bulk-scraping every clan's treasury + roster + emblem.
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        // Clans are written by the client (clan-api.ts writeClanData) to
        // `save:clan-<slug>` via the /api/save endpoint — the same key the
        // Clan Hall reads back. So that is the authoritative pattern to scan.
        // `clan:*` is an older/legacy layout kept here as a fallback so a
        // pre-migration clan record still surfaces in the list. Dedupe by key
        // (a migrated clan can exist under both) preferring the `save:clan-*`
        // copy, which is the one the rest of the app reads/writes.
        // Auth is enforced per-request ABOVE; only the storage build is shared.
        const clans = await cachedFor('clans:list', CLANS_LIST_TTL_MS, async () => {
            const [saveKeys, legacyKeys] = await Promise.all([
                kv.keys('save:clan-*'),
                kv.keys('clan:*').catch(() => [] as string[]),
            ]);
            // Normalize both layouts (`save:clan-storm` and legacy `clan:storm`)
            // to the bare slug so a clan present under both isn't listed twice.
            const bareSlug = (k: string) => k.replace(/^save:clan-/, '').replace(/^clan[:-]/, '');
            const seen = new Set(saveKeys.map(bareSlug));
            const keys = [...saveKeys, ...legacyKeys.filter((k) => !seen.has(bareSlug(k)))];
            if (!keys.length) return [] as unknown[];
            return (await kv.mget(...keys)).filter(Boolean);
        });
        // 30s browser-private cache. Now that the list is auth-gated it must
        // NOT sit in a shared/edge cache (that could re-serve the authed list to
        // an unauthenticated client and defeat the gate); `private` keeps the
        // per-client caching benefit — the expensive mget is one row per clan —
        // without that risk. The list changes only on create/disband/edit, so
        // 30s latency is fine.
        res.setHeader('Cache-Control', 'private, max-age=30');
        return res.status(200).json(clans);
    } catch (err) {
        console.error('[clans/list]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
