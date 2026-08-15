import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import {
    isRankedPetMatchToken,
    isRankedPetSettlementIntent,
    petRankedSettlementIntentKey,
    type RankedPetMatchToken,
} from './_ranked-authority.js';
import { resolveRankedPetDuel } from './_ranked-duel.js';

/*
 * /api/pet/ranked-watch — POST { matchToken }
 *
 * Hands a ranked pet match's two participants the event log of the fight the
 * SERVER rated, so the screen plays the rated fight instead of simulating its
 * own. This is the whole point: the ranked duel used to be resolved twice, by
 * two different engines over two different seeds — the client's cinematic and
 * the server's rating had no reliable relationship, and a watched victory could
 * be recorded as a loss.
 *
 * Nothing is stored. The script is RE-DERIVED from the sealed match token by
 * the same pure resolveRankedPetDuel that battle-result rates with (the replay
 * doctrine this repo uses everywhere: store inputs, not fights). Two calls
 * return byte-identical logs, and the log a player watches is the log that
 * moved their Elo.
 *
 * AUTHORITY. This is a READ of a fight already decided at token mint — watching
 * it settles nothing, grants nothing, and cannot change the verdict. The gate is
 * therefore only "are you in this match": the caller must be `a` or `b` on the
 * token. A settled match still answers, because the loser deserves to see the
 * fight they lost, and both participants routinely ask after settlement.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        // Resolution is CPU work (a full headless match), so the limit is the
        // real defence here — not the storage read.
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-ranked-watch', 20, 60_000, identity.name))) return;

        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const raw = typeof body.matchToken === 'string' ? body.matchToken.trim() : '';
        const matchToken = /^[0-9a-f-]{36}$/i.test(raw) ? raw : '';
        if (!matchToken) return res.status(400).json({ error: 'A valid ranked match token is required.' });

        /*
         * Two places hold the sealed inputs, and BOTH are needed.
         *
         * The live proof is retired as soon as the first participant settles, so
         * a watcher reading only that would lose the fight the moment their
         * opponent reported first — a race the loser would hit routinely, since
         * they are usually the one still watching. The settlement intent carries
         * the same token and survives until BOTH sides have settled, so it is
         * the fallback rather than a second authority: same bytes, longer life.
         */
        const [stored, intent] = await Promise.all([
            kv.get<unknown>(`pet:ranked-token:${matchToken}`),
            kv.get<unknown>(petRankedSettlementIntentKey(matchToken)),
        ]);
        const token: RankedPetMatchToken | null = isRankedPetMatchToken(stored)
            ? stored
            : isRankedPetSettlementIntent(intent) && intent.matchToken === matchToken
                ? intent.token
                : null;
        if (!token) return res.status(404).json({ error: 'That ranked pet match is no longer available to watch.' });
        if (!identity.admin && token.a !== identity.name && token.b !== identity.name) {
            return res.status(403).json({ error: 'That ranked match does not name you.' });
        }

        const { winnerName, script } = resolveRankedPetDuel(token);
        return res.status(200).json({
            ok: true,
            script,
            // Named, not sided: the client decides what "you" means from its own
            // account name, and the two participants must never be handed
            // different answers about who won.
            winnerName,
        });
    } catch (error) {
        console.error('[pet/ranked-watch]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
