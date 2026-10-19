import { rankedBuildForPet, sameTacticsBuild, tacticsBuildIssue } from '../../../shared/pet-tactics-build';
import type { TacticsBuild } from '../../../shared/pet-tactics-contract';
import type { Pet } from '../types/pet';

export type PetLoadoutDraft = { baseKey: string; build: TacticsBuild };

/** An editor preset is a choice to save, not an owned preference. Keep current
 * native admission visible until a matching, valid local draft is edited. */
export function petLoadoutPreview(pet: Pet, draft: PetLoadoutDraft | null = null) {
    const committed = rankedBuildForPet(pet);
    const baseKey = JSON.stringify({ petId: pet.id, hasSavedBuild: pet.rankedBuild != null, build: committed });
    const matchingDraft = draft?.baseKey === baseKey ? draft : null;
    const build = matchingDraft?.build ?? committed;
    const unsaved = !!matchingDraft && (!pet.rankedBuild || !sameTacticsBuild(committed, build));
    const previewingDraft = unsaved && !!build && tacticsBuildIssue(build) === null;
    return { committed, baseKey, build, unsaved, previewingDraft,
        previewPet: previewingDraft ? { ...pet, rankedBuild: build! } : pet,
        preferenceState: !matchingDraft && !pet.rankedBuild ? 'default' as const : unsaved ? 'draft' as const : 'saved' as const,
    };
}
