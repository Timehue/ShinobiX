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
import { villageBiomeMap } from "../data/village-biomes";
import type { StoryInterlude } from "../data/story-interludes";
import { isStoryContentVillage, type StoryContentPayload } from "./story-content-contract";
import { loadStoryContent } from "./story-content-loader";

// Post-finale ending epilogues live in their own module; re-exported here so
// App.tsx keeps a single story-beat import surface (and its line ratchet).
export { selectStoryEpilogueEvent } from "./story-epilogue";

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

export function interludeToCreatorEvent(interlude: StoryInterlude, bossIcon = "📜"): CreatorEvent {
    return {
        id: interlude.id,
        name: `${interlude.village}: ${interlude.title}`,
        biome: villageBiomeMap[interlude.village] ?? "central",
        icon: bossIcon,
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

/** The choice trait this character recorded for an interlude, or null if the
 *  scene has not been decided yet (skipped scenes leave no trait). */
export function interludeChosenTraitFromContent(character: Character, content: StoryContentPayload, interludeId: string): string | null {
    const village = character.storyVillage || character.village;
    if (content.village !== village) return null;
    const interlude = content.interludes.find((entry) => entry.id === interludeId);
    if (!interlude) return null;
    const lastPage = interlude.pages[interlude.pages.length - 1];
    const choiceTraits = (lastPage?.choices ?? []).map((choice) => choice.trait).filter(Boolean);
    return (character.storyTraits ?? []).find((t) => choiceTraits.includes(t)) ?? null;
}

/**
 * The next story beat that should auto-fire for this character, or null.
 * Candidates: the current milestone step (existing behavior, unchanged) and the
 * lowest eligible interlude (level + minProgress gates). When both are pending,
 * the lower levelReq fires first so the narrative stays in order.
 *
 * Milestones are consumed only by storyProgress (a sealed boss win), never by
 * merely opening their VN. Interludes are consumed by COMPLETION, not by firing:
 * an interlude is done
 * when its id was recorded in triggeredEvents at completion OR the player owns
 * one of its choice traits (the double-guard prevents re-choosing after a
 * refresh). `dismissed` is the caller's session-only skip list, so a refresh
 * re-offers a skipped scene instead of losing it forever.
 */
export function nextStoryTriggerFromContent(character: Character, content: StoryContentPayload, triggeredEvents: string[], dismissed: readonly string[] = []): StoryTriggerCandidate | null {
    const village = character.storyVillage || character.village;
    if (content.village !== village) return null;
    const storyLine = content.chapters;

    let milestone: StoryTriggerCandidate | null = null;
    const step = storyLine[character.storyProgress] ?? null;
    if (step && character.level >= step.levelReq) {
        const index = storyLine.findIndex((s) => s.levelReq === step.levelReq);
        if (index >= 0) {
            const eventId = `story-${village.toLowerCase().replace(/\W+/g, "-")}-${step.levelReq}-${index}`;
            if (!dismissed.includes(eventId)) {
                milestone = { eventId, base: storyToCreatorEvent(step, village, index), returnScreen: "storyHall" };
            }
        }
    }

    let interlude: StoryTriggerCandidate | null = null;
    const owned = character.storyTraits ?? [];
    for (const entry of content.interludes) {
        if (character.level < entry.levelReq) continue;
        if ((character.storyProgress ?? 0) < entry.minProgress) continue;
        if (triggeredEvents.includes(entry.id) || dismissed.includes(entry.id)) continue;
        const lastChoices = entry.pages[entry.pages.length - 1].choices ?? [];
        if (lastChoices.some((choice) => choice.trait && owned.includes(choice.trait))) continue;
        interlude = { eventId: entry.id, base: interludeToCreatorEvent(entry, storyLine[0]?.bossIcon), returnScreen: "current" };
        break;
    }

    if (milestone && interlude) return milestone.base.levelReq <= interlude.base.levelReq ? milestone : interlude;
    return milestone ?? interlude;
}

async function contentFor(character: Character): Promise<StoryContentPayload | null> {
    const village = character.storyVillage || character.village;
    if (!isStoryContentVillage(village)) return null;
    return loadStoryContent(village);
}

export async function nextStoryTrigger(character: Character, triggeredEvents: string[], dismissed: readonly string[] = []): Promise<StoryTriggerCandidate | null> {
    const content = await contentFor(character);
    return content ? nextStoryTriggerFromContent(character, content, triggeredEvents, dismissed) : null;
}

export async function interludeChosenTrait(character: Character, interludeId: string): Promise<string | null> {
    const content = await contentFor(character);
    return content ? interludeChosenTraitFromContent(character, content, interludeId) : null;
}

/**
 * Report a completed interlude's chosen trait to the server story record.
 * Fire-and-forget: the interlude pays no XP/ryo/items, so a lost report costs
 * flavor bookkeeping, never rewards. Skipped scenes (no choice made) report
 * nothing. authFetch's global interceptor attaches the auth headers.
 */
export type StoryReportResult = { ok: boolean; trait?: string; reason?: string; recordedTrait?: string };

export async function reportStoryInterlude(character: Character, interludeId: string, exactTrait?: string): Promise<StoryReportResult> {
    const trait = exactTrait ?? await interludeChosenTrait(character, interludeId);
    if (!trait) return { ok: false, reason: "missing-choice" };
    const post = async (): Promise<string> => {
        const res = await fetch("/api/story/interlude", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "complete", playerName: character.name, interludeId, trait }),
        });
        const body = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; trait?: string; recordedTrait?: string } | null;
        if (res.ok && body?.ok === true) return `ok:${body.trait ?? trait}`;
        return body?.ok === false && typeof body.reason === "string"
            ? `${body.reason}:${body.recordedTrait ?? ""}`
            : `http:${res.status}`;
    };
    try {
        let reason = await post();
        // The server validates against the SAVED character; right after a
        // level-up or chapter win the autosave may still be in flight, so a
        // level/progress rejection gets one delayed retry.
        if (reason.startsWith("level:") || reason.startsWith("progress:")) {
            await new Promise((resolve) => setTimeout(resolve, 6000));
            reason = await post();
        }
        if (reason.startsWith("ok:")) return { ok: true, trait: reason.slice(3) };
        const [code, recordedTrait] = reason.split(":", 2);
        return { ok: false, reason: code, ...(recordedTrait ? { recordedTrait } : {}) };
    } catch {
        return { ok: false, reason: "network" };
    }
}

/** Exact current milestone for explicit Story Hall resume intent. Optional
 * lower-level interludes remain pending and resume their normal order later. */
export function currentStoryChapterTriggerFromContent(character: Character, content: StoryContentPayload): StoryTriggerCandidate | null {
    const village = character.storyVillage || character.village;
    if (content.village !== village) return null;
    const progress = Math.max(0, Math.floor(character.storyProgress ?? 0));
    const step = content.chapters[progress];
    if (!step || character.level < step.levelReq) return null;
    const eventId = `story-${village.toLowerCase().replace(/\W+/g, "-")}-${step.levelReq}-${progress}`;
    return { eventId, base: storyToCreatorEvent(step, village, progress), returnScreen: "storyHall" };
}

export async function currentStoryChapterTrigger(character: Character): Promise<StoryTriggerCandidate | null> {
    const content = await contentFor(character);
    return content ? currentStoryChapterTriggerFromContent(character, content) : null;
}
