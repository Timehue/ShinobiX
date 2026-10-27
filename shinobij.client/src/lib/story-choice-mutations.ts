import type { Character, StoryChoiceReceipt } from "../types/character";
import { deriveStoryTraits } from "./story-derive";
import { sanitizeStoryChoices, storyDecisionKey } from "./story-history";
import { recordStoryChoice } from "./story-history-mutations";

// Record a story/VN choice trait on the character (additive + deduped). The VN
// renderer's onChoice callback calls this when a branching choice is picked, so
// later choices/pages can gate on it (requireTrait / forbidTrait). Pure: only
// ever appends to storyTraits, never touches another save field — so wiring it
// into the live renderer can't corrupt a save.
export function addStoryTrait(character: Character, trait: string): Character {
    const t = trait.trim();
    if (!t) return character;
    const existing = character.storyTraits ?? [];
    if (existing.includes(t)) return character;
    return { ...character, storyTraits: [...existing, t] };
}

/** Atomically preserve exact choice identity and its compatibility trait projection. */
export function applyStoryChoiceReceipt(character: Character, receipt: StoryChoiceReceipt): Character {
    const priorDecision = sanitizeStoryChoices(character.storyChoices).find((row) => storyDecisionKey(row) === storyDecisionKey(receipt));
    const recorded = recordStoryChoice(character, receipt);
    const accepted = priorDecision ?? receipt;
    const withTrait = accepted.choiceId === receipt.choiceId && accepted.trait ? addStoryTrait(recorded, accepted.trait) : recorded;
    const before = withTrait.storyTraits ?? [];
    const derived = deriveStoryTraits(before, withTrait.storyChoices);
    const unchanged = derived.length === before.length && derived.every((trait) => before.includes(trait));
    return unchanged ? withTrait : { ...withTrait, storyTraits: derived };
}
