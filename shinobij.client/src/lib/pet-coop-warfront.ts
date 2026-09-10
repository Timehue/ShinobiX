import type { ArenaSlot } from "./pet-arena-sim";

export type CoopWarfrontMatch = { seed: number; blue: ArenaSlot[]; red: ArenaSlot[] };

/** Old lobby documents stored fallback roles on the slot. The formation engine
 * reads the pet itself, so retain that sealed role when adapting the replay. */
export function normalizeCoopWarfrontMatch(match: CoopWarfrontMatch): CoopWarfrontMatch {
    const band = (slots: ArenaSlot[]): ArenaSlot[] => slots.map((slot) => ({
        ...slot,
        pet: { ...slot.pet, role: slot.pet.role ?? slot.role, jutsus: slot.pet.jutsus ?? [] },
    }));
    return { ...match, blue: band(match.blue), red: band(match.red) };
}
