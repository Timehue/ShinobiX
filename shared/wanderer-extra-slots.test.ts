import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_NODES } from './resource-nodes.js';
import { isWalkableTile } from './sector-walk-mask.js';
import { WANDERER_BUCKET_MS, WANDERER_RIFT_INDEX, WANDERER_SECTOR_COUNT, WANDERER_TRADE_INDEX } from './wanderer-roster.js';
import {
    TRADE_WANDERER_CHANCE,
    extraSlotWanderersAt,
    resolveExtraSlotWanderer,
    riftSealOf,
    rollRiftSpawn,
    rollTradeWanderer,
} from './wanderer-extra-slots.js';

const BUCKET = 5000;
const NOW = BUCKET * WANDERER_BUCKET_MS + 4321;
const nodeSectors = new Set(RESOURCE_NODES.map((node) => node.sector));

test('anglers and miners stand only beside resource nodes, about half the windows', () => {
    let rolled = 0, possible = 0;
    for (let bucket = BUCKET; bucket < BUCKET + 200; bucket++) {
        for (let sector = 1; sector <= WANDERER_SECTOR_COUNT; sector++) {
            const w = rollTradeWanderer(sector, bucket);
            if (!nodeSectors.has(sector)) { assert.equal(w, null, `sector ${sector} has no node`); continue; }
            possible++;
            if (!w) continue;
            rolled++;
            assert.equal(w.id, `w-${sector}-${bucket}-${WANDERER_TRADE_INDEX}`);
            assert.equal(w.movement, 'stationary');
            assert.ok(isWalkableTile(sector, w.homeTile), `sector ${sector}: stands on a walkable tile`);
            const nodes = RESOURCE_NODES.filter((node) => node.sector === sector);
            assert.ok(!nodes.some((node) => node.target === w.homeTile), 'never on the water or rock itself');
            if (w.archetype === 'angler') {
                assert.equal(w.verb, 'angler');
                assert.ok(nodes.some((node) => node.activity === 'fishing'));
            } else {
                assert.equal(w.archetype, 'rivalMiner');
                assert.equal(w.verb, 'contest');
                assert.ok(nodes.some((node) => node.activity === 'mining'));
            }
        }
    }
    const rate = rolled / possible;
    assert.ok(Math.abs(rate - TRADE_WANDERER_CHANCE) < 0.08, `trade rate ${rate}`);
    assert.deepEqual(rollTradeWanderer(2, BUCKET), rollTradeWanderer(2, BUCKET), 'deterministic');
});

test('an angler or miner never stands where any gatherer in the sector stands', () => {
    // Sector 6's two shoals sit side by side, so each one's gatherer tile is
    // beside the other's. The angler used to land on it, under the node button.
    let sector6 = 0;
    for (let bucket = BUCKET; bucket < BUCKET + 400; bucket++) {
        for (const sector of nodeSectors) {
            const w = rollTradeWanderer(sector, bucket);
            if (!w) continue;
            if (sector === 6) sector6++;
            const approaches = RESOURCE_NODES.filter((node) => node.sector === sector).map((node) => node.approach);
            assert.ok(!approaches.includes(w.homeTile), `sector ${sector} bucket ${bucket}: stands on gatherer tile ${w.homeTile}`);
        }
    }
    assert.ok(sector6 > 0, 'sector 6 rolled an angler in the sampled windows');
});

test('a rift creature hunts only in the target sector of the seal its player holds', () => {
    const seal = riftSealOf({ activeRiftQuest: { id: 'rift-a', targetSector: 12, stage: 'travel' } });
    assert.deepEqual(seal, { id: 'rift-a', targetSector: 12 });
    const w = rollRiftSpawn(12, BUCKET, seal)!;
    assert.equal(w.id, `w-12-${BUCKET}-${WANDERER_RIFT_INDEX}`);
    assert.equal(w.archetype, 'riftspawn');
    assert.equal(w.verb, 'attack');
    assert.equal(w.movement, 'pursue');
    assert.equal(rollRiftSpawn(13, BUCKET, seal), null, 'not outside the target sector');
    assert.equal(rollRiftSpawn(12, BUCKET, null), null, 'not without a seal');
    assert.equal(riftSealOf({ activeRiftQuest: null }), null);
    assert.equal(riftSealOf({ activeRiftQuest: { id: '', targetSector: 12 } }), null);
    assert.deepEqual(extraSlotWanderersAt(12, BUCKET, seal).filter((x) => x.archetype === 'riftspawn'), [w]);
});

test('the server resolves the extra slots for the current window and this player only', () => {
    const seal = { id: 'rift-a', targetSector: 12 };
    assert.ok(resolveExtraSlotWanderer(`w-12-${BUCKET}-${WANDERER_RIFT_INDEX}`, NOW, seal));
    assert.equal(resolveExtraSlotWanderer(`w-12-${BUCKET}-${WANDERER_RIFT_INDEX}`, NOW, null), null, 'another player has no creature');
    assert.equal(resolveExtraSlotWanderer(`w-12-${BUCKET - 1}-${WANDERER_RIFT_INDEX}`, NOW, seal), null, 'stale window');
    assert.equal(resolveExtraSlotWanderer(`w-12-${BUCKET}-0`, NOW, seal), null, 'slots 0..2 resolve elsewhere');
    for (let sector = 1; sector <= WANDERER_SECTOR_COUNT; sector++) {
        assert.deepEqual(resolveExtraSlotWanderer(`w-${sector}-${BUCKET}-${WANDERER_TRADE_INDEX}`, NOW, null), rollTradeWanderer(sector, BUCKET));
    }
});
