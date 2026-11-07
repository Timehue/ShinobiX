// Kama Reaping settlement (docs/harvesting-minigame-plan.md §4 and §6). The
// server re-scores the strokes from the sealed seed and pays the approved table
// from the sealed rules and draws only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HARVEST_BLOOM_MS, HARVEST_NODES, RESOURCE_NODES, harvestBloom, harvestNodeAt, resourceNodeAtLevel, type ResourceNode } from '../../shared/resource-nodes.js';
import { readResourceGathering, resourceAttemptsToday } from '../../shared/resource-gathering.js';
import { kamaField, kamaSeed, kamaStalkPose, KAMA_LIMIT_MS, KAMA_READY_MS, type KamaStroke } from '../../shared/kama-reaping.js';
import { gatheringToolRemaining, initializeGatheringTool } from '../../shared/gathering-tools.js';
import { admitResourceAttempt, mintResourceSeal, resolveResourceAttempt, resourceAdmissionError, type ResourceSeal } from './_resource-gathering.js';
import { countOwned } from '../craft/_forge.js';
import type { OnlinePlayer } from '../_realtime/types.js';

const now = Date.parse('2026-11-06T12:00:00Z');
const meadow = (biome: 'central' | 'forest' | 'shadow', level: 1 | 4 | 7) => {
    const sectors = { central: 1, forest: 9, shadow: 17 };
    return resourceNodeAtLevel(HARVEST_NODES.find(node => node.sector === sectors[biome])!, level);
};
const presenceAt = (node: ResourceNode): OnlinePlayer => ({ name: 'reaper', displayName: 'Reaper', sector: node.sector, tile: node.approach,
    lastSeenAt: now, connectedAt: now, pendingAttacker: null, character: null, movementSeq: 2 });
const base = (extra: Record<string, unknown> = {}) => ({ name: 'reaper', level: 100, inventory: [] as string[],
    itemStacks: [] as { itemId: string; count: number }[], equipment: { kama: 'tool-golden-harvest-kama' } as Record<string, string>, ...extra });

/** A fixed field: the same seed shared/kama-reaping.test.ts proves a perfect run on. */
const FIXED = { template: 3, hookAt: 2400 };
const field = kamaField(kamaSeed(FIXED));
const pointOn = (index: number, at: number, fraction: number) => {
    const { base: root, tip } = kamaStalkPose(field, index, at);
    return { x: root.x + (tip.x - root.x) * fraction, y: root.y + (tip.y - root.y) * fraction };
};
const strokeAt = (index: number, at: number, offset = 0): KamaStroke => {
    const point = pointOn(index, at, field.stalks[index].band + offset);
    return { kind: 'stroke', at, x1: point.x - 3, y1: point.y, x2: point.x + 3, y2: point.y };
};
const sweep = (first: number, second: number, at: number): KamaStroke => {
    const a = pointOn(first, at, field.stalks[first].band), b = pointOn(second, at, field.stalks[second].band);
    const dx = b.x - a.x, dy = b.y - a.y;
    return { kind: 'stroke', at, x1: a.x - dx * .05, y1: a.y - dy * .05, x2: b.x + dx * .05, y2: b.y + dy * .05 };
};
const PERFECT = [sweep(0, 1, 1000), sweep(2, 3, 1400), strokeAt(4, 1800)];
const ROUGH_ONE = [strokeAt(0, 1000, .06), strokeAt(1, 1400, .3), strokeAt(2, 1800, .3)];

function admit(node: ResourceNode, id: string, mode: 'active' | 'relaxed', draws: Partial<ResourceSeal>, character = base()) {
    const seal = { ...mintResourceSeal(character, node, id, mode, presenceAt(node), now), ...FIXED, ...draws };
    const admitted = admitResourceAttempt(character, seal, now);
    assert.ok(admitted, 'admitted');
    return { seal, admitted: admitted! };
}

test('a harvest needs a usable kama, Harvesting skill and its own daily allowance', () => {
    const node = meadow('forest', 4);
    assert.match(resourceAdmissionError(base({ equipment: { pickaxe: 'tool-golden-pickaxe' } }), meadow('central', 1), now, true)!, /Equip a harvest kama/);
    assert.match(resourceAdmissionError(base(), node, now, true)!, /Requires Harvesting skill 4/);
    assert.equal(resourceAdmissionError(base({ resourceGathering: { harvestingXp: 450 } }), node, now, true), null);
    const capped = base({ resourceGathering: { date: '2026-11-06', harvestingAttemptsToday: 50, miningAttemptsToday: 0 } });
    assert.match(resourceAdmissionError(capped, meadow('central', 1), now, true)!, /50 harvesting attempts/);
    const mine = RESOURCE_NODES.find(candidate => candidate.activity === 'mining' && candidate.difficulty === 1)!;
    assert.equal(resourceAdmissionError({ ...capped, equipment: { pickaxe: 'tool-golden-pickaxe' } }, mine, now, true), null, 'mining keeps its own allowance');
});

test('a dormant meadow refuses harvesting, and an attempt keeps the plant it bloomed with', () => {
    const base0 = HARVEST_NODES.find(node => node.sector === 1)!;
    // Find a half hour where this spot is dormant, then one where it grows fiber.
    let dormantAt = 0, fiberAt = 0;
    for (let cycle = 0; (!dormantAt || !fiberAt) && cycle < 200; cycle++) {
        const at = now + cycle * HARVEST_BLOOM_MS, bloom = harvestBloom(base0, at);
        if (!bloom.present && !dormantAt) dormantAt = at;
        if (bloom.present && bloom.family === 'gather-binding-fiber' && !fiberAt) fiberAt = at;
    }
    assert.ok(dormantAt && fiberAt);
    const dormant = harvestNodeAt(resourceNodeAtLevel(base0, 1), dormantAt);
    assert.match(resourceAdmissionError(base(), dormant, dormantAt, true)!, /Nothing is growing here/);
    // Start one second before the half hour turns; settle after it has.
    const startAt = fiberAt + HARVEST_BLOOM_MS - 1000;
    const fiber = harvestNodeAt(resourceNodeAtLevel(base0, 1), startAt);
    assert.equal(fiber.family, 'gather-binding-fiber');
    assert.equal(resourceAdmissionError(base(), fiber, startAt, true), null);
    const seal = { ...mintResourceSeal(base(), fiber, 'kama-bloom', 'active', presenceAt(fiber), startAt), ...FIXED, successDraw: 0 };
    assert.equal(seal.rules.family, 'gather-binding-fiber');
    const admitted = admitResourceAttempt(base(), seal, startAt)!;
    const result = resolveResourceAttempt(admitted, seal.id, { events: PERFECT }, presenceAt(fiber), startAt + 2000, seal);
    assert.ok(result.ok); if (!result.ok) return;
    assert.equal(result.receipt.itemId, 'gather-binding-fiber', 'the sealed plant pays, whatever bloomed next');
    assert.equal(countOwned(result.character, 'gather-binding-fiber'), 2);
});

test('admission spends one kama use and one harvesting attempt, and seals a kama field', () => {
    const character = initializeGatheringTool(base({ equipment: { kama: 'tool-basic-harvest-kama' } }), 'tool-basic-harvest-kama');
    const node = meadow('central', 1);
    const seal = mintResourceSeal(character, node, 'kama-admission', 'active', presenceAt(node), now);
    assert.equal(seal.activity, 'harvesting');
    assert.equal(seal.toolId, 'tool-basic-harvest-kama');
    assert.ok(Number.isInteger(seal.template) && seal.template >= 0 && seal.template < 1000);
    assert.equal(seal.rules.family, node.family);
    const admitted = admitResourceAttempt(character, seal, now)!;
    assert.equal(gatheringToolRemaining(admitted, 'tool-basic-harvest-kama'), 124);
    assert.equal(resourceAttemptsToday(admitted, 'harvesting', now), 1);
    assert.equal(resourceAttemptsToday(admitted, 'mining', now), 0);
    assert.equal(readResourceGathering(admitted.resourceGathering).nodes[node.id].attempts, 1);
});

test('a perfect run pays two of the meadow material and 5 XP, once', () => {
    const node = meadow('central', 1);
    const { seal, admitted } = admit(node, 'kama-perfect', 'active', { successDraw: 0, traceDraw: 0 });
    const result = resolveResourceAttempt(admitted, seal.id, { events: PERFECT }, presenceAt(node), now + 2000, seal);
    assert.ok(result.ok); if (!result.ok) return;
    assert.equal(result.receipt.outcome, 'success');
    assert.equal(result.receipt.performance, 10);
    assert.deepEqual(result.receipt.harvestCuts, { clean: 5, rough: 0, wasted: 0, tear: 0 });
    assert.equal(result.receipt.itemId, node.family);
    assert.equal(result.receipt.count, 2);
    assert.equal(result.receipt.grade, undefined, 'harvest ids are ungraded');
    assert.equal(result.receipt.traceId, undefined, 'a level 1 meadow has no trace');
    assert.equal(countOwned(result.character, node.family), 2);
    assert.equal(readResourceGathering(result.character.resourceGathering).harvestingXp, 5);
    const replay = resolveResourceAttempt(result.character, seal.id, { events: PERFECT }, presenceAt(node), now + 3000, seal);
    assert.ok(replay.ok); if (!replay.ok) return;
    assert.equal(replay.replayed, true);
    assert.equal(countOwned(replay.character, node.family), 2);
});

test('an imperfect success pays one, and skill traces follow the sealed level', () => {
    for (const [biome, level, trace] of [['forest', 4, 'gather-heartwood-bark'], ['shadow', 7, 'gather-shadow-thread'], ['central', 7, undefined]] as const) {
        const node = meadow(biome, level);
        const character = base({ resourceGathering: { harvestingXp: 3200 } });
        for (const traceDraw of [0, .9]) {
            const { seal, admitted } = admit(node, `kama-${biome}-${traceDraw}`, 'active', { successDraw: 0, traceDraw }, character);
            const result = resolveResourceAttempt(admitted, seal.id, { events: ROUGH_ONE }, presenceAt(node), now + 2000, seal);
            assert.ok(result.ok); if (!result.ok) continue;
            assert.equal(result.receipt.outcome, 'success');
            assert.equal(result.receipt.count, 1);
            assert.equal(countOwned(result.character, node.family), 1);
            const expected = traceDraw === 0 ? trace : undefined;
            assert.equal(result.receipt.traceId, expected, `${biome} ${traceDraw}`);
            if (expected) assert.equal(countOwned(result.character, expected), 1);
        }
    }
});

test('performance raises the success roll, and a failure pays only 1 XP', () => {
    const node = meadow('central', 1);
    // Skill 1 on a level 1 meadow: 60% base, +10 for a perfect run (70%).
    for (const [events, outcome] of [[PERFECT, 'success'], [ROUGH_ONE, 'failed']] as const) {
        const { seal, admitted } = admit(node, `kama-roll-${outcome}`, 'active', { successDraw: .65 });
        const result = resolveResourceAttempt(admitted, seal.id, { events }, presenceAt(node), now + 2000, seal);
        assert.ok(result.ok); if (!result.ok) continue;
        assert.equal(result.receipt.outcome, outcome);
        if (outcome === 'failed') {
            assert.equal(result.receipt.itemId, undefined);
            assert.equal(result.receipt.xp, 1);
            assert.equal(countOwned(result.character, node.family), 0);
        }
    }
});

test('torn roots or an empty run fail even on a winning draw', () => {
    const node = meadow('central', 1);
    const torn = [strokeAt(0, 1000, -.2), strokeAt(1, 1400, -.2), strokeAt(2, 1800)];
    for (const [events, elapsed] of [[torn, 2000], [[], KAMA_READY_MS + KAMA_LIMIT_MS]] as const) {
        const { seal, admitted } = admit(node, `kama-fail-${events.length}`, 'active', { successDraw: 0 });
        const result = resolveResourceAttempt(admitted, seal.id, { events }, presenceAt(node), now + elapsed, seal);
        assert.ok(result.ok); if (!result.ok) continue;
        assert.equal(result.receipt.outcome, 'failed');
        assert.equal(result.receipt.itemId, undefined);
        assert.equal(result.receipt.xp, 1);
    }
});

test('an unfinished or malformed run is refused without settling, then can be cancelled', () => {
    const node = meadow('central', 1);
    const { seal, admitted } = admit(node, 'kama-unfinished', 'active', { successDraw: 0 });
    for (const events of [[strokeAt(0, 1000)], [{ ...strokeAt(0, 1000), x1: Number.NaN }], 'strokes', [strokeAt(0, 5000)]]) {
        const refused = resolveResourceAttempt(admitted, seal.id, { events }, presenceAt(node), now + 2000, seal);
        assert.equal(refused.ok, false, JSON.stringify(events));
        if (!refused.ok) assert.match(refused.error, /still in progress/);
    }
    const cancelled = resolveResourceAttempt(admitted, seal.id, { cancel: true }, presenceAt(node), now + 2000, seal);
    assert.ok(cancelled.ok); if (!cancelled.ok) return;
    assert.equal(cancelled.receipt.outcome, 'cancelled');
    assert.equal(cancelled.receipt.xp, 0);
    assert.equal(countOwned(cancelled.character, node.family), 0);
});

test('relaxed harvesting waits out the animation and uses the baseline roll', () => {
    const node = meadow('central', 1);
    const { seal, admitted } = admit(node, 'kama-relaxed', 'relaxed', { successDraw: 0 });
    assert.equal(resolveResourceAttempt(admitted, seal.id, {}, presenceAt(node), now + 1000, seal).ok, false);
    const result = resolveResourceAttempt(admitted, seal.id, {}, presenceAt(node), now + 3000, seal);
    assert.ok(result.ok); if (!result.ok) return;
    assert.equal(result.receipt.outcome, 'success');
    assert.equal(result.receipt.performance, 0);
    assert.equal(result.receipt.count, 1, 'relaxed play never earns the perfect bonus');
});

test('moving away closes a harvest without items or XP', () => {
    const node = meadow('central', 1);
    const { seal, admitted } = admit(node, 'kama-moved', 'active', { successDraw: 0 });
    const moved = { ...presenceAt(node), movementSeq: 3 };
    const result = resolveResourceAttempt(admitted, seal.id, { events: PERFECT }, moved, now + 2000, seal);
    assert.ok(result.ok); if (!result.ok) return;
    assert.equal(result.receipt.outcome, 'cancelled');
    assert.equal(result.receipt.itemId, undefined);
    assert.equal(result.receipt.xp, 0);
});
