import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { readSession } from '../towers/_tower-store.js';
import { readSoloPveSession } from '../solo-pve/_store.js';
import { isSoloPveSession } from '../solo-pve/_session.js';
import { abandonSoloPveSession } from '../solo-pve/_abandon.js';
import type { AiFightSession } from '../missions/_ai-fight-outcome.js';
import { settlePveFightOutcome } from './_fight-outcome-settlement.js';

/*
 * /api/pve/fight-outcome — POST only
 *
 * The PHYSICAL consequence of a server-resolved PvE fight, split out from the
 * reward. It pays nothing and grants nothing; all it does is write back what the
 * fight cost: the HP the player survived with, and the hospital stay when they
 * went down or walked out on an unresolved run.
 *
 * WHY THIS EXISTS
 * Every mode that moved onto the tower engine lost its defeat cost. The local
 * Arena writes surviving HP back on every exchange and does
 * `{hp: 0, hospitalized: true}` when the player falls — none of the
 * server-resolved modes did either, so losing a combat mission or a story boss
 * cost literally nothing and could be retried immediately at full HP. That is
 * not a difficulty knob, it is the risk half of the loop going missing.
 *
 * Kept separate from the reward settles (api/story/settle, queue-combat-claim)
 * on purpose: those refuse a losing run by design, and threading a defeat
 * through them would mean teaching each one to pay nothing while still writing a
 * save. One endpoint, one rule, reused by every mode.
 *
 * AUTHORITY
 * The SESSION decides — never the caller. The body carries a runId and nothing
 * else that matters, and unlike the AI-fight path (where the runId comes from a
 * sealed token) this one is client-supplied, so membership is verified against
 * the session's own squad roster before anything is written. A stranger's runId
 * settles nothing.
 *
 * IDEMPOTENT
 * A per-run receipt gates the write. Without it a refresh on the results screen
 * would re-apply the hospital stay and PUSH `hospitalizedUntil` further out each
 * time — a defeat that gets worse the more you look at it.
 */

function cleanRunId(raw: unknown): string {
    const runId = typeof raw === 'string' ? raw.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9:_-]+$/.test(runId) ? runId : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only settle your own fights.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pve-fight-outcome', 60, 60_000, identity.name))) return;

        const runId = cleanRunId(body.runId);
        if (!runId) return res.status(400).json({ error: 'Missing run.' });

        // Solo-PvE first; the legacy Tower store is consulted only after a
        // CONFIRMED not-found. A storage failure on either read is an outage,
        // not evidence of absence: it used to be swallowed into `null` and
        // answered 200 `unknown`, which told the client its obligation was
        // finished. It now answers a retryable 503 that keeps the same runId
        // pending on the client (lib/pve-outcome-api retries on any non-2xx).
        let session: AiFightSession | null;
        try {
            session = await readSoloPveSession(runId) ?? await readSession(runId);
        } catch (err) {
            console.error('[pve/fight-outcome] session store unavailable', safeLogValue(err));
            return res.status(503).json({ error: 'The fight record is temporarily unavailable. Please retry.', retryable: true, runId });
        }
        // A vanished session neither costs nor refunds. The store has a TTL, and a
        // late report is far likelier to be a slow client than a cheat — so this
        // fails toward leaving the player alone, the only side that cannot punish
        // someone who did nothing wrong.
        if (!session) return res.status(200).json({ ok: true, outcome: 'unknown', applied: false, reason: 'session-not-found' });

        // An ACTIVE session is not settled from its live HP. The owner walking
        // out on a Solo-PvE fight is an intentional abandon: perform the engine's
        // own terminal transition in the owning store first, then settle the
        // sealed result exactly like any other terminal session. Anything else
        // that is still active (a Tower run, which has its own lifecycle) is
        // refused rather than given a premature physical receipt.
        if (isSoloPveSession(session) && session.status === 'active') {
            if (identity.admin || session.ownerSlug.toLowerCase() === playerName.toLowerCase()) {
                const abandoned = await abandonSoloPveSession(session.sessionId, playerName);
                if (!abandoned.ok) {
                    return res.status(abandoned.status).json({
                        error: abandoned.error,
                        ...(abandoned.retryable ? { retryable: true, runId } : {}),
                    });
                }
                session = abandoned.session;
            }
        }
        if (session.status !== 'done') {
            return res.status(409).json({ error: 'That run is still active. Finish or leave it through its own mode first.', reason: 'session-active', runId });
        }

        // The runId is CLIENT-supplied here. Membership is the only thing stopping
        // one player from applying another's session outcome to their own save —
        // which, on a winning session, would be a free heal.
        const settled = await settlePveFightOutcome(session, playerName);
        if (!settled.ok) return res.status(settled.status).json({ error: settled.error });
        return res.status(200).json(settled);
    } catch (err) {
        console.error('[pve/fight-outcome]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
