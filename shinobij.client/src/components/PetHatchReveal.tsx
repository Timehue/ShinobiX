import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import hatchSanctum from '../assets/pet-home/hatch-sanctum.webp';
import rareOverlay from '../assets/pet-home/hatch-rare-overlay.webp';
import chromaticOverlay from '../assets/pet-home/hatch-chromatic-overlay.webp';
import { petDisplayName } from '../lib/pet';
import { petScenicPortraitImage } from '../lib/pet-scenic-portrait';
import { petVisualVariantClass } from '../lib/pet-visual-variant';
import { playPetSfx } from '../lib/pet-sfx';
import { petTraitDescriptions, ultraPetTraits } from '../data/pet-config';
import type { Pet } from '../types/pet';
import '../styles/pet-home.css';

/** The existing hatch cinematic, shared by the global deferred hatch queue. */
export function PetHatchReveal({ pet, sharedImages, onClose, busy, error }: {
    pet: Pet; sharedImages: Record<string, string>; onClose: () => void; busy?: boolean; error?: string;
}) {
    const modal = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose); closeRef.current = onClose;
    const apex = pet.trait && ultraPetTraits.includes(pet.trait) ? pet.trait : null;
    const art = petScenicPortraitImage(pet, sharedImages);
    useEffect(() => {
        const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        modal.current?.querySelector('button')?.focus();
        playPetSfx('victory');
        const sting = pet.paletteVariantId || apex ? window.setTimeout(() => playPetSfx('superEffective'), 420) : undefined;
        function key(event: KeyboardEvent) {
            if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
            if (event.key === 'Tab') { event.preventDefault(); modal.current?.querySelector('button')?.focus(); }
        }
        document.addEventListener('keydown', key);
        return () => { window.clearTimeout(sting); document.removeEventListener('keydown', key); if (priorFocus?.isConnected) priorFocus.focus(); };
    }, [pet.id, pet.paletteVariantId, apex]);
    return createPortal(<div className="pet-home-modal-backdrop hatch-cinematic" data-pet-hatch-reveal><div ref={modal}
        className={`pet-home-modal hatch-reveal ${petVisualVariantClass(pet)}${apex ? ' hatch-reveal--apex' : ''}`}
        role="dialog" aria-modal="true" aria-labelledby="hatch-title" aria-describedby="hatch-summary" tabIndex={-1}>
        <img className="hatch-sanctum" src={hatchSanctum} alt="" />
        <img className={`hatch-aura ${pet.paletteVariantId ? 'hatch-aura--chromatic' : 'hatch-aura--rare'}`}
            src={pet.paletteVariantId ? chromaticOverlay : rareOverlay} alt="" />
        <span className="pet-home-kicker">Bond awakened</span><h3 id="hatch-title">{petDisplayName(pet)}</h3>
        <div className="hatch-pet-stage">{art ? <img className="hatch-pet" src={art} alt={petDisplayName(pet)} />
            : <span className="hatch-pet-fallback">{petDisplayName(pet).split(/\s+/).map(word => word[0]).join('').slice(0, 2)}</span>}</div>
        <p id="hatch-summary">{pet.rarity} · {pet.element} · {pet.trait} · Generation {pet.generation}</p>
        {apex && <><strong className="apex-trait-ribbon">Apex trait · {apex}</strong><small className="apex-trait-copy">{petTraitDescriptions[apex]}</small></>}
        {pet.paletteVariantId && <strong className="chromatic-ribbon">Chromatic miracle</strong>}
        <p className="hatch-sanctuary-note">Your new companion is resting safely in Sanctuary.</p>
        {error && <p role="alert">{error}</p>}
        <button type="button" className="pet-home-primary" disabled={busy} onClick={onClose}>{busy ? 'Saving…' : 'Welcome home'}</button>
    </div></div>, document.body);
}
