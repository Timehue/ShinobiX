import type { BattleHistoryEntry, Character } from '../types/character';
import type { SoloPveSession } from '../lib/solo-pve-api';
import { fetchHuntCombatState, huntSessionForTower, submitHuntCombatAction } from '../lib/hunt-combat-api';
import { BattleTowerFight } from './BattleTowerFight';
import { beastPortrait } from '../data/hunter-art';
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
    // A resumed fight has no launch art, and the Tower portrait table only knows
    // Tower enemies. The sealed visual still names the beast on the board.
    const visual = String(session.enemy.character.visual ?? '');
    const beastAvatar = enemyAvatar || sharedImages?.[`ai:${visual}`] || beastPortrait(visual);
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
            enemyAvatarOverride={session.huntCombat?.purpose ? undefined : beastAvatar}
            renderResult={renderResult}
            onRecordBattle={onRecordBattle}
            onExit={onExit}
        />
    );
}
