import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors, clanBareSlug } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { playerClanSlug } from '../../clans/_clan-public-view.js';
import { loadPool } from './_storage.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    // Auth gate: previously anon-readable. The recent donation log (donor
    // names + amounts + timestamps) is useful intel for griefing campaigns,
    // so only the clan's own members (and admins) see it. The client only
    // ever asks for the player's own clan (ClanSealPool.tsx); a non-member
    // gets the balance with an empty log, the same shape as a fresh pool.
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        const clanName = String(req.query.clanName ?? '').trim();
        if (!clanName) return res.status(400).json({ error: 'Missing clanName.' });
        const targetSlug = clanBareSlug(clanName);
        const isMember = identity.admin
            || (!!targetSlug && (await playerClanSlug(identity.name)) === targetSlug);
        const pool = await loadPool(clanName);
        return res.status(200).json({
            clanName: pool.clanName,
            balance: pool.balance,
            log: isMember ? pool.log.slice(0, 20) : [],
        });
    } catch (err) {
        console.error('[clan/seal-pool/get]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
