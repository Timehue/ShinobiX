import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EXPLORE_BATTLE_AUTHORITY_TTL_MS, exploreBattleMarkerKey } from '../missions/_generic-ai-fight-authority.js';
import { unresolvedExploreBattle } from './_pending-battle.js';

const NOW = 1_800_000_000_000;

function receipt(id: string, kind: 'battle' | 'chest' | 'none', at: number, sector = 12) {
    return { id, sector, reward: { sector, xp: 1, ryo: 0 }, outcome: { kind }, at };
}

describe('unresolvedExploreBattle — an ambush is an obligation', () => {
    it('names the newest unstarted battle receipt inside the authority window', async () => {
        const receipts = [receipt('old-battle-0001', 'battle', NOW - 60_000), receipt('quiet-0000000', 'none', NOW - 30_000), receipt('new-battle-0002', 'battle', NOW - 10_000)];
        const reads: string[] = [];
        const pending = await unresolvedExploreBattle('rill', receipts, NOW, { get: async (key) => { reads.push(key); return null; } });
        assert.deepEqual(pending, { requestId: 'new-battle-0002', sector: 12, at: NOW - 10_000 });
        assert.deepEqual(reads, [exploreBattleMarkerKey('rill', 'new-battle-0002')], 'one marker read, for the newest only');
    });

    it('is satisfied once the fight was started (marker claimed), even if it later ended', async () => {
        const receipts = [receipt('battle-000000001', 'battle', NOW - 10_000)];
        const pending = await unresolvedExploreBattle('rill', receipts, NOW, { get: async () => ({ token: 'x', sessionId: 'y' }) });
        assert.equal(pending, null);
    });

    it('ignores receipts outside the fight-start authority window and non-battle outcomes', async () => {
        const stale = [receipt('battle-000000001', 'battle', NOW - EXPLORE_BATTLE_AUTHORITY_TTL_MS - 1)];
        assert.equal(await unresolvedExploreBattle('rill', stale, NOW, { get: async () => null }), null);
        const chest = [receipt('chest-0000000001', 'chest', NOW - 1_000)];
        assert.equal(await unresolvedExploreBattle('rill', chest, NOW, { get: async () => null }), null);
        assert.equal(await unresolvedExploreBattle('rill', [], NOW, { get: async () => null }), null);
    });
});
