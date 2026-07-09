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

import type { Character } from "../types/character";
import type { Biome } from "../types/core";
import type { CreatorEvent } from "../types/vn";
import type { Wanderer, WandererArchetypeId } from "./wanderers";
import { storyRoadEvents, type StoryRoadEvent, type StoryRoadNpcArchetype } from "../data/story-road-events";

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
export function nextRoadEvent(character: Character): StoryRoadEvent | null {
    const traits = character.storyTraits ?? [];
    for (const event of storyRoadEvents) {
        if (character.level < event.levelReq) continue;
        if ((character.storyProgress ?? 0) < event.minProgress) continue;
        if (roadEventCompleted(event, traits)) continue;
        return event;
    }
    return null;
}

export function roadEventBySynthId(id: string): StoryRoadEvent | null {
    return storyRoadEvents.find((event) => event.id === id) ?? null;
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

export function roadEventToCreatorEvent(event: StoryRoadEvent, biome: Biome): CreatorEvent {
    const pages: NonNullable<CreatorEvent["vnPages"]> = event.pages.map((page) => ({
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
        image: "",
        vnPages: pages,
        levelReq: event.levelReq,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: event.pages.flatMap((page) => page.dialogue),
    };
}

/** Report the recorded choice to the server story record. Fire-and-forget:
 *  road events pay no rewards, so a lost report costs bookkeeping, never loot.
 *  authFetch's global interceptor attaches the auth headers. */
export async function reportStoryRoadEvent(playerName: string, eventId: string, trait: string): Promise<void> {
    try {
        await fetch("/api/story/road-event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "complete", playerName, eventId, trait }),
        });
    } catch {
        // Offline: the trait mirror stays on the save; the record misses this
        // beat until a future reconcile pass.
    }
}
