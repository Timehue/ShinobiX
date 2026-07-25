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

    // Durable payload. `battle` is the resolved BattleReceipt when one exists so
    // the client can render the summary header (outcome, rounds, opponent)
    // without a second request; it is null while the fight is still live.
    const battle = await readBattleReceipt(battleId);
    const all = await readActionReceipts(battleId);

    // 404 only when we have NEITHER a live session NOR any durable record —
    // otherwise a battle that resolved before per-action receipts existed would
    // look like it never happened.
    if (!live && !battle && all.length === 0) {
        return res.status(404).json({ error: 'No combat log found for that battle.' });
    }

    // Optional server-side narrowing. The client can also filter locally, but
    // doing it here keeps a long fight's payload small on mobile.
    const actorFilter = String(req.query.actor ?? 'all').toLowerCase();
    const includeBasic = String(req.query.includeBasic ?? 'true').toLowerCase() !== 'false';
    // Resolve "self"/"opponent" against the CALLER's role, not a client-supplied
    // role, so the filter can't be used to probe anything they can't already see.
    const myRole: 'p1' | 'p2' | null = !identity.admin && identity.name
        ? (identity.name === safeName(p1Name) ? 'p1' : identity.name === safeName(p2Name) ? 'p2' : null)
        : null;

    let filtered = all;
    if (myRole && (actorFilter === 'self' || actorFilter === 'opponent')) {
        const want: 'p1' | 'p2' = actorFilter === 'self' ? myRole : (myRole === 'p1' ? 'p2' : 'p1');
        filtered = filtered.filter((e) => e.actorRole === want);
    }
    if (!includeBasic) {
        // "Basic actions" are the low-signal turn/movement/basic beats a player
        // scrubbing a fight usually wants out of the way.
        const noisy = new Set(['basic', 'movement', 'turn']);
        filtered = filtered.filter((e) => !noisy.has(e.display?.category ?? ''));
    }

    // Newest-first pagination by seq. `beforeSeq` walks backwards through a long
    // fight without re-sending the whole log.
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : filtered.length;
    const rawBefore = Number(req.query.beforeSeq);
    const beforeSeq = Number.isFinite(rawBefore) ? Math.floor(rawBefore) : null;
    const windowed = beforeSeq === null ? filtered : filtered.filter((e) => e.seq < beforeSeq);
    // Take the LAST `limit` entries so a default request returns the most recent
    // action of the fight, then hand back ascending seq order for rendering.
    const page = windowed.slice(Math.max(0, windowed.length - limit));
    const nextCursor = page.length && windowed.length > page.length ? page[0].seq : undefined;

    // A battle that predates per-action receipts still has its final log on the
    // BattleReceipt. Report that honestly via `source` so the client renders it
    // through buildActionsFromPvpLog instead of showing "no actions".
    const source = all.length > 0 ? 'receipts' : (battle?.log?.length ? 'legacy-final-log' : 'receipts');

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
        battleId,
        battle,
        entries: page,
        source,
        nextCursor,
        legacyLog: source === 'legacy-final-log' ? (battle?.log ?? []) : undefined,
    });
}
