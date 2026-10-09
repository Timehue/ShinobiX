import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_NODES, validResourceNodeTerrain, resourceNode } from '../../shared/resource-nodes.js';
import { resourceActionsToday, readResourceGathering } from '../../shared/resource-gathering.js';
import { admitResourceAttempt, resolveResourceAttempt, mintResourceSeal, resourceAdmissionError, equipGatheringTool } from './_resource-gathering.js';
import type { OnlinePlayer } from '../_realtime/types.js';
import { countOwned, applyForge } from '../craft/_forge.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { applyCookRecipe, cookRecipe } from '../player/_cafeteria.js';
import { purchaseCatalogItem } from '../shop/_purchase.js';
const now = Date.parse('2026-10-07T12:00:00Z');
const node = resourceNode('resource-17')!;
const player: OnlinePlayer = { name: 'miner', displayName: 'Miner', sector: node.sector, tile: node.approach, lastSeenAt: now, connectedAt: now, pendingAttacker: null, character: null, movementSeq: 4 };
const base = () => ({ name: 'miner', level: 100, ryo: 999999, fateShards: 500, inventory: [] as string[], itemStacks: [] as { itemId: string; count: number }[], equipment: { pickaxe: 'tool-golden-pickaxe' } });
test('all 24 nodes have valid water/rock targets and walkable adjacent approaches', () => {
    assert.equal(RESOURCE_NODES.length, 24);
    assert.equal(new Set(RESOURCE_NODES.map(n => n.id)).size, 24);
    for (const n of RESOURCE_NODES) {
        assert.ok(validResourceNodeTerrain(n), n.id);
        const distance = Math.abs(n.target % 12 - n.approach % 12) + Math.abs(Math.floor(n.target / 12) - Math.floor(n.approach / 12));
        assert.equal(distance, 1, n.id);
    }
});
test('failed and cancelled attempts spend the shared allowance and all three charges', () => {
    let c: Record<string, unknown> = { ...base(), serverExploreDate: '2026-10-07', serverExploresToday: 97 };
    for (let i = 0; i < 3; i++) {
        const seal = { ...mintResourceSeal(c, node, `attempt-number-${i}`, 'active', player, now + i * 5000), successDraw: .999 };
        c = admitResourceAttempt(c, seal, now + i * 5000)!;
        assert.equal(resourceActionsToday(c, now), 98 + i);
        const result = resolveResourceAttempt(c, seal.id, i === 1 ? { cancel: true } : { placements: [0, 1] }, player, now + i * 5000 + 3000, seal);
        assert.ok(result.ok); if (!result.ok) return;
        assert.equal(result.receipt.outcome, i === 1 ? 'cancelled' : 'failed'); c = result.character;
    }
    assert.equal(readResourceGathering(c.resourceGathering).miningXp, 6);
    assert.equal(readResourceGathering(c.resourceGathering).nodes[node.id].attempts, 3);
    assert.match(resourceAdmissionError(c, node, now)!, /100/);
});
test('resolution replay pays once and a level-up only improves the next attempt', () => {
    const c = { ...base(), resourceGathering: { miningXp: 99 } };
    const seal = { ...mintResourceSeal(c, node, 'one-successful-attempt', 'active', player, now), successDraw: 0, qualityDraw: .999 };
    const admitted = admitResourceAttempt(c, seal, now)!;
    const result = resolveResourceAttempt(admitted, seal.id, { placements: [0, 1] }, player, now + 5000, seal);
    assert.ok(result.ok); if (!result.ok) return;
    assert.equal(result.receipt.grade, 0);
    assert.equal(countOwned(result.character, 'gather-iron-sand'), 1);
    assert.equal(readResourceGathering(result.character.resourceGathering).miningXp, 109);
    assert.equal(readResourceGathering(result.character.resourceGathering).fishingXp, 0);
    const replay = resolveResourceAttempt(result.character, seal.id, { placements: [2, 3] }, player, now + 6000);
    assert.ok(replay.ok); if (!replay.ok) return;
    assert.equal(replay.replayed, true); assert.equal(replay.character, result.character);
    assert.equal(mintResourceSeal(result.character, node, 'another-attempt', 'active', player, now).skillLevel, 2);
});
test('movement, battle epoch and expiry close attempts without items or XP', () => {
    for (const [changed, at] of [[{ ...player, movementSeq: 6 }, now + 5000], [{ ...player, resourceEpoch: 1 }, now + 5000], [player, now + 90_000]] as const) {
        const seal = { ...mintResourceSeal(base(), node, 'interrupted-attempt', 'relaxed', player, now), successDraw: 0 };
        const c = admitResourceAttempt(base(), seal, now)!;
        const resolved = resolveResourceAttempt(c, seal.id, {}, changed, at, seal);
        assert.ok(resolved.ok); if (!resolved.ok) return;
        assert.equal(resolved.receipt.xp, 0); assert.equal(resolved.receipt.itemId, undefined);
        assert.equal(resourceActionsToday(resolved.character, now), 1);
    }
});

test('admitted difficulty, grade ceiling and reward family survive a node configuration change', () => {
    const character = { ...base(), resourceGathering: { miningXp: 3200 } };
    const formerNode = { ...node, difficulty: 7 as const, ceiling: 3 as const, family: 'gather-ember-ore' as const };
    for (const draw of [0, .9]) {
        const seal = { ...mintResourceSeal(character, formerNode, `sealed-rules-${draw}`, 'relaxed', player, now), successDraw: draw, qualityDraw: .999 };
        const admitted = admitResourceAttempt(character, seal, now)!;
        // The live node definition is a basic Iron Sand seam; this admitted
        // attempt must still use its former master-tier Ember Ore settings.
        const result = resolveResourceAttempt(admitted, seal.id, {}, player, now + 4000, seal);
        assert.ok(result.ok); if (!result.ok) return;
        assert.equal(result.receipt.outcome, draw === 0 ? 'success' : 'failed');
        assert.equal(result.receipt.itemId, draw === 0 ? 'gather-ember-ore-pristine' : undefined);
    }
});
test('gold tools cost exactly 50 shards with trade focus and equipped duplicates cannot be purchased', () => {
    const purchased = purchaseCatalogItem({ ...base(), equipment: {}, elderFocus: 'trade' }, 'tool-golden-pickaxe', 1);
    assert.ok(purchased.ok); if (!purchased.ok) return;
    assert.equal(purchased.item.totalCost, 50);
    const equipped = equipGatheringTool(purchased.character, 'tool-golden-pickaxe', false)!;
    assert.equal(countOwned(equipped, 'tool-golden-pickaxe'), 0);
    assert.equal(purchaseCatalogItem(equipped, 'tool-golden-pickaxe', 1).ok, false);
});

test('public attempts hide reward rolls and missing or mismatched journals cannot grant rewards', () => {
    const seal = { ...mintResourceSeal(base(), node, 'private-reward-rolls', 'relaxed', player, now), successDraw: 0 };
    const admitted = admitResourceAttempt(base(), seal, now)!;
    const publicAttempt = readResourceGathering(admitted.resourceGathering).active!;
    for (const key of ['successDraw', 'qualityDraw', 'traceDraw', 'rules', 'authorityEpoch'])
        assert.equal(Object.hasOwn(publicAttempt, key), false, key);
    for (const unavailable of [undefined, { ...seal, id: 'another-attempt-id' }]) {
        const refused = resolveResourceAttempt(admitted, seal.id, {}, player, now + 4000, unavailable);
        assert.equal(refused.ok, false);
    }
    const cancelled = resolveResourceAttempt(admitted, seal.id, { cancel: true }, player, now + 4000);
    assert.ok(cancelled.ok); if (!cancelled.ok) return;
    assert.equal(cancelled.receipt.outcome, 'cancelled'); assert.equal(cancelled.receipt.xp, 0);
    assert.equal(cancelled.receipt.itemId, undefined);
    const expired = resolveResourceAttempt(admitted, seal.id, {}, player, now + 90_000);
    assert.ok(expired.ok); if (!expired.ok) return;
    assert.equal(expired.receipt.outcome, 'expired'); assert.equal(expired.receipt.xp, 0);
});
test('weapons require their ore grade; high-grade fish uses five units and respects output cap', () => {
    const weapon = Object.values(ITEM_CATALOG).find(item => item.rarity === 'epic' && item.slot === 'hand' && item.weaponEp != null && !item.id.startsWith('named-') && !item.id.includes('step'))!;
    const c = { ...base(), itemStacks: [{ itemId: 'hunt-torn-hide', count: 2000 }, { itemId: 'gather-iron-sand-fine', count: 100 },
        { itemId: 'gather-heartwood-bark', count: 2 }, { itemId: 'gather-binding-fiber', count: 6 }, { itemId: 'gather-stormglass-shard-fine', count: 1 }] };
    assert.equal(applyForge(c, 'weapon', weapon.id, 1), null);
    const forged = applyForge({ ...c, itemStacks: [...c.itemStacks, { itemId: 'gather-iron-sand-superior', count: 18 }] }, 'weapon', weapon.id, 1);
    assert.ok(forged); assert.equal(countOwned(forged!, 'gather-iron-sand-superior'), 0);
    const recipe = cookRecipe('fish-rations-pristine')!;
    const kitchen = { ...base(), itemStacks: [{ itemId: 'gather-river-fish-pristine', count: 10 }, { itemId: 'gather-field-herb', count: 2 }, { itemId: 'gather-heartwood-bark', count: 2 }] };
    const cook = applyCookRecipe(kitchen, recipe, now); assert.ok(cook.ok); if (!cook.ok) return;
    assert.equal(cook.cooked, 20); assert.equal(countOwned(cook.character, 'gather-river-fish-pristine'), 5);
    const twice = applyCookRecipe(cook.character, recipe, now); assert.ok(twice.ok); if (!twice.ok) return;
    assert.equal(twice.dailyCooked, 40); assert.equal(applyCookRecipe(twice.character, recipe, now).ok, false);
});
