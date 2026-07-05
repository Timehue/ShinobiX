import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import {
    readSession,
    settleFloorForMember,
    settleAssistForAlly,
    settleSpireForMember,
    settleConsumedItemsForMember,
    isSpireRun,
    type SettleResult,
    type ConsumedItemsResult,
} from './_tower-store.js';

/*
 * POST /api/towers/settle — pay out a cleared floor to every squad member.
 *
 * Fully server-authoritative + idempotent: settleFloorForMember / settleAssistForAlly each
 * re-verify the session (status 'done' + squad win), resolve the floor from the catalog by
 * id, compute the score, and credit at most once (NX receipts + the permanent first-clear
 * gate). Safe to call repeatedly. Live human members get the full first-clear reward;
 * borrowed AI allies get the capped, daily-bounded assist. Body: { runId, playerName }.
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
        if (!enforceRateLimit(req, res, 'towers-settle', 30, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });

        const session = await readSession(runId);
        if (!session) return res.status(404).json({ error: 'Run not found.' });

        const callerSlug = identity.admin ? null : identity.name;
        const isMember = identity.admin || session.actors.some(a => a.side === 'squad' && a.ownerSlug === callerSlug);
        if (!isMember) return res.status(403).json({ error: 'Not a member of this run.' });

        // Endless Spire runs settle through the weekly spire channel (best-tier-per-week); the
        // 10 story floors keep the one-time first-clear channel. All spire members are live humans.
        const spire = isSpireRun(session);
        const results: Record<string, SettleResult> = {};
        const consumables: Record<string, ConsumedItemsResult> = {};
        for (const a of session.actors.filter(x => x.side === 'squad')) {
            const slug = a.ownerSlug;
            if (!slug) continue;
            consumables[slug] = await settleConsumedItemsForMember({ session, slug });
            results[slug] = spire
                ? await settleSpireForMember({ session, slug })
                : a.ai
                    ? await settleAssistForAlly({ session, slug })
                    : await settleFloorForMember({ session, slug });
        }
        return res.status(200).json({ runId, winner: session.winner, results, consumables });
    } catch (err) {
        console.error('[towers/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
