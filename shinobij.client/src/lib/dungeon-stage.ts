import type { Character } from '../types/character';

export type DungeonStage = 'intro' | 'tile' | 'pet' | 'complete';

type ActiveDungeonRun = NonNullable<Character['activeDungeonRun']>;

const WARDEN_PROOF_RE = /^[A-Za-z0-9]{8,96}$/;
const ENCOUNTER_PROOF_RE = /^[A-Za-z0-9_-]{8,96}$/;

function hasWardenWin(run: ActiveDungeonRun): boolean {
    return run.combatAuthorityVersion === 1
        && run.wardenDefeated === true
        && typeof run.wardenProofId === 'string'
        && WARDEN_PROOF_RE.test(run.wardenProofId);
}

function hasCardWin(run: ActiveDungeonRun): boolean {
    return run.cardAuthorityVersion === 1
        && run.cardDefeated === true
        && run.cardLastOutcome === 'player'
        && Number.isFinite(run.cardSettledAt)
        && Number.isFinite(run.cardDefeatedAt)
        && typeof run.cardProofId === 'string'
        && ENCOUNTER_PROOF_RE.test(run.cardProofId)
        && run.cardLastProofId === run.cardProofId;
}

function hasPetWin(run: ActiveDungeonRun): boolean {
    const petIds = Array.isArray(run.petLastPetIds) ? run.petLastPetIds : [];
    return run.petAuthorityVersion === 1
        && run.petDefeated === true
        && run.petLastOutcome === 'win'
        && Number.isFinite(run.petSettledAt)
        && Number.isFinite(run.petDefeatedAt)
        && typeof run.petProofId === 'string'
        && ENCOUNTER_PROOF_RE.test(run.petProofId)
        && run.petLastProofId === run.petProofId
        && petIds.length > 0
        && petIds.length <= 4
        && petIds.every((petId) => /^[A-Za-z0-9:_-]{1,128}$/.test(petId))
        && new Set(petIds).size === petIds.length;
}

/** Reconstruct the next Dungeon screen from server-owned evidence after a
 * refresh or device change. `complete` means the Pet seal is proved and the
 * reward remains claimable; only /api/dungeon/run clears the active run. */
export function resolveDungeonStage(run: Character['activeDungeonRun'] | undefined): DungeonStage {
    if (!run || !hasWardenWin(run)) return 'intro';
    if (!hasCardWin(run)) return 'tile';
    if (!hasPetWin(run)) return 'pet';
    return 'complete';
}
