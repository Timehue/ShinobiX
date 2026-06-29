/*
 * Unit tests for the visual-novel trait-branching primitives:
 *   • isChoiceAvailable — the requireTrait/forbidTrait gating rule used by the
 *     live VN renderer to decide which choices a player can see.
 *   • addStoryTrait     — the additive, deduped persistence of a picked trait.
 *
 * These guard the branching behaviour that drives story choices, so a future
 * edit can't silently break gating or corrupt a save by mutating it in place.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isChoiceAvailable, analyzeVnFlow, parseDialogueString, serializeDialogueLines, splitDialogueLine, type VnFlowPage } from "./vn";
import { addStoryTrait } from "./character-progress";
import type { Character } from "../types/character";

test("isChoiceAvailable: a choice with no conditions is always available", () => {
    assert.equal(isChoiceAvailable({}, []), true);
    assert.equal(isChoiceAvailable({}, ["reckless"]), true);
});

test("isChoiceAvailable: requireTrait shows the choice only once the trait is earned", () => {
    assert.equal(isChoiceAvailable({ requireTrait: "reckless" }, []), false);
    assert.equal(isChoiceAvailable({ requireTrait: "reckless" }, ["reckless"]), true);
});

test("isChoiceAvailable: forbidTrait hides the choice once the trait is earned", () => {
    assert.equal(isChoiceAvailable({ forbidTrait: "merciful" }, []), true);
    assert.equal(isChoiceAvailable({ forbidTrait: "merciful" }, ["merciful"]), false);
});

test("isChoiceAvailable: require and forbid combine (need a, must not have b)", () => {
    assert.equal(isChoiceAvailable({ requireTrait: "a", forbidTrait: "b" }, ["a"]), true);
    assert.equal(isChoiceAvailable({ requireTrait: "a", forbidTrait: "b" }, ["a", "b"]), false);
    assert.equal(isChoiceAvailable({ requireTrait: "a", forbidTrait: "b" }, []), false);
});

test("addStoryTrait: appends, dedupes, and never mutates the input character", () => {
    const base = { storyTraits: [] as string[] } as unknown as Character;
    const a = addStoryTrait(base, "reckless");
    assert.deepEqual(a.storyTraits, ["reckless"]);
    assert.deepEqual(base.storyTraits, []); // original is untouched
    assert.equal(addStoryTrait(a, "reckless"), a); // duplicate → same ref, no growth
    assert.deepEqual(addStoryTrait(a, "merciful").storyTraits, ["reckless", "merciful"]);
});

test("addStoryTrait: a blank trait is a no-op", () => {
    const base = { storyTraits: ["x"] } as unknown as Character;
    assert.equal(addStoryTrait(base, "   "), base);
});

const flowPage = (over: Partial<VnFlowPage> = {}): VnFlowPage => ({ scene: "s", dialogue: "d", choices: [], ...over });

test("analyzeVnFlow: linear pages are all reachable with no warnings", () => {
    const r = analyzeVnFlow([flowPage(), flowPage(), flowPage()]);
    assert.deepEqual([...r.reachable].sort((a, b) => a - b), [0, 1, 2]);
    assert.deepEqual(r.warnings, []);
});

test("analyzeVnFlow: a branch target is reachable and an orphaned page warns", () => {
    // page 1 branches only to page 3, so page 2 is never linked or fallen through to.
    const r = analyzeVnFlow([
        flowPage({ choices: [{ text: "go", nextPage: 2 }] }),
        flowPage(),
        flowPage(),
    ]);
    assert.ok(r.reachable.includes(0) && r.reachable.includes(2));
    assert.ok(!r.reachable.includes(1));
    assert.ok(r.warnings.some((w) => w.includes("Page 2 is unreachable")));
});

test("analyzeVnFlow: an out-of-range choice target warns", () => {
    const r = analyzeVnFlow([flowPage({ choices: [{ text: "x", nextPage: 9 }] })]);
    assert.ok(r.warnings.some((w) => w.includes("jumps to a page that doesn't exist")));
});

test("analyzeVnFlow: an empty page warns", () => {
    const r = analyzeVnFlow([flowPage(), flowPage({ scene: "", dialogue: "  " })]);
    assert.ok(r.warnings.some((w) => w.includes("Page 2 has no dialogue or scene text")));
});

test("dialogue parse: first colon splits speaker from text; no colon = narration", () => {
    assert.deepEqual(parseDialogueString("Mira: Wait: listen."), [{ speaker: "Mira", text: "Wait: listen." }]);
    assert.deepEqual(parseDialogueString("The wind howls."), [{ speaker: "", text: "The wind howls." }]);
    assert.deepEqual(parseDialogueString(""), [{ speaker: "", text: "" }]);
});

test("dialogue serialize: empty speaker writes bare text, else 'Speaker: text'", () => {
    assert.equal(serializeDialogueLines([{ speaker: "Eileen", text: "Hi" }, { speaker: "", text: "It is quiet." }]), "Eileen: Hi\nIt is quiet.");
});

test("dialogue round-trips and is stable across repeated passes", () => {
    const s = "Elder Vanta: Do not mistake chaos for stupidity.\nThe storm answers.\nMira Volt: Show us.";
    assert.equal(serializeDialogueLines(parseDialogueString(s)), s);
    const once = serializeDialogueLines(parseDialogueString(s));
    assert.equal(serializeDialogueLines(parseDialogueString(once)), once);
});

test("splitDialogueLine: 'Speaker: text' splits on the first colon", () => {
    assert.deepEqual(splitDialogueLine("Mira: Wait: listen.", "Narrator"), { speaker: "Mira", text: "Wait: listen." });
});

test("splitDialogueLine: a colon-less line uses (trimmed) fallback speaker + whole line", () => {
    assert.deepEqual(splitDialogueLine("The wind howls.", "  Elder Vanta  "), { speaker: "Elder Vanta", text: "The wind howls." });
});

test("splitDialogueLine: empty after the colon falls back to the whole line; speaker/text trimmed", () => {
    assert.deepEqual(splitDialogueLine("Mira:", "Narrator"), { speaker: "Mira", text: "Mira:" });
    assert.deepEqual(splitDialogueLine("  Mira  :  Hello  ", "Narrator"), { speaker: "Mira", text: "Hello" });
});
