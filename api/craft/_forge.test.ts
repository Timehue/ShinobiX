import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyForge, craftPointTotal } from './_forge.js';

describe('server Crafter forge', () => {
    const base = { level: 100, ryo: 10_000, inventory: ['hunt-torn-hide', 'hunt-torn-hide'], itemStacks: [{ itemId: 'weekly-boss-core', count: 10 }] };
    it('consumes the canonical material pool and grants supplies', () => {
        const out = applyForge(base, 'supply', 'pet-treat', 2)!;
        assert.equal(craftPointTotal(out), craftPointTotal(base) - 156); // cheapest-first discrete materials overspend the 100-point bill like the client
        assert.deepEqual((out.itemStacks as any[])?.find((s: any) => s.itemId === 'pet-treat'), { itemId: 'pet-treat', count: 2 });
    });
    it('rejects unknown recipes and grants only canonical built-in weapons', () => {
        assert.equal(applyForge(base, 'weapon', 'forged-client-item', 1), null);
        const out = applyForge(base, 'weapon', 'ashen-leaf-saber', 1)!;
        assert.equal(out.ryo, 9400);
        assert.ok((out.inventory as string[]).includes('ashen-leaf-saber'));
    });
    it('converts exactly five fragments into one relic', () => {
        const out = applyForge({ itemStacks: [{ itemId: 'dungeon-legendary-fragment', count: 6 }] }, 'relic', 'dungeon-legendary-relic', 1)!;
        assert.equal((out.itemStacks as any[]).find((s: any) => s.itemId === 'dungeon-legendary-fragment').count, 1);
        assert.equal((out.itemStacks as any[]).find((s: any) => s.itemId === 'dungeon-legendary-relic').count, 1);
    });
});
