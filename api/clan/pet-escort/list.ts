import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { listActiveEscorters } from './_storage.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    // Auth gate: previously anon-readable. Active escorter names + their
    // stamps leak presence intel. Any logged-in player can read; the
    // underlying _storage helper does best-effort stale-cleanup writes
    // so we also avoid anonymous write-induction.
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        const clanName = String(req.query.clanName ?? '').trim();
        if (!clanName) return res.status(400).json({ error: 'Missing clanName.' });
        const escorters = await listActiveEscorters(clanName);
        // 15s edge cache. List changes when a Pet Tamer toggles their
        // escort offer; minute-scale latency would be too laggy for
        // the UI but 15s is fine.
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
        return res.status(200).json({ clanName, escorters });
    } catch (err) {
        console.error('[clan/pet-escort/list]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
