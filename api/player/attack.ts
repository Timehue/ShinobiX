import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Require a logged-in player. Prevents anonymous DoS where any name
    // can be marked as "engaged" to block their PvP.
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { targetName, attacker } = body as { targetName?: string; attacker?: { name?: string } | null };
        if (!targetName) return res.status(400).json({ error: 'Missing targetName.' });

        // Attacker's reported name (if any) must match the authed identity —
        // a player can't initiate an attack masquerading as someone else.
        if (!identity.admin && attacker && attacker.name) {
            const claimedName = String(attacker.name).trim().toLowerCase();
            if (claimedName !== identity.name) {
                return res.status(403).json({ error: 'Attacker name does not match authenticated user.' });
            }
        }

        const key = `presence:${targetName}`;
        const target = await kv.get<Record<string, unknown>>(key);
        if (!target) return res.status(404).json({ error: 'Target not online.' });

        // Block attack if the target is currently traveling between sectors.
        const travelingUntil = Number(target.travelingUntil ?? 0);
        if (travelingUntil > Date.now()) {
            return res.status(409).json({ error: 'Target is traveling and cannot be attacked.' });
        }

        // Block attack if the target already has a pending attacker (double-battle prevention).
        if (target.pendingAttacker) {
            return res.status(409).json({ error: 'Target is already engaged in combat.' });
        }

        // Block attack if the target is in an active PvP battle.
        if (target.inBattle) {
            return res.status(409).json({ error: 'Target is already in a battle.' });
        }

        await kv.set(key, { ...target, pendingAttacker: attacker ?? null }, { ex: 60 });
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[attack]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
