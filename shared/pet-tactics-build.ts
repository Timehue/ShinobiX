import type { TacticsBuild } from './pet-tactics-contract.js';
import { TACTICS_ITEMS, TACTICS_MOVES, ownedTacticsSpeciesId, tacticsPreset, tacticsSpecies } from './pet-tactics-roster.js';

/** Shared admission rules for the editor, saved loadouts and sealed battles. */
export function validateTacticsBuild(value: unknown): TacticsBuild {
    const raw = value as Partial<TacticsBuild> | null;
    const species = typeof raw?.speciesId === 'string' ? tacticsSpecies(raw.speciesId) : undefined;
    if (!species) throw new Error('Unknown competitive species.');
    const ids = raw?.moveIds;
    if (!Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4 || ids.some(id => typeof id !== 'string' || !species.pool.includes(id))) {
        throw new Error('Equip four distinct moves from this pet’s pool.');
    }
    const moves = ids.map(id => TACTICS_MOVES[id]);
    if (!moves.some(m => m.power > 0 && m.cooldown === 0 && m.hold === 0)) throw new Error('Each pet needs repeatable offense.');
    if (moves.filter(m => m.kind === 'stun').length > 1 || moves.filter(m => m.power > 0 && m.element !== 'None' && m.element !== species.element).length > 1) {
        throw new Error('At most one control and one off-element attack per pet.');
    }
    const allocation = {} as TacticsBuild['allocation'];
    for (const key of ['vitality', 'power', 'guard', 'agility'] as const) {
        const n = raw?.allocation?.[key];
        if (!Number.isSafeInteger(n) || n == null || n < 0 || n > 25) throw new Error('Allocation values must be whole numbers from 0 to 25.');
        allocation[key] = n;
    }
    if (Object.values(allocation).reduce((a, b) => a + b, 0) !== 49) throw new Error('Allocate exactly 49 competitive points.');
    if (!TACTICS_ITEMS.some(i => i.id === raw?.item)) throw new Error('Choose a competitive item.');
    const ownedPetId = typeof raw?.ownedPetId === 'string' && raw.ownedPetId.trim() ? raw.ownedPetId : undefined;
    return { speciesId: species.id, ...(ownedPetId ? { ownedPetId } : {}), moveIds: [...ids], allocation, item: raw!.item! };
}

export function tacticsBuildIssue(value: unknown): string | null {
    try { validateTacticsBuild(value); return null; }
    catch (error) { return error instanceof Error ? error.message : 'Choose a valid ranked loadout.'; }
}

export function sameTacticsBuild(a: unknown, b: unknown): boolean {
    try { return JSON.stringify(validateTacticsBuild(a)) === JSON.stringify(validateTacticsBuild(b)); }
    catch { return false; }
}

/** Old saves and evolved forms safely start with their current species preset. */
export function rankedBuildForPet(pet: { id: string; templateId?: unknown; evolutionStage?: unknown; rarity?: unknown; rankedBuild?: unknown }): TacticsBuild | null {
    const speciesId = ownedTacticsSpeciesId(pet);
    if (!speciesId) return null;
    try {
        const saved = validateTacticsBuild(pet.rankedBuild);
        if (saved.speciesId === speciesId) return { ...saved, ownedPetId: pet.id };
    } catch { /* Missing or outdated loadout: use a legal species preset. */ }
    return { ...tacticsPreset(speciesId), ownedPetId: pet.id };
}
