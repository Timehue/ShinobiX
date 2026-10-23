import { PET_GAUNTLET_ENTRY_FEE_AT_CAP, petGauntletRyoSchedule } from '../../shared/pet-gauntlet-economy.js';

export const PET_GAUNTLET_FREE_RUNS = 1;
/** The paid-entry fee from L70; below that it scales with A(L) (shared/pet-gauntlet-economy.ts). */
export const PET_GAUNTLET_ENTRY_FEE = PET_GAUNTLET_ENTRY_FEE_AT_CAP;

export type GauntletEntryCharacter = {
    ryo?: unknown;
    level?: unknown;
    petGauntletEntryDate?: unknown;
    petGauntletEntryCount?: unknown;
    [key: string]: unknown;
};

const whole = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

export function gauntletEntryCost(character: GauntletEntryCharacter, day: string): number {
    const count = character.petGauntletEntryDate === day ? whole(character.petGauntletEntryCount) : 0;
    return count < PET_GAUNTLET_FREE_RUNS ? 0 : petGauntletRyoSchedule(character.level).entryFee;
}

export function debitGauntletEntry(character: GauntletEntryCharacter, day: string):
    { ok: true; character: GauntletEntryCharacter; charged: number } | { ok: false; required: number } {
    const ryo = whole(character.ryo);
    const count = character.petGauntletEntryDate === day ? whole(character.petGauntletEntryCount) : 0;
    const charged = gauntletEntryCost(character, day);
    if (ryo < charged) return { ok: false, required: charged };
    return {
        ok: true,
        charged,
        character: {
            ...character,
            ryo: ryo - charged,
            petGauntletEntryDate: day,
            petGauntletEntryCount: count + 1,
        },
    };
}
