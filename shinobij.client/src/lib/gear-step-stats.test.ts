/**
 * The client shows (and its PvE fights use) a gear step armor piece's exact damage
 * reduction, while the server derives the reduction PvP and every sealed fight uses.
 * They are separate code paths, so this pins that they agree for all 45 armor steps
 * and that a step is the only thing that changes the number.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { starterItems } from "../data/starter-items";
import { getCharacterArmorFactor, getCharacterArmorRawDR } from "./equipment-stats";
import { armorReductionForItem } from "./equipment";
import { deriveCombatMultipliers } from "../../../api/pvp/_multipliers";
import { isStepItemId, parseStepItemId } from "../../../shared/gear-steps";
import type { Character } from "../types/character";

const armorSteps = starterItems.filter((item) => isStepItemId(item.id) && item.armorQuality);
const wear = (slot: string, id: string) => ({ equipment: { [slot]: id } }) as unknown as Character;

describe("gear step armor: client and server agree", () => {
    it("has 45 armor steps to compare", () => {
        assert.equal(armorSteps.length, 45);
    });

    it("computes the same raw reduction for every armor step", () => {
        for (const item of armorSteps) {
            const client = getCharacterArmorRawDR(wear(item.slot, item.id), starterItems);
            const server = deriveCombatMultipliers({ equipment: { [item.slot]: item.id } }, null).armorRawDR;
            assert.ok(Math.abs(client - server) < 1e-9, `${item.id}: client ${client} vs server ${server}`);
            assert.ok(Math.abs(client - (item.armorReduction ?? -1)) < 1e-9, `${item.id}: not the item's own reduction`);
        }
    });

    it("agrees on a full five piece set, and on the PvE armor factor", () => {
        const set = ["head", "body", "waist", "legs", "feet"].map((slot) => armorSteps.find((item) => item.slot === slot && item.id.endsWith("-s3"))!);
        const equipment = Object.fromEntries(set.map((item) => [item.slot, item.id]));
        const client = getCharacterArmorRawDR({ equipment } as unknown as Character, starterItems);
        const server = deriveCombatMultipliers({ equipment }, null).armorRawDR;
        assert.ok(Math.abs(client - server) < 1e-9, `${client} vs ${server}`);
        const factor = getCharacterArmorFactor({ equipment } as unknown as Character, starterItems);
        assert.ok(Math.abs(factor - Math.max(0.25, 1 - client)) < 1e-9);
    });

    it("a step is strictly better than its base and strictly worse than the next tier", () => {
        const nextTier: Record<string, number> = { Standard: 0.03, Reinforced: 0.05, Rare: 0.07 };
        for (const item of armorSteps) {
            const base = starterItems.find((candidate) => candidate.id === parseStepItemId(item.id)!.baseId)!;
            assert.ok(armorReductionForItem(item) > armorReductionForItem(base), item.id);
            assert.ok(armorReductionForItem(item) < nextTier[item.armorQuality!], item.id);
        }
    });
});
