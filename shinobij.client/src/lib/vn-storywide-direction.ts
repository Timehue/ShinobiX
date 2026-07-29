import type { CreatorEvent, VnCinematicDirection } from "../types/vn";

type VnPage = NonNullable<CreatorEvent["vnPages"]>[number];

export type StoryVillageKey = "stormveil" | "ashen" | "frostfang" | "moonshadow";
export type StorySceneFamily = "civic" | "intimate" | "threshold" | "sanctum";

export const STORYWIDE_ENVIRONMENTS: Record<StoryVillageKey, Record<StorySceneFamily, string>> = {
    stormveil: {
        civic: "/scenes/story/cinematic/storywide/stormveil-civic.webp",
        intimate: "/scenes/story/cinematic/storywide/stormveil-intimate.webp",
        threshold: "/scenes/story/cinematic/storywide/stormveil-threshold.webp",
        sanctum: "/scenes/story/cinematic/storywide/stormveil-sanctum.webp",
    },
    ashen: {
        civic: "/scenes/story/cinematic/storywide/ashen-civic.webp",
        intimate: "/scenes/story/cinematic/storywide/ashen-intimate.webp",
        threshold: "/scenes/story/cinematic/storywide/ashen-threshold.webp",
        sanctum: "/scenes/story/cinematic/storywide/ashen-sanctum.webp",
    },
    frostfang: {
        civic: "/scenes/story/cinematic/storywide/frostfang-civic.webp",
        intimate: "/scenes/story/cinematic/storywide/frostfang-intimate.webp",
        threshold: "/scenes/story/cinematic/storywide/frostfang-threshold.webp",
        sanctum: "/scenes/story/cinematic/storywide/frostfang-sanctum.webp",
    },
    moonshadow: {
        civic: "/scenes/story/cinematic/storywide/moonshadow-civic.webp",
        intimate: "/scenes/story/cinematic/storywide/moonshadow-intimate.webp",
        threshold: "/scenes/story/cinematic/storywide/moonshadow-threshold.webp",
        sanctum: "/scenes/story/cinematic/storywide/moonshadow-sanctum.webp",
    },
};

export const STORYWIDE_ACTORS: Record<string, string> = {
    "mira volt": "/portraits/cinematic/storywide/mira-volt.webp",
    "kage raiko veyr": "/portraits/cinematic/storywide/kage-raiko-veyr.webp",
    "raiko veyr": "/portraits/cinematic/storywide/kage-raiko-veyr.webp",
    "elder vanta": "/portraits/cinematic/storywide/elder-vanta.webp",
    "toma reed": "/portraits/cinematic/toma-reed.webp",
    "registry duty clerk": "/portraits/cinematic/registry-duty-clerk.webp",
    "elder mori": "/portraits/cinematic/elder-mori.webp",
    "kite harrow": "/portraits/cinematic/kite-harrow.webp",
    "kage hoshina enju": "/portraits/cinematic/storywide/kage-hoshina-enju.webp",
    "hoshina enju": "/portraits/cinematic/storywide/kage-hoshina-enju.webp",
    "captain yura": "/portraits/cinematic/storywide/captain-yura.webp",
    "kage kael whitefang": "/portraits/cinematic/storywide/kage-kael-whitefang.webp",
    "kael whitefang": "/portraits/cinematic/storywide/kage-kael-whitefang.webp",
    "elder sova": "/portraits/cinematic/storywide/elder-sova.webp",
    nyx: "/portraits/cinematic/storywide/nyx.webp",
    "kage sable nocturne": "/portraits/cinematic/storywide/kage-sable-nocturne.webp",
    "sable nocturne": "/portraits/cinematic/storywide/kage-sable-nocturne.webp",
    "shade-master iro": "/portraits/cinematic/storywide/shade-master-iro.webp",
    "shade master iro": "/portraits/cinematic/storywide/shade-master-iro.webp",
};

const FAMILY_KEYWORDS: Record<StorySceneFamily, readonly string[]> = {
    sanctum: [
        "altar", "buried", "cellar", "chamber", "cistern", "crypt", "engine", "glacier",
        "kiln", "mirror", "rootfire", "seal", "shrine", "underground", "vault",
    ],
    civic: [
        "archive", "council", "court", "desk", "hearing", "hall", "ledger", "office",
        "register", "registry", "roll", "tower",
    ],
    intimate: [
        "annex", "bedside", "clinic", "family", "home", "house", "infirmary", "kitchen",
        "library", "room", "sickbed", "workbench", "workshop",
    ],
    threshold: [
        "border", "bridge", "cliff", "coast", "dock", "gate", "market", "orchard", "pass",
        "path", "ridge", "road", "square", "steps", "street", "terrace", "trail", "yard",
    ],
};

const DEFAULT_FAMILY_CYCLE: readonly StorySceneFamily[] = ["civic", "intimate", "threshold", "sanctum"];

function normalizedStoryText(event: CreatorEvent, page: VnPage): string {
    return [
        event.id,
        event.name,
        event.village,
        event.vnTitle,
        event.vnScene,
        page.title,
        page.scene,
        page.speaker,
    ].filter(Boolean).join(" ").toLowerCase();
}

export function storyVillageKey(event: CreatorEvent, page?: VnPage): StoryVillageKey | null {
    const text = [
        event.id,
        event.name,
        event.village,
        event.vnTitle,
        event.vnScene,
        page?.title,
        page?.scene,
        page?.speaker,
    ].filter(Boolean).join(" ").toLowerCase();

    if (text.includes("stormveil") || text.includes("mira volt") || text.includes("raiko veyr") || text.includes("elder vanta")) return "stormveil";
    if (text.includes("ashen leaf") || text.includes("toma reed") || text.includes("hoshina enju") || text.includes("elder mori")) return "ashen";
    if (text.includes("frostfang") || text.includes("captain yura") || text.includes("kael whitefang") || text.includes("elder sova")) return "frostfang";
    if (text.includes("moonshadow") || text.includes("sable nocturne") || text.includes("shade-master iro") || /\bnyx\b/.test(text)) return "moonshadow";

    if (!event.id.startsWith("story-")) return null;
    if (event.biome === "forest") return "stormveil";
    if (event.biome === "volcano") return "ashen";
    if (event.biome === "snow") return "frostfang";
    if (event.biome === "shadow") return "moonshadow";
    return null;
}

export function resolveStorySceneFamily(event: CreatorEvent, page: VnPage, pageIndex: number): StorySceneFamily {
    const text = normalizedStoryText(event, page);
    for (const family of ["sanctum", "civic", "intimate", "threshold"] as const) {
        if (FAMILY_KEYWORDS[family].some((keyword) => text.includes(keyword))) return family;
    }
    return DEFAULT_FAMILY_CYCLE[Math.abs(pageIndex) % DEFAULT_FAMILY_CYCLE.length];
}

function villageDirection(village: StoryVillageKey, family: StorySceneFamily): VnCinematicDirection {
    const atmosphere = village === "ashen" ? "embers"
        : village === "frostfang" ? "snow"
            : village === "moonshadow" ? "mist"
                : "rain";
    const tone = village === "ashen" ? "warm"
        : village === "frostfang" ? "cold"
            : village === "moonshadow" ? "hollow"
                : "neutral";
    const ambience = family === "threshold" ? "village"
        : family === "sanctum" ? "hollow"
            : "interior";

    return {
        backgroundImage: STORYWIDE_ENVIRONMENTS[village][family],
        shot: family === "intimate" ? "medium" : family === "sanctum" ? "close" : "wide",
        focus: "speaker",
        backgroundMotion: family === "threshold" ? "pan-right" : family === "sanctum" ? "push" : "drift",
        backgroundPosition: "50% 50%",
        transition: "crossfade",
        tone: family === "sanctum" ? "danger" : tone,
        atmosphere,
        actorEntrance: "none",
        impact: "none",
        ambience,
        cue: "none",
    };
}

/**
 * Automatic story direction is intentionally a baseline. The chapter's
 * authored opening and ending paintings stay intact; reusable village scene
 * families stage the intermediate pages. Admin-authored event/page/line
 * direction is merged after this and always wins.
 */
export function resolveStorywideDirection(
    event: CreatorEvent,
    page: VnPage,
    pageIndex: number,
): VnCinematicDirection | undefined {
    if (!event.id.startsWith("story-")) return undefined;
    const pageCount = event.vnPages?.length ?? 1;
    const opening = pageIndex === 0;
    const ending = pageIndex === pageCount - 1;
    const village = storyVillageKey(event, page);

    if (opening || ending || !village) {
        return {
            shot: opening ? "wide" : "medium",
            focus: "speaker",
            backgroundMotion: opening ? "push" : "drift",
            transition: opening || ending ? "dip-black" : "crossfade",
            actorEntrance: opening ? "fade" : "none",
            titleCard: opening,
            ambience: opening ? "village" : "auto",
            cue: opening ? "title" : "none",
        };
    }

    return villageDirection(village, resolveStorySceneFamily(event, page, pageIndex));
}

export function isPremiumVnEvent(eventId: string): boolean {
    return eventId.startsWith("story-");
}

export function resolveStorywideActorImage(eventId: string, actorName: string): string | undefined {
    if (!isPremiumVnEvent(eventId)) return undefined;
    return STORYWIDE_ACTORS[actorName.trim().toLowerCase()];
}
