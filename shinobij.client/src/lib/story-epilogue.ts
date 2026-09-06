/*
 * story-epilogue — post-finale reckoning epilogues (owner brief 2026-07-09).
 *
 * After the kage-finale boss falls, the win path queues a short VN that
 * reflects BOTH the lane the player fought through (break / bind / take) and
 * whether they carried the better-winter proof — the "ending modifier".
 * The lane cannot be derived from storyTraits (generic lane tags accumulate
 * across chapters). The accepted terminal choice is stored as an exact receipt;
 * a sealed first clear records a durable pending epilogue from that receipt and
 * can recover it after refresh. Historical saves without the receipt stay unknown.
 *
 * Epilogue events are synthetic (`story-epilogue-*`), pay nothing, and are
 * shown once through their dedicated pending/seen bookkeeping.
 */

import type { Character } from "../types/character";
import type { CreatorEvent } from "../types/vn";
import { villageBiomeMap } from "../data/village-biomes";
import type { StoryEpilogueDef } from "../data/story-epilogues";
import { isStoryContentVillage } from "./story-content-contract";

/**
 * First entry matching the fought lane whose requireTrait (if any) is owned.
 * Data keeps gated variants before their ungated base entry, so array order
 * IS the precedence (the story-epilogues test enforces that ordering).
 */
export function selectStoryEpilogueFrom(defs: readonly StoryEpilogueDef[], lane: string | null | undefined, traits: readonly string[]): StoryEpilogueDef | null {
    if (!lane) return null;
    return defs.find(
        (def) => def.lane === lane
            && (!def.requireTrait || traits.includes(def.requireTrait))
            && (!def.requireAnyTrait?.length || def.requireAnyTrait.some((trait) => traits.includes(trait))),
    ) ?? null;
}

/** The queued epilogue as a ready-to-render VN event, or null (no epilogue
 *  authored for this village/lane, or no lane captured). */
export async function selectStoryEpilogueEvent(character: Character, lane: string | null | undefined, traitSnapshot?: readonly string[], authoredDefs?: readonly StoryEpilogueDef[]): Promise<CreatorEvent | null> {
    const village = character.storyVillage || character.village;
    if (!isStoryContentVillage(village) || !lane) return null;
    const defs = authoredDefs ?? await import("./story-epilogue-loader").then((module) => module.loadStoryEpilogues(village)) ?? [];
    const def = selectStoryEpilogueFrom(defs, lane, traitSnapshot ?? character.storyTraits ?? []);
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
