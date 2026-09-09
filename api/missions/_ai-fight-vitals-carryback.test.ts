import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyAiFightOutcomeToCharacter, type AiFightPlayerCombatant } from './_ai-fight-outcome.js';

/*
 * PvE settlement carries the fight's CHAKRA and STAMINA back, not just its HP.
 *
 * Why this exists: F1 made the hospital treat injury only, so chakra and stamina
 * spent losing a fight now have to be rested off or bought back at the Cafeteria.
 * That rule was PvP-only by accident. `applyPvpVitalsToCharacter` writes the
 * spend for a PvP fight, but this helper wrote HP alone and left chakra/stamina
 * at the values the SAVE already held — which are the pre-fight ones, because its
 * input is the stored character, not the client's post-fight copy. The client
 * then ADOPTS the returned character (lib/ai-fight-settle.ts), so the server's
 * value wins and a mission fight silently refunded everything it cost.
 *
 * The sealed actor is the authoritative record of what the fight burned — both
 * TowerActor and PvpFighter carry hp/chakra/stamina — so settlement reads it for
 * all three, exactly as PvP does.
 */

const actor = (over: Record<string, unknown> = {}) => ({
    hp: 400, maxHp: 1_000,
    chakra: 120, maxChakra: 2_000,
    stamina: 300, maxStamina: 2_000,
    ...over,
} as unknown as AiFightPlayerCombatant);

const character = (over: Record<string, unknown> = {}) => ({
    name: 'fieldworker', level: 40,
    hp: 1_000, maxHp: 1_000,
    chakra: 2_000, maxChakra: 2_000,
    stamina: 2_000, maxStamina: 2_000,
    ...over,
});

const NOW = 1_800_000_000_000;

describe('PvE settlement carries the fight cost back', () => {
    it('persists the chakra and stamina the fight actually burned', () => {
        const out = applyAiFightOutcomeToCharacter(character(), 'win', actor(), NOW);
        assert.equal(out.hp, 400, 'HP was already carried back');
        assert.equal(out.chakra, 120, 'chakra spent winning must not be refunded');
        assert.equal(out.stamina, 300, 'nor stamina');
    });

    it('carries the cost back on a loss too, alongside the admission', () => {
        const out = applyAiFightOutcomeToCharacter(character(), 'loss', actor({ hp: 0 }), NOW);
        assert.equal(out.hp, 0);
        assert.equal(out.hospitalized, true);
        assert.equal(out.chakra, 120, 'a defeat is exactly where the refund used to happen');
        assert.equal(out.stamina, 300);
    });

    it('clamps to the SAVE\'s own maxima, never the sealed session\'s', () => {
        // A session sealed before gear or a level changed the pool must not be
        // able to set a vital above the real ceiling — the same rule HP follows.
        const out = applyAiFightOutcomeToCharacter(
            character({ maxChakra: 50, maxStamina: 50 }),
            'win',
            actor({ chakra: 9_999, stamina: 9_999 }),
            NOW,
        );
        assert.equal(out.chakra, 50);
        assert.equal(out.stamina, 50);
    });

    it('never writes a negative vital', () => {
        const out = applyAiFightOutcomeToCharacter(character(), 'win', actor({ chakra: -5, stamina: -5 }), NOW);
        assert.equal(out.chakra, 0);
        assert.equal(out.stamina, 0);
    });

    it('leaves the character untouched when there is no actor to read', () => {
        // No evidence of what the fight cost — guessing is worse than doing
        // nothing, and this guard predates the change.
        const before = character();
        assert.deepEqual(applyAiFightOutcomeToCharacter(before, 'win', undefined, NOW), before);
        assert.deepEqual(applyAiFightOutcomeToCharacter(before, 'unknown', actor(), NOW), before);
    });
});
