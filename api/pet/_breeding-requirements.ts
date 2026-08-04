import { randomInt } from 'node:crypto';
import type { SecureInt } from './_owned-pet.js';

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

export type PetBreedingSession = {
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

const CARE_CATALOG = [
    { id: 'care:training:1', kind: 'training', label: 'Complete one pet training session.', target: 1 },
    { id: 'care:feed:2', kind: 'feed', label: 'Feed owned pets two times.', target: 2 },
] as const;

const ADVENTURE_CATALOG = [
    { id: 'adventure:missions:1', kind: 'mission-complete', label: 'Complete one mission.', target: 1 },
    { id: 'adventure:missions:2', kind: 'mission-complete', label: 'Complete two missions.', target: 2 },
] as const;

const ELEMENTAL_CATALOG = [
    { id: 'elemental-bond:interaction:3', kind: 'pet-interaction', target: 3 },
    { id: 'elemental-bond:interaction:5', kind: 'pet-interaction', target: 5 },
] as const;

function choose<T>(items: readonly T[], secureInt: SecureInt): T {
    return items[secureInt(0, items.length)];
}

export function rollPetBreedingRequirements(
    character: Record<string, unknown>,
    element: string,
    secureInt: SecureInt = randomInt,
): PetBreedingRequirement[] {
    const pets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
    const hasTrainablePet = pets.some((pet) => Number(pet.level ?? 1) < Number(pet.maxLevel ?? 100));
    const carePool = hasTrainablePet ? CARE_CATALOG : CARE_CATALOG.filter((entry) => entry.kind === 'feed');
    const care = choose(carePool, secureInt);
    const adventure = choose(ADVENTURE_CATALOG, secureInt);
    const elemental = choose(ELEMENTAL_CATALOG, secureInt);
    return [
        { ...care, category: 'care', progress: 0 },
        { ...adventure, category: 'adventure', progress: 0 },
        {
            ...elemental,
            category: 'elementalBond',
            progress: 0,
            element,
            label: `Interact with ${element} pets ${elemental.target} times.`,
        },
    ];
}

export function settlePetBreedingSession(
    character: Record<string, unknown>,
    now = Date.now(),
    secureInt: SecureInt = randomInt,
): { character: Record<string, unknown>; changed: boolean } {
    const session = character.petBreeding as PetBreedingSession | null | undefined;
    if (!session || session.state !== 'breeding' || now < Number(session.readyAt)) return { character, changed: false };
    const requirements = Array.isArray(session.requirements) && session.requirements.length === 3
        ? session.requirements
        : rollPetBreedingRequirements(character, session.parentElement, secureInt);
    return {
        character: {
            ...character,
            petBreeding: {
                ...session,
                state: 'egg',
                eggCreatedAt: Number(session.eggCreatedAt) || now,
                requirements,
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
    return Boolean(session?.state === 'egg'
        && Array.isArray(session.requirements)
        && session.requirements.length === 3
        && session.requirements.every((requirement) => requirement.progress >= requirement.target));
}
