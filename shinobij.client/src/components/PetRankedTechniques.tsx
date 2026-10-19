import { useState } from 'react';
import type { TacticsBuild } from '../../../shared/pet-tactics-contract';
import { rankedBuildForPet, sameTacticsBuild } from '../../../shared/pet-tactics-build';
import type { Pet } from '../types/pet';
import { petDisplayName } from '../lib/pet';
import { PetTacticsBuildEditor } from './PetTacticsBuildEditor';
import { PetAbilityProgression } from './PetAbilityProgression';
import { petProgressionPresentation } from '../lib/pet-progression-presentation';

export function PetRankedTechniques({ pet, onSave, disabled, lockedReason, onOpenRanked, inspector = false }: {
    pet: Pet; onSave: (build: TacticsBuild) => Promise<void>; disabled?: boolean; lockedReason?: string;
    onOpenRanked?: () => void;
    inspector?: boolean;
}) {
    const committed = rankedBuildForPet(pet);
    const baseKey = JSON.stringify(committed);
    const [draft, setDraft] = useState<{ baseKey: string; build: TacticsBuild } | null>(null);
    if (!committed) return <><PetAbilityProgression pet={pet} compact={inspector} /><p>Loadout editing is unavailable for this companion.</p></>;
    const build = draft?.baseKey === baseKey ? draft.build : committed;
    const unsaved = !sameTacticsBuild(committed, build);
    const previewPet = { ...pet, rankedBuild: build };
    const inactivePreferenceIds = petProgressionPresentation(previewPet).savedInactive.map(move => String(move.id));
    return <section className="pet-ranked-techniques">{!inspector && <h3>Battle loadout</h3>}
        {unsaved && <p>Previewing unsaved preferences. Save the loadout to use these choices in future battles.</p>}
        <PetAbilityProgression pet={previewPet} compact={inspector} />
        <PetTacticsBuildEditor build={build} name={petDisplayName(pet)} onChange={next => setDraft({ baseKey, build: next })}
            progressionLevel={pet.level}
            inactivePreferenceIds={inactivePreferenceIds}
            summaryLabel={inspector ? 'Edit loadout' : undefined} defaultExpanded={!inspector}
            description="Save four preferred ordinary techniques. Progression needs an affordable basic attack: when none is preferred, your native basic takes one ordinary slot and the first three earned preferences fit. Extra and locked choices stay saved. Your native Final Art unlocks at level 20 and stays with your companion. Competitive Tactics uses its separate normalized kit and signature."
            savedBuild={pet.rankedBuild} onSave={onSave} disabled={disabled} lockedReason={lockedReason} />
        {onOpenRanked && <div className="pet-ranked-techniques-navigation">
            <button type="button" disabled={unsaved} onClick={onOpenRanked}>Open ranked Pet Colosseum</button>
            {unsaved && <p className="hint">Save your changes to use this loadout in future battles.</p>}
        </div>}
    </section>;
}
