import { rallyPath, rallySection } from '../../../../shared/sunscar/rally-tracks';
import { sunscarRandom } from '../../../../shared/sunscar/random';
import type { RallyTrack } from '../../../../shared/sunscar/rally-types';

/** The road ribbon samples the course every step from this start. Scenery reads
 * the edge the ribbon actually draws, including its taper at section seams. */
export const RALLY_RIBBON_START = -20;
export const RALLY_RIBBON_STEP = 8;
/** Open ground between the drawn road edge and the nearest boulder surface. */
export const RALLY_ROCK_CLEARANCE = 1.2;
/** Open ground between a boulder and any stand, pavilion, spectator or arch. */
export const RALLY_SET_PIECE_CLEARANCE = .5;
/** Spectators stand in a band this far outside the road edge. */
export const RALLY_CROWD_BAND = { inner: 1.6, depth: 1.5, count: 15, spacing: 1.8 } as const;
/** Pavilion footprint half-size: the square roof (cone radius 3.6 turned 45°) overhangs its 4 × 3 hut. */
const PAVILION_HALF = 2.6;

type Vec3 = [number, number, number];
export type RallyRock = { position: Vec3; rotation: Vec3; scale: Vec3 };
/** Ground a boulder must not enter, beside the road on one side, between two course distances. */
export type RallyKeepOut = { name: string; side: -1 | 1; from: number; to: number; minX: number; maxX: number };

/** Half the drawn road width. Between ribbon samples the width interpolates, so
 * a section seam tapers over one step rather than snapping. */
export function rallyRoadHalfWidth(track: RallyTrack, distance: number): number {
    const index = Math.floor((distance - RALLY_RIBBON_START) / RALLY_RIBBON_STEP);
    const from = RALLY_RIBBON_START + index * RALLY_RIBBON_STEP;
    const t = (distance - from) / RALLY_RIBBON_STEP;
    const a = rallySection(track, Math.max(0, from)).width;
    const b = rallySection(track, Math.max(0, from + RALLY_RIBBON_STEP)).width;
    return (a + (b - a) * t) / 2;
}

/** Outermost drawn road edge on one side across a stretch of the course. */
export function rallyRoadEdge(track: RallyTrack, from: number, to: number, side: -1 | 1): number {
    let edge = side * -Infinity;
    for (let distance = from; ; distance = Math.min(to, distance + 1)) {
        const x = rallyPath(track, distance).x + side * rallyRoadHalfWidth(track, distance);
        edge = side > 0 ? Math.max(edge, x) : Math.min(edge, x);
        if (distance >= to) return edge;
    }
}

/** Start and finish arches: posts stand beside the road and the checkered line
 * spans it exactly, whatever the course's width there. */
export function rallyArch(track: RallyTrack, distance: number): { half: number; post: number; tiles: number; tile: number } {
    const half = rallyRoadHalfWidth(track, distance);
    const tiles = Math.round(half * 2);
    return { half, post: Math.max(6.4, half + .7), tiles, tile: half * 2 / tiles };
}

/** Market pavilions along the festival and market courses. */
export function rallyPavilions(track: RallyTrack): { x: number; y: number; z: number; accent: boolean }[] {
    if (track.scenery !== 'festival' && track.scenery !== 'market') return [];
    return Array.from({ length: 16 }, (_, i) => {
        const p = rallyPath(track, i * track.length / 16 + 15);
        return { x: p.x + (i % 2 ? -11 : 11), y: p.y, z: p.z, accent: i % 3 !== 0 };
    });
}

/** The two finish grandstands: three stepped rows with a pavilion on top. */
export function rallyGrandstands(track: RallyTrack): { side: -1 | 1; x: number; y: number; z: number }[] {
    const finish = rallyPath(track, track.length);
    return ([-1, 1] as const).map(side => ({ side, x: finish.x + side * 13, y: finish.y, z: finish.z + 12 }));
}

/** Course distances where a block of spectators begins, on both sides. */
export function rallyCrowdSpots(track: RallyTrack): number[] {
    return track.scenery === 'festival' || track.scenery === 'market' ? [30, 200, 400, 650, track.length - 20] : [25, track.length - 20];
}

/** Every set piece a boulder must stay clear of, from the same placements the scene draws. */
export function rallyKeepOuts(track: RallyTrack): RallyKeepOut[] {
    const out: RallyKeepOut[] = [];
    const sideOf = (x: number, distance: number): -1 | 1 => x > rallyPath(track, distance).x ? 1 : -1;
    for (const [i, p] of rallyPavilions(track).entries()) {
        out.push({ name: `pavilion ${i}`, side: sideOf(p.x, -p.z), from: -p.z - PAVILION_HALF, to: -p.z + PAVILION_HALF, minX: p.x - PAVILION_HALF, maxX: p.x + PAVILION_HALF });
    }
    for (const stand of rallyGrandstands(track)) {
        // Rows reach 1.5 inboard and 3.5 outboard of the group; its pavilion sits 2 outboard and 8 towards the finish.
        const d = -stand.z, s = stand.side;
        out.push({ name: `grandstand ${s}`, side: s, from: d - 9, to: d + 8 + PAVILION_HALF,
            minX: stand.x + (s > 0 ? -1.5 : -2 - PAVILION_HALF), maxX: stand.x + (s > 0 ? 2 + PAVILION_HALF : 1.5) });
    }
    for (const spot of rallyCrowdSpots(track)) {
        // One slot per spectator, so a block on a bend follows the road.
        for (let i = 0; i < RALLY_CROWD_BAND.count; i++) {
            const d = spot + i * RALLY_CROWD_BAND.spacing;
            for (const side of [-1, 1] as const) {
                const edge = rallyPath(track, d).x + side * rallyRoadHalfWidth(track, d);
                const near = edge + side * RALLY_CROWD_BAND.inner, far = edge + side * (RALLY_CROWD_BAND.inner + RALLY_CROWD_BAND.depth);
                out.push({ name: `crowd ${spot}${side > 0 ? 'R' : 'L'} #${i}`, side, from: d - .5, to: d + .5, minX: Math.min(near, far) - .3, maxX: Math.max(near, far) + .3 });
            }
        }
    }
    for (const d of [0, track.length]) {
        const p = rallyPath(track, d), { post } = rallyArch(track, d);
        for (const side of [-1, 1] as const) out.push({ name: `arch ${d}${side > 0 ? 'R' : 'L'}`, side, from: d - 1, to: d + 1, minX: p.x + side * post - .6, maxX: p.x + side * post + .6 });
    }
    return out;
}

/** Horizontal half-extents of a unit sphere after a three.js XYZ Euler rotation
 * and a scale. Every rock mesh is inscribed in that sphere, so this bounds it. */
export function rallyRockHalfExtents(rotation: Vec3, scale: Vec3): { x: number; z: number } {
    const [ax, ay, az] = rotation;
    const a = Math.cos(ax), b = Math.sin(ax), c = Math.cos(ay), d = Math.sin(ay), e = Math.cos(az), f = Math.sin(az);
    // World x and z rows of Rx·Ry·Rz, as Matrix4.makeRotationFromEuler builds them.
    const rowX = [c * e, -c * f, d];
    const rowZ = [b * f - a * e * d, b * e + a * f * d, a * c];
    const extent = (row: number[]) => Math.hypot(row[0] * scale[0], row[1] * scale[1], row[2] * scale[2]);
    return { x: extent(rowX), z: extent(rowZ) };
}

/** Boulders that line the course. Each keeps the spot the course has always
 * given it unless its footprint would reach the road or a set piece somewhere
 * along its length; then it steps outward just far enough to clear them. */
export function rallyRocks(track: RallyTrack): RallyRock[] {
    const random = sunscarRandom(817);
    const keepOuts = rallyKeepOuts(track);
    const rocks: RallyRock[] = [];
    for (let d = 0; d < track.length + 40; d += 12) {
        const p = rallyPath(track, d);
        const width = rallySection(track, d).width;
        for (const side of [-1, 1] as const) {
            const high = track.scenery === 'canyon' ? 6 + random() * 12 : 1 + random() * 5;
            const offset = width / 2 + 6 + random() * 12;
            const along = d + random() * 8;
            const rotation: Vec3 = [random() * .5, random() * 6, random() * .4];
            const scale: Vec3 = [high * .7, high, high * .8];
            const extent = rallyRockHalfExtents(rotation, scale);
            const road = rallyRoadEdge(track, along - extent.z, along + extent.z, side) + side * (RALLY_ROCK_CLEARANCE + extent.x);
            let x = side > 0 ? Math.max(p.x + offset, road) : Math.min(p.x - offset, road);
            for (let moved = true; moved;) {
                moved = false;
                for (const zone of keepOuts) {
                    if (zone.side !== side || zone.to < along - extent.z || zone.from > along + extent.z) continue;
                    if (x + extent.x <= zone.minX - RALLY_SET_PIECE_CLEARANCE || x - extent.x >= zone.maxX + RALLY_SET_PIECE_CLEARANCE) continue;
                    const beyond = side > 0 ? zone.maxX + RALLY_SET_PIECE_CLEARANCE + extent.x : zone.minX - RALLY_SET_PIECE_CLEARANCE - extent.x;
                    // Only ever outward, and only by a real amount: rounding can
                    // leave a boulder that already sits on the far edge "touching" it.
                    if (side * (beyond - x) > 1e-6) { x = beyond; moved = true; }
                }
            }
            rocks.push({ position: [x, p.y + high * .25 - 1, -along], rotation, scale });
        }
    }
    return rocks;
}
