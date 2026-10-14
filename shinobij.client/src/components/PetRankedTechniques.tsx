import { useState } from 'react';
import type { TacticsBuild } from '../../../shared/pet-tactics-contract';
import { rankedBuildForPet, sameTacticsBuild } from '../../../shared/pet-tactics-build';
import type { Pet } from '../types/pet';
import { petDisplayName } from '../lib/pet';
import { PetTacticsBuildEditor } from './PetTacticsBuildEditor';

export function PetRankedTechniques({ pet, onSave, disabled, lockedReason, onOpenRanked }: {
    pet: Pet; onSave: (build: TacticsBuild) => Promise<void>; disabled?: boolean; lockedReason?: string;
    onOpenRanked?: () => void;
}) {
    const committed = rankedBuildForPet(pet);
    const baseKey = JSON.stringify(committed);
    const [draft, setDraft] = useState<{ baseKey: string; build: TacticsBuild } | null>(null);
    if (!committed) return <p>Ranked techniques are unavailable for this companion.</p>;
    const build = draft?.baseKey === baseKey ? draft.build : committed;
    const unsaved = !sameTacticsBuild(committed, build);
    return <section className="pet-ranked-techniques"><h3>Ranked battle loadout</h3>
        <p>Choose the techniques {petDisplayName(pet)} takes into the Pet Colosseum. Your saved choices also appear in the ranked squad screen, where you can adjust them before a match.</p>
        <PetTacticsBuildEditor build={build} name={petDisplayName(pet)} onChange={next => setDraft({ baseKey, build: next })}
            savedBuild={pet.rankedBuild} onSave={onSave} disabled={disabled} lockedReason={lockedReason} />
        {onOpenRanked && <div className="pet-ranked-techniques-navigation">
            <button type="button" disabled={unsaved} onClick={onOpenRanked}>Open ranked Pet Colosseum</button>
            {unsaved && <p className="hint">Save your changes to bring this loadout into ranked.</p>}
        </div>}
    </section>;
}
