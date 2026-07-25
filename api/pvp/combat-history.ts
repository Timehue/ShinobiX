import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { readBattleHistory, HISTORY_MAX_ENTRIES } from '../_receipts.js';
import type { BattleHistorySummary } from '../_receipts.js';

// GET /api/pvp/combat-history?limit=20&cursor=<offset>
//
// The caller's own durable battle list — the index written for both fighters
// when a battle resolves (see api/_receipts.ts "per-player battle history
// index"). This is what makes a finished fight survive the 15-minute
// `pvp:<battleId>` session TTL: the client no longer needs to already know a
// battleId to find a battle, and history now follows the account rather than the
// browser tab that fought it.
//
//   → 200 { entries: BattleHistorySummary[], nextCursor?: number }
//
// Access: authenticated. A normal player can only read their OWN history — the
// subject is resolved from the auth identity, never from a query parameter, so
// there is no way to enumerate another account's battles. Admins may pass
// ?player=<name> for support triage, matching the existing admin patterns.
//
// The stored summaries are already display-shaped and participant-relative
// (opponent + outcome from the reader's side), so this endpoint is one KV read
// and a slice — no per-battle fan-out, and no fighter character blobs, loadouts,
// inventory, or auth material are ever in the payload.

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = HISTORY_MAX_ENTRIES;

// Cursor is a simple offset into the newest-first list. The list is capped and
// immutable-per-battle, so an offset is stable enough for pagination without
// carrying an opaque token; it is clamped so a hostile value can't index wildly.
function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    // One list is a few KB. 60/min per IP covers a player paging through their
    // history and blocks a scraping loop.
    if (!(await enforceRateLimitKv(req, res, 'pvp-combat-history', 60, 60_000))) return;

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    // Resolve the SUBJECT from auth, not from the query string. Only an admin may
    // name a different player; a normal player's ?player= is ignored outright
    // rather than validated, so there is nothing to bypass.
    let subject = identity.admin ? '' : String(identity.name ?? '');
    if (identity.admin) {
        const requested = String(req.query.player ?? '').trim();
        if (!requested) return res.status(400).json({ error: 'Admin requests must name a player.' });
        subject = requested;
    }
    const safeSubject = safeName(subject);
    if (!safeSubject) return res.status(400).json({ error: 'Could not resolve a player for this request.' });

    const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const cursor = clampInt(req.query.cursor, 0, 0, MAX_LIMIT);

    const all: BattleHistorySummary[] = await readBattleHistory(safeSubject);
    const page = all.slice(cursor, cursor + limit);
    const next = cursor + page.length;
    // Only advertise a cursor when there is genuinely more to read, so the client
    // can loop on `while (nextCursor)` without an extra empty round-trip.
    const nextCursor = next < all.length ? next : undefined;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ entries: page, nextCursor });
}
