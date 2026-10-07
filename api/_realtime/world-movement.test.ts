import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldMovementGate } from './world-movement.js';
import { worldPositionModel, WORLD_LAYOUT_VERSION, CONTINUOUS_WORLD_SPACE } from '../../shared/continuous-world-layout.js';
import { buildWorldNavigation } from '../../shared/continuous-world-navigation.js';
import type { OnlinePlayer } from './types.js';
const model = worldPositionModel(), nodes = buildWorldNavigation(CONTINUOUS_WORLD_SPACE).nodes;
const a = nodes.find(n => n.road && n.neighbors.length === 2)!;
const b = a.neighbors[0]!;
const position = { layoutVersion: WORLD_LAYOUT_VERSION, from: a.id, to: b, progress: 0 };
function actor(): OnlinePlayer {
    const location = model.location(position);
    return { name: 'rill', displayName: 'Rill', ...location, worldPosition: position, character: null,
        lastSeenAt: 1000, connectedAt: 1000, pendingAttacker: null, movementSeq: 0 };
}

test('admission uses server time and consumes one shared movement budget', () => {
    const gate = createWorldMovementGate(), player = actor();
    const first = gate.admit(player, { ...position, progress: .2 }, 0, 1000);
    assert(first.ok); player.worldPosition = first.position; player.movementSeq = 1;
    assert.deepEqual(gate.admit(player, { ...position, progress: .8 }, 1, 1000), { ok: false, reason: 'speed' });
    const later = gate.admit(player, { ...position, progress: .8 }, 1, 1100);
    assert(later.ok); assert(Math.abs(later.distance - .6) < 1e-8);
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
