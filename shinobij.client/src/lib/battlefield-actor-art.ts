import academySparringSprite from "../assets/combat-actors/builtin-ai-academy-sparring-idle.webp";
import mistSentinelSprite from "../assets/combat-actors/builtin-ai-mist-sentinel-idle.webp";
import emberDuelistSprite from "../assets/combat-actors/builtin-ai-ember-duelist-idle.webp";
import examProctorSprite from "../assets/combat-actors/builtin-ai-exam-proctor-idle.webp";
import frostSealerSprite from "../assets/combat-actors/builtin-ai-frost-sealer-idle.webp";
import rogueNinjaSprite from "../assets/combat-actors/builtin-ai-rogue-ninja-idle.webp";
import shadowWeaverSprite from "../assets/combat-actors/builtin-ai-shadow-weaver-idle.webp";
import centralChampionSprite from "../assets/combat-actors/builtin-ai-central-champion-idle.webp";
import rivalFallbackSprite from "../assets/combat-actors/ai-rival-fallback-idle.webp";
import wildBoarSprite from "../assets/combat-actors/creatures/hunt-ai-wild-boar-idle.webp";
import forestHawkSprite from "../assets/combat-actors/creatures/hunt-ai-forest-hawk-idle.webp";
import frostWolfSprite from "../assets/combat-actors/creatures/hunt-ai-frost-wolf-idle.webp";
import ashLizardSprite from "../assets/combat-actors/creatures/hunt-ai-ash-lizard-idle.webp";
import shadowPantherSprite from "../assets/combat-actors/creatures/hunt-ai-shadow-panther-idle.webp";
import ironbackBearSprite from "../assets/combat-actors/creatures/hunt-ai-ironback-bear-idle.webp";
import emberDrakeSprite from "../assets/combat-actors/creatures/hunt-ai-ember-drake-idle.webp";
import moonSerpentSprite from "../assets/combat-actors/creatures/hunt-ai-moon-serpent-idle.webp";
import ancientChakraBeastSprite from "../assets/combat-actors/creatures/hunt-ai-ancient-chakra-beast-idle.webp";
import worldstormDragonSprite from "../assets/combat-actors/creatures/hunt-ai-worldstorm-dragon-idle.webp";
import apexEmberDrakeSprite from "../assets/combat-actors/creatures/apex-ai-ember-drake-idle.webp";
import apexMoonSerpentSprite from "../assets/combat-actors/creatures/apex-ai-moon-serpent-idle.webp";
import apexAncientChakraBeastSprite from "../assets/combat-actors/creatures/apex-ai-ancient-chakra-beast-idle.webp";
import apexWorldstormDragonSprite from "../assets/combat-actors/creatures/apex-ai-worldstorm-dragon-idle.webp";
import riftLegacyEchoSprite from "../assets/combat-actors/bosses/rift-boss-legacy-echo-idle.webp";
import riftHollowStalkerSprite from "../assets/combat-actors/bosses/rift-boss-hollow-stalker-idle.webp";
import riftWarrenAlphaSprite from "../assets/combat-actors/bosses/rift-boss-warren-alpha-idle.webp";
import riftEngineEchoSprite from "../assets/combat-actors/bosses/rift-boss-engine-echo-idle.webp";
import riftHollowLegacySprite from "../assets/combat-actors/bosses/rift-boss-hollow-legacy-idle.webp";
import riftMirrorShardSprite from "../assets/combat-actors/bosses/rift-boss-mirror-shard-idle.webp";
import riftGateHeirSprite from "../assets/combat-actors/bosses/rift-boss-gate-heir-idle.webp";
import towerHeavySprite from "../assets/combat-actors/bosses/tower-heavy-idle.webp";
import towerCasterSprite from "../assets/combat-actors/bosses/tower-caster-idle.webp";
import towerArmoredBossSprite from "../assets/combat-actors/bosses/tower-armored-boss-idle.webp";
import towerSpectralBossSprite from "../assets/combat-actors/bosses/tower-spectral-boss-idle.webp";
import towerRavagerSprite from "../assets/combat-actors/bosses/tower-ravager-idle.webp";
import clanOniSprite from "../assets/combat-actors/bosses/clan-boss-oni-idle.webp";
import clanLeviathanSprite from "../assets/combat-actors/bosses/clan-boss-leviathan-idle.webp";
import clanGolemSprite from "../assets/combat-actors/bosses/clan-boss-golem-idle.webp";

const HOLLOW_HOUND_SPRITE = "/hollow-gate/hollow-hound-idle.webp";

const HUNT_BATTLE_SPRITES: Record<string, string> = {
    "hunt-ai-wild-boar": wildBoarSprite,
    "hunt-ai-forest-hawk": forestHawkSprite,
    "hunt-ai-frost-wolf": frostWolfSprite,
    "hunt-ai-ash-lizard": ashLizardSprite,
    "hunt-ai-shadow-panther": shadowPantherSprite,
    "hunt-ai-ironback-bear": ironbackBearSprite,
    "hunt-ai-ember-drake": emberDrakeSprite,
    "hunt-ai-moon-serpent": moonSerpentSprite,
    "hunt-ai-ancient-chakra-beast": ancientChakraBeastSprite,
    "hunt-ai-worldstorm-dragon": worldstormDragonSprite,
};

const APEX_BATTLE_SPRITES: Record<string, string> = {
    "apex-ai-ember-drake": apexEmberDrakeSprite,
    "apex-ai-moon-serpent": apexMoonSerpentSprite,
    "apex-ai-ancient-chakra-beast": apexAncientChakraBeastSprite,
    "apex-ai-worldstorm-dragon": apexWorldstormDragonSprite,
};

const RIFT_BOSS_SPRITES: Record<string, string> = {
    "rift-boss-legacy-echo": riftLegacyEchoSprite,
    "rift-boss-hollow-stalker": riftHollowStalkerSprite,
    "rift-boss-warren-alpha": riftWarrenAlphaSprite,
    "rift-boss-engine-echo": riftEngineEchoSprite,
    "rift-boss-hollow-legacy": riftHollowLegacySprite,
    "rift-boss-mirror-shard": riftMirrorShardSprite,
    "rift-boss-gate-heir": riftGateHeirSprite,
};

const TOWER_BATTLE_SPRITES: Record<string, string> = {
    bandit: rivalFallbackSprite,
    archer: rivalFallbackSprite,
    genin: rivalFallbackSprite,
    "tower-scout": rivalFallbackSprite,
    "stormglass-lancer": rivalFallbackSprite,
    "stormglass-marksman": rivalFallbackSprite,
    blocker: towerHeavySprite,
    brute: towerHeavySprite,
    "stormglass-bastion": towerHeavySprite,
    acolyte: towerCasterSprite,
    "stormglass-weaver": towerCasterSprite,
    "thunder-archivist": towerCasterSprite,
    "stormglass-regent": towerCasterSprite,
    stormcaller: towerCasterSprite,
    "clan-boss-kage": towerCasterSprite,
    warden: towerArmoredBossSprite,
    sovereign: towerArmoredBossSprite,
    "mirror-shogun": towerArmoredBossSprite,
    "void-emperor": towerArmoredBossSprite,
    revenant: towerSpectralBossSprite,
    ravager: towerRavagerSprite,
    "clan-boss-oni": clanOniSprite,
    "clan-boss-leviathan": clanLeviathanSprite,
    "clan-boss-golem": clanGolemSprite,
};

const BUNDLED_AI_BATTLE_SPRITES: Record<string, string> = {
    "builtin-ai-academy-sparring": academySparringSprite,
    "builtin-ai-mist-sentinel": mistSentinelSprite,
    "builtin-ai-ember-duelist": emberDuelistSprite,
    "builtin-ai-exam-proctor": examProctorSprite,
    "builtin-ai-frost-sealer": frostSealerSprite,
    "builtin-ai-rogue-ninja": rogueNinjaSprite,
    "builtin-ai-shadow-weaver": shadowWeaverSprite,
    "builtin-ai-central-champion": centralChampionSprite,
    ...HUNT_BATTLE_SPRITES,
    ...APEX_BATTLE_SPRITES,
    ...RIFT_BOSS_SPRITES,
    ...TOWER_BATTLE_SPRITES,
    "academy-spar-dummy": academySparringSprite,
    "hollow-hound": HOLLOW_HOUND_SPRITE,
    "boss-hollow-gate-warden": HOLLOW_HOUND_SPRITE,
    "ashen-dragon": apexEmberDrakeSprite,
    "deathsgate-revenant": towerSpectralBossSprite,
    "frostfang-warlord": towerArmoredBossSprite,
    "moonshadow-oni": clanOniSprite,
    "stormveil-beast": apexAncientChakraBeastSprite,
};

const QUEST_BOSS_SPRITES: Record<string, string> = {
    "ashbound-raider": rivalFallbackSprite,
    "bell-wraith": towerSpectralBossSprite,
    "bandit-captain-goro": towerHeavySprite,
    "puppeteer-itoguchi": towerCasterSprite,
    "hunter-shirakawa": rivalFallbackSprite,
    "raiju-storm-hound": HOLLOW_HOUND_SPRITE,
    "house-kuroban": towerArmoredBossSprite,
    "ashbound-cinder": towerCasterSprite,
    "ashbound-slag": clanGolemSprite,
    "kazan-ashbound": towerRavagerSprite,
};

const STORY_RECKONING_SPRITES: Record<string, string> = {
    "story-reckoning-vanta-ninth": towerArmoredBossSprite,
    "story-reckoning-mori-working-copy": riftHollowLegacySprite,
    "story-reckoning-yura-exemption": towerCasterSprite,
    "story-reckoning-iro-sealed-shelf": rivalFallbackSprite,
    "story-reckoning-harrow-unbought": rivalFallbackSprite,
};

const HUNT_MISSION_TO_PROFILE = Object.keys(HUNT_BATTLE_SPRITES).map((profileId) => [
    profileId.replace("hunt-ai-", "hunt-"),
    profileId,
] as const);

export const BUNDLED_HUNT_SPRITE_IDS = Object.freeze(Object.keys(HUNT_BATTLE_SPRITES));
export const BUNDLED_APEX_SPRITE_IDS = Object.freeze(Object.keys(APEX_BATTLE_SPRITES));
export const BUNDLED_RIFT_SPRITE_IDS = Object.freeze(Object.keys(RIFT_BOSS_SPRITES));
export const BUNDLED_TOWER_SPRITE_IDS = Object.freeze(Object.keys(TOWER_BATTLE_SPRITES));

function canonicalAiId(id: string): string {
    return /^endless-(.+)-w\d+$/.exec(id)?.[1] ?? id;
}

function runtimeSprite(id: string): string | null {
    for (const [missionId, profileId] of HUNT_MISSION_TO_PROFILE) {
        if (id.startsWith(`world-hunt-pack-${missionId}-`)) {
            return HUNT_BATTLE_SPRITES[profileId] ?? null;
        }
    }
    if (id.startsWith("world-questbook-")) {
        for (const [bossId, sprite] of Object.entries(QUEST_BOSS_SPRITES)) {
            if (id.endsWith(`-${bossId}`)) return sprite;
        }
    }
    if (id.startsWith("world-story-")) {
        for (const [sourceId, sprite] of Object.entries(STORY_RECKONING_SPRITES)) {
            if (id === `world-story-${sourceId}`) return sprite;
        }
    }
    if (id.startsWith("dungeon-warden-")) return towerArmoredBossSprite;
    if (id.startsWith("world-bounty-") || id.startsWith("world-ambush-")) return towerHeavySprite;
    if (id.startsWith("world-wanderer-") || id.startsWith("world-patrol-")) return rivalFallbackSprite;
    if (id.startsWith("merc-") || id.startsWith("wanderer-") || id.startsWith("story-ai-")) return rivalFallbackSprite;
    return null;
}

/**
 * Resolve display-only grid art for an AI. Published full-body art uses the
 * existing `ai` image category (`ai:<id>:body`), so adding a sprite never changes
 * an authoritative combat/session payload. Every known creature and boss has a
 * typed bundled silhouette; a neutral shinobi body is the visual-only fallback
 * for future/custom AI IDs so they never regress to an empty portrait circle.
 */
export function battlefieldAiSprite(
    rawId: string | null | undefined,
    sharedImages?: Record<string, string>,
): string | null {
    const suppliedId = String(rawId ?? "");
    if (!suppliedId) return null;
    const id = canonicalAiId(suppliedId);
    const published = sharedImages?.[`ai:${suppliedId}:body`]
        || sharedImages?.[`ai:${id}:body`];
    if (published) return published;
    return BUNDLED_AI_BATTLE_SPRITES[id]
        || QUEST_BOSS_SPRITES[id]
        || runtimeSprite(id)
        || rivalFallbackSprite;
}

export function defaultAiRivalSprite(): string {
    return rivalFallbackSprite;
}
