import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { readSoloPveSession, writeSoloPveSession } from '../solo-pve/_store.js';
import { applySoloPveUsageCosts, withSoloPveSettlementReceipt } from '../solo-pve/_settlement.js';
import { applyAcademySparSettlement, applyStoryBossSettlement } from './_settle.js';
import { validateCompletedAcademySparSession } from './_academy-spar.js';
import {
    settleStoryCombatBinding,
    storyCombatBindingKey,
    storySessionSurvivingHp,
    validateCompletedStoryCombatSession,
    STORY_COMBAT_SESSION_TTL_SECONDS,
    type StoryCombatBinding,
} from './_authoritative-story-combat.js';

type StoryRedemption = {
    token: string;
    progress: number;
    xp: number;
    ryo: number;
    auraDust: number;
    finale: boolean;
    statPoints?: number;
    title?: string;
};

function cleanRunId(raw: unknown): string {
    const runId = typeof raw === 'string' ? raw.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9:_-]{8,96}$/.test(runId) ? runId : '';
}

/* Settle a completed server-owned story boss or Academy spar. The request
 * carries identity, run id, and lane only; the solo-PvE session proves the win,
 * surviving HP, item use, companion use, and bound opponent. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const runId = cleanRunId(body.runId);
        const kind = body.kind === 'academySparring' ? 'academySparring' : body.kind === 'storyBoss' ? 'storyBoss' : '';
        if (!playerName || !runId || !kind) {
            return res.status(400).json({ error: 'Player name, run id, and story battle kind are required.' });
        }
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only settle your own story battle.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'story-settle', 12, 60_000, identity.name))) return;

        const outcome = await settleSealedStoryRun({
            runId,
            playerName,
            isSpar: kind === 'academySparring',
        });
        if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
        return res.status(200).json({
            ok: true,
            ...outcome.value,
            character: outcome.character,
            _saveVersion: outcome._saveVersion,
        });
    } catch (err) {
        console.error('[story/settle]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

async function settleSealedStoryRun(params: { runId: string; playerName: string; isSpar: boolean }) {
    const { runId, playerName, isSpar } = params;
    const bindingKey = storyCombatBindingKey(runId);
    return withKvLock(bindingKey, async () => {
        const binding = await kv.get<StoryCombatBinding>(bindingKey);
        const session = await readSoloPveSession(runId);
        const result = await mutatePlayerSave(playerName, async ({ character }) => {
            const redeemed = Array.isArray(character.redeemedStoryBattles)
                ? (character.redeemedStoryBattles as unknown[]).filter((entry): entry is StoryRedemption => (
                    !!entry && typeof entry === 'object' && typeof (entry as StoryRedemption).token === 'string'
                ))
                : [];
            const redemptionKey = `run:${runId}`;
            const prior = redeemed.find((entry) => entry.token === redemptionKey);
            if (prior) return { ok: true as const, character, value: { ...prior, replayed: true } };

            const validation = isSpar
                ? validateCompletedAcademySparSession({ binding, session, playerName, character })
                : validateCompletedStoryCombatSession({ binding, session, playerName, character });
            if (!validation.ok) {
                const label = isSpar ? 'Sparring match' : 'Story battle';
                return { ok: false as const, status: 409, error: `${label} could not be verified (${validation.reason}).` };
            }

            const chargedCharacter = applySoloPveUsageCosts(character, session!);
            const settled = isSpar
                ? applyAcademySparSettlement(chargedCharacter, { opponentId: validation.binding.opponentId })
                : applyStoryBossSettlement(
                    chargedCharacter,
                    { opponentId: validation.binding.opponentId },
                    storySessionSurvivingHp(session!, playerName),
                );
            if (!settled.ok) return settled;
            const redemption: StoryRedemption = {
                token: redemptionKey,
                progress: settled.progress,
                xp: settled.xp,
                statPoints: settled.statPoints,
                ryo: settled.ryo,
                auraDust: settled.auraDust,
                finale: settled.finale,
                ...(settled.title ? { title: settled.title } : {}),
            };
            return {
                ok: true as const,
                character: {
                    ...settled.character,
                    redeemedStoryBattles: [...redeemed.slice(-19), redemption],
                },
                value: { ...redemption, replayed: false },
            };
        });

        // Finalize both authority records after the save mutation. On a retry,
        // the redemption row above prevents rewards and costs from being applied
        // twice and this block repairs an interrupted metadata write.
        if (result.ok && binding && session && binding.playerName === playerName && session.ownerSlug === playerName) {
            if (session.settlementState !== 'settled') {
                await writeSoloPveSession(withSoloPveSettlementReceipt(session, {
                    kind: isSpar ? 'academy-spar' : 'story-boss',
                    id: runId,
                    settledAt: Date.now(),
                    rewards: {
                        progress: Number(result.value.progress) || 0,
                        statPoints: Number(result.value.statPoints) || 0,
                        ryo: Number(result.value.ryo) || 0,
                        auraDust: Number(result.value.auraDust) || 0,
                        finale: result.value.finale === true,
                    },
                }));
            }
            if (!binding.settledAt && binding.status === 'active') {
                await kv.set(
                    bindingKey,
                    settleStoryCombatBinding(binding),
                    { ex: STORY_COMBAT_SESSION_TTL_SECONDS },
                );
            }
        }
        return result;
    }, { failClosed: true });
}
