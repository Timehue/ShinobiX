/*
 * Unit tests for the derived-trait layer. These pin the Ashen Leaf better-
 * winter state machine (owner brief 2026-07-09): the strongest finale unlocks
 * only when the machine is proven AND a form of proof is kept AND Aren's
 * provenance is honored — and humility (deferring to the Reeds) still counts,
 * while broken trust reaches only the lesser "unfinished" answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStoryTraits, DERIVED_TRAIT_LEVELS } from "./story-derive";

const has = (traits: string[], t: string) => deriveStoryTraits(traits).includes(t);

test("a player with no story traits derives nothing", () => {
    assert.deepEqual(deriveStoryTraits([]), []);
    assert.deepEqual(deriveStoryTraits(["mira-trust", "sv42-said-it-aloud"]).sort(), ["mira-trust", "sv42-said-it-aloud"]);
});

test("water-proven follows from reaching the number beat", () => {
    assert.equal(has(["al88-ninety-mouths"], "al88-water-proven"), true);
    // Completing the Wet Field (any lane) implies the number beat only if it was
    // actually recorded; a bare lane without ninety-mouths does not fabricate it.
    assert.equal(has(["al88-held-the-proof"], "al88-water-proven"), false);
});

test("better-winter-ready requires proof kept AND provenance carried", () => {
    const carried = ["al88-ninety-mouths", "al88-held-the-proof", "al88-reed-proof-ready"];
    assert.equal(has(carried, "al88-better-winter-ready"), true);
    // Missing the reed-proof handoff: not ready.
    assert.equal(has(["al88-ninety-mouths", "al88-held-the-proof"], "al88-better-winter-ready"), false);
    // Missing a lane (no proof preserved): not ready.
    assert.equal(has(["al88-ninety-mouths", "al88-reed-proof-ready"], "al88-better-winter-ready"), false);
});

test("humility is not punished: deferring to the Reeds still unlocks the best path", () => {
    const deferred = ["al88-ninety-mouths", "al88-proved-the-winter", "al88-reed-proof-deferred"];
    assert.equal(has(deferred, "al88-better-winter-ready"), true);
    assert.equal(has(deferred, "al88-unfinished-answer"), false);
});

test("saved the model but never earned the handoff: the unfinished answer, not the best one", () => {
    const unfinished = ["al65-saved-the-screw", "al88-ninety-mouths", "al88-baited-the-survey"];
    assert.equal(has(unfinished, "al88-unfinished-answer"), true);
    assert.equal(has(unfinished, "al88-better-winter-ready"), false);
    // water-proven still holds (they proved the machine), which drives the
    // partial "water without a name" branch only when the model was NOT saved.
    assert.equal(has(unfinished, "al88-water-proven"), true);
});

test("better-winter-ready and unfinished-answer are mutually exclusive", () => {
    for (const reed of ["al88-reed-proof-ready", "al88-reed-proof-deferred"]) {
        const traits = deriveStoryTraits(["al65-saved-the-screw", "al88-ninety-mouths", "al88-held-the-proof", reed]);
        assert.equal(traits.includes("al88-better-winter-ready"), true, reed);
        assert.equal(traits.includes("al88-unfinished-answer"), false, reed);
    }
});

test("carried vs deferred composites split cleanly for the L100 finale", () => {
    const carried = ["al88-ninety-mouths", "al88-held-the-proof", "al88-reed-proof-ready"];
    assert.equal(has(carried, "al88-better-winter-carried"), true);
    assert.equal(has(carried, "al88-better-winter-deferred"), false);
    const deferred = ["al88-ninety-mouths", "al88-proved-the-winter", "al88-reed-proof-deferred"];
    assert.equal(has(deferred, "al88-better-winter-deferred"), true);
    assert.equal(has(deferred, "al88-better-winter-carried"), false);
    // Both still count as "reed proof exists in some form" for the reckoning.
    assert.equal(has(carried, "al88-reed-proof-any"), true);
    assert.equal(has(deferred, "al88-reed-proof-any"), true);
    assert.equal(has(["al88-ninety-mouths", "al88-held-the-proof"], "al88-reed-proof-any"), false);
});

test("Mori steps forward only on the civic / trusting L92 lanes", () => {
    assert.equal(has(["al92-carried-their-trust"], "al92-mori-present"), true);
    assert.equal(has(["al92-took-the-count"], "al92-mori-present"), true);
    assert.equal(has(["al92-wore-their-fear"], "al92-mori-present"), false);
});

test("derivation is idempotent", () => {
    const once = deriveStoryTraits(["al88-ninety-mouths", "al88-proved-the-winter", "al88-reed-proof-ready"]);
    const twice = deriveStoryTraits(once);
    assert.deepEqual([...once].sort(), [...twice].sort());
});

test("every derived trait is registered with an earnable level", () => {
    for (const trait of ["al88-water-proven", "al88-better-winter-ready", "al88-better-winter-carried", "al88-better-winter-deferred", "al88-reed-proof-any", "al88-unfinished-answer"]) {
        assert.equal(DERIVED_TRAIT_LEVELS[trait], 88, trait);
    }
    assert.equal(DERIVED_TRAIT_LEVELS["al92-mori-present"], 92);
});
