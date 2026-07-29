import type { Biome } from "../types/core";
import type {
    CreatorEvent,
    VnActorEntrance,
    VnActorPose,
    VnAtmosphere,
    VnBackgroundMotion,
    VnCinematicDirection,
    VnFocus,
    VnImpact,
    VnShot,
    VnSoundCue,
    VnTone,
    VnTransition,
} from "../types/vn";
import { sanitizeVnDirection } from "./vn-cinematic-authoring";
import {
    isPremiumVnEvent,
    resolveStoryActorPose,
    resolveStorywideActorImage,
    resolveStorywideDirection,
} from "./vn-storywide-direction";

type VnPage = NonNullable<CreatorEvent["vnPages"]>[number];

export type ResolvedVnPresentation = {
    mode: "classic" | "cinematic";
    shot: VnShot;
    focus: VnFocus;
    backgroundMotion: Exclude<VnBackgroundMotion, "auto">;
    backgroundPosition: string;
    backgroundImage: string;
    transition: Exclude<VnTransition, "auto">;
    tone: VnTone;
    atmosphere: Exclude<VnAtmosphere, "auto">;
    actorEntrance: Exclude<VnActorEntrance, "auto">;
    leftActorPose: VnActorPose;
    rightActorPose: VnActorPose;
    impact: VnImpact;
    titleCard: boolean;
    ambience: Exclude<NonNullable<VnCinematicDirection["ambience"]>, "auto">;
    cue: VnSoundCue;
    premium: boolean;
};

type PilotPageDirection = VnCinematicDirection & {
    lineCues?: Record<number, VnSoundCue>;
    lineDirections?: Record<number, VnCinematicDirection>;
};

const ASHEN_CHAPTER_ID = "story-ashen-leaf-village-4-0";
const ASHEN_INTERLUDE_ID = "story-interlude-ashen-leaf-village-20";

const ASHEN_CHAPTER: Record<number, PilotPageDirection> = {
    0: {
        backgroundImage: "/scenes/story/cinematic/ashen-register-hall-wide.webp",
        shot: "wide",
        focus: "left",
        backgroundMotion: "push",
        backgroundPosition: "50% 48%",
        transition: "dip-black",
        tone: "warm",
        atmosphere: "embers",
        actorEntrance: "left",
        titleCard: true,
        ambience: "interior",
        cue: "title",
    },
    1: {
        backgroundImage: "/scenes/story/cinematic/ashen-register-wall.webp",
        shot: "detail",
        focus: "center",
        backgroundMotion: "push",
        backgroundPosition: "52% 48%",
        transition: "crossfade",
        tone: "warm",
        atmosphere: "motes",
        actorEntrance: "fade",
        ambience: "interior",
        cue: "none",
        lineCues: { 1: "paper" },
    },
    2: { backgroundImage: "/scenes/story/cinematic/ashen-register-wall.webp", shot: "medium", focus: "left", backgroundMotion: "drift", tone: "warm", atmosphere: "motes", ambience: "interior", cue: "none" },
    3: { backgroundImage: "/scenes/story/cinematic/ashen-register-wall.webp", shot: "medium", focus: "left", backgroundMotion: "drift", tone: "warm", atmosphere: "motes", ambience: "interior", cue: "none" },
    4: { backgroundImage: "/scenes/story/cinematic/ashen-register-wall.webp", shot: "medium", focus: "left", backgroundMotion: "drift", tone: "warm", atmosphere: "motes", ambience: "interior", cue: "none" },
    5: { backgroundImage: "/scenes/story/cinematic/ashen-register-wall.webp", shot: "medium", focus: "left", backgroundMotion: "drift", tone: "warm", atmosphere: "motes", ambience: "interior", cue: "none" },
    6: { backgroundImage: "/scenes/story/cinematic/ashen-register-wall.webp", shot: "medium", focus: "left", backgroundMotion: "drift", tone: "warm", atmosphere: "motes", ambience: "interior", cue: "none" },
    7: {
        backgroundImage: "/scenes/story/cinematic/ashen-register-wall.webp",
        shot: "medium",
        focus: "center",
        backgroundMotion: "push",
        backgroundPosition: "50% 55%",
        transition: "dip-black",
        tone: "cold",
        atmosphere: "motes",
        actorEntrance: "fade",
        ambience: "hollow",
        cue: "none",
        lineCues: { 2: "reveal" },
        lineDirections: {
            2: {
                backgroundImage: "/scenes/story/cinematic/ashen-black-flower-reveal.webp",
                shot: "close",
                tone: "hollow",
                atmosphere: "embers",
                impact: "soft",
                transition: "dip-black",
            },
        },
    },
    8: {
        backgroundImage: "/scenes/story/cinematic/ashen-black-flower-reveal.webp",
        shot: "medium",
        focus: "left",
        backgroundMotion: "pan-right",
        backgroundPosition: "48% 52%",
        transition: "crossfade",
        tone: "elegy",
        atmosphere: "embers",
        actorEntrance: "rise",
        ambience: "hollow",
        cue: "none",
    },
    9: {
        backgroundImage: "/scenes/story/cinematic/ashen-old-grove-trial.webp",
        shot: "wide",
        focus: "center",
        backgroundMotion: "push",
        backgroundPosition: "50% 52%",
        transition: "dip-black",
        tone: "danger",
        atmosphere: "embers",
        actorEntrance: "left",
        ambience: "village",
        cue: "battle",
    },
};

const ASHEN_INTERLUDE: Record<number, PilotPageDirection> = {
    0: {
        backgroundImage: "/scenes/story/cinematic/ashen-register-annex.webp",
        shot: "wide",
        focus: "left",
        backgroundMotion: "push",
        backgroundPosition: "52% 48%",
        transition: "dip-black",
        tone: "warm",
        atmosphere: "embers",
        actorEntrance: "left",
        titleCard: true,
        ambience: "interior",
        cue: "title",
    },
    1: {
        backgroundImage: "/scenes/story/cinematic/ashen-register-annex.webp",
        shot: "medium",
        focus: "right",
        backgroundMotion: "drift",
        backgroundPosition: "48% 48%",
        transition: "crossfade",
        tone: "warm",
        atmosphere: "motes",
        actorEntrance: "right",
        ambience: "interior",
        cue: "none",
        lineCues: { 3: "omen" },
        lineDirections: {
            3: {
                backgroundImage: "/scenes/story/cinematic/ashen-annex-charts.webp",
                focus: "center",
                backgroundMotion: "pan-left",
                tone: "cold",
                impact: "soft",
            },
            4: {
                backgroundImage: "/scenes/story/cinematic/ashen-annex-charts.webp",
                focus: "center",
                backgroundMotion: "pan-left",
                tone: "cold",
            },
        },
    },
    2: {
        backgroundImage: "/scenes/story/cinematic/ashen-annex-steps.webp",
        shot: "wide",
        focus: "left",
        backgroundMotion: "drift",
        backgroundPosition: "50% 50%",
        transition: "crossfade",
        tone: "elegy",
        atmosphere: "embers",
        actorEntrance: "left",
        ambience: "village",
        cue: "none",
    },
};

function pilotDirection(eventId: string, pageIndex: number): PilotPageDirection | undefined {
    if (eventId === ASHEN_CHAPTER_ID) return ASHEN_CHAPTER[pageIndex];
    if (eventId === ASHEN_INTERLUDE_ID) return ASHEN_INTERLUDE[pageIndex];
    return undefined;
}

function atmosphereFor(biome: Biome): Exclude<VnAtmosphere, "auto"> {
    if (biome === "volcano") return "embers";
    if (biome === "snow") return "snow";
    if (biome === "shadow") return "mist";
    if (biome === "forest") return "rain";
    return "motes";
}

function toneFor(biome: Biome): VnTone {
    if (biome === "volcano") return "warm";
    if (biome === "snow") return "cold";
    if (biome === "shadow") return "hollow";
    return "neutral";
}

function automaticMotion(pageIndex: number): Exclude<VnBackgroundMotion, "auto"> {
    return (["push", "pan-left", "drift", "pan-right"] as const)[Math.abs(pageIndex) % 4];
}

function resolveAuto<T>(value: T | "auto" | undefined, fallback: T): T {
    return value === undefined || value === "auto" ? fallback : value;
}

export function resolveVnPresentation(input: {
    event: CreatorEvent;
    page: VnPage;
    pageIndex: number;
    lineIndex: number;
    speaker: string;
    speakingSide: "left" | "right" | null;
    pageImage: string;
    choicePoint?: boolean;
    reducedMotion?: boolean;
    liteFx?: boolean;
}): ResolvedVnPresentation {
    const {
        event,
        page,
        pageIndex,
        lineIndex,
        speakingSide,
        pageImage,
        choicePoint = false,
        reducedMotion = false,
        liteFx = false,
    } = input;
    const pilot = pilotDirection(event.id, pageIndex);
    const pilotLine = pilot?.lineDirections?.[lineIndex];
    const storywide = resolveStorywideDirection(event, page, pageIndex);
    const pageAuthored = sanitizeVnDirection({
        ...storywide,
        ...pilot,
        ...event.cinematic,
        ...page.cinematic,
    });
    const authored = sanitizeVnDirection({
        ...pageAuthored,
        ...pilotLine,
        ...page.lines?.[lineIndex]?.cinematic,
    });
    const lineCue = pilot?.lineCues?.[lineIndex];
    const mode = authored.mode === "classic" ? "classic" : "cinematic";
    const focus: VnFocus = authored.focus === "speaker"
        ? (speakingSide ?? "center")
        : (authored.focus ?? speakingSide ?? "center");
    const backgroundMotion = reducedMotion || liteFx
        ? "none"
        : resolveAuto(authored.backgroundMotion, automaticMotion(pageIndex));
    const atmosphere = reducedMotion || liteFx
        ? "none"
        : resolveAuto(authored.atmosphere, atmosphereFor(event.biome));
    const transition = reducedMotion
        ? "crossfade"
        : resolveAuto(authored.transition, pageIndex === 0 ? "dip-black" : "crossfade");
    const actorEntrance = reducedMotion
        ? "fade"
        : resolveAuto(authored.actorEntrance, pageIndex === 0 ? "fade" : "none");
    const automaticActorPose = isPremiumVnEvent(event.id)
        ? resolveStoryActorPose(event, page)
        : "neutral";

    return {
        mode,
        shot: authored.shot ?? (pageIndex === 0 ? "wide" : "medium"),
        focus,
        backgroundMotion,
        backgroundPosition: authored.backgroundPosition ?? "50% 50%",
        backgroundImage: authored.backgroundImage ?? pageImage,
        transition,
        tone: authored.tone ?? toneFor(event.biome),
        atmosphere,
        actorEntrance,
        // Actor art is intentionally locked at page scope. A line may change
        // camera, grade, or impact, but it never causes a cutout to flicker.
        leftActorPose: pageAuthored.leftActorPose ?? automaticActorPose,
        rightActorPose: pageAuthored.rightActorPose ?? automaticActorPose,
        impact: reducedMotion ? "none" : (authored.impact ?? "none"),
        titleCard: Boolean(authored.titleCard ?? pageIndex === 0),
        ambience: resolveAuto(authored.ambience, event.id.startsWith("story-road-") ? "road" : "village"),
        cue: choicePoint ? "decision" : (lineCue ?? authored.cue ?? "none"),
        premium: isPremiumVnEvent(event.id),
    };
}

export function resolveCinematicActorImage(
    eventId: string,
    actorName: string,
    fallback: string,
    pose: VnActorPose = "neutral",
    authoredImage?: string,
): string {
    // A page-specific actor image is deliberate story direction (not a generic
    // fallback). Preserve transformations such as the Hollow Kage finales and
    // admin-published actor overrides.
    return authoredImage?.trim()
        || resolveStorywideActorImage(eventId, actorName, pose)
        || fallback;
}
