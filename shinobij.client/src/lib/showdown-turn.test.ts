/*
 * The empty case is the whole point of this test file.
 *
 * `promptablePets` returning [] is a legal, reachable state that the command
 * deck cannot render — and the deck owns the only call to submitRound, so an
 * empty result used to strand the player on a blank command bar for the rest of
 * the fight. The Overdraft rule is *designed* to produce exactly this state, so
 * this is not an exotic edge: it is the tutorial-level lesson of the mechanic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promptablePets } from "./showdown-turn";
import type { ShowdownPetView } from "../../../shared/pet-showdown-contract";

function pet(id: string, over: Partial<ShowdownPetView> = {}): ShowdownPetView {
    return {
        id, name: id, element: "Fire", role: "assassin",
        hp: 100, maxHp: 100, stamina: 50, maxStamina: 50,
        ko: false, benched: false, statuses: [], moves: [],
        skipsNextAction: false, canSwitchOut: true,
        ...over,
    } as unknown as ShowdownPetView;
}

test("a healthy pet is always promptable", () => {
    assert.equal(promptablePets([pet("a")], 0).length, 1);
    assert.equal(promptablePets([pet("a"), pet("b")], 2).length, 2);
});

test("a stunned pet is still prompted when it has somewhere to rotate", () => {
    // Stun bars the action but not the switch, so the player still has a real
    // decision and must be asked for it.
    const stunned = pet("a", { skipsNextAction: true, canSwitchOut: true });
    assert.equal(promptablePets([stunned], 1).length, 1, "bench available → prompt");
    assert.equal(promptablePets([stunned], 0).length, 0, "no bench → nothing to ask");
});

test("an overdraft-winded pet is never prompted, bench or not", () => {
    // Winded bars switching too, so there is no decision left to take.
    const winded = pet("a", { skipsNextAction: true, canSwitchOut: false });
    assert.equal(promptablePets([winded], 0).length, 0);
    assert.equal(promptablePets([winded], 3).length, 0, "a bench does not un-wind it");
});

test("THE SOFT-LOCK PRECONDITION: a whole living team can be unpromptable", () => {
    // This returning [] is what stranded the player. It must stay reachable and
    // obvious, so the component's guard is never quietly dropped as dead code.
    const team = [
        pet("a", { skipsNextAction: true, canSwitchOut: false }),
        pet("b", { skipsNextAction: true, canSwitchOut: false }),
        pet("c", { skipsNextAction: true, canSwitchOut: true }),
    ];
    assert.deepEqual(promptablePets(team, 0), [], "all winded, no bench → nobody to ask");

    // The single-pet 1v1 case, which is the likeliest way a player meets it:
    // overdraft your only pet and there is no order to give at all.
    const solo = [pet("solo", { skipsNextAction: true, canSwitchOut: false })];
    assert.deepEqual(promptablePets(solo, 0), []);
});

test("KO'd pets are the caller's job to exclude, not this filter's", () => {
    // Documenting the contract: callers pass LIVING pets. If this ever starts
    // filtering ko itself, the caller's own filter becomes redundant and the
    // two can drift apart.
    const dead = pet("a", { ko: true });
    assert.equal(promptablePets([dead], 0).length, 1, "ko is not filtered here");
});
