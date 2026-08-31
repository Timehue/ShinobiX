import { useState } from "react";
import { TriggeredVisualNovel } from "../../components/TriggeredVisualNovel";
import { storylines } from "../../data/storylines";
import { storyRoadEvents } from "../../data/story-road-events";
import { hollowRifts } from "../../data/hollow-rifts";
import { hiddenDungeonVnEvent } from "../../data/vn-events";
import { defaultAncientChestVn, defaultPetEncounterVn } from "../../data/default-vn-events";
import { storyToCreatorEvent } from "../../lib/story-trigger";
import { roadEventToCreatorEvent } from "../../lib/story-road-events";
import { riftIntroEvent } from "../../lib/hollow-rifts";
import { scribeIntroEvent } from "../../lib/chronicle-scribe";
import type { Character } from "../../types/character";
import type { CreatorEvent, VnActorPose } from "../../types/vn";
import type { StorySceneVariant, StoryVillageKey } from "../../lib/vn-storywide-direction";

type PreviewCast = {
    left: string;
    right: string;
};

const VILLAGES: readonly StoryVillageKey[] = ["stormveil", "ashen", "frostfang", "moonshadow"];
const VARIANTS: readonly StorySceneVariant[] = ["standard", "crisis", "aftermath"];
const CHAPTERS = ["semantic", "pale-pack", "road", "rift", "scribe", "dungeon", "pet", "chest"] as const;

const CAST: Record<StoryVillageKey, PreviewCast> = {
    stormveil: { left: "Mira Volt", right: "Kage Raiko Veyr" },
    ashen: { left: "Kage Hoshina Enju", right: "Toma Reed" },
    frostfang: { left: "Captain Yura", right: "Kage Kael Whitefang" },
    moonshadow: { left: "Nyx", right: "Kage Sable Nocturne" },
};

const HOLLOW_ACTORS: Record<StoryVillageKey, string> = {
    stormveil: "/portraits/cinematic/storywide/kage-raiko-veyr-hollow.webp",
    ashen: "/portraits/cinematic/storywide/kage-hoshina-enju-hollow-canon.webp",
    frostfang: "/portraits/cinematic/storywide/kage-kael-whitefang-hollow.webp",
    moonshadow: "/portraits/cinematic/storywide/kage-sable-nocturne-hollow.webp",
};

const VILLAGE_DETAILS: Record<StoryVillageKey, {
    eventId: string;
    name: string;
    biome: CreatorEvent["biome"];
}> = {
    stormveil: { eventId: "story-stormveil-village-preview", name: "Stormveil Village", biome: "forest" },
    ashen: { eventId: "story-ashen-leaf-village-preview", name: "Ashen Leaf Village", biome: "volcano" },
    frostfang: { eventId: "story-frostfang-village-preview", name: "Frostfang Village", biome: "snow" },
    moonshadow: { eventId: "story-moonshadow-village-preview", name: "Moonshadow Village", biome: "shadow" },
};

const PLAYER_AVATAR_SHAPES = ["none", "square", "wide", "tall"] as const;
type PlayerAvatarShape = typeof PLAYER_AVATAR_SHAPES[number];

function qaAvatar(shape: PlayerAvatarShape): string {
    if (shape === "none") return "";
    const dimensions = shape === "wide" ? [1200, 600] : shape === "tall" ? [700, 1200] : [900, 900];
    const [width, height] = dimensions;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#172334"/><circle cx="${width / 2}" cy="${height * .34}" r="${Math.min(width, height) * .19}" fill="#d7b18b"/><path d="M${width * .22} ${height} Q${width * .5} ${height * .5} ${width * .78} ${height}Z" fill="#315273"/><path d="M${width * .3} ${height * .27} Q${width * .5} ${height * .02} ${width * .7} ${height * .27} L${width * .61} ${height * .14} L${width * .48} ${height * .25} L${width * .4} ${height * .12}Z" fill="#0b1018"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function qaCharacter(shape: PlayerAvatarShape): Character {
    return {
        name: "QA Shinobi",
        avatarImage: qaAvatar(shape),
        storyTraits: [],
        pets: [],
    } as unknown as Character;
}

function parameter<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    const candidate = new URLSearchParams(window.location.search).get(name);
    return allowed.includes(candidate as T) ? candidate as T : fallback;
}

function semanticLine(variant: StorySceneVariant): string {
    if (variant === "crisis") {
        return "Alarm bells answer a blackout. The village is under attack, but the line still holds.";
    }
    if (variant === "aftermath") {
        return "After the battle, recovery crews repair the wreckage and count who returned.";
    }
    return "The civic hall keeps its composure while the village decides what the silence means.";
}

function actorPose(variant: StorySceneVariant): VnActorPose {
    if (variant === "crisis") return "tense";
    if (variant === "aftermath") return "injured";
    return "neutral";
}

function previewEvent(village: StoryVillageKey, variant: StorySceneVariant, hollow: boolean, playerAvatar: PlayerAvatarShape): CreatorEvent {
    const cast = CAST[village];
    const details = VILLAGE_DETAILS[village];
    const pose = actorPose(variant);
    const playerOnStage = playerAvatar !== "none";
    const leftName = playerOnStage ? "Player" : cast.left;
    const middlePage = {
        title: `${details.name} · ${variant}`,
        scene: "The civic hall, with clear foreground space for both speakers",
        speaker: leftName,
        dialogue: [
            semanticLine(variant),
            `${cast.right}: No one calls this victory. They call it the morning after and begin counting.`,
            `${leftName}: The record will be clean. The people who lived it will know better.`,
        ],
        leftName,
        rightName: cast.right,
        rightImage: hollow ? HOLLOW_ACTORS[village] : undefined,
        cinematic: {
            leftActorPose: pose,
            rightActorPose: pose,
            ambience: "none" as const,
            cue: "none" as const,
        },
    };

    return {
        // The Hollow variant represents a level-100 reckoning so it also
        // exercises the shared finale score route, not only the actor cutout.
        id: hollow ? details.eventId.replace("-preview", "-100-preview") : details.eventId,
        name: `${details.name} Cinematic QA`,
        biome: details.biome,
        village: details.name,
        icon: "◆",
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: "Cinematic Integration QA",
        vnScene: middlePage.scene,
        vnSpeaker: leftName,
        image: "",
        vnPages: [
            {
                ...middlePage,
                title: `${details.name} · opening`,
                dialogue: ["The chapter opens on the village."],
            },
            middlePage,
            {
                ...middlePage,
                title: `${details.name} · ending`,
                dialogue: ["The chapter closes without losing what happened here."],
            },
        ],
        levelReq: 1,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: middlePage.dialogue,
    };
}

function palePackEvent(): CreatorEvent {
    const chapters = storylines["Frostfang Village"] ?? [];
    const index = chapters.findIndex((chapter) => chapter.levelReq === 35);
    if (index < 0) throw new Error("Cinematic VN QA could not find The Pale Pack chapter");
    return storyToCreatorEvent(chapters[index], "Frostfang Village", index);
}

function sideStoryEvent(chapter: Exclude<typeof CHAPTERS[number], "semantic" | "pale-pack">): CreatorEvent {
    if (chapter === "road") {
        const road = storyRoadEvents.find((candidate) => candidate.id === "story-road-border-smoke");
        if (!road) throw new Error("Cinematic VN QA could not find Border Smoke");
        return roadEventToCreatorEvent(road, "forest");
    }
    if (chapter === "rift") {
        const rift = hollowRifts.find((candidate) => candidate.slug === "legacy-echo");
        if (!rift) throw new Error("Cinematic VN QA could not find Legacy Echo");
        return riftIntroEvent(rift, 20, "shadow");
    }
    if (chapter === "scribe") return scribeIntroEvent("forest");
    if (chapter === "pet") {
        const petImage = "/pet-poses/generic-ai-pet-guardhound-idle.webp";
        return {
            ...defaultPetEncounterVn,
            avatarImage: petImage,
            vnPages: defaultPetEncounterVn.vnPages?.map((page) => ({
                ...page,
                rightName: "Guard Hound",
                rightImage: petImage,
            })),
        };
    }
    if (chapter === "chest") return defaultAncientChestVn;
    return hiddenDungeonVnEvent;
}

export function CinematicVnPreview() {
    const village = parameter("village", VILLAGES, "moonshadow");
    const variant = parameter("state", VARIANTS, "crisis");
    const playerAvatar = parameter("avatar", PLAYER_AVATAR_SHAPES, "none");
    const chapter = parameter("chapter", CHAPTERS, "semantic");
    const hollow = new URLSearchParams(window.location.search).get("hollow") === "1";
    const initialPage = chapter === "pale-pack" ? 4 : chapter === "road" ? 1 : chapter === "semantic" ? 1 : 0;
    const [pageIndex, setPageIndex] = useState(initialPage);
    const [lineIndex, setLineIndex] = useState(0);
    const event = chapter === "pale-pack"
        ? palePackEvent()
        : chapter === "semantic"
            ? previewEvent(village, variant, hollow, playerAvatar)
            : sideStoryEvent(chapter);

    return (
        <TriggeredVisualNovel
            event={event}
            character={qaCharacter(playerAvatar)}
            pageIndex={pageIndex}
            lineIndex={lineIndex}
            setPageIndex={setPageIndex}
            setLineIndex={setLineIndex}
            onCancel={() => {
                setPageIndex(initialPage);
                setLineIndex(0);
            }}
            onComplete={() => {
                setPageIndex(initialPage);
                setLineIndex(0);
            }}
            onBattle={() => {}}
        />
    );
}
