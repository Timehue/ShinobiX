/*
 * rollWanderers — the per-sector roster must be deterministic (same sector +
 * dayBucket → identical cast, so nothing flickers and a later phase could
 * re-derive it server-side), bounded, and on-grid.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rollWanderers, wandererLevelFor, wandererDayBucket, wandererCount, type Wanderer } from "./wanderers";

const GRID = 12;
const onGrid = (t: number) => Number.isInteger(t) && t >= 0 && t < GRID * GRID;

describe("rollWanderers", () => {
    it("is deterministic for the same (sector, dayBucket)", () => {
        const a = rollWanderers(7, 1000);
        const b = rollWanderers(7, 1000);
        assert.deepEqual(a, b);
    });

    it("varies the cast across sectors (and isn't all-empty)", () => {
        const rosters = Array.from({ length: 60 }, (_, i) => JSON.stringify(rollWanderers(i + 1, 1000)));
        assert.ok(new Set(rosters).size > 1, "rosters should differ across sectors");
        assert.ok(rosters.some(r => r !== "[]"), "at least some sectors are populated");
    });

    it("is an occasional encounter — many sectors empty, most populated have 1", () => {
        let empty = 0, total = 0, maxLen = 0;
        for (let sector = 1; sector <= 200; sector++) {
            const list = rollWanderers(sector, 5000);
            if (list.length === 0) empty++;
            total++;
            maxLen = Math.max(maxLen, list.length);
        }
        assert.ok(empty / total > 0.4, "a healthy share of sectors are empty");
        assert.ok(maxLen <= 2, "never more than 2 in a sector");
    });

    it("returns 0–2 wanderers with valid, on-grid data", () => {
        for (let sector = 1; sector <= 80; sector++) {
            for (let d = 0; d < 4; d++) {
                const list = rollWanderers(sector, 5000 + d);
                assert.ok(list.length >= 0 && list.length <= 2, `count for sector ${sector}`);
                for (const w of list) assertValidWanderer(w);
            }
        }
    });

    it("never spawns in a non-positive sector", () => {
        assert.deepEqual(rollWanderers(0, 1), []);
        assert.deepEqual(rollWanderers(-3, 1), []);
    });

    it("ids are unique within a roster", () => {
        // find a populated roster to test against
        let list: Wanderer[] = [];
        for (let s = 1; s <= 200 && list.length < 2; s++) list = rollWanderers(s, 5000);
        assert.equal(new Set(list.map(w => w.id)).size, list.length);
    });
});

describe("wandererCount", () => {
    it("maps rng to 0/1/2 with empties common and pairs rare", () => {
        assert.equal(wandererCount(0), 0);
        assert.equal(wandererCount(0.5), 0);
        assert.equal(wandererCount(0.7), 1);
        assert.equal(wandererCount(0.95), 2);
        assert.ok(wandererCount(0.99) <= 2);
    });
});

describe("wandererLevelFor", () => {
    it("stays within [3, 95] and scales with the sector", () => {
        const rng = () => 0.5; // mid jitter → deterministic here
        assert.ok(wandererLevelFor(1, rng) >= 3);
        assert.ok(wandererLevelFor(60, rng) <= 95);
        assert.ok(wandererLevelFor(40, rng) > wandererLevelFor(5, rng));
    });
});

describe("wandererDayBucket", () => {
    it("advances every 6 hours", () => {
        const t0 = new Date("2026-06-25T00:00:00Z");
        const t5 = new Date("2026-06-25T05:59:00Z");
        const t6 = new Date("2026-06-25T06:01:00Z");
        assert.equal(wandererDayBucket(t0), wandererDayBucket(t5));
        assert.equal(wandererDayBucket(t6), wandererDayBucket(t0) + 1);
    });
});

function assertValidWanderer(w: Wanderer): void {
    assert.ok(w.name.length > 0);
    assert.ok(["attack", "gift", "gamble", "petDuel", "quest"].includes(w.verb));
    assert.ok(["bandit", "gambler", "pilgrim", "beast", "sage"].includes(w.archetype));
    assert.ok(w.level >= 3 && w.level <= 95);
    assert.ok(onGrid(w.homeTile), `home ${w.homeTile}`);
    assert.ok(w.waypoints.length >= 1 && w.waypoints.every(onGrid), "waypoints on grid");
    assert.ok(w.greeting.length > 0);
    assert.ok(/^#/.test(w.tellTint));
    // attacker-archetype invariant: bandits attack, others don't
    assert.equal(w.verb === "attack", w.archetype === "bandit");
}
