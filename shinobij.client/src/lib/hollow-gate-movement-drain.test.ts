import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainHollowGateMovement } from './hollow-gate-movement-drain';
import type { HollowGateShrineRun } from '../types/character';
import type { HollowGateMoveEffect } from './hollow-gate-movement-projection';

function fixture() {
    let live: HollowGateShrineRun | null = { width: 5, height: 3, playerX: 1, playerY: 1, floor: 1, runToken: 'run-one', keys: 0, torch: 8, threat: 0, completed: false,
        tiles: Array.from({ length: 15 }, () => ({ kind: 'empty', revealed: true, resolved: false })) };
    let player = 'scout'; const calls: string[] = [];
    const effect = (x: number, kind: 'empty' | 'chest' | 'descend' = 'empty'): HollowGateMoveEffect => ({ wallBump: false, torchSputtered: false, ambushImmediate: false,
        justResolved: { tile: { kind, revealed: true, resolved: false }, nx: x, ny: 1 }, step: { requestId: `step-${x}-request`, fromX: x - 1, fromY: 1, toX: x, toY: 1 } });
    const ctx: Parameters<typeof drainHollowGateMovement>[0] = { playerName: player, run: live, currentPlayer: () => player, currentRun: () => live,
        queue: { current: [effect(2), effect(3)] }, setRun: update => { live = update(live); }, log: () => calls.push('log'), stopWalk: () => calls.push('stop'),
        acceptVersion: () => calls.push('version'), openPending: () => calls.push('pending'), openBattle: () => { calls.push('battle'); },
        resolveTile: async tile => { calls.push(`tile:${tile.kind}`); }, sealStep: async req => { calls.push(`seal:${req.toX}:floor:${req.floor}`); return { ok: true, position: { x: req.toX, y: req.toY }, torch: 7, threat: 4 }; } };
    return { ctx, calls, effect, run: () => live!, replace: (next: HollowGateShrineRun | null) => { live = next; }, changePlayer: () => { player = 'other'; } };
}
test('a chest dialog stops the captured batch and restores the accepted interaction tile', async () => {
    const f = fixture(); f.ctx.queue.current = [f.effect(2, 'chest'), f.effect(3)];
    await drainHollowGateMovement(f.ctx);
    assert.deepEqual(f.calls, ['seal:2:floor:1', 'version', 'tile:chest', 'stop']); assert.equal(f.run().playerX, 2);
});
test('a traveler on an already-resolved tile stops walking and receives the accepted server roster', async () => {
    const f = fixture(), npcs = [{ role: 'medic' as const, origin: 7, tile: 7, nodeId: 'floor:1:tile:7' }];
    f.ctx.queue.current[0].justResolved = null;
    f.ctx.sealStep = async () => ({ ok: true, position: { x: 2, y: 1 }, wanderers: npcs });
    f.ctx.resolveTile = async (tile, _x, _y, roster) => { assert.equal(tile.kind, 'npc'); assert.deepEqual(roster, npcs); f.calls.push('traveler'); };
    await drainHollowGateMovement(f.ctx); assert.deepEqual(f.calls, ['version', 'traveler', 'stop']);
});
for (const change of ['floor', 'token', 'account', 'exit'] as const) test(`a delayed movement reply cannot touch another ${change}`, async () => {
    const f = fixture(); let release: (() => void) | undefined;
    f.ctx.sealStep = async () => { await new Promise<void>(resolve => { release = resolve; }); return { ok: true, torch: 0, threat: 100, ambush: { kind: 'battle', nodeId: 'floor:1:tile:9' } }; };
    const pending = drainHollowGateMovement(f.ctx);
    if (change === 'exit') f.replace(null);
    else if (change === 'account') f.changePlayer();
    else f.replace({ ...f.run(), ...(change === 'floor' ? { floor: 2 } : { runToken: 'run-two' }) });
    f.ctx.queue.current = [f.effect(4)]; release!(); await pending;
    assert.deepEqual(f.calls, []); assert.equal(f.ctx.queue.current.length, 1, 'the newer input queue is retained');
    if (change !== 'exit') assert.equal(f.run().torch, 8);
});
test('descent during tile resolution aborts the old batch without rewinding the new floor', async () => {
    const f = fixture(); f.ctx.resolveTile = async () => { f.replace({ ...f.run(), floor: 2, playerX: 0, playerY: 0, torch: 10 }); };
    await drainHollowGateMovement(f.ctx); assert.equal(f.run().floor, 2); assert.equal(f.run().playerX, 0); assert.equal(f.calls.filter(c => c.startsWith('seal')).length, 1);
});
test('a rejected combat step stops the walker and reopens the exact unresolved node', async () => {
    const f = fixture(); f.ctx.sealStep = async () => ({ ok: false, position: { x: 1, y: 1 }, sealedCombat: { nodeId: 'floor:1:tile:6', kind: 'elite' } });
    f.ctx.openBattle = opts => { assert.deepEqual(opts, { nodeId: 'floor:1:tile:6', isElite: true }); f.calls.push('battle'); };
    await drainHollowGateMovement(f.ctx); assert.deepEqual(f.calls, ['stop', 'log', 'battle']); assert.equal(f.run().playerX, 1);
});

 test('a threat ambush on the stairs takes priority over the descent dialog', async () => {
    const f = fixture(); f.ctx.queue.current = [f.effect(2, 'descend'), f.effect(3)];
    f.ctx.sealStep = async () => ({ ok: true, position: { x: 2, y: 1 }, torch: 7, threat: 100,
        ambush: { kind: 'ambush', nodeId: 'floor:1:ambush:threat-v9' } });
    await drainHollowGateMovement(f.ctx);
    assert.ok(!f.calls.some(c => c.startsWith('tile:'))); assert.ok(f.calls.includes('pending'));
    assert.equal(f.run().playerX, 2); assert.equal(f.ctx.queue.current.length, 0);
});
