import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { validateSubmittedDeck, type ClashCard } from '../clan/war/_card-clash-engine.js';
import { canonicalClashStats, buildCreatorBaseMap } from '../clan/war/_card-catalog.js';
import {
    CARD_CLASH_AI_TOKEN_TTL_SECONDS,
    cardClashAiTokenKey,
} from './_ai-reward.js';
import { createAiMatch, projectAiMatch } from './_ai-engine.js';

/*
 * /api/card-clash/ai-start — POST only. Opens a SERVER-AUTHORITATIVE single-player
 * (vs AI) Shinobi Card Clash match.
 *
 * The match is now resolved on the server (see _ai-engine.ts + ai-move.ts): the
 * server owns the shuffled decks, the hidden AI hand, and every turn resolution,
 * so the winner — and the Ryo reward — is computed here, not asserted by the
 * client. This handler resolves the player's chosen deck (canonical stats, known
 * ids), generates the AI deck, deals, and stores the session under cc-ai:<id>.
 *
 * Deck posture: this is a fixed-reward PvE minigame (the payout is gated on the
 * server-verified OUTCOME, not the deck), so ownership is NOT required — but every
 * id must be a real card and its stats are overridden with the server's canonical
 * values (so a forged 1-cost/12-power card can't be fielded). This keeps the
 * "deal me in on a starter deck" path (buildPlayableDeck pads from the catalog)
 * working while blocking forged ids/stats.
 */

// Resolve a submitted deck to canonical server stats. Rejects unknown ids; does
// NOT require ownership (see header — PvE, outcome-gated reward).
async function resolveDeck(deck: ClashCard[], playerName: string): Promise<{ ok: true; deck: ClashCard[] } | { ok: false }> {
    const save = playerName ? await kv.get<Record<string, unknown>>(`save:${safeName(playerName)}`) : null;
    const creatorBase = buildCreatorBaseMap((save as Record<string, unknown> | null)?.creatorCards);
    const out: ClashCard[] = [];
    for (const card of deck) {
        const canon = canonicalClashStats(card.id, creatorBase);
        if (!canon) return { ok: false };
        out.push({ id: card.id, ...canon });
    }
    return { ok: true, deck: out };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'You can only start your own AI card match.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'card-clash-ai-start', 30, 60_000, identity.name))) return;

        const validated = validateSubmittedDeck(body.deck);
        if (!validated.ok) return res.status(400).json({ error: `Invalid deck: ${validated.error}` });
        const resolved = await resolveDeck(validated.deck, playerName);
        if (!resolved.ok) return res.status(400).json({ error: 'Deck contains an unknown card.' });

        const playerLevel = Math.max(1, Math.min(100, Math.floor(Number(body.playerLevel ?? 1))));
        const matchId = randomUUID();
        const session = createAiMatch(matchId, playerName, resolved.deck, playerLevel, Date.now());
        await kv.set(cardClashAiTokenKey(matchId), session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });

        return res.status(200).json({ ok: true, matchId, session: projectAiMatch(session) });
    } catch (err) {
        console.error('[card-clash/ai-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
