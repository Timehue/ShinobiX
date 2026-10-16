// Local art review entry. Uses the production identity component and resolver.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CompanionIdentity } from './components/CompanionIdentity';
import { petPoseImage } from './lib/pet-battle-anim';
import { petScenicPortraitImage } from './lib/pet-scenic-portrait';
import { PET_SCENIC_PORTRAITS } from './lib/pet-portrait-assets.generated';
import { PET_SHOWDOWN_ANIMATION_MODEL_IDS } from './lib/pet-showdown-animation-assets';
import { STARTER_PETS } from './data/starter-pets';
import { STARTER_EVOLUTIONS } from './data/pet-evolutions';
import { rawPetPool } from './data/pet-pool';
import { petElementByName } from './data/pet-elements';
import './styles/pet-home.css';
import './pet-portrait-preview.css';

const catalog = [...STARTER_PETS.map(({ pet }) => pet), ...STARTER_EVOLUTIONS, ...rawPetPool.map((pet) => ({ ...pet, element: pet.element || petElementByName[pet.name] }))];

function Review() {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(() => {
        const requested = new URLSearchParams(location.search).get('pet');
        return catalog.some((item) => item.id === requested) ? requested! : 'starter-fire';
    });
    const completed = catalog.filter((pet) => PET_SCENIC_PORTRAITS[pet.id]);
    const shown = completed.filter((pet) => `${pet.id} ${pet.name} ${pet.rarity}`.toLowerCase().includes(query.toLowerCase()));
    const pet = catalog.find((item) => item.id === selected)!;
    const modelAtlas = pet.id.startsWith('starter-') ? null : `/pet-models/warfront-impostors/${PET_SHOWDOWN_ANIMATION_MODEL_IDS.has(pet.id) ? 'showdown-v2' : 'roster'}/${pet.id}.webp`;
    return <main className="portrait-review">
        <header><p>Shinobi Journey / Companion art</p><h1>Portrait collection</h1><label>Find a companion <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, rarity or identity" /></label><output data-testid="coverage">{completed.length} / {catalog.length} portraits</output></header>
        <section className="portrait-comparison" aria-label="Character fidelity comparison">
            <figure><img src={petScenicPortraitImage(pet)} alt={`${pet.name}, new portrait`} /><figcaption>{pet.name} / Finished portrait</figcaption></figure>
            <figure><img src={petPoseImage(pet)} alt={`${pet.name}, original battle cutout`} /><figcaption>Original battle art / Preserved</figcaption></figure>
            {modelAtlas && <figure><img src={modelAtlas} alt={`${pet.name}, current model pose reference`} /><figcaption>Current model reference / Preserved</figcaption></figure>}
        </section>
        <section className="portrait-review-grid" aria-label="Portrait cards">{shown.map((item) => <button key={item.id} className={`companion-card portrait-review-card rarity-${item.rarity}`} onClick={() => setSelected(item.id)} data-portrait-id={item.id}>
            <CompanionIdentity pet={item} sharedImages={{}} loading="eager" />
            <span className="portrait-review-context">{item.id.startsWith('starter-') ? 'Starter companion' : 'Wild companion'}</span>
        </button>)}</section>
    </main>;
}

createRoot(document.getElementById('root')!).render(<Review />);
