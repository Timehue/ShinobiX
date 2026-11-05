import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

test('generic client saves cannot reset, forge or remove independent gathering counters', async () => {
    const { sanitizeCharacterSave } = await import('./[name].js');
    const resourceGathering = { date: '2026-11-03', miningAttemptsToday: 50, fishingAttemptsToday: 49,
        attemptsToday: 99, miningXp: 700, fishingXp: 450, nodes: {}, receipts: [] };
    const stored = { character: { resourceGathering } };
    for (const incoming of [undefined, {}, { ...resourceGathering, miningAttemptsToday: 0, fishingAttemptsToday: 0 },
        { ...resourceGathering, date: '2026-11-04', miningXp: 99999 }]) {
        const result = sanitizeCharacterSave({ character: { resourceGathering: incoming } }, stored);
        assert.deepEqual((result.character as Record<string, unknown>).resourceGathering, resourceGathering);
    }
    const absent = sanitizeCharacterSave({ character: { resourceGathering } }, { character: {} });
    assert.equal((absent.character as Record<string, unknown>).resourceGathering, undefined);
});
