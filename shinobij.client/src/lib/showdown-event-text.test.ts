import { strict as assert } from "node:assert";
import { it } from "node:test";
import type { ShowdownEvent } from "../../../shared/pet-showdown-contract";
import { describeShowdownBeat } from "./showdown-event-text";

const nameOf = (id: string) => id === "a" ? "Fox" : "Wolf";
const action = (applied?: string, damage = 0): Extract<ShowdownEvent, { t: "action" }> => ({
    t: "action", actorId: "a", actorSide: "player", moveName: "Technique", moveKind: "damage",
    element: "Fire", delivery: "ranged", weight: "normal", super: false,
    targets: [{ id: "b", damage, heal: 0, effectiveness: "neutral", guarded: false, ko: false, applied }],
    staminaAfter: 20, meterAfter: 10, overexerted: false,
});

it("reports actual HP and damage values, including overexertion and zero healing", () => {
    const e = action(undefined, 27);
    e.overexerted = true;
    e.overexertDamage = 6;
    assert.equal(describeShowdownBeat(e, nameOf), "Fox uses Technique. Wolf takes 27 damage. Fox overexerts, losing 6 HP, and will miss its next action.");
    assert.match(describeShowdownBeat(action("heal"), nameOf), /Wolf restores 0 HP/);
});

it("narrates utility results without exposing internal IDs or claiming an attempted debuff landed", () => {
    assert.match(describeShowdownBeat(action("cleanse"), nameOf), /Wolf's harmful conditions are cleared/);
    assert.match(describeShowdownBeat(action("buff"), nameOf), /gains attack power/);
    assert.match(describeShowdownBeat(action("failed"), nameOf), /Protect fails because it was used last round/);
    const protectedPet = action("protect");
    protectedPet.moveKind = "protect";
    assert.match(describeShowdownBeat(protectedPet, nameOf), /gains Protect/);
    assert.doesNotMatch(describeShowdownBeat(action("stun", 12), nameOf), /stunned/, "a hit can carry an attempted status that immunity blocked");
});

it("explains non-numeric consumable effects and reports reflected knockouts", () => {
    const e: Extract<ShowdownEvent, { t: "consumable" }> = { t: "consumable", petId: "a", side: "player", targetId: "a", itemName: "Cleanse Charm", effect: "cleanse", damage: 0, heal: 0, ko: false, spent: true };
    assert.match(describeShowdownBeat(e, nameOf), /Fox removes harmful conditions/);
    assert.match(describeShowdownBeat({ ...e, targetId: "b", effect: "thorns", damage: 11, ko: true }, nameOf), /Wolf takes 11 reflected damage\. Wolf is knocked out/);
});
