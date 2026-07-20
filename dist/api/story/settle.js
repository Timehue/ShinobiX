"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _lock_js_1 = require("../_lock.js");
const _ai_fight_token_js_1 = require("../missions/_ai-fight-token.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _tower_store_js_1 = require("../towers/_tower-store.js");
const _release_flags_js_1 = require("../_release-flags.js");
const _settle_js_1 = require("./_settle.js");
const _authoritative_story_combat_js_1 = require("./_authoritative-story-combat.js");
/*
 * /api/story/settle — POST only.
 *
 * Two channels, mutually exclusive per battle kind:
 * - storyBoss (authoritative): body.runId references a completed, WINNING,
 *   player-bound Tower session minted by /api/story/boss-start. The server's
 *   recorded outcome and surviving HP drive the settlement — the client
 *   attests nothing. Legacy aiFightToken settles for storyBoss are rejected
 *   unless ENABLE_CLIENT_TRUSTED_STORY_BOSS=1 (rollback switch only).
 * - academySparring (legacy, deliberate): the capped tutorial spar keeps the
 *   mint-at-start AiFightToken + client survivingHp path.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const runId = /^[A-Za-z0-9-]{8,96}$/.test(String(body.runId ?? '')) ? String(body.runId) : '';
        const token = (0, _ai_fight_token_js_1.cleanAiFightToken)(body.aiFightToken ?? body.token);
        if (!playerName || (!token && !runId))
            return res.status(400).json({ error: 'Player name and battle token are required.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only settle your own story battle.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'story-settle', 12, 60_000, identity.name)))
            return;
        const isSpar = body.kind === 'academySparring';
        // ── Authoritative channel: completed server session referenced by runId ──
        if (!isSpar && runId) {
            const bindingKey = (0, _authoritative_story_combat_js_1.storyCombatBindingKey)(runId);
            const outcome = await (0, _lock_js_1.withKvLock)(bindingKey, async () => {
                const binding = await _storage_js_1.kv.get(bindingKey);
                const session = await (0, _tower_store_js_1.readSession)(runId);
                // Replays return the recorded settlement instead of an error so a
                // refresh on the results screen stays idempotent (mirrors the
                // token path's redeemedStoryBattles behavior).
                const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, async ({ character }) => {
                    const redeemed = Array.isArray(character.redeemedStoryBattles)
                        ? character.redeemedStoryBattles.filter((entry) => !!entry && typeof entry === 'object' && typeof entry.token === 'string')
                        : [];
                    const redemptionKey = `run:${runId}`;
                    const prior = redeemed.find((entry) => entry.token === redemptionKey);
                    if (prior)
                        return { ok: true, character, value: { ...prior, replayed: true } };
                    const validation = (0, _authoritative_story_combat_js_1.validateCompletedStoryCombatSession)({ binding, session, playerName, character });
                    if (!validation.ok)
                        return { ok: false, status: 409, error: `Story battle could not be verified (${validation.reason}).` };
                    const survivingHp = (0, _authoritative_story_combat_js_1.storySessionSurvivingHp)(session, playerName);
                    // applyStoryBossSettlement re-derives the milestone from the
                    // save and only reads opponentId off the token argument — the
                    // sealed binding provides it, so milestone drift still 409s.
                    const settled = (0, _settle_js_1.applyStoryBossSettlement)(character, { opponentId: validation.binding.opponentId }, survivingHp);
                    if (!settled.ok)
                        return settled;
                    const redemption = { token: redemptionKey, progress: settled.progress, xp: settled.xp, ryo: settled.ryo, auraDust: settled.auraDust, finale: settled.finale };
                    return {
                        ok: true,
                        character: { ...settled.character, redeemedStoryBattles: [...redeemed.slice(-19), redemption] },
                        value: { ...redemption, replayed: false, title: settled.title },
                    };
                });
                if (result.ok && !result.value.replayed && binding) {
                    // The battle engine, not the client, recorded item uses —
                    // deduct through the same per-run receipt path as missions.
                    await (0, _tower_store_js_1.settleConsumedItemsForMember)({ session: session, slug: playerName });
                    await _storage_js_1.kv.set(bindingKey, (0, _authoritative_story_combat_js_1.settleStoryCombatBinding)(binding), { ex: _authoritative_story_combat_js_1.STORY_COMBAT_SESSION_TTL_SECONDS });
                }
                return result;
            }, { failClosed: true });
            if (!outcome.ok)
                return res.status(outcome.status).json({ error: outcome.error });
            return res.status(200).json({ ok: true, ...outcome.value, character: outcome.character, _saveVersion: outcome._saveVersion });
        }
        // ── Legacy token channel ──
        if (!token)
            return res.status(400).json({ error: 'Player name and battle token are required.' });
        if (!isSpar && !(0, _release_flags_js_1.clientTrustedStoryBossAllowed)()) {
            return res.status(409).json({ error: 'This story battle must be fought on the server. Reload the game and retry from the Story Hall.', reason: _release_flags_js_1.STORY_BOSS_CLIENT_TRUST_DISABLED_REASON });
        }
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, async ({ character }) => {
            const redeemed = Array.isArray(character.redeemedStoryBattles)
                ? character.redeemedStoryBattles.filter((entry) => !!entry && typeof entry === 'object' && typeof entry.token === 'string')
                : [];
            const prior = redeemed.find((entry) => entry.token === token);
            if (prior)
                return { ok: true, character, value: { ...prior, replayed: true } };
            const tokenData = await _storage_js_1.kv.get((0, _ai_fight_token_js_1.aiFightTokenKey)(playerName, token));
            if (!tokenData)
                return { ok: false, status: 409, error: 'Story battle token is invalid or already spent.' };
            if ((tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase())
                return { ok: false, status: 403, error: 'Battle token belongs to another player.' };
            const settled = isSpar
                ? (0, _settle_js_1.applyAcademySparSettlement)(character, tokenData)
                : (0, _settle_js_1.applyStoryBossSettlement)(character, tokenData, body.survivingHp);
            if (!settled.ok)
                return settled;
            const redemption = { token, progress: settled.progress, xp: settled.xp, ryo: settled.ryo, auraDust: settled.auraDust, finale: settled.finale };
            return {
                ok: true,
                character: { ...settled.character, redeemedStoryBattles: [...redeemed.slice(-19), redemption] },
                value: { ...redemption, replayed: false, title: settled.title },
            };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        await _storage_js_1.kv.del((0, _ai_fight_token_js_1.aiFightTokenKey)(playerName, token)).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (err) {
        console.error('[story/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
