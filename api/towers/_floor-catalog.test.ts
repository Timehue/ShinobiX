import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { FLOOR_CATALOG, getFloor, TOWER_FLOOR_COUNT, partyScaleFactor, scaleEnemyStat, getFloorBalanceFor, MIN_PARTY_SIZE, DEFAULT_PARTY_SIZE, type TowerFloor } from './_floor-catalog.js';
import { validateFloor, validateCatalog } from './_floor-validate.js';

describe('Battle Towers floor catalog', () => {
    it('the shipped catalog is valid (no shape or cross-field errors)', () => {
        const errs = validateCatalog(FLOOR_CATALOG);
        assert.deepEqual(errs, [], `catalog errors:\n${errs.join('\n')}`);
    });

    // Drift detector: a hand-maintained replica of catalog invariants, so an
    // accidental edit to the catalog data trips this test (mirrors _mission-catalog).
    it('matches the expected v1 shape (drift detector)', () => {
        assert.equal(TOWER_FLOOR_COUNT, 5, 'v1 ships 5 seed floors');
        assert.deepEqual(FLOOR_CATALOG.map(f => f.id), [1, 2, 3, 4, 5]);
        assert.deepEqual(
            FLOOR_CATALOG.map(f => f.objective),
            ['defeat-all', 'defeat-all', 'reach-tile', 'protect-npc', 'defeat-boss'],
        );
        // Floor 5 is the boss + milestone floor.
        const f5 = getFloor(5);
        assert.ok(f5?.boss, 'floor 5 has a boss');
        assert.equal(f5?.firstClearReward.milestone, 'tower-floor-5');
    });

    it('every map fits the board bounds and boss/npc/goal cross-fields hold', () => {
        for (const f of FLOOR_CATALOG) {
            assert.ok(f.map.width >= 8 && f.map.width <= 24, `floor ${f.id} width`);
            assert.ok(f.map.height >= 8 && f.map.height <= 24, `floor ${f.id} height`);
            if (f.objective === 'reach-tile') {
                assert.ok(typeof f.goalTile === 'number' && f.goalTile < f.map.width * f.map.height, `floor ${f.id} goalTile`);
            }
            if (f.objective === 'protect-npc') assert.ok(f.npc?.aiId, `floor ${f.id} npc`);
        }
    });

    it('milestone reward keys are unique', () => {
        const keys = FLOOR_CATALOG.map(f => f.firstClearReward.milestone).filter(Boolean);
        assert.equal(new Set(keys).size, keys.length);
    });

    // ── validator negative tests ──────────────────────────────────────────────
    function baseFloor(): TowerFloor {
        return {
            id: 1, name: 'Test', biome: 'forest', objective: 'defeat-all',
            roundBudget: 8, map: { width: 20, height: 16 }, fieldRule: { kind: 'none' },
            enemies: [{ aiId: 'grunt', count: 2 }], firstClearReward: { ryo: 100 },
        };
    }

    it('rejects an invalid objective', () => {
        const f = { ...baseFloor(), objective: 'nuke-everything' as unknown as TowerFloor['objective'] };
        assert.ok(validateFloor(f).some(e => e.includes('invalid objective')));
    });

    it('rejects an out-of-bounds map', () => {
        const f = { ...baseFloor(), map: { width: 64, height: 64 } };
        assert.ok(validateFloor(f).length > 0);
    });

    it('requires a boss for boss objectives', () => {
        const f = { ...baseFloor(), objective: 'defeat-boss' as const };
        assert.ok(validateFloor(f).some(e => e.includes('requires a boss')));
    });

    it('requires a goalTile (in bounds) for reach-tile', () => {
        const f = { ...baseFloor(), objective: 'reach-tile' as const };
        assert.ok(validateFloor(f).some(e => e.includes('goalTile')));
        const f2 = { ...baseFloor(), objective: 'reach-tile' as const, goalTile: 99999 };
        assert.ok(validateFloor(f2).some(e => e.includes('goalTile')));
    });

    it('flags duplicate + non-contiguous ids at the catalog level', () => {
        const dup = [baseFloor(), { ...baseFloor(), id: 1 }];
        assert.ok(validateCatalog(dup).some(e => e.includes('duplicate floor id')));
        const gap = [baseFloor(), { ...baseFloor(), id: 3 }];
        assert.ok(validateCatalog(gap).some(e => e.includes('contiguous')));
    });

    it('accepts a valid balanceFor and rejects an out-of-range one', () => {
        const ok: TowerFloor = { ...FLOOR_CATALOG[0], balanceFor: 2 };
        assert.deepEqual(validateFloor(ok), []);
        const bad: TowerFloor = { ...FLOOR_CATALOG[0], balanceFor: 7 };
        assert.ok(validateFloor(bad).some(e => e.includes('balanceFor')));
    });
});

describe('Battle Towers party scaling (2–4 squad)', () => {
    it('a full party (>= balanceFor) gets no scaling', () => {
        assert.equal(partyScaleFactor(4, 4), 1);
        assert.equal(partyScaleFactor(3, 3), 1);
        assert.equal(partyScaleFactor(2, 2), 1);
        assert.equal(partyScaleFactor(5, 4), 1, 'clamped party >= base → 1, never scales up');
    });

    it('smaller parties scale enemies down, sub-linearly with a floor', () => {
        assert.equal(partyScaleFactor(2, 4), 0.6, 'duo hits the PARTY_SCALE_FLOOR');
        assert.equal(partyScaleFactor(3, 4), 0.75, 'trio is linear above the floor');
        assert.ok(partyScaleFactor(2, 4) < partyScaleFactor(3, 4));
        assert.ok(partyScaleFactor(2, 4) <= 1);
    });

    it('clamps party size to [2,4]', () => {
        assert.equal(partyScaleFactor(1, 4), partyScaleFactor(MIN_PARTY_SIZE, 4));
        assert.equal(partyScaleFactor(99, 4), 1);
    });

    it('scaleEnemyStat applies the factor, floor of 1, never above the base value', () => {
        assert.equal(scaleEnemyStat(1000, 0.6), 600);
        assert.equal(scaleEnemyStat(1000, 1), 1000);
        assert.equal(scaleEnemyStat(1000, 2), 1000, 'factor clamped to <= 1');
        assert.equal(scaleEnemyStat(1, 0.1), 1, 'floor at 1 (no zero-HP enemies)');
    });

    it('getFloorBalanceFor defaults to 4 and honours an explicit value', () => {
        assert.equal(getFloorBalanceFor({ ...FLOOR_CATALOG[0] }), DEFAULT_PARTY_SIZE);
        assert.equal(getFloorBalanceFor({ ...FLOOR_CATALOG[0], balanceFor: 2 }), 2);
    });
});
