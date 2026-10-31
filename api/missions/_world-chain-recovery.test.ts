import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyWorldAiFightSettlement, clearCompletedWorldAiPendingChain } from './_world-ai-fight.js';
import { mergePreservingImages } from '../_utils.js';
import type { WorldAiFightContext } from '../../shared/world-ai-fight.js';

const context: WorldAiFightContext = {
    kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 60,
    chainId: 'recovery_chain', stage: 3, finalStage: true, displayName: 'Road Bandit',
};
const pending = { request: { kind: context.kind, sourceId: context.sourceId, sector: 60, chainId: context.chainId, stage: 3 }, displayName: 'Road Bandit', createdAt: 1 };
const wins = Array.from({ length: 4 }, (_, stage) => ({ ...context, stage, id: `recovery_chain:${stage}`, proofId: `proof_${stage}` }));

for (const outcome of ['win', 'loss', 'draw', 'forfeit'] as const) {
    test(`terminal ambush ${outcome} stays cleared through the production save merge`, () => {
        const before = { robberStreak: 5, worldAiPendingChain: pending, worldAiChainWins: wins.slice(0, 3) };
        const after = applyWorldAiFightSettlement(before, context, outcome, 'final_proof');
        const persisted = mergePreservingImages({ character: after }, { character: before }) as { character: Record<string, unknown> };
        assert.equal(persisted.character.worldAiPendingChain, null);
        assert.equal(persisted.character.robberStreak, 0);
        if (outcome === 'win') assert.ok(persisted.character.worldAiPendingOutcome, 'unpaid reward survives');
    });
}

test('terminal settlement does not clear another chain', () => {
    const other = { ...pending, request: { ...pending.request, chainId: 'another_chain' } };
    const after = applyWorldAiFightSettlement({ worldAiPendingChain: other }, context, 'loss', 'proof');
    assert.deepEqual(after.worldAiPendingChain, other);
});

test('old completed ambush handoff repairs without changing rewards, receipts or proofs', () => {
    const before = { worldAiPendingChain: pending, worldAiChainWins: wins, robberStreak: 0,
        worldAiPendingOutcome: { kind: 'wanderer-ambush-reward', chainId: context.chainId },
        redeemedWandererAmbushes: ['previous-claim'], ryo: 777 };
    const repaired = clearCompletedWorldAiPendingChain(before);
    assert.deepEqual(repaired, { ...before, worldAiPendingChain: null });
    assert.equal(clearCompletedWorldAiPendingChain(repaired), repaired, 'idempotent');
    assert.deepEqual(mergePreservingImages(repaired, before), repaired, 'repair persists');
});

test('incomplete and incorrectly bound proof sets never authorize recovery', () => {
    for (const proofSet of [wins.slice(0, 3), wins.slice(1),
        wins.map(w => ({ ...w, chainId: 'another_chain' })),
        wins.map(w => ({ ...w, sector: 59 })),
        wins.map(w => ({ ...w, sourceId: 'another-source' })),
        wins.map(w => ({ ...w, kind: 'hunt-pack' })),
    ]) {
        const before = { worldAiPendingChain: pending, worldAiChainWins: proofSet, robberStreak: 0 };
        assert.equal(clearCompletedWorldAiPendingChain(before), before);
    }
});

test('completed hunt pack requires all three exact stage proofs', () => {
    const pack = { ...pending, request: { ...pending.request, kind: 'hunt-pack', sourceId: 'hunt-wild-boar', decisionId: 'decision_123', stage: 2 } };
    const proofSet = wins.slice(0, 3).map(w => ({ ...w, kind: 'hunt-pack', sourceId: 'hunt-wild-boar' }));
    const before = { worldAiPendingChain: pack, worldAiChainWins: proofSet };
    assert.deepEqual(clearCompletedWorldAiPendingChain(before), { ...before, worldAiPendingChain: null });
});
