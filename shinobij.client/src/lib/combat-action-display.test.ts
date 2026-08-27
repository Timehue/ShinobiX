import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
    activeCombatDisplayStatuses,
    activeBarrierTilesForDisplay,
    adjustedCombatApCost,
    adjustedPvpCombatApCost,
    COMBAT_REJECTION_CODES,
    combatActionAvailability,
    combatRejectionMessage,
    isElementallySealedForDisplay,
    partitionCombatDisplayStatuses,
    pvpCombatWardKey,
} from "./combat-action-display.js";

describe("combat action affordance parity", () => {
    it("uses the canonical Lag-then-Overclock order and stacks active percentages", () => {
        const statuses = [
            { name: "Lag", percent: 10 },
            { name: "Lag", percent: 20 },
            { name: "Overclock", percent: 25 },
        ];
        // ceil(41 * 1.30) = 54, then floor(54 * 0.75) = 40.
        assert.equal(adjustedCombatApCost(statuses, 41, 3), 40);
    });

    it("ignores effects whose active round has not begun", () => {
        const statuses = [
            { name: "Lag", percent: 50, activeRound: 4 },
            { name: "Overclock", percent: 50, activeRound: 5 },
        ];
        assert.equal(adjustedCombatApCost(statuses, 40, 3), 40);
        assert.equal(adjustedCombatApCost(statuses, 40, 4), 60);
    });

    it("switches a refreshed status from its retiring copy to its pending replacement at the exact boundary", () => {
        const retiring = { name: "Lag", percent: 50, rounds: 2, activeRound: 1, inactiveRound: 4 };
        const replacement = { name: "Lag", percent: 10, rounds: 2, activeRound: 4 };
        const statuses = [retiring, replacement];

        assert.deepEqual(activeCombatDisplayStatuses(statuses, 3), [retiring]);
        assert.deepEqual(partitionCombatDisplayStatuses(statuses, 3), {
            active: [retiring],
            pending: [replacement],
            retired: [],
        });
        assert.deepEqual(activeCombatDisplayStatuses(statuses, 4), [replacement]);
        assert.deepEqual(partitionCombatDisplayStatuses(statuses, 4), {
            active: [replacement],
            pending: [],
            retired: [retiring],
        });
        // Ordinary PvP must read the replacement, not the earlier retiring copy:
        // ceil(40 × 1.10) = 44.
        assert.equal(adjustedPvpCombatApCost(statuses, 40, 4), 44);
    });

    it("matches ordinary PvP's first-active modifier rule after round filtering", () => {
        const statuses = [
            { name: "Lag", percent: 90, activeRound: 5 },
            { name: "Lag", percent: 50, activeRound: 2 },
            { name: "Lag", percent: 10, activeRound: 1 },
            { name: "Overclock", percent: 20, activeRound: 2 },
            { name: "Overclock", percent: 80, activeRound: 1 },
        ];
        assert.equal(adjustedPvpCombatApCost(statuses, 40, 1), 8);
        // Round 2 filters out the future modifier, then uses the first active Lag
        // and Overclock: ceil(40 * 1.50) = 60; floor(60 * 0.80) = 48.
        assert.equal(adjustedPvpCombatApCost(statuses, 40, 2), 48);
    });

    it("gates paid actions on adjusted AP, resources, cooldown, seal, and action cap", () => {
        const statuses = [
            { name: "Lag", percent: 50, activeRound: 2 },
            { name: "Elemental Seal", activeRound: 2 },
        ];
        const blocked = combatActionAvailability({
            statuses,
            round: 2,
            apModifierMode: "first-active",
            baseAp: 40,
            availableAp: 59,
            chakraCost: 20,
            availableChakra: 19,
            staminaCost: 10,
            availableStamina: 9,
            cooldownRemaining: 1,
            element: "Fire",
            actionsThisTurn: 5,
            maxActions: 5,
        });
        assert.deepEqual(blocked, {
            apCost: 60,
            chakraCost: 20,
            staminaCost: 10,
            sealed: true,
            onCooldown: true,
            actionLimitReached: true,
            affordable: false,
        });

        const nonBasic = combatActionAvailability({
            statuses,
            round: 2,
            apModifierMode: "first-active",
            baseAp: 40,
            availableAp: 60,
            chakraCost: 20,
            availableChakra: 20,
            staminaCost: 10,
            availableStamina: 10,
            element: "Yin",
            actionsThisTurn: 4,
            maxActions: 5,
        });
        assert.equal(nonBasic.sealed, false);
        assert.equal(nonBasic.affordable, true);
    });

    it("seals only the same five basic elements as the canonical resolver", () => {
        const seal = [{ name: "Elemental Seal", activeRound: 2 }];
        assert.equal(isElementallySealedForDisplay(seal, "Fire", 1), false);
        assert.equal(isElementallySealedForDisplay(seal, "Fire", 2), true);
        assert.equal(isElementallySealedForDisplay(seal, "Yin", 2), false);
        assert.equal(isElementallySealedForDisplay(seal, "None", 2), false);
        assert.equal(isElementallySealedForDisplay([{ ...seal[0], inactiveRound: 3 }], "Fire", 3), false);
    });

    it("exposes only active, server-authored Tower grid barriers as blocked tiles", () => {
        const statuses = [
            { name: "Barrier", source: "tower-grid:wall", amount: 7, rounds: 2, activeRound: 3 },
            { name: "Barrier", source: "jutsu:guard", amount: 8, rounds: 2, activeRound: 1 },
            { name: "Barrier", source: "tower-grid:future", amount: 9, rounds: 2, activeRound: 4 },
            { name: "Barrier", source: "tower-grid:expired", amount: 10, rounds: 0, activeRound: 1 },
            { name: "Barrier", source: "tower-grid:retired", amount: 11, rounds: 2, activeRound: 1, inactiveRound: 3 },
        ];
        assert.deepEqual([...activeBarrierTilesForDisplay(statuses, 3, 120, "tower-grid:")], [7]);
    });

    it("does not render deferred PvP ward effects before their active round", () => {
        const fighter = {
            shield: 0,
            statuses: [
                { name: "Barrier", rounds: 2, activeRound: 4 },
                { name: "Reflect", rounds: 2, activeRound: 4 },
                { name: "Absorb", rounds: 2, activeRound: 4 },
            ],
        };
        assert.equal(pvpCombatWardKey(fighter, 3), null);
        assert.equal(pvpCombatWardKey(fighter, 4), "shield");
        assert.equal(pvpCombatWardKey({ ...fighter, statuses: fighter.statuses.slice(1) }, 4), "reflect");
        assert.equal(pvpCombatWardKey({ ...fighter, statuses: fighter.statuses.slice(2) }, 4), "absorb");
        assert.equal(pvpCombatWardKey({ ...fighter, shield: 250 }, 3), "shield");
    });

    it("does not render a retired PvP ward at or after its inactive round", () => {
        const retiring = {
            shield: 0,
            statuses: [{ name: "Reflect", rounds: 2, activeRound: 1, inactiveRound: 4 }],
        };
        assert.equal(pvpCombatWardKey(retiring, 3), "reflect");
        assert.equal(pvpCombatWardKey(retiring, 4), null);
    });

    it("presents representative canonical rejection codes as player-facing copy", () => {
        assert.equal(combatRejectionMessage("no-chakra"), "You do not have enough chakra.");
        assert.equal(combatRejectionMessage("elementally-sealed"), "An Elemental Seal prevents that technique.");
        assert.equal(combatRejectionMessage("Network request timed out."), "Network request timed out.");
        assert.equal(combatRejectionMessage("new-machine-code"), "That command could not be completed. Choose another highlighted target.");
    });

    it("keeps a closed player-facing presenter for every emitted Solo and Tower reason", () => {
        const canonicalReasons = [
            "actor-defeated", "already-summoned", "bad-tile", "blocked", "cannot-act", "cannot-forfeit",
            "companion-cannot-summon", "down", "duplicate-move-token", "elementally-sealed", "enemy-cannot-summon",
            "friendly-fire", "invalid-action-type", "invalid-expected-version", "invalid-move", "invalid-move-token",
            "invalid-target", "match-not-found", "member-busy", "move-token-conflict", "no-ammo", "no-chakra",
            "no-companion", "no-item", "no-jutsu", "no-space", "no-stamina", "no-target", "no-weapon",
            "not-a-member", "not-adjacent", "not-your-turn", "objective-locked", "occupied", "on-cooldown",
            "out-of-ammo", "out-of-item", "out-of-range", "rejected", "retreat-sealed", "session-done",
            "session-not-active", "stale-version", "turn-expired", "unknown-action",
        ];
        assert.deepEqual([...COMBAT_REJECTION_CODES], canonicalReasons);
        for (const reason of canonicalReasons) {
            assert.notEqual(
                combatRejectionMessage(reason),
                "That command could not be completed. Choose another highlighted target.",
                reason,
            );
        }
        assert.equal(combatRejectionMessage("cannot-act"), "You need more AP or another action slot before acting.");
    });
});
