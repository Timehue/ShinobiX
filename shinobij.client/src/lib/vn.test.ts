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
import { applyVnTextVars, vnTextVarsFor, hidePlayerPortraitDuringNarration, isChoiceAvailable, analyzeVnFlow, parseDialogueString, resolveVnActorBaseImage, resolveVnAuthoredActorImage, serializeDialogueLines, splitDialogueLine, type VnFlowPage } from "./vn";
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

test("narration hides generic Player portraits in either slot, not authored actors", () => {
    assert.equal(hidePlayerPortraitDuringNarration("Narrator", "Player"), true);
    assert.equal(hidePlayerPortraitDuringNarration("Narrator", "Player", "/portraits/player-scene.webp"), false);
    assert.equal(hidePlayerPortraitDuringNarration("Narrator", "Sefa"), false);
    assert.equal(hidePlayerPortraitDuringNarration("Sefa", "Player"), false);
});

test("story actors use their named portrait instead of a stale event-wide avatar", () => {
    assert.equal(
        resolveVnActorBaseImage("story-interlude-frostfang-village-92", "Pale Pack Runner", undefined, "/portraits/elder-sova.webp"),
        "/portraits/pale-pack-runner.webp",
    );
    assert.equal(
        resolveVnActorBaseImage("story-frostfang-village-50-4", "Elder Sova", "/portraits/elder-sova-solemn.webp", "/portraits/wrong-elder.webp"),
        "/portraits/elder-sova-solemn.webp",
    );
    assert.equal(
        resolveVnActorBaseImage("creator-generic", "Guide", undefined, "/portraits/admin-guide.webp"),
        "/portraits/admin-guide.webp",
    );
});

test("story actor overrides cannot put another character under the speaker label", () => {
    assert.equal(
        resolveVnAuthoredActorImage("story-frostfang-village-35-3", "Pale Pack Runner", "/portraits/elder-sova.webp"),
        "",
    );
    assert.equal(
        resolveVnActorBaseImage("story-frostfang-village-35-3", "Pale Pack Runner", "/portraits/elder-sova.webp"),
        "/portraits/pale-pack-runner.webp",
    );
    assert.equal(
        resolveVnAuthoredActorImage("story-ashen-leaf-village-100-8", "Kage Hoshina Enju", "/portraits/kage-hoshina-enju-hollow.webp"),
        "/portraits/kage-hoshina-enju-hollow.webp",
    );
    assert.equal(
        resolveVnAuthoredActorImage("creator-generic", "Guide", "data:image/webp;base64,custom"),
        "data:image/webp;base64,custom",
    );
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

test("applyVnTextVars: %name becomes the player name; plain text passes through", () => {
    assert.equal(applyVnTextVars("Welcome to Ashen Leaf, %name.", "Rill"), "Welcome to Ashen Leaf, Rill.");
    assert.equal(applyVnTextVars("%name and %name again", "Rill"), "Rill and Rill again");
    assert.equal(applyVnTextVars("No token here.", "Rill"), "No token here.");
    // A blank player name leaves the token visible rather than emitting a hole.
    assert.equal(applyVnTextVars("Hello, %name.", "   "), "Hello, %name.");
});

test("applyVnTextVars: %pet becomes the pet name, with a companion fallback when absent", () => {
    assert.equal(applyVnTextVars("I watched %pet step wide of it.", { name: "Rill", petName: "Shiranui" }), "I watched Shiranui step wide of it.");
    // No active pet (or a blank name) → the neutral fallback, never a visible token.
    assert.equal(applyVnTextVars("I watched %pet step wide of it.", { name: "Rill" }), "I watched your companion step wide of it.");
    assert.equal(applyVnTextVars("I watched %pet step wide of it.", { name: "Rill", petName: "  " }), "I watched your companion step wide of it.");
    // The fallback capitalizes at the start of the text or of a sentence.
    assert.equal(applyVnTextVars("%pet stops at the moss line.", { name: "Rill" }), "Your companion stops at the moss line.");
    assert.equal(applyVnTextVars("Look there. %pet saw it first.", { name: "Rill" }), "Look there. Your companion saw it first.");
    // %name and %pet substitute together; the legacy string form leaves %pet on fallback.
    assert.equal(applyVnTextVars("%name, keep %pet close.", { name: "Rill", petName: "Kit" }), "Rill, keep Kit close.");
    assert.equal(applyVnTextVars("Keep %pet close, %name.", "Rill"), "Keep your companion close, Rill.");
});

test("vnTextVarsFor: resolves the active pet's name; no active pet leaves petName undefined", () => {
    const pets = [{ id: "a", name: "Kit" }, { id: "b", name: "Shiranui" }];
    assert.deepEqual(vnTextVarsFor({ name: "Rill", pets, activePetId: "b" }), { name: "Rill", petName: "Shiranui" });
    assert.deepEqual(vnTextVarsFor({ name: "Rill", pets }), { name: "Rill", petName: undefined });
    assert.deepEqual(vnTextVarsFor({ name: "Rill", pets, activePetId: "missing" }), { name: "Rill", petName: undefined });
    assert.deepEqual(vnTextVarsFor({ name: "Rill" }), { name: "Rill", petName: undefined });
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
