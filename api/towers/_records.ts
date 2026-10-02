import type { TowerRecords, TowerHonorId, TowerClearComparison } from '../../shared/tower-progression.js';
import type { TowerSession } from './_tower-session.js';
import { isPublicTowerRun, isSpireRun, type StoreDeps } from './_tower-store.js';
import { floorForSession } from './_session-floor.js';
import { clearMetrics, computeFloorClearScore } from './_tower-rewards.js';
import { towerRouteScoreMultiplier } from './_route-choice.js';
import { kv as realKv } from '../_storage.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict, retryOnSaveVersionConflict } from '../save/_projected-write.js';
import { recordEraCampaignEvidence } from '../_era-campaign.js';

export function towerRecordsForClear(previous: TowerRecords | undefined, session: TowerSession): TowerRecords {
    const result: TowerRecords = { bests: { ...(previous?.bests ?? {}) }, honors: { ...(previous?.honors ?? {}) } };
    const floor = floorForSession(session);
    if (!floor || session.status !== 'done' || session.winner !== 'squad' || (!isPublicTowerRun(session) && !isSpireRun(session))) return result;
    const mode = isSpireRun(session) ? 'spire' : 'story';
    const floorId = mode === 'spire' ? session.ascensionTier! : session.floor;
    const humans = session.actors.filter(a => a.side === 'squad' && !a.ai && a.ownerSlug).length;
    const partySize = Math.max(1, humans);
    const key = `${mode}:${floorId}:${partySize}:${session.routeChoice?.id ?? 'standard'}`;
    const old = result.bests[key];
    const score = Math.round(computeFloorClearScore(clearMetrics(session), floor) * towerRouteScoreMultiplier(session));
    const clean = Boolean(session.towerTactics && session.towerTactics.squadKnockouts.length === 0 && session.actors.filter(a => a.side === 'squad' && !a.character.companion).every(a => a.hp > 0));
    result.bests[key] = { mode, floor: floorId, partySize, bestScore: Math.max(old?.bestScore ?? 0, score), fastestRounds: Math.min(old?.fastestRounds ?? Infinity, Math.max(1, session.round)), noKnockout: clean || old?.noKnockout === true };
    const award = (id: TowerHonorId, qualifies: boolean) => { if (qualifies && !result.honors[id]) result.honors[id] = Math.max(1, session.createdAt); };
    award('tower-clean-clear', clean);
    award('tower-par-clear', session.round <= floor.roundBudget);
    award('tower-disrupt-clear', (session.towerTactics?.disruptedPylons.length ?? 0) > 0);
    award('tower-bait-clear', (session.towerTactics?.chargeBaits ?? 0) > 0);
    award('tower-dodge-clear', (session.towerTactics?.avoidedStrikes ?? 0) > 0);
    award('tower-elite-clear', session.routeChoice?.id === 'elite-shortcut');
    return result;
}

/** Monotonic records and achievement evidence; repeat clears update records without paying twice. */
export async function settleTowerRecords(session: TowerSession, slug: string, deps: StoreDeps = {}): Promise<TowerClearComparison | undefined> {
    if (session.status !== 'done' || session.winner !== 'squad' || (!isPublicTowerRun(session) && !isSpireRun(session)) || !session.actors.some(a => a.side === 'squad' && a.ai === false && a.ownerSlug === slug)) return;
    const entry = Object.entries(towerRecordsForClear(undefined, session).bests)[0];
    if (!entry) return;
    const kv = deps.kv ?? realKv;
    let out: PlayerSaveMutationResult<TowerClearComparison>;
    try {
        // Records only improve and the comparison is sealed before the write, so
        // a lost compare-and-set re-runs once against the fresh save.
        out = await retryOnSaveVersionConflict(() => mutatePlayerSave<TowerClearComparison>(slug, async ({ character }) => {
            const previous = character.battleTowerRecords as TowerRecords | undefined;
            const records = towerRecordsForClear(previous, session);
            const receiptKey = `tower-record-comparison:${session.runId}:${slug}`;
            let comparison = await kv.get<TowerClearComparison>(receiptKey);
            if (!comparison) {
                const [key, best] = entry;
                comparison = { runId: session.runId, key, score: best.bestScore, rounds: best.fastestRounds, clean: best.noKnockout,
                    ...(previous?.bests?.[key] ? { previous: previous.bests[key] } : {}) };
                // Seal the baseline before writing the save. A failed save or lost response
                // retries against the same baseline, even after another run improves records.
                const sealed = await kv.set(receiptKey, comparison, { nx: true, ex: 8 * 24 * 60 * 60 });
                if (sealed === null) throw new Error('Tower comparison was not committed; retry settlement.');
            }
            const campaignCharacter = recordEraCampaignEvidence(character, { kind: 'tower', receiptId: `tower:${session.runId}`, at: Date.now(), startedAt: session.createdAt,
                floor: isSpireRun(session) ? session.ascensionTier! : session.floor, story: isPublicTowerRun(session), spire: isSpireRun(session),
                humanMembers: new Set(session.actors.filter(actor => actor.side === 'squad' && actor.ai === false && actor.ownerSlug).map(actor => actor.ownerSlug)).size,
                clean: comparison.clean, withinPar: session.round <= floorForSession(session)!.roundBudget,
                disrupted: (session.towerTactics?.disruptedPylons.length ?? 0) > 0, avoided: (session.towerTactics?.avoidedStrikes ?? 0) > 0, baited: (session.towerTactics?.chargeBaits ?? 0) > 0 });
            if (JSON.stringify(previous) === JSON.stringify(records) && campaignCharacter === character) {
                return { ok: true, write: false, character, value: comparison };
            }
            return { ok: true, character: { ...campaignCharacter, battleTowerRecords: records }, value: comparison };
        }));
    } catch (error) {
        if (isPlayerSaveVersionConflict(error)) throw new Error('Tower records were not committed; retry settlement.');
        throw error;
    }
    if (!out.ok) throw new Error('Tower record save is unavailable; retry settlement.');
    return out.value;
}
