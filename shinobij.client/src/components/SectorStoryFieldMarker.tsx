import { sectorStoryPlacement } from "../lib/sector-story-placement";
export type SectorStoryFieldMarkerProps = Readonly<{
    pointId: string;
    title: string;
    tile: number;
    onOpen: () => void;
    sector?: number;
}>;

export function SectorStoryFieldMarker({ pointId, title, tile, onOpen, sector }: SectorStoryFieldMarkerProps) {
    const at = sectorStoryPlacement(pointId, tile, sector);
    return (
        <button type="button"
            className={`atlas-landmark sector-story-field-marker${at.cairn ? ' sector-story-field-marker--art' : ''}${at.authored ? ' sector-story-authored' : ''}`}
            style={{ left: `${at.left}%`, top: `${at.top}%`, width: at.width ? `${at.width}%` : undefined }}
            onClick={onOpen} title={title} aria-label={`Explore ${title}`}>
            {!at.baked && (at.cairn
                ? <img src="/landmarks/signal-cairn-v1.webp" alt="" draggable={false} />
                : <strong aria-hidden="true">◇</strong>)}
            <span>{title}</span>
        </button>
    );
}
