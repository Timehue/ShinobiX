import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';

// Anti-tamper coverage for the HollowGate save-sanitizer clamps (forged-save only;
// a legitimate save must pass through unchanged). The sanitizer takes/returns the
// { character, ... } wrapper and returns { ...incoming, character: <sanitized> }.

type Char = Record<string, unknown>;
const wrap = (character: Char) => ({ character });
const sanitize = (incoming: Char, existing: Char | null) =>
    sanitizeCharacterSave(wrap(incoming), existing ? wrap(existing) : null).character as Record<string, any>;

test('attunement: each node clamped to its catalog maxRank; unknown ids dropped', () => {
    const out = sanitize(
        { hollowGateAttunement: { 'extra-dive': 3, 'seasoned-delver': 9, 'key-forge': 2, 'made-up-node': 5 } },
        { hollowGateAttunement: {} },
    );
    assert.equal(out.hollowGateAttunement['extra-dive'], 1, 'extra-dive maxRank 1');
    assert.equal(out.hollowGateAttunement['seasoned-delver'], 2, 'seasoned-delver maxRank 2');
    assert.equal(out.hollowGateAttunement['key-forge'], 1, 'key-forge maxRank 1');
    assert.equal(out.hollowGateAttunement['made-up-node'], undefined, 'unknown node dropped');
});

test('hollowGateRun: a spendable-currency entry above current is preserved (legit mid-run spend not over-penalised)', () => {
    // Hollow Shards are spendable mid-run, so the entry snapshot can legitimately
    // exceed the current balance. The sanitizer must NOT clamp entry down to current
    // (that would over-claw-back on a later reload-path death). floor/keys ARE bounded.
    const out = sanitize(
        { hollowShards: 70, hollowGateRun: { floor: 9999, keys: 9999, entryCurrencies: { hollowShards: 100 } } },
        { hollowShards: 70 },
    );
    assert.equal((out.hollowGateRun as any).entryCurrencies.hollowShards, 100, 'entry shards preserved above current');
    assert.ok((out.hollowGateRun as any).floor <= 50, 'floor bounded');
    assert.ok((out.hollowGateRun as any).keys <= 99, 'keys bounded');
});

test('hollowGateRun: absurd floor / keys clamped to sane ceilings', () => {
    const out = sanitize({ hollowGateRun: { floor: 9999, keys: 9999, entryCurrencies: {} } }, {});
    assert.ok((out.hollowGateRun as any).floor <= 50, 'floor clamped');
    assert.ok((out.hollowGateRun as any).keys <= 99, 'keys clamped');
});

test('hollow-gate-key: per-save GAIN capped above the existing stack', () => {
    const out = sanitize(
        { itemStacks: [{ itemId: 'hollow-gate-key', count: 9999 }] },
        { itemStacks: [{ itemId: 'hollow-gate-key', count: 2 }] },
    );
    const keys = (out.itemStacks as Array<{ itemId: string; count: number }>).find(s => s.itemId === 'hollow-gate-key');
    assert.equal(keys?.count, 12, '2 existing + 10 per-save gain cap');
});

test('legit HollowGate save passes through unchanged', () => {
    const out = sanitize(
        {
            ryo: 5000,
            hollowGateAttunement: { 'greedy-hands': 2 },
            hollowGateRun: { floor: 3, keys: 1, entryCurrencies: { ryo: 4000 } },
            itemStacks: [{ itemId: 'hollow-gate-key', count: 3 }],
        },
        { ryo: 4000, itemStacks: [{ itemId: 'hollow-gate-key', count: 1 }] },
    );
    assert.equal(out.hollowGateAttunement['greedy-hands'], 2, 'legit rank (<= maxRank 3) untouched');
    assert.equal((out.hollowGateRun as any).entryCurrencies.ryo, 4000, 'legit entry snapshot untouched');
    const keys = (out.itemStacks as Array<{ itemId: string; count: number }>).find(s => s.itemId === 'hollow-gate-key');
    assert.equal(keys?.count, 3, 'legit key gain 1->3 within cap, untouched');
});
