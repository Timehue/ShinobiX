import { strict as assert } from "node:assert";
import test from "node:test";
import {
    ARENA_ACTION_BEAT_MS,
    ARENA_BATCH_MAX_MS,
    ARENA_MOVE_STEP_MS,
    arenaBeatSchedule,
    combatHitFloatLane,
    combatHitFloatOffset,
    combatHitLabel,
    combatWeatherPresentation,
    combatWeatherSource,
    diffCombatVitals,
    reactionDirection,
    reactionForHit,
} from "./combat-presentation";

test("diffCombatVitals names HP loss, HP gain, absorbed guard, gained guard and new statuses", () => {
    assert.deepEqual(diffCombatVitals("enemy", { hp: 50 }, { hp: 38 }), [{ target: "enemy", amount: 12, kind: "damage" }]);
    assert.deepEqual(diffCombatVitals("player", { hp: 40 }, { hp: 52 }), [{ target: "player", amount: 12, kind: "heal", label: "+12" }]);
    // A blow the shield ate entirely still reads — as guard, not as damage.
    assert.deepEqual(diffCombatVitals("player", { hp: 40, shield: 15 }, { hp: 40, shield: 3 }), [
        { target: "player", amount: 12, kind: "shield", label: "−12 guard" },
    ]);
    // A shield raised alongside no HP change.
    assert.deepEqual(diffCombatVitals("player", { hp: 40, shield: 0 }, { hp: 40, shield: 20 }), [
        { target: "player", amount: 20, kind: "shield", label: "+20 guard" },
    ]);
    // Damage that breaks the shield AND bites HP reports the HP loss only; the
    // guard collapse is implied by the number, not shown twice.
    assert.deepEqual(diffCombatVitals("enemy", { hp: 40, shield: 5 }, { hp: 30, shield: 0 }), [
        { target: "enemy", amount: 10, kind: "damage" },
    ]);
    assert.deepEqual(
        diffCombatVitals("enemy", { hp: 40, statuses: [{ name: "Wound" }] }, { hp: 40, statuses: [{ name: "Wound" }, { name: "Stun" }, { name: "Stun" }] }),
        [{ target: "enemy", amount: 0, kind: "status", label: "Stun" }],
    );
});

test("diffCombatVitals tolerates missing snapshots and reports nothing for an unchanged fighter", () => {
    assert.deepEqual(diffCombatVitals("player", undefined, { hp: 10 }), []);
    assert.deepEqual(diffCombatVitals("player", { hp: 10 }, null), []);
    assert.deepEqual(diffCombatVitals("player", { hp: 10, shield: 2, statuses: [{ name: "Burn" }] }, { hp: 10, shield: 2, statuses: [{ name: "Burn" }] }), []);
});

test("combatHitLabel prefers the authored label and otherwise signs the number", () => {
    assert.equal(combatHitLabel({ amount: 9, kind: "damage" }), "−9");
    assert.equal(combatHitLabel({ amount: 9, kind: "heal" }), "+9");
    assert.equal(combatHitLabel({ amount: 0, kind: "status", label: "Seal" }), "Seal");
});

test("hit-number lanes alternate sideways, step lower, and never repeat within five numbers", () => {
    const lanes = [0, 1, 2, 3, 4].map(combatHitFloatOffset);
    assert.equal(new Set(lanes).size, 5);
    assert.equal(combatHitFloatOffset(5), combatHitFloatOffset(0));
    assert.deepEqual(combatHitFloatLane(0), { dx: 0, dy: 0 });
    assert.ok(combatHitFloatLane(1).dy > 0 && Math.abs(combatHitFloatLane(1).dx) >= 24, "a second label clears a wide status word");
});

test("reactionForHit grades damage by fraction of max HP and reports a KO when HP is gone", () => {
    assert.equal(reactionForHit({ kind: "damage", amount: 10 }, { maxHp: 100, down: false }), "hit");
    assert.equal(reactionForHit({ kind: "damage", amount: 18 }, { maxHp: 100, down: false }), "heavy");
    assert.equal(reactionForHit({ kind: "damage", amount: 5 }, { maxHp: 100, down: true }), "ko");
    assert.equal(reactionForHit({ kind: "shield", amount: 8 }, { maxHp: 100, down: false }), "guard");
    assert.equal(reactionForHit({ kind: "heal", amount: 8 }, { maxHp: 100, down: false }), "heal");
    // A status refresh alone does not move the body.
    assert.equal(reactionForHit({ kind: "status", amount: 0 }, { maxHp: 100, down: false }), null);
});

test("reactionDirection is a unit vector that survives coincident points", () => {
    const d = reactionDirection({ x: 0, y: 0 }, { x: 3, y: 4 });
    assert.ok(Math.abs(d.x - 0.6) < 1e-9 && Math.abs(d.y - 0.8) < 1e-9);
    assert.deepEqual(reactionDirection({ x: 5, y: 5 }, { x: 5, y: 5 }), { x: 1, y: 0 });
});

test("arenaBeatSchedule spaces a batch in seq order, walk steps at the step cadence", () => {
    const fresh = [
        { seq: 7, movement: true },
        { seq: 5 },
        { seq: 6, movement: true },
        { seq: 8 },
    ];
    const { beats, total } = arenaBeatSchedule(fresh);
    assert.deepEqual(beats.map(({ beat, at }) => [beat.seq, at]), [
        [5, 0],
        [6, ARENA_ACTION_BEAT_MS],
        [7, ARENA_ACTION_BEAT_MS + ARENA_MOVE_STEP_MS],
        [8, ARENA_ACTION_BEAT_MS + 2 * ARENA_MOVE_STEP_MS],
    ]);
    assert.equal(total, 2 * ARENA_ACTION_BEAT_MS + 2 * ARENA_MOVE_STEP_MS);
});

test("arenaBeatSchedule compresses a long AI turn into the batch ceiling and collapses under instant", () => {
    const fresh = Array.from({ length: 12 }, (_, i) => ({ seq: i + 1 }));
    const { beats, total } = arenaBeatSchedule(fresh);
    assert.equal(total, ARENA_BATCH_MAX_MS);
    assert.ok(beats.every(({ at }) => at <= ARENA_BATCH_MAX_MS));
    for (let i = 1; i < beats.length; i++) assert.ok(beats[i]!.at > beats[i - 1]!.at, "order survives compression");
    const instant = arenaBeatSchedule(fresh, { instant: true });
    assert.equal(instant.total, 0);
    assert.ok(instant.beats.every(({ at }) => at === 0));
    assert.deepEqual(arenaBeatSchedule([]), { beats: [], total: 0 });
});

test("a clear sky draws nothing; every real sky stays below full intensity and opacity", () => {
    assert.equal(combatWeatherPresentation("clear"), null);
    assert.equal(combatWeatherPresentation(undefined), null);
    for (const sky of ["rain", "thunderstorm", "ashfall", "tornado", "desertHaze"] as const) {
        const p = combatWeatherPresentation(sky);
        assert.ok(p, `${sky} must render`);
        assert.ok(p!.intensity <= 0.75 && p!.intensity > 0, `${sky} intensity is restrained`);
        assert.ok(p!.opacity <= 0.65 && p!.opacity > 0, `${sky} opacity leaves the board readable`);
    }
});

test("combatWeatherSource prefers the sealed sky, then the sector sky, and none under authored art", () => {
    const calls: string[] = [];
    const lookups = {
        weatherFromElements: (p: string, n: string) => { calls.push(`el:${p}/${n}`); return "rain" as const; },
        weatherForSector: (s: number) => { calls.push(`sector:${s}`); return "ashfall" as const; },
    };
    assert.equal(combatWeatherSource({ sealedPositive: "Water", sealedNegative: "Fire", sector: 4, ...lookups }), "rain");
    assert.equal(combatWeatherSource({ sealedPositive: "", sealedNegative: "", sector: 4, ...lookups }), "ashfall");
    assert.equal(combatWeatherSource({ sector: 4, ...lookups }), "ashfall");
    assert.equal(combatWeatherSource({ sector: undefined, ...lookups }), null);
    assert.equal(combatWeatherSource({ sealedPositive: "Water", sealedNegative: "Fire", sector: 4, authoredBackdrop: true, ...lookups }), null);
    assert.deepEqual(calls, ["el:Water/Fire", "sector:4", "sector:4"]);
});
