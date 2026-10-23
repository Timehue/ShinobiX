import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { anchorRyoPerMinute } from '../../shared/economy-anchor.js';
import {
    GATE_RYO_K,
    GATE_RYO_K_FLAT,
    GATE_RYO_REFERENCE_PER_MIN,
    gateRyoK,
    HOLLOW_GATE_PAID_AMBUSHES_PER_RUN,
    hollowGateAmbushPurse,
    hollowGateEntryLevel,
    hollowGatePaidAmbushCount,
    hollowGateRunRyoScale,
    hollowGateRyoScaleForLevel,
    scaleHollowGateRyo,
} from './_gate-scale.js';

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

afterEach(() => { delete process.env.GATE_RYO_K; });

describe('Hollow Gate ryo level scale (2026-10 rebalance #1)', () => {
    it('is min(1, K·A(L)/312) on the shared anchor, full from L70', () => {
        assert.equal(GATE_RYO_K, 1.04);
        assert.equal(GATE_RYO_REFERENCE_PER_MIN, 312);
        const pins: Array<[number, number]> = [
            [1, 0.08], [10, 0.2], [12, 0.2267], [20, 0.3333], [30, 0.4667],
            [50, 0.7333], [59, 0.8533], [60, 0.8667], [69, 0.9867], [70, 1], [90, 1],
        ];
        for (const [level, scale] of pins) {
            assert.equal(round4(hollowGateRyoScaleForLevel(level)), scale, `L${level}`);
            assert.equal(hollowGateRyoScaleForLevel(level), Math.min(1, GATE_RYO_K * anchorRyoPerMinute(level) / 312));
        }
    });

    it('keeps the framework scale table when the owner turns K to 1.2', () => {
        const at = (level: number) => round4(hollowGateRyoScaleForLevel(level, 1.2));
        assert.deepEqual([10, 12, 20, 30, 50, 59, 60].map(at), [0.2308, 0.2615, 0.3846, 0.5385, 0.8462, 0.9846, 1]);
    });

    it('reads GATE_RYO_K from the env inside [1, 1.4] or exactly the flat kill value', () => {
        assert.equal(gateRyoK(), GATE_RYO_K);
        process.env.GATE_RYO_K = '1.3';
        assert.equal(gateRyoK(), 1.3);
        assert.equal(round4(hollowGateRyoScaleForLevel(30)), round4(1.3 * 140 / 312));
        process.env.GATE_RYO_K = String(GATE_RYO_K_FLAT);
        assert.equal(gateRyoK(), 99);
        assert.equal(hollowGateRyoScaleForLevel(1), 1, 'the kill value pays every level the flat purse');
        for (const typo of ['12', '0.5', '-1', 'abc', '', '1.41', '98']) {
            process.env.GATE_RYO_K = typo;
            assert.equal(gateRyoK(), GATE_RYO_K, `GATE_RYO_K=${JSON.stringify(typo)} falls back to the default`);
        }
    });

    it('seals the start level and keeps flat pay for a run minted before the cutover (I-18)', () => {
        assert.equal(hollowGateEntryLevel(30.9), 30);
        assert.equal(hollowGateEntryLevel(0), 1);
        assert.equal(hollowGateEntryLevel('junk'), 1);
        assert.equal(hollowGateEntryLevel(400), 100);
        assert.equal(hollowGateRunRyoScale({}), 1);
        assert.equal(hollowGateRunRyoScale(null), 1);
        assert.equal(hollowGateRunRyoScale({ entryLevel: 'not-a-level' }), 1);
        assert.equal(round4(hollowGateRunRyoScale({ entryLevel: 30 })), 0.4667);
    });

    it('floors scaled ryo and never raises it', () => {
        assert.equal(scaleHollowGateRyo(485, 0.2267), 109);
        assert.equal(scaleHollowGateRyo(485, 1), 485);
        assert.equal(scaleHollowGateRyo(485, 3), 485);
        assert.equal(scaleHollowGateRyo(485, -1), 0);
        assert.equal(scaleHollowGateRyo(-50, 1), 0);
    });

    it('start.ts is the minting path and seals entryLevel on every run token', () => {
        const start = readFileSync(join('api', 'hollow-gate', 'start.ts'), 'utf8');
        assert.match(start, /entryLevel: hollowGateEntryLevel\(character\.level\)/);
    });
});

describe('paid threat ambushes per run (2026-10 rebalance #12)', () => {
    it('counts only won threat ambushes, never battles, card duels or a threat-raised boss', () => {
        assert.equal(HOLLOW_GATE_PAID_AMBUSHES_PER_RUN, 16);
        assert.equal(hollowGatePaidAmbushCount({ resolvedEncounterIds: [
            '1:ambush:floor:1:ambush:threat-v9',
            '1:battle:floor:1:tile:4',
            '1:card:floor:1:ambush:threat-v3',
            '5:boss:floor:5:ambush:threat-v40',
            '2:ambush:floor:2:ambush:threat-v31',
        ] }), 2);
        assert.equal(hollowGatePaidAmbushCount({}), 0);
        assert.equal(hollowGatePaidAmbushCount(null), 0);
        assert.equal(hollowGatePaidAmbushCount({ resolvedEncounterIds: 'junk' }), 0);
    });

    it('tells the reward line where a won ambush sits against the cap', () => {
        assert.deepEqual(hollowGateAmbushPurse('ambush', true, 0), { ordinal: 1, paidCap: 16, paid: true });
        assert.deepEqual(hollowGateAmbushPurse('ambush', true, 15), { ordinal: 16, paidCap: 16, paid: true });
        assert.deepEqual(hollowGateAmbushPurse('ambush', true, 16), { ordinal: 17, paidCap: 16, paid: false });
        assert.equal(hollowGateAmbushPurse('ambush', false, 3), undefined, 'a lost ambush pays nothing and counts nothing');
        assert.equal(hollowGateAmbushPurse('battle', true, 3), undefined);
        assert.equal(hollowGateAmbushPurse('boss', true, 3), undefined);
    });

    it('combat-settle returns the purse note on fresh and replayed settlements', () => {
        const settle = readFileSync(join('api', 'hollow-gate', 'combat-settle.ts'), 'utf8');
        // An ended pet projection pays nothing, so it reports no purse either.
        assert.match(settle, /hollowGateAmbushPurse\(binding!\.kind, won && !endedProjection, rewardOptions\.paidAmbushes\)/);
        // Both replay paths answer through combatReplayBody (merged from main).
        assert.match(settle, /function combatReplayBody[\s\S]*?receipt\.ambushPurse \? \{ ambushPurse: receipt\.ambushPurse \}/);
        assert.match(settle, /banked\.receipt\.ambushPurse \? \{ ambushPurse: banked\.receipt\.ambushPurse \}/);
    });
});
