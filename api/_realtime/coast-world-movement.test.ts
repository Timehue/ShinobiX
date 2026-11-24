import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coastWalkSpace, sectorPositionModel } from '../_coast-walk-space.js';
import { buildWorldNavigation, worldRoute } from '../../shared/continuous-world-navigation.js';
import { COAST_DOCK, coastExits, coastSitesInSector } from '../../shared/coast-world.js';
import { coastEntryRefusal } from '../_coast-admission.js';

process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.NODE_ENV = 'test';

test('every admitted coast position connects to the dock at every stage of the crossing', () => {
    const { byId, nodes } = buildWorldNavigation(coastWalkSpace);
    for (const [region, lastGarrison] of [[1, false], [2, false], [3, false], [4, false], [5, false], [5, true]] as const) {
        const admission = { level: 100, boat: true, secondDock: true, region, lastGarrison };
        const sectors = new Set(coastWalkSpace.chunks.map(chunk => chunk.sector)
            .filter(sector => !coastEntryRefusal(admission, sector)));
        const queue = [`${COAST_DOCK.sector}:${COAST_DOCK.tile}`], reached = new Set(queue);
        for (const id of queue) for (const next of byId.get(id)!.neighbors) {
            if (!reached.has(next) && sectors.has(byId.get(next)!.sector)) {
                reached.add(next);
                queue.push(next);
            }
        }
        for (const node of nodes) assert.equal(reached.has(node.id), sectors.has(node.sector), node.id);
        assert.equal(sectors.size, region * 10 - Number(region === 5 && !lastGarrison));
    }
});

test('choosing a coast trail from another trail or site walks directly to the named neighbour', () => {
    const { byId } = buildWorldNavigation(coastWalkSpace);
    for (const { sector } of coastWalkSpace.chunks) {
        const exits = coastExits(sector);
        const starts = new Set([...exits.map(exit => exit.tile), ...coastSitesInSector(sector).map(site => site.approach)]);
        for (const tile of starts) for (const exit of exits) {
            const route = worldRoute(byId, `${sector}:${tile}`, `${exit.destinationSector}:${exit.destinationTile}`, true);
            assert.ok(route, exit.id);
            const crossed = route.map(id => byId.get(id)!.sector).filter((s, i, all) => s !== all[i - 1]);
            assert.deepEqual(crossed, [sector, exit.destinationSector], exit.id + ' from tile ' + tile);
        }
    }
});

test('coast seam uses the saved region, a durable cursor and a coast-only nearby roster', async () => {
    const { applyWorldMovement, nearbyWorldPlayers } = await import('./world-movement-service.js');
    const { onlineStore } = await import('./online-store.js');
    const { readWalkedTile, resumeWorldPositionFor } = await import('./walked-tile.js');
    const { kv } = await import('../_storage.js');
    const graph = buildWorldNavigation(coastWalkSpace), model = sectorPositionModel(101);
    const mouth = graph.nodes.find(n => n.road === '101-111' && n.sector === 101
        && n.neighbors.some(id => graph.byId.get(id)?.sector === 111))!;
    const across = graph.byId.get(mouth.neighbors.find(id => graph.byId.get(id)?.sector === 111)!)!;
    const cursor = (id: string) => ({ layoutVersion: coastWalkSpace.layoutVersion, from: id, to: id, progress: 0 });
    const from = cursor(mouth.id), to = cursor(across.id);
    const name = 'coastwalker';
    const walker = onlineStore.upsert({ name, sector: 101, restoredWorldPosition: from, tile: model.location(from).tile, character: null });
    onlineStore.upsert({ name: 'coastpeer', sector: 111, restoredWorldPosition: to, tile: model.location(to).tile, character: null });
    onlineStore.upsert({ name: 'homepeer', sector: 9, tile: 78, character: null });
    assert.deepEqual(nearbyWorldPlayers(walker).map(p => p.name), ['coastpeer']);
    const move = () => applyWorldMovement(name, { expectedSequence: 0, worldPosition: to });
    const save = (region: number) => kv.set('save:' + name, { character: { level: 85 }, questLines: {
        v: 1, active: {}, done: { 'shuttered-boat': { at: 1, marks: 1, opensRegion: region, unlocks: ['boat'] } },
    } });
    await save(1);
    assert.equal((await move()).ok, false);
    assert.deepEqual(onlineStore.get(name)?.worldPosition, from);
    await save(2);
    const accepted = await move();
    assert.ok(accepted.ok, JSON.stringify(accepted));
    assert.equal(accepted.sector, 111);
    assert.deepEqual(accepted.worldPosition, to);
    const { getTravelLease } = await import('./travel-lease.js');
    assert.deepEqual((await getTravelLease(name))?.worldPosition, to);
    // The lease commits before acknowledgement. The regular position checkpoint follows asynchronously.
    await new Promise<void>(resolve => setImmediate(resolve));
    const checkpoint = await readWalkedTile(kv, name);
    assert.deepEqual(resumeWorldPositionFor(checkpoint, 111, undefined), to);
    assert.equal(sectorPositionModel(9).read(to), null);
    assert.equal(model.fallback(9, 78), null);
});
