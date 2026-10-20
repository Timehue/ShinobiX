import type { BattleHistoryEntry, Character } from '../types/character';
import type { SoloPveSession } from '../lib/solo-pve-api';
import { fetchHuntCombatState, huntSessionForTower, submitHuntCombatAction } from '../lib/hunt-combat-api';
import { BattleTowerFight } from './BattleTowerFight';
import type { ComponentProps } from 'react';

/**
 * Hunt encounters reuse the Tower grid screen, but every command goes through the
 * hunt's own authenticated solo-PvE fight. Kept in its own lazy module so the grid
 * screen and its transport stay out of the initial bundle.
 */
export default function HuntTowerFight({ character, sharedImages, session, settleFn, enemyAvatar, onRecordBattle, onExit, renderResult }: {
    character: Character;
    sharedImages?: Record<string, string>;
    session: SoloPveSession;
    settleFn: (runId: string, playerName: string) => Promise<unknown>;
    enemyAvatar?: string;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    onExit: () => void;
    renderResult?: ComponentProps<typeof BattleTowerFight>['renderResult'];
}) {
    return (
        <BattleTowerFight
            character={character}
            sharedImages={sharedImages}
            runId={session.sessionId}
            initialSession={huntSessionForTower(session)}
            stateFn={fetchHuntCombatState}
            actionRetryFn={submitHuntCombatAction}
            settleFn={settleFn}
            settleOnAnyDone
            variant={session.huntCombat?.purpose === 'narrative-group' ? 'narrative-group' : 'hunt'}
            enemyAvatarOverride={session.huntCombat?.purpose ? undefined : enemyAvatar}
            renderResult={renderResult}
            onRecordBattle={onRecordBattle}
            onExit={onExit}
        />
    );
}
