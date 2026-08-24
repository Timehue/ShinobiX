import { beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    __resetSectorPoolCache, cleanSectorPoolView, hydrateSectorPools, noteSectorPoolView,
    SECTOR_DEPLETED_MESSAGE, sectorExploreRefusal, sectorGatherLineFor, sectorPoolDepleted,
    sectorPoolViewFor,
} from "./sector-pool";

describe("sector gathering pool (client mirror)", () => {
    beforeEach(() => __resetSectorPoolCache());

    it("applies the owner-village bonus only for the owning village's members", () => {
        assert.equal(hydrateSectorPools({ sectorPools: { 66: { explores: 12, chests: 3 } }, sectorPoolCaps: { explores: 500, chests: 75, ownerBonus: 0.5 } }), true);
        assert.deepEqual(sectorPoolViewFor(66, "Leaf", "Leaf"), { exploresUsed: 12, exploresCap: 750, chestsUsed: 3, chestsCap: 112, hydrated: true });
        assert.deepEqual(sectorPoolViewFor(66, "Leaf", "Sand"), { exploresUsed: 12, exploresCap: 500, chestsUsed: 3, chestsCap: 75, hydrated: true });
        assert.deepEqual(sectorPoolViewFor(67, undefined, "Sand"), { exploresUsed: 0, exploresCap: 500, chestsUsed: 0, chestsCap: 75, hydrated: true });
        assert.equal(hydrateSectorPools({ sectorPools: { 66: { explores: 12, chests: 3 } }, sectorPoolCaps: { explores: 500, chests: 75, ownerBonus: 0.5 } }), false);
    });

    it("mirrors the server's default caps before any poll has landed, but flags them as NOT hydrated", () => {
        // KEEP IN SYNC with api/world/_sector-pool.ts. 1,500 explores = 10 maxed
        // players (150/day each) to drain a non-owner sector, 15 for the owning
        // village; the 225 chest cap is 1,500 x the authored 0.15 chest rate.
        assert.deepEqual(sectorPoolViewFor(66, "Leaf", "Sand"), { exploresUsed: 0, exploresCap: 1500, chestsUsed: 0, chestsCap: 225, hydrated: false });
        assert.deepEqual(sectorPoolViewFor(66, "Leaf", "Leaf"), { exploresUsed: 0, exploresCap: 2250, chestsUsed: 0, chestsCap: 337, hydrated: false });
    });

    it("counts an EMPTY pools payload as hydration — nobody gathered anywhere today", () => {
        assert.equal(sectorPoolViewFor(66, "Leaf", "Sand").hydrated, false);
        hydrateSectorPools({ sectorPools: {}, sectorPoolCaps: { explores: 500, chests: 75, ownerBonus: 0.5 } });
        assert.equal(sectorPoolViewFor(66, "Leaf", "Sand").hydrated, true);
        // A payload carrying neither key is not a pool poll and must not hydrate.
        __resetSectorPoolCache();
        hydrateSectorPools({});
        assert.equal(sectorPoolViewFor(66, "Leaf", "Sand").hydrated, false);
    });

    it("prefers the server's exact per-viewer view from a gather response until a NEWER poll lands", () => {
        noteSectorPoolView(66, { exploresUsed: 500, exploresCap: 500, chestsUsed: 1, chestsCap: 75 });
        const view = sectorPoolViewFor(66, "Leaf", "Leaf");
        assert.equal(view.exploresCap, 500);
        // An exact view is the server's own answer for THIS sector, so it counts
        // as hydrated even with no poll behind it — but only for that sector.
        assert.equal(view.hydrated, true);
        assert.equal(sectorPoolViewFor(67, "Leaf", "Leaf").hydrated, false);
        assert.equal(sectorPoolDepleted(view), true);
        // A newer poll (counts caught up with the gather) supersedes it.
        hydrateSectorPools({ sectorPools: { 66: { explores: 500, chests: 1 } }, sectorPoolCaps: { explores: 500, chests: 75, ownerBonus: 0 } });
        assert.equal(sectorPoolViewFor(66, "Leaf", "Leaf").exploresUsed, 500);
        noteSectorPoolView(66, { exploresUsed: 501, exploresCap: 500, chestsUsed: 1, chestsCap: 75 });
        // …but a STALE one (a 304 replaying a body from before the explore, which
        // is possible because sectorPools rides outside the ETag) does not. The
        // counter must never run backwards on the plate.
        hydrateSectorPools({ sectorPools: { 66: { explores: 499, chests: 1 } } });
        assert.equal(sectorPoolViewFor(66, "Leaf", "Leaf").exploresUsed, 501);
        // A poll that omits the sector entirely is older still — nobody gathered.
        hydrateSectorPools({ sectorPools: {} });
        assert.equal(sectorPoolViewFor(66, "Leaf", "Leaf").exploresUsed, 501);
        // Chests count too: explores caught up but chests did not.
        hydrateSectorPools({ sectorPools: { 66: { explores: 700, chests: 0 } } });
        assert.equal(sectorPoolViewFor(66, "Leaf", "Leaf").exploresUsed, 501);
        hydrateSectorPools({ sectorPools: { 66: { explores: 700, chests: 4 } } });
        assert.equal(sectorPoolViewFor(66, "Leaf", "Leaf").exploresUsed, 700);
    });

    it("rejects malformed views and ignores junk sectors", () => {
        assert.equal(cleanSectorPoolView({ exploresUsed: 1 }), null);
        assert.equal(cleanSectorPoolView("nope"), null);
        hydrateSectorPools({ sectorPools: { abc: { explores: 1 }, "-4": { explores: 1 }, 5: "x" } });
        assert.deepEqual(sectorPoolViewFor(5, undefined, undefined).exploresUsed, 0);
    });
});

describe("explore pre-flight against a depleted sector", () => {
    beforeEach(() => __resetSectorPoolCache());

    it("refuses BEFORE the discovery probes, and only when the viewer's own pool is spent", () => {
        // The probes commit real server state (a pet-encounter pointer, a free
        // dungeon run) and the explore that settles them runs afterwards, so a
        // probe hit in a depleted sector used to mint a discovery that could
        // never settle — which then blocked exploring in EVERY sector all day.
        hydrateSectorPools({
            sectorPools: { 66: { explores: 1500, chests: 0 } },
            sectorPoolCaps: { explores: 1500, chests: 225, ownerBonus: 0.5 },
        });
        assert.equal(sectorExploreRefusal(66, "Leaf", "Sand"), SECTOR_DEPLETED_MESSAGE);
        // The owning village still has 750 of its 2,250 left on the same tile.
        assert.equal(sectorExploreRefusal(66, "Leaf", "Leaf"), null);
        assert.equal(sectorExploreRefusal(41, undefined, "Sand"), null, "an untouched sector never refuses");
    });

    it("uses the server's exact view once a gather response supplies one", () => {
        noteSectorPoolView(66, { exploresUsed: 1500, exploresCap: 1500, chestsUsed: 4, chestsCap: 225 });
        assert.equal(sectorExploreRefusal(66, "Leaf", "Leaf"), SECTOR_DEPLETED_MESSAGE);
    });

    it("never refuses on un-hydrated placeholder numbers", () => {
        // Pre-poll the counts are zeros against MIRRORED caps. If the live caps
        // ever differ, refusing here would block the game's core verb on a guess.
        assert.equal(sectorExploreRefusal(66, "Leaf", "Sand"), null);
    });

    it("names the refill and points somewhere else to go", () => {
        assert.match(SECTOR_DEPLETED_MESSAGE, /^Picked clean — /u);
        assert.match(SECTOR_DEPLETED_MESSAGE, /midnight UTC/u);
        assert.match(SECTOR_DEPLETED_MESSAGE, /other sectors are still rich/u);
    });
});

describe("the selected-sector gathering line", () => {
    beforeEach(() => __resetSectorPoolCache());

    it("says the counts are unknown instead of faking 0 / 1,500 before the first poll", () => {
        const line = sectorGatherLineFor(sectorPoolViewFor(66, "Leaf", "Sand"));
        assert.deepEqual(line, { text: "Gathered today · checking…", note: null, depleted: false, pending: true });
        // The plate is off entirely on a non-wild sector.
        assert.equal(sectorGatherLineFor(null), null);
    });

    it("labels BOTH pairs and locale-formats every number", () => {
        hydrateSectorPools({
            sectorPools: { 66: { explores: 12, chests: 3 } },
            sectorPoolCaps: { explores: 1500, chests: 225, ownerBonus: 0.5 },
        });
        const line = sectorGatherLineFor(sectorPoolViewFor(66, "Leaf", "Sand"));
        assert.equal(line?.text, "Gathered today · Explores 12 / 1,500 · Chests 3 / 225");
        assert.equal(line?.note, null);
        assert.equal(line?.depleted, false);
        assert.equal(line?.pending, false);
    });

    it("keeps the counts AND adds the actionable next step once the pool is spent", () => {
        hydrateSectorPools({
            sectorPools: { 66: { explores: 1500, chests: 210 } },
            sectorPoolCaps: { explores: 1500, chests: 225, ownerBonus: 0.5 },
        });
        const line = sectorGatherLineFor(sectorPoolViewFor(66, "Leaf", "Sand"));
        assert.equal(line?.depleted, true);
        assert.equal(line?.text, "Gathered today · Explores 1,500 / 1,500 · Chests 210 / 225");
        assert.equal(line?.note, SECTOR_DEPLETED_MESSAGE);
        // The owning village still has headroom on the same tile, so its plate
        // is neither depleted nor carrying the note.
        const owner = sectorGatherLineFor(sectorPoolViewFor(66, "Leaf", "Leaf"));
        assert.equal(owner?.depleted, false);
        assert.equal(owner?.note, null);
    });
});
