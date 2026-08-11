import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { readSession } from './_tower-store.js';

/*
 * POST /api/towers/join — a squad member (esp. a borrowed/invited ally) confirms membership
 * in a run and receives the session. Purely a read: every member's fighter — jutsu, stats,
 * pvpItems, and the equipment-derived passives — was already sealed SERVER-SIDE from their
 * authoritative save at /start (sealTowerFighter → hydrateCharacterFromSave derives pvpItems
 * + multipliers via resolveEquippedPvpItems / deriveCombatMultipliers). The endpoint used to
 * Object.assign a clamped client `loadout` onto the sealed actor, which let a tampered client
 * overwrite its server-derived gear with inflated values (armorRawDR up to the 1.5 clamp,
 * 5000 shield, 60-EP weapons) in a reward-paying mode — the body's `loadout` is now ignored.
 * Body: { runId, playerName }.
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

        // Read-only membership check: the actor's loadout was sealed at /start and
        // is immutable mid-run, so no session lock or write is needed here.
        const session = await readSession(runId);
        if (!session) return res.status(404).json({ error: 'Run not found.' });

        // Only the caller's own LIVE squad actor (membership = ownership).
        const myActor = session.actors.find(a => a.side === 'squad'
            && a.ai === false
            && a.ownerSlug === playerName);
        if (!myActor) return res.status(403).json({ error: 'Not a member of this run.' });
        return res.status(200).json({ session });
    } catch (err) {
        console.error('[towers/join]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
