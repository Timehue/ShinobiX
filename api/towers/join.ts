import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { readSession, writeSession } from './_tower-store.js';
import { clampTowerLoadout } from './_seal.js';

/*
 * POST /api/towers/join — a squad member (esp. a borrowed/invited ally) supplies their
 * client-computed loadout extras (pvpItems + equipment passives the SAVE doesn't persist) so
 * their LIVE fighter is fully equipped, exactly like the host's at /start. It merges ONLY the
 * clamped loadout fields onto the caller's OWN squad actor — never the server-authoritative
 * stats / jutsu / vitals / itemCharges (those were sealed from the save at /start). Idempotent
 * (re-merging the same clamped values is a no-op in effect). Body: { runId, playerName, loadout }.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const runId = String(body.runId ?? '');
        if (!playerName || !runId) return res.status(400).json({ error: 'Missing player or run.' });
        if (!enforceRateLimit(req, res, 'towers-join', 12, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only join as yourself.' });

        const session = await readSession(runId);
        if (!session) return res.status(404).json({ error: 'Run not found.' });

        // Only the caller's own LIVE squad actor (membership = ownership).
        const myActor = session.actors.find(a => a.side === 'squad' && a.ownerSlug === playerName);
        if (!myActor) return res.status(403).json({ error: 'Not a member of this run.' });
        if (session.status !== 'active') return res.status(200).json({ session });

        const loadout = (body.loadout && typeof body.loadout === 'object') ? body.loadout as Record<string, unknown> : {};
        const clamped = clampTowerLoadout(loadout);
        if (Object.keys(clamped).length > 0) {
            Object.assign(myActor.character, clamped);
            await writeSession(session);
        }
        return res.status(200).json({ session });
    } catch (err) {
        console.error('[towers/join]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
