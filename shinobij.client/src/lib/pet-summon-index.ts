import { PET_SUMMON_ROWS } from "../generated/pet-summon-sprites";

const kinds: Record<string, string> = { f: "flying", h: "humanoid", q: "quadruped", s: "serpentine" };
export const PET_SUMMON_KINDS = new Map<string, string>();
export const LEFT_FACING_PETS = new Set<string>();

for (const [family, forms] of Object.entries(PET_SUMMON_ROWS)) {
    for (const [index, code] of [...forms].entries()) {
        const id = family.startsWith("starter-") ? family + ["", "-r", "-l"][index] : `${family}-${index}`;
        const kind = code.toLowerCase();
        PET_SUMMON_KINDS.set(id, kinds[kind]);
        if (code === kind) LEFT_FACING_PETS.add(id);
    }
}
