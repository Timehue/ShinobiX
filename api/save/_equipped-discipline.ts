import { bloodlineDisciplineCounts, leadingBloodlineDiscipline } from '../../shared/bloodline-discipline.js';

/**
 * Publishes the equipped custom bloodline's discipline for public lists. It is
 * display-only: `specialty` stays what combat and stat credit read. The server
 * derives it from the stored kit on every save, so a client cannot set it.
 */
export function stampEquippedDiscipline(character: Record<string, unknown>, savedBloodlines: unknown): void {
    delete character.equippedDiscipline;
    const stored = Array.isArray(savedBloodlines) ? savedBloodlines as Array<Record<string, unknown> | null> : [];
    const equipped = character.equippedBloodlineId
        ? stored.find((bloodline) => bloodline?.id === character.equippedBloodlineId)
        : undefined;
    if (!Array.isArray(equipped?.jutsus)) return;
    const jutsus = equipped.jutsus.filter((jutsu) => jutsu && typeof jutsu === 'object');
    const discipline = leadingBloodlineDiscipline(bloodlineDisciplineCounts({ jutsus }), character.specialty);
    if (discipline) character.equippedDiscipline = discipline;
}
