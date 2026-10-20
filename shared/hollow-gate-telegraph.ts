import { hollowGateCombatDirective, type HollowGateCombatDirective } from './hollow-gate-combat-director.js';
import type { HollowGateHoundKind } from './hollow-gate-contract.js';

export type HollowGateTelegraph = { round: number; directive: HollowGateCombatDirective };
type TelegraphState = {
    round: number;
    encounter: { kind: string; metadata?: Record<string, string | number | boolean | null> };
    player: { pos: number };
    enemy: { hp: number; maxHp: number; pos: number; name?: string; character?: { visual?: unknown } };
    hollowGateTelegraph?: HollowGateTelegraph;
    gridWidth?: number;
    gridHeight?: number;
};

/** One advertised arena rule for the whole player turn and enemy resolution.
 * Old sessions without a cue use their current decision state until first action. */
export function hollowGateSessionDirective(state: TelegraphState, sealed = true): HollowGateCombatDirective | null {
    if (state.encounter.kind !== 'hollow-gate') return null;
    const kind = String(state.encounter.metadata?.combatKind ?? '');
    if (!['battle', 'elite', 'ambush', 'beast', 'boss'].includes(kind)) return null;
    if (kind === 'boss' && sealed && state.hollowGateTelegraph?.round === state.round) return state.hollowGateTelegraph.directive;
    const directive = hollowGateCombatDirective({
        enemyVisual: typeof state.enemy.character?.visual === 'string' ? state.enemy.character.visual : undefined,
        floor: state.encounter.metadata?.floor, kind: kind as HollowGateHoundKind, turn: state.round,
        enemyHp: state.enemy.hp, enemyMaxHp: state.enemy.maxHp,
        playerPos: state.player.pos, enemyPos: state.enemy.pos, gridWidth: state.gridWidth, gridHeight: state.gridHeight,
    });
    // Named bosses share the existing arena rules; their labels identify the actual opponent.
    const name = state.enemy.name;
    if (kind === 'boss' && name && name !== 'Hollow Hound Alpha') {
        const personalize = (line: string) => line.replace(/(?:The|the) Alpha/g, () => name);
        return { ...directive, title: personalize(directive.title), instruction: personalize(directive.instruction) };
    }
    return directive;
}

/** Called only when the player can next make a decision, never during an action. */
export function sealHollowGateTelegraph(state: TelegraphState): void {
    if (state.encounter.metadata?.combatKind !== 'boss') return;
    const directive = hollowGateSessionDirective(state, false);
    if (directive) state.hollowGateTelegraph = { round: state.round, directive };
}
