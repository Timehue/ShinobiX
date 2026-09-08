// The discipline used to label a player's own damage effects across the jutsu
// screens (Profile lens default + overview, Training Hall, combat inspect).
// Derives from the chosen bloodline, then specialty; "Any"/missing → Ninjutsu.
import type { Character } from '../types/character';
import type { JutsuType } from '../types/core';
import { starterBloodlineOffense } from '../data/jutsu';

export function playerLensDiscipline(character: Character): JutsuType {
    const fromBloodline = starterBloodlineOffense[character.bloodline];
    if (fromBloodline && fromBloodline !== "Any") return fromBloodline;
    return character.specialty && character.specialty !== "Any" ? character.specialty : "Ninjutsu";
}
