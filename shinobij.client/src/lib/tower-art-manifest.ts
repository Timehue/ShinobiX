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
};

export const UNKNOWN_TOWER_COMBATANT = {
    label: "Unknown combatant",
    glyph: "?",
} as const;

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
