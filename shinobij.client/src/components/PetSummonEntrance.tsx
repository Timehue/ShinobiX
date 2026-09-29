import { useState, type CSSProperties, type ReactNode } from 'react';

/** DOM counterpart of the Colosseum's Beast Seal release. */
export function PetSummonEntrance({ children, enabled = true, color = '#f0c463' }: { children: ReactNode; enabled?: boolean; color?: string }) {
    const [settled, setSettled] = useState(!enabled);
    return <span className={`pet-summon-entrance${settled ? '' : ' is-summoning'}`} style={{ '--pet-summon-color': color } as CSSProperties}
        onAnimationEnd={event => { if (event.animationName === 'pet-summon-rise') setSettled(true); }}>
        <span className="pet-summon-body">{children}</span>
        {!settled && <img className="pet-summon-card" src="/items/beast-seal-reinforced.webp" alt="" aria-hidden="true" />}
    </span>;
}
