"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _card_clash_engine_js_1 = require("../clan/war/_card-clash-engine.js");
const _card_catalog_js_1 = require("../clan/war/_card-catalog.js");
const _ai_reward_js_1 = require("./_ai-reward.js");
const _ai_engine_js_1 = require("./_ai-engine.js");
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
async function resolveDeck(deck, playerName) {
    const save = playerName ? await _storage_js_1.kv.get(`save:${(0, _utils_js_1.safeName)(playerName)}`) : null;
    const creatorBase = (0, _card_catalog_js_1.buildCreatorBaseMap)(save?.creatorCards);
    const out = [];
    for (const card of deck) {
        const canon = (0, _card_catalog_js_1.canonicalClashStats)(card.id, creatorBase);
        if (!canon)
            return { ok: false };
        out.push({ id: card.id, ...canon });
    }
    return { ok: true, deck: out };
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'You can only start your own AI card match.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'card-clash-ai-start', 30, 60_000, identity.name)))
            return;
        const validated = (0, _card_clash_engine_js_1.validateSubmittedDeck)(body.deck);
        if (!validated.ok)
            return res.status(400).json({ error: `Invalid deck: ${validated.error}` });
        const resolved = await resolveDeck(validated.deck, playerName);
        if (!resolved.ok)
            return res.status(400).json({ error: 'Deck contains an unknown card.' });
        const playerLevel = Math.max(1, Math.min(100, Math.floor(Number(body.playerLevel ?? 1))));
        const matchId = (0, node_crypto_1.randomUUID)();
        const session = (0, _ai_engine_js_1.createAiMatch)(matchId, playerName, resolved.deck, playerLevel, Date.now());
        await _storage_js_1.kv.set((0, _ai_reward_js_1.cardClashAiTokenKey)(matchId), session, { ex: _ai_reward_js_1.CARD_CLASH_AI_TOKEN_TTL_SECONDS });
        return res.status(200).json({ ok: true, matchId, session: (0, _ai_engine_js_1.projectAiMatch)(session) });
    }
    catch (err) {
        console.error('[card-clash/ai-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
