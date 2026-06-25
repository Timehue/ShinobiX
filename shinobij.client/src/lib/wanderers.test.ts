/*
 * rollWanderers — the per-sector roster must be deterministic (same sector +
 * dayBucket → identical cast, so nothing flickers and a later phase could
 * re-derive it server-side), bounded, and on-grid.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rollWanderers, wandererLevelFor, wandererDayBucket, type Wanderer } from "./wanderers";

const GRID = 12;
const onGrid = (t: number) => Number.isInteger(t) && t >= 0 && t < GRID * GRID;

describe("rollWanderers", () => {
    it("is deterministic for the same (sector, dayBucket)", () => {
        const a = rollWanderers(7, 1000);
        const b = rollWanderers(7, 1000);
        assert.deepEqual(a, b);
    });

    it("changes the cast across days / sectors", () => {
        const day = JSON.stringify(rollWanderers(7, 1000));
        const nextDay = JSON.stringify(rollWanderers(7, 1001));
        const nextSector = JSON.stringify(rollWanderers(8, 1000));
        assert.notEqual(day, nextDay);
        assert.notEqual(day, nextSector);
    });

    it("returns 1–3 wanderers with valid, on-grid data", () => {
        for (let sector = 1; sector <= 60; sector++) {
            for (let d = 0; d < 4; d++) {
                const list = rollWanderers(sector, 5000 + d);
                assert.ok(list.length >= 1 && list.length <= 3, `count for sector ${sector}`);
                for (const w of list) assertValidWanderer(w);
            }
        }
    });

    it("never spawns in a non-positive sector", () => {
        assert.deepEqual(rollWanderers(0, 1), []);
        assert.deepEqual(rollWanderers(-3, 1), []);
    });

    it("ids are unique within a roster", () => {
        const list = rollWanderers(42, 9999);
        assert.equal(new Set(list.map(w => w.id)).size, list.length);
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
