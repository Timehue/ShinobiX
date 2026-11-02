// The discipline used to label a player's own damage effects across the jutsu
// screens (Profile lens default + overview, Training Hall, combat inspect).
// An equipped bloodline's own jutsu decide it: equipping never rewrites the
// starter `bloodline` or `specialty`, so a custom kit must be read from its
// techniques. Screens without the stored kits use the server's stamp of the same
// answer. Then the starter bloodline, then specialty; "Any"/missing → Ninjutsu.
import type { Character } from '../types/character';
import type { SavedBloodline } from '../types/combat';
import { starterBloodlineOffense } from '../data/jutsu';
import { isCombatDiscipline } from '../../../shared/bloodline-discipline';
import { bloodlineDisciplineCounts, leadingBloodlineDiscipline, type CombatDiscipline } from './bloodline';

export function playerLensDiscipline(
    character: Pick<Character, 'bloodline' | 'equippedBloodlineId' | 'equippedDiscipline' | 'specialty'>,
    savedBloodlines: SavedBloodline[] = [],
): CombatDiscipline {
    const equipped = savedBloodlines.find((bloodline) => bloodline.id === character.equippedBloodlineId);
    const fromEquipped = leadingBloodlineDiscipline(bloodlineDisciplineCounts(equipped), character.specialty);
    if (fromEquipped) return fromEquipped;
    if (isCombatDiscipline(character.equippedDiscipline)) return character.equippedDiscipline;
    const fromBloodline = starterBloodlineOffense[character.bloodline];
    if (fromBloodline && fromBloodline !== "Any") return fromBloodline;
    return character.specialty && character.specialty !== "Any" ? character.specialty : "Ninjutsu";
}
