/*
 * rollWanderers — the per-sector roster must be deterministic (same sector +
 * dayBucket → identical cast, so nothing flickers and a later phase could
 * re-derive it server-side), bounded, and on-grid.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rollWanderers, wandererLevelFor, wandererDayBucket, wandererCount, isWandererOnCooldown, withWandererCooldown, WANDERER_NPC_COOLDOWN_MS, WANDERER_FLEE_COOLDOWN_MS, parseWandererId, wandererRelocationSector, pruneWandererMoves, hasWandererRelocated, wanderersVisitingSector, type Wanderer } from "./wanderers";

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

describe("per-NPC cooldown", () => {
    it("isWandererOnCooldown is true only while the entry is in the future", () => {
        const now = 1_000_000;
        assert.equal(isWandererOnCooldown({ a: now + 1000 }, "a", now), true);
        assert.equal(isWandererOnCooldown({ a: now - 1000 }, "a", now), false);
        assert.equal(isWandererOnCooldown({ a: now + 1000 }, "b", now), false);
        assert.equal(isWandererOnCooldown(undefined, "a", now), false);
        assert.equal(isWandererOnCooldown(null, "a", now), false);
    });
    it("withWandererCooldown sets the new entry and prunes expired ones", () => {
        const now = 1_000_000;
        const next = withWandererCooldown({ stale: now - 1, live: now + 5000 }, "w1", now);
        assert.equal(next.w1, now + WANDERER_NPC_COOLDOWN_MS, "new entry cooled a few hours out");
        assert.equal(next.live, now + 5000, "still-live entry kept");
        assert.equal("stale" in next, false, "expired entry pruned");
        assert.equal(isWandererOnCooldown(next, "w1", now), true);
    });
    it("the cooldown is a few hours", () => {
        assert.ok(WANDERER_NPC_COOLDOWN_MS >= 60 * 60 * 1000 && WANDERER_NPC_COOLDOWN_MS <= 6 * 60 * 60 * 1000);
    });
    it("withWandererCooldown honours a custom (shorter) duration", () => {
        const now = 1_000_000;
        const fled = withWandererCooldown(null, "bandit", now, WANDERER_FLEE_COOLDOWN_MS);
        assert.equal(fled.bandit, now + WANDERER_FLEE_COOLDOWN_MS, "cooled for exactly the passed duration");
        assert.equal(isWandererOnCooldown(fled, "bandit", now), true, "on cooldown right after fleeing");
        assert.equal(isWandererOnCooldown(fled, "bandit", now + WANDERER_FLEE_COOLDOWN_MS + 1), false, "back after the flee window");
    });
    it("the flee back-off is short — present, but well under the anti-farm window", () => {
        assert.ok(WANDERER_FLEE_COOLDOWN_MS > 0 && WANDERER_FLEE_COOLDOWN_MS < WANDERER_NPC_COOLDOWN_MS);
    });
});

describe("wanderer relocation", () => {
    const BUCKET = 5000;
    // Find a populated sector for this bucket so we have a real wanderer id to move.
    function anyWanderer(): Wanderer {
        for (let s = 1; s <= 400; s++) {
            const list = rollWanderers(s, BUCKET);
            if (list.length) return list[0];
        }
        throw new Error("no populated sector found for the test bucket");
    }

    it("parseWandererId reads real ids and rejects merc/synthetic ones", () => {
        assert.deepEqual(parseWandererId("w-7-5000-1"), { sector: 7, dayBucket: 5000, index: 1 });
        assert.equal(parseWandererId("merc-abc-2"), null);
        assert.equal(parseWandererId("w-7-5000"), null);
        assert.equal(parseWandererId(""), null);
    });

    it("wandererRelocationSector picks a different, in-range sector deterministically", () => {
        for (let from = 1; from <= 60; from++) {
            const dest = wandererRelocationSector("w-7-5000-0", from);
            assert.ok(dest >= 1 && dest <= 60, `dest ${dest} in range`);
            assert.notEqual(dest, from, "never relocates to the same sector");
        }
        // deterministic
        assert.equal(wandererRelocationSector("w-7-5000-0", 12), wandererRelocationSector("w-7-5000-0", 12));
        // hopping again from the new sector generally moves it somewhere else
        const s1 = wandererRelocationSector("w-7-5000-0", 7);
        const s2 = wandererRelocationSector("w-7-5000-0", s1);
        assert.notEqual(s2, s1);
    });

    it("hasWandererRelocated / pruneWandererMoves track and expire entries", () => {
        assert.equal(hasWandererRelocated({ "w-7-5000-0": 12 }, "w-7-5000-0"), true);
        assert.equal(hasWandererRelocated({ "w-7-5000-0": 12 }, "w-7-5000-1"), false);
        assert.equal(hasWandererRelocated(undefined, "w-7-5000-0"), false);
        // prune keeps current-bucket entries, drops stale-bucket + malformed ones
        const pruned = pruneWandererMoves({ "w-7-5000-0": 12, "w-7-4999-0": 3, "merc-x": 5 }, 5000);
        assert.deepEqual(pruned, { "w-7-5000-0": 12 });
    });

    it("wanderersVisitingSector surfaces a moved wanderer once its cooldown lifts", () => {
        const w = anyWanderer();
        const parsed = parseWandererId(w.id)!;
        const dest = parsed.sector === 60 ? 59 : 60; // any sector that isn't home
        const now = 1_000_000;
        const moves = { [w.id]: dest };

        // On cooldown → still travelling, not here yet.
        const onCd = wanderersVisitingSector(dest, BUCKET, moves, { [w.id]: now + 1000 }, now);
        assert.equal(onCd.length, 0);

        // Cooldown lifted → appears in the destination sector, same id, re-homed tile.
        const arrived = wanderersVisitingSector(dest, BUCKET, moves, {}, now);
        assert.equal(arrived.length, 1);
        assert.equal(arrived[0].id, w.id);
        assert.ok(arrived[0].homeTile >= 0 && arrived[0].homeTile < 144);

        // Not shown in a sector it didn't move to, nor against a stale window.
        assert.equal(wanderersVisitingSector(dest + 1 <= 60 ? dest + 1 : 1, BUCKET, moves, {}, now).length, 0);
        assert.equal(wanderersVisitingSector(dest, BUCKET + 1, moves, {}, now).length, 0);
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
