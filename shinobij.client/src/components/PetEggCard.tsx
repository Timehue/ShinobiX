import { useEffect, useState } from 'react';
import eggFire from '../assets/pet-home/egg-fire.webp';
import eggWater from '../assets/pet-home/egg-water.webp';
import eggWind from '../assets/pet-home/egg-wind.webp';
import eggLightning from '../assets/pet-home/egg-lightning.webp';
import eggEarth from '../assets/pet-home/egg-earth.webp';
import { formatBreedingDuration } from '../lib/pet-breeding';
import type { PetBreedingSession } from '../types/pet';

const EGGS: Record<string, string> = { Fire: eggFire, Water: eggWater, Wind: eggWind, Lightning: eggLightning, Earth: eggEarth };
export function PetEggCard({ session }: { session: PetBreedingSession }) {
    const [clock, setClock] = useState({ key: '', elapsed: 0 });
    const key = `${session.sessionId}:${session.incubationUpdatedAt}:${session.incubationRemainingMs}`;
    useEffect(() => {
        let last = performance.now(), elapsed = 0;
        const interval = window.setInterval(() => {
            const now = performance.now();
            if (!document.hidden && document.hasFocus()) elapsed += Math.min(1500, now - last);
            last = now; setClock({ key, elapsed });
        }, 1000);
        return () => window.clearInterval(interval);
    }, [key]);
    const remaining = Math.max(0, (session.incubationRemainingMs ?? 0) - (clock.key === key ? clock.elapsed : 0));
    return <article className="egg-nursery sanctuary-egg" aria-label={`${session.parentElement} egg in Sanctuary`}>
        <div className="egg-stage"><img src={EGGS[session.parentElement] ?? eggEarth} alt={`${session.parentElement} companion egg`} /><span>{session.parentElement} egg</span></div>
        <div><h3>Sanctuary incubation</h3><time className="breeding-countdown" aria-label="Gameplay time remaining">{formatBreedingDuration(remaining)}</time>
            <p>12 hours of gameplay. Time pauses when the game is closed or in the background.</p>
            <p>{remaining <= 0 ? 'Ready to hatch. The reveal will wait until your current battle or event finishes.' : 'The hatch reveal begins automatically when incubation finishes, after any battle or event.'}</p></div>
    </article>;
}
