export const PET_GAUNTLET_FREE_RUNS = 1;
export const PET_GAUNTLET_ENTRY_FEE = 1_500;

export type GauntletEntryCharacter = {
    ryo?: unknown;
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
    return count < PET_GAUNTLET_FREE_RUNS ? 0 : PET_GAUNTLET_ENTRY_FEE;
}

export function debitGauntletEntry(character: GauntletEntryCharacter, day: string):
    { ok: true; character: GauntletEntryCharacter; charged: number } | { ok: false; required: number } {
    const ryo = whole(character.ryo);
    const count = character.petGauntletEntryDate === day ? whole(character.petGauntletEntryCount) : 0;
    const charged = count < PET_GAUNTLET_FREE_RUNS ? 0 : PET_GAUNTLET_ENTRY_FEE;
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
