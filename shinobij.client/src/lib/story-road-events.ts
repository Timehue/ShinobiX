/*
 * story-road-events (lib) — delivery layer for the wandering story events in
 * data/story-road-events.ts. The next eligible event's NPC walks the player's
 * current sector (synthetic wanderer, weight-0 style like the Sage/emissaries);
 * talking to them opens the event as a multi-page VN through WorldMap's
 * selectedCreatorEvent path. The chosen trait is granted locally at choice time
 * AND reported to the server story record (api/story/road-event) — battles that
 * follow a choice resolve flavor, never the record, so a battle loss cannot
 * lose the story beat.
 *
 * Completion is trait-presence: an event whose choice trait is already on
 * character.storyTraits never spawns again. One road NPC at a time, lowest
 * eligible level first.
 */

import type { Character, StoryChoiceReceipt } from "../types/character";
import type { Biome } from "../types/core";
import type { CreatorEvent } from "../types/vn";
import type { Wanderer, WandererArchetypeId } from "./wanderers";
import type { StoryRoadEvent, StoryRoadNpcArchetype } from "../data/story-road-events";
import { applyStoryChoiceReceipt } from "./story-choice-mutations";
import { queueStoryReport } from "./story-history-mutations";

export const ROAD_WANDERER_PREFIX = "story-road-";

/** Which existing NPC face each road archetype wears until the art pass lands. */
const ROAD_ART: Record<StoryRoadNpcArchetype, WandererArchetypeId> = {
    courier: "courier",
    tracker: "tracker",
    trainer: "sage",
    pilgrim: "pilgrim",
    emissary: "pilgrim",
    broker: "merchant",
    official: "patrol",
    soldier: "patrol",
    rival: "bountyHunter",
};

export function roadEventChoiceTraits(event: StoryRoadEvent): string[] {
    const lastPage = event.pages[event.pages.length - 1];
    return (lastPage?.choices ?? []).map((choice) => choice.trait).filter(Boolean);
}

export function roadEventCompleted(event: StoryRoadEvent, storyTraits: string[]): boolean {
    return roadEventChoiceTraits(event).some((trait) => storyTraits.includes(trait));
}

/** The next road event that should find this player, or null. */
export function nextRoadEvent(character: Character, events: readonly StoryRoadEvent[]): StoryRoadEvent | null {
    const traits = character.storyTraits ?? [];
    for (const event of events) {
        if (character.level < event.levelReq) continue;
        if ((character.storyProgress ?? 0) < event.minProgress) continue;
        if (roadEventCompleted(event, traits)) continue;
        return event;
    }
    return null;
}

export function roadEventBySynthId(id: string, events: readonly StoryRoadEvent[]): StoryRoadEvent | null {
    return events.find((event) => event.id === id) ?? null;
}

/** The event's NPC as a sector wanderer — never hostile, never cooled, placed
 *  deterministically per (event, sector) so it doesn't jump between polls. */
export function synthRoadWanderer(event: StoryRoadEvent, sector: number): Wanderer {
    let hash = 0;
    for (const ch of event.slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const home = 5 * 12 + ((sector * 7 + hash) % 8) + 2; // mid-row interior tile
    return {
        id: event.id,
        name: event.npcName,
        archetype: ROAD_ART[event.npcArchetype],
        verb: "quest",
        level: event.levelReq,
        homeTile: home,
        waypoints: [home, home + 1, home - 1],
        greeting: `${event.npcName} stops mid-stride when they see you — whatever brought them onto this road, it was you.`,
        tellTint: "#fbbf24",
        avatarKey: ROAD_ART[event.npcArchetype],
    };
}

function callbackForRoad(event: StoryRoadEvent, pageTitle: string, traits: readonly string[]): string | null {
    if (event.id === "story-road-four-seals-one-gate" && pageTitle === "One Lattice") {
        if (traits.includes("rd66-dropped-the-shaft")) return "I found blasting dust in the map fold. Dropping Corvo's shaft kept the route from becoming a toll road; it did not erase what the gallery proved.";
        if (traits.includes("rd66-carried-the-map")) return "I set your gallery map beside the four rubbings. Its sleeping-face columns match the older network, while its route remains a separate piece of evidence.";
        if (traits.includes("rd66-priced-the-routes")) return "I have seen the priced route copies bearing your seal. I used one to align the sockets; the question of their buyers stays with you.";
    }
    if (event.id === "story-road-last-road" && pageTitle === "The Last Mile") {
        if (traits.includes("rd74-broke-the-anchor-keys")) return "No anchor key travels with the column. The broken pieces remain at the crossroads, and the road ahead must stand without that shortcut.";
        if (traits.includes("rd74-bound-the-lattice")) return "A courier's receipt says the Sage still carries the bound seal. Corvel notes its independent custody in the contract margin.";
        if (traits.includes("rd74-palmed-a-key")) return "The fourth key shifts in your pack as the horses change. Nobody on the road claims to know it is there.";
    }
    return null;
}

export function roadEventToCreatorEvent(event: StoryRoadEvent, biome: Biome, character?: Pick<Character, "storyTraits">): CreatorEvent {
    const traits = character?.storyTraits ?? [];
    const sourcePages = event.pages.map((page) => {
        const callback = callbackForRoad(event, page.title, traits);
        return callback ? { ...page, dialogue: [...page.dialogue, callback] } : page;
    });
    const pages: NonNullable<CreatorEvent["vnPages"]> = sourcePages.map((page) => ({
        title: page.title,
        scene: page.scene,
        speaker: page.speaker,
        dialogue: page.dialogue,
        choices: page.choices?.map((choice) => ({
            text: choice.text,
            nextPage: choice.nextPage,
            conclusion: choice.conclusion,
            trait: choice.trait,
            ...(choice.battle ? { battle: { encounterType: "ai" as const, bossName: choice.battle.bossName, bossIcon: choice.battle.bossIcon } } : {}),
        })),
    }));
    return {
        id: event.id,
        name: event.title,
        biome,
        icon: "🧭",
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: event.title,
        vnScene: event.pages[0]?.scene ?? "",
        vnSpeaker: event.pages[0]?.speaker ?? "Narrator",
        // Generated backdrop (scripts/gen-story-art.mjs); missing file = biome gradient.
        image: `/scenes/story/${event.id}.webp`,
        vnPages: pages,
        levelReq: event.levelReq,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        // The complete script already lives in vnPages. Keeping a flattened
        // second copy materially inflated the emitted road-event chunk.
        dialogue: [],
    };
}

/** Persist the exact road choice and its retryable report as one local update. */
export function applyRoadEventChoice(
    character: Character,
    eventId: string,
    trait: string,
    receipt: StoryChoiceReceipt,
): Character {
    return queueStoryReport(applyStoryChoiceReceipt(character, receipt), { kind: "road", eventId, trait });
}

/** Report the recorded choice to the server story record. Fire-and-forget:
 *  road events pay no rewards, so a lost report costs bookkeeping, never loot.
 *  authFetch's global interceptor attaches the auth headers. */
export async function reportStoryRoadEvent(playerName: string, eventId: string, trait: string): Promise<{ ok: boolean; trait?: string; reason?: string; recordedTrait?: string }> {
    try {
        const response = await fetch("/api/story/road-event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "complete", playerName, eventId, trait }),
        });
        const body = await response.json().catch(() => null) as { ok?: boolean; trait?: string; reason?: string; recordedTrait?: string } | null;
        if (response.ok && body?.ok === true) return { ok: true, trait: body.trait ?? trait };
        return { ok: false, reason: body?.reason ?? `http-${response.status}`, recordedTrait: body?.recordedTrait };
    } catch {
        return { ok: false, reason: "network" };
    }
}
