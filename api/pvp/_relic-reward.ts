import { pvpSessionMayGrantProgress, pvpSessionMayReward, type PvpSession } from './session.js';
import { hasRecentIpOrFpOverlapStrict } from '../_player-ips.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyEarnedRelicRoll, relicRewardRoll, relicDropPool } from '../_relic-rewards.js';
import { safeName } from '../_utils.js';

/** Matchmade player-ranked wins only. Reuse the ladder's real-player and
 * same-device guards; pets, spars, AI, draws and cancelled matches never roll. */
export async function settleRankedRelicReward(session: PvpSession): Promise<void> {
    if (session.status !== 'done' || !session.ranked || session.rankedKind !== 'player'
        || session.rewardAuthority !== 'ranked' || !pvpSessionMayReward(session) || !pvpSessionMayGrantProgress(session)
        || (session.winner !== 'p1' && session.winner !== 'p2')) return;
    const winner = session.winner === 'p1' ? session.p1 : session.p2;
    const loser = session.winner === 'p1' ? session.p2 : session.p1;
    const player = safeName(winner.name);
    const opponent = safeName(loser.name);
    if (!player || !opponent || player === opponent || !relicDropPool('pvp', Number(winner.character?.level)).length) return;
    if (await hasRecentIpOrFpOverlapStrict(player, opponent)) return;
    const proof = { kind: 'pvp' as const, id: session.battleId, eventAt: Number(session.endedAt ?? session.lastMoveAt),
        level: Number(winner.character?.level), opponent };
    const result = await mutatePlayerSave(player, ({ character }) => {
        const reward = applyEarnedRelicRoll(character, proof, relicRewardRoll(proof, player));
        return { ok: true, character: reward.character, value: reward.outcome, write: reward.changed };
    });
    if (!result.ok) throw new Error(`ranked-relic-settlement:${result.error}`);
}
