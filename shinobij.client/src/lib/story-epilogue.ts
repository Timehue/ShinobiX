/*
 * story-epilogue — post-finale reckoning epilogues (owner brief 2026-07-09).
 *
 * After the kage-finale boss falls, the win path queues a short VN that
 * reflects BOTH the lane the player fought through (break / bind / take) and
 * whether they carried the better-winter proof — the "ending modifier".
 * The lane cannot be derived from storyTraits (generic lane tags accumulate
 * across chapters), so App captures it at choice time from the finale VN and
 * hands it here; a missing lane (Story Hall fallback fight, refresh mid-fight)
 * just skips the epilogue — it is goodbye flavor, never rewards or state.
 *
 * Epilogue events are synthetic (`story-epilogue-*`), pay nothing, and are
 * shown once; they never enter the story trigger/consumption bookkeeping.
 */

import type { Character } from "../types/character";
import type { CreatorEvent } from "../types/vn";
import { villageBiomeMap } from "../data/storylines";
import { storyEpiloguesByVillage, type StoryEpilogueDef } from "../data/story-epilogues";

/**
 * First entry matching the fought lane whose requireTrait (if any) is owned.
 * Data keeps gated variants before their ungated base entry, so array order
 * IS the precedence (the story-epilogues test enforces that ordering).
 */
export function selectStoryEpilogue(village: string, lane: string | null | undefined, traits: readonly string[]): StoryEpilogueDef | null {
    if (!lane) return null;
    return (storyEpiloguesByVillage[village] ?? []).find(
        (def) => def.lane === lane && (!def.requireTrait || traits.includes(def.requireTrait)),
    ) ?? null;
}

/** The queued epilogue as a ready-to-render VN event, or null (no epilogue
 *  authored for this village/lane, or no lane captured). */
export function selectStoryEpilogueEvent(character: Character, lane: string | null | undefined): CreatorEvent | null {
    const village = character.storyVillage || character.village;
    const def = selectStoryEpilogue(village, lane, character.storyTraits ?? []);
    if (!def) return null;
    const slug = village.toLowerCase().replace(/\W+/g, "-");
    // Reuse the finale chapter's backdrop (level 100 is milestone index 8 in
    // every village) — epilogues need no art of their own.
    const image = `/scenes/story/story-${slug}-100-8.webp`;
    return {
        id: `story-epilogue-${slug}-${def.lane}`,
        name: `${village}: ${def.title}`,
        biome: villageBiomeMap[village] ?? "central",
        icon: "🕯️",
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: def.title,
        vnScene: def.pages[0]?.scene ?? "",
        vnSpeaker: def.pages[0]?.speaker ?? "Narrator",
        image,
        village,
        vnPages: def.pages.map((page) => ({ ...page, image })),
        levelReq: 100,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: def.pages.flatMap((page) => page.dialogue),
    };
}
