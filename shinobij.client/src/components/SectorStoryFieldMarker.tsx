export type SectorStoryFieldMarkerProps = Readonly<{
    pointId: string;
    title: string;
    tile: number;
    onOpen: () => void;
}>;

// Art and placement share stable point IDs, independent of translated titles.
const CAIRNS: Readonly<Record<string, { left: number; top: number }>> = {
    'sv-signal-cairn': { left: 50, top: 34 },
    'sv-rain-split-cairn': { left: 52, top: 39 },
};

export function SectorStoryFieldMarker({ pointId, title, tile, onOpen }: SectorStoryFieldMarkerProps) {
    const cairn = Object.hasOwn(CAIRNS, pointId) ? CAIRNS[pointId] : undefined;
    // Plant cairns on the painted paths, clear of roofs and water. These visual
    // coordinates leave the quest's authoritative point and tile intact.
    const at = cairn ?? { left: ((tile % 12) + .5) / 12 * 100, top: (Math.floor(tile / 12) + .5) / 12 * 100 };
    return (
        <button type="button"
            className={`atlas-landmark sector-story-field-marker${cairn ? ' sector-story-field-marker--art' : ''}`}
            style={{ left: `${at.left}%`, top: `${at.top}%` }}
            onClick={onOpen} title={title} aria-label={`Explore ${title}`}>
            {cairn
                ? <img src="/landmarks/signal-cairn-v1.webp" alt="" draggable={false} />
                : <strong aria-hidden="true">◇</strong>}
            <span>{title}</span>
        </button>
    );
}
