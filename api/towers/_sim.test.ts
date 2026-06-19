import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { runTowerFloorSpike, makeRng, statFactor, EP_MULTIPLIER, MAX_STAT, type TowerFighter } from './_sim.js';

// A fixed 2v2 roster — sealed queue order, like the real start-token would seal.
function roster(): TowerFighter[] {
    return [
        { id: 'sq-1', side: 'squad', hp: 1200, maxHp: 1200, ep: 12, offense: 1400, defense: 900 },
        { id: 'sq-2', side: 'squad', hp: 1000, maxHp: 1000, ep: 10, offense: 1100, defense: 1100 },
        { id: 'en-1', side: 'enemy', hp: 1100, maxHp: 1100, ep: 11, offense: 1200, defense: 1000 },
        { id: 'en-2', side: 'enemy', hp: 900, maxHp: 900, ep: 9, offense: 900, defense: 1300 },
    ];
}

describe('Battle Towers deterministic sim (P0.3 spike)', () => {
    it('produces a byte-identical result from the same seed (Decision 2 foundation)', () => {
        const a = runTowerFloorSpike(roster(), 1234567);
        const b = runTowerFloorSpike(roster(), 1234567);
        assert.equal(JSON.stringify(a), JSON.stringify(b), 'same seed must replay byte-identically');
    });

    it('is deterministic across many seeds (two runs each are identical)', () => {
        for (const seed of [1, 2, 42, 1000, 99991, 2_000_000_111]) {
            const a = runTowerFloorSpike(roster(), seed);
            const b = runTowerFloorSpike(roster(), seed);
            assert.equal(JSON.stringify(a), JSON.stringify(b), `seed ${seed} must be deterministic`);
        }
    });

    it('the seed actually affects the outcome (RNG is wired, not a no-op)', () => {
        const a = runTowerFloorSpike(roster(), 111);
        const b = runTowerFloorSpike(roster(), 999999);
        // Different seeds must diverge somewhere (damage numbers at minimum → different log).
        assert.notEqual(JSON.stringify(a), JSON.stringify(b), 'different seeds should differ');
    });

    it('does not mutate the caller roster (clones internally)', () => {
        const r = roster();
        const before = JSON.stringify(r);
        runTowerFloorSpike(r, 555);
        assert.equal(JSON.stringify(r), before, 'roster must be untouched after a run');
    });

    it('always resolves to a winner within the round budget', () => {
        const res = runTowerFloorSpike(roster(), 7);
        assert.ok(['squad', 'enemy', 'draw'].includes(res.winner));
        assert.ok(res.rounds >= 1 && res.rounds <= 25, 'rounds within [1,25]');
        assert.ok(Object.keys(res.finalHp).length === 4, 'all actors reported');
    });

    it('makeRng is a stable LCG stream (ported determinism primitive)', () => {
        const r1 = makeRng(12345);
        const r2 = makeRng(12345);
        const s1 = [r1(), r1(), r1(), r1(), r1()];
        const s2 = [r2(), r2(), r2(), r2(), r2()];
        assert.deepEqual(s1, s2, 'same seed → same stream');
        assert.ok(s1.every(v => v >= 0 && v < 1), 'values in [0,1)');
    });

    it('ports the PvP statFactor identity + clamp (combat parity)', () => {
        assert.equal(statFactor(1000, 1000), 1, 'identity at off==def');
        assert.ok(statFactor(99999, 0) <= 1.85, 'clamped high');
        assert.ok(statFactor(0, 99999) >= 0.35, 'clamped low');
        assert.equal(EP_MULTIPLIER, 32);
        assert.equal(MAX_STAT, 2500);
    });
});
