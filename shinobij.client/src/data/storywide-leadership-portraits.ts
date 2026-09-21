const STORY_LEADERSHIP_PORTRAITS = {
    "kage raiko veyr": { base: "/portraits/cinematic/storywide/kage-raiko-veyr.webp" },
    "elder vanta": { base: "/portraits/cinematic/storywide/elder-vanta.webp" },
    "mira volt": {
        base: "/portraits/cinematic/storywide/mira-volt.webp",
        neutral: "/portraits/cinematic/storywide/mira-volt-neutral.webp",
    },
    "tempest guard captain": { base: "/portraits/cinematic/storywide/tempest-guard-captain.webp" },
    "kage hoshina enju": { base: "/portraits/cinematic/storywide/kage-hoshina-enju-canon.webp" },
    "elder mori": { base: "/portraits/cinematic/elder-mori.webp" },
    "toma reed": { base: "/portraits/cinematic/toma-reed.webp" },
    "registry duty clerk": { base: "/portraits/cinematic/registry-duty-clerk.webp" },
    "kage kael whitefang": { base: "/portraits/cinematic/storywide/kage-kael-whitefang.webp" },
    "elder sova": { base: "/portraits/cinematic/storywide/elder-sova-canon.webp" },
    "captain yura": { base: "/portraits/cinematic/storywide/captain-yura.webp" },
    "seal-keeper vess": { base: "/portraits/cinematic/storywide/seal-keeper-vess-clean-alpha-v1.webp" },
    "kage sable nocturne": {
        base: "/portraits/cinematic/storywide/kage-sable-nocturne.webp",
        neutral: "/portraits/cinematic/storywide/kage-sable-nocturne-readable.webp",
    },
    "shade master iro": { base: "/portraits/cinematic/storywide/shade-master-iro.webp" },
    nyx: {
        base: "/portraits/cinematic/storywide/nyx.webp",
        neutral: "/portraits/cinematic/storywide/nyx-neutral.webp",
    },
} as const;

export type StoryLeadershipActor = keyof typeof STORY_LEADERSHIP_PORTRAITS;

export function storyLeadershipPortrait(name: StoryLeadershipActor, pose: "base" | "neutral" = "base"): string {
    const portraits = STORY_LEADERSHIP_PORTRAITS[name] as { base: string; neutral?: string };
    return pose === "neutral" ? portraits.neutral ?? portraits.base : portraits.base;
}
