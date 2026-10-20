import type { SoloPveSession } from './_session.js';

/** Pure proof check: settlement must not import the combat construction graph. */
export function narrativeGroupWinConfirmed(session: SoloPveSession): boolean {
    const group = session.huntCombat;
    if (group?.purpose !== 'narrative-group') return true;
    const ids = group.requiredEnemyIds;
    const battle = group.battle;
    return !!ids && ids.length >= 2 && new Set(ids).size === ids.length && battle.runId === session.sessionId
        && battle.status === 'done' && battle.winner === 'squad'
        && !battle.actors.some(a => a.side === 'enemy' && a.hp > 0)
        && ids.every(id => { const actors = battle.actors.filter(a => a.id === id); return actors.length === 1 && actors[0].side === 'enemy' && actors[0].hp <= 0; });
}
