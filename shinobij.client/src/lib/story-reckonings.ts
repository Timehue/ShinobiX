import type { Character } from "../types/character";
import type { Biome } from "../types/core";
import type { CreatorEvent } from "../types/vn";
import type { Wanderer } from "./wanderers";
import { villageForOutskirtsSector } from "../data/sectors";
import { defaultVnPortrait } from "./vn";
import { storyReckoningById, storyReckonings, type StoryReckoning, type StoryReckoningPage } from "../data/story-reckonings";

export const STORY_RECKONING_ACCEPT_TRAIT = "__story-reckoning-accept";
export const STORY_RECKONING_ABANDON_TRAIT = "__story-reckoning-abandon";
export const STORY_RECKONING_RETURN_SUFFIX = "-return";

export function isStoryReckoningId(id: string): boolean {
    return id.startsWith("story-reckoning-");
}

export function isStoryReckoningReturnEventId(id: string): boolean {
    return isStoryReckoningId(id) && id.endsWith(STORY_RECKONING_RETURN_SUFFIX);
}

export function storyReckoningForEventId(id: string): StoryReckoning | null {
    const base = isStoryReckoningReturnEventId(id) ? id.slice(0, -STORY_RECKONING_RETURN_SUFFIX.length) : id;
    return storyReckoningById(base);
}

export function storyReckoningEligible(character: Character, quest: StoryReckoning): boolean {
    const traits = character.storyTraits ?? [];
    if (traits.includes(quest.completionTrait)) return false;
    if ((character.level ?? 0) < quest.levelReq) return false;
    if ((character.storyProgress ?? 0) < quest.ownProgress) return false;
    // A cross-village figure (Kite Harrow) stands at ANY village's outskirts once
    // the player has reached the required progress; own-village arcs additionally
    // require the player to be on that village's story.
    return quest.crossVillage === true || character.storyVillage === quest.village;
}

export function visibleStoryReckonings(character: Character, sector: number): Wanderer[] {
    const village = villageForOutskirtsSector(sector);
    if (!village) return [];
    return storyReckonings
        .filter((quest) => (quest.crossVillage === true || quest.village === village) && storyReckoningEligible(character, quest))
        .map((quest) => synthStoryReckoningWanderer(quest, sector));
}

export function synthStoryReckoningWanderer(quest: StoryReckoning, sector: number): Wanderer {
    let hash = 0;
    for (const ch of quest.slug) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
    const home = 5 * 12 + ((sector * 7 + hash) % 8) + 2;
    return {
        id: quest.id,
        name: quest.npcName,
        archetype: quest.npcName.includes("Mira") ? "pilgrim" : "sage",
        verb: "quest",
        level: quest.levelReq,
        homeTile: home,
        waypoints: [home],
        greeting: `${quest.npcName} waits at the village edge with unfinished business.`,
        tellTint: "#c084fc",
        avatarKey: quest.npcName.includes("Mira") ? "pilgrim" : "sage",
        avatarImage: defaultVnPortrait(quest.npcName) || undefined,
    };
}

function mapPages(pages: StoryReckoningPage[], acceptTrait: string): NonNullable<CreatorEvent["vnPages"]> {
    const last = pages.length - 1;
    return pages.map((page, index) => ({
        title: page.title,
        scene: page.scene,
        speaker: page.speaker,
        dialogue: page.dialogue,
        rightImage: defaultVnPortrait(page.speaker) || undefined,
        choices: index === last
            ? page.choices?.map((choice) => ({
                text: choice.text,
                nextPage: last,
                conclusion: choice.conclusion,
                trait: choice.accept ? acceptTrait : choice.trait,
                requireTrait: choice.requireTrait,
            }))
            : undefined,
    }));
}

export function storyReckoningIntroEvent(quest: StoryReckoning, biome: Biome): CreatorEvent {
    return {
        id: quest.id,
        name: quest.title,
        biome,
        icon: "SR",
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: quest.title,
        vnScene: quest.intro[0]?.scene ?? "",
        vnSpeaker: quest.npcName,
        avatarImage: defaultVnPortrait(quest.npcName) || undefined,
        image: `/scenes/story/${quest.id}.webp`,
        vnPages: mapPages(quest.intro, STORY_RECKONING_ACCEPT_TRAIT),
        levelReq: quest.levelReq,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: quest.intro.flatMap((page) => page.dialogue),
    };
}

export function storyReckoningPayoffEvent(quest: StoryReckoning, biome: Biome): CreatorEvent {
    return {
        id: `${quest.id}${STORY_RECKONING_RETURN_SUFFIX}`,
        name: `${quest.title} Reckoning`,
        biome,
        icon: "SR",
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: quest.title,
        vnScene: quest.payoff[0]?.scene ?? "",
        vnSpeaker: quest.npcName,
        avatarImage: defaultVnPortrait(quest.npcName) || undefined,
        image: `/scenes/story/${quest.id}${STORY_RECKONING_RETURN_SUFFIX}.webp`,
        vnPages: mapPages(quest.payoff, STORY_RECKONING_ABANDON_TRAIT),
        levelReq: quest.levelReq,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: quest.payoff.flatMap((page) => page.dialogue),
    };
}

type StoryReckoningResponse = {
    ok?: boolean;
    reason?: string;
    activeStoryReckoning?: Character["activeStoryReckoning"];
    dropItemId?: string;
    ryo?: number;
    totalRyo?: number;
    fateShards?: number;
    totalFateShards?: number;
    title?: string;
    questTitles?: string[];
    completionTrait?: string;
    progress?: number;
    target?: number;
    character?: Character;
    _saveVersion?: number;
};

async function postStoryReckoning(body: Record<string, unknown>): Promise<StoryReckoningResponse> {
    try {
        const res = await fetch("/api/sector/story-reckoning", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return (await res.json()) as StoryReckoningResponse;
    } catch {
        return { ok: false, reason: "offline" };
    }
}

export function acceptStoryReckoning(playerName: string, questId: string) {
    return postStoryReckoning({ action: "accept", playerName, questId });
}

export function reportStoryReckoning(playerName: string, questId: string) {
    return postStoryReckoning({ action: "report", playerName, questId });
}

export function turnInStoryReckoning(playerName: string, questId: string) {
    return postStoryReckoning({ action: "turn-in", playerName, questId });
}

export function abandonStoryReckoning(playerName: string) {
    return postStoryReckoning({ action: "abandon", playerName });
}
