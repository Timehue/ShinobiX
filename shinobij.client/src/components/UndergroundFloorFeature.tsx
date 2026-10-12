import type { UndergroundFloorFeature as Feature } from '../../../shared/underground-floor-features';

/** Painted surface and server collision share one floor footprint. The image
 * is grounded inside that footprint; it cannot invent a doorway or passage. */
export function UndergroundFloorFeature({ feature: f, cave, opacity }: { feature: Feature; cave: boolean; opacity: number }) {
    const height = ['guardian', 'banner-pillar', 'broken-pillar', 'training-dummy'].includes(f.role) ? 1.12 : .95;
    return <g className="underground-fixture underground-floor-feature" data-room={f.roomId} data-purpose={f.purpose}
        data-collision={f.cells.join(',')} data-role={f.role} opacity={opacity}>
        <ellipse cx={f.left + f.span / 2} cy={f.top + .75} rx={f.span * .34} ry=".12" fill="#000" opacity=".22" />
        <image href={`/underground/${cave ? 'cavern' : 'fortress'}-${f.role}-v1.webp`} x={f.left + .08} y={f.top + .84 - height}
            width={f.span - .16} height={height} preserveAspectRatio="xMidYMax meet" />
    </g>;
}
