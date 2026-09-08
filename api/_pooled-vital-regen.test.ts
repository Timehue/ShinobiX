process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REGEN_FULL_BAR_SEC, VITAL_REGEN_MS, settleVitalsRegen, vitalRegenPerTick } from './_elapsed-state.js';
import { sanitizeCharacterSave } from './save/[name].js';

/*
 * F1(B): idle recovery is a share of each POOL, not a flat 1 point shared by all
 * three vitals.
 *
 * The flat rate was tuned for the ~100-point pools of the early game. The v2
 * curve took them to 10,000 (HP_CAP / CHAKRA_CAP_V2 / STAMINA_CAP_V2), so a full
 * bar at level 100 took 2h46m and resting was dead content for most of the level
 * range — which is what made a free 60-second hospital discharge the fastest
 * restore in the game.
 *
 * Two properties matter and both are pinned here: nobody regenerates SLOWER than
 * before, and the autosave gain ceiling in the save validator allows exactly what
 * this file settles. If those two drift, a high-level player's bars visibly fall
 * on every save — worse than the bug being fixed.
 */

const NOW = 1_800_000_000_000;

function record(character: Record<string, unknown>, agoSec: number) {
    return {
        _saveAt: NOW - agoSec * 1000,
        _regenAt: NOW - agoSec * 1000,
        character: { name: 'restsubject', level: 100, ...character },
    };
}

describe('vitalRegenPerTick', () => {
    it('never regenerates slower than the old flat rate', () => {
        for (const pool of [1, 50, 100, 500, 1_800, 3_600, 10_000]) {
            assert.ok(vitalRegenPerTick(pool) >= 1, `pool ${pool} must not fall below 1/sec`);
        }
        assert.equal(vitalRegenPerTick(100), 1, 'an early-game pool keeps exactly the old rate');
    });

    it('refills any pool in REGEN_FULL_BAR_SEC', () => {
        for (const pool of [1_800, 5_000, 10_000]) {
            const seconds = pool / vitalRegenPerTick(pool);
            assert.ok(seconds <= REGEN_FULL_BAR_SEC, `pool ${pool} refills in ${seconds}s, over the ${REGEN_FULL_BAR_SEC}s budget`);
        }
        assert.equal(vitalRegenPerTick(10_000), 6, 'a maxed pool moves 6/sec, not 1');
    });

    it('adds the Aura Sphere bonus on top rather than replacing the pooled rate', () => {
        assert.equal(vitalRegenPerTick(10_000, 2), 8);
        assert.equal(vitalRegenPerTick(100, 2), 3);
    });

    it('falls back to the flat rate when the kill switch is thrown', () => {
        assert.equal(vitalRegenPerTick(10_000, 0, false), 1, 'DISABLE_POOLED_VITAL_REGEN restores the old behaviour exactly');
        assert.equal(vitalRegenPerTick(10_000, 2, false), 3);
    });
});

describe('settleVitalsRegen — per-pool', () => {
    it('recovers a maxed-out character in well under the old 2h46m', () => {
        const out = settleVitalsRegen(
            record({ hp: 0, maxHp: 10_000, chakra: 0, maxChakra: 10_000, stamina: 0, maxStamina: 10_000 }, REGEN_FULL_BAR_SEC),
            { now: NOW, battleLocked: false },
        );
        const char = out.record.character as unknown as Record<string, number>;
        assert.equal(out.changed, true);
        assert.equal(char.hp, 10_000, 'a full 30-minute rest refills the bar');
        assert.equal(char.chakra, 10_000);
        assert.equal(char.stamina, 10_000);
    });

    it('leaves an early-game character on exactly the old rate', () => {
        const out = settleVitalsRegen(
            record({ level: 1, hp: 0, maxHp: 100, chakra: 0, maxChakra: 100, stamina: 0, maxStamina: 100 }, 30),
            { now: NOW, battleLocked: false },
        );
        const char = out.record.character as unknown as Record<string, number>;
        assert.equal(char.hp, 30, '30 seconds still buys 30 points at level 1');
    });

    it('scales each vital to its OWN pool when the pools differ', () => {
        const out = settleVitalsRegen(
            record({ hp: 0, maxHp: 10_000, chakra: 0, maxChakra: 1_800, stamina: 0, maxStamina: 100 }, 10),
            { now: NOW, battleLocked: false },
        );
        const char = out.record.character as unknown as Record<string, number>;
        assert.equal(char.hp, 60, 'the 10,000 pool moves 6/sec');
        assert.equal(char.chakra, 10, 'the 1,800 pool moves 1/sec');
        assert.equal(char.stamina, 10, 'the small pool keeps the floor of 1/sec');
    });

    it('still refuses to regenerate an admitted character', () => {
        const out = settleVitalsRegen(
            record({ hp: 0, maxHp: 10_000, chakra: 0, maxChakra: 10_000, stamina: 0, maxStamina: 10_000, hospitalized: true }, 600),
            { now: NOW, battleLocked: false },
        );
        assert.equal(out.excluded, true, 'the hospital still suspends recovery');
        assert.equal(out.changed, false);
    });

    it('advances by whole ticks only, so equal elapsed time yields equal recovery', () => {
        const once = settleVitalsRegen(
            record({ hp: 0, maxHp: 10_000, chakra: 0, maxChakra: 10_000, stamina: 0, maxStamina: 10_000 }, 20),
            { now: NOW, battleLocked: false },
        );
        assert.equal((once.record.character as unknown as Record<string, number>).hp, 20 * 6);
        assert.equal(once.cursor, NOW - 20_000 + 20 * VITAL_REGEN_MS);
    });
});

describe('the autosave gain ceiling mirrors the settled rate', () => {
    // If these drift, a high-level player regenerates server-side and then has
    // the value clamped back down on their next save — bars falling on screen.
    const stored = (over: Record<string, unknown> = {}) => ({
        _saveAt: NOW - 60_000,
        character: {
            name: 'ceilingsubject', level: 100, village: 'Mist',
            hp: 0, maxHp: 10_000, chakra: 0, maxChakra: 10_000, stamina: 0, maxStamina: 10_000,
            inventory: [], itemStacks: [], stats: {}, ...over,
        },
    });

    it('accepts a full 60 seconds of pooled regeneration', () => {
        // 60s x 6/sec = 360 per vital, which the old flat ceiling (60) would have
        // clamped to 60 — the exact "my chakra went backwards" failure.
        const incoming = stored({ hp: 360, chakra: 360, stamina: 360 });
        const out = sanitizeCharacterSave(incoming, stored(), { now: NOW });
        const char = out.character as unknown as Record<string, number>;
        assert.equal(char.hp, 360, 'legitimately regenerated HP survives the ceiling');
        assert.equal(char.chakra, 360);
        assert.equal(char.stamina, 360);
    });

    it('still clamps a gain the elapsed time cannot explain', () => {
        const incoming = stored({ hp: 9_999, chakra: 9_999, stamina: 9_999 });
        const out = sanitizeCharacterSave(incoming, stored(), { now: NOW });
        const char = out.character as unknown as Record<string, number>;
        assert.ok(char.hp < 9_999, 'a forged full heal is still refused');
        assert.ok(char.hp >= 360, 'but the honest part of the gain is kept');
    });
});
