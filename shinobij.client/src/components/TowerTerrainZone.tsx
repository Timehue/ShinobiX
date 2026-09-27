import { memo, useId } from 'react';
import terrainAtlas from '../assets/towers/battlefield/terrain-effects-v1.webp';
import propAtlas from '../assets/towers/battlefield/terrain-props-v1.webp';
import { TERRAIN_ATLAS_CELLS, TERRAIN_PROP_CELLS, towerTerrainPatches, type TowerTerrainKind, type TowerPropKind } from '../lib/tower-terrain';
import { towerHexPixel, HEX_W, HEX_H } from '../lib/tower-grid';

type Props = {
    tiles: readonly number[];
    width: number;
    height: number;
    kind: TowerTerrainKind;
    urgent?: boolean;
    inactive?: boolean;
    label?: string;
    holder?: string;
};

/** One illustrated surface per connected footprint, clipped to server-owned cells.
 * This layer is decorative: the existing hex/actor buttons own all input and names. */
export const TowerTerrainZone = memo(function TowerTerrainZone({ tiles, width, height, kind, urgent, label, holder, inactive }: Props) {
    const id = useId().replace(/:/g, '');
    const cell = TERRAIN_ATLAS_CELLS[kind];
    return towerTerrainPatches(tiles, width, height).map((patch, index) => {
        const clip = `terrain-${id}-${index}`;
        return <svg key={patch.tiles[0]} className={`tower-terrain-zone tower-terrain-zone--${kind}${urgent ? ' is-urgent' : ''}`}
            data-terrain-kind={kind} data-terrain-tiles={patch.tiles.join(',')} data-holder={holder} data-inactive={inactive || undefined}
            aria-hidden="true" focusable="false" viewBox={`0 0 ${patch.width} ${patch.height}`}
            style={{ left: patch.left, top: patch.top, width: patch.width, height: patch.height }}>
            {label && <title>{label}</title>}
            <defs><clipPath id={clip}>{patch.polygons.map((points, i) => <polygon key={patch.tiles[i]} points={points} />)}</clipPath></defs>
            <g clipPath={`url(#${clip})`}>
                <svg width={patch.width} height={patch.height} viewBox={`${cell % 4} ${Math.floor(cell / 4)} 1 1`} preserveAspectRatio="none">
                    <image href={terrainAtlas} width="4" height="4" />
                </svg>
                {patch.polygons.map((points, i) => <polygon key={patch.tiles[i]} className="tower-terrain-boundary" points={points} />)}
            </g>
        </svg>;
    });
});

export const TowerTerrainProp = memo(function TowerTerrainProp({ tile, width, kind, label, size = 62, inactive = false }: {
    tile: number; width: number; kind: TowerPropKind; label?: string; size?: number; inactive?: boolean;
}) {
    const { left, top } = towerHexPixel(tile, width);
    const cell = TERRAIN_PROP_CELLS[kind];
    return <svg className="tower-terrain-prop" data-prop-kind={kind} data-inactive={inactive || undefined} aria-hidden="true" focusable="false"
        viewBox={`${cell % 4} ${Math.floor(cell / 4)} 1 1`}
        style={{ left: left + HEX_W / 2 - size / 2, top: top + HEX_H * .9 - size, width: size, height: size, zIndex: 10 + Math.floor(tile / width) }}>
        {label && <title>{label}</title>}
        <image href={propAtlas} width="4" height="4" />
    </svg>;
});
