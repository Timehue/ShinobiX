/*
 * POST /api/card-clash/claim-starter — the Chronicle Scribe's traveler's codex.
 *
 * Server-authoritative one-time claim (choose-starter pattern): authed player,
 * locked mutatePlayerSave, sealed grant list (CHRONICLE_STARTER_GRANT_IDS —
 * never client-supplied), boolean latch on the save. See ./_starter-cards.ts.
 */
import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { claimStarterCards } from './_starter-cards.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your codex.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'chronicle-claim-starter', 5, 60_000, identity.name))) return;
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const claim = claimStarterCards(character);
            if (!claim.ok) return { ok: false as const, status: 409, error: claim.reason };
            return {
                ok: true as const,
                character: claim.character,
                value: {
                    granted: claim.granted,
                    starterGranted: claim.starterGranted,
                    progressionGranted: claim.progressionGranted,
                    replayed: claim.replayed,
                },
                // A response-lost retry returns the current authoritative codex
                // without rewriting an identical save. Older claimed accounts
                // missing a starter/progression record are repaired here too.
                write: !claim.replayed || claim.granted.length > 0,
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({
            ok: true,
            granted: result.value.granted,
            starterGranted: result.value.starterGranted,
            progressionGranted: result.value.progressionGranted,
            replayed: result.value.replayed,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    } catch (error) {
        console.error('[card-clash/claim-starter]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
