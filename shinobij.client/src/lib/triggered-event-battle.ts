import type { Dispatch, SetStateAction } from "react";
import type { Character } from "../types/character";
import type { Biome, Screen, WeatherType } from "../types/core";
import type { CreatorEvent } from "../types/vn";
import { weatherForBiome } from "../data/sectors";
import { requestAiFight } from "./ai-fight-request";
import { creatorEventPracticeOpponent } from "./creator-event-practice";
import { extractMentorLines, extractStoryFightScript, requestStoryBossFight } from "./story-fight-theme";

export type EventEncounterBattle = NonNullable<NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>[number]["battle"]>;
export type PendingEventEncounter = { event: CreatorEvent; battle?: EventEncounterBattle };

/** Route a VN battle choice without leaving its presentation and sealed-combat
 * decisions inside App. Current story chapters can only enter the story host;
 * if that host is unavailable, the scene stays open for a safe retry. */
export function launchTriggeredEventBattle({
    event, battle, character, returnScreen, sharedImages, setPendingEncounter,
    setActiveEvent, setScreen, setBiome, setWeather,
}: {
    event: CreatorEvent;
    battle?: EventEncounterBattle;
    character: Character | null;
    returnScreen: Screen;
    sharedImages: Record<string, string>;
    setPendingEncounter: Dispatch<SetStateAction<PendingEventEncounter | null>>;
    setActiveEvent: Dispatch<SetStateAction<CreatorEvent | null>>;
    setScreen: Dispatch<SetStateAction<Screen>>;
    setBiome: Dispatch<SetStateAction<Biome>>;
    setWeather: Dispatch<SetStateAction<WeatherType>>;
}): void {
    if (battle?.encounterType === "pet" || battle?.encounterType === "tiles") {
        setPendingEncounter({ event, battle });
        setActiveEvent(null);
        setScreen(battle.encounterType === "pet" ? "eventPetBattle" : "eventTiles");
        return;
    }
    const chapterIndex = /^story-(?!interlude-|road-)[a-z0-9-]+?-(\d+)$/.exec(event.id)?.[1];
    if (battle && chapterIndex !== undefined && Number(chapterIndex) === (character?.storyProgress ?? -1)) {
        const bossName = battle.bossName || event.name;
        const started = requestStoryBossFight({
            bossName,
            chapterLabel: `Chapter ${Number(chapterIndex) + 1} — ${event.vnTitle ?? event.name}`,
            backdropImage: sharedImages[`event:${event.id}:bg`] || sharedImages[`vn:${event.id}:page:0`] || undefined,
            bossPortrait: sharedImages[`event:${event.id}:avatar`] || sharedImages[`vn:${event.id}:page:0:right`] || undefined,
            ...extractStoryFightScript(event.vnPages, bossName),
            ally: extractMentorLines(event.vnPages, bossName, character?.name ?? ""),
            village: event.village || character?.village,
        });
        if (started) setActiveEvent(null);
        else window.alert("The sealed story arena is unavailable. Your chapter remains open.");
        return;
    }
    const opponent = creatorEventPracticeOpponent(event.aiProfileId, battle?.aiProfileId, character?.level ?? event.levelReq);
    if (!requestAiFight({
        opponentId: opponent.id,
        opponentLevel: Math.max(1, character?.level ?? event.levelReq),
        battleKind: "practice",
        returnScreen,
    })) return void window.alert("The sealed practice arena is unavailable. Your event remains open.");
    setActiveEvent(null);
    setBiome(event.biome);
    setWeather(weatherForBiome(event.biome));
}
