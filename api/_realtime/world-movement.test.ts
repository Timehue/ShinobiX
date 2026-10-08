import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldMovementGate } from './world-movement.js';
import { worldPositionModel, WORLD_LAYOUT_VERSION, CONTINUOUS_WORLD_SPACE } from '../../shared/continuous-world-layout.js';
import { buildWorldNavigation } from '../../shared/continuous-world-navigation.js';
import type { OnlinePlayer } from './types.js';
const model = worldPositionModel(), nodes = buildWorldNavigation(CONTINUOUS_WORLD_SPACE).nodes;
// Road nodes are numbered along their corridor, so a long road gives a straight walk.
const road = CONTINUOUS_WORLD_SPACE.roads.find(r => r.length > 12)!, key = `${road.a.sector}-${road.b.sector}`;
const nodeAt = (serial: number) => nodes.find(n => n.id === `road:${key}:${serial}`)!;
const a = nodeAt(4);
const b = nodeAt(5).id;
const position = { layoutVersion: WORLD_LAYOUT_VERSION, from: a.id, to: b, progress: 0 };
/** A resting cursor `steps` road nodes beyond `a`. */
const along = (steps: number) => ({ layoutVersion: WORLD_LAYOUT_VERSION, from: nodeAt(4 + steps).id, to: nodeAt(4 + steps).id, progress: 0 });
function actor(): OnlinePlayer {
    const location = model.location(position);
    return { name: 'rill', displayName: 'Rill', ...location, worldPosition: position, character: null,
        lastSeenAt: 1000, connectedAt: 1000, pendingAttacker: null, movementSeq: 0 };
}

test('admission uses server time and consumes one shared movement budget', () => {
    const gate = createWorldMovementGate(), player = actor();
    const burst = gate.admit(player, along(2), 0, 1000);
    assert(burst.ok); assert(Math.abs(burst.distance - 2) < 1e-8);
    player.worldPosition = burst.position; player.movementSeq = 1;
    const onward = { ...along(2), to: along(3).from, progress: .6 };
    assert.deepEqual(gate.admit(player, onward, 1, 1000), { ok: false, reason: 'speed' });
    const later = gate.admit(player, onward, 1, 1100);
    assert(later.ok); assert(Math.abs(later.distance - .6) < 1e-8);
});

test('the first step after the idle sweep keeps the walk instead of snapping back', () => {
    const gate = createWorldMovementGate(), player = actor();
    assert(gate.admit(player, position, 0, 1000).ok);
    // 256 requests after a 90 s rest prune every idle clock, including this one.
    const bystander = { ...actor(), name: 'bystander' };
    for (let i = 0; i < 256; i++) gate.admit(bystander, position, 99, 200_000);
    const resumed = gate.admit(player, { ...position, progress: .9 }, 0, 200_000);
    assert(resumed.ok, JSON.stringify(resumed));
});

test('stale/replayed sequence and locked players cannot move', () => {
    const gate = createWorldMovementGate(), player = actor();
    assert.deepEqual(gate.admit(player, position, -1, 1000), { ok: false, reason: 'sequence' });
    for (const lock of [{ inBattle: true }, { travelingUntil: 2000 }, { locationUnverified: true }]) {
        assert.deepEqual(gate.admit({ ...player, ...lock }, position, 0, 1000), { ok: false, reason: 'locked' });
    }
});

test('unknown layouts and distant destinations fail without changing the player', () => {
    const gate = createWorldMovementGate(), player = actor(), before = structuredClone(player);
    assert.deepEqual(gate.admit(player, { ...position, layoutVersion: 'forged' }, 0, 1000), { ok: false, reason: 'position' });
    assert.deepEqual(gate.admit(player, model.fallback(27, 78), 0, 1000), { ok: false, reason: 'speed' });
    assert.deepEqual(player, before);
});

test('idle time cannot bank a cross-world teleport', () => {
    const gate = createWorldMovementGate(), player = actor();
    assert(gate.admit(player, position, 0, 1000).ok);
    assert.deepEqual(gate.admit(player, model.fallback(27, 78), 0, 9999999), { ok: false, reason: 'speed' });
});
