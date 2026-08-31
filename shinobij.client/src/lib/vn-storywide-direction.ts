import type { CreatorEvent, VnActorPose, VnCinematicDirection } from "../types/vn";

type VnPage = NonNullable<CreatorEvent["vnPages"]>[number];

export type StoryVillageKey = "stormveil" | "ashen" | "frostfang" | "moonshadow";
export type StorySceneFamily = "civic" | "intimate" | "threshold" | "sanctum";
export type StorySceneVariant = "standard" | "crisis" | "aftermath";

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

export const STORYWIDE_ENVIRONMENT_VARIANTS: Record<
    StoryVillageKey,
    Record<Exclude<StorySceneVariant, "standard">, string>
> = {
    stormveil: {
        crisis: "/scenes/story/cinematic/storywide/stormveil-blackout.webp",
        aftermath: "/scenes/story/cinematic/storywide/stormveil-aftermath.webp",
    },
    ashen: {
        crisis: "/scenes/story/cinematic/storywide/ashen-ashfall.webp",
        aftermath: "/scenes/story/cinematic/storywide/ashen-aftermath.webp",
    },
    frostfang: {
        crisis: "/scenes/story/cinematic/storywide/frostfang-whiteout.webp",
        aftermath: "/scenes/story/cinematic/storywide/frostfang-aftermath.webp",
    },
    moonshadow: {
        crisis: "/scenes/story/cinematic/storywide/moonshadow-blackout.webp",
        aftermath: "/scenes/story/cinematic/storywide/moonshadow-aftermath.webp",
    },
};

export const STORYWIDE_CLIMAX_ENVIRONMENTS: Record<StoryVillageKey, string> = {
    stormveil: "/scenes/story/cinematic/storywide/stormveil-climax-blank-board.webp",
    ashen: "/scenes/story/cinematic/storywide/ashen-climax-rootfire.webp",
    frostfang: "/scenes/story/cinematic/storywide/frostfang-climax-meter-zero.webp",
    moonshadow: "/scenes/story/cinematic/storywide/moonshadow-climax-black-glass.webp",
};

export const STORYWIDE_ACTORS: Record<string, string> = {
    "mira volt": "/portraits/cinematic/storywide/mira-volt.webp",
    "kage raiko veyr": "/portraits/cinematic/storywide/kage-raiko-veyr.webp",
    "raiko veyr": "/portraits/cinematic/storywide/kage-raiko-veyr.webp",
    "elder vanta": "/portraits/cinematic/storywide/elder-vanta.webp",
    "ledger clerk": "/portraits/cinematic/storywide/ledger-clerk.webp",
    "tempest guard captain": "/portraits/cinematic/storywide/tempest-guard-captain.webp",
    "joren pike": "/portraits/cinematic/storywide/joren-pike.webp",
    "rebel medic": "/portraits/cinematic/storywide/rebel-medic.webp",
    "toma reed": "/portraits/cinematic/toma-reed.webp",
    "registry duty clerk": "/portraits/cinematic/registry-duty-clerk.webp",
    "elder mori": "/portraits/cinematic/elder-mori.webp",
    "kite harrow": "/portraits/cinematic/kite-harrow.webp",
    imera: "/portraits/cinematic/storywide/imera.webp",
    "sera reed": "/portraits/cinematic/storywide/sera-reed.webp",
    "first flame avatar": "/portraits/cinematic/storywide/first-flame-avatar.webp",
    "kage hoshina enju": "/portraits/cinematic/storywide/kage-hoshina-enju-canon.webp",
    "hoshina enju": "/portraits/cinematic/storywide/kage-hoshina-enju-canon.webp",
    "captain yura": "/portraits/cinematic/storywide/captain-yura.webp",
    // The legacy tall cutout depicts a different character; keep the verified
    // canonical runner portrait in both classic and cinematic story readers.
    "pale pack runner": "/portraits/pale-pack-runner.webp",
    "frost seal echo": "/portraits/cinematic/storywide/frost-seal-echo.webp",
    "seal-keeper vess": "/portraits/cinematic/storywide/seal-keeper-vess.webp",
    "kage kael whitefang": "/portraits/cinematic/storywide/kage-kael-whitefang.webp",
    "kael whitefang": "/portraits/cinematic/storywide/kage-kael-whitefang.webp",
    "elder sova": "/portraits/cinematic/storywide/elder-sova-canon.webp",
    nyx: "/portraits/cinematic/storywide/nyx.webp",
    "hollow moon": "/portraits/cinematic/storywide/hollow-moon.webp",
    "veil adaza": "/portraits/cinematic/storywide/veil-adaza.webp",
    "shrine witness": "/portraits/cinematic/storywide/shrine-witness.webp",
    "veiled hand collector": "/portraits/cinematic/storywide/veiled-hand-collector.webp",
    "kage sable nocturne": "/portraits/cinematic/storywide/kage-sable-nocturne.webp",
    "sable nocturne": "/portraits/cinematic/storywide/kage-sable-nocturne.webp",
    "shade-master iro": "/portraits/cinematic/storywide/shade-master-iro.webp",
    "shade master iro": "/portraits/cinematic/storywide/shade-master-iro.webp",
};

export const STORYWIDE_ACTOR_VARIANTS: Record<string, Partial<Record<VnActorPose, string>>> = {
    "mira volt": {
        neutral: "/portraits/cinematic/storywide/mira-volt-neutral.webp",
        tense: STORYWIDE_ACTORS["mira volt"],
        grieving: "/portraits/cinematic/storywide/mira-volt-grieving.webp",
    },
    "toma reed": {
        resolute: "/portraits/cinematic/storywide/toma-reed-resolute.webp",
    },
    "elder vanta": {
        solemn: "/portraits/cinematic/storywide/elder-vanta-solemn.webp",
    },
    "elder mori": {
        solemn: "/portraits/cinematic/storywide/elder-mori-solemn.webp",
    },
    "kage hoshina enju": {
        tense: "/portraits/cinematic/storywide/kage-hoshina-enju-tense-canon.webp",
    },
    "hoshina enju": {
        tense: "/portraits/cinematic/storywide/kage-hoshina-enju-tense-canon.webp",
    },
    "captain yura": {
        injured: "/portraits/cinematic/storywide/captain-yura-injured.webp",
        defiant: "/portraits/cinematic/storywide/captain-yura-defiant.webp",
    },
    "elder sova": {
        solemn: "/portraits/cinematic/storywide/elder-sova-solemn-canon.webp",
    },
    nyx: {
        neutral: "/portraits/cinematic/storywide/nyx-neutral.webp",
        tense: STORYWIDE_ACTORS.nyx,
        resolute: "/portraits/cinematic/storywide/nyx-resolute.webp",
    },
    "kage sable nocturne": {
        neutral: "/portraits/cinematic/storywide/kage-sable-nocturne-readable.webp",
        tense: "/portraits/cinematic/storywide/kage-sable-nocturne-readable.webp",
    },
    "sable nocturne": {
        neutral: "/portraits/cinematic/storywide/kage-sable-nocturne-readable.webp",
        tense: "/portraits/cinematic/storywide/kage-sable-nocturne-readable.webp",
    },
    "shade-master iro": {
        tense: "/portraits/cinematic/storywide/shade-master-iro-tense.webp",
        solemn: "/portraits/cinematic/storywide/shade-master-iro-solemn.webp",
    },
    "shade master iro": {
        tense: "/portraits/cinematic/storywide/shade-master-iro-tense.webp",
        solemn: "/portraits/cinematic/storywide/shade-master-iro-solemn.webp",
    },
};

/*
 * Hand-authored hero beats. Ordinary pages use a quiet, mostly static baseline;
 * these pages earn the camera move, impact, semantic cue, and expression swap.
 */
export const MAJOR_STORY_DIRECTIONS: Readonly<Record<string, VnCinematicDirection>> = {
    "stormveil:the kage in the square": { shot: "wide", focus: "left", backgroundMotion: "push", transition: "crossfade", tone: "warm", atmosphere: "rain", impact: "soft", cue: "reveal" },
    "stormveil:vanta reads the wax": { shot: "detail", focus: "left", backgroundMotion: "none", tone: "elegy", atmosphere: "rain", leftActorPose: "solemn", cue: "paper" },
    "stormveil:eleven pipes": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "dip-black", tone: "hollow", atmosphere: "motes", impact: "soft", cue: "reveal" },
    "stormveil:the missing chalk line": { shot: "close", focus: "left", backgroundMotion: "none", tone: "elegy", atmosphere: "motes", cue: "reveal" },
    "stormveil:the rescued slates": { shot: "wide", focus: "center", backgroundMotion: "drift", tone: "elegy", atmosphere: "rain", leftActorPose: "grieving", cue: "paper" },
    "stormveil:the routing mark": { shot: "detail", focus: "center", backgroundMotion: "push", tone: "danger", atmosphere: "rain", cue: "omen" },
    "stormveil:fees waived": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "dip-black", tone: "danger", atmosphere: "rain", titleCard: true, cue: "omen" },
    "stormveil:the surge valve": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "whip", tone: "danger", atmosphere: "rain", impact: "heavy", cue: "battle" },
    "stormveil:the village climbs": { shot: "wide", focus: "center", backgroundMotion: "pan-right", transition: "dip-black", tone: "elegy", atmosphere: "rain", titleCard: true, cue: "title" },
    "stormveil:the man becoming weather": { shot: "close", focus: "left", backgroundMotion: "push", tone: "danger", atmosphere: "rain", leftActorPose: "tense", impact: "soft", cue: "reveal" },
    "stormveil:her daughter says the why": { shot: "close", focus: "left", backgroundMotion: "none", transition: "crossfade", tone: "elegy", atmosphere: "rain", leftActorPose: "grieving", cue: "reveal" },
    "stormveil:vanta opens the books": { shot: "medium", focus: "left", backgroundMotion: "drift", tone: "elegy", atmosphere: "rain", leftActorPose: "solemn", cue: "paper" },
    "stormveil:the blank board": { backgroundImage: STORYWIDE_CLIMAX_ENVIRONMENTS.stormveil, shot: "wide", focus: "center", backgroundMotion: "push", transition: "whiteout", tone: "danger", atmosphere: "rain", rightActorPose: "tense", impact: "heavy", cue: "battle" },

    "ashen:mori counts": { shot: "detail", focus: "left", backgroundMotion: "none", tone: "elegy", atmosphere: "motes", leftActorPose: "solemn", cue: "paper" },
    "ashen:aren reed": { shot: "close", focus: "left", backgroundMotion: "none", tone: "elegy", atmosphere: "motes", leftActorPose: "resolute", cue: "reveal" },
    "ashen:the second feeding": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "dip-black", tone: "hollow", atmosphere: "embers", impact: "soft", cue: "omen" },
    "ashen:the question": { shot: "close", focus: "left", backgroundMotion: "none", tone: "elegy", atmosphere: "motes", leftActorPose: "tense", cue: "reveal" },
    "ashen:the manifest under the ash": { shot: "detail", focus: "center", backgroundMotion: "none", tone: "cold", atmosphere: "embers", cue: "paper" },
    "ashen:the bellows": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "dip-black", tone: "danger", atmosphere: "embers", impact: "soft", cue: "omen" },
    "ashen:the detainment lists": { shot: "wide", focus: "left", backgroundMotion: "push", transition: "dip-black", tone: "danger", atmosphere: "embers", titleCard: true, cue: "omen" },
    "ashen:the detention rows": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "whip", tone: "danger", atmosphere: "embers", impact: "heavy", cue: "battle" },
    "ashen:frost-fall": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "dip-black", tone: "elegy", atmosphere: "embers", titleCard: true, cue: "title" },
    "ashen:the vessel": { shot: "close", focus: "left", backgroundMotion: "push", tone: "danger", atmosphere: "embers", leftActorPose: "tense", impact: "soft", cue: "reveal" },
    "ashen:this part is ours": { shot: "close", focus: "left", backgroundMotion: "none", tone: "warm", atmosphere: "motes", leftActorPose: "resolute", cue: "reveal" },
    "ashen:mori reads the pattern": { shot: "medium", focus: "left", backgroundMotion: "drift", tone: "elegy", atmosphere: "embers", leftActorPose: "solemn", cue: "paper" },
    "ashen:the shears on the anvil": { backgroundImage: STORYWIDE_CLIMAX_ENVIRONMENTS.ashen, shot: "wide", focus: "center", backgroundMotion: "push", transition: "whiteout", tone: "danger", atmosphere: "embers", rightActorPose: "tense", impact: "heavy", cue: "battle" },

    "frostfang:the corrected man": { shot: "close", focus: "left", backgroundMotion: "push", tone: "cold", atmosphere: "snow", impact: "soft", cue: "reveal" },
    "frostfang:the deep script": { shot: "detail", focus: "center", backgroundMotion: "push", tone: "hollow", atmosphere: "snow", cue: "reveal" },
    "frostfang:the struck names": { backgroundImage: "/scenes/story/cinematic/storywide/frostfang-pale-pack-cavern-interior.webp", shot: "wide", focus: "right", backgroundMotion: "push", backgroundPosition: "50% 50%", transition: "dip-black", tone: "warm", atmosphere: "motes", actorEntrance: "fade", ambience: "interior", cue: "title" },
    "frostfang:yura's roster-mate": { backgroundImage: "/scenes/story/cinematic/storywide/frostfang-pale-pack-cavern-interior.webp", shot: "medium", focus: "right", backgroundMotion: "none", backgroundPosition: "48% 50%", transition: "crossfade", tone: "elegy", atmosphere: "motes", actorEntrance: "none", ambience: "interior", cue: "reveal" },
    "frostfang:returned to the count": { backgroundImage: "/scenes/story/cinematic/storywide/frostfang-pale-pack-cavern-mouth.webp", shot: "wide", focus: "center", backgroundMotion: "push", backgroundPosition: "50% 48%", transition: "dip-black", tone: "danger", atmosphere: "snow", ambience: "road", cue: "omen" },
    "frostfang:the captain's arithmetic": { backgroundImage: "/scenes/story/cinematic/storywide/frostfang-pale-pack-cavern-mouth.webp", shot: "close", focus: "right", backgroundMotion: "none", backgroundPosition: "47% 48%", transition: "crossfade", tone: "elegy", atmosphere: "snow", actorEntrance: "none", ambience: "road", cue: "reveal" },
    "frostfang:one bell": { backgroundImage: "/scenes/story/cinematic/storywide/frostfang-pale-pack-cavern-mouth.webp", shot: "wide", focus: "right", backgroundMotion: "push", backgroundPosition: "50% 48%", transition: "dip-black", tone: "danger", atmosphere: "snow", actorEntrance: "fade", impact: "soft", ambience: "road", cue: "decision" },
    "frostfang:the pen gets lighter": { shot: "close", focus: "left", backgroundMotion: "none", tone: "elegy", atmosphere: "motes", leftActorPose: "defiant", cue: "reveal" },
    "frostfang:the confiscated kits": { shot: "detail", focus: "left", backgroundMotion: "drift", tone: "elegy", atmosphere: "snow", leftActorPose: "injured", cue: "paper" },
    "frostfang:self-injury, filed": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "dip-black", tone: "danger", atmosphere: "snow", impact: "soft", cue: "omen" },
    "frostfang:the white silence": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "dip-black", tone: "cold", atmosphere: "snow", titleCard: true, cue: "omen" },
    "frostfang:the alpha guard": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "whip", tone: "danger", atmosphere: "snow", impact: "heavy", cue: "battle" },
    "frostfang:the open ledgers": { shot: "wide", focus: "center", backgroundMotion: "pan-left", transition: "dip-black", tone: "cold", atmosphere: "snow", titleCard: true, cue: "title" },
    "frostfang:the man fused to the door": { shot: "close", focus: "left", backgroundMotion: "push", tone: "danger", atmosphere: "snow", leftActorPose: "tense", impact: "soft", cue: "reveal" },
    "frostfang:she answers his roll": { shot: "close", focus: "left", backgroundMotion: "none", tone: "cold", atmosphere: "snow", leftActorPose: "defiant", cue: "reveal" },
    "frostfang:the litany, backwards": { shot: "medium", focus: "left", backgroundMotion: "drift", tone: "elegy", atmosphere: "snow", leftActorPose: "solemn", cue: "paper" },
    "frostfang:the meter at zero": { backgroundImage: STORYWIDE_CLIMAX_ENVIRONMENTS.frostfang, shot: "wide", focus: "center", backgroundMotion: "push", transition: "whiteout", tone: "danger", atmosphere: "snow", rightActorPose: "tense", impact: "heavy", cue: "battle" },

    "moonshadow:the kage's mercy": { shot: "close", focus: "left", backgroundMotion: "none", tone: "elegy", atmosphere: "motes", cue: "reveal" },
    "moonshadow:the prepaid buyer": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "dip-black", tone: "hollow", atmosphere: "mist", cue: "omen" },
    "moonshadow:the counterparty": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "dip-black", tone: "hollow", atmosphere: "mist", impact: "soft", cue: "reveal" },
    "moonshadow:the report she kept": { shot: "detail", focus: "left", backgroundMotion: "none", tone: "elegy", atmosphere: "motes", cue: "paper" },
    "moonshadow:the copied names": { shot: "detail", focus: "center", backgroundMotion: "drift", tone: "elegy", atmosphere: "mist", cue: "paper" },
    "moonshadow:naming it": { shot: "close", focus: "left", backgroundMotion: "none", tone: "elegy", atmosphere: "motes", leftActorPose: "resolute", cue: "reveal" },
    "moonshadow:the night of open files": { shot: "wide", focus: "center", backgroundMotion: "pan-right", transition: "dip-black", tone: "hollow", atmosphere: "mist", titleCard: true, cue: "omen" },
    "moonshadow:the veiled hand grandmaster": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "whip", tone: "danger", atmosphere: "mist", impact: "heavy", cue: "battle" },
    "moonshadow:the black moon": { shot: "wide", focus: "center", backgroundMotion: "push", transition: "dip-black", tone: "hollow", atmosphere: "mist", titleCard: true, cue: "title" },
    "moonshadow:the woman and the tank": { shot: "close", focus: "left", backgroundMotion: "push", tone: "hollow", atmosphere: "mist", leftActorPose: "tense", impact: "soft", cue: "reveal" },
    "moonshadow:her own name": { shot: "close", focus: "left", backgroundMotion: "none", tone: "elegy", atmosphere: "motes", leftActorPose: "resolute", cue: "reveal" },
    "moonshadow:iro reads the manifest": { shot: "medium", focus: "left", backgroundMotion: "drift", tone: "elegy", atmosphere: "mist", leftActorPose: "solemn", cue: "paper" },
    "moonshadow:the glass and the notice": { backgroundImage: STORYWIDE_CLIMAX_ENVIRONMENTS.moonshadow, shot: "wide", focus: "center", backgroundMotion: "push", transition: "whiteout", tone: "danger", atmosphere: "mist", rightActorPose: "tense", impact: "heavy", cue: "battle" },
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
        ...page.dialogue,
        ...(page.lines?.map((line) => line.text) ?? []),
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

const AFTERMATH_PATTERNS = [
    /\baftermath\b/,
    /\bafter (?:the )?(?:attack|battle|blizzard|breach|fight|fire|siege|storm)\b/,
    /\b(?:rebuild|rebuilding|recovery|repair|ruins?|wreckage)\b/,
    /\b(?:battle|storm|siege) (?:is|was) over\b/,
] as const;

const CRISIS_PATTERNS = [
    /\b(?:alarm|ambush|ashfall|attack|battle|blackout|blizzard|breach|eruption|execution|fire|invasion|siege|storm|whiteout)\b/,
    /\bunder attack\b/,
    /\b(?:burning|collapsing|evacuate|evacuation)\b/,
] as const;

const INJURY_PATTERNS = [
    /\b(?:bandaged|bleeding|bloodied|bruised|hurt|injured|limping|scarred|wounded)\b/,
    /\b(?:broken|cracked) (?:arm|bone|rib|shoulder)\b/,
] as const;

const TENSION_PATTERNS = [
    ...CRISIS_PATTERNS,
    /\b(?:betrayal|danger|duel|enemy|executioner|fight|guardian|hostage|kill|threat|trial)\b/,
    /\bweapons? drawn\b/,
] as const;

export function resolveStorySceneVariant(event: CreatorEvent, page: VnPage): StorySceneVariant {
    const text = normalizedStoryText(event, page);
    if (AFTERMATH_PATTERNS.some((pattern) => pattern.test(text))) return "aftermath";
    if (CRISIS_PATTERNS.some((pattern) => pattern.test(text))) return "crisis";
    return "standard";
}

export function resolveStoryActorPose(event: CreatorEvent, page: VnPage): VnActorPose {
    const text = normalizedStoryText(event, page);
    if (INJURY_PATTERNS.some((pattern) => pattern.test(text))) return "injured";
    if (TENSION_PATTERNS.some((pattern) => pattern.test(text))) return "tense";
    return "neutral";
}

function villageDirection(
    village: StoryVillageKey,
    family: StorySceneFamily,
    variant: StorySceneVariant,
): VnCinematicDirection {
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
        backgroundImage: variant === "standard"
            ? STORYWIDE_ENVIRONMENTS[village][family]
            : STORYWIDE_ENVIRONMENT_VARIANTS[village][variant],
        shot: family === "intimate" ? "medium" : family === "sanctum" ? "close" : "wide",
        focus: "speaker",
        // Motion is punctuation, not wallpaper. Ordinary dialogue holds still;
        // crises and aftermaths earn a restrained move.
        backgroundMotion: variant === "crisis" ? "push" : variant === "aftermath" ? "drift" : "none",
        backgroundPosition: "50% 50%",
        transition: variant === "crisis" ? "dip-black" : "crossfade",
        tone: variant === "crisis" || family === "sanctum"
            ? "danger"
            : variant === "aftermath"
                ? "elegy"
                : tone,
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
    const major = village ? MAJOR_STORY_DIRECTIONS[`${village}:${page.title.trim().toLowerCase()}`] : undefined;

    if (opening || ending || !village) {
        const baseline: VnCinematicDirection = {
            shot: opening ? "wide" : "medium",
            focus: "speaker",
            backgroundMotion: opening ? "push" : "drift",
            transition: opening || ending ? "dip-black" : "crossfade",
            actorEntrance: opening ? "fade" : "none",
            titleCard: opening,
            ambience: opening ? "village" : "auto",
            cue: opening ? "title" : "none",
        };
        return major ? { ...baseline, ...major } : baseline;
    }

    const baseline = villageDirection(
        village,
        resolveStorySceneFamily(event, page, pageIndex),
        resolveStorySceneVariant(event, page),
    );
    return major ? { ...baseline, ...major } : baseline;
}

export function isPremiumVnEvent(eventId: string): boolean {
    return eventId.startsWith("story-");
}

export function resolveStorywideActorImage(
    eventId: string,
    actorName: string,
    pose: VnActorPose = "neutral",
): string | undefined {
    if (!isPremiumVnEvent(eventId)) return undefined;
    const key = actorName.trim().toLowerCase();
    const variants = STORYWIDE_ACTOR_VARIANTS[key];
    return variants?.[pose]
        ?? (pose === "injured" ? variants?.tense : undefined)
        ?? variants?.neutral
        ?? STORYWIDE_ACTORS[key];
}
