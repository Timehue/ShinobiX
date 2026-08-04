import { isBreedableTemplate, resolvePetTemplateId } from './_owned-pet.js';
import type { PetBreedingSession } from './_breeding-requirements.js';

export const PET_BREEDING_MIN_LEVEL = 50;

export type PetBusyCode =
    | 'pet-is-breeding'
    | 'pet-is-training'
    | 'pet-is-on-expedition'
    | 'pet-is-active'
    | 'pet-is-reserve'
    | 'pet-is-assigned';

export type PetEligibilityResult = { ok: true; templateId: string; element: string }
    | { ok: false; code: string; message: string };

function stringSet(value: unknown): Set<string> {
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry)));
}

export function activeBreedingParentIds(character: Record<string, unknown>, now = Date.now()): Set<string> {
    const session = character.petBreeding as PetBreedingSession | null | undefined;
    if (!session || session.state !== 'breeding' || now >= Number(session.readyAt)) return new Set();
    return new Set(session.parentIds);
}

export function petBusyReason(
    character: Record<string, unknown>,
    pet: Record<string, unknown>,
    now = Date.now(),
    options: { includeActive?: boolean; includeReserve?: boolean; assignmentIds?: Iterable<string> } = {},
): PetBusyCode | null {
    const id = String(pet.id ?? '');
    if (activeBreedingParentIds(character, now).has(id)) return 'pet-is-breeding';
    if (pet.training) return 'pet-is-training';
    if (pet.expedition) return 'pet-is-on-expedition';
    if (options.includeActive !== false && String(character.activePetId ?? '') === id) return 'pet-is-active';
    if (options.includeReserve !== false && String(character.activePetId2v2 ?? '') === id) return 'pet-is-reserve';
    const assigned = new Set(options.assignmentIds ?? []);
    for (const field of ['petArenaTeamIds', 'tacticalPetTeamIds', 'petEscortPetIds', 'petDefensePetIds', 'petBattlePetIds']) {
        for (const assignedId of stringSet(character[field])) assigned.add(assignedId);
    }
    return assigned.has(id) ? 'pet-is-assigned' : null;
}

export function petBusyMessage(code: PetBusyCode): string {
    switch (code) {
        case 'pet-is-breeding': return 'This pet is in the breeding barn until the timer completes.';
        case 'pet-is-training': return 'This pet has training in progress or waiting to be collected.';
        case 'pet-is-on-expedition': return 'This pet is on an expedition or has an unclaimed expedition.';
        case 'pet-is-active': return 'Remove this pet from the active PvE slot before breeding.';
        case 'pet-is-reserve': return 'Remove this pet from the active 2v2 reserve slot before breeding.';
        case 'pet-is-assigned': return 'Remove this pet from its persistent team or assignment before breeding.';
    }
}

export function petBreedingEligibility(
    character: Record<string, unknown>,
    pet: Record<string, unknown>,
    now = Date.now(),
    options: { assignmentIds?: Iterable<string> } = {},
): PetEligibilityResult {
    const templateId = resolvePetTemplateId(pet);
    if (!templateId) return { ok: false, code: 'unknown-pet-template', message: 'This legacy companion could not be matched to the breeding catalog.' };
    if (!isBreedableTemplate(templateId) || pet.breedable === false) return { ok: false, code: 'protected-pet', message: 'This protected companion cannot breed.' };
    const element = String(pet.element ?? 'None');
    if (!element || element === 'None') return { ok: false, code: 'invalid-element', message: 'This pet has no breedable element.' };
    if (Number(pet.level ?? 0) < PET_BREEDING_MIN_LEVEL) {
        return { ok: false, code: 'pet-level-too-low', message: `This pet must reach level ${PET_BREEDING_MIN_LEVEL} before breeding.` };
    }
    if (Number(pet.breedingUsesRemaining ?? 0) <= 0) return { ok: false, code: 'no-breeding-uses', message: 'This pet has no breeding uses remaining.' };
    const busy = petBusyReason(character, pet, now, { assignmentIds: options.assignmentIds });
    if (busy) return { ok: false, code: busy, message: petBusyMessage(busy) };
    return { ok: true, templateId, element };
}

export function isPetBreedingEligible(character: Record<string, unknown>, pet: Record<string, unknown>, now = Date.now()): boolean {
    return petBreedingEligibility(character, pet, now).ok;
}
