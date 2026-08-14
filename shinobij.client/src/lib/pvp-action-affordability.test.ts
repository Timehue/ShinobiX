import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { hasAffordablePvpPaidAction, type PvpPaidActionSnapshot } from "./pvp-action-affordability.js";

const baseSnapshot: PvpPaidActionSnapshot = {
    statuses: [],
    round: 3,
    availableAp: 0,
    availableChakra: 100,
    availableStamina: 100,
    cooldowns: {},
    actionsThisTurn: 0,
    jutsu: [],
    items: [],
};

describe("ordinary PvP current-snapshot auto-pass", () => {
    it("re-evaluates a newly affordable Move after Cleanse removes Lag", () => {
        const beforeCleanse = {
            ...baseSnapshot,
            statuses: [{ name: "Lag", percent: 15, rounds: 1, activeRound: 1 }],
            availableAp: 31,
        };
        assert.equal(hasAffordablePvpPaidAction(beforeCleanse), false);
        assert.equal(hasAffordablePvpPaidAction({ ...beforeCleanse, statuses: [] }), true);
    });

    it("does not treat sealed, cooling-down, or under-resourced jutsu as legal", () => {
        const jutsu = [{ id: "cheap", ap: 20, chakraCost: 10, staminaCost: 5, element: "Fire" }];
        assert.equal(hasAffordablePvpPaidAction({
            ...baseSnapshot,
            statuses: [{ name: "Elemental Seal", rounds: 1, activeRound: 3 }],
            availableAp: 20,
            jutsu,
        }), false);
        assert.equal(hasAffordablePvpPaidAction({
            ...baseSnapshot,
            availableAp: 20,
            cooldowns: { cheap: 1 },
            jutsu,
        }), false);
        assert.equal(hasAffordablePvpPaidAction({
            ...baseSnapshot,
            availableAp: 20,
            availableChakra: 9,
            jutsu,
        }), false);
        assert.equal(hasAffordablePvpPaidAction({ ...baseSnapshot, availableAp: 20, jutsu }), true);
    });

    it("honors weapon, thrown, consumable, charge, rollout, and action-cap gates", () => {
        const hand = { id: "blade", name: "Blade", slot: "hand", apCost: 20 };
        const thrown = { id: "kunai", name: "Kunai", slot: "thrown", apCost: 20 };
        const item = { id: "pill", name: "Pill", slot: "item", apCost: 20 };
        assert.equal(hasAffordablePvpPaidAction({ ...baseSnapshot, availableAp: 20, items: [hand] }), true);
        assert.equal(hasAffordablePvpPaidAction({ ...baseSnapshot, availableAp: 20, items: [thrown], itemCharges: { kunai: 1 } }), true);
        assert.equal(hasAffordablePvpPaidAction({ ...baseSnapshot, availableAp: 20, items: [item], itemCharges: { pill: 1 } }), true);
        assert.equal(hasAffordablePvpPaidAction({ ...baseSnapshot, availableAp: 20, items: [thrown], itemCharges: { kunai: 0 } }), false);
        assert.equal(hasAffordablePvpPaidAction({ ...baseSnapshot, availableAp: 20, items: [item], itemCharges: { pill: 1 }, rankedItemsDisabled: true }), false);
        assert.equal(hasAffordablePvpPaidAction({ ...baseSnapshot, availableAp: 100, items: [hand], actionsThisTurn: 5 }), false);
    });
});
