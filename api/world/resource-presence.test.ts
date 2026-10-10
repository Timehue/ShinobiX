import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryOnlineStateStore } from '../_realtime/online-store.js';
import { worldPositionModel, CONTINUOUS_WORLD_SPACE } from '../../shared/continuous-world-layout.js';
import { buildWorldNavigation, createWorldWalker } from '../../shared/continuous-world-navigation.js';
import { resourceNode } from '../../shared/resource-nodes.js';
import { readResourceGathering } from '../../shared/resource-gathering.js';
import { admitResourceAttempt, mintResourceSeal, resolveResourceAttempt } from './_resource-gathering.js';

const now = Date.parse('2026-10-09T12:00:00Z');
for (const activity of ['mining', 'fishing'] as const) {
    function fixture() {
        let time = now;
        const store = new MemoryOnlineStateStore({ now: () => time });
        const node = resourceNode(activity === 'mining' ? 'resource-13' : 'resource-1')!;
        const beat = () => store.upsert({ name: activity, sector: node.sector, tile: node.approach, character: null });
        beat(); store.setInBattle(activity, true); store.setInBattle(activity, false);
        const player = store.get(activity)!;
        const character = { name: activity, equipment: { pickaxe: 'tool-basic-pickaxe', fishingPole: 'tool-basic-fishing-pole' },
            gatheringToolUses: { 'tool-basic-pickaxe': 0, 'tool-basic-fishing-pole': 0 }, inventory: [], itemStacks: [] };
        const seal = { ...mintResourceSeal(character, node, `presence-${activity}`, 'relaxed', player, now), successDraw: 0, traceDraw: 1 };
        const admitted = admitResourceAttempt(character, seal, now)!;
        return { store, node, beat, seal, admitted, advance: (ms: number) => { time += ms; } };
    }
    test(`${activity}: ordinary heartbeat and stationary reconnect preserve a nonzero authority seal`, () => {
        const { store, beat, seal, admitted } = fixture();
        assert.equal(seal.authorityEpoch, 1);
        const refreshed = beat();
        assert.equal(refreshed.resourceEpoch, 1);
        const cursor = worldPositionModel().fallback(refreshed.sector, refreshed.tile!)!;
        const reconnected = store.commitWorldPosition(activity, cursor, refreshed.movementSeq ?? 0)!;
        assert.ok(reconnected); assert.equal(reconnected.movementSeq, seal.movementSequence);
        const resolved = resolveResourceAttempt(admitted, seal.id, {}, reconnected, now + 4000, seal);
        assert.ok(resolved.ok); if (!resolved.ok) return;
        assert.equal(resolved.receipt.outcome, 'success'); assert.equal(resolved.receipt.xp, 10);
        assert.equal(readResourceGathering(resolved.character.resourceGathering).attemptsToday, 1);
        assert.equal((resolved.character.gatheringToolUses as Record<string, number>)[activity === 'mining' ? 'tool-basic-pickaxe' : 'tool-basic-fishing-pole'], 1);
    });
    test(`${activity}: fractional walker reconnect retains the canonical cursor without cumulative no-op drift`, () => {
        const { store, node, beat } = fixture(), model = worldPositionModel();
        const original = model.fallback(node.sector, node.approach)!;
        const edge = [-12, -1, 1, 12].map(offset => model.fallback(node.sector, node.approach + offset))
            .filter(Boolean).map(neighbor => ({ ...original, to: neighbor!.from, progress: .1 }))
            .find(candidate => model.read(candidate))!;
        assert.ok(store.commitWorldPosition(activity, edge, 0));
        const player = beat(), canonical = { ...player.worldPosition! }, sequence = player.movementSeq!;
        const graph = buildWorldNavigation(CONTINUOUS_WORLD_SPACE).byId;
        const walker = createWorldWalker(graph, canonical.from); walker.restore(canonical);
        const recovered = walker.cursor(canonical.layoutVersion);
        assert.ok(model.distanceWithin(canonical, recovered, 0) !== null);
        for (let replay = 0; replay < 20; replay++) {
            const tiny = { ...recovered, progress: recovered.progress + replay * 1e-12 };
            const acknowledged = store.commitWorldPosition(activity, tiny, sequence)!;
            assert.ok(acknowledged); assert.equal(acknowledged.movementSeq, sequence);
            assert.deepEqual(acknowledged.worldPosition, canonical);
        }
        const character = { name: activity, equipment: { pickaxe: 'tool-golden-pickaxe', fishingPole: 'tool-golden-fishing-pole' } };
        const seal = { ...mintResourceSeal(character, node, `fractional-resume-${activity}`, 'relaxed', store.get(activity)!, now), successDraw: 0 };
        const admitted = admitResourceAttempt(character, seal, now)!;
        assert.ok(store.commitWorldPosition(activity, recovered, sequence));
        const result = resolveResourceAttempt(admitted, seal.id, {}, store.get(activity), now + 4000, seal);
        assert.ok(result.ok); if (!result.ok) return;
        assert.equal(result.receipt.outcome, 'success');
        assert.ok(store.commitWorldPosition(activity, { ...canonical, progress: canonical.progress + 1e-7 }, sequence));
        assert.equal(store.get(activity)!.movementSeq, sequence + 1, 'a genuine fractional step still invalidates the old seal');
        const moved = resolveResourceAttempt(admitted, seal.id, {}, store.get(activity), now + 4000, seal);
        assert.ok(moved.ok); if (!moved.ok) return; assert.equal(moved.receipt.outcome, 'cancelled');
    });
    for (const interruption of ['battle', 'travel', 'walk', 'expiry'] as const) {
        test(`${activity}: ${interruption} followed by heartbeat cannot revive the old seal or replay rewards`, () => {
            const { store, node, beat, seal, admitted, advance } = fixture();
            if (interruption === 'battle') { store.setInBattle(activity, true); store.setInBattle(activity, false); }
            if (interruption === 'travel') {
                store.startTravel(activity, 0, now); advance(1); store.get(activity);
                store.startTravel(activity, node.sector, now + 1, 0, node.approach); store.get(activity);
            }
            if (interruption === 'walk') {
                const model = worldPositionModel(), original = model.fallback(node.sector, node.approach)!;
                // An actual fractional move remains an interruption even on the same tile.
                const edge = [-12, -1, 1, 12].map(offset => model.fallback(node.sector, node.approach + offset))
                    .filter(Boolean).map(neighbor => ({ ...original, to: neighbor!.from, progress: .1 }))
                    .find(candidate => model.read(candidate));
                assert.ok(edge);
                assert.ok(store.commitWorldPosition(activity, edge!, 0));
                assert.ok(store.commitWorldPosition(activity, original, 1));
            }
            const refreshed = beat();
            const resolved = resolveResourceAttempt(admitted, seal.id, {}, refreshed, now + (interruption === 'expiry' ? 90_000 : 4000), seal);
            assert.ok(resolved.ok); if (!resolved.ok) return;
            assert.equal(resolved.receipt.outcome, interruption === 'expiry' ? 'expired' : 'cancelled');
            assert.equal(resolved.receipt.xp, 0); assert.equal(resolved.receipt.itemId, undefined);
            const state = readResourceGathering(resolved.character.resourceGathering);
            assert.equal(state.attemptsToday, 1); assert.equal(state.nodes[node.id].attempts, 1);
            const replay = resolveResourceAttempt(resolved.character, seal.id, {}, refreshed, now + 5000, seal);
            assert.ok(replay.ok); if (!replay.ok) return;
            assert.equal(replay.replayed, true); assert.deepEqual(replay.character, resolved.character);
        });
    }
}
