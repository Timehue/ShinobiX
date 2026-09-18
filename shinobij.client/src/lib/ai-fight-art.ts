import type { CreatorEvent } from "../types/vn";
import { resolveVnActorBaseImage, resolveVnAuthoredActorImage } from "./vn";
import { resolveStorywideActorImage } from "./vn-storywide-direction";
import { vnActorImageKey } from './vn-shared-artwork';
import { isRetiredVnArt } from './vn-retired-artwork';
import { resolveCinematicActorImage } from './vn-presentation';

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

/** Only slots explicitly belonging to the Warden can supply its combat portrait. */
export function resolveDungeonWardenPortrait(
    event: DungeonArtEvent,
    sharedImages: Record<string, string>,
): string | undefined {
    const dedicated = sharedImages[`event:${event.id}:warden`];
    if (dedicated) return dedicated;
    const slots = (event.vnPages ?? []).flatMap((page, index) => {
        const actors = [
            { side: "left", name: page.leftName, image: page.leftImage },
            { side: "right", name: page.rightName || page.speaker, image: page.rightImage },
        ];
        return actors.filter((actor) => actor.name?.trim().toLowerCase() === "dungeon warden")
            .map((actor) => ({ ...actor, key: `vn:${event.id}:page:${index}:${actor.side}`, namedKey: vnActorImageKey(event.id, index, 'Dungeon Warden') }));
    }).reverse();
    const published = slots.map((slot) => resolveVnAuthoredActorImage(event.id, 'Dungeon Warden', sharedImages[slot.namedKey] || sharedImages[slot.key])).find(Boolean);
    if (published) return published;
    const authored = slots.map((slot) => resolveVnAuthoredActorImage(event.id, 'Dungeon Warden', slot.image)).find(Boolean);
    if (authored) return authored;
    return resolveVnAuthoredActorImage(event.id, "Dungeon Warden", event.avatarImage)
        || resolveStorywideActorImage(event.id, "Dungeon Warden")
        || undefined;
}

/** Combat has no React artwork hook. Verify its selected shared portrait before
 * handing it to the arena, retaining any replacement bytes in an old slot. */
export async function resolveVerifiedDungeonWardenPortrait(event: DungeonArtEvent, sharedImages: Record<string, string>): Promise<string | undefined> {
    let current = event, images = sharedImages;
    let portrait = resolveDungeonWardenPortrait(current, images);
    while (portrait && await isRetiredVnArt(event.id, portrait)) {
        const retired = portrait;
        images = Object.fromEntries(Object.entries(images).filter(([, image]) => image !== retired));
        current = { ...current, avatarImage: current.avatarImage === retired ? undefined : current.avatarImage,
            vnPages: current.vnPages?.map(page => ({ ...page,
                leftImage: page.leftImage === retired ? undefined : page.leftImage,
                rightImage: page.rightImage === retired ? undefined : page.rightImage,
            })) };
        portrait = resolveDungeonWardenPortrait(current, images);
    }
    return portrait;
}

/** A player reply or another speaker must never wear the Warden's portrait. */
export function resolveDungeonSpeakerPortrait(
    event: DungeonArtEvent,
    speaker: string,
    sharedImages: Record<string, string>,
    page?: NonNullable<CreatorEvent["vnPages"]>[number],
): string | undefined {
    const name = speaker.trim().toLowerCase();
    if (!name || name === "narrator" || name === "player" || name === "%name") return undefined;
    if (name === "dungeon warden") return resolveDungeonWardenPortrait(event, sharedImages);
    const authored = page?.rightName?.trim().toLowerCase() === name ? page.rightImage
        : page?.leftName?.trim().toLowerCase() === name ? page.leftImage : undefined;
    return resolveCinematicActorImage(event.id, speaker, resolveVnActorBaseImage(event.id, speaker, authored), 'neutral', authored) || undefined;
}
