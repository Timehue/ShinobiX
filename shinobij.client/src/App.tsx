import { useEffect, useRef, useState, type ReactNode, type ChangeEvent } from "react";
import type * as React from "react";
import "./index.css";
import worldMapBg from "./assets/maps/world_map.png";
import castleImg from "./assets/castle.png";
import houseImg from "./assets/house1.png";
import towerImg from "./assets/tower.png";
import moonshadowImage from "./assets/moonshadow.png";
import iceSectorImg from "./assets/sectors/ice.png";
import darkSectorImg from "./assets/sectors/dark.png";
import templeSectorImg from "./assets/sectors/temple.png";
import waterSectorImg from "./assets/sectors/water.png";
import forrestSectorImg from "./assets/sectors/forrest.png";
import meadow2SectorImg from "./assets/sectors/meadow2.png";
import meadowSectorImg from "./assets/sectors/meadow.png";
import stormveilVillageImg from "./assets/sectors/stormveil-village.png";
import shinobiBanner from './assets/shinobi-banner.png'
import rightMenuBg from "./assets/rightmenu.png";
import sectorBanner from "./assets/sectorbanner.png";
import backgroundImage from "./assets/background-image.png";
type Screen =
    | "start"
    | "adminLogin"
    | "adminPanel"
    | "village"
    | "villageLore"
    | "profile"
    | "inventory"
    | "training"
    | "jutsuTraining"
    | "missions"
    | "arena"
    | "bloodlineMaker"
    | "clan"
    | "worldMap"
    | "townHall"
    | "bank"
    | "shop"
    | "grandMarketplace"
    | "hospital"
    | "cafeteria"
    | "storyHall"
    | "storyBoss"
    | "sunscarFestival"
    | "centralHub"
    | "petArena"
    | "pets"
    | "shinobiTiles";

type Rank = "B Rank" | "A Rank" | "S Rank";
type Biome = "forest" | "snow" | "volcano" | "shadow" | "central";
type JutsuType = "Ninjutsu" | "Taijutsu" | "Genjutsu" | "Bukijutsu";
type JutsuElement = "Earth" | "Wind" | "Lightning" | "Fire" | "Water";
type JutsuTarget = "SELF" | "OPPONENT" | "OTHER_USER" | "CHARACTER" | "EMPTY_GROUND";
type JutsuMethod = "SINGLE" | "ALL" | "AOE_CIRCLE" | "AOE_LINE";
type JutsuSort = "name" | "type" | "element" | "effect" | "ap" | "range" | "effectPower";
type WeatherType =
    | "clear"
    | "rain"
    | "ashfall"
    | "thunderstorm"
    | "tornado"
    | "desertHaze";

type VillageUpgradeKey =
    | "training"
    | "jutsuTraining"
    | "shop"
    | "townDefense"
    | "petYard"
    | "bank"
    | "missionHall"
    | "hospital";

type VillageUpgrades = Record<VillageUpgradeKey, number>;

const terrainEffects: Record<
    Biome,
    {
        name: string;
        description: string;
        playerBuff?: string;
    }
> = {
    forest: {
        name: "Forest Terrain",
        description: "Taijutsu and Bukijutsu are empowered.",
        playerBuff: "+10% Physical Damage",
    },

    snow: {
        name: "Frozen Terrain",
        description: "Water techniques are empowered.",
        playerBuff: "+10% Water Damage",
    },

    volcano: {
        name: "Volcanic Terrain",
        description: "Fire attacks burn hotter.",
        playerBuff: "+10% Fire Damage",
    },

    shadow: {
        name: "Shadow Terrain",
        description: "Genjutsu thrives in darkness.",
        playerBuff: "+10% Genjutsu Damage",
    },

    central: {
        name: "Central Arena",
        description: "Balanced battlefield.",
    },
};

const weatherEffects: Record<
    WeatherType,
    {
        name: string;
        description: string;
        effect: string;
        positiveElement?: JutsuElement;
        negativeElement?: JutsuElement;
    }
> = {
    clear: {
        name: "Clear Skies",
        description: "No active weather effect.",
        effect: "No combat modifiers.",
    },

    rain: {
        name: "Rainstorm",
        description: "Water chakra flows easier while fire struggles to ignite.",
        effect: "Water damage +5%. Fire damage -2%.",
        positiveElement: "Water",
        negativeElement: "Fire",
    },

    ashfall: {
        name: "Ashfall",
        description: "Fire chakra burns hotter while water is choked by drifting ash.",
        effect: "Fire damage +5%. Water damage -2%.",
        positiveElement: "Fire",
        negativeElement: "Water",
    },

    thunderstorm: {
        name: "Thunderstorm",
        description: "Lightning surges through the field while wind patterns collapse.",
        effect: "Lightning damage +5%. Wind damage -2%.",
        positiveElement: "Lightning",
        negativeElement: "Wind",
    },

    tornado: {
        name: "Tornado",
        description: "Wind chakra accelerates while grounded techniques lose stability.",
        effect: "Wind damage +5%. Earth damage -2%.",
        positiveElement: "Wind",
        negativeElement: "Earth",
    },

    desertHaze: {
        name: "Desert Haze",
        description: "Earth chakra hardens while lightning has trouble finding a clean path.",
        effect: "Earth damage +5%. Lightning damage -2%.",
        positiveElement: "Earth",
        negativeElement: "Lightning",
    },
};

const biomeWeatherTables: Record<Biome, WeatherType[]> = {
    forest: ["rain", "tornado", "rain", "clear"],
    snow: ["rain", "thunderstorm", "clear", "rain"],
    volcano: ["ashfall", "desertHaze", "ashfall", "clear"],
    shadow: ["thunderstorm", "tornado", "desertHaze", "clear"],
    central: ["clear", "rain", "ashfall", "thunderstorm", "tornado", "desertHaze"],
};

function weatherForBiome(biome: Biome) {
    return biomeWeatherTables[biome][0] ?? "clear";
}

function weatherForSector(sector: number, biome: Biome) {
    const table = biomeWeatherTables[biome];
    return table[(sector - 1) % table.length] ?? "clear";
}
type Stats = {
    strength: number;
    speed: number;
    intelligence: number;
    willpower: number;
    bukijutsuOffense: number;
    bukijutsuDefense: number;
    taijutsuOffense: number;
    taijutsuDefense: number;
    genjutsuOffense: number;
    genjutsuDefense: number;
    ninjutsuOffense: number;
    ninjutsuDefense: number;
};

type JutsuMastery = { jutsuId: string; level: number; xp: number };
type AdminAccount = "Admin 1" | "Admin 2";
type PetRarity = "standard" | "rare" | "legendary" | "mythic";
type PetTrait = "Loyal" | "Aggressive" | "Guardian" | "Swift" | "Lucky" | "Battleborn";
type PetTrainingType = "strength" | "endurance" | "agility" | "chakra" | "bond";

type PetJutsu = {
    name: string;
    power: number;
    cooldown: number;
    currentCooldown: number;
    kind: "damage" | "buff";
};

type Pet = {
    id: string;
    name: string;
    rarity: PetRarity;
    level: number;
    xp: number;
    maxLevel: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    image?: string;
    description?: string;
    jutsus: PetJutsu[];
    unlockedForPve: boolean;
    trait?: PetTrait;
    training?: { type: PetTrainingType; endsAt: number };
};
type Character = {
    name: string;
    village: string;
    specialty: JutsuType;
    bloodline: string;
    avatarImage?: string;
    level: number;
    xp: number;
    ryo: number;
    bankRyo: number;
    honorSeals: number;
    auraDust: number;
    auraSphereLevel: number;
    fateShards: number;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    rankTitle: string;
    storyProgress: number;
    storyVillage: string;
    equippedBloodlineId?: string;
    stats: Stats;
    unspentStats: number;
    equippedJutsuIds: string[];
    inventory: string[];
    equipment: EquipmentSlots;
    jutsuMastery: JutsuMastery[];
    pets: Pet[];
    activePetId?: string;
    tileCards: string[];
    element?: string;
    elements?: string[];
    boneCharms: number;
    auraStones: number;
    mythicSeals: number;
    clan?: string;
    clanFounder?: boolean;
    clanBattleContrib: number;
    clanEventContrib: number;
    clanMissionContrib: number;
    clanContribMonth?: string;
    guardQueued?: boolean;
    hospitalized?: boolean;
    villageUpgrades: VillageUpgrades;
    lastBankInterestAt?: number;
};
type RewardCurrencyKey = "fateShards" | "honorSeals" | "boneCharms" | "auraStones" | "auraDust" | "mythicSeals";
type CurrencyRewards = Partial<Record<RewardCurrencyKey, number>>;

type PlayerRecord = {
    name: string;
    level: number;
    village: string;
    specialty: JutsuType;
    character: Character;
    currentSector?: number;
    lastSeenAt?: number;
};

type DuelChallenge = {
    id: string;
    fromName: string;
    toName: string;
    challenger: Character;
    createdAt: number;
};

type AiCondition = "always" | "specific_round" | "distance_lower_than" | "distance_higher_than" | "hp_lower_than";
type AiAction = "use_specific_jutsu" | "use_highest_power_jutsu" | "move_towards_opponent" | "use_basic_attack";
type AiRule = {
    id: string;
    condition: AiCondition;
    value: number;
    action: AiAction;
    jutsuId?: string;
};
type CreatorAi = {
    id: string;
    name: string;
    icon: string;
    image?: string;
    level: number;
    village: string;
    hp: number;
    chakra: number;
    stamina: number;
    stats: Stats;
    jutsuIds: string[];
    rules: AiRule[];
};

type JutsuTag = { name: string; percent: number };

type Jutsu = {
    id: string;
    name: string;
    type: JutsuType;
    element: JutsuElement;
    ap: number;
    range: number;
    effectPower: number;
    cooldown: number;
    currentCooldown: number;
    chakraCost: number;
    staminaCost: number;
    healthCost: number;
    target: JutsuTarget;
    method: JutsuMethod;
    battleDescription: string;
    healthCostReducePerLvl: number;
    chakraCostReducePerLvl: number;
    staminaCostReducePerLvl: number;
    tags: JutsuTag[];
    description?: string;
    image?: string;
    bloodlineRank?: Rank; // set on bloodline jutsus; absent = global/starter
};
type EquipmentSlot = "aura" | "hand" | "body" | "waist" | "legs" | "feet" | "head" | "item" | "thrown" | "weapon" | "armor" | "accessory";

const itemSectionOptions: Array<{ value: EquipmentSlot; label: string }> = [
    { value: "aura", label: "Aura" },
    { value: "hand", label: "Hand" },
    { value: "body", label: "Body" },
    { value: "waist", label: "Waist" },
    { value: "legs", label: "Legs" },
    { value: "feet", label: "Feet" },
    { value: "head", label: "Head" },
    { value: "item", label: "Item" },
    { value: "thrown", label: "Thrown" },
];

function normalizeEquipmentSlot(slot: EquipmentSlot): EquipmentSlot {
    if (slot === "weapon") return "hand";
    if (slot === "armor") return "body";
    if (slot === "accessory") return "aura";
    return slot;
}

function equipmentSlotLabel(slot: EquipmentSlot) {
    const normalized = normalizeEquipmentSlot(slot);
    return itemSectionOptions.find((option) => option.value === normalized)?.label ?? normalized;
}

type ArmorQuality = "Standard" | "Reinforced" | "Rare" | "Elite" | "Legendary";

const armorQualityTiers: { quality: ArmorQuality; reduction: number; label: string }[] = [
    { quality: "Standard", reduction: 0.01, label: "Standard — 1% damage reduction" },
    { quality: "Reinforced", reduction: 0.05, label: "Reinforced — 5% damage reduction" },
    { quality: "Rare", reduction: 0.07, label: "Rare — 7% damage reduction" },
    { quality: "Elite", reduction: 0.10, label: "Elite — 10% damage reduction" },
    { quality: "Legendary", reduction: 0.15, label: "Legendary — 15% damage reduction" },
];

function armorReductionForQuality(quality?: ArmorQuality): number {
    return armorQualityTiers.find((t) => t.quality === quality)?.reduction ?? 0;
}

function getActivePetTrait(character: Character): PetTrait | undefined {
    return character.pets?.find((p) => p.id === character.activePetId)?.trait;
}

function getCharacterArmorFactor(character: Character, allItems: GameItem[]): number {
    const armorSlots: EquipmentSlot[] = ["head", "body", "armor", "waist", "legs", "feet"];
    let totalReduction = 0;
    for (const slot of armorSlots) {
        const id = character.equipment?.[slot];
        if (!id) continue;
        const item = allItems.find((i) => i.id === id);
        if (item?.armorQuality) totalReduction += armorReductionForQuality(item.armorQuality);
    }
    if (getActivePetTrait(character) === "Guardian") totalReduction += 0.08;
    return Math.max(0.25, 1 - totalReduction);
}

type GameItem = {
    id: string;
    name: string;
    slot: EquipmentSlot;
    rarity: "common" | "rare" | "epic" | "legendary" | "mythic";
    cost: number;
    description: string;
    armorQuality?: ArmorQuality;
    image?: string;
    bonuses: Partial<Stats> & {
        maxHp?: number;
        maxChakra?: number;
        maxStamina?: number;
    };
};

type EquipmentSlots = Partial<Record<EquipmentSlot, string>>;
type SavedBloodline = {
    id: string;
    name: string;
    rank: Rank;
    image?: string;
    specialElement?: string;
    lore?: string;
    jutsus: Jutsu[];
    totalPoints: number;
};

type ActiveTraining = {
    label: string;
    stat: keyof Stats;
    xp: number;
    statGain: number;
    staminaCost: number;
    endsAt: number;
};

type CreatorEvent = {
    id: string;
    name: string;
    biome: Biome;
    icon: string;
    eventKind?: "reward" | "visualNovel";
    trigger?: "manual" | "firstBattleArena" | "firstLeaveVillage";
    vnTitle?: string;
    vnScene?: string;
    vnSpeaker?: string;
    image?: string;
    aiProfileId?: string;
    vnPages?: {
        title: string;
        scene: string;
        speaker: string;
        dialogue: string[];
        image?: string;
        choices?: { text: string; nextPage: number; conclusion?: string }[];
    }[];
    levelReq: number;
    xpReward: number;
    ryoReward: number;
    staminaReward: number;
    currencyRewards?: CurrencyRewards;
    dialogue: string[];
};

type MissionRank = "Daily" | "D Rank" | "C Rank" | "B Rank" | "A Rank" | "S Rank";

type CreatorMission = {
    id: string;
    name: string;
    rank: MissionRank;
    description: string;
    type: "fetchExplore";
    aiProfileId?: string;
    targetSector: number;
    exploreCount: number;
    levelReq: number;
    xpReward: number;
    ryoReward: number;
    staminaReward: number;
    currencyRewards?: CurrencyRewards;
};

type CreatorRaid = {
    id: string;
    name: string;
    biome: Biome;
    icon: string;
    levelReq: number;
    aiProfileId?: string;
    waves: number;
    xpReward: number;
    ryoReward: number;
    staminaReward: number;
    currencyRewards?: CurrencyRewards;
    description: string;
};

type PlayerAccountSave = {
    password: string;
    snapshot: {
        character: Character;
        currentBiome: Biome;
        activeTraining: ActiveTraining | null;
        acceptedMissionIds: string[];
        missionProgress: Record<string, number>;
        triggeredEvents: string[];
        pendingAiProfileId: string;
        currentSector?: number;
    };
};

type PlayerAccounts = Record<string, PlayerAccountSave>;

type StoryStep = {
    levelReq: number;
    title: string;
    cinematicTitle: string;
    scene: string;
    dialogue: string[];
    bossName: string;
    bossIcon: string;
    bossHp: number;
    bossDamage: number;
    rewardXp: number;
    rewardRyo: number;
};

const MAX_LEVEL = 100;
const MAX_STAT = 2500;
const AWAKENING_VN_ID = "builtin-awakening-lv2";
const AURA_SPHERE_VN_ID = "builtin-aura-sphere-lv9";
const AURA_SPHERE_ITEM_ID = "aura-sphere";
const AWAKENING_FREE_LV2_ID = "awakening-free-lv2";
const AWAKENING_FREE_LV20_ID = "awakening-free-lv20";
const AWAKENING_ELEMENTS = ["Water", "Wind", "Earth", "Lightning", "Fire"] as const;
const STUN_AP_PENALTY = 40;
function rollAwakeningElement(): string {
    return AWAKENING_ELEMENTS[Math.floor(Math.random() * AWAKENING_ELEMENTS.length)];
}
function elementIcon(element?: string) {
    if (element === "Water") return "💧";
    if (element === "Wind") return "🌀";
    if (element === "Earth") return "🪨";
    if (element === "Lightning") return "⚡";
    if (element === "Fire") return "🔥";
    return "✦";
}
function uniqueElements(elements: (string | undefined | null)[]) {
    const seen = new Set<string>();
    return elements
        .map((element) => element?.trim())
        .filter((element): element is string => Boolean(element))
        .filter((element) => {
            const key = element.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}
function getCharacterElements(character: Pick<Character, "element" | "elements">) {
    return uniqueElements([...(character.elements ?? []), character.element]);
}
function hasCharacterElement(character: Pick<Character, "element" | "elements">, element?: string) {
    if (!element) return true;
    const ownedElements = getCharacterElements(character).map((owned) => owned.toLowerCase());
    return ownedElements.includes(element.toLowerCase());
}
function getCharacterBloodlines(character: Pick<Character, "bloodline" | "equippedBloodlineId">, savedBloodlines: SavedBloodline[]) {
    const starterBloodlineName = character.bloodline === "Blue Blade Eyes" ? "Ashen Eyes" : character.bloodline;
    const starterBloodline = starterSavedBloodlines.find((bloodline) => bloodline.name === starterBloodlineName);
    const equippedBloodline = [...savedBloodlines, ...starterSavedBloodlines].find((bloodline) => bloodline.id === character.equippedBloodlineId);
    return [starterBloodline, equippedBloodline]
        .filter((bloodline): bloodline is SavedBloodline => Boolean(bloodline))
        .filter((bloodline, index, bloodlines) => bloodlines.findIndex((candidate) => candidate.id === bloodline.id) === index);
}
function isBloodlineSpecialElementJutsu(character: Character, jutsu: Jutsu, savedBloodlines: SavedBloodline[]) {
    return getCharacterBloodlines(character, savedBloodlines).some((bloodline) =>
        Boolean(bloodline.specialElement) &&
        bloodline.specialElement?.toLowerCase() === jutsu.element.toLowerCase() &&
        bloodline.jutsus.some((bloodlineJutsu) => bloodlineJutsu.id === jutsu.id)
    );
}
function canEquipElementJutsu(character: Character, jutsu: Jutsu, savedBloodlines: SavedBloodline[]) {
    return hasCharacterElement(character, jutsu.element) || isBloodlineSpecialElementJutsu(character, jutsu, savedBloodlines);
}
function rollNewAwakeningElement(currentElements: string[]) {
    const current = new Set(currentElements.map((element) => element.toLowerCase()));
    const available = AWAKENING_ELEMENTS.filter((element) => !current.has(element.toLowerCase()));
    return available.length ? available[Math.floor(Math.random() * available.length)] : rollAwakeningElement();
}
function rollAwakeningElements(count: number) {
    return Array.from({ length: Math.min(count, AWAKENING_ELEMENTS.length) }).reduce<string[]>((elements) => {
        return [...elements, rollNewAwakeningElement(elements)];
    }, []);
}
const awakeningLv2VnEvent: CreatorEvent = {
    id: AWAKENING_VN_ID,
    name: "The Awakening Stone Calls",
    biome: "central",
    icon: "💎",
    eventKind: "visualNovel",
    trigger: "firstLeaveVillage",
    levelReq: 2,
            xpReward: 0,
            ryoReward: 0,
            staminaReward: 0,
            currencyRewards: {},
            dialogue: [],
    vnPages: [
        {
            title: "A Strange Resonance",
            scene: "An ancient energy stirs as you step beyond the village gates.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: The moment you step past the gates, a deep hum resonates through your chakra network.",
                "Narrator: It pulses from far away — from the heart of Central, the Thousand Gates.",
                "Village Elder: Wait, young one. You feel it, don't you?",
                "Village Elder: That vibration. The Awakening Stone is calling to you.",
                "Village Elder: Hidden within Central Hub lies an ancient relic — the Awakening Stone.",
                "Village Elder: Every shinobi carries a hidden elemental nature — Water, Wind, Earth, Lightning, or Fire.",
                "Village Elder: The stone will awaken yours and align your chakra to its truest form.",
                "Village Elder: Travel to Central Hub. Find the Awakening Stone. Discover your element.",
                "Village Elder: At certain power thresholds — level 2 and level 20 — the stone will read you for free.",
                "Narrator: A new path opens before you. The Awakening Stone awaits in Central...",
            ],
        },
    ],
};
const auraSphereLv9VnEvent: CreatorEvent = {
    id: AURA_SPHERE_VN_ID,
    name: "The Elder's Aura Sphere",
    biome: "central",
    icon: "AS",
    eventKind: "visualNovel",
    trigger: "manual",
    levelReq: 9,
    xpReward: 0,
    ryoReward: 0,
    staminaReward: 0,
    dialogue: [],
    vnPages: [
        {
            title: "A Quiet Summons",
            scene: "An elder waits beside a low lantern, holding a small sphere that drinks in the light around it.",
            speaker: "Village Elder",
            dialogue: [
                "Village Elder: Level nine already. Your chakra is beginning to leave footprints in the air.",
                "Village Elder: That means you are ready to carry something older than our village walls.",
                "Village Elder: This is an Aura Sphere. It does not make power for you. It remembers the power you earn.",
            ],
        },
        {
            title: "The Sphere Awakens",
            scene: "The sphere rises from the elder's palm and turns slowly, mist curling around its surface.",
            speaker: "Village Elder",
            dialogue: [
                "Village Elder: Equip it in your aura slot. Only then will its menu reveal itself to you.",
                "Village Elder: Feed it Aura Dust from battles, raids, bosses, war contribution, and ancient chests.",
                "Village Elder: Treat it well, and one day your own aura will answer before you speak.",
            ],
        },
    ],
};
const JUTSU_MAX_LEVEL = 50;
const JUTSU_TRAINING_CAP = 30;
const STORAGE = "ninjav-admin-build-v1";
const PLAYER_ACCOUNTS_STORAGE = "ninjav-player-accounts-v1";
const HP_CAP = 10000;
const CHAKRA_CAP = 5000;
const STAMINA_CAP = 5000;

const villages = ["Stormveil Village", "Ashen Leaf Village", "Frostfang Village", "Moonshadow Village"];
function villagePageImage(villageName: string): string {
    if (villageName === "Stormveil Village") return stormveilVillageImg;
    if (villageName === "Ashen Leaf Village") return houseImg;
    if (villageName === "Frostfang Village") return castleImg;
    if (villageName === "Moonshadow Village") return moonshadowImage;
    return stormveilVillageImg;
}
function villageOutskirtsSectorNumber(villageName: string): number {
    if (villageName === "Stormveil Village") return 31;
    if (villageName === "Ashen Leaf Village") return 38;
    if (villageName === "Frostfang Village") return 47;
    if (villageName === "Moonshadow Village") return 11;
    return 40;
}
function villageForOutskirtsSector(sector: number): string | undefined {
    return villages.find((village) => villageOutskirtsSectorNumber(village) === sector);
}
const villageLore: Record<string, { icon: string; theme: string; lore: string }> = {
    "Ashen Leaf Village": {
        icon: "🌿",
        theme: "The Traditional Path",
        lore: `Born from the remnants of a world once consumed by fire, Ashen Leaf rose where devastation met renewal.

Long ago, the land was reduced to ash during a great war between rival clans. From that scorched earth, a single forest began to grow—its leaves darkened by soot, yet alive with quiet strength.

The survivors who gathered there believed in preserving the old ways. They rebuilt not just a village, but a philosophy: discipline, balance, and respect for tradition above all else.

Their shinobi are taught that true strength is not taken—it is cultivated. Every jutsu, every movement, is rooted in history. While other villages chase evolution, Ashen Leaf endures.

To walk their path is to carry the weight of legacy… and the honor that comes with it.`
    },

    "Stormveil Village": {
        icon: "⚡",
        theme: "The Chaotic Path",
        lore: `Stormveil was never meant to exist.

It began as a refuge for outcasts—rogue shinobi, exiles, and warriors who rejected the rigid laws of the great villages. They gathered beneath endless storms, where lightning split the sky and power answered only to those bold enough to seize it.

There were no rulers. No traditions. Only strength.

Over time, Stormveil became something far more dangerous than a village—it became a proving ground. Alliances are temporary, betrayal is common, and power shifts like the storm itself.

Their shinobi embrace unpredictability. They fight without restraint, evolve without limits, and destroy anything that tries to control them.

To join Stormveil is to abandon certainty… and become the storm.`
    },

    "Frostfang Village": {
        icon: "❄️",
        theme: "The Loyal Path",
        lore: `Far beyond the reach of warm lands lies Frostfang—a village carved into ice and bound by unbreakable unity.

Founded by a single clan that survived the harshest winters imaginable, Frostfang was built on one principle: no one survives alone. The cold does not forgive weakness, and so its people became each other’s strength.

Every shinobi of Frostfang is raised as part of a greater whole. Loyalty is not taught—it is lived. To betray the village is to lose not just honor, but identity.

Their warriors fight with precision and purpose, moving as one, striking as one. Like a pack of wolves in the snow, they overwhelm their enemies through trust and coordination.

To stand with Frostfang is to never stand alone… but to fall means you have failed more than just yourself.`
    },

    "Moonshadow Village": {
        icon: "🌙",
        theme: "The Selfish Path",
        lore: `Moonshadow exists in silence… and thrives in secrecy.

No one knows exactly when it was founded. Some say it emerged from assassins who abandoned all allegiance. Others believe it was built by those who understood a simple truth: trust is weakness.

In Moonshadow, every shinobi walks their own path. Power is personal. Alliances are fleeting. Even within the village, information is currency—and secrets are worth more than gold.

They are masters of stealth, deception, and precision. They strike from darkness, achieve their goals, and vanish before consequences can follow.

Where other villages build bonds, Moonshadow cultivates ambition.

To choose Moonshadow is to rely on no one… and ensure no one can ever control you.`
    }
};
const specialties: JutsuType[] = ["Ninjutsu", "Taijutsu", "Genjutsu", "Bukijutsu"];
const jutsuElements: JutsuElement[] = ["Earth", "Wind", "Lightning", "Fire", "Water"];
const jutsuTargets: JutsuTarget[] = ["OPPONENT", "SELF", "OTHER_USER", "CHARACTER", "EMPTY_GROUND"];
const jutsuMethods: JutsuMethod[] = ["SINGLE", "ALL", "AOE_CIRCLE", "AOE_LINE"];
const bloodlineJutsuMethods: JutsuMethod[] = ["SINGLE", "AOE_CIRCLE"];
const starterBloodlines = ["Ashen Eyes", "Inferno Cataclysm", "Shadow Lotus", "Iron Fang"];
const petTraits: PetTrait[] = ["Loyal", "Aggressive", "Guardian", "Swift", "Lucky", "Battleborn"];
const petTraitDescriptions: Record<PetTrait, string> = {
    Loyal: "Pet trains 50% faster — gains more stats from every training session",
    Aggressive: "Pet spawns with +15% attack",
    Guardian: "Pet spawns with +20% HP & defense — reduces your incoming battle damage by 8% while active",
    Swift: "Pet spawns with +20% speed — you earn +25% XP from battles while active",
    Lucky: "You earn +20% ryo from battles while this pet is active",
    Battleborn: "Pet spawns with +10% to all stats",
};
const petTrainingDurations = [
    { label: "15 minutes", ms: 15 * 60 * 1000 },
    { label: "1 hour", ms: 60 * 60 * 1000 },
    { label: "4 hours", ms: 4 * 60 * 60 * 1000 },
    { label: "8 hours", ms: 8 * 60 * 60 * 1000 },
] as const;
const petRarityOrder: PetRarity[] = ["standard", "rare", "legendary", "mythic"];
const petTrainingOptions: { type: PetTrainingType; label: string; desc: string }[] = [
    { type: "strength", label: "Strength Training", desc: "Boosts attack (+3 per session)" },
    { type: "endurance", label: "Endurance Training", desc: "Boosts HP (+15) and defense (+2)" },
    { type: "agility", label: "Agility Training", desc: "Boosts speed (+2)" },
    { type: "chakra", label: "Chakra Training", desc: "Boosts jutsu power (+2 per jutsu)" },
    { type: "bond", label: "Bond Training", desc: "Earns XP and improves passive bonuses" },
];
const petTreatItems = [
    { id: "pet-treat", name: "Treats", xp: 100 },
    { id: "elemental-pet-treat", name: "Elemental Treats", xp: 250 },
    { id: "ancient-pet-treat", name: "Ancient Treats", xp: 500 },
] as const;
const petFeedItems = [
    ...petTreatItems,
    { id: "golden-apple", name: "Golden Apple", xp: 2000 },
] as const;
const stackableItemIds = new Set<string>(petFeedItems.map((item) => item.id));
function petFeedXpForItem(itemId?: string): number | undefined {
    return petFeedItems.find((item) => item.id === itemId)?.xp;
}
function rollPetTrait(rarity: PetRarity): PetTrait {
    const pool = rarity === "mythic" ? petTraits : petTraits.filter((t) => t !== "Guardian");
    return pool[Math.floor(Math.random() * pool.length)];
}
function applyPetTraitBonuses(pet: Pet, trait: PetTrait): Pet {
    switch (trait) {
        case "Aggressive": return { ...pet, attack: Math.round(pet.attack * 1.15) };
        case "Battleborn": return { ...pet, attack: Math.round(pet.attack * 1.1), hp: Math.round(pet.hp * 1.1), defense: Math.round(pet.defense * 1.1), speed: Math.round(pet.speed * 1.1) };
        case "Guardian": return { ...pet, hp: Math.round(pet.hp * 1.2), defense: Math.round(pet.defense * 1.2) };
        case "Swift": return { ...pet, speed: Math.round(pet.speed * 1.2) };
        default: return pet;
    }
}
function collectPetTraining(pet: Pet): Pet {
    if (!pet.training) return pet;
    const xpMult = pet.trait === "Loyal" ? 1.5 : 1;
    switch (pet.training.type) {
        case "strength": return { ...pet, attack: pet.attack + Math.round(3 * xpMult), training: undefined };
        case "endurance": return { ...pet, hp: pet.hp + Math.round(15 * xpMult), defense: pet.defense + Math.round(2 * xpMult), training: undefined };
        case "agility": return { ...pet, speed: pet.speed + Math.round(2 * xpMult), training: undefined };
        case "chakra": return { ...pet, jutsus: pet.jutsus.map(j => ({ ...j, power: j.power + Math.round(2 * xpMult) })), training: undefined };
        case "bond": return { ...pet, xp: pet.xp + Math.round(50 * xpMult), training: undefined };
    }
}
function petXpNeeded(level: number): number {
    return Math.max(100, Math.floor(level * 100));
}
function gainPetXp(pet: Pet, amount: number): Pet {
    let level = pet.level;
    let xp = pet.xp + Math.max(0, Math.floor(amount));

    while (level < pet.maxLevel && xp >= petXpNeeded(level)) {
        xp -= petXpNeeded(level);
        level += 1;
    }

    if (level >= pet.maxLevel) {
        level = pet.maxLevel;
        xp = 0;
    }

    return { ...pet, level, xp };
}
function formatPetTimer(ms: number): string {
    if (ms <= 0) return "Done";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}
const petPool: Pet[] = [
    // STANDARD PETS - weakest
    ...[
        "Red Fox", "Snow Rabbit", "Black Cat", "Forest Hawk", "River Otter",
        "Stone Turtle", "Desert Lizard", "Ashen Crow", "Blue Frog", "Wild Boar",
        "Pine Owl", "Sand Snake", "Mist Ferret", "Iron Beetle", "White Crane",
        "Cinder Rat", "Meadow Deer", "Storm Gull", "Shadow Bat", "Mud Toad",
        "Leaf Monkey", "Frost Cub", "Temple Gecko", "Rock Badger", "Tiny Wolf"
    ].map((name, index): Pet => ({
        id: `standard-${index}`,
        name,
        rarity: "standard",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 150 + index * 4,
        attack: 18 + index,
        defense: 12 + index,
        speed: 10 + index,
        unlockedForPve: false,
        jutsus: [
            {
                name: `${name} Strike`,
                power: 35 + index,
                cooldown: 3,
                currentCooldown: 0,
                kind: "damage",
            },
        ],
    })),
    // RARE PETS - stronger than standard, weaker than legendary
    ...[
        "Crimson Fox", "Frost Hare", "Night Panther", "Sky Falcon", "Tide Otter",
        "Ironback Turtle", "Dune Viper", "Ashwing Raven", "Azure Toad", "Bristle Boar",
        "Silver Owl", "Glass Serpent", "Mist Lynx", "Steel Beetle", "Pearl Crane",
        "Cinder Weasel", "Thorn Stag", "Stormfin Gull", "Duskwings Bat", "Mossback Toad",
        "Bamboo Ape", "Frostbite Cub", "Shrine Salamander", "Granite Badger", "Young Direwolf"
    ].map((name, index): Pet => ({
        id: `rare-${index}`,
        name,
        rarity: "rare",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 275 + index * 7,
        attack: 34 + index,
        defense: 24 + index,
        speed: 20 + index,
        unlockedForPve: false,
        jutsus: [
            {
                name: `${name} Strike`,
                power: 55 + index,
                cooldown: 3,
                currentCooldown: 0,
                kind: "damage",
            },
            {
                name: `${name} Instinct`,
                power: 8,
                cooldown: 4,
                currentCooldown: 0,
                kind: "buff",
            },
        ],
    })),
    // LEGENDARY PETS - middle
    ...[
        "Glacier Wolf", "Tempest Hawk", "Umbra Fox", "Spirit Deer", "Ironfang Tiger",
        "Azure Kirin", "Ember Phoenix", "Moon Serpent", "Storm Lion", "Crystal Bear",
        "Void Raven", "Thunder Drake", "Frost Lynx", "Golden Scarab", "Ancient Crane"
    ].map((name, index): Pet => ({
        id: `legendary-${index}`,
        name,
        rarity: "legendary",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 450 + index * 12,
        attack: 55 + index * 2,
        defense: 42 + index * 2,
        speed: 35 + index,
        unlockedForPve: false,
        jutsus: [
            {
                name: `${name} Battle Cry`,
                power: 12,
                cooldown: 3,
                currentCooldown: 0,
                kind: "buff",
            },
            {
                name: `${name} Fang Art`,
                power: 90 + index * 2,
                cooldown: 3,
                currentCooldown: 0,
                kind: "damage",
            },
        ],
    })),

    // MYTHIC PETS - strongest
    {
        id: "mythic-0",
        name: "Eclipse Kitsune",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1000,
        attack: 130,
        defense: 95,
        speed: 115,
        unlockedForPve: false,
        jutsus: [
            { name: "Nine Shadow Blessing", power: 25, cooldown: 3, currentCooldown: 0, kind: "buff" },
            { name: "Eclipse Fang", power: 180, cooldown: 3, currentCooldown: 0, kind: "damage" },
            { name: "Moonbreak Nova", power: 260, cooldown: 3, currentCooldown: 0, kind: "damage" },
        ],
    },
    {
        id: "mythic-1",
        name: "Worldstorm Dragon",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1100,
        attack: 150,
        defense: 90,
        speed: 100,
        unlockedForPve: false,
        jutsus: [
            { name: "Storm King Aura", power: 22, cooldown: 3, currentCooldown: 0, kind: "buff" },
            { name: "Thunder Maw", power: 200, cooldown: 3, currentCooldown: 0, kind: "damage" },
            { name: "Sky Rupture Beam", power: 290, cooldown: 3, currentCooldown: 0, kind: "damage" },
        ],
    },
    {
        id: "mythic-2",
        name: "Ancient Frost Titan",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1250,
        attack: 120,
        defense: 140,
        speed: 70,
        unlockedForPve: false,
        jutsus: [
            { name: "Absolute Zero Guard", power: 30, cooldown: 3, currentCooldown: 0, kind: "buff" },
            { name: "Glacier Crush", power: 175, cooldown: 3, currentCooldown: 0, kind: "damage" },
            { name: "Frozen World Slam", power: 250, cooldown: 3, currentCooldown: 0, kind: "damage" },
        ],
    },
    {
        id: "mythic-3",
        name: "Solar Stag",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 950,
        attack: 115,
        defense: 100,
        speed: 140,
        unlockedForPve: false,
        jutsus: [
            { name: "Solar Spirit Blessing", power: 35, cooldown: 3, currentCooldown: 0, kind: "buff" },
            { name: "Radiant Horn", power: 165, cooldown: 3, currentCooldown: 0, kind: "damage" },
            { name: "Sunfall Judgment", power: 245, cooldown: 3, currentCooldown: 0, kind: "damage" },
        ],
    },
    {
        id: "mythic-4",
        name: "Abyssal Oni Hound",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1050,
        attack: 170,
        defense: 85,
        speed: 95,
        unlockedForPve: false,
        jutsus: [
            { name: "Oni Rage Howl", power: 28, cooldown: 3, currentCooldown: 0, kind: "buff" },
            { name: "Abyss Bite", power: 210, cooldown: 3, currentCooldown: 0, kind: "damage" },
            { name: "Hellhound Execution", power: 310, cooldown: 3, currentCooldown: 0, kind: "damage" },
        ],
    },
];
function mergeMissingBuiltInPets(currentPets: Pet[]): Pet[] {
    const currentIds = new Set(currentPets.map((pet) => pet.id));
    const missingBuiltInPets = petPool.filter((pet) => !currentIds.has(pet.id));

    return [...currentPets, ...missingBuiltInPets];
}
function cloneEncounterPet(pet: Pet): Pet {
    return {
        ...pet,
        id: `${pet.id}-${Date.now()}`,
        jutsus: pet.jutsus.map((jutsu) => ({ ...jutsu })),
    };
}
const starterBloodlineOffense: Record<string, JutsuType> = {
    "Ashen Eyes": "Genjutsu",
    "Inferno Cataclysm": "Ninjutsu",
    "Shadow Lotus": "Bukijutsu",
    "Iron Fang": "Taijutsu",
};

const percentageTags = [
    "Increase Damage Given",
    "Decrease Damage Given",
    "Increase Damage Taken",
    "Decrease Damage Taken",
    "Absorb",
    "Lifesteal",
    "Afterburn",
    "Reflect",
    "Recoil",
    "Wound",
];

// Tags whose percent is capped per source rank
const cappedDamageTags = [
    "Increase Damage Given",
    "Decrease Damage Given",
    "Increase Damage Taken",
    "Decrease Damage Taken",
    "Absorb",
    "Lifesteal",
    "Afterburn",
    "Reflect",
    "Recoil",
];

// Tags that are binary (always apply, no percent-based hit chance)
const binaryTags = [
    "Stun",
    "Seal",
    "Elemental Seal",
    "Copy",
    "Mirror",
    "Move",
    "Buff Prevent",
    "Debuff Prevent",
    "Cleanse Prevent",
    "Clear Prevent",
    "Stun Prevent",
    "Time Compression",
    "Time Dilation",
];

function normalizeJutsuTags(tags?: JutsuTag[]): JutsuTag[] {
    return (tags ?? [])
        .filter((tag) => tag.name?.trim())
        .map((tag) => binaryTags.includes(tag.name) ? { ...tag, percent: 0 } : tag);
}

function tagCapForRank(rank?: Rank | null): number {
    if (rank === "S Rank") return 40;
    if (rank === "A Rank" || rank === "B Rank") return 35;
    return 30; // global / no rank
}

function effectiveTagPercent(tag: JutsuTag, bloodlineRank?: Rank | null): number {
    const raw = tag.percent > 0 ? tag.percent : 30;
    if (cappedDamageTags.includes(tag.name)) {
        return Math.min(raw, tagCapForRank(bloodlineRank));
    }
    return raw;
}

const allTags = [
    "Damage",
    "Absorb",
    "Afterburn",
    "Barrier",
    "Buff Prevent",
    "Cleanse Prevent",
    "Clear Prevent",
    "Copy",
    "Debuff Prevent",
    "Decrease Damage Given",
    "Decrease Damage Taken",
    "Drain",
    "Elemental Seal",
    "Heal",
    "Increase Damage Given",
    "Increase Damage Taken",
    "Increase Heal",
    "Lifesteal",
    "Mirror",
    "Move",
    "Pierce",
    "Poison",
    "Recoil",
    "Reflect",
    "Push/Pull",
    "Seal",
    "Shield",
    "Stun",
    "Stun Prevent",
    "Time Compression",
    "Time Dilation",
    "Vamp",
    "Wound",
];

const fixedEffectPowerTags = [...binaryTags, "Push/Pull"];

function hasFixedEffectPower(jutsu: Pick<Jutsu, "tags">) {
    return jutsu.tags.some((tag) => fixedEffectPowerTags.includes(tag.name));
}

const nonBloodlineFortyApTagPairs: JutsuTag[][] = [
    [{ name: "Increase Damage Given", percent: 30 }, { name: "Recoil", percent: 30 }],
    [{ name: "Increase Damage Taken", percent: 30 }, { name: "Reflect", percent: 30 }],
    [{ name: "Decrease Damage Given", percent: 30 }, { name: "Absorb", percent: 30 }],
    [{ name: "Decrease Damage Taken", percent: 30 }, { name: "Lifesteal", percent: 30 }],
    [{ name: "Increase Heal", percent: 30 }, { name: "Absorb", percent: 30 }],
];

const nonBloodlineSixtyApTags: JutsuTag[] = [
    { name: "Stun", percent: 0 },
    { name: "Increase Damage Given", percent: 30 },
    { name: "Decrease Damage Given", percent: 30 },
    { name: "Increase Damage Taken", percent: 30 },
    { name: "Decrease Damage Taken", percent: 30 },
    { name: "Absorb", percent: 30 },
    { name: "Lifesteal", percent: 30 },
    { name: "Reflect", percent: 30 },
    { name: "Recoil", percent: 30 },
];

function nonBloodlineBalanceIndex(jutsu: Jutsu) {
    const elementIndex = Math.max(0, jutsuElements.indexOf(jutsu.element as JutsuElement));
    const specialtyIndex = Math.max(0, specialties.indexOf(jutsu.type));
    const variant = Number(jutsu.id.match(/-(\d+)$/)?.[1] ?? 1);
    return elementIndex + specialtyIndex * jutsuElements.length + variant;
}

function nonBloodlineFortyApTags(jutsu: Jutsu): JutsuTag[] {
    const pair = nonBloodlineFortyApTagPairs[nonBloodlineBalanceIndex(jutsu) % nonBloodlineFortyApTagPairs.length];
    return pair.map((tag) => ({ ...tag }));
}

function nonBloodlineSixtyApTag(jutsu: Jutsu): JutsuTag {
    const tag = nonBloodlineSixtyApTags[nonBloodlineBalanceIndex(jutsu) % nonBloodlineSixtyApTags.length];
    return { ...tag };
}

function rebalanceNonBloodlineJutsu(jutsu: Jutsu): Jutsu {
    const normalized = normalizeJutsu(jutsu);
    const tags = normalized.ap === 60
        ? [{ name: "Damage", percent: 30 }, nonBloodlineSixtyApTag(normalized)]
        : normalized.ap === 40
            ? nonBloodlineFortyApTags(normalized)
            : [{ name: "Damage", percent: 30 }];

    return normalizeJutsu({
        ...normalized,
        range: normalized.target === "OPPONENT" ? 4 : normalized.range,
        cooldown: 7,
        effectPower: 28,
        tags,
    });
}

const starterJutsus: Jutsu[] = [
    makeJutsu("starter-nin-earth-1", "Stone Needle Volley", "Ninjutsu", 40, 4, 92, 1, 22, 10, [{ name: "Pierce", percent: 0 }], "Earth"),
    makeJutsu("starter-nin-earth-2", "Mud Coffin Bind", "Ninjutsu", 60, 3, 30, 3, 34, 12, [{ name: "Stun", percent: 0 }], "Earth"),
    makeJutsu("starter-nin-earth-3", "Iron Sand Burst", "Ninjutsu", 40, 3, 96, 2, 24, 12, [{ name: "Wound", percent: 18 }], "Earth"),
    makeJutsu("starter-nin-wind-1", "Vacuum Palm Wave", "Ninjutsu", 40, 5, 88, 1, 20, 12, [{ name: "Push/Pull", percent: 0 }], "Wind"),
    makeJutsu("starter-nin-wind-2", "Cyclone Cutter", "Ninjutsu", 60, 5, 30, 2, 36, 14, [{ name: "Increase Damage Given", percent: 18 }], "Wind"),
    makeJutsu("starter-nin-wind-3", "Gale Net Snare", "Ninjutsu", 40, 4, 82, 2, 24, 10, [{ name: "Decrease Damage Given", percent: 20 }], "Wind"),
    makeJutsu("starter-nin-lightning-1", "Static Fang", "Ninjutsu", 40, 4, 100, 1, 26, 8, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-nin-lightning-2", "Thunderclap Lance", "Ninjutsu", 60, 5, 30, 2, 38, 10, [{ name: "Pierce", percent: 0 }], "Lightning"),
    makeJutsu("starter-nin-lightning-3", "Nerve Spark Seal", "Ninjutsu", 60, 3, 30, 3, 34, 12, [{ name: "Seal", percent: 0 }], "Lightning"),
    makeJutsu("starter-nin-fire-1", "Cinder Shot", "Ninjutsu", 40, 4, 88, 1, 22, 8, [{ name: "Afterburn", percent: 18 }], "Fire"),
    makeJutsu("starter-nin-fire-2", "Blazing Dragon Arc", "Ninjutsu", 60, 5, 30, 2, 40, 12, [{ name: "Increase Damage Taken", percent: 18 }], "Fire"),
    makeJutsu("starter-nin-fire-3", "Ash Cloud Breaker", "Ninjutsu", 40, 3, 94, 2, 26, 10, [{ name: "Poison", percent: 15 }], "Fire"),
    makeJutsu("starter-nin-water-1", "Tide Spear", "Ninjutsu", 40, 4, 96, 1, 24, 8, [{ name: "Damage", percent: 100 }], "Water"),
    makeJutsu("starter-nin-water-2", "Crashing Wave Prison", "Ninjutsu", 60, 3, 30, 3, 36, 12, [{ name: "Stun", percent: 0 }], "Water"),
    makeJutsu("starter-nin-water-3", "Mist Veil Flow", "Ninjutsu", 40, 0, 0, 2, 28, 8, [{ name: "Shield", percent: 0 }, { name: "Decrease Damage Taken", percent: 18 }], "Water"),

    makeJutsu("starter-tai-earth-1", "Granite Elbow", "Taijutsu", 40, 1, 98, 1, 8, 24, [{ name: "Damage", percent: 100 }], "Earth"),
    makeJutsu("starter-tai-earth-2", "Boulder Heel Drop", "Taijutsu", 60, 1, 30, 2, 10, 36, [{ name: "Increase Damage Given", percent: 16 }], "Earth"),
    makeJutsu("starter-tai-earth-3", "Rooted Guard Break", "Taijutsu", 40, 1, 86, 2, 8, 26, [{ name: "Pierce", percent: 0 }], "Earth"),
    makeJutsu("starter-tai-wind-1", "Tempest Step Kick", "Taijutsu", 40, 2, 92, 1, 8, 24, [{ name: "Move", percent: 0 }], "Wind"),
    makeJutsu("starter-tai-wind-2", "Rising Gale Combo", "Taijutsu", 60, 1, 30, 2, 10, 34, [{ name: "Increase Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-tai-wind-3", "Spiral Backfist", "Taijutsu", 40, 1, 94, 1, 8, 22, [{ name: "Push/Pull", percent: 0 }], "Wind"),
    makeJutsu("starter-tai-lightning-1", "Spark Jab Chain", "Taijutsu", 40, 1, 96, 1, 10, 24, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-tai-lightning-2", "Raikou Knee Strike", "Taijutsu", 60, 1, 30, 2, 12, 36, [{ name: "Stun", percent: 0 }], "Lightning"),
    makeJutsu("starter-tai-lightning-3", "Flash Step Counter", "Taijutsu", 40, 1, 0, 3, 12, 28, [{ name: "Reflect", percent: 22 }], "Lightning"),
    makeJutsu("starter-tai-fire-1", "Burning Knuckle", "Taijutsu", 40, 1, 90, 1, 10, 24, [{ name: "Afterburn", percent: 16 }], "Fire"),
    makeJutsu("starter-tai-fire-2", "Meteor Axe Kick", "Taijutsu", 60, 1, 30, 2, 12, 38, [{ name: "Recoil", percent: 10 }], "Fire"),
    makeJutsu("starter-tai-fire-3", "Cinder Rush", "Taijutsu", 40, 2, 88, 1, 10, 24, [{ name: "Wound", percent: 14 }], "Fire"),
    makeJutsu("starter-tai-water-1", "Flowing Palm", "Taijutsu", 40, 1, 84, 1, 10, 20, [{ name: "Lifesteal", percent: 18 }], "Water"),
    makeJutsu("starter-tai-water-2", "Tidal Shoulder Throw", "Taijutsu", 60, 1, 30, 2, 12, 34, [{ name: "Decrease Damage Given", percent: 18 }], "Water"),
    makeJutsu("starter-tai-water-3", "Ripple Guard Form", "Taijutsu", 40, 0, 0, 2, 12, 24, [{ name: "Shield", percent: 0 }, { name: "Cleanse Prevent", percent: 0 }], "Water"),

    makeJutsu("starter-gen-earth-1", "Stone Eye Mirage", "Genjutsu", 40, 4, 86, 2, 24, 8, [{ name: "Decrease Damage Given", percent: 18 }], "Earth"),
    makeJutsu("starter-gen-earth-2", "Buried Memory Field", "Genjutsu", 60, 4, 30, 3, 36, 10, [{ name: "Seal", percent: 0 }], "Earth"),
    makeJutsu("starter-gen-earth-3", "Dust Puppet Vision", "Genjutsu", 40, 3, 92, 1, 24, 8, [{ name: "Poison", percent: 14 }], "Earth"),
    makeJutsu("starter-gen-wind-1", "Whispering Gale", "Genjutsu", 40, 5, 88, 1, 22, 8, [{ name: "Increase Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-gen-wind-2", "Hollow Voice Cyclone", "Genjutsu", 60, 5, 30, 2, 34, 10, [{ name: "Time Dilation", percent: 0 }], "Wind"),
    makeJutsu("starter-gen-wind-3", "Feather Step Illusion", "Genjutsu", 40, 0, 0, 2, 24, 8, [{ name: "Move", percent: 0 }, { name: "Decrease Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-gen-lightning-1", "Neural Flash", "Genjutsu", 40, 4, 94, 1, 26, 8, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-gen-lightning-2", "Paralysis Theater", "Genjutsu", 60, 4, 30, 3, 38, 10, [{ name: "Stun", percent: 0 }], "Lightning"),
    makeJutsu("starter-gen-lightning-3", "Mirror Spark Dream", "Genjutsu", 40, 0, 0, 3, 30, 8, [{ name: "Mirror", percent: 22 }], "Lightning"),
    makeJutsu("starter-gen-fire-1", "Lantern Fear", "Genjutsu", 40, 4, 90, 1, 24, 8, [{ name: "Afterburn", percent: 14 }], "Fire"),
    makeJutsu("starter-gen-fire-2", "Inferno Hallucination", "Genjutsu", 60, 4, 30, 2, 38, 10, [{ name: "Increase Damage Given", percent: 16 }], "Fire"),
    makeJutsu("starter-gen-fire-3", "Ashen Mind Lock", "Genjutsu", 40, 3, 82, 2, 28, 8, [{ name: "Buff Prevent", percent: 0 }], "Fire"),
    makeJutsu("starter-gen-water-1", "Drowning Reflection", "Genjutsu", 40, 4, 88, 1, 24, 8, [{ name: "Drain", percent: 0 }], "Water"),
    makeJutsu("starter-gen-water-2", "Moonlit Tide Dream", "Genjutsu", 60, 4, 30, 2, 36, 10, [{ name: "Decrease Damage Taken", percent: 20 }], "Water"),
    makeJutsu("starter-gen-water-3", "Mist Memory Snare", "Genjutsu", 40, 4, 84, 2, 28, 8, [{ name: "Clear Prevent", percent: 0 }], "Water"),

    makeJutsu("starter-buki-earth-1", "Stone Kunai Rain", "Bukijutsu", 40, 4, 94, 1, 10, 22, [{ name: "Damage", percent: 100 }], "Earth"),
    makeJutsu("starter-buki-earth-2", "Adamant Chain Pull", "Bukijutsu", 60, 4, 30, 2, 12, 34, [{ name: "Push/Pull", percent: 0 }], "Earth"),
    makeJutsu("starter-buki-earth-3", "Obsidian Edge", "Bukijutsu", 40, 2, 90, 1, 10, 24, [{ name: "Pierce", percent: 0 }], "Earth"),
    makeJutsu("starter-buki-wind-1", "Windmill Shuriken Line", "Bukijutsu", 40, 5, 92, 1, 10, 22, [{ name: "Wound", percent: 14 }], "Wind"),
    makeJutsu("starter-buki-wind-2", "Aerial Blade Fan", "Bukijutsu", 60, 5, 30, 2, 12, 34, [{ name: "Increase Damage Given", percent: 16 }], "Wind"),
    makeJutsu("starter-buki-wind-3", "Crosswind Needle", "Bukijutsu", 40, 5, 88, 1, 10, 22, [{ name: "Decrease Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-buki-lightning-1", "Charged Senbon", "Bukijutsu", 40, 5, 96, 1, 12, 22, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-buki-lightning-2", "Thunder Wire Trap", "Bukijutsu", 60, 4, 30, 3, 14, 34, [{ name: "Stun", percent: 0 }], "Lightning"),
    makeJutsu("starter-buki-lightning-3", "Magnet Blade Return", "Bukijutsu", 40, 4, 90, 2, 12, 26, [{ name: "Reflect", percent: 20 }], "Lightning"),
    makeJutsu("starter-buki-fire-1", "Explosive Tag Flicker", "Bukijutsu", 40, 4, 90, 1, 12, 24, [{ name: "Afterburn", percent: 16 }], "Fire"),
    makeJutsu("starter-buki-fire-2", "Flame Wire Detonation", "Bukijutsu", 60, 4, 30, 2, 14, 36, [{ name: "Increase Damage Taken", percent: 16 }], "Fire"),
    makeJutsu("starter-buki-fire-3", "Searing Blade Toss", "Bukijutsu", 40, 3, 88, 1, 12, 24, [{ name: "Poison", percent: 14 }], "Fire"),
    makeJutsu("starter-buki-water-1", "Mist Needle Spread", "Bukijutsu", 40, 5, 92, 1, 10, 22, [{ name: "Drain", percent: 0 }], "Water"),
    makeJutsu("starter-buki-water-2", "Torrent Chain Slash", "Bukijutsu", 60, 4, 30, 2, 12, 34, [{ name: "Lifesteal", percent: 16 }], "Water"),
    makeJutsu("starter-buki-water-3", "Hidden Current Guard", "Bukijutsu", 40, 0, 0, 2, 12, 24, [{ name: "Barrier", percent: 0 }, { name: "Cleanse Prevent", percent: 0 }], "Water"),
].map(rebalanceNonBloodlineJutsu);

const starterSavedBloodlines: SavedBloodline[] = [
    {
        id: "starter-bloodline-ashen-eyes",
        name: "Ashen Eyes",
        rank: "A Rank" as Rank,
        specialElement: "Blood",
        lore: "A cursed kekkei genkai born from a clan that broke a forbidden pact with blood spirits. Those awakened by the Ashen Eyes see the world through a veil of crimson — perceiving every living being as a tapestry of veins and chakra pathways. The afflicted can shatter hallucinations directly into their opponent's bloodstream, weaponizing the very sight of life itself. Ancient texts warn that prolonged use slowly turns the user's own eyes the color of ash and bone.",
        jutsus: [
            makeJutsu("ashen-eyes-blood-gaze", "Blood Gaze Rupture", "Genjutsu", 60, 4, 30, 7, 32, 12, [{ name: "Damage", percent: 100 }], "Blood" as JutsuElement),
            makeJutsu("ashen-eyes-crimson-hall", "Crimson Hallucination", "Genjutsu", 60, 4, 30, 7, 34, 10, [{ name: "Damage", percent: 100 }], "Blood" as JutsuElement),
            makeJutsu("ashen-eyes-vein-mirror", "Vein Mirror Nightmare", "Genjutsu", 60, 4, 30, 7, 36, 10, [{ name: "Damage", percent: 100 }], "Blood" as JutsuElement),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-inferno-cataclysm",
        name: "Inferno Cataclysm",
        rank: "A Rank" as Rank,
        specialElement: "Lava",
        lore: "Forged in the volcanic rifts of the Ember Wastes, the Inferno Cataclysm lineage merges fire and earth chakra at the cellular level. The wielder's body temperature runs far above human limits — surface veins glow faintly orange in darkness. In battle, they can compress molten rock and superheated gas into devastating projectiles or coffin-like formations that entomb the enemy in cooling lava. Survivors of their attacks are found encased in obsidian, preserved like dark statues.",
        jutsus: [
            makeJutsu("inferno-cataclysm-lava-burst", "Lava Burst Coffin", "Ninjutsu", 60, 4, 30, 7, 34, 12, [{ name: "Damage", percent: 100 }], "Lava" as JutsuElement),
            makeJutsu("inferno-cataclysm-molten-rain", "Molten Rainfall", "Ninjutsu", 60, 4, 30, 7, 36, 10, [{ name: "Damage", percent: 100 }], "Lava" as JutsuElement),
            makeJutsu("inferno-cataclysm-crater-lance", "Crater Lance", "Ninjutsu", 60, 4, 30, 7, 38, 10, [{ name: "Damage", percent: 100 }], "Lava" as JutsuElement),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-shadow-lotus",
        name: "Shadow Lotus",
        rank: "A Rank" as Rank,
        specialElement: "Shadow",
        lore: "Descended from a sect of bukijutsu assassins who trained in perpetual darkness for generations, the Shadow Lotus bloodline channels shadow-natured chakra through weapons and thrown implements. Their techniques bloom like deadly flowers from the dark — blades that trail shadow-ribbons, senbon that multiply in dim light, and wires that vanish entirely in low visibility. Their clan temple has no lanterns. They say the darkness learned to fear them first.",
        jutsus: [
            makeJutsu("shadow-lotus-umbra-senbon", "Umbra Senbon Bloom", "Bukijutsu", 60, 4, 30, 7, 28, 18, [{ name: "Damage", percent: 100 }], "Shadow" as JutsuElement),
            makeJutsu("shadow-lotus-night-petal", "Night Petal Cutter", "Bukijutsu", 60, 4, 30, 7, 30, 18, [{ name: "Damage", percent: 100 }], "Shadow" as JutsuElement),
            makeJutsu("shadow-lotus-eclipse-wire", "Eclipse Wire Blossom", "Bukijutsu", 60, 4, 30, 7, 32, 16, [{ name: "Damage", percent: 100 }], "Shadow" as JutsuElement),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-iron-fang",
        name: "Iron Fang",
        rank: "A Rank" as Rank,
        specialElement: "Iron",
        lore: "A taijutsu bloodline born from miners who fused raw metallic chakra into their fighting style over ten generations. Iron Fang users can coat their limbs in magnetized iron-dense chakra, turning every punch and kick into a shattering impact that tears armor and breaks weapons. Their fists leave cracked stone. Some high-level users develop iron-grey patches on their knuckles, shins, and forearms — natural battle plating grown from within. The clan motto: 'The mountain doesn't dodge. It endures. Then it falls on you.'",
        jutsus: [
            makeJutsu("iron-fang-ferrous-crash", "Ferrous Fang Crash", "Taijutsu", 60, 4, 30, 7, 12, 34, [{ name: "Damage", percent: 100 }], "Iron" as JutsuElement),
            makeJutsu("iron-fang-steel-maw", "Steel Maw Breaker", "Taijutsu", 60, 4, 30, 7, 10, 36, [{ name: "Damage", percent: 100 }], "Iron" as JutsuElement),
            makeJutsu("iron-fang-magnet-knuckle", "Magnet Knuckle Rend", "Taijutsu", 60, 4, 30, 7, 12, 38, [{ name: "Damage", percent: 100 }], "Iron" as JutsuElement),
        ],
        totalPoints: 9,
    },
].map((bloodline) => ({ ...bloodline, totalPoints: bloodlinePoints(bloodline.jutsus) }));

const defaultPetEncounterVn: CreatorEvent = {
    id: "sys-pet-encounter",
    name: "Pet Encounter",
    biome: "forest",
    icon: "🐾",
    eventKind: "visualNovel",
    trigger: "manual",
    levelReq: 1,
    xpReward: 0,
    ryoReward: 0,
    staminaReward: 0,
    dialogue: [],
    vnTitle: "A Presence in the Shadows",
    vnScene: "The rustling of leaves breaks the silence of the sector.",
    vnSpeaker: "Narrator",
    vnPages: [
        {
            title: "A Presence in the Shadows",
            scene: "The rustling of leaves breaks the silence of the sector.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: Something stirs at the edge of your senses.",
                "Narrator: A warmth — not from fire, but from living breath nearby.",
                "Narrator: You stop moving. So does it.",
            ],
            choices: [],
        },
        {
            title: "The Creature Reveals Itself",
            scene: "A creature emerges from the undergrowth, watching you carefully.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: Eyes catch yours — ancient, curious, unafraid.",
                "Narrator: It does not run. It does not attack.",
                "Narrator: It simply waits.",
            ],
            choices: [],
        },
        {
            title: "A Choice Before You",
            scene: "The creature tilts its head as if asking a question only it understands.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: Shinobi learn to read animals the way they read the wind.",
                "Narrator: This one is not lost. It chose to find you.",
                "Narrator: The question is — will you let it stay?",
            ],
            choices: [],
        },
    ],
};

const starterItems: GameItem[] = [
    {
        id: "wooden-katana",
        name: "Wooden Katana",
        slot: "hand",
        rarity: "common",
        cost: 75,
        description: "A basic training blade.",
        bonuses: { bukijutsuOffense: 25, strength: 5 },
    },
    {
        id: "shinobi-vest",
        name: "Shinobi Vest",
        slot: "body",
        rarity: "common",
        cost: 120,
        description: "Light armor for rookie shinobi.",
        bonuses: { maxHp: 100, taijutsuDefense: 20 },
    },
    {
        id: "chakra-ring",
        name: "Chakra Ring",
        slot: "aura",
        rarity: "rare",
        cost: 300,
        description: "Improves chakra flow.",
        bonuses: { maxChakra: 150, ninjutsuOffense: 30 },
    },
    {
        id: AURA_SPHERE_ITEM_ID,
        name: "Aura Sphere",
        slot: "aura",
        rarity: "legendary",
        cost: 0,
        description: "An elder-gifted sphere that unlocks the Aura Sphere menu while equipped.",
        bonuses: {},
    },
    {
        id: "pet-treat",
        name: "Treats",
        slot: "item",
        rarity: "common",
        cost: 50,
        description: "A simple pet snack. Feed to a selected pet for +100 pet XP.",
        bonuses: {},
    },
    {
        id: "elemental-pet-treat",
        name: "Elemental Treats",
        slot: "item",
        rarity: "rare",
        cost: 150,
        description: "A chakra-infused pet snack. Feed to a selected pet for +250 pet XP.",
        bonuses: {},
    },
    {
        id: "ancient-pet-treat",
        name: "Ancient Treats",
        slot: "item",
        rarity: "epic",
        cost: 300,
        description: "An old-world pet delicacy. Feed to a selected pet for +500 pet XP.",
        bonuses: {},
    },
    {
        id: "golden-apple",
        name: "Golden Apple",
        slot: "item",
        rarity: "legendary",
        cost: 20,
        description: "A Grand Marketplace pet feast. Feed to a selected pet for +2000 pet XP.",
        bonuses: {},
    },
    // ── Legendary armor (Grand Marketplace — fate shards) ───────────────────
    {
        id: "legendary-crown",
        name: "Crown of the Void",
        slot: "head",
        rarity: "legendary",
        cost: 100,
        description: "A transcendent crown forged from void-touched metal. Said to contain the will of fallen legends.",
        armorQuality: "Legendary",
        bonuses: { taijutsuDefense: 50, ninjutsuDefense: 45, maxHp: 300, strength: 10 },
    },
    {
        id: "legendary-chest",
        name: "Mantle of Eternity",
        slot: "body",
        rarity: "legendary",
        cost: 100,
        description: "An ancient chest piece worn by the first Kage. Its seals repel even S-rank techniques.",
        armorQuality: "Legendary",
        bonuses: { taijutsuDefense: 70, ninjutsuDefense: 60, maxHp: 600, maxChakra: 200 },
    },
    {
        id: "legendary-waist",
        name: "Obi of the Shinobi God",
        slot: "waist",
        rarity: "legendary",
        cost: 100,
        description: "A ceremonial obi woven from chakra-thread. Binds the body against fatal wounds.",
        armorQuality: "Legendary",
        bonuses: { taijutsuDefense: 40, ninjutsuDefense: 35, maxStamina: 300, maxHp: 200 },
    },
    {
        id: "legendary-legs",
        name: "Greaves of the Storm",
        slot: "legs",
        rarity: "legendary",
        cost: 100,
        description: "Leg armor forged during the Great Shinobi War. Channels lightning through every step.",
        armorQuality: "Legendary",
        bonuses: { taijutsuDefense: 50, ninjutsuDefense: 40, maxStamina: 250, maxHp: 250 },
    },
    {
        id: "legendary-feet",
        name: "Sandals of the Sennin",
        slot: "feet",
        rarity: "legendary",
        cost: 100,
        description: "Worn by a legendary sage. Imbued with natural energy, they never wear down.",
        armorQuality: "Legendary",
        bonuses: { taijutsuDefense: 35, ninjutsuDefense: 30, maxStamina: 200, maxHp: 150, strength: 5 },
    },
    // ── Head armor ──────────────────────────────────────────────────────────
    {
        id: "cloth-hood",
        name: "Cloth Hood",
        slot: "head",
        rarity: "common",
        cost: 80,
        description: "A simple cloth hood. Offers minimal protection.",
        armorQuality: "Standard",
        bonuses: { taijutsuDefense: 5 },
    },
    {
        id: "leather-headband",
        name: "Leather Headband",
        slot: "head",
        rarity: "common",
        cost: 180,
        description: "Reinforced leather headband worn by field shinobi.",
        armorQuality: "Reinforced",
        bonuses: { taijutsuDefense: 12, ninjutsuDefense: 8 },
    },
    {
        id: "iron-kabuto",
        name: "Iron Kabuto",
        slot: "head",
        rarity: "rare",
        cost: 400,
        description: "A fitted iron helmet offering solid protection.",
        armorQuality: "Rare",
        bonuses: { taijutsuDefense: 20, ninjutsuDefense: 15, maxHp: 50 },
    },
    // ── Chest armor ─────────────────────────────────────────────────────────
    {
        id: "cloth-robe",
        name: "Cloth Robe",
        slot: "body",
        rarity: "common",
        cost: 100,
        description: "A basic robe offering minimal defense.",
        armorQuality: "Standard",
        bonuses: { taijutsuDefense: 8, maxHp: 30 },
    },
    {
        id: "reinforced-vest",
        name: "Reinforced Vest",
        slot: "body",
        rarity: "common",
        cost: 220,
        description: "Padded vest with metal plating sewn in.",
        armorQuality: "Reinforced",
        bonuses: { taijutsuDefense: 18, ninjutsuDefense: 10, maxHp: 80 },
    },
    {
        id: "rare-chest-plate",
        name: "Rare Chest Plate",
        slot: "body",
        rarity: "rare",
        cost: 500,
        description: "Polished rare-alloy plate for veteran shinobi.",
        armorQuality: "Rare",
        bonuses: { taijutsuDefense: 28, ninjutsuDefense: 20, maxHp: 150 },
    },
    // ── Waist armor ─────────────────────────────────────────────────────────
    {
        id: "cloth-sash",
        name: "Cloth Sash",
        slot: "waist",
        rarity: "common",
        cost: 60,
        description: "A plain cloth sash worn around the waist.",
        armorQuality: "Standard",
        bonuses: { taijutsuDefense: 4, maxStamina: 20 },
    },
    {
        id: "leather-belt",
        name: "Leather Belt",
        slot: "waist",
        rarity: "common",
        cost: 140,
        description: "Sturdy leather belt reinforced at the core.",
        armorQuality: "Reinforced",
        bonuses: { taijutsuDefense: 10, maxStamina: 50 },
    },
    {
        id: "chain-obi",
        name: "Chain Obi",
        slot: "waist",
        rarity: "rare",
        cost: 320,
        description: "A woven chain obi that absorbs impact at the midsection.",
        armorQuality: "Rare",
        bonuses: { taijutsuDefense: 18, ninjutsuDefense: 10, maxStamina: 80 },
    },
    // ── Leg armor ───────────────────────────────────────────────────────────
    {
        id: "cloth-pants",
        name: "Cloth Pants",
        slot: "legs",
        rarity: "common",
        cost: 70,
        description: "Light cloth trousers offering basic leg coverage.",
        armorQuality: "Standard",
        bonuses: { taijutsuDefense: 5, maxStamina: 15 },
    },
    {
        id: "padded-leggings",
        name: "Padded Leggings",
        slot: "legs",
        rarity: "common",
        cost: 160,
        description: "Reinforced leggings for extended field missions.",
        armorQuality: "Reinforced",
        bonuses: { taijutsuDefense: 12, maxStamina: 40, maxHp: 40 },
    },
    {
        id: "rare-greaves",
        name: "Rare Greaves",
        slot: "legs",
        rarity: "rare",
        cost: 360,
        description: "Fitted rare-metal greaves protecting the thighs and shins.",
        armorQuality: "Rare",
        bonuses: { taijutsuDefense: 20, ninjutsuDefense: 12, maxStamina: 60, maxHp: 80 },
    },
    // ── Footwear ────────────────────────────────────────────────────────────
    {
        id: "cloth-sandals",
        name: "Cloth Sandals",
        slot: "feet",
        rarity: "common",
        cost: 50,
        description: "Simple sandals offering minimal protection.",
        armorQuality: "Standard",
        bonuses: { taijutsuDefense: 3, maxStamina: 10 },
    },
    {
        id: "shinobi-boots",
        name: "Shinobi Boots",
        slot: "feet",
        rarity: "common",
        cost: 130,
        description: "Reinforced boots worn by chuunin-rank shinobi.",
        armorQuality: "Reinforced",
        bonuses: { taijutsuDefense: 8, maxStamina: 30, maxHp: 30 },
    },
    {
        id: "rare-tabi",
        name: "Rare Tabi",
        slot: "feet",
        rarity: "rare",
        cost: 300,
        description: "Rare-crafted tabi with embedded guard plating.",
        armorQuality: "Rare",
        bonuses: { taijutsuDefense: 15, ninjutsuDefense: 8, maxStamina: 50, maxHp: 60 },
    },
    // ── Common Weapons (Shop — ryo) ──────────────────────────────────────────
    {
        id: "rustfang-kunai",
        name: "Rustfang Kunai",
        slot: "hand",
        rarity: "common",
        cost: 150,
        description: "A chipped beginner kunai with a rough edge that leaves shallow cuts. [Wound 10%]",
        bonuses: { bukijutsuOffense: 55, strength: 5 },
    },
    {
        id: "training-katana",
        name: "Training Katana",
        slot: "hand",
        rarity: "common",
        cost: 160,
        description: "A dull academy blade made for safe sparring, but still useful in battle. [Increase Damage Given 10%]",
        bonuses: { bukijutsuOffense: 58, strength: 5 },
    },
    {
        id: "ash-wrapped-tanto",
        name: "Ash-Wrapped Tanto",
        slot: "hand",
        rarity: "common",
        cost: 145,
        description: "A simple short blade wrapped in burnt cloth from old village ruins. [Afterburn 10%]",
        bonuses: { bukijutsuOffense: 54, strength: 5 },
    },
    {
        id: "rookie-chain-sickle",
        name: "Rookie Chain Sickle",
        slot: "hand",
        rarity: "common",
        cost: 140,
        description: "A lightweight chain-sickle used by beginner weapon specialists. [Decrease Damage Given 10%]",
        bonuses: { bukijutsuOffense: 52, strength: 5 },
    },
    {
        id: "cracked-bone-dagger",
        name: "Cracked Bone Dagger",
        slot: "hand",
        rarity: "common",
        cost: 155,
        description: "A cheap dagger carved from beast bone and reinforced with iron. [Lifesteal 10%]",
        bonuses: { bukijutsuOffense: 53, strength: 5 },
    },
    // ── Rare Weapons (Shop — ryo) ────────────────────────────────────────────
    {
        id: "mistfang-tanto",
        name: "Mistfang Tanto",
        slot: "hand",
        rarity: "rare",
        cost: 450,
        description: "A clean assassin blade that leaves thin chakra cuts after striking. [Wound 15%]",
        bonuses: { bukijutsuOffense: 88, strength: 10 },
    },
    {
        id: "ashen-leaf-saber",
        name: "Ashen Leaf Saber",
        slot: "hand",
        rarity: "rare",
        cost: 480,
        description: "A traditional fire-forged sword carried by disciplined village shinobi. [Afterburn 15%]",
        bonuses: { bukijutsuOffense: 90, strength: 10 },
    },
    {
        id: "riverbone-spear",
        name: "Riverbone Spear",
        slot: "hand",
        rarity: "rare",
        cost: 430,
        description: "A smooth spear designed to weaken enemy pressure from mid-range. [Decrease Damage Given 15%]",
        bonuses: { bukijutsuOffense: 86, strength: 10 },
    },
    {
        id: "iron-fang-knuckles",
        name: "Iron Fang Knuckles",
        slot: "hand",
        rarity: "rare",
        cost: 510,
        description: "Heavy knuckles made for taijutsu fighters who want raw pressure. [Increase Damage Given 15%]",
        bonuses: { bukijutsuOffense: 93, strength: 10 },
    },
    {
        id: "blue-thread-dagger",
        name: "Blue Thread Dagger",
        slot: "hand",
        rarity: "rare",
        cost: 420,
        description: "A dagger wrapped in blue chakra thread that feeds off clean hits. [Lifesteal 15%]",
        bonuses: { bukijutsuOffense: 84, strength: 10 },
    },
    // ── Epic Weapons (Shop — ryo) ────────────────────────────────────────────
    {
        id: "stormcoil-kusarigama",
        name: "Stormcoil Kusarigama",
        slot: "hand",
        rarity: "epic",
        cost: 950,
        description: "A chained sickle charged with unstable storm chakra. [Afterburn 25%]",
        bonuses: { bukijutsuOffense: 113, strength: 15 },
    },
    {
        id: "moonshadow-needleblade",
        name: "Moonshadow Needleblade",
        slot: "hand",
        rarity: "epic",
        cost: 900,
        description: "A thin black blade used for fast, quiet assassination strikes. [Wound 25%]",
        bonuses: { bukijutsuOffense: 109, strength: 15 },
    },
    {
        id: "frostbite-cleaver",
        name: "Frostbite Cleaver",
        slot: "hand",
        rarity: "epic",
        cost: 980,
        description: "A heavy frozen blade that slows an enemy's fighting rhythm. [Decrease Damage Given 25%]",
        bonuses: { bukijutsuOffense: 115, strength: 15 },
    },
    {
        id: "ashglass-katana",
        name: "Ashglass Katana",
        slot: "hand",
        rarity: "epic",
        cost: 1050,
        description: "A volcanic glass katana that sharpens the user's killing intent. [Increase Damage Given 25%]",
        bonuses: { bukijutsuOffense: 118, strength: 15 },
    },
    {
        id: "spirit-leech-wakizashi",
        name: "Spirit Leech Wakizashi",
        slot: "hand",
        rarity: "epic",
        cost: 850,
        description: "A short spirit blade that pulls health from enemy chakra wounds. [Lifesteal 25%]",
        bonuses: { bukijutsuOffense: 104, strength: 15 },
    },
    // ── Legendary Weapons (Grand Marketplace — fate shards) ──────────────────
    {
        id: "frostfang-oathblade",
        name: "Frostfang Oathblade",
        slot: "hand",
        rarity: "legendary",
        cost: 100,
        description: "A sacred Frostfang sword carried by warriors sworn to protect their clan. [Decrease Damage Taken 30%]",
        bonuses: { bukijutsuOffense: 136, strength: 20 },
    },
    {
        id: "tempest-fang-blade",
        name: "Tempest Fang Blade",
        slot: "hand",
        rarity: "legendary",
        cost: 100,
        description: "A chaotic Stormveil weapon that empowers aggressive attacks. [Increase Damage Given 30%]",
        bonuses: { bukijutsuOffense: 141, strength: 20 },
    },
    {
        id: "black-lotus-dagger",
        name: "Black Lotus Dagger",
        slot: "hand",
        rarity: "legendary",
        cost: 100,
        description: "A cursed Moonshadow dagger used by silent executioners. [Wound 30%]",
        bonuses: { bukijutsuOffense: 131, strength: 20 },
    },
    {
        id: "elderbranch-katana",
        name: "Elderbranch Katana",
        slot: "hand",
        rarity: "legendary",
        cost: 100,
        description: "An Ashen Leaf relic blade carved from ancient chakra wood. [Absorb 30%]",
        bonuses: { bukijutsuOffense: 134, strength: 20 },
    },
    {
        id: "embercoil-scythe",
        name: "Embercoil Scythe",
        slot: "hand",
        rarity: "legendary",
        cost: 100,
        description: "A curved weapon wrapped in burning chain links. [Afterburn 30%]",
        bonuses: { bukijutsuOffense: 128, strength: 20 },
    },
    // ── Mythic Weapons (Grand Marketplace — fate shards) ─────────────────────
    {
        id: "worldsplitter-katana",
        name: "Worldsplitter Katana",
        slot: "hand",
        rarity: "mythic",
        cost: 100,
        description: "A forbidden black-blue katana said to cut through fate itself. [Increase Damage Given 35%]",
        bonuses: { bukijutsuOffense: 160, strength: 25 },
    },
    {
        id: "eclipse-fang-dagger",
        name: "Eclipse Fang Dagger",
        slot: "hand",
        rarity: "mythic",
        cost: 100,
        description: "A mythic assassin blade that drinks moonlight and leaves cursed wounds. [Wound 35%]",
        bonuses: { bukijutsuOffense: 157, strength: 25 },
    },
    {
        id: "glacier-king-cleaver",
        name: "Glacier King Cleaver",
        slot: "hand",
        rarity: "mythic",
        cost: 100,
        description: "A massive frozen blade once carried by the first Frostfang warlord. [Decrease Damage Given 35%]",
        bonuses: { bukijutsuOffense: 163, strength: 25 },
    },
    {
        id: "ashen-dragon-katana",
        name: "Ashen Dragon Katana",
        slot: "hand",
        rarity: "mythic",
        cost: 100,
        description: "An ancient sword said to contain the soul of a fire dragon. [Afterburn 35%]",
        bonuses: { bukijutsuOffense: 166, strength: 25 },
    },
    {
        id: "void-leech-nodachi",
        name: "Void Leech Nodachi",
        slot: "hand",
        rarity: "mythic",
        cost: 100,
        description: "A long cursed blade that absorbs enemy chakra through every strike. [Absorb 35%]",
        bonuses: { bukijutsuOffense: 168, strength: 25 },
    },
];

function getAllItems(creatorItems: GameItem[]) {
    return [...creatorItems, ...starterItems.filter((s) => !creatorItems.some((c) => c.id === s.id))];
}

// ── Shinobi Tiles card game ───────────────────────────────────────────────────
type TileCardArrow = "up" | "down" | "left" | "right";
type TileCard = {
    id: string; name: string; power: number; element: string;
    arrows: TileCardArrow[]; rarity: "common" | "rare" | "epic"; description: string;
    image?: string;
};

const shinobiTileCards: TileCard[] = [
    // Common (20)
    { id: "tc-01", name: "Training Dummy", power: 1, element: "None", arrows: ["up"], rarity: "common", description: "Weak starter card." },
    { id: "tc-02", name: "Leaf Cat", power: 2, element: "Wind", arrows: ["left", "right"], rarity: "common", description: "Fast village pet card." },
    { id: "tc-03", name: "Stone Turtle", power: 3, element: "Earth", arrows: ["up", "down"], rarity: "common", description: "Slow but sturdy." },
    { id: "tc-04", name: "Kunai Scout", power: 2, element: "Lightning", arrows: ["up", "right"], rarity: "common", description: "Basic ninja scout." },
    { id: "tc-05", name: "Ramen Dog", power: 1, element: "Water", arrows: ["left", "down", "right"], rarity: "common", description: "Weak power, good arrows." },
    { id: "tc-06", name: "Rookie Shinobi", power: 2, element: "None", arrows: ["up", "down"], rarity: "common", description: "Balanced beginner card." },
    { id: "tc-07", name: "Wooden Shield Guard", power: 2, element: "Earth", arrows: ["left", "up"], rarity: "common", description: "Defensive corner card." },
    { id: "tc-08", name: "Paper Tag Mouse", power: 1, element: "Fire", arrows: ["right", "down"], rarity: "common", description: "Tiny explosive card." },
    { id: "tc-09", name: "River Frog", power: 2, element: "Water", arrows: ["down", "right"], rarity: "common", description: "Good bottom corner card." },
    { id: "tc-10", name: "Crow Lookout", power: 2, element: "Wind", arrows: ["left", "up"], rarity: "common", description: "Good top-row card." },
    { id: "tc-11", name: "Rusty Blade Bandit", power: 3, element: "None", arrows: ["right"], rarity: "common", description: "Strong but only attacks one way." },
    { id: "tc-12", name: "Forest Beetle", power: 2, element: "Earth", arrows: ["left", "down"], rarity: "common", description: "Small defensive bug card." },
    { id: "tc-13", name: "Candle Wisp", power: 2, element: "Fire", arrows: ["up", "right"], rarity: "common", description: "Starter fire spirit." },
    { id: "tc-14", name: "Static Lizard", power: 2, element: "Lightning", arrows: ["left", "right"], rarity: "common", description: "Side-control card." },
    { id: "tc-15", name: "Pond Turtle", power: 1, element: "Water", arrows: ["up", "left", "down"], rarity: "common", description: "Low power, many arrows." },
    { id: "tc-16", name: "Training Clone", power: 2, element: "None", arrows: ["up", "right", "down"], rarity: "common", description: "Good beginner combo card." },
    { id: "tc-17", name: "Small Spider", power: 1, element: "Dark", arrows: ["left", "down"], rarity: "common", description: "Sneaky weak card." },
    { id: "tc-18", name: "Wind Squirrel", power: 2, element: "Wind", arrows: ["up", "right"], rarity: "common", description: "Quick movement card." },
    { id: "tc-19", name: "Clay Golem Head", power: 3, element: "Earth", arrows: ["down"], rarity: "common", description: "Strong one-direction card." },
    { id: "tc-20", name: "Village Messenger", power: 1, element: "Light", arrows: ["left", "up", "right"], rarity: "common", description: "Weak but flexible." },
    // Rare (20)
    { id: "tc-21", name: "Ashen Wolf", power: 4, element: "Earth", arrows: ["up", "right", "down"], rarity: "rare", description: "Reliable attacker." },
    { id: "tc-22", name: "Storm Crow", power: 3, element: "Lightning", arrows: ["left", "up", "right"], rarity: "rare", description: "Great top-row control." },
    { id: "tc-23", name: "Frost Owl", power: 4, element: "Water", arrows: ["up", "left", "down"], rarity: "rare", description: "Strong side card." },
    { id: "tc-24", name: "Shadow Fox", power: 3, element: "Dark", arrows: ["left", "right", "down"], rarity: "rare", description: "Good for multi-flips." },
    { id: "tc-25", name: "Blue Fang Lynx", power: 4, element: "Lightning", arrows: ["up", "right"], rarity: "rare", description: "High pressure rare." },
    { id: "tc-26", name: "Forest Tanuki", power: 3, element: "Earth", arrows: ["left", "up", "down"], rarity: "rare", description: "Defensive rare pet." },
    { id: "tc-27", name: "Mist Serpent", power: 4, element: "Water", arrows: ["left", "right"], rarity: "rare", description: "Strong lane card." },
    { id: "tc-28", name: "Ember Salamander", power: 4, element: "Fire", arrows: ["right", "down"], rarity: "rare", description: "Good attack corner." },
    { id: "tc-29", name: "Moonshadow Cat", power: 3, element: "Dark", arrows: ["up", "left", "right", "down"], rarity: "rare", description: "Low power, excellent arrows." },
    { id: "tc-30", name: "Iron Mask Guard", power: 4, element: "Earth", arrows: ["up", "down"], rarity: "rare", description: "Strong vertical defender." },
    { id: "tc-31", name: "Scroll Thief", power: 3, element: "Wind", arrows: ["left", "right", "down"], rarity: "rare", description: "Sneaky board-control card." },
    { id: "tc-32", name: "Lightning Hare", power: 3, element: "Lightning", arrows: ["up", "right", "down"], rarity: "rare", description: "Fast pressure card." },
    { id: "tc-33", name: "Shrine Monk", power: 3, element: "Light", arrows: ["left", "up", "right"], rarity: "rare", description: "Good support-style card." },
    { id: "tc-34", name: "Ice Shell Turtle", power: 4, element: "Water", arrows: ["left", "up"], rarity: "rare", description: "Strong corner defender." },
    { id: "tc-35", name: "Wild Boar Bandit", power: 4, element: "None", arrows: ["right", "down"], rarity: "rare", description: "Simple brute card." },
    { id: "tc-36", name: "Ashen Leaf Archer", power: 3, element: "Wind", arrows: ["up", "right", "down"], rarity: "rare", description: "Balanced ranged card." },
    { id: "tc-37", name: "Stormveil Raider", power: 4, element: "Lightning", arrows: ["left", "right"], rarity: "rare", description: "Aggressive side flipper." },
    { id: "tc-38", name: "Frostfang Pup", power: 3, element: "Water", arrows: ["up", "left", "down"], rarity: "rare", description: "Flexible rare pet." },
    { id: "tc-39", name: "Moonshadow Spy", power: 3, element: "Dark", arrows: ["left", "up", "right"], rarity: "rare", description: "Strong top control." },
    { id: "tc-40", name: "Golden Beetle", power: 4, element: "Light", arrows: ["left", "down", "right"], rarity: "rare", description: "Strong bottom control." },
    // Epic (10)
    { id: "tc-41", name: "Blue Blade Raccoon", power: 5, element: "Water", arrows: ["up", "left", "right", "down"], rarity: "epic", description: "Strong all-around mascot card." },
    { id: "tc-42", name: "Inferno Cat", power: 6, element: "Fire", arrows: ["right", "down"], rarity: "epic", description: "Huge power, fewer arrows." },
    { id: "tc-43", name: "Iron Beetle King", power: 5, element: "Earth", arrows: ["left", "up", "down"], rarity: "epic", description: "Strong defensive control." },
    { id: "tc-44", name: "Phantom Spider Lady", power: 5, element: "Dark", arrows: ["up", "left", "right"], rarity: "epic", description: "Excellent top-side control." },
    { id: "tc-45", name: "Storm Serpent", power: 5, element: "Lightning", arrows: ["up", "right", "down"], rarity: "epic", description: "Aggressive combo card." },
    { id: "tc-46", name: "Frostfang Dire Wolf", power: 6, element: "Water", arrows: ["up", "right"], rarity: "epic", description: "High power beast card." },
    { id: "tc-47", name: "Ashen Forest Guardian", power: 5, element: "Earth", arrows: ["left", "up", "right", "down"], rarity: "epic", description: "Strong village defender." },
    { id: "tc-48", name: "Moonshadow Nine-Tail", power: 5, element: "Dark", arrows: ["left", "right", "down"], rarity: "epic", description: "Dangerous bottom-row flipper." },
    { id: "tc-49", name: "Shrine Dragon Spirit", power: 5, element: "Light", arrows: ["up", "left", "right"], rarity: "epic", description: "Holy epic spirit card." },
    { id: "tc-50", name: "Crimson Tag Master", power: 6, element: "Fire", arrows: ["left", "down"], rarity: "epic", description: "Big power, limited angles." },
];

function getAllTileCards(creatorCards: TileCard[]): TileCard[] {
    return [...creatorCards, ...shinobiTileCards.filter((s) => !creatorCards.some((c) => c.id === s.id))];
}

function getItemById(items: GameItem[], id?: string) {
    return items.find((item) => item.id === id);
}

const storylines: Record<string, StoryStep[]> = {
    "Stormveil Village": [
        story(1, "The Wind Awakens", "ACT I — The Restless Sky", "Storm clouds twist over Stormveil. Blue chakra lightning dances across the rooftops.", ["Elder: The wind carries warnings before war arrives.", "Elder: The storm has noticed you.", "Elder: Face the rogue scout beyond the training cliffs."], "Rogue Wind Scout", "🌪️", 180, 18, 75, 40),
        story(10, "Central’s Warning", "ACT II — Message from Central", "A wounded messenger collapses at the gate with Central’s golden crest.", ["Messenger: Central is no longer safe...", "Messenger: Chakra storms are appearing in every biome.", "Kage: If Central falls, every village falls."], "Storm-Touched Bandit", "⚡", 320, 28, 200, 100),
        story(30, "The Broken Sky", "ACT III — The Sky Splits", "The clouds tear open like a wound. A floating battlefield appears above Stormveil.", ["Kage: The storm is not natural.", "Kage: Someone is weaponizing the skies.", "Kage: Climb and silence its guardian."], "Sky-Rift Guardian", "🦅", 650, 42, 550, 300),
        story(60, "War of the Five", "ACT IV — Five Villages Tremble", "Signal fires burn in every direction. The roads to Central glow red.", ["Central Commander: The enemy wants us divided.", "Central Commander: Show them Stormveil bends to no storm."], "Tempest Warlord", "🗡️", 1050, 68, 1200, 650),
        story(90, "Final Tempest", "ACT V — Eye of the World Storm", "A cyclone of black-blue chakra rises into the heavens. A masked figure waits inside it.", ["Masked Storm Kage: You chased the storm all this way.", "Masked Storm Kage: I was waiting for someone strong enough to break."], "Masked Storm Kage", "👹", 1800, 95, 3000, 1500),
    ],
    "Ashen Leaf Village": [
        story(1, "Ashes Stir", "ACT I — Smoke Beneath the Leaves", "Ash falls like snow. The trees glow red from beneath the bark.", ["Ashen Elder: Fire remembers every war.", "Ashen Elder: Now it whispers your name."], "Cinder Wolf", "🐺", 190, 20, 75, 40),
        story(20, "Lava Rift", "ACT II — The Mountain Opens", "The volcano cracks open. Rivers of lava crawl toward Ashen Leaf.", ["Scout: Something climbed out of the rift.", "Kage: Then it belongs to an ancient war."], "Lava Rift Knight", "🔥", 450, 38, 350, 180),
        story(50, "Inferno Beast", "ACT III — Beast of the Old Flame", "A beast made of molten stone rises from the crater.", ["Kage: We cannot contain it.", "Kage: So you must defeat it."], "Inferno Beast", "🐉", 950, 62, 1000, 550),
        story(90, "World Burn", "ACT IV — The Flame That Ends All", "The sky turns crimson. Central’s tower burns without being touched.", ["World Flame: I am the ending hidden inside every spark.", "World Flame: Kneel or burn beautifully."], "World Flame Avatar", "☄️", 1850, 100, 3000, 1500),
    ],
    "Frostfang Village": [
        story(1, "Frozen Echo", "ACT I — The Silence Beneath Snow", "The village bells ring once, then freeze mid-sound.", ["Frostfang Elder: This cold is not weather.", "Frostfang Elder: Go to the ice road."], "Ice Road Stalker", "❄️", 180, 18, 75, 40),
        story(25, "Ice Collapse", "ACT II — The Glacier Moves", "The ancient glacier shifts for the first time in centuries.", ["Scout: The mountain moved.", "Kage: Something beneath it has awakened."], "Glacier Sentinel", "🧊", 520, 40, 425, 220),
        story(70, "Absolute Zero", "ACT III — Time Freezes", "Snow stops falling in midair. The world becomes silent.", ["Frozen Monarch: Movement is arrogance.", "Frozen Monarch: I will make the world still."], "Frozen Monarch", "👑", 1300, 78, 1700, 850),
        story(95, "The Last Snow", "ACT IV — White End", "Central disappears beneath a white storm. Only your footsteps remain visible.", ["Ancient Frost: I froze the first war.", "Ancient Frost: I will freeze the last."], "Ancient Frost", "🌨️", 1900, 105, 3200, 1700),
    ],
    "Moonshadow Village": [
        story(1, "Whispers in Darkness", "ACT I — Names in the Dark", "The moon vanishes. Shadows stretch in directions they should not.", ["Moonshadow Elder: The shadows know your footsteps.", "Moonshadow Elder: But they do not yet know your strength."], "Shadow Whisper", "🌑", 175, 19, 75, 40),
        story(20, "Vanishing Shinobi", "ACT II — Empty Footprints", "Entire patrols vanish without blood, sound, or tracks.", ["Scout: They were here one breath ago.", "Kage: Something is taking our shinobi alive."], "Mist Kidnapper", "☁️", 440, 36, 350, 180),
        story(60, "Shadow Realm", "ACT III — No Escape", "The ground becomes black water. You are standing inside someone else’s jutsu.", ["Unknown Voice: You entered my domain.", "Unknown Voice: Your mind will not leave."], "Shadow Realm Keeper", "👁️", 1100, 70, 1400, 700),
        story(90, "The Moonless Throne", "ACT IV — King of No Light", "A throne of black chakra rises from Central’s ruins.", ["Moonless King: Every village casts a shadow.", "Moonless King: Kneel in darkness."], "Moonless King", "🕷️", 1850, 98, 3000, 1500),
    ],
};

function makeJutsu(id: string, name: string, type: JutsuType, ap: number, range: number, effectPower: number, cooldown: number, chakraCost: number, staminaCost: number, tags: JutsuTag[], element: JutsuElement = "Fire"): Jutsu {
    return normalizeJutsu({ id, name, type, element, ap, range, effectPower, cooldown, currentCooldown: 0, chakraCost, staminaCost, tags });
}

function story(levelReq: number, title: string, cinematicTitle: string, scene: string, dialogue: string[], bossName: string, bossIcon: string, bossHp: number, bossDamage: number, rewardXp: number, rewardRyo: number): StoryStep {
    return { levelReq, title, cinematicTitle, scene, dialogue, bossName, bossIcon, bossHp, bossDamage, rewardXp, rewardRyo };
}

function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function compressDataUrl(dataUrl: string, maxPx = 512, quality = 0.82): Promise<string> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

function readImageFile(file: File, onLoad: (image: string) => void, maxSizeMb = 100) {
    if (!file.type.startsWith("image/")) return alert("Please upload an image file.");
    if (file.size > maxSizeMb * 1024 * 1024) return alert(`Please upload an image under ${maxSizeMb} MB.`);
    const reader = new FileReader();
    reader.onload = () => {
        compressDataUrl(String(reader.result)).then(onLoad);
    };
    reader.readAsDataURL(file);
}

function capStat(value: number) {
    return Math.min(MAX_STAT, Math.max(0, Math.floor(value)));
}

function xpNeeded(level: number) {
    if (level >= MAX_LEVEL) return 0;
    return level * 100;
}

function maxHpForLevel(level: number) {
    return Math.min(HP_CAP, 100 + (Math.max(1, level) - 1) * 100);
}

function maxChakraForLevel(level: number) {
    return Math.min(CHAKRA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((CHAKRA_CAP - 100) / (MAX_LEVEL - 1))));
}

function maxStaminaForLevel(level: number) {
    return Math.min(STAMINA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((STAMINA_CAP - 100) / (MAX_LEVEL - 1))));
}

function rankFromLevel(level: number) {
    if (level >= 100) return "Legendary Kage";
    if (level >= 90) return "Kage";
    if (level >= 70) return "Elite Jonin";
    if (level >= 50) return "Jonin";
    if (level >= 30) return "Chunin";
    if (level >= 10) return "Genin";
    return "Academy Student";
}

function baseStats(): Stats {
    return {
        strength: 10,
        speed: 10,
        intelligence: 10,
        willpower: 10,
        bukijutsuOffense: 10,
        bukijutsuDefense: 10,
        taijutsuOffense: 10,
        taijutsuDefense: 10,
        genjutsuOffense: 10,
        genjutsuDefense: 10,
        ninjutsuOffense: 10,
        ninjutsuDefense: 10,
    };
}

function enemyStats(): Stats {
    return {
        strength: 25,
        speed: 25,
        intelligence: 25,
        willpower: 25,
        bukijutsuOffense: 25,
        bukijutsuDefense: 25,
        taijutsuOffense: 25,
        taijutsuDefense: 25,
        genjutsuOffense: 25,
        genjutsuDefense: 25,
        ninjutsuOffense: 25,
        ninjutsuDefense: 25,
    };
}

function addToAllStats(stats: Stats, amount: number): Stats {
    return {
        strength: capStat(stats.strength + amount),
        speed: capStat(stats.speed + amount),
        intelligence: capStat(stats.intelligence + amount),
        willpower: capStat(stats.willpower + amount),
        bukijutsuOffense: capStat(stats.bukijutsuOffense + amount),
        bukijutsuDefense: capStat(stats.bukijutsuDefense + amount),
        taijutsuOffense: capStat(stats.taijutsuOffense + amount),
        taijutsuDefense: capStat(stats.taijutsuDefense + amount),
        genjutsuOffense: capStat(stats.genjutsuOffense + amount),
        genjutsuDefense: capStat(stats.genjutsuDefense + amount),
        ninjutsuOffense: capStat(stats.ninjutsuOffense + amount),
        ninjutsuDefense: capStat(stats.ninjutsuDefense + amount),
    };
}

function maxedStats(): Stats {
    return addToAllStats(baseStats(), MAX_STAT);
}

function isAdminAccountName(name?: string): name is AdminAccount {
    return name === "Admin 1" || name === "Admin 2";
}

function normalizeAdminCharacter(character: Character): Character {
    const normalized = normalizeCharacter(character);
    if (!isAdminAccountName(normalized.name)) return normalized;
    return {
        ...normalized,
        stats: maxedStats(),
        unspentStats: 0,
    };
}

function gainXp(character: Character, amount: number): Character {
    let updated: Character = { ...character, xp: character.level >= MAX_LEVEL ? 0 : character.xp + amount };
    while (updated.level < MAX_LEVEL && updated.xp >= xpNeeded(updated.level)) {
        const needed = xpNeeded(updated.level);
        const newLevel = updated.level + 1;
        const nextMaxHp = maxHpForLevel(newLevel);
        const nextMaxChakra = maxChakraForLevel(newLevel);
        const nextMaxStamina = maxStaminaForLevel(newLevel);
        updated = {
            ...updated,
            xp: updated.xp - needed,
            level: newLevel,
            rankTitle: rankFromLevel(newLevel),
            maxHp: nextMaxHp,
            maxChakra: nextMaxChakra,
            maxStamina: nextMaxStamina,
            hp: nextMaxHp,
            chakra: nextMaxChakra,
            stamina: nextMaxStamina,
            unspentStats: updated.unspentStats + 5,
            stats: addToAllStats(updated.stats, 1),
        };
    }
    if (updated.level >= MAX_LEVEL) return { ...updated, level: MAX_LEVEL, xp: 0, rankTitle: rankFromLevel(MAX_LEVEL) };
    return updated;
}

const rewardCurrencyOptions: Array<{ key: RewardCurrencyKey; label: string }> = [
    { key: "fateShards", label: "Fate Shards" },
    { key: "honorSeals", label: "Honor Seals" },
    { key: "boneCharms", label: "Bone Charms" },
    { key: "auraStones", label: "Aura Stones" },
    { key: "auraDust", label: "Aura Dust" },
    { key: "mythicSeals", label: "Mythic Seals" },
];

function normalizeCurrencyRewards(rewards?: CurrencyRewards): CurrencyRewards {
    const normalized: CurrencyRewards = {};
    rewardCurrencyOptions.forEach(({ key }) => {
        const value = Math.max(0, Math.floor(Number(rewards?.[key] ?? 0)));
        if (value > 0) normalized[key] = value;
    });
    return normalized;
}

function singleCurrencyReward(key: RewardCurrencyKey, amount: number): CurrencyRewards | undefined {
    const value = Math.max(0, Math.floor(Number(amount)));
    return value > 0 ? ({ [key]: value } as CurrencyRewards) : undefined;
}

function firstCurrencyReward(rewards?: CurrencyRewards): { key: RewardCurrencyKey; amount: number } {
    const normalized = normalizeCurrencyRewards(rewards);
    const found = rewardCurrencyOptions.find(({ key }) => (normalized[key] ?? 0) > 0);
    return { key: found?.key ?? "fateShards", amount: found ? normalized[found.key] ?? 0 : 0 };
}

function applyCurrencyRewards(character: Character, rewards?: CurrencyRewards): Character {
    const normalized = normalizeCurrencyRewards(rewards);
    return rewardCurrencyOptions.reduce<Character>((updated, { key }) => {
        const amount = normalized[key] ?? 0;
        return amount > 0 ? { ...updated, [key]: (updated[key] ?? 0) + amount } : updated;
    }, character);
}

function formatCurrencyRewards(rewards?: CurrencyRewards): string {
    const normalized = normalizeCurrencyRewards(rewards);
    return rewardCurrencyOptions
        .filter(({ key }) => (normalized[key] ?? 0) > 0)
        .map(({ key, label }) => `+${normalized[key]} ${label}`)
        .join(" / ");
}

function rewardSummary(xp: number, ryo: number, stamina: number, rewards?: CurrencyRewards): string {
    return [`+${xp} XP`, `+${ryo} ryo`, `+${stamina} stamina`, formatCurrencyRewards(rewards)].filter(Boolean).join(" / ");
}

const VILLAGE_UPGRADE_MAX_LEVEL = 50;

const villageUpgradeDefinitions: Array<{
    key: VillageUpgradeKey;
    name: string;
    icon: string;
    perLevel: number;
    unit: "%";
    description: string;
}> = [
        { key: "training", name: "Training Grounds", icon: "🏋️", perLevel: 0.25, unit: "%", description: "+0.25% character XP from stat training per level." },
        { key: "jutsuTraining", name: "Jutsu Training", icon: "🥋", perLevel: 0.25, unit: "%", description: "+0.25% jutsu training speed / jutsu XP per level." },
        { key: "shop", name: "Shop", icon: "🛒", perLevel: 0.25, unit: "%", description: "0.25% shop discount per level." },
        { key: "townDefense", name: "Town Defense", icon: "🛡️", perLevel: 0.1, unit: "%", description: "+0.1% defense vs Genjutsu, Taijutsu, Bukijutsu, and Ninjutsu while defending through the Village Guard queue." },
        { key: "petYard", name: "Pet Yard", icon: "🐾", perLevel: 0.25, unit: "%", description: "+0.25% pet XP from pet training per level." },
        { key: "bank", name: "Bank", icon: "🏦", perLevel: 0.25, unit: "%", description: "+0.25% bank interest per level." },
        { key: "missionHall", name: "Mission Hall", icon: "📜", perLevel: 0.5, unit: "%", description: "+0.5% XP, ryo, and stamina mission rewards per level." },
        { key: "hospital", name: "Hospital", icon: "🏥", perLevel: 1, unit: "%", description: "1% hospital discount per level." },
    ];

type VillageLeadershipProfile = { kage: string; elders: string[]; atWar: boolean; pastWars: string[] };
type VillageLeadershipImages = Record<string, { kage?: string; elders?: string[] }>;

const villageLeadership: Record<string, VillageLeadershipProfile> = {
    "Stormveil Village": {
        kage: "Raiden Veyr, Storm Kage",
        elders: ["Elder Kuro Volt", "Elder Maika Gale", "Elder Denji Rain"],
        atWar: false,
        pastWars: ["Won the Tempest Border War vs Moonshadow", "Lost the Crimson Dock Raid vs Ashen Leaf", "Draw at the Broken Thunder Pass"],
    },
    "Ashen Leaf Village": {
        kage: "Hiru Ashroot, Leaf Kage",
        elders: ["Elder Sora Ember", "Elder Jun Oakseal", "Elder Rina Cinder"],
        atWar: false,
        pastWars: ["Won the Crimson Dock Raid vs Stormveil", "Won the Ember Road Defense vs Frostfang", "Lost the Old Grove Skirmish vs Moonshadow"],
    },
    "Frostfang Village": {
        kage: "Yukina Frostfang, Frost Kage",
        elders: ["Elder Hako Snowguard", "Elder Mira Icevein", "Elder Tovan Wolfbond"],
        atWar: false,
        pastWars: ["Won the White Ridge Siege vs Moonshadow", "Lost the Ember Road Assault vs Ashen Leaf", "Draw at the Frozen Gate"],
    },
    "Moonshadow Village": {
        kage: "Noctis Kage, Shadow Kage",
        elders: ["Elder Aya Dusk", "Elder Ren Blackveil", "Elder Sable Thorn"],
        atWar: false,
        pastWars: ["Won the Old Grove Skirmish vs Ashen Leaf", "Lost the White Ridge Siege vs Frostfang", "Lost the Tempest Border War vs Stormveil"],
    },
};

function villageLeadershipImagesKey() {
    return "village-leadership-images-v1";
}

function normalizeVillageLeadershipImages(images?: VillageLeadershipImages): VillageLeadershipImages {
    const normalized: VillageLeadershipImages = {};
    Object.keys(villageLeadership).forEach((village) => {
        const source = images?.[village];
        normalized[village] = {
            kage: source?.kage ?? "",
            elders: Array.from({ length: 3 }, (_, index) => source?.elders?.[index] ?? ""),
        };
    });
    return normalized;
}

function loadVillageLeadershipImages(): VillageLeadershipImages {
    try {
        const raw = localStorage.getItem(villageLeadershipImagesKey());
        return normalizeVillageLeadershipImages(raw ? JSON.parse(raw) : undefined);
    } catch {
        return normalizeVillageLeadershipImages();
    }
}

function saveVillageLeadershipImages(images: VillageLeadershipImages) {
    try {
        localStorage.setItem(villageLeadershipImagesKey(), JSON.stringify(normalizeVillageLeadershipImages(images)));
    } catch { }
}

function defaultVillageUpgrades(): VillageUpgrades {
    return {
        training: 0,
        jutsuTraining: 0,
        shop: 0,
        townDefense: 0,
        petYard: 0,
        bank: 0,
        missionHall: 0,
        hospital: 0,
    };
}

function normalizeVillageUpgrades(upgrades?: Partial<VillageUpgrades>): VillageUpgrades {
    const defaults = defaultVillageUpgrades();
    const normalized = { ...defaults, ...(upgrades ?? {}) } as VillageUpgrades;
    for (const key of Object.keys(defaults) as VillageUpgradeKey[]) {
        normalized[key] = clampNumber(Math.floor(Number(normalized[key] ?? 0)), 0, VILLAGE_UPGRADE_MAX_LEVEL);
    }
    return normalized;
}

function getVillageUpgrades(character: Character): VillageUpgrades {
    return normalizeVillageUpgrades(character.villageUpgrades);
}

function villageUpgradeLevel(character: Character, key: VillageUpgradeKey): number {
    return getVillageUpgrades(character)[key] ?? 0;
}

function villageUpgradeBonus(character: Character, key: VillageUpgradeKey): number {
    const def = villageUpgradeDefinitions.find((upgrade) => upgrade.key === key);
    return villageUpgradeLevel(character, key) * (def?.perLevel ?? 0);
}

function boostAmount(amount: number, percent: number) {
    return Math.max(0, Math.floor(amount * (1 + percent / 100)));
}

const auraSphereRanks = [
    "Dormant Aura Stone",
    "Awakened Aura Stone",
    "Radiant Aura Stone",
    "Fighting Spirit Aura Stone",
    "Sage Aura Stone",
    "Mythic Aura Stone",
    "Eternal Aura Stone",
];

function auraSphereLevel(character: Pick<Character, "auraSphereLevel">) {
    return Math.max(1, Math.floor(character.auraSphereLevel ?? 1));
}

function auraSphereRankIndex(level: number) {
    return Math.min(auraSphereRanks.length - 1, Math.floor(Math.max(1, level) / 50));
}

function auraSphereRankName(level: number) {
    return auraSphereRanks[auraSphereRankIndex(level)];
}

function auraSphereDustNeeded(level: number) {
    return Math.floor(12 + Math.max(1, level) * 2.5);
}

function getAuraSphereBonuses(character: Pick<Character, "auraSphereLevel">) {
    const level = auraSphereLevel(character);
    return {
        rankName: auraSphereRankName(level),
        regen: level >= 300 ? 5 : level >= 150 ? 2 : level >= 100 ? 2 : level >= 1 ? 1 : 0,
        missionRewardPercent: level >= 100 ? 1 : level >= 50 ? 2 : 0,
        jutsuTrainingSpeedPercent: level >= 250 ? 5 : level >= 150 ? 5 : 0,
        jutsuXpPercent: level >= 250 ? 5 : 0,
        pveDamagePercent: level >= 300 ? 5 : 0,
        avatarAura: level >= 200,
    };
}
function hasEquippedAuraSphere(character: Pick<Character, "equipment">) {
    return character.equipment?.aura === AURA_SPHERE_ITEM_ID || character.equipment?.accessory === AURA_SPHERE_ITEM_ID;
}
function getActiveAuraSphereBonuses(character: Pick<Character, "auraSphereLevel" | "equipment">) {
    if (!hasEquippedAuraSphere(character)) {
        return {
            ...getAuraSphereBonuses(character),
            regen: 0,
            missionRewardPercent: 0,
            jutsuTrainingSpeedPercent: 0,
            jutsuXpPercent: 0,
            pveDamagePercent: 0,
            avatarAura: false,
        };
    }
    return getAuraSphereBonuses(character);
}

function discountCost(cost: number, percent: number) {
    return Math.max(1, Math.floor(cost * Math.max(0, 1 - percent / 100)));
}

function villageUpgradeCost(key: VillageUpgradeKey, currentLevel: number) {
    const base: Record<VillageUpgradeKey, number> = {
        training: 10,
        jutsuTraining: 12,
        shop: 12,
        townDefense: 14,
        petYard: 12,
        bank: 16,
        missionHall: 14,
        hospital: 12,
    };
    return Math.floor((base[key] ?? 12) + currentLevel * 4 + Math.pow(currentLevel, 1.25) * 2);
}

function getTrainingXpBonus(character: Character) { return villageUpgradeBonus(character, "training"); }
function getJutsuTrainingSpeedBonus(character: Character) { return villageUpgradeBonus(character, "jutsuTraining"); }
function getShopDiscountPercent(character: Character) { return villageUpgradeBonus(character, "shop"); }
function getTownDefenseGuardBonus(character: Character) { return villageUpgradeBonus(character, "townDefense"); }
function getPetXpBonus(character: Character) { return villageUpgradeBonus(character, "petYard"); }
function getBankInterestPercent(character: Character) { return villageUpgradeBonus(character, "bank"); }
function getMissionRewardBonus(character: Character) { return villageUpgradeBonus(character, "missionHall"); }
function getHospitalDiscountPercent(character: Character) { return villageUpgradeBonus(character, "hospital"); }

function normalizeJutsu(jutsu: Partial<Jutsu> & Pick<Jutsu, "id" | "name" | "type">): Jutsu {
    return {
        id: jutsu.id,
        name: jutsu.name,
        type: jutsu.type,
        element: (jutsu.element ?? "Fire") as JutsuElement,
        ap: jutsu.ap ?? 40,
        range: jutsu.range ?? 3,
        effectPower: jutsu.effectPower ?? 50,
        cooldown: jutsu.cooldown ?? 1,
        currentCooldown: jutsu.currentCooldown ?? 0,
        chakraCost: jutsu.chakraCost ?? 20,
        staminaCost: jutsu.staminaCost ?? 10,
        healthCost: jutsu.healthCost ?? 0,
        target: (jutsu.target ?? "OPPONENT") as JutsuTarget,
        method: (jutsu.method ?? "SINGLE") as JutsuMethod,
        battleDescription: jutsu.battleDescription ?? `${jutsu.name} strikes %target`,
        healthCostReducePerLvl: jutsu.healthCostReducePerLvl ?? 0,
        chakraCostReducePerLvl: jutsu.chakraCostReducePerLvl ?? 0,
        staminaCostReducePerLvl: jutsu.staminaCostReducePerLvl ?? 0,
        tags: normalizeJutsuTags(jutsu.tags),
        description: jutsu.description ?? "",
        image: jutsu.image ?? "",
    };
}

function normalizeCharacter(parsed: Character): Character {
    const level = parsed.level ?? 1;
    const expectedMaxHp = maxHpForLevel(level);
    const expectedMaxChakra = maxChakraForLevel(level);
    const expectedMaxStamina = maxStaminaForLevel(level);
    const maxHp = Math.max(parsed.maxHp ?? expectedMaxHp, expectedMaxHp);
    const maxChakra = Math.max(parsed.maxChakra ?? expectedMaxChakra, expectedMaxChakra);
    const maxStamina = Math.max(parsed.maxStamina ?? expectedMaxStamina, expectedMaxStamina);

    return {
        ...parsed,
        avatarImage: parsed.avatarImage ?? "",
        specialty: (parsed.specialty ?? "Ninjutsu") as JutsuType,
        storyProgress: parsed.storyProgress ?? 0,
        storyVillage: parsed.storyVillage ?? parsed.village ?? villages[0],
        bankRyo: parsed.bankRyo ?? 0,
        honorSeals: parsed.honorSeals ?? 0,
        auraDust: parsed.auraDust ?? 0,
        auraSphereLevel: Math.max(1, Math.floor(parsed.auraSphereLevel ?? 1)),
        fateShards: parsed.fateShards ?? 0,
        tileCards: parsed.tileCards ?? [],
        elements: getCharacterElements(parsed),
        hp: Math.min(maxHp, parsed.maxHp && parsed.maxHp < expectedMaxHp ? expectedMaxHp : parsed.hp ?? expectedMaxHp),
        maxHp,
        chakra: Math.min(maxChakra, parsed.maxChakra && parsed.maxChakra < expectedMaxChakra ? expectedMaxChakra : parsed.chakra ?? expectedMaxChakra),
        maxChakra,
        stamina: Math.min(maxStamina, parsed.maxStamina && parsed.maxStamina < expectedMaxStamina ? expectedMaxStamina : parsed.stamina ?? expectedMaxStamina),
        maxStamina,
        rankTitle: parsed.rankTitle ?? rankFromLevel(level),
        inventory: parsed.inventory ?? [],
        equipment: parsed.equipment ?? {},
        stats: { ...baseStats(), ...parsed.stats },
        equippedJutsuIds: (parsed.equippedJutsuIds ?? []).slice(0, 15),
        jutsuMastery: parsed.jutsuMastery ?? [],
        pets: parsed.pets ?? [],
        activePetId: parsed.activePetId,
        boneCharms: parsed.boneCharms ?? 0,
        auraStones: parsed.auraStones ?? 0,
        mythicSeals: parsed.mythicSeals ?? 0,
        clan: parsed.clan,
        clanFounder: parsed.clanFounder ?? false,
        clanBattleContrib: parsed.clanBattleContrib ?? 0,
        clanEventContrib: parsed.clanEventContrib ?? 0,
        clanMissionContrib: parsed.clanMissionContrib ?? 0,
        clanContribMonth: parsed.clanContribMonth,
        guardQueued: parsed.guardQueued ?? false,
        hospitalized: parsed.hospitalized ?? false,
        villageUpgrades: normalizeVillageUpgrades(parsed.villageUpgrades),
        lastBankInterestAt: parsed.lastBankInterestAt ?? 0,
    };
}

function accountKey(name: string) {
    return name.trim().toLowerCase();
}

function loadPlayerAccounts(): PlayerAccounts {
    try {
        const raw = localStorage.getItem(PLAYER_ACCOUNTS_STORAGE);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function savePlayerAccounts(accounts: PlayerAccounts) {
    // Strip base64 images so we never hit the 5 MB localStorage quota.
    // The full data (with images) lives on the server and is loaded on login/startup.
    function noImages(_key: string, value: unknown) {
        if (typeof value === "string" && value.startsWith("data:image")) return "";
        return value;
    }
    try {
        localStorage.setItem(PLAYER_ACCOUNTS_STORAGE, JSON.stringify(accounts, noImages));
    } catch {
        // If it still fails for some reason, silently skip — server save is the source of truth
    }
}

function rosterFromAccounts(accounts: PlayerAccounts): PlayerRecord[] {
    return Object.values(accounts).map((account) => {
        const character = normalizeCharacter(account.snapshot.character);
        return {
            name: character.name,
            level: character.level,
            village: character.village,
            specialty: character.specialty,
            character,
            currentSector: account.snapshot.currentSector ?? 40,
            lastSeenAt: Date.now(),
        };
    });
}

function getOffenseStat(stats: Stats, type: JutsuType | string) {
    if (type === "Taijutsu") return stats.taijutsuOffense + stats.strength;
    if (type === "Bukijutsu") return stats.bukijutsuOffense + stats.speed;
    if (type === "Genjutsu") return stats.genjutsuOffense + stats.willpower;
    return stats.ninjutsuOffense + stats.intelligence;
}

function getDefenseStat(stats: Stats, type: JutsuType | string) {
    if (type === "Taijutsu") return stats.taijutsuDefense + stats.strength;
    if (type === "Bukijutsu") return stats.bukijutsuDefense + stats.speed;
    if (type === "Genjutsu") return stats.genjutsuDefense + stats.willpower;
    return stats.ninjutsuDefense + stats.intelligence;
}

function clampNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function diminishingPercent(percent: number, stackIndex: number) {
    const raw = Math.max(0, percent) / 100;
    return raw / (1 + stackIndex * 0.35 + raw * 0.25);
}

function multiplicativeTagMultiplier(tags: { percent?: number }[], direction: "increase" | "decrease") {
    return tags.reduce((multiplier, tag, index) => {
        const effective = diminishingPercent(tag.percent ?? 0, index);
        return direction === "increase"
            ? multiplier * (1 + effective)
            : multiplier / (1 + effective);
    }, 1);
}

function getTagMultiplier(tags: JutsuTag[]): number {
    const dmgTags = tags.filter(t => t.name === "Damage").sort((a, b) => b.percent - a.percent);
    return dmgTags.reduce((mult, tag, i) => mult * (1 + (tag.percent / 100) * Math.pow(0.7, i)), 1);
}

function getBloodlineMultiplier(char: Character, allSavedBloodlines: SavedBloodline[]): number {
    if (!char.equippedBloodlineId) return 1.0;
    const adminBl = allSavedBloodlines.find(b => b.id === char.equippedBloodlineId);
    if (adminBl) return adminBl.rank === "S Rank" ? 1.40 : adminBl.rank === "A Rank" ? 1.35 : 1.30;
    const starterBl = starterSavedBloodlines.find(b => b.id === char.equippedBloodlineId);
    if (starterBl) return 1.32;
    return 1.0;
}

// bloodlineMult: applied last (1.32 starter, 1.30 B Rank, 1.35 A Rank, 1.40 S Rank)
// armorFactor / itemMult: placeholders until items/armor system is implemented
function calculateDamage(
    jutsu: Jutsu,
    attackerStats: Stats,
    defenderStats: Stats,
    targetMaxHp = HP_CAP,
    bloodlineMult = 1.0,
    armorFactor = 1.0,
    itemMult = 1.0
) {
    const offense = getOffenseStat(attackerStats, jutsu.type);
    const defense = getDefenseStat(defenderStats, jutsu.type);
    const baselineDamage = targetMaxHp / 10;
    const statFactor = clampNumber(1 + ((offense - defense) / (MAX_STAT * 2)) * 0.85, 0.35, 1.85);
    const effectFactor = Math.max(0, jutsu.effectPower) / 100;
    const tagMult = getTagMultiplier(jutsu.tags);
    return Math.max(0, Math.floor(baselineDamage * effectFactor * statFactor * tagMult * bloodlineMult * armorFactor * itemMult));
}

function tagPower(tag: JutsuTag, fallback = 30) {
    return tag.percent > 0 ? tag.percent : fallback;
}

function jutsuEffectInfo(jutsu: Jutsu, tag: JutsuTag) {
    const pct = tagPower(tag);
    const effectPower = jutsu.effectPower;
    const percentLabel = tag.percent > 0 ? `${tag.percent}%` : "Static";

    if (tag.name === "Damage") return { summary: `Deals damage at ${effectPower}% effect power.`, rule: "Uses the jutsu offense type against the target's matching defense, then applies weather, bloodline, armor, and status modifiers.", duration: "Instant", value: `${effectPower}% EP` };
    if (tag.name === "Heal") return { summary: `Restores HP to the user based on ${effectPower}% effect power.`, rule: "Sets direct damage to 0 and heals the caster. Increase Heal statuses improve the final heal.", duration: "Instant", value: `${effectPower}% EP` };
    if (tag.name === "Shield") return { summary: `Adds ${effectPower} shield to the user.`, rule: "Shield absorbs incoming damage before HP. Pierce can bypass shield.", duration: "Until broken", value: `${effectPower}` };
    if (tag.name === "Barrier") return { summary: `Adds ${effectPower} barrier shield to the user.`, rule: "Functions like shield and absorbs incoming damage before HP. Pierce can bypass it.", duration: "Until broken", value: `${effectPower}` };
    if (tag.name === "Increase Damage Given") return { summary: `Boosts the caster's damage by ${pct}%.`, rule: "Applies to this jutsu's final damage calculation as an outgoing damage multiplier.", duration: "Instant strike", value: `${pct}%` };
    if (tag.name === "Decrease Damage Given") return { summary: `Makes the target deal ${pct}% less damage.`, rule: "Adds a negative status to the target that lowers outgoing damage.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Increase Damage Taken") return { summary: `Makes the target take ${pct}% more damage.`, rule: "Adds a negative status to the target that raises incoming damage.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Decrease Damage Taken") return { summary: `Makes the user take ${pct}% less damage.`, rule: "Adds a positive status to the caster that lowers incoming damage.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Absorb") return { summary: `Converts ${pct}% of incoming damage into healing.`, rule: "Adds a positive status to the caster. Buff Prevent can block it.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Lifesteal" || tag.name === "Vamp") return { summary: `Heals the user for ${pct}% of damage dealt.`, rule: "Triggers after damage. The heal is based on capped post-damage and benefits from Increase Heal.", duration: "Instant after hit", value: `${pct}%` };
    if (tag.name === "Reflect") return { summary: `Reflects ${pct}% damage back at attackers.`, rule: "Adds a positive status to the caster. Buff Prevent can block it.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Recoil") return { summary: `Deals ${pct}% recoil damage to the user.`, rule: "Triggers after damage and hurts the caster based on capped post-damage.", duration: "Instant after hit", value: `${pct}%` };
    if (tag.name === "Wound") return { summary: `Makes the target bleed after the hit.`, rule: "Applies a damage-over-time status based on capped post-damage.", duration: "3 rounds", value: `${pct}%` };
    if (tag.name === "Afterburn") return { summary: `Adds extra burn damage after the hit.`, rule: "Deals capped post-damage immediately after the main hit.", duration: "Instant after hit", value: `${pct}%` };
    if (tag.name === "Stun") return { summary: `Removes ${STUN_AP_PENALTY} AP from the target's next turn.`, rule: "Always applies unless Stun Prevent or Debuff Prevent blocks it. It does not skip the target's turn.", duration: "Next turn", value: `-${STUN_AP_PENALTY} AP` };
    if (tag.name === "Seal") return { summary: "Seals the target.", rule: "Always applies unless Debuff Prevent blocks it.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Elemental Seal") return { summary: "Seals elemental jutsu.", rule: "Always applies unless Debuff Prevent blocks it. Prevents elemental jutsu use while active.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Move") return { summary: "Moves the user on the battlefield.", rule: "Always lets the user choose an open tile within the jutsu range.", duration: "Instant", value: "Always" };
    if (tag.name === "Push/Pull") return { summary: "Moves the target on the battlefield.", rule: "Pushes or pulls the target position when the jutsu resolves.", duration: "Instant", value: "Position" };
    if (tag.name === "Buff Prevent") return { summary: "Blocks positive effects on the target.", rule: "Always prevents new positive effects like Shield, Reflect, Absorb, and similar buffs.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Debuff Prevent") return { summary: "Blocks negative effects on the target.", rule: "Always prevents new debuffs such as Stun, Seal, Poison, Drain, and damage-taken increases.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Cleanse Prevent") return { summary: "Prevents cleanse effects.", rule: "Always stops negative effects from being cleansed while active.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Clear Prevent") return { summary: "Prevents clear effects.", rule: "Always stops positive effects from being cleared while active.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Stun Prevent") return { summary: "Prevents stun.", rule: "Always protects against incoming Stun.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Poison") return { summary: `Poisons the target at ${pct}% strength.`, rule: "Adds a negative status tied to future resource use and pressure effects.", duration: "3 rounds", value: `${pct}%` };
    if (tag.name === "Drain") return { summary: "Drains the target over time.", rule: "Deals recurring drain based on the target's HP, chakra, and stamina pools.", duration: "3 rounds", value: "Scaling" };
    if (tag.name === "Pierce") return { summary: "Pierces shields.", rule: "The jutsu ignores shield blocking when damage is applied.", duration: "Instant", value: "Static" };
    if (tag.name === "Copy") return { summary: "Copies enemy positive effects.", rule: "Always copies active positive statuses from the target to the user.", duration: "Up to 2 rounds", value: "Always" };
    if (tag.name === "Mirror") return { summary: "Mirrors negative effects back to the enemy.", rule: "Always transfers the user's non-damage-over-time negative statuses to the target.", duration: "Up to 2 rounds", value: "Always" };
    if (tag.name === "Time Compression") return { summary: "Increases enemy AP costs.", rule: "Always adds a negative status that makes enemy actions cost more AP.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Time Dilation") return { summary: "Reduces the user's AP costs.", rule: "Always adds a positive status that makes the user's actions cost less AP.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Increase Heal") return { summary: `Increases healing by ${pct}%.`, rule: "Always adds a positive status that boosts future healing and lifesteal by this amount.", duration: "2 rounds", value: `${pct}%` };
    return { summary: tag.name || "Unnamed effect", rule: "Custom effect tag.", duration: "Varies", value: percentLabel };
}

function describeJutsuEffects(jutsu: Jutsu) {
    const descriptions = jutsu.tags
        .filter((tag) => tag.name)
        .map((tag) => jutsuEffectInfo(jutsu, tag).summary);

    return descriptions.length ? descriptions.join(" ") : "No special effects.";
}

function cappedPostDamage(damage: number, percent: number) {
    return Math.floor(Math.min(damage * (percent / 100), damage * 0.6));
}

function jutsuXpNeeded(level: number) {
    if (level >= JUTSU_MAX_LEVEL) return 0;
    return Math.max(1, level) * 50;
}

function getJutsuMastery(character: Character, jutsuId: string): JutsuMastery {
    return character.jutsuMastery?.find((j) => j.jutsuId === jutsuId) ?? { jutsuId, level: 0, xp: 0 };
}

function gainJutsuXp(character: Character, jutsuId: string, amount: number, maxLevelAllowed: number): Character {
    const existing = character.jutsuMastery?.length ? character.jutsuMastery : [];
    const mastery = existing.find((j) => j.jutsuId === jutsuId) ?? { jutsuId, level: 1, xp: 0 };
    let level = mastery.level;
    let xp = mastery.xp + amount;
    while (level < maxLevelAllowed && level < JUTSU_MAX_LEVEL && xp >= jutsuXpNeeded(level)) {
        xp -= jutsuXpNeeded(level);
        level++;
    }
    if (level >= maxLevelAllowed || level >= JUTSU_MAX_LEVEL) {
        level = Math.min(maxLevelAllowed, JUTSU_MAX_LEVEL);
        xp = 0;
    }
    return { ...character, jutsuMastery: [...existing.filter((j) => j.jutsuId !== jutsuId), { jutsuId, level, xp }] };
}

function scaleJutsuByLevel(jutsu: Jutsu, level: number) {
    const levelBonus = Math.max(0, level - 1);
    const effectMultiplier = 1 + levelBonus * 0.04;
    const costMultiplier = Math.max(0.8, 1 - levelBonus * 0.004);
    return {
        scaledEffectPower: Math.floor(jutsu.effectPower * effectMultiplier),
        healthCost: Math.max(0, Math.floor((jutsu.healthCost - jutsu.healthCostReducePerLvl * level) * costMultiplier)),
        chakraCost: Math.max(0, Math.floor(jutsu.chakraCost * costMultiplier)),
        staminaCost: Math.max(0, Math.floor(jutsu.staminaCost * costMultiplier)),
    };
}

function blankJutsu(index: number, rank: Rank): Jutsu {
    const defaultPercent = rank === "S Rank" ? 40 : 35;
    return makeJutsu(makeId(), `Jutsu ${index + 1}`, "Ninjutsu", 60, 4, 0, 7, 0, 0, [
        { name: "", percent: defaultPercent },
        { name: "", percent: defaultPercent },
    ]);
}
function jutsuCountForRank(rank: Rank) { return rank === "B Rank" ? 4 : 5; }
function pointBudgetForRank(rank: Rank) { return rank === "S Rank" ? 14 : rank === "A Rank" ? 13 : 9; }

function tagPointValue(tag: JutsuTag, rank?: Rank | null) {
    if (!tag.name) return 0;
    if (cappedDamageTags.includes(tag.name)) {
        const cap = tagCapForRank(rank);
        if (tag.percent >= cap) return 0.75; // at-cap bonus cost
        return 0;
    }
    if (percentageTags.includes(tag.name)) { // Wound only remains here
        if (tag.percent >= 40) return 1;
        if (tag.percent >= 35) return 0.5;
        return 0;
    }
    if (["Stun", "Copy", "Mirror", "Time Compression", "Time Dilation"].includes(tag.name)) return 2;
    if (["Seal", "Reflect", "Buff Prevent", "Cleanse Prevent", "Clear Prevent"].includes(tag.name)) return 1.5;
    if (["Shield", "Heal", "Pierce", "Wound", "Barrier", "Drain"].includes(tag.name)) return 1;
    if (["Move", "Push/Pull", "Poison", "Afterburn"].includes(tag.name)) return 0.5;
    return 1;
}

function jutsuPoints(jutsu: Jutsu, rank?: Rank | null) {
    const effectiveRank = rank ?? jutsu.bloodlineRank ?? null;
    let points = jutsu.tags.reduce((sum, tag) => sum + tagPointValue(tag, effectiveRank), 0);
    if (jutsu.ap === 40) points += 1;
    if (jutsu.range >= 5) points += 0.5;
    if (jutsu.target === "EMPTY_GROUND" && jutsu.method === "AOE_CIRCLE") points += 1;
    if (!hasFixedEffectPower(jutsu)) {
        if (jutsu.effectPower >= 38 && jutsu.effectPower <= 40) points += 1;
        if (jutsu.effectPower >= 45) points += 2;
    }
    if (jutsu.cooldown <= 1) points += 0.5;
    return points;
}

function bloodlinePoints(jutsus: Jutsu[]) {
    return jutsus.reduce((sum, jutsu) => sum + jutsuPoints(jutsu), 0);
}

function biomeLabel(biome: Biome) {
    if (biome === "forest") return "Stormveil Coastal Waters";
    if (biome === "snow") return "Frostfang Icefields";
    if (biome === "volcano") return "Ashen Leaf Forest";
    if (biome === "shadow") return "Moonshadow Darklands";
    return "Central Meadow";
}

function getCurrentStory(character: Character) {
    const storyLine = storylines[character.storyVillage || character.village] || storylines["Stormveil Village"];
    return storyLine[character.storyProgress] ?? null;
}

function createCharacter(name: string, village: string, specialty: JutsuType, bloodline: string): Character {
    return {
        name,
        village,
        specialty,
        bloodline,
        avatarImage: "",
        storyProgress: 0,
        storyVillage: village,
        level: 1,
        xp: 0,
        ryo: 100,
        bankRyo: 0,
        honorSeals: 0,
        auraDust: 0,
        auraSphereLevel: 1,
        fateShards: 0,
        tileCards: [],
        elements: [],
        hp: maxHpForLevel(1),
        maxHp: maxHpForLevel(1),
        chakra: maxChakraForLevel(1),
        maxChakra: maxChakraForLevel(1),
        stamina: maxStaminaForLevel(1),
        maxStamina: maxStaminaForLevel(1),
        rankTitle: "Academy Student",
        stats: baseStats(),
        unspentStats: 20,
        equippedJutsuIds: [],
        inventory: ["wooden-katana", "shinobi-vest"],
        equipment: {},
        jutsuMastery: [],
        pets: [],
        activePetId: undefined,
        boneCharms: 0,
        auraStones: 0,
        mythicSeals: 0,
        clanBattleContrib: 0,
        clanEventContrib: 0,
        clanMissionContrib: 0,
        villageUpgrades: defaultVillageUpgrades(),
        lastBankInterestAt: 0,
    };
}

function createAdminCharacter(adminName: AdminAccount = "Admin 1"): Character {
    return {
        ...createCharacter(adminName, "Stormveil Village", "Ninjutsu", "Admin Core"),
        level: 100,
        xp: 0,
        ryo: 999999,
        honorSeals: 9999,
        auraDust: 99999,
        auraSphereLevel: 300,
        fateShards: 9999,
        hp: maxHpForLevel(100),
        maxHp: maxHpForLevel(100),
        chakra: maxChakraForLevel(100),
        maxChakra: maxChakraForLevel(100),
        stamina: maxStaminaForLevel(100),
        maxStamina: maxStaminaForLevel(100),
        rankTitle: "Admin",
        stats: maxedStats(),
        unspentStats: 0,
        boneCharms: 9999,
        auraStones: 9999,
        mythicSeals: 9999,
    };
}

function getAllJutsus(savedBloodlines: SavedBloodline[], creatorJutsus: Jutsu[], character?: Character | null) {
    const starterBloodlineName = character?.bloodline === "Blue Blade Eyes" ? "Ashen Eyes" : character?.bloodline;
    const starterBloodline = starterSavedBloodlines.find((b) => b.name === starterBloodlineName);
    const equippedBloodline = savedBloodlines.find((b) => b.id === character?.equippedBloodlineId);
    const merged = new Map<string, Jutsu>();
    const markRank = (jutsus: Jutsu[], rank: Rank) => jutsus.map(j => ({ ...j, bloodlineRank: rank }));
    [
        ...starterJutsus,
        ...markRank(starterBloodline?.jutsus ?? [], starterBloodline?.rank ?? "B Rank"),
        ...markRank(equippedBloodline?.jutsus ?? [], equippedBloodline?.rank ?? "B Rank"),
        ...creatorJutsus.map(rebalanceNonBloodlineJutsu),
    ].map(normalizeJutsu).forEach((jutsu) => {
        merged.set(jutsu.id, jutsu);
    });
    return [...merged.values()];
}

function getJutsuSelectOptions(jutsus: Jutsu[], typeFilter: "All" | JutsuType, elementFilter: "All" | JutsuElement, sortBy: JutsuSort) {
    return [...jutsus]
        .filter((jutsu) => typeFilter === "All" || jutsu.type === typeFilter)
        .filter((jutsu) => elementFilter === "All" || jutsu.element === elementFilter)
        .sort((a, b) => {
            if (sortBy === "ap" || sortBy === "range" || sortBy === "effectPower") return a[sortBy] - b[sortBy];
            if (sortBy === "effect") return describeJutsuEffects(a).localeCompare(describeJutsuEffects(b)) || a.name.localeCompare(b.name);
            return String(a[sortBy]).localeCompare(String(b[sortBy])) || a.name.localeCompare(b.name);
        });
}

function storyToCreatorEvent(step: StoryStep, village: string, index: number): CreatorEvent {
    return {
        id: `story-${village.toLowerCase().replace(/\W+/g, "-")}-${index}`,
        name: `${village}: ${step.title}`,
        biome: "central",
        icon: step.bossIcon,
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: step.title,
        vnScene: step.scene,
        vnSpeaker: "Narrator",
        vnPages: [{
            title: step.cinematicTitle,
            scene: step.scene,
            speaker: "Narrator",
            dialogue: step.dialogue,
        }],
        levelReq: step.levelReq,
        xpReward: step.rewardXp,
        ryoReward: step.rewardRyo,
        staminaReward: 0,
        dialogue: step.dialogue,
    };
}

function blankAiRule(): AiRule {
    return { id: makeId(), condition: "always", value: 1, action: "use_highest_power_jutsu" };
}

function starterAiProfile(jutsus: Jutsu[] = starterJutsus): CreatorAi {
    return {
        id: `ai-${makeId()}`,
        name: "Custom Arena AI",
        icon: "EN",
        level: 10,
        village: "Admin Arena",
        hp: 1200,
        chakra: 700,
        stamina: 700,
        stats: addToAllStats(baseStats(), 60),
        jutsuIds: jutsus.slice(0, 4).map((jutsu) => jutsu.id),
        rules: [
            { id: makeId(), condition: "specific_round", value: 1, action: "use_highest_power_jutsu" },
            { id: makeId(), condition: "distance_higher_than", value: 1, action: "move_towards_opponent" },
            { id: makeId(), condition: "distance_lower_than", value: 3, action: "use_highest_power_jutsu" },
            { id: makeId(), condition: "always", value: 0, action: "use_basic_attack" },
        ],
    };
}

function buildBasicCombatAiRules(selectedJutsus: Jutsu[]): AiRule[] {
    const usableJutsus = selectedJutsus.length ? selectedJutsus : starterJutsus.slice(0, 4);
    const selfJutsu = usableJutsus.find((jutsu) => jutsu.target === "SELF" || jutsu.tags.some((tag) => ["Heal", "Shield", "Barrier", "Buff Prevent", "Stun Prevent"].includes(tag.name)));
    const controlJutsu = usableJutsus.find((jutsu) => jutsu.target !== "SELF" && jutsu.tags.some((tag) => ["Stun", "Seal", "Elemental Seal", "Decrease Damage Given", "Increase Damage Taken"].includes(tag.name)));
    const damageJutsu = [...usableJutsus]
        .filter((jutsu) => jutsu.target !== "SELF")
        .sort((a, b) => b.effectPower - a.effectPower || b.ap - a.ap)[0];
    const longestRange = Math.max(1, ...usableJutsus.filter((jutsu) => jutsu.target !== "SELF").map((jutsu) => jutsu.range || 1));
    const rules: AiRule[] = [];

    if (selfJutsu) {
        rules.push({ id: makeId(), condition: "hp_lower_than", value: 45, action: "use_specific_jutsu", jutsuId: selfJutsu.id });
    }

    if (controlJutsu) {
        rules.push({ id: makeId(), condition: "specific_round", value: 1, action: "use_specific_jutsu", jutsuId: controlJutsu.id });
    }

    if (damageJutsu) {
        rules.push({ id: makeId(), condition: "distance_lower_than", value: longestRange + 1, action: "use_specific_jutsu", jutsuId: damageJutsu.id });
        rules.push({ id: makeId(), condition: "distance_lower_than", value: longestRange + 1, action: "use_highest_power_jutsu" });
    }

    rules.push({ id: makeId(), condition: "distance_higher_than", value: longestRange, action: "move_towards_opponent" });
    rules.push({ id: makeId(), condition: "always", value: 0, action: damageJutsu ? "use_highest_power_jutsu" : "use_basic_attack" });
    rules.push({ id: makeId(), condition: "always", value: 0, action: "use_basic_attack" });

    return rules;
}

function makeBuiltinAi(
    id: string,
    name: string,
    icon: string,
    level: number,
    village: string,
    jutsus: Jutsu[],
    statBonus: number
): CreatorAi {
    const selectedJutsus = jutsus.map(normalizeJutsu);
    return normalizeAiProfile({
        id,
        name,
        icon,
        level,
        village,
        hp: maxHpForLevel(level),
        chakra: maxChakraForLevel(level),
        stamina: maxStaminaForLevel(level),
        stats: addToAllStats(enemyStats(), statBonus),
        jutsuIds: selectedJutsus.map((jutsu) => jutsu.id),
        rules: buildBasicCombatAiRules(selectedJutsus),
    }, starterJutsus);
}
function rollPetEncounter(pets: Pet[]): Pet | null {
    const roll = Math.random();

    // Total pet chance: 1% — 1 in 100 explores
    // Mythic: 0.02%
    // Legendary: 0.18%
    // Rare: 0.30%
    // Standard: 0.50%

    function choosePetFromRarity(rarity: PetRarity): Pet | null {
        const rarityIndex = petRarityOrder.indexOf(rarity);
        const fallbackRarities = petRarityOrder.slice(0, rarityIndex + 1).reverse();
        for (const fallbackRarity of fallbackRarities) {
            const pool = pets.filter((pet) => pet.rarity === fallbackRarity);
            const chosen = pool[Math.floor(Math.random() * pool.length)];
            if (chosen) return cloneEncounterPet(chosen);
        }
        return null;
    }

    if (roll <= 0.002) {
        return choosePetFromRarity("mythic");
    }

    if (roll <= 0.007) {
        return choosePetFromRarity("legendary");
    }

    if (roll <= 0.01) {
        return choosePetFromRarity("rare");
    }

    if (roll <= 0.05) {
        return choosePetFromRarity("standard");
    }

    return null;
}
const builtinAis: CreatorAi[] = [
    makeBuiltinAi("builtin-ai-mist-sentinel", "Mist Sentinel", "MS", 8, "Stormveil Patrol", starterJutsus.filter((jutsu) => jutsu.element === "Water").slice(0, 4), 18),
    makeBuiltinAi("builtin-ai-ember-duelist", "Ember Duelist", "ED", 18, "Ashen Leaf Duelist", starterJutsus.filter((jutsu) => jutsu.element === "Fire").slice(0, 4), 34),
    makeBuiltinAi("builtin-ai-frost-sealer", "Frost Sealer", "FS", 32, "Frostfang Hunter", starterJutsus.filter((jutsu) => jutsu.element === "Lightning" || jutsu.tags.some((tag) => ["Stun", "Seal"].includes(tag.name))).slice(0, 4), 52),
    makeBuiltinAi("builtin-ai-shadow-weaver", "Shadow Weaver", "SW", 48, "Moonshadow Operative", starterJutsus.filter((jutsu) => jutsu.type === "Genjutsu").slice(0, 5), 74),
    makeBuiltinAi("builtin-ai-central-champion", "Central Champion", "CC", 70, "Central Arena", starterJutsus.filter((jutsu) => jutsu.ap === 60).slice(0, 6), 110),
];

function normalizeAiProfile(ai: Partial<CreatorAi>, allJutsus: Jutsu[] = starterJutsus): CreatorAi {
    const fallback = starterAiProfile(allJutsus);
    return {
        ...fallback,
        ...ai,
        id: ai.id ?? fallback.id,
        name: ai.name ?? fallback.name,
        icon: ai.icon ?? fallback.icon,
        image: ai.image ?? fallback.image,
        level: Math.max(1, Math.min(MAX_LEVEL, Number(ai.level ?? fallback.level))),
        hp: Math.max(1, Number(ai.hp ?? fallback.hp)),
        chakra: Math.max(0, Number(ai.chakra ?? fallback.chakra)),
        stamina: Math.max(0, Number(ai.stamina ?? fallback.stamina)),
        stats: { ...baseStats(), ...(ai.stats ?? fallback.stats) },
        jutsuIds: ai.jutsuIds ?? fallback.jutsuIds,
        rules: (ai.rules?.length ? ai.rules : fallback.rules).map((rule) => ({
            id: rule.id ?? makeId(),
            condition: rule.condition ?? "always",
            value: Number(rule.value ?? 0),
            action: rule.action ?? "use_highest_power_jutsu",
            jutsuId: rule.jutsuId,
        })),
    };
}
export default function App() {
    const [screen, setScreen] = useState<Screen>("start");
    const [worldMapKey, setWorldMapKey] = useState(0);
    const [character, setCharacter] = useState<Character | null>(null);
    const [currentAccountName, setCurrentAccountName] = useState("");
    const [savedBloodlines, setSavedBloodlines] = useState<SavedBloodline[]>([]);
    const [currentBiome, setCurrentBiome] = useState<Biome>("central");
    const [currentWeather, setCurrentWeather] =
        useState<WeatherType>("clear");
    const [activeTraining, setActiveTraining] = useState<ActiveTraining | null>(null);
    const [adminLoggedIn, setAdminLoggedIn] = useState(false);
    const [adminAccount, setAdminAccount] = useState<AdminAccount | "">("");
    const [creatorJutsus, setCreatorJutsus] = useState<Jutsu[]>([]);
    const [creatorEvents, setCreatorEvents] = useState<CreatorEvent[]>([]);
    const [creatorItems, setCreatorItems] = useState<GameItem[]>([]);
    const [creatorAis, setCreatorAis] = useState<CreatorAi[]>([]);
    const [creatorMissions, setCreatorMissions] = useState<CreatorMission[]>([]);
    const [creatorRaids, setCreatorRaids] = useState<CreatorRaid[]>([]);
    const [creatorCards, setCreatorCards] = useState<TileCard[]>([]);
    const [petEncounterVn, setPetEncounterVn] = useState<CreatorEvent>(defaultPetEncounterVn);
    const [editablePets, setEditablePets] = useState<Pet[]>(petPool);
    const [selectedPetId, setSelectedPetId] = useState(petPool[0]?.id ?? "");
    useEffect(() => {
        setEditablePets((currentPets) => {
            const mergedPets = mergeMissingBuiltInPets(currentPets);

            if (mergedPets.length === currentPets.length) {
                return currentPets;
            }

            return mergedPets;
        });
    }, []);
    const [acceptedMissionIds, setAcceptedMissionIds] = useState<string[]>([]);
    const [missionProgress, setMissionProgress] = useState<Record<string, number>>({});
    const [pendingAiProfileId, setPendingAiProfileId] = useState("");
    const [pendingPvpOpponent, setPendingPvpOpponent] = useState<Character | null>(null);
    const [raidBattleKind, setRaidBattleKind] = useState<"none" | "raidAi" | "raidPlayer" | "defense">("none");
    const [endlessBattleActive, setEndlessBattleActive] = useState(false);
    const [endlessBattleWave, setEndlessBattleWave] = useState(0);
    const [arenaKey, setArenaKey] = useState(0);
    const [currentSector, setCurrentSector] = useState(40);
    const [playerRoster, setPlayerRoster] = useState<PlayerRecord[]>([]);
    const [duelChallenges, setDuelChallenges] = useState<DuelChallenge[]>([]);
    const [triggeredEvents, setTriggeredEvents] = useState<string[]>([]);
    const [liveSectorPlayers, setLiveSectorPlayers] = useState<PlayerRecord[]>([]);
    const [incomingAttackBanner, setIncomingAttackBanner] = useState("");
    const [activeTriggeredEvent, setActiveTriggeredEvent] = useState<CreatorEvent | null>(null);
    const [activeTriggerReturnScreen, setActiveTriggerReturnScreen] = useState<Screen>("village");
    const [triggerPage, setTriggerPage] = useState(0);
    const [triggerLine, setTriggerLine] = useState(0);
    // Multiplayer heartbeat — keeps server presence alive and detects incoming attacks
    const characterRef = useRef<Character | null>(null);
    useEffect(() => { characterRef.current = character; }, [character]);

    useEffect(() => {
        if (!character) return;

        async function heartbeat() {
            const char = characterRef.current;
            if (!char) return;
            try {
                const res = await fetch('/api/player/heartbeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: char.name, sector: currentSector, character: char }),
                });
                if (!res.ok) return;
                const data: { sectorMates?: PlayerRecord[]; pendingAttacker?: Character | null } = await res.json();
                if (data.sectorMates) setLiveSectorPlayers(data.sectorMates);
                if (data.pendingAttacker) {
                    const attacker = normalizeCharacter(data.pendingAttacker);
                    setIncomingAttackBanner(`${attacker.name} is attacking you!`);
                    setTimeout(() => setIncomingAttackBanner(""), 4000);
                    setPendingAiProfileId('');
                    setPendingPvpOpponent(attacker);
                    setRaidBattleKind("defense");
                    setScreen('arena');
                }
            } catch {
                // Server unavailable — silently skip
            }
        }

        heartbeat();
        const id = setInterval(heartbeat, 3000);
        return () => clearInterval(id);
    }, [character?.name, currentSector]);

    useEffect(() => {
        // Helper: apply a full server/local snapshot to state
        function applySnapshot(snap: ReturnType<typeof buildPlayerSavePayload>) {
            setCharacter(normalizeAdminCharacter(snap.character));
            setCurrentAccountName(snap.character.name);
            setCurrentBiome(snap.currentBiome ?? "central");
            setActiveTraining(snap.activeTraining ?? null);
            setAcceptedMissionIds(snap.acceptedMissionIds ?? []);
            setMissionProgress(snap.missionProgress ?? {});
            setTriggeredEvents(snap.triggeredEvents ?? []);
            setPendingAiProfileId(snap.pendingAiProfileId ?? "");
            setCurrentSector(snap.currentSector ?? 40);
            if (snap.savedBloodlines) setSavedBloodlines(snap.savedBloodlines.map((bloodline: SavedBloodline) => ({ ...bloodline, jutsus: bloodline.jutsus.map(normalizeJutsu) })));
            if (snap.creatorJutsus) setCreatorJutsus(snap.creatorJutsus.map(normalizeJutsu).map(rebalanceNonBloodlineJutsu));
            if (snap.creatorAis) setCreatorAis(snap.creatorAis);
            if (snap.creatorEvents) setCreatorEvents(snap.creatorEvents);
            if (snap.creatorMissions) setCreatorMissions(snap.creatorMissions);
            if (snap.creatorRaids) setCreatorRaids(snap.creatorRaids);
            if (snap.creatorCards) setCreatorCards(snap.creatorCards);
            if (snap.creatorItems) setCreatorItems(snap.creatorItems);
            if (snap.petEncounterVn) setPetEncounterVn(snap.petEncounterVn);
            if (snap.editablePets) setEditablePets(mergeMissingBuiltInPets(snap.editablePets));
            setScreen("village");
        }

        let localAccountName = "";

        try {
            const raw = localStorage.getItem(STORAGE);
            if (raw) {
                const data = JSON.parse(raw);

                const accounts = loadPlayerAccounts();
                setPlayerRoster(rosterFromAccounts(accounts));

                localAccountName = data.currentAccountName ?? "";
                const savedAccount = accounts[accountKey(localAccountName)];

                // Restore session from local snapshot (no images — stripped to save space)
                if (localAccountName && savedAccount) {
                    const snapshot = savedAccount.snapshot;
                    setCurrentAccountName(snapshot.character.name);
                    setCharacter(normalizeAdminCharacter(snapshot.character));
                    setCurrentBiome(snapshot.currentBiome ?? "central");
                    setActiveTraining(snapshot.activeTraining ?? null);
                    setAcceptedMissionIds(snapshot.acceptedMissionIds ?? []);
                    setMissionProgress(snapshot.missionProgress ?? {});
                    setTriggeredEvents(snapshot.triggeredEvents ?? []);
                    setPendingAiProfileId(snapshot.pendingAiProfileId ?? "");
                    setCurrentSector(snapshot.currentSector ?? 40);
                    setScreen("village");
                } else if (data.character) {
                    setCharacter(normalizeAdminCharacter(data.character));
                    setScreen("village");
                }

                if (data.savedBloodlines) setSavedBloodlines(data.savedBloodlines.map((b: SavedBloodline) => ({ ...b, jutsus: b.jutsus.map(normalizeJutsu) })));
                if (data.currentBiome) setCurrentBiome(data.currentBiome);
                if (data.currentSector) setCurrentSector(data.currentSector);
                if (data.activeTraining) setActiveTraining(data.activeTraining);
                if (data.adminLoggedIn) setAdminLoggedIn(true);
                if (data.adminAccount) setAdminAccount(data.adminAccount);
                if (data.creatorJutsus) setCreatorJutsus(data.creatorJutsus.map(normalizeJutsu).map(rebalanceNonBloodlineJutsu));
                if (data.creatorAis) setCreatorAis(data.creatorAis.map((ai: CreatorAi) => normalizeAiProfile(ai, [...starterJutsus, ...((data.creatorJutsus ?? []) as Jutsu[]).map(normalizeJutsu).map(rebalanceNonBloodlineJutsu)])));
                if (data.creatorItems) setCreatorItems(data.creatorItems);
                if (data.creatorEvents) setCreatorEvents(data.creatorEvents);
                if (data.editablePets) setEditablePets(mergeMissingBuiltInPets(data.editablePets));
                if (data.creatorMissions) setCreatorMissions(data.creatorMissions);
                if (data.creatorRaids) setCreatorRaids(data.creatorRaids);
                if (data.creatorCards) setCreatorCards(data.creatorCards);
                if (data.petEncounterVn) setPetEncounterVn(data.petEncounterVn);
                if (data.acceptedMissionIds) setAcceptedMissionIds(data.acceptedMissionIds);
                if (data.missionProgress) setMissionProgress(data.missionProgress);
                if (data.pendingAiProfileId) setPendingAiProfileId(data.pendingAiProfileId);
                if (data.triggeredEvents) setTriggeredEvents(data.triggeredEvents);
                if (data.playerRoster && Object.keys(accounts).length === 0) setPlayerRoster(data.playerRoster.map((player: PlayerRecord) => ({ ...player, character: normalizeCharacter(player.character), currentSector: player.currentSector ?? 40 })));
                if (data.duelChallenges) setDuelChallenges(data.duelChallenges.map((challenge: DuelChallenge) => ({ ...challenge, challenger: normalizeCharacter(challenge.challenger) })));
            }
        } catch {
            console.warn("Could not load local save data.");
        }

        // Always try to pull full save from server (images live here, not in localStorage).
        // Use currentAccountName from localStorage — no account-existence gate.
        if (localAccountName) {
            pullSaveFromServer(localAccountName).then((snap) => {
                if (snap) applySnapshot(snap);
            });
        }
    }, []);

    useEffect(() => {
        // Strip base64 images before writing to localStorage to avoid 5 MB quota errors.
        // Images are preserved server-side via pushSaveToServer and restored on startup.
        function noImages(_key: string, value: unknown) {
            if (typeof value === "string" && value.startsWith("data:image")) return "";
            return value;
        }
        try {
            localStorage.setItem(
                STORAGE,
                JSON.stringify({
                    character,
                    currentAccountName,
                    savedBloodlines,
                    currentBiome,
                    activeTraining,
                    adminLoggedIn,
                    adminAccount,
                    creatorJutsus,
                    creatorAis,
                    creatorEvents,
                    creatorMissions,
                    creatorRaids,
                    creatorCards,
                    petEncounterVn,
                    acceptedMissionIds,
                    missionProgress,
                    creatorItems,
                    pendingAiProfileId,
                    currentSector,
                    triggeredEvents,
                    playerRoster,
                    duelChallenges,
                    editablePets,
                }, noImages)
            );
        } catch (error) {
            console.warn("localStorage save failed:", error);
        }
    }, [
        character,
        currentAccountName,
        savedBloodlines,
        currentBiome,
        activeTraining,
        adminLoggedIn,
        adminAccount,
        creatorJutsus,
        creatorAis,
        creatorEvents,
        creatorMissions,
        creatorRaids,
        creatorCards,
        petEncounterVn,
        acceptedMissionIds,
        missionProgress,
        creatorItems,
        pendingAiProfileId,
        currentSector,
        triggeredEvents,
        playerRoster,
        duelChallenges,
        editablePets,
    ]);

    function buildPlayerSavePayload(characterToSave: Character) {
        return {
            character: characterToSave,
            currentBiome,
            activeTraining,
            acceptedMissionIds,
            missionProgress,
            triggeredEvents,
            pendingAiProfileId,
            currentSector,
            savedBloodlines,
            creatorJutsus,
            creatorAis,
            creatorEvents,
            creatorMissions,
            creatorRaids,
            creatorCards,
            creatorItems,
            petEncounterVn,
            editablePets,
        };
    }

    async function pushSaveToServer(characterToSave: Character, name: string) {
        const res = await fetch(`/api/save/${encodeURIComponent(name.toLowerCase())}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildPlayerSavePayload(characterToSave)),
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
    }

    async function pullSaveFromServer(name: string): Promise<ReturnType<typeof buildPlayerSavePayload> | null> {
        try {
            const res = await fetch(`/api/save/${encodeURIComponent(name.toLowerCase())}`);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }

    function saveAccountProgress(characterToSave: Character, accountName = currentAccountName) {
        const key = accountKey(accountName || characterToSave.name);
        if (!key) return;
        const accounts = loadPlayerAccounts();
        const existing = accounts[key];
        if (!existing) return;
        accounts[key] = {
            ...existing,
            snapshot: {
                character: characterToSave,
                currentBiome,
                activeTraining,
                acceptedMissionIds,
                missionProgress,
                triggeredEvents,
                pendingAiProfileId,
                currentSector,
            },
        };
        savePlayerAccounts(accounts);
        setPlayerRoster(rosterFromAccounts(accounts));
    }

    useEffect(() => {
        if (!character || !currentAccountName) return;
        saveAccountProgress(character, currentAccountName);
    }, [
        character,
        currentAccountName,
        currentBiome,
        activeTraining,
        acceptedMissionIds,
        missionProgress,
        triggeredEvents,
        pendingAiProfileId,
        currentSector,
    ]);

    useEffect(() => {
        if (!character) return;
        setPlayerRoster((current) => {
            const record: PlayerRecord = {
                name: character.name,
                level: character.level,
                village: character.village,
                specialty: character.specialty,
                character,
                currentSector,
                lastSeenAt: Date.now(),
            };
            return [record, ...current.filter((player) => player.name !== character.name)].slice(0, 30);
        });
    }, [character, currentSector]);

    useEffect(() => {
        if (!character || activeTriggeredEvent) return;
        if (character.level < 9 || triggeredEvents.includes(AURA_SPHERE_VN_ID)) return;
        const alreadyHasAuraSphere = character.inventory.includes(AURA_SPHERE_ITEM_ID) || Object.values(character.equipment).includes(AURA_SPHERE_ITEM_ID);
        if (alreadyHasAuraSphere) {
            setTriggeredEvents((ids) => ids.includes(AURA_SPHERE_VN_ID) ? ids : [...ids, AURA_SPHERE_VN_ID]);
            return;
        }
        setTriggeredEvents((ids) => ids.includes(AURA_SPHERE_VN_ID) ? ids : [...ids, AURA_SPHERE_VN_ID]);
        setActiveTriggeredEvent(auraSphereLv9VnEvent);
        setActiveTriggerReturnScreen(screen);
        setTriggerPage(0);
        setTriggerLine(0);
    }, [activeTriggeredEvent, character, screen, triggeredEvents]);

    useEffect(() => {
        const interval = setInterval(() => {
            setCharacter((prev) => {
                if (!prev) return prev;
                if (screen === "arena" || screen === "storyBoss") return prev;
                const auraBonuses = getActiveAuraSphereBonuses(prev);

                return {
                    ...prev,
                    hp: Math.min(prev.maxHp, prev.hp + 1 + auraBonuses.regen),
                    chakra: Math.min(prev.maxChakra, prev.chakra + 1 + auraBonuses.regen),
                    stamina: Math.min(prev.maxStamina, prev.stamina + 1 + auraBonuses.regen),
                };
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [screen]);

    // Keep a ref to the latest save payload so the interval always uses current data
    const latestSaveRef = useRef<{ character: Character; name: string; payload: ReturnType<typeof buildPlayerSavePayload> } | null>(null);
    useEffect(() => {
        if (!character || !currentAccountName) { latestSaveRef.current = null; return; }
        latestSaveRef.current = { character, name: currentAccountName, payload: buildPlayerSavePayload(character) };
    });

    useEffect(() => {
        const id = setInterval(() => {
            const snap = latestSaveRef.current;
            if (!snap) return;
            fetch(`/api/save/${encodeURIComponent(snap.name.toLowerCase())}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(snap.payload),
            }).catch(() => { /* silent background save */ });
        }, 60_000);
        return () => clearInterval(id);
    }, []);

    function createPlayerAccount(newCharacter: Character, password: string) {
        const key = accountKey(newCharacter.name);
        const accounts = loadPlayerAccounts();
        if (accounts[key]) {
            alert("A player with that name already exists. Log in instead or choose another name.");
            return;
        }

        accounts[key] = {
            password,
            snapshot: {
                character: newCharacter,
                currentBiome: "central",
                activeTraining: null,
                acceptedMissionIds: [],
                missionProgress: {},
                triggeredEvents: [],
                pendingAiProfileId: "",
                currentSector: 40,
            },
        };
        savePlayerAccounts(accounts);

        setCurrentAccountName(newCharacter.name);
        setCharacter(newCharacter);
        setCurrentBiome("central");
        setActiveTraining(null);
        setAcceptedMissionIds([]);
        setMissionProgress({});
        setTriggeredEvents([]);
        setPendingAiProfileId("");
        setCurrentSector(40);
        setScreen("villageLore");
    }

    // Apply a full server snapshot to all game state
    function applyServerSnapshot(snap: ReturnType<typeof buildPlayerSavePayload>) {
        setCurrentAccountName(snap.character.name);
        setCharacter(normalizeAdminCharacter(snap.character));
        setCurrentBiome(snap.currentBiome ?? "central");
        setActiveTraining(snap.activeTraining ?? null);
        setAcceptedMissionIds(snap.acceptedMissionIds ?? []);
        setMissionProgress(snap.missionProgress ?? {});
        setTriggeredEvents(snap.triggeredEvents ?? []);
        setPendingAiProfileId(snap.pendingAiProfileId ?? "");
        setCurrentSector(snap.currentSector ?? 40);
        if (snap.savedBloodlines) setSavedBloodlines(snap.savedBloodlines.map((bloodline: SavedBloodline) => ({ ...bloodline, jutsus: bloodline.jutsus.map(normalizeJutsu) })));
        if (snap.creatorJutsus) setCreatorJutsus(snap.creatorJutsus.map(normalizeJutsu).map(rebalanceNonBloodlineJutsu));
        if (snap.creatorAis) setCreatorAis(snap.creatorAis);
        if (snap.creatorEvents) setCreatorEvents(snap.creatorEvents);
        if (snap.creatorMissions) setCreatorMissions(snap.creatorMissions);
        if (snap.creatorRaids) setCreatorRaids(snap.creatorRaids);
        if (snap.creatorCards) setCreatorCards(snap.creatorCards);
        if (snap.creatorItems) setCreatorItems(snap.creatorItems);
        if (snap.petEncounterVn) setPetEncounterVn(snap.petEncounterVn);
        if (snap.editablePets) setEditablePets(mergeMissingBuiltInPets(snap.editablePets));
        setPlayerRoster(rosterFromAccounts(loadPlayerAccounts()));
        setScreen("village");
    }

    async function loginPlayerAccount(name: string, password: string) {
        const account = loadPlayerAccounts()[accountKey(name)];

        // If local account exists, validate password strictly
        if (account && account.password !== password) {
            alert("Player name or password is incorrect.");
            return;
        }

        // Show village immediately with whatever local data we have
        if (account) {
            const localSnapshot = account.snapshot;
            setCurrentAccountName(localSnapshot.character.name);
            setCharacter(normalizeCharacter(localSnapshot.character));
            setCurrentBiome(localSnapshot.currentBiome ?? "central");
            setActiveTraining(localSnapshot.activeTraining ?? null);
            setAcceptedMissionIds(localSnapshot.acceptedMissionIds ?? []);
            setMissionProgress(localSnapshot.missionProgress ?? {});
            setTriggeredEvents(localSnapshot.triggeredEvents ?? []);
            setPendingAiProfileId(localSnapshot.pendingAiProfileId ?? "");
            setCurrentSector(localSnapshot.currentSector ?? 40);
            setScreen("village");
        }

        // Always pull the full server save — this is where images and latest state live
        const serverSnapshot = await pullSaveFromServer(name);
        if (serverSnapshot) {
            applyServerSnapshot(serverSnapshot);
        } else if (!account) {
            alert("No save found for that name. Check spelling or create a new character.");
        }
    }

    function logoutPlayer() {
        if (character) {
            saveAccountProgress(character);
            pushSaveToServer(character, currentAccountName || character.name);
        }
        setCharacter(null);
        setCurrentAccountName("");
        setActiveTraining(null);
        setAcceptedMissionIds([]);
        setMissionProgress({});
        setTriggeredEvents([]);
        setPendingAiProfileId("");
        setPendingPvpOpponent(null);
        setCurrentSector(40);
        setActiveTriggeredEvent(null);
        setScreen("start");
    }

    function resetGame() {
        localStorage.removeItem(STORAGE);
        localStorage.removeItem(PLAYER_ACCOUNTS_STORAGE);
        setCharacter(null);
        setCurrentAccountName("");
        setSavedBloodlines([]);
        setCurrentBiome("central");
        setActiveTraining(null);
        setAdminLoggedIn(false);
        setAdminAccount("");
        setCreatorJutsus([]);
        setCreatorAis([]);
        setPendingAiProfileId("");
        setPendingPvpOpponent(null);
        setCurrentSector(40);
        setCreatorEvents([]);
        setCreatorMissions([]);
        setAcceptedMissionIds([]);
        setMissionProgress({});
        setTriggeredEvents([]);
        setPlayerRoster([]);
        setDuelChallenges([]);
        setScreen("start");
        setCreatorItems([]);
    }

    function recordMissionExplore(sector: number) {
        const matchingMissions = creatorMissions.filter((mission) =>
            acceptedMissionIds.includes(mission.id) &&
            mission.type === "fetchExplore" &&
            mission.targetSector === sector
        );

        if (matchingMissions.length === 0) return;

        setMissionProgress((current) => {
            const next = { ...current };
            matchingMissions.forEach((mission) => {
                next[mission.id] = Math.min(mission.exploreCount, (next[mission.id] ?? 0) + 1);
            });
            return next;
        });
    }

    function pickRandomEndlessAi(wave: number): string {
        if (playableAis.length === 0) return "";
        // Scale difficulty: allow AIs up to player level + 5 per wave, capped at 100
        const cap = Math.min(100, (character?.level ?? 1) + wave * 5);
        const pool = playableAis.filter(ai => (ai.level ?? 1) <= cap);
        const chosen = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : playableAis[Math.floor(Math.random() * playableAis.length)];
        return chosen.id;
    }

    function startEndlessBattle() {
        setEndlessBattleActive(true);
        setEndlessBattleWave(1);
        setPendingAiProfileId(pickRandomEndlessAi(1));
        setArenaKey(k => k + 1);
        navigate("arena");
    }

    function handleEndlessWin(currentWave: number) {
        const next = currentWave + 1;
        setEndlessBattleWave(next);
        setPendingAiProfileId(pickRandomEndlessAi(next));
        setArenaKey(k => k + 1);
    }

    function endEndlessBattle() {
        setEndlessBattleActive(false);
        setEndlessBattleWave(0);
    }

    function navigate(nextScreen: Screen) {
        if (character && nextScreen === "arena") {
            const event = creatorEvents.find(
                (candidate) =>
                    candidate.eventKind === "visualNovel" &&
                    candidate.trigger === "firstBattleArena" &&
                    !triggeredEvents.includes(candidate.id) &&
                    character.level >= candidate.levelReq
            );

            if (event) {
                setTriggeredEvents((ids) => [...ids, event.id]);
                setActiveTriggeredEvent(event);
                setActiveTriggerReturnScreen("arena");
                setTriggerPage(0);
                setTriggerLine(0);
                return;
            }
        }

        if (character && screen === "village" && nextScreen !== "village") {
            // Built-in: Awakening Stone VN fires first time leaving village at level 2+
            if (character.level >= 2 && !triggeredEvents.includes(AWAKENING_VN_ID)) {
                setTriggeredEvents((ids) => [...ids, AWAKENING_VN_ID]);
                setActiveTriggeredEvent(awakeningLv2VnEvent);
                setActiveTriggerReturnScreen(nextScreen);
                setTriggerPage(0);
                setTriggerLine(0);
                return;
            }

            const event = creatorEvents.find(
                (candidate) =>
                    candidate.eventKind === "visualNovel" &&
                    candidate.trigger === "firstLeaveVillage" &&
                    !triggeredEvents.includes(candidate.id) &&
                    character.level >= candidate.levelReq
            );

            if (event) {
                setTriggeredEvents((ids) => [...ids, event.id]);
                setActiveTriggeredEvent(event);
                setActiveTriggerReturnScreen(nextScreen);
                setTriggerPage(0);
                setTriggerLine(0);
                return;
            }
        }

        if (nextScreen === "worldMap") setWorldMapKey((k) => k + 1);
        setScreen(nextScreen);
    }

    function completeTriggeredEvent(event: CreatorEvent) {
        if (character) {
            const leveled = gainXp(character, event.xpReward);
            const isRewardEvent = event.eventKind !== "visualNovel";
            const rewardInventory = event.id === AURA_SPHERE_VN_ID && !leveled.inventory.includes(AURA_SPHERE_ITEM_ID) && !Object.values(leveled.equipment).includes(AURA_SPHERE_ITEM_ID)
                ? [...leveled.inventory, AURA_SPHERE_ITEM_ID]
                : leveled.inventory;
            setCharacter({
                ...applyCurrencyRewards(leveled, event.currencyRewards),
                ryo: leveled.ryo + event.ryoReward,
                stamina: Math.min(leveled.maxStamina, leveled.stamina + event.staminaReward),
                clanEventContrib: (leveled.clanEventContrib ?? 0) + (isRewardEvent ? 1 : 0),
                clanContribMonth: new Date().toISOString().slice(0, 7),
                inventory: rewardInventory,
            });
        }

        setActiveTriggeredEvent(null);
        setScreen(activeTriggerReturnScreen);
    }

    const playableAis = [
        ...builtinAis.map((builtin) => creatorAis.find((ai) => ai.id === builtin.id) ?? builtin),
        ...creatorAis.filter((ai) => !builtinAis.some((builtin) => builtin.id === ai.id)),
    ];

    return (
        <div
            className={`app-shell shell-biome-${currentBiome} screen-${screen}`}
            style={{
                backgroundImage: `linear-gradient(rgba(2, 6, 23, 0.38), rgba(2, 6, 23, 0.76)), url(${backgroundImage})`,
            }}
        >
            <div
                className="app-background"
                style={{ backgroundImage: `url(${backgroundImage})` }}
            />

            {character &&
                screen !== "start" &&
                screen !== "arena" &&
                screen !== "storyBoss" && (
                    <LeftProfileCard
                        character={character}
                        updateCharacter={setCharacter}
                    />
                )}

            {screen !== "start" && character && (screen === "arena" || screen === "storyBoss") && <SectorBanner />}

            {screen !== "start" && character && (
                <RightMenu
                    navigate={navigate}
                    adminLoggedIn={adminLoggedIn}
                    resetGame={resetGame}
                    logoutPlayer={logoutPlayer}
                    currentBiome={currentBiome}
                    characterVillage={character?.village ?? ""}
                    screen={screen}
                />
            )}

            {incomingAttackBanner && (
                <div className="incoming-attack-banner">{incomingAttackBanner}</div>
            )}

            <main
                className={`center-game screen-${screen}`}
                style={{
                    backgroundImage: `linear-gradient(rgba(2, 6, 23, 0.30), rgba(2, 6, 23, 0.72)), url(${backgroundImage})`,
                }}
            >
                <div
                    className="journey-banner"
                    style={{ backgroundImage: `url(${shinobiBanner})` }}
                >
                    {character && (
                        <div className="journey-live-stats">
                            <div className="stat-box">
                                <span>RANK</span>
                                <strong>{character.rankTitle}</strong>
                            </div>

                            <div className="stat-box">
                                <span>LVL</span>
                                <strong>{character.level}/100</strong>
                            </div>

                            <div className="stat-box">
                                <span>XP</span>
                                <strong>
                                    {character.level >= MAX_LEVEL
                                        ? "MAX"
                                        : `${character.xp}/${xpNeeded(character.level)}`}
                                </strong>
                            </div>

                            <div className="stat-box">
                                <span>RYO</span>
                                <strong>{character.ryo}</strong>
                            </div>
                            <div className="stat-box" style={{ color: "#ce93d8" }}>
                                <span>✦ SHARDS</span>
                                <strong>{character.fateShards}</strong>
                            </div>
                        </div>
                    )}
                </div>

                {screen === "start" && (
                    <StartScreen
                        onCreate={createPlayerAccount}
                        onLogin={loginPlayerAccount}
                        onAdmin={() => {
                            navigate(adminLoggedIn ? "adminPanel" : "adminLogin");
                        }}
                    />
                )}

                {screen === "adminLogin" && (
                    <AdminLogin
                        onLogin={async (account) => {
                            setAdminLoggedIn(true);
                            setAdminAccount(account);
                            setCurrentAccountName(account); // needed for save button + auto-save
                            const adminChar = createAdminCharacter(account);
                            setCharacter(adminChar);
                            setScreen("adminPanel");
                            // Restore any previously saved admin data (jutsus, events, pets, etc.)
                            const snap = await pullSaveFromServer(account);
                            if (snap) applyServerSnapshot(snap);
                        }}
                        setScreen={setScreen}
                    />
                )}

                {screen === "adminPanel" && character && (
                    <AdminPanel
                        character={character}
                        creatorItems={creatorItems}
                        setCreatorItems={setCreatorItems}
                        updateCharacter={setCharacter}
                        creatorJutsus={creatorJutsus}
                        setCreatorJutsus={setCreatorJutsus}
                        creatorAis={creatorAis}
                        setCreatorAis={setCreatorAis}
                        creatorEvents={creatorEvents}
                        setCreatorEvents={setCreatorEvents}
                        creatorMissions={creatorMissions}
                        setCreatorMissions={setCreatorMissions}
                        creatorRaids={creatorRaids}
                        setCreatorRaids={setCreatorRaids}
                        creatorCards={creatorCards}
                        setCreatorCards={setCreatorCards}
                        petEncounterVn={petEncounterVn}
                        setPetEncounterVn={setPetEncounterVn}
                        editablePets={editablePets}
                        setEditablePets={setEditablePets}
                        selectedPetId={selectedPetId}
                        setSelectedPetId={setSelectedPetId}
                        savedBloodlines={savedBloodlines}
                        setSavedBloodlines={setSavedBloodlines}
                        setAdminLoggedIn={setAdminLoggedIn}
                        setScreen={setScreen}
                        onSave={async () => {
                            if (!currentAccountName) return;
                            await pushSaveToServer(character, currentAccountName);
                        }}
                    />
                )}

                {activeTriggeredEvent && character && (
                    <TriggeredVisualNovel
                        event={activeTriggeredEvent}
                        character={character}
                        pageIndex={triggerPage}
                        lineIndex={triggerLine}
                        setPageIndex={setTriggerPage}
                        setLineIndex={setTriggerLine}
                        onCancel={() => setActiveTriggeredEvent(null)}
                        onComplete={() => completeTriggeredEvent(activeTriggeredEvent)}
                        setScreen={setScreen}
                        setCurrentBiome={setCurrentBiome}
                        setCurrentWeather={setCurrentWeather}
                        setPendingAiProfileId={setPendingAiProfileId}
                    />
                )}

                {!activeTriggeredEvent && screen === "villageLore" && character && (
                    <VillageLoreScreen
                        character={character}
                        onBack={() => {
                            setCharacter(null);
                            setScreen("start");
                        }}
                        onContinue={() => setScreen("village")}
                    />
                )}

                {!activeTriggeredEvent && screen === "village" && character && (
                    <Village
                        characterVillage={character.village}
                        setScreen={navigate}
                        onSave={async () => {
                            if (!currentAccountName) return;
                            await pushSaveToServer(character, currentAccountName);
                        }}
                    />
                )}
                {!activeTriggeredEvent && screen === "worldMap" && character && (
                    <WorldMap
                        key={worldMapKey}
                        setCurrentBiome={setCurrentBiome}
                        setScreen={navigate}
                        character={character}
                        updateCharacter={setCharacter}
                        creatorEvents={creatorEvents}
                        petEncounterVn={petEncounterVn}
                        editablePets={editablePets}
                        setPendingAiProfileId={setPendingAiProfileId}
                        setRaidBattleKind={setRaidBattleKind}
                        recordMissionExplore={recordMissionExplore}
                        playableAis={playableAis}
                        setCurrentWeather={setCurrentWeather}
                        playerRoster={playerRoster}
                        liveSectorPlayers={liveSectorPlayers}
                        setCurrentSector={setCurrentSector}
                        attackPlayer={async (opponent) => {
                            try {
                                await fetch('/api/player/attack', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ targetName: opponent.name, attacker: character }),
                                });
                            } catch { /* server unavailable */ }
                            setPendingAiProfileId("");
                            setRaidBattleKind("raidPlayer");
                            setPendingPvpOpponent(normalizeCharacter(opponent.character));
                            setCurrentSector(opponent.currentSector ?? currentSector);
                            setScreen("arena");
                        }}
                    />
                )}
                {!activeTriggeredEvent && screen === "sunscarFestival" && character && (
                    <SunscarFestival
                        character={character}
                        updateCharacter={setCharacter}
                        creatorCards={creatorCards}
                    />
                )}
                {!activeTriggeredEvent && screen === "centralHub" && character && (
                    <CentralHub
                        character={character}
                        updateCharacter={setCharacter}
                        setScreen={setScreen}
                        savedBloodlines={savedBloodlines}
                        setSavedBloodlines={setSavedBloodlines}
                        triggeredEvents={triggeredEvents}
                        setTriggeredEvents={setTriggeredEvents}
                        onStartEndlessBattle={startEndlessBattle}
                    />
                )}
                {!activeTriggeredEvent && screen === "storyHall" && character && <StoryHall character={character} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "storyBoss" && character && <StoryBoss character={character} updateCharacter={setCharacter} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "training" && character && <Training character={character} updateCharacter={setCharacter} activeTraining={activeTraining} setActiveTraining={setActiveTraining} />}
                {!activeTriggeredEvent && screen === "pets" && character && <PetYard character={character} updateCharacter={setCharacter} setScreen={navigate} />}
                {!activeTriggeredEvent && screen === "petArena" && character && <PetArena character={character} updateCharacter={setCharacter} playerRoster={playerRoster} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "jutsuTraining" && character && <JutsuTrainingHall character={character} updateCharacter={setCharacter} savedBloodlines={savedBloodlines} creatorJutsus={creatorJutsus} />}
                {!activeTriggeredEvent && screen === "missions" && character && <Missions character={character} updateCharacter={setCharacter} creatorAis={playableAis} creatorMissions={creatorMissions} acceptedMissionIds={acceptedMissionIds} setAcceptedMissionIds={setAcceptedMissionIds} missionProgress={missionProgress} setMissionProgress={setMissionProgress} setPendingAiProfileId={setPendingAiProfileId} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "townHall" && character && <TownHall character={character} updateCharacter={setCharacter} />}
                {!activeTriggeredEvent && screen === "clan" && character && <ClanHall character={character} updateCharacter={setCharacter} />}
                {!activeTriggeredEvent && screen === "bank" && character && <Bank character={character} updateCharacter={setCharacter} />}
                {!activeTriggeredEvent && screen === "shop" && character && <Shop character={character} updateCharacter={setCharacter} creatorItems={creatorItems} creatorCards={creatorCards} />}
                {!activeTriggeredEvent && screen === "grandMarketplace" && character && <GrandMarketplace character={character} updateCharacter={setCharacter} creatorItems={creatorItems} creatorCards={creatorCards} />}
                {!activeTriggeredEvent && screen === "shinobiTiles" && character && <ShinobiTiles character={character} updateCharacter={setCharacter} creatorCards={creatorCards} />}
                {!activeTriggeredEvent && screen === "hospital" && character && <Hospital character={character} updateCharacter={setCharacter} />}
                {!activeTriggeredEvent && screen === "cafeteria" && character && <Cafeteria character={character} updateCharacter={setCharacter} />}
                {!activeTriggeredEvent && screen === "profile" && character && (
                    <Profile
                        character={character}
                        updateCharacter={setCharacter}
                        savedBloodlines={savedBloodlines}
                        creatorJutsus={creatorJutsus}
                        creatorItems={creatorItems}
                    />
                )}
                {!activeTriggeredEvent && screen === "inventory" && character && (
                    <Inventory
                        character={character}
                        updateCharacter={setCharacter}
                        creatorItems={creatorItems}
                        creatorCards={creatorCards}
                    />
                )}

                {!activeTriggeredEvent && screen === "arena" && character && (
                    <Arena
                        key={arenaKey}
                        character={character}
                        updateCharacter={setCharacter}
                        savedBloodlines={savedBloodlines}
                        creatorJutsus={creatorJutsus}
                        creatorAis={playableAis}
                        pendingAiProfileId={pendingAiProfileId}
                        setPendingAiProfileId={setPendingAiProfileId}
                        currentBiome={currentBiome}
                        currentWeather={currentWeather}
                        playerRoster={playerRoster}
                        duelChallenges={duelChallenges}
                        setDuelChallenges={setDuelChallenges}
                        pendingPvpOpponent={pendingPvpOpponent}
                        setPendingPvpOpponent={setPendingPvpOpponent}
                        raidBattleKind={raidBattleKind}
                        setRaidBattleKind={setRaidBattleKind}
                        creatorItems={creatorItems}
                        setScreen={navigate}
                        endlessBattleActive={endlessBattleActive}
                        endlessBattleWave={endlessBattleWave}
                        onEndlessWin={handleEndlessWin}
                        onEndlessBattleEnd={endEndlessBattle}
                    />
                )}

                {!activeTriggeredEvent && screen === "bloodlineMaker" && (
                    <BloodlineMaker
                        savedBloodlines={savedBloodlines}
                        setSavedBloodlines={setSavedBloodlines}
                    />
                )}
            </main>
        </div>
    );
}

function LeftProfileCard({
    character,
    updateCharacter,
}: {
    character: Character;
    updateCharacter: (c: Character) => void;
}) {
    function uploadAvatar(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            updateCharacter({
                ...character,
                avatarImage: reader.result as string
            });
        };
        reader.readAsDataURL(file);
    }

    return (
        <aside className="left-profile-card">
            <label className={`left-profile-avatar ${getActiveAuraSphereBonuses(character).avatarAura ? "aura-sphere-avatar" : ""}`}>
                {character.avatarImage ? (
                    <img src={character.avatarImage} alt={character.name} />
                ) : (
                    character.name.slice(0, 2).toUpperCase()
                )}

                <input
                    type="file"
                    accept="image/*"
                    onChange={uploadAvatar}
                    style={{ display: "none" }}
                />
            </label>

            <div className="left-profile-name">{character.name}</div>
            <div className="left-profile-rank">{character.rankTitle}</div>
            <div className="left-profile-stat">HP {character.hp}/{character.maxHp}</div>
            <div className="left-profile-stat">Chakra {character.chakra}/{character.maxChakra}</div>
            <div className="left-profile-stat">Stamina {character.stamina}/{character.maxStamina}</div>
            <div className="left-profile-stat">Sector 40</div>
            <div className="left-profile-stat">Weather Clear Skies</div>

            {/* Currencies */}
            <div className="left-currencies">
                <div className="left-currency-row">
                    <span className="left-currency-icon">💴</span>
                    <span className="left-currency-label">Ryo</span>
                    <span className="left-currency-value">{character.ryo.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">🎖️</span>
                    <span className="left-currency-label">Honor Seals</span>
                    <span className="left-currency-value" style={{ color: "#facc15" }}>{character.honorSeals.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">🌫️</span>
                    <span className="left-currency-label">Aura Dust</span>
                    <span className="left-currency-value" style={{ color: "#fef3c7" }}>{character.auraDust.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">✦</span>
                    <span className="left-currency-label">Fate Shards</span>
                    <span className="left-currency-value" style={{ color: "#ce93d8" }}>{character.fateShards.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">🔮</span>
                    <span className="left-currency-label">Aura Stones</span>
                    <span className="left-currency-value" style={{ color: "#60a5fa" }}>{character.auraStones.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">🔱</span>
                    <span className="left-currency-label">Mythic Seals</span>
                    <span className="left-currency-value" style={{ color: "#fde047" }}>{character.mythicSeals.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">🦴</span>
                    <span className="left-currency-label">Bone Charms</span>
                    <span className="left-currency-value" style={{ color: "#94a3b8" }}>{character.boneCharms.toLocaleString()}</span>
                </div>
            </div>

            {/* XP bar */}
            <div className="left-xp-section">
                {character.level >= MAX_LEVEL ? (
                    <div className="left-xp-label">Lv {character.level} — MAX</div>
                ) : (
                    <>
                        <div className="left-xp-label">
                            Lv {character.level} &nbsp;·&nbsp; {character.xp} / {xpNeeded(character.level)} XP
                        </div>
                        <div className="left-xp-bar-track">
                            <div
                                className="left-xp-bar-fill"
                                style={{ width: `${Math.min(100, Math.round((character.xp / xpNeeded(character.level)) * 100))}%` }}
                            />
                        </div>
                        {character.xp >= xpNeeded(character.level) && (
                            <button
                                className="left-levelup-btn"
                                onClick={() => updateCharacter(gainXp(character, 0))}
                            >
                                ⬆ Level Up!
                            </button>
                        )}
                    </>
                )}
            </div>
        </aside>
    );
}

function SectorBanner() {
    return (
        <aside className="sector-banner-panel">
            <img src={sectorBanner} alt="Sector Banner" className="sector-banner-img" />
        </aside>
    );
}
const villageBiomes: Record<string, Biome> = {
    "Stormveil Village": "forest",
    "Ashen Leaf Village": "volcano",
    "Frostfang Village": "snow",
    "Moonshadow Village": "shadow",
};

function RightMenu({
    navigate,
    adminLoggedIn,
    resetGame,
    logoutPlayer,
    currentBiome,
    characterVillage,
    screen,
}: {
    navigate: (screen: Screen) => void;
    adminLoggedIn: boolean;
    resetGame: () => void;
    logoutPlayer: () => void;
    currentBiome: Biome;
    characterVillage: string;
    screen: Screen;
}) {
    const [menuOpen, setMenuOpen] = useState(true);
    const homeBiome = villageBiomes[characterVillage];
    const atHome = screen !== "worldMap" || currentBiome === homeBiome;

    return (
        <aside
            className={`right-menu-panel ${menuOpen ? "open" : "closed"}`}
            style={{
                backgroundImage: `url(${rightMenuBg})`,
            }}
        >
            <button onClick={() => setMenuOpen((open) => !open)}>
                {menuOpen ? "Hide Menu" : "Menu"}
            </button>

            {menuOpen && (
                <>
                    <h3>Main Menu</h3>

                    <div className="right-menu-buttons">
                        <button onClick={() => navigate("village")} disabled={!atHome} title={atHome ? undefined : `Travel to ${characterVillage} to enter`}>Village</button>
                        <button onClick={() => navigate("worldMap")}>Travel</button>
                        <button onClick={() => navigate("storyHall")}>Story</button>
                        <button onClick={() => navigate("profile")}>Character</button>
                        <button onClick={() => navigate("inventory")}>Inventory</button>
                        <button onClick={() => navigate("training")}>Stats</button>
                        <button onClick={() => navigate("jutsuTraining")}>Jutsu</button>
                        <button onClick={() => navigate("missions")}>Missions</button>
                        <button onClick={() => navigate("pets")}>Pets 🐾</button>
                        <button onClick={() => navigate("arena")}>Arena</button>
                        <button onClick={() => navigate("bloodlineMaker")}>Bloodline</button>
                        <button onClick={() => navigate(adminLoggedIn ? "adminPanel" : "adminLogin")}>Admin</button>
                        <button onClick={logoutPlayer}>Logout + Save</button>
                        <button className="danger-button" onClick={resetGame}>Reset</button>
                    </div>
                </>
            )}
        </aside>
    );
}
function StartScreen({ onCreate, onLogin, onAdmin }: { onCreate: (character: Character, password: string) => void; onLogin: (name: string, password: string) => void; onAdmin: () => void }) {
    const [loginName, setLoginName] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [loginStatus, setLoginStatus] = useState("");

    async function submitLogin() {
        if (loginName.trim().length < 2) return alert("Enter your player name.");
        if (!loginPassword) return alert("Enter your password.");
        setLoginStatus("Loading…");
        try {
            await onLogin(loginName.trim(), loginPassword);
        } finally {
            setLoginStatus("");
        }
    }

    return (
        <div className="start-grid">
            <CharacterCreator onCreate={onCreate} />
            <div className="card creator-card">
                <h2>Player Login</h2>
                <label>Name</label>
                <input value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder="Enter your shinobi name" />
                <label>Password</label>
                <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitLogin()} placeholder="Enter your password" />
                <button onClick={submitLogin} disabled={!!loginStatus}>{loginStatus || "Log Back In"}</button>
                <p className="hint" style={{ marginTop: 8 }}>Logging in automatically restores your full save including images.</p>
            </div>
            <div className="card creator-card admin-start-card">
                <h2>🛠️ Admin Mode</h2>
                <p>Create jutsus, world events, dialogue, and test your game instantly.</p>
                <button className="admin-button" onClick={onAdmin}>Enter Admin Mode</button>
                <p className="hint">Password: admin</p>
            </div>
        </div>
    );
}
function VillageLoreScreen({
    character,
    onBack,
    onContinue,
}: {
    character: Character;
    onBack: () => void;
    onContinue: () => void;
}) {
    const loreData = villageLore[character.village] ?? {
        icon: "🥷",
        theme: "The Shinobi Path",
        lore: "Your shinobi journey begins here.",
    };

    const [shownText, setShownText] = useState("");

    useEffect(() => {
        setShownText("");

        let index = 0;
        const timer = setInterval(() => {
            index++;
            setShownText(loreData.lore.slice(0, index));

            if (index >= loreData.lore.length) {
                clearInterval(timer);
            }
        }, 12);
        return () => clearInterval(timer);
    }, [character.village, loreData.lore]);

    return (
        <div className="card cinematic-card village-lore-screen">
            <h1>{loreData.icon} {character.village}</h1>
            <h3><em>{loreData.theme}</em></h3>

            <div className="village-lore-text">
                {shownText.split("\n").map((line, index) => (
                    <p key={index}>{line}</p>
                ))}
            </div>

            <div className="menu">
                <button onClick={onBack}>Choose Another Village</button>
                <button onClick={onContinue} className="admin-button">
                    Begin Journey
                </button>
            </div>
        </div>
    );
}
function TriggeredVisualNovel({ event, character, pageIndex, lineIndex, setPageIndex, setLineIndex, onCancel, onComplete, setScreen, setCurrentBiome, setCurrentWeather, setPendingAiProfileId }: { event: CreatorEvent; character: Character; pageIndex: number; lineIndex: number; setPageIndex: (index: number | ((index: number) => number)) => void; setLineIndex: (index: number | ((index: number) => number)) => void; onCancel: () => void; onComplete: () => void; setScreen: (screen: Screen) => void; setCurrentBiome: (biome: Biome) => void; setCurrentWeather: (weather: WeatherType) => void; setPendingAiProfileId: (id: string) => void }) {
    const pages = event.vnPages && event.vnPages.length > 0 ? event.vnPages : [{ title: event.vnTitle || event.name, scene: event.vnScene || "", speaker: event.vnSpeaker || "Narrator", dialogue: event.dialogue, image: event.image }];
    const page = pages[Math.min(pageIndex, pages.length - 1)];
    const pageDialogue = page.dialogue.length > 0 ? page.dialogue : event.dialogue;
    const activeLine = pageDialogue[lineIndex] ?? pageDialogue[0] ?? page.scene ?? "The scene begins.";
    const splitLine = activeLine.includes(":") ? activeLine.split(":") : [page.speaker || event.vnSpeaker || "Narrator", activeLine];
    const speaker = splitLine[0].trim();
    const spoken = splitLine.slice(1).join(":").trim() || activeLine;
    const initials = speaker === "Narrator" ? "..." : speaker.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    const pageImage = page.image || event.image;
    const canBack = lineIndex > 0 || pageIndex > 0;
    const isLastLine = pageIndex === pages.length - 1 && lineIndex >= pageDialogue.length - 1;
    const pageChoices = page.choices?.filter((c) => c.text);
    const isAtChoicePoint = lineIndex >= pageDialogue.length - 1 && !!pageChoices?.length;
    const [showFinale, setShowFinale] = useState(false);
    const [pendingChoice, setPendingChoice] = useState<{ conclusion: string; nextPage: number } | null>(null);
    const isAuraSphereEvent = event.id === AURA_SPHERE_VN_ID;
    function previousLine() { if (lineIndex > 0) return setLineIndex((index) => index - 1); if (pageIndex > 0) { const previousPage = pages[pageIndex - 1]; setPageIndex((index) => index - 1); setLineIndex(Math.max(0, ((previousPage.dialogue.length || 1) - 1))); } }
    function nextLine() { if (isAtChoicePoint) return; if (lineIndex < pageDialogue.length - 1) return setLineIndex((index) => index + 1); if (pageIndex < pages.length - 1) { setPageIndex((index) => index + 1); setLineIndex(0); return; } setShowFinale(true); }
    function chooseOption(choice: { text: string; nextPage: number; conclusion?: string }) {
        const target = Math.max(0, Math.min(pages.length - 1, choice.nextPage));
        if (choice.conclusion?.trim()) { setPendingChoice({ conclusion: choice.conclusion.trim(), nextPage: target }); }
        else { setPageIndex(target); setLineIndex(0); }
    }
    function confirmPendingChoice() { if (!pendingChoice) return; setPageIndex(pendingChoice.nextPage); setLineIndex(0); setPendingChoice(null); }
    if (showFinale) return (
        <div className="card cinematic-card vn-finale-panel">
            <div className="vn-finale-header">
                <p className="act-label">SCENE COMPLETE</p>
                <h2>{event.name}</h2>
            </div>
            <div className="vn-finale-body">
                <p className="vn-scene-card">
                    {isAuraSphereEvent
                        ? "The elder places the Aura Sphere in your hands. It waits in your inventory until you equip it in your aura slot."
                        : <>The scene fades — a shinobi challenger steps from the shadows of <strong>{biomeLabel(event.biome)}</strong>. The fight is not over.</>}
                </p>
            </div>
            <div className="menu">
                {!isAuraSphereEvent && (
                    <button className="admin-button" onClick={() => { setPendingAiProfileId(event.aiProfileId ?? ""); setCurrentBiome(event.biome); setCurrentWeather(weatherForBiome(event.biome)); setScreen("arena"); onCancel(); }}>
                        Enter Battle — {biomeLabel(event.biome)}
                    </button>
                )}
                <button onClick={onComplete}>{isAuraSphereEvent ? "Claim Aura Sphere" : "Claim Reward & Skip Fight"}</button>
            </div>
            <div className="vn-reward-strip">
                <span>{isAuraSphereEvent ? "Reward: Aura Sphere item" : `Reward: ${rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards)}`}</span>
            </div>
        </div>
    );
    return (
        <div className="card cinematic-card">
            <button onClick={onCancel}>Skip Scene</button>
            <div className="visual-novel admin-vn-play">
                <div className="vn-header">
                    <div>
                        <p className="act-label">TRIGGERED STORY EVENT</p>
                        <h2>{page.title || event.vnTitle || event.name}</h2>
                    </div>
                    <div className="vn-progress">Page {pageIndex + 1}/{pages.length} | Line {lineIndex + 1}/{Math.max(1, pageDialogue.length)}</div>
                </div>
                <div className={"vn-stage vn-biome-" + event.biome + (pageImage ? " vn-has-image" : "")} style={pageImage ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${pageImage})` } : undefined}>
                    <div className="vn-backdrop"><span className="vn-village-silhouette"></span></div>
                    <div className="vn-character mentor-character">{initials}</div>
                    <div className="vn-character hero-character">{character.name.slice(0, 2).toUpperCase()}</div>
                    <div className="vn-scene-card">{page.scene || event.vnScene || "An event interrupts your path."}</div>
                    <div className="vn-dialogue">
                        <div className="vn-speaker">{speaker}</div>
                        <p>{spoken}</p>
                        {pendingChoice ? (
                            <div className="vn-conclusion">
                                <p className="vn-conclusion-text">{pendingChoice.conclusion}</p>
                                <div className="vn-controls">
                                    <button onClick={confirmPendingChoice}>Continue</button>
                                </div>
                            </div>
                        ) : isAtChoicePoint ? (
                            <div className="vn-choices">
                                {pageChoices!.map((choice, i) => (
                                    <button key={i} className="vn-choice-btn" onClick={() => chooseOption(choice)}>
                                        {choice.text}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="vn-controls">
                                <button disabled={!canBack} onClick={previousLine}>Back</button>
                                <button onClick={nextLine}>{isLastLine ? "Begin Battle" : "Next"}</button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="vn-choice-row">
                    <button onClick={() => { setPageIndex(0); setLineIndex(0); }}>Replay Scene</button>
                    <button onClick={() => { setPendingAiProfileId(event.aiProfileId ?? ""); setCurrentBiome(event.biome); setCurrentWeather(weatherForBiome(event.biome)); setScreen("arena"); onCancel(); }}>Battle in {biomeLabel(event.biome)}</button>
                    <button onClick={onComplete}>Claim Reward + Continue</button>
                </div>
                <div className="vn-reward-strip">
                    <span>Trigger: {event.trigger === "firstBattleArena" ? "First Battle Arena click" : "First Village exit"}</span>
                    <span>Reward: {rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards)}</span>
                </div>
            </div>
        </div>
    );
}

function CharacterCreator({ onCreate }: { onCreate: (character: Character, password: string) => void }) {
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [village, setVillage] = useState(villages[0]);
    const [bloodline, setBloodline] = useState(starterBloodlines[0]);

    function submitCharacter() {
        if (name.trim().length < 2) return alert("Enter a ninja name first.");
        if (password.length < 4) return alert("Create a password with at least 4 characters.");
        if (password !== confirmPassword) return alert("Passwords do not match.");
        onCreate(createCharacter(name.trim(), village, starterBloodlineOffense[bloodline] ?? "Ninjutsu", bloodline), password);
    }

    return (
        <div className="card creator-card">
            <h2>Character Creator</h2>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your shinobi name" />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a login password" />
            <label>Confirm Password</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Retype password" />
            <label>Village</label>
            <select value={village} onChange={(e) => setVillage(e.target.value)}>{villages.map((v) => <option key={v}>{v}</option>)}</select>
            <label>Starter Bloodline</label>
            <select value={bloodline} onChange={(e) => setBloodline(e.target.value)}>{starterBloodlines.map((b) => <option key={b} value={b}>{b} ({starterBloodlineOffense[b]})</option>)}</select>
            <button onClick={submitCharacter}>Begin Your Shinobi Path</button>
        </div>
    );
}

function AdminLogin({ onLogin, setScreen }: { onLogin: (account: AdminAccount) => void; setScreen: (screen: Screen) => void }) {
    const [password, setPassword] = useState("");
    function submit() {
        const normalized = password.trim().toLowerCase();
        if (normalized === "admin1") return onLogin("Admin 1");
        if (normalized === "admin2") return onLogin("Admin 2");
        return alert("Wrong password. Use: admin1 or admin2");
    }
    return (
        <div className="card creator-card">
            <h2>Admin Login</h2>
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="admin" />
            <div className="menu">
                <button onClick={submit}>Login</button>
                <button onClick={() => setScreen("start")}>Back</button>
            </div>
            <p className="hint">Passwords: admin1 or admin2</p>
        </div>
    );
}

function PetYard({ character, updateCharacter, setScreen }: { character: Character; updateCharacter: (c: Character) => void; setScreen: (s: Screen) => void }) {
    const [selectedPetId, setSelectedPetId] = useState(character.pets[0]?.id ?? "");
    const [trainingType, setTrainingType] = useState<PetTrainingType>("strength");
    const [trainingDuration, setTrainingDuration] = useState(petTrainingDurations[0].ms);
    const [tick, setTick] = useState(0);
    const [petHeartBurst, setPetHeartBurst] = useState(0);
    const selectedPet = character.pets.find((p) => p.id === selectedPetId) ?? character.pets[0] ?? null;
    const petXpBonus = getPetXpBonus(character);

    useEffect(() => {
        const hasActivePetTraining = character.pets.some((p) => p.training && Date.now() < p.training.endsAt);
        if (!hasActivePetTraining) return;
        const id = setInterval(() => setTick((t) => t + 1), 1000);
        return () => clearInterval(id);
    }, [character.pets, tick]);

    function startTraining() {
        if (!selectedPet) return;
        if (selectedPet.training && Date.now() < selectedPet.training.endsAt) return alert(`${selectedPet.name} is already training.`);
        updateCharacter({
            ...character,
            pets: character.pets.map((p) => p.id === selectedPet.id ? { ...p, training: { type: trainingType, endsAt: Date.now() + trainingDuration } } : p),
        });
    }

    function collectTraining() {
        if (!selectedPet?.training) return;
        if (Date.now() < selectedPet.training.endsAt) {
            return alert(`${selectedPet.name} needs ${formatPetTimer(selectedPet.training.endsAt - Date.now())} more.`);
        }
        const completedBase = collectPetTraining(selectedPet);
        const bonusXp = selectedPet.training.type === "bond" ? Math.max(0, boostAmount(completedBase.xp - selectedPet.xp, petXpBonus) - (completedBase.xp - selectedPet.xp)) : 0;
        const completed = selectedPet.training.type === "bond"
            ? gainPetXp({ ...completedBase, xp: selectedPet.xp }, completedBase.xp - selectedPet.xp + bonusXp)
            : completedBase;
        updateCharacter({ ...character, pets: character.pets.map((p) => p.id === selectedPet.id ? completed : p) });
        alert(`${selectedPet.name} completed ${selectedPet.training.type} training!${bonusXp > 0 ? ` +${bonusXp} bonus pet XP.` : " Stats improved."}`);
    }

    function removeInventoryItem(itemId: string) {
        let removed = false;
        return character.inventory.filter((entry) => {
            if (!removed && entry === itemId) {
                removed = true;
                return false;
            }
            return true;
        });
    }

    function inventoryCount(itemId: string) {
        return character.inventory.filter((entry) => entry === itemId).length;
    }

    function petSelectedPet() {
        if (!selectedPet) return;
        setPetHeartBurst(Date.now());
    }

    function feedPet(treat: typeof petFeedItems[number]) {
        if (!selectedPet) return;
        if (!character.inventory.includes(treat.id)) {
            return alert(`You need ${treat.name} to feed ${selectedPet.name}.`);
        }

        const fedPet = gainPetXp(selectedPet, treat.xp);
        updateCharacter({
            ...character,
            inventory: removeInventoryItem(treat.id),
            pets: character.pets.map((p) => p.id === selectedPet.id ? fedPet : p),
        });
        alert(`${selectedPet.name} ate ${treat.name} and gained ${treat.xp} XP.${fedPet.level > selectedPet.level ? ` Level ${fedPet.level}!` : ""}`);
    }

    function releasePet() {
        if (!selectedPet) return;
        if (!confirm(`Release ${selectedPet.name}? This cannot be undone.`)) return;
        const updatedPets = character.pets.filter((p) => p.id !== selectedPet.id);
        updateCharacter({
            ...character,
            pets: updatedPets,
            activePetId: character.activePetId === selectedPet.id ? updatedPets[0]?.id : character.activePetId,
        });
        setSelectedPetId(updatedPets[0]?.id ?? "");
    }

    return (
        <div className="pet-yard-screen">
            <div className="pet-yard-overlay">
                <div className="pet-yard-header">
                    <button className="back-btn" onClick={() => setScreen("village")}>← Village</button>
                    <div>
                        <h2>Pet Yard</h2>
                        <p className="hint">{character.pets.length}/5 pets · Town Hall Pet XP Bonus: {petXpBonus.toFixed(2)}%</p>
                    </div>
                    {character.activePetId && (
                        <p className="hint">Active: {character.pets.find((p) => p.id === character.activePetId)?.name ?? "—"}</p>
                    )}
                </div>

                <div className="pet-slots-row">
                    {Array.from({ length: 5 }, (_, i) => {
                        const pet = character.pets[i];
                        return (
                            <div
                                key={i}
                                className={`pet-slot-card${pet ? (selectedPet?.id === pet.id ? " pet-selected" : "") : " pet-empty"}${character.activePetId === pet?.id ? " pet-active" : ""}`}
                                onClick={() => pet && setSelectedPetId(pet.id)}
                            >
                                {pet ? (
                                    <>
                                        <div className="pet-slot-avatar">
                                            {pet.image ? <img src={pet.image} alt={pet.name} /> : <span className="pet-initials">{pet.name.slice(0, 2).toUpperCase()}</span>}
                                        </div>
                                        <p className="pet-slot-name">{pet.name}</p>
                                        <span className={`pet-rarity-tag rarity-${pet.rarity}`}>{pet.rarity}</span>
                                        {pet.trait && <span className="pet-trait-tag">{pet.trait}</span>}
                                        {character.activePetId === pet.id && <span className="pet-active-tag">Active</span>}
                                        {pet.training && Date.now() < pet.training.endsAt && (
                                            <span className="pet-training-tag">⏱ {formatPetTimer(pet.training.endsAt - Date.now())}</span>
                                        )}
                                        {pet.training && Date.now() >= pet.training.endsAt && (
                                            <span className="pet-ready-tag">✓ Ready</span>
                                        )}
                                    </>
                                ) : (
                                    <span className="pet-empty-label">Empty</span>
                                )}
                            </div>
                        );
                    })}
                </div>

                {selectedPet ? (
                    <div className="pet-detail-panel">
                        <div className="pet-detail-left pet-profile-panel">
                            <div className="pet-detail-avatar pet-heart-anchor">
                                {selectedPet.image ? <img src={selectedPet.image} alt={selectedPet.name} /> : <span className="pet-detail-initials">{selectedPet.name.slice(0, 2).toUpperCase()}</span>}
                                {petHeartBurst > 0 && <span key={petHeartBurst} className="pet-heart-pop">♥</span>}
                            </div>
                            <h3>{selectedPet.name}</h3>
                            <p>Level {selectedPet.level} | {selectedPet.rarity}</p>
                            <p className="pet-xp-line">
                                XP {selectedPet.level >= selectedPet.maxLevel ? "MAX" : `${selectedPet.xp}/${petXpNeeded(selectedPet.level)}`}
                            </p>
                            <div className="pet-stats-grid">
                                <span>❤️ HP: {selectedPet.hp}</span>
                                <span>⚔️ ATK: {selectedPet.attack}</span>
                                <span>🛡️ DEF: {selectedPet.defense}</span>
                                <span>💨 SPD: {selectedPet.speed}</span>
                            </div>
                            {selectedPet.description && <p className="pet-description">{selectedPet.description}</p>}
                            <div className="pet-care-actions">
                                <button onClick={petSelectedPet}>Pet</button>
                            </div>
                            <section className="pet-feed-panel">
                                <h4>Feed</h4>
                                <div className="pet-feed-grid">
                                    {petFeedItems.map((treat) => {
                                        const count = inventoryCount(treat.id);
                                        return (
                                            <button key={treat.id} onClick={() => feedPet(treat)} disabled={count <= 0}>
                                                <strong>{treat.name}</strong>
                                                <span>+{treat.xp} XP | Owned {count}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                            <div className="menu">
                                <button onClick={() => updateCharacter({ ...character, activePetId: selectedPet.id })}>
                                    {character.activePetId === selectedPet.id ? "✓ Active Pet" : "Set as Active"}
                                </button>
                                <button className="danger-button" onClick={releasePet}>Release</button>
                            </div>
                        </div>

                        <div className="pet-training-panel">
                            <h4>Training</h4>
                            {selectedPet.training && Date.now() < selectedPet.training.endsAt ? (
                                <div className="training-in-progress">
                                    <p>📋 {petTrainingOptions.find((o) => o.type === selectedPet.training?.type)?.label}</p>
                                    <p className="training-timer">{formatPetTimer(selectedPet.training.endsAt - Date.now())} remaining</p>
                                </div>
                            ) : selectedPet.training ? (
                                <div className="training-complete">
                                    <p>✓ {petTrainingOptions.find((o) => o.type === selectedPet.training?.type)?.label} complete!</p>
                                    <button className="admin-button" onClick={collectTraining}>Collect Results</button>
                                </div>
                            ) : (
                                <>
                                    <label>Training Type</label>
                                    <select value={trainingType} onChange={(e) => setTrainingType(e.target.value as PetTrainingType)}>
                                        {petTrainingOptions.map((opt) => (
                                            <option key={opt.type} value={opt.type}>{opt.label} — {opt.desc}</option>
                                        ))}
                                    </select>
                                    <label>Duration</label>
                                    <select value={trainingDuration} onChange={(e) => setTrainingDuration(Number(e.target.value))}>
                                        {petTrainingDurations.map((d) => (
                                            <option key={d.ms} value={d.ms}>{d.label}</option>
                                        ))}
                                    </select>
                                    <button className="admin-button" onClick={startTraining}>Start Training</button>
                                </>
                            )}
                        </div>

                        <div className="pet-info-panel">
                            <section className="pet-trait-display">
                                <h4>Trait</h4>
                                {selectedPet.trait ? (
                                    <>
                                        <strong>{selectedPet.trait}</strong>
                                        <p>{petTraitDescriptions[selectedPet.trait]}</p>
                                    </>
                                ) : (
                                    <p>No trait discovered.</p>
                                )}
                            </section>

                            <section className="pet-jutsu-panel">
                                <h4>Pet Jutsus</h4>
                                {selectedPet.jutsus.length === 0 ? (
                                    <p className="hint">This pet has no jutsu yet.</p>
                                ) : selectedPet.jutsus.map((jutsu, i) => (
                                    <div key={i} className="pet-jutsu-row">
                                        <strong>{jutsu.name}</strong>
                                        <span>Power {jutsu.power}</span>
                                        <span>Cooldown {jutsu.cooldown}</span>
                                    </div>
                                ))}
                            </section>
                        </div>
                    </div>
                ) : (
                    <div className="pet-empty-state">
                        <p>You haven't captured any pets yet.</p>
                        <p>Explore the World Map to encounter and befriend pets!</p>
                        <button onClick={() => setScreen("worldMap")}>Go to World Map</button>
                    </div>
                )}
            </div>
        </div>
    );
}

type PetArenaOpponent = {
    owner: string;
    pet: Pet;
};

const genericPetArenaOpponents: PetArenaOpponent[] = [
    {
        owner: "Central Pet Arena AI",
        pet: applyPetTraitBonuses({
            id: "generic-ai-pet-sparrow",
            name: "Arena Sparrow",
            rarity: "standard",
            level: 8,
            xp: 0,
            maxLevel: 50,
            hp: 130,
            attack: 24,
            defense: 16,
            speed: 30,
            description: "A quick generic arena pet trained for beginner matches.",
            jutsus: [
                { name: "Peck Rush", power: 24, cooldown: 1, currentCooldown: 0, kind: "damage" },
                { name: "Wing Guard", power: 14, cooldown: 3, currentCooldown: 0, kind: "buff" },
            ],
            unlockedForPve: true,
            trait: "Swift",
        }, "Swift"),
    },
    {
        owner: "Central Pet Arena AI",
        pet: applyPetTraitBonuses({
            id: "generic-ai-pet-guardhound",
            name: "Arena Guardhound",
            rarity: "rare",
            level: 18,
            xp: 0,
            maxLevel: 70,
            hp: 240,
            attack: 38,
            defense: 30,
            speed: 22,
            description: "A sturdy AI pet that tests defensive builds.",
            jutsus: [
                { name: "Iron Bite", power: 38, cooldown: 2, currentCooldown: 0, kind: "damage" },
                { name: "Guard Stance", power: 24, cooldown: 3, currentCooldown: 0, kind: "buff" },
            ],
            unlockedForPve: true,
            trait: "Guardian",
        }, "Guardian"),
    },
    {
        owner: "Central Pet Arena AI",
        pet: applyPetTraitBonuses({
            id: "generic-ai-pet-emberlynx",
            name: "Arena Emberlynx",
            rarity: "legendary",
            level: 35,
            xp: 0,
            maxLevel: 90,
            hp: 360,
            attack: 62,
            defense: 34,
            speed: 48,
            description: "A high-pressure AI pet with aggressive jutsu timing.",
            jutsus: [
                { name: "Ember Pounce", power: 62, cooldown: 2, currentCooldown: 0, kind: "damage" },
                { name: "Predator Focus", power: 32, cooldown: 4, currentCooldown: 0, kind: "buff" },
            ],
            unlockedForPve: true,
            trait: "Aggressive",
        }, "Aggressive"),
    },
];

type PetBattleFighter = {
    owner: string;
    pet: Pet;
    hp: number;
    attackBuff: number;
    defenseBuff: number;
    cooldowns: Record<string, number>;
};

type PetArenaFrame = {
    round: number;
    message: string;
    playerHp: number;
    enemyHp: number;
    playerPos: number;
    enemyPos: number;
    actor: "player" | "enemy" | "system";
    actionKind?: "damage" | "buff" | "basic" | "result";
};

function petAiRules(pet: Pet): AiRule[] {
    const buffJutsu = pet.jutsus.find((jutsu) => jutsu.kind === "buff");
    const damageJutsu = [...pet.jutsus].filter((jutsu) => jutsu.kind === "damage").sort((a, b) => b.power - a.power)[0];
    const rules: AiRule[] = [];
    if (buffJutsu) rules.push({ id: makeId(), condition: "hp_lower_than", value: 55, action: "use_specific_jutsu", jutsuId: buffJutsu.name });
    if (damageJutsu) rules.push({ id: makeId(), condition: "specific_round", value: 1, action: "use_specific_jutsu", jutsuId: damageJutsu.name });
    rules.push({ id: makeId(), condition: "always", value: 0, action: "use_highest_power_jutsu" });
    rules.push({ id: makeId(), condition: "always", value: 0, action: "use_basic_attack" });
    return rules;
}

function petRuleMatches(rule: AiRule, round: number, fighter: PetBattleFighter) {
    if (rule.condition === "always") return true;
    if (rule.condition === "specific_round") return round === rule.value;
    if (rule.condition === "hp_lower_than") return (fighter.hp / Math.max(1, fighter.pet.hp)) * 100 < rule.value;
    if (rule.condition === "distance_lower_than") return true;
    if (rule.condition === "distance_higher_than") return false;
    return false;
}

function availablePetJutsus(fighter: PetBattleFighter) {
    return fighter.pet.jutsus.filter((jutsu) => (fighter.cooldowns[jutsu.name] ?? 0) <= 0);
}

function choosePetJutsu(rule: AiRule, fighter: PetBattleFighter) {
    const ready = availablePetJutsus(fighter);
    if (rule.action === "use_specific_jutsu") {
        return ready.find((jutsu) => jutsu.name === rule.jutsuId);
    }
    if (rule.action === "use_highest_power_jutsu") {
        return [...ready].sort((a, b) => b.power - a.power || b.cooldown - a.cooldown)[0];
    }
    return undefined;
}

function petBasicDamage(attacker: PetBattleFighter, defender: PetBattleFighter) {
    return Math.max(1, Math.floor(attacker.pet.attack + attacker.attackBuff - (defender.pet.defense + defender.defenseBuff) * 0.45));
}

function runPetArenaBattle(playerPet: Pet, opponentPet: Pet, opponentOwner: string) {
    let player: PetBattleFighter = { owner: "You", pet: playerPet, hp: playerPet.hp, attackBuff: 0, defenseBuff: 0, cooldowns: {} };
    let enemy: PetBattleFighter = { owner: opponentOwner, pet: opponentPet, hp: opponentPet.hp, attackBuff: 0, defenseBuff: 0, cooldowns: {} };
    const logs: string[] = [`${player.pet.name} enters against ${enemy.owner}'s ${enemy.pet.name}.`];
    const frames: PetArenaFrame[] = [];
    const rules = {
        player: petAiRules(player.pet),
        enemy: petAiRules(enemy.pet),
    };
    const basePlayerPos = 15;
    const baseEnemyPos = 19;

    function pushFrame(round: number, message: string, actor: PetArenaFrame["actor"], actionKind?: PetArenaFrame["actionKind"]) {
        frames.push({
            round,
            message,
            playerHp: player.hp,
            enemyHp: enemy.hp,
            playerPos: actor === "player" && (actionKind === "damage" || actionKind === "basic") ? 17 : basePlayerPos,
            enemyPos: actor === "enemy" && (actionKind === "damage" || actionKind === "basic") ? 17 : baseEnemyPos,
            actor,
            actionKind,
        });
    }

    pushFrame(0, logs[0], "system");

    function tick(fighter: PetBattleFighter): PetBattleFighter {
        return {
            ...fighter,
            attackBuff: Math.max(0, fighter.attackBuff - 1),
            defenseBuff: Math.max(0, fighter.defenseBuff - 1),
            cooldowns: Object.fromEntries(Object.entries(fighter.cooldowns).map(([name, value]) => [name, Math.max(0, value - 1)])),
        };
    }

    function act(actor: PetBattleFighter, target: PetBattleFighter, actorRules: AiRule[], round: number): [PetBattleFighter, PetBattleFighter] {
        const actorSide: PetArenaFrame["actor"] = actor.owner === "You" ? "player" : "enemy";
        const matchedRules = actorRules.filter((rule) => petRuleMatches(rule, round, actor));
        for (const rule of matchedRules) {
            if (rule.action === "move_towards_opponent") continue;
            const jutsu = choosePetJutsu(rule, actor);
            if (!jutsu && rule.action !== "use_basic_attack") continue;

            if (jutsu) {
                const nextActor = {
                    ...actor,
                    cooldowns: { ...actor.cooldowns, [jutsu.name]: Math.max(1, jutsu.cooldown) },
                };

                if (jutsu.kind === "buff") {
                    const buffed = {
                        ...nextActor,
                        attackBuff: nextActor.attackBuff + Math.max(1, Math.floor(jutsu.power / 2)),
                        defenseBuff: nextActor.defenseBuff + Math.max(1, Math.floor(jutsu.power / 3)),
                    };
                    const message = `Round ${round}: ${actor.pet.name} uses ${jutsu.name}, gaining +${Math.max(1, Math.floor(jutsu.power / 2))} ATK and +${Math.max(1, Math.floor(jutsu.power / 3))} DEF.`;
                    logs.push(message);
                    if (actorSide === "player") player = buffed; else enemy = buffed;
                    pushFrame(round, message, actorSide, "buff");
                    return [buffed, target];
                }

                const damage = Math.max(1, Math.floor(actor.pet.attack + actor.attackBuff + jutsu.power - (target.pet.defense + target.defenseBuff) * 0.5));
                const damagedTarget = { ...target, hp: Math.max(0, target.hp - damage) };
                const message = `Round ${round}: ${actor.pet.name} uses ${jutsu.name} for ${damage} damage.`;
                logs.push(message);
                if (actorSide === "player") {
                    player = nextActor;
                    enemy = damagedTarget;
                } else {
                    enemy = nextActor;
                    player = damagedTarget;
                }
                pushFrame(round, message, actorSide, "damage");
                return [nextActor, damagedTarget];
            }

            const damage = petBasicDamage(actor, target);
            const damagedTarget = { ...target, hp: Math.max(0, target.hp - damage) };
            const message = `Round ${round}: ${actor.pet.name} basic attacks for ${damage} damage.`;
            logs.push(message);
            if (actorSide === "player") enemy = damagedTarget; else player = damagedTarget;
            pushFrame(round, message, actorSide, "basic");
            return [actor, damagedTarget];
        }

        const damage = petBasicDamage(actor, target);
        const damagedTarget = { ...target, hp: Math.max(0, target.hp - damage) };
        const message = `Round ${round}: ${actor.pet.name} basic attacks for ${damage} damage.`;
        logs.push(message);
        if (actorSide === "player") enemy = damagedTarget; else player = damagedTarget;
        pushFrame(round, message, actorSide, "basic");
        return [actor, damagedTarget];
    }

    for (let round = 1; round <= 20 && player.hp > 0 && enemy.hp > 0; round += 1) {
        player = tick(player);
        enemy = tick(enemy);
        const playerFirst = player.pet.speed >= enemy.pet.speed;
        if (playerFirst) {
            [player, enemy] = act(player, enemy, rules.player, round);
            if (enemy.hp <= 0) break;
            [enemy, player] = act(enemy, player, rules.enemy, round);
        } else {
            [enemy, player] = act(enemy, player, rules.enemy, round);
            if (player.hp <= 0) break;
            [player, enemy] = act(player, enemy, rules.player, round);
        }
        const roundMessage = `Round ${round} result: ${player.pet.name} ${player.hp}/${player.pet.hp} HP, ${enemy.pet.name} ${enemy.hp}/${enemy.pet.hp} HP.`;
        logs.push(roundMessage);
        pushFrame(round, roundMessage, "system");
    }

    const playerWon = player.hp > 0 && enemy.hp <= 0;
    const enemyWon = enemy.hp > 0 && player.hp <= 0;
    const result = playerWon ? "win" : enemyWon ? "loss" : player.hp >= enemy.hp ? "win" : "loss";
    const finalMessage = result === "win" ? `${player.pet.name} wins the Pet Arena match.` : `${enemy.pet.name} wins the Pet Arena match.`;
    logs.push(finalMessage);
    pushFrame(21, finalMessage, "system", "result");
    return { result, player, enemy, logs, frames };
}

function PetArena({ character, updateCharacter, playerRoster, setScreen }: { character: Character; updateCharacter: (character: Character) => void; playerRoster: PlayerRecord[]; setScreen: (screen: Screen) => void }) {
    const [selectedPetId, setSelectedPetId] = useState(character.activePetId ?? character.pets[0]?.id ?? "");
    const [opponentMode, setOpponentMode] = useState<"player" | "ai">("player");
    const playerOpponentPets: PetArenaOpponent[] = playerRoster
        .filter((player) => player.name !== character.name)
        .flatMap((player) => player.character.pets.map((pet) => ({ owner: player.name, pet })));
    const opponentPets: PetArenaOpponent[] = opponentMode === "player" ? playerOpponentPets : genericPetArenaOpponents;
    const [selectedOpponentKey, setSelectedOpponentKey] = useState("");
    const selectedPet = character.pets.find((pet) => pet.id === selectedPetId) ?? character.pets[0];
    const selectedOpponent = opponentPets.find((entry) => `${entry.owner}:${entry.pet.id}` === selectedOpponentKey) ?? opponentPets[0];
    const [battleLog, setBattleLog] = useState<string[]>([]);
    const [battleFrames, setBattleFrames] = useState<PetArenaFrame[]>([]);
    const [frameIndex, setFrameIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [result, setResult] = useState("");
    const currentFrame = battleFrames[frameIndex];
    const showResult = currentFrame?.actionKind === "result";
    const visibleLog = battleFrames.length ? battleFrames.slice(0, frameIndex + 1).map((frame) => frame.message) : battleLog;

    useEffect(() => {
        if (opponentPets.length === 0) {
            if (selectedOpponentKey) setSelectedOpponentKey("");
            return;
        }
        const keyStillExists = opponentPets.some((entry) => `${entry.owner}:${entry.pet.id}` === selectedOpponentKey);
        if (!selectedOpponentKey || !keyStillExists) setSelectedOpponentKey(`${opponentPets[0].owner}:${opponentPets[0].pet.id}`);
    }, [selectedOpponentKey, opponentMode, opponentPets[0]?.owner, opponentPets[0]?.pet.id, opponentPets.length]);

    useEffect(() => {
        if (!isPlaying) return;
        if (frameIndex >= battleFrames.length - 1) {
            setIsPlaying(false);
            return;
        }
        const timer = window.setTimeout(() => setFrameIndex((index) => Math.min(index + 1, battleFrames.length - 1)), 950);
        return () => window.clearTimeout(timer);
    }, [battleFrames.length, frameIndex, isPlaying]);

    function startBattle() {
        if (!selectedPet) return alert("Choose one of your pets first.");
        if (!selectedOpponent) {
            return alert(opponentMode === "player"
                ? "No player pets found. Choose Fight AI or have another player with pets in the roster."
                : "No AI pets found.");
        }
        const battle = runPetArenaBattle(selectedPet, selectedOpponent.pet, selectedOpponent.owner);
        setBattleLog(battle.logs);
        setBattleFrames(battle.frames);
        setFrameIndex(0);
        setIsPlaying(true);
        setResult(battle.result === "win" ? "Victory" : "Defeat");
        if (battle.result === "win") {
            const reward = Math.max(20, selectedOpponent.pet.level * 5);
            updateCharacter({ ...character, ryo: character.ryo + reward });
        }
    }

    return (
        <div className="card pet-arena-screen">
            <div className="pet-arena-header">
                <button className="back-btn" onClick={() => setScreen("centralHub")}>Back to Central</button>
                <div>
                    <h2>Pet Arena</h2>
                    <p className="hint">Autobattle only. Pets choose actions using ordered AI rules: low HP buff, opener, highest-power jutsu, then basic attack.</p>
                </div>
            </div>

            <div className="pet-arena-grid">
                <section className="summary-box pet-arena-selector">
                    <h3>Your Pet</h3>
                    {character.pets.length === 0 ? (
                        <p className="hint">You need a pet before entering the arena.</p>
                    ) : (
                        <select value={selectedPetId} onChange={(e) => setSelectedPetId(e.target.value)}>
                            {character.pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name} | Lv {pet.level} | {pet.rarity}</option>)}
                        </select>
                    )}
                    {selectedPet && <PetArenaCard owner="You" pet={selectedPet} />}
                </section>

                <section className="summary-box pet-arena-selector">
                    <h3>Opponent Pet</h3>
                    <div className="pet-arena-mode-toggle">
                        <button
                            type="button"
                            className={opponentMode === "player" ? "active" : ""}
                            onClick={() => {
                                setOpponentMode("player");
                                setBattleLog([]);
                                setBattleFrames([]);
                                setResult("");
                                setIsPlaying(false);
                            }}
                        >
                            Fight Player
                        </button>
                        <button
                            type="button"
                            className={opponentMode === "ai" ? "active" : ""}
                            onClick={() => {
                                setOpponentMode("ai");
                                setBattleLog([]);
                                setBattleFrames([]);
                                setResult("");
                                setIsPlaying(false);
                            }}
                        >
                            Fight AI
                        </button>
                    </div>
                    {opponentPets.length > 0 ? (
                        <select value={selectedOpponentKey} onChange={(e) => setSelectedOpponentKey(e.target.value)}>
                            {opponentPets.map((entry) => <option key={`${entry.owner}:${entry.pet.id}`} value={`${entry.owner}:${entry.pet.id}`}>{entry.owner}: {entry.pet.name} | Lv {entry.pet.level}</option>)}
                        </select>
                    ) : (
                        <p className="hint">No player pets found. Switch to Fight AI for generic arena opponents.</p>
                    )}
                    <p className="hint">{opponentMode === "player" ? "Fight pets owned by other players in the roster." : "Fight generic AI pet arena opponents."}</p>
                    {selectedOpponent && <PetArenaCard owner={selectedOpponent.owner} pet={selectedOpponent.pet} />}
                </section>
            </div>

            <div className="menu">
                <button onClick={startBattle} disabled={!selectedPet || !selectedOpponent}>Start Battle</button>
                {battleFrames.length > 0 && (
                    <button onClick={() => {
                        if (frameIndex >= battleFrames.length - 1) {
                            setFrameIndex(0);
                            setIsPlaying(true);
                            return;
                        }
                        setIsPlaying((playing) => !playing);
                    }}>
                        {isPlaying ? "Pause" : frameIndex >= battleFrames.length - 1 ? "Replay" : "Resume"}
                    </button>
                )}
                {showResult && result && <strong className={result === "Victory" ? "pet-arena-win" : "pet-arena-loss"}>{result}</strong>}
            </div>

            {selectedPet && selectedOpponent && (
                <PetArenaBattlefield
                    playerPet={selectedPet}
                    enemyPet={selectedOpponent.pet}
                    enemyOwner={selectedOpponent.owner}
                    frame={currentFrame}
                    result={showResult ? result : ""}
                    onReplay={() => {
                        if (!battleFrames.length) return;
                        setFrameIndex(0);
                        setIsPlaying(true);
                    }}
                    onFightAgain={startBattle}
                    onExit={() => setScreen("centralHub")}
                />
            )}

            <section className="summary-box pet-arena-log">
                <h3>Battle Log</h3>
                {visibleLog.length === 0 ? <p className="hint">Start a match to watch the pets fight.</p> : visibleLog.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
            </section>
        </div>
    );
}

function PetArenaBattlefield({ playerPet, enemyPet, enemyOwner, frame, result, onReplay, onFightAgain, onExit }: { playerPet: Pet; enemyPet: Pet; enemyOwner: string; frame?: PetArenaFrame; result: string; onReplay: () => void; onFightAgain: () => void; onExit: () => void }) {
    const playerHp = frame?.playerHp ?? playerPet.hp;
    const enemyHp = frame?.enemyHp ?? enemyPet.hp;
    const playerPercent = Math.max(0, Math.min(100, (playerHp / Math.max(1, playerPet.hp)) * 100));
    const enemyPercent = Math.max(0, Math.min(100, (enemyHp / Math.max(1, enemyPet.hp)) * 100));
    const playerPos = frame?.playerPos ?? 15;
    const enemyPos = frame?.enemyPos ?? 19;
    const effectTile =
        frame?.actionKind === "buff"
            ? frame.actor === "enemy" ? enemyPos : playerPos
            : frame?.actionKind === "damage" || frame?.actionKind === "basic"
                ? frame.actor === "enemy" ? playerPos : enemyPos
                : frame?.actionKind === "result"
                    ? frame.actor === "enemy" ? enemyPos : playerPos
                    : -1;
    const effectLabel =
        frame?.actionKind === "buff" ? "Boost" :
            frame?.actionKind === "basic" ? "Hit" :
                frame?.actionKind === "damage" ? "Strike" :
                    frame?.actionKind === "result" ? result :
                        "";
    const winnerPet = result === "Victory" ? playerPet : result === "Defeat" ? enemyPet : null;
    const winnerSide: "player" | "enemy" = result === "Victory" ? "player" : "enemy";
    const winnerOwner = result === "Victory" ? "You" : enemyOwner;

    return (
        <section className="pet-arena-battlefield">
            <div className="pet-arena-bars">
                <div className="pet-arena-fighter-bar">
                    <strong>{playerPet.name}</strong>
                    <span>{playerHp}/{playerPet.hp} HP</span>
                    <div className="pet-arena-hpbar"><i style={{ width: `${playerPercent}%` }} /></div>
                </div>
                <div className="pet-arena-fighter-bar enemy">
                    <strong>{enemyOwner}: {enemyPet.name}</strong>
                    <span>{enemyHp}/{enemyPet.hp} HP</span>
                    <div className="pet-arena-hpbar"><i style={{ width: `${enemyPercent}%` }} /></div>
                </div>
            </div>

            <div className="pet-park-stage">
                <div className={`pet-park-grid pet-vfx-${frame?.actionKind ?? "idle"} pet-vfx-actor-${frame?.actor ?? "system"}`} aria-label="Pet arena park battlefield">
                    {Array.from({ length: 35 }, (_, index) => {
                        const occupiedByPlayer = index === playerPos;
                        const occupiedByEnemy = index === enemyPos;
                        const isTrail = [3, 4, 5, 10, 11, 12, 17, 18, 24, 25, 26, 31].includes(index);
                        const isActionTile = frame?.actionKind && (occupiedByPlayer || occupiedByEnemy);
                        const hasEffect = index === effectTile && frame?.actionKind;
                        return (
                            <div
                                key={index}
                                className={`pet-park-tile${isTrail ? " pet-path" : ""}${isActionTile ? " pet-action-tile" : ""}${hasEffect ? ` pet-vfx-tile pet-vfx-tile-${frame?.actionKind}` : ""}${occupiedByPlayer || occupiedByEnemy ? " pet-occupied" : ""}`}
                            >
                                {hasEffect && (
                                    <span className="pet-battle-vfx" key={`${frame?.message}-${index}`}>
                                        <i />
                                        <b>{effectLabel}</b>
                                        <em />
                                    </span>
                                )}
                                {occupiedByPlayer && <PetBattleAvatar pet={playerPet} side="player" active={frame?.actor === "player"} />}
                                {occupiedByEnemy && <PetBattleAvatar pet={enemyPet} side="enemy" active={frame?.actor === "enemy"} />}
                            </div>
                        );
                    })}
                </div>

                {winnerPet && (
                    <div className={`pet-victory-screen ${winnerSide}`}>
                        <span className="pet-victory-burst" />
                        <PetBattleAvatar pet={winnerPet} side={winnerSide} active />
                        <div>
                            <span>Arena Winner</span>
                            <strong>{winnerPet.name}</strong>
                            <p>{winnerOwner} wins the match.</p>
                        </div>
                        <div className="pet-victory-actions">
                            <button type="button" onClick={onFightAgain}>Fight Again</button>
                            <button type="button" className="danger-button" onClick={onExit}>Exit</button>
                        </div>
                    </div>
                )}
            </div>

            <div className={`pet-arena-current-action ${frame?.actor ?? "system"}`}>
                <span>{frame?.round ? `Round ${frame.round}` : "Ready"}</span>
                <strong>{frame?.message ?? "Pick two pets and start the match."}</strong>
                {result && frame?.actionKind === "result" && <button onClick={onReplay}>Replay</button>}
            </div>
        </section>
    );
}

function PetBattleAvatar({ pet, side, active }: { pet: Pet; side: "player" | "enemy"; active: boolean }) {
    return (
        <div className={`pet-battle-avatar ${side}${active ? " active" : ""}`}>
            {pet.image ? <img src={pet.image} alt={pet.name} /> : <span>{pet.name.slice(0, 2).toUpperCase()}</span>}
        </div>
    );
}

function PetArenaCard({ owner, pet }: { owner: string; pet: Pet }) {
    return (
        <div className="pet-arena-card">
            <div className="pet-arena-avatar">
                {pet.image ? <img src={pet.image} alt={pet.name} /> : <span>{pet.name.slice(0, 2).toUpperCase()}</span>}
            </div>
            <div>
                <strong>{pet.name}</strong>
                <p>{owner} | {pet.rarity} | Lv {pet.level}</p>
                <p>HP {pet.hp} | ATK {pet.attack} | DEF {pet.defense} | SPD {pet.speed}</p>
                {pet.trait && <p><strong>Trait:</strong> {pet.trait} — {petTraitDescriptions[pet.trait]}</p>}
                <div className="pet-arena-jutsu-list">
                    {pet.jutsus.length ? pet.jutsus.map((jutsu) => <span key={jutsu.name}>{jutsu.name} ({jutsu.kind}, P{jutsu.power}, CD{jutsu.cooldown})</span>) : <span>No jutsu</span>}
                </div>
            </div>
        </div>
    );
}

function AdminPanel({
    character,
    updateCharacter,
    creatorJutsus,
    setCreatorJutsus,
    creatorAis,
    setCreatorAis,
    creatorEvents,
    setCreatorEvents,
    creatorMissions,
    setCreatorMissions,
    creatorRaids,
    setCreatorRaids,
    creatorCards,
    setCreatorCards,
    petEncounterVn,
    setPetEncounterVn,
    editablePets,
    setEditablePets,
    selectedPetId,
    setSelectedPetId,
    creatorItems,
    setCreatorItems,
    savedBloodlines,
    setSavedBloodlines,
    setAdminLoggedIn,
    setScreen,
    onSave,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    creatorJutsus: Jutsu[];
    setCreatorJutsus: (jutsus: Jutsu[]) => void;
    creatorAis: CreatorAi[];
    setCreatorAis: (ais: CreatorAi[]) => void;
    creatorEvents: CreatorEvent[];
    setCreatorEvents: (events: CreatorEvent[]) => void;
    creatorMissions: CreatorMission[];
    setCreatorMissions: (missions: CreatorMission[]) => void;
    creatorRaids: CreatorRaid[];
    setCreatorRaids: (raids: CreatorRaid[]) => void;
    creatorCards: TileCard[];
    setCreatorCards: (cards: TileCard[]) => void;
    petEncounterVn: CreatorEvent;
    setPetEncounterVn: (vn: CreatorEvent) => void;
    editablePets: Pet[];
    setEditablePets: (pets: Pet[]) => void;
    selectedPetId: string;
    setSelectedPetId: (id: string) => void;
    creatorItems: GameItem[];
    setCreatorItems: (items: GameItem[]) => void;
    savedBloodlines: SavedBloodline[];
    setSavedBloodlines: (bloodlines: SavedBloodline[]) => void;
    setAdminLoggedIn: (value: boolean) => void;
    setScreen: (screen: Screen) => void;
    onSave: () => Promise<void>;
}) {
    const [editingJutsuId, setEditingJutsuId] = useState("");
    const [jutsuName, setJutsuName] = useState("Admin Flame Burst");
    const [jutsuGenStatus, setJutsuGenStatus] = useState("");
    const [jutsuIsGenerating, setJutsuIsGenerating] = useState(false);
    const [petGenStatus, setPetGenStatus] = useState("");
    const [petIsGenerating, setPetIsGenerating] = useState(false);
    const [jutsuType, setJutsuType] = useState<JutsuType>("Ninjutsu");
    const [jutsuElement, setJutsuElement] = useState<JutsuElement>("Fire");
    const [jutsuAp, setJutsuAp] = useState(40);
    const [jutsuRange, setJutsuRange] = useState(4);
    const [jutsuEp, setJutsuEp] = useState(100);
    const [jutsuCooldown, setJutsuCooldown] = useState(2);
    const [jutsuTarget, setJutsuTarget] = useState<JutsuTarget>("OPPONENT");
    const [jutsuMethod, setJutsuMethod] = useState<JutsuMethod>("SINGLE");
    const [healthCost, setHealthCost] = useState(0);
    const [chakraCost, setChakraCost] = useState(25);
    const [staminaCost, setStaminaCost] = useState(10);
    const [healthCostReducePerLvl, setHealthCostReducePerLvl] = useState(0);
    const [chakraCostReducePerLvl, setChakraCostReducePerLvl] = useState(0);
    const [staminaCostReducePerLvl, setStaminaCostReducePerLvl] = useState(0);
    const [tag1, setTag1] = useState("Increase Damage Given");
    const [tag1Percent, setTag1Percent] = useState(40);
    const [tag2, setTag2] = useState("Afterburn");
    const [tag2Percent, setTag2Percent] = useState(25);
    const [tag3, setTag3] = useState("");
    const [tag3Percent, setTag3Percent] = useState(30);
    const [tag4, setTag4] = useState("");
    const [tag4Percent, setTag4Percent] = useState(30);
    const [jutsuDescription, setJutsuDescription] = useState("");
    const [jutsuImage, setJutsuImage] = useState("");
    const [damageTagEnabled, setDamageTagEnabled] = useState(true);
    const [damageEffectPower, setDamageEffectPower] = useState(100);
    const [itemName, setItemName] = useState("Iron Katana");
    const [itemSlot, setItemSlot] = useState<EquipmentSlot>("hand");
    const [itemRarity, setItemRarity] = useState<GameItem["rarity"]>("common");
    const [itemCost, setItemCost] = useState(100);
    const [itemDescription, setItemDescription] = useState("A custom admin-created item.");
    const [itemBonusStat, setItemBonusStat] = useState<keyof Stats>("strength");
    const [itemBonusAmount, setItemBonusAmount] = useState(25);
    const [itemArmorQuality, setItemArmorQuality] = useState<ArmorQuality | "">("");
    const [itemImage, setItemImage] = useState("");
    const [editingItemId, setEditingItemId] = useState("");
    const isArmorSlot = ["head", "body", "armor", "waist", "legs", "feet"].includes(itemSlot);

    // Bulk item image generation
    const [itemBulkSelections, setItemBulkSelections] = useState<string[]>([]);
    const [itemBulkRunning, setItemBulkRunning] = useState(false);
    const [itemBulkProgress, setItemBulkProgress] = useState<{ current: number; total: number; itemName: string } | null>(null);
    const [itemBulkErrors, setItemBulkErrors] = useState<{ id: string; name: string; error: string }[]>([]);
    const [itemBulkSkipExisting, setItemBulkSkipExisting] = useState(true);
    const [itemBulkShowSection, setItemBulkShowSection] = useState(false);
    const [itemBulkCustomPrompts, setItemBulkCustomPrompts] = useState<Record<string, string>>({});
    const [itemBulkSlotFilter, setItemBulkSlotFilter] = useState<string>("all");

    function itemFromForm(id?: string): GameItem {
        return {
            id: id ?? `item-${makeId()}`,
            name: itemName,
            slot: itemSlot,
            rarity: itemRarity,
            cost: Number(itemCost),
            description: itemDescription,
            ...(isArmorSlot && itemArmorQuality ? { armorQuality: itemArmorQuality } : {}),
            ...(itemImage ? { image: itemImage } : {}),
            bonuses: { [itemBonusStat]: Number(itemBonusAmount) },
        };
    }

    function loadAdminItem(item: GameItem) {
        setEditingItemId(item.id);
        setItemName(item.name);
        setItemSlot(item.slot);
        setItemRarity(item.rarity);
        setItemCost(item.cost);
        setItemDescription(item.description);
        setItemArmorQuality(item.armorQuality ?? "");
        setItemImage(item.image ?? "");
        const firstBonus = Object.entries(item.bonuses).find(([, v]) => v !== undefined && (v as number) !== 0);
        if (firstBonus) {
            setItemBonusStat(firstBonus[0] as keyof Stats);
            setItemBonusAmount(firstBonus[1] as number);
        } else {
            setItemBonusStat("strength");
            setItemBonusAmount(0);
        }
    }

    function applyItemImage(image: string) {
        setItemImage(image);
        if (!editingItemId) return;
        const isCreator = creatorItems.some((i) => i.id === editingItemId);
        if (isCreator) {
            setCreatorItems(creatorItems.map((i) => i.id === editingItemId ? { ...i, image } : i));
        } else {
            // starter item override: create override entry with image
            const base = [...starterItems, ...creatorItems].find((i) => i.id === editingItemId);
            if (base) setCreatorItems([...creatorItems, { ...base, image }]);
        }
    }

    function saveAdminItemEdit() {
        const updated = itemFromForm(editingItemId);
        const isCreator = creatorItems.some((i) => i.id === editingItemId);
        if (isCreator) {
            setCreatorItems(creatorItems.map((i) => i.id === editingItemId ? updated : i));
        } else {
            setCreatorItems([...creatorItems, updated]);
        }
        setEditingItemId("");
        alert(`${updated.name} saved.`);
    }

    function createAdminItem() {
        if (editingItemId) { saveAdminItemEdit(); return; }
        const newItem = itemFromForm();
        setCreatorItems([...creatorItems, newItem]);
        alert(`${newItem.name} created.`);
    }

    async function runBulkItemGeneration() {
        const allItems = getAllItems(creatorItems);
        const toProcess = itemBulkSelections
            .map(id => allItems.find(i => i.id === id))
            .filter(Boolean) as GameItem[];
        if (toProcess.length === 0) { alert("No items selected."); return; }

        setItemBulkRunning(true);
        setItemBulkErrors([]);
        const errors: { id: string; name: string; error: string }[] = [];
        let live = [...creatorItems];

        for (let idx = 0; idx < toProcess.length; idx++) {
            const item = toProcess[idx];
            setItemBulkProgress({ current: idx + 1, total: toProcess.length, itemName: item.name });
            try {
                const customPrompt = itemBulkCustomPrompts[item.id]?.trim();
                const slotLabel = equipmentSlotLabel(item.slot);
                const autoPrompt = `${item.name} ${item.rarity} ${slotLabel} shinobi ninja RPG equipment game art`;
                const response = await fetch("/api/generate-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: customPrompt || autoPrompt, label: "Item Image" }),
                });
                const rawText = await response.text();
                let data: Record<string, unknown> = {};
                try { data = rawText ? JSON.parse(rawText) : {}; } catch { throw new Error(`Server error ${response.status}`); }
                if (!response.ok) throw new Error((data.error as string) || `Status ${response.status}`);
                if (!data.image) throw new Error("No image returned.");
                const image = await compressDataUrl(data.image as string);

                const isCreator = live.some(i => i.id === item.id);
                if (isCreator) {
                    live = live.map(i => i.id === item.id ? { ...i, image } : i);
                } else {
                    // starter-item override: clone and add image
                    live = [...live, { ...item, image }];
                }
                setCreatorItems(live);
            } catch (err) {
                errors.push({ id: item.id, name: item.name, error: err instanceof Error ? err.message : "Failed" });
            }
        }

        setItemBulkErrors(errors);
        setItemBulkProgress(null);
        setItemBulkRunning(false);
        setItemBulkSelections([]);
        // Push to server so images survive localStorage's image-strip on refresh
        try { await onSave(); } catch { /* ignore if no account */ }
    }

    const [cardName, setCardName] = useState("New Card");
    const [cardPower, setCardPower] = useState(3);
    const [cardElement, setCardElement] = useState("None");
    const [cardRarity, setCardRarity] = useState<TileCard["rarity"]>("common");
    const [cardArrows, setCardArrows] = useState<TileCardArrow[]>(["up"]);
    const [cardDescription, setCardDescription] = useState("A custom card.");
    const [cardImage, setCardImage] = useState("");
    const [editingCardId, setEditingCardId] = useState("");

    // Bulk image generation
    const [bulkSelections, setBulkSelections] = useState<string[]>([]);
    const [bulkRunning, setBulkRunning] = useState(false);
    const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; cardName: string } | null>(null);
    const [bulkErrors, setBulkErrors] = useState<{ id: string; name: string; error: string }[]>([]);
    const [bulkSkipExisting, setBulkSkipExisting] = useState(true);
    const [bulkShowSection, setBulkShowSection] = useState(false);
    const [bulkCustomPrompts, setBulkCustomPrompts] = useState<Record<string, string>>({});

    function cardFromForm(id?: string): TileCard {
        return { id: id ?? `card-${makeId()}`, name: cardName, power: cardPower, element: cardElement, arrows: cardArrows, rarity: cardRarity, description: cardDescription, ...(cardImage ? { image: cardImage } : {}) };
    }

    function loadAdminCard(card: TileCard) {
        setEditingCardId(card.id);
        setCardName(card.name);
        setCardPower(card.power);
        setCardElement(card.element);
        setCardRarity(card.rarity);
        setCardArrows(card.arrows);
        setCardDescription(card.description);
        setCardImage(card.image ?? "");
    }

    function saveAdminCardEdit() {
        const updated = cardFromForm(editingCardId);
        const isCreator = creatorCards.some((c) => c.id === editingCardId);
        if (isCreator) {
            setCreatorCards(creatorCards.map((c) => c.id === editingCardId ? updated : c));
        } else {
            setCreatorCards([...creatorCards, updated]);
        }
        setEditingCardId("");
        alert(`${updated.name} saved.`);
    }

    function createAdminCard() {
        if (editingCardId) { saveAdminCardEdit(); return; }
        const newCard = cardFromForm();
        setCreatorCards([...creatorCards, newCard]);
        alert(`${newCard.name} created.`);
    }

    async function generateCardImageRaw(prompt: string): Promise<string> {
        const response = await fetch("/api/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, label: "Card Image" }),
        });
        const rawText = await response.text();
        let data: Record<string, unknown> = {};
        try { data = rawText ? JSON.parse(rawText) : {}; } catch { throw new Error(`Server error ${response.status}`); }
        if (!response.ok) throw new Error((data.error as string) || `Status ${response.status}`);
        if (!data.image) throw new Error("No image returned.");
        return compressDataUrl(data.image as string);
    }

    async function runBulkGeneration() {
        const allCards = getAllTileCards(creatorCards);
        const toProcess = bulkSelections
            .map(id => allCards.find(c => c.id === id))
            .filter(Boolean) as TileCard[];
        if (toProcess.length === 0) { alert("No cards selected."); return; }

        setBulkRunning(true);
        setBulkErrors([]);
        const errors: { id: string; name: string; error: string }[] = [];
        let live = [...creatorCards];

        for (let i = 0; i < toProcess.length; i++) {
            const card = toProcess[i];
            setBulkProgress({ current: i + 1, total: toProcess.length, cardName: card.name });
            try {
                const customPrompt = bulkCustomPrompts[card.id]?.trim();
                const autoPrompt = `${card.name}${card.element !== "None" ? " " + card.element : ""} shinobi tile card game artwork, ${card.rarity} rarity`;
                const image = await generateCardImageRaw(customPrompt || autoPrompt);
                const isCreator = live.some(c => c.id === card.id);
                if (isCreator) {
                    live = live.map(c => c.id === card.id ? { ...c, image } : c);
                } else {
                    live = [...live, { ...card, image }];
                }
                setCreatorCards(live);
            } catch (err) {
                errors.push({ id: card.id, name: card.name, error: err instanceof Error ? err.message : "Failed" });
            }
        }

        setBulkErrors(errors);
        setBulkProgress(null);
        setBulkRunning(false);
        setBulkSelections([]);
        try { await onSave(); } catch { /* ignore if no account */ }
    }

    const [previewVn, setPreviewVn] = useState<CreatorEvent | null>(null);
    const [previewVnPage, setPreviewVnPage] = useState(0);
    const [previewVnLine, setPreviewVnLine] = useState(0);

    const [eventName, setEventName] = useState("Admin World Event");
    const [editingEventId, setEditingEventId] = useState("");
    const [eventKind, setEventKind] = useState<"reward" | "visualNovel">("visualNovel");
    const [eventTrigger, setEventTrigger] = useState<"manual" | "firstBattleArena" | "firstLeaveVillage">("manual");
    const [eventBiome, setEventBiome] = useState<Biome>("central");
    const [eventVnTitle, setEventVnTitle] = useState("A Stranger at the Gate");
    const [eventVnScene, setEventVnScene] = useState("Rain taps against the village rooftops while an unknown shinobi waits beneath the lanterns.");
    const [eventVnSpeaker, setEventVnSpeaker] = useState("Unknown Shinobi");
    const [eventImage, setEventImage] = useState("");
    const [eventAiProfileId, setEventAiProfileId] = useState("");
    const [eventPageCount, setEventPageCount] = useState(1);
    const [eventVnPages, setEventVnPages] = useState(Array.from({ length: 10 }, (_, index) => ({
        title: index === 0 ? "A Stranger at the Gate" : `Story Page ${index + 1}`,
        scene: index === 0 ? "Rain taps against the village rooftops while an unknown shinobi waits beneath the lanterns." : "",
        speaker: index === 0 ? "Unknown Shinobi" : "Narrator",
        dialogue: index === 0 ? "Unknown Shinobi: You are late.\nUnknown Shinobi: The first seal has already broken." : "",
        image: "",
        choices: [] as { text: string; nextPage: number; conclusion?: string }[],
    })));
    const [eventIcon, setEventIcon] = useState("⚔️");
    const [eventLevelReq, setEventLevelReq] = useState(1);
    const [eventXp, setEventXp] = useState(200);
    const [eventRyo, setEventRyo] = useState(100);
    const [eventStamina, setEventStamina] = useState(25);
    const [eventRewardCurrency, setEventRewardCurrency] = useState<RewardCurrencyKey>("fateShards");
    const [eventRewardCurrencyAmount, setEventRewardCurrencyAmount] = useState(0);
    const [eventDialogue, setEventDialogue] = useState("A strange chakra pressure fills the air.\nAdmin Event: Test your strength, shinobi.");
    const [editingMissionId, setEditingMissionId] = useState("");
    const [missionName, setMissionName] = useState("Sector Sweep");
    const [missionRank, setMissionRank] = useState<MissionRank>("Daily");
    const [missionDescription, setMissionDescription] = useState("Scout the assigned sector and report back to the mission hall.");
    const [missionAiProfileId, setMissionAiProfileId] = useState("");
    const [missionTargetSector, setMissionTargetSector] = useState(1);
    const [missionExploreCount, setMissionExploreCount] = useState(3);
    const [missionLevelReq, setMissionLevelReq] = useState(1);
    const [missionXp, setMissionXp] = useState(50);
    const [missionRyo, setMissionRyo] = useState(35);
    const [missionStamina, setMissionStamina] = useState(5);
    const [missionRewardCurrency, setMissionRewardCurrency] = useState<RewardCurrencyKey>("fateShards");
    const [missionRewardCurrencyAmount, setMissionRewardCurrencyAmount] = useState(0);
    const [missionRankFilter, setMissionRankFilter] = useState<"All" | MissionRank>("All");
    const [editingRaidId, setEditingRaidId] = useState("");
    const [raidName, setRaidName] = useState("Shadow Boss Raid");
    const [raidBiome, setRaidBiome] = useState<Biome>("shadow");
    const [raidIcon, setRaidIcon] = useState("💀");
    const [raidLevelReq, setRaidLevelReq] = useState(20);
    const [raidAiProfileId, setRaidAiProfileId] = useState("");
    const [raidWaves, setRaidWaves] = useState(3);
    const [raidXp, setRaidXp] = useState(500);
    const [raidRyo, setRaidRyo] = useState(300);
    const [raidStamina, setRaidStamina] = useState(50);
    const [raidRewardCurrency, setRaidRewardCurrency] = useState<RewardCurrencyKey>("fateShards");
    const [raidRewardCurrencyAmount, setRaidRewardCurrencyAmount] = useState(0);
    const [raidDescription, setRaidDescription] = useState("A powerful enemy has appeared. Defeat all waves to claim the reward.");
    const [editingBloodlineId, setEditingBloodlineId] = useState("");
    const [bloodlineEditName, setBloodlineEditName] = useState("");
    const [bloodlineEditRank, setBloodlineEditRank] = useState<Rank>("A Rank");
    const [bloodlineEditElement, setBloodlineEditElement] = useState("");
    const [bloodlineEditImage, setBloodlineEditImage] = useState("");
    const [bloodlineRankFilter, setBloodlineRankFilter] = useState<"All" | Rank>("All");
    const [bloodlineSort, setBloodlineSort] = useState<"name" | "rank" | "points" | "jutsus">("name");
    const [selectedBloodlineId, setSelectedBloodlineId] = useState("");
    const [eventBiomeFilter, setEventBiomeFilter] = useState<"All" | Biome>("All");
    const [eventSort, setEventSort] = useState<"name" | "type" | "biome" | "level">("name");
    const [selectedEventId, setSelectedEventId] = useState("");
    const [editingAiId, setEditingAiId] = useState("");
    const [aiName, setAiName] = useState("Custom Arena AI");
    const [aiIcon, setAiIcon] = useState("EN");
    const [aiImage, setAiImage] = useState("");
    const [aiLevel, setAiLevel] = useState(10);
    const [aiVillage, setAiVillage] = useState("Admin Arena");
    const [aiHp, setAiHp] = useState(1200);
    const [aiChakra, setAiChakra] = useState(700);
    const [aiStamina, setAiStamina] = useState(700);
    const [aiStats, setAiStats] = useState<Stats>(addToAllStats(baseStats(), 60));
    const [aiJutsuIds, setAiJutsuIds] = useState<string[]>(starterJutsus.slice(0, 4).map((jutsu) => jutsu.id));
    const [aiRules, setAiRules] = useState<AiRule[]>(starterAiProfile(starterJutsus).rules);
    const [selectedAiId, setSelectedAiId] = useState("");
    const [activeAdminPanel, setActiveAdminPanel] = useState<"jutsuBloodlines" | "eventsRaids" | "visualNovels" | "aiCreator" | "petEditor" | "cardEditor" | "villageLeaders">("jutsuBloodlines");
    const [leadershipImages, setLeadershipImages] = useState<VillageLeadershipImages>(() => loadVillageLeadershipImages());
    const eventKindFilter: "All" | "reward" | "visualNovel" =
        activeAdminPanel === "eventsRaids" ? "reward"
            : activeAdminPanel === "visualNovels" ? "visualNovel"
                : "All";

    const allGameJutsus = getAllJutsus(savedBloodlines, creatorJutsus, character);
    const allAdminAis = [
        ...builtinAis.map((builtin) => creatorAis.find((ai) => ai.id === builtin.id) ?? builtin),
        ...creatorAis.filter((ai) => !builtinAis.some((builtin) => builtin.id === ai.id)),
    ];
    const selectedAdminAiProfile = allAdminAis.find((ai) => ai.id === selectedAiId) ?? allAdminAis[0];
    const builtInVisualNovels = Object.entries(storylines).flatMap(([village, steps]) => steps.map((step, index) => storyToCreatorEvent(step, village, index)));
    const allEditableEvents = [
        ...builtInVisualNovels.filter((builtIn) => !creatorEvents.some((event) => event.id === builtIn.id)),
        ...creatorEvents,
    ];
    const missionRanks: MissionRank[] = ["Daily", "D Rank", "C Rank", "B Rank", "A Rank", "S Rank"];
    const allEditableBloodlines = [
        ...starterSavedBloodlines.filter((builtIn) => !savedBloodlines.some((bloodline) => bloodline.name === builtIn.name || bloodline.id === builtIn.id)),
        ...savedBloodlines,
    ];
    function updateLeadershipImage(village: string, slot: "kage" | number, image: string) {
        const current = leadershipImages[village] ?? { kage: "", elders: ["", "", ""] };
        const nextVillageImages = slot === "kage"
            ? { ...current, kage: image, elders: Array.from({ length: 3 }, (_, index) => current.elders?.[index] ?? "") }
            : { ...current, elders: Array.from({ length: 3 }, (_, index) => index === slot ? image : current.elders?.[index] ?? "") };
        const next = normalizeVillageLeadershipImages({ ...leadershipImages, [village]: nextVillageImages });
        setLeadershipImages(next);
        saveVillageLeadershipImages(next);
    }
    const sortedBloodlines = [...allEditableBloodlines]
        .filter((bloodline) => bloodlineRankFilter === "All" || bloodline.rank === bloodlineRankFilter)
        .sort((a, b) => {
            if (bloodlineSort === "points") return b.totalPoints - a.totalPoints;
            if (bloodlineSort === "jutsus") return b.jutsus.length - a.jutsus.length;
            return String(a[bloodlineSort]).localeCompare(String(b[bloodlineSort])) || a.name.localeCompare(b.name);
        });
    const selectedBloodline = sortedBloodlines.find((bloodline) => bloodline.id === selectedBloodlineId) ?? sortedBloodlines[0];
    const sortedEditableEvents = [...allEditableEvents]
        .filter((event) => eventKindFilter === "All" || (event.eventKind ?? "reward") === eventKindFilter)
        .filter((event) => eventBiomeFilter === "All" || event.biome === eventBiomeFilter)
        .sort((a, b) => {
            if (eventSort === "level") return a.levelReq - b.levelReq;
            if (eventSort === "type") return String(a.eventKind ?? "reward").localeCompare(String(b.eventKind ?? "reward")) || a.name.localeCompare(b.name);
            return String(a[eventSort]).localeCompare(String(b[eventSort])) || a.name.localeCompare(b.name);
        });

    const sortedCreatorMissions = [...creatorMissions]
        .filter((mission) => missionRankFilter === "All" || mission.rank === missionRankFilter)
        .sort((a, b) => missionRanks.indexOf(a.rank) - missionRanks.indexOf(b.rank) || a.levelReq - b.levelReq || a.name.localeCompare(b.name));

    function makeTags() {
        const tags = normalizeJutsuTags([
            { name: tag1, percent: tag1Percent },
            { name: tag2, percent: tag2Percent },
            { name: tag3, percent: tag3Percent },
            { name: tag4, percent: tag4Percent },
        ]);

        if (damageTagEnabled) {
            tags.unshift({ name: "Damage", percent: damageEffectPower });
        }

        return normalizeJutsuTags(tags);
    }

    function updateVnPage(index: number, updated: Partial<typeof eventVnPages[number]>) {
        setEventVnPages((pages) => pages.map((page, pageIndex) => pageIndex === index ? { ...page, ...updated } : page));
        if ('image' in updated && editingEventId) {
            setCreatorEvents(creatorEvents.map((ev) => {
                if (ev.id !== editingEventId || !ev.vnPages) return ev;
                return { ...ev, vnPages: ev.vnPages.map((p, i) => i === index ? { ...p, image: updated.image } : p) };
            }));
        }
    }

    function applyJutsuImage(image: string) {
        setJutsuImage(image);
        if (!editingJutsuId) return;
        setCreatorJutsus(creatorJutsus.map((j) => j.id === editingJutsuId ? { ...j, image } : j));
        setSavedBloodlines(savedBloodlines.map((bl) => ({
            ...bl,
            jutsus: bl.jutsus.map((j) => j.id === editingJutsuId ? { ...j, image } : j),
        })));
    }

    function applyBloodlineImage(image: string) {
        setBloodlineEditImage(image);
        if (!editingBloodlineId) return;
        setSavedBloodlines(savedBloodlines.map((bl) => bl.id === editingBloodlineId ? { ...bl, image } : bl));
    }

    function setVnPageImage(eventId: string, pageIndex: number, image: string) {
        setCreatorEvents(creatorEvents.map((ev) => {
            if (ev.id !== eventId || !ev.vnPages) return ev;
            return { ...ev, vnPages: ev.vnPages.map((p, i) => i === pageIndex ? { ...p, image } : p) };
        }));
    }

    function setPetVnPageImage(pageIndex: number, image: string) {
        if (!petEncounterVn.vnPages) return;
        setPetEncounterVn({ ...petEncounterVn, vnPages: petEncounterVn.vnPages.map((p, i) => i === pageIndex ? { ...p, image } : p) });
    }

    function applyEventImage(image: string) {
        setEventImage(image);
        if (!editingEventId) return;
        setCreatorEvents(creatorEvents.map((ev) => ev.id === editingEventId ? { ...ev, image } : ev));
    }

    function applyAiImage(image: string) {
        setAiImage(image);
        if (!editingAiId) return;
        setCreatorAis(creatorAis.map((ai) => ai.id === editingAiId ? { ...ai, image } : ai));
    }

    function jutsuFromForm(id = `admin-${makeId()}`) {
        const finalEffectPower = damageTagEnabled
            ? Number(damageEffectPower)
            : Number(jutsuEp);

        const jutsu = normalizeJutsu({
            id,
            name: jutsuName.trim() || "Admin Jutsu",
            type: jutsuType,
            element: jutsuElement,
            ap: Number(jutsuAp),
            range: Number(jutsuRange),
            effectPower: finalEffectPower,
            cooldown: Number(jutsuCooldown),
            target: jutsuTarget,
            method: jutsuMethod,
            healthCost: Number(healthCost),
            chakraCost: Number(chakraCost),
            staminaCost: Number(staminaCost),
            healthCostReducePerLvl: Number(healthCostReducePerLvl),
            chakraCostReducePerLvl: Number(chakraCostReducePerLvl),
            staminaCostReducePerLvl: Number(staminaCostReducePerLvl),
            battleDescription: jutsuDescription || `${jutsuName} hits %target`,
            tags: makeTags(),
        }) as Jutsu & {
            description?: string;
            image?: string;
        };

        jutsu.description = jutsuDescription;
        jutsu.image = jutsuImage;

        return jutsu;
    }

    function loadAdminJutsu(jutsu: Jutsu) {
        const normalized = normalizeJutsu(jutsu);
        const damageTag = normalized.tags.find((tag) => tag.name === "Damage");
        const otherTags = normalized.tags.filter((tag) => tag.name !== "Damage");

        setEditingJutsuId(normalized.id);
        setJutsuName(normalized.name);
        setJutsuType(normalized.type);
        setJutsuElement(normalized.element);
        setJutsuAp(normalized.ap);
        setJutsuRange(normalized.range);
        setJutsuEp(normalized.effectPower);
        setJutsuCooldown(normalized.cooldown);
        setJutsuTarget(normalized.target);
        setJutsuMethod(normalized.method);
        setHealthCost(normalized.healthCost);
        setChakraCost(normalized.chakraCost);
        setStaminaCost(normalized.staminaCost);
        setHealthCostReducePerLvl(normalized.healthCostReducePerLvl);
        setChakraCostReducePerLvl(normalized.chakraCostReducePerLvl);
        setStaminaCostReducePerLvl(normalized.staminaCostReducePerLvl);
        setJutsuDescription(normalized.description ?? "");
        setJutsuImage(normalized.image ?? "");
        setDamageTagEnabled(Boolean(damageTag));
        setDamageEffectPower(damageTag?.percent ?? normalized.effectPower);
        setTag1(otherTags[0]?.name ?? "");
        setTag1Percent(otherTags[0]?.percent ?? 30);
        setTag2(otherTags[1]?.name ?? "");
        setTag2Percent(otherTags[1]?.percent ?? 30);
        setTag3(otherTags[2]?.name ?? "");
        setTag3Percent(otherTags[2]?.percent ?? 30);
        setTag4(otherTags[3]?.name ?? "");
        setTag4Percent(otherTags[3]?.percent ?? 30);
    }

    function createAdminJutsu() {
        const newJutsu = rebalanceNonBloodlineJutsu(jutsuFromForm());

        setCreatorJutsus([...creatorJutsus, newJutsu]);

        alert(`${newJutsu.name} created and imported to the game. Train it before equipping it.`);
    }

    function saveAdminJutsuEdit() {
        if (!editingJutsuId) return alert("Load an existing admin jutsu first.");
        const updatedJutsu = jutsuFromForm(editingJutsuId);
        const sourceBloodline = savedBloodlines.find((bloodline) => bloodline.jutsus.some((jutsu) => jutsu.id === editingJutsuId));
        if (sourceBloodline) {
            setSavedBloodlines(savedBloodlines.map((bloodline) => bloodline.id === sourceBloodline.id ? {
                ...bloodline,
                jutsus: bloodline.jutsus.map((jutsu) => jutsu.id === editingJutsuId ? updatedJutsu : jutsu),
                totalPoints: bloodline.jutsus.map((jutsu) => jutsu.id === editingJutsuId ? updatedJutsu : jutsu).reduce((sum, jutsu) => sum + jutsuPoints(jutsu), 0),
            } : bloodline));
        } else if (creatorJutsus.some((jutsu) => jutsu.id === editingJutsuId)) {
            setCreatorJutsus(creatorJutsus.map((jutsu) => jutsu.id === editingJutsuId ? rebalanceNonBloodlineJutsu(updatedJutsu) : jutsu));
        } else {
            setCreatorJutsus([...creatorJutsus, rebalanceNonBloodlineJutsu(updatedJutsu)]);
        }
        alert(`${updatedJutsu.name} updated.`);
    }
    function eventFromForm(id = `event-${makeId()}`): CreatorEvent {
        return {
            id,
            name: eventName.trim() || "Admin Event",
            biome: eventBiome,
            icon: eventIcon || "⚔️",
            eventKind,
            trigger: eventTrigger,
            vnTitle: eventVnTitle.trim() || eventName.trim() || "Visual Novel Scene",
            vnScene: eventVnScene.trim(),
            vnSpeaker: eventVnSpeaker.trim() || "Narrator",
            image: eventImage,
            aiProfileId: eventAiProfileId || undefined,
            vnPages: eventKind === "visualNovel" ? eventVnPages.slice(0, eventPageCount).map((page, index) => ({
                title: page.title.trim() || `Story Page ${index + 1}`,
                scene: page.scene.trim(),
                speaker: page.speaker.trim() || "Narrator",
                dialogue: page.dialogue.split("\n").map((line) => line.trim()).filter(Boolean),
                image: page.image,
                choices: page.choices?.filter((c) => c.text.trim()).length
                    ? page.choices.filter((c) => c.text.trim()).map((c) => ({ text: c.text.trim(), nextPage: c.nextPage }))
                    : undefined,
            })) : undefined,
            levelReq: Math.max(1, Number(eventLevelReq)),
            xpReward: Math.max(0, Number(eventXp)),
            ryoReward: Math.max(0, Number(eventRyo)),
            staminaReward: Math.max(0, Number(eventStamina)),
            currencyRewards: singleCurrencyReward(eventRewardCurrency, eventRewardCurrencyAmount),
            dialogue: eventDialogue.split("\n").map((line) => line.trim()).filter(Boolean),
        };
    }

    function loadAdminEvent(event: CreatorEvent) {
        setEditingEventId(event.id);
        setEventName(event.name);
        setEventKind(event.eventKind ?? "reward");
        setEventTrigger(event.trigger ?? "manual");
        setEventBiome(event.biome);
        setEventIcon(event.icon);
        setEventVnTitle(event.vnTitle ?? event.name);
        setEventVnScene(event.vnScene ?? "");
        setEventVnSpeaker(event.vnSpeaker ?? "Narrator");
        setEventImage(event.image ?? "");
        setEventAiProfileId(event.aiProfileId ?? "");
        setEventLevelReq(event.levelReq);
        setEventXp(event.xpReward);
        setEventRyo(event.ryoReward);
        setEventStamina(event.staminaReward);
        const eventCurrencyReward = firstCurrencyReward(event.currencyRewards);
        setEventRewardCurrency(eventCurrencyReward.key);
        setEventRewardCurrencyAmount(eventCurrencyReward.amount);
        setEventDialogue(event.dialogue.join("\n"));

        const pages = event.vnPages?.length
            ? event.vnPages
            : [{ title: event.vnTitle ?? event.name, scene: event.vnScene ?? "", speaker: event.vnSpeaker ?? "Narrator", dialogue: event.dialogue, image: event.image ?? "" }];

        setEventPageCount(Math.min(10, Math.max(1, pages.length)));
        setEventVnPages(Array.from({ length: 10 }, (_, index) => {
            const page = pages[index];
            return {
                title: page?.title ?? `Story Page ${index + 1}`,
                scene: page?.scene ?? "",
                speaker: page?.speaker ?? "Narrator",
                dialogue: page?.dialogue?.join("\n") ?? "",
                image: page?.image ?? "",
                choices: page?.choices ?? [],
            };
        }));
    }

    function createAdminEvent() {
        const event = eventFromForm();
        setCreatorEvents([...creatorEvents, event]);
        alert(`${event.name} created and imported to World Map.`);
    }

    function saveAdminEventEdit() {
        if (!editingEventId) return alert("Load an existing admin event first.");
        const updatedEvent = eventFromForm(editingEventId);
        setCreatorEvents(creatorEvents.some((event) => event.id === editingEventId)
            ? creatorEvents.map((event) => event.id === editingEventId ? updatedEvent : event)
            : [...creatorEvents, updatedEvent]);
        alert(`${updatedEvent.name} updated.`);
    }

    function missionFromForm(id = `mission-${makeId()}`): CreatorMission {
        return {
            id,
            name: missionName.trim() || "Sector Fetch Mission",
            rank: missionRank,
            description: missionDescription.trim() || "Explore the assigned sector and return to claim the reward.",
            type: "fetchExplore",
            aiProfileId: missionAiProfileId || undefined,
            targetSector: Math.max(1, Math.min(60, Number(missionTargetSector))),
            exploreCount: Math.max(1, Number(missionExploreCount)),
            levelReq: Math.max(1, Math.min(MAX_LEVEL, Number(missionLevelReq))),
            xpReward: Math.max(0, Number(missionXp)),
            ryoReward: Math.max(0, Number(missionRyo)),
            staminaReward: Math.max(0, Number(missionStamina)),
            currencyRewards: singleCurrencyReward(missionRewardCurrency, missionRewardCurrencyAmount),
        };
    }

    function loadAdminMission(mission: CreatorMission) {
        setEditingMissionId(mission.id);
        setMissionName(mission.name);
        setMissionRank(mission.rank);
        setMissionDescription(mission.description);
        setMissionAiProfileId(mission.aiProfileId ?? "");
        setMissionTargetSector(mission.targetSector);
        setMissionExploreCount(mission.exploreCount);
        setMissionLevelReq(mission.levelReq);
        setMissionXp(mission.xpReward);
        setMissionRyo(mission.ryoReward);
        setMissionStamina(mission.staminaReward);
        const missionCurrencyReward = firstCurrencyReward(mission.currencyRewards);
        setMissionRewardCurrency(missionCurrencyReward.key);
        setMissionRewardCurrencyAmount(missionCurrencyReward.amount);
    }

    function createAdminMission() {
        const mission = missionFromForm();
        setCreatorMissions([...creatorMissions, mission]);
        alert(`${mission.name} created and added to Mission Hall.`);
    }

    function saveAdminMissionEdit() {
        if (!editingMissionId) return alert("Load an existing mission first.");
        const mission = missionFromForm(editingMissionId);
        setCreatorMissions(creatorMissions.some((existing) => existing.id === mission.id)
            ? creatorMissions.map((existing) => existing.id === mission.id ? mission : existing)
            : [...creatorMissions, mission]);
        alert(`${mission.name} updated.`);
    }

    function raidFromForm(id = `raid-${makeId()}`): CreatorRaid {
        return {
            id,
            name: raidName.trim() || "Shadow Boss Raid",
            biome: raidBiome,
            icon: raidIcon || "💀",
            levelReq: Math.max(1, Number(raidLevelReq)),
            aiProfileId: raidAiProfileId || undefined,
            waves: Math.max(1, Math.min(10, Number(raidWaves))),
            xpReward: Math.max(0, Number(raidXp)),
            ryoReward: Math.max(0, Number(raidRyo)),
            staminaReward: Math.max(0, Number(raidStamina)),
            currencyRewards: singleCurrencyReward(raidRewardCurrency, raidRewardCurrencyAmount),
            description: raidDescription.trim() || "Defeat all waves to claim the reward.",
        };
    }

    function loadAdminRaid(raid: CreatorRaid) {
        setEditingRaidId(raid.id);
        setRaidName(raid.name);
        setRaidBiome(raid.biome);
        setRaidIcon(raid.icon);
        setRaidLevelReq(raid.levelReq);
        setRaidAiProfileId(raid.aiProfileId ?? "");
        setRaidWaves(raid.waves);
        setRaidXp(raid.xpReward);
        setRaidRyo(raid.ryoReward);
        setRaidStamina(raid.staminaReward);
        const raidCurrencyReward = firstCurrencyReward(raid.currencyRewards);
        setRaidRewardCurrency(raidCurrencyReward.key);
        setRaidRewardCurrencyAmount(raidCurrencyReward.amount);
        setRaidDescription(raid.description);
    }

    function createAdminRaid() {
        const raid = raidFromForm();
        setCreatorRaids([...creatorRaids, raid]);
        alert(`${raid.name} created.`);
    }

    function saveAdminRaidEdit() {
        if (!editingRaidId) return alert("Load an existing raid first.");
        const raid = raidFromForm(editingRaidId);
        setCreatorRaids(creatorRaids.some((r) => r.id === editingRaidId)
            ? creatorRaids.map((r) => r.id === editingRaidId ? raid : r)
            : [...creatorRaids, raid]);
        setEditingRaidId(raid.id);
        alert(`${raid.name} updated.`);
    }

    function aiFromForm(id = `ai-${makeId()}`): CreatorAi {
        return normalizeAiProfile({
            id,
            name: aiName.trim() || "Custom Arena AI",
            icon: aiIcon.trim() || "EN",
            image: aiImage || undefined,
            level: Number(aiLevel),
            village: aiVillage.trim() || "Admin Arena",
            hp: Number(aiHp),
            chakra: Number(aiChakra),
            stamina: Number(aiStamina),
            stats: aiStats,
            jutsuIds: aiJutsuIds,
            rules: aiRules,
        }, allGameJutsus);
    }

    function loadAdminAi(ai: CreatorAi) {
        const normalized = normalizeAiProfile(ai, allGameJutsus);
        setEditingAiId(normalized.id);
        setAiName(normalized.name);
        setAiIcon(normalized.icon);
        setAiImage(normalized.image ?? "");
        setAiLevel(normalized.level);
        setAiVillage(normalized.village);
        setAiHp(normalized.hp);
        setAiChakra(normalized.chakra);
        setAiStamina(normalized.stamina);
        setAiStats(normalized.stats);
        setAiJutsuIds(normalized.jutsuIds);
        setAiRules(normalized.rules);
        setSelectedAiId(normalized.id);
    }

    function saveAdminAi() {
        const ai = aiFromForm(editingAiId || undefined);
        setCreatorAis(creatorAis.some((existing) => existing.id === ai.id)
            ? creatorAis.map((existing) => existing.id === ai.id ? ai : existing)
            : [...creatorAis, ai]);
        setEditingAiId(ai.id);
        setSelectedAiId(ai.id);
        alert(`${ai.name} saved.`);
    }

    function updateAiStat(stat: keyof Stats, value: number) {
        setAiStats((stats) => ({ ...stats, [stat]: capStat(value) }));
    }

    function updateAiRule(index: number, updated: Partial<AiRule>) {
        setAiRules((rules) => rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...updated } : rule));
    }

    function applyBasicCombatAiPreset() {
        const selectedJutsus = allGameJutsus.filter((jutsu) => aiJutsuIds.includes(jutsu.id));
        setAiRules(buildBasicCombatAiRules(selectedJutsus));
        alert("Basic Combat AI rules applied from the selected jutsus.");
    }

    function loadAdminBloodline(bloodline: SavedBloodline) {
        setEditingBloodlineId(bloodline.id);
        setBloodlineEditName(bloodline.name);
        setBloodlineEditRank(bloodline.rank);
        setBloodlineEditElement(bloodline.specialElement ?? "");
        setBloodlineEditImage(bloodline.image ?? "");
    }

    function saveAdminBloodlineEdit() {
        if (!editingBloodlineId) return alert("Load an existing bloodline first.");
        const sourceBloodline = allEditableBloodlines.find((bloodline) => bloodline.id === editingBloodlineId);
        if (!sourceBloodline) return alert("Loaded bloodline was not found.");
        const updatedBloodline: SavedBloodline = {
            ...sourceBloodline,
            id: savedBloodlines.some((bloodline) => bloodline.id === editingBloodlineId) ? editingBloodlineId : `bloodline-${makeId()}`,
            name: bloodlineEditName.trim() || sourceBloodline.name,
            rank: bloodlineEditRank,
            specialElement: bloodlineEditElement.trim(),
            image: bloodlineEditImage,
        };
        setSavedBloodlines(savedBloodlines.some((bloodline) => bloodline.id === editingBloodlineId)
            ? savedBloodlines.map((bloodline) => bloodline.id === editingBloodlineId ? updatedBloodline : bloodline)
            : [...savedBloodlines, updatedBloodline]);
        setEditingBloodlineId(updatedBloodline.id);
        setSelectedBloodlineId(updatedBloodline.id);
        alert(`${bloodlineEditName || "Bloodline"} updated.`);
    }

    function setLevel(level: number) {
        const nextLevel = Math.max(1, Math.min(MAX_LEVEL, level));
        const nextMaxHp = maxHpForLevel(nextLevel);
        const nextMaxChakra = maxChakraForLevel(nextLevel);
        const nextMaxStamina = maxStaminaForLevel(nextLevel);
        updateCharacter({
            ...character,
            level: nextLevel,
            xp: 0,
            rankTitle: rankFromLevel(nextLevel),
            maxHp: nextMaxHp,
            hp: nextMaxHp,
            maxChakra: nextMaxChakra,
            chakra: nextMaxChakra,
            maxStamina: nextMaxStamina,
            stamina: nextMaxStamina,
            unspentStats: character.unspentStats + nextLevel * 5,
        });
    }

    function maxResources() {
        updateCharacter({ ...character, hp: character.maxHp, chakra: character.maxChakra, stamina: character.maxStamina, ryo: character.ryo + 10000, auraDust: (character.auraDust ?? 0) + 1000 });
    }

    const [adminSaving, setAdminSaving] = useState(false);
    const [adminSaveMsg, setAdminSaveMsg] = useState("");
    async function handleAdminSave() {
        setAdminSaving(true); setAdminSaveMsg("");
        try { await onSave(); setAdminSaveMsg("Saved!"); }
        catch { setAdminSaveMsg("Save failed."); }
        setAdminSaving(false);
        setTimeout(() => setAdminSaveMsg(""), 3000);
    }

    return (
        <div className="card admin-panel global-menu-panel">
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>🛠️ Admin Panel</h2>
                <button className="village-save-btn" onClick={handleAdminSave} disabled={adminSaving} style={{ marginLeft: "auto" }}>
                    {adminSaving ? "Saving…" : "💾 Save"}
                </button>
                {adminSaveMsg && <span className="village-save-msg">{adminSaveMsg}</span>}
            </div>
            <p>Anything created here is saved and imported into normal gameplay.</p>

            <div className="admin-panel-switcher">
                <button className={activeAdminPanel === "jutsuBloodlines" ? "active" : ""} onClick={() => setActiveAdminPanel("jutsuBloodlines")}>
                    Jutsus + Bloodlines
                </button>
                <button className={activeAdminPanel === "eventsRaids" ? "active" : ""} onClick={() => { setActiveAdminPanel("eventsRaids"); setEventKind("reward"); }}>
                    Events / Missions / Raids
                </button>
                <button className={activeAdminPanel === "visualNovels" ? "active" : ""} onClick={() => { setActiveAdminPanel("visualNovels"); setEventKind("visualNovel"); }}>
                    Visual Novels
                </button>
                <button className={activeAdminPanel === "aiCreator" ? "active" : ""} onClick={() => setActiveAdminPanel("aiCreator")}>
                    AI Creator
                </button>

                <button className={activeAdminPanel === "petEditor" ? "active" : ""} onClick={() => setActiveAdminPanel("petEditor")}>
                    Pet Editor
                </button>
                <button className={activeAdminPanel === "cardEditor" ? "active" : ""} onClick={() => setActiveAdminPanel("cardEditor")}>
                    Card Editor
                </button>
                <button className={activeAdminPanel === "villageLeaders" ? "active" : ""} onClick={() => setActiveAdminPanel("villageLeaders")}>
                    Village Leaders
                </button>
            </div>

            <div className="admin-grid">
                <section className="summary-box">
                    <h3>Testing Tools</h3>
                    <p>Current: Level {character.level} | {character.rankTitle}</p>
                    <div className="menu">{[1, 10, 30, 50, 70, 90, 100].map((level) => <button key={level} onClick={() => setLevel(level)}>Level {level}</button>)}</div>
                    <button onClick={maxResources}>Max Resources + 10,000 Ryo</button>
                </section>
            </div>

            {activeAdminPanel === "villageLeaders" && (
                <div className="admin-subpanel">
                    <div className="admin-panel-heading">
                        <h3>Village Leaders</h3>
                        <p>Add portraits for every village Kage and Elder. These appear in each village's Town Hall.</p>
                    </div>
                    {Object.entries(villageLeadership).map(([village, leadership]) => {
                        const images = leadershipImages[village] ?? { kage: "", elders: ["", "", ""] };
                        return (
                            <section className="summary-box village-leader-section" key={village}>
                                <h3>{village}</h3>
                                <div className="leader-admin-grid">
                                    <div className="leader-admin-card">
                                        <h4>Kage</h4>
                                        <strong>{leadership.kage}</strong>
                                        {images.kage ? <img src={images.kage} alt={leadership.kage} /> : <div className="leader-image-placeholder">No Image</div>}
                                        <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) readImageFile(file, (image) => updateLeadershipImage(village, "kage", image), 100); }} />
                                        <div className="menu">
                                            <AiImagePrompt label="Kage Image" suggestedPrompt={`${leadership.kage}, shinobi village leader portrait`} onImage={(image) => updateLeadershipImage(village, "kage", image)} />
                                            {images.kage && <button className="danger-button" onClick={() => updateLeadershipImage(village, "kage", "")}>Remove Image</button>}
                                        </div>
                                    </div>
                                    {leadership.elders.map((elder, index) => (
                                        <div className="leader-admin-card" key={elder}>
                                            <h4>{index === 0 ? "War Elder" : index === 1 ? "Trade Elder" : "Training Elder"}</h4>
                                            <strong>{elder}</strong>
                                            {images.elders?.[index] ? <img src={images.elders[index]} alt={elder} /> : <div className="leader-image-placeholder">No Image</div>}
                                            <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) readImageFile(file, (image) => updateLeadershipImage(village, index, image), 100); }} />
                                            <div className="menu">
                                                <AiImagePrompt label="Elder Image" suggestedPrompt={`${elder}, shinobi village elder portrait`} onImage={(image) => updateLeadershipImage(village, index, image)} />
                                                {images.elders?.[index] && <button className="danger-button" onClick={() => updateLeadershipImage(village, index, "")}>Remove Image</button>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}

            {activeAdminPanel === "jutsuBloodlines" && (
                <div className="admin-subpanel">
                    <div className="admin-panel-heading">
                        <h3>Jutsus + Bloodlines</h3>
                        <p>Create, edit, import, equip, and organize combat techniques and bloodline kits.</p>
                    </div>
                    <div className="admin-grid">
                        <section className="summary-box">
                            <h3>Full Jutsu Builder</h3>
                            <label>Name</label><input value={jutsuName} onChange={(e) => setJutsuName(e.target.value)} />
                            <label>Description / Flavor Text</label>
                            <textarea
                                value={jutsuDescription}
                                onChange={(e) => setJutsuDescription(e.target.value)}
                                rows={4}
                                placeholder="Describe what the jutsu does, how it looks, and its combat flavor."
                            />

                            <label>Jutsu Image</label>
                            <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    readImageFile(file, applyJutsuImage, 200);
                                }}
                            />
                            <AiImagePrompt label="Jutsu Image" suggestedPrompt={`${jutsuElement} ${jutsuType} technique, ${jutsuName}`} onImage={applyJutsuImage} />

                            {jutsuImage && (
                                <div className="admin-jutsu-preview">
                                    <img src={jutsuImage} alt="Jutsu preview" />
                                </div>
                            )}

                            <label>
                                <input
                                    type="checkbox"
                                    checked={damageTagEnabled}
                                    onChange={(e) => setDamageTagEnabled(e.target.checked)}
                                />
                                Add Damage Tag
                            </label>

                            {damageTagEnabled && (
                                <>
                                    <label>Damage Effect Power</label>
                                    <input
                                        type="number"
                                        value={damageEffectPower}
                                        onChange={(e) => setDamageEffectPower(Number(e.target.value))}
                                    />
                                </>
                            )}
                            <label>Type / Element</label>
                            <div className="inline-grid">
                                <select value={jutsuType} onChange={(e) => setJutsuType(e.target.value as JutsuType)}>{specialties.map((type) => <option key={type}>{type}</option>)}</select>
                                <select value={jutsuElement} onChange={(e) => setJutsuElement(e.target.value as JutsuElement)}>{jutsuElements.map((element) => <option key={element}>{element}</option>)}</select>
                            </div>
                            <label>Target / Method</label>
                            <div className="inline-grid">
                                <select value={jutsuTarget} onChange={(e) => setJutsuTarget(e.target.value as JutsuTarget)}>{jutsuTargets.map((target) => <option key={target}>{target}</option>)}</select>
                                <select value={jutsuMethod} onChange={(e) => setJutsuMethod(e.target.value as JutsuMethod)}>{jutsuMethods.map((method) => <option key={method}>{method}</option>)}</select>
                            </div>
                            <label>AP / Range / Effect Power / Cooldown</label>
                            <div className="inline-grid"><input type="number" value={jutsuAp} onChange={(e) => setJutsuAp(Number(e.target.value))} /><input type="number" value={jutsuRange} onChange={(e) => setJutsuRange(Number(e.target.value))} /><input type="number" value={jutsuEp} onChange={(e) => setJutsuEp(Number(e.target.value))} /><input type="number" value={jutsuCooldown} onChange={(e) => setJutsuCooldown(Number(e.target.value))} /></div>
                            <label>Health / Chakra / Stamina Cost</label>
                            <div className="inline-grid"><input type="number" value={healthCost} onChange={(e) => setHealthCost(Number(e.target.value))} /><input type="number" value={chakraCost} onChange={(e) => setChakraCost(Number(e.target.value))} /><input type="number" value={staminaCost} onChange={(e) => setStaminaCost(Number(e.target.value))} /></div>
                            <label>Health / Chakra / Stamina Cost Reduction Per Level</label>
                            <div className="inline-grid"><input type="number" value={healthCostReducePerLvl} onChange={(e) => setHealthCostReducePerLvl(Number(e.target.value))} /><input type="number" value={chakraCostReducePerLvl} onChange={(e) => setChakraCostReducePerLvl(Number(e.target.value))} /><input type="number" value={staminaCostReducePerLvl} onChange={(e) => setStaminaCostReducePerLvl(Number(e.target.value))} /></div>
                            <label>Tags</label>
                            <TagPicker tag={tag1} setTag={setTag1} percent={tag1Percent} setPercent={setTag1Percent} />
                            <TagPicker tag={tag2} setTag={setTag2} percent={tag2Percent} setPercent={setTag2Percent} />
                            <TagPicker tag={tag3} setTag={setTag3} percent={tag3Percent} setPercent={setTag3Percent} />
                            <TagPicker tag={tag4} setTag={setTag4} percent={tag4Percent} setPercent={setTag4Percent} />
                            <div className="menu">
                                <button onClick={createAdminJutsu}>Create + Import Jutsu</button>
                                <button onClick={saveAdminJutsuEdit}>Save Loaded Jutsu</button>
                            </div>
                            {editingJutsuId && <p className="hint">Editing jutsu: {editingJutsuId}</p>}
                        </section>

                    </div>
                </div>
            )}

            {activeAdminPanel === "eventsRaids" && (
                <div className="admin-subpanel">
                    <div className="admin-panel-heading">
                        <h3>Events / Missions / Raids</h3>
                        <p>Build world map reward events, fetch missions, and raid encounters.</p>
                    </div>
                    <div className="admin-grid">
                        <section className="summary-box">
                            <h3>World Event Builder</h3>
                            <label>Event Name</label><input value={eventName} onChange={(e) => setEventName(e.target.value)} />
                            <label>AI To Fight</label><select value={eventAiProfileId} onChange={(e) => setEventAiProfileId(e.target.value)}><option value="">Default Arena AI</option>{allAdminAis.map((ai) => <option key={ai.id} value={ai.id}>{ai.name} | Level {ai.level}</option>)}</select>
                            <label>Trigger</label><select value={eventTrigger} onChange={(e) => setEventTrigger(e.target.value as "manual" | "firstBattleArena" | "firstLeaveVillage")}><option value="manual">Manual: World Map Admin Event</option><option value="firstBattleArena">First time clicking Battle Arena</option><option value="firstLeaveVillage">First time leaving the Village</option></select>
                            <label>Biome</label><select value={eventBiome} onChange={(e) => setEventBiome(e.target.value as Biome)}><option value="central">central</option><option value="forest">forest</option><option value="volcano">volcano</option><option value="snow">snow</option><option value="shadow">shadow</option></select>
                            <label>Icon</label><input value={eventIcon} onChange={(e) => setEventIcon(e.target.value)} />
                            <label>Event Image</label>
                            <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, applyEventImage, 100); }} />
                            <AiImagePrompt label="Event Image" suggestedPrompt={`${eventBiome} world event scene, ${eventName}`} onImage={applyEventImage} />
                            {eventImage && (<div className="admin-jutsu-preview admin-event-preview"><img src={eventImage} alt="Event preview" /><button className="danger-button" onClick={() => applyEventImage("")}>Remove Image</button></div>)}
                            <label>Level / XP / Ryo / Stamina</label>
                            <div className="inline-grid"><input type="number" value={eventLevelReq} onChange={(e) => setEventLevelReq(Number(e.target.value))} /><input type="number" value={eventXp} onChange={(e) => setEventXp(Number(e.target.value))} /><input type="number" value={eventRyo} onChange={(e) => setEventRyo(Number(e.target.value))} /><input type="number" value={eventStamina} onChange={(e) => setEventStamina(Number(e.target.value))} /></div>
                            <label>Bonus Currency Reward</label>
                            <div className="inline-grid">
                                <select value={eventRewardCurrency} onChange={(e) => setEventRewardCurrency(e.target.value as RewardCurrencyKey)}>
                                    {rewardCurrencyOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                                </select>
                                <input type="number" min={0} value={eventRewardCurrencyAmount} onChange={(e) => setEventRewardCurrencyAmount(Number(e.target.value))} />
                            </div>
                            <label>Dialogue</label><textarea value={eventDialogue} onChange={(e) => setEventDialogue(e.target.value)} rows={5} />
                            <div className="menu">
                                <button onClick={createAdminEvent}>Create + Import Event</button>
                                <button onClick={saveAdminEventEdit}>Save Loaded Event</button>
                            </div>
                            {editingEventId && <p className="hint">Editing event: {editingEventId}</p>}
                        </section>
                        <section className="summary-box">
                            <h3>Mission Editor</h3>
                            <p className="hint">Fetch quests send players to a numbered world sector and count each Explore Tile action.</p>
                            <label>Mission Name</label><input value={missionName} onChange={(e) => setMissionName(e.target.value)} />
                            <label>Mission Board</label>
                            <select value={missionRank} onChange={(e) => setMissionRank(e.target.value as MissionRank)}>
                                {missionRanks.map((rank) => <option key={rank}>{rank}</option>)}
                            </select>
                            <label>Description</label><textarea value={missionDescription} onChange={(e) => setMissionDescription(e.target.value)} rows={3} />
                            <label>AI To Fight</label>
                            <select value={missionAiProfileId} onChange={(e) => setMissionAiProfileId(e.target.value)}>
                                <option value="">No mission battle AI</option>
                                {allAdminAis.map((ai) => <option key={ai.id} value={ai.id}>{ai.name} | Level {ai.level}</option>)}
                            </select>
                            <label>Target Sector / Explore Count</label>
                            <div className="inline-grid">
                                <input type="number" min={1} max={60} value={missionTargetSector} onChange={(e) => setMissionTargetSector(Number(e.target.value))} />
                                <input type="number" min={1} value={missionExploreCount} onChange={(e) => setMissionExploreCount(Number(e.target.value))} />
                            </div>
                            <label>Level / XP / Ryo / Stamina Reward</label>
                            <div className="inline-grid">
                                <input type="number" min={1} max={MAX_LEVEL} value={missionLevelReq} onChange={(e) => setMissionLevelReq(Number(e.target.value))} />
                                <input type="number" min={0} value={missionXp} onChange={(e) => setMissionXp(Number(e.target.value))} />
                                <input type="number" min={0} value={missionRyo} onChange={(e) => setMissionRyo(Number(e.target.value))} />
                                <input type="number" min={0} value={missionStamina} onChange={(e) => setMissionStamina(Number(e.target.value))} />
                            </div>
                            <label>Bonus Currency Reward</label>
                            <div className="inline-grid">
                                <select value={missionRewardCurrency} onChange={(e) => setMissionRewardCurrency(e.target.value as RewardCurrencyKey)}>
                                    {rewardCurrencyOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                                </select>
                                <input type="number" min={0} value={missionRewardCurrencyAmount} onChange={(e) => setMissionRewardCurrencyAmount(Number(e.target.value))} />
                            </div>
                            <div className="menu">
                                <button onClick={createAdminMission}>Create Mission</button>
                                <button onClick={saveAdminMissionEdit}>Save Loaded Mission</button>
                            </div>
                            {editingMissionId && <p className="hint">Editing mission: {editingMissionId}</p>}
                            <h4>Created Missions</h4>
                            <div className="inline-grid">
                                <select value={missionRankFilter} onChange={(e) => setMissionRankFilter(e.target.value as "All" | MissionRank)}>
                                    <option value="All">All Mission Boards</option>
                                    {missionRanks.map((rank) => <option key={rank}>{rank}</option>)}
                                </select>
                            </div>
                            {sortedCreatorMissions.length === 0 ? <p className="hint">No custom missions yet.</p> : sortedCreatorMissions.map((mission) => (
                                <div className="summary-box mission-editor-card" key={mission.id}>
                                    <strong>{mission.rank}: {mission.name}</strong>
                                    <p>Sector {mission.targetSector} x {mission.exploreCount} explores | Level {mission.levelReq}</p>
                                    {mission.aiProfileId && <p>Battle AI: {allAdminAis.find((ai) => ai.id === mission.aiProfileId)?.name ?? mission.aiProfileId}</p>}
                                    <p>{mission.description}</p>
                                    <p>Reward: {rewardSummary(mission.xpReward, mission.ryoReward, mission.staminaReward, mission.currencyRewards)}</p>
                                    <div className="menu">
                                        <button onClick={() => loadAdminMission(mission)}>Edit</button>
                                        <button className="danger-button" onClick={() => setCreatorMissions(creatorMissions.filter((candidate) => candidate.id !== mission.id))}>Delete</button>
                                    </div>
                                </div>
                            ))}
                        </section>
                        <section className="summary-box">
                            <h3>Raid Creator</h3>
                            <p className="hint">Raids are boss encounters with multiple waves. Assign a boss AI and set escalating rewards.</p>
                            <label>Raid Name</label><input value={raidName} onChange={(e) => setRaidName(e.target.value)} />
                            <label>Description</label><textarea value={raidDescription} onChange={(e) => setRaidDescription(e.target.value)} rows={3} />
                            <label>Biome</label>
                            <select value={raidBiome} onChange={(e) => setRaidBiome(e.target.value as Biome)}>
                                <option value="central">central</option><option value="forest">forest</option><option value="volcano">volcano</option><option value="snow">snow</option><option value="shadow">shadow</option>
                            </select>
                            <label>Icon</label><input value={raidIcon} onChange={(e) => setRaidIcon(e.target.value)} />
                            <label>Boss AI</label>
                            <select value={raidAiProfileId} onChange={(e) => setRaidAiProfileId(e.target.value)}>
                                <option value="">Default Arena AI</option>
                                {allAdminAis.map((ai) => <option key={ai.id} value={ai.id}>{ai.name} | Level {ai.level}</option>)}
                            </select>
                            <label>Waves / Level Req / XP / Ryo / Stamina</label>
                            <div className="inline-grid">
                                <input type="number" min={1} max={10} value={raidWaves} onChange={(e) => setRaidWaves(Number(e.target.value))} placeholder="Waves" />
                                <input type="number" min={1} value={raidLevelReq} onChange={(e) => setRaidLevelReq(Number(e.target.value))} placeholder="Level" />
                                <input type="number" min={0} value={raidXp} onChange={(e) => setRaidXp(Number(e.target.value))} placeholder="XP" />
                                <input type="number" min={0} value={raidRyo} onChange={(e) => setRaidRyo(Number(e.target.value))} placeholder="Ryo" />
                                <input type="number" min={0} value={raidStamina} onChange={(e) => setRaidStamina(Number(e.target.value))} placeholder="Stamina" />
                            </div>
                            <label>Bonus Currency Reward</label>
                            <div className="inline-grid">
                                <select value={raidRewardCurrency} onChange={(e) => setRaidRewardCurrency(e.target.value as RewardCurrencyKey)}>
                                    {rewardCurrencyOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                                </select>
                                <input type="number" min={0} value={raidRewardCurrencyAmount} onChange={(e) => setRaidRewardCurrencyAmount(Number(e.target.value))} />
                            </div>
                            <div className="menu">
                                <button onClick={createAdminRaid}>Create Raid</button>
                                <button onClick={saveAdminRaidEdit}>Save Loaded Raid</button>
                            </div>
                            {editingRaidId && <p className="hint">Editing raid: {editingRaidId}</p>}
                            <h4>Created Raids</h4>
                            {creatorRaids.length === 0 ? <p className="hint">No raids yet.</p> : creatorRaids.map((raid) => (
                                <div className="summary-box mission-editor-card" key={raid.id}>
                                    <strong>{raid.icon} {raid.name}</strong>
                                    <p>{raid.waves} waves | {raid.biome} | Level {raid.levelReq}</p>
                                    {raid.aiProfileId && <p>Boss: {allAdminAis.find((ai) => ai.id === raid.aiProfileId)?.name ?? raid.aiProfileId}</p>}
                                    <p>{raid.description}</p>
                                    <p>Reward: {rewardSummary(raid.xpReward, raid.ryoReward, raid.staminaReward, raid.currencyRewards)}</p>
                                    <div className="menu">
                                        <button onClick={() => loadAdminRaid(raid)}>Edit</button>
                                        <button className="danger-button" onClick={() => setCreatorRaids(creatorRaids.filter((r) => r.id !== raid.id))}>Delete</button>
                                    </div>
                                </div>
                            ))}
                        </section>
                    </div>
                </div>
            )}

            {activeAdminPanel === "visualNovels" && (
                <div className="admin-subpanel">
                    <div className="admin-panel-heading">
                        <h3>Visual Novel Editor</h3>
                        <p>Create branching multi-page story scenes. Add choices at the end of any page to branch the narrative.</p>
                    </div>
                    <div className="admin-grid">
                        <section className="summary-box">
                            <h3>Visual Novel Builder</h3>
                            <label>VN Name</label><input value={eventName} onChange={(e) => setEventName(e.target.value)} />
                            <label>VN Title</label><input value={eventVnTitle} onChange={(e) => setEventVnTitle(e.target.value)} />
                            <label>Scene Description</label><textarea value={eventVnScene} onChange={(e) => setEventVnScene(e.target.value)} rows={3} />
                            <label>Default Speaker</label><input value={eventVnSpeaker} onChange={(e) => setEventVnSpeaker(e.target.value)} />
                            <label>AI To Fight (after VN)</label><select value={eventAiProfileId} onChange={(e) => setEventAiProfileId(e.target.value)}><option value="">Default Arena AI</option>{allAdminAis.map((ai) => <option key={ai.id} value={ai.id}>{ai.name} | Level {ai.level}</option>)}</select>
                            <label>Trigger</label><select value={eventTrigger} onChange={(e) => setEventTrigger(e.target.value as "manual" | "firstBattleArena" | "firstLeaveVillage")}><option value="manual">Manual: World Map</option><option value="firstBattleArena">First Battle Arena click</option><option value="firstLeaveVillage">First Village exit</option></select>
                            <label>Biome</label><select value={eventBiome} onChange={(e) => setEventBiome(e.target.value as Biome)}><option value="central">central</option><option value="forest">forest</option><option value="volcano">volcano</option><option value="snow">snow</option><option value="shadow">shadow</option></select>
                            <label>Icon</label><input value={eventIcon} onChange={(e) => setEventIcon(e.target.value)} />
                            <label>Backdrop Image</label>
                            <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, applyEventImage, 100); }} />
                            <AiImagePrompt label="VN Backdrop" suggestedPrompt={`${eventBiome} visual novel backdrop, ${eventName}`} onImage={applyEventImage} />
                            {eventImage && (<div className="admin-jutsu-preview admin-event-preview"><img src={eventImage} alt="Backdrop preview" /><button className="danger-button" onClick={() => applyEventImage("")}>Remove Image</button></div>)}
                            <label>Story Pages (1–10)</label><input type="number" min={1} max={10} value={eventPageCount} onChange={(e) => setEventPageCount(Math.max(1, Math.min(10, Number(e.target.value))))} />
                            <div className="admin-vn-page-list">
                                {eventVnPages.slice(0, eventPageCount).map((page, index) => (
                                    <div className="summary-box admin-vn-page" key={index}>
                                        <h4>Page {index + 1}</h4>
                                        <label>Page Title</label><input value={page.title} onChange={(e) => updateVnPage(index, { title: e.target.value })} />
                                        <label>Scene</label><textarea rows={2} value={page.scene} onChange={(e) => updateVnPage(index, { scene: e.target.value })} />
                                        <label>Speaker</label><input value={page.speaker} onChange={(e) => updateVnPage(index, { speaker: e.target.value })} />
                                        <label>Dialogue Lines</label>
                                        <textarea rows={4} value={page.dialogue} onChange={(e) => updateVnPage(index, { dialogue: e.target.value })} />
                                        <label>Page Image</label>
                                        <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, (image) => updateVnPage(index, { image }), 100); }} />
                                        <AiImagePrompt label={`Page ${index + 1} Image`} suggestedPrompt={`${page.title}, ${page.scene}`} onImage={(image) => updateVnPage(index, { image })} />
                                        {character.avatarImage && (
                                            <button style={{ marginTop: "0.3rem" }} onClick={() => updateVnPage(index, { image: character.avatarImage })}>
                                                Use Player Avatar
                                            </button>
                                        )}
                                        {page.image && (
                                            <div className="vn-page-img-preview">
                                                <img src={page.image} alt={`Page ${index + 1} preview`} />
                                                <button className="danger-button" onClick={() => updateVnPage(index, { image: "" })}>Remove Image</button>
                                            </div>
                                        )}
                                        <div className="summary-box">
                                            <h5>Choices (branch at end of page dialogue)</h5>
                                            <p className="hint">Each choice appears as a button after the last dialogue line. Leave empty to auto-advance. Page numbers are 1-based.</p>
                                            {page.choices.map((choice, ci) => (
                                                <div className="vn-choice-editor" key={ci}>
                                                    <div className="inline-grid">
                                                        <input
                                                            placeholder={`Choice ${ci + 1} button text`}
                                                            value={choice.text}
                                                            onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, text: e.target.value } : c) })}
                                                        />
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            max={eventPageCount}
                                                            placeholder="→ Page"
                                                            value={choice.nextPage + 1}
                                                            onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, nextPage: Math.max(0, Number(e.target.value) - 1) } : c) })}
                                                        />
                                                        <button className="danger-button" onClick={() => updateVnPage(index, { choices: page.choices.filter((_, i) => i !== ci) })}>✕</button>
                                                    </div>
                                                    <textarea
                                                        rows={2}
                                                        placeholder={`Conclusion / answer shown after "${choice.text || `Choice ${ci + 1}`}" is picked (optional)`}
                                                        value={choice.conclusion ?? ""}
                                                        onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, conclusion: e.target.value } : c) })}
                                                    />
                                                </div>
                                            ))}
                                            {page.choices.length < 4 && (
                                                <button onClick={() => updateVnPage(index, { choices: [...page.choices, { text: "", nextPage: Math.min(index + 1, eventPageCount - 1) }] })}>
                                                    + Add Choice
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="hint">Dialogue format: Speaker: Line text. Each line is a separate Next press.</p>
                            <label>Level / XP / Ryo / Stamina Reward</label>
                            <div className="inline-grid"><input type="number" value={eventLevelReq} onChange={(e) => setEventLevelReq(Number(e.target.value))} /><input type="number" value={eventXp} onChange={(e) => setEventXp(Number(e.target.value))} /><input type="number" value={eventRyo} onChange={(e) => setEventRyo(Number(e.target.value))} /><input type="number" value={eventStamina} onChange={(e) => setEventStamina(Number(e.target.value))} /></div>
                            <label>Bonus Currency Reward</label>
                            <div className="inline-grid">
                                <select value={eventRewardCurrency} onChange={(e) => setEventRewardCurrency(e.target.value as RewardCurrencyKey)}>
                                    {rewardCurrencyOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                                </select>
                                <input type="number" min={0} value={eventRewardCurrencyAmount} onChange={(e) => setEventRewardCurrencyAmount(Number(e.target.value))} />
                            </div>
                            <div className="menu">
                                <button onClick={createAdminEvent}>Create Visual Novel</button>
                                <button onClick={saveAdminEventEdit}>Save Loaded VN</button>
                                <button
                                    style={{ background: "#1e3a5f", borderColor: "#60a5fa" }}
                                    onClick={() => {
                                        const ev = eventFromForm();
                                        setPreviewVn(ev);
                                        setPreviewVnPage(0);
                                        setPreviewVnLine(0);
                                    }}
                                >
                                    ▶ Play Preview
                                </button>
                                <button
                                    style={{ background: "#2e4a1e", borderColor: "#a5d6a7" }}
                                    onClick={() => {
                                        setPetEncounterVn(eventFromForm("sys-pet-encounter"));
                                        alert("Pet Encounter VN saved! Players will see this scene when they find a pet.");
                                    }}
                                >
                                    💾 Save as Pet Encounter VN
                                </button>
                            </div>
                            {editingEventId && <p className="hint">Editing VN: {editingEventId}</p>}
                        </section>

                        <section className="summary-box">
                            <h4>🐾 Pet Encounter VN (System)</h4>
                            <p className="hint">This VN plays every time a player discovers a wild pet. Edit it above and click "Save as Pet Encounter VN".</p>
                            <p><strong>{petEncounterVn.vnTitle || petEncounterVn.name}</strong> — {petEncounterVn.vnPages?.length ?? 1} page(s)</p>
                            {petEncounterVn.vnPages?.map((page, i) => (
                                <div key={i} className="summary-box" style={{ marginBottom: "0.4rem" }}>
                                    <strong>Page {i + 1}: {page.title}</strong>
                                    <p style={{ color: "#aaa", fontSize: 12 }}>{page.scene}</p>
                                </div>
                            ))}
                            <div className="menu">
                                <button onClick={() => loadAdminEvent(petEncounterVn)}>Load for Editing</button>
                                <button
                                    style={{ background: "#1e3a5f", borderColor: "#60a5fa" }}
                                    onClick={() => {
                                        setPreviewVn(petEncounterVn);
                                        setPreviewVnPage(0);
                                        setPreviewVnLine(0);
                                    }}
                                >
                                    ▶ Preview Pet VN
                                </button>
                                <button onClick={() => { setPetEncounterVn(defaultPetEncounterVn); alert("Pet Encounter VN reset to default."); }}>Reset to Default</button>
                            </div>
                        </section>
                    </div>
                </div>
            )}

            {/* ── VN Preview Overlay ─────────────────────────────────── */}
            {previewVn && (
                <div className="vn-preview-overlay">
                    <div className="vn-preview-modal">
                        <div className="vn-preview-topbar">
                            <span className="vn-preview-label">🎬 Preview Mode — this is how players will see it</span>
                            <button className="danger-button" onClick={() => setPreviewVn(null)}>✕ Close Preview</button>
                        </div>
                        <TriggeredVisualNovel
                            event={previewVn}
                            character={character}
                            pageIndex={previewVnPage}
                            lineIndex={previewVnLine}
                            setPageIndex={setPreviewVnPage}
                            setLineIndex={setPreviewVnLine}
                            onCancel={() => setPreviewVn(null)}
                            onComplete={() => setPreviewVn(null)}
                            setScreen={() => setPreviewVn(null)}
                            setCurrentBiome={() => { }}
                            setCurrentWeather={() => { }}
                            setPendingAiProfileId={() => { }}
                        />
                    </div>
                </div>
            )}

            {activeAdminPanel === "aiCreator" && (
                <div className="admin-subpanel">
                    <div className="admin-panel-heading">
                        <h3>AI Creator</h3>
                        <p>Design custom arena opponents, assign jutsus, and tune combat decision rules.</p>
                    </div>
                    <h3>AI Battle Builder</h3>
                    <section className="summary-box">
                        <label>Find Saved AI</label>
                        {allAdminAis.length === 0 ? <p className="hint">No AI profiles yet. Build one below and save it.</p> : (
                            <>
                                <select value={selectedAdminAiProfile?.id ?? ""} onChange={(e) => setSelectedAiId(e.target.value)}>
                                    {allAdminAis.map((ai) => <option key={ai.id} value={ai.id}>{ai.name} | Level {ai.level} | {ai.rules.length} rules{builtinAis.some((builtin) => builtin.id === ai.id) ? " | Built-in" : ""}</option>)}
                                </select>
                                {selectedAdminAiProfile && <div className="summary-box ai-selected-preview">{selectedAdminAiProfile.image ? <img src={selectedAdminAiProfile.image} alt={selectedAdminAiProfile.name} /> : <span>{selectedAdminAiProfile.icon}</span>}<div><strong>{selectedAdminAiProfile.name}</strong><p>{selectedAdminAiProfile.village} | Level {selectedAdminAiProfile.level}</p><div className="menu"><button onClick={() => loadAdminAi(selectedAdminAiProfile)}>Load AI</button>{!builtinAis.some((builtin) => builtin.id === selectedAdminAiProfile.id) && <button className="danger-button" onClick={() => setCreatorAis(creatorAis.filter((ai) => ai.id !== selectedAdminAiProfile.id))}>Delete AI</button>}</div></div></div>}
                            </>
                        )}

                        <div className="inline-grid">
                            <div><label>AI Name</label><input value={aiName} onChange={(e) => setAiName(e.target.value)} /></div>
                            <div><label>Icon / Initials</label><input value={aiIcon} onChange={(e) => setAiIcon(e.target.value)} /></div>
                            <div><label>Level</label><input type="number" min={1} max={MAX_LEVEL} value={aiLevel} onChange={(e) => setAiLevel(Math.max(1, Math.min(MAX_LEVEL, Number(e.target.value))))} /></div>
                            <div><label>Village / Faction</label><input value={aiVillage} onChange={(e) => setAiVillage(e.target.value)} /></div>
                        </div>
                        <label>AI Image</label>
                        <p className="hint">Upload a portrait for this AI. It appears in the AI creator, mission battles, and combat HUD.</p>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                readImageFile(file, applyAiImage, 100);
                            }}
                        />
                        <AiImagePrompt label="AI Image" suggestedPrompt={`${aiName}, ${aiVillage} arena opponent portrait`} onImage={applyAiImage} />
                        {aiImage && (
                            <div className="admin-jutsu-preview ai-image-preview">
                                <img src={aiImage} alt={`${aiName} preview`} />
                                <button className="danger-button" onClick={() => applyAiImage("")}>Remove Image</button>
                            </div>
                        )}
                        <label>Health / Chakra / Stamina</label>
                        <div className="inline-grid"><input type="number" value={aiHp} onChange={(e) => setAiHp(Number(e.target.value))} /><input type="number" value={aiChakra} onChange={(e) => setAiChakra(Number(e.target.value))} /><input type="number" value={aiStamina} onChange={(e) => setAiStamina(Number(e.target.value))} /></div>

                        <h4>AI Stats</h4>
                        <div className="stat-grid">
                            {Object.entries(aiStats).map(([stat, value]) => (
                                <div className="summary-box stat-card" key={stat}>
                                    <label>{stat}</label>
                                    <input type="number" value={value} onChange={(e) => updateAiStat(stat as keyof Stats, Number(e.target.value))} />
                                </div>
                            ))}
                        </div>

                        <h4>AI Jutsus</h4>
                        <JutsuDropdownList
                            jutsus={allGameJutsus}
                            label="Add Jutsu To AI"
                            renderDetails={(jutsu) => <><p>{jutsu.type} | {jutsu.element} | {jutsu.ap} AP | R{jutsu.range} | EP {jutsu.effectPower}</p><p><strong>Effects:</strong> {describeJutsuEffects(jutsu)}</p></>}
                            renderActions={(jutsu) => <button disabled={aiJutsuIds.includes(jutsu.id)} onClick={() => setAiJutsuIds([...aiJutsuIds, jutsu.id])}>{aiJutsuIds.includes(jutsu.id) ? "Already Added" : "Add Jutsu"}</button>}
                        />
                        <div className="menu">
                            {aiJutsuIds.map((id) => {
                                const jutsu = allGameJutsus.find((candidate) => candidate.id === id);
                                return <button key={id} onClick={() => setAiJutsuIds(aiJutsuIds.filter((jutsuId) => jutsuId !== id))}>{jutsu?.name ?? id} x</button>;
                            })}
                        </div>

                        <h4>AI Rules</h4>
                        <div className="summary-box ai-preset-card">
                            <strong>Basic Combat AI</strong>
                            <p>Builds a practical rule set from selected jutsus: move into range, open with control, use defensive self jutsus when hurt, then attack with the strongest available technique.</p>
                            <button onClick={applyBasicCombatAiPreset}>Apply Basic Combat AI</button>
                        </div>
                        {aiRules.map((rule, index) => (
                            <div className="summary-box" key={rule.id}>
                                <strong>Rule {index + 1}: {rule.condition} -&gt; {rule.action}</strong>
                                <div className="inline-grid">
                                    <select value={rule.condition} onChange={(e) => updateAiRule(index, { condition: e.target.value as AiCondition })}>
                                        <option value="always">always</option>
                                        <option value="specific_round">specific_round</option>
                                        <option value="distance_lower_than">distance_lower_than</option>
                                        <option value="distance_higher_than">distance_higher_than</option>
                                        <option value="hp_lower_than">hp_lower_than</option>
                                    </select>
                                    <input type="number" value={rule.value} onChange={(e) => updateAiRule(index, { value: Number(e.target.value) })} />
                                    <select value={rule.action} onChange={(e) => updateAiRule(index, { action: e.target.value as AiAction })}>
                                        <option value="use_specific_jutsu">use_specific_jutsu</option>
                                        <option value="use_highest_power_jutsu">use_highest_power_jutsu</option>
                                        <option value="move_towards_opponent">move_towards_opponent</option>
                                        <option value="use_basic_attack">use_basic_attack</option>
                                    </select>
                                    <select value={rule.jutsuId ?? ""} onChange={(e) => updateAiRule(index, { jutsuId: e.target.value || undefined })}>
                                        <option value="">No Specific Jutsu</option>
                                        {aiJutsuIds.map((id) => {
                                            const jutsu = allGameJutsus.find((candidate) => candidate.id === id);
                                            return <option key={id} value={id}>{jutsu?.name ?? id}</option>;
                                        })}
                                    </select>
                                </div>
                                <div className="menu"><button onClick={() => setAiRules(aiRules.map((candidate, candidateIndex) => candidateIndex === index - 1 ? rule : candidateIndex === index ? aiRules[index - 1] : candidate).filter(Boolean))} disabled={index === 0}>Move Up</button><button onClick={() => setAiRules(aiRules.map((candidate, candidateIndex) => candidateIndex === index + 1 ? rule : candidateIndex === index ? aiRules[index + 1] : candidate).filter(Boolean))} disabled={index === aiRules.length - 1}>Move Down</button><button className="danger-button" onClick={() => setAiRules(aiRules.filter((candidate) => candidate.id !== rule.id))}>Delete Rule</button></div>
                            </div>
                        ))}
                        <div className="menu"><button onClick={() => setAiRules([...aiRules, blankAiRule()])}>Add Rule</button><button onClick={saveAdminAi}>Save AI Profile</button></div>
                        {editingAiId && <p className="hint">Editing AI: {editingAiId}</p>}
                    </section>
                </div>
            )}

            {activeAdminPanel === "jutsuBloodlines" && (
                <div className="admin-subpanel">
                    <h3>Jutsu Editor: All Existing Jutsus</h3>
                    <JutsuDropdownList
                        jutsus={allGameJutsus}
                        label="Find Jutsu"
                        renderDetails={(jutsu) => (
                            <>
                                <p>{jutsu.type} | {jutsu.element} | {jutsu.ap} AP | R{jutsu.range} | EP {jutsu.effectPower} | CD {jutsu.cooldown}</p>
                                <p>Tags: {jutsu.tags.map((tag) => `${tag.name}${percentageTags.includes(tag.name) ? ` ${tag.percent}%` : ""}`).join(", ") || "None"}</p>
                                <p><strong>Effects:</strong> {describeJutsuEffects(jutsu)}</p>
                            </>
                        )}
                        renderActions={(jutsu) => (
                            <>
                                <button onClick={() => loadAdminJutsu(jutsu)}>Load In Editor</button>
                                <button onClick={() => updateCharacter({ ...character, equippedJutsuIds: [...new Set([...character.equippedJutsuIds, jutsu.id])].slice(0, 15) })}>Equip</button>
                                {creatorJutsus.some((created) => created.id === jutsu.id) && <button className="danger-button" onClick={() => setCreatorJutsus(creatorJutsus.filter((created) => created.id !== jutsu.id))}>Delete Override</button>}
                            </>
                        )}
                    />
                    <section className="summary-box">
                        <h3>Equipment Item Builder</h3>

                        <label>Item Name</label>
                        <input value={itemName} onChange={(e) => setItemName(e.target.value)} />

                        <label>Section</label>
                        <select value={itemSlot} onChange={(e) => setItemSlot(e.target.value as EquipmentSlot)}>
                            {itemSectionOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>

                        <label>Rarity</label>
                        <select value={itemRarity} onChange={(e) => setItemRarity(e.target.value as GameItem["rarity"])}>
                            <option value="common">Common</option>
                            <option value="rare">Rare</option>
                            <option value="epic">Epic</option>
                            <option value="legendary">Legendary</option>
                            <option value="mythic">Mythic</option>
                        </select>

                        {isArmorSlot && (
                            <>
                                <label>Armor Quality</label>
                                <select value={itemArmorQuality} onChange={(e) => setItemArmorQuality(e.target.value as ArmorQuality | "")}>
                                    <option value="">— None —</option>
                                    {armorQualityTiers.map((t) => (
                                        <option key={t.quality} value={t.quality}>{t.label}</option>
                                    ))}
                                </select>
                            </>
                        )}

                        <label>Cost</label>
                        <input type="number" value={itemCost} onChange={(e) => setItemCost(Number(e.target.value))} />

                        <label>Description</label>
                        <textarea value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />

                        <label>Item Image</label>
                        <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, applyItemImage, 100); }} />
                        <AiImagePrompt label="Item Image" suggestedPrompt={`${itemName} ${itemRarity} equipment weapon ninja shinobi`} onImage={applyItemImage} />
                        {itemImage && (
                            <div className="admin-jutsu-preview">
                                <img src={itemImage} alt={itemName} />
                                <button className="danger-button" onClick={() => applyItemImage("")}>Remove Image</button>
                            </div>
                        )}

                        <label>Bonus Stat</label>
                        <select value={itemBonusStat} onChange={(e) => setItemBonusStat(e.target.value as keyof Stats)}>
                            {Object.keys(baseStats()).map((stat) => (
                                <option key={stat}>{stat}</option>
                            ))}
                        </select>

                        <label>Bonus Amount</label>
                        <input type="number" value={itemBonusAmount} onChange={(e) => setItemBonusAmount(Number(e.target.value))} />

                        {editingItemId && (
                            <p className="hint">Editing: <strong>{itemName}</strong>{starterItems.some((s) => s.id === editingItemId) ? " (starter item — save creates an override)" : ""}</p>
                        )}
                        <div className="menu">
                            <button onClick={createAdminItem}>{editingItemId ? "Save Item" : "Create Item"}</button>
                            {editingItemId && <button onClick={() => setEditingItemId("")}>Cancel Edit</button>}
                        </div>

                        {/* ── Bulk Item Image Generator ── */}
                        {(() => {
                            const allItems = getAllItems(creatorItems);
                            const slotOptions = ["all", ...Array.from(new Set(allItems.map(i => i.slot))).sort()];
                            const slotFiltered = itemBulkSlotFilter === "all"
                                ? allItems
                                : allItems.filter(i => i.slot === itemBulkSlotFilter);
                            const visibleItems = itemBulkSkipExisting
                                ? slotFiltered.filter(i => !i.image)
                                : slotFiltered;
                            const selCount = itemBulkSelections.length;
                            const pct = itemBulkProgress
                                ? Math.round((itemBulkProgress.current / itemBulkProgress.total) * 100)
                                : 0;
                            const rarityColor: Record<string, string> = {
                                common: "#94a3b8", rare: "#60a5fa", epic: "#c084fc",
                                legendary: "#fb923c", mythic: "#f472b6",
                            };
                            return (
                                <div className="bulk-image-section" style={{ marginTop: 14 }}>
                                    <div className="bulk-image-header" onClick={() => setItemBulkShowSection(v => !v)}>
                                        <span>🎨 Bulk Image Generator — Items / Armor / Weapons</span>
                                        <span className="bulk-image-chevron">{itemBulkShowSection ? "▲" : "▼"}</span>
                                    </div>

                                    {itemBulkShowSection && (
                                        <div className="bulk-image-body">
                                            {/* Options */}
                                            <div className="bulk-image-opts">
                                                <label className="bulk-image-toggle">
                                                    <input type="checkbox" checked={itemBulkSkipExisting}
                                                        onChange={e => { setItemBulkSkipExisting(e.target.checked); setItemBulkSelections([]); }} />
                                                    Show only items without images
                                                </label>
                                                <select
                                                    value={itemBulkSlotFilter}
                                                    onChange={e => { setItemBulkSlotFilter(e.target.value); setItemBulkSelections([]); }}
                                                    style={{ fontSize: "0.78rem", padding: "3px 6px", background: "#0f172a", color: "#cbd5e1", border: "1px solid #334155", borderRadius: 6 }}
                                                >
                                                    {slotOptions.map(s => (
                                                        <option key={s} value={s}>{s === "all" ? "All slots" : equipmentSlotLabel(s as EquipmentSlot)}</option>
                                                    ))}
                                                </select>
                                                <div className="bulk-image-quickbtns">
                                                    <button className="bulk-quick-btn" disabled={itemBulkRunning}
                                                        onClick={() => setItemBulkSelections(visibleItems.map(i => i.id))}>
                                                        Select All ({visibleItems.length})
                                                    </button>
                                                    <button className="bulk-quick-btn" disabled={itemBulkRunning}
                                                        onClick={() => setItemBulkSelections(allItems.filter(i => !i.image).map(i => i.id))}>
                                                        No Image Only
                                                    </button>
                                                    <button className="bulk-quick-btn" disabled={itemBulkRunning}
                                                        onClick={() => setItemBulkSelections([])}>
                                                        Deselect All
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Item list */}
                                            <div className="bulk-card-list">
                                                {visibleItems.length === 0 && (
                                                    <p className="hint" style={{ padding: "8px 0" }}>
                                                        {itemBulkSkipExisting ? "All items in this filter already have images." : "No items found."}
                                                    </p>
                                                )}
                                                {visibleItems.map(item => {
                                                    const checked = itemBulkSelections.includes(item.id);
                                                    const customPrompt = itemBulkCustomPrompts[item.id] ?? "";
                                                    const slotLabel = equipmentSlotLabel(item.slot);
                                                    const rc = rarityColor[item.rarity] ?? "#94a3b8";
                                                    return (
                                                        <div key={item.id} className={`bulk-card-row${checked ? " bulk-card-row--checked" : ""}`}>
                                                            <label className="bulk-card-check">
                                                                <input type="checkbox" checked={checked} disabled={itemBulkRunning}
                                                                    onChange={e => setItemBulkSelections(e.target.checked
                                                                        ? [...itemBulkSelections, item.id]
                                                                        : itemBulkSelections.filter(id => id !== item.id))} />
                                                            </label>
                                                            {item.image
                                                                ? <img src={item.image} alt={item.name} className="bulk-card-thumb" />
                                                                : <div className="bulk-card-thumb bulk-card-thumb--empty">?</div>
                                                            }
                                                            <div className="bulk-card-info">
                                                                <span className="bulk-card-name">{item.name}</span>
                                                                <span className="bulk-card-rarity" style={{ background: rc + "22", color: rc, border: `1px solid ${rc}44` }}>
                                                                    {item.rarity}
                                                                </span>
                                                                <span className="bulk-card-element">{slotLabel}</span>
                                                                {item.image && <span className="bulk-card-has-img">✓ has image</span>}
                                                            </div>
                                                            {checked && (
                                                                <input
                                                                    className="bulk-card-prompt-input"
                                                                    placeholder={`Auto: "${item.name} ${item.rarity} ${slotLabel} shinobi RPG art…"`}
                                                                    value={customPrompt}
                                                                    disabled={itemBulkRunning}
                                                                    onChange={e => setItemBulkCustomPrompts(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                                />
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Progress bar */}
                                            {itemBulkProgress && (
                                                <div className="bulk-progress-wrap">
                                                    <div className="bulk-progress-label">
                                                        Generating <strong>{itemBulkProgress.itemName}</strong> ({itemBulkProgress.current}/{itemBulkProgress.total})
                                                    </div>
                                                    <div className="bulk-progress-track">
                                                        <div className="bulk-progress-fill" style={{ width: `${pct}%` }} />
                                                    </div>
                                                </div>
                                            )}

                                            {/* Errors */}
                                            {itemBulkErrors.length > 0 && (
                                                <div className="bulk-error-list">
                                                    <strong style={{ color: "#f87171" }}>Errors ({itemBulkErrors.length}):</strong>
                                                    {itemBulkErrors.map(e => (
                                                        <div key={e.id} className="bulk-error-row">❌ <strong>{e.name}</strong>: {e.error}</div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Generate button */}
                                            <div className="menu" style={{ marginTop: 10 }}>
                                                <button
                                                    className="bulk-generate-btn"
                                                    disabled={itemBulkRunning || selCount === 0}
                                                    onClick={runBulkItemGeneration}
                                                >
                                                    {itemBulkRunning
                                                        ? `⏳ Generating… ${itemBulkProgress ? `${itemBulkProgress.current}/${itemBulkProgress.total}` : ""}`
                                                        : `🎨 Generate Images for ${selCount} Item${selCount !== 1 ? "s" : ""}`}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        <h4>All Items</h4>
                        {getAllItems(creatorItems).map((item) => {
                            const isCreator = creatorItems.some((c) => c.id === item.id);
                            return (
                                <div className={`equipment-item rarity-${item.rarity}`} key={item.id}
                                    style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                                    {item.image
                                        ? <img src={item.image} alt={item.name}
                                            style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, flexShrink: 0, border: "1px solid #334155" }} />
                                        : <div style={{ width: 48, height: 48, borderRadius: 6, background: "#0f172a", border: "1px dashed #334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>⚔️</div>
                                    }
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <strong>{item.name}</strong>
                                        <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "#94a3b8" }}>
                                            {equipmentSlotLabel(item.slot)} | {item.rarity} | {item.cost} {item.rarity === "legendary" || item.rarity === "mythic" ? "Fate Shards" : "ryo"}{isCreator ? " (admin)" : ""}
                                        </p>
                                        <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748b" }}>{item.description}</p>
                                    </div>
                                    <div className="menu" style={{ flexShrink: 0 }}>
                                        <button onClick={() => loadAdminItem(item)}>Load / Edit</button>
                                        {isCreator && (
                                            <button
                                                className="danger-button"
                                                onClick={() => { setCreatorItems(creatorItems.filter((i) => i.id !== item.id)); if (editingItemId === item.id) setEditingItemId(""); }}
                                            >
                                                Delete
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </section>
                    <h3>Bloodline Editor</h3>
                    <section className="summary-box">
                        <label>Loaded Bloodline Name</label><input value={bloodlineEditName} onChange={(e) => setBloodlineEditName(e.target.value)} />
                        <label>Rank</label><select value={bloodlineEditRank} onChange={(e) => setBloodlineEditRank(e.target.value as Rank)}><option>B Rank</option><option>A Rank</option><option>S Rank</option></select>
                        <label>Special Element</label><input value={bloodlineEditElement} onChange={(e) => setBloodlineEditElement(e.target.value)} />
                        <label>Bloodline Image URL</label><input value={bloodlineEditImage} onChange={(e) => applyBloodlineImage(e.target.value)} />
                        <AiImagePrompt label="Bloodline Image" suggestedPrompt={`${bloodlineEditName || "Bloodline"} ${bloodlineEditElement || "chakra"} clan art`} onImage={applyBloodlineImage} />
                        <button onClick={saveAdminBloodlineEdit}>Save Loaded Bloodline</button>
                        {editingBloodlineId && <p className="hint">Editing bloodline: {editingBloodlineId}</p>}
                    </section>
                    <section className="summary-box">
                        <label>Find Bloodline</label>
                        <div className="inline-grid">
                            <select value={bloodlineRankFilter} onChange={(e) => setBloodlineRankFilter(e.target.value as "All" | Rank)}>
                                <option value="All">All Ranks</option>
                                <option>B Rank</option>
                                <option>A Rank</option>
                                <option>S Rank</option>
                            </select>
                            <select value={bloodlineSort} onChange={(e) => setBloodlineSort(e.target.value as "name" | "rank" | "points" | "jutsus")}>
                                <option value="name">Sort: Name</option>
                                <option value="rank">Sort: Rank</option>
                                <option value="points">Sort: Points</option>
                                <option value="jutsus">Sort: Jutsu Count</option>
                            </select>
                        </div>
                        {sortedBloodlines.length === 0 ? <div className="summary-box">No saved bloodlines yet.</div> : (
                            <>
                                <select value={selectedBloodline?.id ?? ""} onChange={(e) => setSelectedBloodlineId(e.target.value)}>
                                    {sortedBloodlines.map((bloodline) => <option key={bloodline.id} value={bloodline.id}>{bloodline.name} | {bloodline.rank} | {bloodline.jutsus.length} jutsus</option>)}
                                </select>
                                {selectedBloodline && (
                                    <div className="summary-box">
                                        <strong>{selectedBloodline.name}</strong>
                                        <p>{selectedBloodline.rank} | {selectedBloodline.specialElement || "No special element"} | {selectedBloodline.jutsus.length} jutsus | Points {selectedBloodline.totalPoints}{starterSavedBloodlines.some((builtIn) => builtIn.id === selectedBloodline.id) ? " | Built-in" : ""}</p>
                                        {selectedBloodline.image && <div className="admin-event-list-preview"><img src={selectedBloodline.image} alt={selectedBloodline.name} /></div>}
                                        <div className="menu"><button onClick={() => loadAdminBloodline(selectedBloodline)}>Edit Bloodline</button>{savedBloodlines.some((candidate) => candidate.id === selectedBloodline.id) && <button className="danger-button" onClick={() => setSavedBloodlines(savedBloodlines.filter((candidate) => candidate.id !== selectedBloodline.id))}>Delete</button>}</div>
                                        <JutsuDropdownList
                                            jutsus={selectedBloodline.jutsus}
                                            label="Bloodline Jutsus"
                                            emptyText="No bloodline jutsus yet."
                                            renderDetails={(jutsu) => <><p>{jutsu.type} | {jutsu.element} | {jutsu.ap} AP | R{jutsu.range} | EP {jutsu.effectPower}</p><p><strong>Effects:</strong> {describeJutsuEffects(jutsu)}</p></>}
                                            renderActions={(jutsu) => <button onClick={() => loadAdminJutsu(jutsu)}>Edit Selected Jutsu</button>}
                                        />
                                    </div>
                                )}
                            </>
                        )}
                    </section>

                    <section className="summary-box">
                        <h4>Bulk Jutsu Image Generation</h4>
                        <p className="hint">Generates AI images for all jutsus that don't have a photo yet. Saves as overrides in Creator Jutsus.</p>
                        <p className="hint">Jutsus without images: <strong>{allGameJutsus.filter((j) => !j.image).length}</strong> / {allGameJutsus.length}</p>
                        <button disabled={jutsuIsGenerating} onClick={async () => {
                            const missing = allGameJutsus.filter((j) => !j.image);
                            if (missing.length === 0) { setJutsuGenStatus("All jutsus already have images!"); return; }
                            setJutsuIsGenerating(true);
                            let done = 0;
                            let updated = [...creatorJutsus];
                            for (const jutsu of missing) {
                                setJutsuGenStatus(`Generating ${jutsu.name}... (${done + 1}/${missing.length})`);
                                try {
                                    const res = await fetch("/api/generate-image", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ prompt: `${jutsu.name} ${jutsu.element} ${jutsu.type} ninja technique ability`, label: "Jutsu Image" }),
                                    });
                                    if (res.ok) {
                                        const data = await res.json();
                                        const withImage = { ...jutsu, image: data.image };
                                        const idx = updated.findIndex((c) => c.id === jutsu.id);
                                        if (idx >= 0) { updated[idx] = withImage; } else { updated = [...updated, withImage]; }
                                    }
                                } catch { /* skip */ }
                                done++;
                            }
                            setCreatorJutsus(updated);
                            setJutsuIsGenerating(false);
                            setJutsuGenStatus(`Done! Generated images for ${done} jutsu(s).`);
                        }}>
                            {jutsuIsGenerating ? "Generating..." : "Generate All Missing Jutsu Images"}
                        </button>
                        {jutsuGenStatus && <p className="hint" style={{ color: "#a5d6a7", marginTop: "0.4rem" }}>{jutsuGenStatus}</p>}
                    </section>
                </div>
            )}

            {(activeAdminPanel === "eventsRaids" || activeAdminPanel === "visualNovels") && (
                <div className="admin-subpanel">
                    <h3>{activeAdminPanel === "visualNovels" ? "Visual Novel Library" : "Event Library"}</h3>
                    <section className="summary-box">
                        <label>{activeAdminPanel === "visualNovels" ? "Find Visual Novel" : "Find Event"}</label>
                        <div className="inline-grid">
                            <select value={eventBiomeFilter} onChange={(e) => setEventBiomeFilter(e.target.value as "All" | Biome)}>
                                <option value="All">All Biomes</option>
                                <option value="central">central</option>
                                <option value="forest">forest</option>
                                <option value="volcano">volcano</option>
                                <option value="snow">snow</option>
                                <option value="shadow">shadow</option>
                            </select>
                            <select value={eventSort} onChange={(e) => setEventSort(e.target.value as "name" | "type" | "biome" | "level")}>
                                <option value="name">Sort: Name</option>
                                <option value="type">Sort: Type</option>
                                <option value="biome">Sort: Biome</option>
                                <option value="level">Sort: Level</option>
                            </select>
                        </div>
                        {(() => {
                            const filtered = sortedEditableEvents.filter((ev) =>
                                activeAdminPanel === "visualNovels"
                                    ? (ev.eventKind ?? "reward") === "visualNovel"
                                    : (ev.eventKind ?? "reward") !== "visualNovel"
                            );
                            const selected = filtered.find((ev) => ev.id === selectedEventId) ?? filtered[0];
                            return filtered.length === 0 ? <div className="summary-box">None yet.</div> : (
                                <>
                                    <select value={selected?.id ?? ""} onChange={(e) => setSelectedEventId(e.target.value)}>
                                        {filtered.map((event) => <option key={event.id} value={event.id}>{event.name} | {event.eventKind === "visualNovel" ? "Visual Novel" : "Reward"} | Level {event.levelReq}</option>)}
                                    </select>
                                    {selected && (
                                        <div className="summary-box">
                                            <strong>{selected.icon} {selected.name}</strong>
                                            <p>{selected.eventKind === "visualNovel" ? "Visual Novel" : "Reward Event"} | {selected.biome} | Level {selected.levelReq} | {rewardSummary(selected.xpReward, selected.ryoReward, selected.staminaReward, selected.currencyRewards)}</p>
                                            {selected.aiProfileId && <p><strong>Battle AI:</strong> {allAdminAis.find((ai) => ai.id === selected.aiProfileId)?.name ?? selected.aiProfileId}</p>}
                                            {selected.id.startsWith("story-") && !creatorEvents.some((created) => created.id === selected.id) && <p className="hint">Built-in visual novel. Saving creates an editable imported copy.</p>}
                                            {selected.eventKind === "visualNovel" && <p><strong>VN:</strong> {selected.vnTitle}{selected.vnPages ? ` | ${selected.vnPages.length} pages` : ""}</p>}
                                            {selected.image && <div className="admin-event-list-preview"><img src={selected.image} alt={selected.name} /></div>}
                                            <p>{selected.dialogue.join(" ")}</p>
                                            <div className="menu"><button onClick={() => loadAdminEvent(selected)}>Edit</button>{creatorEvents.some((created) => created.id === selected.id) && <button className="danger-button" onClick={() => setCreatorEvents(creatorEvents.filter((e) => e.id !== selected.id))}>Delete</button>}</div>
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </section>
                </div>
            )}
            {activeAdminPanel === "visualNovels" && (() => {
                const galleryVns: { id: string; label: string; pages: { title: string; image?: string }[]; isPet?: boolean }[] = [];
                if (petEncounterVn.vnPages?.length) {
                    galleryVns.push({ id: "sys-pet-encounter", label: "🐾 Pet Encounter VN", pages: petEncounterVn.vnPages, isPet: true });
                }
                sortedEditableEvents
                    .filter((ev) => (ev.eventKind ?? "reward") === "visualNovel")
                    .forEach((ev) => {
                        if (ev.vnPages?.length) {
                            galleryVns.push({ id: ev.id, label: `${ev.icon ?? ""} ${ev.name}`, pages: ev.vnPages });
                        }
                    });
                if (galleryVns.length === 0) return null;
                return (
                    <div className="admin-subpanel vn-gallery-panel">
                        <h3>VN Image Gallery</h3>
                        <p className="hint">All visual novels and their page images. Upload, generate, or clear images directly.</p>
                        {galleryVns.map((vn) => (
                            <div key={vn.id} className="vn-gallery-vn">
                                <h4>{vn.label}</h4>
                                <div className="vn-gallery-pages">
                                    {vn.pages.map((page, pi) => (
                                        <div key={pi} className="vn-gallery-card">
                                            <div className="vn-gallery-card-img">
                                                {page.image
                                                    ? <img src={page.image} alt={page.title} />
                                                    : <div className="vn-gallery-no-img">No Image</div>
                                                }
                                            </div>
                                            <div className="vn-gallery-card-info">
                                                <strong>Page {pi + 1}</strong>
                                                <span>{page.title}</span>
                                            </div>
                                            <div className="vn-gallery-card-actions">
                                                <label className="vn-gallery-upload-btn">
                                                    Upload
                                                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (!file) return;
                                                        readImageFile(file, (img) => vn.isPet ? setPetVnPageImage(pi, img) : setVnPageImage(vn.id, pi, img), 100);
                                                    }} />
                                                </label>
                                                <AiImagePrompt label="" suggestedPrompt={`${page.title} visual novel scene`} onImage={(img) => vn.isPet ? setPetVnPageImage(pi, img) : setVnPageImage(vn.id, pi, img)} />
                                                {character.avatarImage && (
                                                    <button onClick={() => vn.isPet ? setPetVnPageImage(pi, character.avatarImage!) : setVnPageImage(vn.id, pi, character.avatarImage!)}>Avatar</button>
                                                )}
                                                {page.image && (
                                                    <button className="danger-button" onClick={() => vn.isPet ? setPetVnPageImage(pi, "") : setVnPageImage(vn.id, pi, "")}>Remove</button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                );
            })()}
            {activeAdminPanel === "petEditor" && (
                <div className="admin-subpanel">
                    <div className="admin-panel-heading">
                        <h3>Pet Editor</h3>
                        <p>Edit pet names, stats, rarity, jutsus, descriptions, and upload pet photos. Wild explore rolls include standard, rare, legendary, and mythic pets.</p>
                    </div>

                    <section className="summary-box">
                        <div className="pet-rarity-summary">
                            {petRarityOrder.map((rarity) => (
                                <span key={rarity} className={`pet-rarity-tag rarity-${rarity}`}>
                                    {rarity}: {editablePets.filter((pet) => pet.rarity === rarity).length}
                                </span>
                            ))}
                        </div>

                        <label>Select Pet</label>
                        <select value={selectedPetId} onChange={(e) => setSelectedPetId(e.target.value)}>
                            {petRarityOrder.map((rarity) => {
                                const petsOfRarity = editablePets.filter((pet) => pet.rarity === rarity);

                                if (petsOfRarity.length === 0) return null;

                                return (
                                    <optgroup key={rarity} label={`${rarity.toUpperCase()} PETS`}>
                                        {petsOfRarity.map((pet) => (
                                            <option key={pet.id} value={pet.id}>
                                                {pet.name} | {pet.rarity} | LVL {pet.level}
                                            </option>
                                        ))}
                                    </optgroup>
                                );
                            })}
                        </select>

                        {(() => {
                            const pet = editablePets.find((p) => p.id === selectedPetId);
                            if (!pet) return <p>No pet selected.</p>;
                            const selectedPet = pet;

                            function updatePet(updated: Partial<Pet>) {
                                setEditablePets(
                                    editablePets.map((p) => p.id === selectedPet.id ? { ...p, ...updated } : p)
                                );
                            }

                            function updatePetJutsu(index: number, updated: Partial<PetJutsu>) {
                                updatePet({
                                    jutsus: selectedPet.jutsus.map((jutsu, jutsuIndex) =>
                                        jutsuIndex === index ? { ...jutsu, ...updated } : jutsu
                                    ),
                                });
                            }

                            return (
                                <div className="summary-box pet-editor-card">
                                    <h3>{pet.name}</h3>

                                    {pet.image && (
                                        <div className="admin-jutsu-preview">
                                            <img src={pet.image} alt={pet.name} />
                                        </div>
                                    )}

                                    <label>Pet Photo</label>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            readImageFile(file, (image) => updatePet({ image }), 100);
                                        }}
                                    />
                                    <AiImagePrompt label="Pet Photo" suggestedPrompt={`${pet.name} ${pet.rarity} shinobi companion`} onImage={(image) => updatePet({ image })} />

                                    <label>Name</label>
                                    <input value={pet.name} onChange={(e) => updatePet({ name: e.target.value })} />

                                    <label>Description</label>
                                    <textarea
                                        value={pet.description ?? ""}
                                        onChange={(e) => updatePet({ description: e.target.value })}
                                        rows={3}
                                        placeholder="Pet lore, personality, or where it appears."
                                    />

                                    <select value={pet.rarity} onChange={(e) => updatePet({ rarity: e.target.value as PetRarity })}>
                                        <option value="standard">standard</option>
                                        <option value="rare">rare</option>
                                        <option value="legendary">legendary</option>
                                        <option value="mythic">mythic</option>
                                    </select>

                                    <label>Level / XP / Max Level</label>
                                    <div className="inline-grid">
                                        <input type="number" value={pet.level} onChange={(e) => updatePet({ level: Number(e.target.value), unlockedForPve: Number(e.target.value) >= 50 })} />
                                        <input type="number" value={pet.xp} onChange={(e) => updatePet({ xp: Number(e.target.value) })} />
                                        <input type="number" value={pet.maxLevel} onChange={(e) => updatePet({ maxLevel: Number(e.target.value) })} />
                                    </div>

                                    <label>HP / Attack / Defense / Speed</label>
                                    <div className="inline-grid">
                                        <input type="number" value={pet.hp} onChange={(e) => updatePet({ hp: Number(e.target.value) })} />
                                        <input type="number" value={pet.attack} onChange={(e) => updatePet({ attack: Number(e.target.value) })} />
                                        <input type="number" value={pet.defense} onChange={(e) => updatePet({ defense: Number(e.target.value) })} />
                                        <input type="number" value={pet.speed} onChange={(e) => updatePet({ speed: Number(e.target.value) })} />
                                    </div>

                                    <h4>Pet Jutsus</h4>
                                    {pet.jutsus.map((jutsu, index) => (
                                        <div className="summary-box" key={index}>
                                            <label>Jutsu Name</label>
                                            <input value={jutsu.name} onChange={(e) => updatePetJutsu(index, { name: e.target.value })} />

                                            <label>Power / Cooldown</label>
                                            <div className="inline-grid">
                                                <input type="number" value={jutsu.power} onChange={(e) => updatePetJutsu(index, { power: Number(e.target.value) })} />
                                                <input type="number" value={jutsu.cooldown} onChange={(e) => updatePetJutsu(index, { cooldown: Number(e.target.value) })} />
                                            </div>

                                            <label>Kind</label>
                                            <select value={jutsu.kind} onChange={(e) => updatePetJutsu(index, { kind: e.target.value as "damage" | "buff" })}>
                                                <option value="damage">damage</option>
                                                <option value="buff">buff</option>
                                            </select>
                                        </div>
                                    ))}

                                    <div className="menu">
                                        {petRarityOrder.map((rarity) => {
                                            const rarityLabel = rarity.charAt(0).toUpperCase() + rarity.slice(1);
                                            return (
                                                <button
                                                    key={rarity}
                                                    onClick={() => {
                                                        const newPet: Pet = {
                                                            id: `admin-pet-${makeId()}`,
                                                            name: `New ${rarityLabel} Pet`,
                                                            rarity,
                                                            level: 1,
                                                            xp: 0,
                                                            maxLevel: 100,
                                                            hp: rarity === "mythic" ? 650 : rarity === "legendary" ? 450 : rarity === "rare" ? 275 : 150,
                                                            attack: rarity === "mythic" ? 95 : rarity === "legendary" ? 65 : rarity === "rare" ? 34 : 20,
                                                            defense: rarity === "mythic" ? 85 : rarity === "legendary" ? 55 : rarity === "rare" ? 24 : 15,
                                                            speed: rarity === "mythic" ? 90 : rarity === "legendary" ? 60 : rarity === "rare" ? 20 : 10,
                                                            unlockedForPve: false,
                                                            jutsus: [
                                                                {
                                                                    name: `${rarityLabel} Pet Strike`,
                                                                    power: rarity === "mythic" ? 210 : rarity === "legendary" ? 120 : rarity === "rare" ? 55 : 35,
                                                                    cooldown: 3,
                                                                    currentCooldown: 0,
                                                                    kind: "damage",
                                                                },
                                                            ],
                                                        };

                                                        setEditablePets([...editablePets, newPet]);
                                                        setSelectedPetId(newPet.id);
                                                    }}
                                                >
                                                    Add {rarity} Pet
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}
                    </section>

                    <section className="summary-box">
                        <h4>Bulk Image Generation</h4>
                        <p className="hint">Generates AI images for all pets that don't have a photo yet. Runs sequentially — may take a few minutes.</p>
                        <p className="hint">Pets without images: <strong>{editablePets.filter((p) => !p.image).length}</strong> / {editablePets.length}</p>
                        <button disabled={petIsGenerating} onClick={async () => {
                            const missing = editablePets.filter((p) => !p.image);
                            if (missing.length === 0) { setPetGenStatus("All pets already have images!"); return; }
                            setPetIsGenerating(true);
                            let done = 0;
                            const updated = [...editablePets];
                            for (const pet of missing) {
                                setPetGenStatus(`Generating ${pet.name}... (${done + 1}/${missing.length})`);
                                try {
                                    const res = await fetch("/api/generate-image", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ prompt: `${pet.name} ${pet.rarity} shinobi companion animal`, label: "Pet Photo" }),
                                    });
                                    if (res.ok) {
                                        const data = await res.json();
                                        const idx = updated.findIndex((p) => p.id === pet.id);
                                        if (idx >= 0) updated[idx] = { ...updated[idx], image: data.image };
                                    }
                                } catch { /* skip */ }
                                done++;
                            }
                            setEditablePets(updated);
                            setPetIsGenerating(false);
                            setPetGenStatus(`Done! Generated images for ${done} pet(s).`);
                        }}>
                            {petIsGenerating ? "Generating..." : "Generate All Missing Pet Images"}
                        </button>
                        {petGenStatus && <p className="hint" style={{ color: "#a5d6a7", marginTop: "0.4rem" }}>{petGenStatus}</p>}
                    </section>
                </div>
            )}
            {activeAdminPanel === "cardEditor" && (
                <div className="admin-subpanel">
                    <div className="admin-panel-heading">
                        <h3>Card Editor</h3>
                        <p>Create and edit Shinobi Tiles cards. Changes persist across sessions.</p>
                    </div>

                    <section className="summary-box">
                        {editingCardId && (
                            <p className="hint">Editing: <strong>{cardName}</strong>{shinobiTileCards.some((c) => c.id === editingCardId) ? " (built-in — save creates an override)" : ""}</p>
                        )}

                        <label>Card Name</label>
                        <input value={cardName} onChange={(e) => setCardName(e.target.value)} />

                        <label>Power (1–10)</label>
                        <input type="number" min={1} max={10} value={cardPower} onChange={(e) => setCardPower(Number(e.target.value))} />

                        <label>Element</label>
                        <select value={cardElement} onChange={(e) => setCardElement(e.target.value)}>
                            {["None", "Fire", "Water", "Wind", "Earth", "Lightning", "Shadow", "Ice"].map((el) => (
                                <option key={el} value={el}>{el}</option>
                            ))}
                        </select>

                        <label>Rarity</label>
                        <select value={cardRarity} onChange={(e) => setCardRarity(e.target.value as TileCard["rarity"])}>
                            <option value="common">common</option>
                            <option value="rare">rare</option>
                            <option value="epic">epic</option>
                        </select>

                        <label>Arrows</label>
                        <div className="inline-grid">
                            {(["up", "down", "left", "right"] as TileCardArrow[]).map((dir) => (
                                <label key={dir} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                                    <input
                                        type="checkbox"
                                        checked={cardArrows.includes(dir)}
                                        onChange={(e) => setCardArrows(e.target.checked ? [...cardArrows, dir] : cardArrows.filter((d) => d !== dir))}
                                    />
                                    {dir}
                                </label>
                            ))}
                        </div>

                        <label>Description</label>
                        <textarea value={cardDescription} onChange={(e) => setCardDescription(e.target.value)} rows={2} />

                        <label>Card Image</label>
                        {cardImage && <div className="admin-jutsu-preview"><img src={cardImage} alt={cardName} /></div>}
                        <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                readImageFile(file, (img) => setCardImage(img), 100);
                            }}
                        />
                        <AiImagePrompt
                            label="Card Image"
                            suggestedPrompt={`${cardName} ${cardElement} shinobi card game artwork`}
                            onImage={(img) => setCardImage(img)}
                        />

                        <div className="menu">
                            <button onClick={createAdminCard}>{editingCardId ? "Save Card" : "Create Card"}</button>
                            {editingCardId && <button onClick={() => { setEditingCardId(""); setCardName("New Card"); setCardPower(3); setCardArrows(["up"]); setCardImage(""); }}>Cancel Edit</button>}
                        </div>
                    </section>

                    {/* ── Bulk Image Generator ── */}
                    <section className="summary-box bulk-image-section">
                        <div className="bulk-image-header" onClick={() => setBulkShowSection(v => !v)}>
                            <span>🎨 Bulk Image Generator</span>
                            <span className="bulk-image-chevron">{bulkShowSection ? "▲" : "▼"}</span>
                        </div>

                        {bulkShowSection && (() => {
                            const allCards = getAllTileCards(creatorCards);
                            const visibleCards = bulkSkipExisting ? allCards.filter(c => !c.image) : allCards;
                            const selectedCount = bulkSelections.length;
                            const pct = bulkProgress ? Math.round((bulkProgress.current / bulkProgress.total) * 100) : 0;

                            return (
                                <div className="bulk-image-body">
                                    {/* Options row */}
                                    <div className="bulk-image-opts">
                                        <label className="bulk-image-toggle">
                                            <input type="checkbox" checked={bulkSkipExisting} onChange={e => { setBulkSkipExisting(e.target.checked); setBulkSelections([]); }} />
                                            Show only cards without images
                                        </label>
                                        <div className="bulk-image-quickbtns">
                                            <button
                                                className="bulk-quick-btn"
                                                disabled={bulkRunning}
                                                onClick={() => setBulkSelections(visibleCards.map(c => c.id))}
                                            >Select All ({visibleCards.length})</button>
                                            <button
                                                className="bulk-quick-btn"
                                                disabled={bulkRunning}
                                                onClick={() => setBulkSelections(allCards.filter(c => !c.image).map(c => c.id))}
                                            >No Image Only</button>
                                            <button
                                                className="bulk-quick-btn"
                                                disabled={bulkRunning}
                                                onClick={() => setBulkSelections([])}
                                            >Deselect All</button>
                                        </div>
                                    </div>

                                    {/* Card list */}
                                    <div className="bulk-card-list">
                                        {visibleCards.length === 0 && (
                                            <p className="hint" style={{ padding: "8px 0" }}>All cards already have images.</p>
                                        )}
                                        {visibleCards.map(card => {
                                            const checked = bulkSelections.includes(card.id);
                                            const customPrompt = bulkCustomPrompts[card.id] ?? "";
                                            return (
                                                <div key={card.id} className={`bulk-card-row${checked ? " bulk-card-row--checked" : ""}`}>
                                                    <label className="bulk-card-check">
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            disabled={bulkRunning}
                                                            onChange={e => setBulkSelections(e.target.checked
                                                                ? [...bulkSelections, card.id]
                                                                : bulkSelections.filter(id => id !== card.id))}
                                                        />
                                                    </label>
                                                    {card.image
                                                        ? <img src={card.image} alt={card.name} className="bulk-card-thumb" />
                                                        : <div className="bulk-card-thumb bulk-card-thumb--empty">?</div>
                                                    }
                                                    <div className="bulk-card-info">
                                                        <span className="bulk-card-name">{card.name}</span>
                                                        <span className={`bulk-card-rarity bulk-rarity-${card.rarity}`}>{card.rarity}</span>
                                                        {card.element !== "None" && <span className="bulk-card-element">{card.element}</span>}
                                                        {card.image && <span className="bulk-card-has-img">✓ has image</span>}
                                                    </div>
                                                    {checked && (
                                                        <input
                                                            className="bulk-card-prompt-input"
                                                            placeholder={`Auto: "${card.name}${card.element !== "None" ? " " + card.element : ""} shinobi card art..."`}
                                                            value={customPrompt}
                                                            disabled={bulkRunning}
                                                            onChange={e => setBulkCustomPrompts(prev => ({ ...prev, [card.id]: e.target.value }))}
                                                        />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Progress bar */}
                                    {bulkProgress && (
                                        <div className="bulk-progress-wrap">
                                            <div className="bulk-progress-label">
                                                Generating <strong>{bulkProgress.cardName}</strong> ({bulkProgress.current}/{bulkProgress.total})
                                            </div>
                                            <div className="bulk-progress-track">
                                                <div className="bulk-progress-fill" style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                    )}

                                    {/* Errors */}
                                    {bulkErrors.length > 0 && (
                                        <div className="bulk-error-list">
                                            <strong style={{ color: "#f87171" }}>Errors ({bulkErrors.length}):</strong>
                                            {bulkErrors.map(e => (
                                                <div key={e.id} className="bulk-error-row">❌ <strong>{e.name}</strong>: {e.error}</div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Generate button */}
                                    <div className="menu" style={{ marginTop: 10 }}>
                                        <button
                                            className="bulk-generate-btn"
                                            disabled={bulkRunning || selectedCount === 0}
                                            onClick={runBulkGeneration}
                                        >
                                            {bulkRunning
                                                ? `⏳ Generating… ${bulkProgress ? `${bulkProgress.current}/${bulkProgress.total}` : ""}`
                                                : `🎨 Generate Images for ${selectedCount} Card${selectedCount !== 1 ? "s" : ""}`}
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </section>

                    <section className="summary-box">
                        <h4>All Cards ({[...creatorCards, ...shinobiTileCards.filter((s) => !creatorCards.some((c) => c.id === s.id))].length})</h4>
                        {([...creatorCards, ...shinobiTileCards.filter((s) => !creatorCards.some((c) => c.id === s.id))]).map((card) => {
                            const isCreator = creatorCards.some((c) => c.id === card.id);
                            return (
                                <div key={card.id} className="summary-box" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                                    {card.image && <img src={card.image} alt={card.name} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} />}
                                    <span style={{ flex: 1 }}><strong>{card.name}</strong> | PWR {card.power} | {card.element} | {card.rarity} | [{card.arrows.join(",")}]</span>
                                    <button onClick={() => loadAdminCard(card)}>Edit</button>
                                    {isCreator && (
                                        <button className="danger-button" onClick={() => { setCreatorCards(creatorCards.filter((c) => c.id !== card.id)); if (editingCardId === card.id) setEditingCardId(""); }}>Delete</button>
                                    )}
                                </div>
                            );
                        })}
                    </section>
                </div>
            )}

            <div className="menu">
                <button onClick={() => setScreen("worldMap")}>Test World Map</button>
                <button onClick={() => setScreen("profile")}>Test Profile</button>
                <button onClick={() => setScreen("arena")}>Test Combat</button>
                <button className="danger-button" onClick={() => { setAdminLoggedIn(false); setScreen("start"); }}>Admin Logout</button>
            </div>
            <p className="hint">Total available jutsus right now: {allGameJutsus.length}</p>
        </div>
    );
}

function TagPicker({ tag, setTag, percent, setPercent, rank }: { tag: string; setTag: (tag: string) => void; percent: number; setPercent: (percent: number) => void; rank?: Rank | null }) {
    const isBinary = binaryTags.includes(tag);
    const isCapped = cappedDamageTags.includes(tag);
    const cap = isCapped ? tagCapForRank(rank) : 100;
    const atCap = isCapped && percent >= cap;
    const selectedTagInfo = tag
        ? jutsuEffectInfo(normalizeJutsu({ id: "tag-preview", name: "Tag Preview", type: "Ninjutsu", effectPower: 100, tags: [{ name: tag, percent }] }), { name: tag, percent })
        : null;

    function handlePercent(val: number) {
        setPercent(Math.min(cap, Math.max(0, val)));
    }

    return (
        <div className="tag-picker">
            <select
                value={tag}
                onChange={(e) => {
                    const nextTag = e.target.value;
                    setTag(nextTag);
                    if (binaryTags.includes(nextTag)) setPercent(0);
                }}
            >
                <option value="">No Tag</option>
                {allTags.map((tagName) => <option key={tagName}>{tagName}</option>)}
            </select>
            {!isBinary && isCapped && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <input
                        type="number"
                        value={percent}
                        min={0}
                        max={cap}
                        onChange={(e) => handlePercent(Number(e.target.value))}
                        style={{ width: 56 }}
                    />
                    <span style={{ fontSize: "0.72rem", color: atCap ? "#fde047" : "#64748b" }}>
                        / {cap}%{atCap ? " ⚡+0.75pt" : ""}
                    </span>
                </div>
            )}
            {!isBinary && !isCapped && tag && (
                <input type="number" value={percent} onChange={(e) => setPercent(Number(e.target.value))} />
            )}
            {isBinary && tag && (
                <span style={{ fontSize: "0.75rem", color: "#4ade80", padding: "0 0.4rem" }}>✓ 100% applies</span>
            )}
            {selectedTagInfo && (
                <small className="tag-effect-help">
                    {selectedTagInfo.summary} {selectedTagInfo.rule}
                </small>
            )}
        </div>
    );
}

function AiImagePrompt({
    label,
    suggestedPrompt,
    onImage,
}: {
    label: string;
    suggestedPrompt: string;
    onImage: (image: string) => void;
}) {
    const [prompt, setPrompt] = useState(suggestedPrompt);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState("");

    async function generateImage() {
        const cleanPrompt = prompt.trim();

        if (!cleanPrompt) {
            setError("Type an image prompt first.");
            return;
        }

        try {
            setIsGenerating(true);
            setError("");

            const response = await fetch("/api/generate-image", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    prompt: cleanPrompt,
                    label,
                }),
            });

            const rawText = await response.text();

            let data: { error?: string; detail?: string; title?: string; image?: string } = {};
            try {
                data = rawText ? JSON.parse(rawText) as typeof data : {};
            } catch {
                throw new Error(
                    `Server did not return JSON. Status ${response.status}. Response: ${rawText.slice(0, 300)}`
                );
            }

            if (!response.ok) {
                throw new Error(
                    data.error ||
                    data.detail ||
                    data.title ||
                    `Image generation failed with status ${response.status}.`
                );
            }

            if (!data.image) {
                throw new Error("The server responded, but no image was returned.");
            }

            const compressed = await compressDataUrl(data.image);
            onImage(compressed);
        } catch (err) {
            console.error("Image generation error:", err);
            setError(err instanceof Error ? err.message : "Image generation failed.");
        } finally {
            setIsGenerating(false);
        }
    }

    return (
        <div className="ai-image-generator">
            <label>{label} AI Prompt</label>

            <div className="ai-image-prompt-row">
                <input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Small prompt for generated art"
                    disabled={isGenerating}
                />

                <button type="button" onClick={generateImage} disabled={isGenerating}>
                    {isGenerating ? "Generating..." : "Generate"}
                </button>
            </div>

            {error && (
                <p className="hint" style={{ color: "#ff7777", whiteSpace: "pre-wrap" }}>
                    {error}
                </p>
            )}
        </div>
    );
}

function JutsuDropdownList({
    jutsus,
    label,
    emptyText = "No jutsus available.",
    renderDetails,
    renderActions,
    onSelectJutsu,
}: {
    jutsus: Jutsu[];
    label: string;
    emptyText?: string;
    renderDetails: (jutsu: Jutsu) => ReactNode;
    renderActions?: (jutsu: Jutsu) => ReactNode;
    onSelectJutsu?: (jutsu: Jutsu) => void;
}) {
    const [nameFilter, setNameFilter] = useState("");
    const [typeFilter, setTypeFilter] = useState<"All" | JutsuType>("All");
    const [elementFilter, setElementFilter] = useState<"All" | JutsuElement>("All");
    const [effectFilter, setEffectFilter] = useState("All");
    const [sortBy, setSortBy] = useState<JutsuSort>("name");
    const sortedJutsus = getJutsuSelectOptions(jutsus, typeFilter, elementFilter, sortBy)
        .filter((jutsu) => jutsu.name.toLowerCase().includes(nameFilter.trim().toLowerCase()))
        .filter((jutsu) => effectFilter === "All" || jutsu.tags.some((tag) => tag.name === effectFilter));
    const [selectedId, setSelectedId] = useState(sortedJutsus[0]?.id ?? "");
    const selectedJutsu = sortedJutsus.find((jutsu) => jutsu.id === selectedId) ?? sortedJutsus[0];

    useEffect(() => {
        if (!selectedJutsu) {
            setSelectedId("");
            return;
        }
        if (!sortedJutsus.some((jutsu) => jutsu.id === selectedId)) setSelectedId(selectedJutsu.id);
    }, [selectedId, selectedJutsu, sortedJutsus]);

    if (jutsus.length === 0) return <div className="summary-box">{emptyText}</div>;

    return (
        <div className="jutsu-dropdown-list technique-browser">
            <div className="technique-header">
                <label>{label}</label>
                <span>{sortedJutsus.length}/{jutsus.length}</span>
            </div>
            <div className="technique-shell">
                <div className="technique-grid" role="listbox" aria-label={label}>
                    {sortedJutsus.length === 0 ? (
                        <div className="summary-box">{emptyText}</div>
                    ) : sortedJutsus.map((jutsu) => {
                        const selected = selectedJutsu?.id === jutsu.id;
                        const image = jutsu.image;
                        return (
                            <button
                                key={jutsu.id}
                                className={`technique-card ${selected ? "selected" : ""}`}
                                onClick={() => {
                                    setSelectedId(jutsu.id);
                                    onSelectJutsu?.(jutsu);
                                }}
                                type="button"
                            >
                                <span className="technique-thumb">
                                    {image ? <img src={image} alt={jutsu.name} /> : <strong>{jutsu.type.slice(0, 3).toUpperCase()}</strong>}
                                </span>
                                <span className="technique-name">{jutsu.name}</span>
                                <span className="technique-cost">{jutsu.ap}</span>
                            </button>
                        );
                    })}
                </div>

                <aside className="technique-filter-panel">
                    <label>Name</label>
                    <input value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} placeholder="Name" />
                    <label>Offense</label>
                    <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as "All" | JutsuType)}>
                        <option value="All">All Offenses</option>
                        {specialties.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                    <label>Element</label>
                    <select value={elementFilter} onChange={(e) => setElementFilter(e.target.value as "All" | JutsuElement)}>
                        <option value="All">All Elements</option>
                        {jutsuElements.map((element) => <option key={element} value={element}>{element}</option>)}
                    </select>
                    <label>Effects</label>
                    <select value={effectFilter} onChange={(e) => setEffectFilter(e.target.value)}>
                        <option value="All">All Effects</option>
                        {allTags.map((tagName) => <option key={tagName} value={tagName}>{tagName}</option>)}
                    </select>
                    <label>Sort</label>
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value as JutsuSort)}>
                        <option value="name">Name</option>
                        <option value="type">Offense</option>
                        <option value="element">Element</option>
                        <option value="effect">Effects</option>
                        <option value="ap">AP</option>
                        <option value="range">Range</option>
                        <option value="effectPower">Effect Power</option>
                    </select>
                    {selectedJutsu && (
                        <div className="technique-selected-panel">
                            <h4>{selectedJutsu.name}</h4>
                            {renderDetails(selectedJutsu)}
                            {renderActions && <div className="menu">{renderActions(selectedJutsu)}</div>}
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}

function JutsuEffectCards({ jutsu, scaledEffectPower }: { jutsu: Jutsu; scaledEffectPower?: number }) {
    const tags = jutsu.tags.filter((tag) => tag.name);
    if (tags.length === 0) {
        return (
            <div className="jutsu-effect-cards">
                <div className="jutsu-effect-card">
                    <strong>No special effects</strong>
                    <p>This jutsu only uses its base effect power.</p>
                </div>
            </div>
        );
    }

    const effectJutsu = scaledEffectPower === undefined ? jutsu : { ...jutsu, effectPower: scaledEffectPower };

    return (
        <div className="jutsu-effect-cards">
            {tags.map((tag, index) => {
                const info = jutsuEffectInfo(effectJutsu, tag);
                return (
                    <div className="jutsu-effect-card" key={`${tag.name}-${index}`}>
                        <div className="jutsu-effect-card-head">
                            <strong>{tag.name}</strong>
                            <span>{info.duration}</span>
                        </div>
                        <p>{info.summary}</p>
                        <div className="jutsu-effect-meta">
                            <span><strong>Value:</strong> {info.value}</span>
                            <span><strong>Target:</strong> {jutsu.target.toLowerCase().replaceAll("_", " ")}</span>
                        </div>
                        <small>{info.rule}</small>
                    </div>
                );
            })}
        </div>
    );
}

function Village({ characterVillage, setScreen, onSave }: { characterVillage: string; setScreen: (screen: Screen) => void; onSave: () => Promise<void> }) {
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState("");
    async function handleSave() {
        setSaving(true);
        setSaveMsg("");
        try {
            await onSave();
            setSaveMsg("Saved!");
        } catch {
            setSaveMsg("Save failed.");
        }
        setSaving(false);
        setTimeout(() => setSaveMsg(""), 3000);
    }
    const locations = [
        { name: "Battle Arena", icon: "⚔️", screen: "arena" as Screen, x: "10%", y: "31%" },
        { name: "Story Hall", icon: "🔖", screen: "storyHall" as Screen, x: "29%", y: "33%" },
        { name: "Town Hall", icon: "🏯", screen: "townHall" as Screen, x: "50%", y: "22%" },
        { name: "Bank", icon: "💰", screen: "bank" as Screen, x: "68%", y: "31%" },
        { name: "Shop", icon: "🛒", screen: "shop" as Screen, x: "18%", y: "79%" },
        { name: "Clan Hall", icon: "⛩️", screen: "clan" as Screen, x: "13%", y: "57%" },
        { name: "Hospital", icon: "🏥", screen: "hospital" as Screen, x: "66%", y: "56%" },
        { name: "Mission Hall", icon: "📜", screen: "missions" as Screen, x: "68%", y: "75%" },
        { name: "Cafeteria", icon: "🍜", screen: "cafeteria" as Screen, x: "82%", y: "45%" },
        { name: "Stat Training", icon: "🏆", screen: "training" as Screen, x: "83%", y: "25%" },
        { name: "Jutsu Training", icon: "📘", screen: "jutsuTraining" as Screen, x: "80%", y: "81%" },
        { name: "World Map", icon: "🗺️", screen: "worldMap" as Screen, x: "45%", y: "68%" },
        { name: "Pet Yard", icon: "🐾", screen: "pets" as Screen, x: "32%", y: "55%" },
        { name: "Card Hall", icon: "🃏", screen: "shinobiTiles" as Screen, x: "52%", y: "55%" },
    ];

    return (
        <div className="stormveil-village-screen">
            <div className="village-save-bar">
                <button className="village-save-btn" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : "💾 Save Game"}
                </button>
                {saveMsg && <span className="village-save-msg">{saveMsg}</span>}
            </div>

            <div
                className="stormveil-map"
                style={{
                    backgroundImage: `url(${villagePageImage(characterVillage)})`,
                }}
            >
                {locations.map((location) => (
                    <button
                        key={location.name}
                        className="stormveil-map-button"
                        style={{
                            left: location.x,
                            top: location.y,
                        }}
                        onClick={() => setScreen(location.screen)}
                    >
                        <span>{location.icon}</span>
                        <strong>{location.name}</strong>
                    </button>
                ))}
            </div>
        </div>
    );
}
const clanLore: Record<string, { name: string; motto: string; lore: string }> = {
    "Frostfang Village": {
        name: "Frostfang Clan Halls",
        motto: "No fang breaks from the pack.",
        lore: "Frostfang clans are built like wolf packs. Each clan swears loyalty to its members before glory, wealth, or personal fame. Their oldest houses were formed during the first endless winter, when surviving alone meant death."
    },
    "Stormveil Village": {
        name: "Stormveil Warbands",
        motto: "Power belongs to whoever takes it.",
        lore: "Stormveil clans are unstable, loud, and dangerous. They are less like noble families and more like warbands formed beneath thunderclouds. Leaders rise fast, fall faster, and only the strongest names survive the storm."
    },
    "Ashen Leaf Village": {
        name: "Ashen Leaf Houses",
        motto: "Roots remember what flames forget.",
        lore: "Ashen Leaf clans preserve ancient shinobi traditions. Many houses trace their bloodlines back to survivors of the great fire war, guarding old techniques, scrolls, and family oaths passed down through generations."
    },
    "Moonshadow Village": {
        name: "Moonshadow Secret Circles",
        motto: "Trust no shadow but your own.",
        lore: "Moonshadow clans are secretive circles built on ambition, stealth, and hidden contracts. Some are assassin houses, some are spy networks, and some exist only as names whispered under moonless skies."
    }
};

// ── Clan system types & helpers ────────────────────────────────────────────
type ClanMemberEntry = {
    name: string; village: string; level: number; specialty: string;
    battleContrib: number; eventContrib: number; missionContrib: number;
    isFounder: boolean; month: string;
};
type ClanData = {
    name: string; village: string; founderName: string;
    createdAt: number; members: ClanMemberEntry[];
};
function clanContribTotal(m: ClanMemberEntry): number {
    return m.battleContrib * 10 + m.eventContrib * 5 + m.missionContrib * 2;
}
function clanRankOf(member: ClanMemberEntry, members: ClanMemberEntry[], founderName: string): string {
    if (member.name === founderName) return "Clan Head";
    const sorted = [...members].filter(m => m.name !== founderName)
        .sort((a, b) => clanContribTotal(b) - clanContribTotal(a));
    const idx = sorted.findIndex(m => m.name === member.name);
    if (idx < 0) return "Clan Initiate";
    if (idx < 2) return "Clan Elder";
    if (idx < 5) return "Clan Enforcer";
    if (idx < 10) return "Clan Shinobi";
    return "Clan Initiate";
}
const CLAN_RANK_COLOR: Record<string, string> = {
    "Clan Head": "#fde047",
    "Clan Elder": "#c084fc",
    "Clan Enforcer": "#60a5fa",
    "Clan Shinobi": "#4ade80",
    "Clan Initiate": "#64748b",
};
const CLAN_RANK_ICON: Record<string, string> = {
    "Clan Head": "👑",
    "Clan Elder": "⭐",
    "Clan Enforcer": "🔱",
    "Clan Shinobi": "🗡️",
    "Clan Initiate": "🌀",
};
function clanSlug(name: string): string {
    return "clan-" + name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
async function fetchClanData(name: string): Promise<ClanData | null> {
    try {
        const res = await fetch(`/api/save/${clanSlug(name)}`);
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}
async function writeClanData(data: ClanData): Promise<void> {
    await fetch(`/api/save/${clanSlug(data.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
}
async function postGuardQueue(action: "queue" | "dequeue", payload: object): Promise<void> {
    await fetch(`/api/village-guard/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }).catch(() => { });
}


// ── Expanded clan systems ─────────────────────────────────────────────────
type ClanRole = "Founder" | "Leader" | "Officer" | "Elite Member" | "Member" | "Recruit";
type ClanUpgradeKey = "trainingGrounds" | "warRoom" | "treasury" | "petDen" | "medicalWing" | "blacksmith" | "scoutNetwork";
type ClanUpgradeLevels = Record<ClanUpgradeKey, number>;
type ClanTreasury = { ryo: number; fateShards: number; boneCharms: number; auraStones: number; mythicSeals: number; };
type ClanWarRecord = { opponent: string; result: "Won" | "Lost" | "Draw"; finalScore: string; topAttacker: string; topDefender: string; mvpClan: string; reward: string; date: string; };
type EnhancedClanData = ClanData & { level: number; xp: number; treasury: ClanTreasury; upgrades: ClanUpgradeLevels; warHistory: ClanWarRecord[]; activeWar?: { opponentClan: string; enemyVillage: string; ourScore: number; enemyScore: number; startedAt: number; endsAt: number; }; roleOverrides?: Record<string, ClanRole>; };
const CLAN_UPGRADE_MAX_LEVEL = 50;
const clanBoostTiers = [
    { min: 3, max: 5, percent: 2 },
    { min: 6, max: 10, percent: 5 },
    { min: 11, max: 15, percent: 7 },
    { min: 16, max: Infinity, percent: 10 },
] as const;
const clanMissionDefinitions = [
    { key: "battle", icon: "⚔️", name: "Win 20 Battles", description: "Clan members combine for 20 battle wins.", target: 20, reward: "+450 Clan XP / +2,500 Treasury Ryo" },
    { key: "mission", icon: "📜", name: "Complete 50 Missions", description: "Clan members combine for 50 mission completions.", target: 50, reward: "+650 Clan XP / +3,500 Treasury Ryo" },
    { key: "guard", icon: "🛡️", name: "Defend Village 10 Times", description: "Keep village guard pressure active and defend the village.", target: 10, reward: "+500 Clan XP / +2,000 Treasury Ryo" },
    { key: "donation", icon: "💰", name: "Donate 25,000 Ryo", description: "Grow the clan treasury through member donations.", target: 25000, reward: "+700 Clan XP / +1 Aura Stone" },
    { key: "training", icon: "⏳", name: "Train 100 Hours", description: "Long-term clan discipline objective.", target: 100, reward: "+600 Clan XP" },
    { key: "raid", icon: "👹", name: "Defeat 5 Raid Bosses", description: "Raid contribution objective for future PvE events.", target: 5, reward: "+900 Clan XP / +1 Mythic Seal" },
] as const;
const CLAN_ROLE_ICON: Record<ClanRole, string> = { Founder: "👑", Leader: "🌟", Officer: "🛡️", "Elite Member": "🔱", Member: "🗡️", Recruit: "🌀" };
function defaultClanTreasury(): ClanTreasury { return { ryo: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0 }; }
function defaultClanUpgrades(): ClanUpgradeLevels { return { trainingGrounds: 0, warRoom: 0, treasury: 0, petDen: 0, medicalWing: 0, blacksmith: 0, scoutNetwork: 0 }; }
function cleanClanTreasury(t?: Partial<ClanTreasury>): ClanTreasury { const b = defaultClanTreasury(); const m = { ...b, ...(t ?? {}) } as ClanTreasury; (Object.keys(b) as Array<keyof ClanTreasury>).forEach(k => m[k] = Math.max(0, Math.floor(Number(m[k] ?? 0)))); return m; }
function cleanClanUpgrades(u?: Partial<ClanUpgradeLevels>): ClanUpgradeLevels { const b = defaultClanUpgrades(); const m = { ...b, ...(u ?? {}) } as ClanUpgradeLevels; (Object.keys(b) as ClanUpgradeKey[]).forEach(k => m[k] = clampNumber(Math.floor(Number(m[k] ?? 0)), 0, CLAN_UPGRADE_MAX_LEVEL)); return m; }
function defaultClanWarHistory(name: string): ClanWarRecord[] { return [{ opponent: "Iron Lanterns", result: "Won", finalScore: "84 - 61", topAttacker: "Rill", topDefender: "Village Guard", mvpClan: name, reward: "2,500 ryo / 450 Clan XP", date: "Recent Season" }]; }
function enhanceClanData(data: ClanData & Partial<EnhancedClanData>): EnhancedClanData { return { ...data, level: clampNumber(Math.floor(Number(data.level ?? 1)), 1, 100), xp: Math.max(0, Math.floor(Number(data.xp ?? 0))), treasury: cleanClanTreasury(data.treasury), upgrades: cleanClanUpgrades(data.upgrades), warHistory: data.warHistory?.length ? data.warHistory : defaultClanWarHistory(data.name), activeWar: data.activeWar, roleOverrides: data.roleOverrides ?? {} }; }
function clanXpNeeded(level: number) { return Math.floor(500 + level * 275 + Math.pow(level, 1.22) * 45); }
function addClanXp(data: EnhancedClanData, amount: number): EnhancedClanData { let next = { ...data, xp: data.xp + Math.max(0, Math.floor(amount)) }; while (next.level < 100 && next.xp >= clanXpNeeded(next.level)) next = { ...next, xp: next.xp - clanXpNeeded(next.level), level: next.level + 1 }; return next; }
function clanMemberBoostPercent(memberCount: number) { return clanBoostTiers.find(tier => memberCount >= tier.min && memberCount <= tier.max)?.percent ?? 0; }
function clanUpgradeBonus(data: EnhancedClanData, key: ClanUpgradeKey) { if (key === "trainingGrounds" || key === "scoutNetwork") return clanMemberBoostPercent(data.members.length); return 0; }
function clanRoleOf(member: ClanMemberEntry, data: EnhancedClanData): ClanRole { const override = data.roleOverrides?.[member.name]; if (override) return override; if (member.name === data.founderName || member.isFounder) return "Founder"; const sorted = [...data.members].filter(m => m.name !== data.founderName).sort((a, b) => clanContribTotal(b) - clanContribTotal(a)); const idx = sorted.findIndex(m => m.name === member.name); if (idx === 0) return "Leader"; if (idx > 0 && idx <= 2) return "Officer"; if (idx > 2 && idx <= 4) return "Elite Member"; if (clanContribTotal(member) <= 5) return "Recruit"; return "Member"; }
function canManageClan(role: ClanRole) { return role === "Founder" || role === "Leader" || role === "Officer"; }
function clanHallTier(level: number) { if (level >= 40) return { name: "Legendary Clan Citadel", icon: "🏰", desc: "A mythic fortress known across the ninja world." }; if (level >= 25) return { name: "War Fortress", icon: "🛡️", desc: "Walls, watchtowers, and banners built for war." }; if (level >= 15) return { name: "Hidden Clan Compound", icon: "⛩️", desc: "A fortified compound with training yards and sealed rooms." }; if (level >= 7) return { name: "Fortified Dojo", icon: "🥋", desc: "A proper dojo with guard posts and a treasury room." }; return { name: "Empty Clan Camp", icon: "🏕️", desc: "A small camp waiting to grow into a feared clan home." }; }
function clanMissionProgress(data: EnhancedClanData, key: string) { const battle = data.members.reduce((s, m) => s + (m.battleContrib ?? 0), 0); const mission = data.members.reduce((s, m) => s + (m.missionContrib ?? 0), 0); const event = data.members.reduce((s, m) => s + (m.eventContrib ?? 0), 0); if (key === "battle") return battle; if (key === "mission") return mission; if (key === "guard") return Math.min(10, Math.floor(event / 2) + data.members.filter(m => m.level >= 5).length); if (key === "donation") return data.treasury.ryo; if (key === "training") return Math.min(100, Math.floor((battle + mission + event) * 1.5)); if (key === "raid") return Math.min(5, Math.floor(event / 3)); return 0; }
function ClanHall({ character, updateCharacter }: { character: Character; updateCharacter: (c: Character) => void }) {
    const lore = clanLore[character.village];
    const isInClan = !!character.clan;
    const [clanName, setClanName] = useState("");
    const [joinInput, setJoinInput] = useState("");
    const [view, setView] = useState<"roster" | "guard" | "treasury" | "boosts" | "missions" | "wars" | "hall">("roster");
    const [loading, setLoading] = useState(false);
    const [clanData, setClanData] = useState<EnhancedClanData | null>(null);
    const [guardList, setGuardList] = useState<{ name: string; level: number; defenseBonusPercent?: number }[]>([]);
    const [guardBusy, setGuardBusy] = useState(false);
    const [donation, setDonation] = useState(1000);

    function myMemberEntry(): ClanMemberEntry {
        return { name: character.name, village: character.village, level: character.level, specialty: character.specialty, battleContrib: character.clanBattleContrib ?? 0, eventContrib: character.clanEventContrib ?? 0, missionContrib: character.clanMissionContrib ?? 0, isFounder: character.clanFounder ?? false, month: new Date().toISOString().slice(0, 7) };
    }
    async function saveClan(next: EnhancedClanData) { const enhanced = enhanceClanData(next); setClanData(enhanced); await writeClanData(enhanced); }

    useEffect(() => {
        if (!character.clan) { setClanData(null); return; }
        setLoading(true);
        fetchClanData(character.clan).then(async data => {
            if (!data) { setClanData(null); setLoading(false); return; }
            const enhanced = enhanceClanData(data);
            const myEntry = myMemberEntry();
            const exists = enhanced.members.find(m => m.name === character.name);
            const synced = enhanceClanData({ ...enhanced, members: exists ? enhanced.members.map(m => m.name === character.name ? { ...m, ...myEntry, isFounder: m.isFounder || myEntry.isFounder } : m) : [...enhanced.members, myEntry] });
            setClanData(synced); await writeClanData(synced); setLoading(false);
        });
    }, [character.clan, character.name, character.level, character.village, character.specialty, character.clanBattleContrib, character.clanEventContrib, character.clanMissionContrib]);

    useEffect(() => {
        if (!isInClan || view !== "guard") return;
        fetch("/api/village-guard/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ village: character.village }) })
            .then(r => r.ok ? r.json() : []).then(list => setGuardList(Array.isArray(list) ? list : [])).catch(() => setGuardList([]));
    }, [isInClan, view, character.village, character.guardQueued]);

    async function createClan() {
        const name = clanName.trim(); if (name.length < 3) return alert("Clan name must be at least 3 characters.");
        const existing = await fetchClanData(name); if (existing) return alert("That clan already exists.");
        const newClan = enhanceClanData({ name, village: character.village, founderName: character.name, createdAt: Date.now(), members: [{ ...myMemberEntry(), isFounder: true }] });
        await writeClanData(newClan); updateCharacter({ ...character, clan: name, clanFounder: true }); setClanData(newClan);
    }
    async function joinClan() {
        const name = joinInput.trim(); const data = await fetchClanData(name); if (!data) return alert("Clan not found. Check the exact name.");
        const enhanced = enhanceClanData(data); if (enhanced.village !== character.village) return alert("You can only join clans from your own village.");
        const myEntry = { ...myMemberEntry(), isFounder: false }; const updated = enhanceClanData({ ...enhanced, members: enhanced.members.some(m => m.name === character.name) ? enhanced.members : [...enhanced.members, myEntry] });
        await writeClanData(updated); updateCharacter({ ...character, clan: updated.name, clanFounder: false }); setClanData(updated);
    }
    async function leaveClan() {
        if (!character.clan) return; const data = await fetchClanData(character.clan); if (data) await writeClanData(enhanceClanData({ ...data, members: data.members.filter(m => m.name !== character.name) }));
        updateCharacter({ ...character, clan: undefined, clanFounder: false, guardQueued: false }); setClanData(null);
    }
    async function toggleGuard() {
        const queued = character.guardQueued ?? false; setGuardBusy(true);
        if (queued) { await postGuardQueue("dequeue", { name: character.name, village: character.village }); updateCharacter({ ...character, guardQueued: false }); }
        else { await postGuardQueue("queue", { name: character.name, village: character.village, level: character.level, defenseBonusPercent: getTownDefenseGuardBonus(character) }); updateCharacter({ ...character, guardQueued: true }); }
        setGuardBusy(false);
    }
    async function donateRyo() {
        if (!clanData) return; const amount = Math.max(1, Math.floor(donation)); if (character.ryo < amount) return alert("Not enough ryo.");
        await saveClan(addClanXp({ ...clanData, treasury: { ...clanData.treasury, ryo: clanData.treasury.ryo + amount } }, Math.floor(amount / 35)));
        updateCharacter({ ...character, ryo: character.ryo - amount, clanEventContrib: (character.clanEventContrib ?? 0) + Math.max(1, Math.floor(amount / 1000)) });
    }
    async function donateSpecial(currency: keyof Omit<ClanTreasury, "ryo">, amount: number) {
        if (!clanData) return; const current = character[currency] ?? 0; if (current < amount) return alert(`Not enough ${currency}.`);
        await saveClan(addClanXp({ ...clanData, treasury: { ...clanData.treasury, [currency]: clanData.treasury[currency] + amount } }, amount * 200));
        updateCharacter({ ...character, [currency]: current - amount, clanEventContrib: (character.clanEventContrib ?? 0) + amount } as Character);
    }
    async function startClanWar() {
        if (!clanData) return; if (clanData.activeWar) return alert("Your clan already has an active war.");
        const rivals = ["Iron Lanterns", "Black Rain Circle", "Crimson Market Ronin", "White Ridge Pack"];
        await saveClan({ ...clanData, activeWar: { opponentClan: rivals[(clanData.warHistory.length + clanData.level) % rivals.length], enemyVillage: villages[(villages.indexOf(character.village) + 1) % villages.length], ourScore: 0, enemyScore: 0, startedAt: Date.now(), endsAt: Date.now() + 48 * 60 * 60 * 1000 } });
    }
    async function addWarScore(points: number) { if (!clanData?.activeWar) return; const boosted = Math.max(1, Math.round(points * (1 + clanUpgradeBonus(clanData, "warRoom") / 100))); await saveClan({ ...clanData, activeWar: { ...clanData.activeWar, ourScore: clanData.activeWar.ourScore + boosted, enemyScore: clanData.activeWar.enemyScore + Math.floor(points / 2) } }); updateCharacter({ ...character, auraDust: (character.auraDust ?? 0) + Math.max(1, points) }); }
    async function resolveClanWar() {
        if (!clanData?.activeWar) return; const war = clanData.activeWar; const result: ClanWarRecord["result"] = war.ourScore > war.enemyScore ? "Won" : war.ourScore < war.enemyScore ? "Lost" : "Draw";
        const record: ClanWarRecord = { opponent: war.opponentClan, result, finalScore: `${war.ourScore} - ${war.enemyScore}`, topAttacker: character.name, topDefender: character.guardQueued ? character.name : "Village Guard", mvpClan: result === "Won" ? clanData.name : result === "Lost" ? war.opponentClan : "None", reward: result === "Won" ? "4,000 ryo / 800 Clan XP" : result === "Draw" ? "1,500 ryo / 300 Clan XP" : "250 Clan XP", date: new Date().toLocaleDateString() };
        await saveClan(addClanXp({ ...clanData, activeWar: undefined, warHistory: [record, ...clanData.warHistory].slice(0, 12), treasury: { ...clanData.treasury, ryo: clanData.treasury.ryo + (result === "Won" ? 4000 : result === "Draw" ? 1500 : 0) } }, result === "Won" ? 800 : result === "Draw" ? 300 : 250));
    }

    if (!isInClan) return <div className="card clan-hall-screen"><div className="clan-create-hero"><div><p className="act-label">{character.village}</p><h2>⛩️ {lore?.name ?? "Clan Hall"}</h2><p className="hint">{lore?.motto}</p></div><span className="clan-hall-big-icon">⛩️</span></div><p>{lore?.lore}</p><div className="clan-join-grid"><div className="summary-box"><h3>Create Clan</h3><p className="hint">Become founder, open a clan treasury, unlock member-count boosts, missions, wars, and a growing clan hall.</p><label>Clan Name</label><input value={clanName} onChange={e => setClanName(e.target.value)} placeholder="Example: Fated Reunion" /><button onClick={createClan}>Create Clan</button></div><div className="summary-box"><h3>Join Clan</h3><p className="hint">Enter the exact name of a clan from your village.</p><label>Clan Name</label><input value={joinInput} onChange={e => setJoinInput(e.target.value)} placeholder="Exact clan name..." /><button onClick={joinClan}>Join Clan</button></div></div></div>;
    if (loading) return <div className="card"><p style={{ color: "#94a3b8" }}>Loading clan data…</p></div>;
    if (!clanData) return <div className="card"><h2>⛩️ Clan Hall</h2><p>Could not load clan data for <strong>{character.clan}</strong>.</p><button className="danger-button" onClick={leaveClan}>Leave Clan</button></div>;

    const founderEntry = clanData.members.find(m => m.name === clanData.founderName);
    const nonFounders = [...clanData.members].filter(m => m.name !== clanData.founderName).sort((a, b) => clanContribTotal(b) - clanContribTotal(a));
    const sortedMembers = founderEntry ? [founderEntry, ...nonFounders] : nonFounders;
    const myEntry = clanData.members.find(m => m.name === character.name) ?? myMemberEntry();
    const myRank = clanRankOf(myEntry, clanData.members, clanData.founderName);
    const myRole = clanRoleOf(myEntry, clanData);
    const myContrib = clanContribTotal(myEntry);
    const hall = clanHallTier(clanData.level);
    const xpNeed = clanXpNeeded(clanData.level);
    const clanBoostPercent = clanMemberBoostPercent(clanData.members.length);
    const clanBuffs = [
        { label: "Training XP", value: clanBoostPercent }, { label: "Mission XP", value: clanBoostPercent }, { label: "Ryo Gain", value: clanBoostPercent },
    ].filter(buff => buff.value > 0);

    return <div className="card clan-hall-screen">
        <div className="clan-header"><div><h2 style={{ margin: 0 }}>🏴 {clanData.name}</h2><p className="hint" style={{ margin: "2px 0 0" }}>{clanData.village} · {clanData.members.length} members · Level {clanData.level}</p><div className="clan-xp-track"><span style={{ width: `${Math.min(100, (clanData.xp / xpNeed) * 100)}%` }} /></div><small>{clanData.xp.toLocaleString()} / {xpNeed.toLocaleString()} Clan XP</small></div><div className="clan-my-badge"><span className="clan-rank-badge" style={{ background: CLAN_RANK_COLOR[myRank] + "22", color: CLAN_RANK_COLOR[myRank], borderColor: CLAN_RANK_COLOR[myRank] + "55" }}>{CLAN_RANK_ICON[myRank]} {myRank}</span><span className="clan-role-badge">{CLAN_ROLE_ICON[myRole]} {myRole}</span><span className="clan-my-contrib">{myContrib} pts this month</span></div></div>
        <div className="clan-buff-banner"><strong>Active Clan Boosts</strong>{clanBuffs.length === 0 ? <span>No clan boosts yet — recruit at least 3 members.</span> : clanBuffs.map(buff => <span key={buff.label}>{buff.label} +{buff.value.toFixed(2)}%</span>)}</div>
        <div className="clan-tabs expanded-tabs"><button className={view === "roster" ? "active" : ""} onClick={() => setView("roster")}>📋 Roster</button><button className={view === "treasury" ? "active" : ""} onClick={() => setView("treasury")}>💰 Treasury</button><button className={view === "boosts" ? "active" : ""} onClick={() => setView("boosts")}>✨ Boosts</button><button className={view === "missions" ? "active" : ""} onClick={() => setView("missions")}>📜 Missions</button><button className={view === "wars" ? "active" : ""} onClick={() => setView("wars")}>⚔️ Wars</button><button className={view === "guard" ? "active" : ""} onClick={() => setView("guard")}>🛡️ Guard</button><button className={view === "hall" ? "active" : ""} onClick={() => setView("hall")}>⛩️ Hall</button></div>
        {view === "roster" && <div className="clan-roster"><div className="clan-roster-header clan-roster-header-wide"><span>#</span><span>Member</span><span>Rank</span><span>Role</span><span>Contribution</span></div>{sortedMembers.map((member, idx) => { const rank = clanRankOf(member, clanData.members, clanData.founderName); const role = clanRoleOf(member, clanData); const contrib = clanContribTotal(member); const isMe = member.name === character.name; const rankColor = CLAN_RANK_COLOR[rank]; return <div key={member.name} className={`clan-member-row clan-member-row-wide${isMe ? " clan-member-me" : ""}`}><span className="clan-member-pos">#{idx + 1}</span><div className="clan-member-info"><span className="clan-member-name">{member.name}{isMe ? " ✦" : ""}</span><span className="clan-member-sub">Lv.{member.level} · {member.specialty}</span></div><span className="clan-rank-badge" style={{ background: rankColor + "1a", color: rankColor, borderColor: rankColor + "44" }}>{CLAN_RANK_ICON[rank]} {rank}</span><span className="clan-role-badge">{CLAN_ROLE_ICON[role]} {role}</span><div className="clan-contrib-col"><span className="clan-contrib-total">{contrib} pts</span><span className="clan-contrib-breakdown">⚔️{member.battleContrib} ✦{member.eventContrib} 📜{member.missionContrib}</span></div></div>; })}<div className="summary-box clan-rank-legend"><strong style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Permissions</strong><p className="hint">Founder, Leader, and Officer can start clan wars. Everyone can donate, recruit, and contribute missions.</p></div></div>}
        {view === "treasury" && <div className="summary-box"><h3>💰 Clan Treasury</h3><div className="treasury-grid"><p><strong>Ryo:</strong> {clanData.treasury.ryo.toLocaleString()}</p><p><strong>Fate Shards:</strong> {clanData.treasury.fateShards}</p><p><strong>Bone Charms:</strong> {clanData.treasury.boneCharms}</p><p><strong>Aura Stones:</strong> {clanData.treasury.auraStones}</p><p><strong>Mythic Seals:</strong> {clanData.treasury.mythicSeals}</p></div><label>Donate Ryo</label><input type="number" value={donation} onChange={(e) => setDonation(Number(e.target.value))} /><div className="menu"><button onClick={donateRyo}>Donate Ryo</button><button onClick={() => donateSpecial("fateShards", 1)}>Donate 1 Fate Shard</button><button onClick={() => donateSpecial("boneCharms", 1)}>Donate 1 Bone Charm</button><button onClick={() => donateSpecial("auraStones", 1)}>Donate 1 Aura Stone</button><button onClick={() => donateSpecial("mythicSeals", 1)}>Donate 1 Mythic Seal</button></div><p className="hint">Donations add clan XP and treasury resources.</p></div>}
        {view === "boosts" && <div className="clan-upgrade-grid">{clanBoostTiers.map(tier => { const active = clanData.members.length >= tier.min && clanData.members.length <= tier.max; const label = Number.isFinite(tier.max) ? `${tier.min}-${tier.max} members` : `${tier.min}+ members`; return <div key={label} className={`town-upgrade-card clan-upgrade-card ${active ? "active" : ""}`}><div className="town-upgrade-topline"><span className="town-upgrade-icon">✨</span><div><strong>{label}</strong><p>{active ? "Active Boost" : "Recruitment Tier"}</p></div></div><div className="town-upgrade-bar"><span style={{ width: active ? "100%" : "0%" }} /></div><p className="town-upgrade-desc">Clan members receive +{tier.percent}% training XP, mission XP, and ryo gain at this roster size.</p><p className="town-upgrade-bonus">Boost: <strong>+{tier.percent}%</strong></p></div>; })}</div>}
        {view === "missions" && <div className="clan-mission-grid">{clanMissionDefinitions.map(mission => { const progress = clanMissionProgress(clanData, mission.key); return <div key={mission.key} className="summary-box clan-mission-card"><h3>{mission.icon} {mission.name}</h3><p>{mission.description}</p><div className="town-upgrade-bar"><span style={{ width: `${Math.min(100, (progress / mission.target) * 100)}%` }} /></div><p><strong>{Math.min(progress, mission.target).toLocaleString()}</strong> / {mission.target.toLocaleString()}</p><p className="hint">Reward: {mission.reward}</p></div>; })}</div>}
        {view === "wars" && <div className="summary-box"><h3>⚔️ Clan Wars</h3>{clanData.activeWar ? <div className="clan-war-active"><h3>{clanData.name} vs {clanData.activeWar.opponentClan}</h3><p className="hint">Enemy Village: {clanData.activeWar.enemyVillage} · Ends: {new Date(clanData.activeWar.endsAt).toLocaleString()}</p><div className="war-score-board"><strong>{clanData.activeWar.ourScore}</strong><span>VS</span><strong>{clanData.activeWar.enemyScore}</strong></div><div className="menu"><button onClick={() => addWarScore(3)}>Log Arena Win +3</button><button onClick={() => addWarScore(2)}>Log Defense Win +2</button><button onClick={() => addWarScore(5)}>Log Raid Contribution +5</button><button onClick={resolveClanWar}>Resolve War</button></div></div> : <button disabled={!canManageClan(myRole)} onClick={startClanWar}>{canManageClan(myRole) ? "Start Clan War" : "Officer+ can start wars"}</button>}<h4>Past War History</h4><div className="war-record-grid">{clanData.warHistory.map((war, idx) => <div key={`${war.opponent}-${idx}`} className="war-record-card"><strong>{war.result} vs {war.opponent}</strong><span>{war.finalScore}</span><small>{war.date} · MVP: {war.mvpClan}</small><small>Top Attacker: {war.topAttacker} · Top Defender: {war.topDefender}</small><small>Reward: {war.reward}</small></div>)}</div></div>}
        {view === "guard" && <div className="summary-box"><h3>🛡️ Village Guard</h3><p className="hint">Queue as a guard to defend <strong>{character.village}</strong>. Town Hall defense bonus applies while you are queued.</p><button className={character.guardQueued ? "danger-button" : ""} onClick={toggleGuard} disabled={guardBusy} style={{ marginBottom: 12 }}>{guardBusy ? "Updating…" : character.guardQueued ? "🛑 Leave Guard Queue" : "🛡️ Queue as Village Guard"}</button><h4>Active Guards for {character.village} ({guardList.length})</h4>{guardList.length === 0 ? <p className="hint">No active guards. Village is undefended.</p> : <div className="clan-guard-list">{guardList.map(g => <div key={g.name} className="clan-guard-row"><span>🛡️ <strong>{g.name}</strong></span><span className="clan-guard-lvl">Lv. {g.level}{g.defenseBonusPercent ? ` · DEF +${g.defenseBonusPercent.toFixed(1)}%` : ""}</span></div>)}</div>}</div>}
        {view === "hall" && <div className="summary-box clan-visual-hall"><span className="clan-hall-tier-icon">{hall.icon}</span><div><h3>{hall.name}</h3><p>{hall.desc}</p><p className="hint">Hall tier grows automatically from clan level: Camp → Dojo → Compound → Fortress → Citadel.</p></div></div>}
        <div className="menu" style={{ marginTop: 12 }}><button className="danger-button" onClick={leaveClan}>Leave Clan</button></div>
    </div>;
}

// ── Expanded Town Hall state ──────────────────────────────────────────────
type VillageTreasury = { ryo: number; honorSeals: number; fateShards: number; boneCharms: number; auraStones: number; mythicSeals: number; };
type DetailedVillageWarRecord = { opponent: string; winner: string; finalScore: string; topDefender: string; topAttacker: string; mvpClan: string; rewards: string; date: string; };
type VillageState = { treasury: VillageTreasury; contributionPoints: number; notices: string[]; warRecords: DetailedVillageWarRecord[]; };
function defaultVillageTreasury(): VillageTreasury { return { ryo: 0, honorSeals: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0 }; }
function cleanVillageTreasury(t?: Partial<VillageTreasury>): VillageTreasury { const b = defaultVillageTreasury(); const m = { ...b, ...(t ?? {}) } as VillageTreasury; (Object.keys(b) as Array<keyof VillageTreasury>).forEach(k => m[k] = Math.max(0, Math.floor(Number(m[k] ?? 0)))); return m; }
function defaultVillageWarRecords(village: string): DetailedVillageWarRecord[] { const leadership = villageLeadership[village]; return (leadership?.pastWars ?? ["No recorded wars yet."]).map((war, index) => ({ opponent: war.replace(/^Won |^Lost |^Draw at /, ""), winner: war.startsWith("Won") ? village : war.startsWith("Lost") ? "Enemy Village" : "Draw", finalScore: index === 0 ? "112 - 88" : index === 1 ? "76 - 91" : "64 - 64", topDefender: leadership?.elders?.[index % 3] ?? "Village Guard", topAttacker: leadership?.kage ?? "Kage Council", mvpClan: index === 0 ? "Fated Reunion" : "Unclaimed", rewards: index === 0 ? "Village XP / guard medals" : "Archive record", date: index === 0 ? "Recent Season" : "Previous Season" })); }
function defaultVillageState(village: string): VillageState { return { treasury: defaultVillageTreasury(), contributionPoints: 0, notices: ["Town Hall upgrades are open for donation funding.", "Village Guard queue is accepting defenders."], warRecords: defaultVillageWarRecords(village) }; }
function villageStateKey(village: string) { return "village-state-" + village.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function normalizeVillageState(village: string, state?: Partial<VillageState>): VillageState { const base = defaultVillageState(village); return { treasury: cleanVillageTreasury(state?.treasury), contributionPoints: Math.max(0, Math.floor(Number(state?.contributionPoints ?? 0))), notices: state?.notices?.length ? state.notices.slice(0, 8) : base.notices, warRecords: state?.warRecords?.length ? state.warRecords : base.warRecords }; }
function loadVillageState(village: string): VillageState { try { const raw = localStorage.getItem(villageStateKey(village)); return normalizeVillageState(village, raw ? JSON.parse(raw) : undefined); } catch { return defaultVillageState(village); } }
function saveVillageState(village: string, state: VillageState) { try { localStorage.setItem(villageStateKey(village), JSON.stringify(normalizeVillageState(village, state))); } catch { } }

function TownHall({ character, updateCharacter }: { character: Character; updateCharacter: (character: Character) => void }) {
    const leadership = villageLeadership[character.village] ?? { kage: "Acting Kage Council", elders: ["First Elder", "Second Elder", "Third Elder"], atWar: false, pastWars: ["No recorded wars yet."] };
    const leadershipImages = loadVillageLeadershipImages()[character.village] ?? { kage: "", elders: ["", "", ""] };
    const upgrades = getVillageUpgrades(character);
    const totalUpgradeLevel = Object.values(upgrades).reduce((sum, level) => sum + level, 0);
    const [tab, setTab] = useState<"status" | "upgrades" | "treasury" | "guard" | "politics">("status");
    const [state, setState] = useState<VillageState>(() => loadVillageState(character.village));
    const [donation, setDonation] = useState(1000);
    const [guardList, setGuardList] = useState<{ name: string; level: number; defenseBonusPercent?: number }[]>([]);
    const [guardBusy, setGuardBusy] = useState(false);
    useEffect(() => setState(loadVillageState(character.village)), [character.village]);
    useEffect(() => saveVillageState(character.village, state), [character.village, state]);
    useEffect(() => { if (tab !== "guard" && tab !== "status") return; fetch("/api/village-guard/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ village: character.village }) }).then(r => r.ok ? r.json() : []).then(list => setGuardList(Array.isArray(list) ? list : [])).catch(() => setGuardList([])); }, [tab, character.village, character.guardQueued]);
    function updateVillageState(next: VillageState) { const normalized = normalizeVillageState(character.village, next); setState(normalized); saveVillageState(character.village, normalized); }
    function addNotice(text: string, nextState: VillageState = state) { return { ...nextState, notices: [text, ...nextState.notices].slice(0, 8) }; }
    function upgradeTownFeature(key: VillageUpgradeKey) { const currentLevel = upgrades[key]; if (currentLevel >= VILLAGE_UPGRADE_MAX_LEVEL) return alert("This village upgrade is already maxed at level 50."); const cost = villageUpgradeCost(key, currentLevel); if ((character.honorSeals ?? 0) < cost) return alert(`Not enough Honor Seals. You need ${cost.toLocaleString()} Honor Seals.`); updateCharacter({ ...character, honorSeals: (character.honorSeals ?? 0) - cost, villageUpgrades: { ...upgrades, [key]: currentLevel + 1 } }); updateVillageState(addNotice(`${character.name} spent ${cost.toLocaleString()} Honor Seals to upgrade ${villageUpgradeDefinitions.find(def => def.key === key)?.name ?? key} to level ${currentLevel + 1}.`, { ...state, contributionPoints: state.contributionPoints + 10 })); }
    function donateVillageRyo() { const amount = Math.max(1, Math.floor(donation)); if (character.ryo < amount) return alert("Not enough ryo."); updateCharacter({ ...character, ryo: character.ryo - amount }); updateVillageState(addNotice(`${character.name} donated ${amount.toLocaleString()} ryo to the village treasury.`, { ...state, treasury: { ...state.treasury, ryo: state.treasury.ryo + amount }, contributionPoints: state.contributionPoints + Math.max(1, Math.floor(amount / 1000)) })); }
    function donateVillageSpecial(currency: keyof Omit<VillageTreasury, "ryo">) { const current = character[currency] ?? 0; if (current < 1) return alert(`Not enough ${currency}.`); updateCharacter({ ...character, [currency]: current - 1 } as Character); updateVillageState(addNotice(`${character.name} donated 1 ${currency} to the village treasury.`, { ...state, treasury: { ...state.treasury, [currency]: state.treasury[currency] + 1 }, contributionPoints: state.contributionPoints + 5 })); }
    async function toggleTownGuard() { const queued = character.guardQueued ?? false; setGuardBusy(true); if (queued) { await postGuardQueue("dequeue", { name: character.name, village: character.village }); updateCharacter({ ...character, guardQueued: false }); updateVillageState(addNotice(`${character.name} left the Village Guard queue.`)); } else { await postGuardQueue("queue", { name: character.name, village: character.village, level: character.level, defenseBonusPercent: getTownDefenseGuardBonus(character) }); updateCharacter({ ...character, guardQueued: true }); updateVillageState(addNotice(`${character.name} joined the Village Guard queue with +${getTownDefenseGuardBonus(character).toFixed(1)}% defense.`)); } setGuardBusy(false); }
    function postKageChallenge() { updateVillageState(addNotice(`${character.name} entered the Kage challenge discussion for the next election cycle.`, { ...state, contributionPoints: state.contributionPoints + 25 })); }
    function supportVillageFocus(focus: string) { updateVillageState(addNotice(`${character.name} supported the ${focus} village focus.`, { ...state, contributionPoints: state.contributionPoints + 10 })); }
    const villageLevel = Math.max(1, Math.floor(totalUpgradeLevel / 8) + 1);
    const villageStrength = totalUpgradeLevel * 25 + state.contributionPoints + guardList.length * 75;
    const population = 1000 + villageLevel * 90 + state.contributionPoints * 2;
    const contributionRankings = [{ name: character.name, role: "Candidate", points: state.contributionPoints + totalUpgradeLevel * 12 }, { name: leadership.elders[0] ?? "War Elder", role: "War Elder", points: totalUpgradeLevel * 8 + 120 }, { name: leadership.elders[1] ?? "Trade Elder", role: "Trade Elder", points: totalUpgradeLevel * 7 + 95 }, { name: leadership.elders[2] ?? "Training Elder", role: "Training Elder", points: totalUpgradeLevel * 6 + 80 }].sort((a, b) => b.points - a.points);
    return <div className="card town-hall-screen">
        <div className="town-hall-hero"><div><p className="act-label">{character.village}</p><h2>🏯 Town Hall</h2><p className="hint">Village government, war records, guard defense, upgrades, treasury, and leadership.</p></div><div className="town-hall-wallet"><span>Honor Seals</span><strong>{(character.honorSeals ?? 0).toLocaleString()}</strong><small>Ryo {character.ryo.toLocaleString()}</small></div></div>
        <div className="clan-tabs expanded-tabs town-tabs"><button className={tab === "status" ? "active" : ""} onClick={() => setTab("status")}>📊 Status</button><button className={tab === "upgrades" ? "active" : ""} onClick={() => setTab("upgrades")}>🏗️ Upgrades</button><button className={tab === "treasury" ? "active" : ""} onClick={() => setTab("treasury")}>💰 Treasury</button><button className={tab === "guard" ? "active" : ""} onClick={() => setTab("guard")}>🛡️ Guard</button><button className={tab === "politics" ? "active" : ""} onClick={() => setTab("politics")}>👑 Kage/Elders</button></div>
        {tab === "status" && <><div className="town-hall-grid"><section className="summary-box town-hall-panel"><h3>👑 Village Status</h3><div className="town-leader-row">{leadershipImages.kage && <img src={leadershipImages.kage} alt={leadership.kage} />}<p><strong>Kage:</strong> {leadership.kage}</p></div><p><strong>Population:</strong> {population.toLocaleString()}</p><p><strong>Village Level:</strong> {villageLevel}</p><p><strong>Village Strength:</strong> {villageStrength.toLocaleString()}</p><p><strong>Guard Queue:</strong> {guardList.length} active defender{guardList.length === 1 ? "" : "s"}</p></section><section className="summary-box town-hall-panel"><h3>⚔️ War Status</h3><div className={leadership.atWar ? "war-status at-war" : "war-status peace"}>{leadership.atWar ? "At War" : "Not At War"}</div><h4>Current Village Buffs</h4><div className="village-buff-list"><span>Training +{getTrainingXpBonus(character).toFixed(2)}%</span><span>Jutsu Speed +{getJutsuTrainingSpeedBonus(character).toFixed(2)}%</span><span>Shop Discount +{getShopDiscountPercent(character).toFixed(2)}%</span><span>Guard DEF +{getTownDefenseGuardBonus(character).toFixed(2)}%</span><span>Pet XP +{getPetXpBonus(character).toFixed(2)}%</span><span>Bank Interest +{getBankInterestPercent(character).toFixed(2)}%</span><span>Mission Rewards +{getMissionRewardBonus(character).toFixed(2)}%</span><span>Hospital Discount +{getHospitalDiscountPercent(character).toFixed(2)}%</span></div></section></div><section className="summary-box town-notice-board"><h3>📌 Village Notice Board</h3>{state.notices.map((notice, idx) => <p key={`${notice}-${idx}`}>• {notice}</p>)}</section><section className="summary-box"><h3>📜 Detailed War Records</h3><div className="war-record-grid">{state.warRecords.map((war, idx) => <div key={`${war.opponent}-${idx}`} className="war-record-card"><strong>{war.winner} vs {war.opponent}</strong><span>{war.finalScore}</span><small>{war.date} · MVP Clan: {war.mvpClan}</small><small>Top Attacker: {war.topAttacker}</small><small>Top Defender: {war.topDefender}</small><small>Rewards: {war.rewards}</small></div>)}</div></section></>}
        {tab === "upgrades" && <section className="summary-box town-upgrade-summary"><h3>🏗️ Village Upgrades</h3><p className="hint">Village upgrades now spend <strong>Honor Seals</strong>. Earn them from village raids and defenses.</p><p className="hint">Total Village Development: <strong>{totalUpgradeLevel}</strong> / {VILLAGE_UPGRADE_MAX_LEVEL * villageUpgradeDefinitions.length}</p><div className="town-upgrade-grid">{villageUpgradeDefinitions.map((upgrade) => { const level = upgrades[upgrade.key]; const bonus = level * upgrade.perLevel; const cost = villageUpgradeCost(upgrade.key, level); const maxed = level >= VILLAGE_UPGRADE_MAX_LEVEL; const canAfford = (character.honorSeals ?? 0) >= cost; return <div key={upgrade.key} className="town-upgrade-card"><div className="town-upgrade-topline"><span className="town-upgrade-icon">{upgrade.icon}</span><div><strong>{upgrade.name}</strong><p>Level {level}/{VILLAGE_UPGRADE_MAX_LEVEL}</p></div></div><div className="town-upgrade-bar"><span style={{ width: `${(level / VILLAGE_UPGRADE_MAX_LEVEL) * 100}%` }} /></div><p className="town-upgrade-desc">{upgrade.description}</p><p className="town-upgrade-bonus">Current Bonus: <strong>{bonus.toFixed(2)}{upgrade.unit}</strong></p><button disabled={maxed || !canAfford} onClick={() => upgradeTownFeature(upgrade.key)}>{maxed ? "Max Level" : canAfford ? `Upgrade — ${cost.toLocaleString()} Honor Seals` : `Need ${cost.toLocaleString()} Honor Seals`}</button></div>; })}</div></section>}
        {tab === "treasury" && <section className="summary-box"><h3>💰 Village Treasury</h3><p className="hint">Honor Seals are the village war and boost reserve for Kage spending.</p><div className="treasury-grid"><p><strong>Ryo:</strong> {state.treasury.ryo.toLocaleString()}</p><p><strong>Honor Seals:</strong> {state.treasury.honorSeals.toLocaleString()}</p><p><strong>Fate Shards:</strong> {state.treasury.fateShards}</p><p><strong>Bone Charms:</strong> {state.treasury.boneCharms}</p><p><strong>Aura Stones:</strong> {state.treasury.auraStones}</p><p><strong>Mythic Seals:</strong> {state.treasury.mythicSeals}</p><p><strong>Your Contribution:</strong> {state.contributionPoints} pts</p></div><label>Donate Ryo</label><input type="number" value={donation} onChange={(e) => setDonation(Number(e.target.value))} /><div className="menu"><button onClick={donateVillageRyo}>Donate Ryo</button><button onClick={() => donateVillageSpecial("honorSeals")}>Donate 1 Honor Seal</button><button onClick={() => donateVillageSpecial("fateShards")}>Donate 1 Fate Shard</button><button onClick={() => donateVillageSpecial("boneCharms")}>Donate 1 Bone Charm</button><button onClick={() => donateVillageSpecial("auraStones")}>Donate 1 Aura Stone</button><button onClick={() => donateVillageSpecial("mythicSeals")}>Donate 1 Mythic Seal</button></div></section>}
        {tab === "guard" && <section className="summary-box"><h3>🛡️ Village Guard Queue</h3><p className="hint">Town Defense gives +0.1% defense per level vs Genjutsu, Taijutsu, Bukijutsu, and Ninjutsu while defending through this queue.</p><p>Current Town Defense Bonus: <strong>+{getTownDefenseGuardBonus(character).toFixed(2)}%</strong></p><button className={character.guardQueued ? "danger-button" : ""} onClick={toggleTownGuard} disabled={guardBusy}>{guardBusy ? "Updating…" : character.guardQueued ? "Leave Guard Queue" : "Queue as Village Guard"}</button><h4>Active Defenders</h4>{guardList.length === 0 ? <p className="hint">No active guards right now.</p> : <div className="clan-guard-list">{guardList.map(g => <div key={g.name} className="clan-guard-row"><span>🛡️ <strong>{g.name}</strong></span><span className="clan-guard-lvl">Lv. {g.level}{g.defenseBonusPercent ? ` · DEF +${g.defenseBonusPercent.toFixed(1)}%` : ""}</span></div>)}</div>}</section>}
        {tab === "politics" && <><section className="summary-box"><h3>👑 Kage & Elder Seats</h3><div className="town-leader-row town-kage-card">{leadershipImages.kage && <img src={leadershipImages.kage} alt={leadership.kage} />}<p><strong>Current Kage:</strong> {leadership.kage}</p></div><div className="elder-seat-grid"><div className="elder-card">{leadershipImages.elders?.[0] && <img className="elder-portrait" src={leadershipImages.elders[0]} alt={leadership.elders[0]} />}<span>War Elder</span><strong>{leadership.elders[0]}</strong><button onClick={() => supportVillageFocus("War Elder")}>Support War Focus</button></div><div className="elder-card">{leadershipImages.elders?.[1] && <img className="elder-portrait" src={leadershipImages.elders[1]} alt={leadership.elders[1]} />}<span>Trade Elder</span><strong>{leadership.elders[1]}</strong><button onClick={() => supportVillageFocus("Trade Elder")}>Support Trade Focus</button></div><div className="elder-card">{leadershipImages.elders?.[2] && <img className="elder-portrait" src={leadershipImages.elders[2]} alt={leadership.elders[2]} />}<span>Training Elder</span><strong>{leadership.elders[2]}</strong><button onClick={() => supportVillageFocus("Training Elder")}>Support Training Focus</button></div></div></section><section className="summary-box"><h3>🗳️ Kage Election / Challenge Board</h3><p className="hint">Local test version of future Kage elections. Contribution points decide who rises in the village.</p><div className="contrib-rank-grid">{contributionRankings.map((row, idx) => <div key={row.name} className="clan-guard-row"><span>#{idx + 1} <strong>{row.name}</strong> — {row.role}</span><span>{row.points.toLocaleString()} pts</span></div>)}</div><button onClick={postKageChallenge}>Enter Kage Challenge Discussion</button></section></>}
    </div>;
}

function Bank({ character, updateCharacter }: { character: Character; updateCharacter: (character: Character) => void }) {
    const [amount, setAmount] = useState(0);
    const interestPercent = getBankInterestPercent(character);
    const lastClaim = character.lastBankInterestAt ?? 0;
    const nextClaimAt = lastClaim + 24 * 60 * 60 * 1000;
    const canClaimInterest = character.bankRyo > 0 && interestPercent > 0 && Date.now() >= nextClaimAt;
    const projectedInterest = Math.max(0, Math.floor(character.bankRyo * (interestPercent / 100)));

    function deposit() {
        const value = Math.max(0, Math.floor(amount));
        if (value > character.ryo) return alert("Not enough ryo.");
        updateCharacter({ ...character, ryo: character.ryo - value, bankRyo: character.bankRyo + value });
    }

    function withdraw() {
        const value = Math.max(0, Math.floor(amount));
        if (value > character.bankRyo) return alert("Not enough banked ryo.");
        updateCharacter({ ...character, ryo: character.ryo + value, bankRyo: character.bankRyo - value });
    }

    function claimInterest() {
        if (interestPercent <= 0) return alert("Upgrade the Bank in Town Hall to earn interest.");
        if (character.bankRyo <= 0) return alert("Deposit ryo first.");
        if (Date.now() < nextClaimAt) return alert(`Interest can be claimed again at ${new Date(nextClaimAt).toLocaleString()}.`);
        if (projectedInterest <= 0) return alert("Your deposit is too small to earn interest yet.");
        updateCharacter({ ...character, bankRyo: character.bankRyo + projectedInterest, lastBankInterestAt: Date.now() });
        alert(`Bank interest claimed: +${projectedInterest.toLocaleString()} ryo.`);
    }

    return (
        <div className="card">
            <h2>Bank</h2>
            <div className="summary-box profile-summary">
                <p>Wallet: <strong>{character.ryo.toLocaleString()}</strong> ryo</p>
                <p>Bank: <strong>{character.bankRyo.toLocaleString()}</strong> ryo</p>
                <p>Interest Rate: <strong>{interestPercent.toFixed(2)}%</strong></p>
                <p>Projected Claim: <strong>{projectedInterest.toLocaleString()}</strong> ryo</p>
            </div>
            <label>Amount</label>
            <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            <div className="menu">
                <button onClick={deposit}>Deposit</button>
                <button onClick={withdraw}>Withdraw</button>
                <button onClick={claimInterest} disabled={!canClaimInterest}>Collect Interest</button>
            </div>
            <p className="hint">Town Hall Bank upgrade gives +0.25% interest per level. Interest can be collected once every 24 hours.</p>
        </div>
    );
}


function ShopBase({
    character, updateCharacter, creatorItems, title, subtitle, filterRarities, currency = "ryo",
}: {
    character: Character; updateCharacter: (c: Character) => void; creatorItems: GameItem[];
    title: string; subtitle: string; filterRarities: GameItem["rarity"][];
    currency?: "ryo" | "fateShards";
}) {
    const [selectedItem, setSelectedItem] = useState<GameItem | null>(null);

    const allItems = getAllItems(creatorItems);
    const shopSlots: EquipmentSlot[] = ["head", "body", "waist", "legs", "feet", "hand", "aura", "weapon", "thrown", "item", "accessory"];
    const shopItems = allItems.filter(
        (item) => shopSlots.includes(item.slot) && filterRarities.includes(item.rarity)
    );

    const slotGroups: { label: string; slots: EquipmentSlot[] }[] = [
        { label: "Head", slots: ["head"] },
        { label: "Chest", slots: ["body", "armor"] },
        { label: "Waist", slots: ["waist"] },
        { label: "Legs", slots: ["legs"] },
        { label: "Feet", slots: ["feet"] },
        { label: "Weapon / Hand", slots: ["hand", "weapon", "thrown"] },
        { label: "Aura / Accessory", slots: ["aura", "accessory", "item"] },
    ];

    const rarityIcon: Record<string, string> = {
        common: "⬜",
        rare: "🟦",
        epic: "🟪",
        legendary: "🟡",
        mythic: "🔴"
    };

    const qualityColor: Record<string, string> = {
        Standard: "#aaa",
        Reinforced: "#4fc3f7",
        Rare: "#81c784",
        Elite: "#ffb74d",
        Legendary: "#ce93d8"
    };

    const currencyLabel = currency === "fateShards" ? "Fate Shards" : "ryo";
    const currencyIcon = currency === "fateShards" ? "✦" : "";
    const wallet = currency === "fateShards" ? character.fateShards : character.ryo;
    const shopDiscountPercent = currency === "ryo" ? getShopDiscountPercent(character) : 0;
    const getShopCost = (cost: number) => discountCost(cost, shopDiscountPercent);

    function buy(item: GameItem) {
        const finalCost = getShopCost(item.cost);
        if (wallet < finalCost) return alert(`Not enough ${currencyLabel}.`);

        const update = currency === "fateShards"
            ? { fateShards: character.fateShards - finalCost }
            : { ryo: character.ryo - finalCost };

        updateCharacter({
            ...character,
            ...update,
            inventory: [...character.inventory, item.id]
        });

        setSelectedItem(null);
    }

    const alreadyOwned = (item: GameItem) =>
        stackableItemIds.has(item.id) ? false : character.inventory.includes(item.id) || Object.values(character.equipment).includes(item.id);

    function statLabel(stat: string) {
        return stat
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (c) => c.toUpperCase());
    }

    function itemBonusLines(item: GameItem) {
        return Object.entries(item.bonuses)
            .filter(([, value]) => typeof value === "number" && value !== 0)
            .map(([stat, value]) => ({
                stat: statLabel(stat),
                value: value as number
            }));
    }

    return (
        <div className="card">
            <h2>{title}</h2>

            <p style={{ marginBottom: "0.25rem", color: "#aaa" }}>{subtitle}</p>

            <p style={{ marginBottom: "1rem" }}>
                {currency === "fateShards"
                    ? <><span style={{ color: "#ce93d8" }}>✦ Fate Shards:</span> <strong style={{ color: "#ce93d8" }}>{character.fateShards}</strong></>
                    : <>Wallet: <strong>{character.ryo} ryo</strong> · Town Hall Shop Discount: <strong>{shopDiscountPercent.toFixed(2)}%</strong></>
                }
            </p>

            {slotGroups.map((group) => {
                const groupItems = shopItems.filter((item) => group.slots.includes(normalizeEquipmentSlot(item.slot)));
                if (groupItems.length === 0) return null;

                return (
                    <div key={group.label} style={{ marginBottom: "1.2rem" }}>
                        <h3 style={{ marginBottom: "0.4rem", color: "var(--accent, #e0a000)" }}>{group.label}</h3>

                        <div className="location-grid">
                            {groupItems.map((item) => {
                                const owned = alreadyOwned(item);
                                const finalCost = getShopCost(item.cost);
                                const canAfford = wallet >= finalCost;

                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="location-button shop-item-button"
                                        onClick={() => setSelectedItem(item)}
                                        style={{ opacity: owned || !canAfford ? 0.75 : 1 }}
                                    >
                                        {item.image && (
                                            <img
                                                src={item.image}
                                                alt={item.name}
                                                className="shop-item-thumb"
                                            />
                                        )}

                                        <span>{rarityIcon[item.rarity]} {item.name}</span>

                                        {item.armorQuality && (
                                            <small style={{ color: qualityColor[item.armorQuality] }}>
                                                {item.armorQuality}
                                            </small>
                                        )}

                                        <small>{equipmentSlotLabel(item.slot)}</small>

                                        <small style={{ fontWeight: "bold" }}>
                                            {currencyIcon} {finalCost} {currencyLabel}{shopDiscountPercent > 0 ? ` (was ${item.cost})` : ""}{owned ? " — Owned" : ""}
                                        </small>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {selectedItem && (
                <div className="item-popup-backdrop" onClick={() => setSelectedItem(null)}>
                    <div className="item-popup-card" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            className="item-popup-close"
                            onClick={() => setSelectedItem(null)}
                        >
                            ✕
                        </button>

                        <div className="item-popup-top">
                            <div className="item-popup-art-box">
                                {selectedItem.image ? (
                                    <img src={selectedItem.image} alt={selectedItem.name} />
                                ) : (
                                    <span>{rarityIcon[selectedItem.rarity]}</span>
                                )}
                            </div>

                            <div className="item-popup-main">
                                <div className="item-popup-title-row">
                                    <h2>{selectedItem.name}</h2>
                                    <span className={`item-popup-rarity rarity-${selectedItem.rarity}`}>
                                        {selectedItem.rarity.toUpperCase()}
                                    </span>
                                </div>

                                <p className="item-popup-updated">
                                    Created: 1/21/2026 &nbsp; Updated: 1/21/2026
                                </p>

                                <p className="item-popup-description">
                                    {selectedItem.description}
                                </p>

                                <div className="item-popup-detail-grid">
                                    <p><strong>Battle Type:</strong> PvE / PvP</p>
                                    <p><strong>Rarity:</strong> {selectedItem.rarity}</p>
                                    <p><strong>Can be Traded:</strong> yes</p>
                                    <p><strong>Can be Crafted:</strong> yes</p>
                                    <p><strong>Stackable:</strong> {stackableItemIds.has(selectedItem.id) ? "yes" : "1"}</p>
                                    <p><strong>Item Type:</strong> {equipmentSlotLabel(selectedItem.slot)}</p>
                                    <p><strong>Hidden:</strong> no</p>
                                    <p><strong>Range:</strong> 0</p>
                                    <p><strong>Destroy on use:</strong> {stackableItemIds.has(selectedItem.id) ? "yes" : "no"}</p>
                                    <p><strong>Action Usage:</strong> 0%</p>
                                    <p><strong>Target:</strong> self</p>
                                    <p><strong>Method:</strong> single</p>
                                    <p><strong>Weapon:</strong> {normalizeEquipmentSlot(selectedItem.slot) === "hand" ? "yes" : "none"}</p>
                                    <p><strong>Durability:</strong> 75 / 100</p>
                                    <p><strong>Equip:</strong> {!stackableItemIds.has(selectedItem.id) && ["head", "body", "waist", "legs", "feet", "hand", "aura", "thrown"].includes(normalizeEquipmentSlot(selectedItem.slot)) ? "yes" : "no"}</p>
                                    <p><strong>Required Level:</strong> 1</p>
                                    <p><strong>Shop Price:</strong> {currencyIcon} {getShopCost(selectedItem.cost)} {currencyLabel}{shopDiscountPercent > 0 ? ` (was ${selectedItem.cost})` : ""}</p>
                                </div>

                                {petFeedXpForItem(selectedItem.id) && (
                                    <div className="item-popup-effect-box">
                                        <h4>Effect 1: Pet XP Food</h4>
                                        <div className="item-popup-effect-grid">
                                            <p><strong>Rounds:</strong> Instant</p>
                                            <p><strong>Calculation:</strong> flat</p>
                                            <p><strong>Effect Power:</strong> +{petFeedXpForItem(selectedItem.id)} pet XP</p>
                                            <p><strong>Target:</strong> selected pet</p>
                                            <p><strong>Effect Power / Lvl:</strong> 0</p>
                                            <p><strong>Stats:</strong> Pet experience</p>
                                        </div>
                                    </div>
                                )}

                                {selectedItem.armorQuality && (
                                    <div className="item-popup-effect-box">
                                        <h4>Effect 1: Damage Reduction</h4>
                                        <div className="item-popup-effect-grid">
                                            <p><strong>Rounds:</strong> Passive</p>
                                            <p><strong>Calculation:</strong> percentage</p>
                                            <p><strong>Effect Power:</strong> {Math.round(armorReductionForQuality(selectedItem.armorQuality) * 100)}%</p>
                                            <p><strong>Target:</strong> self</p>
                                            <p><strong>Effect Power / Lvl:</strong> 0</p>
                                            <p><strong>Stats:</strong> All incoming damage</p>
                                        </div>
                                    </div>
                                )}

                                {itemBonusLines(selectedItem).map((bonus, index) => (
                                    <div className="item-popup-effect-box" key={`${bonus.stat}-${index}`}>
                                        <h4>Effect {selectedItem.armorQuality ? index + 2 : index + 1}: Increase {bonus.stat}</h4>
                                        <div className="item-popup-effect-grid">
                                            <p><strong>Rounds:</strong> Passive</p>
                                            <p><strong>Calculation:</strong> flat</p>
                                            <p><strong>Effect Power:</strong> +{bonus.value}</p>
                                            <p><strong>Target:</strong> self</p>
                                            <p><strong>Effect Power / Lvl:</strong> 0</p>
                                            <p><strong>Stats:</strong> {bonus.stat}</p>
                                        </div>
                                    </div>
                                ))}

                                <div className="item-popup-actions">
                                    <button
                                        type="button"
                                        onClick={() => buy(selectedItem)}
                                        disabled={alreadyOwned(selectedItem) || wallet < getShopCost(selectedItem.cost)}
                                    >
                                        {alreadyOwned(selectedItem)
                                            ? "Owned"
                                            : wallet < getShopCost(selectedItem.cost)
                                                ? `Need More ${currencyLabel}`
                                                : `Buy for ${currencyIcon} ${getShopCost(selectedItem.cost)} ${currencyLabel}`}
                                    </button>

                                    <button
                                        type="button"
                                        className="danger-button"
                                        onClick={() => setSelectedItem(null)}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function CardPackSection({ character, updateCharacter, currency, creatorCards }: { character: Character; updateCharacter: (c: Character) => void; currency: "ryo" | "fateShards"; creatorCards: TileCard[] }) {
    const shopDiscountPercent = currency === "ryo" ? getShopDiscountPercent(character) : 0;
    const packCost = (cost: number) => discountCost(cost, shopDiscountPercent);

    function openPack(count: number, rarities: TileCard["rarity"][], cost: number) {
        const wallet = currency === "fateShards" ? character.fateShards : character.ryo;
        const label = currency === "fateShards" ? "Fate Shards" : "ryo";
        const finalCost = packCost(cost);
        if (wallet < finalCost) return alert(`Not enough ${label}.`);
        const allCards = getAllTileCards(creatorCards);
        const pool = allCards.filter((c) => rarities.includes(c.rarity));
        const drawn: string[] = [];
        for (let i = 0; i < count; i++) drawn.push(pool[Math.floor(Math.random() * pool.length)].id);
        const costUpdate = currency === "fateShards" ? { fateShards: character.fateShards - finalCost } : { ryo: character.ryo - finalCost };
        updateCharacter({ ...character, ...costUpdate, tileCards: [...character.tileCards, ...drawn] });
        alert(`Pack opened!\n• ${drawn.map((id) => allCards.find((c) => c.id === id)?.name ?? id).join("\n• ")}`);
    }

    return (
        <div className="card" style={{ marginTop: "1rem" }}>
            <h2>🃏 Card Packs</h2>
            <p style={{ color: "#aaa", marginBottom: "0.4rem" }}>Collect cards for the Shinobi Tiles card game at the Card Hall.</p>
            <p style={{ marginBottom: "0.8rem" }}>Collection: <strong>{character.tileCards.length}</strong> cards</p>
            {currency === "ryo" && (
                <button onClick={() => openPack(5, ["common", "rare"], 250)} disabled={character.ryo < packCost(250)}>
                    Standard Pack — 5 cards (Common / Rare) — {packCost(250)} ryo{shopDiscountPercent > 0 ? " discounted" : ""}
                </button>
            )}
            {currency === "fateShards" && (
                <button onClick={() => openPack(1, ["epic"], 10)} disabled={character.fateShards < 10} style={{ color: "#ce93d8" }}>
                    ✦ Epic Pack — 1 guaranteed Epic card — 10 Fate Shards
                </button>
            )}
        </div>
    );
}

function Shop({ character, updateCharacter, creatorItems, creatorCards }: { character: Character; updateCharacter: (c: Character) => void; creatorItems: GameItem[]; creatorCards: TileCard[] }) {
    return (
        <>
            <ShopBase
                character={character}
                updateCharacter={updateCharacter}
                creatorItems={creatorItems}
                title="Shop"
                subtitle="Standard gear for everyday shinobi."
                filterRarities={["common", "rare", "epic"]}
                currency="ryo"
            />
            <CardPackSection character={character} updateCharacter={updateCharacter} currency="ryo" creatorCards={creatorCards} />
        </>
    );
}

function GrandMarketplace({ character, updateCharacter, creatorItems, creatorCards }: { character: Character; updateCharacter: (c: Character) => void; creatorItems: GameItem[]; creatorCards: TileCard[] }) {
    return (
        <>
            <ShopBase
                character={character}
                updateCharacter={updateCharacter}
                creatorItems={creatorItems}
                title="Grand Marketplace"
                subtitle="Legendary and Mythic equipment from across the shinobi world. All items cost Fate Shards ✦"
                filterRarities={["legendary", "mythic"]}
                currency="fateShards"
            />
            <CardPackSection character={character} updateCharacter={updateCharacter} currency="fateShards" creatorCards={creatorCards} />
        </>
    );
}

function ShinobiTiles({ character, updateCharacter, creatorCards }: { character: Character; updateCharacter: (c: Character) => void; creatorCards: TileCard[] }) {
    type BoardCell = { card: TileCard; owner: "player" | "enemy" } | null;
    type Phase = "collection" | "select" | "game" | "result";

    const allCards = getAllTileCards(creatorCards);
    const ownedCards = character.tileCards.map((id) => allCards.find((c) => c.id === id)).filter(Boolean) as TileCard[];

    const [phase, setPhase] = useState<Phase>("collection");
    const [deckPicks, setDeckPicks] = useState<TileCard[]>([]);
    const [board, setBoard] = useState<BoardCell[]>(Array(9).fill(null));
    const [playerHand, setPlayerHand] = useState<TileCard[]>([]);
    const [enemyHand, setEnemyHand] = useState<TileCard[]>([]);
    const [selectedCard, setSelectedCard] = useState<TileCard | null>(null);
    const [isPlayerTurn, setIsPlayerTurn] = useState(true);
    const [flipped, setFlipped] = useState<number[]>([]);
    const [lastPlaced, setLastPlaced] = useState<number | null>(null);
    const [result, setResult] = useState<"win" | "lose" | "draw" | null>(null);

    function adjPos(pos: number, dir: TileCardArrow): number | null {
        const r = Math.floor(pos / 3), c = pos % 3;
        if (dir === "up" && r > 0) return pos - 3;
        if (dir === "down" && r < 2) return pos + 3;
        if (dir === "left" && c > 0) return pos - 1;
        if (dir === "right" && c < 2) return pos + 1;
        return null;
    }

    function doFlips(b: BoardCell[], pos: number, owner: "player" | "enemy"): BoardCell[] {
        const nb = [...b];
        const placed = nb[pos]!.card;
        const justFlipped: number[] = [];
        for (const dir of placed.arrows) {
            const ap = adjPos(pos, dir);
            if (ap === null) continue;
            const cell = nb[ap];
            if (!cell || cell.owner === owner) continue;
            if (placed.power >= cell.card.power) { nb[ap] = { ...cell, owner }; justFlipped.push(ap); }
        }
        setFlipped(justFlipped);
        return nb;
    }

    function countScore(b: BoardCell[]) {
        return { player: b.filter((c) => c?.owner === "player").length, enemy: b.filter((c) => c?.owner === "enemy").length };
    }

    function checkEnd(b: BoardCell[], ph: TileCard[], eh: TileCard[]): boolean {
        if (!b.every((c) => c !== null) && (ph.length > 0 || eh.length > 0)) return false;
        const { player, enemy } = countScore(b);
        const r = player > enemy ? "win" : player < enemy ? "lose" : "draw";
        setResult(r);
        setPhase("result");
        if (r === "win") updateCharacter({ ...character, ryo: character.ryo + 150 });
        return true;
    }

    function startGame() {
        if (deckPicks.length !== 5) return;
        const ai = [...allCards].sort(() => Math.random() - 0.5).slice(0, 5);
        setBoard(Array(9).fill(null));
        setPlayerHand([...deckPicks]);
        setEnemyHand(ai);
        setSelectedCard(null);
        setFlipped([]);
        setLastPlaced(null);
        setIsPlayerTurn(true);
        setResult(null);
        setPhase("game");
    }

    function placeCard(pos: number) {
        if (!isPlayerTurn || !selectedCard || board[pos] !== null) return;
        const nb = [...board]; nb[pos] = { card: selectedCard, owner: "player" };
        const afterFlip = doFlips(nb, pos, "player");
        setLastPlaced(pos);
        const newPH = playerHand.filter((c) => c !== selectedCard);
        setPlayerHand(newPH); setSelectedCard(null); setBoard(afterFlip); setIsPlayerTurn(false);
        if (checkEnd(afterFlip, newPH, enemyHand)) return;
        setTimeout(() => aiTurn(afterFlip, enemyHand, newPH), 900);
    }

    function aiTurn(b: BoardCell[], eh: TileCard[], ph: TileCard[]) {
        if (eh.length === 0) { checkEnd(b, ph, []); return; }
        const empty = b.map((c, i) => c === null ? i : -1).filter((i) => i >= 0);
        if (empty.length === 0) { checkEnd(b, ph, eh); return; }
        let bestCard = eh[0], bestPos = empty[0], bestScore = -1;
        for (const card of eh) {
            for (const pos of empty) {
                let score = 0;
                for (const dir of card.arrows) {
                    const ap = adjPos(pos, dir);
                    if (ap !== null && b[ap]?.owner === "player" && card.power >= b[ap]!.card.power) score++;
                }
                if (score > bestScore) { bestScore = score; bestCard = card; bestPos = pos; }
            }
        }
        const nb = [...b]; nb[bestPos] = { card: bestCard, owner: "enemy" };
        const afterFlip = doFlips(nb, bestPos, "enemy");
        setLastPlaced(bestPos);
        const newEH = eh.filter((c) => c !== bestCard);
        setEnemyHand(newEH); setBoard(afterFlip); setIsPlayerTurn(true);
        checkEnd(afterFlip, ph, newEH);
    }

    function togglePick(card: TileCard) {
        if (deckPicks.includes(card)) setDeckPicks(deckPicks.filter((c) => c !== card));
        else if (deckPicks.length < 5) setDeckPicks([...deckPicks, card]);
    }

    function CardTile({ card, owner, selected, compact }: { card: TileCard; owner?: "player" | "enemy"; selected?: boolean; compact?: boolean }) {
        const has = (d: TileCardArrow) => card.arrows.includes(d);
        const borderColor = selected
            ? "#ffe082"
            : owner === "player" ? "#4fc3f7"
                : owner === "enemy" ? "#ef5350"
                    : card.rarity === "epic" ? "#ce93d8"
                        : card.rarity === "rare" ? "#60a5fa"
                            : "#475569";
        const bgColor = owner === "player" ? "rgba(13,33,55,0.97)"
            : owner === "enemy" ? "rgba(40,10,10,0.97)"
                : "rgba(18,18,36,0.97)";
        const rarityGlow = card.rarity === "epic" ? "0 0 10px rgba(206,147,216,0.45)"
            : card.rarity === "rare" ? "0 0 8px rgba(96,165,250,0.4)"
                : "none";
        const ec: Record<string, string> = { Fire: "#ff7043", Water: "#4fc3f7", Earth: "#a1887f", Wind: "#a5d6a7", Lightning: "#fff176", Shadow: "#ba68c8", Ice: "#b0e0ff", Dark: "#ba68c8", None: "#666" };
        const w = compact ? 90 : 120;
        const ih = compact ? 60 : 90;
        const arSz = compact ? 10 : 13;
        const arOn = "#ffe082"; const arOff = "rgba(255,255,255,0.12)";
        const arSh = (on: boolean) => on ? `0 0 5px ${arOn}` : "none";
        return (
            <div style={{
                position: "relative", width: w, background: bgColor, border: `2px solid ${borderColor}`,
                borderRadius: 8, overflow: "hidden", boxShadow: rarityGlow, boxSizing: "border-box", flexShrink: 0
            }}>
                {/* ── Image area ── */}
                <div style={{ position: "relative", width: "100%", height: ih, background: "#07111f", overflow: "hidden" }}>
                    {card.image
                        ? <img src={card.image} alt={card.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, opacity: 0.25 }}>🃏</div>
                    }
                    {/* Arrow overlays */}
                    <span style={{
                        position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)",
                        fontSize: arSz, color: has("up") ? arOn : arOff, textShadow: arSh(has("up")), lineHeight: 1
                    }}>▲</span>
                    <span style={{
                        position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)",
                        fontSize: arSz, color: has("down") ? arOn : arOff, textShadow: arSh(has("down")), lineHeight: 1
                    }}>▼</span>
                    <span style={{
                        position: "absolute", left: 2, top: "50%", transform: "translateY(-50%)",
                        fontSize: arSz, color: has("left") ? arOn : arOff, textShadow: arSh(has("left")), lineHeight: 1
                    }}>◀</span>
                    <span style={{
                        position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)",
                        fontSize: arSz, color: has("right") ? arOn : arOff, textShadow: arSh(has("right")), lineHeight: 1
                    }}>▶</span>
                    {/* Power badge */}
                    <span style={{
                        position: "absolute", top: 2, right: 3, fontSize: compact ? 9 : 11, fontWeight: "bold",
                        color: "#fff", background: "rgba(0,0,0,0.7)", padding: "1px 4px", borderRadius: 4, lineHeight: 1.4
                    }}>
                        {card.power}
                    </span>
                </div>
                {/* ── Name / element strip ── */}
                <div style={{ padding: compact ? "2px 5px 3px" : "4px 6px 5px", background: "rgba(0,0,0,0.6)" }}>
                    <div style={{
                        fontSize: compact ? 8 : 10, fontWeight: "bold", color: "#e2e8f0",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                    }}>{card.name}</div>
                    {!compact && card.element !== "None" && (
                        <div style={{ fontSize: 8, color: ec[card.element] ?? "#aaa", marginTop: 1 }}>{card.element}</div>
                    )}
                </div>
            </div>
        );
    }

    // Collection view
    if (phase === "collection") {
        const grouped = (r: TileCard["rarity"]) => ownedCards.filter((c) => c.rarity === r);
        const rarityColor = { epic: "#ce93d8", rare: "#4fc3f7", common: "#aaa" };
        return (
            <div className="card">
                <h2>🃏 Shinobi Tiles</h2>
                <p style={{ color: "#aaa", marginBottom: "0.4rem" }}>Place cards on a 3×3 board. Arrows flip adjacent enemy cards — most cards wins.</p>
                <p style={{ marginBottom: "0.8rem" }}>Cards owned: <strong>{ownedCards.length}</strong>{ownedCards.length < 5 && <span style={{ color: "#ef5350" }}> — Buy packs in the Shop to get started (need 5)</span>}</p>
                {ownedCards.length >= 5 && <button onClick={() => { setDeckPicks([]); setPhase("select"); }} style={{ marginBottom: "1rem" }}>Build Deck & Play</button>}
                {(["epic", "rare", "common"] as TileCard["rarity"][]).map((r) => grouped(r).length > 0 && (
                    <div key={r} style={{ marginBottom: "1rem" }}>
                        <h3 style={{ color: rarityColor[r], textTransform: "capitalize", marginBottom: "0.4rem" }}>{r} ({grouped(r).length})</h3>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{grouped(r).map((card, i) => <CardTile key={card.id + i} card={card} />)}</div>
                    </div>
                ))}
            </div>
        );
    }

    // Deck selection
    if (phase === "select") {
        return (
            <div className="card">
                <h2>Select 5 Cards</h2>
                <p style={{ marginBottom: "0.5rem" }}>Picked: <strong>{deckPicks.length} / 5</strong></p>
                <div className="menu" style={{ marginBottom: "1rem" }}>
                    <button onClick={startGame} disabled={deckPicks.length !== 5}>Play</button>
                    <button onClick={() => setPhase("collection")}>Back</button>
                </div>
                {deckPicks.length > 0 && (
                    <div style={{ marginBottom: "1rem" }}>
                        <h4>Your Deck</h4>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {deckPicks.map((c, i) => <div key={i} onClick={() => togglePick(c)} style={{ cursor: "pointer" }}><CardTile card={c} owner="player" compact /></div>)}
                        </div>
                    </div>
                )}
                <h4>Collection</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {ownedCards.map((card, i) => {
                        const picked = deckPicks.includes(card);
                        return (
                            <div key={card.id + i} onClick={() => togglePick(card)}
                                style={{ cursor: "pointer", opacity: !picked && deckPicks.length >= 5 ? 0.4 : 1 }}>
                                <CardTile card={card} owner={picked ? "player" : undefined} selected={picked} compact />
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // Result
    if (phase === "result") {
        const { player, enemy } = countScore(board);
        return (
            <div className="card" style={{ textAlign: "center" }}>
                <h2 style={{ fontSize: "1.8rem", color: result === "win" ? "#a5d6a7" : result === "lose" ? "#ef5350" : "#ffe082" }}>
                    {result === "win" ? "Victory!" : result === "lose" ? "Defeated" : "Draw"}
                </h2>
                <p style={{ marginBottom: "0.5rem" }}>You <strong>{player}</strong> — Enemy <strong>{enemy}</strong></p>
                {result === "win" && <p style={{ color: "#a5d6a7", marginBottom: "0.8rem" }}>+150 ryo reward!</p>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: "1rem", maxWidth: 320, margin: "0 auto 1rem" }}>
                    {board.map((cell, i) => (
                        <div key={i} style={{ background: cell?.owner === "player" ? "#0d2137" : cell?.owner === "enemy" ? "#200a0a" : "#111", border: `2px solid ${cell?.owner === "player" ? "#4fc3f7" : cell?.owner === "enemy" ? "#ef5350" : "#333"}`, borderRadius: 8, padding: 4, minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {cell && <CardTile card={cell.card} owner={cell.owner} compact />}
                        </div>
                    ))}
                </div>
                <div className="menu">
                    <button onClick={() => { setDeckPicks([]); setPhase("select"); }}>Play Again</button>
                    <button onClick={() => setPhase("collection")}>Collection</button>
                </div>
            </div>
        );
    }

    // Game board
    const { player: pScore, enemy: eScore } = countScore(board);
    return (
        <div className="card">
            <h2 style={{ marginBottom: "0.3rem" }}>🃏 Shinobi Tiles</h2>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: 13 }}>
                <span style={{ color: "#4fc3f7" }}>You: {pScore}</span>
                <span style={{ color: isPlayerTurn ? "#a5d6a7" : "#ef9a9a" }}>{isPlayerTurn ? "Your Turn" : "Enemy thinking..."}</span>
                <span style={{ color: "#ef5350" }}>Enemy: {eScore}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: "1rem" }}>
                {board.map((cell, i) => (
                    <div key={i}
                        onClick={() => placeCard(i)}
                        style={{
                            background: cell ? (cell.owner === "player" ? "rgba(13,33,55,0.6)" : "rgba(40,10,10,0.6)") : "rgba(10,10,20,0.5)",
                            border: flipped.includes(i) ? "2px solid #ffe082" : lastPlaced === i ? "2px solid #4ade80" : cell ? `2px solid ${cell.owner === "player" ? "#4fc3f7" : "#ef5350"}` : "2px dashed #2d3748",
                            borderRadius: 10, minHeight: 88, display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: isPlayerTurn && selectedCard && !cell ? "pointer" : "default",
                            transition: "border-color 0.2s, background 0.2s",
                            boxShadow: flipped.includes(i) ? "0 0 12px rgba(255,224,130,0.4)" : lastPlaced === i ? "0 0 10px rgba(74,222,128,0.3)" : "none",
                        }}>
                        {cell
                            ? <CardTile card={cell.card} owner={cell.owner} compact />
                            : isPlayerTurn && selectedCard
                                ? <span style={{ color: "#3b82f6", fontSize: 20, opacity: 0.5 }}>+</span>
                                : null}
                    </div>
                ))}
            </div>

            <h4 style={{ marginBottom: "0.4rem" }}>Your Hand ({playerHand.length})</h4>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.5rem" }}>
                {playerHand.map((card, i) => (
                    <div key={i} onClick={() => isPlayerTurn && setSelectedCard(selectedCard === card ? null : card)}
                        style={{ cursor: isPlayerTurn ? "pointer" : "default", transform: selectedCard === card ? "translateY(-4px)" : "none", transition: "transform 0.15s" }}>
                        <CardTile card={card} owner="player" selected={selectedCard === card} compact />
                    </div>
                ))}
                {playerHand.length === 0 && <span style={{ color: "#555", fontSize: 12 }}>No cards remaining</span>}
            </div>
            {selectedCard && <p style={{ color: "#ffe082", fontSize: 12, marginTop: 4 }}>✦ {selectedCard.name} selected — tap a board cell to place it</p>}
        </div>
    );
}

function Hospital({ character, updateCharacter }: { character: Character; updateCharacter: (character: Character) => void }) {
    const hospitalDiscount = getHospitalDiscountPercent(character);
    const dischargeCost = discountCost(1000, hospitalDiscount);
    const topUpCost = discountCost(50, hospitalDiscount);

    function discharge() {
        if (character.ryo < dischargeCost) return alert(`Not enough ryo. You need ${dischargeCost} ryo to be discharged.`);
        updateCharacter({ ...character, ryo: character.ryo - dischargeCost, hp: character.maxHp, chakra: character.maxChakra, stamina: character.maxStamina, hospitalized: false });
    }

    function topUp() {
        if (character.ryo < topUpCost) return alert("Not enough ryo.");
        updateCharacter({ ...character, ryo: character.ryo - topUpCost, hp: character.maxHp });
    }

    if (character.hospitalized) {
        return (
            <div className="card">
                <h2>🏥 Village Hospital</h2>
                <p className="hint">Town Hall Hospital Discount: <strong>{hospitalDiscount.toFixed(2)}%</strong></p>
                <div className="hospital-admitted-banner">
                    <span className="hospital-admitted-icon">🚑</span>
                    <div>
                        <strong>You are currently admitted</strong>
                        <p>You were knocked out in battle and brought here by your village medics. Pay the treatment fee to be discharged.</p>
                    </div>
                </div>
                <div className="summary-box" style={{ marginBottom: "1rem" }}>
                    <span>HP: <strong style={{ color: "#f87171" }}>{character.hp}/{character.maxHp}</strong></span>
                    <span style={{ marginLeft: "1.5rem" }}>Ryo: <strong style={{ color: character.ryo >= dischargeCost ? "#4ade80" : "#f87171" }}>{character.ryo.toLocaleString()}</strong></span>
                </div>
                <button
                    onClick={discharge}
                    disabled={character.ryo < dischargeCost}
                    style={{ background: "linear-gradient(#14532d,#052e16)", borderColor: "#4ade80", opacity: character.ryo < dischargeCost ? 0.5 : 1, width: "100%" }}
                >
                    💊 Pay {dischargeCost.toLocaleString()} ryo — Full Heal &amp; Discharge
                </button>
                {character.ryo < dischargeCost && (
                    <p style={{ color: "#f87171", fontSize: "0.82rem", marginTop: "0.5rem", textAlign: "center" }}>
                        You need {(dischargeCost - character.ryo).toLocaleString()} more ryo. Visit the Bank or complete missions to earn it.
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="card">
            <h2>🏥 Village Hospital</h2>
            <p style={{ color: "#94a3b8" }}>Rest, recover, and restore your vitals. Town Hall Hospital Discount: <strong>{hospitalDiscount.toFixed(2)}%</strong></p>
            <div className="summary-box" style={{ marginBottom: "1rem" }}>
                <span>HP: <strong>{character.hp}/{character.maxHp}</strong></span>
                <span style={{ marginLeft: "1.5rem" }}>Ryo: <strong>{character.ryo.toLocaleString()}</strong></span>
            </div>
            <button onClick={topUp}>💊 Full Heal — {topUpCost} ryo{hospitalDiscount > 0 ? " discounted" : ""}</button>
        </div>
    );
}


function Cafeteria({ character, updateCharacter }: { character: Character; updateCharacter: (character: Character) => void }) {
    function eat(name: string, cost: number, hp: number, chakra: number, stamina: number) { if (character.ryo < cost) return alert("Not enough ryo."); updateCharacter({ ...character, ryo: character.ryo - cost, hp: Math.min(character.maxHp, character.hp + hp), chakra: Math.min(character.maxChakra, character.chakra + chakra), stamina: Math.min(character.maxStamina, character.stamina + stamina) }); alert(`${name} restored your resources.`); }
    return <div className="card"><h2>Cafeteria</h2><p>Ryo: {character.ryo}</p><div className="location-grid"><button className="location-button" onClick={() => eat("Small Ramen", 20, 25, 10, 10)}>🍜 Small Ramen<br /><small>+25 HP +10 Chakra +10 Stamina</small></button><button className="location-button" onClick={() => eat("Shinobi Meal", 50, 75, 35, 35)}>🍱 Shinobi Meal<br /><small>+75 HP +35 Chakra +35 Stamina</small></button><button className="location-button" onClick={() => eat("Feast", 100, 9999, 9999, 9999)}>🍖 Feast<br /><small>Full restore</small></button></div></div>;
}
function Inventory({
    character,
    updateCharacter,
    creatorItems,
    creatorCards,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    creatorItems: GameItem[];
    creatorCards: TileCard[];
}) {
    const [selectedInventoryItem, setSelectedInventoryItem] = useState<null | {
        entry: string;
        item?: GameItem;
        index: number;
        count: number;
        source: "backpack" | "equipped";
        equipmentSlot?: EquipmentSlot;
    }>(null);
    const [inventoryTab, setInventoryTab] = useState<"items" | "tileCards">("items");
    const [selectedTileCard, setSelectedTileCard] = useState<{ card: TileCard; count: number } | null>(null);
    const allItems = getAllItems(creatorItems);
    const allTileCards = getAllTileCards(creatorCards);

    const tileCardStacks = Object.values(
        character.tileCards.reduce<Record<string, { id: string; card?: TileCard; count: number }>>((stacks, cardId) => {
            const card = allTileCards.find((c) => c.id === cardId);

            if (!stacks[cardId]) {
                stacks[cardId] = {
                    id: cardId,
                    card,
                    count: 0,
                };
            }

            stacks[cardId].count += 1;
            return stacks;
        }, {})
    );

    function arrowSymbol(arrow: TileCardArrow) {
        if (arrow === "up") return "↑";
        if (arrow === "down") return "↓";
        if (arrow === "left") return "←";
        if (arrow === "right") return "→";
        return "?";
    }
    const inventoryEntries = character.inventory.map((entry, index) => {
        const item = getItemById(allItems, entry) ?? allItems.find((candidate) => candidate.name === entry);
        return { entry, index, item, stackKey: item?.id ?? entry };
    });

    const backpackStacks = inventoryEntries.reduce<Array<{ entry: string; item?: GameItem; indices: number[]; stackKey: string }>>((stacks, entry) => {
        const existing = stacks.find((stack) => stack.stackKey === entry.stackKey);
        if (existing) {
            existing.indices.push(entry.index);
            return stacks;
        }
        return [...stacks, { entry: entry.entry, item: entry.item, indices: [entry.index], stackKey: entry.stackKey }];
    }, []);

    const visualSlots: Array<{ label: string; equipmentSlot?: EquipmentSlot; accepts?: EquipmentSlot; className: string }> = [
        { label: "Aura", equipmentSlot: "aura", accepts: "aura", className: "slot-keystone" },
        { label: "Head", equipmentSlot: "head", accepts: "head", className: "slot-head" },
        { label: "Thrown", equipmentSlot: "thrown", accepts: "thrown", className: "slot-thrown" },
        { label: "Item", equipmentSlot: "item", accepts: "item", className: "slot-left-item-1" },
        { label: "Body", equipmentSlot: "body", accepts: "body", className: "slot-chest" },
        { label: "Item", className: "slot-right-item-1" },
        { label: "Hand", equipmentSlot: "hand", accepts: "hand", className: "slot-left-hand" },
        { label: "Waist", equipmentSlot: "waist", accepts: "waist", className: "slot-waist" },
        { label: "Hand", className: "slot-right-hand" },
        { label: "Item", className: "slot-left-item-2" },
        { label: "Legs", equipmentSlot: "legs", accepts: "legs", className: "slot-legs" },
        { label: "Item", className: "slot-right-item-2" },
        { label: "Item", className: "slot-left-item-3" },
        { label: "Feet", equipmentSlot: "feet", accepts: "feet", className: "slot-feet" },
        { label: "Item", className: "slot-right-item-3" },
    ];

    function equippedIdForSlot(slot: EquipmentSlot) {
        const normalized = normalizeEquipmentSlot(slot);
        return character.equipment[normalized] ?? (
            normalized === "hand"
                ? character.equipment.weapon
                : normalized === "body"
                    ? character.equipment.armor
                    : normalized === "aura"
                        ? character.equipment.accessory
                        : undefined
        );
    }

    function removeInventoryIndex(index: number) {
        return character.inventory.filter((_, itemIndex) => itemIndex !== index);
    }

    function equipItem(item: GameItem, index: number) {
        const slot = normalizeEquipmentSlot(item.slot);
        const previousEquipped = equippedIdForSlot(slot);
        const nextInventory = removeInventoryIndex(index);

        updateCharacter({
            ...character,
            inventory: previousEquipped ? [...nextInventory, previousEquipped] : nextInventory,
            equipment: {
                ...character.equipment,
                [slot]: item.id,
            },
        });

        setSelectedInventoryItem(null);
    }

    function unequipItem(slot: EquipmentSlot) {
        const normalized = normalizeEquipmentSlot(slot);
        const equippedId = equippedIdForSlot(normalized);
        if (!equippedId) return;

        updateCharacter({
            ...character,
            inventory: [...character.inventory, equippedId],
            equipment: {
                ...character.equipment,
                [normalized]: undefined,
                ...(normalized === "hand" ? { weapon: undefined } : {}),
                ...(normalized === "body" ? { armor: undefined } : {}),
                ...(normalized === "aura" ? { accessory: undefined } : {}),
            },
        });

        setSelectedInventoryItem(null);
    }

    function consumeItem(entry: string, index: number) {
        if (entry === "Soldier Pill") {
            updateCharacter({
                ...character,
                inventory: removeInventoryIndex(index),
                stamina: Math.min(character.maxStamina, character.stamina + 25),
            });
            setSelectedInventoryItem(null);
            return;
        }

        if (entry === "Chakra Pill") {
            updateCharacter({
                ...character,
                inventory: removeInventoryIndex(index),
                chakra: Math.min(character.maxChakra, character.chakra + 25),
            });
            setSelectedInventoryItem(null);
            return;
        }

        alert("This item cannot be used yet.");
    }

    function statLabel(stat: string) {
        return stat
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (c) => c.toUpperCase());
    }

    function describeBonuses(item: GameItem) {
        const petXp = petFeedXpForItem(item.id);
        if (petXp) return `Pet XP +${petXp}`;
        const bonuses = Object.entries(item.bonuses).filter(([, value]) => Number(value) !== 0);
        return bonuses.length ? bonuses.map(([stat, value]) => `${statLabel(stat)} +${value}`).join(", ") : "No bonuses";
    }

    function itemBonusLines(item: GameItem) {
        return Object.entries(item.bonuses)
            .filter(([, value]) => typeof value === "number" && value !== 0)
            .map(([stat, value]) => ({
                stat: statLabel(stat),
                value: value as number,
            }));
    }

    function slotHelp(slot: typeof visualSlots[number]) {
        if (!slot.accepts) return "Future equipment slot";
        return `${equipmentSlotLabel(slot.accepts)} slot`;
    }

    function itemInitials(name: string) {
        return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    }

    const selected = selectedInventoryItem;
    const selectedGameItem = selected?.item;
    const selectedPetFoodXp = petFeedXpForItem(selectedGameItem?.id);

    return (
        <>
            <div className="inventory-page">
                <section className="inventory-equipped-panel">
                    <h2>Equipped</h2>

                    <div className="inventory-character-layout">
                        <div className="inventory-silhouette">
                            <div className="silhouette-head"></div>
                            <div className="silhouette-body"></div>
                            <div className="silhouette-arm silhouette-arm-left"></div>
                            <div className="silhouette-arm silhouette-arm-right"></div>
                            <div className="silhouette-leg silhouette-leg-left"></div>
                            <div className="silhouette-leg silhouette-leg-right"></div>
                        </div>

                        {visualSlots.map((slot) => {
                            const equipped = slot.equipmentSlot
                                ? getItemById(allItems, equippedIdForSlot(slot.equipmentSlot))
                                : undefined;

                            return (
                                <button
                                    key={slot.className}
                                    type="button"
                                    className={`character-equip-slot ${slot.className} ${equipped ? `filled rarity-${equipped.rarity}` : ""}`}
                                    onClick={() => {
                                        if (!slot.equipmentSlot || !equipped) return;

                                        setSelectedInventoryItem({
                                            entry: equipped.id,
                                            item: equipped,
                                            index: -1,
                                            count: 1,
                                            source: "equipped",
                                            equipmentSlot: slot.equipmentSlot,
                                        });
                                    }}
                                    title={equipped ? `${equipped.name}: click to inspect` : slotHelp(slot)}
                                >
                                    {equipped?.image ? (
                                        <img
                                            src={equipped.image}
                                            alt={equipped.name}
                                            style={{
                                                width: "100%",
                                                height: "100%",
                                                objectFit: "contain",
                                                borderRadius: 4,
                                                position: "absolute",
                                                top: 0,
                                                left: 0,
                                                padding: 4,
                                            }}
                                        />
                                    ) : (
                                        <span>{equipped ? itemInitials(equipped.name) : slot.label}</span>
                                    )}

                                    {equipped && (
                                        <small
                                            style={{
                                                position: "relative",
                                                zIndex: 1,
                                                background: "rgba(0,0,0,0.6)",
                                                borderRadius: 3,
                                                padding: "0 2px",
                                            }}
                                        >
                                            {equipped.name}
                                        </small>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="inventory-backpack-panel">
                    <div className="inventory-panel-header">
                        <h2>{inventoryTab === "items" ? "Backpack" : "Shinobi Tile Cards"}</h2>

                        <div className="inventory-tabs">
                            <button
                                type="button"
                                className={inventoryTab === "items" ? "active" : ""}
                                onClick={() => setInventoryTab("items")}
                            >
                                🎒 Items
                            </button>

                            <button
                                type="button"
                                className={inventoryTab === "tileCards" ? "active" : ""}
                                onClick={() => setInventoryTab("tileCards")}
                            >
                                🃏 Tile Cards
                            </button>
                        </div>
                    </div>

                    {inventoryTab === "items" && (
                        <>
                            {backpackStacks.length === 0 ? (
                                <p className="inventory-empty">No items in inventory.</p>
                            ) : (
                                <div className="backpack-grid">
                                    {backpackStacks.map(({ entry, item, indices, stackKey }) => (
                                        <div
                                            className={`backpack-item ${item ? `rarity-${item.rarity}` : "rarity-common"}`}
                                            key={stackKey}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() =>
                                                setSelectedInventoryItem({
                                                    entry,
                                                    item,
                                                    index: indices[0],
                                                    count: indices.length,
                                                    source: "backpack",
                                                })
                                            }
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    setSelectedInventoryItem({
                                                        entry,
                                                        item,
                                                        index: indices[0],
                                                        count: indices.length,
                                                        source: "backpack",
                                                    });
                                                }
                                            }}
                                            style={{ cursor: "pointer" }}
                                        >
                                            <div className="backpack-item-art">
                                                {item?.image ? (
                                                    <img
                                                        src={item.image}
                                                        alt={item.name}
                                                        style={{
                                                            width: "100%",
                                                            height: "100%",
                                                            objectFit: "contain",
                                                            borderRadius: 4,
                                                            padding: 3,
                                                        }}
                                                    />
                                                ) : (
                                                    <span>{itemInitials(item?.name ?? entry)}</span>
                                                )}
                                            </div>

                                            <strong>{item?.name ?? entry}</strong>

                                            <p>
                                                {item
                                                    ? `${equipmentSlotLabel(item.slot)} | ${describeBonuses(item)}`
                                                    : entry === "Soldier Pill"
                                                        ? "Restores 25 stamina."
                                                        : entry === "Chakra Pill"
                                                            ? "Restores 25 chakra."
                                                            : "General inventory item."}
                                            </p>

                                            {indices.length > 1 && (
                                                <span className="stack-count">{indices.length}</span>
                                            )}

                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();

                                                    setSelectedInventoryItem({
                                                        entry,
                                                        item,
                                                        index: indices[0],
                                                        count: indices.length,
                                                        source: "backpack",
                                                    });
                                                }}
                                            >
                                                Inspect
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {inventoryTab === "tileCards" && (
                        <>
                            <p className="tile-card-collection-summary">
                                Collection: <strong>{character.tileCards.length}</strong> total cards |{" "}
                                <strong>{tileCardStacks.length}</strong> unique cards
                            </p>

                            {tileCardStacks.length === 0 ? (
                                <p className="inventory-empty">
                                    No Shinobi Tile Cards yet. Buy card packs from the Shop or Grand Marketplace.
                                </p>
                            ) : (
                                <div className="tile-card-inventory-grid">
                                    {tileCardStacks.map(({ id, card, count }) => (
                                        <button
                                            key={id}
                                            type="button"
                                            className={`tile-card-inventory-card rarity-${card?.rarity ?? "common"}`}
                                            onClick={() => {
                                                if (card) {
                                                    setSelectedTileCard({ card, count });
                                                }
                                            }}
                                        >
                                            <div className="tile-card-inventory-art">
                                                {card?.image ? (
                                                    <img src={card.image} alt={card.name} />
                                                ) : (
                                                    <span>🃏</span>
                                                )}
                                            </div>

                                            <strong>{card?.name ?? id}</strong>

                                            <div className="tile-card-mini-stats">
                                                <span>Power {card?.power ?? "?"}</span>
                                                <span>{card?.element ?? "Unknown"}</span>
                                            </div>

                                            <div className="tile-card-arrow-row">
                                                {card?.arrows.map((arrow) => (
                                                    <span key={arrow}>{arrowSymbol(arrow)}</span>
                                                ))}
                                            </div>

                                            <small>{card?.rarity ?? "missing card"}</small>

                                            {count > 1 && (
                                                <span className="tile-card-count">x{count}</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {selectedTileCard && (
                                <div className="summary-box tile-card-selected-detail">
                                    <button
                                        type="button"
                                        className="item-popup-close"
                                        onClick={() => setSelectedTileCard(null)}
                                        title="Close card details"
                                    >
                                        x
                                    </button>
                                    <strong>{selectedTileCard.card.name}</strong>
                                    <p className="hint">
                                        {selectedTileCard.card.rarity} {selectedTileCard.card.element} card | Power {selectedTileCard.card.power} | Owned x{selectedTileCard.count}
                                    </p>
                                    <div className="tile-card-arrow-row">
                                        {selectedTileCard.card.arrows.map((arrow) => (
                                            <span key={arrow}>{arrowSymbol(arrow)}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </section>
            </div>

            {selected && (
                <div className="item-popup-backdrop" onClick={() => setSelectedInventoryItem(null)}>
                    <div className="item-popup-card" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            className="item-popup-close"
                            onClick={() => setSelectedInventoryItem(null)}
                        >
                            ✕
                        </button>

                        <div className="item-popup-top">
                            <div className="item-popup-art-box">
                                {selectedGameItem?.image ? (
                                    <img src={selectedGameItem.image} alt={selectedGameItem.name} />
                                ) : (
                                    <span>{itemInitials(selectedGameItem?.name ?? selected.entry)}</span>
                                )}
                            </div>

                            <div className="item-popup-main">
                                <div className="item-popup-title-row">
                                    <h2>{selectedGameItem?.name ?? selected.entry}</h2>

                                    {selectedGameItem && (
                                        <span className={`item-popup-rarity rarity-${selectedGameItem.rarity}`}>
                                            {selectedGameItem.rarity.toUpperCase()}
                                        </span>
                                    )}
                                </div>

                                <p className="item-popup-updated">
                                    Inventory Count: {selected.count} &nbsp; Source: {selected.source === "equipped" ? "Equipped" : "Backpack"}
                                </p>

                                <p className="item-popup-description">
                                    {selectedGameItem
                                        ? selectedGameItem.description
                                        : selected.entry === "Soldier Pill"
                                            ? "A stamina pill that restores 25 stamina."
                                            : selected.entry === "Chakra Pill"
                                                ? "A chakra pill that restores 25 chakra."
                                                : "A general inventory item."}
                                </p>

                                {selectedGameItem ? (
                                    <>
                                        <div className="item-popup-detail-grid">
                                            <p><strong>Battle Type:</strong> PvE / PvP</p>
                                            <p><strong>Rarity:</strong> {selectedGameItem.rarity}</p>
                                            <p><strong>Can be Traded:</strong> yes</p>
                                            <p><strong>Can be Crafted:</strong> yes</p>
                                            <p><strong>Stackable:</strong> {selected.count}</p>
                                            <p><strong>Item Type:</strong> {equipmentSlotLabel(selectedGameItem.slot)}</p>
                                            <p><strong>Hidden:</strong> no</p>
                                            <p><strong>Range:</strong> 0</p>
                                            <p><strong>Destroy on use:</strong> {selectedPetFoodXp ? "yes" : "no"}</p>
                                            <p><strong>Action Usage:</strong> 0%</p>
                                            <p><strong>Target:</strong> {selectedPetFoodXp ? "selected pet" : "self"}</p>
                                            <p><strong>Method:</strong> single</p>
                                            <p><strong>Weapon:</strong> {normalizeEquipmentSlot(selectedGameItem.slot) === "hand" ? "yes" : "none"}</p>
                                            <p><strong>Durability:</strong> 75 / 100</p>
                                            <p><strong>Equip:</strong> {selectedPetFoodXp ? "no" : "yes"}</p>
                                            <p><strong>Required Level:</strong> 1</p>
                                            <p><strong>Shop Price:</strong> {selectedGameItem.cost} ryo</p>
                                        </div>

                                        {selectedPetFoodXp && (
                                            <div className="item-popup-effect-box">
                                                <h4>Effect 1: Pet XP Food</h4>
                                                <div className="item-popup-effect-grid">
                                                    <p><strong>Rounds:</strong> Instant</p>
                                                    <p><strong>Calculation:</strong> flat</p>
                                                    <p><strong>Effect Power:</strong> +{selectedPetFoodXp} pet XP</p>
                                                    <p><strong>Target:</strong> selected pet</p>
                                                    <p><strong>Effect Power / Lvl:</strong> 0</p>
                                                    <p><strong>Stats:</strong> Pet experience</p>
                                                </div>
                                            </div>
                                        )}

                                        {selectedGameItem.armorQuality && (
                                            <div className="item-popup-effect-box">
                                                <h4>Effect 1: Damage Reduction</h4>
                                                <div className="item-popup-effect-grid">
                                                    <p><strong>Rounds:</strong> Passive</p>
                                                    <p><strong>Calculation:</strong> percentage</p>
                                                    <p><strong>Effect Power:</strong> {Math.round(armorReductionForQuality(selectedGameItem.armorQuality) * 100)}%</p>
                                                    <p><strong>Target:</strong> self</p>
                                                    <p><strong>Effect Power / Lvl:</strong> 0</p>
                                                    <p><strong>Stats:</strong> All incoming damage</p>
                                                </div>
                                            </div>
                                        )}

                                        {itemBonusLines(selectedGameItem).map((bonus, index) => (
                                            <div className="item-popup-effect-box" key={`${bonus.stat}-${index}`}>
                                                <h4>Effect {selectedGameItem.armorQuality ? index + 2 : index + 1}: Increase {bonus.stat}</h4>
                                                <div className="item-popup-effect-grid">
                                                    <p><strong>Rounds:</strong> Passive</p>
                                                    <p><strong>Calculation:</strong> flat</p>
                                                    <p><strong>Effect Power:</strong> +{bonus.value}</p>
                                                    <p><strong>Target:</strong> self</p>
                                                    <p><strong>Effect Power / Lvl:</strong> 0</p>
                                                    <p><strong>Stats:</strong> {bonus.stat}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </>
                                ) : (
                                    <div className="item-popup-detail-grid">
                                        <p><strong>Item Type:</strong> Consumable</p>
                                        <p><strong>Stackable:</strong> {selected.count}</p>
                                        <p><strong>Target:</strong> self</p>
                                        <p><strong>Method:</strong> single</p>
                                    </div>
                                )}

                                <div className="item-popup-actions">
                                    {selectedGameItem && selected.source === "backpack" && !selectedPetFoodXp && (
                                        <button
                                            type="button"
                                            onClick={() => equipItem(selectedGameItem, selected.index)}
                                        >
                                            Equip to {equipmentSlotLabel(selectedGameItem.slot)}
                                        </button>
                                    )}

                                    {selectedGameItem && selected.source === "equipped" && selected.equipmentSlot && (
                                        <button
                                            type="button"
                                            onClick={() => unequipItem(selected.equipmentSlot!)}
                                        >
                                            Unequip
                                        </button>
                                    )}

                                    {!selectedGameItem && selected.source === "backpack" && (
                                        <button
                                            type="button"
                                            onClick={() => consumeItem(selected.entry, selected.index)}
                                        >
                                            {selected.entry === "Soldier Pill" || selected.entry === "Chakra Pill" ? "Use" : "Inspect"}
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        className="danger-button"
                                        onClick={() => setSelectedInventoryItem(null)}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function SunscarFestival({
    character,
    updateCharacter,
    creatorCards,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    creatorCards: TileCard[];
}) {
    const [diceResult, setDiceResult] = useState<string[]>([]);
    const [festivalLog, setFestivalLog] = useState(
        "Kael the Sand Dealer watches you from beneath a gold mask."
    );

    // ── Card Duel state ──────────────────────────────────────────────────────
    type DuelPhase = "idle" | "bet" | "select" | "game" | "result";
    type BoardCell = { card: TileCard; owner: "player" | "enemy" } | null;

    const [duelPhase, setDuelPhase] = useState<DuelPhase>("idle");
    const [duelBet, setDuelBet] = useState(0);
    const [deckPicks, setDeckPicks] = useState<TileCard[]>([]);
    const [board, setBoard] = useState<BoardCell[]>(Array(9).fill(null));
    const [playerHand, setPlayerHand] = useState<TileCard[]>([]);
    const [enemyHand, setEnemyHand] = useState<TileCard[]>([]);
    const [selectedCard, setSelectedCard] = useState<TileCard | null>(null);
    const [isPlayerTurn, setIsPlayerTurn] = useState(true);
    const [duelFlipped, setDuelFlipped] = useState<number[]>([]);
    const [lastPlaced, setLastPlaced] = useState<number | null>(null);
    const [duelResult, setDuelResult] = useState<"win" | "lose" | "draw" | null>(null);

    const allCards = getAllTileCards(creatorCards);
    const ownedCards = character.tileCards.map((id) => allCards.find((c) => c.id === id)).filter(Boolean) as TileCard[];

    function adjPos(pos: number, dir: TileCardArrow): number | null {
        const r = Math.floor(pos / 3), c = pos % 3;
        if (dir === "up" && r > 0) return pos - 3;
        if (dir === "down" && r < 2) return pos + 3;
        if (dir === "left" && c > 0) return pos - 1;
        if (dir === "right" && c < 2) return pos + 1;
        return null;
    }

    function doFlips(b: BoardCell[], pos: number, owner: "player" | "enemy"): BoardCell[] {
        const nb = [...b];
        const placed = nb[pos]!.card;
        const justFlipped: number[] = [];
        for (const dir of placed.arrows) {
            const ap = adjPos(pos, dir);
            if (ap === null) continue;
            const cell = nb[ap];
            if (!cell || cell.owner === owner) continue;
            if (placed.power >= cell.card.power) { nb[ap] = { ...cell, owner }; justFlipped.push(ap); }
        }
        setDuelFlipped(justFlipped);
        return nb;
    }

    function countDuelScore(b: BoardCell[]) {
        return { player: b.filter((c) => c?.owner === "player").length, enemy: b.filter((c) => c?.owner === "enemy").length };
    }

    function checkDuelEnd(b: BoardCell[], ph: TileCard[], eh: TileCard[]): boolean {
        if (!b.every((c) => c !== null) && (ph.length > 0 || eh.length > 0)) return false;
        const { player, enemy } = countDuelScore(b);
        const r = player > enemy ? "win" : player < enemy ? "lose" : "draw";
        setDuelResult(r);
        setDuelPhase("result");
        if (r === "win") updateCharacter({ ...character, ryo: character.ryo + duelBet * 2 });
        else if (r === "lose") updateCharacter({ ...character, ryo: character.ryo - duelBet });
        return true;
    }

    function startDuel() {
        if (deckPicks.length !== 5) return;
        const npcDeck = [...allCards].sort(() => Math.random() - 0.5).slice(0, 5);
        setBoard(Array(9).fill(null));
        setPlayerHand([...deckPicks]);
        setEnemyHand(npcDeck);
        setSelectedCard(null);
        setDuelFlipped([]);
        setLastPlaced(null);
        setIsPlayerTurn(true);
        setDuelResult(null);
        setDuelPhase("game");
    }

    function placeCard(pos: number) {
        if (!isPlayerTurn || !selectedCard || board[pos] !== null) return;
        const nb = [...board]; nb[pos] = { card: selectedCard, owner: "player" };
        const afterFlip = doFlips(nb, pos, "player");
        setLastPlaced(pos);
        const newPH = playerHand.filter((c) => c !== selectedCard);
        setPlayerHand(newPH); setSelectedCard(null); setBoard(afterFlip); setIsPlayerTurn(false);
        if (checkDuelEnd(afterFlip, newPH, enemyHand)) return;
        setTimeout(() => npcAiTurn(afterFlip, enemyHand, newPH), 900);
    }

    function npcAiTurn(b: BoardCell[], eh: TileCard[], ph: TileCard[]) {
        if (eh.length === 0) { checkDuelEnd(b, ph, []); return; }
        const empty = b.map((c, i) => c === null ? i : -1).filter((i) => i >= 0);
        if (empty.length === 0) { checkDuelEnd(b, ph, eh); return; }
        let bestCard = eh[0], bestPos = empty[0], bestScore = -1;
        for (const card of eh) {
            for (const pos of empty) {
                let score = 0;
                for (const dir of card.arrows) {
                    const ap = adjPos(pos, dir);
                    if (ap !== null && b[ap]?.owner === "player" && card.power >= b[ap]!.card.power) score++;
                }
                if (score > bestScore) { bestScore = score; bestCard = card; bestPos = pos; }
            }
        }
        const nb = [...b]; nb[bestPos] = { card: bestCard, owner: "enemy" };
        const afterFlip = doFlips(nb, bestPos, "enemy");
        setLastPlaced(bestPos);
        const newEH = eh.filter((c) => c !== bestCard);
        setEnemyHand(newEH); setBoard(afterFlip); setIsPlayerTurn(true);
        checkDuelEnd(afterFlip, ph, newEH);
    }

    function togglePick(card: TileCard) {
        if (deckPicks.includes(card)) setDeckPicks(deckPicks.filter((c) => c !== card));
        else if (deckPicks.length < 5) setDeckPicks([...deckPicks, card]);
    }

    function DuelCardTile({ card, owner, selected, compact }: { card: TileCard; owner?: "player" | "enemy"; selected?: boolean; compact?: boolean }) {
        const has = (d: TileCardArrow) => card.arrows.includes(d);
        const borderColor = selected
            ? "#ffe082"
            : owner === "player" ? "#4fc3f7"
                : owner === "enemy" ? "#ef5350"
                    : card.rarity === "epic" ? "#ce93d8"
                        : card.rarity === "rare" ? "#60a5fa"
                            : "#475569";
        const bgColor = owner === "player" ? "rgba(13,33,55,0.97)"
            : owner === "enemy" ? "rgba(40,10,10,0.97)"
                : "rgba(18,18,36,0.97)";
        const rarityGlow = card.rarity === "epic" ? "0 0 10px rgba(206,147,216,0.45)"
            : card.rarity === "rare" ? "0 0 8px rgba(96,165,250,0.4)"
                : "none";
        const ec: Record<string, string> = { Fire: "#ff7043", Water: "#4fc3f7", Earth: "#a1887f", Wind: "#a5d6a7", Lightning: "#fff176", Shadow: "#ba68c8", Ice: "#b0e0ff", Dark: "#ba68c8", None: "#666" };
        const w = compact ? 90 : 120;
        const ih = compact ? 60 : 90;
        const arSz = compact ? 10 : 13;
        const arOn = "#ffe082"; const arOff = "rgba(255,255,255,0.12)";
        const arSh = (on: boolean) => on ? `0 0 5px ${arOn}` : "none";
        return (
            <div style={{
                position: "relative", width: w, background: bgColor, border: `2px solid ${borderColor}`,
                borderRadius: 8, overflow: "hidden", boxShadow: rarityGlow, boxSizing: "border-box", flexShrink: 0
            }}>
                <div style={{ position: "relative", width: "100%", height: ih, background: "#07111f", overflow: "hidden" }}>
                    {card.image
                        ? <img src={card.image} alt={card.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, opacity: 0.25 }}>🃏</div>
                    }
                    <span style={{
                        position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)",
                        fontSize: arSz, color: has("up") ? arOn : arOff, textShadow: arSh(has("up")), lineHeight: 1
                    }}>▲</span>
                    <span style={{
                        position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)",
                        fontSize: arSz, color: has("down") ? arOn : arOff, textShadow: arSh(has("down")), lineHeight: 1
                    }}>▼</span>
                    <span style={{
                        position: "absolute", left: 2, top: "50%", transform: "translateY(-50%)",
                        fontSize: arSz, color: has("left") ? arOn : arOff, textShadow: arSh(has("left")), lineHeight: 1
                    }}>◀</span>
                    <span style={{
                        position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)",
                        fontSize: arSz, color: has("right") ? arOn : arOff, textShadow: arSh(has("right")), lineHeight: 1
                    }}>▶</span>
                    <span style={{
                        position: "absolute", top: 2, right: 3, fontSize: compact ? 9 : 11, fontWeight: "bold",
                        color: "#fff", background: "rgba(0,0,0,0.7)", padding: "1px 4px", borderRadius: 4, lineHeight: 1.4
                    }}>
                        {card.power}
                    </span>
                </div>
                <div style={{ padding: compact ? "2px 5px 3px" : "4px 6px 5px", background: "rgba(0,0,0,0.6)" }}>
                    <div style={{
                        fontSize: compact ? 8 : 10, fontWeight: "bold", color: "#e2e8f0",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                    }}>{card.name}</div>
                    {!compact && card.element !== "None" && (
                        <div style={{ fontSize: 8, color: ec[card.element] ?? "#aaa", marginTop: 1 }}>{card.element}</div>
                    )}
                </div>
            </div>
        );
    }

    const symbols = ["🔥", "🌙", "🗡️", "💰", "🦂", "👁️"];

    function rollDice() {
        const cost = 25;

        if (character.ryo < cost) {
            setFestivalLog("Kael: No coin, no fate. Come back with more ryo.");
            return;
        }

        const roll = Array.from({ length: 3 }).map(
            () => symbols[Math.floor(Math.random() * symbols.length)]
        );

        let rewardRyo = 0;
        let rewardXp = 0;
        let rewardStamina = 0;
        let message = "";

        const same = roll[0] === roll[1] && roll[1] === roll[2];

        if (same && roll[0] === "👁️") {
            rewardRyo = 500;
            rewardXp = 150;
            message = "LEGENDARY FATE! The Eye of the Dunes opens.";
        } else if (same) {
            rewardRyo = 200;
            rewardXp = 75;
            message = "Triple symbols! The crowd erupts around the dice table.";
        } else if (roll.includes("🦂")) {
            rewardRyo = 0;
            rewardXp = 10;
            message = "The scorpion strikes. You lose the wager, but learn from fate.";
        } else if (roll.includes("💰")) {
            rewardRyo = 75;
            message = "Coins flash beneath the desert sun. You win ryo.";
        } else if (roll.includes("🗡️")) {
            rewardStamina = 20;
            message = "Blade omen. Your fighting spirit rises.";
        } else if (roll.includes("🌙")) {
            rewardXp = 50;
            message = "Moon omen. A strange luck follows you.";
        } else {
            rewardRyo = 30;
            message = "Small fortune. The sands give a little back.";
        }

        const paidCharacter = {
            ...character,
            ryo: character.ryo - cost,
        };

        const leveled = gainXp(paidCharacter, rewardXp);

        updateCharacter({
            ...leveled,
            ryo: leveled.ryo + rewardRyo,
            stamina: Math.min(leveled.maxStamina, leveled.stamina + rewardStamina),
        });

        setDiceResult(roll);
        setFestivalLog(`Kael: ${message} +${rewardRyo} ryo, +${rewardXp} XP, +${rewardStamina} stamina.`);
    }

    // ── Active card duel overlays ────────────────────────────────────────────
    if (duelPhase === "bet") {
        return (
            <div className="card" style={{ maxWidth: 480, margin: "0 auto" }}>
                <div style={{ fontSize: "2rem", textAlign: "center", marginBottom: "0.4rem" }}>🃏</div>
                <h2 style={{ textAlign: "center", marginBottom: "0.2rem" }}>Miraa the Card Seer</h2>
                <p style={{ color: "#aaa", textAlign: "center", marginBottom: "1rem" }}>"Place your wager and we shall see whose fate runs deeper."</p>
                <p style={{ marginBottom: "0.8rem" }}>Your ryo: <strong>{character.ryo}</strong></p>
                {ownedCards.length < 5
                    ? <p style={{ color: "#ef5350" }}>You need at least 5 cards to duel. Buy packs in the Shop.</p>
                    : (
                        <div className="menu" style={{ flexDirection: "column", gap: "0.5rem" }}>
                            {[50, 100, 250, 500].map((amount) => (
                                <button key={amount}
                                    disabled={character.ryo < amount}
                                    onClick={() => { setDuelBet(amount); setDeckPicks([]); setDuelPhase("select"); }}>
                                    Bet {amount} ryo — win {amount * 2} ryo
                                </button>
                            ))}
                        </div>
                    )
                }
                <button style={{ marginTop: "1rem" }} onClick={() => setDuelPhase("idle")}>Leave</button>
            </div>
        );
    }

    if (duelPhase === "select") {
        return (
            <div className="card">
                <h2>Select Your 5 Cards</h2>
                <p style={{ color: "#aaa", marginBottom: "0.3rem" }}>Bet: <strong style={{ color: "#ffe082" }}>{duelBet} ryo</strong></p>
                <p style={{ marginBottom: "0.5rem" }}>Picked: <strong>{deckPicks.length} / 5</strong></p>
                <div className="menu" style={{ marginBottom: "1rem" }}>
                    <button onClick={startDuel} disabled={deckPicks.length !== 5}>Play</button>
                    <button onClick={() => setDuelPhase("bet")}>Back</button>
                </div>
                {deckPicks.length > 0 && (
                    <div style={{ marginBottom: "1rem" }}>
                        <h4>Your Deck</h4>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {deckPicks.map((c, i) => <div key={i} onClick={() => togglePick(c)} style={{ cursor: "pointer" }}><DuelCardTile card={c} owner="player" compact /></div>)}
                        </div>
                    </div>
                )}
                <h4>Collection</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {ownedCards.map((card, i) => {
                        const picked = deckPicks.includes(card);
                        return (
                            <div key={card.id + i} onClick={() => togglePick(card)}
                                style={{ cursor: "pointer", opacity: !picked && deckPicks.length >= 5 ? 0.4 : 1 }}>
                                <DuelCardTile card={card} owner={picked ? "player" : undefined} selected={picked} compact />
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (duelPhase === "game") {
        const { player: pScore, enemy: eScore } = countDuelScore(board);
        return (
            <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                    <h2 style={{ margin: 0 }}>🃏 vs Miraa</h2>
                    <span style={{ color: "#ffe082", fontSize: 13 }}>Bet: {duelBet} ryo</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: 13 }}>
                    <span style={{ color: "#4fc3f7" }}>You: {pScore}</span>
                    <span style={{ color: isPlayerTurn ? "#a5d6a7" : "#ef9a9a" }}>{isPlayerTurn ? "Your Turn" : "Miraa thinking..."}</span>
                    <span style={{ color: "#ef5350" }}>Miraa: {eScore}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: "1rem" }}>
                    {board.map((cell, i) => (
                        <div key={i} onClick={() => placeCard(i)}
                            style={{
                                background: cell ? (cell.owner === "player" ? "rgba(13,33,55,0.6)" : "rgba(40,10,10,0.6)") : "rgba(10,10,20,0.5)",
                                border: duelFlipped.includes(i) ? "2px solid #ffe082" : lastPlaced === i ? "2px solid #4ade80" : cell ? `2px solid ${cell.owner === "player" ? "#4fc3f7" : "#ef5350"}` : "2px dashed #2d3748",
                                borderRadius: 10, minHeight: 88, display: "flex", alignItems: "center", justifyContent: "center",
                                cursor: isPlayerTurn && selectedCard && !cell ? "pointer" : "default",
                                transition: "border-color 0.2s, background 0.2s",
                                boxShadow: duelFlipped.includes(i) ? "0 0 12px rgba(255,224,130,0.4)" : lastPlaced === i ? "0 0 10px rgba(74,222,128,0.3)" : "none",
                            }}>
                            {cell
                                ? <DuelCardTile card={cell.card} owner={cell.owner} compact />
                                : isPlayerTurn && selectedCard
                                    ? <span style={{ color: "#3b82f6", fontSize: 20, opacity: 0.5 }}>+</span>
                                    : null}
                        </div>
                    ))}
                </div>
                <h4 style={{ marginBottom: "0.4rem" }}>Your Hand ({playerHand.length})</h4>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.5rem" }}>
                    {playerHand.map((card, i) => (
                        <div key={i} onClick={() => isPlayerTurn && setSelectedCard(selectedCard === card ? null : card)}
                            style={{ cursor: isPlayerTurn ? "pointer" : "default", transform: selectedCard === card ? "translateY(-4px)" : "none", transition: "transform 0.15s" }}>
                            <DuelCardTile card={card} owner="player" selected={selectedCard === card} compact />
                        </div>
                    ))}
                </div>
                {selectedCard && <p style={{ color: "#ffe082", fontSize: 12, marginTop: 4 }}>✦ {selectedCard.name} selected — tap a board cell to place it</p>}
            </div>
        );
    }

    if (duelPhase === "result") {
        const { player, enemy } = countDuelScore(board);
        const ryoChange = duelResult === "win" ? `+${duelBet} ryo` : duelResult === "lose" ? `-${duelBet} ryo` : "no change";
        const miraaQuote = duelResult === "win"
            ? "Miraa: \"The sands do not lie... you have read them well. Take your prize.\""
            : duelResult === "lose"
                ? "Miraa: \"The desert claims the weak. Come back when you are worthy.\""
                : "Miraa: \"Even fate blinks sometimes. A draw — rare as a storm with no lightning.\"";
        return (
            <div className="card" style={{ textAlign: "center" }}>
                <h2 style={{ fontSize: "1.8rem", color: duelResult === "win" ? "#a5d6a7" : duelResult === "lose" ? "#ef5350" : "#ffe082" }}>
                    {duelResult === "win" ? "Victory!" : duelResult === "lose" ? "Defeated" : "Draw"}
                </h2>
                <p style={{ marginBottom: "0.3rem" }}>You <strong>{player}</strong> — Miraa <strong>{enemy}</strong></p>
                <p style={{ color: duelResult === "win" ? "#a5d6a7" : duelResult === "lose" ? "#ef5350" : "#ffe082", marginBottom: "0.5rem" }}>{ryoChange}</p>
                <p style={{ color: "#aaa", fontStyle: "italic", marginBottom: "1rem", fontSize: 13 }}>{miraaQuote}</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: "1rem", maxWidth: 320, margin: "0 auto 1rem" }}>
                    {board.map((cell, i) => (
                        <div key={i} style={{ background: cell?.owner === "player" ? "#0d2137" : cell?.owner === "enemy" ? "#200a0a" : "#111", border: `2px solid ${cell?.owner === "player" ? "#4fc3f7" : cell?.owner === "enemy" ? "#ef5350" : "#333"}`, borderRadius: 8, padding: 4, minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {cell && <DuelCardTile card={cell.card} owner={cell.owner} compact />}
                        </div>
                    ))}
                </div>
                <div className="menu">
                    <button onClick={() => { setDeckPicks([]); setDuelPhase("bet"); }}>Challenge Again</button>
                    <button onClick={() => setDuelPhase("idle")}>Return to Festival</button>
                </div>
            </div>
        );
    }

    return (
        <div className="sunscar-festival">
            <div className="sunscar-hero">
                <h1>🏜️ Sunscar Festival</h1>
                <p>
                    Sector 35 — a permanent desert festival of lanterns, caravans,
                    sandstone arches, and fate-bound dice.
                </p>
            </div>

            <div className="sunscar-grid">
                <section className="sunscar-card npc-card">
                    <div className="sunscar-npc">🎭</div>
                    <h2>Kael the Sand Dealer</h2>
                    <p>
                        "Fortune favors the bold… and buries the weak beneath the sands."
                    </p>
                    <p><strong>Entry Cost:</strong> 25 ryo per roll</p>
                    <p><strong>Your Ryo:</strong> {character.ryo}</p>
                </section>

                <section className="sunscar-card dice-card">
                    <h2>🎲 Dice of Fate</h2>

                    <div className="dice-row">
                        {(diceResult.length ? diceResult : ["?", "?", "?"]).map((die, index) => (
                            <div className="fate-die" key={index}>{die}</div>
                        ))}
                    </div>

                    <button className="sunscar-roll-button" onClick={rollDice}>
                        Roll Dice of Fate
                    </button>

                    <div className="sunscar-log">{festivalLog}</div>
                </section>

                <section className="sunscar-card npc-card">
                    <div className="sunscar-npc">🃏</div>
                    <h2>Miraa the Card Seer</h2>
                    <p style={{ fontStyle: "italic", color: "#aaa", marginBottom: "0.5rem" }}>
                        "The cards remember every shinobi who has sat across from me. Most don't return."
                    </p>
                    <p style={{ marginBottom: "0.5rem" }}>Challenge Miraa to a game of <strong>Shinobi Tiles</strong>. Bet ryo — winner takes double.</p>
                    {character.tileCards.length < 5
                        ? <p style={{ color: "#ef5350", fontSize: 13 }}>You need 5 cards to duel. Buy packs in the Shop.</p>
                        : <button onClick={() => setDuelPhase("bet")} style={{ marginTop: "0.5rem" }}>Challenge Miraa</button>
                    }
                </section>

                <section className="sunscar-card">
                    <h2>Festival Grounds</h2>
                    <div className="festival-visual">
                        <span>⛺</span>
                        <span>🏺</span>
                        <span>🔥</span>
                        <span>🎲</span>
                        <span>🐪</span>
                        <span>🏜️</span>
                    </div>
                    <p>
                        Golden tents, torch bowls, desert drums, masked merchants,
                        camel caravans, and huge carved dice statues fill the dunes.
                    </p>
                </section>
            </div>
        </div>
    );
}
function CentralHub({
    character,
    updateCharacter,
    setScreen,
    savedBloodlines,
    setSavedBloodlines,
    triggeredEvents,
    setTriggeredEvents,
    onStartEndlessBattle,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    setScreen: (screen: Screen) => void;
    savedBloodlines: SavedBloodline[];
    setSavedBloodlines: (bls: SavedBloodline[]) => void;
    triggeredEvents: string[];
    setTriggeredEvents: React.Dispatch<React.SetStateAction<string[]>>;
    onStartEndlessBattle: () => void;
}) {
    const [centralLog, setCentralLog] = useState(
        "Welcome to Central — the neutral heart of the shinobi world."
    );
    const [showArchives, setShowArchives] = useState(false);
    const [showAwakening, setShowAwakening] = useState(false);
    const [awakeningMsg, setAwakeningMsg] = useState("");
    const [showCelestialPanel, setShowCelestialPanel] = useState(false);

    function quickReward(name: string, xp: number, ryo: number, stamina: number) {
        const leveled = gainXp(character, xp);

        updateCharacter({
            ...leveled,
            ryo: leveled.ryo + ryo,
            stamina: Math.min(leveled.maxStamina, leveled.stamina + stamina),
        });

        setCentralLog(`${name} complete. +${xp} XP, +${ryo} ryo, +${stamina} stamina.`);
    }

    function awakeningFreeRoll() {
        const isFreeAtLv2 = character.level >= 2 && !triggeredEvents.includes(AWAKENING_FREE_LV2_ID);
        const isFreeAtLv20 = character.level >= 20 && !triggeredEvents.includes(AWAKENING_FREE_LV20_ID);
        const currentElements = getCharacterElements(character);
        const element = rollNewAwakeningElement(currentElements);
        const nextElements = uniqueElements([...currentElements, element]);
        const eventId = isFreeAtLv2 ? AWAKENING_FREE_LV2_ID : isFreeAtLv20 ? AWAKENING_FREE_LV20_ID : null;
        if (!eventId) return;
        setTriggeredEvents((ids) => [...ids, eventId]);
        updateCharacter({ ...character, element: nextElements[0], elements: nextElements });
        setAwakeningMsg(`✨ The stone pulses with ${element} chakra! Your awakened elements: ${nextElements.join(" / ")}.`);
    }

    function awakeningPaidRoll() {
        if (character.fateShards < 10) {
            setAwakeningMsg("❌ Not enough Fate Shards — you need 10 to reroll your element.");
            return;
        }
        const currentElements = getCharacterElements(character);
        const nextElements = rollAwakeningElements(Math.max(1, currentElements.length));
        updateCharacter({ ...character, fateShards: character.fateShards - 10, element: nextElements[0], elements: nextElements });
        setAwakeningMsg(`💫 The stone swirls and reveals: ${nextElements.join(" / ")}! Your awakened elements have been rerolled (−10 Fate Shards).`);
    }

    function awakeningCreateBloodline(rank: Rank, materialKey: "boneCharms" | "auraStones" | "mythicSeals", cost: number) {
        if ((character[materialKey] ?? 0) < cost) {
            const label = materialKey === "boneCharms" ? "Bone Charms" : materialKey === "auraStones" ? "Aura Stones" : "Mythic Seals";
            setAwakeningMsg(`❌ Not enough ${label} — you need ${cost}.`);
            return;
        }
        const blName = prompt(`Name your new ${rank} bloodline:`)?.trim();
        if (!blName) return;
        const ownedElements = getCharacterElements(character);
        const newBloodline: SavedBloodline = {
            id: `awakened-${rank.replace(" ", "").toLowerCase()}-${Date.now()}`,
            name: blName,
            rank,
            specialElement: ownedElements[0],
            lore: `Forged from ${materialKey === "boneCharms" ? "100 Bone Charms" : materialKey === "auraStones" ? "100 Aura Stones" : "100 Mythic Seals"} at the Awakening Stone by ${character.name}.`,
            jutsus: [],
            totalPoints: rank === "B Rank" ? 100 : rank === "A Rank" ? 200 : 300,
        };
        setSavedBloodlines([...savedBloodlines, newBloodline]);
        updateCharacter({ ...character, [materialKey]: (character[materialKey] ?? 0) - cost });
        setAwakeningMsg(`⚡ ${rank} Bloodline "${blName}" has been forged! Visit the admin panel to add techniques.`);
    }

    const hasFreeRoll = (character.level >= 2 && !triggeredEvents.includes(AWAKENING_FREE_LV2_ID))
        || (character.level >= 20 && !triggeredEvents.includes(AWAKENING_FREE_LV20_ID));

    const centralOptions = [
        {
            name: "Arena District",
            icon: "⚔️",
            text: "Ranked battles, casual fights, clan wars, tournaments, spectators, and daily arena rewards.",
            action: () => setScreen("arena"),
        },
        {
            name: "Shinobi Council Hall",
            icon: "🏛️",
            text: "View village influence, active wars, bounties, diplomacy, and Kage rankings.",
            action: () => setCentralLog("Council Notice: The villages are stable, but tension is rising near the outer sectors."),
        },
        {
            name: "Grand Marketplace",
            icon: "🛒",
            text: "Rare items, trading stalls, cosmetics, limited event goods, and merchant contracts.",
            action: () => setScreen("grandMarketplace"),
        },
        {
            name: "Hunter Guild",
            icon: "🎯",
            text: "S-rank contracts, rogue ninja hunts, world boss clues, escort jobs, and dungeon requests.",
            action: () => quickReward("Hunter Guild Contract", 90, 75, 10),
        },
        {
            name: "Hall of Legends",
            icon: "🏆",
            text: "Top players, top clans, seasonal statues, mission rankings, and legacy rewards.",
            action: () => setCentralLog(`${character.name} is recorded as a rising shinobi of ${character.village}.`),
        },
        {
            name: "Ancient Archives",
            icon: "📚",
            text: "Bloodline lore, forbidden jutsu research, hidden boss clues, and world history.",
            action: () => setShowArchives(true),
        },
        {
            name: "Awakening Stone",
            icon: "💎",
            text: getCharacterElements(character).length
                ? `Your elements: ${getCharacterElements(character).join(" / ")}. Reroll, or forge a bloodline using ancient materials.`
                : "Discover your elemental nature. Free at level 2 and level 20.",
            action: () => { setShowAwakening(true); setAwakeningMsg(""); },
        },
        {
            name: "Pet Arena",
            icon: "🐾",
            text: "Choose one of your pets and watch it autobattle another player's pet using AI rule logic.",
            action: () => setScreen("petArena"),
        },
        {
            name: "Gateway Ring",
            icon: "🌀",
            text: "Fast travel gates, regional portals, dungeon entrances, event portals, and raid queues.",
            action: () => setScreen("worldMap"),
        },
        {
            name: "Underground Syndicate",
            icon: "🕶️",
            text: "Illegal contracts, stolen goods, assassination boards, curse marks, and dark jutsu rumors.",
            action: () => quickReward("Syndicate Shadow Contract", 120, 150, 0),
        },
        {
            name: "Celestial Tower",
            icon: "🗼",
            text: "Endless PvE floors, boss rushes, element trials, bloodline trials, and ascension battles.",
            action: () => setShowCelestialPanel(true),
        },
    ];

    return (
        <div className="central-hub">
            <div className="central-hero">
                <h1>🏯 Central — The Thousand Gates</h1>
                <p>
                    A neutral fortress city where every village, clan, rogue, merchant,
                    hunter, and legend crosses paths.
                </p>
            </div>

            <div className="central-log">
                {centralLog}
            </div>

            <div className="central-grid">
                {centralOptions.map((option) => (
                    <button className="central-card" key={option.name} onClick={option.action}>
                        <span className="central-icon">{option.icon}</span>
                        <strong>{option.name}</strong>
                        <small>{option.text}</small>
                    </button>
                ))}
            </div>

            {showCelestialPanel && (
                <div className="celestial-panel-overlay" onClick={() => setShowCelestialPanel(false)}>
                    <div className="celestial-panel" onClick={e => e.stopPropagation()}>
                        <h2>🗼 Celestial Tower</h2>
                        <p className="celestial-panel-sub">Choose your challenge, shinobi.</p>
                        <div className="celestial-panel-options">
                            <button className="celestial-option-btn" onClick={() => { setShowCelestialPanel(false); setCentralLog("Celestial Tower is open. Floor 1 trial begins in the Arena."); setScreen("arena"); }}>
                                <span className="celestial-option-icon">⚔️</span>
                                <strong>Floor Trial</strong>
                                <small>Standard arena battle against a selected opponent.</small>
                            </button>
                            <button className="celestial-option-btn celestial-endless-btn" onClick={() => { setShowCelestialPanel(false); onStartEndlessBattle(); }}>
                                <span className="celestial-option-icon">♾️</span>
                                <strong>Endless Battle</strong>
                                <small>Fight wave after wave of random opponents. How far can you climb before you fall?</small>
                            </button>
                        </div>
                        <button className="back-btn" style={{ marginTop: "1rem" }} onClick={() => setShowCelestialPanel(false)}>✕ Close</button>
                    </div>
                </div>
            )}

            {showArchives && (() => {
                const allBloodlines = [
                    ...starterSavedBloodlines,
                    ...savedBloodlines.filter((b) => !starterSavedBloodlines.some((s) => s.id === b.id)),
                ];
                return (
                    <div className="archives-overlay">
                        <div className="archives-panel">
                            <div className="archives-header">
                                <h2>📚 Ancient Archives — Bloodline Codex</h2>
                                <button className="danger-button" onClick={() => setShowArchives(false)}>✕ Close</button>
                            </div>
                            <p className="archives-subtitle">
                                {allBloodlines.length} bloodline{allBloodlines.length !== 1 ? "s" : ""} recorded — {starterSavedBloodlines.length} ancient, {allBloodlines.length - starterSavedBloodlines.length} custom
                            </p>
                            <div className="archives-grid">
                                {allBloodlines.map((bl) => (
                                    <div className="archives-card" key={bl.id}>
                                        <div className="archives-card-img-wrap">
                                            {bl.image
                                                ? <img src={bl.image} alt={bl.name} className="archives-card-img" />
                                                : <div className="archives-card-no-img">⚔️</div>
                                            }
                                        </div>
                                        <div className="archives-card-body">
                                            <div className="archives-card-title-row">
                                                <h3>{bl.name}</h3>
                                                <span className="archives-rank-badge">{bl.rank}</span>
                                            </div>
                                            {bl.specialElement && (
                                                <span className="archives-element-tag">✦ {bl.specialElement} Release</span>
                                            )}
                                            {bl.lore
                                                ? <p className="archives-lore">{bl.lore}</p>
                                                : <p className="archives-lore archives-lore-missing">No lore recorded for this bloodline yet.</p>
                                            }
                                            <div className="archives-jutsu-list">
                                                <strong>Techniques ({bl.jutsus.length})</strong>
                                                {bl.jutsus.map((j) => (
                                                    <div key={j.id} className="archives-jutsu-row">
                                                        {j.image && <img src={j.image} alt={j.name} className="archives-jutsu-img" />}
                                                        <div>
                                                            <span className="archives-jutsu-name">{j.name}</span>
                                                            <span className="archives-jutsu-meta">{j.type} · {j.element} · {j.ap} AP</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {showAwakening && (
                <div className="archives-overlay">
                    <div className="awakening-panel">
                        <div className="archives-header">
                            <h2>💎 Awakening Stone</h2>
                            <button className="danger-button" onClick={() => setShowAwakening(false)}>✕ Close</button>
                        </div>

                        {/* Current element status */}
                        <div className="awakening-element-display">
                            {(() => {
                                const ownedElements = getCharacterElements(character);
                                return ownedElements.length ? (
                                    <>
                                        <div className="awakening-element-badges">
                                            {ownedElements.map((element) => (
                                                <span key={element} className={`awakening-element-badge element-${element.toLowerCase()}`}>
                                                    {elementIcon(element)} {element}
                                                </span>
                                            ))}
                                        </div>
                                        <p className="awakening-element-desc">Your chakra resonates with <strong>{ownedElements.join(" / ")}</strong> energy. You can train jutsu that match these elements.</p>
                                    </>
                                ) : (
                                    <p className="awakening-element-desc awakening-unawakened">Your element has not yet been awakened. Use the stone to reveal your nature.</p>
                                );
                            })()}
                        </div>

                        {awakeningMsg && (
                            <div className={`awakening-msg ${awakeningMsg.startsWith("❌") ? "awakening-msg-error" : "awakening-msg-success"}`}>
                                {awakeningMsg}
                            </div>
                        )}

                        {/* Element roll section */}
                        <div className="awakening-section">
                            <h3>⚡ Elemental Awakening</h3>
                            <p className="awakening-hint">The stone randomly reveals one of five elements: 💧 Water · 🌀 Wind · 🪨 Earth · ⚡ Lightning · 🔥 Fire</p>
                            <div className="awakening-roll-row">
                                {hasFreeRoll ? (
                                    <button className="awakening-free-btn" onClick={awakeningFreeRoll}>
                                        ✨ Awaken Element — FREE
                                        <small>{character.level >= 20 && !triggeredEvents.includes(AWAKENING_FREE_LV20_ID) ? "(Level 20 reward)" : "(Level 2 reward)"}</small>
                                    </button>
                                ) : (
                                    <button
                                        className="awakening-paid-btn"
                                        onClick={awakeningPaidRoll}
                                        disabled={character.fateShards < 10}
                                        title={character.fateShards < 10 ? "Not enough Fate Shards" : ""}
                                    >
                                        🔮 Reroll Element — 10 Fate Shards
                                        <small>You have {character.fateShards} Fate Shards</small>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Material balances */}
                        <div className="awakening-section">
                            <h3>🧪 Ancient Materials</h3>
                            <div className="awakening-materials">
                                <div className="awakening-material-row">
                                    <span className="awakening-material-icon">🦴</span>
                                    <span className="awakening-material-name">Bone Charms</span>
                                    <span className="awakening-material-count">{character.boneCharms ?? 0}</span>
                                </div>
                                <div className="awakening-material-row">
                                    <span className="awakening-material-icon">🌟</span>
                                    <span className="awakening-material-name">Aura Stones</span>
                                    <span className="awakening-material-count">{character.auraStones ?? 0}</span>
                                </div>
                                <div className="awakening-material-row">
                                    <span className="awakening-material-icon">🔱</span>
                                    <span className="awakening-material-name">Mythic Seals</span>
                                    <span className="awakening-material-count">{character.mythicSeals ?? 0}</span>
                                </div>
                            </div>
                        </div>

                        {/* Bloodline forge section */}
                        <div className="awakening-section">
                            <h3>⚗️ Bloodline Forge</h3>
                            <p className="awakening-hint">Channel ancient materials through the stone to forge a new bloodline. The bloodline will carry your element and await further techniques.</p>
                            <div className="awakening-forge-grid">
                                <div className="awakening-forge-card rank-b">
                                    <div className="awakening-forge-rank">B Rank</div>
                                    <div className="awakening-forge-cost">🦴 100 Bone Charms</div>
                                    <div className="awakening-forge-have">You have: {character.boneCharms ?? 0}</div>
                                    <button
                                        className="awakening-forge-btn"
                                        onClick={() => awakeningCreateBloodline("B Rank", "boneCharms", 100)}
                                        disabled={(character.boneCharms ?? 0) < 100}
                                    >
                                        Forge B Rank Bloodline
                                    </button>
                                </div>
                                <div className="awakening-forge-card rank-a">
                                    <div className="awakening-forge-rank">A Rank</div>
                                    <div className="awakening-forge-cost">🌟 100 Aura Stones</div>
                                    <div className="awakening-forge-have">You have: {character.auraStones ?? 0}</div>
                                    <button
                                        className="awakening-forge-btn"
                                        onClick={() => awakeningCreateBloodline("A Rank", "auraStones", 100)}
                                        disabled={(character.auraStones ?? 0) < 100}
                                    >
                                        Forge A Rank Bloodline
                                    </button>
                                </div>
                                <div className="awakening-forge-card rank-s">
                                    <div className="awakening-forge-rank">S Rank</div>
                                    <div className="awakening-forge-cost">🔱 100 Mythic Seals</div>
                                    <div className="awakening-forge-have">You have: {character.mythicSeals ?? 0}</div>
                                    <button
                                        className="awakening-forge-btn"
                                        onClick={() => awakeningCreateBloodline("S Rank", "mythicSeals", 100)}
                                        disabled={(character.mythicSeals ?? 0) < 100}
                                    >
                                        Forge S Rank Bloodline
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function sectorBackgroundImage(sector: number) {
    const village = villageForOutskirtsSector(sector);
    if (village) return villagePageImage(village);

    const sectorImages: Record<string, number[]> = {
        ice: [47, 52, 48, 53, 54, 50, 55],
        dark: [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 17, 20, 19, 18, 14, 15, 13],
        temple: [34, 60, 59],
        water: [26, 21, 22, 27, 32, 28, 33, 42],
        forrest: [36, 37, 38, 39, 40, 43, 46],      // removed 23 — now stormveil
        stormveil: [23, 31, 35, 10, 16],               // sectors near Stormveil get storm look
        meadow2: [44, 24, 29, 30, 59, 1],
        meadow: [25, 41, 45, 57, 51],
    };

    if (sectorImages.ice.includes(sector)) return iceSectorImg;
    if (sectorImages.dark.includes(sector)) return darkSectorImg;
    if (sectorImages.temple.includes(sector)) return templeSectorImg;
    if (sectorImages.water.includes(sector)) return waterSectorImg;
    if (sectorImages.stormveil.includes(sector)) return stormveilVillageImg;
    if (sectorImages.forrest.includes(sector)) return forrestSectorImg;
    if (sectorImages.meadow2.includes(sector)) return meadow2SectorImg;
    if (sectorImages.meadow.includes(sector)) return meadowSectorImg;

    return meadowSectorImg;
}
function WorldMap({
    setCurrentBiome,
    setScreen,
    character,
    updateCharacter,
    creatorEvents,
    petEncounterVn,
    editablePets,
    setPendingAiProfileId,
    setRaidBattleKind,
    recordMissionExplore,
    playableAis,
    setCurrentWeather,
    playerRoster,
    liveSectorPlayers,
    setCurrentSector,
    attackPlayer,
}: {
    setCurrentBiome: (biome: Biome) => void;
    setScreen: (screen: Screen) => void;
    character: Character;
    updateCharacter: (character: Character) => void;
    creatorEvents: CreatorEvent[];
    petEncounterVn: CreatorEvent;
    editablePets: Pet[];
    setPendingAiProfileId: (id: string) => void;
    setRaidBattleKind: (kind: "none" | "raidAi" | "raidPlayer" | "defense") => void;
    recordMissionExplore: (sector: number) => void;
    playableAis: CreatorAi[];
    setCurrentWeather: (weather: WeatherType) => void;
    playerRoster: PlayerRecord[];
    liveSectorPlayers: PlayerRecord[];
    setCurrentSector: (sector: number) => void;
    attackPlayer: (opponent: PlayerRecord) => void;
}) {
    const [selectedSector, setSelectedSector] = useState<number | null>(null);
    const [selectedVillageTerritory, setSelectedVillageTerritory] = useState<typeof locations[number] | null>(null);
    const [territoryGuards, setTerritoryGuards] = useState<{ name: string; level: number; village: string; defenseBonusPercent?: number }[]>([]);

    useEffect(() => {
        if (!selectedVillageTerritory) { setTerritoryGuards([]); return; }
        fetch("/api/village-guard/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ village: selectedVillageTerritory.name }),
        }).then(r => r.ok ? r.json() : []).then(setTerritoryGuards).catch(() => setTerritoryGuards([]));
    }, [selectedVillageTerritory]);

    function pickGuardAi(level: number, defenseBonusPercent = 0): string {
        const effectiveLevel = level + Math.floor(defenseBonusPercent * 2);
        if (effectiveLevel < 20) return "builtin-ai-mist-sentinel";
        if (effectiveLevel < 40) return "builtin-ai-ember-duelist";
        if (effectiveLevel < 60) return "builtin-ai-frost-sealer";
        if (effectiveLevel < 80) return "builtin-ai-shadow-weaver";
        return "builtin-ai-central-champion";
    }
    const [activePetEncounter, setActivePetEncounter] = useState<Pet | null>(null);
    const [petVnDone, setPetVnDone] = useState(false);
    const [petVnPage, setPetVnPage] = useState(0);
    const [petVnLine, setPetVnLine] = useState(0);
    const [sectorPlayerPos, setSectorPlayerPos] = useState(78);
    const [selectedCreatorEvent, setSelectedCreatorEvent] = useState<CreatorEvent | null>(null);
    const [creatorEventPage, setCreatorEventPage] = useState(0);
    const [creatorEventLine, setCreatorEventLine] = useState(0);
    type ChestLoot = {
        xp: number;
        ryo?: number;
        itemId?: string;
        cardId?: string;
        fateShards?: number;
        boneCharms?: number;
        auraStones?: number;
        auraDust?: number;
    };
    const [activeChest, setActiveChest] = useState<ChestLoot | null>(null);
    const [chestVnPage, setChestVnPage] = useState(0);
    const [chestVnLine, setChestVnLine] = useState(0);
    const [chestVnDone, setChestVnDone] = useState(false);
    const locations = [
        { name: "Stormveil Village", type: "village", biome: "forest" as Biome, x: 20, y: 65, icon: "SV" },
        { name: "Ashen Leaf Village", type: "village", biome: "volcano" as Biome, x: 24, y: 22, icon: "AL" },
        { name: "Frostfang Village", type: "village", biome: "snow" as Biome, x: 76, y: 15, icon: "FF" },
        { name: "Moonshadow Village", type: "village", biome: "shadow" as Biome, x: 76, y: 66, icon: "MS" },
        { name: "Central", type: "central", biome: "central" as Biome, x: 52, y: 42, icon: "C", staminaReward: 20, xpReward: 20 },
    ];
    const [selectedLandmark, setSelectedLandmark] = useState<(typeof locations)[number] | null>(null);
    const sectorPoints = [
        { id: 1, x: 67, y: 46 }, { id: 2, x: 72, y: 45 }, { id: 3, x: 78, y: 45 }, { id: 4, x: 83, y: 47 }, { id: 5, x: 87, y: 51 },
        { id: 6, x: 74, y: 53 }, { id: 7, x: 79, y: 56 }, { id: 8, x: 84, y: 59 }, { id: 9, x: 69, y: 61 }, { id: 10, x: 75, y: 65 },
        { id: 11, x: 81, y: 67 }, { id: 12, x: 88, y: 69 }, { id: 13, x: 64, y: 70 }, { id: 14, x: 71, y: 74 }, { id: 15, x: 78, y: 76 },
        { id: 16, x: 84, y: 78 }, { id: 17, x: 90, y: 79 }, { id: 18, x: 73, y: 86 }, { id: 19, x: 81, y: 88 }, { id: 20, x: 89, y: 90 },
        { id: 21, x: 16, y: 49 }, { id: 22, x: 21, y: 45 }, { id: 23, x: 27, y: 42 }, { id: 24, x: 33, y: 40 }, { id: 25, x: 39, y: 43 },
        { id: 26, x: 18, y: 56 }, { id: 27, x: 24, y: 54 }, { id: 28, x: 31, y: 55 }, { id: 29, x: 38, y: 58 }, { id: 30, x: 45, y: 60 },
        { id: 31, x: 20, y: 65 }, { id: 32, x: 27, y: 67 }, { id: 33, x: 34, y: 70 }, { id: 34, x: 41, y: 72 }, { id: 35, x: 47, y: 76 },
        { id: 36, x: 13, y: 30 }, { id: 37, x: 18, y: 23 }, { id: 38, x: 24, y: 18 }, { id: 39, x: 31, y: 17 }, { id: 40, x: 38, y: 20 },
        { id: 41, x: 45, y: 25 }, { id: 42, x: 18, y: 34 }, { id: 43, x: 27, y: 31 }, { id: 44, x: 36, y: 33 }, { id: 45, x: 45, y: 36 },
        { id: 46, x: 56, y: 15 }, { id: 47, x: 62, y: 11 }, { id: 48, x: 69, y: 12 }, { id: 49, x: 76, y: 15 }, { id: 50, x: 83, y: 20 },
        { id: 51, x: 58, y: 24 }, { id: 52, x: 65, y: 25 }, { id: 53, x: 72, y: 27 }, { id: 54, x: 80, y: 31 }, { id: 55, x: 88, y: 36 },
        { id: 56, x: 53, y: 43 }, { id: 57, x: 57, y: 49 }, { id: 58, x: 52, y: 55 }, { id: 59, x: 57, y: 61 }, { id: 60, x: 50, y: 67 },
    ];

    function biomeForSector(sector: number): Biome {
        if (sector >= 56) return "central"; // Central meadow
        if (sector <= 20) return "shadow";  // Moonshadow darkness
        if (sector <= 35) return "forest";  // Stormveil water
        if (sector <= 45) return "volcano"; // Ashen Leaf forest
        return "snow";                      // Frostfang ice
    }

    // Sector adjacent to each home village (used for Outskirts)
    function villageOutskirtsSector(villageName: string): number {
        return villageOutskirtsSectorNumber(villageName);
    }

    // Background image for enemy village territory pages
    function villageTerritorySectorBg(villageName: string): string {
        return villagePageImage(villageName);
    }

    function enterLandmark(location: typeof locations[number]) {
        setCurrentBiome(location.biome);
        setCurrentWeather(weatherForBiome(location.biome));
        // Enemy village → territory exploration page; own village & Central → normal landmark
        if (location.type === "village" && location.name !== character.village) {
            setSelectedVillageTerritory(location);
        } else {
            setSelectedLandmark(location);
        }
    }
    function triggerTravelPoint(sector: number) {
        if (sector === 35) {
            setCurrentBiome("volcano");
            setCurrentWeather(weatherForSector(sector, "volcano"));
            setCurrentSector(sector);
            setScreen("sunscarFestival");
            return;
        }

        const biome = biomeForSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(sector, biome));
        setCurrentSector(sector);
        setSelectedSector(sector);
    }

    function rollAncientChest(sector: number, allCards: TileCard[]): ChestLoot {
        // Always: XP scaled to sector
        const xp = 50 + Math.floor(sector * 2);

        // 50%: Ryo 100–500
        const ryo = Math.random() < 0.5
            ? 100 + Math.floor(Math.random() * 401)
            : undefined;

        // Loot slot roll (item, card, or currency)
        const lootRoll = Math.random();
        let itemId: string | undefined;
        let cardId: string | undefined;
        let fateShards: number | undefined;
        let boneCharms: number | undefined;
        let auraStones: number | undefined;
        const auraDust = Math.random() < 0.2 ? 5 + Math.floor(Math.random() * 11) : undefined;

        if (lootRoll < 0.2) {
            // 20% - pet treat
            const treat = petTreatItems[Math.floor(Math.random() * petTreatItems.length)];
            itemId = treat.id;
        } else if (lootRoll < 0.55) {
            // 35% - random common gear item
            const commons = starterItems.filter((i) => i.rarity === "common" && i.slot !== "item");
            if (commons.length) itemId = commons[Math.floor(Math.random() * commons.length)].id;
        } else if (lootRoll < 0.65) {
            // 10% - random rare gear item
            const rares = starterItems.filter((i) => i.rarity === "rare" && i.slot !== "item");
            if (rares.length) itemId = rares[Math.floor(Math.random() * rares.length)].id;
        } else if (lootRoll < 0.83) {
            // 18% - random common tile card
            const commonCards = allCards.filter((c) => c.rarity === "common");
            if (commonCards.length) cardId = commonCards[Math.floor(Math.random() * commonCards.length)].id;
        } else if (lootRoll < 0.92) {
            // 9% - random rare tile card
            const rareCards = allCards.filter((c) => c.rarity === "rare");
            if (rareCards.length) cardId = rareCards[Math.floor(Math.random() * rareCards.length)].id;
        } else if (lootRoll < 0.97) {
            // 5% - 1 Fate Shard
            fateShards = 1;
        } else if (lootRoll < 0.99) {
            // 2% - 1 Bone Charm
            boneCharms = 1;
        } else {
            // 1% - 1 Aura Stone
            auraStones = 1;
        }

        return { xp, ryo, itemId, cardId, fateShards, boneCharms, auraStones, auraDust };
    }

    function claimChest(loot: ChestLoot) {
        const leveled = gainXp(character, loot.xp);
        const newInventory = loot.itemId && (stackableItemIds.has(loot.itemId) || !character.inventory.includes(loot.itemId))
            ? [...character.inventory, loot.itemId]
            : character.inventory;
        const newTileCards = loot.cardId && !character.tileCards.includes(loot.cardId)
            ? [...character.tileCards, loot.cardId]
            : character.tileCards;
        updateCharacter({
            ...leveled,
            ryo: leveled.ryo + (loot.ryo ?? 0),
            fateShards: leveled.fateShards + (loot.fateShards ?? 0),
            boneCharms: (leveled.boneCharms ?? 0) + (loot.boneCharms ?? 0),
            auraStones: (leveled.auraStones ?? 0) + (loot.auraStones ?? 0),
            auraDust: (leveled.auraDust ?? 0) + (loot.auraDust ?? 0),
            inventory: newInventory,
            tileCards: newTileCards,
        });
        setActiveChest(null);
        setChestVnDone(false);
        setChestVnPage(0);
        setChestVnLine(0);
    }

    function exploreSector(sector: number) {
        const petEncounter = rollPetEncounter(editablePets);

        if (petEncounter) {
            setSelectedVillageTerritory(null);
            setSelectedSector(sector);

            setActivePetEncounter(petEncounter);
            setPetVnDone(false);
            setPetVnPage(0);
            setPetVnLine(0);
            return;
        }

        // 15% — Ancient Chest found
        if (Math.random() < 0.15) {
            const biome = biomeForSector(sector);

            setSelectedVillageTerritory(null);
            setSelectedSector(sector);

            setCurrentBiome(biome);
            setCurrentWeather(weatherForSector(sector, biome));
            recordMissionExplore(sector);

            const allCards = getAllTileCards([]);
            setActiveChest(rollAncientChest(sector, allCards));
            setChestVnPage(0);
            setChestVnLine(0);
            setChestVnDone(false);
            return;
        }

        const battleRoll = Math.random();

        // 80% random AI battle chance
        if (battleRoll <= 0.80 && playableAis.length > 0) {
            const randomAi = playableAis[Math.floor(Math.random() * playableAis.length)];

            alert(`A hostile shinobi appears: ${randomAi.name}!`);
            setPendingAiProfileId(randomAi.id);
            setScreen("arena");
            return;
        }

        const biome = biomeForSector(sector);
        const xpReward = 20 + Math.floor(sector / 5);
        const ryoReward = 10 + Math.floor(sector / 4);
        const leveled = gainXp(character, xpReward);

        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(sector, biome));

        updateCharacter({
            ...leveled,
            ryo: leveled.ryo + ryoReward,
        });

        recordMissionExplore(sector);

        alert("Sector " + sector + " explored. +" + xpReward + " XP and +" + ryoReward + " ryo.");
    }
    function restInSector(sector: number) {
        const staminaReward = 10 + (sector % 10);

        updateCharacter({
            ...character,
            stamina: Math.min(character.maxStamina, character.stamina + staminaReward),
        });

        alert("You recovered in Sector " + sector + ". +" + staminaReward + " stamina.");
    }

    function moveSectorPlayer(direction: "up" | "down" | "left" | "right") {
        const width = 12;
        const height = 12;

        const x = sectorPlayerPos % width;
        const y = Math.floor(sectorPlayerPos / width);

        let nextX = x;
        let nextY = y;

        if (direction === "up") nextY--;
        if (direction === "down") nextY++;
        if (direction === "left") nextX--;
        if (direction === "right") nextX++;

        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) return;

        setSectorPlayerPos(nextY * width + nextX);
    }
    function triggerCreatorEvent(event: CreatorEvent) {
        setCurrentBiome(event.biome);
        setCurrentWeather(weatherForBiome(event.biome));
        if (character.level < event.levelReq) return alert("Requires level " + event.levelReq + ".");
        if (event.eventKind === "visualNovel") {
            setCreatorEventPage(0);
            setCreatorEventLine(0);
            setSelectedCreatorEvent(event);
            return;
        }
        const leveled = gainXp(character, event.xpReward);
        const rewarded = applyCurrencyRewards(leveled, event.currencyRewards);
        updateCharacter({ ...rewarded, ryo: rewarded.ryo + event.ryoReward, stamina: Math.min(rewarded.maxStamina, rewarded.stamina + event.staminaReward) });
        alert(event.icon + " " + event.name + "\n\n" + event.dialogue.join("\n") + "\n\n" + rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards));
    }
    function completeCreatorEvent(event: CreatorEvent) {
        const leveled = gainXp(character, event.xpReward);
        const rewarded = applyCurrencyRewards(leveled, event.currencyRewards);
        updateCharacter({ ...rewarded, ryo: rewarded.ryo + event.ryoReward, stamina: Math.min(rewarded.maxStamina, rewarded.stamina + event.staminaReward) });
        alert(event.name + " complete. " + rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards) + ".");
        setSelectedCreatorEvent(null);
    }
    if (activePetEncounter && !petVnDone) {
        const vn = petEncounterVn;
        const pages = vn.vnPages && vn.vnPages.length > 0 ? vn.vnPages : [{ title: vn.vnTitle || vn.name, scene: vn.vnScene || "", speaker: vn.vnSpeaker || "Narrator", dialogue: vn.dialogue, image: vn.image, choices: [] }];
        const page = pages[Math.min(petVnPage, pages.length - 1)];
        const pageDialogue = page.dialogue.length > 0 ? page.dialogue : vn.dialogue;
        const activeLine = pageDialogue[petVnLine] ?? pageDialogue[0] ?? page.scene ?? "A presence stirs nearby.";
        const splitLine = activeLine.includes(":") ? activeLine.split(":") : [page.speaker || vn.vnSpeaker || "Narrator", activeLine];
        const speaker = splitLine[0].trim();
        const spoken = splitLine.slice(1).join(":").trim() || activeLine;
        const initials = speaker === "Narrator" ? "..." : speaker.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
        const pageImage = page.image || vn.image || activePetEncounter.image;
        const canBack = petVnLine > 0 || petVnPage > 0;
        const isLastPage = petVnPage >= pages.length - 1;
        const isLastLine = petVnLine >= pageDialogue.length - 1;

        function vnBack() {
            if (petVnLine > 0) { setPetVnLine((l) => l - 1); return; }
            if (petVnPage > 0) { const prev = pages[petVnPage - 1]; setPetVnPage((p) => p - 1); setPetVnLine(Math.max(0, (prev.dialogue.length || 1) - 1)); }
        }
        function vnNext() {
            if (!isLastLine) { setPetVnLine((l) => l + 1); return; }
            if (!isLastPage) { setPetVnPage((p) => p + 1); setPetVnLine(0); return; }
            setPetVnDone(true);
        }

        return (
            <div className="card cinematic-card">
                <div className="visual-novel admin-vn-play">
                    <div className="vn-header">
                        <div>
                            <p className="act-label">🐾 PET ENCOUNTER</p>
                            <h2>{page.title || vn.vnTitle || "A Presence in the Shadows"}</h2>
                        </div>
                        <div className="vn-progress">Page {petVnPage + 1}/{pages.length} | Line {petVnLine + 1}/{Math.max(1, pageDialogue.length)}</div>
                    </div>
                    <div className={"vn-stage vn-biome-forest" + (pageImage ? " vn-has-image" : "")} style={pageImage ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${pageImage})` } : undefined}>
                        <div className="vn-backdrop"><span className="vn-village-silhouette" /></div>
                        <div className="vn-character mentor-character">{activePetEncounter.image ? <img src={activePetEncounter.image} alt={activePetEncounter.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} /> : "🐾"}</div>
                        <div className="vn-character hero-character">{character.name.slice(0, 2).toUpperCase()}</div>
                        <div className="vn-scene-card">{page.scene || vn.vnScene || "Something moves through the undergrowth."}</div>
                        <div className="vn-dialogue">
                            <div className="vn-speaker">{speaker === "Narrator" ? initials : speaker}</div>
                            <p>{spoken}</p>
                            <div className="vn-controls">
                                <button disabled={!canBack} onClick={vnBack}>Back</button>
                                <button onClick={vnNext}>{isLastPage && isLastLine ? "Continue" : "Next"}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (activePetEncounter && petVnDone) {
        return (
            <div className="card cinematic-card">
                <h2>🐾 {activePetEncounter.name} Wants to Join You!</h2>

                <div className="summary-box">
                    <h3>{activePetEncounter.name}</h3>
                    <p><strong>Rarity:</strong> {activePetEncounter.rarity}</p>
                    <p><strong>Level:</strong> {activePetEncounter.level}</p>
                    <p>
                        HP {activePetEncounter.hp} | ATK {activePetEncounter.attack} |
                        DEF {activePetEncounter.defense} | SPD {activePetEncounter.speed}
                    </p>

                    {activePetEncounter.image && (
                        <div className="admin-jutsu-preview">
                            <img src={activePetEncounter.image} alt={activePetEncounter.name} />
                        </div>
                    )}
                </div>

                <div className="menu">
                    <button
                        onClick={() => {
                            if (character.pets.length >= 5) {
                                return alert("Your Pet Yard is full (5/5). Release a pet before befriending another.");
                            }
                            const trait = rollPetTrait(activePetEncounter.rarity);
                            const petWithTrait = applyPetTraitBonuses({ ...activePetEncounter, trait }, trait);
                            updateCharacter({
                                ...character,
                                pets: [...character.pets, petWithTrait],
                            });
                            alert(`${activePetEncounter.name} joined you!\nTrait: ${trait} — ${petTraitDescriptions[trait]}`);
                            setActivePetEncounter(null);
                        }}
                    >
                        Befriend Pet
                    </button>

                    <button
                        className="danger-button"
                        onClick={() => setActivePetEncounter(null)}
                    >
                        Leave
                    </button>
                </div>
            </div>
        );
    }
    if (selectedCreatorEvent) {
        const event = selectedCreatorEvent;
        const pages = event.vnPages && event.vnPages.length > 0 ? event.vnPages : [{ title: event.vnTitle || event.name, scene: event.vnScene || "", speaker: event.vnSpeaker || "Narrator", dialogue: event.dialogue, image: event.image }];
        const page = pages[Math.min(creatorEventPage, pages.length - 1)];
        const pageDialogue = page.dialogue.length > 0 ? page.dialogue : event.dialogue;
        const activeLine = pageDialogue[creatorEventLine] ?? pageDialogue[0] ?? page.scene ?? "The scene begins.";
        const splitLine = activeLine.includes(":") ? activeLine.split(":") : [page.speaker || event.vnSpeaker || "Narrator", activeLine];
        const speaker = splitLine[0].trim();
        const spoken = splitLine.slice(1).join(":").trim() || activeLine;
        const initials = speaker === "Narrator" ? "..." : speaker.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
        const pageImage = page.image || event.image;
        const canBack = creatorEventLine > 0 || creatorEventPage > 0;
        function previousLine() { if (creatorEventLine > 0) return setCreatorEventLine((index) => index - 1); if (creatorEventPage > 0) { const previousPage = pages[creatorEventPage - 1]; setCreatorEventPage((index) => index - 1); setCreatorEventLine(Math.max(0, (previousPage.dialogue.length || 1) - 1)); } }
        function nextLine() { if (creatorEventLine < pageDialogue.length - 1) return setCreatorEventLine((index) => index + 1); if (creatorEventPage < pages.length - 1) { setCreatorEventPage((index) => index + 1); setCreatorEventLine(0); return; } completeCreatorEvent(event); }
        return <div className="card cinematic-card"><div className="visual-novel admin-vn-play"><div className="vn-header"><div><p className="act-label">ADMIN VISUAL NOVEL EVENT</p><h2>{page.title || event.vnTitle || event.name}</h2></div><div className="vn-progress">Page {creatorEventPage + 1}/{pages.length} | Line {creatorEventLine + 1}/{Math.max(1, pageDialogue.length)}</div></div><div className={"vn-stage vn-biome-" + event.biome + (pageImage ? " vn-has-image" : "")} style={pageImage ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${pageImage})` } : undefined}><div className="vn-backdrop"><span className="vn-village-silhouette"></span></div><div className="vn-character mentor-character">{initials}</div><div className="vn-character hero-character">{character.name.slice(0, 2).toUpperCase()}</div><div className="vn-scene-card">{page.scene || event.vnScene || "An admin-created scene unfolds across the shinobi world."}</div><div className="vn-dialogue"><div className="vn-speaker">{speaker}</div><p>{spoken}</p><div className="vn-controls"><button disabled={!canBack} onClick={previousLine}>Back</button><button onClick={nextLine}>{creatorEventPage === pages.length - 1 && creatorEventLine >= pageDialogue.length - 1 ? "Complete Event" : "Next"}</button></div></div></div><div className="vn-choice-row"><button onClick={() => { setCreatorEventPage(0); setCreatorEventLine(0); }}>Replay Scene</button><button onClick={() => { setPendingAiProfileId(event.aiProfileId ?? ""); setCurrentBiome(event.biome); setCurrentWeather(weatherForBiome(event.biome)); setScreen("arena"); }}>Battle in {biomeLabel(event.biome)}</button><button onClick={() => completeCreatorEvent(event)}>Claim Reward</button></div><div className="vn-reward-strip"><span>Requirement: Level {event.levelReq}</span><span>Reward: {rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards)}</span></div></div></div>;
    }
    if (activeChest && !chestVnDone) {
        const biome = biomeForSector(selectedSector ?? 40);
        const biomeLabelText = biome === "snow" ? "frozen tundra" : biome === "volcano" ? "volcanic ash fields" : biome === "shadow" ? "shadowed ruins" : biome === "central" ? "ancient central district" : "dense forest";
        const vnPages = [
            {
                title: "Something Stirs in the Ruins",
                scene: `Deep within the ${biomeLabelText}, a faint shimmer catches your eye.`,
                speaker: "Narrator",
                dialogue: [
                    "Narrator: You pause. Something between the rubble is glowing.",
                    "Narrator: Half-buried under centuries of earth and stone — an ancient chest.",
                    `${character.name}: These runes... pre-war era seals. This thing has been here a long time.`,
                    "Narrator: The chakra lock flickers as you approach, as if recognizing your presence.",
                    `${character.name}: Whoever left this... they wanted someone strong enough to find it.`,
                    "Narrator: You press your hand to the seal. It dissolves at your touch.",
                ],
            },
            {
                title: "The Chest Opens",
                scene: "Golden light spills from the ancient chest as the seal breaks.",
                speaker: "Narrator",
                dialogue: [
                    "Narrator: The lid swings open with a low resonant hum.",
                    "Narrator: Inside — preserved by chakra for decades — the chest reveals its contents.",
                    `${character.name}: ...I wasn't expecting this.`,
                    "Narrator: The ancient shinobi who sealed this chest left something worth finding.",
                ],
            },
        ];
        const page = vnPages[Math.min(chestVnPage, vnPages.length - 1)];
        const pageDialogue = page.dialogue;
        const activeLine = pageDialogue[chestVnLine] ?? pageDialogue[0];
        const splitLine = activeLine.includes(":") ? activeLine.split(":") : ["Narrator", activeLine];
        const speaker = splitLine[0].trim();
        const spoken = splitLine.slice(1).join(":").trim() || activeLine;
        const initials = speaker === "Narrator" ? "..." : speaker.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
        const canBack = chestVnLine > 0 || chestVnPage > 0;
        const isLastPage = chestVnPage >= vnPages.length - 1;
        const isLastLine = chestVnLine >= pageDialogue.length - 1;
        function chestVnBack() {
            if (chestVnLine > 0) { setChestVnLine((l) => l - 1); return; }
            if (chestVnPage > 0) { const prev = vnPages[chestVnPage - 1]; setChestVnPage((p) => p - 1); setChestVnLine(Math.max(0, prev.dialogue.length - 1)); }
        }
        function chestVnNext() {
            if (!isLastLine) { setChestVnLine((l) => l + 1); return; }
            if (!isLastPage) { setChestVnPage((p) => p + 1); setChestVnLine(0); return; }
            setChestVnDone(true);
        }

        return (
            <div className="card cinematic-card ancient-chest-vn-card">
                <div className="visual-novel admin-vn-play">
                    <div className="vn-header">
                        <div>
                            <p className="act-label">📦 ANCIENT CHEST DISCOVERED</p>
                            <h2>{page.title}</h2>
                        </div>
                        <div className="vn-progress">Page {chestVnPage + 1}/{vnPages.length} | Line {chestVnLine + 1}/{pageDialogue.length}</div>
                    </div>
                    <div className={`vn-stage vn-biome-${biome}`}>
                        <div className="vn-backdrop"><span className="vn-village-silhouette" /></div>
                        <div className="vn-character mentor-character">📦</div>
                        <div className="vn-character hero-character">{character.name.slice(0, 2).toUpperCase()}</div>
                        <div className="vn-scene-card">{page.scene}</div>
                        <div className="vn-dialogue">
                            <div className="vn-speaker">{speaker === "Narrator" ? initials : speaker}</div>
                            <p>{spoken}</p>
                            <div className="vn-controls">
                                <button disabled={!canBack} onClick={chestVnBack}>Back</button>
                                <button onClick={chestVnNext}>{isLastPage && isLastLine ? "Open Chest" : "Next"}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (activeChest && chestVnDone) {
        const allCards = getAllTileCards([]);
        const lootItem = activeChest.itemId ? starterItems.find((i) => i.id === activeChest.itemId) : null;
        const lootCard = activeChest.cardId ? allCards.find((c) => c.id === activeChest.cardId) : null;
        const alreadyHaveCard = lootCard && character.tileCards.includes(lootCard.id);
        const rewards: { icon: string; label: string; sub: string }[] = [
            { icon: "⭐", label: `+${activeChest.xp} XP`, sub: "Experience" },
        ];
        if (activeChest.ryo) rewards.push({ icon: "💰", label: `+${activeChest.ryo} Ryo`, sub: "Ancient gold" });
        if (lootItem) rewards.push({ icon: stackableItemIds.has(lootItem.id) ? "🍖" : lootItem.rarity === "rare" ? "💜" : "📦", label: lootItem.name, sub: `${lootItem.rarity.charAt(0).toUpperCase() + lootItem.rarity.slice(1)} ${lootItem.slot} · ${lootItem.description.slice(0, 40)}` });
        if (lootCard) rewards.push({ icon: lootCard.rarity === "rare" ? "💜" : "🃏", label: `${lootCard.name}${alreadyHaveCard ? " (duplicate)" : ""}`, sub: `${lootCard.rarity.charAt(0).toUpperCase() + lootCard.rarity.slice(1)} · ${lootCard.element} · Power ${lootCard.power}` });
        if (activeChest.fateShards) rewards.push({ icon: "✨", label: "+1 Fate Shard", sub: "Premium currency" });
        if (activeChest.boneCharms) rewards.push({ icon: "🦴", label: "+1 Bone Charm", sub: "Awakening Stone material" });
        if (activeChest.auraStones) rewards.push({ icon: "🌟", label: "+1 Aura Stone", sub: "Awakening Stone material" });
        if (activeChest.auraDust) rewards.push({ icon: "🌫️", label: `+${activeChest.auraDust} Aura Dust`, sub: "Feeds the Aura Sphere" });

        return (
            <div className="card cinematic-card ancient-chest-reveal-card">
                <div className="chest-reveal">
                    <div className="chest-reveal-header">
                        <p className="act-label">📦 ANCIENT CHEST CONTENTS</p>
                        <h2 className="chest-reveal-title">The chest yields its secrets</h2>
                        <p className="chest-reveal-sub">A relic of the shinobi wars, now yours to keep.</p>
                    </div>
                    <div className="chest-rewards">
                        {rewards.map((r, i) => (
                            <div key={i} className="chest-reward-row">
                                <span className="chest-reward-icon">{r.icon}</span>
                                <div className="chest-reward-text">
                                    <strong>{r.label}</strong>
                                    <small>{r.sub}</small>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button className="chest-claim-btn" onClick={() => claimChest(activeChest)}>
                        ✨ Claim All Rewards
                    </button>
                </div>
            </div>
        );
    }

    if (selectedSector) {
        const biome = biomeForSector(selectedSector);
        const sectorWeather = weatherForSector(selectedSector, biome);
        const sectorPlayers = liveSectorPlayers.length > 0
            ? liveSectorPlayers.filter((p) => p.name !== character.name)
            : playerRoster
                .filter((player) => player.name !== character.name)
                .filter((player) => (player.currentSector ?? 40) === selectedSector);

        return (
            <div className="map-instance">
                <div className="instance-frame">
                    

                    <main className="tile-scene">
                        <div className="scene-title">
                            <strong>Sector {selectedSector}</strong>
                            <span>{biomeLabel(biome)} | {weatherEffects[sectorWeather].name}</span>
                        </div>

                        <div
                            className="pixel-map walkable-sector-map sector-image-map"
                            style={{
                                backgroundImage: `url(${sectorBackgroundImage(selectedSector)})`,
                            }}
                        >
                            {Array.from({ length: 144 }).map((_, index) => {
                                const isPlayer = index === sectorPlayerPos;

                                return (
                                    <button
                                        key={index}
                                        className={`scene-tile walkable-tile transparent-sector-tile ${isPlayer ? "sector-player-tile" : ""}`}
                                        onClick={() => setSectorPlayerPos(index)}
                                    >
                                        {isPlayer ? (
                                            character.avatarImage ? (
                                                <img className="tiny-map-avatar" src={character.avatarImage} alt={character.name} />
                                            ) : (
                                                "🥷"
                                            )
                                        ) : ""}
                                    </button>
                                );
                            })}
                        </div>                  
                    </main>

                    <aside className="instance-actions">
                        <h3>Sector {selectedSector}</h3>
                        <p>{weatherEffects[sectorWeather].effect}</p>
                        <section className="sector-presence">
                            <h4>Players Here {liveSectorPlayers.length > 0 && <span className="live-badge">LIVE</span>}</h4>
                            {sectorPlayers.length === 0 ? (
                                <span>No other players in this sector.</span>
                            ) : (
                                sectorPlayers.map((player) => (
                                    <div className="sector-player-card" key={player.name}>
                                        <div className="sector-player-info">
                                            <strong>{player.name}</strong>
                                            <small>Lv {player.level} · {player.village}</small>
                                            <small>HP {player.character.hp}/{player.character.maxHp}</small>
                                        </div>
                                        <button className="danger-button" onClick={() => attackPlayer(player)}>Attack</button>
                                    </div>
                                ))
                            )}
                        </section>
                        <button onClick={() => exploreSector(selectedSector)}>Explore Tile</button>
                        <button onClick={() => restInSector(selectedSector)}>Recover</button>
                        <button
                            onClick={() => {
                                setCurrentBiome(biome);
                                setCurrentWeather(sectorWeather);
                                setScreen("arena");
                            }}
                        >
                            Battle
                        </button>
                        <button onClick={() => setSelectedSector(null)}>Leave</button>
                    </aside>
                </div>
            </div>
        );
    }

    if (selectedVillageTerritory) {
        const loc = selectedVillageTerritory;
        const biome = loc.biome;
        const weather = weatherForBiome(biome);
        const territoryBg = villageTerritorySectorBg(loc.name);
        // Pick a virtual sector number inside the enemy territory for explore/battle logic
        const virtualSector = villageOutskirtsSector(loc.name) + 4;
        return (
            <div className="map-instance">
                <div className="sector-instance-wrap">
                    <main className="tile-scene">
                        <div className="scene-title">
                            <strong>{loc.name} — Outer Territory</strong>
                            <span>{biomeLabel(biome)} | {weatherEffects[weather].name}</span>
                        </div>

                        <div
                            className="pixel-map walkable-sector-map sector-image-map"
                            style={{ backgroundImage: `url(${territoryBg})` }}
                        >
                            {Array.from({ length: 144 }).map((_, index) => {
                                const isPlayer = index === sectorPlayerPos;
                                return (
                                    <button
                                        key={index}
                                        className={`scene-tile walkable-tile transparent-sector-tile ${isPlayer ? "sector-player-tile" : ""}`}
                                        onClick={() => setSectorPlayerPos(index)}
                                    >
                                        {isPlayer ? (
                                            character.avatarImage ? (
                                                <img className="tiny-map-avatar" src={character.avatarImage} alt={character.name} />
                                            ) : (
                                                "🥷"
                                            )
                                        ) : ""}
                                    </button>
                                );
                            })}                     
                        </div>
                    </main>

                    <aside className="instance-actions">
                        <h3>{loc.name}</h3>
                        <p className="territory-hostile-tag">⚠️ Hostile Territory</p>
                        <p>{weatherEffects[weather].effect}</p>
                        <button onClick={() => exploreSector(virtualSector)}>Explore Territory</button>
                        <button onClick={() => restInSector(virtualSector)}>Recover</button>

                        {/* Village Guard / Raid */}
                        <div className="territory-guard-section">
                            {territoryGuards.length > 0 ? (
                                <>
                                    <p className="territory-guard-label">🛡️ Village Guarded</p>
                                    {territoryGuards.map(g => (
                                        <p key={g.name} className="territory-guard-name">
                                            {g.name} <span className="territory-guard-lvl">Lv.{g.level}</span>{g.defenseBonusPercent ? <span className="territory-guard-lvl"> DEF +{g.defenseBonusPercent.toFixed(1)}%</span> : null}
                                        </p>
                                    ))}
                                    <button
                                        className="territory-raid-btn"
                                        onClick={() => {
                                            const guard = territoryGuards[0];
                                            setPendingAiProfileId(pickGuardAi(guard.level, guard.defenseBonusPercent ?? 0));
                                            setRaidBattleKind("raidAi");
                                            setCurrentBiome(biome);
                                            setCurrentWeather(weather);
                                            setScreen("arena");
                                        }}
                                    >
                                        ⚔️ Challenge Guard
                                    </button>
                                    <p className="hint" style={{ fontSize: "0.7rem", color: "#64748b", marginTop: 2 }}>
                                        Victory earns 5 Honor Seals from an AI guard raid.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="territory-guard-label" style={{ color: "#475569" }}>Village Undefended</p>
                                    <button onClick={() => { setRaidBattleKind("raidAi"); setCurrentBiome(biome); setCurrentWeather(weather); setScreen("arena"); }}>
                                        Raid {loc.name.split(" ")[0]}
                                    </button>
                                </>
                            )}
                        </div>

                        <button onClick={() => setSelectedVillageTerritory(null)}>Leave</button>
                    </aside>
                </div>
            </div>
        );
    }

    if (selectedLandmark) {
        const isCentral = selectedLandmark.type === "central";

        const villageImage =
            selectedLandmark.name === "Ashen Leaf Village" ? houseImg :
                selectedLandmark.name === "Frostfang Village" ? castleImg :
                    selectedLandmark.name === "Stormveil Village" ? towerImg :
                        selectedLandmark.name === "Moonshadow Village" ? moonshadowImage :
                            castleImg;

        return (
            <div className="map-instance">
                <div className="village-full-scene">
                    {!isCentral ? (
                        <img src={villageImage} alt={selectedLandmark.name} />
                    ) : (
                        <div className="central-full-scene">
                            <h1>The Thousand Gates</h1>
                        </div>
                    )}

                    <div className="village-full-overlay">
                        <h2>{selectedLandmark.name}</h2>
                        <p>{biomeLabel(selectedLandmark.biome)}</p>

                        <div className="menu">
                            {isCentral ? (
                                <button onClick={() => {
                                    setCurrentBiome("central");
                                    setScreen("centralHub");
                                }}>
                                    Enter Central
                                </button>
                            ) : (
                                <button onClick={() => setScreen("village")}>Enter {selectedLandmark.name.split(" ")[0]}</button>
                            )}

                            {isCentral ? (
                                <button onClick={() => { setCurrentBiome("central"); setCurrentWeather(weatherForBiome("central")); setScreen("arena"); }}>
                                    Central Battle
                                </button>
                            ) : (
                                <button onClick={() => {
                                    const outskirtsSector = villageOutskirtsSector(character.village);
                                    setCurrentBiome(biomeForSector(outskirtsSector));
                                    setCurrentWeather(weatherForSector(outskirtsSector, biomeForSector(outskirtsSector)));
                                    setSelectedLandmark(null);
                                    setSelectedSector(outskirtsSector);
                                }}>
                                    Outskirts
                                </button>
                            )}

                            <button onClick={() => setSelectedLandmark(null)}>Leave</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="card">
            <div
                className="anime-world-map atlas-world-map generated-world-map"
                style={{ backgroundImage: `url(${worldMapBg})` }}
            >
                <div className="sea-label sea-north">Hoppo Sea</div>
                <div className="sea-label sea-east">Rimawari Ocean</div>
                <div className="sea-label sea-south">Zubunure Sea</div>

                <div className="atlas-landmass continent-west"></div>
                <div className="atlas-landmass continent-east"></div>
                <div className="atlas-landmass frozen-north"></div>
                <div className="atlas-landmass island-south"></div>

                <div className="atlas-region-label label-volcano">Land of Volcanoes</div>
                <div className="atlas-region-label label-forest">Land of Swamps</div>
                <div className="atlas-region-label label-fire">Land of Fire</div>
                <div className="atlas-region-label label-ice">Land of Glaciers</div>
                {sectorPoints.map((sector) => (
                    <button
                        key={sector.id}
                        className={"atlas-sector atlas-sector-" + biomeForSector(sector.id)}
                        style={{ left: sector.x + "%", top: sector.y + "%" }}
                        onClick={() => triggerTravelPoint(sector.id)}
                        title={`Sector ${sector.id} | ${weatherEffects[weatherForSector(sector.id, biomeForSector(sector.id))].name}`}
                    >
                        {sector.id === 35 ? "🎪" : sector.id}
                    </button>
                ))}

                {locations.map((location) => (
                    <button
                        key={location.name}
                        className={"atlas-landmark atlas-" + location.type}
                        style={{ left: location.x + "%", top: location.y + "%" }}
                        onClick={() => enterLandmark(location)}
                        title={location.name}
                    >
                        <strong>{location.icon}</strong>
                        <span>{location.name}</span>
                    </button>
                ))}
            </div>

            {creatorEvents.length > 0 && (
                <div className="summary-box creator-event-list">
                    <h3>Admin Events</h3>
                    <div className="location-grid">
                        {creatorEvents.map((event) => (
                            <button
                                key={event.id}
                                className="location-button"
                                onClick={() => triggerCreatorEvent(event)}
                            >
                                <span className="tile-icon">{event.icon}</span>
                                <span>{event.name}</span>
                                <small>Lvl {event.levelReq} | {event.biome} | {rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards)}</small>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Ancient Chest — VN Scene ──────────────────────────── */}
            {activeChest && !chestVnDone && (() => {
                const biome = biomeForSector(selectedSector ?? 40);
                const biomeLabel = biome === "snow" ? "frozen tundra" : biome === "volcano" ? "volcanic ash fields" : biome === "shadow" ? "shadowed ruins" : biome === "central" ? "ancient central district" : "dense forest";
                const vnPages = [
                    {
                        title: "Something Stirs in the Ruins",
                        scene: `Deep within the ${biomeLabel}, a faint shimmer catches your eye.`,
                        speaker: "Narrator",
                        dialogue: [
                            "Narrator: You pause. Something between the rubble is glowing.",
                            "Narrator: Half-buried under centuries of earth and stone — an ancient chest.",
                            `${character.name}: These runes... pre-war era seals. This thing has been here a long time.`,
                            "Narrator: The chakra lock flickers as you approach, as if recognizing your presence.",
                            `${character.name}: Whoever left this... they wanted someone strong enough to find it.`,
                            "Narrator: You press your hand to the seal. It dissolves at your touch.",
                        ],
                    },
                    {
                        title: "The Chest Opens",
                        scene: "Golden light spills from the ancient chest as the seal breaks.",
                        speaker: "Narrator",
                        dialogue: [
                            "Narrator: The lid swings open with a low resonant hum.",
                            "Narrator: Inside — preserved by chakra for decades — the chest reveals its contents.",
                            `${character.name}: ...I wasn't expecting this.`,
                            "Narrator: The ancient shinobi who sealed this chest left something worth finding.",
                        ],
                    },
                ];
                const page = vnPages[Math.min(chestVnPage, vnPages.length - 1)];
                const pageDialogue = page.dialogue;
                const activeLine = pageDialogue[chestVnLine] ?? pageDialogue[0];
                const splitLine = activeLine.includes(":") ? activeLine.split(":") : ["Narrator", activeLine];
                const speaker = splitLine[0].trim();
                const spoken = splitLine.slice(1).join(":").trim() || activeLine;
                const initials = speaker === "Narrator" ? "..." : speaker.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
                const canBack = chestVnLine > 0 || chestVnPage > 0;
                const isLastPage = chestVnPage >= vnPages.length - 1;
                const isLastLine = chestVnLine >= pageDialogue.length - 1;
                function chestVnBack() {
                    if (chestVnLine > 0) { setChestVnLine((l) => l - 1); return; }
                    if (chestVnPage > 0) { const prev = vnPages[chestVnPage - 1]; setChestVnPage((p) => p - 1); setChestVnLine(Math.max(0, prev.dialogue.length - 1)); }
                }
                function chestVnNext() {
                    if (!isLastLine) { setChestVnLine((l) => l + 1); return; }
                    if (!isLastPage) { setChestVnPage((p) => p + 1); setChestVnLine(0); return; }
                    setChestVnDone(true);
                }
                return (
                    <div className="card cinematic-card">
                        <div className="visual-novel admin-vn-play">
                            <div className="vn-header">
                                <div>
                                    <p className="act-label">📦 ANCIENT CHEST DISCOVERED</p>
                                    <h2>{page.title}</h2>
                                </div>
                                <div className="vn-progress">Page {chestVnPage + 1}/{vnPages.length} | Line {chestVnLine + 1}/{pageDialogue.length}</div>
                            </div>
                            <div className={`vn-stage vn-biome-${biome}`}>
                                <div className="vn-backdrop"><span className="vn-village-silhouette" /></div>
                                <div className="vn-character mentor-character">📦</div>
                                <div className="vn-character hero-character">{character.name.slice(0, 2).toUpperCase()}</div>
                                <div className="vn-scene-card">{page.scene}</div>
                                <div className="vn-dialogue">
                                    <div className="vn-speaker">{speaker === "Narrator" ? initials : speaker}</div>
                                    <p>{spoken}</p>
                                    <div className="vn-controls">
                                        <button disabled={!canBack} onClick={chestVnBack}>Back</button>
                                        <button onClick={chestVnNext}>{isLastPage && isLastLine ? "Open Chest" : "Next"}</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ── Ancient Chest — Loot Reveal ───────────────────────── */}
            {activeChest && chestVnDone && (() => {
                const allCards = getAllTileCards([]);
                const lootItem = activeChest.itemId ? starterItems.find((i) => i.id === activeChest.itemId) : null;
                const lootCard = activeChest.cardId ? allCards.find((c) => c.id === activeChest.cardId) : null;
                const alreadyHaveCard = lootCard && character.tileCards.includes(lootCard.id);
                const rewards: { icon: string; label: string; sub: string }[] = [
                    { icon: "⭐", label: `+${activeChest.xp} XP`, sub: "Experience" },
                ];
                if (activeChest.ryo) rewards.push({ icon: "💰", label: `+${activeChest.ryo} Ryo`, sub: "Ancient gold" });
                if (lootItem) rewards.push({ icon: stackableItemIds.has(lootItem.id) ? "🍖" : lootItem.rarity === "rare" ? "💜" : "📦", label: lootItem.name, sub: `${lootItem.rarity.charAt(0).toUpperCase() + lootItem.rarity.slice(1)} ${lootItem.slot} · ${lootItem.description.slice(0, 40)}` });
                if (lootCard) rewards.push({ icon: lootCard.rarity === "rare" ? "💜" : "🃏", label: `${lootCard.name}${alreadyHaveCard ? " (duplicate)" : ""}`, sub: `${lootCard.rarity.charAt(0).toUpperCase() + lootCard.rarity.slice(1)} · ${lootCard.element} · Power ${lootCard.power}` });
                if (activeChest.fateShards) rewards.push({ icon: "✨", label: "+1 Fate Shard", sub: "Premium currency" });
                if (activeChest.boneCharms) rewards.push({ icon: "🦴", label: "+1 Bone Charm", sub: "Awakening Stone material" });
                if (activeChest.auraStones) rewards.push({ icon: "🌟", label: "+1 Aura Stone", sub: "Awakening Stone material" });
                if (activeChest.auraDust) rewards.push({ icon: "🌫️", label: `+${activeChest.auraDust} Aura Dust`, sub: "Feeds the Aura Sphere" });
                return (
                    <div className="card cinematic-card">
                        <div className="chest-reveal">
                            <div className="chest-reveal-header">
                                <p className="act-label">📦 ANCIENT CHEST CONTENTS</p>
                                <h2 className="chest-reveal-title">The chest yields its secrets</h2>
                                <p className="chest-reveal-sub">A relic of the shinobi wars, now yours to keep.</p>
                            </div>
                            <div className="chest-rewards">
                                {rewards.map((r, i) => (
                                    <div key={i} className="chest-reward-row">
                                        <span className="chest-reward-icon">{r.icon}</span>
                                        <div className="chest-reward-text">
                                            <strong>{r.label}</strong>
                                            <small>{r.sub}</small>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button className="chest-claim-btn" onClick={() => claimChest(activeChest)}>
                                ✨ Claim All Rewards
                            </button>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

function StoryHall({ character, setScreen }: { character: Character; setScreen: (screen: Screen) => void }) {
    const storyLine = storylines[character.storyVillage || character.village] || [];
    const current = getCurrentStory(character);
    const [lineIndex, setLineIndex] = useState(0);
    if (!current) return <div className="card cinematic-card"><div className="visual-novel"><div className="vn-stage vn-complete"><div className="vn-character hero-character">{character.name.slice(0, 2).toUpperCase()}</div><div className="vn-dialogue"><div className="vn-speaker">Narrator</div><p>Your village story is complete. The roads beyond level 100 whisper about clan invasions, forbidden bloodlines, and a war waiting under Central.</p></div></div></div></div>;
    const locked = character.level < current.levelReq;
    const activeLine = current.dialogue[lineIndex] ?? current.dialogue[0] ?? "The night waits for your answer.";
    const splitLine = activeLine.includes(":") ? activeLine.split(":") : ["Narrator", activeLine];
    const speaker = splitLine[0].trim();
    const spoken = splitLine.slice(1).join(":").trim() || activeLine;
    const speakerInitials = speaker === "Narrator" ? "..." : speaker.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    return <div className="card cinematic-card"><div className="visual-novel"><div className="vn-header"><div><p className="act-label">{current.cinematicTitle}</p><h2>{current.title}</h2></div><div className="vn-progress">Chapter {character.storyProgress + 1}/{storyLine.length}</div></div><div className="vn-stage"><div className="vn-backdrop"><span className="vn-moon"></span><span className="vn-village-silhouette"></span></div><div className="vn-character mentor-character">{speakerInitials}</div><div className="vn-character hero-character">{character.name.slice(0, 2).toUpperCase()}</div><div className="vn-scene-card">{current.scene}</div><div className="vn-dialogue"><div className="vn-speaker">{speaker}</div><p>{spoken}</p><div className="vn-controls"><button disabled={lineIndex === 0} onClick={() => setLineIndex((index) => Math.max(0, index - 1))}>Back</button>{lineIndex < current.dialogue.length - 1 ? <button onClick={() => setLineIndex((index) => Math.min(current.dialogue.length - 1, index + 1))}>Next</button> : locked ? <button disabled>Requires Level {current.levelReq}</button> : <button onClick={() => setScreen("storyBoss")}>Face {current.bossName}</button>}</div></div></div><div className="vn-choice-row"><button onClick={() => setLineIndex(0)}>Replay Scene</button><button onClick={() => setScreen("worldMap")}>Investigate World Map</button><button disabled={locked} onClick={() => setScreen("storyBoss")}>{current.bossIcon} Boss: {current.bossName}</button></div><div className="vn-reward-strip"><span>Requirement: Level {current.levelReq}</span><span>Reward: {current.rewardXp} XP / {current.rewardRyo} ryo</span></div></div></div>;
}

function StoryBoss({ character, updateCharacter, setScreen }: { character: Character; updateCharacter: (character: Character) => void; setScreen: (screen: Screen) => void }) {
    const storyStep = getCurrentStory(character);
    const [bossHp, setBossHp] = useState(storyStep?.bossHp ?? 100);
    const [playerHp, setPlayerHp] = useState(character.hp);
    const [ap, setAp] = useState(100);
    const [turn, setTurn] = useState(1);
    const [log, setLog] = useState("The boss steps forward. The air changes.");
    const [effect, setEffect] = useState("");
    if (!storyStep) return <div className="card"><h2>No Boss Available</h2><button onClick={() => setScreen("storyHall")}>Back to Story</button></div>;
    const activeAuraBonuses = getActiveAuraSphereBonuses(character);
    const basicAttackDamage = boostAmount(Math.floor(35 + getOffenseStat(character.stats, character.specialty) * 0.08), activeAuraBonuses.pveDamagePercent);
    const chakraStrikeDamage = boostAmount(Math.floor(65 + getOffenseStat(character.stats, character.specialty) * 0.12), activeAuraBonuses.pveDamagePercent);
    function winBossFight(newPlayerHp: number) { const leveled = gainXp({ ...character, hp: newPlayerHp }, storyStep.rewardXp); updateCharacter({ ...leveled, ryo: leveled.ryo + storyStep.rewardRyo, auraDust: (leveled.auraDust ?? 0) + 12, hp: Math.min(leveled.maxHp, newPlayerHp + 25), stamina: Math.min(leveled.maxStamina, leveled.stamina + 20), chakra: Math.min(leveled.maxChakra, leveled.chakra + 20), storyProgress: character.storyProgress + 1 }); setLog(`${storyStep.bossName} defeated. +${storyStep.rewardXp} XP, +${storyStep.rewardRyo} ryo, +12 Aura Dust. Story advanced.`); }
    function bossCounter() { if (bossHp <= 0) return; const damage = Math.max(5, storyStep.bossDamage + Math.floor(turn * 2)); const afterHit = Math.max(0, playerHp - damage); setPlayerHp(afterHit); updateCharacter({ ...character, hp: afterHit }); if (afterHit <= 0) return setLog(`${storyStep.bossName} defeated you. Visit the Hospital and try again.`); setTurn((t) => t + 1); setAp(100); setLog(`${storyStep.bossName} counters for ${damage} damage.`); }
    function basicAttack() { if (ap < 40) return setLog("Not enough AP."); const newBossHp = Math.max(0, bossHp - basicAttackDamage); setBossHp(newBossHp); setAp((c) => c - 40); setEffect("⚔️"); if (newBossHp <= 0) return winBossFight(playerHp); setLog(`You strike ${storyStep.bossName} for ${basicAttackDamage} damage.`); }
    function chakraStrike() { if (ap < 60) return setLog("Not enough AP."); if (character.chakra < 20) return setLog("Not enough chakra."); const newBossHp = Math.max(0, bossHp - chakraStrikeDamage); setBossHp(newBossHp); setAp((c) => c - 60); setEffect("💠"); updateCharacter({ ...character, chakra: Math.max(0, character.chakra - 20) }); if (newBossHp <= 0) return winBossFight(playerHp); setLog(`You unleash a chakra strike for ${chakraStrikeDamage} damage. -20 chakra.`); }
    function guard() { if (ap < 30) return setLog("Not enough AP."); const reducedDamage = Math.max(1, Math.floor(storyStep.bossDamage * 0.45)); const afterHit = Math.max(0, playerHp - reducedDamage); setPlayerHp(afterHit); setAp(100); setTurn((t) => t + 1); setEffect("🛡️"); updateCharacter({ ...character, hp: afterHit }); setLog(`You guard. ${storyStep.bossName} only deals ${reducedDamage} damage.`); }
    function recover() { if (ap < 50) return setLog("Not enough AP."); const heal = 35 + Math.floor(character.stats.willpower * 0.05); const newHp = Math.min(character.maxHp, playerHp + heal); setPlayerHp(newHp); setAp((c) => c - 50); setEffect("💚"); updateCharacter({ ...character, hp: newHp, chakra: Math.min(character.maxChakra, character.chakra + 15) }); setLog(`You recover your breathing. +${heal} HP and +15 chakra.`); }
    return <div className="card cinematic-card"><div className="boss-stage">{effect && <div className="combat-effect">{effect}</div>}<div className="cinematic-panel"><p className="act-label">{storyStep.cinematicTitle}</p><h2>{storyStep.bossIcon} {storyStep.bossName}</h2><p className="scene-text">{storyStep.scene}</p></div><div className="combat-stats"><div><strong>{character.name}</strong><div className="bar-label">HP {playerHp}/{character.maxHp}</div><div className="bar"><span style={{ width: `${(playerHp / character.maxHp) * 100}%` }}></span></div><div className="bar-label">Chakra {character.chakra}/{character.maxChakra}</div><div className="bar ap-bar"><span style={{ width: `${(character.chakra / character.maxChakra) * 100}%` }}></span></div><p>AP: {ap}/100</p></div><div><strong>{storyStep.bossName}</strong><div className="bar-label">HP {bossHp}/{storyStep.bossHp}</div><div className="bar enemy-bar"><span style={{ width: `${(bossHp / storyStep.bossHp) * 100}%` }}></span></div><p>Boss Damage: {storyStep.bossDamage}</p><p>Turn: {turn}</p></div></div><div className="jutsu-combat-grid"><button onClick={basicAttack}><span className="jutsu-icon">⚔️</span><strong>Basic Attack</strong><small>40 AP / no chakra</small></button><button onClick={chakraStrike}><span className="jutsu-icon">💠</span><strong>Chakra Strike</strong><small>60 AP / -20 chakra</small></button><button onClick={guard}><span className="jutsu-icon">🛡️</span><strong>Guard</strong><small>30 AP / reduce damage</small></button><button onClick={recover}><span className="jutsu-icon">💚</span><strong>Recover</strong><small>50 AP / heal + chakra</small></button></div><div className="menu"><button onClick={bossCounter}>End Turn</button><button onClick={() => setScreen("storyHall")}>Back to Story</button></div><div className="log">{log}</div></div></div>;
}

function Training({ character, updateCharacter, activeTraining, setActiveTraining }: { character: Character; updateCharacter: (character: Character) => void; activeTraining: ActiveTraining | null; setActiveTraining: (training: ActiveTraining | null) => void }) {
    const [selectedStat, setSelectedStat] = useState<keyof Stats>("strength");
    const trainingStats = Object.keys(baseStats()).map((key) => ({ label: key, stat: key as keyof Stats, icon: "🏋️" }));
    const timers = [{ label: "15 Minutes", ms: 15 * 60 * 1000, xp: 20, statGain: 1, staminaCost: 5 }, { label: "1 Hour", ms: 60 * 60 * 1000, xp: 70, statGain: 3, staminaCost: 15 }, { label: "4 Hours", ms: 4 * 60 * 60 * 1000, xp: 220, statGain: 8, staminaCost: 35 }, { label: "8 Hours", ms: 8 * 60 * 60 * 1000, xp: 375, statGain: 14, staminaCost: 60 }];
    const trainingXpBonus = getTrainingXpBonus(character);
    function startTraining(timer: typeof timers[number]) { if (activeTraining) return alert("You are already training."); if (character.stamina < timer.staminaCost) return alert("Not enough stamina."); const boostedXp = boostAmount(timer.xp, trainingXpBonus); updateCharacter({ ...character, stamina: character.stamina - timer.staminaCost }); setActiveTraining({ label: `${timer.label} ${selectedStat} Training`, stat: selectedStat, xp: boostedXp, statGain: timer.statGain, staminaCost: timer.staminaCost, endsAt: Date.now() + timer.ms }); }
    function completeTraining() { if (!activeTraining) return; if (Date.now() < activeTraining.endsAt) return alert(`Training still has ${Math.ceil((activeTraining.endsAt - Date.now()) / 1000)} seconds left.`); const leveled = gainXp(character, activeTraining.xp); updateCharacter({ ...leveled, stats: { ...leveled.stats, [activeTraining.stat]: capStat(leveled.stats[activeTraining.stat] + activeTraining.statGain) } }); alert(`${activeTraining.label} complete.`); setActiveTraining(null); }
    return <div className="card"><h2>Training Grounds</h2><p>Stamina: {character.stamina}/{character.maxStamina} · Town Hall XP Bonus: <strong>{trainingXpBonus.toFixed(2)}%</strong></p>{activeTraining && <div className="summary-box"><h3>Active Training</h3><p>{activeTraining.label}</p><p>Ends: {new Date(activeTraining.endsAt).toLocaleTimeString()}</p><button onClick={completeTraining}>Complete Training</button></div>}<h3>Choose Stat</h3><div className="location-grid">{trainingStats.map((option) => <button key={option.stat} className="location-button" onClick={() => setSelectedStat(option.stat)}><span className="tile-icon">{option.icon}</span><span>{option.label}</span><small>{selectedStat === option.stat ? "Selected" : "Click to select"}</small></button>)}</div><h3>Choose Timer</h3><div className="location-grid">{timers.map((timer) => <button key={timer.label} className="location-button" onClick={() => startTraining(timer)}><span className="tile-icon">⏳</span><span>{timer.label}</span><small>+{boostAmount(timer.xp, trainingXpBonus)} XP / +{timer.statGain} stat</small></button>)}</div></div>;
}

function JutsuTrainingHall({ character, updateCharacter, savedBloodlines, creatorJutsus }: { character: Character; updateCharacter: (character: Character) => void; savedBloodlines: SavedBloodline[]; creatorJutsus: Jutsu[] }) {
    const ownedElements = getCharacterElements(character);
    const allJutsus = getAllJutsus(savedBloodlines, creatorJutsus, character);
    const availableJutsus = allJutsus.filter((jutsu) => hasCharacterElement(character, jutsu.element));
    const lockedElementCount = allJutsus.length - availableJutsus.length;
    const [selectedJutsuId, setSelectedJutsuId] = useState(availableJutsus[0]?.id ?? "");
    const timers = [{ label: "15 Minutes", xp: 25, characterXp: 10, staminaCost: 5 }, { label: "1 Hour", xp: 80, characterXp: 25, staminaCost: 15 }, { label: "4 Hours", xp: 240, characterXp: 75, staminaCost: 35 }, { label: "8 Hours", xp: 400, characterXp: 125, staminaCost: 60 }];
    const jutsuTrainingBonus = getJutsuTrainingSpeedBonus(character) + getActiveAuraSphereBonuses(character).jutsuTrainingSpeedPercent + getActiveAuraSphereBonuses(character).jutsuXpPercent;
    function trainJutsu(timer: typeof timers[number]) { if (!selectedJutsuId) return alert("Pick a jutsu first."); const selectedJutsu = allJutsus.find((jutsu) => jutsu.id === selectedJutsuId); if (!selectedJutsu || !hasCharacterElement(character, selectedJutsu.element)) return alert(`You need the ${selectedJutsu?.element ?? "required"} element to train this jutsu.`); if (character.stamina < timer.staminaCost) return alert("Not enough stamina."); const mastery = getJutsuMastery(character, selectedJutsuId); if (mastery.level >= JUTSU_TRAINING_CAP) return alert("Training Hall can only train jutsu to level 30. Levels 31-50 must be earned in battle."); const boostedJutsuXp = boostAmount(timer.xp, jutsuTrainingBonus); const trainedCharacter = gainJutsuXp({ ...character, stamina: character.stamina - timer.staminaCost }, selectedJutsuId, boostedJutsuXp, JUTSU_TRAINING_CAP); updateCharacter(gainXp(trainedCharacter, timer.characterXp)); alert(`${timer.label} complete. +${boostedJutsuXp} jutsu XP.`); }
    return <div className="card"><h2>Jutsu Training Hall</h2><p>Train jutsu to <strong>Level 30</strong>. Levels <strong>31-50</strong> must be earned from battles. Your elements: <strong>{ownedElements.length ? ownedElements.join(" / ") : "None awakened"}</strong>. Town Hall + Aura bonus: <strong>{jutsuTrainingBonus.toFixed(2)}%</strong>.</p>{lockedElementCount > 0 && <p className="hint">{lockedElementCount} jutsu locked until you awaken their element.</p>}<JutsuDropdownList jutsus={availableJutsus} label="Choose Jutsu" emptyText={ownedElements.length ? "No jutsu match your awakened elements." : "Awaken an element at the Awakening Stone before training elemental jutsu."} renderDetails={(jutsu) => { const mastery = getJutsuMastery(character, jutsu.id); const scaled = scaleJutsuByLevel(jutsu, mastery.level); return <><p>Level: {mastery.level}/50 | XP: {mastery.xp}/{mastery.level >= 50 ? "MAX" : jutsuXpNeeded(mastery.level)}</p><p>Type: {jutsu.type} | Element: {jutsu.element} | AP: {jutsu.ap} | Range: {jutsu.range}</p><p>Scaled EP: {scaled.scaledEffectPower} | Chakra Cost: {scaled.chakraCost} | Stamina Cost: {scaled.staminaCost}</p><p><strong>Effects:</strong> {describeJutsuEffects(jutsu)}</p><JutsuEffectCards jutsu={jutsu} scaledEffectPower={scaled.scaledEffectPower} /><p>{selectedJutsuId === jutsu.id ? "Selected for training." : mastery.level < 30 ? "Training Hall available." : mastery.level < 50 ? "Battle only." : "Mastered."}</p></>; }} renderActions={(jutsu) => <button onClick={() => setSelectedJutsuId(jutsu.id)}>Select For Training</button>} /><h3>Training Timers</h3><div className="location-grid">{timers.map((timer) => <button key={timer.label} className="location-button" onClick={() => trainJutsu(timer)}><span className="tile-icon">🥋</span><span>{timer.label}</span><small>+{boostAmount(timer.xp, jutsuTrainingBonus)} Jutsu XP / +{timer.characterXp} XP</small></button>)}</div></div>;
}

function Missions({
    character,
    updateCharacter,
    creatorAis,
    creatorMissions,
    acceptedMissionIds,
    setAcceptedMissionIds,
    missionProgress,
    setMissionProgress,
    setPendingAiProfileId,
    setScreen,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    creatorAis: CreatorAi[];
    creatorMissions: CreatorMission[];
    acceptedMissionIds: string[];
    setAcceptedMissionIds: (ids: string[]) => void;
    missionProgress: Record<string, number>;
    setMissionProgress: (progress: Record<string, number>) => void;
    setPendingAiProfileId: (id: string) => void;
    setScreen: (screen: Screen) => void;
}) {
    const missionRewardBonus = getMissionRewardBonus(character) + getActiveAuraSphereBonuses(character).missionRewardPercent;
    function completeMission(name: string, xp: number, ryo: number, staminaCost: number, staminaReward: number, minLevel: number) { if (character.level < minLevel) return alert(`Requires level ${minLevel}.`); if (character.stamina < staminaCost) return alert("Not enough stamina."); const boostedXp = boostAmount(xp, missionRewardBonus); const boostedRyo = boostAmount(ryo, missionRewardBonus); const boostedStamina = boostAmount(staminaReward, missionRewardBonus); const leveled = gainXp({ ...character, stamina: character.stamina - staminaCost }, boostedXp); updateCharacter({ ...leveled, ryo: leveled.ryo + boostedRyo, stamina: Math.min(leveled.maxStamina, leveled.stamina + boostedStamina), clanMissionContrib: (leveled.clanMissionContrib ?? 0) + 1, clanContribMonth: new Date().toISOString().slice(0, 7) }); alert(`${name} complete. +${boostedXp} XP, +${boostedRyo} ryo, +${boostedStamina} stamina.`); }
    function startMissionBattle(mission: { min: number; aiProfileId: string }) { if (character.level < mission.min) return alert(`Requires level ${mission.min}.`); const ai = creatorAis.find((candidate) => candidate.id === mission.aiProfileId); if (!ai) return alert("Mission AI is not available."); setPendingAiProfileId(ai.id); setScreen("arena"); }
    function startCreatorMissionBattle(mission: CreatorMission) { if (!mission.aiProfileId) return alert("No AI assigned to this mission."); if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`); const ai = creatorAis.find((candidate) => candidate.id === mission.aiProfileId); if (!ai) return alert("Mission AI is not available."); setPendingAiProfileId(ai.id); setScreen("arena"); }
    function acceptFetchMission(mission: CreatorMission) { if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`); if (acceptedMissionIds.includes(mission.id)) return; setAcceptedMissionIds([...acceptedMissionIds, mission.id]); setMissionProgress({ ...missionProgress, [mission.id]: missionProgress[mission.id] ?? 0 }); alert(`${mission.name} accepted. Explore Sector ${mission.targetSector} ${mission.exploreCount} times.`); }
    function claimFetchMission(mission: CreatorMission) { const progress = missionProgress[mission.id] ?? 0; if (progress < mission.exploreCount) return alert(`Explore Sector ${mission.targetSector} ${mission.exploreCount - progress} more time(s).`); const boostedXp = boostAmount(mission.xpReward, missionRewardBonus); const boostedRyo = boostAmount(mission.ryoReward, missionRewardBonus); const boostedStamina = boostAmount(mission.staminaReward, missionRewardBonus); const leveled = applyCurrencyRewards(gainXp(character, boostedXp), mission.currencyRewards); updateCharacter({ ...leveled, ryo: leveled.ryo + boostedRyo, stamina: Math.min(leveled.maxStamina, leveled.stamina + boostedStamina), clanMissionContrib: (leveled.clanMissionContrib ?? 0) + 1, clanContribMonth: new Date().toISOString().slice(0, 7) }); setAcceptedMissionIds(acceptedMissionIds.filter((id) => id !== mission.id)); setMissionProgress({ ...missionProgress, [mission.id]: 0 }); alert(`${mission.name} complete. ${rewardSummary(boostedXp, boostedRyo, boostedStamina, mission.currencyRewards)}.`); }
    const missions = [
        { name: "D-Rank Errand", xp: 25, ryo: 20, cost: 5, recover: 3, min: 1, icon: "📦", aiProfileId: "builtin-ai-mist-sentinel" },
        { name: "C-Rank Patrol", xp: 75, ryo: 60, cost: 10, recover: 5, min: 10, icon: "👣", aiProfileId: "builtin-ai-ember-duelist" },
        { name: "B-Rank Escort", xp: 150, ryo: 125, cost: 20, recover: 10, min: 30, icon: "🛡️", aiProfileId: "builtin-ai-frost-sealer" },
        { name: "A-Rank Hunt", xp: 300, ryo: 250, cost: 35, recover: 18, min: 50, icon: "⚔️", aiProfileId: "builtin-ai-shadow-weaver" },
        { name: "S-Rank Crisis", xp: 700, ryo: 600, cost: 60, recover: 30, min: 70, icon: "💀", aiProfileId: "builtin-ai-central-champion" },
    ];
    const missionRanks: MissionRank[] = ["Daily", "D Rank", "C Rank", "B Rank", "A Rank", "S Rank"];
    const groupedFetchMissions = missionRanks.map((rank) => ({ rank, missions: creatorMissions.filter((mission) => mission.rank === rank) })).filter((group) => group.missions.length > 0);
    return <div className="card"><h2>Mission Hall</h2><p>Stamina: {character.stamina}/{character.maxStamina} · Town Hall Reward Bonus: <strong>{missionRewardBonus.toFixed(2)}%</strong></p><h3>Combat Missions</h3><div className="location-grid">{missions.map((mission) => { const ai = creatorAis.find((candidate) => candidate.id === mission.aiProfileId); return <div key={mission.name} className="location-button mission-card"><span className="tile-icon">{mission.icon}</span><span>{mission.name}</span><small>Lvl {mission.min} | -{mission.cost} STA | +{boostAmount(mission.xp, missionRewardBonus)} XP / +{boostAmount(mission.ryo, missionRewardBonus)} ryo</small><small>Battle AI: {ai?.name ?? "Missing AI"}</small><div className="menu"><button onClick={() => completeMission(mission.name, mission.xp, mission.ryo, mission.cost, mission.recover, mission.min)}>Complete</button><button onClick={() => startMissionBattle(mission)}>Battle</button></div></div>; })}</div><h3>Fetch Missions</h3>{groupedFetchMissions.length === 0 ? <p className="hint">No admin-created fetch missions yet.</p> : groupedFetchMissions.map((group) => <section className="summary-box mission-board-section" key={group.rank}><h4>{group.rank} Missions</h4><div className="location-grid">{group.missions.map((mission) => { const accepted = acceptedMissionIds.includes(mission.id); const progress = missionProgress[mission.id] ?? 0; const complete = progress >= mission.exploreCount; const missionAi = mission.aiProfileId ? creatorAis.find((candidate) => candidate.id === mission.aiProfileId) : undefined; return <div key={mission.id} className="location-button mission-card"><span className="tile-icon">SEC</span><span>{mission.name}</span><small>Sector {mission.targetSector} | Explore {progress}/{mission.exploreCount}</small><small>Lvl {mission.levelReq} | {rewardSummary(boostAmount(mission.xpReward, missionRewardBonus), boostAmount(mission.ryoReward, missionRewardBonus), boostAmount(mission.staminaReward, missionRewardBonus), mission.currencyRewards)}</small>{mission.aiProfileId && <small>Battle AI: {missionAi?.name ?? "Missing AI"}</small>}<p>{mission.description}</p><div className="mission-progress"><span style={{ width: `${Math.min(100, (progress / mission.exploreCount) * 100)}%` }}></span></div><div className="menu">{!accepted ? <button onClick={() => acceptFetchMission(mission)}>Accept</button> : complete ? <button onClick={() => claimFetchMission(mission)}>Claim Reward</button> : <button onClick={() => setScreen("worldMap")}>Go To Sector {mission.targetSector}</button>}{mission.aiProfileId && <button onClick={() => startCreatorMissionBattle(mission)}>Battle AI</button>}</div></div>; })}</div></section>)}</div>;
}

function Profile({
    character,
    updateCharacter,
    savedBloodlines,
    creatorJutsus,
    creatorItems,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    creatorItems: GameItem[];
}) {
    const allJutsus = getAllJutsus(savedBloodlines, creatorJutsus, character);
    const allItems = getAllItems(creatorItems);
    const equippedItems = itemSectionOptions
        .map(({ value }) => getItemById(allItems, character.equipment[value]))
        .filter((item): item is GameItem => Boolean(item));
    const equippedBloodline = savedBloodlines.find((b) => b.id === character.equippedBloodlineId);
    const auraSphereEquipped = hasEquippedAuraSphere(character);
    const auraBonuses = getActiveAuraSphereBonuses(character);
    const auraDustNeeded = auraSphereDustNeeded(character.auraSphereLevel);
    const ownedElements = getCharacterElements(character);
    function feedAuraSphere() {
        if (character.auraSphereLevel >= 300) return alert("Your Aura Sphere is already eternal.");
        if ((character.auraDust ?? 0) < auraDustNeeded) return alert(`You need ${auraDustNeeded} Aura Dust.`);
        updateCharacter({
            ...character,
            auraDust: character.auraDust - auraDustNeeded,
            auraSphereLevel: character.auraSphereLevel + 1,
        });
    }

    function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) return alert("Please upload an image file.");

        const reader = new FileReader();
        reader.onload = () => {
            updateCharacter({ ...character, avatarImage: String(reader.result) });
        };
        reader.readAsDataURL(file);
    }

    const [statInputs, setStatInputs] = useState<Partial<Record<keyof Stats, number>>>({});
    const [statWarning, setStatWarning] = useState("");

    function formatStatLabel(name: string) {
        return name
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (c) => c.toUpperCase());
    }

    function addStat(stat: keyof Stats) {
        const amount = Math.max(0, Math.floor(statInputs[stat] ?? 1));
        if (amount === 0) return;
        if (amount > character.unspentStats) {
            setStatWarning(`Not enough points — only ${character.unspentStats} remaining.`);
            setTimeout(() => setStatWarning(""), 3000);
            return;
        }
        const newValue = capStat(character.stats[stat] + amount);
        const actualAdded = newValue - character.stats[stat];
        setStatWarning("");
        setStatInputs((prev) => ({ ...prev, [stat]: 1 }));
        updateCharacter({
            ...character,
            unspentStats: character.unspentStats - actualAdded,
            stats: { ...character.stats, [stat]: newValue },
        });
    }

    function equipBloodline(id: string) {
        updateCharacter({
            ...character,
            equippedBloodlineId: id || undefined,
        });
    }

    function toggleJutsu(id: string) {
        const equipped = character.equippedJutsuIds.includes(id);
        const mastery = getJutsuMastery(character, id);

        if (equipped) {
            updateCharacter({
                ...character,
                equippedJutsuIds: character.equippedJutsuIds.filter((j) => j !== id),
            });
            return;
        }

        if (mastery.level < 1) {
            alert("Train this jutsu to level 1 before equipping it.");
            return;
        }

        const jutsu = allJutsus.find((candidate) => candidate.id === id);
        if (jutsu && !canEquipElementJutsu(character, jutsu, savedBloodlines)) {
            alert(`You need the ${jutsu.element} element to equip this jutsu.`);
            return;
        }

        if (character.equippedJutsuIds.length >= 15) {
            alert("You can only equip 15 jutsu.");
            return;
        }

        updateCharacter({
            ...character,
            equippedJutsuIds: [...character.equippedJutsuIds, id],
            jutsuMastery: character.jutsuMastery.some((m) => m.jutsuId === id)
                ? character.jutsuMastery
                : [...character.jutsuMastery, { jutsuId: id, level: 1, xp: 0 }],
        });
    }

    return (
        <div className="profile-page-card">
            <div className="profile-page-header">
                <div>
                    <h2>Profile</h2>
                    <p>An overview of your shinobi.</p>
                </div>
            </div>

            <section className="profile-overview-panel">
                <div className="profile-avatar-upload-box">
                    <div className={`profile-big-avatar ${auraBonuses.avatarAura ? "aura-sphere-avatar" : ""}`}>
                        {character.avatarImage ? (
                            <img src={character.avatarImage} alt="Avatar" />
                        ) : (
                            <span>{character.name.slice(0, 2).toUpperCase()}</span>
                        )}
                    </div>

                    <label className="avatar-upload-button">
                        Upload Avatar
                        <input type="file" accept="image/*" onChange={uploadAvatar} />
                    </label>
                </div>

                <div className="profile-info-grid">
                    <div>
                        <h3>General</h3>
                        <p><strong>Name:</strong> {character.name}</p>
                        <p><strong>Village:</strong> {character.village}</p>
                        <p><strong>Rank:</strong> {character.rankTitle}</p>
                        <p><strong>Level:</strong> {character.level}/100</p>
                        <p><strong>Bloodline:</strong> {equippedBloodline?.name || character.bloodline}</p>
                        <p><strong>Elements:</strong> {ownedElements.length ? ownedElements.join(" / ") : "Not awakened"}</p>
                        {equippedBloodline?.specialElement && <p><strong>Bloodline Element:</strong> {equippedBloodline.specialElement}</p>}
                        {equippedBloodline?.image && <div className="admin-event-list-preview"><img src={equippedBloodline.image} alt={equippedBloodline.name} /></div>}
                    </div>

                    <div>
                        <h3>Activity</h3>
                        <p><strong>XP:</strong> {character.level >= MAX_LEVEL ? "MAX" : `${character.xp}/${xpNeeded(character.level)}`}</p>
                        <p><strong>Ryo:</strong> {character.ryo}</p>
                        <p><strong style={{ color: "#facc15" }}>🎖 Honor Seals:</strong> <span style={{ color: "#facc15" }}>{character.honorSeals ?? 0}</span></p>
                        <p><strong style={{ color: "#fef3c7" }}>🌫 Aura Dust:</strong> <span style={{ color: "#fef3c7" }}>{character.auraDust ?? 0}</span></p>
                        <p><strong>Bank:</strong> {character.bankRyo}</p>
                        <p><strong style={{ color: "#ce93d8" }}>✦ Fate Shards:</strong> <span style={{ color: "#ce93d8" }}>{character.fateShards}</span></p>
                        <p><strong>Jutsu:</strong> {character.equippedJutsuIds.length}/15</p>
                        <p><strong>Equipment:</strong> {equippedItems.length}/3</p>
                        <p><strong>Status:</strong> AWAKE ☼</p>
                    </div>

                    <div>
                        <h3>Resources</h3>
                        <p><strong>HP:</strong> {character.hp}/{character.maxHp}</p>
                        <p><strong>Chakra:</strong> {character.chakra}/{character.maxChakra}</p>
                        <p><strong>Stamina:</strong> {character.stamina}/{character.maxStamina}</p>
                        <p><strong>Regen:</strong> +{1 + auraBonuses.regen} per second outside battle</p>
                    </div>
                </div>
            </section>

            {auraSphereEquipped && <section className="summary-box aura-sphere-panel">
                <div>
                    <p className="act-label">Aura Sphere</p>
                    <h3>{auraBonuses.rankName}</h3>
                    <p>Level {character.auraSphereLevel}/300 · Aura Dust {character.auraDust}/{auraDustNeeded}</p>
                </div>
                <div className="village-buff-list">
                    {auraBonuses.regen > 0 && <span>Regen +{auraBonuses.regen}</span>}
                    {auraBonuses.missionRewardPercent > 0 && <span>Mission Rewards +{auraBonuses.missionRewardPercent}%</span>}
                    {auraBonuses.jutsuTrainingSpeedPercent > 0 && <span>Jutsu Training +{auraBonuses.jutsuTrainingSpeedPercent}%</span>}
                    {auraBonuses.jutsuXpPercent > 0 && <span>Jutsu XP +{auraBonuses.jutsuXpPercent}%</span>}
                    {auraBonuses.avatarAura && <span>Golden Avatar Aura</span>}
                    {auraBonuses.pveDamagePercent > 0 && <span>PvE Damage +{auraBonuses.pveDamagePercent}%</span>}
                </div>
                <button onClick={feedAuraSphere} disabled={character.auraSphereLevel >= 300 || character.auraDust < auraDustNeeded}>
                    {character.auraSphereLevel >= 300 ? "Eternal Aura Reached" : `Feed ${auraDustNeeded} Aura Dust`}
                </button>
                <p className="hint">Aura Dust drops from PvP, village raids, boss wins, war contribution, and ancient chests.</p>
            </section>}

            <section className="profile-build-panel">
                <div className="stat-header">
                    <h2>User Stats</h2>
                    <span className={`stat-points-badge ${character.unspentStats === 0 ? "stat-points-empty" : ""}`}>
                        {character.unspentStats} point{character.unspentStats !== 1 ? "s" : ""} available
                    </span>
                </div>
                {statWarning && <p className="stat-warning">{statWarning}</p>}

                <div className="stat-grid">
                    {(Object.entries(character.stats) as [keyof Stats, number][]).map(([stat, value]) => {
                        const pct = Math.round((value / MAX_STAT) * 100);
                        return (
                            <div className="stat-card" key={stat}>
                                <div className="stat-card-label">{formatStatLabel(stat)}</div>
                                <div className="stat-card-values">
                                    <span className="stat-current">{value}</span>
                                    <span className="stat-max">/ {MAX_STAT}</span>
                                </div>
                                <div className="stat-bar-track">
                                    <div className="stat-bar-fill" style={{ width: `${pct}%` }} />
                                </div>
                                <div className="stat-card-input-row">
                                    <input
                                        type="number"
                                        min={1}
                                        max={character.unspentStats}
                                        value={statInputs[stat] ?? 1}
                                        onChange={(e) => setStatInputs((prev) => ({ ...prev, [stat]: Math.max(1, parseInt(e.target.value) || 1) }))}
                                        className="stat-input"
                                    />
                                    <button
                                        className="stat-add-btn"
                                        onClick={() => addStat(stat)}
                                        disabled={character.unspentStats === 0}
                                    >Add</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="profile-build-panel">
                <h2>Equip Bloodline</h2>

                <select
                    value={character.equippedBloodlineId || ""}
                    onChange={(e) => equipBloodline(e.target.value)}
                >
                    <option value="">No Created Bloodline Equipped</option>
                    {savedBloodlines.map((bloodline) => (
                        <option key={bloodline.id} value={bloodline.id}>
                            {bloodline.name} | {bloodline.specialElement ? `${bloodline.specialElement} | ` : ""}{bloodline.rank}
                        </option>
                    ))}
                </select>
            </section>

            <section className="profile-build-panel">
                <div className="stat-header">
                    <h2>Jutsu Loadout: {character.equippedJutsuIds.length}/15</h2>
                    <button
                        className="danger-button"
                        onClick={() => updateCharacter({ ...character, equippedJutsuIds: [] })}
                        disabled={character.equippedJutsuIds.length === 0}
                    >
                        Unequip All
                    </button>
                </div>
                {(() => {
                    const learnedAnyJutsus = allJutsus.filter((j) => getJutsuMastery(character, j.id).level >= 1);
                    const learnedJutsus = allJutsus.filter((j) => getJutsuMastery(character, j.id).level >= 1 && canEquipElementJutsu(character, j, savedBloodlines));
                    if (learnedJutsus.length === 0) {
                        return <p className="hint">{learnedAnyJutsus.length ? "Your learned jutsu are locked behind elements you do not currently have." : "You haven't trained any jutsu yet. Visit the Training Grounds to learn them."}</p>;
                    }
                    return (
                        <>
                            <p className="hint">{learnedJutsus.length} jutsu learned for your elements — only trained jutsu can be equipped.</p>
                            <JutsuDropdownList
                                jutsus={learnedJutsus}
                                label="Find Jutsu"
                                renderDetails={(jutsu) => {
                                    const mastery = getJutsuMastery(character, jutsu.id);
                                    return (
                                        <>
                                            <p>Level {mastery.level}/50 | {jutsu.type} | {jutsu.element} | {jutsu.ap} AP | R{jutsu.range} | EP {jutsu.effectPower}</p>
                                            <p>Tags: {jutsu.tags.map((tag) => `${tag.name}${tag.percent ? ` ${tag.percent}%` : ""}`).join(", ") || "None"}</p>
                                            <p><strong>Effects:</strong> {describeJutsuEffects(jutsu)}</p>
                                            <JutsuEffectCards jutsu={jutsu} />
                                        </>
                                    );
                                }}
                                renderActions={(jutsu) => {
                                    const equipped = character.equippedJutsuIds.includes(jutsu.id);
                                    return <button onClick={() => toggleJutsu(jutsu.id)}>{equipped ? "Unequip" : "Equip"}</button>;
                                }}
                            />
                        </>
                    );
                })()}
            </section>
        </div>
    );
}
function BloodlineMaker({ savedBloodlines, setSavedBloodlines }: { savedBloodlines: SavedBloodline[]; setSavedBloodlines: (bloodlines: SavedBloodline[]) => void }) {
    const [rank, setRank] = useState<Rank>("A Rank");
    const [bloodlineName, setBloodlineName] = useState("Custom Bloodline");
    const [bloodlineImage, setBloodlineImage] = useState("");
    const [specialElement, setSpecialElement] = useState("");
    const [bloodlineOffense, setBloodlineOffense] = useState<JutsuType>("Ninjutsu");
    const [jutsus, setJutsus] = useState<Jutsu[]>(Array.from({ length: 5 }).map((_, i) => blankJutsu(i, "A Rank")));
    const recommendedMax = pointBudgetForRank(rank);
    function changeRank(newRank: Rank) {
        setRank(newRank);
        setJutsus(Array.from({ length: jutsuCountForRank(newRank) }).map((_, i) => blankJutsu(i, newRank)));
    }
    const totalPoints = bloodlinePoints(jutsus);
    function setBloodlineSpecialElement(value: string) {
        setSpecialElement(value);
        setJutsus((current) => current.map((jutsu) => normalizeJutsu({ ...jutsu, element: (value.trim() || "Fire") as JutsuElement })));
    }
    function setBloodlineOffenseChoice(value: JutsuType) {
        setBloodlineOffense(value);
        setJutsus((current) => current.map((jutsu) => normalizeJutsu({ ...jutsu, type: value })));
    }
    function updateJutsu(index: number, updated: Partial<Jutsu>) {
        setJutsus((current) => current.map((jutsu, i) => {
            if (i !== index) return jutsu;
            const next = normalizeJutsu({ ...jutsu, ...updated });
            if (!bloodlineJutsuMethods.includes(next.method)) next.method = "SINGLE";
            if (next.target === "SELF") next.range = 0;
            else if (![4, 5].includes(next.range)) next.range = 4;
            next.cooldown = 7;
            if (hasFixedEffectPower(next)) next.effectPower = 100;
            return next;
        }));
    }
    function updateJutsuAp(index: number, ap: 40 | 60) {
        const currentJutsu = jutsus[index];
        const fixedEffectPower = currentJutsu ? hasFixedEffectPower(currentJutsu) : false;
        updateJutsu(index, {
            ap,
            tags: (currentJutsu?.tags ?? []).slice(0, ap === 60 ? 2 : 3),
            effectPower: fixedEffectPower ? 100 : ap === 60 ? ([30, 40].includes(currentJutsu?.effectPower ?? 0) ? currentJutsu!.effectPower : 30) : 0,
        });
    }
    function updateTag(jutsuIndex: number, tagIndex: number, updated: Partial<JutsuTag>) {
        setJutsus((current) => current.map((jutsu, i) => {
            if (i !== jutsuIndex) return jutsu;
            const tags = [...jutsu.tags];
            const merged = { ...tags[tagIndex], ...updated };
            if (merged.name && binaryTags.includes(merged.name)) {
                merged.percent = 0;
            }
            // Enforce per-rank cap on capped damage tags
            if (merged.name && cappedDamageTags.includes(merged.name)) {
                merged.percent = Math.min(merged.percent ?? 30, tagCapForRank(rank));
            }
            tags[tagIndex] = merged;
            const next = { ...jutsu, tags: normalizeJutsuTags(tags) };
            return hasFixedEffectPower(next) ? { ...next, effectPower: 100 } : next;
        }));
    }
    function saveBloodline() {
        const finalElement = (specialElement.trim() || "Fire") as JutsuElement;
        const finalizedJutsus = jutsus.map((jutsu) => normalizeJutsu({
            ...jutsu,
            type: bloodlineOffense,
            element: finalElement,
            method: bloodlineJutsuMethods.includes(jutsu.method) ? jutsu.method : "SINGLE",
            range: jutsu.target === "SELF" ? 0 : jutsu.range,
            cooldown: 7,
            effectPower: hasFixedEffectPower(jutsu) ? 100 : jutsu.effectPower,
            tags: normalizeJutsuTags(jutsu.tags),
        }));
        setSavedBloodlines([...savedBloodlines, { id: makeId(), name: bloodlineName, rank, image: bloodlineImage, specialElement: specialElement.trim(), jutsus: finalizedJutsus, totalPoints: bloodlinePoints(finalizedJutsus) }]);
        alert(`${bloodlineName} saved.`);
    }
    return (
        <div className="card bloodline-maker-screen global-menu-panel">
            <h2>Bloodline Maker</h2>
            <label>Name</label><input value={bloodlineName} onChange={(e) => setBloodlineName(e.target.value)} />
            <label>Special Element</label><input value={specialElement} onChange={(e) => setBloodlineSpecialElement(e.target.value)} placeholder="Example: Crystal, Lava, Storm, Shadow Flame" />
            <label>Offense Choice</label>
            <select value={bloodlineOffense} onChange={(e) => setBloodlineOffenseChoice(e.target.value as JutsuType)}>{specialties.map((s) => <option key={s}>{s}</option>)}</select>
            <label>Bloodline Image</label><input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) readImageFile(file, setBloodlineImage, 100); }} />
            <AiImagePrompt label="Bloodline Image" suggestedPrompt={`${bloodlineName}, ${specialElement || "chakra"} bloodline symbol`} onImage={setBloodlineImage} />
            {bloodlineImage && <div className="admin-event-list-preview"><img src={bloodlineImage} alt={bloodlineName} /></div>}
            <label>Rank</label><select value={rank} onChange={(e) => changeRank(e.target.value as Rank)}><option>B Rank</option><option>A Rank</option><option>S Rank</option></select>
            <div className="summary-box"><p>Total Points: {totalPoints} / {recommendedMax}</p>{specialElement.trim() && <p>Special Element: {specialElement.trim()}</p>}</div>
            {jutsus.map((jutsu, jutsuIndex) => (
                <div className="jutsu-card maker-card" key={jutsu.id}>
                    <h3>{jutsu.name}</h3>
                    <label>Name</label><input value={jutsu.name} onChange={(e) => updateJutsu(jutsuIndex, { name: e.target.value })} />
                    <label>Battle Description</label><textarea rows={2} value={jutsu.battleDescription} onChange={(e) => updateJutsu(jutsuIndex, { battleDescription: e.target.value, description: e.target.value })} />
                    <label>Jutsu Image</label><input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) readImageFile(file, (image) => updateJutsu(jutsuIndex, { image }), 100); }} />
                    <AiImagePrompt label="Jutsu Image" suggestedPrompt={`${jutsu.name}, ${specialElement || jutsu.element} ${bloodlineOffense} bloodline technique`} onImage={(image) => updateJutsu(jutsuIndex, { image })} />
                    {jutsu.image && <div className="admin-jutsu-preview"><img src={jutsu.image} alt={jutsu.name} /></div>}
                    <div className="summary-box bloodline-element-lock">Offense: {bloodlineOffense}</div>
                    <div className="summary-box bloodline-element-lock">Element: {specialElement.trim() || "Type a special element above"}</div>
                    <label>Target / Method</label>
                    <div className="inline-grid">
                        <select value={jutsu.target} onChange={(e) => updateJutsu(jutsuIndex, { target: e.target.value as JutsuTarget })}>{jutsuTargets.map((target) => <option key={target} value={target}>{target === "EMPTY_GROUND" ? "GROUND" : target}</option>)}</select>
                        <select value={bloodlineJutsuMethods.includes(jutsu.method) ? jutsu.method : "SINGLE"} onChange={(e) => updateJutsu(jutsuIndex, { method: e.target.value as JutsuMethod })}>
                            {bloodlineJutsuMethods.map((method) => <option key={method} value={method}>{method === "AOE_CIRCLE" ? "AOE_SPIRAL_SHOOT (+1 point with Ground)" : method}</option>)}
                        </select>
                    </div>
                    {jutsu.target === "EMPTY_GROUND" && jutsu.method === "AOE_CIRCLE" && <div className="summary-box bloodline-element-lock">Ground AOE Spiral Shoot: instant ground effect (+1 point). Opponent debuffs apply when the target is caught in the impact area.</div>}
                    <label>AP Type</label>
                    <div className="admin-ap-toggle">
                        <button className={jutsu.ap === 40 ? "active" : ""} onClick={() => updateJutsuAp(jutsuIndex, 40)}>40 AP Utility</button>
                        <button className={jutsu.ap === 60 ? "active" : ""} onClick={() => updateJutsuAp(jutsuIndex, 60)}>60 AP Damage</button>
                    </div>
                    {jutsu.ap === 60 && !hasFixedEffectPower(jutsu) && (() => {
                        const strongUsedElsewhere = jutsus.some((j, i) => i !== jutsuIndex && j.ap === 60 && j.effectPower === 40 && !hasFixedEffectPower(j));
                        return (
                            <div className="summary-box bloodline-damage-section">
                                <h4>Damage</h4>
                                <label>Effect Power</label>
                                <select value={jutsu.effectPower} onChange={(e) => updateJutsu(jutsuIndex, { effectPower: Number(e.target.value) })}>
                                    <option value={30}>30 — Standard (max ~88 at lv 50)</option>
                                    <option value={40} disabled={strongUsedElsewhere}>40 — Strong (max ~118 at lv 50){strongUsedElsewhere ? " [already used]" : " (+1 pt)"}</option>
                                </select>
                            </div>
                        );
                    })()}
                    {hasFixedEffectPower(jutsu) && <div className="summary-box bloodline-damage-section">Effect Power fixed at 100% for prevent, stun, and movement effects.</div>}
                    <label>Range</label>
                    {jutsu.target !== "SELF" ? (
                        <select value={jutsu.range === 5 ? 5 : 4} onChange={(e) => updateJutsu(jutsuIndex, { range: Number(e.target.value) })}>
                            <option value={4}>Range 4</option>
                            <option value={5}>Range 5 (+0.5 points)</option>
                        </select>
                    ) : (
                        <div className="summary-box bloodline-element-lock">Range: Self target</div>
                    )}
                    <div className="summary-box bloodline-element-lock">Cooldown: 7</div>
                    <label>Health / Chakra / Stamina Cost</label>
                    <div className="inline-grid"><input type="number" value={jutsu.healthCost} onChange={(e) => updateJutsu(jutsuIndex, { healthCost: Number(e.target.value) })} /><input type="number" value={jutsu.chakraCost} onChange={(e) => updateJutsu(jutsuIndex, { chakraCost: Number(e.target.value) })} /><input type="number" value={jutsu.staminaCost} onChange={(e) => updateJutsu(jutsuIndex, { staminaCost: Number(e.target.value) })} /></div>
                    <label>Cost Reduction Per Level</label>
                    <div className="inline-grid"><input type="number" value={jutsu.healthCostReducePerLvl} onChange={(e) => updateJutsu(jutsuIndex, { healthCostReducePerLvl: Number(e.target.value) })} /><input type="number" value={jutsu.chakraCostReducePerLvl} onChange={(e) => updateJutsu(jutsuIndex, { chakraCostReducePerLvl: Number(e.target.value) })} /><input type="number" value={jutsu.staminaCostReducePerLvl} onChange={(e) => updateJutsu(jutsuIndex, { staminaCostReducePerLvl: Number(e.target.value) })} /></div>
                    <label>Tags</label>{Array.from({ length: jutsu.ap === 60 ? 2 : 3 }).map((_, tagIndex) => <TagPicker key={tagIndex} rank={rank} tag={jutsu.tags[tagIndex]?.name ?? ""} setTag={(name) => updateTag(jutsuIndex, tagIndex, { name })} percent={jutsu.tags[tagIndex]?.percent ?? 30} setPercent={(percent) => updateTag(jutsuIndex, tagIndex, { percent })} />)}
                    <p>Jutsu Points: {jutsuPoints(jutsu)}</p>
                </div>
            ))}
            <button onClick={saveBloodline}>Save Bloodline</button>
            <h3>Saved</h3>{savedBloodlines.map((b) => <div className="summary-box" key={b.id}>{b.image && <div className="admin-event-list-preview"><img src={b.image} alt={b.name} /></div>}{b.name} | {b.rank} | {b.specialElement ? `${b.specialElement} | ` : ""}Points {b.totalPoints}</div>)}
        </div>
    );
}

function Arena({
    character,
    updateCharacter,
    savedBloodlines,
    creatorJutsus,
    creatorAis,
    pendingAiProfileId,
    setPendingAiProfileId,
    currentBiome,
    playerRoster,
    duelChallenges,
    setDuelChallenges,
    currentWeather,
    pendingPvpOpponent,
    setPendingPvpOpponent,
    raidBattleKind,
    setRaidBattleKind,
    creatorItems,
    setScreen,
    endlessBattleActive = false,
    endlessBattleWave = 0,
    onEndlessWin,
    onEndlessBattleEnd,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    creatorAis: CreatorAi[];
    pendingAiProfileId: string;
    setPendingAiProfileId: (id: string) => void;
    currentBiome: Biome;
    currentWeather: WeatherType;
    playerRoster: PlayerRecord[];
    duelChallenges: DuelChallenge[];
    setDuelChallenges: (challenges: DuelChallenge[]) => void;
    pendingPvpOpponent: Character | null;
    setPendingPvpOpponent: (character: Character | null) => void;
    raidBattleKind: "none" | "raidAi" | "raidPlayer" | "defense";
    setRaidBattleKind: (kind: "none" | "raidAi" | "raidPlayer" | "defense") => void;
    creatorItems: GameItem[];
    setScreen: (screen: Screen) => void;
    endlessBattleActive?: boolean;
    endlessBattleWave?: number;
    onEndlessWin?: (wave: number) => void;
    onEndlessBattleEnd?: () => void;
}) {
    type CombatStatus = {
        name: string;
        rounds: number;
        amount?: number;
        percent?: number;
        kind: "positive" | "negative";
    };
    type BattleActor = "player" | "enemy";
    type BattleActionEntry = {
        round: number;
        actor: string;
        actorRole: BattleActor;
        actionId: string;
        description: string;
        actionNumber: number;
        createdAt: number;
    };
    type SelectedCombatAction = "move" | "dash" | undefined;

    const gridWidth = 12;
    const gridHeight = 10;

    /* Final combat hex sizing */
    const HEX_W = 72;
    const HEX_H = 42;
    const X_STEP = HEX_W * 0.75;
    const Y_STEP = HEX_H * 0.92;
    const ORB = 52;

    const GRID_LAYER_W = (gridWidth - 1) * X_STEP + HEX_W;
    const GRID_LAYER_H = (gridHeight - 1) * Y_STEP + HEX_H * 1.5;

    const battlefieldRef = useRef<HTMLDivElement | null>(null);
    const [boardScale, setBoardScale] = useState(1);

    useEffect(() => {
        const battlefield = battlefieldRef.current;
        if (!battlefield) return;

        function updateBoardScale() {
            const battlefield = battlefieldRef.current;
            if (!battlefield) return;
            const edgeBuffer = Math.min(
                112,
                Math.max(64, Math.min(battlefield.clientWidth, battlefield.clientHeight) * 0.16)
            );
            const availableW = Math.max(1, battlefield.clientWidth - edgeBuffer * 2);
            const availableH = Math.max(1, battlefield.clientHeight - edgeBuffer * 2);

            const nextScale = Math.min(
                1,
                availableW / GRID_LAYER_W,
                availableH / GRID_LAYER_H
            );

            setBoardScale(Math.max(0.45, Math.min(1, Number(nextScale.toFixed(3)))));
        }

        updateBoardScale();

        const observer = new ResizeObserver(updateBoardScale);
        observer.observe(battlefield);
        window.addEventListener("resize", updateBoardScale);

        return () => {
            observer.disconnect();
            window.removeEventListener("resize", updateBoardScale);
        };
    }, [GRID_LAYER_W, GRID_LAYER_H]);
    const allJutsus = getAllJutsus(savedBloodlines, creatorJutsus, character);
    const pendingAiProfile = creatorAis.find((ai) => ai.id === pendingAiProfileId);
    const allItems = getAllItems(creatorItems);
    const playerArmorFactor = getCharacterArmorFactor(character, allItems);
    const equippedJutsus = allJutsus.filter((jutsu) =>
        character.equippedJutsuIds.includes(jutsu.id) && canEquipElementJutsu(character, jutsu, savedBloodlines)
    );
    const combatItemSlots: EquipmentSlot[] = ["hand", "weapon", "thrown", "item"];
    const combatEquippedItems = Array.from(
        new Set(combatItemSlots.map((slot) => character.equipment[slot]).filter((id): id is string => Boolean(id)))
    )
        .map((id) => getItemById(allItems, id))
        .filter((item): item is GameItem => Boolean(item));
    const [battleStarted, setBattleStarted] = useState(false);
    const [aiLevel, setAiLevel] = useState(character.level);
    const [playerSearch, setPlayerSearch] = useState("");
    const [opponentCharacter, setOpponentCharacter] = useState<Character | null>(null);
    const enemyArmorFactor = opponentCharacter ? getCharacterArmorFactor(opponentCharacter, allItems) : 1.0;
    const opponentLevel = opponentCharacter?.level ?? pendingAiProfile?.level ?? aiLevel;
    const opponentName = opponentCharacter?.name ?? pendingAiProfile?.name ?? `Level ${aiLevel} AI Ninja`;
    const opponentAvatar = opponentCharacter?.avatarImage || pendingAiProfile?.image || pendingAiProfile?.icon || "EN";
    const enemyMaxHp = opponentCharacter?.maxHp ?? pendingAiProfile?.hp ?? maxHpForLevel(opponentLevel);
    const enemyMaxChakra = opponentCharacter?.maxChakra ?? pendingAiProfile?.chakra ?? maxChakraForLevel(opponentLevel);
    const enemyMaxStamina = opponentCharacter?.maxStamina ?? pendingAiProfile?.stamina ?? maxStaminaForLevel(opponentLevel);
    const enemyCombatStats = opponentCharacter?.stats ?? pendingAiProfile?.stats ?? addToAllStats(enemyStats(), Math.max(0, opponentLevel - 1));
    const enemyAiJutsus = pendingAiProfile
        ? allJutsus.filter((jutsu) => pendingAiProfile.jutsuIds.includes(jutsu.id))
        : opponentCharacter
            ? getAllJutsus(savedBloodlines, creatorJutsus, opponentCharacter).filter((jutsu) => opponentCharacter.equippedJutsuIds.includes(jutsu.id))
            : [];
    const searchablePlayers = playerRoster.filter((player) => player.name !== character.name && player.name.toLowerCase().includes(playerSearch.trim().toLowerCase()));
    const incomingChallenges = duelChallenges.filter((challenge) => challenge.toName === character.name);
    const rollInitiative = () => (character.stats.speed + character.stats.willpower * 0.4 >= enemyCombatStats.speed + enemyCombatStats.willpower * 0.4 ? "player" : "enemy") as BattleActor;

    const [playerPos, setPlayerPos] = useState(62);
    const [enemyPos, setEnemyPos] = useState(33);

    const [playerHp, setPlayerHp] = useState(character.hp);
    const [enemyHp, setEnemyHp] = useState(enemyMaxHp);

    const [playerShield, setPlayerShield] = useState(0);
    const [enemyShield, setEnemyShield] = useState(0);

    const [ap, setAp] = useState(100);
    const [enemyAp, setEnemyAp] = useState(100);
    const [turn, setTurn] = useState(1);
    const [battleEnded, setBattleEnded] = useState(false);
    const [battleResult, setBattleResult] = useState<"win" | "loss" | "fled" | null>(null);
    const [dashMode, setDashMode] = useState(false);

    const [playerStatuses, setPlayerStatuses] = useState<CombatStatus[]>([]);
    const [enemyStatuses, setEnemyStatuses] = useState<CombatStatus[]>([]);

    const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
    const [jutsuCooldowns, setJutsuCooldowns] = useState<Record<string, number>>({});
    const [log, setLog] = useState("Battle started.");
    const [, setCombatLog] = useState<string[]>([]);
    const [activeActor, setActiveActor] = useState<BattleActor>(rollInitiative);
    const [actionsThisTurn, setActionsThisTurn] = useState(0);
    const [battleHistory, setBattleHistory] = useState<BattleActionEntry[]>([]);
    const [selectedActionId, setSelectedActionId] = useState<SelectedCombatAction>(undefined);

    const [pendingTargetJutsuId, setPendingTargetJutsuIdRaw] = useState("");
    const [pendingTargetJutsuDirect, setPendingTargetJutsuDirect] = useState<Jutsu | null>(null);
    const [inspectedJutsuId, setInspectedJutsuId] = useState("");
    const [inspectedCombatItemId, setInspectedCombatItemId] = useState("");
    const pendingPlayerStunApPenaltyRef = useRef(false);

    function setPendingTargetJutsuId(value: string) {
        setPendingTargetJutsuIdRaw(value);

        if (!value) {
            setPendingTargetJutsuDirect(null);
        }
    }

    function armPendingTargetJutsu(jutsu: Jutsu) {
        setPendingTargetJutsuDirect(jutsu);
        setPendingTargetJutsuIdRaw(jutsu.id || `${jutsu.name}-${jutsu.ap}-${jutsu.range}`);
    }

    const pendingTargetJutsu =
        pendingTargetJutsuDirect ??
        equippedJutsus.find((jutsu) => jutsu.id === pendingTargetJutsuId);

    const inspectedJutsu = equippedJutsus.find((jutsu) => jutsu.id === inspectedJutsuId);
    const inspectedCombatItem = combatEquippedItems.find((item) => item.id === inspectedCombatItemId);

    function weatherDamageMultiplier(jutsu: Jutsu) {
        const weather = weatherEffects[currentWeather];
        if (weather.positiveElement === jutsu.element) return 1.05;
        if (weather.negativeElement === jutsu.element) return 0.98;
        return 1;
    }

    function adjustedApCost(cost: number) {
        const timeCompressionPenalty = playerStatuses.some((s) => s.name === "Time Compression") ? 10 : 0;
        const timeDilationBonus = playerStatuses.some((s) => s.name === "Time Dilation") ? 10 : 0;
        return Math.max(0, cost + timeCompressionPenalty - timeDilationBonus);
    }

    useEffect(() => {
        if (!battleStarted || battleEnded) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() === "m") {
                setSelectedActionId((current) => current === "move" ? undefined : "move");
                setDashMode(false);
                setLog("Move selected. Click an adjacent tile.");
            }
            if (event.key.toLowerCase() === "w") {
                waitTurn();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [battleStarted, battleEnded, activeActor, ap, turn]);

    useEffect(() => {
        if (!battleStarted || battleEnded || activeActor !== "player" || actionsThisTurn === 0) return;
        const nextMoveCost = adjustedApCost(30);
        if (nextMoveCost > 0 && ap < nextMoveCost) {
            addCombatLog(`${character.name} has ${ap} AP left and cannot afford another move. Round ends automatically.`, "autoEnd", character.name);
            enemyTurn();
        }
    }, [ap, actionsThisTurn, activeActor, battleStarted, battleEnded]);

    useEffect(() => {
        if (!pendingAiProfile || battleStarted) return;
        const battleWeather = currentWeather;
        setOpponentCharacter(null);
        setAiLevel(pendingAiProfile.level);
        setEnemyHp(pendingAiProfile.hp);
        setBattleStarted(true);
        resetBattle(pendingAiProfile.hp);
        setLog(`Event battle started against ${pendingAiProfile.name}. Weather: ${weatherEffects[battleWeather].name}.`);
    }, [pendingAiProfile?.id, battleStarted]);

    useEffect(() => {
        if (!pendingPvpOpponent || battleStarted) return;
        const opponent = normalizeCharacter(pendingPvpOpponent);
        setPendingAiProfileId("");
        if (raidBattleKind === "none") setRaidBattleKind("raidPlayer");
        setOpponentCharacter(opponent);
        setEnemyHp(opponent.maxHp);
        setBattleStarted(true);
        resetBattle(opponent.maxHp);
        setLog(`PvP battle started against ${opponent.name}. Weather: ${weatherEffects[currentWeather].name}.`);
        setPendingPvpOpponent(null);
    }, [pendingPvpOpponent?.name, battleStarted]);

    function beginAiBattle() {
        const battleWeather = currentWeather;

        setPendingAiProfileId("");
        setOpponentCharacter(null);
        setEnemyHp(maxHpForLevel(aiLevel));
        setBattleStarted(true);
        resetBattle(maxHpForLevel(aiLevel));
        setLog(`Battle started against Level ${aiLevel} AI Ninja. Weather: ${weatherEffects[battleWeather].name}.`);
    }

    function challengePlayer(opponent: PlayerRecord) {
        if (duelChallenges.some((challenge) => challenge.fromName === character.name && challenge.toName === opponent.name)) {
            alert("Challenge already sent.");
            return;
        }
        setDuelChallenges([...duelChallenges, { id: makeId(), fromName: character.name, toName: opponent.name, challenger: character, createdAt: Date.now() }]);
        alert(`Challenge sent to ${opponent.name}.`);
    }

    function acceptChallenge(challenge: DuelChallenge) {
        setPendingAiProfileId("");
        setRaidBattleKind("raidPlayer");
        setOpponentCharacter(challenge.challenger);
        setDuelChallenges(duelChallenges.filter((candidate) => candidate.id !== challenge.id));
        setEnemyHp(challenge.challenger.maxHp);
        setBattleStarted(true);
        resetBattle(challenge.challenger.maxHp);
        setLog(`Duel accepted against ${challenge.fromName}.`);
    }

    function addCombatLog(entry: string, actionId = "system", actor = activeActor === "player" ? character.name : opponentName, actorRole: BattleActor = actor === opponentName ? "enemy" : "player") {
        setCombatLog((current) => [`Round ${turn}: ${entry}`, ...current].slice(0, 14));
        setBattleHistory((current) => [{ round: turn, actor, actorRole, actionId, description: entry, actionNumber: (current[0]?.actionNumber ?? 0) + 1, createdAt: Date.now() }, ...current].slice(0, 40));
    }

    function xy(pos: number) {
        return { x: pos % gridWidth, y: Math.floor(pos / gridWidth) };
    }

    function posFromXY(x: number, y: number) {
        if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return -1;
        return y * gridWidth + x;
    }

    function axial(pos: number) {
        const { x, y } = xy(pos);
        return { q: x, r: y - ((x - (x & 1)) / 2) };
    }

    function distance(a: number, b: number) {
        const A = axial(a);
        const B = axial(b);
        return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
    }

    function hexNeighbors(pos: number) {
        const { x, y } = xy(pos);
        const even = x % 2 === 0;
        const deltas = even
            ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
            : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        return deltas
            .map(([dx, dy]) => posFromXY(x + dx, y + dy))
            .filter((next) => next >= 0);
    }

    function jutsuRangeTiles(jutsu: Jutsu | null | undefined) {
        if (!jutsu || jutsu.target === "SELF") return new Set<number>();
        const range = isMoveJutsu(jutsu) ? moveJutsuRange(jutsu) : Math.max(0, Number(jutsu.range) || 0);
        if (range <= 0) return new Set<number>();
        return new Set(
            Array.from({ length: gridWidth * gridHeight }, (_, tile) => tile)
                .filter((tile) => tile !== playerPos && distance(playerPos, tile) <= range)
        );
    }

    function jutsuAoeTiles(jutsu: Jutsu | null | undefined) {
        if (!jutsu || jutsu.method !== "AOE_CIRCLE") return new Set<number>();
        if (!jutsuRangeTiles(jutsu).has(enemyPos)) return new Set<number>();
        return new Set([enemyPos, ...hexNeighbors(enemyPos)]);
    }

    function nextStepToward(origin: number, target: number) {
        const occupied = new Set([playerPos]);
        const candidates = hexNeighbors(origin).filter((next) => !occupied.has(next));
        return candidates.sort((a, b) => distance(a, target) - distance(b, target))[0] ?? origin;
    }

    function spendAp(cost: number, actionId = "action") {
        const adjustedCost = adjustedApCost(cost);
        if (activeActor !== "player") {
            setLog(`${opponentName} has initiative. End turn to resolve their action.`);
            addCombatLog(`${character.name} cannot act until ${opponentName}'s action resolves.`, actionId, character.name);
            return false;
        }
        if (actionsThisTurn >= 5) {
            setLog("Maximum actions reached. End your turn.");
            addCombatLog(`${character.name} has already taken 5 actions this turn.`, actionId, character.name);
            return false;
        }
        if (ap < adjustedCost) {
            setLog(`Not enough AP. Need ${adjustedCost}.`);
            addCombatLog(`${character.name} tried to act but did not have enough AP. Needed ${adjustedCost}.`, actionId, character.name);
            return false;
        }
        setAp((current) => current - adjustedCost);
        setActionsThisTurn((current) => current + 1);
        return true;
    }

    function waitTurn() {
        if (battleEnded) return;
        if (activeActor === "enemy") {
            enemyTurn();
            return;
        }
        addCombatLog(`${character.name} waits and ends their turn with ${ap} AP remaining.`, "wait", character.name);
        enemyTurn();
    }

    function reduceCooldowns() {
        setCooldowns((current) => {
            const next: Record<string, number> = {};
            Object.entries(current).forEach(([key, value]) => {
                next[key] = Math.max(0, value - 1);
            });
            return next;
        });

        setJutsuCooldowns((current) => {
            const next: Record<string, number> = {};
            Object.entries(current).forEach(([key, value]) => {
                next[key] = Math.max(0, value - 1);
            });
            return next;
        });
    }

    function tickStatuses(statuses: CombatStatus[]) {
        return statuses
            .map((s) => ({ ...s, rounds: s.rounds - 1 }))
            .filter((s) => s.rounds > 0);
    }

    function withoutStun(statuses: CombatStatus[]) {
        return statuses.filter((s) => s.name !== "Stun");
    }
    function isMoveJutsu(jutsu: Pick<Jutsu, "target" | "tags">) {
        return jutsu.tags.some((tag) => tag.name === "Move");
    }

    function isGroundEffectJutsu(jutsu: Pick<Jutsu, "target" | "tags">) {
        return jutsu.target === "EMPTY_GROUND" && !isMoveJutsu(jutsu);
    }

    function moveJutsuRange(jutsu: Pick<Jutsu, "range">) {
        return Math.max(1, Number(jutsu.range) || 1);
    }

    function handleTileClick(tile: number) {
        if (battleEnded) return;

        if (pendingTargetJutsu && isMoveJutsu(pendingTargetJutsu)) {
            if (tile === enemyPos) {
                setLog(`${pendingTargetJutsu.name}: choose an open tile, not the enemy.`);
                return;
            }

            if (tile === playerPos) {
                setLog(`${pendingTargetJutsu.name}: choose a different open tile.`);
                return;
            }

            const dist = distance(playerPos, tile);
            const moveRange = moveJutsuRange(pendingTargetJutsu);

            if (dist < 1 || dist > moveRange) {
                setLog(`${pendingTargetJutsu.name} can move up to ${moveRange} tile(s).`);
                return;
            }

            if ((jutsuCooldowns[pendingTargetJutsu.id] ?? 0) > 0) {
                setLog(`${pendingTargetJutsu.name} cooldown: ${jutsuCooldowns[pendingTargetJutsu.id]} rounds.`);
                return;
            }

            const mastery = getJutsuMastery(character, pendingTargetJutsu.id);
            const scaled = scaleJutsuByLevel(pendingTargetJutsu, mastery.level);

            if (playerStatuses.some((s) => s.name === "Elemental Seal") && pendingTargetJutsu.element) {
                setLog(`${pendingTargetJutsu.element} jutsu is sealed.`);
                return;
            }

            if (character.hp <= scaled.healthCost) {
                setLog("Not enough health.");
                return;
            }

            if (character.chakra < scaled.chakraCost) {
                setLog("Not enough chakra.");
                return;
            }

            if (character.stamina < scaled.staminaCost) {
                setLog("Not enough stamina.");
                return;
            }

            if (!spendAp(pendingTargetJutsu.ap, pendingTargetJutsu.id)) return;

            setPlayerPos(tile);
            setPendingTargetJutsuId("");
            setSelectedActionId(undefined);
            setDashMode(false);
            setJutsuCooldowns((c) => ({ ...c, [pendingTargetJutsu.id]: pendingTargetJutsu.cooldown }));

            updateCharacter({
                ...gainJutsuXp(character, pendingTargetJutsu.id, boostAmount(20, getActiveAuraSphereBonuses(character).jutsuXpPercent), JUTSU_MAX_LEVEL),
                hp: Math.max(0, character.hp - scaled.healthCost),
                chakra: Math.max(0, character.chakra - scaled.chakraCost),
                stamina: Math.max(0, character.stamina - scaled.staminaCost),
            });

            const flavorText =
                pendingTargetJutsu.battleDescription?.trim() ||
                pendingTargetJutsu.description?.trim() ||
                `${character.name} shifts across the battlefield.`;

            setLog(`${pendingTargetJutsu.name}: moved ${dist} tile(s).`);

            addCombatLog(
                `${pendingTargetJutsu.name}: ${flavorText} Move: ${character.name} relocates ${dist} tile(s) to an open tile.`,
                pendingTargetJutsu.id,
                character.name
            );

            return;
        }

        if (pendingTargetJutsu && isGroundEffectJutsu(pendingTargetJutsu)) {
            const range = Math.max(0, Number(pendingTargetJutsu.range) || 0);
            if (range > 0 && distance(playerPos, tile) > range) {
                setLog(`${pendingTargetJutsu.name} needs range ${range}.`);
                return;
            }
            const catchesEnemy = tile === enemyPos || (pendingTargetJutsu.method === "AOE_CIRCLE" && hexNeighbors(tile).includes(enemyPos));
            if (!catchesEnemy) {
                setLog(`${pendingTargetJutsu.name}: choose a ground tile that catches ${opponentName} in the impact area.`);
                return;
            }
            castJutsu(pendingTargetJutsu, true, tile);
            return;
        }

        if (pendingTargetJutsu && tile === enemyPos) {
            castJutsu(pendingTargetJutsu, true, tile);
            return;
        }

        if (pendingTargetJutsu && tile !== enemyPos) {
            setLog(`Choose ${opponentName} for ${pendingTargetJutsu.name}, or cancel the jutsu.`);
            return;
        }

        if (tile === enemyPos) {
            setLog("Select a jutsu first, then choose this target.");
            return;
        }

        const dist = distance(playerPos, tile);

        if (dashMode) {
            if ((cooldowns.dash ?? 0) > 0) {
                setDashMode(false);
                setSelectedActionId(undefined);
                setLog(`Dash cooldown: ${cooldowns.dash} rounds.`);
                return;
            }

            if (dist < 1 || dist > 3) {
                setLog("Dash can move up to 3 tiles.");
                return;
            }

            if (!spendAp(30, "dash")) return;

            setPlayerPos(tile);
            setDashMode(false);
            setSelectedActionId(undefined);
            setPendingTargetJutsuId("");
            setCooldowns((c) => ({ ...c, dash: 2 }));
            setLog(`Dashed ${dist} tile(s).`);
            addCombatLog(`${character.name} uses Dash, moving ${dist} tile(s). Dash is on cooldown for 2 rounds.`, "dash", character.name);
            return;
        }

        if (dist !== 1) {
            setLog("Normal movement is 1 tile at a time.");
            return;
        }

        if (!spendAp(30, "move")) return;

        setPlayerPos(tile);
        setSelectedActionId(undefined);
        setPendingTargetJutsuId("");
        setLog("Moved 1 tile for 30 AP.");
        addCombatLog(`${character.name} moves 1 tile for 30 AP.`, "move", character.name);
    }

    function basicAttack() {
        if (battleEnded) return;
        setPendingTargetJutsuId("");
        if (distance(playerPos, enemyPos) > 1) {
            setLog("Basic Attack must be adjacent.");
            return;
        }

        if (character.stamina < 10) return setLog("Basic Attack needs 10 stamina.");
        if (!spendAp(40, "basicAttack")) return;

        const basicAttackJutsu = makeJutsu("basic-attack", "Basic Attack", character.specialty, 40, 1, 10, 0, 0, 10, [{ name: "Damage", percent: 10 }], "Earth");
        let damage = Math.floor(calculateDamage(
            basicAttackJutsu,
            character.stats,
            enemyCombatStats,
            enemyMaxHp,
            getBloodlineMultiplier(character, savedBloodlines),
            enemyArmorFactor
        ) * weatherDamageMultiplier(basicAttackJutsu));
        if (!opponentCharacter && getActiveAuraSphereBonuses(character).pveDamagePercent > 0) {
            damage = boostAmount(damage, getActiveAuraSphereBonuses(character).pveDamagePercent);
        }
        const blocked = Math.min(enemyShield, damage);
        const finalDamage = Math.max(0, damage - blocked);

        setEnemyShield((s) => Math.max(0, s - blocked));
        setEnemyHp((hp) => Math.max(0, hp - finalDamage));

        addCombatLog(
            `Basic Attack: ${character.name} hits ${opponentName} for ${finalDamage} damage.${blocked ? ` Enemy shield blocks ${blocked}.` : ""
            }`,
            "basicAttack",
            character.name
        );

        if (enemyHp - finalDamage <= 0) return winBattle();

        updateCharacter({ ...character, stamina: Math.max(0, character.stamina - 10) });
        setLog(`Basic Attack hit for ${finalDamage} damage.`);
    }

    function combatItemInitials(name: string) {
        return name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join("") || "IT";
    }

    function itemBonusTotal(item: GameItem) {
        return Object.values(item.bonuses).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
    }

    function combatItemSummary(item: GameItem) {
        const lines = Object.entries(item.bonuses)
            .filter(([, value]) => Number(value) !== 0)
            .map(([stat, value]) => `${stat.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())} +${value}`);
        return lines.length ? lines.join(" | ") : "No combat bonus";
    }

    function useCombatWeapon(item: GameItem) {
        if (battleEnded) return;
        setPendingTargetJutsuId("");
        setSelectedActionId(undefined);
        setDashMode(false);

        const slot = normalizeEquipmentSlot(item.slot);
        const isThrown = slot === "thrown";
        const range = isThrown ? 4 : 1;
        const apCost = isThrown ? 45 : 40;
        const staminaCost = isThrown ? 8 : 10;

        if (distance(playerPos, enemyPos) > range) {
            setLog(`${item.name} needs range ${range}. Move closer or use a longer range option.`);
            return;
        }

        if (character.stamina < staminaCost) {
            setLog(`${item.name} needs ${staminaCost} stamina.`);
            return;
        }

        if (!spendAp(apCost, item.id)) return;

        const offense = character.stats.strength * 0.18 + character.stats.bukijutsuOffense * 0.1 + itemBonusTotal(item) * 0.18;
        const weaponJutsu = makeJutsu(`item-${item.id}`, item.name, "Bukijutsu", apCost, range, Math.floor(22 + offense), 0, 0, staminaCost, [{ name: "Damage", percent: 100 }], "Earth");
        let damage = calculateDamage(
            weaponJutsu,
            character.stats,
            enemyCombatStats,
            enemyMaxHp,
            getBloodlineMultiplier(character, savedBloodlines),
            enemyArmorFactor
        );
        if (!opponentCharacter && getActiveAuraSphereBonuses(character).pveDamagePercent > 0) {
            damage = boostAmount(damage, getActiveAuraSphereBonuses(character).pveDamagePercent);
        }

        const blocked = Math.min(enemyShield, damage);
        const finalDamage = Math.max(0, damage - blocked);

        setEnemyShield((shieldValue) => Math.max(0, shieldValue - blocked));
        setEnemyHp((hp) => Math.max(0, hp - finalDamage));
        updateCharacter({ ...character, stamina: Math.max(0, character.stamina - staminaCost) });
        addCombatLog(`${item.name}: ${character.name} uses equipped ${equipmentSlotLabel(item.slot).toLowerCase()} gear for ${finalDamage} damage.${blocked ? ` Enemy shield blocks ${blocked}.` : ""}`, item.id, character.name);

        if (enemyHp - finalDamage <= 0) return winBattle();

        setLog(`${item.name} hit for ${finalDamage} damage.`);
    }

    function useCombatItem(item: GameItem) {
        if (battleEnded) return;
        setPendingTargetJutsuId("");
        setSelectedActionId(undefined);
        setDashMode(false);

        const apCost = 35;
        if (!spendAp(apCost, item.id)) return;

        const maxHpBonus = Number(item.bonuses.maxHp) || 0;
        const maxChakraBonus = Number(item.bonuses.maxChakra) || 0;
        const maxStaminaBonus = Number(item.bonuses.maxStamina) || 0;
        const defensiveBonus = (Number(item.bonuses.taijutsuDefense) || 0) + (Number(item.bonuses.ninjutsuDefense) || 0) + (Number(item.bonuses.genjutsuDefense) || 0) + (Number(item.bonuses.bukijutsuDefense) || 0);
        const offensiveBonus = (Number(item.bonuses.strength) || 0) + (Number(item.bonuses.bukijutsuOffense) || 0) + (Number(item.bonuses.taijutsuOffense) || 0) + (Number(item.bonuses.ninjutsuOffense) || 0) + (Number(item.bonuses.genjutsuOffense) || 0);

        const heal = Math.max(maxHpBonus > 0 ? Math.floor(maxHpBonus * 0.35) : 0, item.armorQuality ? Math.floor(character.maxHp * 0.06) : 0);
        const chakraRestore = Math.max(0, Math.floor(maxChakraBonus * 0.35));
        const staminaRestore = Math.max(0, Math.floor(maxStaminaBonus * 0.35));
        const shield = Math.max(0, Math.floor(defensiveBonus * 0.55));
        const focus = Math.max(0, Math.floor(offensiveBonus * 0.25));

        setPlayerHp((hp) => Math.min(character.maxHp, hp + heal));
        setPlayerShield((current) => current + shield + focus);

        updateCharacter({
            ...character,
            hp: Math.min(character.maxHp, character.hp + heal),
            chakra: Math.min(character.maxChakra, character.chakra + chakraRestore),
            stamina: Math.min(character.maxStamina, character.stamina + staminaRestore),
        });

        const effects = [
            heal ? `restores ${heal} HP` : "",
            chakraRestore ? `restores ${chakraRestore} chakra` : "",
            staminaRestore ? `restores ${staminaRestore} stamina` : "",
            shield + focus ? `grants ${shield + focus} shield` : "",
        ].filter(Boolean);

        const summary = effects.length ? effects.join(", ") : "steadies your stance but has no active combat effect";
        setLog(`${item.name}: ${summary}.`);
        addCombatLog(`${item.name}: ${character.name} uses equipped item and ${summary}.`, item.id, character.name);
    }

    function useEquippedCombatItem(item: GameItem) {
        const slot = normalizeEquipmentSlot(item.slot);
        if (slot === "hand" || slot === "thrown") {
            useCombatWeapon(item);
            return;
        }
        useCombatItem(item);
    }

    function basicHeal() {
        setPendingTargetJutsuId("");
        if ((cooldowns.basicHeal ?? 0) > 0) return setLog(`Basic Heal cooldown: ${cooldowns.basicHeal} rounds.`);
        if (character.chakra < 10) return setLog("Basic Heal needs 10 chakra.");
        if (!spendAp(60, "basicHeal")) return;

        const healAmount = Math.max(1, Math.floor(character.maxHp * 0.1));
        setPlayerHp((hp) => Math.min(character.maxHp, hp + healAmount));
        setCooldowns((c) => ({ ...c, basicHeal: 5 }));
        updateCharacter({ ...character, chakra: Math.max(0, character.chakra - 10) });
        setLog(`Basic Heal restored ${healAmount} HP.`);
        addCombatLog(`${character.name} uses Basic Heal and restores ${healAmount} HP. Basic Heal cooldown: 5 rounds.`, "basicHeal", character.name);
    }

    function clearEnemyPositiveEffects() {
        setPendingTargetJutsuId("");
        if ((cooldowns.clear ?? 0) > 0) return setLog(`Clear cooldown: ${cooldowns.clear} rounds.`);
        if (!spendAp(60, "clear")) return;

        if (enemyStatuses.some((s) => s.name === "Clear Prevent")) {
            setLog("Clear was prevented.");
            addCombatLog(`${opponentName}'s Clear Prevent blocks the clear attempt.`, "clear", opponentName);
            return;
        }
        const removed = enemyStatuses.filter((s) => s.kind === "positive").map((s) => s.name);
        setEnemyStatuses((statuses) => statuses.filter((s) => s.kind !== "positive"));
        setCooldowns((c) => ({ ...c, clear: 10 }));
        setLog("Clear removed enemy positive effects.");
        addCombatLog(`Clear: removed enemy positive effects${removed.length ? `: ${removed.join(", ")}` : "."} Cooldown: 10 rounds.`, "clear", character.name);
    }

    function cleansePlayerNegativeEffects() {
        setPendingTargetJutsuId("");
        if ((cooldowns.cleanse ?? 0) > 0) return setLog(`Cleanse cooldown: ${cooldowns.cleanse} rounds.`);
        if (!spendAp(60, "cleanse")) return;

        if (playerStatuses.some((s) => s.name === "Cleanse Prevent")) {
            setLog("Cleanse was prevented.");
            addCombatLog(`${character.name}'s Cleanse Prevent blocks the cleanse attempt.`, "cleanse", character.name);
            return;
        }
        const removed = playerStatuses.filter((s) => s.kind === "negative").map((s) => s.name);
        setPlayerStatuses((statuses) => statuses.filter((s) => s.kind !== "negative"));
        setCooldowns((c) => ({ ...c, cleanse: 10 }));
        setLog("Cleanse removed your negative effects.");
        addCombatLog(`Cleanse: removed ${character.name}'s negative effects${removed.length ? `: ${removed.join(", ")}` : "."} Cooldown: 10 rounds.`, "cleanse", character.name);
    }

    function flee() {
        setPendingTargetJutsuId("");
        if (!spendAp(100, "flee")) return;

        const hpCost = Math.max(1, Math.floor(character.maxHp * 0.1));
        const escaped = Math.random() < 0.2;
        setPlayerHp((hp) => Math.max(0, hp - hpCost));

        if (escaped) {
            setBattleEnded(true);
            setBattleResult("fled");
            setRaidBattleKind("none");
            setLog("You escaped the fight.");
            addCombatLog(`${character.name} successfully fled the battle, losing ${hpCost} HP in the retreat.`, "flee", character.name);
        } else {
            setLog("Flee failed. 20% odds missed.");
            addCombatLog(`${character.name} tried to flee, lost ${hpCost} HP, but failed.`, "flee", character.name);
        }
    }

    function winBattle() {
        const activeTrait = getActivePetTrait(character);
        const xpGain = activeTrait === "Swift" ? 125 : 100;
        const ryoGain = activeTrait === "Lucky" ? 90 : 75;
        const honorSealGain = raidBattleKind === "defense" ? 20 : opponentCharacter ? 15 : raidBattleKind === "raidAi" ? 5 : 0;
        const auraDustGain = raidBattleKind === "defense" ? 8 : opponentCharacter ? 6 : raidBattleKind === "raidAi" ? 4 : 0;
        const leveled = gainXp({ ...character, hp: playerHp }, xpGain);
        updateCharacter({
            ...leveled,
            ryo: leveled.ryo + ryoGain,
            honorSeals: (leveled.honorSeals ?? 0) + honorSealGain,
            auraDust: (leveled.auraDust ?? 0) + auraDustGain,
            stamina: Math.min(leveled.maxStamina, leveled.stamina + 15),
            clanBattleContrib: (leveled.clanBattleContrib ?? 0) + 1,
            clanContribMonth: new Date().toISOString().slice(0, 7),
        });

        const bonusNote = activeTrait === "Swift" ? " (Swift +25% XP)" : activeTrait === "Lucky" ? " (Lucky +20% ryo)" : "";
        const honorNote = honorSealGain > 0 ? ` +${honorSealGain} Honor Seals.` : "";
        const auraDustNote = auraDustGain > 0 ? ` +${auraDustGain} Aura Dust.` : "";
        setBattleEnded(true);
        setBattleResult("win");
        setLog(`${opponentName} defeated. +${xpGain} XP, +${ryoGain} ryo, +15 stamina.${bonusNote}${honorNote}${auraDustNote}`);
        addCombatLog(`${opponentName} is defeated. ${character.name} gains ${xpGain} XP, ${ryoGain} ryo, 15 stamina${honorNote}${auraDustNote}${bonusNote}`);
        setRaidBattleKind("none");
    }
    function selectCombatJutsu(jutsu: Jutsu) {
        if (battleEnded) return;
        const cooldown = jutsuCooldowns[jutsu.id] ?? 0;
        if (cooldown > 0) {
            setPendingTargetJutsuId("");
            return setLog(`${jutsu.name} cooldown: ${cooldown} rounds.`);
        }

        const moveJutsu = isMoveJutsu(jutsu);
        const needsTarget = moveJutsu || jutsu.target !== "SELF";

        setSelectedActionId(undefined);
        setDashMode(false);

        if (needsTarget) {
            armPendingTargetJutsu(jutsu);

            if (moveJutsu) {
                setLog(`${jutsu.name} selected. Choose an open tile within ${moveJutsuRange(jutsu)} spaces.`);
            } else if (isGroundEffectJutsu(jutsu)) {
                setLog(`${jutsu.name} selected. Choose a ground tile within ${jutsu.range} spaces.`);
            } else {
                setLog(`${jutsu.name} selected. Click ${opponentName} on the battlefield.`);
            }

            return;
        }

        castJutsu(jutsu, true);
    }
    function castJutsu(jutsu: Jutsu, targetConfirmed = false, targetTile = enemyPos) {
        if (battleEnded) return;

        const moveJutsu = isMoveJutsu(jutsu);
        const needsTargetClick = moveJutsu || jutsu.target !== "SELF";

        // FIRST CLICK: only arm the jutsu. Do not spend AP or check costs yet.
        if (needsTargetClick && !targetConfirmed) {
            armPendingTargetJutsu(jutsu);
            setSelectedActionId(undefined);
            setDashMode(false);

            if (moveJutsu) {
                setLog(`${jutsu.name} selected. Choose an open tile within ${moveJutsuRange(jutsu)} spaces.`);
            } else if (isGroundEffectJutsu(jutsu)) {
                setLog(`${jutsu.name} selected. Choose a ground tile within ${jutsu.range} spaces.`);
            } else {
                setLog(`${jutsu.name} selected. Click ${opponentName} on the battlefield.`);
            }

            return;
        }

        // SECOND CLICK / SELF JUTSU: now actually validate and use it.
        if ((jutsuCooldowns[jutsu.id] ?? 0) > 0) {
            return setLog(`${jutsu.name} cooldown: ${jutsuCooldowns[jutsu.id]} rounds.`);
        }

        const mastery = getJutsuMastery(character, jutsu.id);
        const scaled = scaleJutsuByLevel(jutsu, mastery.level);

        if (playerStatuses.some((s) => s.name === "Elemental Seal") && jutsu.element) {
            return setLog(`${jutsu.element} jutsu is sealed.`);
        }

        if (character.hp <= scaled.healthCost) return setLog("Not enough health.");
        if (character.chakra < scaled.chakraCost) return setLog("Not enough chakra.");
        if (character.stamina < scaled.staminaCost) return setLog("Not enough stamina.");

        const effectiveTargetTile = isGroundEffectJutsu(jutsu) ? targetTile : enemyPos;
        if (!moveJutsu && jutsu.target !== "SELF" && jutsu.range > 0 && distance(playerPos, effectiveTargetTile) > jutsu.range) {
            return setLog(`${jutsu.name} needs range ${jutsu.range}. Move closer or use a longer range jutsu.`);
        }

        if (!spendAp(jutsu.ap, jutsu.id)) return;
        setPendingTargetJutsuId("");

        let damage = calculateDamage(
            { ...jutsu, effectPower: scaled.scaledEffectPower },
            character.stats,
            enemyCombatStats,
            enemyMaxHp,
            getBloodlineMultiplier(character, savedBloodlines),
            enemyArmorFactor
        );
        const weatherMultiplier = weatherDamageMultiplier(jutsu);
        if (weatherMultiplier !== 1) {
            damage = Math.floor(damage * weatherMultiplier);
        }
        if (!opponentCharacter && getActiveAuraSphereBonuses(character).pveDamagePercent > 0) {
            damage = boostAmount(damage, getActiveAuraSphereBonuses(character).pveDamagePercent);
        }

        let healing = 0;
        let shield = 0;
        let pierce = false;
        const effectLines: string[] = [];
        const instantDamageGivenTags: JutsuTag[] = [];
        const postDamageTags: JutsuTag[] = [];
        const activeDamageTakenTags = enemyStatuses.filter((s) => s.name === "Increase Damage Taken");
        const activeDamageGivenDebuffs = playerStatuses.filter((s) => s.name === "Decrease Damage Given");
        const activeDamageTakenReductions = enemyStatuses.filter((s) => s.name === "Decrease Damage Taken");
        const healMultiplier = multiplicativeTagMultiplier(playerStatuses.filter((s) => s.name === "Increase Heal"), "increase");
        const enemyDebuffPrevented = enemyStatuses.some((s) => s.name === "Debuff Prevent");
        const playerBuffPrevented = playerStatuses.some((s) => s.name === "Buff Prevent");

        jutsu.tags.forEach((tag) => {
            const pct = effectiveTagPercent(tag, jutsu.bloodlineRank);

            if (tag.name === "Increase Damage Given") {
                instantDamageGivenTags.push({ ...tag, percent: pct });
                effectLines.push(`Increase Damage Given: ${character.name}'s next strike is boosted by ${pct}%.`);
            }

            if (tag.name === "Increase Damage Taken") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists damage taken debuff`);
                else {
                    setEnemyStatuses((s) => [...s, { name: "Increase Damage Taken", rounds: 2, percent: pct, kind: "negative" }]);
                    effectLines.push(`Increase Damage Taken: ${opponentName} takes ${pct}% more damage for 2 rounds.`);
                }
            }

            if (tag.name === "Decrease Damage Taken") {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s damage taken buff was prevented`);
                else {
                    setPlayerStatuses((s) => [...s, { name: "Decrease Damage Taken", rounds: 2, percent: pct, kind: "positive" }]);
                    effectLines.push(`Decrease Damage Taken: ${character.name} takes ${pct}% less damage for 2 rounds.`);
                }
            }

            if (tag.name === "Decrease Damage Given") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists damage given debuff`);
                else {
                    setEnemyStatuses((s) => [...s, { name: "Decrease Damage Given", rounds: 2, percent: pct, kind: "negative" }]);
                    effectLines.push(`Decrease Damage Given: ${opponentName} deals ${pct}% less damage for 2 rounds.`);
                }
            }

            if (["Afterburn", "Wound", "Recoil", "Lifesteal", "Vamp"].includes(tag.name)) {
                postDamageTags.push(tag);
            }

            if (tag.name === "Heal") {
                healing += Math.floor(scaled.scaledEffectPower * healMultiplier);
                damage = 0;
                effectLines.push(`Heal: ${character.name} restores ${Math.floor(scaled.scaledEffectPower * healMultiplier)} HP.`);
            }

            if (tag.name === "Shield" || tag.name === "Barrier") {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s shield was prevented`);
                else shield += scaled.scaledEffectPower;
                damage = 0;
                if (!playerBuffPrevented) effectLines.push(`${tag.name}: ${character.name} gains ${scaled.scaledEffectPower} shield.`);
            }

            if (tag.name === "Absorb") {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s absorb was prevented`);
                else {
                    setPlayerStatuses((s) => [...s, { name: "Absorb", rounds: 2, percent: pct, kind: "positive" }]);
                    effectLines.push(`Absorb: ${character.name} converts ${pct}% incoming damage into healing for 2 rounds.`);
                }
            }

            if (tag.name === "Reflect") {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s reflect was prevented`);
                else {
                    setPlayerStatuses((s) => [...s, { name: "Reflect", rounds: 2, percent: pct, kind: "positive" }]);
                    effectLines.push(`${character.name} reflects ${pct}% damage for 2 rounds`);
                }
            }

            if (tag.name === "Mirror") {
                const mirrored = playerStatuses.filter((s) => s.kind === "negative" && !["Wound", "Afterburn"].includes(s.name));
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists mirrored debuffs`);
                else if (mirrored.length) {
                    setEnemyStatuses((s) => [...s, ...mirrored.map((m) => ({ ...m, rounds: Math.min(2, m.rounds) }))]);
                    effectLines.push(`mirrored ${mirrored.length} negative effect(s) to ${opponentName}`);
                } else effectLines.push("no negative effects to mirror");
            }

            if (tag.name === "Copy") {
                const copied = enemyStatuses.filter((s) => s.kind === "positive");
                if (playerBuffPrevented) effectLines.push(`${character.name}'s copy was prevented`);
                else if (copied.length) {
                    setPlayerStatuses((s) => [...s, ...copied.map((c) => ({ ...c, rounds: Math.min(2, c.rounds) }))]);
                    effectLines.push(`copied ${copied.length} positive effect(s)`);
                } else effectLines.push("no positive effects to copy");
            }

            if (tag.name === "Pierce") {
                pierce = true;
                effectLines.push(`${jutsu.name} pierces shields`);
            }

            if (tag.name === "Stun") {
                if (enemyStatuses.some((s) => s.name === "Stun Prevent")) effectLines.push(`${opponentName} resisted stun`);
                else if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists stun`);
                else {
                    setEnemyStatuses((s) => [...s, { name: "Stun", rounds: 1, kind: "negative" }]);
                    effectLines.push(`Stun: ${opponentName} loses ${STUN_AP_PENALTY} AP on their next turn.`);
                }
            }

            if (tag.name === "Seal") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists seal`);
                else {
                    setEnemyStatuses((s) => [...s, { name: "Seal", rounds: 2, kind: "negative" }]);
                    effectLines.push(`${opponentName} is sealed for 2 rounds`);
                }
            }

            if (tag.name === "Poison") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists poison`);
                else {
                    setEnemyStatuses((s) => [...s, { name: "Poison", rounds: 3, percent: pct, kind: "negative" }]);
                    effectLines.push(`${opponentName} takes poison from future chakra/stamina use`);
                }
            }

            if (tag.name === "Drain") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists drain`);
                else {
                    const drain = Math.max(1, Math.floor((enemyMaxHp + enemyMaxChakra + enemyMaxStamina) * 0.005));
                    setEnemyStatuses((s) => [...s, { name: "Drain", rounds: 3, amount: drain, kind: "negative" }]);
                    effectLines.push(`${opponentName} is drained for ${drain} each round`);
                }
            }

            if (["Buff Prevent", "Clear Prevent", "Cleanse Prevent", "Stun Prevent", "Time Dilation", "Increase Heal"].includes(tag.name)) {
                setPlayerStatuses((s) => [...s, { name: tag.name, rounds: 2, percent: pct, kind: "positive" }]);
                effectLines.push(`${character.name} gains ${tag.name} for 2 rounds`);
            }

            if (["Debuff Prevent", "Elemental Seal", "Time Compression"].includes(tag.name)) {
                setEnemyStatuses((s) => [...s, { name: tag.name, rounds: 2, percent: pct, kind: "negative" }]);
                effectLines.push(`${opponentName} suffers ${tag.name} for 2 rounds`);
            }

            if (tag.name === "Move") {
                const next = Math.max(0, Math.min(gridWidth * gridHeight - 1, playerPos + (playerPos > enemyPos ? 1 : -1)));
                if (next !== enemyPos) setPlayerPos(next);
                effectLines.push(`${character.name} shifts position`);
            }

            if (tag.name === "Push/Pull") {
                const next = Math.max(0, Math.min(gridWidth * gridHeight - 1, enemyPos + (enemyPos > playerPos ? 1 : -1)));
                if (next !== playerPos) setEnemyPos(next);
                effectLines.push(`${opponentName} is pushed across the field`);
            }
        });

        const damageMultiplier =
            multiplicativeTagMultiplier(instantDamageGivenTags, "increase") *
            multiplicativeTagMultiplier(activeDamageTakenTags, "increase") *
            multiplicativeTagMultiplier(activeDamageGivenDebuffs, "decrease") *
            multiplicativeTagMultiplier(activeDamageTakenReductions, "decrease");

        damage = Math.floor(damage * damageMultiplier);

        const blocked = pierce ? 0 : Math.min(enemyShield, damage);
        const finalDamage = Math.max(0, damage - blocked);
        let extraEnemyDamage = 0;
        let recoilDamage = 0;

        postDamageTags.forEach((tag) => {
            const pct = effectiveTagPercent(tag, jutsu.bloodlineRank);
            if (tag.name === "Afterburn") {
                const burn = cappedPostDamage(finalDamage, pct);
                extraEnemyDamage += burn;
                effectLines.push(`Afterburn: ${opponentName} takes ${burn} burn damage.`);
            }
            if (tag.name === "Wound" && !enemyDebuffPrevented) {
                const wound = cappedPostDamage(finalDamage, pct);
                setEnemyStatuses((s) => [...s, { name: "Wound", rounds: 3, amount: wound, kind: "negative" }]);
                effectLines.push(`Wound: ${opponentName} bleeds for ${wound} damage on their turns.`);
            }
            if (tag.name === "Recoil") {
                recoilDamage += cappedPostDamage(finalDamage, pct);
            }
            if (tag.name === "Lifesteal" || tag.name === "Vamp") {
                const restored = Math.floor(cappedPostDamage(finalDamage, pct) * healMultiplier);
                healing += restored;
                effectLines.push(`${tag.name} restores ${restored} HP`);
            }
        });

        setEnemyShield((s) => pierce ? s : Math.max(0, s - blocked));
        setEnemyHp((hp) => Math.max(0, hp - finalDamage - extraEnemyDamage));
        setPlayerHp((hp) => Math.max(0, Math.min(character.maxHp, hp + healing - recoilDamage)));
        setPlayerShield((s) => s + shield);

        setJutsuCooldowns((c) => ({ ...c, [jutsu.id]: jutsu.cooldown }));

        updateCharacter({
            ...gainJutsuXp(character, jutsu.id, boostAmount(20, getActiveAuraSphereBonuses(character).jutsuXpPercent), JUTSU_MAX_LEVEL),
            hp: Math.max(0, character.hp - scaled.healthCost),
            chakra: Math.max(0, character.chakra - scaled.chakraCost),
            stamina: Math.max(0, character.stamina - scaled.staminaCost),
        });

        const flavorText =
            jutsu.battleDescription?.trim() ||
            jutsu.description?.trim() ||
            `${character.name} unleashes ${jutsu.name}.`;

        const totalDamage = finalDamage + extraEnemyDamage;

        const timelineParts = [
            `${jutsu.name}: ${flavorText}`,
            totalDamage > 0 ? `Damage Dealt: ${opponentName} takes ${totalDamage} damage.` : "",
            blocked > 0 ? `Shield: ${opponentName}'s shield blocks ${blocked} damage.` : "",
            healing > 0 ? `Heal: ${character.name} restores ${healing} HP.` : "",
            shield > 0 ? `Shield: ${character.name} gains ${shield} shield.` : "",
            recoilDamage > 0 ? `Recoil: ${character.name} takes ${recoilDamage} recoil damage.` : "",
            effectLines.length ? `Tags: ${effectLines.join(" ")}` : "",
        ].filter(Boolean).join(" ");

        addCombatLog(
            timelineParts,
            jutsu.id,
            character.name
        );

        if (enemyHp - finalDamage - extraEnemyDamage <= 0) return winBattle();

        setLog(`${jutsu.name} used on ${opponentName}. ${finalDamage + extraEnemyDamage} damage. ${healing ? `Healed ${healing}.` : ""}`);
    }

    function aiRuleMatches(rule: AiRule) {
        const dist = distance(playerPos, enemyPos);
        if (rule.condition === "always") return true;
        if (rule.condition === "specific_round") return turn === rule.value;
        if (rule.condition === "distance_lower_than") return dist < rule.value;
        if (rule.condition === "distance_higher_than") return dist > rule.value;
        if (rule.condition === "hp_lower_than") return (enemyHp / enemyMaxHp) * 100 < rule.value;
        return false;
    }

    function highestPowerAiJutsu(availableAp = 100) {
        return [...enemyAiJutsus]
            .filter((jutsu) => jutsu.ap <= availableAp)
            .filter((jutsu) => jutsu.target === "SELF" || jutsu.range <= 0 || distance(playerPos, enemyPos) <= jutsu.range)
            .sort((a, b) => b.effectPower - a.effectPower || b.ap - a.ap)[0];
    }

    function enemyUseAiJutsu(jutsu: Jutsu, availableAp = 100) {
        if (jutsu.ap > availableAp) return false;
        if (jutsu.target !== "SELF" && jutsu.range > 0 && distance(playerPos, enemyPos) > jutsu.range) return false;

        const damageBase = jutsu.tags.some((tag) => ["Heal", "Shield", "Barrier"].includes(tag.name))
            ? 0
            : calculateDamage(
                jutsu,
                enemyCombatStats,
                character.stats,
                character.maxHp,
                opponentCharacter ? getBloodlineMultiplier(opponentCharacter, savedBloodlines) : 1.0,
                playerArmorFactor
            );
        const damage = Math.floor(damageBase * weatherDamageMultiplier(jutsu));
        let healing = 0;
        let shield = 0;
        let extraDamage = 0;
        const effectLines: string[] = [];
        const playerDebuffPrevented = playerStatuses.some((s) => s.name === "Debuff Prevent");
        const enemyBuffPrevented = enemyStatuses.some((s) => s.name === "Buff Prevent");

        jutsu.tags.forEach((tag) => {
            const pct = effectiveTagPercent(tag, jutsu.bloodlineRank);
            if (tag.name === "Heal") {
                healing += Math.max(1, Math.floor(jutsu.effectPower));
                effectLines.push(`${opponentName} heals ${Math.floor(jutsu.effectPower)} HP`);
            }
            if (tag.name === "Shield" || tag.name === "Barrier") {
                shield += Math.max(1, Math.floor(jutsu.effectPower));
                effectLines.push(`${opponentName} gains ${Math.floor(jutsu.effectPower)} shield`);
            }
            if (tag.name === "Afterburn" || tag.name === "Wound") {
                const dot = cappedPostDamage(damage, pct);
                extraDamage += dot;
                effectLines.push(`${character.name} takes ${dot} ${tag.name.toLowerCase()} damage`);
            }
            if (tag.name === "Stun") {
                if (playerStatuses.some((s) => s.name === "Stun Prevent")) effectLines.push(`${character.name} resisted stun`);
                else if (playerDebuffPrevented) effectLines.push(`${character.name} prevents stun`);
                else {
                    pendingPlayerStunApPenaltyRef.current = true;
                    setPlayerStatuses((s) => [...s, { name: "Stun", rounds: 1, kind: "negative" }]);
                    effectLines.push(`Stun: ${character.name} loses ${STUN_AP_PENALTY} AP on their next turn`);
                }
            }
            if (tag.name === "Seal") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents seal`);
                else {
                    setPlayerStatuses((s) => [...s, { name: "Seal", rounds: 2, kind: "negative" }]);
                    effectLines.push(`${character.name} is sealed for 2 rounds`);
                }
            }
            if (tag.name === "Elemental Seal") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents elemental seal`);
                else {
                    setPlayerStatuses((s) => [...s, { name: "Elemental Seal", rounds: 2, kind: "negative" }]);
                    effectLines.push(`${character.name}'s elemental jutsu are sealed for 2 rounds`);
                }
            }
            if (tag.name === "Decrease Damage Given") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents damage given debuff`);
                else {
                    setPlayerStatuses((s) => [...s, { name: "Decrease Damage Given", rounds: 2, percent: pct, kind: "negative" }]);
                    effectLines.push(`${character.name}'s damage given is decreased by ${pct}%`);
                }
            }
            if (tag.name === "Increase Damage Taken") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents damage taken debuff`);
                else {
                    setPlayerStatuses((s) => [...s, { name: "Increase Damage Taken", rounds: 2, percent: pct, kind: "negative" }]);
                    effectLines.push(`${character.name}'s damage taken is increased by ${pct}%`);
                }
            }
            if (tag.name === "Copy") {
                const copied = playerStatuses.filter((s) => s.kind === "positive");
                if (enemyBuffPrevented) effectLines.push(`${opponentName}'s copy was prevented`);
                else if (copied.length) {
                    setEnemyStatuses((s) => [...s, ...copied.map((status) => ({ ...status, rounds: Math.min(2, status.rounds) }))]);
                    effectLines.push(`${opponentName} copies ${copied.length} positive effect(s)`);
                } else effectLines.push("no positive effects to copy");
            }
            if (tag.name === "Mirror") {
                const mirrored = enemyStatuses.filter((s) => s.kind === "negative" && !["Wound", "Afterburn"].includes(s.name));
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents mirrored debuffs`);
                else if (mirrored.length) {
                    setPlayerStatuses((s) => [...s, ...mirrored.map((status) => ({ ...status, rounds: Math.min(2, status.rounds) }))]);
                    effectLines.push(`${opponentName} mirrors ${mirrored.length} negative effect(s)`);
                } else effectLines.push("no negative effects to mirror");
            }
            if (["Buff Prevent", "Clear Prevent", "Cleanse Prevent", "Stun Prevent", "Time Dilation", "Increase Heal"].includes(tag.name)) {
                if (enemyBuffPrevented) effectLines.push(`${opponentName}'s ${tag.name} was prevented`);
                else {
                    setEnemyStatuses((s) => [...s, { name: tag.name, rounds: 2, percent: pct, kind: "positive" }]);
                    effectLines.push(`${opponentName} gains ${tag.name} for 2 rounds`);
                }
            }
            if (["Debuff Prevent", "Time Compression"].includes(tag.name)) {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents ${tag.name}`);
                else {
                    setPlayerStatuses((s) => [...s, { name: tag.name, rounds: 2, percent: pct, kind: "negative" }]);
                    effectLines.push(`${character.name} suffers ${tag.name} for 2 rounds`);
                }
            }
        });

        const blocked = Math.min(playerShield, damage);
        const finalDamage = Math.max(0, damage - blocked);
        setPlayerShield((s) => Math.max(0, s - blocked));
        setPlayerHp((hp) => Math.max(0, hp - finalDamage - extraDamage));
        setEnemyHp((hp) => Math.min(enemyMaxHp, hp + healing));
        setEnemyShield((s) => s + shield);
        updateCharacter({ ...character, hp: Math.max(0, playerHp - finalDamage - extraDamage) });
        const enemyFlavorText =
            jutsu.battleDescription?.trim() ||
            jutsu.description?.trim() ||
            `${opponentName} uses ${jutsu.name}.`;

        const enemyTimelineParts = [
            `${jutsu.name}: ${enemyFlavorText}`,
            finalDamage + extraDamage > 0 ? `Damage Dealt: ${character.name} takes ${finalDamage + extraDamage} damage.` : "",
            blocked > 0 ? `Shield: ${character.name}'s shield blocks ${blocked} damage.` : "",
            healing > 0 ? `Heal: ${opponentName} restores ${healing} HP.` : "",
            shield > 0 ? `Shield: ${opponentName} gains ${shield} shield.` : "",
            effectLines.length ? `Tags: ${effectLines.join(" ")}` : "",
        ].filter(Boolean).join(" ");

        addCombatLog(enemyTimelineParts, jutsu.id, opponentName);
        setLog(`${opponentName} used ${jutsu.name}.`);

        if (playerHp - finalDamage - extraDamage <= 0) {
            setBattleEnded(true);
            setBattleResult("loss");
            setRaidBattleKind("none");
            setLog(`${character.name} was defeated.`);
            addCombatLog(`${opponentName} defeats ${character.name}.`, "defeat", opponentName);
            updateCharacter({ ...character, hp: 0, hospitalized: true });
        }
        return true;
    }

    function finishEnemyAiAction() {
        setEnemyStatuses((s) => tickStatuses(s));
        const playerStunned = pendingPlayerStunApPenaltyRef.current || playerStatuses.some((s) => s.name === "Stun");
        pendingPlayerStunApPenaltyRef.current = false;
        setPlayerStatuses((s) => tickStatuses(withoutStun(s)));
        reduceCooldowns();
        setAp(playerStunned ? Math.max(0, 100 - STUN_AP_PENALTY) : 100);
        setEnemyAp(100);
        setActiveActor("player");
        setActionsThisTurn(0);
        setTurn((t) => t + 1);
        if (playerStunned) {
            addCombatLog(`Stun: ${character.name} starts their turn with ${STUN_AP_PENALTY} less AP.`, "stun", character.name);
        }
    }

    function enemyTurn() {
        if (battleEnded) return;
        setActiveActor("enemy");
        setActionsThisTurn(0);
        const enemyStunned = enemyStatuses.some((s) => s.name === "Stun");
        const enemyCompressed = enemyStatuses.some((s) => s.name === "Time Compression");
        const enemyTurnAp = Math.max(0, 100 - (enemyStunned ? STUN_AP_PENALTY : 0) - (enemyCompressed ? 10 : 0));
        setEnemyAp(enemyTurnAp);
        if (enemyStunned) {
            setEnemyStatuses((s) => withoutStun(s));
            setLog(`Stun: ${opponentName} loses ${STUN_AP_PENALTY} AP this turn.`);
            addCombatLog(`Stun: ${opponentName} starts their turn with ${STUN_AP_PENALTY} less AP.`, "stun", opponentName);
        }
        if (enemyCompressed) {
            addCombatLog(`Time Compression: ${opponentName}'s actions cost 10 more AP this turn.`, "timeCompression", opponentName);
        }

        let dotDamage = 0;
        enemyStatuses.filter((s) => s.name !== "Stun").forEach((s) => {
            if (["Wound", "Drain"].includes(s.name)) dotDamage += s.amount || 0;
            if (s.name === "Poison") dotDamage += Math.floor((enemyMaxChakra * 0.01 + enemyMaxStamina * 0.01) * ((s.percent || 30) / 100));
        });

        if (dotDamage > 0) {
            setEnemyHp((hp) => Math.max(0, hp - dotDamage));
            addCombatLog(`Damage over time: ${opponentName} takes ${dotDamage} damage from active effects.`, "effects", opponentName);
        }

        if (enemyHp - dotDamage <= 0) return winBattle();

        if (pendingAiProfile) {
            const matchedRules = pendingAiProfile.rules.filter(aiRuleMatches);

            for (const rule of matchedRules) {
                const specificJutsu = rule.jutsuId ? enemyAiJutsus.find((jutsu) => jutsu.id === rule.jutsuId) : undefined;
                const chosenJutsu = rule.action === "use_specific_jutsu" ? specificJutsu : rule.action === "use_highest_power_jutsu" ? highestPowerAiJutsu(enemyTurnAp) : undefined;

                if (chosenJutsu && enemyUseAiJutsu(chosenJutsu, enemyTurnAp)) {
                    addCombatLog(`${opponentName} follows AI Rule ${pendingAiProfile.rules.indexOf(rule) + 1}.`, "aiRule", opponentName);
                    finishEnemyAiAction();
                    return;
                }

                if (rule.action === "move_towards_opponent" && distance(playerPos, enemyPos) > 1) {
                    const next = nextStepToward(enemyPos, playerPos);
                    if (next >= 0 && next < gridWidth * gridHeight && next !== playerPos) setEnemyPos(next);
                    setLog(`${opponentName} follows its AI rule and moves closer.`);
                    addCombatLog(`${opponentName} follows AI Rule ${pendingAiProfile.rules.indexOf(rule) + 1} and moves toward ${character.name}.`, "move", opponentName);
                    finishEnemyAiAction();
                    return;
                }

                if (rule.action === "use_basic_attack" && distance(playerPos, enemyPos) <= 1) {
                    break;
                }
            }
        }

        if (opponentCharacter && enemyAiJutsus.length > 0) {
            const chosenJutsu = highestPowerAiJutsu(enemyTurnAp);
            if (chosenJutsu && enemyUseAiJutsu(chosenJutsu, enemyTurnAp)) {
                addCombatLog(`${opponentName} uses an equipped player jutsu.`, chosenJutsu.id, opponentName);
                finishEnemyAiAction();
                return;
            }

            if (distance(playerPos, enemyPos) > 1) {
                const next = nextStepToward(enemyPos, playerPos);
                if (next >= 0 && next < gridWidth * gridHeight && next !== playerPos) setEnemyPos(next);
                setLog(`${opponentName} moves closer.`);
                addCombatLog(`${opponentName} moves toward ${character.name}.`, "move", opponentName);
                finishEnemyAiAction();
                return;
            }
        }

        const enemyBasicJutsu = makeJutsu("enemy-basic-strike", "Enemy Strike", "Taijutsu", 40, 1, 100, 0, 0, 0, [], "Earth");
        let enemyDamage = calculateDamage(
            enemyBasicJutsu,
            enemyCombatStats,
            character.stats,
            character.maxHp,
            opponentCharacter ? getBloodlineMultiplier(opponentCharacter, savedBloodlines) : 1.0,
            playerArmorFactor
        );

        enemyDamage = Math.floor(
            enemyDamage *
            weatherDamageMultiplier(enemyBasicJutsu) *
            multiplicativeTagMultiplier(enemyStatuses.filter((s) => s.name === "Decrease Damage Given"), "decrease") *
            multiplicativeTagMultiplier(playerStatuses.filter((s) => s.name === "Decrease Damage Taken"), "decrease") *
            multiplicativeTagMultiplier(playerStatuses.filter((s) => s.name === "Increase Damage Taken"), "increase") *
            (enemyStatuses.some((s) => s.name === "Seal" || s.name === "Elemental Seal") ? 0.85 : 1)
        );

        const reflect = playerStatuses.find((s) => s.name === "Reflect");
        if (reflect) {
            const reflected = cappedPostDamage(enemyDamage, reflect.percent || 30);
            setEnemyHp((hp) => Math.max(0, hp - reflected));
            addCombatLog(`Reflect: ${opponentName} takes ${reflected} reflected damage.`, "reflect", character.name);
        }

        setEnemyAp(0);

        if (distance(playerPos, enemyPos) > 1) {
            const next = nextStepToward(enemyPos, playerPos);

            if (next >= 0 && next < gridWidth * gridHeight && next !== playerPos) setEnemyPos(next);
            setLog("Enemy moved closer across the grid.");
            addCombatLog(`${opponentName} moves closer across the battlefield.`, "move", opponentName);
        } else {
            const blocked = Math.min(playerShield, enemyDamage);
            const finalDamage = enemyDamage - blocked;
            const absorb = playerStatuses.find((s) => s.name === "Absorb");
            const absorbed = absorb ? cappedPostDamage(finalDamage, absorb.percent || 30) : 0;

            setPlayerShield((s) => Math.max(0, s - blocked));
            setPlayerHp((hp) => Math.max(0, Math.min(character.maxHp, hp - finalDamage + absorbed)));

            updateCharacter({
                ...character,
                hp: Math.max(0, Math.min(character.maxHp, playerHp - finalDamage + absorbed)),
            });

            if (playerHp - finalDamage + absorbed <= 0) {
                setBattleEnded(true);
                setBattleResult("loss");
                setRaidBattleKind("none");
                setLog(`${character.name} was defeated.`);
                addCombatLog(`${opponentName} defeats ${character.name}.`, "defeat", opponentName);
                return;
            }

            setLog(`Enemy attacked for ${finalDamage}.`);
            addCombatLog(`${opponentName} attacks ${character.name} for ${finalDamage} damage.${blocked ? ` Shield blocks ${blocked}.` : ""}${absorbed ? ` Absorb restores ${absorbed}.` : ""}`, "basicAttack", opponentName);
        }

        setEnemyStatuses((s) => tickStatuses(s));
        setPlayerStatuses((s) => tickStatuses(s));
        reduceCooldowns();
        setAp(100);
        setEnemyAp(100);
        setActiveActor("player");
        setActionsThisTurn(0);
        setTurn((t) => t + 1);
    }

    function resetBattle(nextEnemyHp = enemyMaxHp) {
        setPlayerPos(62);
        setEnemyPos(33);
        setPlayerHp(character.hp);
        setEnemyHp(nextEnemyHp);
        setPlayerShield(0);
        setEnemyShield(0);
        setAp(100);
        setEnemyAp(100);
        setTurn(1);
        setPlayerStatuses([]);
        setEnemyStatuses([]);
        setCooldowns({});
        setJutsuCooldowns({});
        setBattleEnded(false);
        setBattleResult(null);
        setDashMode(false);
        setSelectedActionId(undefined);
        const initiative = rollInitiative();
        setActiveActor(initiative);
        setActionsThisTurn(0);
        setLog(initiative === "player" ? "Battle reset. You have initiative." : `Battle reset. ${opponentName} has initiative.`);
        setCombatLog([]);
        setBattleHistory([]);
    }

    if (!battleStarted) {
        return (
            <div className="card arena-lobby">
                <h2>Battle Arena</h2>
                <p>Choose an AI opponent or challenge another player before combat begins.</p>

                <section className="summary-box">
                    <h3>Fight AI</h3>
                    <label>AI Level</label>
                    <input type="number" min={1} max={MAX_LEVEL} value={aiLevel} onChange={(e) => setAiLevel(Math.max(1, Math.min(MAX_LEVEL, Number(e.target.value))))} />
                    <button onClick={beginAiBattle}>Start AI Battle</button>
                </section>

                <section className="summary-box">
                    <h3>Challenge Player</h3>
                    <label>Search Player Name</label>
                    <input value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)} placeholder="Search by player name" />
                    <div className="jutsu-list">
                        {searchablePlayers.length === 0 ? <p className="hint">No matching players yet. Log in or create another player to add them to the roster.</p> : searchablePlayers.map((player) => (
                            <div className="summary-box" key={player.name}>
                                <strong>{player.name}</strong>
                                <p>Level {player.level} | {player.village} | {player.specialty}</p>
                                <button onClick={() => challengePlayer(player)}>Challenge</button>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="summary-box">
                    <h3>Incoming Challenges</h3>
                    {incomingChallenges.length === 0 ? <p className="hint">No incoming duel challenges.</p> : incomingChallenges.map((challenge) => (
                        <div className="summary-box" key={challenge.id}>
                            <strong>{challenge.fromName}</strong>
                            <p>challenged {challenge.toName}</p>
                            <div className="menu">
                                <button onClick={() => acceptChallenge(challenge)}>Accept Duel</button>
                                <button className="danger-button" onClick={() => setDuelChallenges(duelChallenges.filter((candidate) => candidate.id !== challenge.id))}>Decline</button>
                            </div>
                        </div>
                    ))}
                </section>
            </div>
        );
    }

    const timelineRounds = battleHistory.reduce<{ round: number; entries: BattleActionEntry[] }[]>((groups, entry) => {
        const group = groups.find((candidate) => candidate.round === entry.round);
        if (group) group.entries.push(entry);
        else groups.push({ round: entry.round, entries: [entry] });
        return groups;
    }, []);
    const activeJutsuRangeTiles = jutsuRangeTiles(pendingTargetJutsu);
    const activeJutsuAoeTiles = jutsuAoeTiles(pendingTargetJutsu);

    return (
        <div className="arena-fullscreen">
            <div className="terrain-weather-panel">
                <div className="twp-biome">{biomeLabel(currentBiome)}</div>
                <div className="twp-row">
                    <span className="twp-label">Terrain</span>
                    <span className="twp-value">{terrainEffects[currentBiome].description}</span>
                </div>
                {terrainEffects[currentBiome].playerBuff && (
                    <div className="twp-buff twp-positive">{terrainEffects[currentBiome].playerBuff}</div>
                )}
                <div className="twp-divider" />
                <div className="twp-row">
                    <span className="twp-label">Weather</span>
                    <span className="twp-value">{weatherEffects[currentWeather].name}</span>
                </div>
                {weatherEffects[currentWeather].effect !== "No combat modifiers." && (
                    <div className="twp-effects">
                        {weatherEffects[currentWeather].positiveElement && (
                            <span className="twp-buff twp-positive">▲ {weatherEffects[currentWeather].positiveElement} +5%</span>
                        )}
                        {weatherEffects[currentWeather].negativeElement && (
                            <span className="twp-buff twp-negative">▼ {weatherEffects[currentWeather].negativeElement} -2%</span>
                        )}
                    </div>
                )}
            </div>
            <div className="combat-layout">
                <CombatSideHud
                    name={character.name}
                    avatar={character.avatarImage || "🥷"}
                    hp={playerHp}
                    maxHp={character.maxHp}
                    chakra={character.chakra}
                    maxChakra={character.maxChakra}
                    stamina={character.stamina}
                    maxStamina={character.maxStamina}
                    shield={playerShield}
                    village={character.village}
                    turn={turn}
                    statuses={playerStatuses}
                />

                <main className="combat-main-area">
                    <div className="arena-top-panel">
                        <div className="arena-title-panel">
                            <h2>{biomeLabel(currentBiome)}</h2>
                            <p>Turn {turn} | Shinobi Duel</p>
                        </div>
                    </div>

                    <div className="dual-ap-panel">
                        <div>
                            <strong>{character.name} AP</strong>
                            <div className="hud-bar ap-display-bar">
                                <span style={{ width: `${ap}%` }} />
                            </div>
                            <small>{ap}/100 | {activeActor === "player" ? `Active: ${actionsThisTurn}/5 actions` : "Waiting"}</small>
                        </div>

                        <div>
                            <strong>Enemy AP</strong>
                            <div className="hud-bar enemy-ap-display-bar">
                                <span style={{ width: `${enemyAp}%` }} />
                            </div>
                            <small>{enemyAp}/100 | {activeActor === "enemy" ? "Active" : "Waiting"}</small>
                        </div>
                    </div>

                    <div className={`hex-battlefield hex-${currentBiome}`} ref={battlefieldRef}>
                        <div
                            className="hex-grid-layer"
                            style={{
                                width: `${GRID_LAYER_W}px`,
                                height: `${GRID_LAYER_H}px`,
                                transform: `scale(${boardScale})`,
                                transformOrigin: "center center",
                            }}
                        >
                            {/* Avatar overlay — sits above tiles, not clipped by hex clip-path */}
                            {(() => {

                                const orbForPos = (pos: number, isEnemy: boolean, imgSrc: string, altText: string) => {
                                    const row = Math.floor(pos / gridWidth);
                                    const col = pos % gridWidth;
                                    const x = col * X_STEP + HEX_W / 2 - ORB / 2;
                                    const y = row * Y_STEP + (col % 2 === 1 ? HEX_H / 2 : 0) + HEX_H * 0.85 - ORB;
                                    return (
                                        <div key={isEnemy ? "enemy-orb" : "player-orb"} className={`avatar-orb ${isEnemy ? "enemy-orb" : ""}`} style={{ position: "absolute", left: x, top: y, width: ORB, height: ORB, zIndex: 10, pointerEvents: "none" }}>
                                            <img className="tiny-map-avatar" src={imgSrc} alt={altText} />
                                        </div>
                                    );
                                };
                                return (
                                    <>
                                        {character.avatarImage && orbForPos(playerPos, false, character.avatarImage, character.name)}
                                        {(opponentAvatar.startsWith("data:image") || opponentAvatar.startsWith("blob:")) && orbForPos(enemyPos, true, opponentAvatar, opponentName)}
                                    </>
                                );
                            })()}
                            {Array.from({ length: gridHeight }).map((_, row) =>
                                Array.from({ length: gridWidth }).map((_, col) => {
                                    const i = row * gridWidth + col;


                                    const x = col * X_STEP;
                                    const y = row * Y_STEP + (col % 2 === 1 ? HEX_H / 2 : 0);

                                    const canDashHere =
                                        dashMode &&
                                        distance(playerPos, i) <= 3 &&
                                        i !== playerPos &&
                                        i !== enemyPos;
                                    const isJutsuRangeTile = activeJutsuRangeTiles.has(i);
                                    const isJutsuAoeTile = activeJutsuAoeTiles.has(i);
                                    const isJutsuAoeCenterTile = pendingTargetJutsu?.method === "AOE_CIRCLE" && i === enemyPos && isJutsuAoeTile;
                                    const isPendingJutsuTarget = Boolean(pendingTargetJutsu) && i === enemyPos;

                                    return (
                                        <button
                                            key={i}
                                            className={`hex-tile ${i === playerPos ? "hex-player" : ""
                                                } ${i === enemyPos ? "hex-enemy" : ""
                                                } ${canDashHere ? "dash-target-tile" : ""
                                                } ${isJutsuRangeTile ? "jutsu-range-tile" : ""
                                                } ${isJutsuAoeTile ? "jutsu-aoe-tile" : ""
                                                } ${isJutsuAoeCenterTile ? "jutsu-aoe-center-tile" : ""
                                                } ${isPendingJutsuTarget ? "jutsu-target-tile" : ""
                                                }`}
                                            style={{
                                                left: `${x}px`,
                                                top: `${y}px`,
                                                width: `${HEX_W}px`,
                                                height: `${HEX_H}px`,
                                            }}
                                            title={isJutsuAoeTile ? `${pendingTargetJutsu?.name} AOE hit tile` : isJutsuRangeTile ? `${pendingTargetJutsu?.name} range` : isPendingJutsuTarget ? `Target ${opponentName} with ${pendingTargetJutsu?.name}` : undefined}
                                            onClick={() => handleTileClick(i)}
                                        >
                                            {i === playerPos ? (character.avatarImage ? "" : "🥷")
                                                : i === enemyPos ? ((opponentAvatar.startsWith("data:image") || opponentAvatar.startsWith("blob:")) ? "" : opponentAvatar)
                                                    : ""}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    <div className="basic-action-bar tnr-command-bar">
                        <button onClick={basicAttack}><span>Attack</span><small>40 AP | 10 SP</small></button>
                        <button className={selectedActionId === "move" ? "selected-action" : ""} onClick={() => { setPendingTargetJutsuId(""); setSelectedActionId((current) => current === "move" ? undefined : "move"); setDashMode(false); setLog("Move selected. Click an adjacent tile."); }}><span>Move</span><small>{adjustedApCost(30)} AP / tile</small></button>
                        <button className={dashMode || selectedActionId === "dash" ? "selected-action" : ""} onClick={() => { setPendingTargetJutsuId(""); setSelectedActionId((current) => current === "dash" ? undefined : "dash"); setDashMode((current) => !current); setLog("Dash selected. Click a tile within 3 spaces."); }}><span>Dash</span><small>3 tiles | {adjustedApCost(30)} AP | CD {cooldowns.dash ?? 0}</small></button>
                        <button onClick={basicHeal}><span>Heal</span><small>60 AP | 10 CP | CD {cooldowns.basicHeal ?? 0}</small></button>
                        <button onClick={clearEnemyPositiveEffects}><span>Clear</span><small>60 AP | CD {cooldowns.clear ?? 0}</small></button>
                        <button onClick={cleansePlayerNegativeEffects}><span>Cleanse</span><small>60 AP | CD {cooldowns.cleanse ?? 0}</small></button>
                        <button onClick={flee}><span>Flee</span><small>100 AP | 20%</small></button>
                        <button onClick={waitTurn}><span>{activeActor === "enemy" ? "Resolve" : "Wait"}</span><small>{activeActor === "enemy" ? "Enemy acts" : "End turn"}</small></button>
                    </div>

                    <div className="jutsu-layout-card combat-jutsu-bar">
                        {pendingTargetJutsu && (
                            <div className="summary-box combat-target-prompt">
                                <strong>{pendingTargetJutsu.name} armed</strong>
                                <span>
                                    {isMoveJutsu(pendingTargetJutsu)
                                        ? `Choose an open tile within ${moveJutsuRange(pendingTargetJutsu)} spaces.`
                                        : isGroundEffectJutsu(pendingTargetJutsu)
                                            ? `Choose a ground tile within ${pendingTargetJutsu.range} spaces that catches ${opponentName}.`
                                        : `Choose ${opponentName} on the battlefield to confirm.`}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPendingTargetJutsuId("");
                                        setLog("Jutsu target selection cancelled.");
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        )}

                        {equippedJutsus.length === 0 && combatEquippedItems.length === 0 ? (
                            <div className="summary-box">
                                No equipped jutsus or combat items. Equip trained jutsus, weapons, or items from Profile.
                            </div>
                        ) : (
                            <>
                                {equippedJutsus.length === 0 ? (
                                    <div className="summary-box combat-no-jutsu-note">
                                        No equipped jutsus. Equip trained jutsus from Profile.
                                    </div>
                                ) : (
                                    <div className="combat-equipped-jutsu-grid">
                                        {equippedJutsus.map((jutsu) => {
                                        const isArmed = pendingTargetJutsuId === jutsu.id;
                                        const cooldown = jutsuCooldowns[jutsu.id] ?? 0;
                                        const isOnCooldown = cooldown > 0;
                                        const image = jutsu.image;

                                        const fallbackIcon =
                                            jutsu.type === "Taijutsu" ? "👊" :
                                                jutsu.type === "Bukijutsu" ? "🗡️" :
                                                    jutsu.type === "Genjutsu" ? "👁️" :
                                                        "💠";

                                        return (
                                            <div
                                                key={jutsu.id}
                                                className={`combat-jutsu-card-wrap ${isArmed ? "selected-action" : ""}`}
                                            >
                                                <button
                                                    type="button"
                                                    className={`combat-jutsu-button ${isArmed ? "selected-action" : ""} ${isOnCooldown ? "jutsu-on-cooldown" : ""}`}
                                                    title={isOnCooldown ? `${jutsu.name} cooldown: ${cooldown} rounds` : `${jutsu.name} | ${jutsu.ap} AP | Range ${jutsu.range}`}
                                                    onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        setInspectedJutsuId("");
                                                        setInspectedCombatItemId("");
                                                        selectCombatJutsu(jutsu);
                                                    }}
                                                >
                                                    <span className="combat-jutsu-thumb">
                                                        {image ? (
                                                            <img src={image} alt={jutsu.name} />
                                                        ) : (
                                                            <strong>{fallbackIcon}</strong>
                                                        )}
                                                    </span>

                                                    <span className="combat-jutsu-name">{jutsu.name}</span>

                                                    <span className="combat-jutsu-info">
                                                        {jutsu.ap} AP | R{jutsu.range} | CD {cooldown}
                                                    </span>
                                                </button>

                                                <button
                                                    type="button"
                                                    className="combat-jutsu-help"
                                                    onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        setInspectedCombatItemId("");
                                                        setInspectedJutsuId(jutsu.id);
                                                    }}
                                                    title={`View ${jutsu.name} details`}
                                                >
                                                    ?
                                                </button>
                                            </div>
                                        );
                                        })}
                                    </div>
                                )}

                                {combatEquippedItems.length > 0 && (
                                    <div className="combat-equipped-items-row">
                                        {combatEquippedItems.map((item) => {
                                            const slot = normalizeEquipmentSlot(item.slot);
                                            const isWeapon = slot === "hand" || slot === "thrown";
                                            const icon = slot === "thrown" ? "◈" : slot === "hand" ? "⚔" : "✚";
                                            const actionText = isWeapon
                                                ? `${slot === "thrown" ? 45 : 40} AP | R${slot === "thrown" ? 4 : 1}`
                                                : "35 AP | Use";

                                            return (
                                                <div className="combat-jutsu-card-wrap combat-item-card-wrap" key={item.id}>
                                                    <button
                                                        type="button"
                                                        className={`combat-jutsu-button combat-item-button rarity-${item.rarity}`}
                                                        title={`${item.name} | ${equipmentSlotLabel(item.slot)} | ${combatItemSummary(item)}`}
                                                        onClick={(event) => {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            setInspectedJutsuId("");
                                                            useEquippedCombatItem(item);
                                                        }}
                                                    >
                                                        <span className="combat-jutsu-thumb combat-item-thumb">
                                                            {item.image ? (
                                                                <img src={item.image} alt={item.name} />
                                                            ) : (
                                                                <strong>{icon || combatItemInitials(item.name)}</strong>
                                                            )}
                                                        </span>
                                                        <span className="combat-jutsu-name">{item.name}</span>
                                                        <span className="combat-jutsu-info">{equipmentSlotLabel(item.slot)} | {actionText}</span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        className="combat-jutsu-help"
                                                        onClick={(event) => {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            setInspectedJutsuId("");
                                                            setInspectedCombatItemId(item.id);
                                                        }}
                                                        title={`View ${item.name} details`}
                                                    >
                                                        ?
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {inspectedJutsu && (() => {
                                    const mastery = getJutsuMastery(character, inspectedJutsu.id);
                                    const scaled = scaleJutsuByLevel(inspectedJutsu, mastery.level);
                                    const cooldown = jutsuCooldowns[inspectedJutsu.id] ?? 0;
                                    const cleanTarget = inspectedJutsu.target.toLowerCase().replaceAll("_", " ");
                                    const cleanMethod = inspectedJutsu.method.toLowerCase().replaceAll("_", " ");

                                    return (
                                        <div className="combat-jutsu-detail-popover">
                                            <div className="combat-jutsu-detail-header">
                                                <div>
                                                    <strong>{inspectedJutsu.name}</strong>
                                                    <small>Level {mastery.level} / {JUTSU_MAX_LEVEL}</small>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => setInspectedJutsuId("")}
                                                >
                                                    ×
                                                </button>
                                            </div>

                                            <div className="combat-jutsu-detail-grid">
                                                <span><strong>Type:</strong> {inspectedJutsu.type}</span>
                                                <span><strong>Element:</strong> {inspectedJutsu.element}</span>
                                                <span><strong>Action Usage:</strong> {inspectedJutsu.ap}%</span>
                                                <span><strong>Range:</strong> {inspectedJutsu.range}</span>
                                                <span><strong>Cooldown:</strong> {cooldown > 0 ? `${cooldown} active` : inspectedJutsu.cooldown}</span>
                                                <span><strong>Target:</strong> {cleanTarget}</span>
                                                <span><strong>Method:</strong> {cleanMethod}</span>
                                                <span><strong>Effect Power:</strong> {scaled.scaledEffectPower}</span>
                                                <span><strong>Chakra Usage:</strong> {scaled.chakraCost}</span>
                                                <span><strong>Stamina Usage:</strong> {scaled.staminaCost}</span>
                                            </div>

                                            {inspectedJutsu.description && (
                                                <p className="combat-jutsu-detail-desc">
                                                    {inspectedJutsu.description}
                                                </p>
                                            )}

                                            <div className="combat-jutsu-effects-list">
                                                <JutsuEffectCards jutsu={inspectedJutsu} scaledEffectPower={scaled.scaledEffectPower} />
                                            </div>
                                        </div>
                                    );
                                })()}

                                {inspectedCombatItem && (
                                    <div className="combat-jutsu-detail-popover combat-item-detail-popover">
                                        <div className="combat-jutsu-detail-header">
                                            <div>
                                                <strong>{inspectedCombatItem.name}</strong>
                                                <small>{equipmentSlotLabel(inspectedCombatItem.slot)} | {inspectedCombatItem.rarity}</small>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => setInspectedCombatItemId("")}
                                            >
                                                ×
                                            </button>
                                        </div>

                                        <div className="combat-jutsu-detail-grid">
                                            <span><strong>Action:</strong> {["hand", "thrown"].includes(normalizeEquipmentSlot(inspectedCombatItem.slot)) ? "Weapon attack" : "Support item"}</span>
                                            <span><strong>AP:</strong> {normalizeEquipmentSlot(inspectedCombatItem.slot) === "thrown" ? 45 : ["hand"].includes(normalizeEquipmentSlot(inspectedCombatItem.slot)) ? 40 : 35}</span>
                                            <span><strong>Range:</strong> {normalizeEquipmentSlot(inspectedCombatItem.slot) === "thrown" ? 4 : normalizeEquipmentSlot(inspectedCombatItem.slot) === "hand" ? 1 : "Self"}</span>
                                            <span><strong>Rarity:</strong> {inspectedCombatItem.rarity}</span>
                                        </div>

                                        <p className="combat-jutsu-detail-desc">
                                            {inspectedCombatItem.description}
                                        </p>

                                        <div className="combat-item-effect-box">
                                            <strong>Combat Bonuses</strong>
                                            <p>{combatItemSummary(inspectedCombatItem)}</p>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    <div className="combat-text-log combat-timeline">
                        <div className="combat-log-header">
                            <strong>Timeline</strong>
                            <span>{activeActor === "player" ? `${character.name}'s turn` : `${opponentName}'s turn`}</span>
                        </div>
                        {battleHistory.length === 0 ? (
                            <p>No timeline entries yet.</p>
                        ) : (
                            timelineRounds.map((roundGroup) => (
                                <section className="timeline-round" key={roundGroup.round}>
                                    <div className="timeline-round-header">
                                        <span>Round {roundGroup.round}</span>
                                        <small>{new Date(roundGroup.entries[0]?.createdAt ?? Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</small>
                                    </div>
                                    {roundGroup.entries.map((entry) => (
                                        <p className={`timeline-entry timeline-${entry.actorRole}`} key={`${entry.round}-${entry.actionId}-${entry.actionNumber}`}>
                                            <strong>#{entry.actionNumber}</strong> {entry.actor}: {entry.description}
                                        </p>
                                    ))}
                                </section>
                            ))
                        )}
                    </div>

                    <div className="battle-command-panel">
                        <button onClick={() => resetBattle()}>Reset Battle</button>
                        <span>Timeline {battleHistory.length} actions</span>
                        <div className="log">{log}</div>
                    </div>
                </main>
                <CombatSideHud
                    name={opponentName}
                    avatar={opponentAvatar}
                    hp={enemyHp}
                    maxHp={enemyMaxHp}
                    chakra={enemyMaxChakra}
                    maxChakra={enemyMaxChakra}
                    stamina={enemyMaxStamina}
                    maxStamina={enemyMaxStamina}
                    shield={enemyShield}
                    village={opponentCharacter?.village ?? pendingAiProfile?.village ?? "AI"}
                    turn={turn}
                    statuses={enemyStatuses}
                />
            </div>

            {battleEnded && (
                <div className="battle-ended-overlay">
                    <div className="card battle-ended-card">
                        {endlessBattleActive && battleResult === "win" ? (
                            <>
                                <h2 className="battle-result-win">⚡ Wave {endlessBattleWave} Clear!</h2>
                                <p>{log}</p>
                                <p style={{ color: "#94a3b8", fontSize: "0.85rem", margin: "0.4rem 0" }}>
                                    HP carried into next wave. Stay alive as long as you can.
                                </p>
                                <button
                                    className="admin-button"
                                    style={{ background: "linear-gradient(#1a3a1a,#0a2010)", borderColor: "#4ade80", fontSize: "1rem", padding: "0.7rem 1.5rem" }}
                                    onClick={() => onEndlessWin?.(endlessBattleWave)}
                                >
                                    ➡ Next Wave
                                </button>
                            </>
                        ) : endlessBattleActive && battleResult === "loss" ? (
                            <>
                                <h2 className="battle-result-loss">🗼 Tower Collapsed</h2>
                                <p style={{ color: "#fde047", fontSize: "1.1rem", fontWeight: 800 }}>
                                    You reached Wave {endlessBattleWave}
                                </p>
                                <p>{log}</p>
                                <p style={{ color: "#f87171", fontSize: "0.88rem", margin: "0.4rem 0" }}>
                                    You've been rushed to the village hospital. Pay <strong style={{ color: "#fde047" }}>1,000 ryo</strong> to be treated.
                                </p>
                                <div className="menu">
                                    <button style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171" }} onClick={() => { onEndlessBattleEnd?.(); setScreen("hospital"); }}>
                                        🏥 Go to Hospital
                                    </button>
                                    <button onClick={() => { onEndlessBattleEnd?.(); setScreen("centralHub"); }}>
                                        Return to Central
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 className={battleResult === "win" ? "battle-result-win" : battleResult === "fled" ? "battle-result-fled" : "battle-result-loss"}>
                                    {battleResult === "win" ? "Victory" : battleResult === "fled" ? "Escaped" : "☠️ Knocked Out"}
                                </h2>
                                <p>{log}</p>
                                {battleResult === "loss" ? (
                                    <>
                                        <p style={{ color: "#f87171", fontSize: "0.9rem", margin: "0.5rem 0" }}>
                                            You've been rushed to the village hospital. Pay <strong style={{ color: "#fde047" }}>1,000 ryo</strong> to be treated and released.
                                        </p>
                                        <button style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171" }} onClick={() => setScreen("hospital")}>
                                            🏥 Go to Hospital
                                        </button>
                                    </>
                                ) : (
                                    <div className="menu">
                                        <button className="admin-button" onClick={() => resetBattle()}>Fight Again</button>
                                        <button onClick={() => setScreen("village")}>Return to Village</button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function CombatSideHud({
    name,
    avatar,
    hp,
    maxHp,
    chakra,
    maxChakra,
    stamina,
    maxStamina,
    shield,
    village,
    turn,
    statuses,
}: {
    name: string;
    avatar: string;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    shield: number;
    village: string;
    turn: number;
    statuses: { name: string; rounds: number; amount?: number; percent?: number; kind: "positive" | "negative" }[];
}) {
    return (
        <aside className="combat-side-hud">
            <h3>{name}</h3>
            <div className="combat-avatar">
                {avatar.startsWith("data:image") || avatar.startsWith("blob:") ? (
                    <img src={avatar} alt={name} />
                ) : (
                    avatar
                )}
            </div>

            <div className="resource-line">
                HP ({hp} / {maxHp})
                <div className="hud-bar hp-bar">
                    <span style={{ width: `${(hp / maxHp) * 100}%` }} />
                </div>
            </div>

            <div className="resource-line">
                CP ({chakra} / {maxChakra})
                <div className="hud-bar chakra-bar">
                    <span style={{ width: `${(chakra / maxChakra) * 100}%` }} />
                </div>
            </div>

            <div className="resource-line">
                SP ({stamina} / {maxStamina})
                <div className="hud-bar stamina-bar">
                    <span style={{ width: `${(stamina / maxStamina) * 100}%` }} />
                </div>
            </div>

            <p><strong>Status:</strong> BATTLE 🛡️</p>
            <p><strong>Village:</strong> {village}</p>
            <p><strong>Turn:</strong> {turn}</p>
            <p><strong>Shield:</strong> {shield}</p>

            <CombatEffectsPanel title="Positive Effects" statuses={statuses.filter((s) => s.kind === "positive")} />
            <CombatEffectsPanel title="Negative Effects" statuses={statuses.filter((s) => s.kind === "negative")} />
        </aside>
    );
}

function CombatEffectsPanel({
    title,
    statuses,
}: {
    title: string;
    statuses: { name: string; rounds: number; amount?: number; percent?: number }[];
}) {
    return (
        <div className="combat-effect-panel">
            <h4>{title}</h4>
            {statuses.length === 0 ? (
                <p className="empty-effects">No active effects</p>
            ) : (
                statuses.map((s, i) => (
                    <div key={i} className="effect-pill">
                        <span>{s.name}</span>
                        <small>{s.percent ? `${s.percent}%` : s.amount ? `${s.amount}` : "active"} | {s.rounds}r</small>
                    </div>
                ))
            )}
        </div>
    );
}
