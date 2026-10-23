import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceNode } from '../../shared/resource-nodes.js';
import { readResourceGathering, resourceActionsToday } from '../../shared/resource-gathering.js';
import { kunaiFish, kunaiFlightMs, kunaiSeed } from '../../shared/kunai-fishing.js';
import { mintResourceSeal, admitResourceAttempt, resolveResourceAttempt } from './_resource-gathering.js';
import type { OnlinePlayer } from '../_realtime/types.js';
import { countOwned } from '../craft/_forge.js';

const now = Date.parse('2026-10-22T12:00:00Z'), node = resourceNode('resource-1')!;
const player = { sector: node.sector, tile: node.approach, movementSeq: 0 } as OnlinePlayer;
const character = { name: 'kunai-test', equipment: { fishingPole: 'tool-basic-fishing-pole' },
    gatheringToolUses: { 'tool-basic-fishing-pole': 0 }, inventory: [], itemStacks: [], resourceGathering: { fishingXp: 3200 } };

test('a visible kunai hit secures one sealed reward and survives retries without extra costs', () => {
    const seal = { ...mintResourceSeal(character, node, 'kunai-catch', 'active', player, now), successDraw: .999, qualityDraw: .999, traceDraw: 1 };
    const admitted = admitResourceAttempt(character, seal, now)!;
    assert.equal(readResourceGathering(admitted.resourceGathering).active?.fishingStyle, 'kunai');
    const shot = { kind: 'throw' as const, at: 900, x: 50, y: 45 };
    for (let n = 0; n < 20; n++) { const p = kunaiFish(kunaiSeed(seal), 0, shot.at + kunaiFlightMs(shot)); shot.x = p.x; shot.y = p.y; }
    const end = now + shot.at + kunaiFlightMs(shot) + 1251;
    assert.equal(resolveResourceAttempt(admitted, seal.id, { events: [shot] }, player, end - 1250, seal).ok, false);
    const result = resolveResourceAttempt(admitted, seal.id, { events: [shot] }, player, end, seal);
    assert.ok(result.ok); if (!result.ok) return;
    assert.equal(result.receipt.outcome, 'success'); assert.equal(result.receipt.xp, 10);
    assert.equal(countOwned(result.character, 'gather-river-fish-fine'), 1);
    assert.equal(resourceActionsToday(result.character, now), 1);
    assert.equal((result.character.gatheringToolUses as Record<string, number>)['tool-basic-fishing-pole'], 1);
    const replay = resolveResourceAttempt(result.character, seal.id, {}, player, end + 1000);
    assert.ok(replay.ok); if (replay.ok) { assert.equal(replay.replayed, true); assert.deepEqual(replay.character, result.character); }
});

test('timeout yields failure XP only; animation mode keeps baseline chance; old sealed casts remain compatible', () => {
    const active = mintResourceSeal(character, node, 'kunai-timeout', 'active', player, now);
    const timeout = resolveResourceAttempt(admitResourceAttempt(character, active, now)!, active.id, { events: [] }, player, now + 18_001, active);
    assert.ok(timeout.ok); if (timeout.ok) { assert.equal(timeout.receipt.outcome, 'failed'); assert.equal(timeout.receipt.xp, 3); assert.equal(timeout.receipt.itemId, undefined); }
    const relaxed = { ...mintResourceSeal(character, node, 'kunai-animation', 'relaxed', player, now), successDraw: .999 };
    const watched = resolveResourceAttempt(admitResourceAttempt(character, relaxed, now)!, relaxed.id, {}, player, now + 3000, relaxed);
    assert.ok(watched.ok); if (watched.ok) assert.equal(watched.receipt.outcome, 'failed');
    const legacy = { ...mintResourceSeal(character, node, 'legacy-cast', 'active', player, now), fishingStyle: undefined, hookAt: 2000, successDraw: 0 };
    const events = [{ kind: 'hook', at: 2000 }, { kind: 'reel', at: 2050 }, { kind: 'release', at: 3350 },
        { kind: 'reel', at: 4050 }, { kind: 'release', at: 5350 }, { kind: 'reel', at: 6050 }, { kind: 'release', at: 7350 }];
    const old = resolveResourceAttempt(admitResourceAttempt(character, legacy, now)!, legacy.id, { events }, player, now + 8500, legacy);
    assert.ok(old.ok); if (old.ok) assert.equal(old.receipt.outcome, 'success');
});

test('an over-level fish grants failure XP only, uses the sealed skill and settles once', () => {
    const novice = { ...character, resourceGathering: { fishingXp: 0 } };
    const seal = { ...mintResourceSeal(novice, node, 'ranked-novice', 'active', player, now), hookAt: 2718, template: 0, successDraw: 0 };
    const admitted = admitResourceAttempt(novice, seal, now)!;
    const shot = { kind: 'throw' as const, at: 1000, x: 50, y: 45 };
    for (let n = 0; n < 20; n++) { const point = kunaiFish(kunaiSeed(seal), 1, shot.at + kunaiFlightMs(shot)); shot.x = point.x; shot.y = point.y; }
    // A newer XP total or forged public level must not change this admitted challenge.
    const changed = { ...admitted, resourceGathering: { ...admitted.resourceGathering, fishingXp: 3200, active: { ...admitted.resourceGathering.active, skillLevel: 10 } } };
    const result = resolveResourceAttempt(changed, seal.id, { events: [shot] }, player, now + shot.at + kunaiFlightMs(shot) + 1251, seal);
    assert.ok(result.ok); if (!result.ok) return;
    assert.equal(result.receipt.outcome, 'failed'); assert.equal(result.receipt.itemId, undefined); assert.equal(result.receipt.xp, 3);
    assert.deepEqual(result.receipt.fishingCatch, { name: 'Bronze Carp', requiredLevel: 4, fisherLevel: 1, tooStrong: true });
    assert.equal(resourceActionsToday(result.character, now), 1);
    assert.equal((result.character.gatheringToolUses as Record<string, number>)['tool-basic-fishing-pole'], 1);
    const replay = resolveResourceAttempt(result.character, seal.id, {}, player, now + 5000, seal);
    assert.ok(replay.ok); if (replay.ok) { assert.equal(replay.replayed, true); assert.deepEqual(replay.receipt, result.receipt); }
});
