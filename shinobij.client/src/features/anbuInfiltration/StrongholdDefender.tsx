import { useLayoutEffect, useRef } from "react";
import { useSectorModelPins } from "../../lib/sector-model-pins";
import { SectorModelFigure, type SectorModelHandle } from "../../components/SectorModelFigure";
import { useWorldModelArtBase } from "../../lib/sector-obstacles";
import { ANBU_AVATAR_ASSET_REVISION } from "../../lib/anbu-infiltration-api";

export function StrongholdDefender({ portrait, name, caption, size, tileSize, overview }: {
    portrait: string | null; name: string; caption: string; size: number; tileSize: number; overview: boolean;
}) {
    const artBase = useWorldModelArtBase();
    const {portraitModels} = useSectorModelPins();
    // Village portraits use this cache revision. The build pins their underlying files.
    const suffix = "?v=" + ANBU_AVATAR_ASSET_REVISION;
    const source = portrait?.endsWith(suffix) ? portrait.slice(0, -suffix.length) : portrait;
    const kind = source && portraitModels.get(source);
    const figure = useRef<SectorModelHandle>(null);
    useLayoutEffect(() => {
        figure.current?.place(0, 0, tileSize * 12, false);
    }, [artBase, kind, tileSize]);
    return <span className="stronghold-anbu-station" style={{ width: size, height: size * 1.28 }}>
        <i aria-hidden="true" />
        {portrait ? <img className="stronghold-anbu" src={portrait} alt={name} />
            : <span className="stronghold-anbu-fallback" aria-hidden="true">◆</span>}
        {artBase && kind && <SectorModelFigure key={kind} ref={figure} kind={kind} artBase={artBase} />}
        {!overview && <b>{name}<small>{caption}</small></b>}
    </span>;
}
