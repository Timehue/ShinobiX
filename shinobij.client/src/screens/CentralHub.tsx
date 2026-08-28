/* eslint-disable react-hooks/purity */
import { useState, useEffect, useMemo } from "react";
import { serverNow } from "../lib/server-clock";
import { NAMED_ITEM_LEVEL_REQ } from "../../../shared/item-level-gate";
import {
    canPayNamedForge,
    NAMED_FORGE_COST,
    NAMED_FORGE_CURRENCY_POINTS,
    namedForgePointTotal,
} from "../../../shared/named-forge-economy";
import type { CSSProperties, Dispatch, ReactElement, SetStateAction } from "react";
import "../styles/central-skin.css";
import "../styles/central-hub-forge.css";
// Compact local location and material glyphs shared with the rest of the game.
import {
    GiCrossedSwords, GiDragonHead, GiBookshelf,
    GiCrystalBall, GiBlacksmith, GiDungeonGate, GiStoneTower,
    GiTempleGate, GiSparkles, GiStoneStack, GiFlame, GiBreastplate, GiTrashCan,
    // Craft-material + recipe glyphs (forge tab).
    GiSwapBag, GiAnimalHide, GiFeather, GiFangs, GiHornInternal, GiMeat, GiSnowflake1,
    GiClawSlashes, GiWolfHead, GiFishScales, GiSpikedDragonHead, GiCrystalGrowth,
    GiSpinalCoil, GiGems, GiCrystalCluster, GiHood,
} from "../components/icons/LightweightGameIcons";
import type { IconType } from "../components/icons/LightweightGameIcons";
// Currency/material rewards reuse the game's own emblem set so they match the HUD.
import { GameIcon, ShinobiCurrencyIcon, type GameIconName } from "../components/icons/GameIcon";
import { ElementSigil } from "../components/icons/ElementSigil";
import centralCommandHero from "../assets/central-command-v2.webp";
import arenaDistrictArt from "../assets/facilities/battle-arena.webp";
import councilHallArt from "../assets/council-hall-command-v2.webp";
import grandMarketplaceArt from "../assets/facilities/shop.webp";
import hunterGuildArt from "../assets/hunter/hunter-guild-board.webp";
import ancientArchivesArt from "../assets/studio/archive-armory.webp";
import crafterForgeArt from "../assets/central/crafter-forge-v1.webp";
import petColosseumArt from "../assets/coliseum/pet-arena-command-v2.webp";
import relicDungeonArt from "../assets/towers/chamber.webp";
import celestialTowerArt from "../assets/towers/battle-towers-key-art-v1.webp";
import weeklyAshenDragonArt from "../assets/combat-actors/creatures/apex-ai-ember-drake-idle.webp";
import weeklyStormveilBeastArt from "../assets/combat-actors/creatures/apex-ai-ancient-chakra-beast-idle.webp";
import weeklyDeathsgateArt from "../assets/combat-actors/bosses/tower-spectral-boss-idle.webp";
import weeklyFrostfangArt from "../assets/combat-actors/bosses/tower-armored-boss-idle.webp";
import weeklyMoonshadowArt from "../assets/combat-actors/bosses/clan-boss-oni-idle.webp";
// Inline glyph style for section headers — sized to the heading text, nudged onto the baseline.
const HDR_ICON = { verticalAlign: "-0.12em", marginRight: "0.35rem" } as const;
// Small inline glyph for currency/cost lines.
const COST_ICON = { verticalAlign: "-2px", marginRight: "3px" } as const;
import { visiblePoll } from "../lib/poll";
import type { Character, VersionedCharacterCommit } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { ArmorQuality, EquipmentSlot, GameItem, ReviewBloodline, SavedBloodline } from "../types/combat";
import type { Rank, Screen } from "../types/core";
import { AWAKENING_ELEMENTS, AWAKENING_FREE_LV20_ID, AWAKENING_FREE_LV2_ID, AWAKENING_PAID_BOTH_ID, AWAKENING_PAID_SINGLE_ID, DAILY_MISSION_LIMIT, DUNGEON_KEY_ID, DUNGEON_LEGENDARY_FRAGMENT_ID, DUNGEON_LEGENDARY_RELIC_ID, ELEMENTAL_CORE_ID, ELEMENTAL_SHARD_ID, ELEMENTAL_SHARDS_PER_CORE, HOLLOW_GATE_KEY_ID, VEIL_OF_THE_HOLLOW_ID, WARFORGED_RELIC_ID, WEEKLY_BOSS_CORE_ID, COMBAT_RESOURCES_V2 } from "../constants/game";
import { PET_PVE_DURABILITY, petConsumables, petPveGear } from "../data/pet-config";
import { armorReductionForQuality, consumableHoldCap, equipmentSlotLabel, normalizeEquipmentSlot } from "../lib/equipment";
import { craftDungeonEvents } from "../data/vn-events";
import { getCharacterElements } from "../lib/elements";
import { getAllItems } from "../lib/items";
import { countItem } from "../lib/inventory";
import { publishSharedImage, readImageFile } from "../lib/shared-images";
import { starterSavedBloodlines } from "../data/jutsu";
import { tagMatchesName } from "../lib/tags";
import { weeklyBossSchedule } from "../lib/weekly-boss";
import { biomeLabel } from "../data/world";
import {
    HOLLOW_GATE_KEY_DUNGEON_KEY_COST,
    HOLLOW_GATE_KEY_FATE_SHARD_COST,
    type CreatorEvent,
} from "../App";
import { sharedWeeklyBossAiIdCache } from "../lib/world-state";
import { type VillageWarRecord } from "../lib/world-state";
import { SceneAmbience } from "../components/SceneAmbience";
import { SceneCritters } from "../components/SceneCritters";
import { DayNightSky } from "../components/DayNightSky";
import { NextGoalPin } from "../components/NextGoalPin";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { commitNamedForgeServer, forgeServer, rollNamedForgeServer } from "../lib/craft-api";
import { forgeHollowGateKeyServer } from "../lib/hollow-gate-forge-api";
import { gameToast } from "../components/GameToast";
import { Modal } from "../components/ui/Modal";
import { rollAwakeningServer } from "../lib/awakening-api";
import { purchaseBloodlineForge } from "../lib/bloodline-forge";
import { bloodlineTagPercentChoices, jutsuCountForRank, pointBudgetForRank } from "../lib/jutsu-points";
import { CentralAwakeningCinematic } from "../components/CentralAwakeningCinematic";
import { playGameSfx, primeGameAudio } from "../lib/game-audio";
import { primeCentralAwakeningArtwork } from "../lib/central-awakening-artwork";
import { dailyMissionsCompleted } from "../lib/character-progress";

const WEEKLY_BOSS_ART: Record<string, string> = {
    "ashen-dragon": weeklyAshenDragonArt,
    "moonshadow-oni": weeklyMoonshadowArt,
    "frostfang-warlord": weeklyFrostfangArt,
    "stormveil-beast": weeklyStormveilBeastArt,
    "deathsgate-revenant": weeklyDeathsgateArt,
};

// Fantasy glyph per craft material — gives the forge's material list real
// imagery instead of plain rows. Tiered by point value (see craftTier) for
// the chip's accent colour, so rarer mats read as more valuable at a glance.
const MATERIAL_ICON: Record<string, IconType> = {
    "hunt-torn-hide": GiAnimalHide,
    "hunt-wild-feather": GiFeather,
    "hunt-small-fang": GiFangs,
    "hunt-cracked-horn": GiHornInternal,
    "hunt-beast-meat": GiMeat,
    "hunt-frost-pelt": GiSnowflake1,
    "hunt-shadow-claw": GiClawSlashes,
    "hunt-wolf-fang": GiWolfHead,
    "hunt-ash-scale": GiFishScales,
    "hunt-ember-scale": GiSpikedDragonHead,
    "hunt-shadow-pelt": GiAnimalHide,
    "hunt-ancient-beast-core": GiCrystalGrowth,
    "hunt-titan-bone": GiSpinalCoil,
    "hunt-legendary-material": GiGems,
    [WEEKLY_BOSS_CORE_ID]: GiCrystalCluster,
    [DUNGEON_LEGENDARY_RELIC_ID]: GiDragonHead,
    [WARFORGED_RELIC_ID]: GiCrossedSwords,
    [VEIL_OF_THE_HOLLOW_ID]: GiHood,
};

const DUNGEON_BIOME_ICON: Record<string, GameIconName> = {
    forest: "leaf",
    snow: "snow",
    volcano: "bolt",
    shadow: "moon",
    central: "gate",
};

const BLOODLINE_AWAKENING_TIERS = [
    { rank: "B Rank", rankMark: "B", className: "rank-b", materialKey: "boneCharms", materialName: "Bone Charms", currencyIcon: "bone" },
    { rank: "A Rank", rankMark: "A", className: "rank-a", materialKey: "auraStones", materialName: "Aura Stones", currencyIcon: "crystal" },
    { rank: "S Rank", rankMark: "S", className: "rank-s", materialKey: "mythicSeals", materialName: "Mythic Seals", currencyIcon: "sigil" },
] as const;

// Material rarity band from its craft-point value → chip accent colour.
function craftTier(pts: number): "common" | "uncommon" | "rare" | "epic" | "legendary" {
    if (pts <= 5) return "common";
    if (pts <= 10) return "uncommon";
    if (pts <= 25) return "rare";
    if (pts <= 50) return "epic";
    return "legendary";
}

type NamedForgeKind = "weapon" | "armor";
type NamedForgeAnimation = { kind: NamedForgeKind; phase: "rolling" | "reveal" };
type NamedForgeRevealStat = { label: string; value: string };

function NamedForgeRollCinematic({
    kind,
    phase,
    stats,
}: {
    kind: NamedForgeKind;
    phase: NamedForgeAnimation["phase"];
    stats: NamedForgeRevealStat[];
}) {
    const Icon = kind === "weapon" ? GiCrossedSwords : GiBreastplate;
    const scanRows = (kind === "weapon" ? ["Edge", "Reach", "Combat tags"] : ["Armor grade", "Guard matrix", "Special sigil"])
        .map((label, index) => ({ label, value: ["READING", "BINDING", "ETCHING"][index] }));
    const rows = phase === "reveal" ? stats : scanRows;
    const itemLabel = kind === "weapon" ? "Named Weapon" : "Named Armor";

    return (
        <section
            className={`nf nf--${kind} is-${phase}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
        >
            <div className="nf-relic" aria-hidden="true"><span><Icon /></span></div>

            <div className="nf-copy">
                <span>
                    {phase === "rolling" ? "Master forge · fate in motion" : "One of one · roll sealed"}
                </span>
                <h3>{phase === "rolling" ? `Rolling ${itemLabel}` : `${itemLabel} Awakened`}</h3>
                <p>
                    {phase === "rolling"
                        ? "Heat, chakra, and chance are converging…"
                        : "The forge has spoken. Your final stats are locked."}
                </p>
            </div>

            <div className="nf-stats">
                {rows.map((row, index) => (
                    <div
                        className="nf-stat"
                        key={`${row.label}-${index}`}
                        style={{ "--i": index } as CSSProperties}
                    >
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                    </div>
                ))}
            </div>

            <div className="nf-progress" aria-hidden="true"><i /></div>
        </section>
    );
}

export function CentralHub({
    character,
    updateCharacter,
    setScreen,
    savedBloodlines,
    publicPlayerBloodlines,
    triggeredEvents,
    setTriggeredEvents,
    onStartEndlessBattle: _onStartEndlessBattle, // retained for backwards-compat with the prop site
    onStartDungeon,
    onOpenBloodlineMaker,
    onVersionedCharacter,
    onServerVersion,
    creatorItems,
    setCreatorItems,
    playableAis,
    sharedImages = {},
    openAwakeningOnMount = false,
    onAwakeningRequestHandled,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    setScreen: (screen: Screen) => void;
    savedBloodlines: SavedBloodline[];
    publicPlayerBloodlines: ReviewBloodline[];
    triggeredEvents: string[];
    setTriggeredEvents: React.Dispatch<React.SetStateAction<string[]>>;
    onStartEndlessBattle: () => void;
    onStartDungeon: (event: CreatorEvent) => void;
    onOpenBloodlineMaker: (rank: Rank, element?: string) => void;
    onVersionedCharacter?: VersionedCharacterCommit;
    onServerVersion?: (version?: number) => void;
    creatorItems: GameItem[];
    setCreatorItems: Dispatch<SetStateAction<GameItem[]>>;
    playableAis: CreatorAi[];
    sharedImages?: Record<string, string>;
    openAwakeningOnMount?: boolean;
    onAwakeningRequestHandled?: () => void;
}) {
    const commitServerCharacter = (nextCharacter: Character, version: unknown): boolean => {
        if (onVersionedCharacter) return onVersionedCharacter(nextCharacter, version);
        onServerVersion?.(typeof version === "number" ? version : undefined);
        updateCharacter(nextCharacter);
        return true;
    };
    const [centralLog, setCentralLog] = useState(
        "Welcome to Central — the neutral heart of the shinobi world."
    );
    const [showArchives, setShowArchives] = useState(false);
    const [showAwakening, setShowAwakening] = useState(openAwakeningOnMount);
    const [awakeningMsg, setAwakeningMsg] = useState("");
    useEffect(() => {
        if (!openAwakeningOnMount) return;
        onAwakeningRequestHandled?.();
    }, [openAwakeningOnMount, onAwakeningRequestHandled]);
    const [awakeningCinematic, setAwakeningCinematic] = useState<{
        elements: string[];
        mode: "awakening" | "reroll";
    } | null>(null);
    const [showCelestialPanel, setShowCelestialPanel] = useState(false);
    const [showDungeonPanel, setShowDungeonPanel] = useState(false);
    const [showCrafter, setShowCrafter] = useState(false);
    const [crafterTab, setCrafterTab] = useState<"supplies" | "weapons" | "armor">("supplies");
    // Batch-craft size for the Supplies tab — craft up to this many per click,
    // with the material (craft-point) cost scaled by the same factor.
    const [craftQty, setCraftQty] = useState(1);
    const [elementalCoreBusy, setElementalCoreBusy] = useState(false);
    const [craftBusy, setCraftBusy] = useState(false);
    const [awakeningBusy, setAwakeningBusy] = useState(false);
    const [bloodlineForgeBusy, setBloodlineForgeBusy] = useState(false);
    function beginCraft(): boolean {
        if (craftBusy) return false;
        setCraftBusy(true);
        return true;
    }
    function endCraft() {
        setCraftBusy(false);
    }
    const [weaponInfoItem, setWeaponInfoItem] = useState<GameItem | null>(null);
    // Active-war banner — fetches the world-state once on mount and
    // refreshes every 15s so the banner doesn't lag the war screen.
    // The dismiss is persistent per-war-ID via localStorage: once you
    // dismiss the banner for war X you never see it again, but a NEW
    // war (different war.id) gets a fresh banner that hasn't been
    // dismissed yet. Storage key holds a JSON array of war IDs.
    const [activeWarBanner, setActiveWarBanner] = useState<VillageWarRecord | null>(null);
    const [dismissedWarIds, setDismissedWarIds] = useState<Set<string>>(() => {
        try {
            const raw = localStorage.getItem("dismissedWarBanners.v1");
            if (!raw) return new Set();
            const parsed = JSON.parse(raw) as unknown;
            return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
        } catch { return new Set(); }
    });
    function dismissWarBanner(warId: string) {
        const next = new Set(dismissedWarIds);
        next.add(warId);
        setDismissedWarIds(next);
        try { localStorage.setItem("dismissedWarBanners.v1", JSON.stringify([...next])); } catch { /* ignore */ }
    }
    useEffect(() => {
        let alive = true;
        async function fetchWar() {
            try {
                const r = await fetch("/api/world-state");
                if (!r.ok) return;
                const data = await r.json() as { wars?: VillageWarRecord[] };
                if (!alive) return;
                const myVillage = (character.village ?? "").trim();
                const mine = (data.wars ?? []).find(w =>
                    !w.endedAt && Array.isArray(w.villages) && w.villages.includes(myVillage)
                );
                setActiveWarBanner(mine ?? null);
            } catch { /* silent */ }
        }
        void fetchWar();
        // 15s matches the war screen's poll cadence so the banner doesn't
        // lag the actual state by up to a minute (previously 60s, which
        // meant winners could sit on a stale "at war" banner for a full
        // poll cycle after victory).
        const stop = visiblePoll(fetchWar, 15_000);
        return () => { alive = false; stop(); };
    }, [character.village]);

    // Named Weapon forge state
    type NamedWeaponRoll = { ep: number; range: 3 | 4 | 5; offenseVal: number; tags: Array<{ name: string; percent: number }> };
    const [namedWeaponRoll, setNamedWeaponRoll] = useState<NamedWeaponRoll | null>(null);
    const [namedWeaponName, setNamedWeaponName] = useState("Unnamed Blade");
    const [namedWeaponImage, setNamedWeaponImage] = useState("");
    const [namedWeaponFlavorText, setNamedWeaponFlavorText] = useState("");
    const [namedWeaponToken, setNamedWeaponToken] = useState("");
    const [namedForgeBusy, setNamedForgeBusy] = useState(false);
    const [namedForgeAnimation, setNamedForgeAnimation] = useState<NamedForgeAnimation | null>(null);
    function beginNamedForge(): boolean {
        if (namedForgeBusy) return false;
        setNamedForgeBusy(true);
        return true;
    }
    function endNamedForge() {
        setNamedForgeBusy(false);
    }

    useEffect(() => {
        if (!namedForgeAnimation) return;
        if (namedForgeAnimation.phase === "rolling") {
            playGameSfx("omen", { gain: 0.58, playbackRate: namedForgeAnimation.kind === "weapon" ? 1.04 : 0.94 });
            return;
        }

        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
        playGameSfx("reveal", { gain: 0.78, playbackRate: namedForgeAnimation.kind === "weapon" ? 1.06 : 0.96 });
        const mythicTimer = window.setTimeout(() => playGameSfx("mythic", { gain: 0.74 }), reducedMotion ? 0 : 520);
        const finishTimer = window.setTimeout(() => setNamedForgeAnimation(null), reducedMotion ? 450 : 3_050);
        if (!reducedMotion) {
            try { navigator.vibrate?.([28, 42, 72]); } catch { /* optional feedback */ }
        }
        return () => {
            window.clearTimeout(mythicTimer);
            window.clearTimeout(finishTimer);
        };
    }, [namedForgeAnimation]);

    const NAMED_WEAPON_TAGS = [
        "Siphon", "Absorb", "Poison", "Wound",
        "Reflect", "Shield", "Drain", "Ignition", "Heal",
        "Increase Damage Given", "Increase Generals", "Decrease Damage Taken",
    ];

    async function rollNamedWeapon() {
        if (namedForgeLocked) return alert(namedForgeLockMessage);
        if (!beginNamedForge()) return;
        primeGameAudio(["omen", "reveal", "mythic"]);
        setNamedForgeAnimation({ kind: "weapon", phase: "rolling" });
        try {
            const result = await rollNamedForgeServer<NamedWeaponRoll>(character.name, "weapon");
            if (!result.roll || !result.token) {
                setNamedForgeAnimation(null);
                return alert(result.error || "The named weapon roll failed.");
            }
            setNamedWeaponRoll(result.roll);
            setNamedWeaponToken(result.token);
            setNamedForgeAnimation({ kind: "weapon", phase: "reveal" });
        } finally {
            endNamedForge();
        }
    }

    // Named gear uses one shared premium-currency economy on both sides of the
    // request boundary. The exact-payment check prevents whole materials from
    // silently rounding a 1,000-point forge upward.
    const NW_CURRENCY_PTS = NAMED_FORGE_CURRENCY_POINTS;
    const NW_COST = NAMED_FORGE_COST;
    // Named gear is the level-90 tier (shared/item-level-gate.ts) and the SERVER
    // refuses both the roll and the forge below it. Mirror that here so the
    // panel explains the lock instead of handing back a 403 after a click — a
    // named roll costs 1,000 forge points, so a silent failure is expensive.
    const namedForgeLocked = Math.max(1, Math.floor(Number(character.level) || 1)) < NAMED_ITEM_LEVEL_REQ;
    const namedForgeLockMessage = `Named forging unlocks at Level ${NAMED_ITEM_LEVEL_REQ}. You are Level ${character.level}.`;

    const { namedForgePts, namedForgePaymentReady } = useMemo(() => ({
        namedForgePts: namedForgePointTotal(character),
        namedForgePaymentReady: canPayNamedForge(character),
    }), [character]);
    const namedForgePaymentError = namedForgePts < NW_COST
        ? `Not enough materials. Need ${NW_COST} forge pts.`
        : `Your materials are worth ${namedForgePts} forge pts, but whole materials cannot make exactly ${NW_COST}. Add Bone Charms or Fate Shards to complete an exact payment.`;

    async function forgeNamedWeapon() {
        if (!requireServerSettlement("creatorItemCraft")) return;
        if (!namedWeaponRoll || !namedWeaponToken) return;
        if (!namedForgePaymentReady) return alert(namedForgePaymentError);
        if (!beginNamedForge()) return;
        try {
            const result = await commitNamedForgeServer(character.name, namedWeaponToken, namedWeaponName, namedWeaponFlavorText);
            if (!result.character || !result.item) return alert(result.error || "The named weapon forge failed.");
            const item: GameItem = { ...result.item, ...(namedWeaponImage ? { image: namedWeaponImage } : {}) };
            if (!commitServerCharacter(result.character, result._saveVersion)) return;
            setCreatorItems((current) => [...current.filter((entry) => entry.id !== item.id), item]);
            if (namedWeaponImage) {
                void publishSharedImage(`item:${item.id}`, namedWeaponImage).then((ok) => {
                    if (!ok) alert(`Heads up - ${item.name} was forged, but its image could not be saved.`);
                });
            }
            setNamedWeaponRoll(null);
            setNamedWeaponToken("");
            setNamedWeaponName("Unnamed Blade");
            setNamedWeaponImage("");
            setNamedWeaponFlavorText("");
            alert(`${item.name} has been forged and added to your inventory!`);
        } finally {
            endNamedForge();
        }
    }

    // ── Named Armor forge ───────────────────────────────────────────────
    // Mirrors the Named Weapon flow but produces a master-forged armor
    // piece. Player picks a slot from a dropdown; rolling fills in
    // randomized stats. Forge cost is shared with named weapons (1000
    // pts, same currency conversion) so both top-tier crafts use the
    // same currency sink.
    type NamedArmorRoll = {
        slot: EquipmentSlot;
        armorQuality: ArmorQuality; // Elite / Legendary / Mythic (6 / 7 / 8 %)
        offenseVal: number;         // 25 – 35, applied to all 4 offense stats
        defenseVal: number;         // 25 – 35, applied to all 4 defense stats
        special: { kind: string; value: number; bonusKey: string };
    };
    const [namedArmorRoll, setNamedArmorRoll] = useState<NamedArmorRoll | null>(null);
    const [namedArmorName, setNamedArmorName] = useState("Unnamed Vestige");
    const [namedArmorImage, setNamedArmorImage] = useState("");
    const [namedArmorFlavorText, setNamedArmorFlavorText] = useState("");
    const [namedArmorSlot, setNamedArmorSlot] = useState<EquipmentSlot>("body");
    const [namedArmorToken, setNamedArmorToken] = useState("");

    const NAMED_ARMOR_SLOTS: Array<{ value: EquipmentSlot; label: string }> = [
        { value: "head",  label: "Head" },
        { value: "body",  label: "Chest" },
        { value: "waist", label: "Waist" },
        { value: "legs",  label: "Legs" },
        { value: "feet",  label: "Feet" },
        // Gloves ride the hand slot — isArmorOrGloveItem checks for
        // /glove|gauntlet/i in the name, so forgeNamedArmor enforces a
        // "Gauntlets" suffix when this slot is chosen.
        { value: "hand",  label: "Gloves" },
    ];

    const NAMED_ARMOR_SPECIALS: Array<{ kind: string; bonusKey: string }> = [
        { kind: "Absorb",          bonusKey: "absorbPercent" },
        { kind: "Shield",          bonusKey: "shield" },
        { kind: "Reflect",         bonusKey: "reflectPercent" },
        { kind: "Life Steal",      bonusKey: "lifeStealPercent" },
        { kind: "Increase Damage", bonusKey: "damagePercent" },
    ];

    async function rollNamedArmor() {
        if (namedForgeLocked) return alert(namedForgeLockMessage);
        if (!beginNamedForge()) return;
        primeGameAudio(["omen", "reveal", "mythic"]);
        setNamedForgeAnimation({ kind: "armor", phase: "rolling" });
        try {
            const result = await rollNamedForgeServer<NamedArmorRoll>(character.name, "armor", namedArmorSlot);
            if (!result.roll || !result.token) {
                setNamedForgeAnimation(null);
                return alert(result.error || "The named armor roll failed.");
            }
            setNamedArmorRoll(result.roll);
            setNamedArmorToken(result.token);
            setNamedForgeAnimation({ kind: "armor", phase: "reveal" });
        } finally {
            endNamedForge();
        }
    }

    async function forgeNamedArmor() {
        if (!requireServerSettlement("creatorItemCraft")) return;
        if (!namedArmorRoll || !namedArmorToken) return;
        if (!namedForgePaymentReady) return alert(namedForgePaymentError);
        if (!beginNamedForge()) return;
        try {
            const result = await commitNamedForgeServer(character.name, namedArmorToken, namedArmorName, namedArmorFlavorText);
            if (!result.character || !result.item) return alert(result.error || "The named armor forge failed.");
            const item: GameItem = { ...result.item, ...(namedArmorImage ? { image: namedArmorImage } : {}) };
            if (!commitServerCharacter(result.character, result._saveVersion)) return;
            setCreatorItems((current) => [...current.filter((entry) => entry.id !== item.id), item]);
            if (namedArmorImage) {
                void publishSharedImage(`item:${item.id}`, namedArmorImage).then((ok) => {
                    if (!ok) alert(`Heads up - ${item.name} was forged, but its image could not be saved.`);
                });
            }
            setNamedArmorRoll(null);
            setNamedArmorToken("");
            setNamedArmorName("Unnamed Vestige");
            setNamedArmorImage("");
            setNamedArmorFlavorText("");
            alert(`${item.name} has been forged and added to your inventory!`);
        } finally {
            endNamedForge();
        }
    }

    const claimedAwakenings = new Set([...(character.claimedAwakenings ?? []), ...triggeredEvents]);
    const freeAwakeningKind = character.level >= 2 && !claimedAwakenings.has(AWAKENING_FREE_LV2_ID)
        ? AWAKENING_FREE_LV2_ID
        : character.level >= 20 && !claimedAwakenings.has(AWAKENING_FREE_LV20_ID)
            ? AWAKENING_FREE_LV20_ID
            : null;

    async function rollAwakening(kind: string) {
        if (awakeningBusy) return;
        setAwakeningBusy(true);
        try {
            const previous = getCharacterElements(character);
            const result = await rollAwakeningServer(character.name, kind);
            if (!commitServerCharacter(result.character, result._saveVersion)) return;
            setTriggeredEvents((current) => Array.from(new Set([
                ...current,
                ...(result.character.claimedAwakenings ?? []),
            ])));
            const next = getCharacterElements(result.character);
            const revealed = next.find(element => !previous.includes(element));
            const isPaidSingle = kind === AWAKENING_PAID_SINGLE_ID;
            const isPaidBoth = kind === AWAKENING_PAID_BOTH_ID;
            setAwakeningCinematic({
                elements: isPaidSingle ? next.slice(0, 1) : isPaidBoth ? next.slice(0, 2) : revealed ? [revealed] : next,
                mode: isPaidSingle || isPaidBoth ? "reroll" : "awakening",
            });
            setAwakeningMsg(isPaidSingle
                ? `✨ The stone swirls and reveals ${next[0]}! Your other element was preserved (-10 Fate Shards).`
                : isPaidBoth
                    ? `✨ The stone surges and reveals: ${next.slice(0, 2).join(" / ")}! Both elements were rerolled (-15 Fate Shards).`
                    : `✨ The stone pulses${revealed ? ` with ${revealed} chakra` : ""}! Your awakened elements: ${next.join(" / ")}.`);
        } catch (error) {
            setAwakeningMsg(`❌ ${error instanceof Error ? error.message : "Elemental awakening failed."}`);
        } finally {
            setAwakeningBusy(false);
        }
    }

    function awakeningFreeRoll() {
        if (freeAwakeningKind) void rollAwakening(freeAwakeningKind);
    }

    function awakeningPaidRoll() {
        if (character.fateShards < 10) {
            setAwakeningMsg("❌ Not enough Fate Shards — you need 10 to reroll your element.");
            return;
        }
        void rollAwakening(AWAKENING_PAID_SINGLE_ID);
    }

    function awakeningPaidBothRoll() {
        if (getCharacterElements(character).length < 2) {
            setAwakeningMsg("❌ Awaken your second element before rerolling both elements.");
            return;
        }
        if (character.fateShards < 15) {
            setAwakeningMsg("❌ Not enough Fate Shards — you need 15 to reroll both elements.");
            return;
        }
        void rollAwakening(AWAKENING_PAID_BOTH_ID);
    }

    async function awakeningCreateBloodline(rank: Rank, materialKey: "boneCharms" | "auraStones" | "mythicSeals", cost: number) {
        if (bloodlineForgeBusy) return;
        if ((character[materialKey] ?? 0) < cost) {
            const label = materialKey === "boneCharms" ? "Bone Charms" : materialKey === "auraStones" ? "Aura Stones" : "Mythic Seals";
            setAwakeningMsg(`❌ Not enough ${label} — you need ${cost}.`);
            return;
        }
        setBloodlineForgeBusy(true);
        try {
            const result = await purchaseBloodlineForge(character.name, rank);
            if (!result.ok || !result.character) throw new Error(result.error || "The Bloodline Awakening ritual rejected this purchase.");
            if (result.rank !== rank) throw new Error("The Bloodline Awakening ritual returned a mismatched grade. No builder was opened.");
            if (!commitServerCharacter(result.character, result._saveVersion)) return;
            setShowAwakening(false);
            setCentralLog(`${rank} Bloodline Awakening attuned. Finish shaping your legacy in Bloodline Awakening.`);
            onOpenBloodlineMaker(rank, getCharacterElements(result.character)[0] ?? "");
        } catch (error) {
            setAwakeningMsg(`❌ ${error instanceof Error ? error.message : "Bloodline Awakening is unavailable."}`);
        } finally {
            setBloodlineForgeBusy(false);
        }
    }

    const hasFreeRoll = freeAwakeningKind !== null;
    const weeklyBossOverrideAi = sharedWeeklyBossAiIdCache ? playableAis.find(ai => ai.id === sharedWeeklyBossAiIdCache) ?? null : null;
    // Surface the current server-wide hunt in the hub so players can tell whether
    // the destination is live before committing to the route.
    const weeklyBoss = weeklyBossSchedule(character, Date.now(), weeklyBossOverrideAi);
    const weeklyBossArtwork = weeklyBossOverrideAi?.image || WEEKLY_BOSS_ART[weeklyBoss.bossId] || weeklyMoonshadowArt;
    const allHubItems = getAllItems(creatorItems);

    function countInventory(itemId: string) {
        return countItem(character, itemId);
    }

    // Rewards are auto-distributed by the weekly-boss API at the 24h
    // despawn (top 10 → core, top 25 → key, all contributors → ryo/xp
    // share with MVP 2× bonus). No client-side claim handler is needed.

    // ── Unified craft-points pool ────────────────────────────────────────
    // Every craftable material — hunt drops AND boss/dungeon/war relics —
    // converts to points. All three Crafter tabs (Supplies, Weapons, Armor)
    // draw from this single pool: any material is accepted until a recipe's
    // point cost is filled. Consumption is cheapest-first, so high-value
    // relics are preserved until a craft is expensive enough to need them.
    const CRAFT_POINTS: Record<string, number> = {
        "hunt-torn-hide": 3,
        "hunt-wild-feather": 3,
        "hunt-small-fang": 3,
        "hunt-cracked-horn": 3,
        "hunt-beast-meat": 5,
        "hunt-frost-pelt": 8,
        "hunt-shadow-claw": 8,
        "hunt-wolf-fang": 10,
        "hunt-ash-scale": 15,
        "hunt-ember-scale": 20,
        "hunt-shadow-pelt": 25,
        "hunt-ancient-beast-core": 30,
        "hunt-titan-bone": 30,
        "hunt-legendary-material": 50,
        [WEEKLY_BOSS_CORE_ID]: 150,
        [DUNGEON_LEGENDARY_RELIC_ID]: 200,
        [WARFORGED_RELIC_ID]: 250,
        [VEIL_OF_THE_HOLLOW_ID]: 250,
    };
    const CRAFT_MATERIAL_NAMES: Record<string, string> = {
        "hunt-torn-hide": "Torn Hide",
        "hunt-wild-feather": "Wild Feather",
        "hunt-small-fang": "Small Fang",
        "hunt-cracked-horn": "Cracked Horn",
        "hunt-beast-meat": "Beast Meat",
        "hunt-frost-pelt": "Frost Pelt",
        "hunt-shadow-claw": "Shadow Claw",
        "hunt-wolf-fang": "Wolf Fang",
        "hunt-ash-scale": "Ash Scale",
        "hunt-ember-scale": "Ember Scale",
        "hunt-shadow-pelt": "Shadow Pelt",
        "hunt-ancient-beast-core": "Ancient Beast Core",
        "hunt-titan-bone": "Titan Bone",
        "hunt-legendary-material": "Legendary Material",
        [WEEKLY_BOSS_CORE_ID]: "Weekly Boss Core",
        [DUNGEON_LEGENDARY_RELIC_ID]: "Dungeon Legendary Relic",
        [WARFORGED_RELIC_ID]: "Warforged Relic",
        [VEIL_OF_THE_HOLLOW_ID]: "Veil of the Hollow",
    };

    function craftPointsTotal(): number {
        return Object.entries(CRAFT_POINTS).reduce((sum, [id, pts]) => {
            return sum + countItem(character, id) * pts;
        }, 0);
    }

    // Points-based weapon/armor crafting — both tabs draw from the unified
    // pool above, just like Supplies. Armor sits one tier above the
    // equivalent weapon rarity (hence the higher point cost). Ryo stays as
    // a secondary sink, scaled by rarity and shared across both crafts.
    function craftRyoForRarity(rarity: string): number {
        if (rarity === "rare") return 600;
        if (rarity === "epic") return 1400;
        return 3500; // legendary
    }
    function weaponCraftPoints(item: GameItem): number {
        if (item.rarity === "rare") return 150;
        if (item.rarity === "epic") return 350;
        return 700; // legendary
    }
    function armorCraftPoints(item: GameItem): number {
        if (item.rarity === "rare") return 200;
        if (item.rarity === "epic") return 400;
        return 800; // legendary
    }

    async function craftExistingWeapon(item: GameItem) {
        if (!requireServerSettlement("creatorItemCraft") || !beginCraft()) return;
        try {
            const result = await forgeServer(character.name, "weapon", item.id, 1);
            if (!result.character) return alert(result.error || "The weapon forge failed.");
            if (!commitServerCharacter(result.character, result._saveVersion)) return;
            alert(`${item.name} forged and added to your inventory.`);
        } finally {
            endCraft();
        }
    }

    async function craftExistingArmor(item: GameItem) {
        if (!requireServerSettlement("creatorItemCraft") || !beginCraft()) return;
        try {
            const result = await forgeServer(character.name, "armor", item.id, 1);
            if (!result.character) return alert(result.error || "The armor forge failed.");
            if (!commitServerCharacter(result.character, result._saveVersion)) return;
            alert(`${item.name} forged and added to your inventory.`);
        } finally {
            endCraft();
        }
    }

    const craftableWeapons = allHubItems
        .filter((item) => item.slot === "hand" && item.weaponEp != null && ["rare", "epic", "legendary"].includes(item.rarity) && !item.id.startsWith("named-weapon-"))
        .sort((a, b) => {
            const rank = { common: 0, uncommon: 0.5, rare: 1, epic: 2, legendary: 3, mythic: 4 } as Record<string, number>;
            return (rank[a.rarity] ?? 0) - (rank[b.rarity] ?? 0) || a.name.localeCompare(b.name);
        });

    // Armor items: rare-rarity body/head/waist/legs/feet pieces with
    // armorQuality set. Restricted to rare for now per design — epic/
    // legendary armor crafting can be unlocked later by widening the
    // rarity allowlist.
    const ARMOR_SLOTS = new Set(["body", "head", "waist", "legs", "feet"]);
    const craftableArmor = allHubItems
        .filter((item) => ARMOR_SLOTS.has(normalizeEquipmentSlot(item.slot)) && item.armorQuality && item.rarity === "rare")
        .sort((a, b) => a.name.localeCompare(b.name));

    const awakenedElements = getCharacterElements(character);
    const dungeonKeyCount = countInventory(DUNGEON_KEY_ID);
    const dailyMissionCount = dailyMissionsCompleted(character);
    const weeklyBossBadge = weeklyBoss.status === "active"
        ? `${weeklyBoss.bossIcon} Live now`
        : weeklyBoss.status === "defeated"
            ? "Cleared this week"
            : weeklyBoss.status === "escaped"
                ? "Returns next week"
                : "Approaching";
    const centralDistricts = [
        {
            id: "city",
            eyebrow: "Navigate the capital",
            title: "City Districts",
            description: "Competition, governance, trade, and contracts—the essential services of Central.",
            tone: "azure",
            options: [
                {
                    name: "Arena District",
                    kicker: "Compete",
                    badge: "Ranked & clan",
                    art: arenaDistrictArt,
                    artPosition: "52% center",
                    text: "Enter tournaments, ranked ladders, spectator boards, and challenge halls.",
                    action: () => setScreen("arenaDistrict"),
                },
                {
                    name: "Shinobi Council Hall",
                    kicker: "Govern",
                    badge: "War command",
                    art: councilHallArt,
                    artPosition: "72% center",
                    text: "Review active village and clan wars, side strength, and leading contributors.",
                    action: () => setScreen("shinobiCouncil"),
                },
                {
                    name: "Grand Marketplace",
                    kicker: "Trade",
                    badge: "Elite stock",
                    art: grandMarketplaceArt,
                    artPosition: "66% center",
                    text: "Browse legendary gear, companion equipment, and premium card packs.",
                    action: () => setScreen("grandMarketplace"),
                },
                {
                    name: "Hunter Guild",
                    kicker: "Track",
                    badge: "Contracts",
                    art: hunterGuildArt,
                    artPosition: "center",
                    text: "Take beast contracts, track sectors, gather materials, and build hunter rank.",
                    action: () => setScreen("hunting"),
                },
            ],
        },
        {
            id: "legacy",
            eyebrow: "Shape your legend",
            title: "Legacy & Craft",
            description: "Study the world, awaken your nature, and turn hard-won materials into power.",
            tone: "gold",
            options: [
                {
                    name: "Hall of Legends",
                    kicker: "Compare",
                    badge: "Leaderboards",
                    art: "/legacy/hall-of-legends-banner.webp",
                    artPosition: "center",
                    text: "See the shinobi, clans, pets, streaks, and villages defining the current era.",
                    action: () => setScreen("hallOfLegends"),
                },
                {
                    name: "Ancient Archives",
                    kicker: "Study",
                    badge: "Bloodline codex",
                    art: ancientArchivesArt,
                    artPosition: "64% center",
                    text: "Explore bloodline lore, techniques, ranks, elements, and player records.",
                    action: () => setShowArchives(true),
                },
                {
                    name: "Awakening Stone",
                    kicker: "Awaken",
                    badge: hasFreeRoll ? "Free awakening ready" : awakenedElements.length ? awakenedElements.join(" · ") : "Elemental path",
                    art: "/assets/awakening-stone-cinematic-v1.webp",
                    artPosition: "center",
                    text: awakenedElements.length
                                ? "Reroll your elemental nature or begin a Bloodline Awakening with ancient materials."
                                : "Reveal your elemental nature and open the path to Bloodline Awakening.",
                    action: () => {
                        primeCentralAwakeningArtwork();
                        primeGameAudio(["omen", "reveal", "mythic"]);
                        setShowAwakening(true);
                        setAwakeningMsg("");
                    },
                    featured: hasFreeRoll,
                },
                {
                    name: "Crafter",
                    kicker: "Forge",
                    badge: "Weapons & supplies",
                    art: crafterForgeArt,
                    artPosition: "68% center",
                    text: "Convert hunting, boss, dungeon, and war materials into proven equipment.",
                    action: () => setShowCrafter(true),
                },
            ],
        },
        {
            id: "frontier",
            eyebrow: "Push beyond the gates",
            title: "Trials & Expeditions",
            description: "High-stakes destinations for companions, relic hunters, and veteran shinobi.",
            tone: "crimson",
            options: [
                {
                    name: "Pet Colosseum",
                    kicker: "Command",
                    badge: "Companion trials",
                    art: petColosseumArt,
                    artPosition: "72% center",
                    text: "Choose a companion for cinematic Colosseum showdowns or command a four-pet squad in Hollow Warfront.",
                    action: () => setScreen("petArena"),
                },
                {
                    name: "Relic Dungeons",
                    kicker: "Explore",
                    badge: `${dungeonKeyCount} ${dungeonKeyCount === 1 ? "key" : "keys"}`,
                    art: relicDungeonArt,
                    artPosition: "center",
                    text: "Spend a Dungeon Key to breach one of five relic vaults with equal strength curves.",
                    action: () => setShowDungeonPanel(true),
                },
                {
                    name: "Weekly Boss",
                    kicker: "Rally",
                    badge: weeklyBossBadge,
                    art: weeklyBossArtwork,
                    artPosition: "center 24%",
                    text: `${weeklyBoss.bossName} anchors this week's server-wide 72-hour hunt and contribution ladder.`,
                    action: () => setScreen("weeklyBoss"),
                    featured: weeklyBoss.status === "active",
                },
                {
                    name: "Celestial Tower",
                    kicker: "Ascend",
                    badge: "Endless climb",
                    art: celestialTowerArt,
                    artPosition: "72% center",
                    text: "Climb scaling floors, protect your banked ryo, and claim permanent milestones.",
                    action: () => setShowCelestialPanel(true),
                },
            ],
        },
    ] as const;
    return (
        <div className="central-hub">
            {awakeningCinematic && (
                <CentralAwakeningCinematic
                    elements={awakeningCinematic.elements}
                    mode={awakeningCinematic.mode}
                    playerName={character.name}
                    onFinished={() => setAwakeningCinematic(null)}
                />
            )}
            {/* Drifting golden motes + god-ray sweep + time-of-day wash + a few
                doves/fireflies over the citadel backdrop (all sit behind the cards
                via z-index in central-skin.css). */}
            <SceneAmbience biome="central" />
            <DayNightSky />
            <SceneCritters biome="central" density={0.7} />
            <header
                className="central-hero"
                style={{ "--central-hero-art": `url(${centralCommandHero})` } as CSSProperties}
            >
                <div className="central-hero-copy">
                    <div className="central-hero-eyebrow">
                        <GiTempleGate aria-hidden="true" />
                        <span>World capital · Neutral territory</span>
                    </div>
                    <h1>
                        <span className="central-hero-title">Central</span>
                        <span className="central-hero-subtitle">The Thousand Gates</span>
                    </h1>
                    <p>
                        Choose your district, follow the live signals, and move through the
                        shinobi world from one clear command center.
                    </p>
                </div>
                <aside className="central-passport" aria-label="Central arrival status">
                    <div className="central-level-seal" aria-label={`Level ${character.level}`}>
                        <span>Level</span>
                        <strong>{character.level}</strong>
                    </div>
                    <div className="central-passport-copy">
                        <span>Arrival status</span>
                        <strong>{character.village ? `${character.village} envoy` : "Independent shinobi"}</strong>
                        <small>{character.rankTitle || "Academy shinobi"}</small>
                    </div>
                    <div className="central-passport-signals" aria-label="Central resources">
                        <span><small>Relic keys</small><strong>{dungeonKeyCount}</strong></span>
                        <span>
                            <small>Daily missions</small>
                            <strong>{dailyMissionCount}<em>/{DAILY_MISSION_LIMIT}</em></strong>
                        </span>
                    </div>
                </aside>
            </header>

            <NextGoalPin
                character={character}
                navigate={setScreen}
                onOpenAwakening={() => {
                    setShowAwakening(true);
                    setAwakeningMsg("");
                }}
            />

            <div className="central-log" role="status" aria-live="polite">
                <span className="central-log-icon" aria-hidden="true"><GiSparkles /></span>
                <span className="central-log-copy">
                    <strong>Central dispatch</strong>
                    <span>{centralLog}</span>
                </span>
            </div>

            {/* Active-war alert: only renders when the player's village
                is in an active war and the banner hasn't been dismissed
                this session. Click-through routes to the Town Hall, which
                hosts the Village War button. Subtle pulse so it draws
                the eye without being obnoxious. */}
            {activeWarBanner && !dismissedWarIds.has(activeWarBanner.id) && (() => {
                const myVillage = (character.village ?? "").trim();
                const enemy = activeWarBanner.villages.find(v => v !== myVillage) ?? "?";
                const myHp = activeWarBanner.hp?.[myVillage] ?? 0;
                const enemyHp = activeWarBanner.hp?.[enemy] ?? 0;
                const isPending = !!activeWarBanner.pendingUntil && activeWarBanner.pendingUntil > serverNow();
                const minsToWar = isPending ? Math.max(1, Math.ceil((activeWarBanner.pendingUntil! - serverNow()) / 60_000)) : 0;
                const ageDays = Math.floor((serverNow() - (activeWarBanner.pendingUntil ?? activeWarBanner.startedAt)) / (24 * 60 * 60 * 1000));
                return (
                    <section className={`central-war-alert ${isPending ? "is-pending" : "is-active"}`} aria-label="Active village war">
                        <div className="central-war-copy">
                            {isPending ? (
                                <>
                                    <strong>⏳ {character.village} vs {enemy} — War starts in {minsToWar} min</strong>
                                    <div className="central-war-summary">
                                        Pre-war window. Rally your village, queue guards, gather pre-fight buffs. No HP can drop until the timer expires.
                                    </div>
                                </>
                            ) : (
                                <>
                                    <strong>⚔ {character.village} is at War with {enemy}</strong>
                                    <div className="central-war-metrics">
                                        <span>Day {ageDays + 1}</span>
                                        <span>{myVillage}: <strong>{myHp.toLocaleString()}</strong> HP</span>
                                        <span>{enemy}: <strong>{enemyHp.toLocaleString()}</strong> HP</span>
                                        <span>War Ground HP: <strong>{activeWarBanner.warGroundHp}</strong></span>
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="central-war-actions">
                            <button
                                className="central-war-primary"
                                onClick={() => setScreen("townHall")}
                            >
                                Open war room →
                            </button>
                            <button
                                className="central-war-dismiss"
                                onClick={() => dismissWarBanner(activeWarBanner.id)}
                                title="Hide this banner for this war (a new war will surface a fresh one)"
                            >
                                Dismiss
                            </button>
                        </div>
                    </section>
                );
            })()}

            <div className="central-directory" aria-label="Central destinations">
                {centralDistricts.map((district, districtIndex) => (
                    <section
                        className="central-district"
                        data-tone={district.tone}
                        key={district.id}
                        aria-labelledby={`central-district-${district.id}`}
                    >
                        <div className="central-district-heading">
                            <div className="central-district-index" aria-hidden="true">0{districtIndex + 1}</div>
                            <div className="central-district-title">
                                <span>{district.eyebrow}</span>
                                <h2 id={`central-district-${district.id}`}>{district.title}</h2>
                            </div>
                            <p>{district.description}</p>
                        </div>
                        <div className="central-grid">
                            {district.options.map((option) => (
                                <button
                                    className={`central-card ${"featured" in option && option.featured ? "is-featured" : ""}`}
                                    key={option.name}
                                    onClick={option.action}
                                >
                                    <span className="central-card-art" aria-hidden="true">
                                        <img
                                            src={option.art}
                                            alt=""
                                            loading="lazy"
                                            decoding="async"
                                            style={{ objectPosition: option.artPosition }}
                                        />
                                    </span>
                                    <span className="central-card-content">
                                        <span className="central-card-meta">
                                            <span className="central-card-kicker">{option.kicker}</span>
                                            <span className="central-card-badge">{option.badge}</span>
                                        </span>
                                        <strong>{option.name}</strong>
                                        <small>{option.text}</small>
                                    </span>
                                    <span className="central-card-arrow" aria-hidden="true">→</span>
                                </button>
                            ))}
                        </div>
                    </section>
                ))}
            </div>

            {showDungeonPanel && (
                <Modal open={showDungeonPanel} onClose={() => setShowDungeonPanel(false)} bare ariaLabel="Relic Dungeons" size="lg" className="central-dialog-shell central-dialog-shell--relic">
                    <div className="relic-command-panel">
                        <header className="relic-command-header" style={{ "--relic-header-art": `url(${centralCommandHero})` } as CSSProperties}>
                            <button type="button" className="relic-command-close" onClick={() => setShowDungeonPanel(false)} aria-label="Return to Central">← <span>Central</span></button>
                            <div className="relic-command-title">
                                <span><GiDungeonGate /> Frontier district · sealed vault network</span>
                                <h2>Relic Dungeons</h2>
                                <p>Choose a biome vault. Every breach follows the same three-seal strength curve and awards a Dungeon Legendary Relic on full clear.</p>
                            </div>
                            <div className="relic-key-balance" aria-label={`${dungeonKeyCount} Dungeon Keys available`}>
                                <GameIcon name="gate" size={22} />
                                <span>Dungeon keys<strong>{dungeonKeyCount}</strong></span>
                            </div>
                        </header>
                        <div className="relic-command-grid">
                            {craftDungeonEvents.map((event) => (
                                <button
                                    key={event.id}
                                    className="relic-command-card"
                                    data-biome={event.biome}
                                    onClick={() => {
                                        setShowDungeonPanel(false);
                                        onStartDungeon(event);
                                    }}
                                    disabled={dungeonKeyCount <= 0 || character.level < event.levelReq}
                                >
                                    <span className="relic-command-card-glow" aria-hidden="true" />
                                    <span className="relic-command-card-icon"><GameIcon name={DUNGEON_BIOME_ICON[event.biome] ?? "sigil"} size={30} /></span>
                                    <span className="relic-command-card-copy">
                                        <small>{biomeLabel(event.biome)} vault</small>
                                        <strong>{event.name}</strong>
                                        <span>{event.vnScene}</span>
                                    </span>
                                    <span className="relic-command-card-footer">
                                        <span>Required level {event.levelReq}</span>
                                        <b>{dungeonKeyCount <= 0 ? "No key" : character.level < event.levelReq ? "Locked" : "Breach vault →"}</b>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </Modal>
            )}

            {showCelestialPanel && (
                <Modal open={showCelestialPanel} onClose={() => setShowCelestialPanel(false)} bare ariaLabel="Celestial Tower" size="lg" className="central-dialog-shell">
                    <div className="celestial-panel">
                        <h2><GiStoneTower style={HDR_ICON} />Celestial Tower</h2>
                        <p className="celestial-panel-sub">Two ways to climb: the endless gauntlet, or curated Battle Tower squad floors.</p>
                        <div style={{ background: "rgba(15,23,42,0.5)", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 6, padding: "0.7rem 0.9rem", margin: "0.4rem 0 0.8rem", fontSize: "0.85rem", lineHeight: 1.5 }}>
                            <div><strong>How it works</strong></div>
                            <div>· Each wave drops a random AI scaled to your level + current wave. Every 10th wave is a boss.</div>
                            <div>· Win → bank ryo, advance to the next wave with whatever HP you have left.</div>
                            <div>· Die → all banked ryo is lost. Hospital trip applies. <strong>Milestone currencies stay credited.</strong></div>
                            <div style={{ marginTop: 6 }}><strong>Kill milestones</strong> (auto-credited, repeat every 20 kills):</div>
                            <div>· Kills 5, 10 → <span style={{ color: "#a78bfa" }}>+5 Bone Charms</span></div>
                            <div>· Kill 15 → <span style={{ color: "var(--gold)" }}>+5 Fate Shards</span></div>
                            <div>· Kill 20 → <span style={{ color: "#a78bfa" }}>+5 Bone Charms</span> &amp; <span style={{ color: "var(--gold)" }}>+5 Fate Shards</span></div>
                            <div>· Pattern repeats: 25/30 bone, 35 fate, 40 both, and so on.</div>
                            <div style={{ marginTop: 6 }}><strong>Rest stops:</strong> every 10th kill automatically restores 33% HP and 50% chakra &amp; stamina.</div>
                        </div>
                        <div className="celestial-panel-options">
                            <button className="celestial-option-btn celestial-endless-btn" onClick={() => { setShowCelestialPanel(false); setScreen("endlessTower"); }}>
                                <span className="celestial-option-icon"><GiStoneTower /></span>
                                <strong>Enter Celestial Tower</strong>
                                <small>Fight until you fall. Banked ryo lost on death — milestones survive.</small>
                            </button>
                            <button className="celestial-option-btn" onClick={() => { setShowCelestialPanel(false); setScreen("battleTowers"); }}>
                                <span className="celestial-option-icon"><GiCrossedSwords /></span>
                                <strong>Battle Towers</strong>
                                <small>Curated squad floors — objectives, gimmicks, bosses. Free retries; first-clear rewards &amp; a leaderboard.</small>
                            </button>
                        </div>
                        <button className="back-btn" style={{ marginTop: "1rem" }} onClick={() => setShowCelestialPanel(false)}>× Close</button>
                    </div>
                </Modal>
            )}

            {showArchives && (() => {
                const allBloodlines = [
                    ...starterSavedBloodlines.map(b => ({ ...b, image: b.image || sharedImages['bloodline:' + b.id] || "" })),
                    ...savedBloodlines.filter((b) => !starterSavedBloodlines.some((s) => s.id === b.id || s.name === b.name)),
                    ...publicPlayerBloodlines.filter((b) =>
                        !starterSavedBloodlines.some((s) => s.id === b.id || s.name === b.name) &&
                        !savedBloodlines.some((saved) => saved.id === b.id)
                    ),
                ];
                return (
                    <Modal open={showArchives} onClose={() => setShowArchives(false)} bare ariaLabel="Ancient Archives" size="lg" className="central-dialog-shell central-dialog-shell--wide">
                        <div className="archives-panel">
                            <div className="archives-header">
                                <h2><GiBookshelf style={HDR_ICON} />Ancient Archives — Bloodline Codex</h2>
                                <button className="danger-button" onClick={() => setShowArchives(false)}>× Close</button>
                            </div>
                            <p className="archives-subtitle">
                                {allBloodlines.length} bloodline{allBloodlines.length !== 1 ? "s" : ""} recorded — {starterSavedBloodlines.length} ancient, {allBloodlines.length - starterSavedBloodlines.length} custom
                            </p>
                            <div className="archives-grid">
                                {allBloodlines.map((bl) => (
                                    <div className="archives-card" key={`${(bl as ReviewBloodline).ownerKey ?? "local"}:${bl.id}`}>
                                        <div className="archives-card-img-wrap">
                                            {bl.image
                                                ? <img src={bl.image} alt={bl.name} className="archives-card-img" />
                                                : <div className="archives-card-no-img">🖼️</div>
                                            }
                                        </div>
                                        <div className="archives-card-body">
                                            <div className="archives-card-title-row">
                                                <h3>{bl.name}</h3>
                                                <span className="archives-rank-badge">{bl.rank}</span>
                                            </div>
                                            {(bl as ReviewBloodline).ownerName && (
                                                <span className="archives-element-tag">Created by {(bl as ReviewBloodline).ownerName}</span>
                                            )}
                                            {bl.specialElement && (
                                                <span className="archives-element-tag">🌀 {bl.specialElement} Release</span>
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
                    </Modal>
                );
            })()}

            {showAwakening && (
                <Modal open={showAwakening} onClose={() => setShowAwakening(false)} bare ariaLabel="Awakening Stone" size="lg" className="central-dialog-shell dlg-aw">
                    <div className="aw-panel aw-command-panel">
                        <header className="aw-command-header">
                            <button type="button" className="aw-command-close" onClick={() => setShowAwakening(false)} aria-label="Return to Central">← <span>Central</span></button>
                            <div className="aw-command-title">
                                <span><GiCrystalBall /> Legacy district · elemental sanctum</span>
                                <h2>Awakening Stone</h2>
                                <p>Reveal your chakra nature, inventory ancient materials, and awaken a bloodline worthy of the Thousand Gates.</p>
                            </div>
                            <div className="aw-command-seal" aria-hidden="true"><GiCrystalBall /></div>
                        </header>

                        {/* Current element status */}
                        <div className="aw-element-display">
                            {(() => {
                                const ownedElements = getCharacterElements(character);
                                return ownedElements.length ? (
                                    <>
                                        <div className="aw-element-badges">
                                            {ownedElements.map((element) => (
                                                <span key={element} className={`aw-element-badge element-${element.toLowerCase()}`}>
                                                    <ElementSigil element={element} size={28} />
                                                    <span>{element}</span>
                                                </span>
                                            ))}
                                        </div>
                                        <p className="aw-element-desc">Your chakra resonates with <strong>{ownedElements.join(" / ")}</strong> energy. You can train jutsu that match these elements.</p>
                                    </>
                                ) : (
                                    <p className="aw-element-desc aw-unawakened">Your element has not yet been awakened. Use the stone to reveal your nature.</p>
                                );
                            })()}
                        </div>

                        {awakeningMsg && (
                            <div className={`aw-msg ${awakeningMsg.startsWith("❌") ? "aw-msg-error" : "aw-msg-success"}`}>
                                {awakeningMsg}
                            </div>
                        )}

                        <div className="aw-command-grid">
                        {/* Element roll section */}
                        <div className="aw-section aw-section--element">
                            <h3><span className="aw-section-icon"><GiSparkles /></span><span>Elemental Awakening<small>Chakra attunement</small></span></h3>
                            <p className="aw-hint">The stone reveals one of five chakra natures.</p>
                            <div className="aw-element-key" aria-label="Possible chakra natures">
                                {AWAKENING_ELEMENTS.map((element) => (
                                    <span key={element}><ElementSigil element={element} size={20} /><span>{element}</span></span>
                                ))}
                            </div>
                            <div className="aw-roll-row">
                                {hasFreeRoll ? (
                                    <button className="aw-free-btn" onClick={awakeningFreeRoll} disabled={awakeningBusy}>
                                        <span className="aw-action-seal"><GiSparkles /></span>
                                        <span className="aw-action-copy">
                                            <strong>{awakeningBusy ? "Awakening..." : "Awaken Element"}</strong>
                                            <small>{freeAwakeningKind === AWAKENING_FREE_LV20_ID ? "Level 20 reward · No cost" : "Level 2 reward · No cost"}</small>
                                        </span>
                                        <span className="aw-action-arrow" aria-hidden="true">→</span>
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            className="aw-paid-btn"
                                            onClick={awakeningPaidRoll}
                                            disabled={character.fateShards < 10 || awakeningBusy}
                                            title={character.fateShards < 10 ? "Not enough Fate Shards" : "Reroll your primary element and preserve the other"}
                                        >
                                            <span className="aw-action-seal"><GameIcon name="dice" size={20} /></span>
                                            <span className="aw-action-copy">
                                                <strong>{awakeningBusy ? "Attuning..." : "Reroll Element"}</strong>
                                                <small>1 element · 10 Fate Shards · {character.fateShards} available</small>
                                            </span>
                                            <span className="aw-action-arrow" aria-hidden="true">→</span>
                                        </button>
                                        <button
                                            className="aw-paid-btn aw-paid-btn--both"
                                            onClick={awakeningPaidBothRoll}
                                            disabled={awakenedElements.length < 2 || character.fateShards < 15 || awakeningBusy}
                                            title={awakenedElements.length < 2 ? "Awaken your second element first" : character.fateShards < 15 ? "Not enough Fate Shards" : "Reroll both elements"}
                                        >
                                            <span className="aw-action-seal"><GameIcon name="dice" size={20} /></span>
                                            <span className="aw-action-copy">
                                                <strong>{awakeningBusy ? "Attuning..." : "Reroll Elements"}</strong>
                                                <small>Both elements · 15 Fate Shards · {character.fateShards} available</small>
                                            </span>
                                            <span className="aw-action-arrow" aria-hidden="true">→</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Material balances */}
                        <div className="aw-section aw-section--materials">
                            <h3><span className="aw-section-icon"><GiStoneStack /></span><span>Ancient Materials<small>Inventory reserve</small></span></h3>
                            <div className="aw-materials">
                                <div className="aw-material-row">
                                    <span className="aw-material-icon"><ShinobiCurrencyIcon name="bone" size={27} /></span>
                                    <span className="aw-material-name">Bone Charms</span>
                                    <span className="aw-material-count">{character.boneCharms ?? 0}</span>
                                </div>
                                <div className="aw-material-row">
                                    <span className="aw-material-icon"><ShinobiCurrencyIcon name="crystal" size={27} /></span>
                                    <span className="aw-material-name">Aura Stones</span>
                                    <span className="aw-material-count">{character.auraStones ?? 0}</span>
                                </div>
                                <div className="aw-material-row">
                                    <span className="aw-material-icon"><ShinobiCurrencyIcon name="sigil" size={27} /></span>
                                    <span className="aw-material-name">Mythic Seals</span>
                                    <span className="aw-material-count">{character.mythicSeals ?? 0}</span>
                                </div>
                            </div>
                        </div>

                        {/* Bloodline Awakening section */}
                        <div className="aw-section aw-section--forge">
                            <div className="aw-forge-heading">
                                <h3><span className="aw-section-icon"><GiFlame /></span><span>Bloodline Awakening<small>Ancestral legacy ritual</small></span></h3>
                                <span className="aw-forge-protocol">Stone attuned · Archive linked</span>
                            </div>
                            <p className="aw-hint">Bind ancient materials to a ritual grade, then enter the Awakening workspace to shape its identity, element, and inherited techniques.</p>
                            <div className="aw-forge-journey" aria-label="Bloodline Awakening process">
                                <span className="is-active"><b>01</b><small>Choose</small><strong>Ritual grade</strong></span>
                                <i aria-hidden="true">→</i>
                                <span><b>02</b><small>Shape</small><strong>Legacy &amp; jutsu</strong></span>
                                <i aria-hidden="true">→</i>
                                <span><b>03</b><small>Seal</small><strong>Equip bloodline</strong></span>
                            </div>
                            <div className="aw-forge-grid">
                                {BLOODLINE_AWAKENING_TIERS.map((tier) => {
                                    const balance = character[tier.materialKey] ?? 0;
                                    const remaining = Math.max(0, 100 - balance);
                                    const isReady = balance >= 100;
                                    const jutsuCount = jutsuCountForRank(tier.rank);
                                    const pointBudget = pointBudgetForRank(tier.rank);
                                    const percentChoices = bloodlineTagPercentChoices(tier.rank);
                                    return (
                                        <article className={`aw-forge-card ${tier.className}${isReady ? " is-ready" : " is-locked"}`} key={tier.rank}>
                                            <div className="aw-forge-card-header">
                                                <span className="aw-forge-tier">{tier.rankMark}</span>
                                                <div><small>Bloodline grade</small><div className="aw-forge-rank">{tier.rank}</div></div>
                                                <span className="aw-forge-readiness">{isReady ? "Ritual ready" : `${remaining} needed`}</span>
                                            </div>
                                            <div className="aw-forge-builder-spec" aria-label={`${tier.rank} builder limits`}>
                                                <span><b>{jutsuCount}</b><small>Techniques</small></span>
                                                <span><b>{pointBudget}</b><small>Point cap</small></span>
                                                <span><b>{percentChoices.map((choice) => `${choice}%`).join(" / ")}</b><small>Tag power</small></span>
                                            </div>
                                            <div className="aw-forge-material">
                                                <ShinobiCurrencyIcon name={tier.currencyIcon} size={29} />
                                                <div><strong>100 {tier.materialName}</strong><small>{balance} held in inventory</small></div>
                                            </div>
                                            <div className="aw-forge-meter" aria-label={`${Math.min(balance, 100)} of 100 ${tier.materialName}`}>
                                                <i style={{ width: `${Math.min(100, balance)}%` }} />
                                            </div>
                                            <button
                                                className="aw-forge-btn"
                                                onClick={() => awakeningCreateBloodline(tier.rank, tier.materialKey, 100)}
                                                disabled={!isReady || bloodlineForgeBusy}
                                            >
                                                <span>{bloodlineForgeBusy && isReady ? "Attuning..." : `Awaken ${tier.rank}`}</span>
                                                <small>{isReady ? "Enter Bloodline Awakening" : `Collect ${remaining} more`}</small>
                                                <b aria-hidden="true">→</b>
                                            </button>
                                        </article>
                                    );
                                })}
                            </div>
                        </div>
                        </div>
                    </div>
                </Modal>
            )}

            {showCrafter && (() => {
                // Supplies, Weapons, and Armor all read the same unified
                // craft-points pool (CRAFT_POINTS / craftPointsTotal) so the
                // three tabs stay balanced against one another. The server owns
                // material consumption and final grants.
                const totalPts = craftPointsTotal();

                // Batch craft up to `qty` copies, scaling the craft-point cost by
                // the same factor ("raise the materials to compensate"). Capped
                // consumables clamp the batch to the carry cap so crafting can't
                // exceed what the shop lets you hold; affordability clamps the rest.
                async function craftRecipe(
                    recipe: { name: string; cost: number; itemId: string; per?: number },
                    qty: number,
                ) {
                    if (!requireServerSettlement("creatorItemCraft")) return;
                    const affordable = Math.floor(totalPts / recipe.cost);
                    if (affordable < 1) return alert(`Not enough materials. Need ${recipe.cost} craft points, you have ${totalPts}.`);
                    let quantity = Math.min(Math.max(1, Math.floor(qty)), affordable);
                    const item = allHubItems.find((entry) => entry.id === recipe.itemId);
                    const cap = item ? consumableHoldCap(item) : null;
                    if (cap != null) {
                        const maxByCap = Math.floor(Math.max(0, cap - countItem(character, recipe.itemId)) / (recipe.per ?? 1));
                        if (maxByCap < 1) return alert(`You can only carry ${cap} ${recipe.name}.`);
                        quantity = Math.min(quantity, maxByCap);
                    }
                    if (!beginCraft()) return;
                    try {
                        const result = await forgeServer(character.name, "supply", recipe.itemId, quantity);
                        if (!result.character) return alert(result.error || "The supply forge failed.");
                        if (!commitServerCharacter(result.character, result._saveVersion)) return;
                        gameToast(`Crafted ${quantity}x ${recipe.name}.`);
                    } finally {
                        endCraft();
                    }
                }

                const recipes: Array<{ name: string; cost: number; desc: string; itemId: string; per?: number }> = [
                    { name: "Pet Treats", cost: 50, desc: "1× Treats (+100 pet XP)", itemId: "pet-treat", per: 1 },
                    { name: "Elemental Treats", cost: 100, desc: "1× Elemental Treats (+250 pet XP)", itemId: "elemental-pet-treat", per: 1 },
                    { name: "Aura Dust", cost: 50, desc: "+50 Aura Dust", itemId: "currency:aura-dust" },
                    { name: "Bone Charm", cost: 1000, desc: "+1 Bone Charm", itemId: "currency:bone-charm" },
                    // Thrown weapons
                    { name: "Shuriken ×3", cost: 15, desc: "3× Shuriken (22 EP thrown)", itemId: "thrown-shuriken", per: 3 },
                    { name: "Senbon ×1", cost: 30, desc: "1× Senbon (300 dmg/round, 2 rounds)", itemId: "thrown-senbon", per: 1 },
                    { name: "Serpent Dust ×1", cost: 40, desc: "1× Serpent Dust (55% poison, 2 rounds)", itemId: "thrown-serpent-dust", per: 1 },
                    // Combat items
                    { name: "Smoke Bomb ×1", cost: 25, desc: "1× Smoke Bomb (100% dmg reduction to both players, 1 round; pierce still deals full dmg)", itemId: "item-smoke-bomb", per: 1 },
                    { name: "Attack Pill ×1", cost: 20, desc: "1× Attack Pill (+15% damage dealt, 2 rounds)", itemId: "item-attack-pill", per: 1 },
                    { name: "Defense Pill ×1", cost: 20, desc: "1× Defense Pill (-15% damage received, 2 rounds)", itemId: "item-defense-pill", per: 1 },
                    // Potions stay stackable in the server-side forge settlement.
                    { name: "Rejuvenation Potion ×1", cost: 250, desc: "1× Rejuvenation Potion (restore 1000 chakra + 1000 stamina in battle, 20 AP, up to 2/fight)", itemId: "potion-rejuvenation", per: 1 },
                    // PVE companion gear — epic/legendary-tier crafts. Each piece
                    // boosts the summoned pet in PvE and wears out after 20 summons.
                    ...petPveGear.map((gear) => ({
                        name: gear.name,
                        cost: gear.craftPts,
                        desc: `1× ${gear.name} (PVE slot) — ${gear.desc}. Breaks after ${PET_PVE_DURABILITY} summons.`,
                        itemId: gear.id,
                        per: 1,
                    })),
                    // Battle consumables — reactive single-use items (epic-tier craft).
                    ...petConsumables.map((cons) => ({
                        name: cons.name,
                        cost: cons.craftPts,
                        desc: `1× ${cons.name} (Consumable slot) — ${cons.desc}. Single use.`,
                        itemId: cons.id,
                        per: 1,
                    })),
                ];

                // Resolve a recipe item's artwork (published shared image first,
                // then the item's own image). Empty string = no art → caller draws
                // a themed fallback glyph instead.
                const itemImage = (id?: string): string =>
                    id ? (sharedImages["item:" + id] || allHubItems.find((i) => i.id === id)?.image || "") : "";

                // Themed fallback glyph for a supply recipe with no artwork, picked
                // from the recipe name so each card still reads at a glance.
                const supplyGlyph = (name: string): ReactElement => {
                    const n = name.toLowerCase();
                    if (n.includes("treat")) return <GiMeat />;
                    if (n.includes("dust")) return <GiSparkles />;
                    if (n.includes("charm") || n.includes("bone")) return <GameIcon name="bone" size={30} />;
                    if (n.includes("pill") || n.includes("potion") || n.includes("elixir")) return <GameIcon name="flask" size={30} />;
                    if (n.includes("smoke")) return <GiFlame />;
                    if (n.includes("shuriken") || n.includes("senbon") || n.includes("serpent")) return <GiCrossedSwords />;
                    return <GiSwapBag />;
                };

                // Shared, collapsed-by-default materials breakdown — identical in
                // all three tabs. The summary always shows the craft-point total so
                // players see their balance without expanding the full list. Each
                // material gets a fantasy glyph + tier colour so the list reads like
                // a forge ledger rather than a wall of text.
                const materialsPanel = (
                    <details className="cf-mats">
                        <summary className="cf-mats-head">
                            <span className="cf-mat-sum"><GiStoneStack /> <strong>Your Materials</strong> · <span className="cf-mat-total">{totalPts} craft pts</span></span>
                            <span className="cf-mat-toggle" />
                        </summary>
                        <div className="cf-mat-grid">
                            {Object.entries(CRAFT_MATERIAL_NAMES).map(([id, label]) => {
                                const count = countItem(character, id);
                                const pts = CRAFT_POINTS[id] ?? 0;
                                const Icon = MATERIAL_ICON[id] ?? GiStoneStack;
                                return (
                                    <div key={id} className="cf-mat" data-tier={craftTier(pts)} data-empty={count === 0 ? "1" : undefined}>
                                        <span className="cf-mat-icon"><Icon size={20} /></span>
                                        <span className="cf-mat-info">
                                            <span className="cf-mat-name">{label}</span>
                                            <span className="cf-mat-meta"><b>{count}×</b> · {pts} pts</span>
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </details>
                );

                return (
                    <Modal open={showCrafter} onClose={() => setShowCrafter(false)} bare ariaLabel="Crafter" size="lg" className="central-dialog-shell central-dialog-shell--crafter">
                        <div className="cf-panel">
                            <div className="archives-header">
                                <h2><GiBlacksmith style={HDR_ICON} />Crafter</h2>
                                <button className="danger-button" onClick={() => setShowCrafter(false)}>✕ Close</button>
                            </div>
                            <p className="cf-sub">Convert hunting, boss, dungeon, and war materials into supplies, weapons, or armor.</p>
                            <div className="cf-tabs">
                                <button disabled={namedForgeAnimation !== null} className={crafterTab === "supplies" ? "active" : ""} onClick={() => setCrafterTab("supplies")}><GiSwapBag />Supplies</button>
                                <button disabled={namedForgeAnimation !== null} className={crafterTab === "weapons" ? "active" : ""} onClick={() => setCrafterTab("weapons")}><GiCrossedSwords />Weapons</button>
                                <button disabled={namedForgeAnimation !== null} className={crafterTab === "armor" ? "active" : ""} onClick={() => setCrafterTab("armor")}><GiBreastplate />Armor</button>
                            </div>

                            <div className="cf-body">
                            {crafterTab === "supplies" && <>{materialsPanel}

                            {/* ── Special forges: Hollow Gate Key + Dungeon Legendary Relic ──
                                Rendered side-by-side in one compact 2-col grid (crafter-special-*)
                                to save vertical space. Each card keeps its own forge logic. */}
                            <div className="cf-grid cf-special-grid" style={{ marginBottom: 12 }}>
                            {(() => {
                                const dungeonKeyCount = countItem(character, DUNGEON_KEY_ID);
                                const fateShardCount = character.fateShards ?? 0;
                                const canCraftWithKeys = dungeonKeyCount >= HOLLOW_GATE_KEY_DUNGEON_KEY_COST;
                                const canCraftWithShards = fateShardCount >= HOLLOW_GATE_KEY_FATE_SHARD_COST;
                                async function craftHollowGateKeyWithDungeonKeys() {
                                    if (!requireServerSettlement("creatorItemCraft") || !beginCraft()) return;
                                    try {
                                        const result = await forgeHollowGateKeyServer(character.name, "dungeonKeys");
                                        if (!result.character) return alert(result.error || "The Hollow Gate Key forge failed.");
                                        if (!commitServerCharacter(result.character, result._saveVersion)) return;
                                        alert(`Hollow Gate Key forged. Consumed ${HOLLOW_GATE_KEY_DUNGEON_KEY_COST} Dungeon Keys.`);
                                    } finally {
                                        endCraft();
                                    }
                                }

                                async function craftHollowGateKeyWithFateShards() {
                                    if (!requireServerSettlement("creatorItemCraft") || !beginCraft()) return;
                                    try {
                                        const result = await forgeHollowGateKeyServer(character.name, "fateShards");
                                        if (!result.character) return alert(result.error || "The Hollow Gate Key forge failed.");
                                        if (!commitServerCharacter(result.character, result._saveVersion)) return;
                                        alert(`Hollow Gate Key forged. Consumed ${HOLLOW_GATE_KEY_FATE_SHARD_COST} Fate Shards.`);
                                    } finally {
                                        endCraft();
                                    }
                                }

                                const ownedKeys = countItem(character, HOLLOW_GATE_KEY_ID);
                                return (
                                    <div className="cf-card cf-special" style={{ borderColor: "var(--purple-500)", boxShadow: "0 0 10px rgba(168,85,247,0.22)" }}>
                                        <strong><GiTempleGate style={COST_ICON} />Hollow Gate Key</strong>
                                        <small>Shrine pass. Bypasses village unlock + 2/day cap.</small>
                                        <small>You own: <strong>{ownedKeys}</strong></small>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: "auto" }}>
                                            <button onClick={craftHollowGateKeyWithDungeonKeys} disabled={!canCraftWithKeys}>
                                                {canCraftWithKeys
                                                    ? `Forge — ${HOLLOW_GATE_KEY_DUNGEON_KEY_COST} Dungeon Keys`
                                                    : `Need ${HOLLOW_GATE_KEY_DUNGEON_KEY_COST} Keys (have ${dungeonKeyCount})`}
                                            </button>
                                            <button onClick={craftHollowGateKeyWithFateShards} disabled={!canCraftWithShards}>
                                                {canCraftWithShards
                                                    ? `Forge — ${HOLLOW_GATE_KEY_FATE_SHARD_COST} Fate Shards`
                                                    : `Need ${HOLLOW_GATE_KEY_FATE_SHARD_COST} Shards (have ${fateShardCount})`}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })()}
                            {(() => {
                                const FRAGMENTS_PER_RELIC = 5;
                                const fragmentCount = countItem(character, DUNGEON_LEGENDARY_FRAGMENT_ID);
                                const relicCount = countItem(character, DUNGEON_LEGENDARY_RELIC_ID);
                                const canForge = fragmentCount >= FRAGMENTS_PER_RELIC;
                                async function forgeRelicFromFragments() {
                                    if (!requireServerSettlement("creatorItemCraft") || !beginCraft()) return;
                                    try {
                                        const result = await forgeServer(character.name, "relic", DUNGEON_LEGENDARY_RELIC_ID, 1);
                                        if (!result.character) return alert(result.error || "The relic forge failed.");
                                        if (!commitServerCharacter(result.character, result._saveVersion)) return;
                                        alert(`Dungeon Legendary Relic forged. Consumed ${FRAGMENTS_PER_RELIC} Fragments.`);
                                    } finally {
                                        endCraft();
                                    }
                                }

                                return (
                                    <div className="cf-card cf-special" style={{ borderColor: "var(--gold)", boxShadow: "0 0 10px rgba(250,204,21,0.22)" }}>
                                        <strong><GameIcon name="shard" size={14} style={COST_ICON} />Dungeon Legendary Relic</strong>
                                        <small>Combine Hollow Hound Alpha fragments into a legendary relic.</small>
                                        <small>Fragments: <strong>{fragmentCount}</strong> · Relics: <strong>{relicCount}</strong></small>
                                        <button style={{ marginTop: "auto" }} onClick={forgeRelicFromFragments} disabled={!canForge}>
                                            {canForge
                                                ? `Forge — ${FRAGMENTS_PER_RELIC} Fragments`
                                                : `Need ${FRAGMENTS_PER_RELIC} Fragments (have ${fragmentCount})`}
                                        </button>
                                    </div>
                                );
                            })()}
                            {(() => {
                                const shardCount = countItem(character, ELEMENTAL_SHARD_ID);
                                const coreCount = countItem(character, ELEMENTAL_CORE_ID);
                                const canForge = shardCount >= ELEMENTAL_SHARDS_PER_CORE;
                                async function forgeCoreFromShards() {
                                    if (elementalCoreBusy) return;
                                    if (shardCount < ELEMENTAL_SHARDS_PER_CORE) {
                                        alert(`You need ${ELEMENTAL_SHARDS_PER_CORE} Elemental Shards. You have ${shardCount}.`);
                                        return;
                                    }
                                    setElementalCoreBusy(true);
                                    try {
                                        const response = await fetch('/api/weapon/forge-elemental-core', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ playerName: character.name }),
                                        });
                                        const data = await response.json().catch(() => ({})) as { character?: Character; error?: string; _saveVersion?: number };
                                        if (!response.ok || !data.character) {
                                            alert(data.error ?? 'Elemental Core could not be forged.');
                                            return;
                                        }
                                        if (!commitServerCharacter(data.character, data._saveVersion)) return;
                                        alert(`Elemental Core forged. Consumed ${ELEMENTAL_SHARDS_PER_CORE} Elemental Shards.`);
                                    } catch {
                                        alert('The forge response was lost. Refresh before trying again.');
                                    } finally {
                                        setElementalCoreBusy(false);
                                    }
                                }
                                return (
                                    <div className="cf-card cf-special" style={{ borderColor: "#22d3ee", boxShadow: "0 0 10px rgba(34,211,238,0.22)" }}>
                                        <strong><GameIcon name="shard" size={14} style={COST_ICON} />Elemental Core</strong>
                                        <small>Fuse Hollow Gate elemental shards into a core that attunes a legendary or mythic weapon to one of your awakened elements.</small>
                                        <small>Shards: <strong>{shardCount}</strong> · Cores: <strong>{coreCount}</strong></small>
                                        <button style={{ marginTop: "auto" }} onClick={() => void forgeCoreFromShards()} disabled={!canForge || elementalCoreBusy}>
                                            {elementalCoreBusy
                                                ? "Forging…"
                                                : canForge
                                                ? `Forge — ${ELEMENTAL_SHARDS_PER_CORE} Shards`
                                                : `Need ${ELEMENTAL_SHARDS_PER_CORE} Shards (have ${shardCount})`}
                                        </button>
                                    </div>
                                );
                            })()}
                            </div>

                            <div className="cf-batch" style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px", flexWrap: "wrap" }}>
                                <strong>Batch:</strong>
                                {[1, 5, 20].map((q) => (
                                    <button
                                        key={q}
                                        type="button"
                                        className={`cf-qty ${craftQty === q ? "active" : ""}`}
                                        onClick={() => setCraftQty(q)}
                                    >
                                        ×{q}
                                    </button>
                                ))}
                                <small style={{ color: "#9aa0aa" }}>Cost scales with quantity. Capped supplies stop at their carry limit.</small>
                            </div>

                            <div className="cf-grid">
                                {recipes.map((recipe) => {
                                    const batchCost = recipe.cost * craftQty;
                                    const fillPct = Math.min(100, Math.floor((totalPts / batchCost) * 100));
                                    // Capped consumables (thrown / combat item / potion) can't be
                                    // crafted past the shared carry cap — show the count and gate.
                                    const capItem = recipe.itemId ? allHubItems.find((i) => i.id === recipe.itemId) : undefined;
                                    const cap = capItem ? consumableHoldCap(capItem) : null;
                                    const owned = recipe.itemId ? countItem(character, recipe.itemId) : 0;
                                    const atCap = cap != null && owned + (recipe.per ?? 1) > cap;
                                    const canAffordOne = totalPts >= recipe.cost;
                                    const img = itemImage(recipe.itemId);
                                    return (
                                        <div key={recipe.name} className="cf-card">
                                            <div className="cf-card-top">
                                                <div className="cf-thumb">
                                                    {img
                                                        ? <img src={img} alt={recipe.name} loading="lazy" />
                                                        : <span className="cf-thumb-icon">{supplyGlyph(recipe.name)}</span>}
                                                </div>
                                                <div className="cf-card-head">
                                                    <strong>{recipe.name}</strong>
                                                    <small>{recipe.desc}</small>
                                                    {cap != null && (
                                                        <small style={{ color: "var(--green-300)" }}>In bag: {owned} / {cap}</small>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="cf-meter">
                                                <div className="cf-meter-fill" style={{ width: `${fillPct}%` }} />
                                            </div>
                                            <small className="cf-points">{Math.min(totalPts, batchCost)}/{batchCost} pts</small>
                                            <button onClick={() => craftRecipe(recipe, craftQty)} disabled={!canAffordOne || atCap}>
                                                {atCap ? "At carry limit" : `Craft ×${craftQty}`}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div></>}

                            {crafterTab === "weapons" && <>{materialsPanel}

                            {weaponInfoItem && (
                                <Modal open={true} onClose={() => setWeaponInfoItem(null)} bare ariaLabel={`${weaponInfoItem.name} details`} size="sm">
                                    <div className="modal-box weapon-info-modal">
                                        <button className="modal-close-btn" aria-label="Close" onClick={() => setWeaponInfoItem(null)}>✕</button>
                                        {(sharedImages['item:' + weaponInfoItem.id] || weaponInfoItem.image) && (
                                            <img
                                                src={sharedImages['item:' + weaponInfoItem.id] || weaponInfoItem.image}
                                                alt={weaponInfoItem.name}
                                                className="weapon-info-img"
                                            />
                                        )}
                                        <h3 className="weapon-info-name">{weaponInfoItem.name}</h3>
                                        <div className="weapon-info-badge" data-rarity={weaponInfoItem.rarity}>{weaponInfoItem.rarity.toUpperCase()}</div>
                                        <div className="weapon-info-stats">
                                            <div><span>Level Req</span><span>{weaponInfoItem.levelReq ?? 1}</span></div>
                                            <div><span>EP</span><span>{weaponInfoItem.weaponEp ?? 0}</span></div>
                                            <div><span>Effect</span><span>{weaponInfoItem.weaponEffect ?? "—"}</span></div>
                                            {weaponInfoItem.weaponEffectValue != null && (
                                                <div><span>Effect Value</span><span>{weaponInfoItem.weaponEffectValue}</span></div>
                                            )}
                                            {weaponInfoItem.weaponRange != null && (
                                                <div><span>Range</span><span>{weaponInfoItem.weaponRange}</span></div>
                                            )}
                                        </div>
                                        {weaponInfoItem.description && (
                                            <p className="weapon-info-desc">{weaponInfoItem.description}</p>
                                        )}
                                    </div>
                                </Modal>
                            )}
                            <div className="cf-grid">
                                {craftableWeapons.map((item) => {
                                    const costPts = weaponCraftPoints(item);
                                    const ryo = craftRyoForRarity(item.rarity);
                                    const ready = character.level >= (item.levelReq ?? 1) && character.ryo >= ryo && totalPts >= costPts;
                                    const fillPct = Math.min(100, Math.floor((totalPts / costPts) * 100));
                                    const img = itemImage(item.id);
                                    return (
                                        <div key={item.id} className="cf-card" data-rarity={item.rarity}>
                                            <div className="cf-card-top">
                                                <div className="cf-thumb" data-rarity={item.rarity}>
                                                    {img
                                                        ? <img src={img} alt={item.name} loading="lazy" />
                                                        : <span className="cf-thumb-icon"><GiCrossedSwords /></span>}
                                                </div>
                                                <div className="cf-card-head">
                                                    <div className="cf-card-title">
                                                        <strong>{item.name}</strong>
                                                        <button className="weapon-info-btn" onClick={() => setWeaponInfoItem(item)} title="View weapon info">ℹ️</button>
                                                    </div>
                                                    <small>{item.rarity.toUpperCase()} | Lv {item.levelReq ?? 1} | {item.weaponEp ?? 0} EP | {item.weaponEffect ?? "Weapon"}</small>
                                                    <small className="cf-cost">{costPts} craft pts + {ryo.toLocaleString()} ryo</small>
                                                </div>
                                            </div>
                                            <div className="cf-meter">
                                                <div className="cf-meter-fill" style={{ width: `${fillPct}%` }} />
                                            </div>
                                            <small className="cf-points">{Math.min(totalPts, costPts)}/{costPts} pts</small>
                                            <button onClick={() => craftExistingWeapon(item)} disabled={!ready}>
                                                Forge
                                            </button>
                                        </div>
                                    );
                                })}
                            </div></>}

                            {crafterTab === "armor" && <>{materialsPanel}
                            <div className="cf-grid">
                                {craftableArmor.length === 0 ? (
                                    <p className="hint">No armor recipes available yet — add craftable armor items via the admin item creator.</p>
                                ) : (
                                    craftableArmor.map((item) => {
                                        const costPts = armorCraftPoints(item);
                                        const ryo = craftRyoForRarity(item.rarity);
                                        const ready = character.level >= (item.levelReq ?? 1) && character.ryo >= ryo && totalPts >= costPts;
                                        const fillPct = Math.min(100, Math.floor((totalPts / costPts) * 100));
                                        const img = itemImage(item.id);
                                        return (
                                            <div key={item.id} className="cf-card" data-rarity={item.rarity}>
                                                <div className="cf-card-top">
                                                    <div className="cf-thumb" data-rarity={item.rarity}>
                                                        {img
                                                            ? <img src={img} alt={item.name} loading="lazy" />
                                                            : <span className="cf-thumb-icon"><GiBreastplate /></span>}
                                                    </div>
                                                    <div className="cf-card-head">
                                                        <strong>{item.name}</strong>
                                                        <small>{item.rarity.toUpperCase()} | Lv {item.levelReq ?? 1} | {equipmentSlotLabel(item.slot)} | {item.armorQuality ?? "—"}</small>
                                                        <small className="cf-cost">{costPts} craft pts + {ryo.toLocaleString()} ryo</small>
                                                    </div>
                                                </div>
                                                <div className="cf-meter">
                                                    <div className="cf-meter-fill" style={{ width: `${fillPct}%` }} />
                                                </div>
                                                <small className="cf-points">{Math.min(totalPts, costPts)}/{costPts} pts</small>
                                                <button onClick={() => craftExistingArmor(item)} disabled={!ready}>
                                                    Forge
                                                </button>
                                            </div>
                                        );
                                    })
                                )}
                            </div></>}

                            {/* -- Named Armor Forge -- */}
                            {crafterTab === "armor" && (() => {
                                const naPts = namedForgePts;
                                const naFill = Math.min(100, Math.floor((naPts / NW_COST) * 100));
                                return (
                                    <div className="nw-forge">
                                        <div className="nw-head">
                                            <span className="nw-title"><GiBreastplate style={HDR_ICON} />Named Armor</span>
                                            <small>Forge a one-of-a-kind armor piece — the finest armor in the world, above mythic. Costs {NW_COST} forge pts.</small>
                                        </div>

                                        {/* Currency display — same pool as named weapons */}
                                        <div className="nw-wallet">
                                            <div className="nw-currency">
                                                <span><GameIcon name="bone" size={14} style={COST_ICON} />Bone Charms</span>
                                                <span>{character.boneCharms ?? 0} × {NW_CURRENCY_PTS.boneCharms} pts = <strong>{(character.boneCharms ?? 0) * NW_CURRENCY_PTS.boneCharms}</strong></span>
                                            </div>
                                            <div className="nw-currency">
                                                <span><GameIcon name="shard" size={14} style={COST_ICON} />Fate Shards</span>
                                                <span>{character.fateShards ?? 0} × {NW_CURRENCY_PTS.fateShards} pts = <strong>{(character.fateShards ?? 0) * NW_CURRENCY_PTS.fateShards}</strong></span>
                                            </div>
                                            <div className="nw-currency">
                                                <span><GameIcon name="crystal" size={14} style={COST_ICON} />Aura Stones</span>
                                                <span>{character.auraStones ?? 0} × {NW_CURRENCY_PTS.auraStones} pts = <strong>{(character.auraStones ?? 0) * NW_CURRENCY_PTS.auraStones}</strong></span>
                                            </div>
                                            <div className="nw-currency">
                                                <span><GameIcon name="sigil" size={14} style={COST_ICON} />Mythic Seals</span>
                                                <span>{character.mythicSeals ?? 0} × {NW_CURRENCY_PTS.mythicSeals} pts = <strong>{(character.mythicSeals ?? 0) * NW_CURRENCY_PTS.mythicSeals}</strong></span>
                                            </div>
                                            <div className="nw-total">
                                                Total forge pts: <strong>{naPts}</strong> / {NW_COST}
                                            </div>
                                            {naPts >= NW_COST && !namedForgePaymentReady && (
                                                <div className="nw-total" style={{ color: "#f59e0b" }}>
                                                    Exact payment unavailable — add Bone Charms or Fate Shards.
                                                </div>
                                            )}
                                            {namedForgeLocked && (
                                                <div className="nw-total" style={{ color: "#ef4444", fontWeight: "bold" }}>
                                                    🔒 Unlocks at Level {NAMED_ITEM_LEVEL_REQ} — you are Level {character.level}
                                                </div>
                                            )}
                                        </div>

                                        <div className="cf-meter" style={{ margin: "4px 0 8px" }}>
                                            <div className="cf-meter-fill" style={{ width: `${naFill}%` }} />
                                        </div>

                                        {/* Slot selector */}
                                        <label className="nw-label">Armor Slot</label>
                                        <select
                                            className="nw-input"
                                            value={namedArmorSlot}
                                            onChange={(e) => setNamedArmorSlot(e.target.value as EquipmentSlot)}
                                        >
                                            {NAMED_ARMOR_SLOTS.map((s) => (
                                                <option key={s.value} value={s.value}>{s.label}</option>
                                            ))}
                                        </select>

                                        <div className="nw-odds">
                                            <div className="nw-odds-title"><GameIcon name="dice" size={14} style={COST_ICON} />Roll Odds</div>
                                            <div className="nw-odds-grid">
                                                {namedArmorSlot === "hand" ? (
                                                    <div className="no-section">
                                                        <div className="no-label">Gauntlet Guard Rule</div>
                                                        <div className="no-rows"><div className="no-row"><span>No damage reduction</span><span className="no-pct">Stats + special</span></div></div>
                                                    </div>
                                                ) : (
                                                    <div className="no-section">
                                                        <div className="no-label">Damage Reduction</div>
                                                        <div className="no-rows">
                                                            <div className="no-row"><span>6% (Elite)</span><span className="no-pct">33.3%</span></div>
                                                            <div className="no-row"><span>7% (Legendary)</span><span className="no-pct">33.3%</span></div>
                                                            <div className="no-row"><span>8% (Mythic)</span><span className="no-pct">33.3%</span></div>
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="no-section">
                                                    <div className="no-label">All Offense</div>
                                                    <div className="no-rows">
                                                        <div className="no-row"><span>+25 to +35</span><span className="no-pct">~9.1% each</span></div>
                                                    </div>
                                                </div>
                                                <div className="no-section">
                                                    <div className="no-label">All Defense</div>
                                                    <div className="no-rows">
                                                        <div className="no-row"><span>+25 to +35</span><span className="no-pct">~9.1% each</span></div>
                                                    </div>
                                                </div>
                                                <div className="no-section no-wide">
                                                    <div className="no-label">Special Effect (each {(100 / NAMED_ARMOR_SPECIALS.length).toFixed(1)}% to roll)</div>
                                                    <div className="no-rows">
                                                        <div className="no-row"><span>🛡 Absorb</span><span className="no-pct">0.08–2%</span></div>
                                                        <div className="no-row"><span>🔰 Shield</span><span className="no-pct">+75 to +150 HP</span></div>
                                                        <div className="no-row"><span>↩️ Reflect</span><span className="no-pct">0.08–2%</span></div>
                                                        <div className="no-row"><span>🩸 Life Steal</span><span className="no-pct">0.08–2%</span></div>
                                                        <div className="no-row"><span>💥 Increase Damage</span><span className="no-pct">0.75–1.50%</span></div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            className="nw-roll"
                                            onClick={rollNamedArmor}
                                            disabled={!namedForgePaymentReady || namedForgeLocked || namedForgeBusy || namedForgeAnimation !== null}
                                        >
                                            <GameIcon name="dice" size={16} style={HDR_ICON} />
                                            {namedForgeAnimation?.kind === "armor"
                                                ? namedForgeAnimation.phase === "rolling" ? "Rolling Armor…" : "Sealing Armor…"
                                                : "Roll Named Armor"}
                                        </button>

                                        {namedForgeAnimation?.kind === "armor" && (
                                            <NamedForgeRollCinematic
                                                kind="armor"
                                                phase={namedForgeAnimation.phase}
                                                stats={namedArmorRoll ? [
                                                    { label: "Slot", value: NAMED_ARMOR_SLOTS.find((slot) => slot.value === namedArmorRoll.slot)?.label ?? namedArmorRoll.slot },
                                                    ...(namedArmorRoll.slot === "hand" ? [] : [{ label: "Damage reduction", value: `${Math.round(armorReductionForQuality(namedArmorRoll.armorQuality) * 100)}% · ${namedArmorRoll.armorQuality}` }]),
                                                    { label: "All offense", value: `+${namedArmorRoll.offenseVal}` },
                                                    { label: "All defense", value: `+${namedArmorRoll.defenseVal}` },
                                                    { label: "Special", value: `${namedArmorRoll.special.kind} ${namedArmorRoll.special.kind === "Shield" ? `+${namedArmorRoll.special.value} HP` : `${namedArmorRoll.special.value}%`}` },
                                                ] : []}
                                            />
                                        )}

                                        {namedArmorRoll && !namedForgeAnimation && (
                                            <div className="nw-result nf-enter">
                                                <div className="nw-stats">
                                                    <div className="nw-stat"><span>Slot</span><strong>{NAMED_ARMOR_SLOTS.find(s => s.value === namedArmorRoll.slot)?.label}</strong></div>
                                                    {namedArmorRoll.slot !== "hand" && <div className="nw-stat"><span>Damage Reduction</span><strong>{Math.round(armorReductionForQuality(namedArmorRoll.armorQuality) * 100)}% ({namedArmorRoll.armorQuality})</strong></div>}
                                                    <div className="nw-stat"><span>All Offense</span><strong>+{namedArmorRoll.offenseVal}</strong></div>
                                                    <div className="nw-stat"><span>All Defense</span><strong>+{namedArmorRoll.defenseVal}</strong></div>
                                                    <div className="nw-stat nw-tag">
                                                        <span>Special</span>
                                                        <strong>
                                                            {namedArmorRoll.special.kind}
                                                            {namedArmorRoll.special.kind === "Shield"
                                                                ? ` +${namedArmorRoll.special.value} HP`
                                                                : ` ${namedArmorRoll.special.value}%`}
                                                        </strong>
                                                    </div>
                                                </div>

                                                <label className="nw-label">Armor Name</label>
                                                <input
                                                    className="nw-input"
                                                    value={namedArmorName}
                                                    onChange={(e) => setNamedArmorName(e.target.value)}
                                                    placeholder="e.g. Stormveil Plate"
                                                />

                                                <label className="nw-label">Flavor Text</label>
                                                <textarea
                                                    className="nw-input"
                                                    rows={3}
                                                    value={namedArmorFlavorText}
                                                    onChange={(e) => setNamedArmorFlavorText(e.target.value)}
                                                    placeholder="Forged from the scales of the Ash Lizard king…"
                                                />

                                                <label className="nw-label">Armor Image</label>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) readImageFile(file, setNamedArmorImage, 25);
                                                    }}
                                                />
                                                {namedArmorImage && (
                                                    <div>
                                                        <img src={namedArmorImage} alt="armor preview" />
                                                        <button className="danger-button" onClick={() => setNamedArmorImage("")}>Remove</button>
                                                    </div>
                                                )}

                                                <div>
                                                    <button className="nw-commit" onClick={forgeNamedArmor}>
                                                        <GiBlacksmith style={HDR_ICON} />Forge Armor
                                                    </button>
                                                    <button className="danger-button" onClick={() => { setNamedArmorRoll(null); setNamedArmorToken(""); }}>
                                                        <GiTrashCan style={HDR_ICON} />Discard Roll
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* -- Named Weapon Forge -- */}
                            {crafterTab === "weapons" && (() => {
                                const nwPts = namedForgePts;
                                const nwFill = Math.min(100, Math.floor((nwPts / NW_COST) * 100));
                                return (
                                    <div className="nw-forge">
                                        <div className="nw-head">
                                            <span className="nw-title"><GiCrossedSwords style={HDR_ICON} />Named Weapon</span>
                                            <small>Forge a one-of-a-kind hand weapon — the finest weapon in the world, above mythic. Costs {NW_COST} forge pts.</small>
                                        </div>

                                        {/* Currency display */}
                                        <div className="nw-wallet">
                                            <div className="nw-currency">
                                                <span><GameIcon name="bone" size={14} style={COST_ICON} />Bone Charms</span>
                                                <span>{character.boneCharms ?? 0} × {NW_CURRENCY_PTS.boneCharms} pts = <strong>{(character.boneCharms ?? 0) * NW_CURRENCY_PTS.boneCharms}</strong></span>
                                            </div>
                                            <div className="nw-currency">
                                                <span><GameIcon name="shard" size={14} style={COST_ICON} />Fate Shards</span>
                                                <span>{character.fateShards ?? 0} × {NW_CURRENCY_PTS.fateShards} pts = <strong>{(character.fateShards ?? 0) * NW_CURRENCY_PTS.fateShards}</strong></span>
                                            </div>
                                            <div className="nw-currency">
                                                <span><GameIcon name="crystal" size={14} style={COST_ICON} />Aura Stones</span>
                                                <span>{character.auraStones ?? 0} × {NW_CURRENCY_PTS.auraStones} pts = <strong>{(character.auraStones ?? 0) * NW_CURRENCY_PTS.auraStones}</strong></span>
                                            </div>
                                            <div className="nw-currency">
                                                <span><GameIcon name="sigil" size={14} style={COST_ICON} />Mythic Seals</span>
                                                <span>{character.mythicSeals ?? 0} × {NW_CURRENCY_PTS.mythicSeals} pts = <strong>{(character.mythicSeals ?? 0) * NW_CURRENCY_PTS.mythicSeals}</strong></span>
                                            </div>
                                            <div className="nw-total">
                                                Total forge pts: <strong>{nwPts}</strong> / {NW_COST}
                                            </div>
                                            {nwPts >= NW_COST && !namedForgePaymentReady && (
                                                <div className="nw-total" style={{ color: "#f59e0b" }}>
                                                    Exact payment unavailable — add Bone Charms or Fate Shards.
                                                </div>
                                            )}
                                            {namedForgeLocked && (
                                                <div className="nw-total" style={{ color: "#ef4444", fontWeight: "bold" }}>
                                                    🔒 Unlocks at Level {NAMED_ITEM_LEVEL_REQ} — you are Level {character.level}
                                                </div>
                                            )}
                                        </div>

                                        <div className="cf-meter" style={{ margin: "4px 0 8px" }}>
                                            <div className="cf-meter-fill" style={{ width: `${nwFill}%` }} />
                                        </div>

                                        <div className="nw-odds">
                                            <div className="nw-odds-title"><GameIcon name="dice" size={14} style={COST_ICON} />Roll Odds</div>
                                            <div className="nw-odds-grid">
                                                <div className="no-section">
                                                    <div className="no-label">Damage EP</div>
                                                    <div className="no-rows">
                                                        {[30,31,32,33,34,35].map(v => (
                                                            <div key={v} className="no-row">
                                                                <span>{v}</span><span className="no-pct">16.7%</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="no-section">
                                                    <div className="no-label">Range</div>
                                                    <div className="no-rows">
                                                        {[3,4,5].map(v => (
                                                            <div key={v} className="no-row">
                                                                <span>{v}</span><span className="no-pct">33.3%</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="no-section">
                                                    <div className="no-label">All Offenses</div>
                                                    <div className="no-rows">
                                                        <div className="no-row"><span>168–180</span><span className="no-pct">~7.7% each</span></div>
                                                    </div>
                                                </div>
                                                <div className="no-section">
                                                    <div className="no-label">Tag Count</div>
                                                    <div className="no-rows">
                                                        <div className="no-row"><span>1 tag (35–40%)</span><span className="no-pct">50%</span></div>
                                                        <div className="no-row"><span>2 tags (15–20% ea.)</span><span className="no-pct">50%</span></div>
                                                    </div>
                                                </div>
                                                <div className="no-section no-wide">
                                                    <div className="no-label">Possible Tags (each ~{(100 / NAMED_WEAPON_TAGS.length).toFixed(1)}% to appear)</div>
                                                    <div className="no-tags">
                                                        {NAMED_WEAPON_TAGS.map(t => (
                                                            <span key={t} className="no-chip">{t}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="no-section no-wide">
                                                    <div className="no-label">Tag Formula Notes</div>
                                                    <div className="no-rows">
                                                        <div className="no-row"><span>🔰 Shield</span><span className="no-pct">Adds HP shield = rolled% × weapon hit damage</span></div>
                                                        <div className="no-row"><span>💚 Heal</span><span className="no-pct">Flat heal — 400 HP (single-tag roll) or 200 HP (dual-tag roll)</span></div>
                                                        <div className="no-row"><span>🩸 Siphon</span><span className="no-pct">Restores HP = rolled% × weapon hit damage</span></div>
                                                        <div className="no-row"><span>🔥 Afterburn</span><span className="no-pct">2-round status: next 2 attacks deal +rolled% damage</span></div>
                                                        <div className="no-row"><span>☠️ Poison / Drain</span><span className="no-pct">{COMBAT_RESOURCES_V2 ? "Drain saps HP+chakra each round; Poison bites when the target spends chakra/stamina to cast" : "Deals rolled% of enemy chakra as damage per round"}</span></div>
                                                        <div className="no-row"><span>💥 Damage / IDG / DDT / Reflect / Absorb</span><span className="no-pct">Flat % modifier for 2 rounds</span></div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            className="nw-roll"
                                            onClick={rollNamedWeapon}
                                            disabled={!namedForgePaymentReady || namedForgeLocked || namedForgeBusy || namedForgeAnimation !== null}
                                        >
                                            <GameIcon name="dice" size={16} style={HDR_ICON} />
                                            {namedForgeAnimation?.kind === "weapon"
                                                ? namedForgeAnimation.phase === "rolling" ? "Rolling Weapon…" : "Sealing Weapon…"
                                                : "Roll Named Weapon"}
                                        </button>

                                        {namedForgeAnimation?.kind === "weapon" && (
                                            <NamedForgeRollCinematic
                                                kind="weapon"
                                                phase={namedForgeAnimation.phase}
                                                stats={namedWeaponRoll ? [
                                                    { label: "Damage EP", value: String(namedWeaponRoll.ep) },
                                                    { label: "AP cost", value: "40" },
                                                    { label: "Range", value: String(namedWeaponRoll.range) },
                                                    { label: "All offenses", value: `+${namedWeaponRoll.offenseVal}` },
                                                    ...namedWeaponRoll.tags.map((tag, index) => ({ label: `Tag ${index + 1}`, value: `${tag.name} · ${tag.percent}%` })),
                                                ] : []}
                                            />
                                        )}

                                        {namedWeaponRoll && !namedForgeAnimation && (
                                            <div className="nw-result nf-enter">
                                                <div className="nw-stats">
                                                    <div className="nw-stat"><span>Damage EP</span><strong>{namedWeaponRoll.ep}</strong></div>
                                                    <div className="nw-stat"><span>AP Cost</span><strong>40</strong></div>
                                                    <div className="nw-stat"><span>Range</span><strong>{namedWeaponRoll.range}</strong></div>
                                                    <div className="nw-stat"><span>All Offenses</span><strong>+{namedWeaponRoll.offenseVal}</strong></div>
                                                    {namedWeaponRoll.tags.map((t, i) => {
                                                        const healFlat = t.name === "Heal" ? (t.percent >= 35 ? 400 : 200) : null;
                                                        const dmgScaled = t.name === "Shield" || t.name === "Siphon" || t.name === "Lifesteal" || t.name === "Wound" || tagMatchesName(t.name, "Ignition");
                                                        return (
                                                            <div key={i} className="nw-stat nw-tag">
                                                                <span>Tag {i + 1}</span>
                                                                <strong>
                                                                    {t.name} {t.percent}%
                                                                    {healFlat !== null && <span className="nw-formula"> (flat {healFlat} HP)</span>}
                                                                    {dmgScaled && <span className="nw-formula"> (= {t.percent}% of hit dmg)</span>}
                                                                </strong>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                <label className="nw-label">Weapon Name</label>
                                                <input
                                                    className="nw-input"
                                                    value={namedWeaponName}
                                                    onChange={(e) => setNamedWeaponName(e.target.value)}
                                                    placeholder="e.g. Void Fang"
                                                />

                                                <label className="nw-label">Flavor Text</label>
                                                <textarea
                                                    className="nw-input"
                                                    rows={3}
                                                    value={namedWeaponFlavorText}
                                                    onChange={(e) => setNamedWeaponFlavorText(e.target.value)}
                                                    placeholder="A blade forged from the bones of ancient beasts…"
                                                />

                                                <label className="nw-label">Weapon Image</label>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) readImageFile(file, setNamedWeaponImage, 25);
                                                    }}
                                                />
                                                {namedWeaponImage && (
                                                    <div>
                                                        <img src={namedWeaponImage} alt="weapon preview" />
                                                        <button className="danger-button" onClick={() => setNamedWeaponImage("")}>Remove</button>
                                                    </div>
                                                )}

                                                <div>
                                                    <button className="nw-commit" onClick={forgeNamedWeapon}>
                                                        <GiBlacksmith style={HDR_ICON} />Forge Weapon
                                                    </button>
                                                    <button className="danger-button" onClick={() => { setNamedWeaponRoll(null); setNamedWeaponToken(""); }}>
                                                        <GiTrashCan style={HDR_ICON} />Discard Roll
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                            </div>
                        </div>
                    </Modal>
                );
            })()}
        </div>
    );
}

/** Deterministic tile index (0-143) for a player name so their map dot is stable across renders */
