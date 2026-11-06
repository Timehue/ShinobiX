import type { HollowGateFissureState } from '../lib/hollow-gate-arena';

/**
 * A boss-arena fissure, drawn with the painted cave decals (public/underground,
 * provenance in shinobij.client/art-source/hollow-gate-cavern-chambers.json): the cracked floor
 * always, with the painted eruption faded in as the rhythm warns and erupts.
 */
export function HollowGateFissureArt({ state }: { state: HollowGateFissureState }) {
    return <span className={`hg-fissure is-${state}`} aria-hidden="true">
        <img src="/underground/cavern-fissure-calm-v1.webp" alt="" draggable={false} />
        <img className="hg-fissure-fire" src="/underground/cavern-fissure-erupting-v1.webp" alt="" draggable={false} />
    </span>;
}
