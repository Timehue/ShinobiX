import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { projectTowerPvpMatchForViewer } from '../towers/_pvp-session.js';
import { settleTowerPvpMatch, towerPvpState } from '../towers/_pvp-lifecycle.js';
import { readTowerPvpMatch } from '../towers/_pvp-store.js';
import {
    acceptRanked2v2Invite,
    inviteRanked2v2Partner,
    leaveRanked2v2Duo,
    queueRanked2v2,
    ranked2v2Status,
    unqueueRanked2v2,
} from './_ranked-2v2.js';
import { settleRanked2v2Match } from './_ranked-2v2-settlement.js';

/*
 * POST /api/pvp/ranked-2v2 — the duo-queue half of ranked 2v2.
 *
 * Pair up, queue together, get matched against another pair:
 *   { action: 'status' }                → duo + queue + live match
 *   { action: 'invite', target }        → invite one partner
 *   { action: 'accept' }                → accept the pending invitation
 *   { action: 'leave' }                 → leave/disband the duo
 *   { action: 'queue' }                 → queue the duo (either member may)
 *   { action: 'unqueue' }               → leave the queue, keep the duo
 *   { action: 'settle' }                → apply the ladder result exactly once
 *
 * The FIGHT itself deliberately reuses the shared four-player surfaces:
 *   /api/towers/pvp-state   poll + reconnect
 *   /api/towers/pvp-action  one idempotent combat command
 * so there is no second combat implementation to drift, and a ranked 2v2 plays
 * by exactly the rules 1v1 PvP does. Only pairing, matchmaking and rating live
 * here — and rating is the reason /api/towers/pvp-settle refuses this match.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const action = String(body.action ?? 'status');
        if (!playerName) return res.status(400).json({ error: 'Missing player.', errorCode: 'invalid-player' });
        if (!enforceRateLimit(req, res, 'ranked-2v2', 60, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only manage your own ranked duo.' });
        }
        const slug = identity.admin ? playerName : identity.name;
        res.setHeader('Cache-Control', 'private, no-store');

        const respond = async (extra: Record<string, unknown> = {}) => {
            const status = await ranked2v2Status(slug);
            return res.status(200).json({
                ...extra,
                duo: status.duo,
                queue: status.queue,
                match: status.match ? projectTowerPvpMatchForViewer(status.match, slug) : null,
            });
        };

        if (action === 'status') return respond();

        if (action === 'invite') {
            const target = safeName(String(body.target ?? ''));
            const invited = await inviteRanked2v2Partner({ actor: slug, target });
            if (!invited.ok) return res.status(invited.status).json({ error: invited.error, errorCode: invited.code });
            return respond();
        }

        if (action === 'accept') {
            const accepted = await acceptRanked2v2Invite(slug);
            if (!accepted.ok) return res.status(accepted.status).json({ error: accepted.error, errorCode: accepted.code });
            return respond();
        }

        if (action === 'leave') {
            await leaveRanked2v2Duo(slug);
            return respond();
        }

        if (action === 'queue') {
            const queued = await queueRanked2v2(slug);
            if (!queued.ok) return res.status(queued.status).json({ error: queued.error, errorCode: queued.code });
            return respond();
        }

        if (action === 'unqueue') {
            await unqueueRanked2v2(slug);
            return respond();
        }

        if (action === 'settle') {
            const status = await ranked2v2Status(slug);
            const matchId = status.match?.matchId;
            if (!matchId) return res.status(404).json({ error: 'No ranked match to settle.', errorCode: 'match-not-found' });
            // Drive the shared lifecycle first so a walked-away duel still
            // reaches a terminal state through the AFK/ready expiry rules.
            const live = await towerPvpState(matchId, slug);
            if (!live.ok) return res.status(live.status).json({ error: live.error, errorCode: live.code });
            if (live.match.status !== 'done' && live.match.status !== 'cancelled') {
                return res.status(409).json({ error: 'That match has not ended.', errorCode: 'match-active' });
            }
            // Acknowledge on the match (writes no rating), then move the ladder.
            await settleTowerPvpMatch(matchId, slug);
            const lines = await settleRanked2v2Match(live.match);
            const settled = await readTowerPvpMatch(matchId);
            const mine = (lines ?? []).find(line => line.slug === slug) ?? null;
            return res.status(200).json({
                settled: true,
                rating: lines ?? [],
                mine,
                // Echo the caller's committed version so their client adopts the
                // new rating instead of racing a stale local save.
                ...(mine?.saveVersion ? { _saveVersion: mine.saveVersion } : {}),
                duo: (await ranked2v2Status(slug)).duo,
                match: settled ? projectTowerPvpMatchForViewer(settled, slug) : null,
            });
        }

        return res.status(400).json({ error: 'Unknown ranked 2v2 action.', errorCode: 'unknown-action' });
    } catch (error) {
        if (error instanceof LockContendedError) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ error: 'Ranked 2v2 state is busy. Retry this request.', errorCode: 'ranked-2v2-busy' });
        }
        console.error('[pvp/ranked-2v2]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
