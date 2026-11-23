import { useCallback, useState } from "react";
import { rawPetPool } from "../data/pet-pool";
import { PetPreviewStage } from "./PetPreviewStage";
import { PetArtwork } from "./PetArtwork";

export function RoadBeastPreview({ speciesId, name, portraitUrl }: { speciesId: string; name: string; portraitUrl?: string }) {
    const [open, setOpen] = useState(false);
    const [failed, setFailed] = useState(false);
    const onFail = useCallback(() => setFailed(true), []);
    const species = rawPetPool.find(pet => pet.id === speciesId);
    if (!species) return <img className="world-wanderer-portrait" src={portraitUrl} alt={name} />;
    const portrait = <PetArtwork pet={species} preferredSrc={portraitUrl} alt={name} loading="eager" className="world-wanderer-portrait" />;
    return <>
        {open && !failed ? <div style={{ position: "relative", height: "clamp(132px, 24dvh, 190px)" }} role="img" aria-label={`${species.name} 3D model`}>
            <PetPreviewStage fallback={portrait} pet={species} paused={window.matchMedia("(prefers-reduced-motion: reduce)").matches}
                turn={0} take={0} appearance="current" collarId="" onFail={onFail} />
        </div> : portrait}
        <div style={{ marginBottom: 6 }}>{failed ? <small role="status">3D preview unavailable</small> :
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
                {open ? "Show portrait" : "View in 3D"}
            </button>}</div>
    </>;
}
