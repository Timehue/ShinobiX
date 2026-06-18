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

const TODAY = new Date().toISOString().slice(0, 10); // matches the sanitizer's SERVER_UTC_DATE

test('dailyHollowGateRuns: a forged reset to 0 within the same UTC day is floored to the server count', () => {
    const out = sanitize(
        { lastDailyReset: TODAY, dailyHollowGateRuns: 0 },   // forged: zero the counter to farm more runs
        { lastDailyReset: TODAY, dailyHollowGateRuns: 2 },   // server-stored: already 2 runs today
    );
    assert.equal(out.dailyHollowGateRuns, 2, 'cannot drop below the server-recorded count for today');
});

test('dailyHollowGateRuns: legit same-day increment kept; genuine new-day reset untouched', () => {
    const inc = sanitize(
        { lastDailyReset: TODAY, dailyHollowGateRuns: 3 },
        { lastDailyReset: TODAY, dailyHollowGateRuns: 2 },
    );
    assert.equal(inc.dailyHollowGateRuns, 3, 'legit increment 2->3 kept');
    // existing save was last written on a prior day -> floor is 0, reset is allowed
    const reset = sanitize(
        { lastDailyReset: TODAY, dailyHollowGateRuns: 0 },
        { lastDailyReset: '2000-01-01', dailyHollowGateRuns: 2 },
    );
    assert.equal(reset.dailyHollowGateRuns, 0, 'new-day reset is not clamped');
});

// ── Core anti-tamper clamps ─────────────────────────────────────────────────
// The broadest reward surface in the repo — EVERY player save POST flows through
// sanitizeCharacterSave. These lock the level/ryo/currency caps so a future
// refactor that drops a floor or loosens a cap fails the build, not in prod.

test('level: cannot regress below the existing level (anti-rollback)', () => {
    assert.equal(sanitize({ level: 40 }, { level: 50 }).level, 50, 'a save reporting a lower level is floored to existing');
});

test('level: per-save gain capped at +5 and hard-capped at 100', () => {
    assert.equal(sanitize({ level: 999 }, { level: 50 }).level, 55, 'gain capped to +MAX_LEVEL_GAIN (5)');
    assert.equal(sanitize({ level: 999 }, { level: 98 }).level, 100, 'hard-capped at LEVEL_CAP (100)');
});

test('ryo: per-save gain capped at +1,000,000 over existing', () => {
    assert.equal(sanitize({ ryo: 9_999_999 }, { ryo: 1000 }).ryo, 1_001_000, 'capped to exRyo + MAX_RYO_GAIN');
});

test('soft currencies: per-save gain capped (fateShards +50, honorSeals +200)', () => {
    assert.equal(sanitize({ fateShards: 9999 }, { fateShards: 10 }).fateShards, 60, 'fateShards capped to +50');
    assert.equal(sanitize({ honorSeals: 9999 }, { honorSeals: 5 }).honorSeals, 205, 'honorSeals capped to +200');
});
