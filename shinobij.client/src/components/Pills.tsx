/*
 * Tiny in-line pills / portraits used by various screens.
 *
 *   • FestivalPortrait — NPC bust shown in the Sunscar Festival screen.
 *   • VillagePill — village panorama thumbnail + name on a dark capsule,
 *     used in the Shinobi Council Hall war cards.
 *
 * Pure presentational. VillagePill depends on villagePageImage which still
 * lives in App.tsx as a const exported function; we import it from there.
 * No closures captured.
 */

import { villagePageImage } from "../App";

export function FestivalPortrait({
    image,
    icon,
    name,
}: { image?: string; icon: string; name: string }) {
    return image
        ? <img className="sunscar-portrait" src={image} alt={name} />
        : <div className="sunscar-npc" aria-label={name}>{icon}</div>;
}

export function VillagePill({
    village,
    highlight = false,
}: { village: string; highlight?: boolean }) {
    if (!village) return null;
    return (
        <span className={`village-pill${highlight ? " village-pill-mine" : ""}`}>
            <img className="village-pill-thumb" src={villagePageImage(village)} alt="" aria-hidden="true" />
            <span className="village-pill-name">{village}</span>
        </span>
    );
}
