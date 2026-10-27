import { randomInt } from 'node:crypto';
import type { SecureInt } from './_owned-pet.js';
import { PET_EGG_GAMEPLAY_MS, type PetIncubation } from '../../shared/pet-incubation.js';

export type PetBreedingRequirementCategory = 'care' | 'adventure' | 'elementalBond';
export type PetBreedingRequirement = {
    id: string;
    category: PetBreedingRequirementCategory;
    kind: string;
    label: string;
    progress: number;
    target: number;
    element?: string;
};

export type PetBreedingSession = PetIncubation & {
    sessionId: string;
    state: 'breeding' | 'egg';
    parentIds: [string, string];
    parentNames: [string, string];
    parentElement: string;
    startedAt: number;
    readyAt: number;
    eggCreatedAt?: number;
    requirements?: PetBreedingRequirement[];
    rulesVersion: number;
    startRequestId?: string;
};

export type PetBreedingProgressEvent = {
    kind: 'training' | 'feed' | 'pet-interaction' | 'mission-complete' | 'expedition-complete' | 'pet-battle-win';
    amount?: number;
    petElement?: string;
    receipt?: string;
};

// Egg incubation replaced rolled requirements. Nothing rolls a new list (the
// roller and its catalogs were deleted on 2026-10-26), but a session saved
// before that can still carry one, so recordPetBreedingProgress keeps
// advancing it.

export function settlePetBreedingSession(
    character: Record<string, unknown>,
    now = Date.now(),
    secureInt: SecureInt = randomInt,
): { character: Record<string, unknown>; changed: boolean } {
    const session = character.petBreeding as PetBreedingSession | null | undefined;
    if (!session || session.incubationRemainingMs !== undefined || (session.state === 'breeding' && now < Number(session.readyAt))) return { character, changed: false };
    // Previously promised pairings keep their sealed offspring. Existing eggs
    // enter gameplay incubation without rerolling species, palette or success.
    return {
        character: {
            ...character,
            petBreeding: {
                ...session,
                state: 'egg',
                eggCreatedAt: Number(session.eggCreatedAt) || now,
                requirements: undefined,
                location: 'sanctuary',
                incubationRemainingMs: PET_EGG_GAMEPLAY_MS,
                incubationUpdatedAt: now,
                incubationActivityId: undefined,
            },
        },
        changed: true,
    };
}

function eventMatches(requirement: PetBreedingRequirement, event: PetBreedingProgressEvent): boolean {
    if (requirement.kind !== event.kind) return false;
    if (requirement.category !== 'elementalBond') return true;
    return Boolean(requirement.element && event.petElement && requirement.element.toLowerCase() === event.petElement.toLowerCase());
}

export function recordPetBreedingProgress(
    character: Record<string, unknown>,
    event: PetBreedingProgressEvent,
    now = Date.now(),
    secureInt: SecureInt = randomInt,
): { character: Record<string, unknown>; changed: boolean; completedIds: string[] } {
    const settled = settlePetBreedingSession(character, now, secureInt);
    const working = settled.character;
    const session = working.petBreeding as PetBreedingSession | null | undefined;
    if (!session || session.state !== 'egg' || !Array.isArray(session.requirements) || !session.eggCreatedAt || now < session.eggCreatedAt) {
        return { character: working, changed: settled.changed, completedIds: [] };
    }
    const receipts = Array.isArray(working.petBreedingProgressReceipts)
        ? (working.petBreedingProgressReceipts as unknown[]).filter((entry): entry is string => typeof entry === 'string').slice(-63)
        : [];
    if (event.receipt && receipts.includes(event.receipt)) return { character: working, changed: settled.changed, completedIds: [] };
    const amount = Math.max(1, Math.min(100, Math.floor(Number(event.amount ?? 1))));
    const completedIds: string[] = [];
    let progressed = false;
    const requirements = session.requirements.map((requirement) => {
        if (!eventMatches(requirement, event) || requirement.progress >= requirement.target) return requirement;
        const progress = Math.min(requirement.target, Math.max(0, requirement.progress) + amount);
        const requirementProgressed = progress !== requirement.progress;
        if (requirementProgressed) progressed = true;
        if (requirementProgressed && progress >= requirement.target) completedIds.push(requirement.id);
        return { ...requirement, progress };
    });
    if (!progressed && !settled.changed) return { character, changed: false, completedIds: [] };
    return {
        character: {
            ...working,
            petBreeding: { ...session, requirements },
            ...(event.receipt ? { petBreedingProgressReceipts: [...receipts, event.receipt] } : {}),
        },
        changed: true,
        completedIds,
    };
}

export function petBreedingRequirementsComplete(session: PetBreedingSession | null | undefined): boolean {
    if (session?.state === 'egg' && session.incubationRemainingMs !== undefined) return session.incubationRemainingMs <= 0;
    return Boolean(session?.state === 'egg'
        && Array.isArray(session.requirements)
        && session.requirements.length === 3
        && session.requirements.every((requirement) => requirement.progress >= requirement.target));
}
