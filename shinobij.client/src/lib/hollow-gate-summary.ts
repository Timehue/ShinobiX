import type { Character, HollowGateShrineRun } from '../types/character';
import { hollowGateRunMaxFloor } from './hollow-gate-variant';

export function hollowGateRunSummary(character: Character | null, run: HollowGateShrineRun | null): string {
    if (!character || !run) return '';
    const count = (...kinds: string[]) => run.tiles.filter(t => t.resolved && kinds.includes(t.kind)).length;
    const hunters = run.wanderers?.filter(n => n.spent && ['bandit', 'night-ninja', 'patrol'].includes(n.role)).length ?? 0;
    return [
        `Floor reached: ${run.floor} / ${hollowGateRunMaxFloor(run)}`,
        `Chests opened: ${count('chest')}`,
        `Hollow Hounds defeated: ${Math.max(0, count('battle', 'elite') - hunters)}`,
        ...(run.wanderers ? [`Hunters defeated: ${hunters}`, `Traveler gifts: ${run.wanderers.filter(n => n.spent && ['medic', 'wayfarer'].includes(n.role)).length}`] : []),
        `Pet-duel Hounds defeated: ${count('pet_battle')}`,
        `Tile Seals claimed: ${count('tile_game')}`,
        `Hidden Chambers: ${count('shrine')}`,
        `Keepers blessed by: ${count('npc')}`,
        `Traps survived: ${count('trap')}`,
        `HP remaining: ${character.hp} / ${character.maxHp}`,
    ].join('\n');
}
