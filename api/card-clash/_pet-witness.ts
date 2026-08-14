import {
    grantChronicleProgressionCards,
    petWitnessProgressionCardId,
} from './_progression-cards.js';
import type { Pet } from '../_pet-sim/pet-types.js';

export const PET_WITNESS_WIN_THRESHOLD = 10;
const PET_WITNESS_LEDGER_CAP = 5;
const PET_WITNESS_PROGRESS_RECEIPT_CAP = 256;

export type ChroniclePetWitness = {
    cardId: string;
    petId: string;
    petName: string;
    templateId?: string;
    element: string;
    deed: 'arena-renown';
    wins: number;
    witnessedAt: number;
    /** Stable authoritative settlement receipt used to replay lost responses. */
    sourceReceipt?: string;
};

/**
 * Exact server-authored progress returned by a victorious arena settlement.
 * These receipts are presentation evidence, not a second entitlement ledger:
 * the pet counter, witness provenance, and card inventory remain authoritative.
 */
export type ChroniclePetWitnessProgress = {
    sourceReceipt: string;
    petId: string;
    petName: string;
    cardId: string;
    wins: number;
    threshold: typeof PET_WITNESS_WIN_THRESHOLD;
    deedRecorded: boolean;
    cardPressed: boolean;
};

export type PetWitnessSettlementReceipt = {
    granted: string[];
    witnessed: ChroniclePetWitness[];
    livingWitnessProgress: ChroniclePetWitnessProgress[];
};

function readPetWitnesses(character: Record<string, unknown>): ChroniclePetWitness[] {
    return Array.isArray(character.chroniclePetWitnesses)
        ? (character.chroniclePetWitnesses as unknown[])
            .filter((entry): entry is ChroniclePetWitness => !!entry && typeof entry === 'object'
                && typeof (entry as ChroniclePetWitness).cardId === 'string')
            .slice(-PET_WITNESS_LEDGER_CAP)
        : [];
}

function readPetWitnessProgress(character: Record<string, unknown>): ChroniclePetWitnessProgress[] {
    return Array.isArray(character.chroniclePetArenaProgressReceipts)
        ? (character.chroniclePetArenaProgressReceipts as unknown[])
            .filter((entry): entry is ChroniclePetWitnessProgress => {
                if (!entry || typeof entry !== 'object') return false;
                const candidate = entry as Partial<ChroniclePetWitnessProgress>;
                return typeof candidate.sourceReceipt === 'string'
                    && typeof candidate.petId === 'string'
                    && typeof candidate.petName === 'string'
                    && typeof candidate.cardId === 'string'
                    && Number.isSafeInteger(candidate.wins)
                    && candidate.threshold === PET_WITNESS_WIN_THRESHOLD
                    && typeof candidate.deedRecorded === 'boolean'
                    && typeof candidate.cardPressed === 'boolean';
            })
            .slice(-PET_WITNESS_PROGRESS_RECEIPT_CAP)
        : [];
}

/** Rebuild the same presentation receipt after a committed response was lost. */
export function petWitnessReceiptForSettlement(
    character: Record<string, unknown>,
    sourceReceipt: string,
): PetWitnessSettlementReceipt {
    const witnessed = readPetWitnesses(character)
        .filter((entry) => entry.sourceReceipt === sourceReceipt);
    const livingWitnessProgress = readPetWitnessProgress(character)
        .filter((entry) => entry.sourceReceipt === sourceReceipt);
    const owned = new Set(
        Array.isArray(character.tileCards)
            ? (character.tileCards as unknown[]).filter((id): id is string => typeof id === 'string')
            : [],
    );
    return {
        granted: witnessed.map((entry) => entry.cardId).filter((id) => owned.has(id)),
        witnessed,
        livingWitnessProgress,
    };
}

export function recordPetArenaVictory(
    character: Record<string, unknown>,
    participatingPetIds: readonly string[],
    now = Date.now(),
    sourceReceiptRaw = '',
    sealedPetSnapshots?: readonly Pet[],
): { character: Record<string, unknown> } & PetWitnessSettlementReceipt {
    const ids = new Set(participatingPetIds.filter(Boolean));
    if (ids.size === 0) return { character, granted: [], witnessed: [], livingWitnessProgress: [] };
    const existingWitnesses = readPetWitnesses(character);
    const sourceReceipt = sourceReceiptRaw.trim().slice(0, 160);
    if (sourceReceipt) {
        const replay = petWitnessReceiptForSettlement(character, sourceReceipt);
        if (replay.livingWitnessProgress.length) return { character, ...replay };
    }
    const existingProgress = readPetWitnessProgress(character);
    const sealedById = new Map(
        (sealedPetSnapshots ?? [])
            .filter((pet) => pet && typeof pet === 'object' && typeof pet.id === 'string')
            .map((pet) => [String(pet.id), pet]),
    );
    const witnessedCardIds = new Set(existingWitnesses.map((entry) => entry.cardId));
    const newlyWitnessed: ChroniclePetWitness[] = [];
    const progressDrafts: Array<Omit<ChroniclePetWitnessProgress, 'deedRecorded' | 'cardPressed'>> = [];
    const pets = Array.isArray(character.pets)
        ? (character.pets as unknown[]).filter((pet): pet is Record<string, unknown> => !!pet && typeof pet === 'object')
        : [];
    const nextPets = pets.map((pet) => {
        const petId = String(pet.id ?? '');
        if (!ids.has(petId)) return pet;
        const witnessedPet = sealedById.get(petId) ?? pet;
        const wins = Math.min(1_000_000, Math.max(0, Math.floor(Number(pet.chronicleArenaWins) || 0)) + 1);
        const cardId = petWitnessProgressionCardId(witnessedPet.element);
        if (wins >= PET_WITNESS_WIN_THRESHOLD && cardId && !witnessedCardIds.has(cardId)) {
            witnessedCardIds.add(cardId);
            newlyWitnessed.push({
                cardId,
                petId,
                petName: String(witnessedPet.nickname || witnessedPet.name || 'Companion').trim().slice(0, 48) || 'Companion',
                ...(typeof witnessedPet.templateId === 'string' ? { templateId: witnessedPet.templateId } : {}),
                element: String(witnessedPet.element ?? ''),
                deed: 'arena-renown',
                wins,
                witnessedAt: now,
                ...(sourceReceipt ? { sourceReceipt } : {}),
            });
        }
        if (cardId && sourceReceipt && wins <= PET_WITNESS_WIN_THRESHOLD) {
            progressDrafts.push({
                sourceReceipt,
                petId,
                petName: String(witnessedPet.nickname || witnessedPet.name || 'Companion').trim().slice(0, 48) || 'Companion',
                cardId,
                wins,
                threshold: PET_WITNESS_WIN_THRESHOLD,
            });
        }
        return { ...pet, chronicleArenaWins: wins };
    });
    const withWitnesses: Record<string, unknown> = {
        ...character,
        pets: nextPets,
        chroniclePetWitnesses: [...existingWitnesses, ...newlyWitnessed].slice(-PET_WITNESS_LEDGER_CAP),
    };
    const grant = character.starterCardsClaimed === true
        ? grantChronicleProgressionCards(withWitnesses, newlyWitnessed.map((entry) => entry.cardId))
        : { character: withWitnesses, granted: [] as string[] };
    const newlyRecordedPetIds = new Set(newlyWitnessed.map((entry) => entry.petId));
    const newlyPressedCardIds = new Set(grant.granted);
    const livingWitnessProgress = progressDrafts.map((entry): ChroniclePetWitnessProgress => ({
        ...entry,
        deedRecorded: entry.wins >= PET_WITNESS_WIN_THRESHOLD && newlyRecordedPetIds.has(entry.petId),
        cardPressed: entry.wins >= PET_WITNESS_WIN_THRESHOLD && newlyPressedCardIds.has(entry.cardId),
    }));
    const characterWithProgress = livingWitnessProgress.length
        ? {
            ...grant.character,
            chroniclePetArenaProgressReceipts: [
                ...existingProgress,
                ...livingWitnessProgress,
            ].slice(-PET_WITNESS_PROGRESS_RECEIPT_CAP),
        }
        : grant.character;
    return {
        character: characterWithProgress,
        granted: grant.granted,
        witnessed: newlyWitnessed,
        livingWitnessProgress,
    };
}
