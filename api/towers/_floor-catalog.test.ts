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
    it('matches the expected shape (drift detector)', () => {
        assert.equal(TOWER_FLOOR_COUNT, 15, 'ships two complete chapters / 15 floors');
        assert.deepEqual(FLOOR_CATALOG.map(f => f.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        assert.deepEqual(
            FLOOR_CATALOG.map(f => f.objective),
            [
                'defeat-all', 'defeat-all', 'defeat-all', 'protect-npc', 'defeat-boss',
                'defeat-all', 'defeat-all-then-boss', 'kill-escort', 'kill-adds-first', 'defeat-boss',
                'defeat-all', 'break-objective', 'protect-npc', 'defeat-all', 'kill-adds-first',
            ],
        );
        assert.equal(getFloor(5)?.firstClearReward.milestone, 'tower-floor-5');
        assert.equal(getFloor(10)?.firstClearReward.milestone, 'tower-floor-10');
        assert.equal(getFloor(15)?.firstClearReward.milestone, 'tower-floor-15');
        // No reach-tile floor (too easy in this format).
        assert.ok(!FLOOR_CATALOG.some(f => f.objective === 'reach-tile'), 'no reach-tile floors');
        // Chapter 1 teaches every signature mechanic once; Chapter 2 recombines those
        // primitives into staged-break and re-locking-add encounters.
        const chapterOneMechs = FLOOR_CATALOG.filter(f => f.id <= 10 && f.boss).map(f => f.boss!.mechanic);
        assert.deepEqual(chapterOneMechs, ['bulwark', 'regen', 'summon', 'enrage']);
        assert.deepEqual(FLOOR_CATALOG.filter(f => f.id > 10 && f.boss).map(f => f.boss!.mechanic), ['bulwark', 'summon']);
    });

    it('ships Chapter 2 as one cohesive, fully briefed Stormglass arc', () => {
        const chapter = FLOOR_CATALOG.filter(f => f.chapter === 2);
        assert.deepEqual(chapter.map(f => f.id), [11, 12, 13, 14, 15]);
        assert.ok(chapter.every(f => f.chapterTitle === 'The Stormglass Rebellion'));
        assert.equal(new Set(chapter.map(f => f.artKey)).size, 5, 'every floor has distinct key art');
        for (const floor of chapter) {
            assert.ok(floor.briefing?.situation, `floor ${floor.id} has a situation brief`);
            assert.ok((floor.briefing?.tactics.length ?? 0) >= 2, `floor ${floor.id} teaches tactics`);
            assert.ok((floor.briefing?.warnings.length ?? 0) >= 1, `floor ${floor.id} previews hazards`);
        }
    });

    it('keeps Tower chapter narration concrete and tied to the shinobi world', () => {
        const narrative = FLOOR_CATALOG.flatMap(floor => [
            floor.chapterTitle ?? '',
            floor.chapterSubtitle ?? '',
            floor.chapterSummary ?? '',
            floor.briefing?.situation ?? '',
        ]).join('\n');
        assert.match(narrative, /shinobi/i);
        assert.match(narrative, /Stormveil splinter regiment/i);
        assert.doesNotMatch(narrative, /[—–]|throne above|weather-forged court awakens|endless storm|Tower can reinforce|boss burn|health gates?/i);
    });

    it('ships every Story floor with unique authored art and mechanically truthful briefings', () => {
        assert.equal(new Set(FLOOR_CATALOG.map(floor => floor.artKey)).size, TOWER_FLOOR_COUNT, 'every Story floor owns distinct key art');
        for (const floor of FLOOR_CATALOG) {
            assert.match(floor.artKey ?? '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `floor ${floor.id} has a valid art key`);
            assert.ok(floor.chapterTitle?.trim(), `floor ${floor.id} has a chapter title`);
            assert.ok(floor.chapterSubtitle?.trim(), `floor ${floor.id} has a chapter subtitle`);
            assert.ok(floor.chapterSummary?.trim(), `floor ${floor.id} has a chapter summary`);
            assert.ok(floor.briefing?.situation.trim(), `floor ${floor.id} has a situation brief`);
            assert.ok((floor.briefing?.tactics.length ?? 0) >= 2, `floor ${floor.id} teaches at least two tactics`);
            assert.ok((floor.briefing?.warnings.length ?? 0) >= 1, `floor ${floor.id} exposes at least one warning`);
        }

        assert.match(getFloor(4)?.briefing?.warnings.join(' ') ?? '', /8 completed rounds/);
        assert.match(getFloor(5)?.briefing?.tactics.join(' ') ?? '', /60% and 30%/);
        assert.match(getFloor(7)?.briefing?.warnings.join(' ') ?? '', /650 health every round/);
        assert.match(getFloor(9)?.briefing?.warnings.join(' ') ?? '', /66% and 33%/);
        assert.match(getFloor(9)?.briefing?.warnings.join(' ') ?? '', /Three Bandits/);
        assert.match(getFloor(10)?.briefing?.warnings.join(' ') ?? '', /round 12/);
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

    it('accepts a valid geyser hazard and rejects malformed cadence/percent/count', () => {
        const ok: TowerFloor = { ...FLOOR_CATALOG[0], dynamicHazards: [{ kind: 'geyser', count: 3, pct: 5, everyRounds: 3, firstRound: 2 }] };
        assert.deepEqual(validateFloor(ok), []);
        const badPct: TowerFloor = { ...FLOOR_CATALOG[0], dynamicHazards: [{ kind: 'geyser', count: 3, pct: 40, everyRounds: 3 }] };
        assert.ok(validateFloor(badPct).some(e => e.includes('pct')), 'a >25% geyser is rejected');
        const badCadence: TowerFloor = { ...FLOOR_CATALOG[0], dynamicHazards: [{ kind: 'geyser', count: 3, pct: 5, everyRounds: 1 }] };
        assert.ok(validateFloor(badCadence).some(e => e.includes('everyRounds')), 'an every-round geyser is rejected');
        const badCount: TowerFloor = { ...FLOOR_CATALOG[0], dynamicHazards: [{ kind: 'geyser', count: 99, pct: 5, everyRounds: 3 }] };
        assert.ok(validateFloor(badCount).some(e => e.includes('count')), 'a 99-vent floor is rejected');
    });

    it('validates staged objectives and player-facing chapter briefings', () => {
        const noGates: TowerFloor = {
            ...baseFloor(), objective: 'break-objective', boss: { aiId: 'boss-warden' },
        };
        assert.ok(validateFloor(noGates).some(e => e.includes('requires at least one boss phase')));

        const ascendingGates: TowerFloor = {
            ...baseFloor(), objective: 'break-objective', boss: { aiId: 'boss-warden', phases: [25, 75] },
        };
        assert.ok(validateFloor(ascendingGates).some(e => e.includes('strictly descending')));

        const malformedBrief: TowerFloor = {
            ...baseFloor(), chapter: 2, chapterTitle: '', artKey: 'Not Valid',
            briefing: { situation: '', tactics: [], warnings: [''] },
        };
        const errors = validateFloor(malformedBrief);
        assert.ok(errors.some(e => e.includes('chapterTitle')));
        assert.ok(errors.some(e => e.includes('artKey')));
        assert.ok(errors.some(e => e.includes('briefing.situation')));
        assert.ok(errors.some(e => e.includes('briefing.tactics')));
        assert.ok(errors.some(e => e.includes('briefing.warnings')));
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
