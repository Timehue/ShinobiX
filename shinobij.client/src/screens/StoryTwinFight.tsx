import { useCallback, type ComponentProps } from 'react';
import type { SoloPveSession } from '../lib/solo-pve-api';
import { fetchHuntCombatState, huntSessionForTower, submitHuntCombatAction } from '../lib/hunt-combat-api';
import type { MissionArenaFight } from './MissionArenaFight';
import { BattleTowerFight } from './BattleTowerFight';

type Props = ComponentProps<typeof MissionArenaFight> & { sealedSession: SoloPveSession };

/** Same story receipt and authenticated Solo-PvE transport; the multi-actor
 * battlefield provides individual targeting, dossiers, HP and turn order. */
export default function StoryTwinFight({ sealedSession, character, sharedImages, storyTheme, renderResult,
    settleFn, outcomeFn, onExit, onRecordBattle }: Props) {
    const settle = useCallback(async (runId: string, playerName: string) => {
        // The server confirms the physical outcome for wins and losses. Rewards
        // remain gated by /story/settle, which verifies every bound enemy is down.
        const terminal = await fetchHuntCombatState(runId, playerName);
        const reward = terminal.winner === 'squad' ? await settleFn?.(runId, playerName) : undefined;
        const outcome = await outcomeFn?.(runId, playerName);
        return reward ?? outcome;
    }, [settleFn, outcomeFn]);
    return <BattleTowerFight character={character} sharedImages={sharedImages} runId={sealedSession.sessionId}
        initialSession={huntSessionForTower(sealedSession)} stateFn={fetchHuntCombatState} actionRetryFn={submitHuntCombatAction}
        settleFn={settle} settleOnAnyDone variant={sealedSession.huntCombat?.purpose === 'narrative-group' ? 'narrative-group' : 'story-trial'} storyTheme={{ ...storyTheme,
            bossName: storyTheme?.bossName ?? sealedSession.enemy.name,
            ...(sealedSession.huntCombat?.purpose === 'story-twins' ? { backdropImage: `/scenes/story/${sealedSession.encounter.sourceId!.replace('story-ai-', 'story-')}-twins.webp` } : {}) }} renderResult={renderResult}
        onRecordBattle={onRecordBattle} onExit={onExit} />;
}
