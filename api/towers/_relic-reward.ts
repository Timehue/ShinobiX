import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyEarnedRelicRoll, relicRewardRoll, type RelicRollOutcome } from '../_relic-rewards.js';
import { isPublicTowerRun } from './_tower-store.js';
import type { TowerSession } from './_tower-session.js';

/** A separate capped roll on repeat clears; first-clear progression stays once-only. */
export async function settleTowerRelicReward(session: TowerSession, slug: string): Promise<RelicRollOutcome> {
    const actor = session.actors.find(candidate => candidate.side === 'squad' && candidate.ownerSlug === slug && !candidate.ai);
    if (!actor || session.status !== 'done' || session.winner !== 'squad' || !isPublicTowerRun(session)
        || session.floor < 10 || Number(actor.character.level) < 70) return { reason: 'ineligible' };
    const proof = { kind: 'tower' as const, id: session.runId, eventAt: Number(session.lastActionAt),
        level: Number(actor.character.level), floor: session.floor };
    const result = await mutatePlayerSave(slug, ({ character }) => {
        const reward = applyEarnedRelicRoll(character, proof, relicRewardRoll(proof, slug));
        return { ok: true, character: reward.character, value: reward.outcome, write: reward.changed };
    });
    if (!result.ok) throw new Error(`tower-relic-settlement:${result.error}`);
    return result.value;
}
