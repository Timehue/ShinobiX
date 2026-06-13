import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import {
    applyLazyClanWarExpiry,
    loadAllClanWars,
    loadClanContext,
    redactClanWarForViewer,
} from './_storage.js';

// GET /api/clan/war/list
// Returns all clan wars (active + recently ended) so the client can
// render the Shinobi Council Hall "Clan Battles" tab.
//
// Authed: the response is contextually redacted so the caller never
// sees the challenger names on pending/queuing challenges from a
// rival clan — anonymity holds in the raw JSON, not just the UI.
// Admins always see the unredacted record.
//
// Applies lazy stale-challenge / stale-war expiry on read so the
// response always reflects the current logical state — but does NOT
// persist (POST endpoints do that). Concurrent readers stay
// consistent because POSTs hold the war lock during their writes.

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        // Auth is best-effort: unauthed callers get the fully-redacted
        // public view (no challenger names at all). Authed callers see
        // their own clan's challenger names unredacted. Admins see
        // everything.
        const identity = await authedPlayerOrAdmin(req).catch(() => null);
        let viewerClan = '';
        let isAdmin = false;
        if (identity && identity.admin) {
            isAdmin = true;
        } else if (identity && !identity.admin) {
            const ctx = await loadClanContext(identity.name).catch(() => null);
            viewerClan = ctx?.clan ?? '';
        }

        const wars = await loadAllClanWars();
        const now = Date.now();
        const projected = wars.map(w => applyLazyClanWarExpiry(w, now).war);
        const shaped = isAdmin
            ? projected
            : projected.map(w => redactClanWarForViewer(w, viewerClan));

        // Drop CDN cache for authed responses since the body now varies
        // by viewer. Unauthed callers still benefit from same logical
        // result (fully redacted), but we can't share a single cache
        // entry across clans safely.
        if (!isAdmin && !viewerClan) {
            res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
        } else {
            res.setHeader('Cache-Control', 'private, no-store');
        }
        return res.status(200).json({ wars: shaped });
    } catch (err) {
        console.error('[clan/war/list]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
