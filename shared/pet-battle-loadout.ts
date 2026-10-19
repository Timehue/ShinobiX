import type { TacticsMove } from './pet-tactics-contract.js';
import { rankedBuildForPet } from './pet-tactics-build.js';
import { tacticsSpecies, TACTICS_MOVES } from './pet-tactics-roster.js';
import { resolvePetAbilityProgression } from './pet-ability-progression.js';

type BattlePet = { id?: unknown; templateId?: unknown; evolutionStage?: unknown; rarity?: unknown; level?: unknown; rankedBuild?: unknown; battleLoadoutVersion?: unknown };
export type PetBattleLoadoutOptions = { ruleset?: 'progression' | 'competitive-tactics'; forceProgression?: boolean };
type ProgressionMove = TacticsMove & { abilityId?: string; baseAbilityId?: string; unlockLevel?: number;
    tier?: 'basic' | 'utility' | 'advanced' | 'signature'; upgrade?: 'utility-mastery' | 'offense-mastery' | 'signature-mastery'; restrained?: boolean };

/** Saved choices apply across progression battles. Earned abilities come from
 * the current form; outdated evolved builds use its eligible preset. */
export function petBattleTechniques(pet: BattlePet, options: PetBattleLoadoutOptions = {}): ProgressionMove[] | null {
    if (!pet.rankedBuild || typeof pet.id !== 'string') return null;
    const build = rankedBuildForPet({ ...pet, id: pet.id });
    const species = build && tacticsSpecies(build.speciesId);
    if (!build || !species) return null;
    const selected = [...build.moveIds.map(id => TACTICS_MOVES[id]), species.signature];
    if (options.ruleset === 'competitive-tactics' || (!options.forceProgression && pet.battleLoadoutVersion === 'legacy-v1')) return selected;
    // Saved choices remain intact. Locked choices temporarily yield to the
    // current form's eligible defaults, then resume automatically when earned.
    const candidates = [...selected.filter(move => move !== species.signature), ...species.pool.map(id => TACTICS_MOVES[id]), species.signature];
    const unique = candidates.filter((move, index) => candidates.findIndex(candidate => candidate.id === move.id) === index);
    const resolved = resolvePetAbilityProgression({ ...pet, level: Number(pet.level ?? 1), ruleset: 'progression', abilitySource: 'tactics', abilities: unique });
    const eligible = resolved.abilities as unknown as ProgressionMove[];
    return [...eligible.filter(move => !move.id.endsWith('-signature')).slice(0, 4), ...eligible.filter(move => move.id.endsWith('-signature')).slice(0, 1)];
}

/** Translate tactical support into the corresponding adventure combat effects.
 * Competitive attributes and items stay exclusive to the competitive format. */
export function petBattleJutsus<T>(pet: BattlePet & { jutsus?: T[] }, options: PetBattleLoadoutOptions = {}): T[] | BattleJutsu[] {
    if (!options.forceProgression && pet.battleLoadoutVersion === 'progression-v3') return Array.isArray(pet.jutsus) ? pet.jutsus : [];
    const moves = petBattleTechniques(pet, options);
    if (!moves) {
        const authored = Array.isArray(pet.jutsus) ? pet.jutsus : [];
        if (!options.forceProgression && pet.battleLoadoutVersion === 'legacy-v1') return authored;
        return resolvePetAbilityProgression({ ...pet, level: Number(pet.level ?? 1), ruleset: options.ruleset ?? 'progression',
            abilities: authored as Parameters<typeof resolvePetAbilityProgression>[0]['abilities'] }).abilities.map(materializeMastery) as unknown as T[];
    }
    return moves.map((move) => materializeMastery({
        ...(move.abilityId ? { abilityId: move.abilityId, baseAbilityId: move.baseAbilityId, unlockLevel: move.unlockLevel,
            tier: move.tier, upgrade: move.upgrade, restrained: move.restrained } : {}),
        name: move.name,
        kind: adventureKind(move.kind),
        power: move.power || 100,
        cooldown: move.cooldown,
        currentCooldown: 0,
        rounds: move.kind === 'stun' || move.kind === 'protect' ? 1 : 2,
        ...(move.id.endsWith('-signature') ? { signature: true } : {}),
        ...(move.target === 'team' ? { aoe: true } : {}),
    }));
}

/** Spatial duels and short PvE summons express mastery in their existing
 * power/cooldown rules. Frozen projections bypass this step on replay. */
function materializeMastery<T extends { power: number; cooldown?: unknown; upgrade?: string; kind?: unknown; restrained?: unknown }>(move: T): T {
    if (move.restrained && ['burn', 'dot', 'wound', 'slow', 'debuff', 'mark', 'stun', 'freeze', 'confuse', 'crush', 'lifesteal', 'push', 'pull', 'movelock'].includes(String(move.kind))) {
        return { ...move, kind: 'damage' };
    }
    if (move.upgrade === 'utility-mastery') return { ...move, cooldown: Math.max(1, (Number(move.cooldown) || 1) - 1) };
    if (move.upgrade === 'offense-mastery' || move.upgrade === 'signature-mastery') return {
        ...move, power: Math.round(move.power * (move.upgrade === 'signature-mastery' ? 1.1 : 1.08)),
    };
    return move;
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
    abilityId?: string; baseAbilityId?: string; unlockLevel?: number;
    tier?: 'basic' | 'utility' | 'advanced' | 'signature'; upgrade?: 'utility-mastery' | 'offense-mastery' | 'signature-mastery'; restrained?: boolean;
    name: string; kind: 'damage' | 'burn' | 'wound' | 'mark' | 'slow' | 'stun' | 'heal' | 'shield' | 'buff' | 'barrier' | 'taunt' | 'cleanse';
    power: number; cooldown: number; currentCooldown: number; rounds: number; signature?: boolean; aoe?: boolean;
};
