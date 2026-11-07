import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { HARVEST_COMMON_IDS, HARVEST_TRACE_CHANCE, harvestPayout, harvestTraceFor, isHarvestCommonId } from './harvesting.js';
import { RESOURCE_FAMILIES } from './resource-items.js';
import { GATHER_TRACE_CHANCE } from './gathering-materials.js';

describe('harvest payout (owner-approved 2026-11-06)', () => {
    const base = { family: 'gather-field-herb' as const, level: 1 as const, performance: 6, traceDraw: 0 };

    it('pays one plain, ungraded material per success', () => {
        assert.deepEqual(harvestPayout(base), { itemId: 'gather-field-herb', count: 1 });
        assert.deepEqual(harvestPayout({ ...base, family: 'gather-binding-fiber' }), { itemId: 'gather-binding-fiber', count: 1 });
        for (const id of HARVEST_COMMON_IDS) assert.equal(id in RESOURCE_FAMILIES, false, `${id} must never be graded`);
    });

    it('pays one more only for a perfect run', () => {
        assert.equal(harvestPayout({ ...base, performance: 9 }).count, 1);
        assert.equal(harvestPayout({ ...base, performance: 10 }).count, 2);
        assert.equal(harvestPayout({ ...base, performance: 0 }).count, 1, 'relaxed mode scores 0');
    });

    it('rolls the trace at 8% on level 4 and 15% on level 7, never on level 1', () => {
        const trace = 'gather-heartwood-bark' as const;
        assert.equal(HARVEST_TRACE_CHANCE[7], GATHER_TRACE_CHANCE, 'level 7 matches exploration finds');
        assert.equal(harvestPayout({ ...base, level: 1, trace, traceDraw: 0 }).traceId, undefined);
        assert.equal(harvestPayout({ ...base, level: 4, trace, traceDraw: .0799 }).traceId, trace);
        assert.equal(harvestPayout({ ...base, level: 4, trace, traceDraw: .08 }).traceId, undefined);
        assert.equal(harvestPayout({ ...base, level: 7, trace, traceDraw: .1499 }).traceId, trace);
        assert.equal(harvestPayout({ ...base, level: 7, trace, traceDraw: .15 }).traceId, undefined);
        assert.equal(harvestPayout({ ...base, level: 7, traceDraw: 0 }).traceId, undefined, 'no trace on a node without one');
        assert.equal(harvestPayout({ ...base, level: 7, trace, traceDraw: Number.NaN }).traceId, undefined);
    });

    it('gives traces only in forest and shadow meadows above level 1', () => {
        assert.equal(harvestTraceFor('forest', 4), 'gather-heartwood-bark');
        assert.equal(harvestTraceFor('shadow', 7), 'gather-shadow-thread');
        assert.equal(harvestTraceFor('forest', 1), undefined);
        for (const biome of ['snow', 'volcano', 'central'] as const) assert.equal(harvestTraceFor(biome, 7), undefined);
    });

    it('recognises only the two common harvest ids', () => {
        assert.equal(isHarvestCommonId('gather-field-herb'), true);
        assert.equal(isHarvestCommonId('gather-heartwood-bark'), false);
        assert.equal(isHarvestCommonId('gather-iron-sand'), false);
    });
});
