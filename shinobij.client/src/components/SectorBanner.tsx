/*
 * Static side-panel banner displayed alongside the world map. Pure
 * decoration; the image asset is the only "data" it carries.
 */

import { memo } from "react";
import sectorBanner from "../assets/sectorbanner.png";

// Static — never needs to re-render after first mount. memo'd so parent
// state churn doesn't even diff the unchanged props.
export const SectorBanner = memo(function SectorBanner() {
    return (
        <aside className="sector-banner-panel">
            <img src={sectorBanner} alt="Sector Banner" className="sector-banner-img" />
        </aside>
    );
});
