import type { CSSProperties } from "react";
import { FACILITY_PRESENTATION, type FacilityId } from "../lib/facility-presentation";
import { facilityThumb } from "../lib/facility-thumbs";

export function VillageFacilityTile({ id, village, preload, position, disabled, enter }: {
    id: FacilityId; village: string; preload?: () => void; position?: number[]; disabled?: boolean; enter: () => void;
}) {
    const site = FACILITY_PRESENTATION[id];
    const x = position ? position[0] + "%" : site.mapX, y = position ? position[1] + "%" : site.mapY;
    return <button type="button" className="stormveil-map-button facility-tile" disabled={disabled} aria-label={"Enter " + site.name}
        style={{ left: x, top: y, "--map-x": x, "--map-y": y, "--facility-accent": site.accent } as CSSProperties}
        onPointerDown={preload} onClick={enter}>
        <span className="stormveil-map-icon-frame"><img className="stormveil-map-icon" src={facilityThumb(village, id)} alt="" draggable={false} /></span>
        <strong className="stormveil-map-label">{site.name}</strong>
    </button>;
}
