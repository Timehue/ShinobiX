import { test } from "node:test";
import assert from "node:assert/strict";
import {
    weeklyBossRoamState,
    roamNeighbors,
    WEEKLY_BOSS_HOP_INTERVAL_MS,
    WEEKLY_BOSS_TRAIL_LEN,
} from "./weekly-boss-roam";

const T0 = 1_783_124_683_778; // a fixed spawn time (Ashen Dragon, 2026-W27)
const boss = (over: Partial<{ weekKey: string; startedAt: number; expiresAt: number }> = {}) => ({
    weekKey: "2026-W27",
    startedAt: T0,
    expiresAt: T0 + 72 * 60 * 60 * 1000,
    ...over,
});

// ── Guard / null handling ────────────────────────────────────────────────────

test("returns null for missing or malformed boss state", () => {
    assert.equal(weeklyBossRoamState(null, T0), null);
    assert.equal(weeklyBossRoamState(undefined, T0), null);
    assert.equal(weeklyBossRoamState({ weekKey: "", startedAt: T0 }, T0), null);
    assert.equal(weeklyBossRoamState({ weekKey: "2026-W27", startedAt: NaN }, T0), null);
});

// ── Determinism (the whole point: no sync, every client agrees) ──────────────

test("is fully deterministic for identical inputs", () => {
    const now = T0 + 5 * WEEKLY_BOSS_HOP_INTERVAL_MS + 12345;
    const a = weeklyBossRoamState(boss(), now);
    const b = weeklyBossRoamState(boss(), now);
    assert.deepEqual(a, b);
});

test("path depends only on weekKey, not on startedAt (same week → same route)", () => {
    // Two spawns of the same week, different startedAt, each sampled at hop 3.
    const a = weeklyBossRoamState(boss({ startedAt: T0 }), T0 + 3 * WEEKLY_BOSS_HOP_INTERVAL_MS);
    const later = T0 + 999_999;
    const b = weeklyBossRoamState(boss({ startedAt: later }), later + 3 * WEEKLY_BOSS_HOP_INTERVAL_MS);
    assert.ok(a && b);
    assert.equal(a.currentSector, b.currentSector);
    assert.equal(a.nextSector, b.nextSector);
});

test("different weeks generally produce different start sectors", () => {
    const weeks = ["2026-W20", "2026-W21", "2026-W22", "2026-W23", "2026-W24", "2026-W25"];
    const starts = new Set(weeks.map((w) => weeklyBossRoamState(boss({ weekKey: w }), T0)!.currentSector));
    assert.ok(starts.size >= 3, `expected varied starts across weeks, got ${starts.size}`);
});

// ── Sector range ─────────────────────────────────────────────────────────────

test("current + next sectors are always standard sectors 1..60 (never 99)", () => {
    for (let h = 0; h <= 400; h += 1) {
        const s = weeklyBossRoamState(boss(), T0 + h * WEEKLY_BOSS_HOP_INTERVAL_MS)!;
        assert.ok(s.currentSector >= 1 && s.currentSector <= 60, `current ${s.currentSector} @hop ${h}`);
        assert.ok(s.nextSector >= 1 && s.nextSector <= 60, `next ${s.nextSector} @hop ${h}`);
    }
});

// ── Connected walk: every hop moves to a real neighbour, no teleporting ───────

test("nextSector is always adjacent to currentSector", () => {
    for (let h = 0; h <= 200; h += 1) {
        const s = weeklyBossRoamState(boss(), T0 + h * WEEKLY_BOSS_HOP_INTERVAL_MS)!;
        assert.ok(
            roamNeighbors(s.currentSector).includes(s.nextSector),
            `hop ${h}: ${s.nextSector} not a neighbour of ${s.currentSector}`,
        );
    }
});

test("consecutive hops step between adjacent sectors (connected path)", () => {
    let prev = weeklyBossRoamState(boss(), T0)!.currentSector;
    for (let h = 1; h <= 200; h += 1) {
        const cur = weeklyBossRoamState(boss(), T0 + h * WEEKLY_BOSS_HOP_INTERVAL_MS)!.currentSector;
        assert.ok(
            roamNeighbors(prev).includes(cur),
            `hop ${h}: ${prev} → ${cur} is not an adjacency step`,
        );
        prev = cur;
    }
});

test("neighbours are real, distinct sectors and never self", () => {
    for (let id = 1; id <= 60; id += 1) {
        const ns = roamNeighbors(id);
        assert.ok(ns.length > 0, `sector ${id} has no neighbours`);
        assert.ok(!ns.includes(id), `sector ${id} lists itself`);
        assert.equal(new Set(ns).size, ns.length, `sector ${id} has duplicate neighbours`);
        for (const n of ns) assert.ok(n >= 1 && n <= 60, `sector ${id} neighbour ${n} out of range`);
    }
});

// ── Hop timing + countdown ────────────────────────────────────────────────────

test("hopIndex advances one per interval", () => {
    assert.equal(weeklyBossRoamState(boss(), T0)!.hopIndex, 0);
    assert.equal(weeklyBossRoamState(boss(), T0 + WEEKLY_BOSS_HOP_INTERVAL_MS - 1)!.hopIndex, 0);
    assert.equal(weeklyBossRoamState(boss(), T0 + WEEKLY_BOSS_HOP_INTERVAL_MS)!.hopIndex, 1);
    assert.equal(weeklyBossRoamState(boss(), T0 + 7 * WEEKLY_BOSS_HOP_INTERVAL_MS + 5)!.hopIndex, 7);
});

test("nextHopInMs counts down within a hop and resets on the boundary", () => {
    assert.equal(weeklyBossRoamState(boss(), T0)!.nextHopInMs, WEEKLY_BOSS_HOP_INTERVAL_MS);
    const half = WEEKLY_BOSS_HOP_INTERVAL_MS / 2;
    assert.equal(weeklyBossRoamState(boss(), T0 + half)!.nextHopInMs, half);
    // Just before a boundary → ~1ms left; on the boundary → full interval again.
    assert.equal(weeklyBossRoamState(boss(), T0 + WEEKLY_BOSS_HOP_INTERVAL_MS - 1)!.nextHopInMs, 1);
    assert.equal(weeklyBossRoamState(boss(), T0 + WEEKLY_BOSS_HOP_INTERVAL_MS)!.nextHopInMs, WEEKLY_BOSS_HOP_INTERVAL_MS);
});

test("current sector actually changes over the roam window", () => {
    const seen = new Set<number>();
    for (let h = 0; h <= 60; h += 1) seen.add(weeklyBossRoamState(boss(), T0 + h * WEEKLY_BOSS_HOP_INTERVAL_MS)!.currentSector);
    assert.ok(seen.size >= 4, `boss should visit several sectors, saw ${seen.size}`);
});

// ── active flag lifecycle ─────────────────────────────────────────────────────

test("active is true only within [startedAt, expiresAt)", () => {
    assert.equal(weeklyBossRoamState(boss(), T0 - 1)!.active, false, "before spawn");
    assert.equal(weeklyBossRoamState(boss(), T0)!.active, true, "at spawn");
    assert.equal(weeklyBossRoamState(boss(), T0 + 60 * 60 * 1000)!.active, true, "mid-window");
    assert.equal(weeklyBossRoamState(boss(), T0 + 72 * 60 * 60 * 1000)!.active, false, "at expiry");
    assert.equal(weeklyBossRoamState(boss(), T0 + 100 * 60 * 60 * 1000)!.active, false, "after expiry");
});

test("still returns a placed position even when inactive (marker can show 'despawned')", () => {
    const s = weeklyBossRoamState(boss(), T0 + 100 * 60 * 60 * 1000)!;
    assert.equal(s.active, false);
    assert.ok(s.currentSector >= 1 && s.currentSector <= 60);
});

// ── Trail ─────────────────────────────────────────────────────────────────────

test("trail excludes the current sector and is capped at TRAIL_LEN", () => {
    const early = weeklyBossRoamState(boss(), T0)!;
    assert.deepEqual(early.trail, [], "hop 0 has no trail");

    const s = weeklyBossRoamState(boss(), T0 + 10 * WEEKLY_BOSS_HOP_INTERVAL_MS)!;
    assert.ok(s.trail.length <= WEEKLY_BOSS_TRAIL_LEN);
    assert.ok(!s.trail.includes(s.currentSector), "trail must not contain the current sector");
    // The most recent trail entry is adjacent to the current sector.
    if (s.trail.length) {
        const last = s.trail[s.trail.length - 1];
        assert.ok(roamNeighbors(last).includes(s.currentSector), "trail is continuous with current");
    }
});

// ── Interval override ─────────────────────────────────────────────────────────

test("honours a custom hop interval", () => {
    const interval = 60 * 1000; // 1 min
    const s = weeklyBossRoamState(boss(), T0 + 5 * interval, interval)!;
    assert.equal(s.hopIndex, 5);
    assert.equal(s.hopIntervalMs, interval);
});
