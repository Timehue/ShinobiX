import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rallyEconomyLabels, type PlacedRallyLabel, type RallyLabel, type RallyLabelRect } from './rally-economy-labels';
import { rallyEconomyFinishSlot, rallyEconomyProjection } from './rally-economy-projection';
import { rallyEconomyPose } from './rally-economy-pose';
import { RALLY_TRACKS } from '../../../../shared/sunscar/rally-tracks';

const viewports = [{ width: 302, height: 173.8 }, { width: 320, height: 214.4 }];
const track = RALLY_TRACKS[0];
const companions = [
    { id: 'player', measuredWidth: 20 },
    { id: 'pebble-tortoise', measuredWidth: 82 },
    { id: 'azure-dragon', measuredWidth: 78 },
    { id: 'shadow-lynx', measuredWidth: 74 },
];

// Fixture geometry follows the real projection and planted/jumping sprite pose;
// these widths cover measured short player and longer companion nameplates.
function racerLabel({ width, height }: { width: number; height: number }, index: number, distance: number, lane = 0, jump = 0, measuredWidth = companions[index].measuredWidth, playerDistance = 78): RallyLabel {
    const point = rallyEconomyProjection(track, playerDistance, distance, lane, width, height);
    assert.equal(point.visible, true);
    const size = Math.max(7, point.unit * 1.5 * point.scale);
    const pose = rallyEconomyPose({ groundY: point.y, spriteHeight: size * 1.6,
        jumpLift: jump * point.unit * point.scale * .7, motion: jump ? 'airborne' : 'run', landingTicks: 0, reducedMotion: false });
    const font = Math.max(10, Math.min(14, Math.round(size * .22)));
    return { id: companions[index].id, width: Math.min(width - 8, measuredWidth + 10), height: font + 8,
        anchor: { x: point.x, y: point.y }, preferredY: point.y + size * .2,
        body: { x: point.x - pose.width / 2, y: pose.top, width: pose.width, height: pose.height } };
}

function assertSafe(placed: PlacedRallyLabel[], blocked: RallyLabelRect[], width: number, height: number) {
    assert.equal(new Set(placed.map(label => label.id)).size, placed.length, 'each companion gets at most one nameplate');
    for (const [index, label] of placed.entries()) {
        assert.ok([label.x, label.y, label.width, label.height].every(Number.isFinite));
        assert.ok(label.x >= 4 && label.y >= 4, `${label.id} starts inside the safe edge`);
        assert.ok(label.x + label.width <= width - 4 + 1e-9 && label.y + label.height <= height - 4 + 1e-9,
            `${label.id} ends inside the safe edge`);
        // A separating axis proves nonintersection; do not reproduce the
        // helper's candidate generation, scoring or collision predicate.
        for (const other of [...blocked, ...placed.slice(0, index)]) {
            const horizontalGap = Math.max(other.x - (label.x + label.width), label.x - (other.x + other.width));
            const verticalGap = Math.max(other.y - (label.y + label.height), label.y - (other.y + other.height));
            assert.ok(Math.max(horizontalGap, verticalGap) >= 2 - 1e-9,
                `${label.id} is separated from every sprite, hazard and earlier label`);
        }
    }
}

test('all four packed same-lane companions retain separated nameplates in minimum portrait and landscape courses', () => {
    for (const viewport of viewports) {
        const labels = companions.map((_, index) => racerLabel(viewport, index, 78 + index * 1.25));
        const blocked = labels.map(label => label.body);
        const placed = rallyEconomyLabels(labels, blocked, viewport.width, viewport.height);
        assert.equal(placed.length, 4, `${viewport.width}x${viewport.height} keeps the complete packed field readable`);
        assertSafe(placed, blocked, viewport.width, viewport.height);
    }
});

test('finish slots retain all four edge-clamped long names without covering podium pets', () => {
    for (const viewport of viewports) {
        const labels = companions.map((_, index) => {
            const slot = rallyEconomyFinishSlot(index);
            return racerLabel(viewport, index, track.length + slot.distance, slot.lane, 0, 480, track.length);
        });
        assert.ok(labels.every(label => label.width === viewport.width - 8), 'oversized name metrics exercise renderer clamping');
        const blocked = labels.map(label => label.body);
        const placed = rallyEconomyLabels(labels, blocked, viewport.width, viewport.height);
        assert.equal(placed.length, 4, 'the podium keeps four long names using separate free rows');
        assertSafe(placed, blocked, viewport.width, viewport.height);
    }
});

test('physical jumps move the blocked body while packed grounded and airborne companions remain labeled', () => {
    for (const viewport of viewports) {
        const labels = companions.map((_, index) => racerLabel(viewport, index, 78 + index * 2, 0, index % 2 ? 1.8 : 0));
        const grounded = racerLabel(viewport, 1, 80);
        assert.ok(labels[1].body.y < grounded.body.y - 20, 'fixture includes an actual physics-derived airborne body');
        const blocked = labels.map(label => label.body);
        const placed = rallyEconomyLabels(labels, blocked, viewport.width, viewport.height);
        assert.equal(placed.length, 4);
        assertSafe(placed, blocked, viewport.width, viewport.height);
    }
});

test('a barrier and technique shot near the preferred nameplate force a safe relocation', () => {
    for (const viewport of viewports) {
        const label = racerLabel(viewport, 0, 78);
        const point = rallyEconomyProjection(track, 78, 78, 0, viewport.width, viewport.height);
        const size = Math.max(7, point.unit * 1.5 * point.scale);
        const barrier = { x: point.x - size * .55, y: point.y - size * .7, width: size * 1.1, height: size * .7 + 5 };
        // A close chasing technique shot occupies the otherwise preferred row.
        const shotPoint = rallyEconomyProjection(track, 78, 73, 0, viewport.width, viewport.height);
        const radius = Math.max(3, 7 * shotPoint.scale);
        const shot = { x: shotPoint.x - radius, y: shotPoint.y - 9 * shotPoint.scale - radius, width: radius * 2, height: radius * 2 };
        const clear = rallyEconomyLabels([label], [label.body], viewport.width, viewport.height);
        const blocked = [label.body, barrier, shot];
        const placed = rallyEconomyLabels([label], blocked, viewport.width, viewport.height);
        assert.equal(placed.length, 1, 'one nearby hazard does not erase a readable name');
        assertSafe(placed, blocked, viewport.width, viewport.height);
        assert.notDeepEqual({ x: placed[0].x, y: placed[0].y }, { x: clear[0].x, y: clear[0].y }, 'shot obstructs the formerly preferred placement');
    }
});

test('identical course geometry produces identical nameplate placements without changing its inputs', () => {
    const viewport = viewports[0];
    const labels = companions.map((_, index) => racerLabel(viewport, index, 78 + index));
    const blocked = labels.map(label => label.body);
    const original = structuredClone({ labels, blocked });
    const first = rallyEconomyLabels(labels, blocked, viewport.width, viewport.height);
    const second = rallyEconomyLabels(structuredClone(labels), structuredClone(blocked), viewport.width, viewport.height);
    assert.deepEqual(second, first);
    assert.deepEqual({ labels, blocked }, original);
    assertSafe(first, blocked, viewport.width, viewport.height);
});

test('fully blocked space and an unfit nameplate are safely omitted', () => {
    const viewport = viewports[0];
    const labels = companions.map((_, index) => racerLabel(viewport, index, 78 + index));
    assert.deepEqual(rallyEconomyLabels(labels, [{ x: 0, y: 0, ...viewport }], viewport.width, viewport.height), []);
    const unfit = { ...labels[0], width: viewport.width - 7 };
    assert.deepEqual(rallyEconomyLabels([unfit], [], viewport.width, viewport.height), []);
});
