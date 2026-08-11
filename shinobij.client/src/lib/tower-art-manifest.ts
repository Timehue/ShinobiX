import battleTowersKeyArtV1 from "../assets/towers/battle-towers-key-art-v1.webp";
import banditSprite from "../assets/towers/enemies/bandit.webp";
import archerSprite from "../assets/towers/enemies/archer.webp";
import blockerSprite from "../assets/towers/enemies/blocker.webp";
import bruteSprite from "../assets/towers/enemies/brute.webp";
import acolyteSprite from "../assets/towers/enemies/acolyte.webp";
import wardenSprite from "../assets/towers/enemies/warden.webp";
import ravagerSprite from "../assets/towers/enemies/ravager.webp";
import geninSprite from "../assets/towers/enemies/genin.webp";
import revenantSprite from "../assets/towers/enemies/revenant.webp";
import sovereignSprite from "../assets/towers/enemies/sovereign.webp";
import stormcallerSprite from "../assets/towers/enemies/stormcaller.webp";
import mirrorShogunSprite from "../assets/towers/enemies/mirror-shogun.webp";
import voidEmperorSprite from "../assets/towers/enemies/void-emperor.webp";
import stormglassLancerSprite from "../assets/towers/enemies/stormglass-lancer.webp";
import stormglassMarksmanSprite from "../assets/towers/enemies/stormglass-marksman.webp";
import stormglassBastionSprite from "../assets/towers/enemies/stormglass-bastion.webp";
import stormglassWeaverSprite from "../assets/towers/enemies/stormglass-weaver.webp";
import thunderArchivistSprite from "../assets/towers/enemies/thunder-archivist.webp";
import stormglassRegentSprite from "../assets/towers/enemies/stormglass-regent.webp";
import towerScoutSprite from "../assets/towers/enemies/tower-scout.webp";
import stormglassCitadel from "../assets/towers/stormglass-citadel.webp";
import footholdArt from "../assets/towers/story/foothold.webp";
import crossfireGladeArt from "../assets/towers/story/crossfire-glade.webp";
import frozenGauntletArt from "../assets/towers/story/frozen-gauntlet.webp";
import holdTheLineArt from "../assets/towers/story/hold-the-line.webp";
import spireWardenArt from "../assets/towers/story/spire-warden.webp";
import acolyteCovenArt from "../assets/towers/story/acolyte-coven.webp";
import hollowRevenantArt from "../assets/towers/story/hollow-revenant.webp";
import escortVanguardArt from "../assets/towers/story/escort-vanguard.webp";
import pitOfEmbersArt from "../assets/towers/story/pit-of-embers.webp";
import spireSovereignArt from "../assets/towers/story/spire-sovereign.webp";
import stormglassBreachArt from "../assets/towers/story/stormglass-breach.webp";
import thunderArchiveArt from "../assets/towers/story/thunder-archive.webp";
import thousandBoltBridgeArt from "../assets/towers/story/thousand-bolt-bridge.webp";
import brokenReflectionsArt from "../assets/towers/story/broken-reflections.webp";
import stormglassCrownArt from "../assets/towers/story/stormglass-crown.webp";
import clanBossOni from "../assets/clan-boss/clan-boss-oni.webp";
import clanBossLeviathan from "../assets/clan-boss/clan-boss-leviathan.webp";
import clanBossKage from "../assets/clan-boss/clan-boss-kage.webp";
import clanBossGolem from "../assets/clan-boss/clan-boss-golem.webp";
import { resolveTowerEnemyPortrait, type TowerEnemySpriteKey } from "./ai-fight-art";
import type { SpireBossKey } from "./spire-catalog";

export const TOWER_KEY_ART = battleTowersKeyArtV1;

export const TOWER_ENEMY_PORTRAITS: Record<TowerEnemySpriteKey, string> = {
    bandit: banditSprite,
    archer: archerSprite,
    blocker: blockerSprite,
    brute: bruteSprite,
    acolyte: acolyteSprite,
    warden: wardenSprite,
    ravager: ravagerSprite,
    genin: geninSprite,
    revenant: revenantSprite,
    sovereign: sovereignSprite,
    stormcaller: stormcallerSprite,
    "mirror-shogun": mirrorShogunSprite,
    "void-emperor": voidEmperorSprite,
    "stormglass-lancer": stormglassLancerSprite,
    "stormglass-marksman": stormglassMarksmanSprite,
    "stormglass-bastion": stormglassBastionSprite,
    "stormglass-weaver": stormglassWeaverSprite,
    "thunder-archivist": thunderArchivistSprite,
    "stormglass-regent": stormglassRegentSprite,
    "tower-scout": towerScoutSprite,
    "clan-boss-oni": clanBossOni,
    "clan-boss-leviathan": clanBossLeviathan,
    "clan-boss-kage": clanBossKage,
    "clan-boss-golem": clanBossGolem,
};

export const TOWER_SPIRE_PORTRAITS: Record<SpireBossKey, string> = {
    warden: TOWER_ENEMY_PORTRAITS.warden,
    revenant: TOWER_ENEMY_PORTRAITS.revenant,
    ravager: TOWER_ENEMY_PORTRAITS.ravager,
    sovereign: TOWER_ENEMY_PORTRAITS.sovereign,
    stormcaller: TOWER_ENEMY_PORTRAITS.stormcaller,
    "mirror-shogun": TOWER_ENEMY_PORTRAITS["mirror-shogun"],
    "void-emperor": TOWER_ENEMY_PORTRAITS["void-emperor"],
};

export const UNKNOWN_TOWER_COMBATANT = {
    label: "Unknown combatant",
    glyph: "?",
} as const;

const TOWER_STORY_FLOOR_ART: Readonly<Record<string, string>> = {
    "foothold": footholdArt,
    "crossfire-glade": crossfireGladeArt,
    "frozen-gauntlet": frozenGauntletArt,
    "hold-the-line": holdTheLineArt,
    "spire-warden": spireWardenArt,
    "acolyte-coven": acolyteCovenArt,
    "hollow-revenant": hollowRevenantArt,
    "escort-vanguard": escortVanguardArt,
    "pit-of-embers": pitOfEmbersArt,
    "spire-sovereign": spireSovereignArt,
    "stormglass-breach": stormglassBreachArt,
    "thunder-archive": thunderArchiveArt,
    "thousand-bolt-bridge": thousandBoltBridgeArt,
    "broken-reflections": brokenReflectionsArt,
    "stormglass-crown": stormglassCrownArt,
};

export type TowerStoryArt =
    | { kind: "authored"; src: string; key: string }
    | { kind: "fallback"; src: typeof TOWER_KEY_ART; key: null };

/** Resolve optional catalog art without ever issuing a broken image request. */
export function resolveTowerStoryArt(artKey: string | null | undefined): TowerStoryArt {
    const normalized = artKey?.trim() ?? "";
    const src = normalized ? TOWER_STORY_FLOOR_ART[normalized] : undefined;
    return src
        ? { kind: "authored", src, key: normalized }
        : { kind: "fallback", src: TOWER_KEY_ART, key: null };
}

/** Chapter 2 owns a panoramic header; Chapter 1 reuses its authored gate establishing shot. */
export function resolveTowerStoryChapterArt(chapter: number, artKey: string | null | undefined): TowerStoryArt {
    return chapter === 2
        ? { kind: "authored", src: stormglassCitadel, key: "stormglass-citadel" }
        : resolveTowerStoryArt(artKey);
}

export type TowerCombatantArt =
    | { kind: "portrait"; src: string; label: string }
    | { kind: "unknown"; src: null; label: typeof UNKNOWN_TOWER_COMBATANT.label; glyph: typeof UNKNOWN_TOWER_COMBATANT.glyph };

/** Resolve server visual IDs without disguising missing art as an unrelated fighter. */
export function resolveTowerCombatantArt(visual: string, sharedImages?: Record<string, string>): TowerCombatantArt {
    const src = resolveTowerEnemyPortrait(visual, TOWER_ENEMY_PORTRAITS, sharedImages);
    return src
        ? { kind: "portrait", src, label: visual }
        : { kind: "unknown", src: null, ...UNKNOWN_TOWER_COMBATANT };
}
