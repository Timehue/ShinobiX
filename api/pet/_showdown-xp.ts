import type { ShowdownSession } from '../_pet-showdown/engine.js';
import { gainServerPetXp } from './_progress.js';

/** A paid win shares one small roster budget, under the existing daily win cap.
 * Twenty XP is one fifth of a basic treat; team size never multiplies it. */
export const SHOWDOWN_PARTICIPATION_XP = 20;

export type ShowdownPetXpAward = {
    petId: string;
    xp: number;
    levelBefore: number;
    levelAfter: number;
};

/** Called only inside the winning settlement's save write, after its receipt
 * and daily-cap checks. Participation comes from server-resolved field actions;
 * a selected reserve or a client-supplied id cannot establish eligibility. */
export function grantShowdownParticipationXp(
    character: Record<string, unknown>,
    session: ShowdownSession,
): { character: Record<string, unknown>; awards: ShowdownPetXpAward[]; total: number } {
    if (session.rulesetVersion !== 'progression-v3' || !session.rewardEligible
        || !session.finished || session.outcome !== 'win') {
        return { character, awards: [], total: 0 };
    }
    const pets = Array.isArray(character.pets) ? character.pets as Record<string, unknown>[] : [];
    const participated = new Set(session.participationIds ?? []);
    const owned = new Map(pets.map(pet => [String(pet?.id ?? ''), pet]));
    // Use sealed roster order for deterministic remainder allocation, never
    // action order or a final hit. Filter against the current owned roster so a
    // collected training level-up or ownership change cannot overfill a cap.
    const eligible = [...new Set(session.player.map(pet => pet.id))].filter(id => {
        const pet = owned.get(id);
        const level = Math.max(1, Number(pet?.level) || 1);
        const cap = Math.max(level, Math.min(100, Number(pet?.maxLevel) || 100));
        return participated.has(id) && !!pet && level < cap;
    });
    if (!eligible.length) return { character, awards: [], total: 0 };
    const awards: ShowdownPetXpAward[] = [];
    const updated = new Map<string, Record<string, unknown>>();
    eligible.forEach((id, index) => {
        const pet = owned.get(id)!;
        const xp = Math.floor(SHOWDOWN_PARTICIPATION_XP / eligible.length)
            + (index < SHOWDOWN_PARTICIPATION_XP % eligible.length ? 1 : 0);
        const next = gainServerPetXp(pet, xp);
        updated.set(id, next);
        awards.push({ petId: id, xp, levelBefore: Number(pet.level) || 1, levelAfter: Number(next.level) });
    });
    return {
        character: { ...character, pets: pets.map(pet => updated.get(String(pet?.id ?? '')) ?? pet) },
        awards,
        total: awards.reduce((sum, award) => sum + award.xp, 0),
    };
}
