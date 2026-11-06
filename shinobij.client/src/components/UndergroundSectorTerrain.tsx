import { memo, useId, useMemo } from 'react';
import './underground-sector.css';
import { planUndergroundFloorFeatures, type UndergroundFloorFeature as FloorFeatureSpec } from '../../../shared/underground-floor-features';
import { UndergroundFloorFeature } from './UndergroundFloorFeature';
import { RiftBreach } from './RiftBreach';
import type { RiftBreachSite } from '../lib/rift-breach-layout';

type TerrainTile = { kind: string; terrain?: string; roomId?: number | null; secret?: boolean };
type Props = {
    tiles: readonly TerrainTile[];
    width: number;
    height: number;
    visible: ReadonlySet<number>;
    known: ReadonlySet<number>;
    mode: 'stronghold' | 'cave';
    vault?: boolean;
    /** A quest rift's signpost breaches (lib/rift-breach-layout), computed by
     *  the view that knows the run, so the energy overlay uses the same list. */
    breaches?: readonly RiftBreachSite[];
    features?: readonly FloorFeatureSpec[];
    renderWindow?: { left: number; top: number; width: number; height: number };
    /** Hollow Gate and quest-rift floors: each room's painted prefab by roomId
     *  (like the stronghold's painted rooms). Its doorways are painted in; an
     *  unused one is closed with the room's sealed painting, and passages are
     *  painted too. */
    roomArt?: Readonly<Record<number, string>>;
    /** The painted passage cell joining crypt rooms (the depth's palette). */
    passageArt?: string;
};

const CAVERN_RUBBLE = '/underground/cavern-crypt-rubble-v1.webp';
const NO_BREACHES: readonly RiftBreachSite[] = [];

/** Explored-but-unlit ground: dark enough to read as unlit map memory,
 * bright enough to retrace a route. */
const MEMORY_OPACITY = .2;

const FORTRESS_ROOM_ART = ['entry-hall', 'watch-barracks', 'armory', 'signal-chamber', 'supply-depot', 'training-hall',
    'war-archives', 'officer-quarters', 'cistern', 'seal-workshop', 'inner-guard', 'anbu-vault'];

/** Painted room floors use the same overhead map approach as sector floors.
 * Their built-in stations match shared collision bays; only the authoritative
 * tile geometry can connect rooms. Unknown terrain stays masked, and the rock
 * around the rooms is plain darkness, never a lit stone slab. */
export const UndergroundSectorTerrain = memo(function UndergroundSectorTerrain({ tiles, width, height, visible, known, mode, vault = false, breaches = NO_BREACHES, features, renderWindow, roomArt, passageArt }: Props) {
    const id = useId().replaceAll(':', '');
    const cave = mode === 'cave';
    // Painted crypt prefabs: every Hollow Gate depth and quest rift.
    const chambers = cave ? roomArt ?? {} : undefined;
    const geometry = useMemo(() => tiles.map((tile, index) => {
        const x = index % width, y = Math.floor(index / width);
        const wallAt = (cx: number, cy: number) => cx < 0 || cy < 0 || cx >= width || cy >= height
            || tiles[cy * width + cx]?.kind === 'wall' || tiles[cy * width + cx]?.terrain === 'wall';
        return { x, y, wall: wallAt(x, y), north: wallAt(x, y - 1), south: wallAt(x, y + 1),
            west: wallAt(x - 1, y), east: wallAt(x + 1, y) };
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
        return [...bounds].map(([roomId, b]) => ({ ...b, roomId }));
    }, [tiles, width]);
    const discoveredRooms = useMemo(() => {
        const ids = new Set<number>();
        for (const index of known) { const roomId = tiles[index]?.roomId; if (roomId != null) ids.add(roomId); }
        for (const index of visible) { const roomId = tiles[index]?.roomId; if (roomId != null) ids.add(roomId); }
        return rooms.filter(room => ids.has(room.roomId));
    }, [rooms, tiles, known, visible]);
    const fixtures = useMemo(() => features ?? (cave ? [] : planUndergroundFloorFeatures(tiles, width, false, vault, 4 * width + 5)), [features, tiles, width, cave, vault]);
    const paintRoom = (room: typeof rooms[number]) => chambers ? <g key={room.roomId} className="cavern-chamber-floor" data-room={room.roomId}>
        {chambers[room.roomId] && <image href={chambers[room.roomId]} x={room.x} y={room.y}
            width={room.right - room.x} height={room.bottom - room.y} preserveAspectRatio="none" />}
    </g> : <g key={room.roomId} className="underground-room-floor" data-room={room.roomId}>
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
            {!cave && <pattern id={`${id}-passage-floor`} width="2" height="2" patternUnits="userSpaceOnUse">
                <image href="/underground/fortress-corridor-floor-v3.webp" width="2" height="2" preserveAspectRatio="none" />
            </pattern>}
            <clipPath id={`${id}-known`}>
                {geometry.map((g, i) => inDrawing(g) && (known.has(i) || visible.has(i)) ? <rect key={i} data-tile={i} x={g.x} y={g.y} width="1" height="1" /> : null)}
            </clipPath>
            {/* Feathered masks that blend a sealed doorway's patch of painted
                wall into the wall beside it (horizontal and vertical edges). */}
            {chambers && (['h', 'v'] as const).map(dir => <g key={dir}>
                <linearGradient id={`${id}-seal-${dir}-fade`} x1="0" y1="0" x2={dir === 'h' ? 1 : 0} y2={dir === 'h' ? 0 : 1}>
                    <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".24" stopColor="#fff" />
                    <stop offset=".76" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
                <mask id={`${id}-seal-${dir}`} maskContentUnits="objectBoundingBox">
                    <rect width="1" height="1" fill={`url(#${id}-seal-${dir}-fade)`} />
                </mask>
            </g>)}
            {/* Remembered floor only (the Obsidian tint never lifts the dark rock). */}
            <clipPath id={`${id}-known-floor`}>
                {geometry.map((g, i) => inDrawing(g) && !g.wall && (known.has(i) || visible.has(i)) ? <rect key={i} x={g.x} y={g.y} width="1" height="1" /> : null)}
            </clipPath>
            {/* Lit cells including their walls: a crypt room's painting also
                lies under its sealed doorways. */}
            <clipPath id={`${id}-${chambers ? 'lit' : 'floor'}`}>
                {geometry.map((g, i) => inDrawing(g) && (chambers || !g.wall) && visible.has(i) ? <rect key={i} x={g.x} y={g.y} width="1" height="1" /> : null)}
            </clipPath>
        </defs>
        <rect x={drawing.left} y={drawing.top} width={drawing.width} height={drawing.height} fill="#000" />
        {/* A stronghold's corridors: painted passage floor between the rooms. */}
        {!cave && geometry.map((g, i) => {
            if (!inDrawing(g) || g.wall || (!known.has(i) && !visible.has(i))) return null;
            if (tiles[i].roomId != null && visible.has(i)) return null; // The opaque room painting covers this floor.
            return <g key={i} transform={`translate(${g.x} ${g.y})`} opacity={visible.has(i) ? 1 : MEMORY_OPACITY}>
                {/* Patterns use absolute world coordinates so cells never look stamped. */}
                <rect width="1.005" height="1.005" fill={`url(#${id}-passage-floor)`} transform={`translate(${-g.x} ${-g.y})`} x={g.x} y={g.y} />
                {g.north && <rect width="1" height=".2" fill="#000" opacity=".3" />}
                {g.west && <path d="M0 0H.08L.13 .4 .06 .7 .1 1H0Z" fill="#071019" opacity=".55" />}
                {g.east && <path d="M1 0H.91L.87 .3 .94 .6 .9 1H1Z" fill="#071019" opacity=".55" />}
                {g.south && <path d="M0 .97H1" stroke="var(--under-highlight)" opacity=".2" strokeWidth=".035" />}
            </g>;
        })}
        {/* Every room is one coherent painting: flooring, light and built-in
            stations share a camera, material scale and architectural plan.
            Only discovered rooms are mounted, so a phone loads its current
            room rather than downloading all twelve room paintings. */}
        <g clipPath={`url(#${id}-known)`} opacity={MEMORY_OPACITY}>
            {paintableRooms.map(paintRoom)}
        </g>
        <g clipPath={`url(#${id}-${chambers ? 'lit' : 'floor'})`}>
            {paintableRooms.map(paintRoom)}
        </g>
        {chambers && geometry.map((g, i) => {
            // Crypt passages and sealed doorways, painted. A passage cell
            // turns to run between its open neighbours; a sealed doorway lies
            // only inside a painted room, never in the open dark.
            if (!inDrawing(g) || (!known.has(i) && !visible.has(i))) return null;
            const opacity = visible.has(i) ? 1 : MEMORY_OPACITY;
            if (!g.wall && tiles[i].terrain === 'corridor_floor') {
                const vertical = g.east && g.west;
                return <image key={`p-${i}`} href={passageArt} x={g.x} y={g.y} width="1" height="1" opacity={opacity} preserveAspectRatio="none"
                    transform={vertical ? `rotate(90 ${g.x + .5} ${g.y + .5})` : undefined} />;
            }
            if (!g.wall) return null;
            const room = rooms.find(r => g.x >= r.x && g.x < r.right && g.y >= r.y && g.y < r.bottom);
            const art = room && chambers[room.roomId];
            if (room && art) {
                // An unused doorway is closed with the room's "sealed" painting
                // (the same room with every doorway walled up), drawn at the
                // same spot. The patch is wider than the doorway and fades out
                // along the wall, so it blends into the painting around it.
                const along = g.y === room.y || g.y === room.bottom - 1;
                const px = along ? g.x - .45 : g.x, py = along ? g.y : g.y - .45, pw = along ? 1.9 : 1, ph = along ? 1 : 1.9;
                return <svg key={`r-${i}`} x={px} y={py} width={pw} height={ph} viewBox={`${px} ${py} ${pw} ${ph}`} opacity={opacity} overflow="hidden">
                    <g mask={`url(#${id}-seal-${along ? 'h' : 'v'})`}>
                        <image href={art.replace(/-v1\.webp$/, '-v1-sealed.webp')} x={room.x} y={room.y} width={room.right - room.x} height={room.bottom - room.y} preserveAspectRatio="none" />
                    </g>
                </svg>;
            }
            // A sealed secret passage reads as a rubble fall (its cracks are drawn on top).
            if (!room && !tiles[i].secret) return null;
            // The rubble art is painted for a north doorway; turn it to its side.
            const turn = !room ? (g.east && g.west ? 0 : 90) : g.y === room.y ? 0 : g.y === room.bottom - 1 ? 180 : g.x === room.x ? 270 : 90;
            return <image key={`r-${i}`} href={CAVERN_RUBBLE} x={g.x - .1} y={g.y - .1} width="1.2" height="1.2" opacity={opacity} preserveAspectRatio="none"
                transform={turn ? `rotate(${turn} ${g.x + .5} ${g.y + .5})` : undefined} />;
        })}
        <g clipPath={`url(#${id}-known)`}>
            {fixtures.map((fixture, i) => {
                const index = fixture.cells[0];
                if (!inDrawing({ x: fixture.left, y: fixture.top }) && !inDrawing({ x: fixture.left + fixture.span - 1, y: fixture.top })) return null;
                if (!known.has(index) && !visible.has(index)) return null;
                return cave ? <UndergroundFloorFeature key={i} feature={fixture} cave opacity={visible.has(index) ? 1 : MEMORY_OPACITY} />
                    : <g key={i} className="underground-fixture underground-built-in" data-room={fixture.roomId} data-purpose={fixture.purpose}
                        data-collision={fixture.cells.join(',')} data-role={fixture.role} data-feature-art="room-floor">
                        <rect x={fixture.left} y={fixture.top} width={fixture.span} height="1" fill="transparent" />
                    </g>;
            })}
        </g>
        {/* The discovered stone rim may project over the dark background, just
            like an actor sprite. Its anchors must all be known; no hidden
            terrain is painted or revealed beneath its transparent silhouette. */}
        {breaches.filter(site => inDrawing(site) && site.cells.every(i => known.has(i) || visible.has(i)))
            .map(site => <RiftBreach key={site.roomId} site={site} active={site.cells.some(i => visible.has(i))} />)}
        {!cave && !vault && <g clipPath={`url(#${id}-known-floor)`}>
            {/* A direct tint keeps the Obsidian palette without allocating a
                filtered surface for the entire offscreen dungeon atlas. */}
            <rect x={drawing.left} y={drawing.top} width={drawing.width} height={drawing.height} fill="#24101a" opacity=".18" />
        </g>}
    </svg>;
});
