import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { aiFightTokenKey, cleanAiFightToken, type AiFightToken } from '../missions/_ai-fight-token.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { readSession, settleConsumedItemsForMember } from '../towers/_tower-store.js';
import {
    clientTrustedStoryBossAllowed,
    STORY_BOSS_CLIENT_TRUST_DISABLED_REASON,
} from '../_release-flags.js';
import { applyAcademySparSettlement, applyStoryBossSettlement } from './_settle.js';
import {
    settleStoryCombatBinding,
    storyCombatBindingKey,
    storySessionSurvivingHp,
    validateCompletedStoryCombatSession,
    STORY_COMBAT_SESSION_TTL_SECONDS,
    type StoryCombatBinding,
} from './_authoritative-story-combat.js';

type StoryRedemption = { token: string; progress: number; xp: number; ryo: number; auraDust: number; finale: boolean };

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
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const runId = /^[A-Za-z0-9-]{8,96}$/.test(String(body.runId ?? '')) ? String(body.runId) : '';
        const token = cleanAiFightToken(body.aiFightToken ?? body.token);
        if (!playerName || (!token && !runId)) return res.status(400).json({ error: 'Player name and battle token are required.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only settle your own story battle.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'story-settle', 12, 60_000, identity.name))) return;

        const isSpar = body.kind === 'academySparring';

        // ── Authoritative channel: completed server session referenced by runId ──
        if (!isSpar && runId) {
            const bindingKey = storyCombatBindingKey(runId);
            const outcome = await withKvLock(bindingKey, async () => {
                const binding = await kv.get<StoryCombatBinding>(bindingKey);
                const session = await readSession(runId);
                // Replays return the recorded settlement instead of an error so a
                // refresh on the results screen stays idempotent (mirrors the
                // token path's redeemedStoryBattles behavior).
                const result = await mutatePlayerSave(playerName, async ({ character }) => {
                    const redeemed = Array.isArray(character.redeemedStoryBattles)
                        ? (character.redeemedStoryBattles as unknown[]).filter((entry): entry is StoryRedemption => !!entry && typeof entry === 'object' && typeof (entry as StoryRedemption).token === 'string')
                        : [];
                    const redemptionKey = `run:${runId}`;
                    const prior = redeemed.find((entry) => entry.token === redemptionKey);
                    if (prior) return { ok: true as const, character, value: { ...prior, replayed: true } };
                    const validation = validateCompletedStoryCombatSession({ binding, session, playerName, character });
                    if (!validation.ok) return { ok: false as const, status: 409, error: `Story battle could not be verified (${validation.reason}).` };
                    const survivingHp = storySessionSurvivingHp(session!, playerName);
                    // applyStoryBossSettlement re-derives the milestone from the
                    // save and only reads opponentId off the token argument — the
                    // sealed binding provides it, so milestone drift still 409s.
                    const settled = applyStoryBossSettlement(character, { opponentId: validation.binding.opponentId } as AiFightToken, survivingHp);
                    if (!settled.ok) return settled;
                    const redemption: StoryRedemption = { token: redemptionKey, progress: settled.progress, xp: settled.xp, ryo: settled.ryo, auraDust: settled.auraDust, finale: settled.finale };
                    return {
                        ok: true as const,
                        character: { ...settled.character, redeemedStoryBattles: [...redeemed.slice(-19), redemption] },
                        value: { ...redemption, replayed: false, title: settled.title },
                    };
                });
                if (result.ok && !(result.value as { replayed?: boolean }).replayed && binding) {
                    // The battle engine, not the client, recorded item uses —
                    // deduct through the same per-run receipt path as missions.
                    await settleConsumedItemsForMember({ session: session!, slug: playerName });
                    await kv.set(bindingKey, settleStoryCombatBinding(binding), { ex: STORY_COMBAT_SESSION_TTL_SECONDS });
                }
                return result;
            }, { failClosed: true });
            if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
            return res.status(200).json({ ok: true, ...outcome.value, character: outcome.character, _saveVersion: outcome._saveVersion });
        }

        // ── Legacy token channel ──
        if (!token) return res.status(400).json({ error: 'Player name and battle token are required.' });
        if (!isSpar && !clientTrustedStoryBossAllowed()) {
            return res.status(409).json({ error: 'This story battle must be fought on the server. Reload the game and retry from the Story Hall.', reason: STORY_BOSS_CLIENT_TRUST_DISABLED_REASON });
        }
        const result = await mutatePlayerSave(playerName, async ({ character }) => {
            const redeemed = Array.isArray(character.redeemedStoryBattles)
                ? (character.redeemedStoryBattles as unknown[]).filter((entry): entry is StoryRedemption => !!entry && typeof entry === 'object' && typeof (entry as StoryRedemption).token === 'string')
                : [];
            const prior = redeemed.find((entry) => entry.token === token);
            if (prior) return { ok: true as const, character, value: { ...prior, replayed: true } };
            const tokenData = await kv.get<AiFightToken>(aiFightTokenKey(playerName, token));
            if (!tokenData) return { ok: false as const, status: 409, error: 'Story battle token is invalid or already spent.' };
            if ((tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) return { ok: false as const, status: 403, error: 'Battle token belongs to another player.' };
            const settled = isSpar
                ? applyAcademySparSettlement(character, tokenData)
                : applyStoryBossSettlement(character, tokenData, body.survivingHp);
            if (!settled.ok) return settled;
            const redemption: StoryRedemption = { token, progress: settled.progress, xp: settled.xp, ryo: settled.ryo, auraDust: settled.auraDust, finale: settled.finale };
            return {
                ok: true as const,
                character: { ...settled.character, redeemedStoryBattles: [...redeemed.slice(-19), redemption] },
                value: { ...redemption, replayed: false, title: settled.title },
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        await kv.del(aiFightTokenKey(playerName, token)).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (err) {
        console.error('[story/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
