import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { loadOrIssueDailyMissions } from './_progress.js';
import type { Profession } from './_pool.js';

const VALID_PROFESSIONS: Profession[] = ['healer', 'vanguard', 'petTamer'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const playerName = safeName(String(req.query.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only fetch your own missions.' });
        }

        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = record?.character as Record<string, unknown> | undefined;
        const profession = char?.profession as Profession | undefined;
        if (!profession || !VALID_PROFESSIONS.includes(profession)) {
            return res.status(200).json({ profession: null, missions: [] });
        }

        const state = await loadOrIssueDailyMissions(playerName, profession);
        if (!state) {
            return res.status(200).json({ profession, missions: [] });
        }

        return res.status(200).json({
            profession: state.profession,
            date: state.date,
            missions: state.missions,
        });
    } catch (err) {
        // Structured log so a Railway/cPanel 500 here is diagnosable without a
        // repro. The likely causes are storage-layer, not logic: a missing DB
        // env var (DATABASE_URL / SUPABASE_*), an absent kv_store table or
        // kv_set_nx/kv_hset RPC, or the disk-overlay proxy (save:<player> reads)
        // being unreachable. The error message/stack distinguishes which.
        const e = err as Error;
        console.error('[missions/daily] failed', JSON.stringify({
            playerName: safeName(String(req.query.playerName ?? '')),
            name: e?.name,
            message: e?.message,
            stack: e?.stack?.split('\n').slice(0, 4).join(' | '),
        }));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
