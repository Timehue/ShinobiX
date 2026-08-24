import test from "node:test";
import assert from "node:assert/strict";
import { weeklyBossHpView } from "./weekly-boss-hp";

test("a healthy pool reports remaining, percent, and a drawable bar", () => {
    const v = weeklyBossHpView({ hpMax: 40_000_000, hpRemaining: 30_000_000 });
    assert.equal(v.hpMax, 40_000_000);
    assert.equal(v.hpRemaining, 30_000_000);
    assert.equal(v.hpPct, 75);
    assert.equal(v.hpPctLabel, "75");
    assert.equal(v.broken, false);
    assert.equal(v.showBar, true);
});

test("THE GUARD: a payload with no pool draws no bar and claims no kill", () => {
    // A stale or partial payload used to render a triumphant gold
    // "BROKEN · staggered" bar reading 0 / 0 — the arena announcing a
    // world-first kill that never happened.
    for (const boss of [
        { hpMax: 0, hpRemaining: 0 },
        {},
        { hpMax: 0, hpRemaining: 0, broken: true },
        { hpMax: undefined, hpRemaining: undefined },
        { hpMax: Number.NaN, hpRemaining: Number.NaN },
        { hpMax: -5_000, hpRemaining: -1 },
        null,
        undefined,
    ]) {
        const v = weeklyBossHpView(boss as never);
        assert.equal(v.showBar, false, `${JSON.stringify(boss)} must not draw a bar`);
        assert.equal(v.broken, false, `${JSON.stringify(boss)} must not read as broken`);
        assert.equal(v.hpMax, 0);
        assert.equal(v.hpRemaining, 0);
        assert.equal(v.hpPct, 0);
    }
});

test("an exhausted REAL pool is broken and still drawn", () => {
    const v = weeklyBossHpView({ hpMax: 40_000_000, hpRemaining: 0 });
    assert.equal(v.broken, true);
    assert.equal(v.showBar, true, "the empty bar is the whole point of the broken state");
    assert.equal(v.hpPctLabel, "0");
    // The server may flag it before the pool reads zero.
    assert.equal(weeklyBossHpView({ hpMax: 100, hpRemaining: 5, broken: true }).broken, true);
});

test("the remainder is derived from damage when the server omits hpRemaining", () => {
    const v = weeklyBossHpView({ hpMax: 1_000, damageByPlayer: { a: 300, b: 200, c: -50 } });
    assert.equal(v.hpRemaining, 500, "negative damage cannot heal the boss");
    assert.equal(weeklyBossHpView({ hpMax: 1_000, damageByPlayer: { a: 9_999 } }).hpRemaining, 0);
    // A published remainder above the pool is clamped rather than trusted.
    assert.equal(weeklyBossHpView({ hpMax: 1_000, hpRemaining: 5_000 }).hpRemaining, 1_000);
});

test("the last sliver of a world pool never reads as a flat 0%", () => {
    assert.equal(weeklyBossHpView({ hpMax: 1_000_000, hpRemaining: 4_000 }).hpPctLabel, "0.4");
    assert.equal(weeklyBossHpView({ hpMax: 1_000_000, hpRemaining: 1 }).hpPctLabel, "0.0");
    assert.equal(weeklyBossHpView({ hpMax: 1_000_000, hpRemaining: 0 }).hpPctLabel, "0");
    assert.equal(weeklyBossHpView({ hpMax: 1_000_000, hpRemaining: 1_000_000 }).hpPctLabel, "100");
});
