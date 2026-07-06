import type { BloodlinePresentation, CreatorStep, StarterAvatar, VillageTheme } from "./characterCreatorTypes";

export const CREATOR_STEPS: { id: CreatorStep; label: string }[] = [
    { id: "welcome", label: "Gate" },
    { id: "village", label: "Village" },
    { id: "bloodline", label: "Bloodline" },
    { id: "avatar", label: "Avatar" },
    { id: "preview", label: "Preview" },
    { id: "identity", label: "Account" },
];

export const STARTER_AVATARS: StarterAvatar[] = [
    {
        id: "avatar-one",
        label: "Avatar One",
        stance: "Forward guard stance",
        image: "/starter-avatar-one.webp",
        alt: "Masked male shinobi warrior in dark armor",
        hook: "A disciplined front-line silhouette built for players who want a direct, battle-ready look.",
    },
    {
        id: "avatar-two",
        label: "Avatar Two",
        stance: "Blade and shadow stance",
        image: "/starter-avatar-two.webp",
        alt: "Masked female shinobi warrior in crimson armor",
        hook: "A sharp, agile silhouette built for players who want a fast, tactical look.",
    },
];

const FALLBACK_VILLAGE_THEME: VillageTheme = {
    tone: "Village Record",
    record: "Starting home and story origin",
    summary: "Your village anchors your first save, story context, and public village identity.",
};

const VILLAGE_THEMES: Record<string, VillageTheme> = {
    "Stormveil Village": {
        tone: "Stormveil Record",
        record: "Starting home and story village",
        summary: "A highland village of storm towers, wet rooftops, and border roads. Pick it if you want your story record tied to Stormveil.",
    },
    "Ashen Leaf Village": {
        tone: "Ashen Leaf Record",
        record: "Starting home and story village",
        summary: "A firelit village of old groves, ash roads, and clan traditions. Pick it if you want your story record tied to Ashen Leaf.",
    },
    "Frostfang Village": {
        tone: "Frostfang Record",
        record: "Starting home and story village",
        summary: "A northern village of snow gates, stone holds, and cold ridgelines. Pick it if you want your story record tied to Frostfang.",
    },
    "Moonshadow Village": {
        tone: "Moonshadow Record",
        record: "Starting home and story village",
        summary: "A night village of lantern paths, hidden courts, and quiet roads. Pick it if you want your story record tied to Moonshadow.",
    },
};

export function getVillageTheme(village: string): VillageTheme {
    return VILLAGE_THEMES[village] ?? FALLBACK_VILLAGE_THEME;
}

export const BLOODLINE_PRESENTATION: Record<string, BloodlinePresentation> = {
    "Ashen Eyes": {
        image: "/bloodline-ashen-eyes.webp",
        alt: "Crimson ocular chakra sigil in a dark shrine",
        tagline: "Genjutsu pressure through Blood element illusions.",
        flavor: "A cursed eye bloodline built around rupturing focus, worsening damage taken, and turning the target's own senses against them.",
    },
    "Inferno Cataclysm": {
        image: "/bloodline-inferno-cataclysm.webp",
        alt: "Molten lava chakra eruption across an obsidian battlefield",
        tagline: "Ninjutsu pressure through Lava element damage.",
        flavor: "A fire-and-earth lineage that plays loud: ignition, raw damage, wounds, and lava techniques that feel heavy from the first fight.",
    },
    "Shadow Lotus": {
        image: "/bloodline-shadow-lotus.webp",
        alt: "Black lotus chakra blooming around blades under moonlight",
        tagline: "Bukijutsu pressure through Shadow element weapon arts.",
        flavor: "A weapon bloodline with poison, protection, and absorb pressure wrapped in moonlit blades and wire.",
    },
    "Iron Fang": {
        image: "/bloodline-iron-fang.webp",
        alt: "Iron chakra impact with armored fist and fang-shaped blades",
        tagline: "Taijutsu pressure through Iron element strikes.",
        flavor: "A close-combat bloodline for players who want blunt impact, wounds, damage boosts, and defensive steel in their starter kit.",
    },
};
