import { useState } from 'react';
import type { TacticsBuild } from '../../../shared/pet-tactics-contract';
import type { Pet } from '../types/pet';
import { petDisplayName } from '../lib/pet';
import { PetTacticsBuildEditor } from './PetTacticsBuildEditor';
import { PetAbilityProgression } from './PetAbilityProgression';
import { petProgressionPresentation } from '../lib/pet-progression-presentation';
import { petLoadoutPreview, type PetLoadoutDraft } from '../lib/pet-loadout-preview';

export function PetRankedTechniques({ pet, onSave, disabled, lockedReason, onOpenRanked, inspector = false }: {
    pet: Pet; onSave: (build: TacticsBuild) => Promise<void>; disabled?: boolean; lockedReason?: string;
    onOpenRanked?: () => void;
    inspector?: boolean;
}) {
    const [draft, setDraft] = useState<PetLoadoutDraft | null>(null);
    const { baseKey, build, unsaved, previewPet, previewingDraft, preferenceState } = petLoadoutPreview(pet, draft);
    if (!build) return <><PetAbilityProgression pet={pet} compact={inspector} /><p>Loadout editing is unavailable for this companion.</p></>;
    const inactivePreferenceIds = petProgressionPresentation(previewPet).savedInactive.map(move => String(move.id));
    return <section className="pet-ranked-techniques">{!inspector && <h3>Battle loadout</h3>}
        {preferenceState === 'default' && <p>No ordinary preferences are saved. Progression currently uses this companion&apos;s native techniques. The editor below offers a default choice that applies only after saving.</p>}
        {unsaved && <p>{previewingDraft ? 'Previewing unsaved preferences.' : 'Unsaved preferences need four legal techniques before they can be previewed.'} Save the loadout to use these choices in future battles.</p>}
        <PetAbilityProgression pet={previewPet} compact={inspector} draftPreferences={previewingDraft} />
        <PetTacticsBuildEditor build={build} name={petDisplayName(pet)} onChange={next => setDraft({ baseKey, build: next })}
            progressionLevel={pet.level}
            inactivePreferenceIds={inactivePreferenceIds}
            preferenceState={preferenceState}
            summaryLabel={inspector ? 'Edit loadout' : undefined} defaultExpanded={!inspector}
            description="Save four preferred ordinary techniques. Progression needs an affordable basic attack: when none is preferred, your native basic takes one ordinary slot and the first three earned preferences fit. Extra and locked choices stay saved. Your native Final Art unlocks at level 20 and stays with your companion. Competitive Tactics uses its separate normalized kit and signature."
            savedBuild={pet.rankedBuild} onSave={onSave} disabled={disabled} lockedReason={lockedReason} />
        {onOpenRanked && <div className="pet-ranked-techniques-navigation">
            <button type="button" disabled={unsaved} onClick={onOpenRanked}>Open ranked Pet Colosseum</button>
            {unsaved && <p className="hint">Save your changes to use this loadout in future battles.</p>}
        </div>}
    </section>;
}
