/*
 * Shinobi Chronicle Showdown -- shared rules v10.
 *
 * This module is deliberately dependency-light and is consumed by both the
 * server handlers and the React client.  The server is the authority: clients
 * receive projections and submit only action intent (indexes / targets).
 */
import { shinobiTileCards, type TileCard } from "./tile-cards.js";
import {
  CHRONICLE_LEGACY_SOURCES,
  type ChronicleLegacySource,
} from "./legacy-card-sources.js";
import {
  CHRONICLE_STORY_SOURCES,
  type ChronicleStorySource,
} from "./story-card-sources.js";

export const CHRONICLE_RULES_VERSION = 10 as const;
export const STARTING_LIFE_POINTS = 8_000;
export const MAIN_DECK_SIZE = 40;
export const OPENING_HAND_SIZE = 5;
export const MONSTER_ZONE_COUNT = 5;
export const MAGIC_TRAP_ZONE_COUNT = 5;
export const MAX_COPIES_PER_CARD = 3;
export const MAX_MONSTER_LEVEL = 8;
export const TURN_TIMEOUT_MS = 60_000;
export const RESPONSE_TIMEOUT_MS = 15_000;

export const CHRONICLE_ROOM_TITLE = "Founding Codex Format";
export const CHRONICLE_FOUNDING_FORMAT = Object.freeze({
  roomTitle: CHRONICLE_ROOM_TITLE,
  region: "Shinobi Chronicle",
  latestLegalSet: "Founding Codex",
  startingLifePoints: STARTING_LIFE_POINTS,
  openingHandSize: OPENING_HAND_SIZE,
  mainDeckSize: MAIN_DECK_SIZE,
  firstPlayerDrawsOnFirstTurn: true,
  firstPlayerMayBattleOnFirstTurn: false,
  defaultField: Object.freeze({
    name: "Neutral Field",
    attackModifier: 0,
    cardActive: false,
  }),
  phases: Object.freeze([
    { id: "draw", shortLabel: "DP", label: "Draw Phase" },
    { id: "standby", shortLabel: "SP", label: "Standby Phase" },
    { id: "main1", shortLabel: "M1", label: "Main Phase 1" },
    { id: "battle", shortLabel: "BP", label: "Battle Phase" },
    { id: "main2", shortLabel: "M2", label: "Main Phase 2" },
    { id: "end", shortLabel: "EP", label: "End Phase" },
  ]),
  battleSteps: Object.freeze([
    "Start Step",
    "Battle Step",
    "Damage Step",
    "End Step",
  ]),
  effectTiming: Object.freeze({
    normalMagic:
      "Activate from hand during an open Main Phase; resolve, then send to the Graveyard.",
    equipMagic:
      "Activate during an open Main Phase and remain attached while the target remains legal.",
    fieldMagic:
      "Activate during an open Main Phase; replace the previous shared environment.",
    trap: "Set during an open Main Phase, wait at least one turn, then answer the printed trigger window.",
    responseOrder:
      "The non-turn player receives one server-owned Snare response before the pending action resolves; Chronicle Showdown does not build multi-link chains.",
  }),
});

export type ChronicleSideKey = "p1" | "p2";
export type ChroniclePhase =
  "draw" | "standby" | "main1" | "battle" | "main2" | "end";
export type ChroniclePosition = "attack" | "defense";
export type ChronicleCardClass = "monster" | "magic" | "trap";
export const CHRONICLE_ELEMENTS = Object.freeze([
  "Fire",
  "Water",
  "Earth",
  "Wind",
  "Lightning",
] as const);
export type ChronicleElement = (typeof CHRONICLE_ELEMENTS)[number];
export const CHRONICLE_ELEMENT_BATTLE_BONUS = 200;
/**
 * A deliberately simple five-nature wheel. The advantaged Monster gains the
 * bonus on the stat it is currently using in battle (ATK or DEF); the other
 * Monster receives no additional penalty. An active Field Jutsu replaces this
 * neutral-field wheel with its printed +300/-200 modifier, so bonuses never
 * stack.
 */
export const CHRONICLE_ELEMENT_ADVANTAGE: Readonly<
  Record<ChronicleElement, ChronicleElement>
> = /* @__PURE__ */ Object.freeze({
  Fire: "Wind",
  Wind: "Lightning",
  Lightning: "Earth",
  Earth: "Water",
  Water: "Fire",
});
export function elementBattleBonus(
  element: ChronicleElement,
  opposingElement: ChronicleElement,
  activeField: ChronicleActiveField | null = null,
): number {
  if (activeField) return 0;
  return CHRONICLE_ELEMENT_ADVANTAGE[element] === opposingElement
    ? CHRONICLE_ELEMENT_BATTLE_BONUS
    : 0;
}
export const CHRONICLE_AI_DIFFICULTIES = /* @__PURE__ */ Object.freeze([
  "easy",
  "medium",
  "hard",
] as const);
export type ChronicleAiDifficulty =
  (typeof CHRONICLE_AI_DIFFICULTIES)[number];
export const CHRONICLE_AI_DIFFICULTY_DETAILS: Readonly<
  Record<
    ChronicleAiDifficulty,
    { label: string; deckName: string }
  >
> = /* @__PURE__ */ Object.freeze({
  easy: {
    label: "Easy",
    deckName: "Academy Practice",
  },
  medium: {
    label: "Medium",
    deckName: "Five-Nature Vanguard",
  },
  hard: {
    label: "Hard",
    deckName: "Crimson Tempest",
  },
});
export type ChronicleFieldId =
  "volcano" | "ocean" | "desert" | "sky" | "lightning-storm";
export type MonsterPowerTier =
  "weak" | "standard" | "elite" | "boss" | "mythic";
export type ChronicleMonsterType = "normal" | "effect";
export type ChronicleMonsterEffectTrigger =
  | "onFlip"
  | "onNormalSummon"
  | "onBattleDamage"
  | "whenAttacked"
  | "afterDamageCalculation"
  | "onDestroyedByBattle"
  | "onTributeSummon"
  | "afterAttack"
  | "whileFaceUp";
export type ChronicleMonsterEffectKind =
  | "drawOnFlip"
  | "cycleHandsOnFlip"
  | "healOnFlip"
  | "destroyStrongestOpponentOnFlip"
  | "changeStrongestOpponentPositionOnFlip"
  | "recoverMagicOnFlip"
  | "setStrongestOpponentFaceDownOnSummon"
  | "reflectDamageWhenAttacked"
  | "phaseOutBattlePairAfterDamage"
  | "destroyAttackerOnFlip"
  | "weakenAttackerOnFlip"
  | "changeToDefenseWhenAttacked"
  | "gainAttackWhenBattlingStronger"
  | "piercingBattleDamage"
  | "destroyAttackerWhenDefenseHolds"
  | "shiftToDefenseAfterAttack"
  | "drawWhenDestroyedByBattle"
  | "searchNormalWhenDestroyedByBattle"
  | "returnBattleOpponentWhenDestroyed"
  | "returnToDeckWhenDestroyed"
  | "recoverFieldMagicWhenDestroyedByBattle"
  | "gainAttackPerOpponentMonster"
  | "gainAttackWhileOnlyMonster"
  | "gainAttackOnMagicActivated"
  | "guardOtherMonsters"
  | "surviveBattleOncePerTurn"
  | "reviveNormalWhenDestroyedByBattle"
  | "drawOnTributeSummon"
  | "destroySetMagicTrapOnTributeSummon"
  | "drawOnBattleDamage"
  | "discardOpponentCardOnBattleDamage"
  | "alliedElementAttackBoost"
  | "sealAttackTraps"
  | "sealAllTraps";
export interface ChronicleMonsterEffect {
  kind: ChronicleMonsterEffectKind;
  trigger: ChronicleMonsterEffectTrigger;
  amount?: number;
  cap?: number;
}
export type ChronicleRarity =
  "common" | "rare" | "epic" | "legendary" | "mythic";
export type ChronicleEffectKind =
  | "drawCards"
  | "drawThenDiscardRandom"
  | "cycleBothHands"
  | "healLifePoints"
  | "modifyAttackUntilEndTurn"
  | "modifyDefenseUntilEndTurn"
  | "modifyAttackAndDefense"
  | "battleShieldEquip"
  | "destroyOneMonster"
  | "destroyLowDefenseMonster"
  | "destroyOneMagicTrap"
  | "destroyOneMagicTrapAndHeal"
  | "destroyActiveField"
  | "destroyAllMonsters"
  | "destroyAllOpponentMonsters"
  | "destroyAllMagicTraps"
  | "destroyAllOpponentMagicTraps"
  | "destroyAllAttackPositionMonsters"
  | "destroyLowestAttackWhenOutnumbered"
  | "negateOneAttack"
  | "negateAttackAndInflictDamage"
  | "destroyAttackerAndDamageBoth"
  | "destroyAttackerIfTargetDestroyed"
  | "borrowAttackerDefense"
  | "redirectAttackToHighestDefense"
  | "defensiveFeint"
  | "summonDefenderFromHand"
  | "endBattlePhase"
  | "weakenSummonedMonster"
  | "sealSummonedMonsterFaceDown"
  | "setFieldEnvironment"
  | "changeOneMonsterPosition"
  | "returnOneMonsterToHand"
  | "recoverOneGraveyardCard"
  | "reviveLevel4OrLowerMonster"
  | "reviveLevel4OrLowerNormalMonster";
export type ChronicleTrigger =
  "onMonsterSummoned" | "onAttackDeclared" | "onMagicActivated";
export type ChronicleTargetScope =
  | "none"
  | "ownedFaceUpMonster"
  | "anyFaceUpMonster"
  | "opponentMonster"
  | "opponentLevel4OrLowerMonster"
  | "opponentMagicTrap"
  | "ownGraveyardMagic"
  | "ownGraveyardFieldMagic"
  | "ownGraveyardLevel4OrLowerMonster"
  | "triggerMonster"
  | "triggerAttacker"
  | "triggerBattleTarget";

export interface ChronicleEffect {
  kind: ChronicleEffectKind;
  legalController: "owner";
  targetScope: ChronicleTargetScope;
  trigger?: ChronicleTrigger;
  /** Element-themed reactive cards require an established face-up specialist.
   * This keeps their stronger interruption roles from collapsing into a single
   * generic Snare package in every deck. */
  requiresFaceUpElement?: ChronicleElement;
  /** Restrict a reactive counter to the printed Jutsu subtype or effect role. */
  requiresMagicType?: ChronicleMagicCard["magicType"];
  requiresMagicKind?: ChronicleEffectKind;
  requiresMagicMonsterTarget?: boolean;
  /** Simple, server-enforced activation costs inspired by period counter Snares. */
  healthCost?: number;
  discardCost?: number;
  amount?: number;
  penaltyAmount?: number;
  cap?: number;
  fieldId?: ChronicleFieldId;
  boostElement?: ChronicleElement;
  penaltyElement?: ChronicleElement;
  duration: "instant" | "untilEndTurn" | "whileEquipped" | "whileFieldActive";
  originatingActionContinues: boolean;
  order: number;
}

interface ChronicleCardBase {
  id: string;
  name: string;
  image?: string;
  lore: string;
  rarity: ChronicleRarity;
  /** High-impact classic-role cards may be more restrictive than the global
   * three-copy ceiling. Omitted means the normal three-copy limit. */
  deckLimit?: 1 | 2;
}

export interface ChronicleMonsterCard extends ChronicleCardBase {
  cardClass: "monster";
  element: ChronicleElement;
  monsterType: ChronicleMonsterType;
  family: string;
  level: number;
  attack: number;
  defense: number;
  powerTier: MonsterPowerTier;
  effectText?: string;
  monsterEffect?: ChronicleMonsterEffect;
}

export interface ChronicleMagicCard extends ChronicleCardBase {
  cardClass: "magic";
  magicType: "normal" | "equip" | "field";
  effectTier: "starter" | "advanced";
  effect: ChronicleEffect;
  effectText: string;
}

export interface ChronicleTrapCard extends ChronicleCardBase {
  cardClass: "trap";
  trapType: "normal" | "counter";
  effectTier: "starter" | "advanced";
  effect: ChronicleEffect;
  effectText: string;
}

export type ChronicleCard =
  ChronicleMonsterCard | ChronicleMagicCard | ChronicleTrapCard;

export interface ChronicleFieldDefinition {
  id: ChronicleFieldId;
  cardId: string;
  name: string;
  image: string;
  boostElement: ChronicleElement;
  penaltyElement: ChronicleElement;
  attackBonus: 300;
  attackPenalty: -200;
}

export const CHRONICLE_FIELD_DEFINITIONS: readonly ChronicleFieldDefinition[] =
  Object.freeze([
    {
      id: "volcano",
      cardId: "chronicle-field-volcano",
      name: "Volcano",
      image: "/chronicle/fields/volcano.webp",
      boostElement: "Fire",
      penaltyElement: "Wind",
      attackBonus: 300,
      attackPenalty: -200,
    },
    {
      id: "ocean",
      cardId: "chronicle-field-ocean",
      name: "Ocean",
      image: "/chronicle/fields/ocean.webp",
      boostElement: "Water",
      penaltyElement: "Fire",
      attackBonus: 300,
      attackPenalty: -200,
    },
    {
      id: "desert",
      cardId: "chronicle-field-desert",
      name: "Desert",
      image: "/chronicle/fields/desert.webp",
      boostElement: "Earth",
      penaltyElement: "Water",
      attackBonus: 300,
      attackPenalty: -200,
    },
    {
      id: "sky",
      cardId: "chronicle-field-sky",
      name: "Sky",
      image: "/chronicle/fields/sky.webp",
      boostElement: "Wind",
      penaltyElement: "Lightning",
      attackBonus: 300,
      attackPenalty: -200,
    },
    {
      id: "lightning-storm",
      cardId: "chronicle-field-lightning-storm",
      name: "Lightning Storm",
      image: "/chronicle/fields/lightning-storm.webp",
      boostElement: "Lightning",
      penaltyElement: "Earth",
      attackBonus: 300,
      attackPenalty: -200,
    },
  ]);
const FIELD_BY_ID = new Map(
  CHRONICLE_FIELD_DEFINITIONS.map((field) => [field.id, field]),
);

const WEAK_IDS = new Set([
  ...Array.from(
    { length: 20 },
    (_, i) => `tc-${String(i + 1).padStart(2, "0")}`,
  ),
  ...Array.from({ length: 20 }, (_, i) => `tc-${i + 51}`),
]);
const STANDARD_IDS = new Set([
  ...Array.from({ length: 20 }, (_, i) => `tc-${i + 21}`),
  ...Array.from({ length: 25 }, (_, i) => `tc-${i + 71}`),
]);
const ELITE_IDS = new Set([
  ...Array.from({ length: 10 }, (_, i) => `tc-${i + 41}`),
  ...Array.from({ length: 25 }, (_, i) => `tc-${i + 96}`),
]);
const BOSS_IDS = new Set(Array.from({ length: 18 }, (_, i) => `tc-${i + 121}`));
const MYTHIC_IDS = new Set(
  Array.from({ length: 12 }, (_, i) => `tc-${i + 139}`),
);

/** Explicit reviewed tier map. The ranges mirror authored catalog story bands,
 * not a hash or a runtime rarity conversion. Individual canon overrides live
 * here and are asserted in tests. */
export const REVIEWED_MONSTER_TIERS: Readonly<
  Record<string, MonsterPowerTier>
> = Object.freeze(
  Object.fromEntries([
    ...[...WEAK_IDS].map((id) => [id, "weak"] as const),
    ...[...STANDARD_IDS].map((id) => [id, "standard"] as const),
    ...[...ELITE_IDS].map((id) => [id, "elite"] as const),
    ...[...BOSS_IDS].map((id) => [id, "boss"] as const),
    ...[...MYTHIC_IDS].map((id) => [id, "mythic"] as const),
  ]),
);

const TIER_PROFILE: Record<
  MonsterPowerTier,
  { level: number; attack: number; defense: number }
> = {
  weak: { level: 2, attack: 900, defense: 900 },
  standard: { level: 4, attack: 1_600, defense: 1_500 },
  elite: { level: 5, attack: 2_100, defense: 1_900 },
  boss: { level: 7, attack: 2_600, defense: 2_400 },
  mythic: { level: 8, attack: 3_000, defense: 2_800 },
};

const ELEMENT_PROFILE: Record<
  ChronicleElement,
  { attack: number; defense: number }
> = {
  Fire: { attack: 200, defense: -100 },
  Lightning: { attack: 150, defense: -50 },
  Wind: { attack: 100, defense: 0 },
  Water: { attack: 0, defense: 100 },
  Earth: { attack: -100, defense: 200 },
};

const ELEMENT_LORE: Readonly<Record<ChronicleElement, string>> = {
  Fire: "its fire chakra blazes through every strike",
  Water: "its water chakra turns defense into relentless motion",
  Earth: "its earth chakra anchors an unbreakable stance",
  Wind: "its wind chakra makes every movement razor-fast",
  Lightning: "its lightning chakra erupts before rivals can react",
};

function stableElementIndex(key: string, modulo: number): number {
  let hash = 0;
  for (const character of key)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % modulo;
}

/** Chronicle Showdown has exactly five Monster elements. Ice identities are
 * Water-aligned; formerly unaligned or shadow-flavored identities are
 * distributed across the four remaining affinities so the roster stays
 * balanced without inventing additional gameplay elements. */
function normalizeElement(value: string, stableKey: string): ChronicleElement {
  if (CHRONICLE_ELEMENTS.includes(value as ChronicleElement))
    return value as ChronicleElement;
  if (value === "Ice") return "Water";
  const fallback: readonly ChronicleElement[] = [
    "Earth",
    "Earth",
    "Earth",
    "Wind",
    "Wind",
    "Lightning",
    "Lightning",
    "Fire",
  ];
  return fallback[stableElementIndex(stableKey, fallback.length)];
}

function finishSentence(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function monsterLoreFromSource(
  source: TileCard,
  element: ChronicleElement,
): string {
  return `${finishSentence(source.description)} In the world of Shinobi Journey, ${ELEMENT_LORE[element]}.`;
}

/** Per-card exact stat overrides — hand-tuned numbers that bypass the tier +
 * element formula for specific signature cards. Keyed by tile-card id. */
const MONSTER_STAT_OVERRIDES: Readonly<
  Record<
    string,
    { level: number; attack: number; defense: number; powerTier: MonsterPowerTier }
  >
> = {
  // Blue Blade Raccoon — promoted to a Legendary signature card.
  "tc-41": { level: 8, attack: 3_500, defense: 2_500, powerTier: "mythic" },
};

function monsterFromSource(source: TileCard): ChronicleMonsterCard {
  const powerTier = REVIEWED_MONSTER_TIERS[source.id] ?? "standard";
  const base = TIER_PROFILE[powerTier];
  const element = normalizeElement(source.element, source.id);
  const profile = ELEMENT_PROFILE[element];
  const isTrainingDummy = source.id === "tc-01";
  const override = isTrainingDummy ? undefined : MONSTER_STAT_OVERRIDES[source.id];
  return {
    id: source.id,
    name: source.name,
    ...(source.image ? { image: source.image } : {}),
    lore: isTrainingDummy
      ? "An academy practice construct built to absorb a new shinobi's first committed strike."
      : monsterLoreFromSource(source, element),
    element,
    rarity: source.rarity,
    cardClass: "monster",
    monsterType: "normal",
    family:
      source.name.includes("Shinobi") ||
      source.name.includes("Genin") ||
      source.name.includes("Guard") ||
      source.name.includes("Master")
        ? "Shinobi"
        : source.name.includes("Spirit") ||
            source.name.includes("Wisp") ||
            source.name.includes("Wraith")
          ? "Spirit"
          : "Beast",
    level: isTrainingDummy ? 1 : (override?.level ?? base.level),
    attack: isTrainingDummy
      ? 300
      : (override?.attack ?? Math.max(100, base.attack + profile.attack)),
    defense: isTrainingDummy
      ? 800
      : (override?.defense ?? Math.max(100, base.defense + profile.defense)),
    powerTier: override?.powerTier ?? powerTier,
  };
}

const LEGACY_ELEMENT_BY_CATEGORY: Readonly<Record<string, ChronicleElement>> = {
  ninjutsu: "Fire",
  genjutsu: "Lightning",
  taijutsu: "Earth",
  bukijutsu: "Wind",
  pvp: "Lightning",
  pve: "Water",
  village: "Earth",
  support: "Earth",
  explorer: "Wind",
  pets: "Fire",
  cards: "Wind",
  war: "Fire",
};
const EARTH_EXPLORER_LEGACY_IDS = new Set([
  "shrine-seeker",
  "hidden-path",
  "wayfarers-mark",
  "road-worn-shinobi",
  "first-steps",
]);
const LEGACY_ELEMENT_BY_VILLAGE: Readonly<Record<string, ChronicleElement>> = {
  "Ashen Leaf": "Fire",
  Stormveil: "Lightning",
  Frostfang: "Water",
  Moonshadow: "Wind",
};
const LEGACY_PROFILE = {
  basic: {
    rarity: "common",
    powerTier: "weak",
    level: 3,
    attack: 1_300,
    defense: 1_500,
  },
  rare: {
    rarity: "rare",
    powerTier: "elite",
    level: 5,
    attack: 2_200,
    defense: 1_900,
  },
  legendary: {
    rarity: "legendary",
    powerTier: "boss",
    level: 7,
    attack: 2_800,
    defense: 2_500,
  },
  mythic: {
    rarity: "mythic",
    powerTier: "mythic",
    level: 8,
    attack: 3_200,
    defense: 2_800,
  },
} as const;

/** Every canonical Legacy is an embodied bearer/incarnation, not its jutsu or
 * badge as an item. Rarity bands are the explicitly reviewed Legacy ladder. */
function monsterFromLegacy(
  source: ChronicleLegacySource,
): ChronicleMonsterCard {
  const profile = LEGACY_PROFILE[source.rarity];
  const categoryElement =
    source.category === "explorer"
      ? source.id === "first-flame"
        ? "Fire"
        : EARTH_EXPLORER_LEGACY_IDS.has(source.id)
          ? "Earth"
          : "Wind"
      : (LEGACY_ELEMENT_BY_CATEGORY[source.category] ?? "Earth");
  const element = source.villageAffinity
    ? (LEGACY_ELEMENT_BY_VILLAGE[source.villageAffinity] ??
      categoryElement)
    : categoryElement;
  return {
    id: `legacy-${source.id}`,
    name: source.name,
    image: `/badges/legacy-${source.badge}.png`,
    lore: source.flavor,
    element,
    rarity: profile.rarity,
    cardClass: "monster",
    monsterType: "normal",
    family: "Legacy Incarnation",
    level: profile.level,
    attack: profile.attack,
    defense: profile.defense,
    powerTier: profile.powerTier,
  };
}

const STORY_ELEMENT_BY_VILLAGE: Readonly<Record<string, ChronicleElement>> = {
  "Stormveil Village": "Lightning",
  "Ashen Leaf Village": "Fire",
  "Frostfang Village": "Water",
  "Moonshadow Village": "Wind",
};
const STORY_KAGE_ART: Readonly<Record<string, string>> = {
  "Kage Raiko Veyr, Hollow Storm Tyrant":
    "/portraits/kage-raiko-veyr-hollow.webp",
  "Kage Hoshina Enju, First Flame Vessel":
    "/portraits/kage-hoshina-enju-hollow.webp",
  "Kage Kael Whitefang, Hollow Oath Tyrant":
    "/portraits/kage-kael-whitefang-hollow.webp",
  "Kage Sable Nocturne, Hollow Moon Sovereign":
    "/portraits/kage-sable-nocturne-hollow.webp",
};

/** In-fiction flavor for story-boss cards, banded like the stat profile. Kept
 * diegetic on purpose (no level/chapter meta — the scribes don't know what a
 * "chapter" is): the Chronicle records the world, so the lore talks about the
 * village and the Hollow, never about the game. */
function storyLoreFor(source: ChronicleStorySource): string {
  if (source.levelReq >= 100)
    return `What became of ${source.village}'s own Kage when the Hollow finished with them. The survivors tell it quietly, and never twice the same.`;
  if (source.levelReq >= 65)
    return `A name from ${source.village}'s darkest season. The shinobi who finally faced them rarely talk about it sober.`;
  if (source.levelReq >= 25)
    return `Pressed from field reports out of ${source.village}. No two witnesses agreed, so the scribes printed the worst version.`;
  if (source.levelReq <= 4)
    return `Every legend starts as somebody's first real fight. ${source.village} remembers this one.`;
  return `One of ${source.village}'s harder lessons, taken down by a scribe who watched from a prudent rooftop.`;
}

function monsterFromStory(source: ChronicleStorySource): ChronicleMonsterCard {
  const profile =
    source.levelReq >= 100
      ? {
          level: 8,
          attack: 3_300,
          defense: 2_800,
          rarity: "mythic",
          powerTier: "mythic",
        }
      : source.levelReq >= 65
        ? {
            level: 7,
            attack: 2_800,
            defense: 2_500,
            rarity: "legendary",
            powerTier: "boss",
          }
        : source.levelReq >= 25
          ? {
              level: 5,
              attack: 2_200,
              defense: 1_900,
              rarity: "epic",
              powerTier: "elite",
            }
          : source.levelReq <= 4
            ? {
                level: 3,
                attack: 1_200,
                defense: 1_400,
                rarity: "common",
                powerTier: "weak",
              }
            : {
                level: 4,
                attack: 1_800,
                defense: 1_600,
                rarity: "rare",
                powerTier: "standard",
              };
  return {
    id: `story-${source.aiProfileId}`,
    name: source.bossName,
    ...(STORY_KAGE_ART[source.bossName]
      ? { image: STORY_KAGE_ART[source.bossName] }
      : {}),
    lore: storyLoreFor(source),
    element: STORY_ELEMENT_BY_VILLAGE[source.village] ?? "Earth",
    rarity: profile.rarity as ChronicleRarity,
    cardClass: "monster",
    monsterType: "normal",
    family: source.bossName.includes("Kage ")
      ? "Kage / Hollow"
      : "Story Combatant",
    level: profile.level,
    attack: profile.attack,
    defense: profile.defense,
    powerTier: profile.powerTier as MonsterPowerTier,
  };
}

const WANDERING_SAGE_CARD: ChronicleMonsterCard = {
  id: "story-wandering-sage",
  name: "Wandering Sage",
  image: "/portraits/wandering-sage.webp",
  lore: "The road-bound keeper who witnesses earned Legacies and opens the path to their trials.",
  element: "Earth",
  rarity: "legendary",
  cardClass: "monster",
  monsterType: "normal",
  family: "Sage / Shinobi",
  level: 6,
  attack: 2_400,
  defense: 2_300,
  powerTier: "elite",
};

interface ReviewedMonsterEffect {
  effect: ChronicleMonsterEffect;
  effectText: string;
  attackAdjustment?: number;
  defenseAdjustment?: number;
  deckLimit?: 1 | 2;
}

/**
 * Explicit semantic review of the Effect Monster roster. The list deliberately
 * covers 66 of the 287 launch Monsters (23.0%): enough to create early-TCG
 * uncertainty without making Normal Monsters or Jutsu/Snare cards irrelevant.
 */
const REVIEWED_MONSTER_EFFECTS: Readonly<
  Record<string, ReviewedMonsterEffect>
> = Object.freeze({
  "tc-03": {
    effect: { kind: "surviveBattleOncePerTurn", trigger: "whileFaceUp" },
    effectText:
      "The first time this card would be destroyed by battle each turn, its shell prevents that destruction.",
    attackAdjustment: -100,
  },
  "tc-04": {
    effect: { kind: "shiftToDefenseAfterAttack", trigger: "afterAttack" },
    effectText:
      "After this card attacks, change it to Defense Position as it withdraws to report.",
    attackAdjustment: 100,
  },
  "tc-05": {
    effect: {
      kind: "drawWhenDestroyedByBattle",
      trigger: "onDestroyedByBattle",
    },
    effectText: "If this card is destroyed by battle: Draw 1 card.",
    },
  "tc-08": {
    effect: { kind: "destroyStrongestOpponentOnFlip", trigger: "onFlip" },
    effectText:
      "FLIP: Destroy the opponent's Monster with the highest ATK.",
    attackAdjustment: -400,
    defenseAdjustment: -200,
  },
  "tc-10": {
    effect: { kind: "drawOnFlip", trigger: "onFlip", amount: 1 },
    effectText: "FLIP: Draw 1 card.",
    attackAdjustment: -300,
  },
  "tc-13": {
    effect: { kind: "healOnFlip", trigger: "onFlip", amount: 500 },
    effectText: "FLIP: Gain 500 Health Points.",
    attackAdjustment: -200,
  },
  "tc-17": {
    effect: {
      kind: "destroyAttackerWhenDefenseHolds",
      trigger: "whileFaceUp",
    },
    effectText:
      "If this Defense Position card is attacked and its DEF is higher than the attacker's ATK: After damage calculation, destroy the attacker.",
    attackAdjustment: -200,
  },
  "tc-20": {
    effect: {
      kind: "searchNormalWhenDestroyedByBattle",
      trigger: "onDestroyedByBattle",
      cap: 4,
      amount: 1_500,
    },
    effectText:
      "If this card is destroyed by battle: Add the first Level 4 or lower Normal Monster with 1,500 or less ATK from your Deck to your hand.",
    attackAdjustment: -200,
  },
  "tc-51": {
    effect: {
      kind: "returnToDeckWhenDestroyed",
      trigger: "onDestroyedByBattle",
    },
    effectText:
      "If this card is destroyed by battle: Place it on the bottom of its owner's Deck instead of leaving it in the Graveyard.",
    },
  "tc-57": {
    effect: { kind: "cycleHandsOnFlip", trigger: "onFlip", amount: 1 },
    effectText:
      "FLIP: Each player draws 1 card, then discards 1 random card.",
    attackAdjustment: -200,
  },
  "tc-63": {
    effect: {
      kind: "reflectDamageWhenAttacked",
      trigger: "whenAttacked",
    },
    effectText:
      "If this face-up Attack Position card is attacked: Before damage calculation, inflict damage to your opponent equal to the attacker's ATK.",
    attackAdjustment: -300,
  },
  "tc-65": {
    effect: {
      kind: "returnBattleOpponentWhenDestroyed",
      trigger: "onDestroyedByBattle",
    },
    effectText:
      "If this card is destroyed by battle: Return the Monster it battled to its owner's hand.",
    attackAdjustment: -200,
    defenseAdjustment: -200,
  },
  "tc-22": {
    effect: { kind: "shiftToDefenseAfterAttack", trigger: "afterAttack" },
    effectText:
      "After this card attacks, change it to Defense Position as it climbs back into the storm.",
    attackAdjustment: 100,
  },
  "tc-24": {
    effect: {
      kind: "changeStrongestOpponentPositionOnFlip",
      trigger: "onFlip",
    },
    effectText:
      "FLIP: Change the highest-ATK face-up opponent Monster to its other battle position. Lock it through the next turn.",
    attackAdjustment: -300,
  },
  "tc-27": {
    effect: { kind: "piercingBattleDamage", trigger: "whileFaceUp" },
    effectText:
      "When this card overpowers a Defense Position Monster, inflict the excess ATK as battle damage.",
    defenseAdjustment: -100,
  },
  "tc-28": {
    effect: { kind: "piercingBattleDamage", trigger: "whileFaceUp" },
    effectText:
      "When this card overpowers a Defense Position Monster, inflict the excess ATK as battle damage.",
    defenseAdjustment: -100,
  },
  "tc-31": {
    effect: {
      kind: "discardOpponentCardOnBattleDamage",
      trigger: "onBattleDamage",
      amount: 1,
    },
    effectText:
      "If this card inflicts battle damage to your opponent: They discard 1 random card.",
    attackAdjustment: -200,
  },
  "tc-33": {
    effect: { kind: "recoverMagicOnFlip", trigger: "onFlip", amount: 1 },
    effectText:
      "FLIP: Return the most recently sent Jutsu Card from your Graveyard to your hand.",
    attackAdjustment: -300,
  },
  "tc-34": {
    effect: { kind: "changeToDefenseWhenAttacked", trigger: "whenAttacked" },
    effectText:
      "When this Attack Position card is attacked: Change it to Defense Position before damage calculation.",
    attackAdjustment: -200,
  },
  "tc-39": {
    effect: {
      kind: "setStrongestOpponentFaceDownOnSummon",
      trigger: "onNormalSummon",
    },
    effectText:
      "If this card is Normal Summoned: Change the opponent's face-up Monster with the highest ATK to face-down Defense Position.",
    attackAdjustment: -300,
  },
  "tc-72": {
    effect: { kind: "shiftToDefenseAfterAttack", trigger: "afterAttack" },
    effectText:
      "After this card attacks, change it to Defense Position as it returns to the clouds.",
    attackAdjustment: 100,
  },
  "tc-75": {
    effect: { kind: "piercingBattleDamage", trigger: "whileFaceUp" },
    effectText:
      "When this card overpowers a Defense Position Monster, inflict the excess ATK as battle damage.",
    defenseAdjustment: -100,
  },
  "tc-76": {
    effect: {
      kind: "returnBattleOpponentWhenDestroyed",
      trigger: "onDestroyedByBattle",
    },
    effectText:
      "If this card is destroyed by battle: Return the Monster it battled to its owner's hand.",
    attackAdjustment: -200,
    defenseAdjustment: -200,
  },
  "tc-81": {
    effect: {
      kind: "gainAttackWhenBattlingStronger",
      trigger: "afterDamageCalculation",
      amount: 600,
    },
    effectText:
      "If this Attack Position card battles a Monster with higher ATK: It gains 600 ATK during damage calculation only.",
    attackAdjustment: -200,
  },
  "tc-85": {
    effect: { kind: "weakenAttackerOnFlip", trigger: "onFlip", amount: 500 },
    effectText:
      "If this face-down card is attacked and flipped face-up: The attacker loses 500 ATK during that damage calculation only.",
    attackAdjustment: -200,
  },
  "tc-91": {
    effect: { kind: "destroyAttackerOnFlip", trigger: "onFlip" },
    effectText:
      "If this face-down card is attacked and flipped face-up: After damage calculation, destroy the attacking Monster.",
    attackAdjustment: -400,
    defenseAdjustment: -200,
  },
  "tc-42": {
    effect: { kind: "piercingBattleDamage", trigger: "whileFaceUp" },
    effectText:
      "When this card overpowers a Defense Position Monster, inflict the excess ATK as battle damage.",
    defenseAdjustment: -100,
  },
  "tc-44": {
    effect: {
      kind: "phaseOutBattlePairAfterDamage",
      trigger: "afterDamageCalculation",
    },
    effectText:
      "After damage calculation, when this card battles an opponent Monster: Place both battling Monsters on the bottom of their owners' Decks.",
    attackAdjustment: -300,
    defenseAdjustment: -100,
  },
  "tc-45": {
    effect: {
      kind: "gainAttackOnMagicActivated",
      trigger: "whileFaceUp",
      amount: 200,
    },
    effectText:
      "Each time a Jutsu Card is activated while this card is face-up: It gains 200 ATK until the End Phase.",
    attackAdjustment: -300,
  },
  "tc-48": {
    effect: {
      kind: "gainAttackWhileOnlyMonster",
      trigger: "whileFaceUp",
      amount: 500,
    },
    effectText:
      "While this is the only Monster you control, it gains 500 ATK.",
    attackAdjustment: -200,
  },
  "tc-49": {
    effect: {
      kind: "recoverFieldMagicWhenDestroyedByBattle",
      trigger: "onDestroyedByBattle",
    },
    effectText:
      "If destroyed by battle: Return the most recent Field Jutsu Card in your Graveyard to your hand.",
    attackAdjustment: -200,
  },
  "tc-50": {
    effect: { kind: "sealAllTraps", trigger: "whileFaceUp" },
    effectText:
      "While this card is face-up, neither player can activate Snare Cards.",
    attackAdjustment: -300,
    deckLimit: 1,
  },
  "tc-96": {
    effect: {
      kind: "destroyAttackerWhenDefenseHolds",
      trigger: "whileFaceUp",
    },
    effectText:
      "If this Defense Position card is attacked and its DEF is higher than the attacker's ATK: After damage calculation, destroy the attacker.",
    attackAdjustment: -200,
  },
  "tc-97": {
    effect: {
      kind: "destroySetMagicTrapOnTributeSummon",
      trigger: "onTributeSummon",
    },
    effectText:
      "If Tribute Summoned: Destroy 1 opponent Set Jutsu or Snare Card. This card cannot attack this turn.",
    defenseAdjustment: -100,
  },
  "tc-99": {
    effect: {
      kind: "reviveNormalWhenDestroyedByBattle",
      trigger: "onDestroyedByBattle",
      cap: 4,
    },
    effectText:
      "If this card is destroyed by battle: Special Summon the most recently sent Level 4 or lower Normal Monster from your Graveyard in face-up Defense Position.",
    attackAdjustment: -200,
    defenseAdjustment: -100,
  },
  "tc-100": {
    effect: {
      kind: "alliedElementAttackBoost",
      trigger: "whileFaceUp",
      amount: 200,
    },
    effectText: "Other face-up Wind Monsters you control gain 200 ATK.",
    attackAdjustment: -200,
  },
  "tc-101": {
    effect: {
      kind: "drawOnBattleDamage",
      trigger: "onBattleDamage",
      amount: 1,
    },
    effectText:
      "If this card inflicts battle damage to your opponent: Draw 1 card.",
    attackAdjustment: -200,
  },
  "tc-110": {
    effect: {
      kind: "reviveNormalWhenDestroyedByBattle",
      trigger: "onDestroyedByBattle",
      cap: 4,
    },
    effectText:
      "If this card is destroyed by battle: Special Summon the most recently sent Level 4 or lower Normal Monster from your Graveyard in face-up Defense Position.",
    attackAdjustment: -200,
    defenseAdjustment: -100,
  },
  "tc-121": {
    effect: { kind: "guardOtherMonsters", trigger: "whileFaceUp" },
    effectText:
      "While face-up in Defense Position, opponents must attack this Monster first.",
    attackAdjustment: -200,
  },
  "tc-122": {
    effect: { kind: "piercingBattleDamage", trigger: "whileFaceUp" },
    effectText:
      "When this card overpowers a Defense Position Monster, inflict the excess ATK as battle damage.",
    defenseAdjustment: -100,
  },
  "tc-123": {
    effect: {
      kind: "alliedElementAttackBoost",
      trigger: "whileFaceUp",
      amount: 200,
    },
    effectText: "Other face-up Water Monsters you control gain 200 ATK.",
    attackAdjustment: -200,
  },
  "tc-124": {
    effect: {
      kind: "gainAttackPerOpponentMonster",
      trigger: "whileFaceUp",
      amount: 150,
    },
    effectText:
      "While face-up, this card gains 150 ATK for each Monster your opponent controls.",
    attackAdjustment: -300,
  },
  "tc-126": {
    effect: { kind: "sealAttackTraps", trigger: "whileFaceUp" },
    effectText:
      "While this card is face-up, your opponent cannot activate Snares when you declare an attack.",
    attackAdjustment: -200,
  },
  "tc-127": {
    effect: { kind: "surviveBattleOncePerTurn", trigger: "whileFaceUp" },
    effectText:
      "The first time this card would be destroyed by battle each turn, its ancient ice prevents that destruction.",
    attackAdjustment: -200,
  },
  "tc-133": {
    effect: {
      kind: "reviveNormalWhenDestroyedByBattle",
      trigger: "onDestroyedByBattle",
      cap: 4,
    },
    effectText:
      "If this card is destroyed by battle: Special Summon the most recently sent Level 4 or lower Normal Monster from your Graveyard in face-up Defense Position.",
    attackAdjustment: -200,
    defenseAdjustment: -100,
  },
  "tc-139": {
    effect: { kind: "surviveBattleOncePerTurn", trigger: "whileFaceUp" },
    effectText:
      "The first time this card would be destroyed by battle each turn, its primordial scales prevent that destruction.",
    attackAdjustment: -200,
  },
  "tc-142": {
    effect: { kind: "piercingBattleDamage", trigger: "whileFaceUp" },
    effectText:
      "When this card overpowers a Defense Position Monster, inflict the excess ATK as battle damage.",
    defenseAdjustment: -100,
    deckLimit: 1,
  },
  "tc-149": {
    effect: {
      kind: "returnToDeckWhenDestroyed",
      trigger: "onDestroyedByBattle",
    },
    effectText:
      "If this card is destroyed by battle: Place it on the bottom of its owner's Deck instead of leaving it in the Graveyard.",
    deckLimit: 1,
  },
  "legacy-first-flame": {
    effect: {
      kind: "drawOnTributeSummon",
      trigger: "onTributeSummon",
      amount: 1,
    },
    effectText: "If this card is Tribute Summoned: Draw 1 card.",
    attackAdjustment: -200,
    deckLimit: 1,
  },
  "legacy-gate-opener": {
    effect: { kind: "piercingBattleDamage", trigger: "whileFaceUp" },
    effectText:
      "When this card overpowers a Defense Position Monster, inflict the excess ATK as battle damage.",
    defenseAdjustment: -100,
    deckLimit: 1,
  },
  "legacy-last-bastion": {
    effect: { kind: "surviveBattleOncePerTurn", trigger: "whileFaceUp" },
    effectText:
      "The first time this card would be destroyed by battle each turn, it remains as the last defense.",
    attackAdjustment: -200,
    deckLimit: 1,
  },
  "legacy-deathless-ember": {
    effect: {
      kind: "returnToDeckWhenDestroyed",
      trigger: "onDestroyedByBattle",
    },
    effectText:
      "If this card is destroyed by battle: Place it on the bottom of its owner's Deck instead of leaving it in the Graveyard.",
    deckLimit: 1,
  },
  "legacy-moonlit-ghost": {
    effect: {
      kind: "returnBattleOpponentWhenDestroyed",
      trigger: "onDestroyedByBattle",
    },
    effectText:
      "If this card is destroyed by battle: Return the Monster it battled to its owner's hand.",
    attackAdjustment: -200,
    defenseAdjustment: -200,
    deckLimit: 1,
  },
  "legacy-thousand-seals": {
    effect: { kind: "sealAttackTraps", trigger: "whileFaceUp" },
    effectText:
      "While this card is face-up, your opponent cannot activate Snares when you declare an attack.",
    attackAdjustment: -200,
    deckLimit: 1,
  },
  "legacy-field-medic": {
    effect: { kind: "healOnFlip", trigger: "onFlip", amount: 900 },
    effectText: "FLIP: Gain 900 Health Points.",
    attackAdjustment: -200,
  },
  "legacy-shadow-strategist": {
    effect: { kind: "drawOnFlip", trigger: "onFlip", amount: 1 },
    effectText: "FLIP: Draw 1 card.",
    attackAdjustment: -300,
  },
  "legacy-blade-saint": {
    effect: { kind: "piercingBattleDamage", trigger: "whileFaceUp" },
    effectText:
      "When this card overpowers a Defense Position Monster, inflict the excess ATK as battle damage.",
    defenseAdjustment: -100,
    deckLimit: 1,
  },
  "legacy-beast-sovereign": {
    effect: {
      kind: "alliedElementAttackBoost",
      trigger: "whileFaceUp",
      amount: 200,
    },
    effectText: "Other face-up Wind Monsters you control gain 200 ATK.",
    attackAdjustment: -200,
    deckLimit: 1,
  },
  "story-story-ai-stormveil-village-25": {
    effect: { kind: "sealAttackTraps", trigger: "whileFaceUp" },
    effectText:
      "While this card is face-up, your opponent cannot activate Snares when you declare an attack.",
    attackAdjustment: -200,
  },
  "story-story-ai-stormveil-village-100": {
    effect: {
      kind: "alliedElementAttackBoost",
      trigger: "whileFaceUp",
      amount: 200,
    },
    effectText: "Other face-up Lightning Monsters you control gain 200 ATK.",
    attackAdjustment: -200,
    deckLimit: 1,
  },
  "story-story-ai-ashen-leaf-village-100": {
    effect: {
      kind: "alliedElementAttackBoost",
      trigger: "whileFaceUp",
      amount: 200,
    },
    effectText: "Other face-up Fire Monsters you control gain 200 ATK.",
    attackAdjustment: -200,
    deckLimit: 1,
  },
  "story-story-ai-frostfang-village-25": {
    effect: { kind: "surviveBattleOncePerTurn", trigger: "whileFaceUp" },
    effectText:
      "The first time this card would be destroyed by battle each turn, its Frost Seal prevents that destruction.",
    attackAdjustment: -200,
  },
  "story-story-ai-frostfang-village-100": {
    effect: {
      kind: "alliedElementAttackBoost",
      trigger: "whileFaceUp",
      amount: 200,
    },
    effectText: "Other face-up Water Monsters you control gain 200 ATK.",
    attackAdjustment: -200,
    deckLimit: 1,
  },
  "story-story-ai-moonshadow-village-50": {
    effect: {
      kind: "returnBattleOpponentWhenDestroyed",
      trigger: "onDestroyedByBattle",
    },
    effectText:
      "If this card is destroyed by battle: Return the Monster it battled to its owner's hand.",
    attackAdjustment: -200,
    defenseAdjustment: -200,
  },
  "story-story-ai-moonshadow-village-100": {
    effect: {
      kind: "alliedElementAttackBoost",
      trigger: "whileFaceUp",
      amount: 200,
    },
    effectText: "Other face-up Wind Monsters you control gain 200 ATK.",
    attackAdjustment: -200,
    deckLimit: 1,
  },
  "story-wandering-sage": {
    effect: {
      kind: "drawOnTributeSummon",
      trigger: "onTributeSummon",
      amount: 1,
    },
    effectText: "If this card is Tribute Summoned: Draw 1 card.",
    attackAdjustment: -200,
    deckLimit: 1,
  },
});

function applyReviewedMonsterEffect(
  card: ChronicleMonsterCard,
): ChronicleMonsterCard {
  const review = REVIEWED_MONSTER_EFFECTS[card.id];
  if (!review) return card;
  return {
    ...card,
    monsterType: "effect",
    attack: Math.max(100, card.attack + (review.attackAdjustment ?? 0)),
    defense: Math.max(100, card.defense + (review.defenseAdjustment ?? 0)),
    effectText: review.effectText,
    monsterEffect: review.effect,
    ...(review.deckLimit ? { deckLimit: review.deckLimit } : {}),
  };
}

function magic(
  id: string,
  name: string,
  image: string | undefined,
  lore: string,
  magicType: "normal" | "equip" | "field",
  effectText: string,
  effect: ChronicleEffect,
  options: {
    rarity?: ChronicleRarity;
    effectTier?: "starter" | "advanced";
    deckLimit?: 1 | 2;
  } = {},
): ChronicleMagicCard {
  return {
    id,
    name,
    ...(image ? { image } : {}),
    lore,
    rarity: options.rarity ?? "common",
    ...(options.deckLimit ? { deckLimit: options.deckLimit } : {}),
    cardClass: "magic",
    magicType,
    effectTier: options.effectTier ?? "starter",
    effectText,
    effect,
  };
}

const TRAP_ELEMENT_REQUIREMENT_BY_ID: Readonly<
  Partial<Record<string, ChronicleElement>>
> = Object.freeze({
  "chronicle-ashen-veil": "Fire",
  "chronicle-cinder-minefield": "Fire",
  "chronicle-ember-cipher": "Fire",
  "chronicle-hearthfire-expulsion": "Fire",
  "chronicle-ringed-detonation": "Fire",
  "chronicle-floodgate-mist": "Water",
  "chronicle-tidal-deflection": "Water",
  "chronicle-undertow-gate": "Water",
  "chronicle-drowned-formula": "Water",
  "chronicle-sand-coffin-counter": "Earth",
  "chronicle-ironwood-bulwark": "Earth",
  "chronicle-earthen-grave-array": "Earth",
  "chronicle-dust-exile": "Earth",
  "chronicle-gale-reversal": "Wind",
  "chronicle-skyhook-snare": "Wind",
  "chronicle-vacuum-prison": "Wind",
  "chronicle-windless-edict": "Wind",
  "chronicle-thunder-cage": "Lightning",
  "chronicle-flash-burial-tag": "Lightning",
  "chronicle-heavenfall-verdict": "Lightning",
  "chronicle-grounding-rod-script": "Lightning",
  "chronicle-avalanche-seal": "Water",
  "chronicle-moonshadow-slip": "Wind",
  "chronicle-scorpion-wire": "Earth",
  "chronicle-mirror-moon-rebuttal": "Lightning",
});

function trap(
  id: string,
  name: string,
  image: string | undefined,
  lore: string,
  effectText: string,
  effect: ChronicleEffect,
  options: {
    rarity?: ChronicleRarity;
    effectTier?: "starter" | "advanced";
    deckLimit?: 1 | 2;
  } = {},
): ChronicleTrapCard {
  const requiredElement = TRAP_ELEMENT_REQUIREMENT_BY_ID[id];
  const reviewedEffect: ChronicleEffect = requiredElement
    ? { ...effect, requiresFaceUpElement: requiredElement }
    : effect;
  const reviewedEffectText =
    reviewedEffect.trigger === "onMonsterSummoned"
      ? effectText.replace(" is Summoned", " is Normal Summoned")
      : effectText;
  return {
    id,
    name,
    ...(image ? { image } : {}),
    lore,
    rarity: options.rarity ?? "common",
    ...(options.deckLimit ? { deckLimit: options.deckLimit } : {}),
    cardClass: "trap",
    trapType: effect.trigger === "onMagicActivated" ? "counter" : "normal",
    effectTier: options.effectTier ?? "starter",
    effectText: requiredElement
      ? `Activation requirement: Control a face-up ${requiredElement} Monster. ${reviewedEffectText}`
      : reviewedEffectText,
    effect: reviewedEffect,
  };
}

const SUPPORT_CARDS: readonly (ChronicleMagicCard | ChronicleTrapCard)[] = [
  magic(
    "chronicle-recon-scroll",
    "Reconnaissance Scroll",
    "/legacy/jutsu/uncharted-strike.webp",
    "A field report opened before the next formation is chosen.",
    "normal",
    "Draw 1 card.",
    {
      kind: "drawCards",
      legalController: "owner",
      targetScope: "none",
      amount: 1,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
  ),
  magic(
    "chronicle-medical-salve",
    "Field Medicine",
    "/legacy/jutsu/triage-under-fire.webp",
    "Compact medicine carried by village field teams.",
    "normal",
    "Gain 800 Health Points.",
    {
      kind: "healLifePoints",
      legalController: "owner",
      targetScope: "none",
      amount: 800,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
  ),
  magic(
    "chronicle-soldier-pill",
    "Soldier Pill",
    "/legacy/jutsu/knuckle-down.webp",
    "A measured stimulant used before committing to an attack.",
    "normal",
    "One face-up Monster gains 400 ATK until the End Phase.",
    {
      kind: "modifyAttackUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 400,
      duration: "untilEndTurn",
      originatingActionContinues: true,
      order: 10,
    },
  ),
  magic(
    "chronicle-guard-stance",
    "Mountain Guard Stance",
    "/legacy/jutsu/mountains-descent.webp",
    "A deliberate defensive form rooted like the northern cliffs.",
    "normal",
    "One face-up Monster gains 500 DEF until the End Phase.",
    {
      kind: "modifyDefenseUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 500,
      duration: "untilEndTurn",
      originatingActionContinues: true,
      order: 10,
    },
  ),
  magic(
    "chronicle-tempered-kunai",
    "Tempered Kunai",
    undefined,
    "A balanced village-forged blade fastened to a combatant's kit.",
    "equip",
    "The equipped Monster gains 400 ATK.",
    {
      kind: "modifyAttackUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 400,
      duration: "whileEquipped",
      originatingActionContinues: true,
      order: 10,
    },
  ),
  magic(
    "chronicle-reinforced-vest",
    "Reinforced Guard Vest",
    undefined,
    "Padded field armor with metal plates sewn between its layers.",
    "equip",
    "The equipped Monster gains 500 DEF.",
    {
      kind: "modifyDefenseUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 500,
      duration: "whileEquipped",
      originatingActionContinues: true,
      order: 10,
    },
  ),
  magic(
    "chronicle-recall-seal",
    "Recall Seal",
    "/combat-vfx/seal.webp",
    "A deliberate seal that extracts a manageable foe from the formation.",
    "normal",
    "Return one face-up opponent Level 4 or lower Monster to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "opponentLevel4OrLowerMonster",
      cap: 4,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
  ),
  magic(
    "chronicle-revival-scroll",
    "Keeper's Revival Scroll",
    "/legacy/jutsu/keepers-mending.webp",
    "A recovery script reserved for fallen junior allies.",
    "normal",
    "Revive one Level 4 or lower Normal Monster from your Graveyard in Defense Position.",
    {
      kind: "reviveLevel4OrLowerNormalMonster",
      legalController: "owner",
      targetScope: "ownGraveyardLevel4OrLowerMonster",
      cap: 4,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
  ),
  magic(
    "chronicle-stacked-scrolls",
    "Stacked Scrolls",
    "/legacy/jutsu/stacked-deck.webp",
    "A sealed archive whose paired intelligence reports can reverse a losing formation.",
    "normal",
    "Draw 2 cards.",
    {
      kind: "drawCards",
      legalController: "owner",
      targetScope: "none",
      amount: 2,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "legendary",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  magic(
    "chronicle-crimson-insight",
    "Crimson Insight",
    "/legacy/jutsu/crimson-draw.webp",
    "A blood-red intelligence cipher reveals the next useful line of play.",
    "normal",
    "Draw 2 cards, then discard 1 random card.",
    {
      kind: "drawThenDiscardRandom",
      legalController: "owner",
      targetScope: "none",
      amount: 2,
      penaltyAmount: 1,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-hundred-shrine-benediction",
    "Hundred-Shrine Benediction",
    "/legacy/jutsu/hundred-shrine-blessing.webp",
    "A chain of village prayers restores a battered commander's resolve.",
    "normal",
    "Gain 1,500 Health Points.",
    {
      kind: "healLifePoints",
      legalController: "owner",
      targetScope: "none",
      amount: 1_500,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-giant-felling-edict",
    "Giant-Felling Edict",
    "/legacy/jutsu/fell-the-giant.webp",
    "A forbidden command mark fractures every hostile foothold at once.",
    "normal",
    "Destroy all Monsters your opponent controls.",
    {
      kind: "destroyAllOpponentMonsters",
      legalController: "owner",
      targetScope: "none",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "legendary",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  magic(
    "chronicle-hollow-breach",
    "Hollow Breach",
    "/legacy/jutsu/hollow-break.webp",
    "A narrow void-tear swallows a lesser fighter before the formation can close.",
    "normal",
    "Target one face-up opponent Monster with 1,000 or less DEF; destroy it.",
    {
      kind: "destroyLowDefenseMonster",
      legalController: "owner",
      targetScope: "opponentMonster",
      cap: 1_000,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
    },
  ),
  magic(
    "chronicle-sealbreak-verdict",
    "Sealbreak Verdict",
    "/legacy/jutsu/sealbreak-verdict.webp",
    "A precise counter-script tears one prepared technique out of the opposing line.",
    "normal",
    "Destroy one opponent Jutsu or Snare Card.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "opponentMagicTrap",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-hundredfold-tempest",
    "Hundredfold Tempest",
    "/legacy/jutsu/hundredfold-tempest.webp",
    "Layered wind seals scour every hostile preparation from the enemy field.",
    "normal",
    "Destroy all Jutsu and Snare Cards your opponent controls.",
    {
      kind: "destroyAllOpponentMagicTraps",
      legalController: "owner",
      targetScope: "none",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  magic(
    "chronicle-moonfold-genjutsu",
    "Moonfold Genjutsu",
    "/legacy/jutsu/mirage-waltz.webp",
    "A folded moon illusion forces an enemy to abandon its chosen stance.",
    "normal",
    "Change one face-up opponent Monster's battle position.",
    {
      kind: "changeOneMonsterPosition",
      legalController: "owner",
      targetScope: "opponentMonster",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-mirage-displacement",
    "Mirage Displacement",
    "/legacy/jutsu/flush-the-quarry.webp",
    "False terrain sends even a veteran enemy back to the edge of battle.",
    "normal",
    "Return one opponent Monster to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "opponentMonster",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  magic(
    "chronicle-deathless-recall",
    "Deathless Recall",
    "/legacy/jutsu/deathless-flurry.webp",
    "An ancestral pulse calls a fallen junior combatant back into formation.",
    "normal",
    "Revive one Level 4 or lower Monster from your Graveyard in Defense Position.",
    {
      kind: "reviveLevel4OrLowerMonster",
      legalController: "owner",
      targetScope: "ownGraveyardLevel4OrLowerMonster",
      cap: 4,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "legendary",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  magic(
    "chronicle-second-wind-recall",
    "Second-Wind Recall",
    "/legacy/jutsu/second-wind.webp",
    "A reserve squad's recovery signal returns a young ally to the line.",
    "normal",
    "Return one Level 4 or lower Monster from your Graveyard to your hand.",
    {
      kind: "recoverOneGraveyardCard",
      legalController: "owner",
      targetScope: "ownGraveyardLevel4OrLowerMonster",
      cap: 4,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-saints-edge",
    "Saint's Edge",
    "/legacy/jutsu/saints-edge.webp",
    "A consecrated short blade carries a dangerous edge through prolonged combat.",
    "equip",
    "The equipped Monster gains 700 ATK.",
    {
      kind: "modifyAttackUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 700,
      duration: "whileEquipped",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-final-bulwark",
    "Final Bulwark",
    "/legacy/jutsu/final-bulwark.webp",
    "Layered plates and sealing cloth turn one shinobi into the formation's anchor.",
    "equip",
    "The equipped Monster gains 800 DEF.",
    {
      kind: "modifyDefenseUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 800,
      duration: "whileEquipped",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-bannerlords-rally",
    "Bannerlord's Rally",
    "/legacy/jutsu/bannerlords-rally.webp",
    "A raised war banner drives one combatant through the decisive exchange.",
    "normal",
    "One face-up Monster gains 600 ATK until the End Phase.",
    {
      kind: "modifyAttackUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 600,
      duration: "untilEndTurn",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-defiant-rampart",
    "Defiant Rampart",
    "/legacy/jutsu/defiant-rampart.webp",
    "Earth-scripted barricades harden around a chosen defender.",
    "normal",
    "One face-up Monster gains 800 DEF until the End Phase.",
    {
      kind: "modifyDefenseUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 800,
      duration: "untilEndTurn",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-cleansing-radiance",
    "Cleansing Radiance",
    "/legacy/jutsu/cleansing-radiance.webp",
    "A white sealing flare burns one hostile script away without touching its bearer.",
    "normal",
    "Destroy one opponent Jutsu or Snare Card, then gain 500 Health Points.",
    {
      kind: "destroyOneMagicTrapAndHeal",
      legalController: "owner",
      targetScope: "opponentMagicTrap",
      amount: 500,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-field-volcano",
    "Volcano",
    "/chronicle/fields/volcano.webp",
    "Obsidian terraces and molten rivers turn every exchange into a trial by flame.",
    "field",
    "Fire Monsters gain 300 ATK. Wind Monsters lose 200 ATK.",
    {
      kind: "setFieldEnvironment",
      legalController: "owner",
      targetScope: "none",
      fieldId: "volcano",
      boostElement: "Fire",
      penaltyElement: "Wind",
      amount: 300,
      penaltyAmount: -200,
      duration: "whileFieldActive",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-field-ocean",
    "Ocean",
    "/chronicle/fields/ocean.webp",
    "A storm-ringed sea platform rewards those who move with the tide.",
    "field",
    "Water Monsters gain 300 ATK. Fire Monsters lose 200 ATK.",
    {
      kind: "setFieldEnvironment",
      legalController: "owner",
      targetScope: "none",
      fieldId: "ocean",
      boostElement: "Water",
      penaltyElement: "Fire",
      amount: 300,
      penaltyAmount: -200,
      duration: "whileFieldActive",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-field-desert",
    "Desert",
    "/chronicle/fields/desert.webp",
    "Ancient sandstone seals favor earthbound strength and drink the moisture from weaker forms.",
    "field",
    "Earth Monsters gain 300 ATK. Water Monsters lose 200 ATK.",
    {
      kind: "setFieldEnvironment",
      legalController: "owner",
      targetScope: "none",
      fieldId: "desert",
      boostElement: "Earth",
      penaltyElement: "Water",
      amount: 300,
      penaltyAmount: -200,
      duration: "whileFieldActive",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-field-sky",
    "Sky",
    "/chronicle/fields/sky.webp",
    "A floating shrine arena lets wind-born combatants command the open heavens.",
    "field",
    "Wind Monsters gain 300 ATK. Lightning Monsters lose 200 ATK.",
    {
      kind: "setFieldEnvironment",
      legalController: "owner",
      targetScope: "none",
      fieldId: "sky",
      boostElement: "Wind",
      penaltyElement: "Lightning",
      amount: 300,
      penaltyAmount: -200,
      duration: "whileFieldActive",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-field-lightning-storm",
    "Lightning Storm",
    "/chronicle/fields/lightning-storm.webp",
    "A charged plateau beneath a living thunderhead feeds every lightning nature on the field.",
    "field",
    "Lightning Monsters gain 300 ATK. Earth Monsters lose 200 ATK.",
    {
      kind: "setFieldEnvironment",
      legalController: "owner",
      targetScope: "none",
      fieldId: "lightning-storm",
      boostElement: "Lightning",
      penaltyElement: "Earth",
      amount: 300,
      penaltyAmount: -200,
      duration: "whileFieldActive",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "legendary",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  magic(
    "chronicle-chakra-ledger",
    "Chakra Ledger",
    "/chronicle/cards/chronicle-chakra-ledger.webp",
    "A quartermaster's coded account reveals one prepared resource at the decisive moment.",
    "normal",
    "Return one Jutsu Card from your Graveyard to your hand.",
    {
      kind: "recoverOneGraveyardCard",
      legalController: "owner",
      targetScope: "ownGraveyardMagic",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "common",
      effectTier: "advanced",
    },
  ),
  magic(
    "chronicle-forbidden-archive",
    "Forbidden Archive",
    "/chronicle/cards/chronicle-forbidden-archive.webp",
    "A sealed vault of battle records yields dangerous knowledge to the shinobi willing to open it.",
    "normal",
    "Draw 3 cards, then discard 2 random cards.",
    {
      kind: "drawThenDiscardRandom",
      legalController: "owner",
      targetScope: "none",
      amount: 3,
      penaltyAmount: 2,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "legendary",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  magic(
    "chronicle-healers-reserve",
    "Healer's Reserve",
    "/chronicle/cards/chronicle-healers-reserve.webp",
    "A hidden field kit restores a commander before the formation collapses.",
    "normal",
    "Gain 1,000 Health Points.",
    {
      kind: "healLifePoints",
      legalController: "owner",
      targetScope: "none",
      amount: 1_000,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  magic(
    "chronicle-war-camp-feast",
    "War-Camp Feast",
    "/chronicle/cards/chronicle-war-camp-feast.webp",
    "A hard-earned meal rallies the whole command after a punishing march.",
    "normal",
    "Each player with cards discards 1 random card, then draws 1 card.",
    {
      kind: "cycleBothHands",
      legalController: "owner",
      targetScope: "none",
      amount: 1,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "epic", effectTier: "advanced", deckLimit: 2 },
  ),
  magic(
    "chronicle-flame-tempered-blade",
    "Flame-Tempered Blade",
    "/chronicle/cards/chronicle-flame-tempered-blade.webp",
    "A blacksmith seals banked fire into a blade that burns brighter with every clash.",
    "equip",
    "The equipped Monster gains 500 ATK but loses 300 DEF.",
    {
      kind: "modifyAttackAndDefense",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 500,
      penaltyAmount: -300,
      duration: "whileEquipped",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  magic(
    "chronicle-stormforged-senbon",
    "Stormforged Senbon",
    "/chronicle/cards/chronicle-stormforged-senbon.webp",
    "Lightning-forged needles turn one combatant's opening into a lethal advance.",
    "equip",
    "The equipped Monster gains 600 ATK.",
    {
      kind: "modifyAttackUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 600,
      duration: "whileEquipped",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "epic", effectTier: "advanced", deckLimit: 2 },
  ),
  magic(
    "chronicle-stoneplate-harness",
    "Stoneplate Harness",
    "/chronicle/cards/chronicle-stoneplate-harness.webp",
    "Interlocking earth plates settle around the wearer without slowing their seals.",
    "equip",
    "The equipped Monster gains 500 DEF. The first time it would be destroyed by battle, destroy this card instead.",
    {
      kind: "battleShieldEquip",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 500,
      duration: "whileEquipped",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  magic(
    "chronicle-tideguard-mantle",
    "Tideguard Mantle",
    "/chronicle/cards/chronicle-tideguard-mantle.webp",
    "Layered water-script cloth hardens at the instant an enemy strike lands.",
    "equip",
    "The equipped Monster gains 700 DEF.",
    {
      kind: "modifyDefenseUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 700,
      duration: "whileEquipped",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "epic", effectTier: "advanced", deckLimit: 2 },
  ),
  magic(
    "chronicle-foxfire-feint",
    "Foxfire Feint",
    "/chronicle/cards/chronicle-foxfire-feint.webp",
    "A false ember trail conceals the angle of one sudden finishing rush.",
    "normal",
    "One face-up Monster gains 500 ATK until the End Phase.",
    {
      kind: "modifyAttackUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 500,
      duration: "untilEndTurn",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  magic(
    "chronicle-iron-root-stance",
    "Iron-Root Stance",
    "/chronicle/cards/chronicle-iron-root-stance.webp",
    "A shinobi anchors their chakra through the ground and refuses to yield.",
    "normal",
    "One face-up Monster gains 600 DEF until the End Phase.",
    {
      kind: "modifyDefenseUntilEndTurn",
      legalController: "owner",
      targetScope: "ownedFaceUpMonster",
      amount: 600,
      duration: "untilEndTurn",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  magic(
    "chronicle-whirlwind-dismissal",
    "Whirlwind Dismissal",
    "/chronicle/cards/chronicle-whirlwind-dismissal.webp",
    "A focused gale strips a junior enemy out of the battle line.",
    "normal",
    "Return one face-up opponent Level 4 or lower Monster to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "opponentLevel4OrLowerMonster",
      cap: 4,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  magic(
    "chronicle-kage-exile-command",
    "Kage Exile Command",
    "/chronicle/cards/chronicle-kage-exile-command.webp",
    "A Kage's black-sealed writ removes even a veteran from the formation.",
    "normal",
    "Return one opponent Monster to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "opponentMonster",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "legendary", effectTier: "advanced", deckLimit: 1 },
  ),
  magic(
    "chronicle-grave-lantern-rite",
    "Grave-Lantern Rite",
    "/chronicle/cards/chronicle-grave-lantern-rite.webp",
    "Blue lanterns guide a lost landscape seal back from the Graveyard.",
    "normal",
    "Return one Field Jutsu Card from your Graveyard to your hand.",
    {
      kind: "recoverOneGraveyardCard",
      legalController: "owner",
      targetScope: "ownGraveyardFieldMagic",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "rare", effectTier: "advanced", deckLimit: 2 },
  ),
  magic(
    "chronicle-ancestral-muster",
    "Ancestral Muster",
    "/chronicle/cards/chronicle-ancestral-muster.webp",
    "The village drums call a fallen protector back to the line.",
    "normal",
    "Revive one Level 4 or lower Monster from your Graveyard in Defense Position.",
    {
      kind: "reviveLevel4OrLowerMonster",
      legalController: "owner",
      targetScope: "ownGraveyardLevel4OrLowerMonster",
      cap: 4,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "epic", effectTier: "advanced", deckLimit: 1 },
  ),
  magic(
    "chronicle-rift-cleaving-script",
    "Rift-Cleaving Script",
    "/chronicle/cards/chronicle-rift-cleaving-script.webp",
    "A narrow dimensional cut erases one lesser enemy before the line closes.",
    "normal",
    "Destroy one face-up opponent Level 4 or lower Monster.",
    {
      kind: "destroyOneMonster",
      legalController: "owner",
      targetScope: "opponentLevel4OrLowerMonster",
      cap: 4,
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  magic(
    "chronicle-executioners-mandate",
    "Executioner's Mandate",
    "/chronicle/cards/chronicle-executioners-mandate.webp",
    "A crimson decree marks every combatant on the battlefield for immediate removal.",
    "normal",
    "Destroy all Monsters on the field.",
    {
      kind: "destroyAllMonsters",
      legalController: "owner",
      targetScope: "none",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "legendary",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  magic(
    "chronicle-shrine-purge",
    "Shrine Purge",
    "/chronicle/cards/chronicle-shrine-purge.webp",
    "A ring of white flame consumes one hostile script without harming the shrine.",
    "normal",
    "Destroy the active Field Jutsu Card.",
    {
      kind: "destroyActiveField",
      legalController: "owner",
      targetScope: "none",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  magic(
    "chronicle-storm-shear",
    "Storm Shear",
    "/chronicle/cards/chronicle-storm-shear.webp",
    "A razor cyclone strips every prepared technique from both formations.",
    "normal",
    "Destroy all Jutsu and Snare Cards on the field.",
    {
      kind: "destroyAllMagicTraps",
      legalController: "owner",
      targetScope: "none",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  magic(
    "chronicle-hall-of-mirrors",
    "Hall of Mirrors",
    "/chronicle/cards/chronicle-hall-of-mirrors.webp",
    "A corridor of reflected movements forces one enemy into the wrong stance.",
    "normal",
    "Change one face-up opponent Monster's battle position.",
    {
      kind: "changeOneMonsterPosition",
      legalController: "owner",
      targetScope: "opponentMonster",
      duration: "instant",
      originatingActionContinues: true,
      order: 10,
    },
    { rarity: "rare", effectTier: "advanced", deckLimit: 2 },
  ),
  trap(
    "chronicle-smoke-bomb",
    "Smoke Bomb",
    "/scenes/story/story-road-border-smoke.webp",
    "A hidden emergency escape tool that erupts as an incoming attack cuts through empty smoke.",
    "When an attack is declared: negate that attack.",
    {
      kind: "negateOneAttack",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
  ),
  trap(
    "chronicle-substitution-log",
    "Substitution Log",
    "/legacy/jutsu/vanish-step.webp",
    "A concealed replacement prepared before the enemy commits to a strike.",
    "When an attack is declared: return that attacker to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
  ),
  trap(
    "chronicle-explosive-tag",
    "Explosive Tag Ambush",
    "/legacy/jutsu/first-light-detonation.webp",
    "A buried tag line waits for an advancing lesser combatant.",
    "When a Level 4 or lower Monster attacks: destroy that attacker.",
    {
      kind: "destroyOneMonster",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      cap: 4,
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
  ),
  trap(
    "chronicle-sealing-circle",
    "Sealing Circle",
    "/scenes/story/story-road-four-seals-one-gate.webp",
    "A prepared village seal closes around a newly arrived lesser foe.",
    "When a Level 4 or lower Monster is Summoned: return it to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      cap: 4,
      duration: "instant",
      originatingActionContinues: true,
      order: 20,
    },
  ),
  trap(
    "chronicle-mirror-shell-counter",
    "Mirror-Shell Counter",
    "/combat-vfx/reflect.webp",
    "A polished barrier reflects one committed assault across the entire attacking formation.",
    "When an attack is declared: destroy all Attack Position Monsters your opponent controls.",
    {
      kind: "destroyAllAttackPositionMonsters",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
    {
      rarity: "legendary",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  trap(
    "chronicle-returning-cylinder-seal",
    "Returning Cylinder Seal",
    "/combat-vfx/absorb.webp",
    "A hollow seal swallows the incoming strike and redirects its full force at the enemy commander.",
    "When an attack is declared: negate that attack, then inflict damage to your opponent equal to the attacker's ATK.",
    {
      kind: "negateAttackAndInflictDamage",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  trap(
    "chronicle-pitfall-tag-array",
    "Pitfall Tag Array",
    "/legacy/jutsu/demons-opening.webp",
    "A ring of buried tags detonates beneath a newly deployed lesser fighter.",
    "When a Level 4 or lower Monster is Summoned: destroy it.",
    {
      kind: "destroyOneMonster",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      cap: 4,
      duration: "instant",
      originatingActionContinues: false,
      order: 20,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  trap(
    "chronicle-abyssal-pitfall",
    "Abyssal Pitfall",
    "/chronicle/cards/chronicle-abyssal-pitfall.webp",
    "A deeper prepared breach can swallow even a one-Tribute combatant.",
    "When a Level 6 or lower Monster is Summoned: destroy it.",
    {
      kind: "destroyOneMonster",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      cap: 6,
      duration: "instant",
      originatingActionContinues: false,
      order: 20,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  trap(
    "chronicle-torrential-tag-field",
    "Torrential Tag Field",
    "/legacy/jutsu/overflow-torrent.webp",
    "A flood-linked seal network erupts beneath every combatant when a new fighter enters.",
    "When a Monster is Summoned: destroy all Monsters on the field.",
    {
      kind: "destroyAllMonsters",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      duration: "instant",
      originatingActionContinues: false,
      order: 20,
    },
    {
      rarity: "legendary",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  trap(
    "chronicle-kage-judgment-seal",
    "Kage Judgment Seal",
    "/legacy/jutsu/founders-injunction.webp",
    "The founder's hidden injunction voids one enemy technique at the instant of release.",
    "When an opponent activates a Jutsu Card: pay 1500 Health Points; negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      healthCost: 1500,
      duration: "instant",
      originatingActionContinues: false,
      order: 1,
    },
    {
      rarity: "legendary",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  trap(
    "chronicle-chakra-jammer",
    "Chakra Jammer",
    "/chronicle/cards/chronicle-chakra-jammer.webp",
    "A disruptive tag scrambles the shaping pattern of an enemy technique.",
    "When an opponent activates a Jutsu Card: discard 1 random card; negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      discardCost: 1,
      duration: "instant",
      originatingActionContinues: false,
      order: 2,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  trap(
    "chronicle-counter-script-cache",
    "Counter-Script Cache",
    "/legacy/jutsu/house-rules.webp",
    "A prepared ruleset closes the loophole an invading technique expected to exploit.",
    "When Jutsu targets exactly 1 Monster: discard 1 random card; negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      requiresMagicMonsterTarget: true,
      discardCost: 1,
      duration: "instant",
      originatingActionContinues: false,
      order: 3,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
    },
  ),
  trap(
    "chronicle-imperial-silence-ward",
    "Imperial Silence Ward",
    "/legacy/jutsu/empire-of-silence.webp",
    "A sovereign barrier forbids one opposing technique from taking form.",
    "When an opponent activates an Equip Jutsu Card: negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      requiresMagicType: "equip",
      duration: "instant",
      originatingActionContinues: false,
      order: 1,
    },
    {
      rarity: "legendary",
      effectTier: "advanced",
    },
  ),
  trap(
    "chronicle-still-water-rebuttal",
    "Still-Water Rebuttal",
    "/legacy/jutsu/still-water-gaze.webp",
    "A perfectly calm counter-seal unthreads one incoming technique.",
    "When an opponent activates a Jutsu Card that would draw cards: negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      requiresMagicKind: "drawCards",
      duration: "instant",
      originatingActionContinues: false,
      order: 3,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
    },
  ),
  trap(
    "chronicle-substitution-mirror",
    "Substitution Mirror",
    "/legacy/jutsu/false-opening.webp",
    "A false opening leaves the attacker chasing its own retreating reflection.",
    "When an attack is declared: return that attacker to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  trap(
    "chronicle-widespread-kunai-line",
    "Widespread Kunai Line",
    "/legacy/jutsu/duelists-riposte.webp",
    "Crossed wire and concealed blades punish the first attacker through the pass.",
    "When an attack is declared: destroy that attacker.",
    {
      kind: "destroyOneMonster",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  trap(
    "chronicle-wall-of-smoke",
    "Wall of Smoke",
    "/chronicle/cards/chronicle-wall-of-smoke.webp",
    "A prepared smoke curtain steals the attacker's line of sight.",
    "When an attack is declared: that attacker loses 500 ATK until the end of the turn.",
    {
      kind: "modifyAttackUntilEndTurn",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "untilEndTurn",
      amount: -500,
      originatingActionContinues: true,
      order: 5,
    },
    {
      rarity: "common",
      effectTier: "advanced",
    },
  ),
  trap(
    "chronicle-stone-clone-barrier",
    "Stone Clone Barrier",
    "/legacy/jutsu/oathkeepers-guard.webp",
    "A hidden earth clone rises between the attacker and its target.",
    "When your Defense Position Monster is attacked: it gains DEF equal to half the attacker's ATK until the End Phase.",
    {
      kind: "borrowAttackerDefense",
      legalController: "owner",
      targetScope: "triggerBattleTarget",
      trigger: "onAttackDeclared",
      duration: "untilEndTurn",
      originatingActionContinues: true,
      order: 5,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
    },
  ),
  trap(
    "chronicle-gatekeepers-rebuke",
    "Gatekeeper's Rebuke",
    "/legacy/jutsu/hearthfire-ward.webp",
    "A threshold seal rejects a lesser intruder before it can settle into formation.",
    "When a Level 4 or lower Monster is Summoned: return it to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      cap: 4,
      duration: "instant",
      originatingActionContinues: false,
      order: 20,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
      deckLimit: 2,
    },
  ),
  trap(
    "chronicle-final-trial-binding",
    "Final-Trial Binding",
    "/legacy/jutsu/final-trial.webp",
    "A senior examiner's hidden seal expels even a one-Tribute arrival.",
    "When a Level 6 or lower Monster is Summoned: return it to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      cap: 6,
      duration: "instant",
      originatingActionContinues: false,
      order: 20,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  trap(
    "chronicle-ringed-detonation",
    "Ringed Detonation",
    "/chronicle/cards/chronicle-ringed-detonation.webp",
    "Concentric explosive tags close around the first committed attacker and burn both commanders through the link.",
    "When an attack is declared: destroy that attacker, then both players take damage equal to its ATK.",
    {
      kind: "destroyAttackerAndDamageBoth",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  trap(
    "chronicle-long-watch",
    "Long Watch",
    "/legacy/jutsu/long-watch.webp",
    "A patient sentry interrupts the one attack the enemy thought unobserved.",
    "When an opponent declares a direct attack: Special Summon the Level 4 or lower Monster with the highest DEF from your hand in Defense Position, then make it the attack target.",
    {
      kind: "summonDefenderFromHand",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      cap: 4,
      duration: "instant",
      originatingActionContinues: true,
      order: 5,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
    },
  ),
  trap(
    "chronicle-hearthfire-expulsion",
    "Hearthfire Expulsion",
    "/legacy/jutsu/immovable-oath.webp",
    "A village oath flares beneath a newly arrived enemy and casts it out.",
    "When a Monster is Summoned: return it to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      duration: "instant",
      originatingActionContinues: false,
      order: 20,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  trap(
    "chronicle-reapers-toll",
    "Reaper's Toll",
    "/legacy/jutsu/reapers-toll.webp",
    "A moonlit execution mark waits until an attacker crosses the final line.",
    "When an opponent's Monster attacks your Monster: if your Monster is destroyed by that battle, destroy the attacker after damage calculation.",
    {
      kind: "destroyAttackerIfTargetDestroyed",
      legalController: "owner",
      targetScope: "triggerBattleTarget",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: true,
      order: 5,
    },
    {
      rarity: "legendary",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  trap(
    "chronicle-palm-ward",
    "Palm Ward",
    "/legacy/jutsu/palm-ward.webp",
    "A concealed palm seal catches a strike at the moment of impact.",
    "When an attack is declared: change that attacker to Defense Position and end the attack.",
    {
      kind: "changeOneMonsterPosition",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
    {
      rarity: "rare",
      effectTier: "advanced",
    },
  ),
  trap(
    "chronicle-sovereigns-decree",
    "Sovereign's Decree",
    "/legacy/jutsu/sovereigns-decree.webp",
    "A hidden royal script rejects one technique that would alter the field.",
    "When an opponent activates a Field Jutsu Card: negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      requiresMagicType: "field",
      duration: "instant",
      originatingActionContinues: false,
      order: 1,
    },
    {
      rarity: "epic",
      effectTier: "advanced",
      deckLimit: 1,
    },
  ),
  trap(
    "chronicle-ashen-veil",
    "Ashen Veil",
    "/chronicle/cards/chronicle-ashen-veil.webp",
    "A curtain of hot ash blinds the enemy at the instant of commitment.",
    "When an attack is declared: negate that attack.",
    {
      kind: "negateOneAttack",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
    { rarity: "common", effectTier: "advanced" },
  ),
  trap(
    "chronicle-floodgate-mist",
    "Floodgate Mist",
    "/chronicle/cards/chronicle-floodgate-mist.webp",
    "A bank of chakra-thick mist erases the attacker's line of sight.",
    "When your opponent declares their second or later attack this Battle Phase while you control at least 2 Defense Position Monsters: end the Battle Phase.",
    {
      kind: "endBattlePhase",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
    { rarity: "rare", effectTier: "advanced", deckLimit: 2 },
  ),
  trap(
    "chronicle-sand-coffin-counter",
    "Sand-Coffin Counter",
    "/chronicle/cards/chronicle-sand-coffin-counter.webp",
    "Compressed desert sand closes around an attacker before the strike lands.",
    "When an opponent declares an attack while they control more Monsters than you: destroy their face-up Monster with the lowest ATK.",
    {
      kind: "destroyLowestAttackWhenOutnumbered",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: true,
      order: 5,
    },
    { rarity: "epic", effectTier: "advanced", deckLimit: 2 },
  ),
  trap(
    "chronicle-gale-reversal",
    "Gale Reversal",
    "/chronicle/cards/chronicle-gale-reversal.webp",
    "A reversed pressure wave hurls the advancing enemy out of formation.",
    "When an attack is declared: return that attacker to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
    { rarity: "rare", effectTier: "advanced", deckLimit: 2 },
  ),
  trap(
    "chronicle-thunder-cage",
    "Thunder Cage",
    "/chronicle/cards/chronicle-thunder-cage.webp",
    "Four charged pylons close a lightning prison around the first aggressor.",
    "When an attack is declared: the attacker loses 700 ATK until the End Phase. The attack continues.",
    {
      kind: "modifyAttackUntilEndTurn",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      amount: -700,
      duration: "instant",
      originatingActionContinues: true,
      order: 5,
    },
    { rarity: "legendary", effectTier: "advanced", deckLimit: 1 },
  ),
  trap(
    "chronicle-moonshadow-slip",
    "Moonshadow Slip",
    "/chronicle/cards/chronicle-moonshadow-slip.webp",
    "A false silhouette lures an attacker through a gate and away from battle.",
    "When your Monster is attacked: redirect the attack to your other Monster with the highest DEF.",
    {
      kind: "redirectAttackToHighestDefense",
      legalController: "owner",
      targetScope: "triggerBattleTarget",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: true,
      order: 5,
    },
    { rarity: "epic", effectTier: "advanced" },
  ),
  trap(
    "chronicle-ironwood-bulwark",
    "Ironwood Bulwark",
    "/chronicle/cards/chronicle-ironwood-bulwark.webp",
    "A prepared forest wall erupts between the formation and the incoming blade.",
    "When your face-up Attack Position Monster is attacked: change it to Defense Position, and the attacker loses 300 ATK until the End Phase.",
    {
      kind: "defensiveFeint",
      legalController: "owner",
      targetScope: "triggerBattleTarget",
      trigger: "onAttackDeclared",
      amount: -300,
      duration: "untilEndTurn",
      originatingActionContinues: true,
      order: 5,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  trap(
    "chronicle-tidal-deflection",
    "Tidal Deflection",
    "/chronicle/cards/chronicle-tidal-deflection.webp",
    "A concealed water seal bends the attacking path safely around its target.",
    "When your Monster is attacked: it gains 500 DEF until the end of the turn.",
    {
      kind: "modifyDefenseUntilEndTurn",
      legalController: "owner",
      targetScope: "triggerBattleTarget",
      trigger: "onAttackDeclared",
      amount: 500,
      duration: "untilEndTurn",
      originatingActionContinues: true,
      order: 5,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  trap(
    "chronicle-cinder-minefield",
    "Cinder Minefield",
    "/chronicle/cards/chronicle-cinder-minefield.webp",
    "A junior attacker crosses a buried seam of ember tags and vanishes in the blast.",
    "When a Level 4 or lower Monster attacks: destroy that attacker.",
    {
      kind: "destroyOneMonster",
      legalController: "owner",
      targetScope: "triggerAttacker",
      trigger: "onAttackDeclared",
      cap: 4,
      duration: "instant",
      originatingActionContinues: false,
      order: 5,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  trap(
    "chronicle-avalanche-seal",
    "Avalanche Seal",
    "/chronicle/cards/chronicle-avalanche-seal.webp",
    "A mountain mark releases a crushing wall of ice above the advancing enemy.",
    "During an attack on your Defense Position Monster: it gains DEF equal to half the attacker's current ATK until the End Phase.",
    {
      kind: "borrowAttackerDefense",
      legalController: "owner",
      targetScope: "triggerBattleTarget",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: true,
      order: 5,
    },
    { rarity: "epic", effectTier: "advanced", deckLimit: 1 },
  ),
  trap(
    "chronicle-scorpion-wire",
    "Scorpion Wire",
    "/chronicle/cards/chronicle-scorpion-wire.webp",
    "Barbed chakra wire catches the attacker and snaps it back across the line.",
    "When your face-up Attack Position Monster is attacked: change it to Defense Position, and the attacker loses 300 ATK until the End Phase.",
    {
      kind: "defensiveFeint",
      legalController: "owner",
      targetScope: "triggerBattleTarget",
      trigger: "onAttackDeclared",
      amount: -300,
      duration: "instant",
      originatingActionContinues: true,
      order: 5,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  trap(
    "chronicle-skyhook-snare",
    "Skyhook Snare",
    "/chronicle/cards/chronicle-skyhook-snare.webp",
    "A wind-rigged hook catches the aggressor and carries it beyond the battlefield.",
    "When your Monster is attacked: redirect the attack to your other Monster with the highest DEF.",
    {
      kind: "redirectAttackToHighestDefense",
      legalController: "owner",
      targetScope: "triggerBattleTarget",
      trigger: "onAttackDeclared",
      duration: "instant",
      originatingActionContinues: true,
      order: 5,
    },
    { rarity: "epic", effectTier: "advanced", deckLimit: 2 },
  ),
  trap(
    "chronicle-earthen-grave-array",
    "Earthen Grave Array",
    "/chronicle/cards/chronicle-earthen-grave-array.webp",
    "Stone jaws rise beneath a newly summoned junior combatant.",
    "When a Level 4 or lower Monster is Summoned: it loses 800 ATK and cannot change its battle position until the End Phase.",
    {
      kind: "weakenSummonedMonster",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      cap: 4,
      amount: 800,
      duration: "instant",
      originatingActionContinues: true,
      order: 20,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  trap(
    "chronicle-flash-burial-tag",
    "Flash-Burial Tag",
    "/chronicle/cards/chronicle-flash-burial-tag.webp",
    "A flash seal detonates under a lesser arrival before it finds its stance.",
    "When a Level 4 or lower Monster is Summoned: change it to face-down Defense Position. It cannot be Flip Summoned or change its battle position through its controller's next turn.",
    {
      kind: "sealSummonedMonsterFaceDown",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      cap: 4,
      duration: "instant",
      originatingActionContinues: true,
      order: 20,
    },
    { rarity: "rare", effectTier: "advanced", deckLimit: 2 },
  ),
  trap(
    "chronicle-great-maw-seal",
    "Great-Maw Seal",
    "/chronicle/cards/chronicle-great-maw-seal.webp",
    "A forbidden beast-script opens beneath even a one-Tribute combatant.",
    "When a Level 6 or lower Monster is Summoned: destroy it.",
    {
      kind: "destroyOneMonster",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      cap: 6,
      duration: "instant",
      originatingActionContinues: false,
      order: 20,
    },
    { rarity: "epic", effectTier: "advanced", deckLimit: 1 },
  ),
  trap(
    "chronicle-heavenfall-verdict",
    "Heavenfall Verdict",
    "/chronicle/cards/chronicle-heavenfall-verdict.webp",
    "A pillar of judgment descends on any enemy bold enough to enter the field.",
    "When a Monster is Summoned: destroy it.",
    {
      kind: "destroyOneMonster",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      duration: "instant",
      originatingActionContinues: false,
      order: 20,
    },
    { rarity: "legendary", effectTier: "advanced", deckLimit: 1 },
  ),
  trap(
    "chronicle-undertow-gate",
    "Undertow Gate",
    "/chronicle/cards/chronicle-undertow-gate.webp",
    "A hidden current drags a newly summoned junior back beyond the formation.",
    "When a Level 4 or lower Monster is Summoned: return it to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      cap: 4,
      duration: "instant",
      originatingActionContinues: false,
      order: 20,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  trap(
    "chronicle-dust-exile",
    "Dust Exile",
    "/chronicle/cards/chronicle-dust-exile.webp",
    "A spiraling desert seal ejects even a one-Tribute arrival from the arena.",
    "When a Level 6 or lower Monster is Summoned: return it to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      cap: 6,
      duration: "instant",
      originatingActionContinues: false,
      order: 20,
    },
    { rarity: "epic", effectTier: "advanced", deckLimit: 1 },
  ),
  trap(
    "chronicle-vacuum-prison",
    "Vacuum Prison",
    "/chronicle/cards/chronicle-vacuum-prison.webp",
    "A sphere of empty air captures any new arrival and removes it from the line.",
    "When a Monster is Summoned: return it to its owner's hand.",
    {
      kind: "returnOneMonsterToHand",
      legalController: "owner",
      targetScope: "triggerMonster",
      trigger: "onMonsterSummoned",
      duration: "instant",
      originatingActionContinues: false,
      order: 20,
    },
    { rarity: "legendary", effectTier: "advanced", deckLimit: 1 },
  ),
  trap(
    "chronicle-ember-cipher",
    "Ember Cipher",
    "/chronicle/cards/chronicle-ember-cipher.webp",
    "A burning counter-script consumes an enemy technique while it is still being shaped.",
    "When an opponent activates a Normal Jutsu Card: negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      requiresMagicType: "normal",
      duration: "instant",
      originatingActionContinues: false,
      order: 2,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  trap(
    "chronicle-drowned-formula",
    "Drowned Formula",
    "/chronicle/cards/chronicle-drowned-formula.webp",
    "A waterlogged seal dissolves the pattern of an activated technique.",
    "When an opponent activates an Equip Jutsu Card: negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      requiresMagicType: "equip",
      duration: "instant",
      originatingActionContinues: false,
      order: 2,
    },
    { rarity: "rare", effectTier: "advanced" },
  ),
  trap(
    "chronicle-grounding-rod-script",
    "Grounding-Rod Script",
    "/chronicle/cards/chronicle-grounding-rod-script.webp",
    "A buried iron seal grounds hostile chakra before the technique resolves.",
    "When an opponent activates a Field Jutsu Card: negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      requiresMagicType: "field",
      duration: "instant",
      originatingActionContinues: false,
      order: 2,
    },
    { rarity: "epic", effectTier: "advanced" },
  ),
  trap(
    "chronicle-windless-edict",
    "Windless Edict",
    "/chronicle/cards/chronicle-windless-edict.webp",
    "A still-air decree denies the motion an enemy technique needs to form.",
    "When an opponent activates a Jutsu Card that changes ATK: negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      requiresMagicKind: "modifyAttackUntilEndTurn",
      duration: "instant",
      originatingActionContinues: false,
      order: 2,
    },
    { rarity: "epic", effectTier: "advanced" },
  ),
  trap(
    "chronicle-mirror-moon-rebuttal",
    "Mirror-Moon Rebuttal",
    "/chronicle/cards/chronicle-mirror-moon-rebuttal.webp",
    "A reflected moon seal turns an enemy technique back into inert ink.",
    "When an opponent activates a Jutsu Card: negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      duration: "instant",
      originatingActionContinues: false,
      order: 1,
    },
    { rarity: "legendary", effectTier: "advanced", deckLimit: 1 },
  ),
  trap(
    "chronicle-kage-archive-lock",
    "Kage Archive Lock",
    "/chronicle/cards/chronicle-kage-archive-lock.webp",
    "A classified prohibition closes around one forbidden technique at activation.",
    "When an opponent activates a Jutsu Card that would draw cards: negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      requiresMagicKind: "drawCards",
      duration: "instant",
      originatingActionContinues: false,
      order: 1,
    },
    { rarity: "legendary", effectTier: "advanced", deckLimit: 2 },
  ),
  trap(
    "chronicle-five-seal-denial",
    "Five-Seal Denial",
    "/chronicle/cards/chronicle-five-seal-denial.webp",
    "Five village scripts converge to erase an activated technique from the field.",
    "When an opponent activates a Jutsu Card: negate it and send it to the Graveyard.",
    {
      kind: "destroyOneMagicTrap",
      legalController: "owner",
      targetScope: "none",
      trigger: "onMagicActivated",
      duration: "instant",
      originatingActionContinues: false,
      order: 1,
    },
    { rarity: "mythic", effectTier: "advanced", deckLimit: 1 },
  ),
];

export const CHRONICLE_SUPPORT_CARDS = Object.freeze(SUPPORT_CARDS.slice());
// Unique starter-card ids remain exported for catalog/filter compatibility.
// The exact quantity-aware grant is CHRONICLE_STARTER_GRANT_IDS below.
export const CHRONICLE_STARTER_MONSTER_IDS = Object.freeze([
  "tc-01",
  "tc-02",
  "tc-03",
  "tc-04",
  "tc-05",
  "tc-06",
  "tc-07",
  "tc-08",
  "tc-09",
  "tc-11",
  "tc-21",
  "tc-23",
  "tc-25",
  "tc-31",
  "tc-41",
  "tc-74",
  "tc-103",
  "tc-104",
  "tc-125",
  "tc-128",
]);
export const CHRONICLE_STARTER_CORE_IDS = Object.freeze([
  ...CHRONICLE_STARTER_MONSTER_IDS,
  ...SUPPORT_CARDS.filter((card) => card.effectTier === "starter").map(
    (card) => card.id,
  ),
]);
const MONSTER_CARDS = shinobiTileCards
  .map(monsterFromSource)
  .map(applyReviewedMonsterEffect);
const LEGACY_MONSTER_CARDS = CHRONICLE_LEGACY_SOURCES.map(
  monsterFromLegacy,
).map(applyReviewedMonsterEffect);
const STORY_MONSTER_CARDS = CHRONICLE_STORY_SOURCES.map(monsterFromStory).map(
  applyReviewedMonsterEffect,
);
function ensureChronicleArt(card: ChronicleCard): ChronicleCard {
  return card.image
    ? card
    : { ...card, image: `/chronicle/cards/${card.id}.webp` };
}
export const CHRONICLE_CARD_CATALOG: readonly ChronicleCard[] = Object.freeze(
  [
    ...MONSTER_CARDS,
    ...LEGACY_MONSTER_CARDS,
    ...STORY_MONSTER_CARDS,
    applyReviewedMonsterEffect(WANDERING_SAGE_CARD),
    ...SUPPORT_CARDS,
  ].map(ensureChronicleArt),
);
export const CHRONICLE_EFFECT_MONSTER_IDS = /* @__PURE__ */ Object.freeze(
  CHRONICLE_CARD_CATALOG.filter(
    (card): card is ChronicleMonsterCard =>
      card.cardClass === "monster" && card.monsterType === "effect",
  ).map((card) => card.id),
);
const CARD_BY_ID = new Map(
  CHRONICLE_CARD_CATALOG.map((card) => [card.id, card]),
);
export const CHRONICLE_FOUNDING_LIMITED_IDS = Object.freeze(
  CHRONICLE_CARD_CATALOG.filter((card) => card.deckLimit === 1).map(
    (card) => card.id,
  ),
);
export const CHRONICLE_FOUNDING_SEMI_LIMITED_IDS = Object.freeze(
  CHRONICLE_CARD_CATALOG.filter((card) => card.deckLimit === 2).map(
    (card) => card.id,
  ),
);

export function getChronicleCard(id: string): ChronicleCard | undefined {
  return CARD_BY_ID.get(id);
}

export function tributeCountForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > MAX_MONSTER_LEVEL)
    throw new RangeError("Monster Level must be 1-8.");
  return level <= 4 ? 0 : level <= 6 ? 1 : 2;
}

export function deckLimitForCard(id: string): number {
  return Math.min(
    MAX_COPIES_PER_CARD,
    getChronicleCard(id)?.deckLimit ?? MAX_COPIES_PER_CARD,
  );
}

export type ChronicleOwnership = ReadonlyMap<string, number>;

/** Convert the saved collection's repeated ids into server-verifiable counts. */
export function countChronicleCards(
  ids: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    if (!getChronicleCard(id)) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function ownedCopies(owned: ChronicleOwnership, id: string): number {
  return Math.max(0, Math.floor(owned.get(id) ?? 0));
}

export interface ChronicleDeckValidation {
  valid: boolean;
  errors: string[];
}

export function validateDeckIds(
  ids: readonly string[],
  ownedCards?: ChronicleOwnership,
): ChronicleDeckValidation {
  const errors: string[] = [];
  if (!Array.isArray(ids) || ids.length !== MAIN_DECK_SIZE)
    errors.push(`Main Deck must contain exactly ${MAIN_DECK_SIZE} cards.`);
  const counts = new Map<string, number>();
  for (const id of ids) {
    if (!getChronicleCard(id)) errors.push(`Unknown card: ${id}`);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of counts) {
    const limit = deckLimitForCard(id);
    if (count > limit) errors.push(`${id} exceeds its ${limit}-copy limit.`);
    if (ownedCards && count > ownedCopies(ownedCards, id))
      errors.push(
        `Only ${ownedCopies(ownedCards, id)} owned ${id} ${ownedCopies(ownedCards, id) === 1 ? "copy is" : "copies are"} available.`,
      );
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export const CHRONICLE_FIXED_FALLBACK_DECK: readonly string[] = Object.freeze([
  "tc-01",
  "tc-01",
  "tc-02",
  "tc-02",
  "tc-03",
  "tc-04",
  "tc-05",
  "tc-06",
  "tc-07",
  "tc-07",
  "tc-08",
  "tc-09",
  "tc-09",
  "tc-11",
  "tc-21",
  "tc-23",
  "tc-25",
  "tc-31",
  "tc-41",
  "tc-74",
  "tc-103",
  "tc-104",
  "tc-125",
  "tc-128",
  "chronicle-recon-scroll",
  "chronicle-recon-scroll",
  "chronicle-medical-salve",
  "chronicle-medical-salve",
  "chronicle-soldier-pill",
  "chronicle-soldier-pill",
  "chronicle-guard-stance",
  "chronicle-guard-stance",
  "chronicle-smoke-bomb",
  "chronicle-smoke-bomb",
  "chronicle-smoke-bomb",
  "chronicle-substitution-log",
  "chronicle-substitution-log",
  "chronicle-explosive-tag",
  "chronicle-explosive-tag",
  "chronicle-sealing-circle",
]);

/** Exact permanent starter grant. Repeated ids are real owned copies. */
export const CHRONICLE_STARTER_GRANT_IDS: readonly string[] = Object.freeze([
  ...CHRONICLE_FIXED_FALLBACK_DECK,
]);

/** Ownership counts with the permanent starter floor applied exactly once. */
export function countChronicleCardsWithStarter(
  ids: readonly string[],
): Map<string, number> {
  const counts = countChronicleCards(ids);
  for (const [id, required] of countChronicleCards(
    CHRONICLE_STARTER_GRANT_IDS,
  ))
    counts.set(id, Math.max(counts.get(id) ?? 0, required));
  return counts;
}

export function migrateLegacyDeck(
  savedIds: readonly string[],
  ownedIds: readonly string[],
  allowServerFallback = false,
): { deck: string[]; starterGrants: string[]; usedFallback: boolean } {
  const owned = ownedIds.filter((id) => Boolean(getChronicleCard(id)));
  const ownedCounts = countChronicleCards(owned);
  const requiredStarterCounts = countChronicleCards(CHRONICLE_STARTER_GRANT_IDS);
  const starterGrants: string[] = [];
  for (const [id, required] of requiredStarterCounts) {
    const current = ownedCounts.get(id) ?? 0;
    for (let count = current; count < required; count += 1)
      starterGrants.push(id);
  }
  const available = [...owned, ...starterGrants];
  const availableCounts = countChronicleCards(available);
  const deck: string[] = [];
  const counts = new Map<string, number>();
  const add = (id: string) => {
    if (
      deck.length >= MAIN_DECK_SIZE ||
      !getChronicleCard(id)
    )
      return;
    const count = counts.get(id) ?? 0;
    if (
      count >= deckLimitForCard(id) ||
      count >= (availableCounts.get(id) ?? 0)
    )
      return;
    deck.push(id);
    counts.set(id, count + 1);
  };
  savedIds.forEach(add);
  // Starter support first so migrated 12-card lists gain the intended 8/8 core.
  [
    "chronicle-recon-scroll",
    "chronicle-recon-scroll",
    "chronicle-medical-salve",
    "chronicle-medical-salve",
    "chronicle-soldier-pill",
    "chronicle-soldier-pill",
    "chronicle-guard-stance",
    "chronicle-guard-stance",
    "chronicle-smoke-bomb",
    "chronicle-smoke-bomb",
    "chronicle-smoke-bomb",
    "chronicle-substitution-log",
    "chronicle-substitution-log",
    "chronicle-explosive-tag",
    "chronicle-explosive-tag",
    "chronicle-sealing-circle",
  ].forEach(add);
  available
    .filter((id) => getChronicleCard(id)?.cardClass === "monster")
    .forEach(add);
  available
    .filter((id) => getChronicleCard(id)?.cardClass !== "monster")
    .forEach(add);
  if (deck.length < MAIN_DECK_SIZE && allowServerFallback)
    return {
      deck: [...CHRONICLE_FIXED_FALLBACK_DECK],
      starterGrants,
      usedFallback: true,
    };
  return { deck, starterGrants, usedFallback: false };
}

export interface ChronicleFieldMonster {
  instanceId: string;
  cardId: string;
  owner: ChronicleSideKey;
  zoneIndex: number;
  position: ChroniclePosition;
  faceUp: boolean;
  summonedOnTurn: number;
  lastPositionChangeTurn: number;
  lastAttackTurn: number;
  temporaryAttack: number;
  temporaryDefense: number;
  monsterEffectUsedTurn?: number;
  positionLockedUntilTurn?: number;
  attachedEquipId?: string;
}

export interface ChronicleMagicTrapZone {
  instanceId: string;
  cardId: string;
  owner: ChronicleSideKey;
  zoneIndex: number;
  faceUp: boolean;
  setOnTurn: number;
  equipTargetInstanceId?: string;
}

export interface ChronicleSide {
  name: string;
  deck: string[];
  hand: string[];
  monsterZones: Array<ChronicleFieldMonster | null>;
  magicTrapZones: Array<ChronicleMagicTrapZone | null>;
  graveyard: string[];
  lifePoints: number;
}

export interface ChronicleActionIntent {
  action: string;
  handIndex?: number;
  zoneIndex?: number;
  tributeZoneIndexes?: number[];
  attackerZoneIndex?: number;
  targetZoneIndex?: number | null;
  targetSide?: ChronicleSideKey;
  graveyardIndex?: number;
  position?: ChroniclePosition;
}

export interface ChronicleResponseWindow {
  id: string;
  trigger: ChronicleTrigger;
  responder: ChronicleSideKey;
  eligibleZoneIndexes: number[];
  openedAt: number;
  expiresAt: number;
  pendingAction: ChronicleActionIntent & { actor: ChronicleSideKey };
}

export interface ChronicleActiveField {
  cardId: string;
  fieldId: ChronicleFieldId;
  owner: ChronicleSideKey;
}

export interface ChronicleMatch {
  rulesVersion: typeof CHRONICLE_RULES_VERSION;
  turnNumber: number;
  firstPlayer: ChronicleSideKey;
  activePlayer: ChronicleSideKey;
  phase: ChroniclePhase;
  normalSummonUsed: boolean;
  responseWindow: ChronicleResponseWindow | null;
  activeField: ChronicleActiveField | null;
  p1: ChronicleSide;
  p2: ChronicleSide;
  status: "active" | "complete";
  winner: ChronicleSideKey | "draw" | null;
  log: string[];
  iidCounter: number;
  /** Persisted server RNG state. Keeping it in the match makes random effects
   * deterministic for replays, tests, and dispute audits. */
  rngState: number;
  turnStartedAt: number;
}

export type ChronicleResult =
  | { ok: true; state: ChronicleMatch }
  | { ok: false; state: ChronicleMatch; error: string };

function other(side: ChronicleSideKey): ChronicleSideKey {
  return side === "p1" ? "p2" : "p1";
}
function sideOf(state: ChronicleMatch, side: ChronicleSideKey): ChronicleSide {
  return state[side];
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
function emptyMonsterZones(): Array<null> {
  return Array.from({ length: MONSTER_ZONE_COUNT }, () => null);
}
function emptyMagicTrapZones(): Array<null> {
  return Array.from({ length: MAGIC_TRAP_ZONE_COUNT }, () => null);
}
function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function failure(state: ChronicleMatch, error: string): ChronicleResult {
  return { ok: false, state, error };
}
function success(state: ChronicleMatch): ChronicleResult {
  return { ok: true, state };
}
function nextIid(state: ChronicleMatch, prefix: string): string {
  return `${prefix}-${state.iidCounter++}`;
}
function nextRandom(state: ChronicleMatch): number {
  // Numerical Recipes LCG: inexpensive, deterministic, and sufficient for
  // hidden card selection. It is not used for secrets or authentication.
  state.rngState =
    (Math.imul(state.rngState >>> 0, 1_664_525) + 1_013_904_223) >>> 0;
  return state.rngState / 0x1_0000_0000;
}
function nextRandomIndex(state: ChronicleMatch, length: number): number {
  return length > 1 ? Math.floor(nextRandom(state) * length) : 0;
}
function validZone(index: unknown, count: number): index is number {
  return Number.isInteger(index) && Number(index) >= 0 && Number(index) < count;
}

export function createMatch(
  p1Name: string,
  p1DeckIds: readonly string[],
  p2Name: string,
  p2DeckIds: readonly string[],
  random: () => number = Math.random,
  now = Date.now(),
): ChronicleMatch {
  const p1Check = validateDeckIds(p1DeckIds);
  const p2Check = validateDeckIds(p2DeckIds);
  if (!p1Check.valid || !p2Check.valid)
    throw new Error(
      `Cannot create duel with invalid deck: ${[...p1Check.errors, ...p2Check.errors].join(" ")}`,
    );
  const firstPlayer: ChronicleSideKey = random() < 0.5 ? "p1" : "p2";
  const makeSide = (name: string, ids: readonly string[]): ChronicleSide => {
    const deck = shuffle(ids, random);
    return {
      name,
      hand: deck.splice(0, OPENING_HAND_SIZE),
      deck,
      monsterZones: emptyMonsterZones(),
      magicTrapZones: emptyMagicTrapZones(),
      graveyard: [],
      lifePoints: STARTING_LIFE_POINTS,
    };
  };
  const p1 = makeSide(p1Name, p1DeckIds);
  const p2 = makeSide(p2Name, p2DeckIds);
  const randomSeed =
    Math.floor(Math.max(0, Math.min(0.9999999999999999, random())) * 0x1_0000_0000) >>>
    0;
  const firstSide = firstPlayer === "p1" ? p1 : p2;
  firstSide.hand.push(firstSide.deck.shift()!);
  return {
    rulesVersion: CHRONICLE_RULES_VERSION,
    turnNumber: 1,
    firstPlayer,
    activePlayer: firstPlayer,
    phase: "draw",
    normalSummonUsed: false,
    responseWindow: null,
    activeField: null,
    p1,
    p2,
    status: "active",
    winner: null,
    log: [
      `${p1Name} and ${p2Name} draw five cards.`,
      `${firstSide.name} takes the first turn and draws in the Draw Phase.`,
    ],
    iidCounter: 1,
    rngState: randomSeed || 0x9e3779b9,
    turnStartedAt: now,
  };
}

function actionGuard(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  phases: ChroniclePhase[],
): string | null {
  if (state.rulesVersion !== CHRONICLE_RULES_VERSION)
    return "This duel used retired rules; start a new duel.";
  if (state.status !== "active") return "The duel is over.";
  if (state.responseWindow) return "A Snare response is waiting.";
  if (state.activePlayer !== actor) return "It is not your turn.";
  if (!phases.includes(state.phase))
    return "That action is not legal in this phase.";
  return null;
}

function cardInHand(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  handIndex: number,
): ChronicleCard | undefined {
  const id = sideOf(state, actor).hand[handIndex];
  return id ? getChronicleCard(id) : undefined;
}

function fieldAttackModifier(
  monster: ChronicleFieldMonster,
  activeField: ChronicleActiveField | null,
): number {
  if (!activeField) return 0;
  const card = getChronicleCard(monster.cardId);
  const field = FIELD_BY_ID.get(activeField.fieldId);
  if (!field || card?.cardClass !== "monster") return 0;
  if (card.element === field.boostElement) return field.attackBonus;
  if (card.element === field.penaltyElement) return field.attackPenalty;
  return 0;
}

function effectiveAttack(
  monster: ChronicleFieldMonster,
  activeField: ChronicleActiveField | null = null,
  state?: ChronicleMatch,
): number {
  const card = getChronicleCard(monster.cardId);
  if (!card || card.cardClass !== "monster") return 0;
  let effectAttack = 0;
  if (monster.faceUp && state) {
    if (card.monsterEffect?.kind === "gainAttackPerOpponentMonster") {
      effectAttack +=
        (card.monsterEffect.amount ?? 0) *
        sideOf(state, other(monster.owner)).monsterZones.filter(Boolean).length;
    }
    if (
      card.monsterEffect?.kind === "gainAttackWhileOnlyMonster" &&
      sideOf(state, monster.owner).monsterZones.filter(Boolean).length === 1
    )
      effectAttack += card.monsterEffect.amount ?? 0;
    for (const ally of sideOf(state, monster.owner).monsterZones) {
      if (!ally || !ally.faceUp || ally.instanceId === monster.instanceId)
        continue;
      const allyCard = getChronicleCard(ally.cardId);
      if (
        allyCard?.cardClass === "monster" &&
        allyCard.element === card.element &&
        allyCard.monsterEffect?.kind === "alliedElementAttackBoost"
      )
        effectAttack += allyCard.monsterEffect.amount ?? 0;
    }
  }
  return Math.max(
    0,
    card.attack +
      monster.temporaryAttack +
      effectAttack +
      fieldAttackModifier(monster, activeField),
  );
}

function effectiveDefense(monster: ChronicleFieldMonster): number {
  const card = getChronicleCard(monster.cardId);
  if (!card || card.cardClass !== "monster") return 0;
  return Math.max(0, card.defense + monster.temporaryDefense);
}

export function monsterAttack(
  monster: ChronicleFieldMonster,
  activeField: ChronicleActiveField | null = null,
  state?: ChronicleMatch,
): number {
  return effectiveAttack(monster, activeField, state);
}
export function monsterDefense(monster: ChronicleFieldMonster): number {
  return effectiveDefense(monster);
}

function detachEquip(
  state: ChronicleMatch,
  owner: ChronicleSideKey,
  monster: ChronicleFieldMonster,
): void {
  if (!monster.attachedEquipId) return;
  const side = sideOf(state, owner);
  const index = side.magicTrapZones.findIndex(
    (zone) => zone?.instanceId === monster.attachedEquipId,
  );
  if (index >= 0) {
    const zone = side.magicTrapZones[index]!;
    const equip = getChronicleCard(zone.cardId);
    if (equip?.cardClass === "magic") {
      if (equip.effect.kind === "modifyAttackUntilEndTurn")
        monster.temporaryAttack -= equip.effect.amount ?? 0;
      if (equip.effect.kind === "modifyDefenseUntilEndTurn")
        monster.temporaryDefense -= equip.effect.amount ?? 0;
      if (equip.effect.kind === "modifyAttackAndDefense") {
        monster.temporaryAttack -= equip.effect.amount ?? 0;
        monster.temporaryDefense -= equip.effect.penaltyAmount ?? 0;
      }
      if (equip.effect.kind === "battleShieldEquip")
        monster.temporaryDefense -= equip.effect.amount ?? 0;
    }
    side.graveyard.push(zone.cardId);
    side.magicTrapZones[index] = null;
  }
  delete monster.attachedEquipId;
}

function sendMonsterToGrave(
  state: ChronicleMatch,
  owner: ChronicleSideKey,
  zoneIndex: number,
): void {
  const side = sideOf(state, owner);
  const monster = side.monsterZones[zoneIndex];
  if (!monster) return;
  detachEquip(state, owner, monster);
  side.graveyard.push(monster.cardId);
  side.monsterZones[zoneIndex] = null;
}

function sendMagicTrapToGrave(
  state: ChronicleMatch,
  owner: ChronicleSideKey,
  zoneIndex: number,
): void {
  const side = sideOf(state, owner);
  const zone = side.magicTrapZones[zoneIndex];
  if (!zone) return;
  if (zone.equipTargetInstanceId) {
    const monster = side.monsterZones.find(
      (entry) => entry?.instanceId === zone.equipTargetInstanceId,
    );
    const equip = getChronicleCard(zone.cardId);
    if (monster && equip?.cardClass === "magic") {
      if (equip.effect.kind === "modifyAttackUntilEndTurn")
        monster.temporaryAttack -= equip.effect.amount ?? 0;
      if (equip.effect.kind === "modifyDefenseUntilEndTurn")
        monster.temporaryDefense -= equip.effect.amount ?? 0;
      if (equip.effect.kind === "modifyAttackAndDefense") {
        monster.temporaryAttack -= equip.effect.amount ?? 0;
        monster.temporaryDefense -= equip.effect.penaltyAmount ?? 0;
      }
      if (equip.effect.kind === "battleShieldEquip")
        monster.temporaryDefense -= equip.effect.amount ?? 0;
      delete monster.attachedEquipId;
    }
  }
  side.graveyard.push(zone.cardId);
  side.magicTrapZones[zoneIndex] = null;
}

function drawForMonsterEffect(
  state: ChronicleMatch,
  owner: ChronicleSideKey,
  amount: number,
  sourceName: string,
): void {
  const side = sideOf(state, owner);
  for (let index = 0; index < amount; index += 1) {
    if (side.deck.length === 0) {
      finish(
        state,
        other(owner),
        `${side.name} cannot draw for ${sourceName}'s effect.`,
      );
      return;
    }
    side.hand.push(side.deck.shift()!);
  }
  state.log.push(`${sourceName}'s effect lets ${side.name} draw ${amount}.`);
}

function applyStandaloneFlipEffect(
  state: ChronicleMatch,
  owner: ChronicleSideKey,
  card: ChronicleMonsterCard,
): void {
  const effect = card.monsterEffect;
  if (!effect || state.status !== "active") return;
  if (effect.kind === "drawOnFlip")
    drawForMonsterEffect(state, owner, effect.amount ?? 1, card.name);
  else if (effect.kind === "cycleHandsOnFlip") {
    for (const sideKey of [owner, other(owner)] as const) {
      drawForMonsterEffect(state, sideKey, effect.amount ?? 1, card.name);
      if (state.status !== "active") return;
    }
    for (const sideKey of [owner, other(owner)] as const) {
      const side = sideOf(state, sideKey);
      if (side.hand.length === 0) continue;
      const handIndex = nextRandomIndex(state, side.hand.length);
      const discardedId = side.hand.splice(handIndex, 1)[0];
      if (discardedId) side.graveyard.push(discardedId);
    }
  }
  else if (effect.kind === "healOnFlip") {
    const amount = effect.amount ?? 0;
    const side = sideOf(state, owner);
    side.lifePoints += amount;
    state.log.push(`${card.name}'s effect restores ${amount} Health Points.`);
  } else if (effect.kind === "destroyStrongestOpponentOnFlip") {
    const opponentKey = other(owner);
    const opponent = sideOf(state, opponentKey);
    const strongest = opponent.monsterZones
      .flatMap((monster, zoneIndex) => {
        if (!monster) return [];
        const targetCard = getChronicleCard(monster.cardId);
        if (targetCard?.cardClass !== "monster") return [];
        const combatValue = monster.faceUp
          ? effectiveAttack(monster, state.activeField, state)
          : targetCard.attack;
        return [{ zoneIndex, combatValue }];
      })
      .sort(
        (a, b) => b.combatValue - a.combatValue || a.zoneIndex - b.zoneIndex,
      )[0];
    if (strongest) {
      sendMonsterToGrave(state, opponentKey, strongest.zoneIndex);
      state.log.push(
        `${card.name}'s Flip effect destroys the opponent's strongest Monster.`,
      );
    }
  } else if (effect.kind === "changeStrongestOpponentPositionOnFlip") {
    const opponentKey = other(owner);
    const target = sideOf(state, opponentKey).monsterZones
      .flatMap((monster, zoneIndex) =>
        monster?.faceUp
          ? [
              {
                monster,
                zoneIndex,
                attack: effectiveAttack(monster, state.activeField, state),
              },
            ]
          : [],
      )
      .sort((a, b) => b.attack - a.attack || a.zoneIndex - b.zoneIndex)[0];
    if (target) {
      target.monster.position =
        target.monster.position === "attack" ? "defense" : "attack";
      target.monster.lastPositionChangeTurn = state.turnNumber;
      target.monster.positionLockedUntilTurn = state.turnNumber + 1;
    }
  } else if (effect.kind === "recoverMagicOnFlip") {
    const side = sideOf(state, owner);
    let graveyardIndex = -1;
    for (let index = side.graveyard.length - 1; index >= 0; index -= 1) {
      if (getChronicleCard(side.graveyard[index])?.cardClass === "magic") {
        graveyardIndex = index;
        break;
      }
    }
    if (graveyardIndex >= 0) {
      const recoveredId = side.graveyard.splice(graveyardIndex, 1)[0];
      side.hand.push(recoveredId);
      state.log.push(
        `${card.name}'s Flip effect returns ${getChronicleCard(recoveredId)?.name ?? "a Jutsu Card"} to the hand.`,
      );
    }
  }
}

function preventBattleDestruction(
  state: ChronicleMatch,
  monster: ChronicleFieldMonster,
): boolean {
  if (monster.attachedEquipId) {
    const side = sideOf(state, monster.owner);
    const equipIndex = side.magicTrapZones.findIndex(
      (zone) => zone?.instanceId === monster.attachedEquipId,
    );
    const equipZone = equipIndex >= 0 ? side.magicTrapZones[equipIndex] : null;
    const equipCard = equipZone ? getChronicleCard(equipZone.cardId) : undefined;
    if (
      equipCard?.cardClass === "magic" &&
      equipCard.effect.kind === "battleShieldEquip"
    ) {
      sendMagicTrapToGrave(state, monster.owner, equipIndex);
      state.log.push(
        `${equipCard.name} is destroyed instead of its equipped Monster.`,
      );
      return true;
    }
  }
  const card = monster.faceUp ? getChronicleCard(monster.cardId) : undefined;
  if (
    card?.cardClass !== "monster" ||
    card.monsterEffect?.kind !== "surviveBattleOncePerTurn" ||
    monster.monsterEffectUsedTurn === state.turnNumber
  )
    return false;
  monster.monsterEffectUsedTurn = state.turnNumber;
  state.log.push(`${card.name}'s effect prevents its battle destruction.`);
  return true;
}

function returnFieldMonsterToHand(
  state: ChronicleMatch,
  owner: ChronicleSideKey,
  instanceId: string,
): boolean {
  const side = sideOf(state, owner);
  const index = side.monsterZones.findIndex(
    (monster) => monster?.instanceId === instanceId,
  );
  const monster = index >= 0 ? side.monsterZones[index] : null;
  if (!monster) return false;
  detachEquip(state, owner, monster);
  side.hand.push(monster.cardId);
  side.monsterZones[index] = null;
  return true;
}

function moveBattleMonsterToDeckBottom(
  state: ChronicleMatch,
  owner: ChronicleSideKey,
  instanceId: string,
  cardId: string,
): void {
  const side = sideOf(state, owner);
  const fieldIndex = side.monsterZones.findIndex(
    (monster) => monster?.instanceId === instanceId,
  );
  if (fieldIndex >= 0) {
    const monster = side.monsterZones[fieldIndex];
    if (monster) detachEquip(state, owner, monster);
    side.monsterZones[fieldIndex] = null;
    side.deck.push(cardId);
    return;
  }
  const graveyardIndex = side.graveyard.lastIndexOf(cardId);
  if (graveyardIndex >= 0) {
    side.graveyard.splice(graveyardIndex, 1);
    side.deck.push(cardId);
  }
}

function applyDestroyedByBattleEffect(
  state: ChronicleMatch,
  owner: ChronicleSideKey,
  card: ChronicleMonsterCard,
  battleOpponentOwner: ChronicleSideKey,
  battleOpponentInstanceId: string,
): void {
  const effect = card.monsterEffect;
  if (!effect || state.status !== "active") return;
  if (effect.kind === "drawWhenDestroyedByBattle") {
    drawForMonsterEffect(state, owner, 1, card.name);
  } else if (effect.kind === "searchNormalWhenDestroyedByBattle") {
    const side = sideOf(state, owner);
    const deckIndex = side.deck.findIndex((id) => {
      const candidate = getChronicleCard(id);
      return (
        candidate?.cardClass === "monster" &&
        candidate.monsterType === "normal" &&
        candidate.level <= (effect.cap ?? 4) &&
        candidate.attack <= (effect.amount ?? 1_500)
      );
    });
    if (deckIndex >= 0) {
      const searchedId = side.deck.splice(deckIndex, 1)[0];
      side.hand.push(searchedId);
      state.log.push(
        `${card.name}'s effect adds ${getChronicleCard(searchedId)?.name ?? "a Normal Monster"} from the Deck to the hand.`,
      );
    }
  } else if (effect.kind === "returnBattleOpponentWhenDestroyed") {
    if (
      returnFieldMonsterToHand(
        state,
        battleOpponentOwner,
        battleOpponentInstanceId,
      )
    )
      state.log.push(
        `${card.name}'s effect returns the Monster it battled to its owner's hand.`,
      );
  } else if (effect.kind === "returnToDeckWhenDestroyed") {
    const side = sideOf(state, owner);
    const graveyardIndex = side.graveyard.lastIndexOf(card.id);
    if (graveyardIndex >= 0) {
      side.graveyard.splice(graveyardIndex, 1);
      side.deck.push(card.id);
      state.log.push(
        `${card.name}'s effect returns it to the bottom of the Deck.`,
      );
    }
  } else if (effect.kind === "recoverFieldMagicWhenDestroyedByBattle") {
    const side = sideOf(state, owner);
    let graveyardIndex = -1;
    for (let index = side.graveyard.length - 1; index >= 0; index -= 1) {
      const candidate = getChronicleCard(side.graveyard[index]);
      if (candidate?.cardClass === "magic" && candidate.magicType === "field") {
        graveyardIndex = index;
        break;
      }
    }
    if (graveyardIndex >= 0) {
      const recoveredId = side.graveyard.splice(graveyardIndex, 1)[0];
      side.hand.push(recoveredId);
      state.log.push(
        `${card.name} recovers a Field Jutsu Card.`,
      );
    }
  } else if (effect.kind === "reviveNormalWhenDestroyedByBattle") {
    const side = sideOf(state, owner);
    const openZone = side.monsterZones.findIndex((monster) => monster === null);
    let graveyardIndex = -1;
    for (let index = side.graveyard.length - 1; index >= 0; index -= 1) {
      const candidate = getChronicleCard(side.graveyard[index]);
      if (
        candidate?.cardClass === "monster" &&
        candidate.monsterType === "normal" &&
        candidate.level <= (effect.cap ?? 4)
      ) {
        graveyardIndex = index;
        break;
      }
    }
    if (openZone >= 0 && graveyardIndex >= 0) {
      const revivedId = side.graveyard.splice(graveyardIndex, 1)[0];
      side.monsterZones[openZone] = {
        instanceId: nextIid(state, "monster"),
        cardId: revivedId,
        owner,
        zoneIndex: openZone,
        position: "defense",
        faceUp: true,
        summonedOnTurn: state.turnNumber,
        lastPositionChangeTurn: state.turnNumber,
        lastAttackTurn: 0,
        temporaryAttack: 0,
        temporaryDefense: 0,
      };
      state.log.push(
        `${card.name}'s effect Special Summons ${getChronicleCard(revivedId)?.name ?? "a Normal Monster"}.`,
      );
    }
  }
}

function applyBattleDamageMonsterEffect(
  state: ChronicleMatch,
  owner: ChronicleSideKey,
  card: ChronicleMonsterCard,
): void {
  const effect = card.monsterEffect;
  if (!effect || state.status !== "active") return;
  if (effect.kind === "drawOnBattleDamage") {
    drawForMonsterEffect(state, owner, effect.amount ?? 1, card.name);
    return;
  }
  if (effect.kind === "discardOpponentCardOnBattleDamage") {
    const opponent = sideOf(state, other(owner));
    const amount = Math.min(effect.amount ?? 1, opponent.hand.length);
    for (let index = 0; index < amount; index += 1) {
      const handIndex = nextRandomIndex(state, opponent.hand.length);
      const discardedId = opponent.hand.splice(handIndex, 1)[0];
      if (discardedId) opponent.graveyard.push(discardedId);
    }
    if (amount > 0)
      state.log.push(
        `${card.name}'s effect forces ${opponent.name} to discard ${amount} random card${amount === 1 ? "" : "s"}.`,
      );
  }
}

function eligibleTrapZones(
  state: ChronicleMatch,
  responder: ChronicleSideKey,
  trigger: ChronicleTrigger,
  pending: ChronicleActionIntent,
): number[] {
  const side = sideOf(state, responder);
  const fieldSealsAllTraps = (["p1", "p2"] as const).some((sideKey) =>
    sideOf(state, sideKey).monsterZones.some((monster) => {
      if (!monster?.faceUp) return false;
      const monsterCard = getChronicleCard(monster.cardId);
      return (
        monsterCard?.cardClass === "monster" &&
        monsterCard.monsterEffect?.kind === "sealAllTraps"
      );
    }),
  );
  const pendingSummonSealsAllTraps =
    trigger === "onMonsterSummoned" &&
    (() => {
      const pendingCard = cardInHand(
        state,
        other(responder),
        Number(pending.handIndex),
      );
      return (
        pendingCard?.cardClass === "monster" &&
        pendingCard.monsterEffect?.kind === "sealAllTraps"
      );
    })();
  if (fieldSealsAllTraps || pendingSummonSealsAllTraps) return [];
  if (trigger === "onAttackDeclared") {
    const attackerIndex = Number(pending.attackerZoneIndex);
    const attacker = validZone(attackerIndex, MONSTER_ZONE_COUNT)
      ? sideOf(state, other(responder)).monsterZones[attackerIndex]
      : null;
    const attackerCard = attacker?.faceUp
      ? getChronicleCard(attacker.cardId)
      : undefined;
    if (
      attackerCard?.cardClass === "monster" &&
      attackerCard.monsterEffect?.kind === "sealAttackTraps"
    )
      return [];
  }
  return side.magicTrapZones.flatMap((zone, index) => {
    if (!zone || zone.faceUp || zone.setOnTurn >= state.turnNumber) return [];
    const card = getChronicleCard(zone.cardId);
    if (!card || card.cardClass !== "trap" || card.effect.trigger !== trigger)
      return [];
    const pendingMagic =
      trigger === "onMagicActivated"
        ? cardInHand(state, other(responder), Number(pending.handIndex))
        : undefined;
    if (
      card.effect.requiresMagicType &&
      (pendingMagic?.cardClass !== "magic" ||
        pendingMagic.magicType !== card.effect.requiresMagicType)
    )
      return [];
    if (
      card.effect.requiresMagicKind &&
      (pendingMagic?.cardClass !== "magic" ||
        (pendingMagic.effect.kind !== card.effect.requiresMagicKind &&
          !(
            card.effect.requiresMagicKind === "drawCards" &&
            pendingMagic.effect.kind === "drawThenDiscardRandom"
          ) &&
          !(
            card.effect.requiresMagicKind === "modifyAttackUntilEndTurn" &&
            pendingMagic.effect.kind === "modifyAttackAndDefense"
          )))
    )
      return [];
    if (
      card.effect.requiresMagicMonsterTarget &&
      (pendingMagic?.cardClass !== "magic" ||
        ![
          "ownedFaceUpMonster",
          "anyFaceUpMonster",
          "opponentMonster",
          "opponentLevel4OrLowerMonster",
        ].includes(pendingMagic.effect.targetScope))
    )
      return [];
    if (
      card.effect.healthCost &&
      side.lifePoints <= card.effect.healthCost
    )
      return [];
    if (card.effect.discardCost && side.hand.length < card.effect.discardCost)
      return [];
    if (
      card.effect.targetScope === "triggerBattleTarget" &&
      (pending.targetZoneIndex === null ||
        pending.targetZoneIndex === undefined ||
        !validZone(Number(pending.targetZoneIndex), MONSTER_ZONE_COUNT))
    )
      return [];
    if (trigger === "onAttackDeclared") {
      const targetIndex = Number(pending.targetZoneIndex);
      const battleTarget = validZone(targetIndex, MONSTER_ZONE_COUNT)
        ? side.monsterZones[targetIndex]
        : null;
      if (
        card.effect.kind === "borrowAttackerDefense" &&
        battleTarget?.position !== "defense"
      )
        return [];
      if (
        card.effect.kind === "defensiveFeint" &&
        (!battleTarget?.faceUp || battleTarget.position !== "attack")
      )
        return [];
      if (
        card.effect.kind === "redirectAttackToHighestDefense" &&
        (!battleTarget ||
          !side.monsterZones.some(
            (candidate) =>
              candidate && candidate.instanceId !== battleTarget.instanceId,
          ))
      )
        return [];
      if (
        card.effect.kind === "summonDefenderFromHand" &&
        (pending.targetZoneIndex !== null ||
          !side.monsterZones.some((candidate) => candidate === null) ||
          !side.hand.some((id) => {
            const candidate = getChronicleCard(id);
            return (
              candidate?.cardClass === "monster" &&
              candidate.level <= (card.effect.cap ?? 4)
            );
          }))
      )
        return [];
      if (
        card.effect.kind === "endBattlePhase" &&
        (side.monsterZones.filter(
          (candidate) => candidate?.position === "defense",
        ).length < 2 ||
          !sideOf(state, other(responder)).monsterZones.some(
            (candidate) => candidate?.lastAttackTurn === state.turnNumber,
          ))
      )
        return [];
      if (
        card.effect.kind === "destroyLowestAttackWhenOutnumbered" &&
        (sideOf(state, other(responder)).monsterZones.filter(Boolean).length <=
          side.monsterZones.filter(Boolean).length ||
          !sideOf(state, other(responder)).monsterZones.some(
            (candidate) => candidate?.faceUp,
          ))
      )
        return [];
      if (
        card.effect.kind === "destroyAttackerIfTargetDestroyed" &&
        !battleTarget
      )
        return [];
    }
    if (
      card.effect.requiresFaceUpElement &&
      !side.monsterZones.some((fieldMonster) => {
        if (!fieldMonster?.faceUp) return false;
        const fieldCard = getChronicleCard(fieldMonster.cardId);
        return (
          fieldCard?.cardClass === "monster" &&
          fieldCard.element === card.effect.requiresFaceUpElement
        );
      })
    )
      return [];
    const triggerSide = other(responder);
    const triggerZone =
      trigger === "onAttackDeclared"
        ? pending.attackerZoneIndex
        : pending.zoneIndex;
    const monster = validZone(triggerZone, MONSTER_ZONE_COUNT)
      ? sideOf(state, triggerSide).monsterZones[triggerZone]
      : null;
    const summonedCard =
      trigger === "onMonsterSummoned"
        ? cardInHand(state, triggerSide, Number(pending.handIndex))
        : undefined;
    const monsterCard =
      summonedCard ?? (monster ? getChronicleCard(monster.cardId) : undefined);
    if (
      card.effect.cap &&
      monsterCard?.cardClass === "monster" &&
      monsterCard.level > card.effect.cap
    )
      return [];
    return [index];
  });
}

function maybeOpenResponse(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  trigger: ChronicleTrigger,
  pendingAction: ChronicleActionIntent,
  now: number,
): ChronicleResult | null {
  const responder = other(actor);
  const eligibleZoneIndexes = eligibleTrapZones(
    state,
    responder,
    trigger,
    pendingAction,
  );
  if (eligibleZoneIndexes.length === 0) return null;
  const next = clone(state);
  next.responseWindow = {
    id: nextIid(next, "response"),
    trigger,
    responder,
    eligibleZoneIndexes,
    openedAt: now,
    expiresAt: now + RESPONSE_TIMEOUT_MS,
    pendingAction: { ...pendingAction, actor },
  };
  next.log.push(`${sideOf(next, responder).name} may respond with a set Snare.`);
  return success(next);
}

function resolveSummon(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  intent: ChronicleActionIntent,
  setFaceDown: boolean,
): ChronicleResult {
  const next = clone(state);
  const side = sideOf(next, actor);
  const handIndex = Number(intent.handIndex);
  const zoneIndex = Number(intent.zoneIndex);
  const card = cardInHand(next, actor, handIndex);
  if (!card || card.cardClass !== "monster")
    return failure(state, "Select a Monster Card in your hand.");
  if (!validZone(zoneIndex, MONSTER_ZONE_COUNT))
    return failure(state, "Choose a valid Monster Zone.");
  const tributeIndexes = intent.tributeZoneIndexes ?? [];
  const required = tributeCountForLevel(card.level);
  if (
    tributeIndexes.length !== required ||
    new Set(tributeIndexes).size !== required
  )
    return failure(
      state,
      `Level ${card.level} requires exactly ${required} distinct Tribute${required === 1 ? "" : "s"}.`,
    );
  if (
    tributeIndexes.some(
      (index) =>
        !validZone(index, MONSTER_ZONE_COUNT) || !side.monsterZones[index],
    )
  )
    return failure(state, "Every Tribute must be one of your field Monsters.");
  if (side.monsterZones[zoneIndex] && !tributeIndexes.includes(zoneIndex))
    return failure(state, "That Monster Zone is occupied.");
  [...tributeIndexes]
    .sort((a, b) => b - a)
    .forEach((index) => sendMonsterToGrave(next, actor, index));
  side.hand.splice(handIndex, 1);
  side.monsterZones[zoneIndex] = {
    instanceId: nextIid(next, "monster"),
    cardId: card.id,
    owner: actor,
    zoneIndex,
    position: setFaceDown ? "defense" : "attack",
    faceUp: !setFaceDown,
    summonedOnTurn: next.turnNumber,
    lastPositionChangeTurn: next.turnNumber,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  next.normalSummonUsed = true;
  next.log.push(
    `${side.name} ${setFaceDown ? "Sets a Monster" : `Summons ${card.name}`}${required ? ` using ${required} Tribute${required === 1 ? "" : "s"}` : ""}.`,
  );
  if (
    !setFaceDown &&
    required > 0 &&
    card.monsterEffect?.kind === "drawOnTributeSummon"
  )
    drawForMonsterEffect(
      next,
      actor,
      card.monsterEffect.amount ?? 1,
      card.name,
    );
  if (
    !setFaceDown &&
    required > 0 &&
    card.monsterEffect?.kind === "destroySetMagicTrapOnTributeSummon"
  ) {
    const summoned = side.monsterZones[zoneIndex];
    if (summoned) summoned.lastAttackTurn = next.turnNumber;
    const opponentKey = other(actor);
    const setZoneIndex = sideOf(next, opponentKey).magicTrapZones.findIndex(
      (zone) => zone && !zone.faceUp,
    );
    if (setZoneIndex >= 0) {
      const destroyedId = sideOf(next, opponentKey).magicTrapZones[setZoneIndex]!.cardId;
      sendMagicTrapToGrave(next, opponentKey, setZoneIndex);
      next.log.push(
        `${card.name}'s Tribute effect destroys the opponent's Set ${getChronicleCard(destroyedId)?.cardClass === "trap" ? "Snare" : "Jutsu"} Card.`,
      );
    }
  }
  if (
    !setFaceDown &&
    card.monsterEffect?.kind === "setStrongestOpponentFaceDownOnSummon"
  ) {
    const opponentKey = other(actor);
    const target = sideOf(next, opponentKey).monsterZones
      .flatMap((monster, targetZoneIndex) =>
        monster?.faceUp
          ? [
              {
                monster,
                targetZoneIndex,
                attack: effectiveAttack(monster, next.activeField, next),
              },
            ]
          : [],
      )
      .sort((a, b) => b.attack - a.attack || a.targetZoneIndex - b.targetZoneIndex)[0];
    if (target) {
      detachEquip(next, opponentKey, target.monster);
      target.monster.faceUp = false;
      target.monster.position = "defense";
      target.monster.lastPositionChangeTurn = next.turnNumber;
      next.log.push(
        `${card.name}'s effect turns the opponent's strongest Monster face-down.`,
      );
    }
  }
  return success(next);
}

function validateSummon(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  intent: ChronicleActionIntent,
): string | null {
  const guard = actionGuard(state, actor, ["main1", "main2"]);
  if (guard) return guard;
  if (state.normalSummonUsed)
    return "You already used your Normal Summon or Set this turn.";
  const card = cardInHand(state, actor, Number(intent.handIndex));
  if (!card || card.cardClass !== "monster")
    return "Select a Monster Card in your hand.";
  const zoneIndex = Number(intent.zoneIndex);
  if (!validZone(zoneIndex, MONSTER_ZONE_COUNT))
    return "Choose a valid Monster Zone.";
  const tributes = intent.tributeZoneIndexes ?? [];
  const required = tributeCountForLevel(card.level);
  if (tributes.length !== required || new Set(tributes).size !== required)
    return `Level ${card.level} requires exactly ${required} distinct Tribute${required === 1 ? "" : "s"}.`;
  const side = sideOf(state, actor);
  if (
    tributes.some(
      (index) =>
        !validZone(index, MONSTER_ZONE_COUNT) || !side.monsterZones[index],
    )
  )
    return "Every Tribute must be one of your field Monsters.";
  if (side.monsterZones[zoneIndex] && !tributes.includes(zoneIndex))
    return "That Monster Zone is occupied.";
  return null;
}

function summonAction(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  intent: ChronicleActionIntent,
  setFaceDown: boolean,
  now: number,
): ChronicleResult {
  const error = validateSummon(state, actor, intent);
  if (error) return failure(state, error);
  const pending = {
    ...intent,
    action: setFaceDown ? "set-monster" : "normal-summon",
  };
  return (
    (!setFaceDown
      ? maybeOpenResponse(state, actor, "onMonsterSummoned", pending, now)
      : null) ?? resolveSummon(state, actor, pending, setFaceDown)
  );
}

export function normalSummon(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  intent: ChronicleActionIntent,
  now = Date.now(),
): ChronicleResult {
  return summonAction(state, actor, intent, false, now);
}
export function normalSet(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  intent: ChronicleActionIntent,
  now = Date.now(),
): ChronicleResult {
  return summonAction(state, actor, intent, true, now);
}

export function flipSummon(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  zoneIndex: number,
): ChronicleResult {
  const guard = actionGuard(state, actor, ["main1", "main2"]);
  if (guard) return failure(state, guard);
  if (!validZone(zoneIndex, MONSTER_ZONE_COUNT))
    return failure(state, "Choose a valid Monster Zone.");
  const monster = sideOf(state, actor).monsterZones[zoneIndex];
  if (!monster || monster.faceUp || monster.position !== "defense")
    return failure(
      state,
      "Only your face-down Defense Monster can be Flip Summoned.",
    );
  if (monster.summonedOnTurn === state.turnNumber)
    return failure(
      state,
      "A Monster cannot be Flip Summoned on the turn it was Set.",
    );
  if ((monster.positionLockedUntilTurn ?? 0) >= state.turnNumber)
    return failure(state, "That Monster is sealed and cannot be Flip Summoned yet.");
  const next = clone(state);
  const target = sideOf(next, actor).monsterZones[zoneIndex]!;
  target.faceUp = true;
  target.position = "attack";
  target.lastPositionChangeTurn = next.turnNumber;
  next.log.push(
    `${sideOf(next, actor).name} Flip Summons ${getChronicleCard(target.cardId)?.name ?? "a Monster"}.`,
  );
  const card = getChronicleCard(target.cardId);
  if (card?.cardClass === "monster")
    applyStandaloneFlipEffect(next, actor, card);
  return success(next);
}

export function changePosition(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  zoneIndex: number,
  position: ChroniclePosition,
): ChronicleResult {
  const guard = actionGuard(state, actor, ["main1", "main2"]);
  if (guard) return failure(state, guard);
  if (!validZone(zoneIndex, MONSTER_ZONE_COUNT))
    return failure(state, "Choose a valid Monster Zone.");
  const monster = sideOf(state, actor).monsterZones[zoneIndex];
  if (!monster || !monster.faceUp)
    return failure(state, "Only a face-up owned Monster can change position.");
  if (monster.position === position)
    return failure(state, "That Monster is already in that position.");
  if (
    monster.summonedOnTurn === state.turnNumber ||
    monster.lastPositionChangeTurn === state.turnNumber ||
    monster.lastAttackTurn === state.turnNumber ||
    (monster.positionLockedUntilTurn ?? 0) >= state.turnNumber
  )
    return failure(state, "That Monster cannot change position this turn.");
  const next = clone(state);
  const target = sideOf(next, actor).monsterZones[zoneIndex]!;
  target.position = position;
  target.lastPositionChangeTurn = next.turnNumber;
  next.log.push(
    `${sideOf(next, actor).name} changes a Monster to ${position === "attack" ? "Attack" : "Defense"} Position.`,
  );
  return success(next);
}

function validateEffectTarget(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  card: ChronicleMagicCard,
  intent: ChronicleActionIntent,
): string | null {
  const scope = card.effect.targetScope;
  if (scope === "none") return null;
  if (scope === "ownGraveyardFieldMagic") {
    const index = Number(intent.graveyardIndex);
    const id = sideOf(state, actor).graveyard[index];
    const target = id ? getChronicleCard(id) : undefined;
    if (target?.cardClass !== "magic" || target.magicType !== "field")
      return "Choose a Field Jutsu Card in your Graveyard.";
    return null;
  }
  if (scope === "ownGraveyardMagic") {
    const index = Number(intent.graveyardIndex);
    const id = sideOf(state, actor).graveyard[index];
    const target = id ? getChronicleCard(id) : undefined;
    if (!target || target.cardClass !== "magic")
      return "Choose a Jutsu Card in your Graveyard.";
    return null;
  }
  if (scope === "ownGraveyardLevel4OrLowerMonster") {
    const index = Number(intent.graveyardIndex);
    const id = sideOf(state, actor).graveyard[index];
    const target = id ? getChronicleCard(id) : undefined;
    if (
      !target ||
      target.cardClass !== "monster" ||
      target.level > 4 ||
      (card.effect.kind === "reviveLevel4OrLowerNormalMonster" &&
        target.monsterType !== "normal")
    )
      return card.effect.kind === "reviveLevel4OrLowerNormalMonster"
        ? "Choose a Level 4 or lower Normal Monster in your Graveyard."
        : "Choose a Level 4 or lower Monster in your Graveyard.";
    if (
      (card.effect.kind === "reviveLevel4OrLowerMonster" ||
        card.effect.kind === "reviveLevel4OrLowerNormalMonster") &&
      !sideOf(state, actor).monsterZones.some((zone) => zone === null)
    )
      return "You need an open Monster Zone.";
    return null;
  }
  if (scope === "opponentMagicTrap") {
    const targetSide = intent.targetSide ?? other(actor);
    const index = Number(intent.targetZoneIndex);
    if (
      targetSide !== other(actor) ||
      !validZone(index, MAGIC_TRAP_ZONE_COUNT) ||
      !sideOf(state, targetSide).magicTrapZones[index]
    )
      return "Choose an opponent Jutsu or Snare Card.";
    return null;
  }
  const targetSide =
    intent.targetSide ??
    (scope === "ownedFaceUpMonster" ? actor : other(actor));
  const index = Number(intent.targetZoneIndex);
  if (!validZone(index, MONSTER_ZONE_COUNT))
    return "Choose a valid Monster target.";
  const monster = sideOf(state, targetSide).monsterZones[index];
  if (!monster) return "That Monster target does not exist.";
  const monsterCard = getChronicleCard(monster.cardId);
  if (
    scope === "ownedFaceUpMonster" &&
    (targetSide !== actor || !monster.faceUp)
  )
    return "Choose one of your face-up Monsters.";
  if (
    (scope === "opponentMonster" || scope === "anyFaceUpMonster") &&
    targetSide !== other(actor)
  )
    return "Choose an opponent Monster.";
  if (
    (scope === "anyFaceUpMonster" ||
      card.effect.kind === "changeOneMonsterPosition") &&
    !monster.faceUp
  )
    return "Choose a face-up Monster.";
  if (
    scope === "opponentLevel4OrLowerMonster" &&
    (targetSide !== other(actor) ||
      !monster.faceUp ||
      monsterCard?.cardClass !== "monster" ||
      monsterCard.level > 4)
  )
    return "Choose a face-up opponent Level 4 or lower Monster.";
  if (
    card.effect.kind === "destroyLowDefenseMonster" &&
    (!monster.faceUp ||
      monsterCard?.cardClass !== "monster" ||
      effectiveDefense(monster) > (card.effect.cap ?? 1_000))
  )
    return `Choose a face-up opponent Monster with ${card.effect.cap ?? 1_000} or less DEF.`;
  return null;
}

function resolveMagic(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  intent: ChronicleActionIntent,
): ChronicleResult {
  const next = clone(state);
  const side = sideOf(next, actor);
  const handIndex = Number(intent.handIndex);
  const card = cardInHand(next, actor, handIndex);
  if (!card || card.cardClass !== "magic")
    return failure(state, "Select a Jutsu Card in your hand.");
  const openIndex = side.magicTrapZones.findIndex((zone) => zone === null);
  if (card.magicType !== "field" && openIndex < 0)
    return failure(state, "All Jutsu/Snare Zones are occupied.");
  const targetError = validateEffectTarget(next, actor, card, intent);
  if (targetError) return failure(state, targetError);
  side.hand.splice(handIndex, 1);
  if (card.magicType === "equip") {
    const targetIndex = Number(intent.targetZoneIndex);
    const target = side.monsterZones[targetIndex]!;
    if (target.attachedEquipId)
      return failure(state, "That Monster already has an Equip Jutsu Card.");
    const zone: ChronicleMagicTrapZone = {
      instanceId: nextIid(next, "equip"),
      cardId: card.id,
      owner: actor,
      zoneIndex: openIndex,
      faceUp: true,
      setOnTurn: next.turnNumber,
      equipTargetInstanceId: target.instanceId,
    };
    side.magicTrapZones[openIndex] = zone;
    target.attachedEquipId = zone.instanceId;
    if (card.effect.kind === "modifyAttackUntilEndTurn")
      target.temporaryAttack += card.effect.amount ?? 0;
    if (card.effect.kind === "modifyDefenseUntilEndTurn")
      target.temporaryDefense += card.effect.amount ?? 0;
    if (card.effect.kind === "modifyAttackAndDefense") {
      target.temporaryAttack += card.effect.amount ?? 0;
      target.temporaryDefense += card.effect.penaltyAmount ?? 0;
    }
    if (card.effect.kind === "battleShieldEquip")
      target.temporaryDefense += card.effect.amount ?? 0;
  } else if (card.magicType === "field") {
    applyMagicEffect(next, actor, card, intent);
  } else {
    applyMagicEffect(next, actor, card, intent);
    side.graveyard.push(card.id);
  }
  next.log.push(`${side.name} activates ${card.name}.`);
  return success(next);
}

function destroyEveryMonsterControlledBy(
  state: ChronicleMatch,
  owners: readonly ChronicleSideKey[],
): void {
  for (const owner of owners)
    for (let zoneIndex = 0; zoneIndex < MONSTER_ZONE_COUNT; zoneIndex += 1)
      if (sideOf(state, owner).monsterZones[zoneIndex])
        sendMonsterToGrave(state, owner, zoneIndex);
}

function destroyEveryMagicTrapControlledBy(
  state: ChronicleMatch,
  owners: readonly ChronicleSideKey[],
): void {
  for (const owner of owners)
    for (let zoneIndex = 0; zoneIndex < MAGIC_TRAP_ZONE_COUNT; zoneIndex += 1)
      if (sideOf(state, owner).magicTrapZones[zoneIndex])
        sendMagicTrapToGrave(state, owner, zoneIndex);
  if (state.activeField && owners.includes(state.activeField.owner)) {
    sideOf(state, state.activeField.owner).graveyard.push(
      state.activeField.cardId,
    );
    state.activeField = null;
  }
}

function applyMagicEffect(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  card: ChronicleMagicCard,
  intent: ChronicleActionIntent,
): void {
  const side = sideOf(state, actor);
  const effect = card.effect;
  if (
    effect.kind === "drawCards" ||
    effect.kind === "drawThenDiscardRandom"
  ) {
    for (let i = 0; i < (effect.amount ?? 1); i++) {
      if (side.deck.length === 0) {
        finish(
          state,
          other(actor),
          `${side.name} cannot draw a required card.`,
        );
        return;
      }
      side.hand.push(side.deck.shift()!);
    }
    if (effect.kind === "drawThenDiscardRandom" && state.status === "active") {
      const discardCount = Math.min(
        Math.max(0, effect.penaltyAmount ?? 1),
        side.hand.length,
      );
      for (let count = 0; count < discardCount; count += 1) {
        const handIndex = nextRandomIndex(state, side.hand.length);
        const discardedId = side.hand.splice(handIndex, 1)[0];
        if (discardedId) side.graveyard.push(discardedId);
      }
      state.log.push(
        `${card.name} makes ${side.name} discard ${discardCount} random card${discardCount === 1 ? "" : "s"}.`,
      );
    }
  } else if (effect.kind === "cycleBothHands") {
    const participants = ([actor, other(actor)] as const).filter(
      (sideKey) => sideOf(state, sideKey).hand.length > 0,
    );
    for (const sideKey of participants) {
      const participant = sideOf(state, sideKey);
      const handIndex = nextRandomIndex(state, participant.hand.length);
      const discardedId = participant.hand.splice(handIndex, 1)[0];
      if (discardedId) participant.graveyard.push(discardedId);
    }
    for (const sideKey of participants) {
      drawForMonsterEffect(state, sideKey, effect.amount ?? 1, card.name);
      if (state.status !== "active") return;
    }
  } else if (effect.kind === "healLifePoints") {
    side.lifePoints += effect.amount ?? 0;
  } else if (
    effect.kind === "modifyAttackUntilEndTurn" ||
    effect.kind === "modifyDefenseUntilEndTurn"
  ) {
    const target = side.monsterZones[Number(intent.targetZoneIndex)];
    if (target) {
      if (effect.kind === "modifyAttackUntilEndTurn")
        target.temporaryAttack += effect.amount ?? 0;
      else target.temporaryDefense += effect.amount ?? 0;
    }
  } else if (
    effect.kind === "destroyOneMonster" ||
    effect.kind === "destroyLowDefenseMonster"
  ) {
    const targetSide = intent.targetSide ?? other(actor);
    sendMonsterToGrave(state, targetSide, Number(intent.targetZoneIndex));
  } else if (
    effect.kind === "destroyOneMagicTrap" ||
    effect.kind === "destroyOneMagicTrapAndHeal"
  ) {
    const targetSide = intent.targetSide ?? other(actor);
    sendMagicTrapToGrave(state, targetSide, Number(intent.targetZoneIndex));
    if (effect.kind === "destroyOneMagicTrapAndHeal")
      side.lifePoints += effect.amount ?? 0;
  } else if (effect.kind === "destroyActiveField") {
    if (state.activeField) {
      sideOf(state, state.activeField.owner).graveyard.push(
        state.activeField.cardId,
      );
      state.activeField = null;
    }
  } else if (effect.kind === "destroyAllOpponentMonsters") {
    destroyEveryMonsterControlledBy(state, [other(actor)]);
  } else if (effect.kind === "destroyAllMonsters") {
    destroyEveryMonsterControlledBy(state, ["p1", "p2"]);
  } else if (effect.kind === "destroyAllOpponentMagicTraps") {
    destroyEveryMagicTrapControlledBy(state, [other(actor)]);
  } else if (effect.kind === "destroyAllMagicTraps") {
    destroyEveryMagicTrapControlledBy(state, ["p1", "p2"]);
  } else if (effect.kind === "changeOneMonsterPosition") {
    const targetSide = intent.targetSide ?? other(actor);
    const target = sideOf(state, targetSide).monsterZones[
      Number(intent.targetZoneIndex)
    ];
    if (target?.faceUp)
      target.position =
        intent.position ??
        (target.position === "attack" ? "defense" : "attack");
  } else if (effect.kind === "setFieldEnvironment" && effect.fieldId) {
    if (state.activeField)
      sideOf(state, state.activeField.owner).graveyard.push(
        state.activeField.cardId,
      );
    state.activeField = {
      cardId: card.id,
      fieldId: effect.fieldId,
      owner: actor,
    };
  } else if (effect.kind === "returnOneMonsterToHand") {
    const targetSide = intent.targetSide ?? other(actor);
    const index = Number(intent.targetZoneIndex);
    const target = sideOf(state, targetSide).monsterZones[index];
    if (target) {
      detachEquip(state, targetSide, target);
      sideOf(state, targetSide).hand.push(target.cardId);
      sideOf(state, targetSide).monsterZones[index] = null;
    }
  } else if (effect.kind === "recoverOneGraveyardCard") {
    const graveIndex = Number(intent.graveyardIndex);
    const id = side.graveyard[graveIndex];
    const recovered = id ? getChronicleCard(id) : undefined;
    if (
      (effect.targetScope === "ownGraveyardMagic" &&
        recovered?.cardClass === "magic") ||
      (effect.targetScope === "ownGraveyardLevel4OrLowerMonster" &&
        recovered?.cardClass === "monster" &&
        recovered.level <= 4) ||
      (effect.targetScope === "ownGraveyardFieldMagic" &&
        recovered?.cardClass === "magic" &&
        recovered.magicType === "field")
    ) {
      side.graveyard.splice(graveIndex, 1);
      side.hand.push(id);
    }
  } else if (
    effect.kind === "reviveLevel4OrLowerMonster" ||
    effect.kind === "reviveLevel4OrLowerNormalMonster"
  ) {
    const graveIndex = Number(intent.graveyardIndex);
    const id = side.graveyard[graveIndex];
    const open = side.monsterZones.findIndex((zone) => zone === null);
    const monsterCard = id ? getChronicleCard(id) : undefined;
    if (
      open >= 0 &&
      monsterCard?.cardClass === "monster" &&
      monsterCard.level <= 4 &&
      (effect.kind !== "reviveLevel4OrLowerNormalMonster" ||
        monsterCard.monsterType === "normal")
    ) {
      side.graveyard.splice(graveIndex, 1);
      side.monsterZones[open] = {
        instanceId: nextIid(state, "monster"),
        cardId: id,
        owner: actor,
        zoneIndex: open,
        position: "defense",
        faceUp: true,
        summonedOnTurn: state.turnNumber,
        lastPositionChangeTurn: state.turnNumber,
        lastAttackTurn: 0,
        temporaryAttack: 0,
        temporaryDefense: 0,
      };
    }
  }
}

function applyMagicActivationMonsterEffects(state: ChronicleMatch): void {
  for (const sideKey of ["p1", "p2"] as const) {
    for (const monster of sideOf(state, sideKey).monsterZones) {
      if (!monster?.faceUp) continue;
      const monsterCard = getChronicleCard(monster.cardId);
      if (
        monsterCard?.cardClass !== "monster" ||
        monsterCard.monsterEffect?.kind !== "gainAttackOnMagicActivated"
      )
        continue;
      const amount = monsterCard.monsterEffect.amount ?? 0;
      monster.temporaryAttack += amount;
    }
  }
}

export function activateMagic(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  intent: ChronicleActionIntent,
  now = Date.now(),
): ChronicleResult {
  const guard = actionGuard(state, actor, ["main1", "main2"]);
  if (guard) return failure(state, guard);
  const card = cardInHand(state, actor, Number(intent.handIndex));
  if (!card || card.cardClass !== "magic")
    return failure(state, "Select a Jutsu Card in your hand.");
  if (
    card.magicType !== "field" &&
    !sideOf(state, actor).magicTrapZones.some((zone) => zone === null)
  )
    return failure(state, "All Jutsu/Snare Zones are occupied.");
  const targetError = validateEffectTarget(state, actor, card, intent);
  if (targetError) return failure(state, targetError);
  const pending = { ...intent, action: "activate-magic" };
  const activatedState = clone(state);
  applyMagicActivationMonsterEffects(activatedState);
  return (
    maybeOpenResponse(
      activatedState,
      actor,
      "onMagicActivated",
      pending,
      now,
    ) ?? resolveMagic(activatedState, actor, pending)
  );
}

export function setTrap(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  handIndex: number,
  zoneIndex: number,
): ChronicleResult {
  const guard = actionGuard(state, actor, ["main1", "main2"]);
  if (guard) return failure(state, guard);
  const card = cardInHand(state, actor, handIndex);
  if (!card || card.cardClass !== "trap")
    return failure(state, "Select a Snare Card in your hand.");
  if (!validZone(zoneIndex, MAGIC_TRAP_ZONE_COUNT))
    return failure(state, "Choose a valid Jutsu/Snare Zone.");
  if (sideOf(state, actor).magicTrapZones[zoneIndex])
    return failure(state, "That Jutsu/Snare Zone is occupied.");
  const next = clone(state);
  const side = sideOf(next, actor);
  side.hand.splice(handIndex, 1);
  side.magicTrapZones[zoneIndex] = {
    instanceId: nextIid(next, "trap"),
    cardId: card.id,
    owner: actor,
    zoneIndex,
    faceUp: false,
    setOnTurn: next.turnNumber,
  };
  next.log.push(`${side.name} Sets a Snare Card.`);
  return success(next);
}

export function advancePhase(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
): ChronicleResult {
  const guard = actionGuard(state, actor, ["draw", "standby"]);
  if (guard) return failure(state, guard);
  const next = clone(state);
  if (next.phase === "draw") {
    next.phase = "standby";
    next.log.push(`${sideOf(next, actor).name} enters the Standby Phase.`);
  } else {
    next.phase = "main1";
    next.log.push(`${sideOf(next, actor).name} enters Main Phase 1.`);
  }
  return success(next);
}

export function startBattlePhase(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
): ChronicleResult {
  const guard = actionGuard(state, actor, ["main1"]);
  if (guard) return failure(state, guard);
  if (state.turnNumber === 1 && state.activePlayer === state.firstPlayer)
    return failure(
      state,
      "The first player cannot enter the Battle Phase on the first turn.",
    );
  const next = clone(state);
  next.phase = "battle";
  next.log.push(
    `${sideOf(next, actor).name} enters the Battle Phase Start Step.`,
  );
  return success(next);
}

function resolveAttack(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  intent: ChronicleActionIntent,
): ChronicleResult {
  const next = clone(state);
  const attackerIndex = Number(intent.attackerZoneIndex);
  const defendingSideKey = other(actor);
  const attacker = sideOf(next, actor).monsterZones[attackerIndex];
  if (!attacker)
    return failure(state, "The attacking Monster is no longer on the field.");
  const attackerCard = getChronicleCard(attacker.cardId);
  if (!attackerCard || attackerCard.cardClass !== "monster")
    return failure(state, "The attacking Monster is invalid.");
  const attackerInstanceId = attacker.instanceId;
  attacker.lastAttackTurn = next.turnNumber;
  const targetIndex = intent.targetZoneIndex;
  if (targetIndex === null || targetIndex === undefined) {
    const damage = effectiveAttack(attacker, next.activeField, next);
    const defender = sideOf(next, defendingSideKey);
    defender.lifePoints = Math.max(0, defender.lifePoints - damage);
    next.log.push(
      `Damage Step: ${sideOf(next, actor).name} attacks directly for ${damage} damage.`,
    );
    if (defender.lifePoints === 0) {
      finish(next, actor, `${defender.name}'s Health Points reached zero.`);
      return success(next);
    }
    applyBattleDamageMonsterEffect(next, actor, attackerCard);
    const survivingAttacker = sideOf(next, actor).monsterZones[attackerIndex];
    if (
      survivingAttacker?.instanceId === attackerInstanceId &&
      attackerCard.monsterEffect?.kind === "shiftToDefenseAfterAttack"
    ) {
      survivingAttacker.position = "defense";
      survivingAttacker.lastPositionChangeTurn = next.turnNumber;
      next.log.push(
        `${attackerCard.name}'s effect changes it to Defense Position.`,
      );
    }
    return success(next);
  }
  const defender = sideOf(next, defendingSideKey).monsterZones[targetIndex];
  if (!defender)
    return failure(state, "The attack target is no longer on the field.");
  const defenderCard = getChronicleCard(defender.cardId);
  if (!defenderCard || defenderCard.cardClass !== "monster")
    return failure(state, "The defending Monster is invalid.");
  const defenderInstanceId = defender.instanceId;
  const defenderWasFlipped = !defender.faceUp;
  if (defenderWasFlipped) {
    defender.faceUp = true;
    defender.position = "defense";
    next.log.push(
      `${sideOf(next, defendingSideKey).name}'s face-down Monster is revealed.`,
    );
  }
  if (
    !defenderWasFlipped &&
    defender.position === "attack" &&
    defenderCard.monsterEffect?.kind === "changeToDefenseWhenAttacked"
  ) {
    defender.position = "defense";
    defender.lastPositionChangeTurn = next.turnNumber;
    next.log.push(
      `${defenderCard.name}'s effect changes it to Defense Position before damage calculation.`,
    );
  }
  let atk = effectiveAttack(attacker, next.activeField, next);
  const originalAttackerAtk = atk;
  let defenderStrongerBattleBonus = 0;
  if (defender.position === "attack") {
    const originalDefenderAtk = effectiveAttack(
      defender,
      next.activeField,
      next,
    );
    if (
      attackerCard.monsterEffect?.kind ===
        "gainAttackWhenBattlingStronger" &&
      originalDefenderAtk > originalAttackerAtk
    ) {
      const amount = attackerCard.monsterEffect.amount ?? 0;
      atk += amount;
      next.log.push(
        `${attackerCard.name} gains ${amount} ATK while battling a stronger Monster.`,
      );
    }
    if (
      defenderCard.monsterEffect?.kind ===
        "gainAttackWhenBattlingStronger" &&
      originalAttackerAtk > originalDefenderAtk
    ) {
      defenderStrongerBattleBonus = defenderCard.monsterEffect.amount ?? 0;
      next.log.push(
        `${defenderCard.name} gains ${defenderStrongerBattleBonus} ATK while battling a stronger Monster.`,
      );
    }
  }
  if (
    defenderWasFlipped &&
    defenderCard.monsterEffect?.kind === "weakenAttackerOnFlip"
  ) {
    const reduction = defenderCard.monsterEffect.amount ?? 0;
    atk = Math.max(0, atk - reduction);
    next.log.push(
      `${defenderCard.name}'s effect reduces the attacker by ${reduction} ATK for this damage calculation.`,
    );
  }
  if (
    !defenderWasFlipped &&
    defender.position === "attack" &&
    defenderCard.monsterEffect?.kind === "reflectDamageWhenAttacked"
  ) {
    const attackingSide = sideOf(next, actor);
    attackingSide.lifePoints = Math.max(0, attackingSide.lifePoints - atk);
    next.log.push(
      `${defenderCard.name}'s effect reflects ${atk} damage before damage calculation.`,
    );
    if (attackingSide.lifePoints === 0) {
      finish(
        next,
        defendingSideKey,
        `${attackingSide.name}'s Health Points reached zero.`,
      );
      return success(next);
    }
  }
  const attackerElementBonus = elementBattleBonus(
    attackerCard.element,
    defenderCard.element,
    next.activeField,
  );
  const defenderElementBonus = elementBattleBonus(
    defenderCard.element,
    attackerCard.element,
    next.activeField,
  );
  if (attackerElementBonus > 0) {
    atk += attackerElementBonus;
    next.log.push(
      `Element edge: ${attackerCard.element} over ${defenderCard.element} gives ${attackerCard.name} +${attackerElementBonus} ATK for this battle.`,
    );
  } else if (defenderElementBonus > 0) {
    next.log.push(
      `Element edge: ${defenderCard.element} over ${attackerCard.element} gives ${defenderCard.name} +${defenderElementBonus} ${defender.position === "attack" ? "ATK" : "DEF"} for this battle.`,
    );
  }
  let attackerDestroyedByBattle = false;
  let defenderDestroyedByBattle = false;
  let battleDamageToDefender = 0;

  const destroyByBattle = (
    owner: ChronicleSideKey,
    zoneIndex: number,
    monster: ChronicleFieldMonster,
  ): boolean => {
    if (preventBattleDestruction(next, monster)) return false;
    sendMonsterToGrave(next, owner, zoneIndex);
    return true;
  };

  if (defender.position === "attack") {
    const defAtk =
      effectiveAttack(defender, next.activeField, next) +
      defenderStrongerBattleBonus +
      defenderElementBonus;
    if (atk > defAtk) {
      defenderDestroyedByBattle = destroyByBattle(
        defendingSideKey,
        targetIndex,
        defender,
      );
      battleDamageToDefender = atk - defAtk;
      sideOf(next, defendingSideKey).lifePoints = Math.max(
        0,
        sideOf(next, defendingSideKey).lifePoints - battleDamageToDefender,
      );
    } else if (atk < defAtk) {
      attackerDestroyedByBattle = destroyByBattle(
        actor,
        attackerIndex,
        attacker,
      );
      sideOf(next, actor).lifePoints = Math.max(
        0,
        sideOf(next, actor).lifePoints - (defAtk - atk),
      );
    } else {
      defenderDestroyedByBattle = destroyByBattle(
        defendingSideKey,
        targetIndex,
        defender,
      );
      attackerDestroyedByBattle = destroyByBattle(
        actor,
        attackerIndex,
        attacker,
      );
    }
  } else {
    const def = effectiveDefense(defender) + defenderElementBonus;
    if (atk > def) {
      defenderDestroyedByBattle = destroyByBattle(
        defendingSideKey,
        targetIndex,
        defender,
      );
      if (attackerCard.monsterEffect?.kind === "piercingBattleDamage") {
        battleDamageToDefender = atk - def;
        sideOf(next, defendingSideKey).lifePoints = Math.max(
          0,
          sideOf(next, defendingSideKey).lifePoints - battleDamageToDefender,
        );
      }
    } else if (atk < def) {
      sideOf(next, actor).lifePoints = Math.max(
        0,
        sideOf(next, actor).lifePoints - (def - atk),
      );
      if (
        defenderCard.monsterEffect?.kind ===
          "destroyAttackerWhenDefenseHolds" &&
        sideOf(next, actor).monsterZones[attackerIndex]?.instanceId ===
          attackerInstanceId
      ) {
        sendMonsterToGrave(next, actor, attackerIndex);
        next.log.push(`${defenderCard.name}'s effect destroys the attacker.`);
      }
    }
  }
  next.log.push(`Damage Step resolves at ${atk} ATK.`);
  if (sideOf(next, actor).lifePoints === 0) {
    finish(
      next,
      defendingSideKey,
      `${sideOf(next, actor).name}'s Health Points reached zero.`,
    );
    return success(next);
  }
  if (sideOf(next, defendingSideKey).lifePoints === 0) {
    finish(
      next,
      actor,
      `${sideOf(next, defendingSideKey).name}'s Health Points reached zero.`,
    );
    return success(next);
  }

  if (defenderWasFlipped) {
    applyStandaloneFlipEffect(next, defendingSideKey, defenderCard);
    if (
      next.status === "active" &&
      defenderCard.monsterEffect?.kind === "destroyAttackerOnFlip" &&
      sideOf(next, actor).monsterZones[attackerIndex]?.instanceId ===
        attackerInstanceId
    ) {
      sendMonsterToGrave(next, actor, attackerIndex);
      next.log.push(
        `${defenderCard.name}'s Flip effect destroys the attacker.`,
      );
    }
  }

  const phaseOutSource =
    attackerCard.monsterEffect?.kind === "phaseOutBattlePairAfterDamage"
      ? attackerCard
      : defenderCard.monsterEffect?.kind === "phaseOutBattlePairAfterDamage"
        ? defenderCard
        : null;
  if (next.status === "active" && phaseOutSource) {
    moveBattleMonsterToDeckBottom(
      next,
      actor,
      attackerInstanceId,
      attackerCard.id,
    );
    moveBattleMonsterToDeckBottom(
      next,
      defendingSideKey,
      defenderInstanceId,
      defenderCard.id,
    );
    attackerDestroyedByBattle = false;
    defenderDestroyedByBattle = false;
    next.log.push(
      `${phaseOutSource.name}'s effect moves both battling Monsters to the bottom of their owners' Decks.`,
    );
  }

  if (next.status === "active" && attackerDestroyedByBattle)
    applyDestroyedByBattleEffect(
      next,
      actor,
      attackerCard,
      defendingSideKey,
      defenderInstanceId,
    );
  if (next.status === "active" && defenderDestroyedByBattle)
    applyDestroyedByBattleEffect(
      next,
      defendingSideKey,
      defenderCard,
      actor,
      attackerInstanceId,
    );
  if (next.status === "active" && battleDamageToDefender > 0)
    applyBattleDamageMonsterEffect(next, actor, attackerCard);
  const survivingAttacker = sideOf(next, actor).monsterZones[attackerIndex];
  if (
    next.status === "active" &&
    survivingAttacker?.instanceId === attackerInstanceId &&
    attackerCard.monsterEffect?.kind === "shiftToDefenseAfterAttack"
  ) {
    survivingAttacker.position = "defense";
    survivingAttacker.lastPositionChangeTurn = next.turnNumber;
    next.log.push(
      `${attackerCard.name}'s effect changes it to Defense Position.`,
    );
  }
  return success(next);
}

function validateAttack(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  intent: ChronicleActionIntent,
): string | null {
  const guard = actionGuard(state, actor, ["battle"]);
  if (guard) return guard;
  const attackerIndex = Number(intent.attackerZoneIndex);
  if (!validZone(attackerIndex, MONSTER_ZONE_COUNT))
    return "Choose a valid attacker.";
  const attacker = sideOf(state, actor).monsterZones[attackerIndex];
  if (!attacker || !attacker.faceUp || attacker.position !== "attack")
    return "Only a face-up Attack Position Monster can attack.";
  if (attacker.lastAttackTurn === state.turnNumber)
    return "That Monster already attacked this turn.";
  const opponent = sideOf(state, other(actor));
  const target = intent.targetZoneIndex;
  if (target === null || target === undefined) {
    if (opponent.monsterZones.some(Boolean))
      return "A direct attack is legal only while the opponent controls no Monsters.";
  } else if (
    !validZone(target, MONSTER_ZONE_COUNT) ||
    !opponent.monsterZones[target]
  )
    return "Choose an opponent Monster to attack.";
  else {
    const selectedTarget = opponent.monsterZones[target];
    const guarded = opponent.monsterZones.some((monster) => {
      if (!monster?.faceUp || monster.position !== "defense") return false;
      const card = getChronicleCard(monster.cardId);
      return (
        card?.cardClass === "monster" &&
        card.monsterEffect?.kind === "guardOtherMonsters"
      );
    });
    const selectedCard = selectedTarget
      ? getChronicleCard(selectedTarget.cardId)
      : undefined;
    if (
      guarded &&
      (selectedCard?.cardClass !== "monster" ||
        selectedCard.monsterEffect?.kind !== "guardOtherMonsters")
    )
      return "A guarding Monster must be selected as the attack target.";
  }
  return null;
}

export function declareAttack(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  intent: ChronicleActionIntent,
  now = Date.now(),
): ChronicleResult {
  const error = validateAttack(state, actor, intent);
  if (error) return failure(state, error);
  const pending = { ...intent, action: "attack" };
  return (
    maybeOpenResponse(state, actor, "onAttackDeclared", pending, now) ??
    resolveAttack(state, actor, pending)
  );
}

function resolvePending(
  state: ChronicleMatch,
  window: ChronicleResponseWindow,
): ChronicleResult {
  const { actor, action } = window.pendingAction;
  if (action === "normal-summon")
    return resolveSummon(state, actor, window.pendingAction, false);
  if (action === "set-monster")
    return resolveSummon(state, actor, window.pendingAction, true);
  if (action === "activate-magic")
    return resolveMagic(state, actor, window.pendingAction);
  if (action === "attack")
    return resolveAttack(state, actor, window.pendingAction);
  return failure(state, "The pending action is invalid.");
}

function resolveTrapEffect(
  state: ChronicleMatch,
  trapCard: ChronicleTrapCard,
  window: ChronicleResponseWindow,
): { state: ChronicleMatch; cancelPending: boolean } {
  const next = state;
  const actor = window.pendingAction.actor;
  const triggerZone =
    window.trigger === "onAttackDeclared"
      ? window.pendingAction.attackerZoneIndex
      : window.pendingAction.zoneIndex;
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "summonDefenderFromHand"
  ) {
    const side = sideOf(next, window.responder);
    const openZone = side.monsterZones.findIndex((zone) => zone === null);
    const defender = side.hand
      .flatMap((id, handIndex) => {
        const card = getChronicleCard(id);
        return card?.cardClass === "monster" &&
          card.level <= (trapCard.effect.cap ?? 4)
          ? [{ card, handIndex }]
          : [];
      })
      .sort(
        (a, b) =>
          b.card.defense - a.card.defense ||
          b.card.attack - a.card.attack ||
          a.handIndex - b.handIndex,
      )[0];
    if (openZone < 0 || !defender)
      return { state: next, cancelPending: false };
    side.hand.splice(defender.handIndex, 1);
    side.monsterZones[openZone] = {
      instanceId: nextIid(next, "monster"),
      cardId: defender.card.id,
      owner: window.responder,
      zoneIndex: openZone,
      position: "defense",
      faceUp: true,
      summonedOnTurn: next.turnNumber,
      lastPositionChangeTurn: next.turnNumber,
      lastAttackTurn: 0,
      temporaryAttack: 0,
      temporaryDefense: 0,
    };
    window.pendingAction.targetZoneIndex = openZone;
    next.log.push(
      `${trapCard.name} Special Summons ${defender.card.name} in Defense Position and redirects the attack.`,
    );
    return { state: next, cancelPending: false };
  }
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "endBattlePhase"
  ) {
    next.phase = "main2";
    next.log.push(`${trapCard.name} ends the Battle Phase.`);
    return { state: next, cancelPending: true };
  }
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "destroyLowestAttackWhenOutnumbered"
  ) {
    const target = sideOf(next, actor).monsterZones
      .flatMap((monster, zoneIndex) =>
        monster?.faceUp
          ? [
              {
                monster,
                zoneIndex,
                attack: effectiveAttack(monster, next.activeField, next),
              },
            ]
          : [],
      )
      .sort((a, b) => a.attack - b.attack || a.zoneIndex - b.zoneIndex)[0];
    if (!target) return { state: next, cancelPending: false };
    sendMonsterToGrave(next, actor, target.zoneIndex);
    next.log.push(
      `${trapCard.name} destroys the opponent's lowest-ATK face-up Monster.`,
    );
    return {
      state: next,
      cancelPending: target.zoneIndex === Number(triggerZone),
    };
  }
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "borrowAttackerDefense"
  ) {
    const attackerIndex = Number(triggerZone);
    const defenderIndex = Number(window.pendingAction.targetZoneIndex);
    const attacker = validZone(attackerIndex, MONSTER_ZONE_COUNT)
      ? sideOf(next, actor).monsterZones[attackerIndex]
      : null;
    const defender = validZone(defenderIndex, MONSTER_ZONE_COUNT)
      ? sideOf(next, window.responder).monsterZones[defenderIndex]
      : null;
    const amount = attacker
      ? Math.floor(effectiveAttack(attacker, next.activeField, next) / 2)
      : 0;
    if (defender) defender.temporaryDefense += amount;
    next.log.push(`${trapCard.name} grants the defender ${amount} DEF.`);
    return { state: next, cancelPending: false };
  }
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "redirectAttackToHighestDefense"
  ) {
    const originalIndex = Number(window.pendingAction.targetZoneIndex);
    const original = validZone(originalIndex, MONSTER_ZONE_COUNT)
      ? sideOf(next, window.responder).monsterZones[originalIndex]
      : null;
    const replacement = sideOf(next, window.responder).monsterZones
      .flatMap((monster, zoneIndex) =>
        monster && monster.instanceId !== original?.instanceId
          ? [{ monster, zoneIndex, defense: effectiveDefense(monster) }]
          : [],
      )
      .sort(
        (a, b) => b.defense - a.defense || a.zoneIndex - b.zoneIndex,
      )[0];
    if (replacement) {
      window.pendingAction.targetZoneIndex = replacement.zoneIndex;
    }
    return { state: next, cancelPending: !replacement };
  }
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "defensiveFeint"
  ) {
    const attackerIndex = Number(triggerZone);
    const defenderIndex = Number(window.pendingAction.targetZoneIndex);
    const attacker = validZone(attackerIndex, MONSTER_ZONE_COUNT)
      ? sideOf(next, actor).monsterZones[attackerIndex]
      : null;
    const defender = validZone(defenderIndex, MONSTER_ZONE_COUNT)
      ? sideOf(next, window.responder).monsterZones[defenderIndex]
      : null;
    if (attacker) attacker.temporaryAttack += trapCard.effect.amount ?? -300;
    if (defender) {
      defender.position = "defense";
      defender.lastPositionChangeTurn = next.turnNumber;
    }
    return { state: next, cancelPending: false };
  }
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "modifyAttackUntilEndTurn"
  ) {
    const index = Number(triggerZone);
    const attacker = validZone(index, MONSTER_ZONE_COUNT)
      ? sideOf(next, actor).monsterZones[index]
      : null;
    if (attacker) attacker.temporaryAttack += trapCard.effect.amount ?? 0;
    return { state: next, cancelPending: false };
  }
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "modifyDefenseUntilEndTurn"
  ) {
    const index = Number(window.pendingAction.targetZoneIndex);
    const defender = validZone(index, MONSTER_ZONE_COUNT)
      ? sideOf(next, window.responder).monsterZones[index]
      : null;
    if (defender) defender.temporaryDefense += trapCard.effect.amount ?? 0;
    return { state: next, cancelPending: false };
  }
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "changeOneMonsterPosition"
  ) {
    const index = Number(triggerZone);
    const attacker = validZone(index, MONSTER_ZONE_COUNT)
      ? sideOf(next, actor).monsterZones[index]
      : null;
    if (attacker) attacker.position = "defense";
    return { state: next, cancelPending: true };
  }
  if (trapCard.effect.kind === "drawCards") {
    drawForMonsterEffect(
      next,
      window.responder,
      trapCard.effect.amount ?? 1,
      trapCard.name,
    );
    return {
      state: next,
      cancelPending:
        next.status !== "active" ||
        !trapCard.effect.originatingActionContinues,
    };
  }
  if (trapCard.effect.kind === "negateOneAttack")
    return { state: next, cancelPending: true };
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "destroyAllAttackPositionMonsters"
  ) {
    for (let index = 0; index < MONSTER_ZONE_COUNT; index += 1) {
      const monster = sideOf(next, actor).monsterZones[index];
      if (monster?.faceUp && monster.position === "attack")
        sendMonsterToGrave(next, actor, index);
    }
    return { state: next, cancelPending: true };
  }
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "negateAttackAndInflictDamage"
  ) {
    const index = Number(triggerZone);
    const attacker = validZone(index, MONSTER_ZONE_COUNT)
      ? sideOf(next, actor).monsterZones[index]
      : null;
    const damage = attacker
      ? effectiveAttack(attacker, next.activeField, next)
      : 0;
    const attackingSide = sideOf(next, actor);
    attackingSide.lifePoints = Math.max(0, attackingSide.lifePoints - damage);
    next.log.push(
      `${trapCard.name} reflects ${damage} damage to ${attackingSide.name}.`,
    );
    if (attackingSide.lifePoints === 0)
      finish(
        next,
        window.responder,
        `${attackingSide.name}'s Health Points reached zero.`,
      );
    return { state: next, cancelPending: true };
  }
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "destroyAttackerAndDamageBoth"
  ) {
    const index = Number(triggerZone);
    const attacker = validZone(index, MONSTER_ZONE_COUNT)
      ? sideOf(next, actor).monsterZones[index]
      : null;
    const damage = attacker
      ? effectiveAttack(attacker, next.activeField, next)
      : 0;
    if (attacker) sendMonsterToGrave(next, actor, index);
    const attackingSide = sideOf(next, actor);
    const respondingSide = sideOf(next, window.responder);
    attackingSide.lifePoints = Math.max(0, attackingSide.lifePoints - damage);
    respondingSide.lifePoints = Math.max(0, respondingSide.lifePoints - damage);
    next.log.push(`${trapCard.name} deals ${damage} damage to both players.`);
    if (attackingSide.lifePoints === 0 && respondingSide.lifePoints === 0)
      finish(next, "draw", "Both players' Health Points reached zero.");
    else if (attackingSide.lifePoints === 0)
      finish(
        next,
        window.responder,
        `${attackingSide.name}'s Health Points reached zero.`,
      );
    else if (respondingSide.lifePoints === 0)
      finish(
        next,
        actor,
        `${respondingSide.name}'s Health Points reached zero.`,
      );
    return { state: next, cancelPending: true };
  }
  if (
    window.trigger === "onMagicActivated" &&
    !trapCard.effect.originatingActionContinues
  ) {
    const side = sideOf(next, actor);
    const handIndex = Number(window.pendingAction.handIndex);
    const pendingCard = cardInHand(next, actor, handIndex);
    if (pendingCard?.cardClass === "magic") {
      side.hand.splice(handIndex, 1);
      side.graveyard.push(pendingCard.id);
      next.log.push(
        `${pendingCard.name} is negated and sent to the Graveyard.`,
      );
    }
    return { state: next, cancelPending: true };
  }
  // Summon-trigger effects need the summoned Monster to exist first.
  if (window.trigger === "onMonsterSummoned") {
    const pendingResolved = resolvePending(next, window);
    if (!pendingResolved.ok) return { state: next, cancelPending: true };
    const resolved = pendingResolved.state;
    if (trapCard.effect.kind === "destroyAllMonsters")
      destroyEveryMonsterControlledBy(resolved, ["p1", "p2"]);
    else {
      const index = Number(triggerZone);
      const target = validZone(index, MONSTER_ZONE_COUNT)
        ? sideOf(resolved, actor).monsterZones[index]
        : null;
      if (target) {
        if (trapCard.effect.kind === "weakenSummonedMonster") {
          const amount = trapCard.effect.amount ?? 800;
          target.temporaryAttack -= amount;
          target.positionLockedUntilTurn = resolved.turnNumber;
          resolved.log.push(
            `${trapCard.name} weakens the summoned Monster by ${amount} ATK and seals its position for the turn.`,
          );
        } else if (trapCard.effect.kind === "sealSummonedMonsterFaceDown") {
          target.faceUp = false;
          target.position = "defense";
          target.lastPositionChangeTurn = resolved.turnNumber;
          target.positionLockedUntilTurn = resolved.turnNumber + 2;
          resolved.log.push(
            `${trapCard.name} seals the summoned Monster face-down in Defense Position.`,
          );
        } else if (trapCard.effect.kind === "returnOneMonsterToHand") {
          detachEquip(resolved, actor, target);
          sideOf(resolved, actor).hand.push(target.cardId);
          sideOf(resolved, actor).monsterZones[index] = null;
        } else if (trapCard.effect.kind === "destroyOneMonster")
          sendMonsterToGrave(resolved, actor, index);
      }
    }
    return { state: resolved, cancelPending: true };
  }
  if (trapCard.effect.kind === "destroyOneMonster") {
    const index = Number(triggerZone);
    if (validZone(index, MONSTER_ZONE_COUNT))
      sendMonsterToGrave(next, actor, index);
    return {
      state: next,
      cancelPending: !trapCard.effect.originatingActionContinues,
    };
  }
  if (
    window.trigger === "onAttackDeclared" &&
    trapCard.effect.kind === "returnOneMonsterToHand"
  ) {
    const index = Number(triggerZone);
    const target = validZone(index, MONSTER_ZONE_COUNT)
      ? sideOf(next, actor).monsterZones[index]
      : null;
    if (target) {
      detachEquip(next, actor, target);
      sideOf(next, actor).hand.push(target.cardId);
      sideOf(next, actor).monsterZones[index] = null;
    }
    return { state: next, cancelPending: true };
  }
  return {
    state: next,
    cancelPending: !trapCard.effect.originatingActionContinues,
  };
}

export function activateTrap(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  zoneIndex: number,
): ChronicleResult {
  const window = state.responseWindow;
  if (!window) return failure(state, "There is no Snare response window.");
  if (window.responder !== actor)
    return failure(state, "Only the responding player may activate a Snare.");
  if (!window.eligibleZoneIndexes.includes(zoneIndex))
    return failure(state, "That Snare is not eligible for this response.");
  const next = clone(state);
  const copiedWindow = next.responseWindow!;
  const side = sideOf(next, actor);
  const zone = side.magicTrapZones[zoneIndex];
  const card = zone ? getChronicleCard(zone.cardId) : undefined;
  if (!zone || !card || card.cardClass !== "trap")
    return failure(state, "That set Snare is unavailable.");
  zone.faceUp = true;
  side.magicTrapZones[zoneIndex] = null;
  side.graveyard.push(card.id);
  if (card.effect.healthCost) {
    side.lifePoints -= card.effect.healthCost;
    next.log.push(
      `${side.name} pays ${card.effect.healthCost} Health Points to activate ${card.name}.`,
    );
  }
  for (let count = 0; count < (card.effect.discardCost ?? 0); count += 1) {
    const handIndex = nextRandomIndex(next, side.hand.length);
    const discardedId = side.hand.splice(handIndex, 1)[0];
    if (discardedId) side.graveyard.push(discardedId);
  }
  if (card.effect.discardCost)
    next.log.push(
      `${side.name} discards ${card.effect.discardCost} random card${card.effect.discardCost === 1 ? "" : "s"} to activate ${card.name}.`,
    );
  next.responseWindow = null;
  next.log.push(`${side.name} activates ${card.name}.`);
  const delayedTargetInstanceId =
    card.effect.kind === "destroyAttackerIfTargetDestroyed"
      ? sideOf(next, actor).monsterZones[
          Number(copiedWindow.pendingAction.targetZoneIndex)
        ]?.instanceId
      : undefined;
  const delayedAttackerInstanceId =
    card.effect.kind === "destroyAttackerIfTargetDestroyed"
      ? sideOf(next, copiedWindow.pendingAction.actor).monsterZones[
          Number(copiedWindow.pendingAction.attackerZoneIndex)
        ]?.instanceId
      : undefined;
  const trapResolution = resolveTrapEffect(next, card, copiedWindow);
  if (trapResolution.cancelPending) return success(trapResolution.state);
  const pendingResolution = resolvePending(trapResolution.state, copiedWindow);
  if (
    pendingResolution.ok &&
    pendingResolution.state.status === "active" &&
    card.effect.kind === "destroyAttackerIfTargetDestroyed" &&
    delayedTargetInstanceId &&
    delayedAttackerInstanceId
  ) {
    const targetSurvived = sideOf(pendingResolution.state, actor).monsterZones.some(
      (monster) => monster?.instanceId === delayedTargetInstanceId,
    );
    const attackerIndex = sideOf(
      pendingResolution.state,
      copiedWindow.pendingAction.actor,
    ).monsterZones.findIndex(
      (monster) => monster?.instanceId === delayedAttackerInstanceId,
    );
    if (!targetSurvived && attackerIndex >= 0) {
      sendMonsterToGrave(
        pendingResolution.state,
        copiedWindow.pendingAction.actor,
        attackerIndex,
      );
      pendingResolution.state.log.push(
        `${card.name} destroys the Monster that won the battle.`,
      );
    }
  }
  return pendingResolution;
}

export function passResponse(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
): ChronicleResult {
  const window = state.responseWindow;
  if (!window) return failure(state, "There is no Snare response window.");
  if (window.responder !== actor)
    return failure(state, "Only the responding player may pass.");
  const next = clone(state);
  const copiedWindow = next.responseWindow!;
  next.responseWindow = null;
  next.log.push(`${sideOf(next, actor).name} passes the Snare response.`);
  return resolvePending(next, copiedWindow);
}

export function passExpiredResponse(
  state: ChronicleMatch,
  now = Date.now(),
): ChronicleResult {
  if (!state.responseWindow || state.responseWindow.expiresAt > now)
    return failure(state, "No Snare response has expired.");
  return passResponse(state, state.responseWindow.responder);
}

export function enterMain2(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
): ChronicleResult {
  const guard = actionGuard(state, actor, ["battle"]);
  if (guard) return failure(state, guard);
  const next = clone(state);
  next.phase = "main2";
  next.log.push(
    `The Battle Phase End Step completes. ${sideOf(next, actor).name} enters Main Phase 2.`,
  );
  return success(next);
}

export function enterEndPhase(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
): ChronicleResult {
  const guard = actionGuard(state, actor, ["main1", "main2"]);
  if (guard) return failure(state, guard);
  const next = clone(state);
  next.phase = "end";
  next.log.push(`${sideOf(next, actor).name} enters the End Phase.`);
  return success(next);
}

function clearEndTurnModifiers(state: ChronicleMatch): void {
  for (const key of ["p1", "p2"] as const) {
    for (const monster of state[key].monsterZones) {
      if (!monster) continue;
      let equipAttack = 0;
      let equipDefense = 0;
      if (monster.attachedEquipId) {
        const zone = state[key].magicTrapZones.find(
          (item) => item?.instanceId === monster.attachedEquipId,
        );
        const card = zone ? getChronicleCard(zone.cardId) : undefined;
        if (card?.cardClass === "magic") {
          if (card.effect.kind === "modifyAttackUntilEndTurn")
            equipAttack = card.effect.amount ?? 0;
          if (card.effect.kind === "modifyDefenseUntilEndTurn")
            equipDefense = card.effect.amount ?? 0;
          if (card.effect.kind === "modifyAttackAndDefense") {
            equipAttack = card.effect.amount ?? 0;
            equipDefense = card.effect.penaltyAmount ?? 0;
          }
          if (card.effect.kind === "battleShieldEquip")
            equipDefense = card.effect.amount ?? 0;
        }
      }
      monster.temporaryAttack = equipAttack;
      monster.temporaryDefense = equipDefense;
    }
  }
}

export function startTurn(
  state: ChronicleMatch,
  sideKey: ChronicleSideKey,
  now = Date.now(),
): ChronicleResult {
  const next = clone(state);
  next.activePlayer = sideKey;
  next.phase = "draw";
  next.normalSummonUsed = false;
  next.turnStartedAt = now;
  const side = sideOf(next, sideKey);
  if (side.deck.length === 0) {
    finish(
      next,
      other(sideKey),
      `${side.name} cannot draw from an empty Deck.`,
    );
    return success(next);
  }
  side.hand.push(side.deck.shift()!);
  next.log.push(`${side.name} draws in the Draw Phase.`);
  return success(next);
}

export function endTurn(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  now = Date.now(),
): ChronicleResult {
  const guard = actionGuard(state, actor, ["end"]);
  if (guard) return failure(state, guard);
  const next = clone(state);
  clearEndTurnModifiers(next);
  next.turnNumber += 1;
  return startTurn(next, other(actor), now);
}

function finish(
  state: ChronicleMatch,
  winner: ChronicleSideKey | "draw",
  reason: string,
): void {
  state.status = "complete";
  state.winner = winner;
  state.responseWindow = null;
  state.log.push(reason);
}

export function determineWinner(
  state: ChronicleMatch,
): ChronicleSideKey | "draw" | null {
  if (state.status === "complete") return state.winner;
  if (state.p1.lifePoints <= 0 && state.p2.lifePoints <= 0) return "draw";
  if (state.p1.lifePoints <= 0) return "p2";
  if (state.p2.lifePoints <= 0) return "p1";
  return null;
}

export function forfeit(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
): ChronicleResult {
  if (state.status !== "active") return failure(state, "The duel is over.");
  const next = clone(state);
  finish(next, other(actor), `${sideOf(next, actor).name} forfeits the duel.`);
  return success(next);
}

export interface ChronicleProjectedMonster {
  instanceId: string;
  owner: ChronicleSideKey;
  zoneIndex: number;
  position: ChroniclePosition;
  faceUp: boolean;
  cardId?: string;
  attack?: number;
  defense?: number;
  level?: number;
  attachedEquipId?: string;
  canAttack?: boolean;
  canFlipSummon?: boolean;
  canChangePosition?: boolean;
}

export interface ChronicleProjectedZone {
  instanceId: string;
  owner: ChronicleSideKey;
  zoneIndex: number;
  faceUp: boolean;
  cardId?: string;
  equipTargetInstanceId?: string;
}

export interface ChronicleProjection {
  rulesVersion: number;
  turnNumber: number;
  firstPlayer: ChronicleSideKey;
  activePlayer: ChronicleSideKey;
  phase: ChroniclePhase;
  normalSummonUsed: boolean;
  status: "active" | "complete";
  winner: ChronicleSideKey | "draw" | null;
  viewerSide: ChronicleSideKey;
  activeField: (ChronicleActiveField & ChronicleFieldDefinition) | null;
  responseWindow: null | {
    id: string;
    trigger: ChronicleTrigger;
    responder: ChronicleSideKey;
    expiresAt: number;
    eligibleZoneIndexes?: number[];
  };
  p1: {
    name: string;
    lifePoints: number;
    deckCount: number;
    handCount: number;
    hand?: string[];
    monsterZones: Array<ChronicleProjectedMonster | null>;
    magicTrapZones: Array<ChronicleProjectedZone | null>;
    graveyard: string[];
  };
  p2: {
    name: string;
    lifePoints: number;
    deckCount: number;
    handCount: number;
    hand?: string[];
    monsterZones: Array<ChronicleProjectedMonster | null>;
    magicTrapZones: Array<ChronicleProjectedZone | null>;
    graveyard: string[];
  };
  log: string[];
  turnStartedAt: number;
}

export function projectMatchForViewer(
  state: ChronicleMatch,
  viewer: ChronicleSideKey,
): ChronicleProjection {
  const projectSide = (key: ChronicleSideKey) => {
    const side = sideOf(state, key);
    return {
      name: side.name,
      lifePoints: side.lifePoints,
      deckCount: side.deck.length,
      handCount: side.hand.length,
      ...(key === viewer ? { hand: side.hand.slice() } : {}),
      monsterZones: side.monsterZones.map((monster) => {
        if (!monster) return null;
        const visible = monster.faceUp || key === viewer;
        const card = visible ? getChronicleCard(monster.cardId) : undefined;
        return {
          instanceId: monster.instanceId,
          owner: monster.owner,
          zoneIndex: monster.zoneIndex,
          position: monster.position,
          faceUp: monster.faceUp,
          ...(visible && card?.cardClass === "monster"
            ? {
                cardId: monster.cardId,
                attack: effectiveAttack(monster, state.activeField, state),
                defense: effectiveDefense(monster),
                level: card.level,
                ...(monster.attachedEquipId
                  ? { attachedEquipId: monster.attachedEquipId }
                  : {}),
              }
            : {}),
          ...(key === viewer
            ? {
                canAttack:
                  monster.faceUp &&
                  monster.position === "attack" &&
                  monster.lastAttackTurn !== state.turnNumber,
                canFlipSummon:
                  !monster.faceUp &&
                  monster.position === "defense" &&
                  monster.summonedOnTurn !== state.turnNumber &&
                  (monster.positionLockedUntilTurn ?? 0) < state.turnNumber,
                canChangePosition:
                  monster.faceUp &&
                  monster.summonedOnTurn !== state.turnNumber &&
                  monster.lastPositionChangeTurn !== state.turnNumber &&
                  monster.lastAttackTurn !== state.turnNumber &&
                  (monster.positionLockedUntilTurn ?? 0) < state.turnNumber,
              }
            : {}),
        };
      }),
      magicTrapZones: side.magicTrapZones.map((zone) =>
        zone
          ? {
              instanceId: zone.instanceId,
              owner: zone.owner,
              zoneIndex: zone.zoneIndex,
              faceUp: zone.faceUp,
              ...(zone.faceUp || key === viewer ? { cardId: zone.cardId } : {}),
              ...(zone.equipTargetInstanceId && (zone.faceUp || key === viewer)
                ? { equipTargetInstanceId: zone.equipTargetInstanceId }
                : {}),
            }
          : null,
      ),
      graveyard: side.graveyard.slice(),
    };
  };
  return {
    rulesVersion: state.rulesVersion,
    turnNumber: state.turnNumber,
    firstPlayer: state.firstPlayer,
    activePlayer: state.activePlayer,
    phase: state.phase,
    normalSummonUsed: state.normalSummonUsed,
    status: state.status,
    winner: state.winner,
    viewerSide: viewer,
    activeField: state.activeField
      ? { ...state.activeField, ...FIELD_BY_ID.get(state.activeField.fieldId)! }
      : null,
    responseWindow: state.responseWindow
      ? {
          id: state.responseWindow.id,
          trigger: state.responseWindow.trigger,
          responder: state.responseWindow.responder,
          expiresAt: state.responseWindow.expiresAt,
          ...(state.responseWindow.responder === viewer
            ? {
                eligibleZoneIndexes:
                  state.responseWindow.eligibleZoneIndexes.slice(),
              }
            : {}),
        }
      : null,
    p1: projectSide("p1"),
    p2: projectSide("p2"),
    log: state.log.slice(-80),
    turnStartedAt: state.turnStartedAt,
  };
}

export function applyAction(
  state: ChronicleMatch,
  actor: ChronicleSideKey,
  intent: ChronicleActionIntent,
  now = Date.now(),
): ChronicleResult {
  switch (intent.action) {
    case "normal-summon":
      return normalSummon(state, actor, intent, now);
    case "set-monster":
      return normalSet(state, actor, intent, now);
    case "flip-summon":
      return flipSummon(state, actor, Number(intent.zoneIndex));
    case "change-position":
      return changePosition(
        state,
        actor,
        Number(intent.zoneIndex),
        intent.position === "attack" ? "attack" : "defense",
      );
    case "activate-magic":
      return activateMagic(state, actor, intent, now);
    case "set-trap":
      return setTrap(
        state,
        actor,
        Number(intent.handIndex),
        Number(intent.zoneIndex),
      );
    case "activate-trap":
      return activateTrap(state, actor, Number(intent.zoneIndex));
    case "pass-response":
      return passResponse(state, actor);
    case "advance-phase":
      return advancePhase(state, actor);
    case "start-battle":
      return startBattlePhase(state, actor);
    case "attack":
      return declareAttack(state, actor, intent, now);
    case "enter-main-2":
      return enterMain2(state, actor);
    case "enter-end-phase":
      return enterEndPhase(state, actor);
    case "end-turn":
      return endTurn(state, actor, now);
    case "forfeit":
      return forfeit(state, actor);
    default:
      return failure(state, `Unknown duel action: ${intent.action}`);
  }
}
