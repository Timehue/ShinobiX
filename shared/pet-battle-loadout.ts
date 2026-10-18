import type { TacticsMove } from './pet-tactics-contract.js';
import { rankedBuildForPet } from './pet-tactics-build.js';
import { tacticsSpecies, TACTICS_MOVES } from './pet-tactics-roster.js';

type BattlePet = { id?: unknown; templateId?: unknown; evolutionStage?: unknown; rarity?: unknown; rankedBuild?: unknown };

/** Saved choices apply to every battle. Pets without a saved build keep their
 * authored adventure kit; outdated evolved builds use the current form's preset. */
export function petBattleTechniques(pet: BattlePet): TacticsMove[] | null {
    if (!pet.rankedBuild || typeof pet.id !== 'string') return null;
    const build = rankedBuildForPet({ ...pet, id: pet.id });
    const species = build && tacticsSpecies(build.speciesId);
    return build && species ? [...build.moveIds.map(id => TACTICS_MOVES[id]), species.signature] : null;
}

/** Translate tactical support into the corresponding adventure combat effects.
 * Competitive attributes and items stay exclusive to the competitive format. */
export function petBattleJutsus<T>(pet: BattlePet & { jutsus?: T[] }): T[] | BattleJutsu[] {
    const moves = petBattleTechniques(pet);
    if (!moves) return Array.isArray(pet.jutsus) ? pet.jutsus : [];
    return moves.map((move, index) => ({
        name: move.name,
        kind: adventureKind(move.kind),
        power: move.power || 100,
        cooldown: move.cooldown,
        currentCooldown: 0,
        rounds: move.kind === 'stun' || move.kind === 'protect' ? 1 : 2,
        ...(index === moves.length - 1 ? { signature: true } : {}),
        ...(move.target === 'team' ? { aoe: true } : {}),
    }));
}

function adventureKind(kind: TacticsMove['kind']): BattleJutsu['kind'] {
    switch (kind) {
        case 'protect': return 'barrier';
        case 'redirect': return 'taunt';
        case 'weather': return 'buff';
        default: return kind;
    }
}

type BattleJutsu = {
    name: string; kind: 'damage' | 'burn' | 'wound' | 'mark' | 'slow' | 'stun' | 'heal' | 'shield' | 'buff' | 'barrier' | 'taunt' | 'cleanse';
    power: number; cooldown: number; currentCooldown: number; rounds: number; signature?: boolean; aoe?: boolean;
};
