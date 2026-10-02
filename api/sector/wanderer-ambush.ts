import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict } from '../save/_projected-write.js';
import { rollAmbushReward, ambushCleared, AMBUSH_REWARDS_PER_DAY } from './_wanderer-ambush.js';
import { bumpLegacyStats } from '../_legacy-track.js';
import { bumpEraContributionOnce } from '../_era.js';
import { cleanWorldAiPendingOutcome } from '../missions/_world-ai-fight.js';

/*
 * /api/sector/wanderer-ambush — POST { action: 'start' | 'claim', playerName }
 *
 * Boss reward for clearing a sector-wanderer ambush. Server-authoritative:
 *   start → seal baseline foe-kills in KV (1h TTL)
 *   claim → verify the player won AMBUSH_KILLS_REQUIRED more fights since (cleared
 *           the gauntlet), roll the reward server-side, grant under the save lock,
 *           consume the token. Daily-capped.
 * The reward is recomputed/rolled here, never trusted from the client.
 */

const TOKEN_TTL_SECONDS = 60 * 60;
const tokenKeyFor = (player: string) => `wanderer-ambush:${player}`;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const utcDateKey = () => new Date().toISOString().slice(0, 10);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `wanderer-ambush-${action}`, 20, 60_000, identity.name))) return;

        const tokenKey = tokenKeyFor(playerName);

        // ── START: seal the foe-kill baseline ─────────────────────────────────
        if (action === 'start') {
            // New runs are sealed by the World AI chain. Baseline-only tokens
            // allowed unrelated fights to impersonate the four-wave ambush.
            return res.status(200).json({ ok: false, reason: 'sealed-combat-required' });
        }

        // ── CLAIM: verify the gauntlet was cleared, then pay ──────────────────
        if (action === 'claim') {
            const today = utcDateKey();
            let legacyReceiptId = '';

            type Reply = Record<string, unknown>;
            const committed = await mutatePlayerSave<Reply>(playerName, async ({ character: char }) => {
                const answer = (body: Reply) => ({ ok: true as const, write: false, character: char, value: body });
                const receipts = Array.isArray(char.redeemedWandererAmbushes) ? char.redeemedWandererAmbushes as Array<Record<string, unknown>> : [];
                const pending = cleanWorldAiPendingOutcome(char.worldAiPendingOutcome);
                const fresh = await kv.get<{ baseline: number; at?: number; authority?: string; chainId?: string; kind?: string; sourceId?: string; sector?: number }>(tokenKey);
                if (!pending && !fresh) {
                    const priorWorld = [...receipts].reverse().find((entry) => entry.source === 'world-ai-chain');
                    if (!priorWorld) return answer({ ok: false, reason: 'none' });
                    legacyReceiptId = String(priorWorld.id ?? '');
                    return answer({ ok: true, replayed: true, reward: priorWorld.reward, totals: { ryo: num(char.ryo), fateShards: num(char.fateShards), boneCharms: num(char.boneCharms) } });
                }
                const receiptId = pending ? `world:${pending.claimId}` : `${fresh!.baseline}:${Number(fresh!.at ?? 0)}`;
                legacyReceiptId = receiptId;
                const prior = receipts.find((entry) => entry.id === receiptId);
                if (prior) {
                    await kv.del(tokenKey).catch(() => undefined);
                    if (pending) {
                        // A save paid before the pending outcome was cleared on
                        // claim still carries it, so every resume probe offered the
                        // paid ambush again. Clear it now; the payout stays as is.
                        return {
                            ok: true,
                            character: { ...char, worldAiPendingOutcome: null },
                            value: { ok: true, replayed: true, reward: prior.reward, totals: { ryo: num(char.ryo), fateShards: num(char.fateShards), boneCharms: num(char.boneCharms) } },
                        };
                    }
                    return answer({ ok: true, replayed: true, reward: prior.reward, totals: { ryo: num(char.ryo), fateShards: num(char.fateShards), boneCharms: num(char.boneCharms) } });
                }

                const chainWins = Array.isArray(char.worldAiChainWins) ? char.worldAiChainWins as Array<Record<string, unknown>> : [];
                const authoritative = pending ?? fresh;
                const hasSealedWorldChain = (pending != null || fresh?.authority === 'world-ai-chain')
                    && typeof authoritative?.chainId === 'string'
                    && (pending ? pending.sourceId : fresh?.kind) === 'wanderer-ambush'
                    && (pending ? pending.sourceId : fresh?.sourceId) === 'wanderer-ambush'
                    && Number.isInteger(authoritative?.sector)
                    && [0, 1, 2, 3].every((stage) => chainWins.some((entry) => entry.chainId === authoritative?.chainId
                        && entry.kind === 'wanderer-ambush'
                        && entry.sourceId === 'wanderer-ambush'
                        && Number(entry.sector) === authoritative?.sector
                        && Number(entry.stage) === stage));
                // New WorldMap encounters require the exact sealed four-wave
                // chain. The baseline-only branch remains solely for an already
                // issued pre-migration token during its one-hour rollout TTL.
                const verified = pending || fresh?.authority === 'world-ai-chain'
                    ? hasSealedWorldChain
                    : ambushCleared(num(fresh?.baseline), num(char.totalAiKills));
                if (!verified) {
                    return answer({ ok: false, reason: 'incomplete' });
                }

                // The in-save receipt below is the single-use gate: it commits
                // with the payout, and a replay finds it above. The legacy token
                // is burned only after that commit, still under the save lock.
                const claimedSoFar = char.wandererAmbushRewardDate === today ? Math.max(0, num(char.wandererAmbushRewardCount)) : 0;
                if (claimedSoFar >= AMBUSH_REWARDS_PER_DAY) {
                    return answer({ ok: false, reason: 'daily-cap' });
                }

                const reward = rollAmbushReward(num(char.level) || 1, Math.random);
                const updated = {
                    ...char,
                    // Null, not an omitted key: the save write deep-merges over the
                    // stored record, so a dropped key would keep the paid outcome
                    // and the resume probe would offer this claim again.
                    worldAiPendingOutcome: null,
                    ryo: num(char.ryo) + reward.ryo,
                    fateShards: num(char.fateShards) + reward.fateShards,
                    boneCharms: num(char.boneCharms) + reward.boneCharms,
                    wandererAmbushRewardDate: today,
                    wandererAmbushRewardCount: claimedSoFar + 1,
                    redeemedWandererAmbushes: [...receipts.slice(-49), { id: receiptId, source: pending ? 'world-ai-chain' : 'legacy', claimId: pending?.claimId, reward }],
                };
                return {
                    ok: true,
                    character: updated,
                    value: {
                        ok: true,
                        reward,
                        totals: { ryo: updated.ryo, fateShards: updated.fateShards, boneCharms: updated.boneCharms },
                    },
                    afterCommit: () => kv.del(tokenKey).then(() => undefined, () => undefined),
                };
            });
            if (!committed.ok) {
                if (committed.status === 404) return res.status(404).json({ error: 'Your save was not found.' });
                return res.status(committed.status).json({ error: committed.error });
            }
            // Every paid or replayed claim answers with the save it reflects.
            const out = { status: 200, body: committed.value };
            if (committed.value.ok === true) {
                committed.value.character = committed.character;
                committed.value._saveVersion = committed._saveVersion;
            }

            // Legacy tracking (ENABLE_LEGACY): a cleared ambush gauntlet is a
            // hidden find + an elite takedown (the warlord boss).
            if (out.status === 200 && (out.body as { ok?: boolean })?.ok === true && legacyReceiptId) {
                const receiptId = `wanderer-ambush:${legacyReceiptId}`;
                const delivered = await bumpLegacyStats(
                    playerName,
                    { hiddenFinds: 1, eliteKills: 1 },
                    {
                        receiptId,
                        characterForBootstrap: (out.body as { character?: Record<string, unknown> }).character ?? null,
                    },
                );
                if (!delivered) {
                    return res.status(503).json({
                        error: 'The ambush reward is safe, but its Legacy record is still being sealed. Retry the same claim.',
                        code: 'legacy-delivery-pending',
                        retryable: true,
                    });
                }
                await bumpEraContributionOnce('discoveries', receiptId);
            }
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError || isPlayerSaveVersionConflict(err)) {
            return res.status(503).json({ error: 'Could not grant the reward — please retry.' });
        }
        console.error('[sector/wanderer-ambush]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
