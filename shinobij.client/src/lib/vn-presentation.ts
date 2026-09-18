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
import { secondaryVnActorImage, secondaryVnActorPose } from './vn-secondary-artwork';
import { resolveVnArtworkBackground, vnArtworkFocalPoint } from "./vn-artwork";
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
                backgroundImage: "/scenes/story/cinematic/ashen-black-flower-reveal-v2.webp",
                shot: "close",
                tone: "hollow",
                atmosphere: "embers",
                impact: "soft",
                transition: "dip-black",
            },
        },
    },
    8: {
        backgroundImage: "/scenes/story/cinematic/ashen-black-flower-reveal-v2.webp",
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

function pilotArtworkDirection(eventId: string, page: VnPage): PilotPageDirection | undefined {
    // Story Hall removes unchosen pages. A replay's array offset is therefore
    // not the original story beat, and must never reveal art from that offset.
    const titles = eventId === ASHEN_CHAPTER_ID
        ? ["The Register Hall", "The Fourth Question", "A Protector", "The Strongest", "A Builder", "A Seeker", "Not Yet", "The Black Flower", "Elder Mori", "The Grove Trial"]
        : eventId === ASHEN_INTERLUDE_ID ? ["The Appraiser", "Kite Harrow", "The Refund"] : [];
    const index = titles.indexOf(page.title);
    return index < 0 ? undefined : pilotDirection(eventId, index);
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
    const artworkPilot = pilotArtworkDirection(event.id, page);
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
    const swapped = page.rightName?.trim().toLowerCase() === "player";
    const leftName = swapped ? "Player" : page.leftName || "Player";
    const rightName = swapped ? page.leftName || page.speaker : page.rightName || page.speaker;
    const automaticPose = (name: string) => secondaryVnActorPose(event.id, page.title, name)
        ?? (isPremiumVnEvent(event.id) ? resolveStoryActorPose(event, page, name) : "neutral");
    const backgroundImage = resolveVnArtworkBackground({ event, page, lineIndex, pageImage,
        inferredImage: storywide?.backgroundImage,
        pilotImage: artworkPilot?.lineDirections?.[lineIndex]?.backgroundImage ?? artworkPilot?.backgroundImage });

    return {
        mode,
        shot: authored.shot ?? (pageIndex === 0 ? "wide" : "medium"),
        focus,
        backgroundMotion,
        backgroundPosition: page.lines?.[lineIndex]?.cinematic?.backgroundPosition
            ?? page.cinematic?.backgroundPosition ?? event.cinematic?.backgroundPosition
            ?? vnArtworkFocalPoint(backgroundImage, event.id) ?? authored.backgroundPosition ?? "50% 50%",
        backgroundImage,
        transition,
        tone: authored.tone ?? toneFor(event.biome),
        atmosphere,
        actorEntrance,
        // Actor art is intentionally locked at page scope. A line may change
        // camera, grade, or impact, but it never causes a cutout to flicker.
        leftActorPose: (swapped ? pageAuthored.rightActorPose : pageAuthored.leftActorPose) ?? automaticPose(leftName),
        rightActorPose: (swapped ? pageAuthored.leftActorPose : pageAuthored.rightActorPose) ?? automaticPose(rightName),
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
    const resolved = authoredImage?.trim()
        || resolveStorywideActorImage(eventId, actorName, pose)
        || fallback;
    return versionCinematicActorAsset(authoredImage?.trim() ? resolved : secondaryVnActorImage(eventId, actorName, resolved, pose));
}

/**
 * Cinematic portraits live under public/ rather than Vite's content-hashed
 * asset graph. Production and the image service worker both cache those URLs,
 * so replacing a cutout in place can otherwise leave players on the old matte
 * for days. Bump this revision whenever any cinematic portrait bytes change.
 */
export const CINEMATIC_ACTOR_ASSET_REVISION = "891202c8e";

export function versionCinematicActorAsset(source: string): string {
    const trimmed = source.trim();
    if (!trimmed.startsWith("/portraits/cinematic/")) return source;

    const hashIndex = trimmed.indexOf("#");
    const pathAndQuery = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
    const hash = hashIndex >= 0 ? trimmed.slice(hashIndex) : "";
    if (/[?&]v=[^&#]*/.test(pathAndQuery)) {
        return `${pathAndQuery.replace(/[?&]v=[^&#]*/, (match) => `${match[0]}v=${CINEMATIC_ACTOR_ASSET_REVISION}`)}${hash}`;
    }
    const separator = pathAndQuery.includes("?") ? "&" : "?";
    return `${pathAndQuery}${separator}v=${CINEMATIC_ACTOR_ASSET_REVISION}${hash}`;
}
