import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyAiFightOutcomeToCharacter,
    sessionUsesContinuousVitals,
    type AiFightPlayerCombatant,
} from './_ai-fight-outcome.js';
import { isOpenWorldBattleKind } from './_ai-fight-token.js';

/*
 * Open-world combat is CONTINUOUS (owner ruling, 2026-09-08): you fight with the
 * HP, chakra and stamina you actually have, and you are put back in your spot
 * with whatever is left. Instanced and consensual content stays FRESH-START.
 *
 * ⚠ The rule is a PAIR and neither half is safe alone:
 *   • SEED  (api/solo-pve/_ai-encounter.ts) — a continuous encounter seeds the
 *     actor from currentChakra/currentStamina instead of the full pool.
 *   • SETTLE (this helper) — carries those back ONLY for a continuous encounter.
 *
 * Carrying vitals back out of a FRESH-START pool is a faucet, not a cost: enter
 * at 10% chakra, fight on a free full bar, finish at 60%, bank the 60%. That was
 * shipped on 2026-09-08 and reverted the same day, which is why the fresh-start
 * cases below are pinned as hard as the continuous ones.
 */

const actor = (over: Record<string, unknown> = {}) => ({
    hp: 400, maxHp: 1_000,
    chakra: 120, maxChakra: 2_000,
    stamina: 300, maxStamina: 2_000,
    ...over,
} as unknown as AiFightPlayerCombatant);

const character = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'fieldworker', level: 40,
    hp: 1_000, maxHp: 1_000,
    chakra: 2_000, maxChakra: 2_000,
    stamina: 2_000, maxStamina: 2_000,
    ...over,
});

const NOW = 1_800_000_000_000;
const CONTINUOUS = true;

describe('open-world combat settles continuously', () => {
    it('puts the player back with the HP, chakra and stamina the fight left them', () => {
        const out = applyAiFightOutcomeToCharacter(character(), 'win', actor(), NOW, CONTINUOUS);
        assert.equal(out.hp, 400);
        assert.equal(out.chakra, 120, 'chakra spent in the open world stays spent');
        assert.equal(out.stamina, 300);
    });

    it('holds on a loss, alongside the admission', () => {
        const out = applyAiFightOutcomeToCharacter(character(), 'loss', actor({ hp: 0 }), NOW, CONTINUOUS);
        assert.equal(out.hp, 0);
        assert.equal(out.hospitalized, true);
        assert.equal(out.chakra, 120);
    });
});

describe('instanced and practice fights stay fresh-start', () => {
    it('does NOT write chakra or stamina without the continuity flag', () => {
        const out = applyAiFightOutcomeToCharacter(character(), 'win', actor(), NOW);
        assert.equal(out.hp, 400, 'HP is seeded from currentHp everywhere, so it is always carried');
        assert.equal(out.chakra, 2_000, 'the stored value stands');
        assert.equal(out.stamina, 2_000);
    });

    it('is the case that makes the faucet obvious', () => {
        // A nearly-empty player in a fresh-start mode. The actor was handed a
        // full pool, so its 1,200 remainder says nothing about this player.
        const out = applyAiFightOutcomeToCharacter(
            character({ chakra: 100, stamina: 100 }), 'win', actor({ chakra: 1_200, stamina: 1_200 }), NOW,
        );
        assert.equal(out.chakra, 100, 'fighting must never be a way to GAIN chakra');
        assert.equal(out.stamina, 100);
    });
});

describe('the carry-back can only ever cost, never mint', () => {
    it('clamps decrease-only even when flagged continuous', () => {
        // Second line of defence: if an encounter were ever mislabelled, the
        // worst case is that a player is charged, never that vitals are minted.
        const out = applyAiFightOutcomeToCharacter(
            character({ chakra: 100, stamina: 100 }), 'win', actor({ chakra: 1_900, stamina: 1_900 }), NOW, CONTINUOUS,
        );
        assert.equal(out.chakra, 100, 'a mislabelled encounter cannot mint chakra');
        assert.equal(out.stamina, 100);
    });

    it('treats an unmodelled or non-numeric vital as no evidence', () => {
        const out = applyAiFightOutcomeToCharacter(
            character(), 'win', { hp: 400, chakra: null } as unknown as AiFightPlayerCombatant, NOW, CONTINUOUS,
        );
        assert.equal(out.chakra, 2_000, 'Number(null) is 0 — it must not read as "spent it all"');
        assert.equal(out.stamina, 2_000);
    });

    it('never writes a negative vital', () => {
        const out = applyAiFightOutcomeToCharacter(character(), 'win', actor({ chakra: -5 }), NOW, CONTINUOUS);
        assert.equal(out.chakra, 0);
    });

    it('still leaves the character untouched with no actor, or an unresolved outcome', () => {
        const before = character();
        assert.deepEqual(applyAiFightOutcomeToCharacter(before, 'win', undefined, NOW, CONTINUOUS), before);
        assert.deepEqual(applyAiFightOutcomeToCharacter(before, 'unknown', actor(), NOW, CONTINUOUS), before);
    });
});

describe('which fights are open-world', () => {
    it('includes the ones a player meets in the world', () => {
        for (const kind of ['explore', 'world', 'mission', 'defense', 'raidAi']) {
            assert.equal(isOpenWorldBattleKind(kind), true, `${kind} is open-world`);
        }
    });

    it('excludes instanced runs and consensual practice', () => {
        for (const kind of ['practice', 'dungeon', 'endless']) {
            assert.equal(isOpenWorldBattleKind(kind), false, `${kind} hands the fighter a fresh pool`);
        }
        assert.equal(isOpenWorldBattleKind(undefined), false);
        assert.equal(isOpenWorldBattleKind('nonsense'), false);
    });
});

describe('the flag survives storage on the session', () => {
    it('reads back off the stored encounter, not off a request field', () => {
        assert.equal(sessionUsesContinuousVitals({ encounter: { metadata: { continuousVitals: true } } }), true);
        assert.equal(sessionUsesContinuousVitals({ encounter: { metadata: { sector: 4 } } }), false);
        assert.equal(sessionUsesContinuousVitals({ encounter: {} }), false);
        assert.equal(sessionUsesContinuousVitals(null), false, 'a lapsed session settles fresh-start, never continuous');
    });
});
