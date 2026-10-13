import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors, clanRecordKey } from '../../_utils.js';
import { kv } from '../../_storage.js';
import { reconcileClanWarCampaign } from './_campaign-reconcile.js';
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
// Legacy HP reads remain side-effect-free. A participating clan's campaign
// read reconciles trusted battle results, closure and durable reward repairs.

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
        const projected = [];
        for (const war of wars) {
            projected.push(war.campaign && (isAdmin || war.clans.includes(viewerClan)
                ||(identity&&!identity.admin&&war.campaign.rosters.some(roster=>roster.members.some(member=>member.name===identity.name))))
                ? await reconcileClanWarCampaign(war.id,now) ?? war : applyLazyClanWarExpiry(war,now).war);
        }
        const clan = viewerClan ? await kv.get<Record<string, unknown>>(clanRecordKey(viewerClan)) : null;
        const scoutLevel = Number((clan?.upgrades as Record<string, unknown> | undefined)?.scoutNetwork ?? 0);
        const shaped = isAdmin
            ? projected
            : projected.map(w => redactClanWarForViewer(w, viewerClan, identity && !identity.admin ? identity.name : '', now,scoutLevel));

        // Drop CDN cache for authed responses since the body now varies
        // by viewer. Unauthed callers still benefit from same logical
        // result (fully redacted), but we can't share a single cache
        // entry across clans safely.
        if (!identity) {
            res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
        } else {
            res.setHeader('Cache-Control', 'private, no-store');
        }
        return res.status(200).json({ wars: shaped,serverNow:now });
    } catch (err) {
        console.error('[clan/war/list]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
