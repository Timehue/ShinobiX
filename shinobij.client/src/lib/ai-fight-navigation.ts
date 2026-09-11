import type { AiFightStart } from './ai-fight-api';
import type { AiFightRequest } from './ai-fight-request';

const circuitFightKey = (name: string) => `dojo-combat-session:${name.trim().toLowerCase()}`;
/** Presentation breadcrumb only. Server match proof, never this key, awards credit. */
export function rememberCircuitCombatSession(name: string, sessionId: string) {
    try { sessionStorage.setItem(circuitFightKey(name), sessionId); } catch { /* Recovery still opens the sealed fight. */ }
}
export function forgetCircuitCombatSession(name: string, sessionId: string) {
    try { if (sessionStorage.getItem(circuitFightKey(name)) === sessionId) sessionStorage.removeItem(circuitFightKey(name)); } catch { /* Optional presentation state. */ }
}
export function requestForResumedGenericFight(started: AiFightStart, playerName = ''): AiFightRequest | null {
    if (!started.opponentId || !started.opponentName || !started.battleKind || started.worldContext) return null;
    let circuit = false;
    try { circuit = !!playerName && started.battleKind === 'practice' && sessionStorage.getItem(circuitFightKey(playerName)) === started.sessionId; } catch { /* Storage can be unavailable. */ }
    return {
        opponentId: started.opponentId,
        opponentLevel: Math.max(1, Number(started.session.enemy.character.level) || 1),
        battleKind: started.battleKind,
        opponentName: started.opponentName,
        ...(typeof started.sector === 'number' ? { sector: started.sector } : {}),
        ...(started.worldExploreRequestId ? { worldExploreRequestId: started.worldExploreRequestId } : {}),
        ...(started.dungeonRunToken ? { dungeonRunToken: started.dungeonRunToken } : {}),
        ...(circuit ? { returnScreen: 'dojoCircuit' }
            : started.battleKind === 'raidAi' || started.battleKind === 'explore' ? { returnScreen: 'worldMap' }
            : started.battleKind === 'dungeon' ? { returnScreen: 'dungeon' } : {}),
    };
}
