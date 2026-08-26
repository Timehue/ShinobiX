import assert from "node:assert/strict";
import test from "node:test";
import { hydrateSectorPools, sectorPoolViewFor } from "./sector-pool";
import { richerSectorsNear, sectorRichnessLabel, sectorRichnessOf } from "./sector-richness";

const caps = { explores: 100, chests: 20, ownerBonus: 0.5 };

test("richness reads rich, worked and spent off the shared pool", () => {
    hydrateSectorPools({ sectorPools: { 2: { explores: 0 }, 3: { explores: 59 }, 4: { explores: 60 }, 5: { explores: 100 } }, sectorPoolCaps: caps });

    assert.equal(sectorRichnessOf(sectorPoolViewFor(2, undefined, "Stormveil Village")), "rich");
    assert.equal(sectorRichnessOf(sectorPoolViewFor(3, undefined, "Stormveil Village")), "rich");
    assert.equal(sectorRichnessOf(sectorPoolViewFor(4, undefined, "Stormveil Village")), "worked");
    assert.equal(sectorRichnessOf(sectorPoolViewFor(5, undefined, "Stormveil Village")), "spent");
});

test("richness never guesses before a poll has landed", () => {
    assert.equal(sectorRichnessOf(null), "unknown");
    assert.equal(sectorRichnessOf({ exploresUsed: 0, exploresCap: 100, chestsUsed: 0, chestsCap: 20, hydrated: false }), "unknown");
    assert.equal(sectorRichnessLabel("unknown"), null);
    assert.equal(sectorRichnessLabel("spent"), "Picked clean today");
});

test("the owner-village bonus decides whether the same sector is spent for you", () => {
    hydrateSectorPools({ sectorPools: { 7: { explores: 120 } }, sectorPoolCaps: caps });

    // 120 of a 100 cap is spent for an outsider; of a 150 owner cap it is not.
    assert.equal(sectorRichnessOf(sectorPoolViewFor(7, "Ashen Leaf Village", "Stormveil Village")), "spent");
    assert.equal(sectorRichnessOf(sectorPoolViewFor(7, "Ashen Leaf Village", "Ashen Leaf Village")), "worked");
});

test("richer ground is found by road distance, nearest first, skipping worked and spent", () => {
    // Sectors 1-8 are the Stormveil block and share roads (shared/sector-links).
    hydrateSectorPools({ sectorPools: { 1: { explores: 100 }, 2: { explores: 100 }, 3: { explores: 100 } }, sectorPoolCaps: caps });

    const found = richerSectorsNear(1, "Stormveil Village", () => undefined, 3);
    assert.equal(found.length, 3);
    assert.ok(found.every((entry) => entry.sector !== 1), "never offers the sector you are standing in");
    assert.ok(found.every((entry) => ![2, 3].includes(entry.sector)), "drained neighbours are skipped");
    // Nearest first: hop counts must never decrease down the list.
    for (let i = 1; i < found.length; i++) assert.ok(found[i].hops >= found[i - 1].hops);
});

test("richer ground answers empty off the road graph and when nothing is left", () => {
    hydrateSectorPools({ sectorPools: {}, sectorPoolCaps: caps });
    assert.deepEqual(richerSectorsNear(99, "Stormveil Village", () => undefined), []);
    assert.deepEqual(richerSectorsNear(1, "Stormveil Village", () => undefined, 0), []);
});
