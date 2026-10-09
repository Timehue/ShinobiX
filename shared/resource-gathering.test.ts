import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceQualityWeights, resourceQuality, resourceSuccessRate, resourceActionsToday, resourceNodeState } from './resource-gathering.js';
import { initializeGatheringTool, useGatheringTool, gatheringToolRemaining } from './gathering-tools.js';
import { FRACTURE_TEMPLATES, solveFractureChain } from './fracture-chain.js';

test('every level improves success and cumulative quality at each site ceiling', () => {
    for (const ceiling of [0, 1, 2, 3] as const) {
        let previous = [100, 0, 0, 0];
        for (let level = 1; level <= 10; level++) {
            const weights = resourceQualityWeights(level, ceiling);
            assert.ok(Math.abs(weights.reduce((a, b) => a + b) - 100) < 1e-8);
            for (let grade = 1; grade <= 3; grade++) {
                assert.ok(weights.slice(grade).reduce((a, b) => a + b) >= previous.slice(grade).reduce((a, b) => a + b) - 1e-8);
            }
            assert.ok(weights.every((weight, grade) => grade <= ceiling || weight === 0));
            assert.ok(resourceSuccessRate(level, 1) >= resourceSuccessRate(Math.max(1, level - 1), 1));
            previous = weights;
        }
    }
    assert.deepEqual(resourceQualityWeights(10, 1), [15, 85, 0, 0]);
    assert.equal(resourceQuality(1, 3, .999999), 0);
    assert.equal(resourceSuccessRate(10, 1, 10), 95);
});
test('mixed actions, midnight and exactly-ten-minute refill boundaries', () => {
    const now = Date.parse('2026-10-07T23:59:59Z');
    const c = { serverExploreDate: '2026-10-07', serverExploresToday: 70, resourceGathering: { date: '2026-10-07', attemptsToday: 30 } };
    assert.equal(resourceActionsToday(c, now), 100);
    assert.equal(resourceActionsToday(c, now + 1000), 0);
    assert.deepEqual(resourceNodeState({ attempts: 3, refillAt: now + 600_000 }, now + 599_999), { attempts: 3, refillAt: now + 600_000 });
    assert.equal(resourceNodeState({ attempts: 3, refillAt: now + 600_000 }, now + 600_000).attempts, 0);
});
test('50th basic use is admitted and breaks; re-equip cannot reset uses; gold is permanent', () => {
    let c: Record<string, unknown> = initializeGatheringTool({ equipment: { pickaxe: 'tool-basic-pickaxe' } }, 'tool-basic-pickaxe');
    for (let i = 0; i < 49; i++) { const use = useGatheringTool(c, 'pickaxe')!; assert.equal(use.broke, false); c = use.character; }
    assert.equal(gatheringToolRemaining(c, 'tool-basic-pickaxe'), 1);
    const last = useGatheringTool(c, 'pickaxe')!;
    assert.equal(last.broke, true);
    assert.equal(useGatheringTool(last.character, 'pickaxe'), null);
    assert.equal(useGatheringTool({ ...last.character, equipment: { pickaxe: 'tool-basic-pickaxe' } }, 'pickaxe'), null);
    const gold = { equipment: { pickaxe: 'tool-golden-pickaxe' } };
    assert.equal(useGatheringTool(gold, 'pickaxe')!.character, gold);
});
test('every fracture formation has a clean solution, legal partial paths and destructive overlap', () => {
    FRACTURE_TEMPLATES.forEach((template, index) => {
        const solutions: number[][] = [];
        function visit(selected: number[]) {
            if (selected.length === template.charges) {
                const result = solveFractureChain(index, selected)!;
                if (!result.destroyed && result.exposed === template.faces) solutions.push(selected);
                return;
            }
            template.sites.forEach((_, site) => { if (!selected.includes(site)) visit([...selected, site]); });
        }
        visit([]); assert.ok(solutions.length > 0, template.name);
        assert.equal(solveFractureChain(index, Array(template.charges).fill(0)), null);
        assert.equal(solveFractureChain(index, [999]), null);
    });
    assert.equal(solveFractureChain(0, [0, 2])!.destroyed, true);
    assert.equal(solveFractureChain(0, [0, 1])!.performance, 10);
});
