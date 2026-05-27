/*
 * Static side-panel banner displayed alongside the world map. Pure
 * decoration; the image asset is the only "data" it carries.
 */

import sectorBanner from "../assets/sectorbanner.png";

export function SectorBanner() {
    return (
        <aside className="sector-banner-panel">
            <img src={sectorBanner} alt="Sector Banner" className="sector-banner-img" />
        </aside>
    );
}
