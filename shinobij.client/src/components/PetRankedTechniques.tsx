import { useState } from 'react';
import type { TacticsBuild } from '../../../shared/pet-tactics-contract';
import { rankedBuildForPet, sameTacticsBuild } from '../../../shared/pet-tactics-build';
import type { Pet } from '../types/pet';
import { petDisplayName } from '../lib/pet';
import { PetTacticsBuildEditor } from './PetTacticsBuildEditor';

export function PetRankedTechniques({ pet, onSave, disabled, lockedReason, onOpenRanked, inspector = false }: {
    pet: Pet; onSave: (build: TacticsBuild) => Promise<void>; disabled?: boolean; lockedReason?: string;
    onOpenRanked?: () => void;
    inspector?: boolean;
}) {
    const committed = rankedBuildForPet(pet);
    const baseKey = JSON.stringify(committed);
    const [draft, setDraft] = useState<{ baseKey: string; build: TacticsBuild } | null>(null);
    if (!committed) return <p>Loadout editing is unavailable for this companion.</p>;
    const build = draft?.baseKey === baseKey ? draft.build : committed;
    const unsaved = !sameTacticsBuild(committed, build);
    return <section className="pet-ranked-techniques">{!inspector && <h3>Battle loadout</h3>}
        <PetTacticsBuildEditor build={build} name={petDisplayName(pet)} onChange={next => setDraft({ baseKey, build: next })}
            summaryLabel={inspector ? 'Edit loadout' : undefined} defaultExpanded={!inspector}
            description="Choose four abilities for all battles, including PvE summons from pet level 50. Your signature is always equipped. Effects and costs follow each mode’s rules."
            savedBuild={pet.rankedBuild} onSave={onSave} disabled={disabled} lockedReason={lockedReason} />
        {onOpenRanked && <div className="pet-ranked-techniques-navigation">
            <button type="button" disabled={unsaved} onClick={onOpenRanked}>Open ranked Pet Colosseum</button>
            {unsaved && <p className="hint">Save your changes to use this loadout in future battles.</p>}
        </div>}
    </section>;
}
