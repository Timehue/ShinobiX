"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _sim_js_1 = require("./_sim.js");
// A fixed 2v2 roster — sealed queue order, like the real start-token would seal.
function roster() {
    return [
        { id: 'sq-1', side: 'squad', hp: 1200, maxHp: 1200, ep: 12, offense: 1400, defense: 900 },
        { id: 'sq-2', side: 'squad', hp: 1000, maxHp: 1000, ep: 10, offense: 1100, defense: 1100 },
        { id: 'en-1', side: 'enemy', hp: 1100, maxHp: 1100, ep: 11, offense: 1200, defense: 1000 },
        { id: 'en-2', side: 'enemy', hp: 900, maxHp: 900, ep: 9, offense: 900, defense: 1300 },
    ];
}
(0, node_test_1.describe)('Battle Towers deterministic sim (P0.3 spike)', () => {
    (0, node_test_1.it)('produces a byte-identical result from the same seed (Decision 2 foundation)', () => {
        const a = (0, _sim_js_1.runTowerFloorSpike)(roster(), 1234567);
        const b = (0, _sim_js_1.runTowerFloorSpike)(roster(), 1234567);
        node_assert_1.strict.equal(JSON.stringify(a), JSON.stringify(b), 'same seed must replay byte-identically');
    });
    (0, node_test_1.it)('is deterministic across many seeds (two runs each are identical)', () => {
        for (const seed of [1, 2, 42, 1000, 99991, 2_000_000_111]) {
            const a = (0, _sim_js_1.runTowerFloorSpike)(roster(), seed);
            const b = (0, _sim_js_1.runTowerFloorSpike)(roster(), seed);
            node_assert_1.strict.equal(JSON.stringify(a), JSON.stringify(b), `seed ${seed} must be deterministic`);
        }
    });
    (0, node_test_1.it)('the seed actually affects the outcome (RNG is wired, not a no-op)', () => {
        const a = (0, _sim_js_1.runTowerFloorSpike)(roster(), 111);
        const b = (0, _sim_js_1.runTowerFloorSpike)(roster(), 999999);
        // Different seeds must diverge somewhere (damage numbers at minimum → different log).
        node_assert_1.strict.notEqual(JSON.stringify(a), JSON.stringify(b), 'different seeds should differ');
    });
    (0, node_test_1.it)('does not mutate the caller roster (clones internally)', () => {
        const r = roster();
        const before = JSON.stringify(r);
        (0, _sim_js_1.runTowerFloorSpike)(r, 555);
        node_assert_1.strict.equal(JSON.stringify(r), before, 'roster must be untouched after a run');
    });
    (0, node_test_1.it)('always resolves to a winner within the round budget', () => {
        const res = (0, _sim_js_1.runTowerFloorSpike)(roster(), 7);
        node_assert_1.strict.ok(['squad', 'enemy', 'draw'].includes(res.winner));
        node_assert_1.strict.ok(res.rounds >= 1 && res.rounds <= 25, 'rounds within [1,25]');
        node_assert_1.strict.ok(Object.keys(res.finalHp).length === 4, 'all actors reported');
    });
    (0, node_test_1.it)('makeRng is a stable LCG stream (ported determinism primitive)', () => {
        const r1 = (0, _sim_js_1.makeRng)(12345);
        const r2 = (0, _sim_js_1.makeRng)(12345);
        const s1 = [r1(), r1(), r1(), r1(), r1()];
        const s2 = [r2(), r2(), r2(), r2(), r2()];
        node_assert_1.strict.deepEqual(s1, s2, 'same seed → same stream');
        node_assert_1.strict.ok(s1.every(v => v >= 0 && v < 1), 'values in [0,1)');
    });
    (0, node_test_1.it)('ports the PvP statFactor identity + clamp (combat parity)', () => {
        node_assert_1.strict.equal((0, _sim_js_1.statFactor)(1000, 1000), 1, 'identity at off==def');
        node_assert_1.strict.ok((0, _sim_js_1.statFactor)(99999, 0) <= 1.85, 'clamped high');
        node_assert_1.strict.ok((0, _sim_js_1.statFactor)(0, 99999) >= 0.35, 'clamped low');
        node_assert_1.strict.equal(_sim_js_1.EP_MULTIPLIER, 32);
        node_assert_1.strict.equal(_sim_js_1.MAX_STAT, 2500);
    });
});
