import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors, safeName } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimit } from '../../_ratelimit.js';
import { LockContendedError } from '../../_lock.js';
import { projectTowerPvpMatchForViewer } from '../../towers/_pvp-session.js';
import { settleTowerPvpMatch, towerPvpState } from '../../towers/_pvp-lifecycle.js';
import { readClanWar2v2Match, startClanWar2v2Match } from './_mpvp.js';
import { settleClanWar2v2Match } from './_mpvp-settlement.js';

/*
 * POST /api/clan/war/pvp-2v2 — the clan-war-owned half of shinobi 2v2.
 *
 * The fight itself deliberately reuses the shared Tower MPvP surfaces:
 *   /api/towers/pvp-state   poll + reconnect
 *   /api/towers/pvp-action  one idempotent combat command
 * Those are one reducer and one projection for both surfaces, member-gated by
 * the sealed roster, so there is no second combat implementation to drift.
 *
 * Only the two ends differ, and both live here:
 *   { action: 'start',  warId, challengeId }  → publish/resolve the match
 *   { action: 'settle', challengeId }         → apply the war HP exactly once
 *
 * `settle` is what makes this mode reward-bearing, so it is the only route that
 * may write it — /api/towers/pvp-settle refuses a clan-war match outright.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const action = String(body.action ?? '');
        const challengeId = String(body.challengeId ?? '');
        if (!playerName || !challengeId) {
            return res.status(400).json({ error: 'Valid player and challenge are required.' });
        }
        if (!enforceRateLimit(req, res, 'clan-war-2v2', 40, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only act as your own shinobi.' });
        }
        const slug = identity.admin ? playerName : identity.name;
        res.setHeader('Cache-Control', 'private, no-store');

        if (action === 'start') {
            const warId = String(body.warId ?? '');
            if (!warId) return res.status(400).json({ error: 'A valid war is required.' });
            const started = await startClanWar2v2Match({ warId, challengeId, actor: slug });
            if (!started.ok) {
                return res.status(started.status).json({ error: started.error, errorCode: started.code });
            }
            // Route the response through the same viewer projection the public
            // queue uses, so violet never receives the amber authority frame.
            return res.status(200).json({
                replayed: started.replayed,
                match: projectTowerPvpMatchForViewer(started.match, slug),
            });
        }

        if (action === 'settle') {
            const published = await readClanWar2v2Match(challengeId);
            if (!published) return res.status(404).json({ error: 'That Clan War duel was not found.', errorCode: 'match-not-found' });
            if (!published.roster.some(member => member.slug === slug)) {
                return res.status(403).json({ error: 'You are not in that Clan War duel.', errorCode: 'not-a-member' });
            }
            // Drive the shared lifecycle first: it applies any pending AFK/ready
            // expiry so a walked-away duel still reaches a terminal state.
            const state = await towerPvpState(published.matchId, slug);
            if (!state.ok) {
                return res.status(state.status).json({ error: state.error, errorCode: state.code });
            }
            if (state.match.status !== 'done' && state.match.status !== 'cancelled') {
                return res.status(409).json({ error: 'That duel has not ended.', errorCode: 'match-active' });
            }
            // Acknowledge on the match first (no reward), then apply the war HP.
            // Ordering matters only for tidiness: the war side is receipt-guarded
            // and idempotent, so a crash between the two replays cleanly.
            await settleTowerPvpMatch(state.match.matchId, slug);
            const settlement = await settleClanWar2v2Match(state.match);
            return res.status(200).json({
                settled: true,
                settlement,
                match: projectTowerPvpMatchForViewer(state.match, slug),
            });
        }

        return res.status(400).json({ error: 'Unknown Clan War 2v2 action.', errorCode: 'unknown-action' });
    } catch (error) {
        if (error instanceof LockContendedError) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ error: 'Clan War 2v2 state is busy. Retry this request.', errorCode: 'clan-war-2v2-busy' });
        }
        console.error('[clan/war/pvp-2v2]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
