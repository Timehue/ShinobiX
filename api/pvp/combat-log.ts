import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { readActionReceipts, readBattleReceipt } from '../_receipts.js';
import type { PvpSession } from './session.js';

// GET /api/pvp/combat-log?id=<battleId>
//
// Durable, structured per-action combat log for a battle. Unlike the live
// `session.log` (capped at 60 lines, gone with the 15-min session TTL), these
// receipts are append-only and kept 90 days, so a player or admin can review
// exactly what happened — each move's name, its flavor/cast narrative + effect
// lines, and compact resource deltas — long after the fight ends.
//
//   → 200 { battleId, entries: ActionReceipt[], source: 'receipts' }
//
// Access: authenticated, restricted to the two participants + admins. The live
// session GET/stream are unauth-by-capability (anyone with the battleId can
// watch the fight), but this structured record is gated: receipts live on
// service-role-only `receipt:` keys, and we confirm the caller is a fighter (or
// admin) before returning it. Participants are resolved from the live session
// while it exists, then from the durable battle receipt after it resolves.
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    // One battle's log is a handful of KB; 60/min per IP is ample for a
    // participant reviewing a fight and blocks scraping loops.
    if (!(await enforceRateLimitKv(req, res, 'pvp-combat-log', 60, 60_000))) return;

    const battleId = String(req.query.id ?? '').trim();
    if (!battleId) return res.status(400).json({ error: 'Missing id' });

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    // Resolve the battle's participants for access control. Prefer the live
    // session (present during / just after the fight); fall back to the durable
    // battle receipt (present once the fight resolved, after the session TTL).
    let p1Name = '';
    let p2Name = '';
    const live = await kv.get<PvpSession>(`pvp:${battleId}`);
    if (live) {
        p1Name = String(live.p1?.name ?? '');
        p2Name = String(live.p2?.name ?? '');
    } else {
        const battle = await readBattleReceipt(battleId);
        if (battle) {
            p1Name = String(battle.p1?.name ?? '');
            p2Name = String(battle.p2?.name ?? '');
        }
    }

    // Admins see any battle. A player may only read a battle they fought in —
    // matched against the participants resolved above (identity.name is only
    // present on the non-admin branch of authedPlayerOrAdmin).
    if (!identity.admin) {
        const me = identity.name;
        const isParticipant = !!me && (me === safeName(p1Name) || me === safeName(p2Name));
        if (!isParticipant) {
            return res.status(403).json({ error: 'Only the battle participants or an admin can view this combat log.' });
        }
    }

    const entries = await readActionReceipts(battleId);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ battleId, entries, source: 'receipts' });
}
