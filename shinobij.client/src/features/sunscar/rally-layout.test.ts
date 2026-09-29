import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { RALLY_TRACKS, rallyLanePosition, rallyPath, rallyPathFrame, rallySection, rallyTrackCoordinates } from '../../../../shared/sunscar/rally-tracks';
import { sunscarRandom } from '../../../../shared/sunscar/random';
import { RALLY_CROWD_BAND, RALLY_RIBBON_START, RALLY_RIBBON_STEP, rallyArch, rallyCrowdSpots, rallyGrandstands, rallyKeepOuts, rallyPavilions, rallyRoadHalfWidth, rallyRocks, type RallyRock } from './rally-layout';
import { rallyCameraGoal } from './rally-presentation';

// The same mesh RouteScenery instances, so these tests check what players see
// rather than trusting the layout's own bounding maths.
const icosahedron = new THREE.IcosahedronGeometry(1, 1);
function rockMatrix(rock: RallyRock): THREE.Matrix4 {
    const dummy = new THREE.Object3D();
    dummy.position.set(...rock.position); dummy.rotation.set(...rock.rotation); dummy.scale.set(...rock.scale);
    dummy.updateMatrix();
    return dummy.matrix;
}
function rockSurface(rock: RallyRock): THREE.Vector3[] {
    const matrix = rockMatrix(rock), position = icosahedron.attributes.position, points: THREE.Vector3[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 3) {
        a.fromBufferAttribute(position, i).applyMatrix4(matrix);
        b.fromBufferAttribute(position, i + 1).applyMatrix4(matrix);
        c.fromBufferAttribute(position, i + 2).applyMatrix4(matrix);
        for (let u = 0; u <= 4; u++) for (let v = 0; v <= 4 - u; v++) {
            points.push(new THREE.Vector3().addScaledVector(a, u / 4).addScaledVector(b, v / 4).addScaledVector(c, 1 - (u + v) / 4));
        }
    }
    return points;
}
const aboveGround = (track: (typeof RALLY_TRACKS)[number], point: THREE.Vector3) => point.y > rallyPath(track, -point.z).y;
const surfaces = new Map(RALLY_TRACKS.map(track => [track.id, rallyRocks(track).map(rock => ({ rock, surface: rockSurface(rock).filter(p => aboveGround(track, p)) }))]));

test('track-local coordinate projection recovers lanes across every bend', () => {
    for (const track of RALLY_TRACKS) for (const distance of [0, 155, 245, 430, 660, track.length - 1]) for (const lateral of [-16, -2.65, 0, 2.65, 16]) {
        const point = rallyLanePosition(track, distance, lateral);
        const projected = rallyTrackCoordinates(track, point.x, point.z);
        assert.ok(Math.abs(projected.distance - distance) < .08, `${track.name} distance ${distance}: ${projected.distance}`);
        assert.ok(Math.abs(projected.lateral - lateral) < .08, `${track.name} lane ${lateral}: ${projected.lateral}`);
    }
});

test('no boulder reaches onto the drawn road on any course', () => {
    for (const track of RALLY_TRACKS) {
        const roadEnd = RALLY_RIBBON_START + Math.ceil((track.length + 70) / RALLY_RIBBON_STEP) * RALLY_RIBBON_STEP;
        const offenders: string[] = [];
        for (const [index, { surface }] of surfaces.get(track.id)!.entries()) {
            let worst = Infinity;
            for (const point of surface) {
                const { distance, lateral } = rallyTrackCoordinates(track, point.x, point.z);
                if (distance < RALLY_RIBBON_START || distance > roadEnd) continue;
                worst = Math.min(worst, Math.abs(lateral) - rallyRoadHalfWidth(track, distance));
            }
            if (worst < .5) offenders.push(`#${index} ${worst.toFixed(2)}m`);
        }
        assert.deepEqual(offenders, [], `${track.name}: boulders must stay at least 0.5m off the road`);
    }
});

// Footprints of the drawn set pieces, built from their placements and the
// mesh sizes in RallyTrackScene / RallyCrowd, independently of rallyKeepOuts.
type Box = { name: string; from: number; to: number; minLateral: number; maxLateral: number };
function setPieceBoxes(track: (typeof RALLY_TRACKS)[number]): Box[] {
    const boxes: Box[] = [];
    const square = (name: string, center: number, distance: number, half: number, depth = half) => boxes.push({ name, from: distance - depth, to: distance + depth, minLateral: center - half, maxLateral: center + half });
    const roof = 3.6 * Math.SQRT1_2; // coneGeometry(3.6, _, 4) turned 45 degrees
    for (const [i, p] of rallyPavilions(track).entries()) {
        const position = rallyTrackCoordinates(track, p.x, p.z);
        square(`pavilion ${i}`, position.lateral, position.distance, roof);
    }
    for (const stand of rallyGrandstands(track)) {
        const center = rallyTrackCoordinates(track, stand.x, stand.z);
        for (const row of [0, 1, 2]) square(`grandstand ${stand.side} row ${row}`, center.lateral + stand.side * row, center.distance, 1.5, 9);
        square(`grandstand ${stand.side} pavilion`, center.lateral + stand.side * 2, center.distance + 8, roof);
    }
    for (const spot of rallyCrowdSpots(track)) for (let i = 0; i < RALLY_CROWD_BAND.count; i++) {
        const d = spot + i * RALLY_CROWD_BAND.spacing, half = rallyRoadHalfWidth(track, d);
        for (const side of [-1, 1]) {
            const a = side * (half + RALLY_CROWD_BAND.inner), b = side * (half + RALLY_CROWD_BAND.inner + RALLY_CROWD_BAND.depth);
            boxes.push({ name: `spectator ${spot}/${i}${side}`, from: d - .15, to: d + .15, minLateral: Math.min(a, b) - .3, maxLateral: Math.max(a, b) + .3 });
        }
    }
    for (const d of [0, track.length]) {
        const { post } = rallyArch(track, d);
        for (const side of [-1, 1]) square(`arch post ${d}${side}`, side * post, d, .225);
    }
    return boxes;
}

test('no boulder cuts through a grandstand, pavilion, spectator or arch post', () => {
    for (const track of RALLY_TRACKS) {
        const offenders: string[] = [];
        for (const [index, { surface }] of surfaces.get(track.id)!.entries()) {
            for (const box of setPieceBoxes(track)) {
                if (surface.some(p => {
                    const point = rallyTrackCoordinates(track, p.x, p.z);
                    return point.distance >= box.from && point.distance <= box.to && point.lateral >= box.minLateral && point.lateral <= box.maxLateral;
                })) offenders.push(`#${index} in ${box.name}`);
            }
        }
        assert.deepEqual(offenders.slice(0, 8), [], `${track.name}: ${offenders.length} set-piece hits`);
    }
});

test('the set pieces themselves stand beside the road', () => {
    for (const track of RALLY_TRACKS) {
        for (const zone of rallyKeepOuts(track)) {
            for (let d = zone.from; d <= zone.to; d += .5) {
                const half = rallyRoadHalfWidth(track, d);
                const gap = zone.side > 0 ? zone.minLateral - half : -zone.maxLateral - half;
                assert.ok(gap > 0, `${track.name} ${zone.name} stands ${gap.toFixed(2)}m from the road at ${d.toFixed(1)}`);
            }
        }
    }
});

test('no boulder hides the chase camera or blocks its view of your pet', () => {
    for (const track of RALLY_TRACKS) {
        const rocks = rallyRocks(track).map(rock => ({ z: rock.position[2], reach: Math.max(...rock.scale), inverse: rockMatrix(rock).clone().invert() }));
        const inside = (point: THREE.Vector3) => rocks.some(r => Math.abs(r.z - point.z) <= r.reach && point.clone().applyMatrix4(r.inverse).lengthSq() < 1);
        const blocked: string[] = [];
        const look = (from: THREE.Vector3, to: THREE.Vector3, what: string) => {
            for (let t = 0; t <= .95; t += .05) if (inside(from.clone().lerp(to, t))) { blocked.push(what); return; }
        };
        for (let distance = 0; distance <= track.length; distance += 3) {
            for (const lane of [-1, -.5, 0, .5, 1]) for (const jump of [0, 4]) {
                const goal = rallyCameraGoal(track, { distance, lane, jump }, false, 390 / 700, false);
                const camera = new THREE.Vector3(...goal.position), path = rallyLanePosition(track, distance, lane * 2.65);
                look(camera, new THREE.Vector3(path.x, path.y + jump + .9, path.z), `pet at ${distance}m lane ${lane}`);
                look(camera, new THREE.Vector3(...goal.look), `view at ${distance}m lane ${lane}`);
            }
        }
        // The finish camera pulls back further on a portrait phone.
        for (const aspect of [320 / 480, 390 / 700, 16 / 9]) {
            const goal = rallyCameraGoal(track, { distance: track.length, lane: 0, jump: 0 }, true, aspect, false);
            look(new THREE.Vector3(...goal.position), new THREE.Vector3(...goal.look), `finish camera at aspect ${aspect.toFixed(2)}`);
        }
        assert.deepEqual(blocked.slice(0, 5), [], `${track.name}: ${blocked.length} camera samples see a boulder first`);
    }
});

test('boulders that touch nothing keep the spot the course always gave them', () => {
    // The authored layout: same seed and draws the scenery has always used.
    for (const track of RALLY_TRACKS) {
        const random = sunscarRandom(817), rocks = rallyRocks(track);
        let index = 0, kept = 0;
        for (let d = 0; d < track.length + 40; d += 12) {
            const width = rallySection(track, d).width;
            for (const side of [-1, 1]) {
                const high = track.scenery === 'canyon' ? 6 + random() * 12 : 1 + random() * 5;
                const offset = width / 2 + 6 + random() * 12, distance = d + random() * 8;
                const rotation = [random() * .5, rallyPathFrame(track, distance).yaw + random() * 6, random() * .4];
                const rock = rocks[index++], point = rallyTrackCoordinates(track, rock.position[0], rock.position[2], distance);
                assert.ok(Math.abs(rock.distance - distance) < .01 && Math.abs(point.distance - distance) < .1, `${track.name} boulder ${index - 1} follows the course distance`);
                assert.ok(Math.abs(rock.position[1] - (rallyPath(track, distance).y + high * .25 - 1)) < .01, `${track.name} boulder ${index - 1} follows course height`);
                assert.deepEqual([...rock.rotation, ...rock.scale], [...rotation.slice(0, 1), rotation[1], rotation[2], high * .7, high, high * .8]);
                if (Math.abs(point.lateral - side * offset) < .1) kept++;
                else assert.ok(side * (point.lateral - side * offset) > 0, `${track.name} boulder ${index - 1} may only step outward`);
            }
        }
        assert.equal(index, rocks.length);
        const share = kept / rocks.length;
        // A small number of festival props on bends legitimately push rocks
        // farther out; the layout should still retain most authored placements.
        assert.ok(track.scenery === 'canyon' ? share > .4 : share > .85, `${track.name} keeps ${(share * 100).toFixed(0)}% of its authored boulders`);
    }
});

test("Scorpion's Spine still reads as a canyon after the walls step back", () => {
    const track = RALLY_TRACKS.find(t => t.scenery === 'canyon')!;
    const gaps = surfaces.get(track.id)!.map(({ rock, surface }) => {
        const distance = -rock.position[2];
        const near = surface.filter(p => Math.abs(-p.z - distance) < 1);
        return Math.min(...near.map(p => Math.abs(rallyTrackCoordinates(track, p.x, p.z, distance).lateral))) - rallyRoadHalfWidth(track, distance);
    }).filter(Number.isFinite).sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    assert.ok(median < 6, `canyon walls sit a median ${median.toFixed(2)}m from the road; they should frame it`);
});

test('the drawn road width follows the ribbon, tapering across a section seam', () => {
    for (const track of RALLY_TRACKS) {
        for (let i = 0; i < 60; i++) {
            const d = RALLY_RIBBON_START + i * RALLY_RIBBON_STEP;
            assert.equal(rallyRoadHalfWidth(track, d), rallySection(track, Math.max(0, d)).width / 2);
        }
    }
});

test('start and finish arches stand beside the road and the checkered line spans it', () => {
    for (const track of RALLY_TRACKS) {
        for (const d of [0, track.length]) {
            const arch = rallyArch(track, d);
            assert.ok(arch.post - .225 > arch.half + .2, `${track.name} arch post at ${d} must stand off the road`);
            assert.ok(Math.abs(arch.tile * arch.tiles - arch.half * 2) < 1e-9, `${track.name} checkered line must span the road`);
            assert.ok(arch.tile > .8 && arch.tile < 1.2, `${track.name} checkered tiles stay roughly square`);
        }
    }
});
