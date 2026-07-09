/*
 * story-trigger — selection + assembly for the auto-triggered story beats:
 * milestone chapter VNs (boss fights, from data/storylines) and VN-only
 * interludes (road scenes, from data/story-interludes). Drained out of the
 * App.tsx trigger effect so the monolith keeps only the setter wiring.
 *
 * Interludes never touch storyProgress (that index is save data and the Kage
 * seat unlock reads `storyProgress >= 9`); they are one-shot triggered events
 * whose chosen trait is reported to the server story record on completion
 * (api/story/interlude — see docs/fable-5-story-rebuild.md §10).
 */

import type { Character } from "../types/character";
import type { CreatorEvent, StoryStep } from "../types/vn";
import { storylines, villageBiomeMap, getCurrentStory } from "../data/storylines";
import { storyInterludesByVillage, type StoryInterlude } from "../data/story-interludes";

export function storyToCreatorEvent(step: StoryStep, village: string, index: number): CreatorEvent {
    const slug = village.toLowerCase().replace(/\W+/g, "-");
    const pages = step.pages?.length ? step.pages : [{
        title: step.cinematicTitle,
        scene: step.scene,
        speaker: "Narrator",
        dialogue: step.dialogue,
        choices: [],
    }];
    return {
        id: `story-${slug}-${step.levelReq}-${index}`,
        name: `${village}: ${step.title}`,
        biome: step.biome ?? villageBiomeMap[village] ?? "central",
        icon: step.bossIcon,
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: step.title,
        vnScene: step.scene,
        vnSpeaker: pages[0]?.speaker ?? "Narrator",
        image: "",
        aiProfileId: step.aiProfileId,
        village,
        kageFinale: step.kageFinale,
        liberatorTitle: step.liberatorTitle,
        vnPages: pages,
        levelReq: step.levelReq,
        xpReward: step.rewardXp,
        ryoReward: step.rewardRyo,
        staminaReward: 0,
        dialogue: step.dialogue,
    };
}

export function interludeToCreatorEvent(interlude: StoryInterlude): CreatorEvent {
    return {
        id: interlude.id,
        name: `${interlude.village}: ${interlude.title}`,
        biome: villageBiomeMap[interlude.village] ?? "central",
        icon: storylines[interlude.village]?.[0]?.bossIcon ?? "📜",
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: interlude.title,
        vnScene: interlude.pages[0]?.scene ?? "",
        vnSpeaker: interlude.pages[0]?.speaker ?? "Narrator",
        // Generated backdrop (scripts/gen-story-art.mjs); a missing file just
        // leaves the biome gradient — the CSS gradient layer always renders.
        image: `/scenes/story/${interlude.id}.webp`,
        village: interlude.village,
        vnPages: interlude.pages as CreatorEvent["vnPages"],
        levelReq: interlude.levelReq,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: interlude.pages.flatMap((page) => page.dialogue),
    };
}

/** The shared-image overlay applied to any story VN (admin-published art wins). */
export function overlayVnImages(base: CreatorEvent, eventId: string, sharedImages: Record<string, string>): CreatorEvent {
    return {
        ...base,
        ...(sharedImages["event:" + eventId + ":bg"]     ? { image:       sharedImages["event:" + eventId + ":bg"] }     : {}),
        ...(sharedImages["event:" + eventId + ":avatar"] ? { avatarImage: sharedImages["event:" + eventId + ":avatar"] } : {}),
        ...(base.vnPages ? {
            vnPages: base.vnPages.map((p, i) => ({
                ...p,
                ...(sharedImages[`vn:${eventId}:page:${i}`]       ? { image:      sharedImages[`vn:${eventId}:page:${i}`] }       : {}),
                ...(sharedImages[`vn:${eventId}:page:${i}:left`]  ? { leftImage:  sharedImages[`vn:${eventId}:page:${i}:left`] }  : {}),
                ...(sharedImages[`vn:${eventId}:page:${i}:right`] ? { rightImage: sharedImages[`vn:${eventId}:page:${i}:right`] } : {}),
            })),
        } : {}),
    };
}

export type StoryTriggerCandidate = {
    eventId: string;
    base: CreatorEvent;
    /** "storyHall" = milestone chapter (returns to the Hall); "current" = interlude (returns whence it fired). */
    returnScreen: "storyHall" | "current";
};

/**
 * The next story beat that should auto-fire for this character, or null.
 * Candidates: the current milestone step (existing behavior, unchanged) and the
 * lowest eligible interlude (level + minProgress gates, one-shot). When both
 * are pending, the lower levelReq fires first so the narrative stays in order.
 */
export function nextStoryTrigger(character: Character, triggeredEvents: string[]): StoryTriggerCandidate | null {
    const village = character.storyVillage || character.village;

    let milestone: StoryTriggerCandidate | null = null;
    const step = getCurrentStory(character);
    if (step && character.level >= step.levelReq) {
        const storyLine = storylines[village] || [];
        const index = storyLine.findIndex((s) => s.levelReq === step.levelReq);
        if (index >= 0) {
            const eventId = `story-${village.toLowerCase().replace(/\W+/g, "-")}-${step.levelReq}-${index}`;
            if (!triggeredEvents.includes(eventId)) {
                milestone = { eventId, base: storyToCreatorEvent(step, village, index), returnScreen: "storyHall" };
            }
        }
    }

    let interlude: StoryTriggerCandidate | null = null;
    for (const entry of storyInterludesByVillage[village] ?? []) {
        if (character.level < entry.levelReq) continue;
        if ((character.storyProgress ?? 0) < entry.minProgress) continue;
        if (triggeredEvents.includes(entry.id)) continue;
        interlude = { eventId: entry.id, base: interludeToCreatorEvent(entry), returnScreen: "current" };
        break;
    }

    if (milestone && interlude) return milestone.base.levelReq <= interlude.base.levelReq ? milestone : interlude;
    return milestone ?? interlude;
}

/**
 * Report a completed interlude's chosen trait to the server story record.
 * Fire-and-forget: the interlude pays no XP/ryo/items, so a lost report costs
 * flavor bookkeeping, never rewards. Skipped scenes (no choice made) report
 * nothing. authFetch's global interceptor attaches the auth headers.
 */
export async function reportStoryInterlude(character: Character, interludeId: string): Promise<void> {
    const village = character.storyVillage || character.village;
    const interlude = (storyInterludesByVillage[village] ?? []).find((entry) => entry.id === interludeId);
    if (!interlude) return;
    const lastPage = interlude.pages[interlude.pages.length - 1];
    const choiceTraits = (lastPage?.choices ?? []).map((choice) => choice.trait).filter(Boolean);
    const trait = (character.storyTraits ?? []).find((t) => choiceTraits.includes(t));
    if (!trait) return;
    try {
        await fetch("/api/story/interlude", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "complete", playerName: character.name, interludeId, trait }),
        });
    } catch {
        // Offline/flaky network: the trait mirror stays on the save; the server
        // record simply misses this beat until a future reconcile pass.
    }
}
