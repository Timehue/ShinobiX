import type { CSSProperties } from 'react';
import water from '../assets/sectors/water.webp';

type FishingSceneProps = {
    elapsed: number;
    hookAt: number;
    hooked?: boolean;
    reeling?: boolean;
    tension?: number;
    progress?: number;
    outcome?: 'landed' | 'escaped';
    relaxed?: boolean;
};

/** Presentation follows the admitted timeline and replayed line simulation. */
export function FishingScene({ elapsed, hookAt, hooked = false, reeling = false, tension = 35, progress = 0, outcome, relaxed = false }: FishingSceneProps) {
    const biting = !relaxed && !hooked && !outcome && elapsed >= hookAt;
    const approach = Math.min(1, elapsed / Math.max(1, hookAt));
    const struggle = hooked && !outcome;
    const fishX = outcome === 'landed' ? 32 : outcome === 'escaped' ? 112
        : hooked ? 60 - progress * .27 : 83 - approach * 24;
    const fishY = outcome === 'landed' ? 54 : outcome === 'escaped' ? 85
        : hooked ? 68 : 72 - approach * 12;
    const bend = hooked ? Math.min(14, tension * .14) : 0;
    const caption = relaxed ? 'A fish follows the current' : outcome === 'landed' ? 'Catch in reach' : outcome === 'escaped' ? 'Back into the depths'
        : biting ? 'Bite! Set the hook' : hooked ? tension > 80 ? 'Strong pull · release' : tension < 20 ? 'Slack line · reel in' : reeling ? 'Reeling toward shore' : 'Fish pulling · keep control' : 'Watch the float';
    return <div className={`fishing-water${elapsed < 900 ? ' casting' : ''}${biting ? ' biting' : ''}${hooked ? ' hooked' : ''}${reeling ? ' reeling' : ''}${outcome ? ` ${outcome}` : ''}${tension > 80 ? ' strained' : ''}`}
        style={{ '--fishing-scene': `url(${water})`, '--fish-x': `${fishX}%`, '--fish-y': `${fishY}%`, '--fish-angle': `${outcome === 'landed' ? -18 : reeling ? -6 : 4}deg`, '--tail-speed': struggle ? reeling ? '.24s' : '.38s' : '.85s' } as CSSProperties} aria-hidden="true">
        <div className="fishing-depth" />
        <span className="fishing-scene-caption">{caption}</span>
        <svg className="fishing-tackle" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path className="fishing-underwater-line" d={hooked ? `M49 41 Q${reeling ? fishX : fishX + 12} ${reeling ? 50 : 65} ${fishX} ${fishY}` : 'M49 41 Q52 55 50 72'} />
            <path className="fishing-rod" d={`M3 100 Q17 35 ${36 + bend} ${12 + bend} Q18 39 5 100Z`} />
            <path className="fishing-grip" d="M4 98 10 76" />
            <path className="fishing-binding" d="M5 94 7 95M6 89 8 90M7 84 9 85M8 79 10 80" />
            <ellipse className="fishing-spool" cx="9" cy="87" rx="2" ry="4" />
            <path className="fishing-cord" d={`M${36 + bend} ${12 + bend} Q48 ${reeling ? 30 : 34} 49 41`} />
            {elapsed < 900 && <path className="fishing-cast-arc" pathLength="1" d="M36 12 Q80 -15 49 41" />}
        </svg>
        <span className="fishing-ripple"/><span className="fishing-ripple fishing-ripple--outer"/><span className="fishing-float"/>
        <svg className="fishing-fish" viewBox="0 0 170 80">
            <g className="fishing-fish-tail"><image href="/items/fishing-river-fish-tail.svg" width="170" height="80" /></g>
            <image href="/items/fishing-river-fish-body.svg" width="170" height="80" />
        </svg>
        {(hooked || biting) && <span key={outcome ?? (hooked ? 'hooked' : 'bite')} className="fishing-splash"/>}
        {biting && <span className="fishing-bite-cue">BITE</span>}
    </div>;
}
