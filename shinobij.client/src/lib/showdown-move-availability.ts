import type { ShowdownPetView } from '../../../shared/pet-showdown-contract';

/** Read server gates without deriving battle effects or cooldowns locally. */
export function showdownMoveAvailability(move: ShowdownPetView['moves'][number], pet: Pick<ShowdownPetView, 'level' | 'readiness'>, commandRound: number) {
    if (move.abilityId === 'unavailable:signature') return { blocked: true, label: 'Unavailable', reason: 'This companion has no signature available in this sealed battle.' };
    if (move.unlockLevel != null && pet.level < move.unlockLevel) return { blocked: true, label: `Lv ${move.unlockLevel}`, reason: `Unlocks at level ${move.unlockLevel}.` };
    if (move.availableAtRound != null && move.availableAtRound > commandRound) return { blocked: true, label: `R${move.availableAtRound}`, reason: `Available again from round ${move.availableAtRound}.` };
    if (move.hold > pet.readiness) return { blocked: true, label: 'Charging', reason: `Needs ${move.hold - pet.readiness} more battle ${move.hold - pet.readiness === 1 ? 'round' : 'rounds'} before use.` };
    return { blocked: false, label: undefined, reason: undefined };
}
