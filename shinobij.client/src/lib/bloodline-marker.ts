/*
 * Which jutsu get the violet "Bloodline" marker in the UI, and which bloodline
 * to name on it. Shared by the Profile Jutsu tab (JutsuLoadoutPanel) and the
 * Jutsu Training Hall (JutsuDropdownList) so the two screens cannot disagree.
 *
 * DISPLAY ONLY. Whether a jutsu may be trained or equipped is decided by
 * canEquipElementJutsu (lib/bloodline.ts) on the client and by
 * api/pvp/_bloodline-gate.ts on the server; nothing here grants or denies access.
 *
 * Leaf module (types only) so components can import it without pulling in the
 * jutsu tables that lib/bloodline.ts depends on.
 */
import type { Jutsu, SavedBloodline } from "../types/combat";

/**
 * Jutsu id -> the name of the bloodline that grants it, for the bloodlines the
 * character carries. Pass getCharacterBloodlines(character, savedBloodlines)
 * (starter + equipped). When two bloodlines carry the same jutsu, the first wins.
 */
export function bloodlineNamesByJutsuId(
    bloodlines: readonly Pick<SavedBloodline, "name" | "jutsus">[],
): Map<string, string> {
    const names = new Map<string, string>();
    for (const bloodline of bloodlines) {
        for (const jutsu of bloodline.jutsus) {
            if (!names.has(jutsu.id)) names.set(jutsu.id, bloodline.name);
        }
    }
    return names;
}

/**
 * Does this jutsu carry the bloodline marker? Yes when one of the character's
 * own bloodlines carries it (which is also the only way its NAME is known), or
 * when getAllJutsus stamped `bloodlineRank` on it, which it does for every
 * bloodline kit it merges, including an admin-authored jutsu from a bloodline
 * this character does not have.
 */
export function hasBloodlineMarker(
    jutsu: Pick<Jutsu, "id" | "bloodlineRank">,
    names: ReadonlyMap<string, string>,
): boolean {
    return names.has(jutsu.id) || Boolean(jutsu.bloodlineRank);
}
