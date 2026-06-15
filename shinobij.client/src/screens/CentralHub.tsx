/* eslint-disable react-hooks/purity */
import { useState, useEffect } from "react";
import type { Character } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { ArmorQuality, EquipmentSlot, GameItem, ReviewBloodline, SavedBloodline } from "../types/combat";
import type { Rank, Screen } from "../types/core";
import { AWAKENING_FREE_LV20_ID, AWAKENING_FREE_LV2_ID, DUNGEON_KEY_ID, DUNGEON_LEGENDARY_FRAGMENT_ID, DUNGEON_LEGENDARY_RELIC_ID, HOLLOW_GATE_KEY_ID, VEIL_OF_THE_HOLLOW_ID, WARFORGED_RELIC_ID, WEEKLY_BOSS_CORE_ID } from "../constants/game";
import { PET_PVE_DURABILITY, petConsumables, petPveGear } from "../data/pet-config";
import { armorReductionForQuality, equipmentSlotLabel, normalizeEquipmentSlot } from "../lib/equipment";
import { craftDungeonEvents } from "../data/vn-events";
import { elementIcon, getCharacterElements, rollAwakeningElements, rollNewAwakeningElement, uniqueElements } from "../lib/elements";
import { getAllItems } from "../lib/items";
import { addItem, removeItem, countItem } from "../lib/inventory";
import { makeId } from "../lib/utils";
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
    creatorItems,
    setCreatorItems,
    playableAis,
    sharedImages = {},
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
    onOpenBloodlineMaker: (rank: Rank) => void;
    creatorItems: GameItem[];
    setCreatorItems: (items: GameItem[]) => void;
    playableAis: CreatorAi[];
    sharedImages?: Record<string, string>;
}) {
    const [centralLog, setCentralLog] = useState(
        "Welcome to Central — the neutral heart of the shinobi world."
    );
    const [showArchives, setShowArchives] = useState(false);
    const [showAwakening, setShowAwakening] = useState(false);
    const [awakeningMsg, setAwakeningMsg] = useState("");
    const [showCelestialPanel, setShowCelestialPanel] = useState(false);
    const [showDungeonPanel, setShowDungeonPanel] = useState(false);
    const [showCrafter, setShowCrafter] = useState(false);
    const [crafterTab, setCrafterTab] = useState<"supplies" | "weapons" | "armor">("supplies");
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
        const id = setInterval(fetchWar, 15_000);
        return () => { alive = false; clearInterval(id); };
    }, [character.village]);

    // Named Weapon forge state
    type NamedWeaponRoll = { ep: number; range: 3 | 4 | 5; offenseVal: number; tags: Array<{ name: string; percent: number }> };
    const [namedWeaponRoll, setNamedWeaponRoll] = useState<NamedWeaponRoll | null>(null);
    const [namedWeaponName, setNamedWeaponName] = useState("Unnamed Blade");
    const [namedWeaponImage, setNamedWeaponImage] = useState("");
    const [namedWeaponFlavorText, setNamedWeaponFlavorText] = useState("");

    const NAMED_WEAPON_TAGS = [
        "Siphon", "Absorb", "Poison", "Wound",
        "Reflect", "Shield", "Drain", "Ignition", "Heal",
        "Increase Damage Given", "Decrease Damage Taken",
    ];

    function rollNamedWeapon() {
        const ranges: (3 | 4 | 5)[] = [3, 4, 5];
        const range = ranges[Math.floor(Math.random() * 3)];
        const ep = 30 + Math.floor(Math.random() * 6); // 30–35
        const offenseVal = 168 + Math.floor(Math.random() * 13); // 168–180
        const useSingle = Math.random() < 0.5;
        const shuffled = [...NAMED_WEAPON_TAGS].sort(() => Math.random() - 0.5);
        let tags: Array<{ name: string; percent: number }>;
        if (useSingle) {
            tags = [{ name: shuffled[0], percent: 35 + Math.floor(Math.random() * 6) }]; // 35–40%
        } else {
            tags = [
                { name: shuffled[0], percent: 15 + Math.floor(Math.random() * 6) }, // 15–20%
                { name: shuffled[1], percent: 15 + Math.floor(Math.random() * 6) },
            ];
        }
        setNamedWeaponRoll({ ep, range, offenseVal, tags });
    }

    // Named Weapon uses premium currencies, not hunt-material craft points
    const NW_CURRENCY_PTS: Record<string, number> = {
        boneCharms: 5,
        fateShards: 5,
        auraStones: 25,
        mythicSeals: 75,
    };
    const NW_COST = 1000; // total points needed

    function namedWeaponCurrencyPts(): number {
        return (
            (character.boneCharms ?? 0) * NW_CURRENCY_PTS.boneCharms +
            (character.fateShards ?? 0) * NW_CURRENCY_PTS.fateShards +
            (character.auraStones ?? 0) * NW_CURRENCY_PTS.auraStones +
            (character.mythicSeals ?? 0) * NW_CURRENCY_PTS.mythicSeals
        );
    }

    function forgeNamedWeapon() {
        if (!namedWeaponRoll) return;
        const available = namedWeaponCurrencyPts();
        if (available < NW_COST) {
            alert(`Not enough materials. Need ${NW_COST} forge pts, you have ${available}.`);
            return;
        }
        // Greedy consume: spend lowest-value currencies first
        let remaining = NW_COST;
        let bc = character.boneCharms ?? 0;
        let fs = character.fateShards ?? 0;
        let as_ = character.auraStones ?? 0;
        let ms = character.mythicSeals ?? 0;
        // Order: boneCharms (5), fateShards (5), auraStones (25), mythicSeals (75)
        const spend = (count: number, pts: number, cur: number): [number, number] => {
            const use = Math.min(cur, Math.ceil(remaining / pts));
            const actual = Math.min(use, cur);
            return [cur - actual, remaining - actual * pts];
        };
        [bc, remaining] = spend(bc, NW_CURRENCY_PTS.boneCharms, bc);
        [fs, remaining] = spend(fs, NW_CURRENCY_PTS.fateShards, fs);
        [as_, remaining] = spend(as_, NW_CURRENCY_PTS.auraStones, as_);
        [ms, remaining] = spend(ms, NW_CURRENCY_PTS.mythicSeals, ms);

        const id = `named-weapon-${makeId()}`;
        const tagDesc = namedWeaponRoll.tags.map((t) => `${t.name} ${t.percent}%`).join(", ");
        const item: GameItem = {
            id,
            name: namedWeaponName.trim() || "Named Weapon",
            slot: "hand",
            rarity: "legendary",
            cost: 0,
            description: namedWeaponFlavorText.trim() || `A master-forged weapon. Tags: ${tagDesc}.`,
            image: namedWeaponImage || undefined,
            weaponEp: namedWeaponRoll.ep,
            apCost: 40,
            weaponRange: namedWeaponRoll.range,
            weaponTags: namedWeaponRoll.tags,
            flavorText: namedWeaponFlavorText.trim() || undefined,
            bonuses: {
                ninjutsuOffense: namedWeaponRoll.offenseVal,
                taijutsuOffense: namedWeaponRoll.offenseVal,
                bukijutsuOffense: namedWeaponRoll.offenseVal,
                genjutsuOffense: namedWeaponRoll.offenseVal,
            },
        };
        setCreatorItems([...creatorItems, item]);
        updateCharacter({
            ...character,
            inventory: [...character.inventory, id],
            boneCharms: bc,
            fateShards: fs,
            auraStones: as_,
            mythicSeals: ms,
        });
        // Persist the forged item's image to the shared store. Saves strip inline
        // base64 images, so without this publish the picture would vanish on the
        // next reload — it re-hydrates from shared:img:item:<id>.
        if (item.image) {
            void publishSharedImage('item:' + id, item.image).then((ok) => {
                if (!ok) alert(`Heads up — ${item.name} was forged, but its image couldn't be saved to the server, so it may not stick after a reload.`);
            });
        }
        setNamedWeaponRoll(null);
        setNamedWeaponName("Unnamed Blade");
        setNamedWeaponImage("");
        setNamedWeaponFlavorText("");
        alert(`${item.name} has been forged and added to your inventory!`);
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

    const NAMED_ARMOR_SPECIALS: Array<{ kind: string; bonusKey: string; valueRoll: () => number }> = [
        { kind: "Absorb",          bonusKey: "absorbPercent",    valueRoll: () => +(0.08 + Math.random() * 1.92).toFixed(2) },   // 0.08 – 2.00 %
        { kind: "Shield",          bonusKey: "shield",           valueRoll: () => 75 + Math.floor(Math.random() * 76) },         // 75 – 150 HP
        { kind: "Reflect",         bonusKey: "reflectPercent",   valueRoll: () => +(0.08 + Math.random() * 1.92).toFixed(2) },   // 0.08 – 2.00 %
        { kind: "Life Steal",      bonusKey: "lifeStealPercent", valueRoll: () => +(0.08 + Math.random() * 1.92).toFixed(2) },   // 0.08 – 2.00 %
        { kind: "Increase Damage", bonusKey: "damagePercent",    valueRoll: () => +(0.75 + Math.random() * 0.75).toFixed(2) },   // 0.75 – 1.50 %
    ];

    function rollNamedArmor() {
        const qualities: ArmorQuality[] = ["Elite", "Legendary", "Mythic"];
        const armorQuality = qualities[Math.floor(Math.random() * qualities.length)];
        const offenseVal = 25 + Math.floor(Math.random() * 11); // 25 – 35
        const defenseVal = 25 + Math.floor(Math.random() * 11);
        const tpl = NAMED_ARMOR_SPECIALS[Math.floor(Math.random() * NAMED_ARMOR_SPECIALS.length)];
        const special = { kind: tpl.kind, bonusKey: tpl.bonusKey, value: tpl.valueRoll() };
        setNamedArmorRoll({ slot: namedArmorSlot, armorQuality, offenseVal, defenseVal, special });
    }

    function forgeNamedArmor() {
        if (!namedArmorRoll) return;
        const available = namedWeaponCurrencyPts(); // shared cost pool with Named Weapon
        if (available < NW_COST) {
            alert(`Not enough materials. Need ${NW_COST} forge pts, you have ${available}.`);
            return;
        }
        // Greedy consume identical to forgeNamedWeapon — spend cheapest first.
        let remaining = NW_COST;
        let bc = character.boneCharms ?? 0;
        let fs = character.fateShards ?? 0;
        let as_ = character.auraStones ?? 0;
        let ms = character.mythicSeals ?? 0;
        const spend = (cur: number, pts: number): [number, number] => {
            const use = Math.min(cur, Math.ceil(remaining / pts));
            const actual = Math.min(use, cur);
            return [cur - actual, remaining - actual * pts];
        };
        [bc, remaining]  = spend(bc,  NW_CURRENCY_PTS.boneCharms);
        [fs, remaining]  = spend(fs,  NW_CURRENCY_PTS.fateShards);
        [as_, remaining] = spend(as_, NW_CURRENCY_PTS.auraStones);
        [ms, remaining]  = spend(ms,  NW_CURRENCY_PTS.mythicSeals);

        const slotLabel = NAMED_ARMOR_SLOTS.find((s) => s.value === namedArmorRoll.slot)?.label ?? "Armor";
        // Hand-slot pieces must contain "glove" or "gauntlet" in their name for
        // isArmorOrGloveItem to treat them as armor — auto-append if missing.
        let finalName = namedArmorName.trim() || `Named ${slotLabel}`;
        if (namedArmorRoll.slot === "hand" && !/glove|gauntlet/i.test(finalName)) {
            finalName = `${finalName} Gauntlets`;
        }

        const bonuses: GameItem["bonuses"] = {
            ninjutsuOffense: namedArmorRoll.offenseVal,
            taijutsuOffense: namedArmorRoll.offenseVal,
            bukijutsuOffense: namedArmorRoll.offenseVal,
            genjutsuOffense: namedArmorRoll.offenseVal,
            ninjutsuDefense: namedArmorRoll.defenseVal,
            taijutsuDefense: namedArmorRoll.defenseVal,
            bukijutsuDefense: namedArmorRoll.defenseVal,
            genjutsuDefense: namedArmorRoll.defenseVal,
            [namedArmorRoll.special.bonusKey]: namedArmorRoll.special.value,
        };

        const reductionPct = Math.round(armorReductionForQuality(namedArmorRoll.armorQuality) * 100);
        const specialDesc = namedArmorRoll.special.kind === "Shield"
            ? `Shield +${namedArmorRoll.special.value}`
            : namedArmorRoll.special.kind === "Increase Damage"
                ? `${namedArmorRoll.special.kind} ${namedArmorRoll.special.value}%`
                : `${namedArmorRoll.special.kind} ${namedArmorRoll.special.value}%`;

        const id = `named-armor-${makeId()}`;
        const item: GameItem = {
            id,
            name: finalName,
            slot: namedArmorRoll.slot,
            rarity: "legendary",
            armorQuality: namedArmorRoll.armorQuality,
            cost: 0,
            description: namedArmorFlavorText.trim() ||
                `A master-forged ${slotLabel.toLowerCase()} piece. ${reductionPct}% damage reduction. ${specialDesc}.`,
            image: namedArmorImage || undefined,
            levelReq: 30,
            flavorText: namedArmorFlavorText.trim() || undefined,
            bonuses,
        };
        setCreatorItems([...creatorItems, item]);
        updateCharacter({
            ...character,
            inventory: [...character.inventory, id],
            boneCharms: bc,
            fateShards: fs,
            auraStones: as_,
            mythicSeals: ms,
        });
        // Persist the forged image to the shared store (saves strip inline base64,
        // so it re-hydrates from shared:img:item:<id> on reload).
        if (item.image) {
            void publishSharedImage('item:' + id, item.image).then((ok) => {
                if (!ok) alert(`Heads up — ${finalName} was forged, but its image couldn't be saved to the server, so it may not stick after a reload.`);
            });
        }
        setNamedArmorRoll(null);
        setNamedArmorName("Unnamed Vestige");
        setNamedArmorImage("");
        setNamedArmorFlavorText("");
        alert(`${finalName} has been forged and added to your inventory!`);
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
        setAwakeningMsg(`? The stone pulses with ${element} chakra! Your awakened elements: ${nextElements.join(" / ")}.`);
    }

    function awakeningPaidRoll() {
        if (character.fateShards < 10) {
            setAwakeningMsg("❌ Not enough Fate Shards — you need 10 to reroll your element.");
            return;
        }
        const currentElements = getCharacterElements(character);
        const nextElements = rollAwakeningElements(Math.max(1, currentElements.length));
        updateCharacter({ ...character, fateShards: character.fateShards - 10, element: nextElements[0], elements: nextElements });
        setAwakeningMsg(`? The stone swirls and reveals: ${nextElements.join(" / ")}! Your awakened elements have been rerolled (-10 Fate Shards).`);
    }

    function awakeningCreateBloodline(rank: Rank, materialKey: "boneCharms" | "auraStones" | "mythicSeals", cost: number) {
        if ((character[materialKey] ?? 0) < cost) {
            const label = materialKey === "boneCharms" ? "Bone Charms" : materialKey === "auraStones" ? "Aura Stones" : "Mythic Seals";
            setAwakeningMsg(`? Not enough ${label} — you need ${cost}.`);
            return;
        }
        updateCharacter({ ...character, [materialKey]: (character[materialKey] ?? 0) - cost });
        setShowAwakening(false);
        setCentralLog(`${rank} bloodline forge purchased. Finish building it in the Bloodline Maker.`);
        onOpenBloodlineMaker(rank);
    }

    const hasFreeRoll = (character.level >= 2 && !triggeredEvents.includes(AWAKENING_FREE_LV2_ID))
        || (character.level >= 20 && !triggeredEvents.includes(AWAKENING_FREE_LV20_ID));
    const weeklyBossOverrideAi = sharedWeeklyBossAiIdCache ? playableAis.find(ai => ai.id === sharedWeeklyBossAiIdCache) ?? null : null;
    // Schedule is consumed locally inside claimWeeklyBoss (fresh per-click compute);
    // the top-level binding is kept for potential future hub UI use.
    const _weeklyBoss = weeklyBossSchedule(character, Date.now(), weeklyBossOverrideAi);
    void _weeklyBoss;
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

    // Burn materials cheapest-first until costPts is paid. Returns a new
    // Character with the consumed materials removed from BOTH stores (hunt drops
    // live in inventory[], relics in itemStacks); does not mutate state.
    function consumeCraftPoints(costPts: number): Character {
        const ordered = Object.entries(CRAFT_POINTS).sort((a, b) => a[1] - b[1]);
        let next = character;
        let remaining = costPts;
        for (const [id, pts] of ordered) {
            while (remaining > 0 && countItem(next, id) > 0) {
                next = removeItem(next, id, 1);
                remaining -= pts;
            }
        }
        return next;
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

    function craftExistingWeapon(item: GameItem) {
        const costPts = weaponCraftPoints(item);
        const ryo = craftRyoForRarity(item.rarity);
        if (character.level < (item.levelReq ?? 1)) return alert(`Requires level ${item.levelReq ?? 1}.`);
        if (character.ryo < ryo) return alert(`Not enough ryo. Need ${ryo.toLocaleString()}.`);
        const total = craftPointsTotal();
        if (total < costPts) return alert(`Not enough materials. Need ${costPts} craft points, you have ${total}.`);
        updateCharacter({
            ...addItem(consumeCraftPoints(costPts), item.id, 1),
            ryo: character.ryo - ryo,
        });
        alert(`${item.name} forged and added to your inventory.`);
    }

    function craftExistingArmor(item: GameItem) {
        const costPts = armorCraftPoints(item);
        const ryo = craftRyoForRarity(item.rarity);
        if (character.level < (item.levelReq ?? 1)) return alert(`Requires level ${item.levelReq ?? 1}.`);
        if (character.ryo < ryo) return alert(`Not enough ryo. Need ${ryo.toLocaleString()}.`);
        const total = craftPointsTotal();
        if (total < costPts) return alert(`Not enough materials. Need ${costPts} craft points, you have ${total}.`);
        updateCharacter({
            ...addItem(consumeCraftPoints(costPts), item.id, 1),
            ryo: character.ryo - ryo,
        });
        alert(`${item.name} forged and added to your inventory.`);
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

    const centralOptions = [
        {
            name: "Arena District",
            icon: "⚔️",
            text: "Clan battles, ranked mode, tournaments, spectator boards, and pet battle challenges.",
            action: () => setScreen("arenaDistrict"),
        },
        {
            name: "Shinobi Council Hall",
            icon: "🏛️",
            text: "Active village wars, clan wars, HP of each side, and top contributors.",
            action: () => setScreen("shinobiCouncil"),
        },
        {
            name: "Grand Marketplace",
            icon: "🏪",
            text: "Rare items, trading stalls, cosmetics, limited event goods, and merchant contracts.",
            action: () => setScreen("grandMarketplace"),
        },
        {
            name: "Hunter Guild",
            icon: "🐉",
            text: "Beast hunt contracts, sector tracking, material drops, and hunter rank progression.",
            action: () => setScreen("hunting"),
        },
        {
            name: "Hall of Legends",
            icon: "🏆",
            text: "Ranked leaderboards, top clans, kill streaks, pet arena, endless waves, and village war records.",
            action: () => setScreen("hallOfLegends"),
        },
        {
            name: "Ancient Archives",
            icon: "📜",
            text: "Bloodline lore, forbidden jutsu research, hidden boss clues, and world history.",
            action: () => setShowArchives(true),
        },
        {
            name: "Awakening Stone",
            icon: "🔮",
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
            name: "Crafter",
            icon: "⚒️",
            text: "Convert hunting, boss, dungeon, and war materials into supplies and existing balanced weapons.",
            action: () => setShowCrafter(true),
        },
        {
            name: "Relic Dungeons",
            icon: "🗝️",
            text: `Use Dungeon Keys to enter one of five same-strength relic dungeons. Keys: ${countInventory(DUNGEON_KEY_ID)}.`,
            action: () => setShowDungeonPanel(true),
        },
        {
            name: "Weekly Boss",
            icon: "👹",
            text: "Server-wide rampage — boss has unlimited HP and despawns in 24h. Top 10 by damage earn a Weekly Boss Core, top 25 earn a Dungeon Key, MVP gets 2× ryo + XP.",
            action: () => setScreen("weeklyBoss"),
        },
        {
            name: "Celestial Tower",
            icon: "🌌",
            text: "Endless PvE climb — fight scaling AI until you fall. Banked ryo & XP lost on death, but kill milestones (Bone Charms / Fate Shards) and 10-kill rest stops are yours to keep.",
            action: () => setShowCelestialPanel(true),
        },
    ];

    return (
        <div className="central-hub">
            {/* Drifting golden motes + god-ray sweep over the citadel backdrop
                (sits behind the cards via z-index in central-skin.css). */}
            <SceneAmbience biome="central" />
            <div className="central-hero">
                <h1>⛩️ Central — The Thousand Gates</h1>
                <p>
                    A neutral fortress city where every village, clan, rogue, merchant,
                    hunter, and legend crosses paths.
                </p>
            </div>

            <div className="central-log">
                {centralLog}
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
                const isPending = !!activeWarBanner.pendingUntil && activeWarBanner.pendingUntil > Date.now();
                const minsToWar = isPending ? Math.max(1, Math.ceil((activeWarBanner.pendingUntil! - Date.now()) / 60_000)) : 0;
                const ageDays = Math.floor((Date.now() - (activeWarBanner.pendingUntil ?? activeWarBanner.startedAt)) / (24 * 60 * 60 * 1000));
                return (
                    <div
                        style={{
                            background: isPending
                                ? "linear-gradient(90deg, #3b2a05, #1a1a2e, #3b2a05)"
                                : "linear-gradient(90deg, #450a0a, #1a1a2e, #450a0a)",
                            border: `2px solid ${isPending ? "#fbbf24" : "#f87171"}`,
                            borderRadius: 8,
                            padding: "0.8rem 1rem",
                            margin: "0 0 1rem",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            boxShadow: isPending
                                ? "0 0 14px rgba(251, 191, 36, 0.25)"
                                : "0 0 14px rgba(248, 113, 113, 0.25)",
                            animation: "pulse 2.5s infinite",
                        }}
                    >
                        <div style={{ flex: 1, minWidth: 0 }}>
                            {isPending ? (
                                <>
                                    <strong style={{ color: "#fde047", fontSize: "1.05rem" }}>⏳ {character.village} vs {enemy} — War starts in {minsToWar} min</strong>
                                    <div style={{ fontSize: "0.82rem", color: "#fcd34d", marginTop: 4 }}>
                                        Pre-war window. Rally your village, queue guards, gather pre-fight buffs. No HP can drop until the timer expires.
                                    </div>
                                </>
                            ) : (
                                <>
                                    <strong style={{ color: "#fca5a5", fontSize: "1.05rem" }}>⚔ {character.village} is at War with {enemy}</strong>
                                    <div style={{ fontSize: "0.82rem", color: "#fde047", marginTop: 4, display: "flex", gap: 16, flexWrap: "wrap" }}>
                                        <span>Day {ageDays + 1}</span>
                                        <span>{myVillage}: <strong>{myHp.toLocaleString()}</strong> HP</span>
                                        <span>{enemy}: <strong>{enemyHp.toLocaleString()}</strong> HP</span>
                                        <span>War Ground HP: <strong>{activeWarBanner.warGroundHp}</strong></span>
                                    </div>
                                </>
                            )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <button
                                onClick={() => setScreen("townHall")}
                                style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171", color: "#fee2e2", padding: "0.4rem 0.8rem", fontSize: "0.85rem", fontWeight: 700 }}
                            >
                                Join the Fight →
                            </button>
                            <button
                                onClick={() => dismissWarBanner(activeWarBanner.id)}
                                style={{ background: "transparent", border: "1px solid #475569", color: "#94a3b8", padding: "0.15rem 0.5rem", fontSize: "0.7rem" }}
                                title="Hide this banner for this war (a new war will surface a fresh one)"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                );
            })()}

            <div className="central-grid">
                {centralOptions.map((option) => (
                    <button className="central-card" key={option.name} onClick={option.action}>
                        <span className="central-icon">{option.icon}</span>
                        <strong>{option.name}</strong>
                        <small>{option.text}</small>
                    </button>
                ))}
            </div>

            {showDungeonPanel && (
                <div className="celestial-panel-overlay" onClick={() => setShowDungeonPanel(false)}>
                    <div className="celestial-panel" onClick={e => e.stopPropagation()}>
                        <h2>Relic Dungeons</h2>
                        <p className="celestial-panel-sub">All five dungeons use the same strength curve and reward a Dungeon Legendary Relic on full clear.</p>
                        <p className="hint">Dungeon Keys: <strong>{countInventory(DUNGEON_KEY_ID)}</strong></p>
                        <div className="celestial-panel-options">
                            {craftDungeonEvents.map((event) => (
                                <button
                                    key={event.id}
                                    className="celestial-option-btn"
                                    onClick={() => {
                                        setShowDungeonPanel(false);
                                        onStartDungeon(event);
                                    }}
                                    disabled={countInventory(DUNGEON_KEY_ID) <= 0 || character.level < event.levelReq}
                                >
                                    <span className="celestial-option-icon">{event.icon}</span>
                                    <strong>{event.name}</strong>
                                    <small>Lv {event.levelReq} | {biomeLabel(event.biome)} | drops Dungeon Legendary Relic</small>
                                </button>
                            ))}
                        </div>
                        <button className="danger-button" onClick={() => setShowDungeonPanel(false)}>Close</button>
                    </div>
                </div>
            )}

            {showCelestialPanel && (
                <div className="celestial-panel-overlay" onClick={() => setShowCelestialPanel(false)}>
                    <div className="celestial-panel" onClick={e => e.stopPropagation()}>
                        <h2>🗼 Celestial Tower</h2>
                        <p className="celestial-panel-sub">An endless climb against a parade of scaling opponents.</p>
                        <div style={{ background: "rgba(15,23,42,0.5)", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 6, padding: "0.7rem 0.9rem", margin: "0.4rem 0 0.8rem", fontSize: "0.85rem", lineHeight: 1.5 }}>
                            <div><strong>How it works</strong></div>
                            <div>· Each wave drops a random AI scaled to your level + current wave. Every 10th wave is a boss.</div>
                            <div>· Win → bank ryo &amp; XP, advance to the next wave with whatever HP you have left.</div>
                            <div>· Die → all banked ryo/XP is lost. Hospital trip applies. <strong>Milestone currencies stay credited.</strong></div>
                            <div style={{ marginTop: 6 }}><strong>Kill milestones</strong> (auto-credited, repeat every 20 kills):</div>
                            <div>· Kills 5, 10 → <span style={{ color: "#a78bfa" }}>+5 Bone Charms</span></div>
                            <div>· Kill 15 → <span style={{ color: "#facc15" }}>+5 Fate Shards</span></div>
                            <div>· Kill 20 → <span style={{ color: "#a78bfa" }}>+5 Bone Charms</span> &amp; <span style={{ color: "#facc15" }}>+5 Fate Shards</span></div>
                            <div>· Pattern repeats: 25/30 bone, 35 fate, 40 both, and so on.</div>
                            <div style={{ marginTop: 6 }}><strong>Rest stops:</strong> every 10th kill automatically restores 33% HP and 50% chakra &amp; stamina.</div>
                        </div>
                        <div className="celestial-panel-options">
                            <button className="celestial-option-btn celestial-endless-btn" onClick={() => { setShowCelestialPanel(false); setScreen("endlessTower"); }}>
                                <span className="celestial-option-icon">🗼</span>
                                <strong>Enter Celestial Tower</strong>
                                <small>Fight until you fall. Banked ryo/XP lost on death — milestones survive.</small>
                            </button>
                        </div>
                        <button className="back-btn" style={{ marginTop: "1rem" }} onClick={() => setShowCelestialPanel(false)}>× Close</button>
                    </div>
                </div>
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
                    <div className="archives-overlay">
                        <div className="archives-panel">
                            <div className="archives-header">
                                <h2>📜 Ancient Archives — Bloodline Codex</h2>
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
                    </div>
                );
            })()}

            {showAwakening && (
                <div className="archives-overlay">
                    <div className="awakening-panel">
                        <div className="archives-header">
                            <h2>💎 Awakening Stone</h2>
                            <button className="danger-button" onClick={() => setShowAwakening(false)}>× Close</button>
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
                            <h3>✨ Elemental Awakening</h3>
                            <p className="awakening-hint">The stone randomly reveals one of five elements: 💧 Water · 💨 Wind · 🌍 Earth · ⚡ Lightning · 🔥 Fire</p>
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
                            <h3>🔮 Ancient Materials</h3>
                            <div className="awakening-materials">
                                <div className="awakening-material-row">
                                    <span className="awakening-material-icon">🦴</span>
                                    <span className="awakening-material-name">Bone Charms</span>
                                    <span className="awakening-material-count">{character.boneCharms ?? 0}</span>
                                </div>
                                <div className="awakening-material-row">
                                    <span className="awakening-material-icon">💎</span>
                                    <span className="awakening-material-name">Aura Stones</span>
                                    <span className="awakening-material-count">{character.auraStones ?? 0}</span>
                                </div>
                                <div className="awakening-material-row">
                                    <span className="awakening-material-icon">📜</span>
                                    <span className="awakening-material-name">Mythic Seals</span>
                                    <span className="awakening-material-count">{character.mythicSeals ?? 0}</span>
                                </div>
                            </div>
                        </div>

                        {/* Bloodline forge section */}
                        <div className="awakening-section">
                            <h3>🔥 Bloodline Forge</h3>
                            <p className="awakening-hint">Channel ancient materials through the stone to forge a new bloodline. The bloodline will carry your element and await further techniques.</p>
                            <div className="awakening-forge-grid">
                                <div className="awakening-forge-card rank-b">
                                    <div className="awakening-forge-rank">B Rank</div>
                                    <div className="awakening-forge-cost">💀 100 Bone Charms</div>
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
                                    <div className="awakening-forge-cost">✨ 100 Aura Stones</div>
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
                                    <div className="awakening-forge-cost">🔮 100 Mythic Seals</div>
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

            {showCrafter && (() => {
                // Supplies, Weapons, and Armor all read the same unified
                // craft-points pool (CRAFT_POINTS / craftPointsTotal /
                // consumeCraftPoints, defined at component scope) so the
                // three tabs stay balanced against one another.
                const totalPts = craftPointsTotal();

                function craftItem(costPts: number, grant: (c: Character) => Character) {
                    if (totalPts < costPts) return alert(`Not enough materials. Need ${costPts} craft points, you have ${totalPts}.`);
                    updateCharacter(grant(consumeCraftPoints(costPts)));
                    alert("Crafting complete!");
                }

                const recipes = [
                    { name: "Pet Treats", cost: 50, desc: "1× Treats (+100 pet XP)", craft: (c: Character) => ({ ...c, inventory: [...c.inventory, "pet-treat"] }) },
                    { name: "Elemental Treats", cost: 100, desc: "1× Elemental Treats (+250 pet XP)", craft: (c: Character) => ({ ...c, inventory: [...c.inventory, "elemental-pet-treat"] }) },
                    { name: "Aura Dust", cost: 50, desc: "+50 Aura Dust", craft: (c: Character) => ({ ...c, auraDust: (c.auraDust ?? 0) + 50 }) },
                    { name: "Bone Charm", cost: 1000, desc: "+1 Bone Charm", craft: (c: Character) => ({ ...c, boneCharms: (c.boneCharms ?? 0) + 1 }) },
                    // Thrown weapons
                    { name: "Shuriken ×3", cost: 15, desc: "3× Shuriken (22 EP thrown)", craft: (c: Character) => ({ ...c, inventory: [...c.inventory, "thrown-shuriken", "thrown-shuriken", "thrown-shuriken"] }) },
                    { name: "Senbon ×1", cost: 30, desc: "1× Senbon (300 dmg/round, 2 rounds)", craft: (c: Character) => ({ ...c, inventory: [...c.inventory, "thrown-senbon"] }) },
                    { name: "Serpent Dust ×1", cost: 40, desc: "1× Serpent Dust (55% poison, 2 rounds)", craft: (c: Character) => ({ ...c, inventory: [...c.inventory, "thrown-serpent-dust"] }) },
                    // Combat items
                    { name: "Smoke Bomb ×1", cost: 25, desc: "1× Smoke Bomb (100% dmg reduction to both players, 1 round; pierce still deals full dmg)", craft: (c: Character) => ({ ...c, inventory: [...c.inventory, "item-smoke-bomb"] }) },
                    { name: "Attack Pill ×1", cost: 20, desc: "1× Attack Pill (+15% damage dealt, 2 rounds)", craft: (c: Character) => ({ ...c, inventory: [...c.inventory, "item-attack-pill"] }) },
                    { name: "Defense Pill ×1", cost: 20, desc: "1× Defense Pill (-15% damage received, 2 rounds)", craft: (c: Character) => ({ ...c, inventory: [...c.inventory, "item-defense-pill"] }) },
                    // PVE companion gear — epic/legendary-tier crafts. Each piece
                    // boosts the summoned pet in PvE and wears out after 20 summons.
                    ...petPveGear.map((gear) => ({
                        name: gear.name,
                        cost: gear.craftPts,
                        desc: `1× ${gear.name} (PVE slot) — ${gear.desc}. Breaks after ${PET_PVE_DURABILITY} summons.`,
                        craft: (c: Character) => ({ ...c, inventory: [...c.inventory, gear.id] }),
                    })),
                    // Battle consumables — reactive single-use items (epic-tier craft).
                    ...petConsumables.map((cons) => ({
                        name: cons.name,
                        cost: cons.craftPts,
                        desc: `1× ${cons.name} (Consumable slot) — ${cons.desc}. Single use.`,
                        craft: (c: Character) => ({ ...c, inventory: [...c.inventory, cons.id] }),
                    })),
                ];

                return (
                    <div className="crafter-overlay" onClick={() => setShowCrafter(false)}>
                        <div className="crafter-panel" onClick={(e) => e.stopPropagation()}>
                            <div className="archives-header">
                                <h2>🔨 Crafter</h2>
                                <button className="danger-button" onClick={() => setShowCrafter(false)}>✕ Close</button>
                            </div>
                            <p className="crafter-subtitle">Convert hunting, boss, dungeon, and war materials into supplies, weapons, or armor.</p>
                            <div className="inventory-tabs" style={{ marginBottom: 12 }}>
                                <button className={crafterTab === "supplies" ? "active" : ""} onClick={() => setCrafterTab("supplies")}>Supplies</button>
                                <button className={crafterTab === "weapons" ? "active" : ""} onClick={() => setCrafterTab("weapons")}>Weapons</button>
                                <button className={crafterTab === "armor" ? "active" : ""} onClick={() => setCrafterTab("armor")}>Armor</button>
                            </div>

                            {crafterTab === "supplies" && <><div className="crafter-material-list">
                                <strong>Your Materials</strong>
                                {Object.entries(CRAFT_MATERIAL_NAMES).map(([id, label]) => {
                                    const count = countItem(character, id);
                                    return (
                                        <div key={id} className="crafter-material-row">
                                            <span>{label}</span>
                                            <span>{count}× <small>({CRAFT_POINTS[id]} pts each)</small></span>
                                        </div>
                                    );
                                })}
                                <div className="crafter-total-pts">Total craft points: <strong>{totalPts}</strong></div>
                            </div>

                            {/* ── Special forges: Hollow Gate Key + Dungeon Legendary Relic ──
                                Rendered side-by-side in one compact 2-col grid (crafter-special-*)
                                to save vertical space. Each card keeps its own forge logic. */}
                            <div className="crafter-recipe-grid crafter-special-grid" style={{ marginBottom: 12 }}>
                            {(() => {
                                const dungeonKeyCount = countItem(character, DUNGEON_KEY_ID);
                                const fateShardCount = character.fateShards ?? 0;
                                const canCraftWithKeys = dungeonKeyCount >= HOLLOW_GATE_KEY_DUNGEON_KEY_COST;
                                const canCraftWithShards = fateShardCount >= HOLLOW_GATE_KEY_FATE_SHARD_COST;
                                function craftHollowGateKeyWithDungeonKeys() {
                                    if (dungeonKeyCount < HOLLOW_GATE_KEY_DUNGEON_KEY_COST) {
                                        alert(`You need ${HOLLOW_GATE_KEY_DUNGEON_KEY_COST} Dungeon Keys. You have ${dungeonKeyCount}.`);
                                        return;
                                    }
                                    updateCharacter(
                                        addItem(
                                            removeItem(character, DUNGEON_KEY_ID, HOLLOW_GATE_KEY_DUNGEON_KEY_COST),
                                            HOLLOW_GATE_KEY_ID,
                                            1,
                                        ),
                                    );
                                    alert(`Hollow Gate Key forged. Consumed ${HOLLOW_GATE_KEY_DUNGEON_KEY_COST} Dungeon Keys.`);
                                }
                                function craftHollowGateKeyWithFateShards() {
                                    if ((character.fateShards ?? 0) < HOLLOW_GATE_KEY_FATE_SHARD_COST) {
                                        alert(`You need ${HOLLOW_GATE_KEY_FATE_SHARD_COST} Fate Shards. You have ${character.fateShards ?? 0}.`);
                                        return;
                                    }
                                    updateCharacter({
                                        ...character,
                                        fateShards: (character.fateShards ?? 0) - HOLLOW_GATE_KEY_FATE_SHARD_COST,
                                        inventory: [...character.inventory, HOLLOW_GATE_KEY_ID],
                                    });
                                    alert(`Hollow Gate Key forged. Consumed ${HOLLOW_GATE_KEY_FATE_SHARD_COST} Fate Shards.`);
                                }
                                const ownedKeys = countItem(character, HOLLOW_GATE_KEY_ID);
                                return (
                                    <div className="crafter-recipe-btn crafter-special-card" style={{ borderColor: "#a855f7", boxShadow: "0 0 10px rgba(168,85,247,0.22)" }}>
                                        <strong>⛩ Hollow Gate Key</strong>
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
                                function forgeRelicFromFragments() {
                                    if (fragmentCount < FRAGMENTS_PER_RELIC) {
                                        alert(`You need ${FRAGMENTS_PER_RELIC} Dungeon Legendary Fragments. You have ${fragmentCount}.`);
                                        return;
                                    }
                                    updateCharacter(
                                        addItem(
                                            removeItem(character, DUNGEON_LEGENDARY_FRAGMENT_ID, FRAGMENTS_PER_RELIC),
                                            DUNGEON_LEGENDARY_RELIC_ID,
                                            1,
                                        ),
                                    );
                                    alert(`Dungeon Legendary Relic forged. Consumed ${FRAGMENTS_PER_RELIC} Fragments.`);
                                }
                                return (
                                    <div className="crafter-recipe-btn crafter-special-card" style={{ borderColor: "#facc15", boxShadow: "0 0 10px rgba(250,204,21,0.22)" }}>
                                        <strong>💎 Dungeon Legendary Relic</strong>
                                        <small>Combine Hollow Gate Warden fragments into a legendary relic.</small>
                                        <small>Fragments: <strong>{fragmentCount}</strong> · Relics: <strong>{relicCount}</strong></small>
                                        <button style={{ marginTop: "auto" }} onClick={forgeRelicFromFragments} disabled={!canForge}>
                                            {canForge
                                                ? `Forge — ${FRAGMENTS_PER_RELIC} Fragments`
                                                : `Need ${FRAGMENTS_PER_RELIC} Fragments (have ${fragmentCount})`}
                                        </button>
                                    </div>
                                );
                            })()}
                            </div>

                            <div className="crafter-recipe-grid">
                                {recipes.map((recipe) => {
                                    const fillPct = Math.min(100, Math.floor((totalPts / recipe.cost) * 100));
                                    return (
                                        <div key={recipe.name} className="crafter-recipe-btn">
                                            <strong>{recipe.name}</strong>
                                            <small>{recipe.desc}</small>
                                            <div className="crafter-progress-bar">
                                                <div className="crafter-progress-fill" style={{ width: `${fillPct}%` }} />
                                            </div>
                                            <small className="crafter-pts-label">{Math.min(totalPts, recipe.cost)}/{recipe.cost} pts</small>
                                            <button onClick={() => craftItem(recipe.cost, recipe.craft)} disabled={totalPts < recipe.cost}>
                                                Craft
                                            </button>
                                        </div>
                                    );
                                })}
                            </div></>}

                            {crafterTab === "weapons" && <><div className="crafter-material-list">
                                <strong>Your Materials</strong>
                                {Object.entries(CRAFT_MATERIAL_NAMES).map(([id, label]) => {
                                    const count = countItem(character, id);
                                    return (
                                        <div key={id} className="crafter-material-row">
                                            <span>{label}</span>
                                            <span>{count}× <small>({CRAFT_POINTS[id]} pts each)</small></span>
                                        </div>
                                    );
                                })}
                                <div className="crafter-total-pts">Total craft points: <strong>{totalPts}</strong></div>
                            </div>

                            {weaponInfoItem && (
                                <div className="modal-overlay" onClick={() => setWeaponInfoItem(null)}>
                                    <div className="modal-box weapon-info-modal" onClick={e => e.stopPropagation()}>
                                        <button className="modal-close-btn" onClick={() => setWeaponInfoItem(null)}>✕</button>
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
                                </div>
                            )}
                            <div className="crafter-recipe-grid">
                                {craftableWeapons.map((item) => {
                                    const costPts = weaponCraftPoints(item);
                                    const ryo = craftRyoForRarity(item.rarity);
                                    const ready = character.level >= (item.levelReq ?? 1) && character.ryo >= ryo && totalPts >= costPts;
                                    const fillPct = Math.min(100, Math.floor((totalPts / costPts) * 100));
                                    return (
                                        <div key={item.id} className="crafter-recipe-btn">
                                            <div className="crafter-recipe-btn-header">
                                                <strong>{item.name}</strong>
                                                <button className="weapon-info-btn" onClick={() => setWeaponInfoItem(item)} title="View weapon info">ℹ️</button>
                                            </div>
                                            <small>{item.rarity.toUpperCase()} | Lv {item.levelReq ?? 1} | {item.weaponEp ?? 0} EP | {item.weaponEffect ?? "Weapon"}</small>
                                            <small>{costPts} craft pts + {ryo.toLocaleString()} ryo</small>
                                            <div className="crafter-progress-bar">
                                                <div className="crafter-progress-fill" style={{ width: `${fillPct}%` }} />
                                            </div>
                                            <small className="crafter-pts-label">{Math.min(totalPts, costPts)}/{costPts} pts</small>
                                            <button onClick={() => craftExistingWeapon(item)} disabled={!ready}>
                                                Forge
                                            </button>
                                        </div>
                                    );
                                })}
                            </div></>}

                            {crafterTab === "armor" && <><div className="crafter-material-list">
                                <strong>Your Materials</strong>
                                {Object.entries(CRAFT_MATERIAL_NAMES).map(([id, label]) => {
                                    const count = countItem(character, id);
                                    return (
                                        <div key={id} className="crafter-material-row">
                                            <span>{label}</span>
                                            <span>{count}× <small>({CRAFT_POINTS[id]} pts each)</small></span>
                                        </div>
                                    );
                                })}
                                <div className="crafter-total-pts">Total craft points: <strong>{totalPts}</strong></div>
                            </div>
                            <div className="crafter-recipe-grid">
                                {craftableArmor.length === 0 ? (
                                    <p className="hint">No armor recipes available yet — add craftable armor items via the admin item creator.</p>
                                ) : (
                                    craftableArmor.map((item) => {
                                        const costPts = armorCraftPoints(item);
                                        const ryo = craftRyoForRarity(item.rarity);
                                        const ready = character.level >= (item.levelReq ?? 1) && character.ryo >= ryo && totalPts >= costPts;
                                        const fillPct = Math.min(100, Math.floor((totalPts / costPts) * 100));
                                        return (
                                            <div key={item.id} className="crafter-recipe-btn">
                                                <div className="crafter-recipe-btn-header">
                                                    <strong>{item.name}</strong>
                                                </div>
                                                <small>{item.rarity.toUpperCase()} | Lv {item.levelReq ?? 1} | {equipmentSlotLabel(item.slot)} | {item.armorQuality ?? "—"}</small>
                                                <small>{costPts} craft pts + {ryo.toLocaleString()} ryo</small>
                                                <div className="crafter-progress-bar">
                                                    <div className="crafter-progress-fill" style={{ width: `${fillPct}%` }} />
                                                </div>
                                                <small className="crafter-pts-label">{Math.min(totalPts, costPts)}/{costPts} pts</small>
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
                                const naPts = namedWeaponCurrencyPts();
                                const naFill = Math.min(100, Math.floor((naPts / NW_COST) * 100));
                                return (
                                    <div className="named-weapon-forge">
                                        <div className="named-weapon-forge-header">
                                            <span className="named-weapon-forge-title">🛡️ Named Armor</span>
                                            <small>Roll a unique legendary armor piece. Costs {NW_COST} forge pts.</small>
                                        </div>

                                        {/* Currency display — same pool as named weapons */}
                                        <div className="named-weapon-currencies">
                                            <div className="named-weapon-currency-row">
                                                <span>🪬 Bone Charms</span>
                                                <span>{character.boneCharms ?? 0} × {NW_CURRENCY_PTS.boneCharms} pts = <strong>{(character.boneCharms ?? 0) * NW_CURRENCY_PTS.boneCharms}</strong></span>
                                            </div>
                                            <div className="named-weapon-currency-row">
                                                <span>🔮 Fate Shards</span>
                                                <span>{character.fateShards ?? 0} × {NW_CURRENCY_PTS.fateShards} pts = <strong>{(character.fateShards ?? 0) * NW_CURRENCY_PTS.fateShards}</strong></span>
                                            </div>
                                            <div className="named-weapon-currency-row">
                                                <span>💠 Aura Stones</span>
                                                <span>{character.auraStones ?? 0} × {NW_CURRENCY_PTS.auraStones} pts = <strong>{(character.auraStones ?? 0) * NW_CURRENCY_PTS.auraStones}</strong></span>
                                            </div>
                                            <div className="named-weapon-currency-row">
                                                <span>🔱 Mythic Seals</span>
                                                <span>{character.mythicSeals ?? 0} × {NW_CURRENCY_PTS.mythicSeals} pts = <strong>{(character.mythicSeals ?? 0) * NW_CURRENCY_PTS.mythicSeals}</strong></span>
                                            </div>
                                            <div className="named-weapon-currency-total">
                                                Total forge pts: <strong>{naPts}</strong> / {NW_COST}
                                            </div>
                                        </div>

                                        <div className="crafter-progress-bar" style={{ margin: "4px 0 8px" }}>
                                            <div className="crafter-progress-fill named-weapon-fill" style={{ width: `${naFill}%` }} />
                                        </div>

                                        {/* Slot selector */}
                                        <label className="named-weapon-label">Armor Slot</label>
                                        <select
                                            className="named-weapon-input"
                                            value={namedArmorSlot}
                                            onChange={(e) => setNamedArmorSlot(e.target.value as EquipmentSlot)}
                                        >
                                            {NAMED_ARMOR_SLOTS.map((s) => (
                                                <option key={s.value} value={s.value}>{s.label}</option>
                                            ))}
                                        </select>

                                        <div className="named-weapon-odds">
                                            <div className="named-weapon-odds-title">🎲 Roll Odds</div>
                                            <div className="named-weapon-odds-grid">
                                                <div className="nwo-section">
                                                    <div className="nwo-label">Damage Reduction</div>
                                                    <div className="nwo-rows">
                                                        <div className="nwo-row"><span>6% (Elite)</span><span className="nwo-pct">33.3%</span></div>
                                                        <div className="nwo-row"><span>7% (Legendary)</span><span className="nwo-pct">33.3%</span></div>
                                                        <div className="nwo-row"><span>8% (Mythic)</span><span className="nwo-pct">33.3%</span></div>
                                                    </div>
                                                </div>
                                                <div className="nwo-section">
                                                    <div className="nwo-label">All Offense</div>
                                                    <div className="nwo-rows">
                                                        <div className="nwo-row"><span>+25 to +35</span><span className="nwo-pct">~9.1% each</span></div>
                                                    </div>
                                                </div>
                                                <div className="nwo-section">
                                                    <div className="nwo-label">All Defense</div>
                                                    <div className="nwo-rows">
                                                        <div className="nwo-row"><span>+25 to +35</span><span className="nwo-pct">~9.1% each</span></div>
                                                    </div>
                                                </div>
                                                <div className="nwo-section nwo-section-wide">
                                                    <div className="nwo-label">Special Effect (each {(100 / NAMED_ARMOR_SPECIALS.length).toFixed(1)}% to roll)</div>
                                                    <div className="nwo-rows">
                                                        <div className="nwo-row"><span>🛡 Absorb</span><span className="nwo-pct">0.08–2%</span></div>
                                                        <div className="nwo-row"><span>🔰 Shield</span><span className="nwo-pct">+75 to +150 HP</span></div>
                                                        <div className="nwo-row"><span>↩️ Reflect</span><span className="nwo-pct">0.08–2%</span></div>
                                                        <div className="nwo-row"><span>🩸 Life Steal</span><span className="nwo-pct">0.08–2%</span></div>
                                                        <div className="nwo-row"><span>💥 Increase Damage</span><span className="nwo-pct">0.75–1.50%</span></div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            className="named-weapon-roll-btn"
                                            onClick={rollNamedArmor}
                                            disabled={naPts < NW_COST}
                                        >
                                            🎲 Roll Named Armor
                                        </button>

                                        {namedArmorRoll && (
                                            <div className="named-weapon-result">
                                                <div className="named-weapon-stats">
                                                    <div className="named-weapon-stat-row"><span>Slot</span><strong>{NAMED_ARMOR_SLOTS.find(s => s.value === namedArmorRoll.slot)?.label}</strong></div>
                                                    <div className="named-weapon-stat-row"><span>Damage Reduction</span><strong>{Math.round(armorReductionForQuality(namedArmorRoll.armorQuality) * 100)}% ({namedArmorRoll.armorQuality})</strong></div>
                                                    <div className="named-weapon-stat-row"><span>All Offense</span><strong>+{namedArmorRoll.offenseVal}</strong></div>
                                                    <div className="named-weapon-stat-row"><span>All Defense</span><strong>+{namedArmorRoll.defenseVal}</strong></div>
                                                    <div className="named-weapon-stat-row named-weapon-tag-row">
                                                        <span>Special</span>
                                                        <strong>
                                                            {namedArmorRoll.special.kind}
                                                            {namedArmorRoll.special.kind === "Shield"
                                                                ? ` +${namedArmorRoll.special.value} HP`
                                                                : ` ${namedArmorRoll.special.value}%`}
                                                        </strong>
                                                    </div>
                                                </div>

                                                <label className="named-weapon-label">Armor Name</label>
                                                <input
                                                    className="named-weapon-input"
                                                    value={namedArmorName}
                                                    onChange={(e) => setNamedArmorName(e.target.value)}
                                                    placeholder="e.g. Stormveil Plate"
                                                />

                                                <label className="named-weapon-label">Flavor Text</label>
                                                <textarea
                                                    className="named-weapon-input"
                                                    rows={3}
                                                    value={namedArmorFlavorText}
                                                    onChange={(e) => setNamedArmorFlavorText(e.target.value)}
                                                    placeholder="Forged from the scales of the Ash Lizard king…"
                                                />

                                                <label className="named-weapon-label">Armor Image</label>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) readImageFile(file, setNamedArmorImage, 100);
                                                    }}
                                                />
                                                {namedArmorImage && (
                                                    <div className="named-weapon-image-preview">
                                                        <img src={namedArmorImage} alt="armor preview" />
                                                        <button className="danger-button" onClick={() => setNamedArmorImage("")}>Remove</button>
                                                    </div>
                                                )}

                                                <div className="named-weapon-forge-actions">
                                                    <button className="named-weapon-forge-btn" onClick={forgeNamedArmor}>
                                                        🔨 Forge Armor
                                                    </button>
                                                    <button className="danger-button" onClick={() => setNamedArmorRoll(null)}>
                                                        🗑️ Discard Roll
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* -- Named Weapon Forge -- */}
                            {crafterTab === "weapons" && (() => {
                                const nwPts = namedWeaponCurrencyPts();
                                const nwFill = Math.min(100, Math.floor((nwPts / NW_COST) * 100));
                                return (
                                    <div className="named-weapon-forge">
                                        <div className="named-weapon-forge-header">
                                            <span className="named-weapon-forge-title">⚔️ Named Weapon</span>
                                            <small>Roll a unique legendary hand weapon. Costs {NW_COST} forge pts.</small>
                                        </div>

                                        {/* Currency display */}
                                        <div className="named-weapon-currencies">
                                            <div className="named-weapon-currency-row">
                                                <span>🪬 Bone Charms</span>
                                                <span>{character.boneCharms ?? 0} × {NW_CURRENCY_PTS.boneCharms} pts = <strong>{(character.boneCharms ?? 0) * NW_CURRENCY_PTS.boneCharms}</strong></span>
                                            </div>
                                            <div className="named-weapon-currency-row">
                                                <span>🔮 Fate Shards</span>
                                                <span>{character.fateShards ?? 0} × {NW_CURRENCY_PTS.fateShards} pts = <strong>{(character.fateShards ?? 0) * NW_CURRENCY_PTS.fateShards}</strong></span>
                                            </div>
                                            <div className="named-weapon-currency-row">
                                                <span>💠 Aura Stones</span>
                                                <span>{character.auraStones ?? 0} × {NW_CURRENCY_PTS.auraStones} pts = <strong>{(character.auraStones ?? 0) * NW_CURRENCY_PTS.auraStones}</strong></span>
                                            </div>
                                            <div className="named-weapon-currency-row">
                                                <span>🔱 Mythic Seals</span>
                                                <span>{character.mythicSeals ?? 0} × {NW_CURRENCY_PTS.mythicSeals} pts = <strong>{(character.mythicSeals ?? 0) * NW_CURRENCY_PTS.mythicSeals}</strong></span>
                                            </div>
                                            <div className="named-weapon-currency-total">
                                                Total forge pts: <strong>{nwPts}</strong> / {NW_COST}
                                            </div>
                                        </div>

                                        <div className="crafter-progress-bar" style={{ margin: "4px 0 8px" }}>
                                            <div className="crafter-progress-fill named-weapon-fill" style={{ width: `${nwFill}%` }} />
                                        </div>

                                        <div className="named-weapon-odds">
                                            <div className="named-weapon-odds-title">🎲 Roll Odds</div>
                                            <div className="named-weapon-odds-grid">
                                                <div className="nwo-section">
                                                    <div className="nwo-label">Damage EP</div>
                                                    <div className="nwo-rows">
                                                        {[30,31,32,33,34,35].map(v => (
                                                            <div key={v} className="nwo-row">
                                                                <span>{v}</span><span className="nwo-pct">16.7%</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="nwo-section">
                                                    <div className="nwo-label">Range</div>
                                                    <div className="nwo-rows">
                                                        {[3,4,5].map(v => (
                                                            <div key={v} className="nwo-row">
                                                                <span>{v}</span><span className="nwo-pct">33.3%</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="nwo-section">
                                                    <div className="nwo-label">All Offenses</div>
                                                    <div className="nwo-rows">
                                                        <div className="nwo-row"><span>168–180</span><span className="nwo-pct">~7.7% each</span></div>
                                                    </div>
                                                </div>
                                                <div className="nwo-section">
                                                    <div className="nwo-label">Tag Count</div>
                                                    <div className="nwo-rows">
                                                        <div className="nwo-row"><span>1 tag (35–40%)</span><span className="nwo-pct">50%</span></div>
                                                        <div className="nwo-row"><span>2 tags (15–20% ea.)</span><span className="nwo-pct">50%</span></div>
                                                    </div>
                                                </div>
                                                <div className="nwo-section nwo-section-wide">
                                                    <div className="nwo-label">Possible Tags (each ~{(100 / NAMED_WEAPON_TAGS.length).toFixed(1)}% to appear)</div>
                                                    <div className="nwo-tags">
                                                        {NAMED_WEAPON_TAGS.map(t => (
                                                            <span key={t} className="nwo-tag-chip">{t}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="nwo-section nwo-section-wide">
                                                    <div className="nwo-label">Tag Formula Notes</div>
                                                    <div className="nwo-rows">
                                                        <div className="nwo-row"><span>🔰 Shield</span><span className="nwo-pct">Adds HP shield = rolled% × weapon hit damage</span></div>
                                                        <div className="nwo-row"><span>💚 Heal</span><span className="nwo-pct">Flat heal — 400 HP (single-tag roll) or 200 HP (dual-tag roll)</span></div>
                                                        <div className="nwo-row"><span>🩸 Siphon</span><span className="nwo-pct">Restores HP = rolled% × weapon hit damage</span></div>
                                                        <div className="nwo-row"><span>🔥 Afterburn</span><span className="nwo-pct">2-round status: next 2 attacks deal +rolled% damage</span></div>
                                                        <div className="nwo-row"><span>☠️ Poison / Drain</span><span className="nwo-pct">Deals rolled% of enemy chakra as damage per round</span></div>
                                                        <div className="nwo-row"><span>💥 Damage / IDG / DDT / Reflect / Absorb</span><span className="nwo-pct">Flat % modifier for 2 rounds</span></div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            className="named-weapon-roll-btn"
                                            onClick={rollNamedWeapon}
                                            disabled={nwPts < NW_COST}
                                        >
                                            🎲 Roll Named Weapon
                                        </button>

                                        {namedWeaponRoll && (
                                            <div className="named-weapon-result">
                                                <div className="named-weapon-stats">
                                                    <div className="named-weapon-stat-row"><span>Damage EP</span><strong>{namedWeaponRoll.ep}</strong></div>
                                                    <div className="named-weapon-stat-row"><span>AP Cost</span><strong>40</strong></div>
                                                    <div className="named-weapon-stat-row"><span>Range</span><strong>{namedWeaponRoll.range}</strong></div>
                                                    <div className="named-weapon-stat-row"><span>All Offenses</span><strong>+{namedWeaponRoll.offenseVal}</strong></div>
                                                    {namedWeaponRoll.tags.map((t, i) => {
                                                        const healFlat = t.name === "Heal" ? (t.percent >= 35 ? 400 : 200) : null;
                                                        const dmgScaled = t.name === "Shield" || t.name === "Siphon" || t.name === "Lifesteal" || t.name === "Wound" || tagMatchesName(t.name, "Ignition");
                                                        return (
                                                            <div key={i} className="named-weapon-stat-row named-weapon-tag-row">
                                                                <span>Tag {i + 1}</span>
                                                                <strong>
                                                                    {t.name} {t.percent}%
                                                                    {healFlat !== null && <span className="nw-tag-formula"> (flat {healFlat} HP)</span>}
                                                                    {dmgScaled && <span className="nw-tag-formula"> (= {t.percent}% of hit dmg)</span>}
                                                                </strong>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                <label className="named-weapon-label">Weapon Name</label>
                                                <input
                                                    className="named-weapon-input"
                                                    value={namedWeaponName}
                                                    onChange={(e) => setNamedWeaponName(e.target.value)}
                                                    placeholder="e.g. Void Fang"
                                                />

                                                <label className="named-weapon-label">Flavor Text</label>
                                                <textarea
                                                    className="named-weapon-input"
                                                    rows={3}
                                                    value={namedWeaponFlavorText}
                                                    onChange={(e) => setNamedWeaponFlavorText(e.target.value)}
                                                    placeholder="A blade forged from the bones of ancient beasts…"
                                                />

                                                <label className="named-weapon-label">Weapon Image</label>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) readImageFile(file, setNamedWeaponImage, 100);
                                                    }}
                                                />
                                                {namedWeaponImage && (
                                                    <div className="named-weapon-image-preview">
                                                        <img src={namedWeaponImage} alt="weapon preview" />
                                                        <button className="danger-button" onClick={() => setNamedWeaponImage("")}>Remove</button>
                                                    </div>
                                                )}

                                                <div className="named-weapon-forge-actions">
                                                    <button className="named-weapon-forge-btn" onClick={forgeNamedWeapon}>
                                                        🔨 Forge Weapon
                                                    </button>
                                                    <button className="danger-button" onClick={() => setNamedWeaponRoll(null)}>
                                                        🗑️ Discard Roll
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

/** Deterministic tile index (0-143) for a player name so their map dot is stable across renders */
