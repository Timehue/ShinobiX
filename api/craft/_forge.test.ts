import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyForge, craftPointTotal, countOwned } from './_forge.js';

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

    it('spares Hunter rank-up materials from the craft burn while fodder covers the cost', () => {
        // 7x torn-hide (3pts = 21, non-protected) + 5x beast-meat (a rank-up material).
        const char = {
            level: 100, ryo: 0,
            inventory: [...Array(7).fill('hunt-torn-hide'), ...Array(5).fill('hunt-beast-meat')],
            itemStacks: [],
        };
        const out = applyForge(char, 'supply', 'item-attack-pill', 1)!; // 20 pts — fodder alone covers it
        assert.equal(countOwned(out, 'hunt-beast-meat'), 5, 'rank-up material untouched');
        assert.equal(countOwned(out, 'hunt-torn-hide'), 0, 'fodder burned first');
    });

    it('still dips into rank-up materials (cheapest-first) when fodder cannot cover the cost', () => {
        // 2x torn-hide (6pts) can't cover 20; the burn falls through to beast-meat (5pts).
        const char = {
            level: 100, ryo: 0,
            inventory: [...Array(2).fill('hunt-torn-hide'), ...Array(5).fill('hunt-beast-meat')],
            itemStacks: [],
        };
        const out = applyForge(char, 'supply', 'item-attack-pill', 1)!; // 20 pts
        assert.equal(countOwned(out, 'hunt-torn-hide'), 0, 'fodder spent first');
        assert.equal(countOwned(out, 'hunt-beast-meat'), 2, 'dipped into 3 rank-up mats to finish paying'); // 6 + 3×5 = 21 ≥ 20
    });
});
