import type { TacticsMove } from './pet-tactics-contract.js';
import { rankedBuildForPet } from './pet-tactics-build.js';
import { tacticsSpecies, TACTICS_MOVES } from './pet-tactics-roster.js';
import { resolvePetAbilityProgression, type AuthoredPetAbility, type ProgressionPetAbility } from './pet-ability-progression.js';

type BattlePet = { id?: unknown; templateId?: unknown; evolutionStage?: unknown; rarity?: unknown; level?: unknown; rankedBuild?: unknown; battleLoadoutVersion?: unknown; jutsus?: unknown[] };
export type PetBattleLoadoutOptions = { ruleset?: 'progression' | 'competitive-tactics'; forceProgression?: boolean };
type ProgressionMove = Omit<TacticsMove, 'kind'> & { kind: string; signature?: boolean; rounds?: number; abilityId?: string; baseAbilityId?: string; unlockLevel?: number;
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
    const native = resolvePetAbilityProgression({ ...pet, level: Number(pet.level ?? 1), abilities: pet.jutsus as AuthoredPetAbility[] | undefined });
    const preferred = resolvePetAbilityProgression({ ...pet, level: Number(pet.level ?? 1),
        abilities: selected.filter(move => move !== species.signature) }, { abilitySource: 'tactics' }).abilities as unknown as ProgressionMove[];
    const projectNative = (move: ProgressionPetAbility): ProgressionMove => ({
        ...move, id: move.baseAbilityId, element: species.element,
        cls: move.tier === 'basic' ? 'special' : ['crush', 'wound', 'push', 'pull', 'pivot', 'lifesteal'].includes(move.kind) ? 'physical'
            : ['damage', 'burn', 'dot', 'freeze'].includes(move.kind) ? 'special' : 'status',
        target: move.aoe === true ? 'team' : ['heal', 'shield', 'barrier', 'absorb', 'buff', 'haste', 'move', 'protect', 'cleanse', 'weather', 'taunt'].includes(move.kind) ? 'self' : 'foe',
        cost: 0, priority: 1, hold: 0, cooldown: Math.max(1, Number(move.cooldown) || 3), effect: '',
        rounds: Number.isFinite(Number(move.rounds)) ? Number(move.rounds) : undefined,
    });
    const nativeOrdinary = native.abilities.filter(move => !move.signature).map(projectNative);
    const ordinary = [...preferred];
    // A utility-heavy preference never removes the species' affordable strike.
    // Stored preferences remain unchanged, including the displaced fourth slot.
    if (!ordinary.some(move => move.tier === 'basic')) {
        const basic = nativeOrdinary.find(move => move.tier === 'basic');
        if (basic) ordinary.unshift(basic);
    }
    for (const move of nativeOrdinary) {
        if (ordinary.length >= 4 || move.tier === 'basic' && ordinary.some(candidate => candidate.tier === 'basic')) continue;
        if (!ordinary.some(candidate => candidate.baseAbilityId === move.baseAbilityId)) ordinary.push(move);
    }
    // Competitive signatures belong to that normalized format. Progression
    // always keeps the form's native Final Art and its earned mastery.
    return [...ordinary.slice(0, 4), ...native.abilities.filter(move => move.signature).map(projectNative)];
}

/** Translate tactical support into the corresponding adventure combat effects.
 * Competitive attributes and items stay exclusive to the competitive format. */
export function petBattleJutsus<T>(pet: BattlePet & { jutsus?: T[] }, options: PetBattleLoadoutOptions = {}): T[] | BattleJutsu[] {
    if (!options.forceProgression && pet.battleLoadoutVersion === 'progression-v3') return Array.isArray(pet.jutsus) ? pet.jutsus : [];
    const moves = petBattleTechniques(pet, options);
    if (!moves) {
        const authored = Array.isArray(pet.jutsus) ? pet.jutsus : [];
        if (!options.forceProgression && pet.battleLoadoutVersion === 'legacy-v1') return authored;
        return resolvePetAbilityProgression({ ...pet, level: Number(pet.level ?? 1),
            abilities: authored as Parameters<typeof resolvePetAbilityProgression>[0]['abilities'] }, { ruleset: options.ruleset ?? 'progression' }).abilities.map(materializeMastery) as unknown as T[];
    }
    return moves.map((move) => materializeMastery({
        ...(move.abilityId ? { abilityId: move.abilityId, baseAbilityId: move.baseAbilityId, unlockLevel: move.unlockLevel,
            tier: move.tier, upgrade: move.upgrade, restrained: move.restrained } : {}),
        name: move.name,
        kind: adventureKind(move.kind),
        power: move.power || 100,
        cooldown: move.cooldown,
        currentCooldown: 0,
        rounds: move.rounds ?? (move.kind === 'stun' || move.kind === 'protect' ? 1 : 2),
        ...(move.signature || move.tier === 'signature' || move.id.endsWith('-signature') ? { signature: true } : {}),
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

function adventureKind(kind: string): BattleJutsu['kind'] {
    switch (kind) {
        case 'protect': return 'barrier';
        case 'redirect': return 'taunt';
        case 'weather': return 'buff';
        case 'damage': case 'buff': case 'heal': case 'debuff': case 'dot': case 'move':
        case 'barrier': case 'movelock': case 'lifesteal': case 'shield': case 'absorb':
        case 'burn': case 'freeze': case 'confuse': case 'stun': case 'crush': case 'wound':
        case 'mark': case 'slow': case 'haste': case 'taunt': case 'push': case 'pull': case 'cleanse':
            return kind;
        default: return 'damage';
    }
}

type BattleJutsu = {
    abilityId?: string; baseAbilityId?: string; unlockLevel?: number;
    tier?: 'basic' | 'utility' | 'advanced' | 'signature'; upgrade?: 'utility-mastery' | 'offense-mastery' | 'signature-mastery'; restrained?: boolean;
    name: string; kind: 'damage' | 'buff' | 'heal' | 'debuff' | 'dot' | 'move' | 'barrier' | 'movelock'
        | 'lifesteal' | 'shield' | 'absorb' | 'burn' | 'freeze' | 'confuse' | 'stun' | 'crush'
        | 'wound' | 'mark' | 'slow' | 'haste' | 'taunt' | 'push' | 'pull' | 'cleanse';
    power: number; cooldown: number; currentCooldown: number; rounds: number; signature?: boolean; aoe?: boolean;
};
