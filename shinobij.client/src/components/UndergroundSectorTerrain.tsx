import { memo, useId, useMemo } from 'react';
import './underground-sector.css';
import { planUndergroundFloorFeatures, type UndergroundFloorFeature as FloorFeatureSpec } from '../../../shared/underground-floor-features';
import { UndergroundFloorFeature } from './UndergroundFloorFeature';

type TerrainTile = { kind: string; terrain?: string; roomId?: number | null };
type Props = {
    tiles: readonly TerrainTile[];
    width: number;
    height: number;
    visible: ReadonlySet<number>;
    known: ReadonlySet<number>;
    mode: 'stronghold' | 'cave';
    vault?: boolean;
    features?: readonly FloorFeatureSpec[];
    renderWindow?: { left: number; top: number; width: number; height: number };
};

const FORTRESS_ROOM_ART = ['entry-hall', 'watch-barracks', 'armory', 'signal-chamber', 'supply-depot', 'training-hall',
    'war-archives', 'officer-quarters', 'cistern', 'seal-workshop', 'inner-guard', 'anbu-vault'];

/** Painted room floors use the same overhead map approach as sector floors.
 * Their built-in stations match shared collision bays; only the authoritative
 * tile geometry can connect rooms. Unknown terrain stays masked. */
export const UndergroundSectorTerrain = memo(function UndergroundSectorTerrain({ tiles, width, height, visible, known, mode, vault = false, features, renderWindow }: Props) {
    const id = useId().replaceAll(':', '');
    const cave = mode === 'cave';
    const geometry = useMemo(() => tiles.map((tile, index) => {
        const x = index % width, y = Math.floor(index / width);
        const wallAt = (cx: number, cy: number) => cx < 0 || cy < 0 || cx >= width || cy >= height
            || tiles[cy * width + cx]?.kind === 'wall' || tiles[cy * width + cx]?.terrain === 'wall';
        const wall = wallAt(x, y);
        return { x, y, wall, north: wallAt(x, y - 1), south: wallAt(x, y + 1),
            west: wallAt(x - 1, y), east: wallAt(x + 1, y),
            lamp: wall && !wallAt(x, y + 1) && (index % 5 === 0 || !wallAt(x - 1, y)),
            seed: ((index * 2654435761) >>> 0) % 7 };
    }), [tiles, width, height]);
    const rooms = useMemo(() => {
        const bounds = new Map<number, { x: number; y: number; right: number; bottom: number }>();
        tiles.forEach((tile, index) => {
            if (tile.roomId == null || tile.kind === 'wall') return;
            const x = index % width, y = Math.floor(index / width), previous = bounds.get(tile.roomId);
            bounds.set(tile.roomId, previous ? { x: Math.min(previous.x, x), y: Math.min(previous.y, y),
                right: Math.max(previous.right, x + 1), bottom: Math.max(previous.bottom, y + 1) }
                : { x, y, right: x + 1, bottom: y + 1 });
        });
        return [...bounds].map(([roomId, b]) => ({ ...b, roomId, cx: (b.x + b.right) / 2, cy: (b.y + b.bottom) / 2 }));
    }, [tiles, width]);
    const discoveredRooms = useMemo(() => {
        const ids = new Set<number>();
        for (const index of known) { const roomId = tiles[index]?.roomId; if (roomId != null) ids.add(roomId); }
        for (const index of visible) { const roomId = tiles[index]?.roomId; if (roomId != null) ids.add(roomId); }
        return rooms.filter(room => ids.has(room.roomId));
    }, [rooms, tiles, known, visible]);
    const fixtures = useMemo(() => features ?? (cave ? [] : planUndergroundFloorFeatures(tiles, width, false, vault, 4 * width + 5)), [features, tiles, width, cave, vault]);
    const paintRoom = (room: typeof rooms[number]) => <g key={room.roomId} className="underground-room-floor" data-room={room.roomId}>
        <image href="/underground/fortress-room-base-v3.webp" x={room.x} y={room.y}
            width={room.right - room.x} height={room.bottom - room.y} preserveAspectRatio="none" />
        {fixtures.filter(f => f.roomId === room.roomId).map((f, i) => {
            const south = f.top > room.y, sourceHeight = south ? f.role === 'cistern' ? 1.9 : 1.4 : 1;
            // Normalize an entire architectural wall band into its reserved
            // footprint, including frame and contact light. Never stamp a
            // floating prop or let painted furniture spill onto open floor.
            return <svg key={i} className="underground-architecture-bay" data-room={f.roomId} data-collision={f.cells.join(',')}
                x={f.left} y={f.top} width={f.span} height="1"
                viewBox={`${f.left} ${south ? room.bottom - sourceHeight : room.y} ${f.span} ${sourceHeight}`}
                preserveAspectRatio="none" overflow="hidden">
                <image href={`/underground/fortress-room-${!vault && room.roomId === 11 ? 'blood-altar' : FORTRESS_ROOM_ART[room.roomId]}-${south ? 'south' : 'north'}-v3.webp`}
                    x={room.x} y={south ? room.bottom - sourceHeight : room.y} width={room.right - room.x} height={sourceHeight} preserveAspectRatio="none" />
            </svg>;
        })}
    </g>;
    if (renderWindow && (!renderWindow.width || !renderWindow.height)) return null;
    // The camera still transforms the whole board. A smaller SVG viewport with
    // matching absolute world offsets leaves every floor/fixture point exactly
    // where it was, while avoiding an offscreen atlas-sized raster surface.
    const drawing = renderWindow ?? { left: 0, top: 0, width, height };
    const inDrawing = (point: { x: number; y: number }) => point.x >= drawing.left && point.x < drawing.left + drawing.width && point.y >= drawing.top && point.y < drawing.top + drawing.height;
    const roomInDrawing = (room: typeof rooms[number]) => room.right > drawing.left && room.x < drawing.left + drawing.width && room.bottom > drawing.top && room.y < drawing.top + drawing.height;
    const paintableRooms = discoveredRooms.filter(roomInDrawing);
    return <svg className={`underground-terrain underground-terrain--${mode}`} viewBox={`${drawing.left} ${drawing.top} ${drawing.width} ${drawing.height}`}
        style={renderWindow ? { left: `${drawing.left / width * 100}%`, top: `${drawing.top / height * 100}%`, right: 'auto', bottom: 'auto', width: `${drawing.width / width * 100}%`, height: `${drawing.height / height * 100}%` } : undefined}
        data-render-window={`${drawing.left},${drawing.top},${drawing.width},${drawing.height}`} width="100%" height="100%" aria-hidden="true" focusable="false">
        <defs>
            {cave && <pattern id={`${id}-slate`} width="2.8" height="2.1" patternUnits="userSpaceOnUse">
                <rect width="2.8" height="2.1" fill="var(--under-floor)" />
                    <path d="M0 .2 .6 .12 1 .4 1.6 .18 2.8 .28 M.6 .12 .4 1 1.1 1.3 .9 2.1 M2 .2 1.8 .8 2.3 1.4 2.1 2.1 M0 1.7 .4 1.6 M2.3 1.4 2.8 1.6" fill="none" stroke="#030b11" strokeWidth=".025" opacity=".5" />
                    <path d="M.16 .48 .42 .36 .64 .55 .36 .72Z M1.2 1.5 1.6 1.34 1.94 1.56 1.66 1.86 1.26 1.84Z M2.24 .45 2.56 .32 2.7 .7 2.36 .88Z" fill="var(--under-highlight)" opacity=".1" />
                    <path d="M0 1.2 .4 1.14 1 .96 1.5 1.06 1.9 1.02 2.8 1.1" stroke="var(--under-water)" strokeWidth=".24" fill="none" opacity=".22" />
                    <path d="M.05 1.26 .5 1.18 1 .99 1.7 1.12 2.76 1.14" stroke="var(--under-highlight)" strokeWidth=".012" fill="none" opacity=".26" />
            </pattern>}
            {cave && <pattern id={`${id}-wall-art`} width="3" height="2" patternUnits="userSpaceOnUse">
                <image href="/underground/cavern-rock-face-v1.webp" width="3" height="2" preserveAspectRatio="none" />
                <rect width="3" height="2" fill="var(--under-rock)" opacity=".2" />
            </pattern>}
            <radialGradient id={`${id}-light`}>
                <stop stopColor="var(--under-glow)" stopOpacity=".35" /><stop offset="1" stopColor="var(--under-glow)" stopOpacity="0" />
            </radialGradient>
            {cave && <pattern id={`${id}-material`} width="6" height="6" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill={`url(#${id}-slate)`} />
                <image href="/underground/hollow-cavern-v1.webp" width="6" height="6" preserveAspectRatio="none" />
                <rect width="6" height="6" fill="var(--under-floor)" opacity=".22" />
            </pattern>}
            {!cave && <pattern id={`${id}-passage-floor`} width="2" height="2" patternUnits="userSpaceOnUse">
                <image href="/underground/fortress-corridor-floor-v3.webp" width="2" height="2" preserveAspectRatio="none" />
            </pattern>}
            <pattern id={`${id}-bedrock`} width="6" height="6" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill="var(--under-rock)" />
                <image href={cave ? '/underground/hollow-cavern-v1.webp' : '/underground/fortress-corridor-floor-v3.webp'} width="6" height="6" preserveAspectRatio="none" opacity=".25" />
            </pattern>
            <clipPath id={`${id}-known`}>
                {geometry.map((g, i) => inDrawing(g) && (known.has(i) || visible.has(i)) ? <rect key={i} data-tile={i} x={g.x} y={g.y} width="1" height="1" /> : null)}
            </clipPath>
            <clipPath id={`${id}-floor`}>
                {geometry.map((g, i) => inDrawing(g) && !g.wall && visible.has(i) ? <rect key={i} x={g.x} y={g.y} width="1" height="1" /> : null)}
            </clipPath>
        </defs>
        <rect x={drawing.left} y={drawing.top} width={drawing.width} height={drawing.height} fill="#080d14" />
        {/* Solid rock fills the darkness without exposing any unknown rooms. */}
        <rect x={drawing.left} y={drawing.top} width={drawing.width} height={drawing.height} fill={`url(#${id}-bedrock)`} opacity=".18" />
        {geometry.map((g, i) => {
            if (!inDrawing(g) || (!known.has(i) && !visible.has(i))) return null;
            if (!cave && !g.wall && tiles[i].roomId != null && visible.has(i)) return null; // The opaque room painting covers this floor.
            return <g key={i} transform={`translate(${g.x} ${g.y})`} opacity={visible.has(i) ? 1 : .32}>
                {/* Patterns use absolute world coordinates so cells never look stamped. */}
                <rect width="1.005" height="1.005" fill={`url(#${id}-${g.wall ? 'bedrock' : cave ? 'material' : 'passage-floor'})`} transform={`translate(${-g.x} ${-g.y})`} x={g.x} y={g.y} />
                {g.wall && !cave && <>
                    <rect width="1" height="1" fill={`url(#${id}-passage-floor)`} transform={`translate(${-g.x} ${-g.y})`} x={g.x} y={g.y} />
                    <rect width="1" height="1" fill="#111820" opacity=".65" />
                    <path d={`${!g.north ? 'M0 .04H1' : ''} ${!g.south ? 'M0 .96H1' : ''} ${!g.west ? 'M.04 0V1' : ''} ${!g.east ? 'M.96 0V1' : ''}`}
                        fill="none" stroke="#998a6f" strokeWidth=".03" opacity=".35" />
                </>}
                {g.wall && cave && !g.south && <>
                    {/* Sample wall art in world coordinates, as the floor does,
                        so adjoining wall faces do not restart the same crop. */}
                    <path transform={`translate(${-g.x} ${-g.y})`}
                        d={cave ? `M${g.x} ${g.y + .28}q.2-.18 .4-.05t.3-.05q.18-.06 .3.1V${g.y + 1}h-1Z` : `M${g.x} ${g.y + .18}h1v.82h-1Z`} fill={`url(#${id}-wall-art)`} />
                    <path d={cave ? 'M0 .28Q.2 .1 .4 .23T.7 .18Q.88 .12 1 .28' : 'M0 .19H1'} fill="none" stroke="var(--under-highlight)" strokeWidth=".012" opacity=".45" />
                    <rect y=".86" width="1" height=".14" fill="#02070c" opacity=".35" />
                </>}
                {!g.wall && <>
                    {g.north && <rect width="1" height=".2" fill="#000" opacity=".3" />}
                    {g.west && <path d="M0 0H.08L.13 .4 .06 .7 .1 1H0Z" fill="#071019" opacity=".55" />}
                    {g.east && <path d="M1 0H.91L.87 .3 .94 .6 .9 1H1Z" fill="#071019" opacity=".55" />}
                    {g.south && <path d="M0 .97H1" stroke="var(--under-highlight)" opacity=".2" strokeWidth=".035" />}
                </>}
            </g>;
        })}
        {!cave && <>
            {/* Every room is one coherent painting: flooring, light and built-in
                stations share a camera, material scale and architectural plan.
                Only discovered rooms are mounted, so a phone loads its current
                room rather than downloading all twelve room paintings. */}
            <g clipPath={`url(#${id}-known)`} opacity=".32">
                {paintableRooms.map(paintRoom)}
            </g>
            <g clipPath={`url(#${id}-floor)`}>
                {paintableRooms.map(paintRoom)}
            </g>
        </>}
        <g clipPath={`url(#${id}-floor)`}>
            {cave && rooms.filter(roomInDrawing).map(room => <g key={room.roomId}>
                {vault && room.roomId === 11 && <g>
                    <path d={`M${room.cx - .75} ${room.cy}h1.5 M${room.cx} ${room.cy - .6}v1.2`} stroke="#b89557" strokeWidth=".012" opacity=".25" />
                    <circle cx={room.cx} cy={room.cy} r=".7" fill="none" stroke="#c2ab7e" strokeWidth=".014" opacity=".3" />
                    <circle cx={room.cx} cy={room.cy} r=".58" fill="none" stroke="#c2ab7e" strokeWidth=".01" opacity=".22" />
                </g>}
                <ellipse cx={room.cx} cy={room.cy} rx={(room.right - room.x) * .48} ry={(room.bottom - room.y) * .45} fill={`url(#${id}-light)`} opacity=".55" />
            </g>)}
            {cave && geometry.map((g, i) => inDrawing(g) && g.lamp && visible.has(i) ? <ellipse key={i} cx={g.x + .5} cy={g.y + 1.2} rx="1.6" ry="1.9" fill={`url(#${id}-light)`} /> : null)}
        </g>
        <g clipPath={`url(#${id}-known)`} fill="none" stroke="var(--under-highlight)" opacity=".08" strokeWidth=".02">
            {cave && rooms.filter(roomInDrawing).map(room => <path key={room.roomId} d={`M${room.x} ${room.bottom - .6}q${(room.right - room.x) * .4} -1 ${room.right - room.x} -.2`} />)}
        </g>
        <g clipPath={`url(#${id}-known)`}>
            {geometry.map((g, i) => {
                if (!inDrawing(g) || !cave || tiles[i].terrain !== 'door' || (!known.has(i) && !visible.has(i))) return null;
                const north = tiles[i - width]?.terrain === 'corridor_floor', south = tiles[i + width]?.terrain === 'corridor_floor';
                const east = tiles[i + 1]?.terrain === 'corridor_floor', west = tiles[i - 1]?.terrain === 'corridor_floor';
                if (!north && !south && !east && !west) return null;
                const angle = north ? 0 : south ? 180 : east ? 90 : -90;
                return <g className="underground-doorway" data-tile={i} key={`passage-${i}`} transform={`translate(${g.x + .5} ${g.y + .5}) rotate(${angle})`} opacity={visible.has(i) ? 1 : .32}>
                    <image href={`/underground/${cave ? 'cavern' : 'fortress'}-passage-v1.webp`} x="-1.2" y="-1.25" width="2.4" height="1.55" preserveAspectRatio="xMidYMax meet" />
                </g>;
            })}
            {fixtures.map((fixture, i) => {
                const index = fixture.cells[0];
                if (!inDrawing({ x: fixture.left, y: fixture.top }) && !inDrawing({ x: fixture.left + fixture.span - 1, y: fixture.top })) return null;
                if (!known.has(index) && !visible.has(index)) return null;
                return cave ? <UndergroundFloorFeature key={i} feature={fixture} cave opacity={visible.has(index) ? 1 : .32} />
                    : <g key={i} className="underground-fixture underground-built-in" data-room={fixture.roomId} data-purpose={fixture.purpose}
                        data-collision={fixture.cells.join(',')} data-role={fixture.role} data-feature-art="room-floor">
                        <rect x={fixture.left} y={fixture.top} width={fixture.span} height="1" fill="transparent" />
                    </g>;
            })}
        </g>
        {!cave && !vault && <g clipPath={`url(#${id}-known)`}>
            {/* A direct tint keeps the Obsidian palette without allocating a
                filtered surface for the entire offscreen dungeon atlas. */}
            <rect x={drawing.left} y={drawing.top} width={drawing.width} height={drawing.height} fill="#24101a" opacity=".18" />
        </g>}
    </svg>;
});
