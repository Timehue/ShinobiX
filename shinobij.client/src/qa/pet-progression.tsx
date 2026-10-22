/** Local-only UI fixture. No account, network persistence or battle settlement. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PetRankedTechniques } from '../components/PetRankedTechniques';
import { tacticsPreset } from '../../../shared/pet-tactics-roster';
import type { Pet } from '../types/pet';
import type { TacticsBuild } from '../../../shared/pet-tactics-contract';
import '../styles/tokens.css';

export function ProgressionReview() {
    const [level, setLevel] = useState(1);
    const [rankedBuild, setRankedBuild] = useState<TacticsBuild | undefined>({ ...tacticsPreset('starter-water'), ownedPetId: 'starter-water-review' });
    const pet: Pet = { id: 'starter-water-review', templateId: 'starter-water', name: 'Brook Turtle', rarity: 'standard',
        level, maxLevel: 100, xp: 0, role: 'sage', hp: 400, attack: 60, defense: 65, speed: 45,
        unlockedForPve: true, jutsus: [], rankedBuild,
    };
    return <main style={{ maxWidth: 820, margin: '0 auto', padding: 16 }}><h1>Companion progression review</h1>
        <label>Preview level <select aria-label="Preview level" value={level} onChange={event => setLevel(Number(event.target.value))} style={{ minHeight: 44, margin: 12 }}>
            {[1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 74, 75, 100].map(value => <option key={value}>{value}</option>)}
        </select></label>
        <PetRankedTechniques pet={pet} onSave={async build => { setRankedBuild(build); }} />
        <button type="button" onClick={() => setRankedBuild(undefined)}>Preview companion without saved preferences</button>
        <output id="saved-loadout" hidden>{JSON.stringify(rankedBuild ?? null)}</output>
    </main>;
}
document.body.style.cssText = 'margin:0;background:#0d141e;color:#f5ebd6;font-family:system-ui,sans-serif';
createRoot(document.getElementById('root')!).render(<ProgressionReview />);
