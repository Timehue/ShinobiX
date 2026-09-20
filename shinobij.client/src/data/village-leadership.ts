import { STORYWIDE_ACTORS, STORYWIDE_ACTOR_VARIANTS } from "../lib/vn-storywide-direction";

type VillageLeadershipProfile = { kage: string; elders: string[]; roles: string[]; atWar: boolean; pastWars: string[] };
export type VillageLeadershipImages = Record<string, { kage?: string; elders?: string[] }>;

export const villageLeadership: Record<string, VillageLeadershipProfile> = {
    "Stormveil Village": {
        kage: "Kage Raiko Veyr",
        elders: ["Elder Vanta", "Mira Volt", "Tempest Guard Captain"],
        roles: ["Bookmaker and record witness", "Arena cable rigger", "Tempest Guard captain"],
        atWar: false,
        pastWars: ["Won the Tempest Border War vs Moonshadow", "Lost the Crimson Dock Raid vs Ashen Leaf", "Draw at the Broken Thunder Pass"],
    },
    "Ashen Leaf Village": {
        kage: "Kage Hoshina Enju",
        elders: ["Elder Mori", "Toma Reed", "Registry Duty Clerk"],
        roles: ["Register record keeper", "Carpenter and family witness", "Registry duty clerk"],
        atWar: false,
        pastWars: ["Won the Crimson Dock Raid vs Stormveil", "Won the Ember Road Defense vs Frostfang", "Lost the Old Grove Skirmish vs Moonshadow"],
    },
    "Frostfang Village": {
        kage: "Kage Kael Whitefang",
        elders: ["Elder Sova", "Captain Yura", "Seal-Keeper Vess"],
        roles: ["Count record keeper", "Wall and rescue captain", "Seal keeper"],
        atWar: false,
        pastWars: ["Won the White Ridge Siege vs Moonshadow", "Lost the Ember Road Assault vs Ashen Leaf", "Draw at the Frozen Gate"],
    },
    "Moonshadow Village": {
        kage: "Kage Sable Nocturne",
        elders: ["Shade Master Iro", "Nyx", "Veiled Hand Grandmaster"],
        roles: ["Archive custodian", "Information broker", "Veiled Hand officer"],
        atWar: false,
        pastWars: ["Won the Old Grove Skirmish vs Ashen Leaf", "Lost the White Ridge Siege vs Frostfang", "Lost the Tempest Border War vs Stormveil"],
    },
};

function defaultPortraitFor(name?: string): string {
    const slug = (name ?? "").trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
    return slug ? `/portraits/${slug}.webp` : "";
}

// Static leadership cards should share the reviewed character identities used by
// the story. Neutral variants are preferred where the VN has an action pose as
// its base image, because the Town Hall is a calm civic setting.
const CANONICAL_LEADERSHIP_PORTRAITS: Record<string, string> = {
    "kage raiko veyr": STORYWIDE_ACTORS["kage raiko veyr"],
    "elder vanta": STORYWIDE_ACTORS["elder vanta"],
    "mira volt": STORYWIDE_ACTOR_VARIANTS["mira volt"]?.neutral ?? STORYWIDE_ACTORS["mira volt"],
    "tempest guard captain": STORYWIDE_ACTORS["tempest guard captain"],
    "kage hoshina enju": STORYWIDE_ACTORS["kage hoshina enju"],
    "elder mori": STORYWIDE_ACTORS["elder mori"],
    "toma reed": STORYWIDE_ACTORS["toma reed"],
    "registry duty clerk": STORYWIDE_ACTORS["registry duty clerk"],
    "kage kael whitefang": STORYWIDE_ACTORS["kage kael whitefang"],
    "elder sova": STORYWIDE_ACTORS["elder sova"],
    "captain yura": STORYWIDE_ACTORS["captain yura"],
    "seal-keeper vess": STORYWIDE_ACTORS["seal-keeper vess"],
    "kage sable nocturne": STORYWIDE_ACTOR_VARIANTS["kage sable nocturne"]?.neutral ?? STORYWIDE_ACTORS["kage sable nocturne"],
    "shade master iro": STORYWIDE_ACTORS["shade master iro"],
    nyx: STORYWIDE_ACTOR_VARIANTS.nyx?.neutral ?? STORYWIDE_ACTORS.nyx,
};

function canonicalLeadershipPortraitFor(name?: string): string {
    const normalizedName = (name ?? "").trim().toLowerCase();
    return CANONICAL_LEADERSHIP_PORTRAITS[normalizedName] || defaultPortraitFor(name);
}

function normalizeLeadershipPortrait(image: string | undefined, name?: string): string {
    const legacyDefault = defaultPortraitFor(name);
    // Migrate the old generated default in memory, including values persisted by
    // earlier releases. Anything else is an intentional admin override.
    if (!image || image === legacyDefault) return canonicalLeadershipPortraitFor(name);
    return image;
}

export function normalizeVillageLeadershipImages(images?: VillageLeadershipImages): VillageLeadershipImages {
    const normalized: VillageLeadershipImages = {};
    Object.entries(villageLeadership).forEach(([village, leadership]) => {
        const source = images?.[village];
        normalized[village] = {
            kage: normalizeLeadershipPortrait(source?.kage, leadership.kage),
            elders: Array.from({ length: 3 }, (_, index) => normalizeLeadershipPortrait(source?.elders?.[index], leadership.elders[index])),
        };
    });
    return normalized;
}
