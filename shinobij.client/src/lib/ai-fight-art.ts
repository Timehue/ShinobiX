import type { CreatorEvent } from "../types/vn";

export type TowerEnemySpriteKey =
    | "bandit"
    | "archer"
    | "blocker"
    | "brute"
    | "acolyte"
    | "warden"
    | "ravager"
    | "genin"
    | "revenant"
    | "sovereign"
    | "stormcaller"
    | "mirror-shogun"
    | "void-emperor"
    | "stormglass-lancer"
    | "stormglass-marksman"
    | "stormglass-bastion"
    | "stormglass-weaver"
    | "thunder-archivist"
    | "stormglass-regent"
    | "tower-scout"
    | "clan-boss-oni"
    | "clan-boss-leviathan"
    | "clan-boss-kage"
    | "clan-boss-golem";

const DIRECT_TOWER_SPRITES = new Set<TowerEnemySpriteKey>([
    "bandit", "archer", "blocker", "brute", "acolyte", "warden", "ravager",
    "genin", "revenant", "sovereign", "stormcaller", "mirror-shogun", "void-emperor",
    "stormglass-lancer", "stormglass-marksman", "stormglass-bastion", "stormglass-weaver",
    "thunder-archivist", "stormglass-regent", "tower-scout",
    "clan-boss-oni", "clan-boss-leviathan",
    "clan-boss-kage", "clan-boss-golem",
]);

const HOLLOW_GATE_FALLBACK_SPRITES: Record<string, TowerEnemySpriteKey> = {
    battle: "genin",
    elite: "blocker",
    ambush: "brute",
    beast: "ravager",
};

const RIFT_BOSS_PORTRAITS: Record<string, string> = {
    "rift-boss-legacy-echo": "/portraits/rift-boss-legacy-echo.webp",
    "rift-boss-hollow-stalker": "/portraits/rift-boss-hollow-stalker.webp",
    "rift-boss-warren-alpha": "/portraits/rift-boss-warren-alpha.webp",
    "rift-boss-engine-echo": "/portraits/rift-boss-engine-echo.webp",
    "rift-boss-hollow-legacy": "/portraits/rift-boss-hollow-legacy.webp",
    "rift-boss-mirror-shard": "/portraits/rift-boss-mirror-shard.webp",
    "rift-boss-gate-heir": "/portraits/rift-boss-gate-heir.webp",
};

/**
 * Resolve the opaque `character.visual` emitted by authoritative tower fights.
 * Existing tower sprite keys retain their original bundled-first behavior. Named
 * AI profiles can use published art, while Rift bosses and generated Hollow Gate
 * encounters have deterministic bundled fallbacks.
 */
export function resolveTowerEnemyPortrait(
    visual: string,
    sprites: Partial<Record<TowerEnemySpriteKey, string>>,
    sharedImages?: Record<string, string>,
): string | null {
    if (DIRECT_TOWER_SPRITES.has(visual as TowerEnemySpriteKey)) {
        const direct = sprites[visual as TowerEnemySpriteKey];
        if (direct) return direct;
    }

    const published = sharedImages?.[`ai:${visual}`];
    if (published) return published;

    const riftPortrait = RIFT_BOSS_PORTRAITS[visual];
    if (riftPortrait) return riftPortrait;

    const hollowKind = /^hollow-gate-(battle|elite|ambush|beast)-f\d+$/.exec(visual)?.[1];
    const fallbackKey = hollowKind ? HOLLOW_GATE_FALLBACK_SPRITES[hollowKind] : undefined;
    return fallbackKey ? sprites[fallbackKey] ?? null : null;
}

/** Recover a profile id after Endless Tower wraps it in `endless-…-wN`. */
export function canonicalBeastPortraitId(aiProfileId: string): string {
    return /^endless-(.+)-w\d+$/.exec(aiProfileId)?.[1] ?? aiProfileId;
}

// Road bosses without bespoke portraits deliberately use a stable, character-
// appropriate painted stand-in. This is preferable to rendering the event's
// landscape backdrop inside Arena's circular fighter portrait.
const STORY_ROAD_BATTLE_PORTRAITS: Record<string, string> = {
    "Tally-Captain Brask": "/portraits/captain-joss-arne.webp",
    "The Magpie": "/portraits/corvo-latch.webp",
    "Instructor Havek": "/portraits/instructor-havek.webp",
    "Raid Captain Hela Dray": "/portraits/captain-hela-dray.webp",
    "Black Bridge Raiders": "/portraits/pale-pack-runner.webp",
    "Anji Vesk": "/portraits/anji-vesk.webp",
    "The Forty-First": "/portraits/sergeant-essen.webp",
    "Foreman Dray": "/portraits/foreman-dray.webp",
    "Anchor Warden": "/portraits/hollow-warden.webp",
};

export function storyRoadBattlePortrait(bossName?: string): string | undefined {
    return bossName ? STORY_ROAD_BATTLE_PORTRAITS[bossName] : undefined;
}

type DungeonArtEvent = Pick<CreatorEvent, "id" | "avatarImage" | "vnPages">;

/**
 * Prefer a dedicated dungeon-Warden upload, then the final authored right-side
 * character portrait. Scene/background art is intentionally never a fighter.
 */
export function resolveDungeonWardenPortrait(
    event: DungeonArtEvent,
    sharedImages: Record<string, string>,
): string | undefined {
    const dedicated = sharedImages[`event:${event.id}:warden`];
    if (dedicated) return dedicated;

    const pages = event.vnPages ?? [];
    for (let index = pages.length - 1; index >= 0; index--) {
        const published = sharedImages[`vn:${event.id}:page:${index}:right`];
        if (published) return published;
    }
    for (let index = pages.length - 1; index >= 0; index--) {
        if (pages[index].rightImage) return pages[index].rightImage;
    }

    return event.avatarImage || undefined;
}
