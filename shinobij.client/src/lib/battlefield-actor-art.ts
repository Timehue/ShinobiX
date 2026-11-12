import academySparringSprite from "../assets/combat-actors/builtin-ai-academy-sparring-idle.webp";
import { storyTwinArt } from '../../../shared/story-twin-art';
import mistSentinelSprite from "../assets/combat-actors/builtin-ai-mist-sentinel-idle.webp";
import emberDuelistSprite from "../assets/combat-actors/builtin-ai-ember-duelist-idle.webp";
import examProctorSprite from "../assets/combat-actors/builtin-ai-exam-proctor-idle.webp";
import frostSealerSprite from "../assets/combat-actors/builtin-ai-frost-sealer-idle.webp";
import rogueNinjaSprite from "../assets/combat-actors/builtin-ai-rogue-ninja-idle.webp";
import shadowWeaverSprite from "../assets/combat-actors/builtin-ai-shadow-weaver-idle.webp";
import centralChampionSprite from "../assets/combat-actors/builtin-ai-central-champion-idle.webp";
import rivalFallbackSprite from "../assets/combat-actors/ai-rival-fallback-idle.webp";
import pveBruiserSprite from '../assets/combat-actors/pve/bandit-bruiser-idle.webp';
import roadBanditSprite from '../assets/combat-actors/pve/bandit-idle.webp';
import pveSkirmisherSprite from '../assets/combat-actors/pve/bandit-skirmisher-idle.webp';
import pveAssassinSprite from '../assets/combat-actors/pve/rogue-assassin-idle.webp';
import roadNightbladeSprite from '../assets/combat-actors/pve/nightblade-idle.webp';
import pveElementalistSprite from '../assets/combat-actors/pve/elemental-specialist-idle.webp';
import pveDefenderSprite from '../assets/combat-actors/pve/defensive-specialist-idle.webp';
import rivalMinerSprite from '../assets/combat-actors/pve/rival-miner-idle.webp';
import kageroSprite from '../assets/combat-actors/pve/kagero-idle.webp';
import tsukikaSprite from '../assets/combat-actors/pve/tsukika-idle.webp';
import hoshinaHollowSprite from '../assets/combat-actors/pve/hoshina-hollow-idle.webp';
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
import { worldBossDefinitionForVisual, worldBossDefinitionForGuardVisual } from "../../../shared/world-boss-event";
import { STORY_COMBAT_IDENTITIES } from '../../../shared/story-combat-identity';
import { narrativeEnemyIdentity } from '../../../shared/narrative-enemy-identity';
import { parseWandererId, WANDERER_RIFT_INDEX } from '../../../shared/wanderer-roster';

const HOLLOW_HOUND_SPRITE = "/hollow-gate/hollow-hound-idle.webp";
const STORY_KAGE_SPRITES: Record<string, string> = {
    'story-ai-stormveil-village-100': '/combat-actors/named/kage-raiko-veyr-hollow-idle.webp',
    'story-ai-ashen-leaf-village-100': hoshinaHollowSprite,
    'story-ai-frostfang-village-100': '/combat-actors/named/kage-kael-whitefang-hollow-idle.webp',
    'story-ai-moonshadow-village-100': '/combat-actors/named/kage-sable-nocturne-hollow-idle.webp',
};
const NAMED_COMBAT_PORTRAITS = new Set([
    'tempest-guard-captain', 'mira-volt', 'veiled-hand-collector', 'masked-auction-enforcer',
    'veiled-hand-executioner', 'veiled-hand-grandmaster', 'instructor-havek', 'captain-hela-dray',
    'anji-vesk', 'foreman-dray', 'warden-sesk', 'redactor-sella', 'meter-warden-kree', 'counterfeit-broker',
    'quest-bosses/ashbound-raider', 'quest-bosses/bell-wraith', 'quest-bosses/bandit-captain-goro',
    'quest-bosses/puppeteer-itoguchi', 'quest-bosses/hunter-shirakawa', 'quest-bosses/house-kuroban',
    'quest-bosses/ashbound-cinder', 'quest-bosses/ashbound-slag', 'quest-bosses/kazan-ashbound',
]);

function namedPortraitSprite(portrait: string): string | undefined {
    const key = /^\/portraits\/(.+)\.webp$/.exec(portrait)?.[1];
    return key && NAMED_COMBAT_PORTRAITS.has(key) ? `/combat-actors/named/${key}-idle.webp` : undefined;
}
const ORDINARY_PVE_SPRITES: Record<string, string> = {
    bruiser: pveBruiserSprite, skirmisher: pveSkirmisherSprite, assassin: pveAssassinSprite,
    elementalist: pveElementalistSprite, defender: pveDefenderSprite,
    bandit: roadBanditSprite, nightblade: roadNightbladeSprite, rivalMiner: rivalMinerSprite, tsukika: tsukikaSprite,
    nemesis: kageroSprite, 'world-wanderer-nemesis': kageroSprite,
};

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
    "academy-spar-dummy": "/combat-actors/narrative/academy-training-dummy.webp",
    "hollow-hound": HOLLOW_HOUND_SPRITE,
    "boss-hollow-gate-warden": HOLLOW_HOUND_SPRITE,
    "ashen-dragon": apexEmberDrakeSprite,
    "deathsgate-revenant": towerSpectralBossSprite,
    "frostfang-warlord": towerArmoredBossSprite,
    "moonshadow-oni": clanOniSprite,
    "stormveil-beast": apexAncientChakraBeastSprite,
};

const HUNT_MISSION_TO_PROFILE = Object.keys(HUNT_BATTLE_SPRITES).map((profileId) => [
    profileId.replace("hunt-ai-", "hunt-"),
    profileId,
] as const);

function canonicalAiId(id: string): string {
    return /^endless-(.+)-w\d+$/.exec(id)?.[1] ?? id;
}

function runtimeSprite(id: string): string | null {
    for (const [missionId, profileId] of HUNT_MISSION_TO_PROFILE) {
        if (id.startsWith(`world-hunt-pack-${missionId}-`)) {
            return HUNT_BATTLE_SPRITES[profileId] ?? null;
        }
    }
    if (id === "raiju-storm-hound" || (id.startsWith("world-questbook-") && id.endsWith("-raiju-storm-hound"))) return HOLLOW_HOUND_SPRITE;
    if (id.startsWith("dungeon-warden-")) return towerArmoredBossSprite;
    if (id.startsWith("world-bounty-") || id.startsWith("world-ambush-")) return towerHeavySprite;
    // The rift-touched creature keeps its slot id, not a human roster role.
    if (parseWandererId(id.replace("world-wanderer-", ""))?.index === WANDERER_RIFT_INDEX) return riftHollowStalkerSprite;
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
    identity?: { name?: string; archetype?: string; portrait?: string | null },
): string | null {
    const suppliedId = String(rawId ?? "");
    if (!suppliedId) return null;
    const id = canonicalAiId(suppliedId);
    const published = sharedImages?.[`ai:${suppliedId}:body`]
        || sharedImages?.[`ai:${id}:body`];
    if (published) return published;
    const twin = storyTwinArt(id);
    if (twin) return twin;
    const authored = STORY_COMBAT_IDENTITIES[id] ?? narrativeEnemyIdentity(id);
    if (authored) return namedPortraitSprite(authored.portrait) || authored.body || (authored.sprite && (ORDINARY_PVE_SPRITES[authored.sprite] || BUNDLED_AI_BATTLE_SPRITES[authored.sprite])) || authored.portrait;
    const portraitKey = /^\/portraits\/pve\/([a-z]+)\.webp(?:[?#]|$)/i.exec(identity?.portrait ?? '')?.[1];
    if (portraitKey && Object.hasOwn(ORDINARY_PVE_SPRITES, portraitKey)) return ORDINARY_PVE_SPRITES[portraitKey];
    if (/^Tsukika\b/i.test(identity?.name ?? '') && (id === 'nightblade' || identity?.archetype === 'assassin')) return tsukikaSprite;
    if (/^Kagero\b/i.test(identity?.name ?? '')) return kageroSprite;
    return worldBossDefinitionForVisual(id)?.battleSprite
        || worldBossDefinitionForGuardVisual(id)?.battleSprite
        || BUNDLED_AI_BATTLE_SPRITES[id]
        || STORY_KAGE_SPRITES[id]
        || ORDINARY_PVE_SPRITES[id]
        || ORDINARY_PVE_SPRITES[identity?.archetype ?? '']
        || runtimeSprite(id)
        || rivalFallbackSprite;
}

export function defaultAiRivalSprite(): string {
    return rivalFallbackSprite;
}
