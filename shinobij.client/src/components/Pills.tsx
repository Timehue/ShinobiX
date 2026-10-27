/*
 * Tiny in-line pill used by various screens.
 *
 *   • VillagePill — village panorama thumbnail + name on a dark capsule,
 *     used in the Shinobi Council Hall war cards.
 *
 * Pure presentational. VillagePill depends on the shared village image helper.
 * No closures captured.
 */

import { villagePageImage } from "../lib/village-page-image";

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
