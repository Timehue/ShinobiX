// Harvest meadow placement (docs/harvesting-minigame-plan.md §5). Each node was
// picked from open walkable ground and then checked against its sector painting
// (RESOURCE_MEADOW_TILES); these tests hold the same rules the newer fishing and
// mining nodes follow (shinobij.client/src/lib/resource-node-placement.test.ts),
// so the meadows can join the visible map in Phase 3 without moving.
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { HARVEST_BLOOM_MS, HARVEST_MARKER_LIFT, HARVEST_NODES, RESOURCE_NODES, WORLD_BOSS_CRYSTAL_NODES, harvestBloom, harvestNodeAs, harvestNodeAt, resourceNode, resourceNodeOffer, resourceNodePosition, validResourceNodeTerrain } from './resource-nodes.js';
import { RESOURCE_MEADOW_TILES } from './resource-node-terrain.js';
import { RESOURCE_REFILL_MS } from './resource-gathering.js';
import { SECTOR_PLACES, isPlayableWildSector, sectorArtKey } from './sector-geo.js';
import { SECTOR_FLOOR_LAYOUTS } from './sector-floor-layouts.js';
import { STORY_FIELD_JOURNEYS } from './story-field-work.js';
import { sectorExits } from './sector-links.js';
import { SECTOR_BUILDINGS } from './sector-buildings.js';
import { isHarvestCommonId } from './harvesting.js';

const G = 12;
const cheb = (a: number, b: number) => Math.max(Math.abs(a % G - b % G), Math.abs(Math.floor(a / G) - Math.floor(b / G)));
const manhattan = (a: number, b: number) => Math.abs(a % G - b % G) + Math.abs(Math.floor(a / G) - Math.floor(b / G));
const storyTiles = (sector: number) => Object.values(STORY_FIELD_JOURNEYS).flatMap(journey => Object.values(journey.points))
    .filter(point => point.sector === sector).map(point => point.tile);

function ownedTiles(sector: number): Map<number, string> {
    const owned = new Map<number, string>();
    const layout = SECTOR_FLOOR_LAYOUTS[sectorArtKey(sector)];
    for (const [kind, site] of Object.entries(layout?.sites ?? {})) {
        if (!site) continue;
        owned.set(site.approach, `${kind} approach`);
        const [left, top, size] = site.footprint;
        if (left === undefined || top === undefined || !size) continue;
        for (let k = 0; k < size * size; k++) owned.set((top + Math.floor(k / size)) * G + left + (k % size), `${kind} footprint`);
    }
    if (layout?.village) {
        const col = Math.min(G - 1, Math.floor(layout.village.left / 100 * G)), row = Math.min(G - 1, Math.floor(layout.village.top / 100 * G));
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) owned.set((row + dr) * G + col + dc, 'village gate');
        owned.set(layout.village.approach, 'village approach');
    }
    for (const exit of [...(layout?.exits ?? []), ...sectorExits(sector)]) owned.set(exit.tile, 'road exit');
    for (const tile of storyTiles(sector)) owned.set(tile, 'story marker');
    for (const building of SECTOR_BUILDINGS.filter(b => b.sector === sector)) {
        for (const tile of building.footprint ?? []) owned.set(tile, `${building.id} footprint`);
        owned.set(building.approach, `${building.id} approach`);
    }
    return owned;
}

describe('harvest meadows', () => {
    it('stand one per forest, shadow and central wild sector, none on ice or ash', () => {
        assert.equal(HARVEST_NODES.length, 52);
        assert.deepEqual(HARVEST_NODES.map(node => node.id), HARVEST_NODES.map((_, index) => `harvest-${index + 1}`));
        for (const place of SECTOR_PLACES) {
            if (!isPlayableWildSector(place.id)) continue;
            const count = HARVEST_NODES.filter(node => node.sector === place.id).length;
            assert.equal(count, ['forest', 'shadow', 'central'].includes(place.biome) ? 1 : 0, `sector ${place.id} (${place.biome})`);
        }
    });

    it('use only reviewed meadow cells, with the gatherer on a walkable neighbour', () => {
        assert.deepEqual(Object.fromEntries(HARVEST_NODES.map(node => [node.sector, [node.target]])), RESOURCE_MEADOW_TILES);
        for (const node of HARVEST_NODES) {
            assert.ok(validResourceNodeTerrain(node), node.id);
            assert.equal(manhattan(node.target, node.approach), 1, node.id);
            assert.equal(validResourceNodeTerrain({ ...node, target: node.approach, approach: node.target }), false, `${node.id} swapped`);
            assert.equal(validResourceNodeTerrain({ ...node, activity: 'mining' }), false, `${node.id} as a seam`);
            assert.equal(validResourceNodeTerrain({ ...node, activity: 'fishing' }), false, `${node.id} as a shoal`);
        }
    });

    it('never stand on a structure, gate, road exit, building or story marker', () => {
        for (const node of HARVEST_NODES) {
            const owned = ownedTiles(node.sector);
            for (const [label, tile] of [['target', node.target], ['approach', node.approach]] as const)
                assert.ok(!owned.has(tile), `${node.id} (sector ${node.sector}) ${label} ${tile} is on the ${owned.get(tile)}`);
        }
    });

    it('never touch another gathering marker or story marker', () => {
        for (const node of HARVEST_NODES) {
            const others = [...RESOURCE_NODES, ...WORLD_BOSS_CRYSTAL_NODES, ...HARVEST_NODES]
                .filter(other => other.sector === node.sector && other.id !== node.id);
            for (const other of others) {
                assert.ok(cheb(node.target, other.target) >= 2, `${node.id} at ${node.target} touches ${other.id} at ${other.target}`);
                assert.ok(![other.target, other.approach].includes(node.approach), `${node.id} approach is on ${other.id}`);
            }
            for (const tile of storyTiles(node.sector)) assert.ok(cheb(node.target, tile) >= 2, `${node.id} touches a story marker`);
        }
    });

    it('keep two tiles between the LIFTED meadow marker and every other gathering marker', () => {
        // On a phone the 48px touch floor makes a marker nearly two tiles wide.
        // The meadow marker draws HARVEST_MARKER_LIFT tiles up, so measure from there.
        for (const node of HARVEST_NODES) {
            const x = node.target % G + .5, y = Math.floor(node.target / G) + .5 - HARVEST_MARKER_LIFT;
            for (const other of [...RESOURCE_NODES, ...WORLD_BOSS_CRYSTAL_NODES].filter(o => o.sector === node.sector)) {
                const p = resourceNodePosition(other), ox = p.left / 100 * G, oy = p.top / 100 * G;
                const gap = Math.max(Math.abs(ox - x), Math.abs(oy - y));
                assert.ok(gap >= 2, `${node.id} (sector ${node.sector}) marker is ${gap.toFixed(2)} tiles from ${other.id}`);
            }
        }
    });

    it('pay plain herb or fiber, with bark in forests and thread in shadow above level 1', () => {
        for (const node of HARVEST_NODES) {
            assert.ok(isHarvestCommonId(node.family), node.id);
            assert.equal(node.ceiling, 0, `${node.id} is ungraded`);
            const biome = SECTOR_PLACES.find(place => place.id === node.sector)!.biome;
            const trace = node.difficulty === 1 ? undefined : biome === 'forest' ? 'gather-heartwood-bark' : biome === 'shadow' ? 'gather-shadow-thread' : undefined;
            assert.equal(node.trace, trace, node.id);
        }
        const herbs = HARVEST_NODES.filter(node => node.family === 'gather-field-herb').length;
        assert.equal(herbs, 26, 'herb and fiber alternate');
    });

    it('resolve by id for the server but stay off the visible map until Phase 3', () => {
        for (const node of HARVEST_NODES) assert.equal(resourceNode(node.id), node);
        assert.equal(RESOURCE_NODES.some(node => node.activity === 'harvesting'), false);
        assert.equal(resourceNode('harvest-0'), undefined);
        assert.equal(resourceNode('harvest-53'), undefined);
    });

    it('bloom on the half hour: about half the spots grow, as herb or fiber, the same for everyone', () => {
        const presentShare: number[] = [], herbShare: number[] = [];
        const perNode = new Map(HARVEST_NODES.map(node => [node.id, 0]));
        const CYCLES = 400;
        for (let cycle = 0; cycle < CYCLES; cycle++) {
            const at = cycle * HARVEST_BLOOM_MS + 1234;
            const blooms = HARVEST_NODES.map(node => harvestBloom(node, at));
            presentShare.push(blooms.filter(bloom => bloom.present).length);
            herbShare.push(blooms.filter(bloom => bloom.family === 'gather-field-herb').length);
            HARVEST_NODES.forEach((node, index) => { if (blooms[index].present) perNode.set(node.id, perNode.get(node.id)! + 1); });
            // Deterministic within a half hour, from its first to its last millisecond.
            for (const node of HARVEST_NODES)
                assert.deepEqual(harvestBloom(node, cycle * HARVEST_BLOOM_MS), harvestBloom(node, (cycle + 1) * HARVEST_BLOOM_MS - 1));
        }
        const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
        assert.ok(Math.abs(mean(presentShare) - 26) < 1.5, `mean present ${mean(presentShare)}`);
        assert.ok(Math.abs(mean(herbShare) - 26) < 1.5, `mean herb ${mean(herbShare)}`);
        assert.ok(Math.min(...presentShare) >= 10 && Math.max(...presentShare) <= 40, 'no half hour empties or fills the world');
        for (const [id, count] of perNode) assert.ok(count > CYCLES * .38 && count < CYCLES * .62, `${id} grew ${count}/${CYCLES}`);
        const flips = HARVEST_NODES.filter(node => harvestBloom(node, 0).present !== harvestBloom(node, HARVEST_BLOOM_MS).present).length;
        assert.ok(flips > 10, 'the next half hour moves the meadows');
    });

    it('offer the bloomed plant under its biome name, or a dormant spot', () => {
        for (let cycle = 0; cycle < 20; cycle++) {
            const at = cycle * HARVEST_BLOOM_MS;
            for (const node of HARVEST_NODES) {
                const bloom = harvestBloom(node, at), offer = resourceNodeOffer(node, at);
                assert.equal(offer.family, bloom.family, node.id);
                assert.equal(offer.dormant, bloom.present ? undefined : true, node.id);
                assert.match(offer.name, bloom.family === 'gather-field-herb' ? /herb patch/ : /fiber/, node.id);
                assert.deepEqual(harvestNodeAt(offer, at), offer, 'applying the bloom twice changes nothing');
            }
        }
        const mine = RESOURCE_NODES.find(node => node.activity === 'mining')!;
        assert.equal(harvestNodeAt(mine, 0), mine, 'seams and shoals never bloom');
    });

    it('name a meadow for the plant the server reports, whatever the local clock rolled', () => {
        for (const node of HARVEST_NODES) {
            const local = harvestNodeAt(node, 0);
            const other = local.family === 'gather-field-herb' ? 'gather-binding-fiber' : 'gather-field-herb';
            const shown = harvestNodeAs(local, other, true);
            assert.equal(shown.family, other);
            assert.match(shown.name, other === 'gather-field-herb' ? /herb patch/ : /fiber/, node.id);
            assert.equal(shown.dormant, undefined);
            assert.equal(harvestNodeAs(local, other, false).dormant, true);
        }
    });

    it('rotate levels on their own deal, half Basic, and keep the traces their level allows', () => {
        for (let cycle = 0; cycle < 30; cycle++) {
            const at = cycle * RESOURCE_REFILL_MS;
            const offers = HARVEST_NODES.map(node => resourceNodeOffer(node, at));
            assert.equal(offers.filter(node => node.difficulty === 1).length, 26, `cycle ${cycle}`);
            assert.equal(offers.filter(node => node.difficulty === 4).length + offers.filter(node => node.difficulty === 7).length, 26);
            for (const offer of offers) {
                const biome = SECTOR_PLACES.find(place => place.id === offer.sector)!.biome;
                const expected = offer.difficulty === 1 ? undefined
                    : biome === 'forest' ? 'gather-heartwood-bark' : biome === 'shadow' ? 'gather-shadow-thread' : undefined;
                assert.equal(offer.trace, expected, `${offer.id} at level ${offer.difficulty}`);
                assert.equal(offer.ceiling, 0);
            }
        }
    });
});
