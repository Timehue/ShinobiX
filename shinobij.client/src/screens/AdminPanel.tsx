/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { AdminRole, Biome, JutsuElement, JutsuMethod, JutsuTarget, JutsuType, Rank, Screen } from "../types/core";
import type { Character, PlayerRecord, RewardCurrencyKey, ServerPlayerSummary } from "../types/character";
import type { ArmorQuality, EquipmentSlot, GameItem, Jutsu, ReviewBloodline, SavedBloodline, Stats } from "../types/combat";
import type { AiAction, AiCondition, AiLoadoutId, AiRule, CreatorAi } from "../types/creator-ai";
import type { CreatorMission, CreatorRaid } from "../types/missions";
import type { Pet, PetJutsu, PetRarity } from "../types/pet";
import type { MissionRank } from "../constants/hunter";
import { DUNGEON_LEGENDARY_FRAGMENT_ID, HOLLOW_GATE_KEY_ID, MAX_LEVEL, PLAYER_ACCOUNTS_STORAGE, STORAGE, VEIL_OF_THE_HOLLOW_ID } from "../constants/game";
import { AdminPasswordReset, AdminClearAuthLock } from "./AdminLogin";
import { ModerationPanel } from "./ModerationPanel";
import { AdminDiagnosticsPanel } from "./AdminDiagnosticsPanel";
import { AiImagePrompt } from "../components/AiImagePrompt";
import { gameConfirm } from "../components/GameAlert";
import { JutsuDropdownList } from "../components/JutsuDropdownList";
import { KenneyAtlasPicker } from "../components/KenneyAtlasPicker";
import { TagPicker } from "../components/TagPicker";
import { TriggeredVisualNovel } from "../components/TriggeredVisualNovel";
import { VnDialogueEditor } from "../components/VnDialogueEditor";
import { biomeForWorldSector, villages, worldSectorOptions } from "../data/sectors";
import { jutsuElements, jutsuMethods, jutsuTargets, rebalanceNonBloodlineJutsu, specialties, starterJutsus, starterSavedBloodlines } from "../data/jutsu";
import { auraSphereLv9VnEvent, awakeningLv2VnEvent, craftDungeonEvents, hiddenDungeonVnEvent } from "../data/vn-events";
import { getAllTileCards, shinobiTileCards, type TileCard } from "../data/tile-cards";
import { mergeBuiltinMissions, missionRaidRequirement } from "../data/missions";
import { petRarityOrder } from "../data/pet-config";
import { isWildSpawnable } from "../lib/pet-balance";
import { PRIMARY_SUBROLE, type PetRole } from "../lib/pet-roles";
import { storylines } from "../data/storylines";
import { starterItems } from "../data/starter-items";
import { aiHpForLevel, aiStatsForLevel } from "../lib/ai-stats";
import { addToAllStats, baseStats, capStat, maxChakraForLevel, maxHpForLevel, maxStaminaForLevel, reconcileCharacterStatBudget } from "../lib/stats";
import { armorQualityTiers, equipmentSlotLabel, itemSectionOptions } from "../lib/equipment";
import { addItem, removeItem, countItem } from "../lib/inventory";
import { compactImage, compressDataUrl, publishSharedImage, readImageFile } from "../lib/shared-images";
import { deletedItemMarker, getAllItems } from "../lib/items";
import { describeJutsuEffects } from "../lib/jutsu-effects";
import { analyzeVnFlow } from "../lib/vn";
import { firstCurrencyReward, rewardCurrencyOptions, rewardSummary, singleCurrencyReward } from "../lib/currency";
import { jutsuPoints } from "../lib/jutsu-points";
import { clampNumber, makeId } from "../lib/utils";
import { normalizeJutsu } from "../lib/jutsu";
import { normalizeJutsuTags, percentageTags } from "../lib/tags";
import { petDisplayName } from "../lib/pet";
import { rankTitleForLevel } from "../lib/character-progress";
import { aiJutsuLoadout, aiLoadoutFromJutsus, aiLoadoutLabels, blankAiRule, buildBasicCombatAiRules, builtinAis, normalizeAiProfile, starterAiProfile } from "../lib/combat-ai";
import {
    HOLLOW_GATE_BOSS_FLOOR_REWARD_MULT,
    HOLLOW_GATE_KEY_DUNGEON_KEY_COST,
    HOLLOW_GATE_KEY_FATE_SHARD_COST,
    HOLLOW_GATE_THREAT_AMBUSH,
    HOLLOW_GATE_THREAT_PER_STEP,
    HOLLOW_GATE_TRAP_DMG_PCT,
    HOLLOW_GATE_UNLOCK_COST,
    setHollowGateBossFloorRewardMult,
    setHollowGateKeyDungeonKeyCost,
    setHollowGateKeyFateShardCost,
    setHollowGateThreatAmbush,
    setHollowGateThreatPerStep,
    setHollowGateTrapDmgPct,
    setHollowGateUnlockCost,
    adminIconOptions,
    createCharacter,
    defaultAncientChestVn,
    defaultPetEncounterVn,
    getAllJutsus,
    loadVillageLeadershipImages,
    normalizeVillageLeadershipImages,
    saveVillageLeadershipImages,
    storyToCreatorEvent,
    stringifyServerSavePayload,
    villageLeadership,
    type CreatorEvent,
    type VillageLeadershipImages,
} from "../App";
import { HOLLOW_GATE_MAX_FLOOR, setHollowGateMaxFloor } from "../constants/game";
import { persistSharedGameState, setSharedWeeklyBossAiId, sharedWeeklyBossAiIdCache } from "../lib/world-state";

export function AdminPanel({
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
    ancientChestVn,
    setAncientChestVn,
    editablePets,
    setEditablePets,
    selectedPetId,
    setSelectedPetId,
    currentSector,
    creatorItems,
    setCreatorItems,
    savedBloodlines,
    setSavedBloodlines,
    setAdminLoggedIn,
    setScreen,
    onSave,
    onReloadImages,
    onEditBloodline,
    onTestHollowGate,
    onHollowGateForceUnlock,
    onHollowGateResetIntro,
    onHollowGateClearRun,
    onHollowGateGrantKey,
    hollowGateVillageUnlocked,
    playerRoster,
    allServerPlayers,
    adminPw,
    adminRole,
    sharedImages,
    setSharedImages,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    creatorJutsus: Jutsu[];
    setCreatorJutsus: (jutsus: Jutsu[]) => void;
    creatorAis: CreatorAi[];
    setCreatorAis: (ais: CreatorAi[]) => void;
    creatorEvents: CreatorEvent[];
    setCreatorEvents: React.Dispatch<React.SetStateAction<CreatorEvent[]>>;
    creatorMissions: CreatorMission[];
    setCreatorMissions: (missions: CreatorMission[]) => void;
    creatorRaids: CreatorRaid[];
    setCreatorRaids: (raids: CreatorRaid[]) => void;
    creatorCards: TileCard[];
    setCreatorCards: (cards: TileCard[]) => void;
    petEncounterVn: CreatorEvent;
    setPetEncounterVn: (vn: CreatorEvent) => void;
    ancientChestVn: CreatorEvent;
    setAncientChestVn: (vn: CreatorEvent) => void;
    editablePets: Pet[];
    currentSector: number;
    setEditablePets: (pets: Pet[]) => void;
    selectedPetId: string;
    setSelectedPetId: (id: string) => void;
    creatorItems: GameItem[];
    setCreatorItems: (items: GameItem[]) => void;
    savedBloodlines: SavedBloodline[];
    setSavedBloodlines: React.Dispatch<React.SetStateAction<SavedBloodline[]>>;
    setAdminLoggedIn: (value: boolean) => void;
    setScreen: (screen: Screen) => void;
    onSave: () => Promise<void>;
    onReloadImages?: () => void;
    onEditBloodline?: (bloodline: SavedBloodline) => void;
    onTestHollowGate?: () => void;
    onHollowGateForceUnlock?: (unlock: boolean) => void;
    onHollowGateResetIntro?: () => void;
    onHollowGateClearRun?: () => void;
    onHollowGateGrantKey?: () => void;
    hollowGateVillageUnlocked?: boolean;
    playerRoster: PlayerRecord[];
    allServerPlayers: ServerPlayerSummary[];
    adminPw: string;
    adminRole: AdminRole;
    sharedImages: Record<string, string>;
    setSharedImages: Dispatch<SetStateAction<Record<string, string>>>;
}) {
    // Always-fresh ref to onSave so async callbacks don't capture a stale closure
    const onSaveRef = useRef(onSave);
    useEffect(() => { onSaveRef.current = onSave; });

    const [editingJutsuId, setEditingJutsuId] = useState("");
    const [jutsuName, setJutsuName] = useState("Admin Flame Burst");
    const [jutsuGenStatus, setJutsuGenStatus] = useState("");
    const [jutsuIsGenerating, setJutsuIsGenerating] = useState(false);
    const [petGenStatus, setPetGenStatus] = useState("");
    const [petIsGenerating, setPetIsGenerating] = useState(false);
    // Pinned pet avatars (key `pet:<id>` → inline data URL). The display prefers
    // these over editablePets/sharedImages, so a just-changed avatar can never be
    // reverted by a background image refetch (hydrateImages), a snapshot restore,
    // or the game-state poll — all of which serve the 5-min-cached /api/img
    // reference URL (the cause of avatars "reverting"). PERSISTED to localStorage
    // because the pet/jutsu Save remounts this panel, which would otherwise wipe
    // the in-memory pin and let the cached image reappear; localStorage survives
    // the remount AND a full page reload. Set on every change + by Force-Save.
    const [pinnedAvatars, setPinnedAvatars] = useState<Record<string, string>>(() => {
        try { return JSON.parse(localStorage.getItem("shinobix:pinnedPetAvatars") || "{}") as Record<string, string>; } catch { return {}; }
    });
    function pinAvatar(key: string, dataUrl: string) {
        setPinnedAvatars((prev) => {
            const next = { ...prev, [key]: dataUrl };
            try { localStorage.setItem("shinobix:pinnedPetAvatars", JSON.stringify(next)); } catch { /* quota exceeded — ignore */ }
            return next;
        });
    }
    function unpinAvatar(key: string) {
        setPinnedAvatars((prev) => {
            const next = { ...prev }; delete next[key];
            try { localStorage.setItem("shinobix:pinnedPetAvatars", JSON.stringify(next)); } catch { /* ignore */ }
            return next;
        });
    }
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
    const [tag2, setTag2] = useState("Ignition");
    const [tag2Percent, setTag2Percent] = useState(25);
    const [tag3, setTag3] = useState("");
    const [tag3Percent, setTag3Percent] = useState(30);
    const [tag4, setTag4] = useState("");
    const [tag4Percent, setTag4Percent] = useState(30);
    const [jutsuDescription, setJutsuDescription] = useState("");
    const [jutsuImage, setJutsuImage] = useState("");
    // Holds the in-flight jutsu-image compression promise (resolves to the
    // finished image). Create/Save await this so a click made BEFORE the upload
    // finishes still saves the picture instead of publishing an empty string.
    // Cleared the moment the upload settles, so a deliberate (already-previewed)
    // save stays fully synchronous.
    const jutsuImagePendingRef = useRef<Promise<string> | null>(null);
    const [itemName, setItemName] = useState("Iron Katana");
    const [itemSlot, setItemSlot] = useState<EquipmentSlot>("hand");
    const [itemRarity, setItemRarity] = useState<GameItem["rarity"]>("common");
    const [itemCost, setItemCost] = useState(100);
    const [itemDescription, setItemDescription] = useState("A custom admin-created item.");
    const [itemBonusStat, setItemBonusStat] = useState<keyof Stats>("strength");
    const [itemBonusAmount, setItemBonusAmount] = useState(25);
    const [itemArmorQuality, setItemArmorQuality] = useState<ArmorQuality | "">("");
    const [itemImage, setItemImage] = useState("");
    const [itemFlavorText, setItemFlavorText] = useState("");
    const [editingItemId, setEditingItemId] = useState("");
    const [itemWeaponElement, setItemWeaponElement] = useState<JutsuElement | "">("");
    const [itemWeaponRange, setItemWeaponRange] = useState<number | "">("");
    const [itemWeaponCooldown, setItemWeaponCooldown] = useState<number | "">("");
    const [itemWeaponEp, setItemWeaponEp] = useState<number | "">("");
    const [itemWeaponEffect, setItemWeaponEffect] = useState<GameItem["weaponEffect"] | "">("");
    const [itemWeaponEffectValue, setItemWeaponEffectValue] = useState<number | "">("");
    const isArmorSlot = ["head", "body", "armor", "waist", "legs", "feet", "gloves"].includes(itemSlot);
    const isWeaponSlot = ["hand", "weapon", "thrown"].includes(itemSlot);

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
        const existing = id ? getAllItems(creatorItems).find((i) => i.id === id) : null;
        const mergedBonuses = existing
            ? { ...existing.bonuses, [itemBonusStat]: Number(itemBonusAmount) }
            : { [itemBonusStat]: Number(itemBonusAmount) };
        return {
            // Start from the existing item so fields the form doesn't expose
            // (weaponTags, levelReq, restoreChakra, etc.) survive an edit instead
            // of being silently dropped. The form fields below override it.
            ...(existing ?? {}),
            id: id ?? `item-${makeId()}`,
            name: itemName,
            slot: itemSlot,
            rarity: itemRarity,
            cost: Number(itemCost),
            description: itemDescription,
            flavorText: itemFlavorText.trim() || undefined,
            ...(isArmorSlot && itemArmorQuality ? { armorQuality: itemArmorQuality } : {}),
            ...(itemImage ? { image: itemImage } : {}),
            ...(isWeaponSlot && itemWeaponElement ? { weaponElement: itemWeaponElement as JutsuElement } : {}),
            ...(isWeaponSlot && itemWeaponRange !== "" ? { weaponRange: Number(itemWeaponRange) } : {}),
            ...(isWeaponSlot && itemWeaponCooldown !== "" ? { weaponCooldown: Number(itemWeaponCooldown) } : {}),
            ...(isWeaponSlot && itemWeaponEp !== "" ? { weaponEp: Number(itemWeaponEp) } : {}),
            ...(isWeaponSlot && itemWeaponEffect ? { weaponEffect: itemWeaponEffect as GameItem["weaponEffect"] } : {}),
            ...(isWeaponSlot && itemWeaponEffectValue !== "" ? { weaponEffectValue: Number(itemWeaponEffectValue) } : {}),
            bonuses: mergedBonuses,
        };
    }

    function loadAdminItem(item: GameItem) {
        setEditingItemId(item.id);
        setItemName(item.name);
        setItemSlot(item.slot);
        setItemRarity(item.rarity);
        setItemCost(item.cost);
        setItemDescription(item.description);
        setItemFlavorText(item.flavorText ?? "");
        setItemArmorQuality(item.armorQuality ?? "");
        setItemImage(item.image ?? "");
        setItemWeaponElement(item.weaponElement ?? "");
        setItemWeaponRange(item.weaponRange ?? "");
        setItemWeaponCooldown(item.weaponCooldown ?? "");
        setItemWeaponEp(item.weaponEp ?? "");
        setItemWeaponEffect(item.weaponEffect ?? "");
        setItemWeaponEffectValue(item.weaponEffectValue ?? "");
        const firstBonus = Object.entries(item.bonuses).find(([, v]) => v !== undefined && (v as number) !== 0);
        if (firstBonus) {
            setItemBonusStat(firstBonus[0] as keyof Stats);
            setItemBonusAmount(firstBonus[1] as number);
        } else {
            setItemBonusStat("strength");
            setItemBonusAmount(0);
        }
    }

    function applyItemImage(rawImage: string) {
        void compactImage(rawImage).then((image) => {
            setItemImage(image);
            publishSharedImage('item:' + editingItemId, image);
            if (!editingItemId) return;
            const isCreator = creatorItems.some((i) => i.id === editingItemId);
            if (isCreator) {
                setCreatorItems(creatorItems.map((i) => i.id === editingItemId ? { ...i, image } : i));
            } else {
                // starter item override: create override entry with image
                const base = [...starterItems, ...creatorItems].find((i) => i.id === editingItemId);
                if (base) setCreatorItems([...creatorItems, { ...base, image }]);
            }
        });
    }

    function saveAdminItemEdit() {
        const updated = itemFromForm(editingItemId);
        if (updated.image) void publishSharedImage('item:' + updated.id, updated.image);
        const isCreator = creatorItems.some((i) => i.id === editingItemId);
        if (isCreator) {
            setCreatorItems(creatorItems.map((i) => i.id === editingItemId ? updated : i));
        } else {
            setCreatorItems([...creatorItems, updated]);
        }
        setEditingItemId("");
        alert(`${updated.name} saved.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    function createAdminItem() {
        if (editingItemId) { saveAdminItemEdit(); return; }
        const newItem = itemFromForm();
        if (newItem.image) void publishSharedImage('item:' + newItem.id, newItem.image);
        setCreatorItems([...creatorItems, newItem]);
        alert(`${newItem.name} created.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    async function deleteAdminItem(item: GameItem) {
        if (!(await gameConfirm(`Delete ${item.name} from the shop and game?`, { danger: true, confirmLabel: "Delete" }))) return;
        const starterItem = starterItems.some((starter) => starter.id === item.id);
        const nextItems = creatorItems.filter((existing) => existing.id !== item.id);
        setCreatorItems(starterItem ? [...nextItems, deletedItemMarker(item.id)] : nextItems);
        if (editingItemId === item.id) setEditingItemId("");
        setItemBulkSelections((ids) => ids.filter((id) => id !== item.id));
        updateCharacter({
            // Drain every copy of this item from BOTH stores (inventory[] + itemStacks).
            ...removeItem(character, item.id, Number.MAX_SAFE_INTEGER),
            equipment: Object.fromEntries(
                Object.entries(character.equipment).map(([slot, id]) => [slot, id === item.id ? "" : id])
            ) as Character["equipment"],
        });
        alert(`${item.name} deleted from the shop and game.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
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
                const autoPrompt = `${item.name} ${item.rarity} ${slotLabel} shinobi RPG equipment game art`;
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
                publishSharedImage('item:' + item.id, image);
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
    const [cardTop, setCardTop] = useState(25);
    const [cardRight, setCardRight] = useState(25);
    const [cardBottom, setCardBottom] = useState(25);
    const [cardLeft, setCardLeft] = useState(25);
    const [cardElement, setCardElement] = useState("None");
    const [cardRarity, setCardRarity] = useState<TileCard["rarity"]>("common");
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

    // AI bulk image generation (separate state from card bulk)
    const [aiBulkSelections, setAiBulkSelections] = useState<string[]>([]);
    const [aiBulkRunning, setAiBulkRunning] = useState(false);
    const [aiBulkProgress, setAiBulkProgress] = useState<{ current: number; total: number; aiName: string } | null>(null);
    const [aiBulkErrors, setAiBulkErrors] = useState<{ id: string; name: string; error: string }[]>([]);
    // Bulk AI image gen state for the Relic Dungeons admin tab (4 slots
    // × 5 dungeons = 20 possible slots). Both per-dungeon and master
    // generators share these so the disabled/progress state is global —
    // can't kick off two batches at once.
    const [dungeonImgBulkRunning, setDungeonImgBulkRunning] = useState(false);
    const [dungeonImgBulkProgress, setDungeonImgBulkProgress] = useState<{ current: number; total: number; label: string } | null>(null);
    const [aiBulkSkipExisting, setAiBulkSkipExisting] = useState(true);
    const [aiBulkShowSection, setAiBulkShowSection] = useState(false);
    const [aiBulkCustomPrompts, setAiBulkCustomPrompts] = useState<Record<string, string>>({});

    function cardFromForm(id?: string): TileCard {
        // Clamp edges to the 1–99 two-digit range the card game uses, so a
        // blank, negative, or oversized input can't save a card that renders or
        // compares wrong. Built-in cards (values 15–99) are unaffected.
        const edge = (v: number) => clampNumber(Number.isFinite(v) ? Math.floor(v) : 1, 1, 99);
        return { id: id ?? `card-${makeId()}`, name: cardName.trim() || "New Card", top: edge(cardTop), right: edge(cardRight), bottom: edge(cardBottom), left: edge(cardLeft), element: cardElement, rarity: cardRarity, description: cardDescription, ...(cardImage ? { image: cardImage } : {}) };
    }

    function loadAdminCard(card: TileCard) {
        setEditingCardId(card.id);
        setCardName(card.name);
        setCardTop(card.top);
        setCardRight(card.right);
        setCardBottom(card.bottom);
        setCardLeft(card.left);
        setCardElement(card.element);
        setCardRarity(card.rarity);
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
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    function createAdminCard() {
        if (editingCardId) { saveAdminCardEdit(); return; }
        const newCard = cardFromForm();
        setCreatorCards([...creatorCards, newCard]);
        alert(`${newCard.name} created.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    async function generateCardImageRaw(prompt: string): Promise<string> {
        const response = await fetch("/api/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, label: "Card Image" }),
        });
        const rawText = await response.text();
        let data: Record<string, unknown>;
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
                publishSharedImage('card:' + card.id, image);
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

    async function runBulkAiGeneration() {
        const toProcess = aiBulkSelections
            .map(id => allAdminAis.find(a => a.id === id))
            .filter(Boolean) as CreatorAi[];
        if (toProcess.length === 0) { alert("No AIs selected."); return; }

        setAiBulkRunning(true);
        setAiBulkErrors([]);
        const errors: { id: string; name: string; error: string }[] = [];

        // Track live state locally (mirrors runBulkGeneration's "live" pattern)
        // so each iteration builds on the previous and onSave sees the final state.
        let liveAis = [...creatorAis];

        for (let i = 0; i < toProcess.length; i++) {
            const ai = toProcess[i];
            setAiBulkProgress({ current: i + 1, total: toProcess.length, aiName: ai.name });
            try {
                const customPrompt = aiBulkCustomPrompts[ai.id]?.trim();
                const autoPrompt = `${ai.name}, ${ai.village || "shinobi"} arena opponent portrait, ninja character art`;
                const response = await fetch("/api/generate-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: customPrompt || autoPrompt, label: "AI Portrait" }),
                });
                const rawText = await response.text();
                let data: Record<string, unknown>;
                try { data = rawText ? JSON.parse(rawText) : {}; } catch { throw new Error(`Server error ${response.status}`); }
                if (!response.ok) throw new Error((data.error as string) || `Status ${response.status}`);
                if (!data.image) throw new Error("No image returned.");
                const image = await compressDataUrl(data.image as string, 512, 0.82);

                // Update local array — if AI is already in creatorAis update it, else add override
                if (liveAis.some(a => a.id === ai.id)) {
                    liveAis = liveAis.map(a => a.id === ai.id ? { ...a, image } : a);
                } else {
                    liveAis = [...liveAis, { ...ai, image }];
                }
                // Push updated array to React state so UI refreshes after each AI
                setCreatorAis(liveAis);
                // Persist to shared KV (all players see the image on next load)
                await publishSharedImage('ai:' + ai.id, image);
            } catch (err) {
                errors.push({ id: ai.id, name: ai.name, error: err instanceof Error ? err.message : "Failed" });
            }
        }

        setAiBulkErrors(errors);
        setAiBulkProgress(null);
        setAiBulkRunning(false);
        setAiBulkSelections([]);
        // onSaveRef.current now closes over the updated creatorAis via re-renders
        try { await onSaveRef.current(); } catch { /* ignore if no account */ }
    }

    const [previewVn, setPreviewVn] = useState<CreatorEvent | null>(null);
    const [previewVnPage, setPreviewVnPage] = useState(0);
    const [previewVnLine, setPreviewVnLine] = useState(0);
    // Reusable VN cast — a per-admin palette of characters (name + small portrait)
    // kept in localStorage so the same character can be dropped onto any page or
    // any VN without re-typing/re-uploading. Editor-only: picking one just fills
    // the per-page leftName/leftImage/rightName/rightImage fields the renderer
    // already reads, so storage + playback are unchanged.
    const [vnCast, setVnCast] = useState<{ name: string; image: string }[]>(() => {
        try {
            const v = JSON.parse(localStorage.getItem("shinobix:vnCast") || "[]");
            return Array.isArray(v) ? v.filter((m) => m && typeof m.name === "string").map((m) => ({ name: m.name, image: typeof m.image === "string" ? m.image : "" })) : [];
        } catch { return []; }
    });
    function saveVnCast(next: { name: string; image: string }[]) {
        setVnCast(next);
        try { localStorage.setItem("shinobix:vnCast", JSON.stringify(next)); } catch { /* quota or storage disabled — keep in-memory */ }
    }
    function addToCast(name?: string, image?: string) {
        const n = (name ?? "").trim();
        if (!n) { alert("Give the character a name first, then save it to the cast."); return; }
        saveVnCast([...vnCast.filter((m) => m.name.toLowerCase() !== n.toLowerCase()), { name: n, image: image ?? "" }]);
    }

    const [eventName, setEventName] = useState("Admin World Event");
    const [editingEventId, setEditingEventId] = useState("");
    const [eventKind, setEventKind] = useState<"reward" | "visualNovel">("visualNovel");
    const [eventTrigger, setEventTrigger] = useState<"" | "manual" | "firstBattleArena" | "firstLeaveVillage">("");
    const [eventBiome, setEventBiome] = useState<Biome>("central");
    const [eventTargetSector, setEventTargetSector] = useState(56);
    const [eventVnTitle, setEventVnTitle] = useState("A Stranger at the Gate");
    const [eventVnScene, setEventVnScene] = useState("Rain taps against the village rooftops while an unknown shinobi waits beneath the lanterns.");
    const [eventVnSpeaker, setEventVnSpeaker] = useState("Unknown Shinobi");
    const [eventImage, setEventImage] = useState("");
    const [eventAvatarImage, setEventAvatarImage] = useState("");
    const [eventAiProfileId, setEventAiProfileId] = useState("");
    const [eventPageCount, setEventPageCount] = useState(1);
    const [eventVnPages, setEventVnPages] = useState(Array.from({ length: 10 }, (_, index) => ({
        title: index === 0 ? "A Stranger at the Gate" : `Story Page ${index + 1}`,
        scene: index === 0 ? "Rain taps against the village rooftops while an unknown shinobi waits beneath the lanterns." : "",
        speaker: index === 0 ? "Unknown Shinobi" : "Narrator",
        dialogue: index === 0 ? "Unknown Shinobi: You are late.\nUnknown Shinobi: The first seal has already broken." : "",
        image: "",
        leftName: "Player",
        leftImage: "",
        rightName: index === 0 ? "Unknown Shinobi" : "Narrator",
        rightImage: "",
        choices: [] as NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>,
    })));
    const [eventIcon, setEventIcon] = useState("⭐");
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
    const [missionRaidCount, setMissionRaidCount] = useState(0);
    const [missionLevelReq, setMissionLevelReq] = useState(1);
    const [missionXp, setMissionXp] = useState(50);
    const [missionRyo, setMissionRyo] = useState(35);
    const [missionStamina, setMissionStamina] = useState(5);
    const [missionRewardCurrency, setMissionRewardCurrency] = useState<RewardCurrencyKey>("fateShards");
    const [missionRewardCurrencyAmount, setMissionRewardCurrencyAmount] = useState(0);
    const [missionRankFilter, setMissionRankFilter] = useState<"All" | MissionRank>("All");
    const [editingRaidId, setEditingRaidId] = useState("");
    const [raidName, setRaidName] = useState("Shadow Boss Raid");
    const [_raidBiome, setRaidBiome] = useState<Biome>("shadow");
    const [raidTargetSector, setRaidTargetSector] = useState(8);
    const [raidIcon, setRaidIcon] = useState("⚔");
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
    const [editingBloodlineOwnerKey, setEditingBloodlineOwnerKey] = useState("");
    const [bloodlineEditName, setBloodlineEditName] = useState("");
    const [bloodlineEditRank, setBloodlineEditRank] = useState<Rank>("A Rank");
    const [bloodlineEditElement, setBloodlineEditElement] = useState("");
    const [bloodlineEditImage, setBloodlineEditImage] = useState("");
    const [bloodlineEditLore, setBloodlineEditLore] = useState("");
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
    const [aiIsBoss, setAiIsBoss] = useState(false);
    // Admin toggle — when true, this AI uses the smart battle AI (lethal
    // detection, DoT-aware KO, full jutsu pool, multi-axis scoring)
    // regardless of its level. Useful for low-level "elite" mobs that
    // should fight smart without bumping their level.
    const [aiMasterAi, setAiMasterAi] = useState(false);
    const [adminWeeklyBossAiId, setAdminWeeklyBossAiId] = useState("");
    const [aiLevel, setAiLevel] = useState(10);
    const [aiVillage, setAiVillage] = useState("Admin Arena");
    const [aiHp, setAiHp] = useState(1200);
    const [aiChakra, setAiChakra] = useState(700);
    const [aiStamina, setAiStamina] = useState(700);
    const [aiStats, setAiStats] = useState<Stats>(addToAllStats(baseStats(), 60));
    const [aiLoadoutId, setAiLoadoutId] = useState<AiLoadoutId>("balanced");
    const [aiJutsuIds, setAiJutsuIds] = useState<string[]>(starterJutsus.slice(0, 4).map((jutsu) => jutsu.id));
    const [aiRules, setAiRules] = useState<AiRule[]>(starterAiProfile(starterJutsus).rules);
    const [selectedAiId, setSelectedAiId] = useState("");
    // Admin-only filter text for the long content pickers (additive UI; no
    // effect on saved data or gameplay). Narrows the list as you type.
    const [aiFindQuery, setAiFindQuery] = useState("");
    const [itemLibQuery, setItemLibQuery] = useState("");
    const [cardLibQuery, setCardLibQuery] = useState("");
    // Tabs Admin 2 (content role) is NOT allowed to access. Hidden from the
    // tab switcher AND clamped at state level so a refresh / stale session-
    // storage / manual setState can't slip them in. Server-side, the
    // matching endpoints (admin/players, admin/moderation, admin/server-reset,
    // admin/migrate-kv, game-state arenaTournament/weeklyBossOverride) gate
    // on isFullAdmin — so even if a content admin somehow landed on these
    // tabs, the underlying actions would 401.
    const CONTENT_ADMIN_FORBIDDEN_TABS = new Set<string>(['playerManagement', 'hollowGate', 'relicDungeons', 'moderation']);
    const [activeAdminPanel, setActiveAdminPanel] = useState<"jutsuBloodlines" | "eventsRaids" | "visualNovels" | "aiCreator" | "petEditor" | "cardEditor" | "villageLeaders" | "playerManagement" | "hollowGate" | "relicDungeons" | "professions" | "moderation" | "diagnostics">("jutsuBloodlines");
    // Clamp the active tab whenever the role flips OR a refresh restored
    // a forbidden tab from React's initial state.
    useEffect(() => {
        if (adminRole === 'content' && CONTENT_ADMIN_FORBIDDEN_TABS.has(activeAdminPanel)) {
            setActiveAdminPanel('jutsuBloodlines');
        }
    }, [adminRole, activeAdminPanel]);

    // Hollow Gate admin tab state — prompts, current preview images, busy/status
    // strings. Preview images are seeded from the existing shared KV on first
    // tab open so we don't blank existing art on every render.
    const [hollowGateAssetPrompts, setHollowGateAssetPrompts] = useState<Record<string, string>>({});
    const [hollowGateAssetImages, setHollowGateAssetImages] = useState<Record<string, string>>({});
    const [hollowGateAssetBusy, setHollowGateAssetBusy] = useState<string>("");
    const [hollowGateAssetStatus, setHollowGateAssetStatus] = useState<string>("");

    useEffect(() => {
        if (activeAdminPanel !== "hollowGate") return;
        // Seed current images from the shared image store so previews show up
        // when the tab is opened. /api/images supports `?cat=<category>` (returns
        // a {id: image} map) — NOT `?id=<key>`. We load the four categories the
        // Hollow Gate assets live under and pick the relevant keys.
        const keys = new Set<string>([
            "item:" + HOLLOW_GATE_KEY_ID,
            "item:" + DUNGEON_LEGENDARY_FRAGMENT_ID,
            "item:" + VEIL_OF_THE_HOLLOW_ID,
            "ai:boss-hollow-gate-warden",
            "landmark:hollow-gate",
            "shrine:hollow-gate-background",
            "shrine:hidden-chamber-background",
            "shrine:tile-sealed-door",
            "shrine:tile-trap",
            "shrine:tile-ancient-chest",
            "shrine:tile-pet-encounter",
            "shrine:tile-corrupted-shinobi",
            "shrine:tile-shrine-keeper",
            "shrine:tile-wall",
            "shrine:tile-room-floor",
            "shrine:tile-corridor-floor",
            "shrine:tile-door",
            "shrine:tile-story",
            "shrine:intro-1",
            "shrine:intro-2",
            "shrine:intro-3",
        ]);
        const categories = ["item", "ai", "landmark", "shrine"];
        let cancelled = false;
        (async () => {
            const next: Record<string, string> = {};
            for (const cat of categories) {
                try {
                    const res = await fetch(`/api/images?cat=${encodeURIComponent(cat)}`);
                    if (!res.ok) continue;
                    const data = await res.json() as Record<string, string>;
                    for (const [id, image] of Object.entries(data)) {
                        if (keys.has(id) && typeof image === "string" && image) next[id] = image;
                    }
                } catch { /* ignore individual fetch errors */ }
            }
            if (!cancelled) setHollowGateAssetImages(prev => ({ ...next, ...prev }));
        })();
        return () => { cancelled = true; };
    }, [activeAdminPanel]);

    // --- Player Management tab state ---
    const [pmTargetName, setPmTargetName] = useState("");
    const [pmSnap, setPmSnap] = useState<Record<string, unknown> | null>(null);
    const [pmMsg, setPmMsg] = useState("");
    const [allKnownPlayers, setAllKnownPlayers] = useState<{ name: string; level: number; village: string; online: boolean }[]>([]);
    const [pendingPlayerBloodlines, setPendingPlayerBloodlines] = useState<ReviewBloodline[]>([]);
    const [serverResetMsg, setServerResetMsg] = useState("");
    // Ranked seasons (admin start / force-rollover). Seasons do NOT auto-start.
    const [rankedSeasonMsg, setRankedSeasonMsg] = useState("");
    const [rankedSeasonActive, setRankedSeasonActive] = useState<boolean | null>(null);
    const [rankedSeasonId, setRankedSeasonId] = useState<number | null>(null);
    useEffect(() => { if (adminPw) void loadRankedSeasonStatus(); }, [adminPw]);
    const [kageResetVillage, setKageResetVillage] = useState(villages[0]);
    const [kageResetMsg, setKageResetMsg] = useState("");
    const [approvedItemIds, setApprovedItemIds] = useState<string[]>([]);
    const [approvedBloodlineIds, setApprovedBloodlineIds] = useState<string[]>([]);

    // Fetch all server-saved players (registry + presence). Full admin only —
    // Admin 2 can't access this endpoint (server-side isFullAdmin gate). The
    // client also avoids calling it when role is content; the jutsuBloodlines
    // tab falls back to /api/bloodlines/list for the bloodline gallery.
    function fetchAllKnownPlayers() {
        if (!adminPw) return;
        if (adminRole !== 'full') return;
        fetch('/api/admin/players', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
            body: JSON.stringify({}),
        })
            .then(r => r.ok ? r.json() : null)
            .then((data: { players: { name: string; level: number; village: string; online: boolean }[]; bloodlines?: ReviewBloodline[]; approvedBloodlines?: string[] } | null) => {
                if (data?.players) setAllKnownPlayers(data.players);
                if (data?.approvedBloodlines) {
                    setApprovedBloodlineIds(data.approvedBloodlines);
                }
                if (data?.bloodlines) {
                    setPendingPlayerBloodlines(data.bloodlines.map((bloodline) => ({
                        ...bloodline,
                        rank: bloodline.rank as Rank,
                        jutsus: (bloodline.jutsus ?? []).map(normalizeJutsu),
                    })));
                }
            })
            .catch(() => {/* silently ignore */});
    }

    // Auto-fetch wherever bloodlines/player review data is shown.
    useEffect(() => {
        if (activeAdminPanel !== "playerManagement" && activeAdminPanel !== "jutsuBloodlines") return;
        fetchAllKnownPlayers();
        // Content admin (Admin 2) is allowed to read the approved-items list
        // (they can curate items) — the server-side item-review endpoint
        // accepts either admin password via isAdmin().
        if (adminPw) {
            fetch('/api/admin/item-review', {
                method: 'GET',
                headers: { 'x-admin-password': adminPw },
            })
                .then(r => r.ok ? r.json() : null)
                .then((data: { approvedItems?: string[] } | null) => {
                    if (data?.approvedItems) setApprovedItemIds(data.approvedItems);
                })
                .catch(() => {});
        }
        // For content admin on the jutsu/bloodline tab, fetch the bloodline
        // gallery from /api/bloodlines/list since they can't hit
        // /api/admin/players. The endpoint returns the same shape (ownerName,
        // ownerKey, jutsus, etc.) — just without the player roster half.
        if (adminRole === 'content' && activeAdminPanel === 'jutsuBloodlines' && adminPw) {
            fetch('/api/bloodlines/list', {
                headers: { 'x-admin-password': adminPw },
            })
                .then(r => r.ok ? r.json() : null)
                .then((data: { bloodlines?: ReviewBloodline[] } | null) => {
                    if (data?.bloodlines) {
                        setPendingPlayerBloodlines(data.bloodlines.map((bloodline) => ({
                            ...bloodline,
                            rank: bloodline.rank as Rank,
                            jutsus: (bloodline.jutsus ?? []).map(normalizeJutsu),
                        })));
                    }
                })
                .catch(() => {});
        }
    }, [activeAdminPanel, adminPw, adminRole]);
    const [pmGivePetId, setPmGivePetId] = useState("");
    const [pmGiveAmounts, setPmGiveAmounts] = useState<Record<string, number>>({ honorSeals: 0, fateShards: 0, boneCharms: 0, auraStones: 0, auraDust: 0, mythicSeals: 0 });

    async function pmLookup() {
        if (!pmTargetName.trim()) return;
        setPmMsg("Looking up…");
        setPmSnap(null);
        try {
            const res = await fetch(`/api/save/${encodeURIComponent(pmTargetName.trim().toLowerCase())}`, {
                headers: adminPw ? { "x-admin-password": adminPw } : {},
            });
            if (res.status === 404) { setPmMsg("⚠️ No server save found for that name (player may use local-only save)."); return; }
            if (!res.ok) { setPmMsg(`❌ Server error ${res.status} — check the player name and try again.`); return; }
            let data: Record<string, unknown>;
            try { data = await res.json(); } catch { setPmMsg("❌ Save exists but response was not valid JSON."); return; }
            setPmSnap(data);
            setPmMsg(`✅ Loaded: ${pmTargetName.trim()}`);
        } catch { setPmMsg("❌ Network error — make sure you're on the deployed site, not local dev."); }
    }

    async function pmGive() {
        if (!pmSnap) { setPmMsg("Look up a player first."); return; }
        if (!adminPw) { setPmMsg("❌ Admin password missing. Log out and back into admin."); return; }
        // Summarize the grant and confirm before writing to the player's save.
        const giftParts: string[] = [];
        if (pmGivePetId) {
            const givePet = editablePets.find(p => p.id === pmGivePetId);
            if (givePet) giftParts.push(`pet: ${petDisplayName(givePet)}`);
        }
        for (const [giftKey, giftAmt] of Object.entries(pmGiveAmounts)) {
            if (giftAmt > 0) giftParts.push(`${giftAmt.toLocaleString()} ${giftKey}`);
        }
        if (giftParts.length === 0) { setPmMsg("Nothing to give — pick a pet or set an amount above 0."); return; }
        if (!(await gameConfirm(`Give ${pmTargetName.trim()}:\n• ${giftParts.join("\n• ")}\n\nThis writes to their save.`))) return;
        const char: Record<string, unknown> = { ...(pmSnap.character as Record<string, unknown>) };
        // Give pet
        if (pmGivePetId) {
            const pet = editablePets.find(p => p.id === pmGivePetId);
            const existing = (char.pets as unknown[] | undefined) ?? [];
            if (pet && existing.length < 5) {
                const cloned = { ...pet, id: `${pet.id}-${Date.now()}` };
                char.pets = [...existing, cloned];
            } else if (pet) {
                alert(`${pmTargetName} already has 5 pets. Cannot give another.`);
            }
        }
        // Give currencies
        for (const [key, amt] of Object.entries(pmGiveAmounts)) {
            if (amt > 0) char[key] = ((char[key] as number) ?? 0) + amt;
        }
        const updated = { ...pmSnap, character: char };
        try {
            const res = await fetch(`/api/save/${encodeURIComponent(pmTargetName.trim().toLowerCase())}?signal=1`, {
                method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": adminPw },
                body: stringifyServerSavePayload(updated),
            });
            if (!res.ok) {
                let detail = `HTTP ${res.status}`;
                try { const data = await res.json() as { error?: string }; if (data.error) detail = data.error; } catch { /* response body not JSON */ }
                setPmMsg(`❌ Save failed: ${detail}`);
                return;
            }
            setPmMsg("✅ Saved! Player will see changes on next login.");
            setPmSnap(updated);
            setPmGivePetId("");
            setPmGiveAmounts({ honorSeals: 0, fateShards: 0, boneCharms: 0, auraStones: 0, auraDust: 0, mythicSeals: 0 });
        } catch (err) { setPmMsg(`? Failed to save: ${String(err)}`); }
    }

    const [pmEditName, setPmEditName] = useState("");
    const [pmEditSnap, setPmEditSnap] = useState<Record<string, unknown> | null>(null);
    const [pmEditMsg, setPmEditMsg] = useState("");
    const [pmEditFields, setPmEditFields] = useState<Record<string, number>>({});

    async function pmEditLookup() {
        if (!pmEditName.trim()) return;
        setPmEditMsg("Loading…");
        setPmEditSnap(null);
        try {
            const res = await fetch(`/api/save/${encodeURIComponent(pmEditName.trim().toLowerCase())}`, {
                headers: adminPw ? { "x-admin-password": adminPw } : {},
            });
            if (res.status === 401) { setPmEditMsg("❌ Admin auth failed — log out and back in as admin."); return; }
            if (!res.ok) { setPmEditMsg("❌ Player not found."); return; }
            const data = await res.json() as Record<string, unknown>;
            const char = data.character as Record<string, unknown> ?? {};
            const stats = char.stats as Record<string, number> ?? {};
            setPmEditSnap(data);
            setPmEditFields({
                level: (char.level as number) ?? 1,
                xp: (char.xp as number) ?? 0,
                ryo: (char.ryo as number) ?? 0,
                unspentStats: (char.unspentStats as number) ?? 0,
                strength: stats.strength ?? 0,
                speed: stats.speed ?? 0,
                intelligence: stats.intelligence ?? 0,
                willpower: stats.willpower ?? 0,
                ninjutsuOffense: stats.ninjutsuOffense ?? 0,
                ninjutsuDefense: stats.ninjutsuDefense ?? 0,
                taijutsuOffense: stats.taijutsuOffense ?? 0,
                taijutsuDefense: stats.taijutsuDefense ?? 0,
                bukijutsuOffense: stats.bukijutsuOffense ?? 0,
                bukijutsuDefense: stats.bukijutsuDefense ?? 0,
                genjutsuOffense: stats.genjutsuOffense ?? 0,
                genjutsuDefense: stats.genjutsuDefense ?? 0,
            });
            setPmEditMsg(`✅ Loaded ${pmEditName.trim()}`);
        } catch { setPmEditMsg("❌ Network error."); }
    }

    async function pmEditPatch(updatedSnap: Record<string, unknown>) {
        setPmEditMsg("Saving…");
        if (!adminPw) { setPmEditMsg("❌ Admin password missing. Log out and back into admin."); return; }
        try {
            const res = await fetch(`/api/save/${encodeURIComponent(pmEditName.trim().toLowerCase())}?signal=1`, {
                method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": adminPw },
                body: stringifyServerSavePayload(updatedSnap),
            });
            if (!res.ok) {
                let detail = `HTTP ${res.status}`;
                try { const data = await res.json() as { error?: string }; if (data.error) detail = data.error; } catch { /* response body not JSON */ }
                setPmEditMsg(`❌ Save failed: ${detail}`);
                return;
            }
            setPmEditSnap(updatedSnap);
            setPmEditMsg("✅ Saved!");
            fetchAllKnownPlayers();
        } catch (err) { setPmEditMsg(`❌ Save failed: ${String(err)}`); }
    }

    async function pmEditSave() {
        if (!pmEditSnap) return;
        const char = { ...(pmEditSnap.character as Record<string, unknown> ?? {}) };
        const stats = { ...(char.stats as Record<string, number> ?? {}) };
        const statKeys = ["strength","speed","intelligence","willpower","ninjutsuOffense","ninjutsuDefense","taijutsuOffense","taijutsuDefense","bukijutsuOffense","bukijutsuDefense","genjutsuOffense","genjutsuDefense"];
        // Clamp every edited field to a legal range so a typo (level 999,
        // negative ryo, an emptied box → NaN) can't corrupt the player's save.
        const fin = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
        for (const key of statKeys) stats[key] = capStat(fin(pmEditFields[key], stats[key] ?? 0));
        char.level = clampNumber(Math.floor(fin(pmEditFields.level, (char.level as number) ?? 1)), 1, MAX_LEVEL);
        char.xp = Math.max(0, Math.floor(fin(pmEditFields.xp, 0)));
        char.ryo = Math.max(0, Math.floor(fin(pmEditFields.ryo, 0)));
        char.unspentStats = Math.max(0, Math.floor(fin(pmEditFields.unspentStats, 0)));
        char.stats = stats;
        const updated = { ...pmEditSnap, character: char };
        await pmEditPatch(updated);
    }

    async function pmSoftReset() {
        const name = pmTargetName.trim();
        if (!name) return;
        if (!(await gameConfirm(`Soft-reset ${name}? Their name, village, specialty, and bloodline are kept. Everything else goes back to level 1 defaults.`, { danger: true, confirmLabel: "Soft-reset" }))) return;
        if (!adminPw) { setPmMsg("❌ Admin password missing. Log out and back into admin."); return; }
        setPmMsg("Soft-resetting…");
        try {
            const res = await fetch(`/api/save/${encodeURIComponent(name.toLowerCase())}`);
            if (!res.ok) { setPmMsg("❌ Player not found."); return; }
            const existing = await res.json() as Record<string, unknown>;
            const char = (existing.character ?? {}) as Record<string, unknown>;
            const fresh = createCharacter(
                (char.name as string) || name,
                (char.village as string) || "",
                ((char.specialty as string) || "Ninjutsu") as JutsuType,
                (char.bloodline as string) || "None",
            );
            const freshSnap = { ...existing, character: fresh };
            const saveRes = await fetch(`/api/save/${encodeURIComponent(name.toLowerCase())}?signal=1`, {
                method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": adminPw },
                body: stringifyServerSavePayload(freshSnap),
            });
            if (!saveRes.ok) {
                let detail = `HTTP ${saveRes.status}`;
                try { const data = await saveRes.json() as { error?: string }; if (data.error) detail = data.error; } catch { /* response body not JSON */ }
                setPmMsg(`❌ Save failed: ${detail}`);
                return;
            }
            setPmSnap(null);
            setPmMsg(`? ${name} soft-reset to Lv 1. Village, specialty & bloodline preserved.`);
            fetchAllKnownPlayers();
        } catch (e) { setPmMsg(`? Error: ${String(e)}`); }
    }

    async function pmReset() {
        if (!pmTargetName.trim()) return;
        if (!(await gameConfirm(`Reset ${pmTargetName.trim()}'s account to level 1? This cannot be undone.`, { danger: true, confirmLabel: "Reset" }))) return;
        setPmMsg("⏳ Resetting…");
        try {
            const res = await fetch(`/api/save/${encodeURIComponent(pmTargetName.trim().toLowerCase())}`, {
                method: "DELETE",
                headers: { "x-admin-password": adminPw },
            });
            if (!res.ok) {
                let errDetail = `HTTP ${res.status}`;
                try { const d = await res.json() as { error?: string }; if (d.error) errDetail = d.error; } catch { /* no-op */ }
                setPmMsg(`❌ Reset failed: ${errDetail}`);
                return;
            }
            setPmSnap(null);
            setPmTargetName("");
            setPmMsg("✅ Account reset. Player starts fresh on next login.");
            fetchAllKnownPlayers();
        } catch (e) { setPmMsg(`❌ Reset failed: ${String(e)}`); }
    }

    async function loadRankedSeasonStatus() {
        try {
            const res = await fetch('/api/admin/ranked-season', { headers: { 'x-admin-password': adminPw } });
            const data = await res.json().catch(() => ({})) as { active?: boolean; current?: { id?: number } | null };
            setRankedSeasonActive(!!data.active);
            setRankedSeasonId(data.current?.id ?? null);
        } catch { /* ignore */ }
    }

    async function rankedSeasonAction(action: 'start' | 'rollover') {
        if (action === 'rollover' && !(await gameConfirm('Force-end the current ranked season NOW? This rewards the top finishers, archives standings, soft-resets every rating, and starts the next season immediately.', { danger: true, confirmLabel: "Force-end" }))) return;
        setRankedSeasonMsg('⏳ Working…');
        try {
            const res = await fetch('/api/admin/ranked-season', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
                body: JSON.stringify({ action }),
            });
            const data = await res.json().catch(() => ({})) as { ok?: boolean; action?: string; seasonId?: number; nextSeasonId?: number; playerChampion?: string; petChampion?: string; error?: string };
            if (!res.ok || !data.ok) { setRankedSeasonMsg(`❌ ${data.error ?? 'Failed.'}`); return; }
            if (data.action === 'initialized') setRankedSeasonMsg(`✅ Ranked Season ${data.seasonId} started.`);
            else if (data.action === 'skipped') setRankedSeasonMsg('ℹ️ A ranked season is already active.');
            else if (data.action === 'rolled-over') setRankedSeasonMsg(`✅ Season ${data.seasonId} ended (champion: ${data.playerChampion ?? '—'}, pet: ${data.petChampion ?? '—'}). Season ${data.nextSeasonId} started.`);
            else if (data.action === 'inactive') setRankedSeasonMsg('ℹ️ No active season — start one first.');
            else setRankedSeasonMsg(`✅ Done (${data.action}).`);
            void loadRankedSeasonStatus();
        } catch {
            setRankedSeasonMsg('❌ Network error.');
        }
    }

    async function serverReset() {
        if (!(await gameConfirm(
            "⚠️ FULL SERVER RESET ⚠️\n\nThis will:\n• Delete ALL player saves — everyone starts fresh at Level 1 and chooses their village again\n• Reset Kage seats and village war history for every village\n• Clear all clans, village chats, presence, PvP sessions, and challenge data\n• Wipe player passwords (players set a new one on next login)\n\nThis will NOT delete:\n• Admin-created content (jutsus, missions, AIs, events, pets, cards, visual novels)\n• Any uploaded images (kage portraits, elder portraits, pets, weapons, avatars)\n• Village Leaders tab configuration (names and images)\n\nThis CANNOT be undone. Are you absolutely sure?",
            { danger: true, confirmLabel: "Reset server" }
        ))) return;
        setServerResetMsg("⏳ Wiping server…");
        try {
            const res = await fetch('/api/admin/server-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
                body: JSON.stringify({}),
            });
            const data = await res.json() as { ok?: boolean; deletedCount?: number; error?: string };
            if (data.ok) {
                // Clear client-side village/war/territory state so the local cache
                // matches the fresh server. Preserve leadership images and admin session.
                const preserve = new Set([
                    STORAGE,
                ]);
                const toRemove: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (!key || preserve.has(key)) continue;
                    if (
                        key.startsWith("village-state-") ||
                        key.startsWith("shinobij-village-war-") ||
                        key.startsWith("shinobij-sector-territory-") ||
                        key === PLAYER_ACCOUNTS_STORAGE
                    ) {
                        toRemove.push(key);
                    }
                }
                toRemove.forEach(k => localStorage.removeItem(k));
                // Drop sessionStorage image-category caches so portraits re-fetch
                // fresh from the server's re-seeded shared:imgfields:misc bucket.
                try {
                    for (let i = sessionStorage.length - 1; i >= 0; i--) {
                        const key = sessionStorage.key(i);
                        if (!key) continue;
                        if (key.startsWith("imgcat:")) sessionStorage.removeItem(key);
                    }
                } catch { /* ignore */ }
                setAllKnownPlayers([]);
                setServerResetMsg(`✅ Server reset complete — ${data.deletedCount ?? 0} keys wiped. All images and admin content preserved. Players start fresh on next login.`);
            } else {
                setServerResetMsg(`❌ Reset failed: ${data.error ?? 'Unknown error'}`);
            }
        } catch {
            setServerResetMsg("❌ Network error during reset.");
        }
    }

    async function pmApproveItem(id: string) {
        const next = Array.from(new Set([...approvedItemIds, id]));
        setApprovedItemIds(next);
        try {
            const res = await fetch('/api/admin/item-review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
                body: JSON.stringify({ action: 'approve', itemId: id }),
            });
            const data = await res.json() as { approvedItems?: string[] };
            if (data.approvedItems) setApprovedItemIds(data.approvedItems);
        } catch {
            setPmMsg("⚠️ Item review state did not save to server.");
        }
    }

    function pmDeleteItem(id: string) {
        setCreatorItems(creatorItems.filter(i => i.id !== id));
        pmApproveItem(id); // also hide from review
    }

    function bloodlineReviewKey(bloodline: ReviewBloodline) {
        return `${bloodline.ownerKey ?? "admin"}:${bloodline.id}`;
    }

    async function saveBloodlineReviewAction(action: "approve" | "delete", bloodline: ReviewBloodline) {
        const res = await fetch('/api/admin/bloodline-review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
            body: JSON.stringify({
                action,
                ownerKey: bloodline.ownerKey ?? "admin",
                bloodlineId: bloodline.id,
            }),
        });
        if (!res.ok) throw new Error(`Review save failed: ${res.status}`);
        const data = await res.json() as { approvedBloodlines?: string[] };
        if (data.approvedBloodlines) {
            setApprovedBloodlineIds(data.approvedBloodlines);
        }
    }

    async function pmApproveBloodline(bloodline: ReviewBloodline) {
        const reviewKey = bloodlineReviewKey(bloodline);
        const cleanBloodline: SavedBloodline = {
            id: bloodline.id,
            name: bloodline.name,
            rank: bloodline.rank,
            image: bloodline.image,
            specialElement: bloodline.specialElement,
            lore: bloodline.lore,
            jutsus: bloodline.jutsus.map(normalizeJutsu),
            totalPoints: bloodline.totalPoints,
        };
        if (!savedBloodlines.some((existing) => existing.id === cleanBloodline.id)) {
            if (cleanBloodline.image) void publishSharedImage('bloodline:' + cleanBloodline.id, cleanBloodline.image);
            for (const jutsu of cleanBloodline.jutsus) {
                if (jutsu.image) void publishSharedImage('jutsu:' + jutsu.id, jutsu.image);
            }
            setSavedBloodlines([...savedBloodlines, cleanBloodline]);
            setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
        }
        const next = Array.from(new Set([...approvedBloodlineIds, reviewKey]));
        setApprovedBloodlineIds(next);
        try {
            await saveBloodlineReviewAction("approve", bloodline);
            setPmMsg(`✅ Approved ${bloodline.name}.`);
        } catch {
            setPmMsg("⚠️ Approved locally, but server review state did not save.");
        }
    }

    async function pmDeleteBloodline(bloodline: ReviewBloodline) {
        const reviewKey = bloodlineReviewKey(bloodline);
        if (!bloodline.ownerKey || bloodline.ownerKey === "admin") {
            setSavedBloodlines(savedBloodlines.filter(b => b.id !== bloodline.id));
        }
        const next = Array.from(new Set([...approvedBloodlineIds, reviewKey]));
        setApprovedBloodlineIds(next);
        setPendingPlayerBloodlines(pendingPlayerBloodlines.filter((candidate) => bloodlineReviewKey(candidate) !== reviewKey));
        try {
            await saveBloodlineReviewAction("delete", bloodline);
            setPmMsg(`✅ Deleted ${bloodline.name} from review${bloodline.ownerName ? ` and ${bloodline.ownerName}'s save` : ""}.`);
            fetchAllKnownPlayers();
        } catch {
            setPmMsg("⚠️ Hidden locally, but server delete did not complete.");
        }
    }

    async function deleteAdminSavedBloodline(bloodline: SavedBloodline) {
        if (!(await gameConfirm(`Delete ${bloodline.name} from the admin bloodline list?`, { danger: true, confirmLabel: "Delete" }))) return;
        setSavedBloodlines(savedBloodlines.filter((candidate) => candidate.id !== bloodline.id));
        if (editingBloodlineId === bloodline.id) { setEditingBloodlineId(""); setEditingBloodlineOwnerKey(""); }
        if (selectedBloodlineId === bloodline.id) setSelectedBloodlineId("");
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }
    const [leadershipImages, setLeadershipImages] = useState<VillageLeadershipImages>(() => loadVillageLeadershipImages());
    const [leaderSaveStatus, setLeaderSaveStatus] = useState("");
    useEffect(() => {
        if (activeAdminPanel !== "villageLeaders") return;
        const refreshLeadershipImages = () => setLeadershipImages(loadVillageLeadershipImages());
        refreshLeadershipImages();
        const id = setInterval(refreshLeadershipImages, 10000);
        return () => clearInterval(id);
    }, [activeAdminPanel]);
    const eventKindFilter: "All" | "reward" | "visualNovel" =
        activeAdminPanel === "eventsRaids" ? "reward"
            : activeAdminPanel === "visualNovels" ? "visualNovel"
                : "All";

    const allGameJutsus = getAllJutsus(savedBloodlines, creatorJutsus, null);
    // Built-in / story AIs are source-authoritative (see playableAis in App.tsx): a
    // same-id override contributes only its image, so the panel shows the real combat
    // stats from code, not a stale captured snapshot. Mirrors the live battle list.
    const allAdminAis = [
        ...builtinAis.map((builtin) => { const o = creatorAis.find((ai) => ai.id === builtin.id); return o ? { ...builtin, image: o.image ?? builtin.image } : builtin; }),
        ...creatorAis.filter((ai) => !builtinAis.some((builtin) => builtin.id === ai.id)),
    ];
    const selectedAdminAiProfile = allAdminAis.find((ai) => ai.id === selectedAiId) ?? allAdminAis[0];
    const builtInVisualNovels = [
        hiddenDungeonVnEvent,
        awakeningLv2VnEvent,
        auraSphereLv9VnEvent,
        ...Object.entries(storylines).flatMap(([village, steps]) => steps.map((step, index) => storyToCreatorEvent(step, village, index))),
    ];
    const allEditableEvents = [
        ...builtInVisualNovels.filter((builtIn) => !creatorEvents.some((event) => event.id === builtIn.id)),
        ...creatorEvents,
    ];
    const missionRanks: MissionRank[] = ["Daily", "D Rank", "C Rank", "B Rank", "A Rank", "S Rank"];
    const allEditableBloodlines = [
        ...starterSavedBloodlines.filter((builtIn) => !savedBloodlines.some((bloodline) => bloodline.name === builtIn.name || bloodline.id === builtIn.id)),
        ...savedBloodlines,
    ];
    const reviewBloodlines: ReviewBloodline[] = [
        ...savedBloodlines.map((bloodline) => ({ ...bloodline, ownerName: "Admin", ownerKey: "admin" })),
        ...pendingPlayerBloodlines.filter((bloodline) => !savedBloodlines.some((saved) => saved.id === bloodline.id)),
    ];
    const adminPanelBloodlines = [
        ...allEditableBloodlines,
        ...reviewBloodlines.filter((bloodline) =>
            !allEditableBloodlines.some((existing) => existing.id === bloodline.id)
        ),
    ];
    function updateLeadershipImage(village: string, slot: "kage" | number, image: string) {
        const shareKey = typeof slot === 'number' ? `leader:${village}:elder:${slot}` : `leader:${village}:kage`;
        publishSharedImage(shareKey, image);
        const current = leadershipImages[village] ?? { kage: "", elders: ["", "", ""] };
        const nextVillageImages = slot === "kage"
            ? { ...current, kage: image, elders: Array.from({ length: 3 }, (_, index) => current.elders?.[index] ?? "") }
            : { ...current, elders: Array.from({ length: 3 }, (_, index) => index === slot ? image : current.elders?.[index] ?? "") };
        const next = normalizeVillageLeadershipImages({ ...leadershipImages, [village]: nextVillageImages });
        setLeadershipImages(next);
        saveVillageLeadershipImages(next);
    }
    const sortedBloodlines = [...adminPanelBloodlines]
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

    const editableMissions = mergeBuiltinMissions(creatorMissions);
    const sortedCreatorMissions = [...editableMissions]
        .filter((mission) => missionRankFilter === "All" || mission.rank === missionRankFilter)
        .sort((a, b) => missionRanks.indexOf(a.rank) - missionRanks.indexOf(b.rank) || a.levelReq - b.levelReq || a.name.localeCompare(b.name));

    function makeTags() {
        const tags = normalizeJutsuTags([
            { name: tag1, percent: tag1Percent },
            { name: tag2, percent: tag2Percent },
            { name: tag3, percent: tag3Percent },
            { name: tag4, percent: tag4Percent },
        ]);

        return normalizeJutsuTags(tags);
    }

    function updateVnPage(index: number, updated: Partial<typeof eventVnPages[number]>) {
        setEventVnPages((pages) => pages.map((page, pageIndex) => pageIndex === index ? { ...page, ...updated } : page));
        if (!editingEventId) return;
        // Publish any image fields to shared KV so they survive page reload.
        // Use functional updater for setCreatorEvents to avoid stale-closure overwrites
        // when multiple images are uploaded in rapid succession.
        if ('image' in updated) {
            const img = updated.image ?? '';
            void publishSharedImage(`vn:${editingEventId}:page:${index}`, img);
            setCreatorEvents(prev => prev.map((ev) => {
                if (ev.id !== editingEventId || !ev.vnPages) return ev;
                return { ...ev, vnPages: ev.vnPages.map((p, i) => i === index ? { ...p, image: img } : p) };
            }));
        }
        if ('leftImage' in updated) {
            const img = updated.leftImage ?? '';
            void publishSharedImage(`vn:${editingEventId}:page:${index}:left`, img);
            setCreatorEvents(prev => prev.map((ev) => {
                if (ev.id !== editingEventId || !ev.vnPages) return ev;
                return { ...ev, vnPages: ev.vnPages.map((p, i) => i === index ? { ...p, leftImage: img } : p) };
            }));
        }
        if ('rightImage' in updated) {
            const img = updated.rightImage ?? '';
            void publishSharedImage(`vn:${editingEventId}:page:${index}:right`, img);
            setCreatorEvents(prev => prev.map((ev) => {
                if (ev.id !== editingEventId || !ev.vnPages) return ev;
                return { ...ev, vnPages: ev.vnPages.map((p, i) => i === index ? { ...p, rightImage: img } : p) };
            }));
        }
    }

    function applyJutsuImage(rawImage: string) {
        const pending = compressDataUrl(rawImage, 512, 0.82).then((image) => {
            setJutsuImage(image);
            // Upload settled — drop the pending marker so a later save doesn't await it.
            if (jutsuImagePendingRef.current === pending) jutsuImagePendingRef.current = null;
            if (!editingJutsuId) return image;
            // Never publish an empty string — the server rejects it (400), and it
            // would otherwise wipe a stored image.
            if (image) void publishSharedImage('jutsu:' + editingJutsuId, image);
            const stamp = Date.now();
            setCreatorJutsus(creatorJutsus.map((j) => j.id === editingJutsuId ? { ...j, image, updatedAt: stamp } : j));
            setSavedBloodlines(savedBloodlines.map((bl) => ({
                ...bl,
                jutsus: bl.jutsus.map((j) => j.id === editingJutsuId ? { ...j, image, updatedAt: stamp } : j),
            })));
            return image;
        });
        jutsuImagePendingRef.current = pending;
        void pending;
    }

    function applyBloodlineImage(rawImage: string) {
        void compactImage(rawImage).then((image) => {
            setBloodlineEditImage(image);
            if (!editingBloodlineId) return;
            void publishSharedImage('bloodline:' + editingBloodlineId, image);
            setSavedBloodlines(savedBloodlines.map((bl) => bl.id === editingBloodlineId ? { ...bl, image } : bl));
        });
    }

    function setVnPageImage(eventId: string, pageIndex: number, image: string) {
        void publishSharedImage(`vn:${eventId}:page:${pageIndex}`, image);
        setCreatorEvents(prev => {
            const existing = prev.find(ev => ev.id === eventId);
            if (existing) {
                return prev.map((ev) => {
                    if (ev.id !== eventId || !ev.vnPages) return ev;
                    return { ...ev, vnPages: ev.vnPages.map((p, i) => i === pageIndex ? { ...p, image } : p) };
                });
            }
            // Builtin event not yet in creatorEvents — upsert it so the image persists
            const builtin = builtInVisualNovels.find(b => b.id === eventId);
            if (builtin?.vnPages) {
                return [...prev, { ...builtin, vnPages: builtin.vnPages.map((p, i) => i === pageIndex ? { ...p, image } : p) }];
            }
            return prev;
        });
    }

    function setPetVnPageImage(pageIndex: number, image: string) {
        void publishSharedImage(`vn:pet-encounter:page:${pageIndex}`, image);
        if (!petEncounterVn.vnPages) return;
        setPetEncounterVn({ ...petEncounterVn, vnPages: petEncounterVn.vnPages.map((p, i) => i === pageIndex ? { ...p, image } : p) });
    }

    function setAncientChestVnPageImage(pageIndex: number, image: string) {
        void publishSharedImage(`vn:ancient-chest:page:${pageIndex}`, image);
        if (!ancientChestVn.vnPages) return;
        setAncientChestVn({ ...ancientChestVn, vnPages: ancientChestVn.vnPages.map((p, i) => i === pageIndex ? { ...p, image } : p) });
    }

    function applyEventImage(image: string) {
        setEventImage(image);
        if (!editingEventId) return;
        void publishSharedImage('event:' + editingEventId + ':bg', image);
        setCreatorEvents(creatorEvents.map((ev) => ev.id === editingEventId ? { ...ev, image } : ev));
    }

    function applyEventAvatarImage(avatarImage: string) {
        setEventAvatarImage(avatarImage);
        if (!editingEventId) return;
        void publishSharedImage('event:' + editingEventId + ':avatar', avatarImage);
        setCreatorEvents(creatorEvents.map((ev) => ev.id === editingEventId ? { ...ev, avatarImage } : ev));
    }

    function applyAiImage(image: string) {
        setAiImage(image);
        if (!editingAiId) return;
        // Update creatorAis state so the arena sees the image immediately
        setCreatorAis(creatorAis.map((ai) => ai.id === editingAiId ? { ...ai, image } : ai));
        // Persist to shared KV so the image survives reload
        void publishSharedImage('ai:' + editingAiId, image);
    }

    function jutsuFromForm(id = `admin-${makeId()}`) {
        const jutsu = normalizeJutsu({
            id,
            name: jutsuName.trim() || "Admin Jutsu",
            type: jutsuType,
            element: jutsuElement,
            ap: Number(jutsuAp),
            range: Number(jutsuRange),
            effectPower: Number(jutsuEp),
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
        // Stamp recency so this edit wins the shared-admin-content merge over a
        // stale same-id copy in the OTHER admin save (the cause of "I removed the
        // tag, saved, and it came back after reload").
        jutsu.updatedAt = Date.now();

        return jutsu;
    }

    function loadAdminJutsu(jutsu: Jutsu) {
        const normalized = normalizeJutsu(jutsu);

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
        setTag1(normalized.tags[0]?.name ?? "");
        setTag1Percent(normalized.tags[0]?.percent ?? 30);
        setTag2(normalized.tags[1]?.name ?? "");
        setTag2Percent(normalized.tags[1]?.percent ?? 30);
        setTag3(normalized.tags[2]?.name ?? "");
        setTag3Percent(normalized.tags[2]?.percent ?? 30);
        setTag4(normalized.tags[3]?.name ?? "");
        setTag4Percent(normalized.tags[3]?.percent ?? 30);
    }

    async function createAdminJutsu() {
        // If an image upload is still compressing, wait for it so we don't create
        // + publish with a half-ready (empty) image. No-op (stays synchronous) once
        // the preview has appeared, since the upload clears the pending marker.
        const readyImage = jutsuImagePendingRef.current ? await jutsuImagePendingRef.current.catch(() => "") : null;
        const newJutsu = rebalanceNonBloodlineJutsu(jutsuFromForm());
        // jutsuFromForm read the form state (stale across the await); prefer the
        // freshly-finished upload when one was in flight.
        if (readyImage) newJutsu.image = readyImage;
        if (newJutsu.image) void publishSharedImage('jutsu:' + newJutsu.id, newJutsu.image);

        setCreatorJutsus([...creatorJutsus, newJutsu]);

        alert(`${newJutsu.name} created and imported to the game. Train it before equipping it.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    async function saveAdminJutsuEdit() {
        if (!editingJutsuId) return alert("Load an existing admin jutsu first.");
        // Wait for an in-flight image upload (no-op once the preview has appeared)
        // so a save made mid-upload still persists the picture.
        const readyImage = jutsuImagePendingRef.current ? await jutsuImagePendingRef.current.catch(() => "") : null;
        const updatedJutsu = jutsuFromForm(editingJutsuId);
        if (readyImage) updatedJutsu.image = readyImage;
        // Skip the publish when there's no image — an empty string is rejected (400).
        if (updatedJutsu.image) void publishSharedImage('jutsu:' + updatedJutsu.id, updatedJutsu.image);
        const sourceBloodline = savedBloodlines.find((bloodline) => bloodline.jutsus.some((jutsu) => jutsu.id === editingJutsuId));
        if (sourceBloodline) {
            setSavedBloodlines(savedBloodlines.map((bloodline) => bloodline.id === sourceBloodline.id ? {
                ...bloodline,
                jutsus: bloodline.jutsus.map((jutsu) => jutsu.id === editingJutsuId ? updatedJutsu : jutsu),
                totalPoints: bloodline.jutsus.map((jutsu) => jutsu.id === editingJutsuId ? updatedJutsu : jutsu).reduce((sum, jutsu) => sum + jutsuPoints(jutsu), 0),
            } : bloodline));
        } else if (creatorJutsus.some((jutsu) => jutsu.id === editingJutsuId)) {
            // Save exactly what the admin set — no rebalance override
            setCreatorJutsus(creatorJutsus.map((jutsu) => jutsu.id === editingJutsuId ? updatedJutsu : jutsu));
        } else {
            // Override a starter jutsu — stored in creatorJutsus, wins via Map in getAllJutsus
            setCreatorJutsus([...creatorJutsus, updatedJutsu]);
        }
        alert(`${updatedJutsu.name} saved.`);
        // Auto-persist: wait for React to re-render with the new state, then save
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    async function deleteAdminJutsu(jutsuId = editingJutsuId) {
        if (!jutsuId) return alert("Load an existing admin jutsu first.");
        const label = allGameJutsus.find((jutsu) => jutsu.id === jutsuId)?.name ?? jutsuId;
        if (!(await gameConfirm(`Permanently delete "${label}"? This cannot be undone.`, { danger: true, confirmLabel: "Delete" }))) return;
        const sourceBloodline = savedBloodlines.find((bloodline) => bloodline.jutsus.some((jutsu) => jutsu.id === jutsuId));
        if (sourceBloodline) {
            const remaining = sourceBloodline.jutsus.filter((jutsu) => jutsu.id !== jutsuId);
            setSavedBloodlines(savedBloodlines.map((bloodline) => bloodline.id === sourceBloodline.id ? {
                ...bloodline,
                jutsus: remaining,
                totalPoints: remaining.reduce((sum, jutsu) => sum + jutsuPoints(jutsu), 0),
            } : bloodline));
        } else if (creatorJutsus.some((jutsu) => jutsu.id === jutsuId)) {
            setCreatorJutsus(creatorJutsus.filter((jutsu) => jutsu.id !== jutsuId));
        } else {
            return alert("That's a built-in starter jutsu — it can't be deleted, only overridden via Save Loaded Jutsu.");
        }
        if (jutsuId === editingJutsuId) setEditingJutsuId("");
        alert(`${label} deleted.`);
        // Auto-persist: wait for React to re-render with the new state, then save
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    function eventFromForm(id = `event-${makeId()}`): CreatorEvent {
        const existingEvent = allEditableEvents.find((event) => event.id === id);
        const targetSector = Math.max(1, Math.min(99, Number(eventTargetSector)));
        const targetBiome = biomeForWorldSector(targetSector);
        return {
            id,
            name: eventName.trim() || "Admin Event",
            biome: targetBiome,
            targetSector,
            icon: eventIcon || "⭐",
            eventKind,
            trigger: eventTrigger || undefined,
            vnTitle: eventVnTitle.trim() || eventName.trim() || "Visual Novel Scene",
            vnScene: eventVnScene.trim(),
            vnSpeaker: eventVnSpeaker.trim() || "Narrator",
            image: eventImage,
            avatarImage: eventAvatarImage,
            aiProfileId: eventAiProfileId || undefined,
            village: existingEvent?.village,
            kageFinale: existingEvent?.kageFinale,
            liberatorTitle: existingEvent?.liberatorTitle,
            vnPages: eventKind === "visualNovel" ? eventVnPages.slice(0, eventPageCount).map((page, index) => ({
                title: page.title.trim() || `Story Page ${index + 1}`,
                scene: page.scene.trim(),
                speaker: page.speaker.trim() || "Narrator",
                dialogue: page.dialogue.split("\n").map((line) => line.trim()).filter(Boolean),
                image: page.image,
                leftName: page.leftName?.trim() || undefined,
                leftImage: page.leftImage || undefined,
                rightName: page.rightName?.trim() || undefined,
                rightImage: page.rightImage || undefined,
                choices: page.choices?.filter((c) => c.text.trim()).length
                    ? page.choices.filter((c) => c.text.trim()).map((c) => ({
                        text: c.text.trim(),
                        nextPage: c.nextPage,
                        conclusion: c.conclusion?.trim() || undefined,
                        trait: c.trait?.trim() || undefined,
                        requireTrait: c.requireTrait?.trim() || undefined,
                        forbidTrait: c.forbidTrait?.trim() || undefined,
                        battle: c.battle,
                    }))
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
        setEventTrigger(event.trigger ?? "");
        setEventBiome(event.biome);
        setEventTargetSector(event.targetSector ?? 56);
        setEventIcon(event.icon);
        setEventVnTitle(event.vnTitle ?? event.name);
        setEventVnScene(event.vnScene ?? "");
        setEventVnSpeaker(event.vnSpeaker ?? "Narrator");
        setEventImage(event.image ?? "");
        setEventAvatarImage(event.avatarImage ?? "");
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
            const savedRightWasPlayer = (page?.rightName ?? "").trim().toLowerCase() === "player";
            return {
                title: page?.title ?? `Story Page ${index + 1}`,
                scene: page?.scene ?? "",
                speaker: page?.speaker ?? "Narrator",
                dialogue: page?.dialogue?.join("\n") ?? "",
                image: page?.image ?? "",
                leftName: savedRightWasPlayer ? "Player" : (page?.leftName ?? "Player"),
                leftImage: savedRightWasPlayer ? "" : (page?.leftImage ?? ""),
                rightName: savedRightWasPlayer ? (page?.leftName ?? page?.speaker ?? event.vnSpeaker ?? "Narrator") : (page?.rightName ?? page?.speaker ?? "Narrator"),
                rightImage: savedRightWasPlayer ? (page?.leftImage ?? page?.rightImage ?? "") : (page?.rightImage ?? ""),
                choices: page?.choices ?? [],
            };
        }));
    }

    async function publishEventPageImages(event: CreatorEvent, imageEventId = event.id) {
        // Publish all VN page images to shared KV so they survive server save stripping.
        // Called on every save (create or update) to catch images uploaded before
        // editingEventId was set, and to re-publish in case of any missed writes.
        await Promise.all([
            publishSharedImage(`event:${imageEventId}:bg`, event.image ?? ""),
            publishSharedImage(`event:${imageEventId}:avatar`, event.avatarImage ?? ""),
        ]);
        if (!event.vnPages) return;
        await Promise.all(event.vnPages.flatMap((page, i) => [
            publishSharedImage(`vn:${imageEventId}:page:${i}`,       page.image ?? ""),
            publishSharedImage(`vn:${imageEventId}:page:${i}:left`,  page.leftImage ?? ""),
            publishSharedImage(`vn:${imageEventId}:page:${i}:right`, page.rightImage ?? ""),
            ...(page.choices ?? []).map((choice, choiceIndex) => publishSharedImage(`vn:${imageEventId}:page:${i}:choice:${choiceIndex}:bg`, choice.battle?.backgroundImage ?? "")),
        ]));
    }

    async function createAdminEvent() {
        const event = eventFromForm();
        setCreatorEvents([...creatorEvents, event]);
        await publishEventPageImages(event);
        alert(`${event.name} created and imported to World Map.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    async function saveAdminEventEdit() {
        if (!editingEventId) return alert("Load an existing admin event first.");
        const updatedEvent = eventFromForm(editingEventId);
        setCreatorEvents(creatorEvents.some((event) => event.id === editingEventId)
            ? creatorEvents.map((event) => event.id === editingEventId ? updatedEvent : event)
            : [...creatorEvents, updatedEvent]);
        await publishEventPageImages(updatedEvent);
        alert(`${updatedEvent.name} updated.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    function missionFromForm(id = `mission-${makeId()}`): CreatorMission {
        return {
            id,
            name: missionName.trim() || "Sector Fetch Mission",
            rank: missionRank,
            description: missionDescription.trim() || "Explore the assigned sector and return to claim the reward.",
            type: "fetchExplore",
            aiProfileId: missionAiProfileId || undefined,
            targetSector: Math.max(1, Math.min(99, Number(missionTargetSector))),
            tileX: Math.floor(Math.random() * 144),
            tileY: Math.floor(Math.random() * 144),
            exploreCount: Math.max(1, Number(missionExploreCount)),
            raidCount: Math.max(0, Number(missionRaidCount)),
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
        setMissionRaidCount(missionRaidRequirement(mission));
        setMissionLevelReq(mission.levelReq);
        setMissionXp(mission.xpReward);
        setMissionRyo(mission.ryoReward);
        setMissionStamina(mission.staminaReward);
        const missionCurrencyReward = firstCurrencyReward(mission.currencyRewards);
        setMissionRewardCurrency(missionCurrencyReward.key);
        setMissionRewardCurrencyAmount(missionCurrencyReward.amount);
    }

    function createAdminMission() {
        // Auto-set target sector to current sector
        setMissionTargetSector(currentSector);
        const mission = missionFromForm();
        setCreatorMissions([...creatorMissions, mission]);
        alert(`${mission.name} created and added to Mission Hall.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    function saveAdminMissionEdit() {
        if (!editingMissionId) return alert("Load an existing mission first.");
        const mission = missionFromForm(editingMissionId);
        setCreatorMissions(creatorMissions.some((existing) => existing.id === mission.id)
            ? creatorMissions.map((existing) => existing.id === mission.id ? mission : existing)
            : [...creatorMissions, mission]);
        alert(`${mission.name} updated.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    function raidFromForm(id = `raid-${makeId()}`): CreatorRaid {
        const targetSector = Math.max(1, Math.min(99, Number(raidTargetSector)));
        return {
            id,
            name: raidName.trim() || "Shadow Boss Raid",
            targetSector,
            tileX: Math.floor(Math.random() * 144),
            tileY: Math.floor(Math.random() * 144),
            biome: biomeForWorldSector(targetSector),
            icon: raidIcon || "⚔",
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
        setRaidTargetSector(raid.targetSector ?? (raid.biome === "shadow" ? 8 : raid.biome === "forest" ? 25 : raid.biome === "snow" ? 50 : raid.biome === "volcano" ? 40 : 56));
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
        // Auto-set target sector to current sector
        setRaidTargetSector(currentSector);
        const raid = raidFromForm();
        setCreatorRaids([...creatorRaids, raid]);
        alert(`${raid.name} created.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    function saveAdminRaidEdit() {
        if (!editingRaidId) return alert("Load an existing raid first.");
        const raid = raidFromForm(editingRaidId);
        setCreatorRaids(creatorRaids.some((r) => r.id === editingRaidId)
            ? creatorRaids.map((r) => r.id === editingRaidId ? raid : r)
            : [...creatorRaids, raid]);
        setEditingRaidId(raid.id);
        alert(`${raid.name} updated.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
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
            loadoutId: aiLoadoutId,
            jutsuIds: aiJutsuIds,
            rules: aiRules,
            isBossAi: aiIsBoss || undefined,
            masterAi: aiMasterAi || undefined,
        }, allGameJutsus);
    }

    function loadAdminAi(ai: CreatorAi) {
        const normalized = normalizeAiProfile(ai, allGameJutsus);
        setEditingAiId(normalized.id);
        setAiName(normalized.name);
        setAiIcon(normalized.icon);
        setAiImage(normalized.image ?? "");
        setAiIsBoss(normalized.isBossAi ?? false);
        setAiMasterAi(normalized.masterAi ?? false);
        setAiLevel(normalized.level);
        setAiVillage(normalized.village);
        setAiHp(normalized.hp);
        setAiChakra(normalized.chakra);
        setAiStamina(normalized.stamina);
        setAiStats(normalized.stats);
        setAiLoadoutId(normalized.loadoutId ?? aiLoadoutFromJutsus(allGameJutsus.filter((jutsu) => normalized.jutsuIds.includes(jutsu.id))));
        setAiJutsuIds(normalized.jutsuIds);
        setAiRules(normalized.rules);
        setSelectedAiId(normalized.id);
    }

    function saveAdminAi() {
        const ai = aiFromForm(editingAiId || undefined);
        if (ai.image) void publishSharedImage('ai:' + ai.id, ai.image);
        setCreatorAis(creatorAis.some((existing) => existing.id === ai.id)
            ? creatorAis.map((existing) => existing.id === ai.id ? ai : existing)
            : [...creatorAis, ai]);
        setEditingAiId(ai.id);
        setSelectedAiId(ai.id);
        alert(`${ai.name} saved.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    function updateAiStat(stat: keyof Stats, value: number) {
        setAiStats((stats) => ({ ...stats, [stat]: capStat(value) }));
    }

    function updateAiRule(index: number, updated: Partial<AiRule>) {
        setAiRules((rules) => rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...updated } : rule));
    }

    function applyBasicCombatAiPreset() {
        const selectedJutsus = allGameJutsus.filter((jutsu) => aiJutsuIds.includes(jutsu.id));
        setAiRules(buildBasicCombatAiRules(selectedJutsus, aiLoadoutId));
        alert("Basic Combat AI rules applied from the selected jutsus.");
    }

    function applyAiJutsuLoadout(loadoutId: AiLoadoutId) {
        const selectedJutsus = aiJutsuLoadout(loadoutId, allGameJutsus);
        setAiLoadoutId(loadoutId);
        setAiJutsuIds(selectedJutsus.map((jutsu) => jutsu.id));
        setAiRules(buildBasicCombatAiRules(selectedJutsus, loadoutId));
        setAiStats(aiStatsForLevel(aiLevel, selectedJutsus));
        alert(`${aiLoadoutLabels[loadoutId]} loadout applied.`);
    }

    function applyLevelScaledAiTuning() {
        const selectedJutsus = allGameJutsus.filter((jutsu) => aiJutsuIds.includes(jutsu.id));
        setAiHp(aiHpForLevel(aiLevel));
        setAiChakra(maxChakraForLevel(aiLevel));
        setAiStamina(maxStaminaForLevel(aiLevel));
        setAiStats(aiStatsForLevel(aiLevel, selectedJutsus));
        alert("Level-scaled AI HP, chakra, stamina, and stats applied.");
    }

    function loadAdminBloodline(bloodline: SavedBloodline) {
        setEditingBloodlineId(bloodline.id);
        setEditingBloodlineOwnerKey((bloodline as ReviewBloodline).ownerKey ?? "");
        setBloodlineEditName(bloodline.name);
        setBloodlineEditRank(bloodline.rank);
        setBloodlineEditElement(bloodline.specialElement ?? "");
        setBloodlineEditImage(bloodline.image ?? "");
        setBloodlineEditLore(bloodline.lore ?? "");
    }

    async function saveAdminBloodlineEdit() {
        if (!editingBloodlineId) return alert("Load an existing bloodline first.");
        const sourceBloodline = adminPanelBloodlines.find((bloodline) => bloodline.id === editingBloodlineId);
        if (!sourceBloodline) return alert("Loaded bloodline was not found.");
        const isPlayerBloodline = editingBloodlineOwnerKey && editingBloodlineOwnerKey !== "admin";
        const updatedBloodline: SavedBloodline = {
            ...sourceBloodline,
            id: savedBloodlines.some((bloodline) => bloodline.id === editingBloodlineId) || isPlayerBloodline ? editingBloodlineId : `bloodline-${makeId()}`,
            name: bloodlineEditName.trim() || sourceBloodline.name,
            rank: bloodlineEditRank,
            specialElement: bloodlineEditElement.trim(),
            image: bloodlineEditImage,
            lore: bloodlineEditLore.trim(),
        };
        // Republish the cover image under the FINAL id. The id can be reminted
        // above (editing a built-in mints a fresh `bloodline-*` id), but
        // applyBloodlineImage published under the loaded id — without this the
        // saved override's `bloodline:<id>` key wouldn't exist and the image
        // would never hydrate. No-ops for an unchanged /api/img reference.
        if (bloodlineEditImage) void publishSharedImage('bloodline:' + updatedBloodline.id, bloodlineEditImage);
        if (isPlayerBloodline) {
            const res = await fetch('/api/admin/bloodline-review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
                body: JSON.stringify({
                    action: 'update',
                    ownerKey: editingBloodlineOwnerKey,
                    bloodlineId: editingBloodlineId,
                    bloodline: updatedBloodline,
                }),
            });
            if (!res.ok) return alert(`Could not update player bloodline (${res.status}).`);
            setPendingPlayerBloodlines(pendingPlayerBloodlines.map((bloodline) =>
                bloodline.id === editingBloodlineId && bloodline.ownerKey === editingBloodlineOwnerKey
                    ? { ...updatedBloodline, ownerKey: bloodline.ownerKey, ownerName: bloodline.ownerName }
                    : bloodline
            ));
            alert(`${updatedBloodline.name} updated in ${editingBloodlineOwnerKey}'s save.`);
            fetchAllKnownPlayers();
            return;
        }
        setSavedBloodlines(savedBloodlines.some((bloodline) => bloodline.id === editingBloodlineId)
            ? savedBloodlines.map((bloodline) => bloodline.id === editingBloodlineId ? updatedBloodline : bloodline)
            : [...savedBloodlines, updatedBloodline]);
        setEditingBloodlineId(updatedBloodline.id);
        setSelectedBloodlineId(updatedBloodline.id);
        alert(`${bloodlineEditName || "Bloodline"} updated.`);
        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
    }

    function setLevel(level: number) {
        const nextLevel = Math.max(1, Math.min(MAX_LEVEL, level));
        const nextMaxHp = maxHpForLevel(nextLevel);
        const nextMaxChakra = maxChakraForLevel(nextLevel);
        const nextMaxStamina = maxStaminaForLevel(nextLevel);
        updateCharacter(reconcileCharacterStatBudget({
            ...character,
            level: nextLevel,
            xp: 0,
            rankTitle: rankTitleForLevel(character, nextLevel),
            maxHp: nextMaxHp,
            hp: nextMaxHp,
            maxChakra: nextMaxChakra,
            chakra: nextMaxChakra,
            maxStamina: nextMaxStamina,
            stamina: nextMaxStamina,
        }));
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
                <h2 style={{ margin: 0 }}>⚙️ Admin Panel</h2>
                <button className="village-save-btn" onClick={handleAdminSave} disabled={adminSaving} style={{ marginLeft: "auto" }}>
                    {adminSaving ? "Saving…" : "💾 Save"}
                </button>
                {onReloadImages && (
                    <button className="village-save-btn" onClick={onReloadImages} style={{ background: "#2a6" }}>
                        🔄 Reload Images
                    </button>
                )}
                {adminSaveMsg && <span className="village-save-msg">{adminSaveMsg}</span>}
            </div>
            <p>Anything created here is saved and imported into normal gameplay.</p>

            <div className="admin-panel-switcher">
                {/* Players, Hollow Gate, and Moderation are full-admin only
                    (Admin 1). Admin 2 (content role) gets the curation tabs:
                    Jutsus+Bloodlines, Events, VNs, AI Creator, Pet/Card
                    Editors, Village Leaders, Professions. */}
                {adminRole === 'full' && (
                    <button className={activeAdminPanel === "playerManagement" ? "active" : ""} onClick={() => setActiveAdminPanel("playerManagement")}>
                        👥 Players
                    </button>
                )}
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
                {adminRole === 'full' && (
                    <button className={activeAdminPanel === "hollowGate" ? "active" : ""} onClick={() => setActiveAdminPanel("hollowGate")}>
                        ⛩ Hollow Gate
                    </button>
                )}
                {adminRole === 'full' && (
                    <button className={activeAdminPanel === "relicDungeons" ? "active" : ""} onClick={() => setActiveAdminPanel("relicDungeons")}>
                        🗝 Relic Dungeons
                    </button>
                )}
                <button className={activeAdminPanel === "professions" ? "active" : ""} onClick={() => setActiveAdminPanel("professions")}>
                    🧑‍⚕️ Professions
                </button>
                {adminRole === 'full' && (
                    <button className={activeAdminPanel === "moderation" ? "active" : ""} onClick={() => setActiveAdminPanel("moderation")}>
                        🛡 Moderation
                    </button>
                )}
                <button className={activeAdminPanel === "diagnostics" ? "active" : ""} onClick={() => setActiveAdminPanel("diagnostics")}>
                    🛠️ Diagnostics
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

            {activeAdminPanel === "villageLeaders" && (() => {
                const elderRoleLabels = ["War Elder", "Trade Elder", "Training Elder"];

                async function generateLeaderImage(prompt: string, label: string): Promise<string | null> {
                    const response = await fetch("/api/generate-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt, label }),
                    });
                    if (!response.ok) return null;
                    const data = await response.json() as { image?: string };
                    return data.image ?? null;
                }

                async function generateAllMissing(village: string, leadership: { kage: string; elders: string[] }) {
                    const images = leadershipImages[village] ?? { kage: "", elders: ["", "", ""] };
                    const slots: { prompt: string; label: string; apply: (img: string) => void }[] = [];
                    if (!images.kage)
                        slots.push({ prompt: `${leadership.kage}, shinobi village Kage leader portrait`, label: "Kage Image", apply: (img) => updateLeadershipImage(village, "kage", img) });
                    leadership.elders.forEach((elder, i) => {
                        if (!images.elders?.[i])
                            slots.push({ prompt: `${elder}, ${elderRoleLabels[i] ?? "elder"}, shinobi NPC portrait`, label: "Elder Image", apply: (img) => updateLeadershipImage(village, i, img) });
                    });
                    if (slots.length === 0) { alert("All portraits already have images."); return; }
                    if (!(await gameConfirm(`Generate ${slots.length} missing portrait${slots.length > 1 ? "s" : ""} for ${village}? This costs image credits.`))) return;
                    for (let i = 0; i < slots.length; i++) {
                        const slot = slots[i];
                        const img = await generateLeaderImage(slot.prompt, slot.label);
                        if (img) slot.apply(img);
                        // Respect the 2/min rate limit — wait 35s between calls
                        if (i < slots.length - 1) await new Promise(r => setTimeout(r, 35_000));
                    }
                    alert(`Done generating portraits for ${village}.`);
                }

                return (
                    <div className="admin-subpanel">
                        <div className="admin-panel-heading">
                            <h3>Village Leaders</h3>
                            <p>Add portraits for the Kage, War Elder, Trade Elder, and Training Elder. These appear in each village's Town Hall.</p>
                        </div>
                        <div className="menu" style={{ marginBottom: "0.5rem" }}>
                            <button onClick={async () => {
                                setLeaderSaveStatus("Saving...");
                                try {
                                    const normalized = normalizeVillageLeadershipImages(leadershipImages);
                                    // Save all individual images to shared images hash
                                    const imagePromises: Promise<boolean>[] = [];
                                    for (const [village, images] of Object.entries(normalized)) {
                                        if (images.kage) imagePromises.push(publishSharedImage(`leader:${village}:kage`, images.kage));
                                        (images.elders ?? []).forEach((elder, i) => {
                                            if (elder) imagePromises.push(publishSharedImage(`leader:${village}:elder:${i}`, elder));
                                        });
                                    }
                                    await Promise.all(imagePromises);
                                    // Save the leadership images blob to game state
                                    saveVillageLeadershipImages(normalized);
                                    // Also trigger a full admin save
                                    // ref read inside onClick handler, not during render — intentional
                                    await onSaveRef.current();
                                    setLeaderSaveStatus("Saved!");
                                } catch {
                                    setLeaderSaveStatus("Save failed — try again.");
                                }
                                setTimeout(() => setLeaderSaveStatus(""), 3000);
                            }}>Save All Leader Images</button>
                            {leaderSaveStatus && <span className="hint" style={{ color: leaderSaveStatus.includes("fail") ? "#ff7777" : "#a5d6a7" }}>{leaderSaveStatus}</span>}
                        </div>
                        {Object.entries(villageLeadership).map(([village, leadership]) => {
                            const images = leadershipImages[village] ?? { kage: "", elders: ["", "", ""] };
                            const missingCount = (!images.kage ? 1 : 0) + leadership.elders.filter((_, i) => !images.elders?.[i]).length;
                            return (
                                <section className="summary-box village-leader-section" key={village}>
                                    <div className="village-leader-section-header">
                                        <h3>{village}</h3>
                                        {missingCount > 0 && (
                                            <button onClick={() => void generateAllMissing(village, leadership)}>
                                                ✨ Generate {missingCount} Missing Portrait{missingCount > 1 ? "s" : ""}
                                            </button>
                                        )}
                                    </div>
                                    <div className="leader-admin-grid">
                                        <div className="leader-admin-card">
                                            <h4>Kage</h4>
                                            <strong>{leadership.kage}</strong>
                                            {images.kage ? <img src={images.kage} alt={leadership.kage} /> : <div className="leader-image-placeholder">No Image</div>}
                                            <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) readImageFile(file, (image) => updateLeadershipImage(village, "kage", image), 100); }} />
                                            <div className="menu">
                                                <AiImagePrompt label="Kage Image" suggestedPrompt={`${leadership.kage}, shinobi village Kage leader portrait`} onImage={(image) => updateLeadershipImage(village, "kage", image)} />
                                                {images.kage && <button className="danger-button" onClick={() => updateLeadershipImage(village, "kage", "")}>Remove Image</button>}
                                            </div>
                                        </div>
                                        {leadership.elders.map((elder, index) => (
                                            <div className="leader-admin-card" key={elder}>
                                                <h4>{elderRoleLabels[index] ?? `Elder ${index + 1}`}</h4>
                                                <strong>{elder}</strong>
                                                {images.elders?.[index] ? <img src={images.elders[index]} alt={elder} /> : <div className="leader-image-placeholder">No Image</div>}
                                                <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) readImageFile(file, (image) => updateLeadershipImage(village, index, image), 100); }} />
                                                <div className="menu">
                                                    <AiImagePrompt label="Elder Image" suggestedPrompt={`${elder}, ${elderRoleLabels[index] ?? "elder"}, shinobi NPC portrait`} onImage={(image) => updateLeadershipImage(village, index, image)} />
                                                    {images.elders?.[index] && <button className="danger-button" onClick={() => updateLeadershipImage(village, index, "")}>Remove Image</button>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                );
            })()}

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
                            <AiImagePrompt label="Jutsu Image" suggestedPrompt={`${jutsuElement} ${jutsuAp === 40 ? "Any" : jutsuType} technique, ${jutsuName}`} onImage={applyJutsuImage} />

                            {jutsuImage && (
                                <div className="admin-jutsu-preview">
                                    <img src={jutsuImage} alt="Jutsu preview" />
                                </div>
                            )}

                            <label>Type / Element</label>
                            <div className="inline-grid">
                                <select value={jutsuAp === 40 ? "Any" : jutsuType} disabled={jutsuAp === 40} onChange={(e) => setJutsuType(e.target.value as JutsuType)}>{specialties.map((type) => <option key={type}>{type}</option>)}</select>
                                <select value={jutsuElement} onChange={(e) => setJutsuElement(e.target.value as JutsuElement)}>{jutsuElements.map((element) => <option key={element}>{element}</option>)}</select>
                            </div>
                            {jutsuAp === 40 && <p className="hint">40 AP jutsu are element-only utility — the offense discipline is locked to Any (their buffs/debuffs apply to all offenses).</p>}
                            <label>Target / Method</label>
                            <div className="inline-grid">
                                <select value={jutsuTarget} onChange={(e) => setJutsuTarget(e.target.value as JutsuTarget)}>{jutsuTargets.map((target) => <option key={target}>{target}</option>)}</select>
                                <select value={jutsuMethod} onChange={(e) => setJutsuMethod(e.target.value as JutsuMethod)}>{jutsuMethods.map((method) => <option key={method}>{method}</option>)}</select>
                            </div>
                            <label>AP / Range / Effect Power / Cooldown</label>
                            <div className="inline-grid"><input type="number" min={1} value={jutsuAp} onChange={(e) => { const ap = Math.max(1, Number(e.target.value)); setJutsuAp(ap); if (ap === 40) setJutsuType("Any"); }} /><input type="number" min={1} value={jutsuRange} onChange={(e) => setJutsuRange(Math.max(1, Number(e.target.value)))} /><input type="number" min={1} value={jutsuEp} onChange={(e) => setJutsuEp(Math.max(1, Number(e.target.value)))} /><input type="number" min={0} value={jutsuCooldown} onChange={(e) => setJutsuCooldown(Math.max(0, Number(e.target.value)))} /></div>
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
                                {editingJutsuId && <button onClick={saveAdminJutsuEdit}>Save Loaded Jutsu</button>}
                                {editingJutsuId && <button className="danger-button" onClick={() => deleteAdminJutsu()}>Delete Loaded Jutsu</button>}
                            </div>
                            {editingJutsuId
                                ? <p className="hint">Editing jutsu: {editingJutsuId} — Save persists your edits (e.g. removing a tag); Delete removes it permanently.</p>
                                : <p className="hint">Load a jutsu below to Save or Delete it.</p>}
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
                            <label>Trigger</label><select value={eventTrigger} onChange={(e) => setEventTrigger(e.target.value as "" | "manual" | "firstBattleArena" | "firstLeaveVillage")}><option value="manual">Manual: World Map Admin Event</option><option value="firstBattleArena">First time clicking Battle Arena</option><option value="firstLeaveVillage">First time leaving the Village</option></select>
                            <label>Sector</label><select value={eventTargetSector} onChange={(e) => { const sector = Number(e.target.value); setEventTargetSector(sector); setEventBiome(biomeForWorldSector(sector)); }}>{worldSectorOptions.map((sector) => <option key={sector} value={sector}>Sector {sector} | {biomeForWorldSector(sector)}</option>)}</select>
                            <label>Icon</label>
                            <select value={eventIcon} onChange={(e) => setEventIcon(e.target.value)}>
                                {adminIconOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                            <label>Event Image</label>
                            <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, applyEventImage, 100); }} />
                            <AiImagePrompt label="Event Image" suggestedPrompt={`${eventBiome} world event scene, ${eventName}`} onImage={applyEventImage} />
                            {eventImage && (<div className="admin-jutsu-preview admin-event-preview"><img src={eventImage} alt="Event preview" /><button className="danger-button" onClick={() => applyEventImage("")}>Remove Image</button></div>)}
                            <label>Avatar Image</label>
                            <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, applyEventAvatarImage, 100); }} />
                            <AiImagePrompt label="Event Avatar" suggestedPrompt={`${eventName} shinobi character portrait`} onImage={applyEventAvatarImage} />
                            {eventAvatarImage && (<div className="admin-jutsu-preview admin-event-preview"><img src={eventAvatarImage} alt="Event avatar preview" /><button className="danger-button" onClick={() => applyEventAvatarImage("")}>Remove Avatar</button></div>)}
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
                            <p className="hint">Fetch quests send players to a numbered world sector and count Explore Tile actions plus optional village raids in that sector.</p>
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
                            <label>Target Sector / Explore Count / Raid Count</label>
                            <div className="inline-grid">
                                <input type="number" min={1} max={99} value={missionTargetSector} onChange={(e) => setMissionTargetSector(Number(e.target.value))} />
                                <input type="number" min={1} value={missionExploreCount} onChange={(e) => setMissionExploreCount(Number(e.target.value))} />
                                <input type="number" min={0} value={missionRaidCount} onChange={(e) => setMissionRaidCount(Number(e.target.value))} />
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
                                    <p>Sector {mission.targetSector} x {mission.exploreCount} explores{missionRaidRequirement(mission) > 0 ? ` + ${missionRaidRequirement(mission)} village raids` : ""} | Level {mission.levelReq}</p>
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
                            <label>Sector</label>
                            <select value={raidTargetSector} onChange={(e) => { const sector = Number(e.target.value); setRaidTargetSector(sector); setRaidBiome(biomeForWorldSector(sector)); }}>
                                {worldSectorOptions.map((sector) => <option key={sector} value={sector}>Sector {sector} | {biomeForWorldSector(sector)}</option>)}
                            </select>
                            <label>Icon</label>
                            <select value={raidIcon} onChange={(e) => setRaidIcon(e.target.value)}>
                                {adminIconOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
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
                            <label>Trigger</label><select value={eventTrigger} onChange={(e) => setEventTrigger(e.target.value as "" | "manual" | "firstBattleArena" | "firstLeaveVillage")}><option value="">Automatic (when level is reached)</option><option value="firstBattleArena">First Battle Arena click</option><option value="firstLeaveVillage">First Village exit</option></select>
                            <label>Sector</label><select value={eventTargetSector} onChange={(e) => { const sector = Number(e.target.value); setEventTargetSector(sector); setEventBiome(biomeForWorldSector(sector)); }}>{worldSectorOptions.map((sector) => <option key={sector} value={sector}>Sector {sector} | {biomeForWorldSector(sector)}</option>)}</select>
                            <label>Icon</label>
                            <select value={eventIcon} onChange={(e) => setEventIcon(e.target.value)}>
                                {adminIconOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                            <label>Backdrop Image</label>
                            <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, applyEventImage, 100); }} />
                            <AiImagePrompt label="VN Backdrop" suggestedPrompt={`${eventBiome} visual novel backdrop, ${eventName}`} onImage={applyEventImage} />
                            {eventImage && (<div className="admin-jutsu-preview admin-event-preview"><img src={eventImage} alt="Backdrop preview" /><button className="danger-button" onClick={() => applyEventImage("")}>Remove Image</button></div>)}
                            <label>Default Right-Side Avatar</label>
                            <p className="hint">Used for the speaker, enemy, or narrator portrait on the right side when a page does not have its own right avatar.</p>
                            <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, applyEventAvatarImage, 100); }} />
                            <AiImagePrompt label="Right-Side VN Avatar" suggestedPrompt={`${eventVnSpeaker || eventName} shinobi visual novel portrait`} onImage={applyEventAvatarImage} />
                            {eventAvatarImage && (<div className="admin-jutsu-preview admin-event-preview"><img src={eventAvatarImage} alt="VN avatar preview" /><button className="danger-button" onClick={() => applyEventAvatarImage("")}>Remove Avatar</button></div>)}
                            <label>Story Pages (1–10)</label><input type="number" min={1} max={10} value={eventPageCount} onChange={(e) => setEventPageCount(Math.max(1, Math.min(10, Number(e.target.value))))} />
                            <div className="summary-box" style={{ margin: "6px 0" }}>
                                <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: 6 }}>Cast — reusable characters (saved on this device, across all VNs)</div>
                                {vnCast.length === 0
                                    ? <p className="hint" style={{ margin: 0 }}>No saved characters yet. Set a page's left/right name + avatar below, then "Save to cast" to reuse them on any page.</p>
                                    : <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                        {vnCast.map((m) => (
                                            <span key={m.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 4px 3px 8px", border: "1px solid #334155", borderRadius: 999 }}>
                                                {m.image
                                                    ? <img src={m.image} alt={m.name} style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
                                                    : <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#1e293b", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{m.name.slice(0, 2).toUpperCase()}</span>}
                                                <span style={{ fontSize: "0.85rem" }}>{m.name}</span>
                                                <button type="button" title={`Remove ${m.name} from cast`} className="danger-button" style={{ padding: "0 7px", lineHeight: "20px" }} onClick={() => saveVnCast(vnCast.filter((c) => c.name !== m.name))}>×</button>
                                            </span>
                                        ))}
                                    </div>}
                            </div>
                            <div className="admin-vn-page-list">
                                {eventVnPages.slice(0, eventPageCount).map((page, index) => (
                                    <div className="summary-box admin-vn-page" id={`admin-vn-page-${index}`} key={index}>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                            <h4 style={{ margin: 0 }}>Page {index + 1}</h4>
                                            <button type="button" onClick={() => { setPreviewVn(eventFromForm()); setPreviewVnPage(index); setPreviewVnLine(0); }}>▶️ Preview from here</button>
                                        </div>
                                        <label>Page Title</label><input value={page.title} onChange={(e) => updateVnPage(index, { title: e.target.value })} />
                                        <label>Scene</label><textarea rows={2} value={page.scene} onChange={(e) => updateVnPage(index, { scene: e.target.value })} />
                                        <label>Speaker</label><input value={page.speaker} onChange={(e) => updateVnPage(index, { speaker: e.target.value })} />
                                        <label>Left / Right Character Names</label>
                                        <div className="inline-grid">
                                            <input placeholder="Left player name" value={page.leftName ?? ""} onChange={(e) => updateVnPage(index, { leftName: e.target.value })} />
                                            <input placeholder="Right speaker / enemy / narrator" value={page.rightName ?? ""} onChange={(e) => updateVnPage(index, { rightName: e.target.value })} />
                                        </div>
                                        {vnCast.length > 0 && (
                                            <div className="inline-grid">
                                                <select value="" onChange={(e) => { const m = vnCast.find((c) => c.name === e.target.value); if (m) updateVnPage(index, { leftName: m.name, leftImage: m.image }); }}>
                                                    <option value="">Use saved character (left)…</option>
                                                    {vnCast.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                                                </select>
                                                <select value="" onChange={(e) => { const m = vnCast.find((c) => c.name === e.target.value); if (m) updateVnPage(index, { rightName: m.name, rightImage: m.image }); }}>
                                                    <option value="">Use saved character (right)…</option>
                                                    {vnCast.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                                                </select>
                                            </div>
                                        )}
                                        <div className="inline-grid">
                                            <button type="button" onClick={() => addToCast(page.leftName, page.leftImage)}>＋ Save left to cast</button>
                                            <button type="button" onClick={() => addToCast(page.rightName, page.rightImage)}>＋ Save right to cast</button>
                                        </div>
                                        <label>VN Avatars</label>
                                        <div className="vn-avatar-editor-row">
                                            <div className="vn-avatar-editor-card">
                                                <span>Left Player</span>
                                                <div className="vn-avatar-editor-preview">
                                                    {(page.leftImage || character.avatarImage) ? <img src={page.leftImage || character.avatarImage} alt="Left player avatar preview" /> : (character.name || "PL").slice(0, 2).toUpperCase()}
                                                </div>
                                                <small>Defaults to the player avatar.</small>
                                                <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, (leftImage) => updateVnPage(index, { leftImage }), 100); }} />
                                            </div>
                                            <div className="vn-avatar-editor-card">
                                                <span>Right Speaker / Enemy / Narrator</span>
                                                <div className="vn-avatar-editor-preview">
                                                    {(page.rightImage || eventAvatarImage) ? <img src={page.rightImage || eventAvatarImage} alt="Right speaker avatar preview" /> : ((page.rightName || page.speaker || "VN").slice(0, 2).toUpperCase())}
                                                </div>
                                                <small>Upload a page-specific avatar, or use the default right-side avatar above.</small>
                                                <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, (rightImage) => updateVnPage(index, { rightImage }), 100); }} />
                                                <AiImagePrompt label={`Page ${index + 1} Right Avatar`} suggestedPrompt={`${page.rightName || page.speaker || eventVnSpeaker} visual novel portrait`} onImage={(rightImage) => updateVnPage(index, { rightImage })} />
                                            </div>
                                        </div>
                                        {(page.leftImage || page.rightImage) && (
                                            <div className="vn-page-img-preview vn-character-preview-row">
                                                {page.leftImage && <img src={page.leftImage} alt={`${page.leftName || "Left character"} preview`} />}
                                                {page.rightImage && <img src={page.rightImage} alt={`${page.rightName || "Right character"} preview`} />}
                                                <button className="danger-button" onClick={() => updateVnPage(index, { leftImage: "", rightImage: "" })}>Remove Character Images</button>
                                            </div>
                                        )}
                                        <label>Dialogue Lines</label>
                                        <VnDialogueEditor
                                            value={page.dialogue}
                                            onChange={(next) => updateVnPage(index, { dialogue: next })}
                                            cast={[page.leftName ?? "", page.rightName ?? "", page.speaker, eventVnSpeaker]}
                                            idBase={`vnpage-${index}`}
                                        />
                                        <p className="hint" style={{ margin: "2px 0 4px" }}>Leave the speaker blank for narration (uses the page speaker). The first colon in a line splits speaker from text.</p>
                                        <details>
                                            <summary className="hint">Edit as raw text</summary>
                                            <textarea rows={4} value={page.dialogue} onChange={(e) => updateVnPage(index, { dialogue: e.target.value })} />
                                        </details>
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
                                            <p className="hint">Each choice appears as a button after the last dialogue line. Leave empty to auto-advance. Page numbers are 1-based. "Grants trait" records a flag on the player; "show/hide if trait" branches later choices on flags earned earlier in the story.</p>
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
                                                            placeholder="📄 Page"
                                                            value={choice.nextPage + 1}
                                                            onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, nextPage: Math.max(0, Math.min(eventPageCount - 1, Number(e.target.value) - 1)) } : c) })}
                                                        />
                                                        <button className="danger-button" onClick={() => updateVnPage(index, { choices: page.choices.filter((_, i) => i !== ci) })}>🗑️</button>
                                                    </div>
                                                    <textarea
                                                        rows={2}
                                                        placeholder={`Conclusion / answer shown after "${choice.text || `Choice ${ci + 1}`}" is picked (optional)`}
                                                        value={choice.conclusion ?? ""}
                                                        onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, conclusion: e.target.value } : c) })}
                                                    />
                                                    <input
                                                        placeholder="Grants trait when picked (merciful, reckless, suspicious...)"
                                                        value={choice.trait ?? ""}
                                                        onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, trait: e.target.value } : c) })}
                                                    />
                                                    <div className="inline-grid">
                                                        <input
                                                            placeholder="Show only if player has trait (optional)"
                                                            value={choice.requireTrait ?? ""}
                                                            onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, requireTrait: e.target.value } : c) })}
                                                        />
                                                        <input
                                                            placeholder="Hide if player has trait (optional)"
                                                            value={choice.forbidTrait ?? ""}
                                                            onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, forbidTrait: e.target.value } : c) })}
                                                        />
                                                    </div>
                                                    <details className="vn-battle-trigger-editor">
                                                        <summary>Optional Encounter Trigger</summary>
                                                        <label>Fight Type</label>
                                                        <select value={choice.battle?.encounterType ?? "ai"} onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), encounterType: e.target.value as "ai" | "pet" | "tiles" } } : c) })}>
                                                            <option value="ai">AI Fight</option>
                                                            <option value="pet">Pet Battle</option>
                                                            <option value="tiles">Shinobi Card Clash</option>
                                                        </select>
                                                        <label>Difficulty</label>
                                                        <select value={choice.battle?.difficulty ?? "normal"} onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), difficulty: e.target.value as "easy" | "normal" | "hard" | "impossible" } } : c) })}>
                                                            <option value="easy">Easy</option>
                                                            <option value="normal">Normal</option>
                                                            <option value="hard">Hard</option>
                                                            <option value="impossible">Impossible</option>
                                                        </select>
                                                        <div className="inline-grid">
                                                            <input placeholder="Boss name" value={choice.battle?.bossName ?? ""} onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), bossName: e.target.value } } : c) })} />
                                                            <input placeholder="Boss icon" value={choice.battle?.bossIcon ?? ""} onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), bossIcon: e.target.value } } : c) })} />
                                                            <input type="number" placeholder="Boss HP" value={choice.battle?.bossHp ?? ""} onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), bossHp: Number(e.target.value) } } : c) })} />
                                                            <input type="number" placeholder="Boss damage" value={choice.battle?.bossDamage ?? ""} onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), bossDamage: Number(e.target.value) } } : c) })} />
                                                        </div>
                                                        <label>AI Profile</label>
                                                        <select value={choice.battle?.aiProfileId ?? ""} onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), aiProfileId: e.target.value || undefined } } : c) })}>
                                                            <option value="">Use VN AI</option>
                                                            {allAdminAis.map((ai) => <option key={ai.id} value={ai.id}>{ai.name} | Level {ai.level}</option>)}
                                                        </select>
                                                        <label>Pet Opponent</label>
                                                        <select value={choice.battle?.petId ?? ""} onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), petId: e.target.value || undefined } } : c) })}>
                                                            <option value="">First available pet</option>
                                                            {editablePets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name} | {pet.rarity} Lv.{pet.level}</option>)}
                                                        </select>
                                                        <label>Shinobi Tile Difficulty</label>
                                                        <select value={choice.battle?.tileDifficulty ?? "normal"} onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), tileDifficulty: e.target.value as "easy" | "normal" | "hard" } } : c) })}>
                                                            <option value="easy">Easy</option>
                                                            <option value="normal">Normal</option>
                                                            <option value="hard">Hard</option>
                                                        </select>
                                                        <label>Encounter Background / Story Image</label>
                                                        <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, (backgroundImage) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), backgroundImage } } : c) }), 100); }} />
                                                        {choice.battle?.backgroundImage && <div className="vn-page-img-preview"><img src={choice.battle.backgroundImage} alt="Encounter background preview" /><button className="danger-button" onClick={() => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), backgroundImage: "" } } : c) })}>Remove Encounter Image</button></div>}
                                                        <div className="inline-grid">
                                                            <input type="number" placeholder="Reward XP" value={choice.battle?.xpReward ?? ""} onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), xpReward: Number(e.target.value) } } : c) })} />
                                                            <input type="number" placeholder="Reward Ryo" value={choice.battle?.ryoReward ?? ""} onChange={(e) => updateVnPage(index, { choices: page.choices.map((c, i) => i === ci ? { ...c, battle: { ...(c.battle ?? {}), ryoReward: Number(e.target.value) } } : c) })} />
                                                        </div>
                                                    </details>
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
                            {(() => {
                                const flowPages = eventVnPages.slice(0, eventPageCount);
                                // Reachability + authoring warnings come from the pure, unit-tested
                                // analyzeVnFlow helper so the editor and its tests stay in lockstep.
                                const { reachable, warnings } = analyzeVnFlow(flowPages);
                                const reachableSet = new Set(reachable);
                                return (
                                    <div className="summary-box">
                                        <h5 style={{ margin: "0 0 0.3rem" }}>Story flow {warnings.length === 0 ? "✓ no issues" : `— ${warnings.length} warning${warnings.length > 1 ? "s" : ""}`}</h5>
                                        <ol className="hint" style={{ margin: 0, paddingLeft: "1.2rem" }}>
                                            {flowPages.map((p, i) => {
                                                const picks = (p.choices ?? []).filter((c) => c.text.trim());
                                                return (
                                                    <li key={i} style={{ opacity: reachableSet.has(i) ? 1 : 0.45 }}>
                                                        <button
                                                            type="button"
                                                            title="Jump to this page in the editor"
                                                            onClick={() => document.getElementById(`admin-vn-page-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                                                            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit", textAlign: "left" }}
                                                        >
                                                            <strong>{p.title?.trim() || `Page ${i + 1}`}</strong>
                                                            {picks.length === 0
                                                                ? (i + 1 < flowPages.length ? ` → page ${i + 2}` : " → battle / finale")
                                                                : `: ${picks.map((c) => `“${c.text.trim()}” → p${c.nextPage + 1}${c.battle ? " ⚔" : ""}${c.requireTrait ? ` (if ${c.requireTrait})` : ""}${c.forbidTrait ? ` (unless ${c.forbidTrait})` : ""}${c.trait ? ` [+${c.trait}]` : ""}`).join("  ·  ")}`}
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ol>
                                        {warnings.length > 0 && (
                                            <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>
                                                {warnings.map((msg, i) => <li key={i} className="hint" style={{ color: "#fcd34d" }}>{msg}</li>)}
                                            </ul>
                                        )}
                                    </div>
                                );
                            })()}
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
                                    ▶️ Play Preview
                                </button>
                                <button
                                    style={{ background: "#2e4a1e", borderColor: "#a5d6a7" }}
                                    onClick={async () => {
                                        const petVn = eventFromForm("sys-pet-encounter");
                                        setPetEncounterVn(petVn);
                                        await publishEventPageImages(petVn, "pet-encounter");
                                        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
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
                                    👁️ Preview Pet VN
                                </button>
                                <button onClick={() => { setPetEncounterVn(defaultPetEncounterVn); alert("Pet Encounter VN reset to default."); }}>Reset to Default</button>
                            </div>
                        </section>

                        <section className="summary-box">
                            <h4>📦 Ancient Chest VN (System)</h4>
                            <p className="hint">This VN plays when a player opens an ancient chest. Load it above, edit, then click "Save as Ancient Chest VN".</p>
                            <p><strong>{ancientChestVn.vnTitle || ancientChestVn.name}</strong> — {ancientChestVn.vnPages?.length ?? 1} page(s)</p>
                            {ancientChestVn.vnPages?.map((page, i) => (
                                <div key={i} className="summary-box" style={{ marginBottom: "0.4rem" }}>
                                    <strong>Page {i + 1}: {page.title}</strong>
                                    <p style={{ color: "#aaa", fontSize: 12 }}>{page.scene}</p>
                                </div>
                            ))}
                            <div className="menu">
                                <button onClick={() => loadAdminEvent(ancientChestVn)}>Load for Editing</button>
                                <button
                                    style={{ background: "#2e4a1e", borderColor: "#a5d6a7" }}
                                    onClick={async () => {
                                        const chestVn = eventFromForm("sys-ancient-chest");
                                        setAncientChestVn(chestVn);
                                        await publishEventPageImages(chestVn, "ancient-chest");
                                        setTimeout(() => { onSaveRef.current().catch(() => {}); }, 150);
                                        alert("Ancient Chest VN saved! Players will see this scene when they open ancient chests.");
                                    }}
                                >
                                    💾 Save as Ancient Chest VN
                                </button>
                                <button
                                    style={{ background: "#1e3a5f", borderColor: "#60a5fa" }}
                                    onClick={() => {
                                        setPreviewVn(ancientChestVn);
                                        setPreviewVnPage(0);
                                        setPreviewVnLine(0);
                                    }}
                                >
                                    ▶️ Preview Chest VN
                                </button>
                                <button onClick={() => { setAncientChestVn(defaultAncientChestVn); alert("Ancient Chest VN reset to default."); }}>Reset to Default</button>
                            </div>
                        </section>
                    </div>
                </div>
            )}

            {/* -- VN Preview Overlay ----------------------------------- */}
            {previewVn && (
                <div className="vn-preview-overlay">
                    <div className="vn-preview-modal">
                        <div className="vn-preview-topbar">
                            <span className="vn-preview-label">👁️ Preview Mode — this is how players will see it</span>
                            <button className="danger-button" onClick={() => setPreviewVn(null)}>✖️ Close Preview</button>
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
                            onBattle={() => setPreviewVn(null)}
                            sharedImages={sharedImages}
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
                                <input placeholder="🔍 Filter AIs by name / village / level…" value={aiFindQuery} onChange={(e) => setAiFindQuery(e.target.value)} style={{ marginBottom: 6 }} />
                                <select value={selectedAdminAiProfile?.id ?? ""} onChange={(e) => setSelectedAiId(e.target.value)}>
                                    {allAdminAis
                                        .filter((ai) => { const q = aiFindQuery.trim().toLowerCase(); return !q || ai.id === selectedAiId || `${ai.name} ${ai.village} lv${ai.level}`.toLowerCase().includes(q); })
                                        .map((ai) => <option key={ai.id} value={ai.id}>{ai.name} | Level {ai.level} | {ai.rules.length} rules{builtinAis.some((builtin) => builtin.id === ai.id) ? " | Built-in" : ""}</option>)}
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
                        <label>AI Type</label>
                        <select value={aiIsBoss ? "boss" : "normal"} onChange={(e) => setAiIsBoss(e.target.value === "boss")}>
                            <option value="normal">Normal AI — available in ambush, arena, and raid fights</option>
                            <option value="boss">Boss AI — only usable in dungeons, VN events, and boss fights</option>
                        </select>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", cursor: "pointer", padding: "0.5rem 0.6rem", background: aiMasterAi ? "rgba(250, 204, 21, 0.15)" : "rgba(15, 23, 42, 0.3)", border: `1px solid ${aiMasterAi ? "#facc15" : "#334155"}`, borderRadius: 6 }}>
                            <input type="checkbox" checked={aiMasterAi} onChange={(e) => setAiMasterAi(e.target.checked)} style={{ width: 18, height: 18, cursor: "pointer" }} />
                            <span>
                                <strong style={{ color: aiMasterAi ? "#facc15" : "#e2e8f0" }}>🧠 Master AI</strong>
                                <span style={{ display: "block", fontSize: "0.82rem", color: "#94a3b8", marginTop: 2 }}>
                                    Force the smart battle AI regardless of level — lethal detection, DoT-aware KO, no-redundant status, full game jutsu pool, multi-axis tactical scoring. Useful for elite low-level mobs that should play to win.
                                </span>
                            </span>
                        </label>
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
                        <div className="summary-box ai-preset-card">
                            <strong>Level Tuning</strong>
                            <p>Sets HP, resources, stats, and damage reduction to match the AI level. Save the profile after applying.</p>
                            <button onClick={applyLevelScaledAiTuning}>Apply Level-Scaled Tuning</button>
                        </div>
                        <div className="stat-grid">
                            {Object.entries(aiStats).map(([stat, value]) => (
                                <div className="summary-box stat-card" key={stat}>
                                    <label>{stat}</label>
                                    <input type="number" value={value} onChange={(e) => updateAiStat(stat as keyof Stats, Number(e.target.value))} />
                                </div>
                            ))}
                        </div>

                        <h4>AI Jutsus</h4>
                        <div className="summary-box ai-preset-card">
                            <strong>AI Jutsu Loadout</strong>
                            <p>Choose a ready-made loadout. This replaces the AI jutsus and rebuilds its rules for that fighting style.</p>
                            <div className="inline-grid">
                                <select value={aiLoadoutId} onChange={(e) => setAiLoadoutId(e.target.value as AiLoadoutId)}>
                                    {(Object.keys(aiLoadoutLabels) as AiLoadoutId[]).map((loadoutId) => (
                                        <option key={loadoutId} value={loadoutId}>{aiLoadoutLabels[loadoutId]}</option>
                                    ))}
                                </select>
                                <button onClick={() => applyAiJutsuLoadout(aiLoadoutId)}>Apply Loadout</button>
                            </div>
                        </div>
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

                    {/* -- AI Bulk Image Generator -- */}
                    <section className="summary-box bulk-image-section">
                        <div className="bulk-image-header" onClick={() => setAiBulkShowSection(v => !v)}>
                            <span>🖼️ Bulk AI Image Generator</span>
                            <span className="bulk-image-chevron">{aiBulkShowSection ? "?" : "?"}</span>
                        </div>

                        {aiBulkShowSection && (() => {
                            const visibleAis = aiBulkSkipExisting
                                ? allAdminAis.filter(a => !a.image)
                                : allAdminAis;
                            const selectedCount = aiBulkSelections.length;
                            const pct = aiBulkProgress ? Math.round((aiBulkProgress.current / aiBulkProgress.total) * 100) : 0;

                            return (
                                <div className="bulk-image-body">
                                    {/* Options row */}
                                    <div className="bulk-image-opts">
                                        <label className="bulk-image-toggle">
                                            <input
                                                type="checkbox"
                                                checked={aiBulkSkipExisting}
                                                onChange={e => { setAiBulkSkipExisting(e.target.checked); setAiBulkSelections([]); }}
                                            />
                                            Show only AIs without images
                                        </label>
                                        <div className="bulk-image-quickbtns">
                                            <button
                                                className="bulk-quick-btn"
                                                disabled={aiBulkRunning}
                                                onClick={() => setAiBulkSelections(visibleAis.map(a => a.id))}
                                            >Select All ({visibleAis.length})</button>
                                            <button
                                                className="bulk-quick-btn"
                                                disabled={aiBulkRunning}
                                                onClick={() => setAiBulkSelections(allAdminAis.filter(a => !a.image).map(a => a.id))}
                                            >No Image Only</button>
                                            <button
                                                className="bulk-quick-btn"
                                                disabled={aiBulkRunning}
                                                onClick={() => setAiBulkSelections([])}
                                            >Deselect All</button>
                                        </div>
                                    </div>

                                    {/* AI list */}
                                    <div className="bulk-card-list">
                                        {visibleAis.length === 0 && (
                                            <p className="hint" style={{ padding: "8px 0" }}>All AI profiles already have images.</p>
                                        )}
                                        {visibleAis.map(ai => {
                                            const checked = aiBulkSelections.includes(ai.id);
                                            const customPrompt = aiBulkCustomPrompts[ai.id] ?? "";
                                            const isBuiltin = builtinAis.some(b => b.id === ai.id);
                                            return (
                                                <div key={ai.id} className={`bulk-card-row${checked ? " bulk-card-row--checked" : ""}`}>
                                                    <label className="bulk-card-check">
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            disabled={aiBulkRunning}
                                                            onChange={e => setAiBulkSelections(e.target.checked
                                                                ? [...aiBulkSelections, ai.id]
                                                                : aiBulkSelections.filter(id => id !== ai.id))}
                                                        />
                                                    </label>
                                                    {ai.image
                                                        ? <img src={ai.image} alt={ai.name} className="bulk-card-thumb" />
                                                        : <div className="bulk-card-thumb bulk-card-thumb--empty">{ai.icon || "?"}</div>
                                                    }
                                                    <div className="bulk-card-info">
                                                        <span className="bulk-card-name">{ai.name}</span>
                                                        <span className="bulk-card-element">Lv {ai.level}</span>
                                                        {ai.village && <span className="bulk-card-element">{ai.village}</span>}
                                                        {isBuiltin && <span className="bulk-card-has-img">📌 built-in</span>}
                                                        {ai.image && <span className="bulk-card-has-img">🖼️ has image</span>}
                                                    </div>
                                                    {checked && (
                                                        <input
                                                            className="bulk-card-prompt-input"
                                                            placeholder={`Auto: "${ai.name}, ${ai.village || "shinobi"} arena opponent portrait..."`}
                                                            value={customPrompt}
                                                            disabled={aiBulkRunning}
                                                            onChange={e => setAiBulkCustomPrompts(prev => ({ ...prev, [ai.id]: e.target.value }))}
                                                        />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Progress bar */}
                                    {aiBulkProgress && (
                                        <div className="bulk-progress-wrap">
                                            <div className="bulk-progress-label">
                                                Generating <strong>{aiBulkProgress.aiName}</strong> ({aiBulkProgress.current}/{aiBulkProgress.total})
                                            </div>
                                            <div className="bulk-progress-track">
                                                <div className="bulk-progress-fill" style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                    )}

                                    {/* Errors */}
                                    {aiBulkErrors.length > 0 && (
                                        <div className="bulk-error-list">
                                            <strong style={{ color: "#f87171" }}>Errors ({aiBulkErrors.length}):</strong>
                                            {aiBulkErrors.map(e => (
                                                <div key={e.id} className="bulk-error-row">❌ <strong>{e.name}</strong>: {e.error}</div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Generate button */}
                                    <div className="menu" style={{ marginTop: 10 }}>
                                        <button
                                            className="bulk-generate-btn"
                                            disabled={aiBulkRunning || selectedCount === 0}
                                            onClick={runBulkAiGeneration}
                                        >
                                            {aiBulkRunning
                                                ? `⏳ Generating… ${aiBulkProgress ? `${aiBulkProgress.current}/${aiBulkProgress.total}` : ""}`
                                                : `🎨 Generate Images for ${selectedCount} AI${selectedCount !== 1 ? "s" : ""}`}
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </section>

                    {/* ── Weekly Boss Override ── */}
                    <h3>Weekly Boss</h3>
                    <section className="summary-box">
                        <p className="hint">
                            The weekly boss is <strong>admin-spawned only</strong>. Pick a Boss AI as the override, then hit
                            <strong> Spawn Now</strong> to summon it. The boss runs for 24h then auto-distributes rewards
                            (Top 10 → Weekly Boss Core, Top 25 → Dungeon Key, MVP → 2× ryo/XP). Spawning again before
                            24h overwrites the active boss and wipes its leaderboard. Only AIs marked as <strong>Boss AI</strong>
                            appear here.
                        </p>
                        {(() => {
                            const bossAis = allAdminAis.filter(ai => ai.isBossAi);
                            const currentOverride = allAdminAis.find(ai => ai.id === sharedWeeklyBossAiIdCache);
                            const selectedBossAi = bossAis.find(ai => ai.id === adminWeeklyBossAiId);
                            return (
                                <>
                                    {currentOverride ? (
                                        <div className="weekly-boss-current">
                                            <span>Current override:</span>
                                            <strong>{currentOverride.icon} {currentOverride.name}</strong>
                                            <small>Lv {currentOverride.level}</small>
                                        </div>
                                    ) : (
                                        <p className="hint">No override — using seeded weekly rotation.</p>
                                    )}
                                    {bossAis.length === 0 ? (
                                        <p className="hint">No Boss AIs saved yet. Create an AI and set its type to Boss AI.</p>
                                    ) : (
                                        <div className="inline-grid">
                                            <div>
                                                <label>Select Boss AI</label>
                                                <select value={adminWeeklyBossAiId} onChange={(e) => setAdminWeeklyBossAiId(e.target.value)}>
                                                    <option value="">— choose —</option>
                                                    {bossAis.map(ai => (
                                                        <option key={ai.id} value={ai.id}>{ai.icon} {ai.name} | Lv {ai.level}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                    <div className="menu">
                                        <button
                                            disabled={!selectedBossAi}
                                            onClick={() => {
                                                if (!selectedBossAi) return;
                                                persistSharedGameState({ kind: "weeklyBossOverride", aiId: selectedBossAi.id });
                                                setSharedWeeklyBossAiId(selectedBossAi.id);
                                                alert(`Override set to ${selectedBossAi.name}. Hit "Spawn Now" to summon it.`);
                                            }}
                                        >
                                            Set as Override
                                        </button>
                                        <button
                                            style={{ background: "linear-gradient(135deg, #b45309, #facc15)", color: "#1c1917", fontWeight: 700 }}
                                            onClick={async () => {
                                                // Calls the existing /api/weekly-boss reset endpoint
                                                // (admin-only). Server reads the override key inside
                                                // buildFreshBossState and spawns whatever AI is set,
                                                // overwriting any active boss. No-op if no AI
                                                // override is set AND no fallback boss list exists.
                                                try {
                                                    const r = await fetch("/api/weekly-boss", {
                                                        method: "POST",
                                                        headers: { "Content-Type": "application/json" },
                                                        body: JSON.stringify({ kind: "reset" }),
                                                    });
                                                    const data = await r.json();
                                                    if (!r.ok) {
                                                        alert(`Spawn failed: ${data?.error ?? "unknown error"}`);
                                                        return;
                                                    }
                                                    alert(`Boss spawned: ${data?.boss?.bossName ?? data?.boss?.aiId ?? "(unnamed)"}. 24h timer started.`);
                                                } catch (err) {
                                                    alert(`Spawn failed: ${err instanceof Error ? err.message : "network error"}`);
                                                }
                                            }}
                                        >
                                            🪄 Spawn Now
                                        </button>
                                        <button
                                            className="danger-button"
                                            disabled={!sharedWeeklyBossAiIdCache}
                                            onClick={() => {
                                                persistSharedGameState({ kind: "weeklyBossOverride", aiId: null });
                                                setSharedWeeklyBossAiId("");
                                                setAdminWeeklyBossAiId("");
                                                alert("Override cleared. Spawn Now will fall back to a random boss AI.");
                                            }}
                                        >
                                            Clear Override
                                        </button>
                                    </div>
                                </>
                            );
                        })()}
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
                        renderActions={(jutsu) => {
                            const deletable = creatorJutsus.some((created) => created.id === jutsu.id)
                                || savedBloodlines.some((bloodline) => bloodline.jutsus.some((blJutsu) => blJutsu.id === jutsu.id));
                            return (
                                <>
                                    <button onClick={() => loadAdminJutsu(jutsu)}>Load In Editor</button>
                                    {deletable && <button className="danger-button" onClick={() => deleteAdminJutsu(jutsu.id)}>Delete</button>}
                                    <button onClick={() => updateCharacter({ ...character, equippedJutsuIds: [...new Set([...character.equippedJutsuIds, jutsu.id])].slice(0, 15) })}>Equip</button>
                                </>
                            );
                        }}
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

                        {isWeaponSlot && (
                            <>
                                <label>Weapon Element Lock (optional)</label>
                                <select value={itemWeaponElement} onChange={(e) => setItemWeaponElement(e.target.value as JutsuElement | "")}>
                                    <option value="">— None (no lock) —</option>
                                    {jutsuElements.map((el) => <option key={el} value={el}>{el}</option>)}
                                </select>

                                <label>Weapon Range Override (blank = default)</label>
                                <input type="number" min={1} max={10} value={itemWeaponRange} placeholder="e.g. 4"
                                    onChange={(e) => setItemWeaponRange(e.target.value === "" ? "" : Number(e.target.value))} />

                                <label>Weapon Cooldown (rounds, 0 = none)</label>
                                <input type="number" min={0} max={20} value={itemWeaponCooldown} placeholder="e.g. 5"
                                    onChange={(e) => setItemWeaponCooldown(e.target.value === "" ? "" : Number(e.target.value))} />

                                <label>Weapon Fixed EP (blank = stat-computed)</label>
                                <input type="number" min={1} max={200} value={itemWeaponEp} placeholder="e.g. 60"
                                    onChange={(e) => setItemWeaponEp(e.target.value === "" ? "" : Number(e.target.value))} />

                                <label>Weapon Special Effect (optional)</label>
                                <select value={itemWeaponEffect ?? ""} onChange={(e) => setItemWeaponEffect(e.target.value as GameItem["weaponEffect"] | "")}>
                                    <option value="">— None —</option>
                                    <option value="Absorb">Absorb</option>
                                    <option value="Lifesteal">Lifesteal</option>
                                    <option value="Reflect">Reflect</option>
                                    <option value="Increase Damage Given">Increase Damage Given</option>
                                    <option value="Decrease Damage Given">Decrease Damage Given</option>
                                    <option value="Shield">Shield (flat HP)</option>
                                </select>

                                <label>Effect Value (% for most; flat HP for Shield)</label>
                                <input type="number" min={0} max={1000} value={itemWeaponEffectValue} placeholder="e.g. 30"
                                    onChange={(e) => setItemWeaponEffectValue(e.target.value === "" ? "" : Number(e.target.value))} />
                            </>
                        )}

                        <label>Cost</label>
                        <input type="number" value={itemCost} onChange={(e) => setItemCost(Number(e.target.value))} />

                        <label>Description</label>
                        <textarea value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />

                        <label>Flavor Text / Lore</label>
                        <textarea value={itemFlavorText} onChange={(e) => setItemFlavorText(e.target.value)} placeholder="Optional italic flavor quote shown on the item card (e.g. a named weapon's legend)." />

                        <label>Item Image</label>
                        <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; readImageFile(file, applyItemImage, 25); }} />
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

                        {/* -- Bulk Item Image Generator -- */}
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
                                        <span>🖼️ Bulk Image Generator — Items / Armor / Weapons</span>
                                        <span className="bulk-image-chevron">{itemBulkShowSection ? "?" : "?"}</span>
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
                                                                : <div className="bulk-card-thumb bulk-card-thumb--empty">🖼️</div>
                                                            }
                                                            <div className="bulk-card-info">
                                                                <span className="bulk-card-name">{item.name}</span>
                                                                <span className="bulk-card-rarity" style={{ background: rc + "22", color: rc, border: `1px solid ${rc}44` }}>
                                                                    {item.rarity}
                                                                </span>
                                                                <span className="bulk-card-element">{slotLabel}</span>
                                                                {item.image && <span className="bulk-card-has-img">🖼️ has image</span>}
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
                                                <button
                                                    disabled={itemBulkRunning}
                                                    onClick={async () => {
                                                        setItemBulkRunning(true);
                                                        try {
                                                            const r = await fetch("/api/images?cat=item");
                                                            const registry = r.ok ? await r.json() as Record<string, string> : {};
                                                            const entries = Object.entries(registry);
                                                            if (entries.length === 0) { alert("No shared item images found."); setItemBulkRunning(false); return; }
                                                            let done = 0;
                                                            for (const [key, raw] of entries) {
                                                                try {
                                                                    const compressed = await compressDataUrl(raw, 512, 0.82);
                                                                    publishSharedImage(key, compressed);
                                                                    const itemId = key.replace(/^item:/, "");
                                                                    setCreatorItems(creatorItems.map(i => i.id === itemId ? { ...i, image: compressed } : i));
                                                                } catch { /* skip */ }
                                                                done++;
                                                            }
                                                            alert(`Recompressed ${done} item image(s).`);
                                                        } catch { alert("Error fetching images."); }
                                                        setItemBulkRunning(false);
                                                    }}
                                                >
                                                    🗜️ Recompress All Existing Item Images
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        <h4>All Items</h4>
                        <input placeholder="🔍 Filter items by name / slot / rarity…" value={itemLibQuery} onChange={(e) => setItemLibQuery(e.target.value)} style={{ marginBottom: 6 }} />
                        {getAllItems(creatorItems).filter((item) => { const q = itemLibQuery.trim().toLowerCase(); return !q || `${item.name} ${equipmentSlotLabel(item.slot)} ${item.rarity}`.toLowerCase().includes(q); }).map((item) => {
                            const isCreator = creatorItems.some((c) => c.id === item.id);
                            return (
                                <div className={`equipment-item rarity-${item.rarity}`} key={item.id}
                                    style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                                    {item.image
                                        ? <img src={item.image} alt={item.name}
                                            style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, flexShrink: 0, border: "1px solid #334155" }} />
                                        : <div style={{ width: 48, height: 48, borderRadius: 6, background: "#0f172a", border: "1px dashed #334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🖼️</div>
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
                                        <button
                                            onClick={() => {
                                                updateCharacter(addItem(character, item.id, 1));
                                                alert(`${item.name} added to your inventory.`);
                                            }}
                                        >
                                            Give to Me
                                        </button>
                                        <button
                                            className="danger-button"
                                            onClick={() => deleteAdminItem(item)}
                                        >
                                            Delete
                                        </button>
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
                        <label>Lore</label><textarea rows={3} value={bloodlineEditLore} onChange={(e) => setBloodlineEditLore(e.target.value)} placeholder="Describe what this bloodline is, where it comes from, or what makes it special." />
                        <label>Bloodline Image URL</label><input value={bloodlineEditImage} onChange={(e) => applyBloodlineImage(e.target.value)} />
                        <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) readImageFile(file, applyBloodlineImage, 25); }} />
                        {bloodlineEditImage && <div className="admin-event-list-preview"><img src={bloodlineEditImage} alt="Bloodline preview" /></div>}
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
                                        {!selectedBloodline.image && <AiImagePrompt label="Bloodline Image" suggestedPrompt={`${selectedBloodline.name} ${selectedBloodline.specialElement || "chakra"} ${selectedBloodline.rank} bloodline kekkei genkai clan eye art`} onImage={(img) => { void compressDataUrl(img, 512, 0.82).then((image) => { publishSharedImage('bloodline:' + selectedBloodline.id, image); setSavedBloodlines(savedBloodlines.map((b) => b.id === selectedBloodline.id ? { ...b, image } : b)); }); }} />}
                                        <div className="menu">
                                            <button onClick={() => loadAdminBloodline(selectedBloodline)}>Edit Bloodline</button>
                                            {savedBloodlines.some((candidate) => candidate.id === selectedBloodline.id) ? (
                                                <button className="danger-button" onClick={() => deleteAdminSavedBloodline(selectedBloodline)}>Delete</button>
                                            ) : (selectedBloodline as ReviewBloodline).ownerKey && (selectedBloodline as ReviewBloodline).ownerKey !== "admin" ? (
                                                <button className="danger-button" onClick={() => pmDeleteBloodline(selectedBloodline as ReviewBloodline)}>Delete From Player Save</button>
                                            ) : null}
                                        </div>
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
                            const bloodlineImageMap: Record<string, string> = {};
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
                                        const image = await compressDataUrl(data.image as string);
                                        const withImage = { ...jutsu, image };
                                        const idx = updated.findIndex((c) => c.id === jutsu.id);
                                        if (idx >= 0) { updated[idx] = withImage; } else { updated = [...updated, withImage]; }
                                        bloodlineImageMap[jutsu.id] = image;
                                        publishSharedImage('jutsu:' + jutsu.id, image);
                                    }
                                } catch { /* skip */ }
                                done++;
                            }
                            setCreatorJutsus(updated);
                            // Patch generated images onto bloodline jutsus too
                            if (Object.keys(bloodlineImageMap).length > 0) {
                                setSavedBloodlines(savedBloodlines.map((b: SavedBloodline) => ({
                                    ...b,
                                    jutsus: b.jutsus.map((j: Jutsu) =>
                                        bloodlineImageMap[j.id] ? { ...j, image: bloodlineImageMap[j.id] } : j),
                                })));
                            }
                            setJutsuIsGenerating(false);
                            setJutsuGenStatus(`Done! Generated images for ${done} jutsu(s).`);
                            try { await onSaveRef.current(); } catch { /* ignore if no account */ }
                        }}>
                            {jutsuIsGenerating ? "Generating..." : "Generate All Missing Jutsu Images"}
                        </button>
                        {jutsuGenStatus && <p className="hint" style={{ color: "#a5d6a7", marginTop: "0.4rem" }}>{jutsuGenStatus}</p>}

                        <hr style={{ margin: "12px 0", borderColor: "rgba(255,255,255,0.1)" }} />
                        <p className="hint">Recompress already-saved jutsu images to ~512 px JPEG to reduce storage size.</p>
                        <button disabled={jutsuIsGenerating} onClick={async () => {
                            setJutsuIsGenerating(true);
                            setJutsuGenStatus("Fetching existing jutsu images…");
                            try {
                                const r = await fetch("/api/images?cat=jutsu");
                                const registry = r.ok ? await r.json() as Record<string, string> : {};
                                const entries = Object.entries(registry);
                                if (entries.length === 0) { setJutsuGenStatus("No shared jutsu images found."); setJutsuIsGenerating(false); return; }
                                let done = 0;
                                const updatedJutsus = [...creatorJutsus];
                                for (const [key, raw] of entries) {
                                    setJutsuGenStatus(`Compressing ${key}… (${done + 1}/${entries.length})`);
                                    try {
                                        const compressed = await compressDataUrl(raw, 512, 0.82);
                                        publishSharedImage(key, compressed);
                                        const jutsuId = key.replace(/^jutsu:/, "");
                                        const idx = updatedJutsus.findIndex(j => j.id === jutsuId);
                                        if (idx >= 0) updatedJutsus[idx] = { ...updatedJutsus[idx], image: compressed };
                                    } catch { /* skip */ }
                                    done++;
                                }
                                setCreatorJutsus(updatedJutsus);
                                setJutsuGenStatus(`Done! Recompressed ${done} jutsu image(s).`);
                            } catch { setJutsuGenStatus("Error fetching images."); }
                            setJutsuIsGenerating(false);
                        }}>
                            {jutsuIsGenerating ? "Working…" : "Recompress All Existing Jutsu Images"}
                        </button>
                    </section>

                    <section className="summary-box">
                        <h4>Bulk Bloodline Image Generation</h4>
                        <p className="hint">Generates AI images for all bloodlines that don't have an image yet.</p>
                        <p className="hint">Bloodlines without images: <strong>{adminPanelBloodlines.filter((b) => !b.image).length}</strong> / {adminPanelBloodlines.length}</p>
                        <button disabled={jutsuIsGenerating} onClick={async () => {
                            const missing = adminPanelBloodlines.filter((b) => !b.image);
                            if (missing.length === 0) { setJutsuGenStatus("All bloodlines already have images!"); return; }
                            setJutsuIsGenerating(true);
                            let done = 0;
                            for (const bl of missing) {
                                setJutsuGenStatus(`Generating bloodline ${bl.name}... (${done + 1}/${missing.length})`);
                                try {
                                    const res = await fetch("/api/generate-image", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ prompt: `${bl.name} ${bl.specialElement || "chakra"} ${bl.rank} bloodline kekkei genkai clan eye art`, label: "Bloodline Image" }),
                                    });
                                    if (res.ok) {
                                        const data = await res.json();
                                        const image = await compressDataUrl(data.image as string);
                                        publishSharedImage('bloodline:' + bl.id, image);
                                        setSavedBloodlines((prev: SavedBloodline[]) => prev.map((b) => b.id === bl.id ? { ...b, image } : b));
                                    }
                                } catch { /* skip */ }
                                done++;
                            }
                            setJutsuIsGenerating(false);
                            setJutsuGenStatus(`Done! Generated images for ${done} bloodline(s).`);
                            try { await onSaveRef.current(); } catch { /* ignore */ }
                        }}>
                            {jutsuIsGenerating ? "Generating..." : "Generate All Missing Bloodline Images"}
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
                const galleryVns: { id: string; label: string; pages: { title: string; image?: string }[]; isPet?: boolean; isChest?: boolean }[] = [];
                if (petEncounterVn.vnPages?.length) {
                    galleryVns.push({ id: "sys-pet-encounter", label: "🐾 Pet Encounter VN", pages: petEncounterVn.vnPages, isPet: true });
                }
                if (ancientChestVn.vnPages?.length) {
                    galleryVns.push({ id: "sys-ancient-chest", label: "📦 Ancient Chest VN", pages: ancientChestVn.vnPages, isChest: true });
                }
                sortedEditableEvents
                    .filter((ev) => (ev.eventKind ?? "reward") === "visualNovel")
                    .forEach((ev) => {
                        if (ev.vnPages?.length) {
                            galleryVns.push({ id: ev.id, label: `${ev.icon ?? ""} ${ev.name}`, pages: ev.vnPages });
                        }
                    });
                if (galleryVns.length === 0) return null;
                function gallerySetImage(vn: typeof galleryVns[number], pi: number, img: string) {
                    if (vn.isPet) setPetVnPageImage(pi, img);
                    else if (vn.isChest) setAncientChestVnPageImage(pi, img);
                    else setVnPageImage(vn.id, pi, img);
                }
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
                                                        readImageFile(file, (img) => gallerySetImage(vn, pi, img), 100);
                                                    }} />
                                                </label>
                                                <AiImagePrompt label="" suggestedPrompt={`${page.title} visual novel scene`} onImage={(img) => gallerySetImage(vn, pi, img)} />
                                                {character.avatarImage && (
                                                    <button onClick={() => gallerySetImage(vn, pi, character.avatarImage!)}>Avatar</button>
                                                )}
                                                {page.image && (
                                                    <button className="danger-button" onClick={() => gallerySetImage(vn, pi, "")}>Remove</button>
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
                        <p>Edit pet names, stats, rarity, jutsus, descriptions, and upload pet photos. Wild explore rolls include standard, rare, legendary, and mythic pets. The 5 starters and their evolved forms are grouped under 🔒 Starters &amp; Evolutions and never spawn in the wild.</p>
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
                                // Wild pets only — starters & their evolutions are
                                // listed in their own locked group below.
                                const petsOfRarity = editablePets.filter((pet) => pet.rarity === rarity && isWildSpawnable(pet));

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
                            {(() => {
                                // Locked group: the 5 starters + their 10 evolved
                                // templates. Editable/imageable here but excluded
                                // from every wild encounter (isWildSpawnable).
                                const locked = editablePets.filter((pet) => !isWildSpawnable(pet));
                                if (locked.length === 0) return null;
                                return (
                                    <optgroup label="🔒 STARTERS & EVOLUTIONS — never wild">
                                        {locked.map((pet) => (
                                            <option key={pet.id} value={pet.id}>
                                                {pet.name} | {pet.rarity} | LVL {pet.level}
                                            </option>
                                        ))}
                                    </optgroup>
                                );
                            })()}
                        </select>

                        {/* Avatar overview — see every pet's avatar at a glance (amber =
                            missing) and jump straight to one to change it. The "Change"
                            button selects the pet so the editor below (upload + AI
                            generate) targets it. Handy for fixing avatars before a
                            battle-sprite pass. */}
                        <details open style={{ marginTop: 8 }}>
                            <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 6 }}>
                                Avatars — {editablePets.filter((p) => !(pinnedAvatars["pet:" + p.id] || p.image || sharedImages["pet:" + p.id] || sharedImages["pet:" + p.id.replace(/-\d{10,}$/, "")])).length} missing of {editablePets.length}
                            </summary>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 360, overflowY: "auto", padding: 4 }}>
                                {editablePets.map((p) => {
                                    const baseId = p.id.replace(/-\d{10,}$/, "");
                                    const img = pinnedAvatars["pet:" + p.id] || p.image || sharedImages["pet:" + p.id] || sharedImages["pet:" + baseId] || "";
                                    const selected = p.id === selectedPetId;
                                    return (
                                        <div key={p.id} style={{ width: 92, textAlign: "center", border: selected ? "2px solid #8b5cf6" : img ? "1px solid #334155" : "1px solid #b45309", borderRadius: 8, padding: 6, background: "#0f172a" }}>
                                            <div style={{ width: 72, height: 72, margin: "0 auto", borderRadius: 8, overflow: "hidden", display: "grid", placeItems: "center", background: "#1e293b" }}>
                                                {img ? <img src={img} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "#f59e0b" }}>no image</span>}
                                            </div>
                                            <div style={{ fontSize: "0.66rem", color: "#cbd5e1", margin: "4px 0", lineHeight: 1.1, height: 24, overflow: "hidden" }}>{p.name}</div>
                                            <button
                                                onClick={() => { setSelectedPetId(p.id); document.getElementById("admin-pet-editor-card")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                                                style={{ fontSize: "0.66rem", padding: "2px 8px", width: "100%" }}
                                            >✎ Change</button>
                                        </div>
                                    );
                                })}
                            </div>
                        </details>

                        {(() => {
                            const pet = editablePets.find((p) => p.id === selectedPetId);
                            if (!pet) return <p>No pet selected.</p>;
                            const selectedPet = pet;

                            function updatePet(updated: Partial<Pet>) {
                                // Stamp updatedAt so the shared-admin-content pull treats this pet as
                                // admin-AUTHORED and publishes its kit/stats to every player's instance
                                // (overriding the built-in baseline). Also gives the two-admin merge a
                                // recency tiebreaker so an edit can't be clobbered by a stale copy.
                                const stamped = { ...updated, updatedAt: Date.now() };
                                setEditablePets(
                                    editablePets.map((p) => p.id === selectedPet.id ? { ...p, ...stamped } : p)
                                );
                                // Mirror image changes to character.pets so the pet tab
                                // shows the new image immediately without a page reload.
                                // character.pets use timestamp-suffixed IDs (cloneEncounterPet),
                                // so match on the base pool ID (strip trailing -NNNNNNNNNNNN).
                                if (updated.image !== undefined) {
                                    const basePoolId = selectedPet.id.replace(/-\d{10,}$/, '');
                                    const patchedPets = character.pets.map(p => {
                                        const pBase = p.id.replace(/-\d{10,}$/, '');
                                        return pBase === basePoolId ? { ...p, image: updated.image! } : p;
                                    });
                                    if (patchedPets.some(p => p.id.replace(/-\d{10,}$/, '') === basePoolId)) {
                                        updateCharacter({ ...character, pets: patchedPets });
                                    }
                                }
                            }

                            function updatePetJutsu(index: number, updated: Partial<PetJutsu>) {
                                updatePet({
                                    jutsus: selectedPet.jutsus.map((jutsu, jutsuIndex) =>
                                        jutsuIndex === index ? { ...jutsu, ...updated } : jutsu
                                    ),
                                });
                            }

                            return (
                                <div className="summary-box pet-editor-card" id="admin-pet-editor-card">
                                    <h3>{pet.name}</h3>

                                    {(pinnedAvatars["pet:" + pet.id] || pet.image) && (
                                        <div className="admin-jutsu-preview">
                                            <img src={pinnedAvatars["pet:" + pet.id] || pet.image} alt={pet.name} />
                                        </div>
                                    )}

                                    <label>Pet Photo</label>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            readImageFile(file, async (raw) => {
                                                const c = await compressDataUrl(raw, 256, 0.85);
                                                pinAvatar("pet:" + pet.id, c);
                                                updatePet({ image: c });
                                                await publishSharedImage('pet:' + pet.id, c);
                                            }, 100);
                                        }}
                                    />
                                    <AiImagePrompt label="Pet Photo" suggestedPrompt={`${pet.name} ${pet.rarity} shinobi companion`} onImage={async (image) => {
                                        const c = await compressDataUrl(image, 256, 0.85);
                                        pinAvatar("pet:" + pet.id, c);
                                        updatePet({ image: c });
                                        await publishSharedImage('pet:' + pet.id, c);
                                    }} />
                                    {/* Force-Save: re-publish + LOCK the current avatar for this session so a
                                        background image refetch / snapshot restore / poll can't revert it (the
                                        cause of avatars reverting after a few seconds). */}
                                    <button
                                        style={{ marginTop: 6, background: "#166534", borderColor: "#22c55e", fontWeight: 600 }}
                                        onClick={async () => {
                                            const current = pinnedAvatars["pet:" + pet.id] || pet.image || "";
                                            if (!current.startsWith("data:")) { setPetGenStatus("⚠️ Upload or generate a new image first, then Force-Save."); return; }
                                            setPetGenStatus(`Saving ${pet.name}'s avatar…`);
                                            const c = await compressDataUrl(current, 256, 0.85);
                                            pinAvatar("pet:" + pet.id, c);
                                            updatePet({ image: c });
                                            const ok = await publishSharedImage('pet:' + pet.id, c);
                                            try { await onSaveRef.current?.(); } catch { /* no account loaded — ignore */ }
                                            setPetGenStatus(ok ? `✅ Saved & locked ${pet.name}'s avatar (won't revert this session).` : `⚠️ Locked locally, but the server publish failed — check you're logged in as admin.`);
                                        }}
                                    >💾 Force-Save Avatar (override)</button>
                                    {pinnedAvatars["pet:" + pet.id] && (
                                        <button
                                            style={{ marginTop: 6, marginLeft: 6, background: "#374151", borderColor: "#6b7280" }}
                                            onClick={() => { unpinAvatar("pet:" + pet.id); setPetGenStatus(`Cleared local pin for ${pet.name} — now showing the server image.`); }}
                                            title="Stop overriding with the local copy and show whatever the server currently has"
                                        >↺ Clear pin</button>
                                    )}
                                    {petGenStatus && <p className="hint" style={{ marginTop: 4 }}>{petGenStatus}</p>}

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

                                    <label>Combat Role</label>
                                    <select
                                        value={pet.role ?? ""}
                                        onChange={(e) => {
                                            const r = e.target.value as PetRole | "";
                                            updatePet(r ? { role: r, subRole: PRIMARY_SUBROLE[r] } : { role: undefined, subRole: undefined });
                                        }}
                                    >
                                        <option value="">Auto (derived from element)</option>
                                        <option value="defender">Defender</option>
                                        <option value="tracker">Tracker</option>
                                        <option value="assassin">Assassin</option>
                                        <option value="sage">Sage</option>
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

                                    <h4>Pet Jutsus <span style={{ fontSize: "0.75rem", color: "#64748b" }}>({pet.jutsus.length} / 6)</span></h4>
                                    {pet.jutsus.map((jutsu, index) => (
                                        <div className="summary-box" key={index} style={{ position: "relative" }}>
                                            <button
                                                onClick={() => updatePet({ jutsus: pet.jutsus.filter((_, i) => i !== index) })}
                                                style={{ position: "absolute", top: 6, right: 6, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5", borderRadius: 4, padding: "1px 7px", fontSize: "0.75rem", cursor: "pointer" }}
                                                title="Remove this jutsu"
                                            >🗑️ Remove</button>

                                            <label>Jutsu Name</label>
                                            <input value={jutsu.name} onChange={(e) => updatePetJutsu(index, { name: e.target.value })} />

                                            <label>Kind</label>
                                            <select value={jutsu.kind} onChange={(e) => updatePetJutsu(index, { kind: e.target.value as PetJutsu["kind"] })}>
                                                <option value="damage">⚔️ damage — direct attack</option>
                                                <option value="buff">💪 buff — raise own ATK + DEF</option>
                                                <option value="heal">💚 heal — restore own HP</option>
                                                <option value="debuff">📉 debuff — lower enemy ATK + DEF</option>
                                                <option value="dot">☠️ dot — poison (3 rounds)</option>
                                                <option value="move">💨 move — dash toward enemy</option>
                                                <option value="barrier">🔰 barrier — large absorb shield</option>
                                                <option value="movelock">🔒 movelock — root enemy (2 rounds)</option>
                                                <option value="lifesteal">🩸 lifesteal — damage + drain 40% HP back</option>
                                                <option value="shield">🛡️ shield — small fast ward (power × 0.45)</option>
                                                <option value="absorb">✨ absorb — 35% damage reduction for 3 rounds</option>
                                                <option value="crush">🪨 crush — damage + larger ATK/DEF strip (Earth)</option>
                                                <option value="burn">🔥 burn — DoT (15%/round) + small ATK debuff</option>
                                                <option value="freeze">🧊 freeze — 50% chance to skip a turn each round</option>
                                                <option value="confuse">🌀 confuse — 50% chance the target hits itself</option>
                                                <option value="stun">💫 stun — guaranteed skip of next turn (1 round)</option>
                                                <option value="wound">🩸 wound — DoT that also halves the target's healing</option>
                                                <option value="mark">🔻 mark — the next hit on the target deals bonus damage</option>
                                                <option value="slow">🐌 slow — target loses movement + dodge for N rounds</option>
                                                <option value="haste">⚡ haste — self buff: +movement + dodge for N rounds</option>
                                                <option value="taunt">❗ taunt — forces the target to attack the caster (2v2)</option>
                                                <option value="push">👊 push — light damage + shove target one tile away</option>
                                                <option value="pull">🪝 pull — light damage + drag target one tile closer</option>
                                            </select>

                                            <label>
                                                {jutsu.kind === "barrier"   ? "Power (shield HP = power × 0.7)" :
                                                 jutsu.kind === "shield"    ? "Power (ward HP = power × 0.45)" :
                                                 jutsu.kind === "buff"      ? "Power (ATK gain = power ÷ 2, DEF gain = power ÷ 3)" :
                                                 jutsu.kind === "heal"      ? "Power (heal = power × 0.6)" :
                                                 jutsu.kind === "debuff"    ? "Power (ATK cut = power ÷ 4, DEF cut = power ÷ 5)" :
                                                 jutsu.kind === "dot"       ? "Power (poison per round = power × 0.28)" :
                                                 jutsu.kind === "lifesteal" ? "Power (damage + 40% drain; treated as damage jutsu)" :
                                                 jutsu.kind === "absorb" || jutsu.kind === "move" || jutsu.kind === "movelock" ? "Power (set to 0 — auto)" :
                                                 "Power"}
                                            </label>
                                            <div className="inline-grid">
                                                <input type="number" value={jutsu.power} onChange={(e) => updatePetJutsu(index, { power: Number(e.target.value) })} placeholder="Power" />
                                                <input type="number" value={jutsu.cooldown} onChange={(e) => updatePetJutsu(index, { cooldown: Number(e.target.value) })} placeholder="Cooldown" />
                                            </div>
                                            <p className="hint" style={{ margin: "2px 0 0" }}>Cooldown: rounds before this jutsu can be used again.</p>
                                        </div>
                                    ))}
                                    {pet.jutsus.length < 6 && (
                                        <button
                                            style={{ marginTop: 6, width: "100%" }}
                                            onClick={() => updatePet({
                                                jutsus: [...pet.jutsus, { name: "New Jutsu", power: 50, cooldown: 3, currentCooldown: 0, kind: "damage" }]
                                            })}
                                        >+ Add Jutsu</button>
                                    )}

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
                                        const compressed = await compressDataUrl(data.image, 256, 0.85);
                                        const idx = updated.findIndex((p) => p.id === pet.id);
                                        if (idx >= 0) {
                                            updated[idx] = { ...updated[idx], image: compressed };
                                            publishSharedImage('pet:' + pet.id, compressed);
                                        }
                                    }
                                } catch { /* skip */ }
                                done++;
                            }
                            setEditablePets(updated);
                            setPetIsGenerating(false);
                            setPetGenStatus(`Done! Generated images for ${done} pet(s).`);
                            try { await onSaveRef.current(); } catch { /* ignore if no account */ }
                        }}>
                            {petIsGenerating ? "Generating..." : "Generate All Missing Pet Images"}
                        </button>
                        {petGenStatus && <p className="hint" style={{ color: "#a5d6a7", marginTop: "0.4rem" }}>{petGenStatus}</p>}

                        <hr style={{ margin: "12px 0", borderColor: "rgba(255,255,255,0.1)" }} />
                        <p className="hint">Recompress already-saved pet images to ~256 px JPEG. Shrinks storage from ~1.5 MB ? ~50 KB per image.</p>
                        <button disabled={petIsGenerating} onClick={async () => {
                            setPetIsGenerating(true);
                            setPetGenStatus("Fetching existing pet images…");
                            try {
                                const r = await fetch("/api/images?cat=pet");
                                const registry = r.ok ? await r.json() as Record<string, string> : {};
                                const entries = Object.entries(registry);
                                if (entries.length === 0) { setPetGenStatus("No shared pet images found."); setPetIsGenerating(false); return; }
                                let done = 0;
                                // Also recompress images stored directly on editable pets
                                const updatedPets = [...editablePets];
                                for (const [key, raw] of entries) {
                                    setPetGenStatus(`Compressing ${key}… (${done + 1}/${entries.length})`);
                                    try {
                                        const compressed = await compressDataUrl(raw, 256, 0.85);
                                        publishSharedImage(key, compressed);
                                        // Update local pet state too if this pet is in the editor
                                        const petId = key.replace(/^pet:/, "");
                                        const idx = updatedPets.findIndex(p => p.id === petId);
                                        if (idx >= 0) updatedPets[idx] = { ...updatedPets[idx], image: compressed };
                                    } catch { /* skip bad entries */ }
                                    done++;
                                }
                                setEditablePets(updatedPets);
                                setPetGenStatus(`Done! Recompressed ${done} pet image(s).`);
                            } catch { setPetGenStatus("Error fetching images."); }
                            setPetIsGenerating(false);
                        }}>
                            {petIsGenerating ? "Working…" : "Recompress All Existing Pet Images"}
                        </button>
                    </section>
                </div>
            )}
            {activeAdminPanel === "cardEditor" && (
                <div className="admin-subpanel">
                    <div className="admin-panel-heading">
                        <h3>Card Editor</h3>
                        <p>Create and edit Shinobi Card Clash cards. Changes persist across sessions.</p>
                    </div>

                    <section className="summary-box">
                        {editingCardId && (
                            <p className="hint">Editing: <strong>{cardName}</strong>{shinobiTileCards.some((c) => c.id === editingCardId) ? " (built-in — save creates an override)" : ""}</p>
                        )}

                        <label>Card Name</label>
                        <input value={cardName} onChange={(e) => setCardName(e.target.value)} />

                        <label>Top (1–99)</label>
                        <input type="number" min={1} max={99} value={cardTop} onChange={(e) => setCardTop(Number(e.target.value))} />

                        <label>Right (1–99)</label>
                        <input type="number" min={1} max={99} value={cardRight} onChange={(e) => setCardRight(Number(e.target.value))} />

                        <label>Bottom (1–99)</label>
                        <input type="number" min={1} max={99} value={cardBottom} onChange={(e) => setCardBottom(Number(e.target.value))} />

                        <label>Left (1–99)</label>
                        <input type="number" min={1} max={99} value={cardLeft} onChange={(e) => setCardLeft(Number(e.target.value))} />

                        <label>Element</label>
                        <select value={cardElement} onChange={(e) => setCardElement(e.target.value)}>
                            {["None", "Fire", "Water", "Wind", "Earth", "Lightning", "Shadow", "Ice", "Neutral"].map((el) => (
                                <option key={el} value={el}>{el}</option>
                            ))}
                        </select>

                        <label>Rarity</label>
                        <select value={cardRarity} onChange={(e) => setCardRarity(e.target.value as TileCard["rarity"])}>
                            <option value="common">common</option>
                            <option value="rare">rare</option>
                            <option value="epic">epic</option>
                            <option value="legendary">legendary</option>
                        </select>

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
                                readImageFile(file, async (img) => { const c = await compressDataUrl(img, 512, 0.82); setCardImage(c); if (editingCardId) publishSharedImage('card:' + editingCardId, c); }, 100);
                            }}
                        />
                        <AiImagePrompt
                            label="Card Image"
                            suggestedPrompt={`${cardName} ${cardElement} shinobi card game artwork`}
                            onImage={async (img) => { const c = await compressDataUrl(img, 512, 0.82); setCardImage(c); if (editingCardId) publishSharedImage('card:' + editingCardId, c); }}
                        />

                        <div className="menu">
                            <button onClick={createAdminCard}>{editingCardId ? "Save Card" : "Create Card"}</button>
                            {editingCardId && <button onClick={() => { setEditingCardId(""); setCardName("New Card"); setCardTop(25); setCardRight(25); setCardBottom(25); setCardLeft(25); setCardImage(""); }}>Cancel Edit</button>}
                        </div>
                    </section>

                    {/* -- Bulk Image Generator -- */}
                    <section className="summary-box bulk-image-section">
                        <div className="bulk-image-header" onClick={() => setBulkShowSection(v => !v)}>
                            <span>🖼️ Bulk Image Generator</span>
                            <span className="bulk-image-chevron">{bulkShowSection ? "?" : "?"}</span>
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
                                                        : <div className="bulk-card-thumb bulk-card-thumb--empty">🖼️</div>
                                                    }
                                                    <div className="bulk-card-info">
                                                        <span className="bulk-card-name">{card.name}</span>
                                                        <span className={`bulk-card-rarity bulk-rarity-${card.rarity}`}>{card.rarity}</span>
                                                        {card.element !== "None" && <span className="bulk-card-element">{card.element}</span>}
                                                        {card.image && <span className="bulk-card-has-img">🖼️ has image</span>}
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
                        <input placeholder="🔍 Filter cards by name / element / rarity…" value={cardLibQuery} onChange={(e) => setCardLibQuery(e.target.value)} style={{ marginBottom: 6 }} />
                        {([...creatorCards, ...shinobiTileCards.filter((s) => !creatorCards.some((c) => c.id === s.id))]).filter((card) => { const q = cardLibQuery.trim().toLowerCase(); return !q || `${card.name} ${card.element} ${card.rarity}`.toLowerCase().includes(q); }).map((card) => {
                            const isCreator = creatorCards.some((c) => c.id === card.id);
                            return (
                                <div key={card.id} className="summary-box" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                                    {card.image && <img src={card.image} alt={card.name} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} />}
                                    <span style={{ flex: 1 }}><strong>{card.name}</strong> | T:{card.top} R:{card.right} B:{card.bottom} L:{card.left} | {card.element} | {card.rarity}</span>
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

            {/* Restricted to full admin (Admin 1). The clamp effect above
                also re-routes Admin 2 away from this tab, but render-gate
                here too to avoid a single-frame flicker if the clamp runs
                after the first paint. */}
            {activeAdminPanel === "playerManagement" && adminRole === 'full' && (() => {
                const reviewItems = getAllItems(creatorItems).filter(i =>
                    i.image && ["weapon","armor","accessory","rune"].includes(i.slot) && !approvedItemIds.includes(i.id)
                );
                const pmChar = pmSnap?.character as Record<string, unknown> | null;
                const currencyLabels: { key: string; label: string }[] = [
                    { key: "honorSeals",  label: "Honor Seals"  },
                    { key: "fateShards",  label: "Fate Shards"  },
                    { key: "boneCharms",  label: "Bone Charms"  },
                    { key: "auraStones",  label: "Aura Stones"  },
                    { key: "auraDust",    label: "Aura Dust"    },
                    { key: "mythicSeals", label: "Mythic Seals" },
                ];
                return (
                    <div className="admin-subpanel">
                        <div className="admin-panel-heading">
                            <h3>👥 Player Management</h3>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                <p style={{ margin: 0 }}>Give items, manage weapons/bloodlines, and reset accounts.</p>
                                <button style={{ fontSize: "0.8rem", padding: "3px 10px" }} onClick={fetchAllKnownPlayers}>🔄 Refresh Player List</button>
                                {allKnownPlayers.length > 0 && <span className="hint" style={{ margin: 0 }}>{allKnownPlayers.length} accounts · {allKnownPlayers.filter(p => p.online).length} online</span>}
                            </div>
                        </div>

                        {/* -- Give to Player -- */}
                        <section className="summary-box">
                            <h4>Give to Player</h4>
                            {(() => {
                                const dropdownPlayers = allKnownPlayers.length > 0
                                    ? allKnownPlayers
                                    : allServerPlayers.length > 0
                                        ? allServerPlayers
                                        : [...new Map(playerRoster.map(p => [p.name, p])).values()].map(p => ({ name: p.name, level: p.level, village: p.village || "", online: false }));
                                return dropdownPlayers.length > 0 ? (
                                    <div style={{ marginBottom: 8 }}>
                                        <label style={{ fontSize: "0.85rem", display: "block", marginBottom: 4 }}>
                                            All server accounts ({dropdownPlayers.length}) — 🟢 online · sorted by recent activity:
                                        </label>
                                        <select
                                            value={pmTargetName}
                                            onChange={e => { setPmTargetName(e.target.value); setPmSnap(null); setPmMsg(""); }}
                                            style={{ width: "100%", marginBottom: 4 }}
                                        >
                                            <option value="">— Select a player —</option>
                                            {dropdownPlayers.map(p => {
                                                const ls = (p as { lastSeen?: number }).lastSeen;
                                                const ago = ls ? Math.floor((Date.now() - ls) / 60000) : null;
                                                const agoStr = ago === null ? "" : ago < 2 ? " · just now" : ago < 60 ? ` · ${ago}m ago` : ago < 1440 ? ` · ${Math.floor(ago / 60)}h ago` : ` · ${Math.floor(ago / 1440)}d ago`;
                                                return (
                                                    <option key={p.name} value={p.name}>
                                                        {p.online ? "🟢 " : ""}{p.name} (Lv {p.level} · {p.village || "No Village"}{agoStr})
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>
                                ) : null;
                            })()}
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                <input
                                    style={{ flex: 1, minWidth: 160 }}
                                    value={pmTargetName}
                                    onChange={e => setPmTargetName(e.target.value)}
                                    placeholder="Or type player name manually"
                                />
                                <button onClick={pmLookup}>Look Up</button>
                            </div>
                            {pmMsg && <p className="hint" style={{ color: pmMsg.startsWith("✅") ? "#4ade80" : pmMsg.startsWith("❌") ? "#f87171" : pmMsg.startsWith("⚠️") ? "#fbbf24" : undefined }}>{pmMsg}</p>}

                            {pmChar && (
                                <>
                                    <p className="hint">Current — Ryo: {String(pmChar.ryo ?? 0)} | Honor: {String(pmChar.honorSeals ?? 0)} | Shards: {String(pmChar.fateShards ?? 0)} | Charms: {String(pmChar.boneCharms ?? 0)} | Aura: {String(pmChar.auraDust ?? 0)} | Stones: {String(pmChar.auraStones ?? 0)} | Mythic: {String(pmChar.mythicSeals ?? 0)}</p>

                                    <label>Give Pet</label>
                                    <select value={pmGivePetId} onChange={e => setPmGivePetId(e.target.value)}>
                                        <option value="">— No pet —</option>
                                        {editablePets.map(p => <option key={p.id} value={p.id}>{p.name} ({p.rarity})</option>)}
                                    </select>

                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8, marginTop: 8 }}>
                                        {currencyLabels.map(({ key, label }) => (
                                            <label key={key} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.85rem" }}>
                                                {label}
                                                <input
                                                    type="number" min={0}
                                                    value={pmGiveAmounts[key] ?? 0}
                                                    onChange={e => setPmGiveAmounts(prev => ({ ...prev, [key]: Math.max(0, Number(e.target.value)) }))}
                                                />
                                            </label>
                                        ))}
                                    </div>

                                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                                        <button onClick={pmGive}>🎁 Give &amp; Save</button>
                                    </div>
                                </>
                            )}
                        </section>

                        {/* -- Password Reset -- */}
                        <section className="summary-box">
                            <h4>🔑 Reset Player Password</h4>
                            <AdminPasswordReset adminPw={adminPw} />
                        </section>

                        {/* -- Auth Lock Clear -- */}
                        <section className="summary-box">
                            <h4>🔓 Clear Auth Lock</h4>
                            <AdminClearAuthLock adminPw={adminPw} />
                        </section>

                        {/* -- Manual Stat Edit -- */}
                        <section className="summary-box">
                            <h4>📊 Edit Player Stats</h4>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                                <input style={{ flex: 1, minWidth: 160 }} value={pmEditName} onChange={e => { setPmEditName(e.target.value); setPmEditSnap(null); }} placeholder="Player name" />
                                <button onClick={pmEditLookup} disabled={!pmEditName.trim()}>Look Up</button>
                            </div>
                            {pmEditMsg && <p className="hint" style={{ color: pmEditMsg.startsWith("✅") ? "#4ade80" : pmEditMsg.startsWith("❌") ? "#f87171" : "#fcd34d", marginBottom: 8 }}>{pmEditMsg}</p>}
                            {pmEditSnap && (() => {
                                const fields: { key: string; label: string }[] = [
                                    { key: "level", label: "Level" },
                                    { key: "xp", label: "XP" },
                                    { key: "ryo", label: "Ryo" },
                                    { key: "unspentStats", label: "Stat Points" },
                                    { key: "strength", label: "Strength" },
                                    { key: "speed", label: "Speed" },
                                    { key: "intelligence", label: "Intelligence" },
                                    { key: "willpower", label: "Willpower" },
                                    { key: "ninjutsuOffense", label: "Ninjutsu Off" },
                                    { key: "ninjutsuDefense", label: "Ninjutsu Def" },
                                    { key: "taijutsuOffense", label: "Taijutsu Off" },
                                    { key: "taijutsuDefense", label: "Taijutsu Def" },
                                    { key: "bukijutsuOffense", label: "Bukijutsu Off" },
                                    { key: "bukijutsuDefense", label: "Bukijutsu Def" },
                                    { key: "genjutsuOffense", label: "Genjutsu Off" },
                                    { key: "genjutsuDefense", label: "Genjutsu Def" },
                                ];
                                return (
                                    <>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "6px 12px", marginBottom: 10 }}>
                                            {fields.map(f => (
                                                <label key={f.key} style={{ display: "flex", flexDirection: "column", fontSize: "0.78rem", gap: 2 }}>
                                                    <span style={{ color: "#94a3b8" }}>{f.label}</span>
                                                    <input
                                                        type="number"
                                                        value={pmEditFields[f.key] ?? 0}
                                                        onChange={e => setPmEditFields(prev => ({ ...prev, [f.key]: Number(e.target.value) }))}
                                                        style={{ width: "100%", padding: "2px 6px" }}
                                                    />
                                                </label>
                                            ))}
                                        </div>
                                        <button onClick={pmEditSave} style={{ background: "linear-gradient(#1e3a5f,#0c1f3d)", borderColor: "#60a5fa" }}>💾 Save Changes</button>
                                    </>
                                );
                            })()}
                            {pmEditSnap && (() => {
                                const char = pmEditSnap.character as Record<string, unknown> ?? {};
                                const inventory = (char.inventory as string[] | undefined) ?? [];
                                const equipment = (char.equipment as Record<string, string> | undefined) ?? {};
                                const pets = (char.pets as Pet[] | undefined) ?? [];
                                const allItems = getAllItems(creatorItems);
                                const itemName = (id: string) => allItems.find(i => i.id === id)?.name ?? id;

                                function unequipSlot(slot: string) {
                                    const newEquip = { ...equipment };
                                    delete newEquip[slot];
                                    const updated = { ...pmEditSnap!, character: { ...char, equipment: newEquip } };
                                    void pmEditPatch(updated);
                                }
                                function removePet(petId: string) {
                                    const newPets = pets.filter(p => p.id !== petId);
                                    const updated = { ...pmEditSnap!, character: { ...char, pets: newPets } };
                                    void pmEditPatch(updated);
                                }

                                return (
                                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                                        {/* Equipment */}
                                        {Object.keys(equipment).length > 0 && (
                                            <div>
                                                <p style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: 4 }}>⚔️ Equipment</p>
                                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                    {Object.entries(equipment).map(([slot, itemId]) => (
                                                        <div key={slot} style={{ display: "flex", alignItems: "center", gap: 4, background: "#1e293b", border: "1px solid #334155", borderRadius: 4, padding: "2px 6px", fontSize: "0.75rem" }}>
                                                            <span style={{ color: "#94a3b8" }}>{slot}:</span>
                                                            <span>{itemName(itemId)}</span>
                                                            <button onClick={() => unequipSlot(slot)} style={{ fontSize: "0.65rem", padding: "1px 5px", background: "#7f1d1d", borderColor: "#ef4444", color: "#fca5a5" }}>✕</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {/* Inventory — stacked by item ID */}
                                        {inventory.length > 0 && (
                                            <div>
                                                <p style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: 4 }}>🎒 Inventory ({inventory.length} items)</p>
                                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                    {(() => {
                                                        const stacked: { itemId: string; indices: number[] }[] = [];
                                                        inventory.forEach((id, idx) => {
                                                            const s = stacked.find(x => x.itemId === id);
                                                            if (s) s.indices.push(idx); else stacked.push({ itemId: id, indices: [idx] });
                                                        });
                                                        return stacked.map(({ itemId, indices }) => {
                                                            const count = indices.length;
                                                            const removeOne = () => {
                                                                const newInv = inventory.filter((_, i) => i !== indices[indices.length - 1]);
                                                                void pmEditPatch({ ...pmEditSnap!, character: { ...char, inventory: newInv } });
                                                            };
                                                            const removeAll = () => {
                                                                const set = new Set(indices);
                                                                const newInv = inventory.filter((_, i) => !set.has(i));
                                                                void pmEditPatch({ ...pmEditSnap!, character: { ...char, inventory: newInv } });
                                                            };
                                                            return (
                                                                <div key={itemId} style={{ display: "flex", alignItems: "center", gap: 4, background: "#1e293b", border: "1px solid #334155", borderRadius: 4, padding: "2px 6px", fontSize: "0.75rem" }}>
                                                                    <span>{itemName(itemId)}</span>
                                                                    {count > 1 && <span style={{ background: "#334155", borderRadius: 8, padding: "0 5px", fontSize: "0.65rem", color: "#94a3b8" }}>×{count}</span>}
                                                                    <button onClick={removeOne} title="Remove one" style={{ fontSize: "0.65rem", padding: "1px 5px", background: "#7f1d1d", borderColor: "#ef4444", color: "#fca5a5" }}>−1</button>
                                                                    {count > 1 && <button onClick={removeAll} title={`Remove all ${count}`} style={{ fontSize: "0.65rem", padding: "1px 5px", background: "#7f1d1d", borderColor: "#ef4444", color: "#fca5a5" }}>−{count}</button>}
                                                                </div>
                                                            );
                                                        });
                                                    })()}
                                                </div>
                                            </div>
                                        )}
                                        {/* Pets */}
                                        {pets.length > 0 && (
                                            <div>
                                                <p style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: 4 }}>🐾 Pets</p>
                                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                    {pets.map(pet => (
                                                        <div key={pet.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#1e293b", border: "1px solid #334155", borderRadius: 4, padding: "4px 8px", fontSize: "0.78rem" }}>
                                                            <span style={{ flex: 1 }}><strong>{petDisplayName(pet)}</strong> <span style={{ color: "#94a3b8" }}>Lv {pet.level} · {pet.rarity}{pet.nickname ? ` · "${pet.nickname}"` : ""}</span></span>
                                                            <button onClick={() => removePet(pet.id)} style={{ fontSize: "0.65rem", padding: "1px 8px", background: "#7f1d1d", borderColor: "#ef4444", color: "#fca5a5" }}>Remove</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </section>

                        {/* -- Reset Account -- */}
                        <section className="summary-box" style={{ borderColor: "#7f1d1d" }}>
                            <h4>🔄 Reset Player Account</h4>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                                <input
                                    style={{ flex: 1, minWidth: 160 }}
                                    value={pmTargetName}
                                    onChange={e => setPmTargetName(e.target.value)}
                                    placeholder="Player name"
                                />
                                <button disabled={!pmTargetName.trim()} onClick={pmSoftReset} style={{ background: "#78350f", borderColor: "#f59e0b", color: "#fde68a" }}>🔄 Soft Reset</button>
                                <button className="danger-button" disabled={!pmTargetName.trim()} onClick={pmReset}>🗑️ Full Wipe</button>
                            </div>
                            <p className="hint" style={{ marginBottom: 2 }}><strong style={{ color: "#fde68a" }}>🔄 Soft Reset</strong> — keeps name, village, specialty & bloodline. Resets everything else to Lv 1 defaults.</p>
                            <p className="hint"><strong style={{ color: "#fca5a5" }}>🗑️ Full Wipe</strong> — deletes the save entirely. Player must create a new character.</p>
                            {pmMsg && <p className="hint" style={{ color: pmMsg.startsWith("✅") ? "#4ade80" : pmMsg.startsWith("❌") ? "#f87171" : "#fcd34d", marginTop: 6 }}>{pmMsg}</p>}
                        </section>

                        {/* -- Reset Kage -- */}
                        <section className="summary-box" style={{ borderColor: "#78350f" }}>
                            <h4>👑 Reset Village Kage</h4>
                            <p className="hint">Resets the Kage system for a village back to NPC control. Clears seated Kage, first liberator, and re-seals the system so a player must complete the level-100 story fight again to unlock it.</p>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                                <select value={kageResetVillage} onChange={e => setKageResetVillage(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
                                    {villages.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                                <button
                                    style={{ background: "#78350f", borderColor: "#f59e0b", color: "#fde68a" }}
                                    disabled={!adminPw}
                                    onClick={async () => {
                                        if (!(await gameConfirm(`Reset Kage for ${kageResetVillage}? This will unseat the current player Kage and re-seal the system.`, { danger: true, confirmLabel: "Reset" }))) return;
                                        setKageResetMsg("Resetting…");
                                        fetch('/api/village/kage', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
                                            body: JSON.stringify({ village: kageResetVillage, playerName: 'admin', action: 'reset' }),
                                        })
                                            .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(d.error ?? 'Failed')))
                                            .then(() => setKageResetMsg(`✅ ${kageResetVillage} Kage reset to NPC.`))
                                            .catch(err => setKageResetMsg(`❌ ${String(err)}`));
                                    }}
                                >👑 Reset Kage to NPC</button>
                            </div>
                            {kageResetMsg && <p className="hint" style={{ color: kageResetMsg.startsWith("✅") ? "#4ade80" : kageResetMsg.startsWith("❌") ? "#f87171" : "#fbbf24" }}>{kageResetMsg}</p>}
                        </section>

                        {/* -- Ranked Seasons -- */}
                        <section className="summary-box">
                            <h4>🏆 Ranked Seasons</h4>
                            <p className="hint">Ranked seasons do <strong>not</strong> auto-start. Start one to begin the monthly cycle; at season end the top 3 of each ladder are rewarded and ratings soft-reset. "Force rollover" ends the current season immediately.</p>
                            <p className="hint" style={{ color: rankedSeasonActive ? "#4ade80" : "#fbbf24" }}>
                                {rankedSeasonActive === null ? "Status unknown." : rankedSeasonActive ? `Active — Season ${rankedSeasonId ?? "?"}.` : "Not started."}
                            </p>
                            {!adminPw && (
                                <p className="hint" style={{ color: "#f87171", marginBottom: 6 }}>⚠️ Session restored without password. Log out and back in to enable server actions.</p>
                            )}
                            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                                <button
                                    style={{ padding: "8px 14px", background: adminPw && !rankedSeasonActive ? "#15803d" : "#374151", opacity: adminPw && !rankedSeasonActive ? 1 : 0.6 }}
                                    onClick={() => rankedSeasonAction('start')}
                                    disabled={!adminPw || rankedSeasonActive === true}
                                >▶ Start Ranked Season</button>
                                <button
                                    style={{ padding: "8px 14px", background: adminPw && rankedSeasonActive ? "#b45309" : "#374151", opacity: adminPw && rankedSeasonActive ? 1 : 0.6 }}
                                    onClick={() => rankedSeasonAction('rollover')}
                                    disabled={!adminPw || !rankedSeasonActive}
                                >⏭ Force Season Rollover Now</button>
                            </div>
                            {rankedSeasonMsg && (
                                <p className="hint" style={{ marginTop: 8, color: rankedSeasonMsg.startsWith("✅") ? "#4ade80" : rankedSeasonMsg.startsWith("❌") ? "#f87171" : "#fbbf24" }}>{rankedSeasonMsg}</p>
                            )}
                        </section>

                        {/* -- Full Server Reset -- */}
                        <section className="summary-box" style={{ borderColor: "#450a0a", background: "#1c0606" }}>
                            <h4 style={{ color: "#fca5a5" }}>💀 Full Server Reset</h4>
                            <p className="hint">Wipes <strong>every player account</strong> back to Level 1. Everyone chooses their village fresh. Resets Kage seats, village wars, clans, village chats, presence, PvP sessions, and player passwords.</p>
                            <p className="hint" style={{ color: "#4ade80" }}>✅ Preserved: All uploaded images (kage portraits, elder portraits, pets, weapons, avatars) and all admin-created game content (jutsus, missions, AIs, events, pets, cards, visual novels). Village Leaders tab configuration is kept.</p>
                            {!adminPw && (
                                <p className="hint" style={{ color: "#f87171", marginBottom: 6 }}>⚠️ Session restored without password. Please log out and log back in to enable server actions.</p>
                            )}
                            <button
                                className="danger-button"
                                style={{ marginTop: 8, width: "100%", padding: "10px", fontSize: "1rem", background: adminPw ? "#7f1d1d" : "#4a1a1a", opacity: adminPw ? 1 : 0.5 }}
                                onClick={serverReset}
                                disabled={!adminPw}
                            >💀 Reset Entire Server (All Players → Level 0)</button>
                            {serverResetMsg && (
                                <p className="hint" style={{
                                    marginTop: 8,
                                    color: serverResetMsg.startsWith("✅") ? "#4ade80" : serverResetMsg.startsWith("❌") ? "#f87171" : "#fbbf24"
                                }}>{serverResetMsg}</p>
                            )}
                        </section>

                        {/* -- Named Weapons / Armor with Images -- */}
                        <section className="summary-box">
                            <h4>Named Weapons &amp; Armor with Images ({reviewItems.length} pending)</h4>
                            <p className="hint">Approve keeps the item in the game. Delete removes it entirely.</p>
                            {reviewItems.length === 0
                                ? <p className="hint">No items pending review.</p>
                                : reviewItems.map(item => (
                                    <div key={item.id} className="summary-box" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                        {item.image && <img src={item.image} alt={item.name} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid #334155" }} />}
                                        <div style={{ flex: 1 }}>
                                            <strong>{item.name}</strong>
                                            <p className="hint" style={{ margin: 0 }}>{item.slot} · {item.rarity}</p>
                                        </div>
                                        <button onClick={() => pmApproveItem(item.id)}>✅ Approve</button>
                                        <button className="danger-button" onClick={() => pmDeleteItem(item.id)}>🗑️ Delete</button>
                                    </div>
                                ))
                            }
                        </section>

                        {/* -- Bloodlines Created -- */}
                        <section className="summary-box">
                            <h4>All Bloodlines ({reviewBloodlines.length})</h4>
                            <p className="hint">All created bloodlines. Delete removes a bloodline from the game entirely.</p>
                            {reviewBloodlines.length === 0
                                ? <p className="hint">No bloodlines created yet.</p>
                                : reviewBloodlines.map(bl => (
                                    <div key={bloodlineReviewKey(bl)} className="summary-box" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                        {bl.image && <img src={bl.image} alt={bl.name} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid #334155" }} />}
                                        <div style={{ flex: 1 }}>
                                            <strong>{bl.name}</strong>
                                            <p className="hint" style={{ margin: 0 }}>{bl.ownerName ? `By ${bl.ownerName} · ` : ""}{bl.rank}{bl.specialElement ? ` · ${bl.specialElement}` : ""} · {bl.totalPoints} pts · {bl.jutsus.length} jutsus</p>
                                            {bl.lore && <p className="hint" style={{ margin: "4px 0 0" }}>{bl.lore}</p>}
                                        </div>
                                        <button onClick={() => {
                                            const base: SavedBloodline = { id: bl.id, name: bl.name, rank: bl.rank, image: bl.image, specialElement: bl.specialElement, lore: bl.lore, jutsus: bl.jutsus, totalPoints: bl.totalPoints };
                                            onEditBloodline?.(base);
                                        }}>✏️ Edit</button>
                                        <button onClick={() => pmApproveBloodline(bl)}>✅ Approve</button>
                                        <button className="danger-button" onClick={() => pmDeleteBloodline(bl)}>🗑️ Delete</button>
                                    </div>
                                ))
                            }
                        </section>
                    </div>
                );
            })()}

            {activeAdminPanel === "hollowGate" && adminRole === 'full' && (() => {
                // ── Hollow Gate admin panel ─────────────────────────────────────
                // Restricted to full admin (Admin 1).
                // Lists every asset the Hollow Gate Shrine system needs an image for,
                // with a one-click image generator wired to /api/generate-image and
                // publishSharedImage. Each row shows the current preview (if any),
                // an editable prompt (with a sensible default), and a Generate button.
                // Rate-limited similar to the village-leaders flow — 35s between calls.

                type HollowGateAsset = {
                    key: string;          // shared image key, e.g. 'item:hollow-gate-key' or 'ai:boss-hollow-gate-warden'
                    name: string;         // display name in the admin list
                    category: "Item" | "Boss AI" | "Location" | "Tile / Scene";
                    defaultPrompt: string;
                    onSave?: (image: string) => void;   // optional extra side effect (e.g. write to creatorItems / creatorAis)
                };

                const hollowGateAssets: HollowGateAsset[] = [
                    // ── Items (3) ─────────────────────────────────────────────
                    {
                        key: "item:" + HOLLOW_GATE_KEY_ID,
                        name: "Hollow Gate Key (item)",
                        category: "Item",
                        defaultPrompt: "Hollow Gate Key, bone-pale key etched with violet shinobi sigils, glowing chakra runes, dark shrine background, RPG inventory icon, square framed game art",
                    },
                    {
                        key: "item:" + DUNGEON_LEGENDARY_FRAGMENT_ID,
                        name: "Dungeon Legendary Fragment (item)",
                        category: "Item",
                        defaultPrompt: "Dungeon Legendary Fragment, jagged broken relic shard with violet chakra burns, faint purple glow, dark stone background, epic rarity RPG inventory icon, square framed game art",
                    },
                    {
                        key: "item:" + VEIL_OF_THE_HOLLOW_ID,
                        name: "Veil of the Hollow (item)",
                        category: "Item",
                        defaultPrompt: "Veil of the Hollow, tattered shadow-violet shinobi veil cloth wrapped in glowing seals, legendary rarity, mystical purple aura, dark altar background, RPG inventory icon, square framed game art",
                    },
                    // ── Boss AI (1) ───────────────────────────────────────────
                    {
                        key: "ai:boss-hollow-gate-warden",
                        name: "Hollow Gate Warden (boss portrait)",
                        category: "Boss AI",
                        defaultPrompt: "Hollow Gate Warden, hulking corrupted shinobi warden in black ritual armor, glowing purple shrine sigils across chest plate, violet chakra burning in cracked mask eyes, ancient torii gate burning behind, dark shadow-temple boss portrait, dramatic shinobi RPG character art",
                        onSave: (image) => {
                            // Mirror to creatorAis so the existing AI image lookup picks it up.
                            const next = creatorAis.some(a => a.id === "boss-hollow-gate-warden")
                                ? creatorAis.map(a => a.id === "boss-hollow-gate-warden" ? { ...a, image } : a)
                                : [...creatorAis, { id: "boss-hollow-gate-warden", name: "Hollow Gate Warden", icon: "👹", image } as CreatorAi];
                            setCreatorAis(next);
                        },
                    },
                    // ── Location / scene backgrounds ──────────────────────────
                    {
                        key: "landmark:hollow-gate",
                        name: "Hollow Gate (world-map landmark)",
                        category: "Location",
                        defaultPrompt: "Square game-icon of a single large dark-purple Japanese torii gate, front-on view, centered subject filling the frame, deep violet lacquered beams with glowing chakra-rune seals, faintly cracked stone base, no background buildings or trees, flat near-black background with subtle purple haze, painted RPG world icon, ninja shinobi map landmark art, no text, no border, no UI elements",
                    },
                    {
                        key: "shrine:hollow-gate-background",
                        name: "Hollow Gate Shrine — main background",
                        category: "Location",
                        defaultPrompt: "Hollow Gate Shrine interior, dark ancient shadow temple with broken torii arches, glowing purple seal runes etched into stone floor, violet chakra mist drifting through corridors, dim spirit lanterns, dungeon crawler background, painted shinobi RPG environment art",
                    },
                    {
                        key: "shrine:hidden-chamber-background",
                        name: "Hidden Chamber background",
                        category: "Location",
                        defaultPrompt: "Hidden Chamber inside the Hollow Gate Shrine, secret ritual circle pulsing violet, spirit lanterns hovering over a cracked altar, ancient tablet humming with sealed chakra, floating shrine relic surrounded by purple energy, mystical dungeon discovery scene, painted shinobi RPG environment art",
                    },
                    // ── Tile / scene illustrations ────────────────────────────
                    {
                        key: "shrine:tile-sealed-door",
                        name: "Sealed Door scene",
                        category: "Tile / Scene",
                        defaultPrompt: "Ancient sealed stone door inside a shadow shinobi shrine, bound by thick chakra chains and glowing purple seal kanji, faint torch light, painted shinobi RPG event scene art",
                    },
                    {
                        key: "shrine:tile-trap",
                        name: "Ancient Seal Trap scene",
                        category: "Tile / Scene",
                        defaultPrompt: "Ancient seal trap inside a shadow shinobi shrine, paper-thin runes flaring red and violet underfoot, venomous chakra mist hissing from cracked stones, painted shinobi RPG event scene art",
                    },
                    {
                        key: "shrine:tile-ancient-chest",
                        name: "Ancient Chest scene",
                        category: "Tile / Scene",
                        defaultPrompt: "Ancient lacquered shrine offering chest, glowing violet chakra runes around the lock, dim shrine torches, glowing pawprints leading toward it, painted shinobi RPG event scene art",
                    },
                    {
                        key: "shrine:tile-pet-encounter",
                        name: "Glowing Pawprints / Pet encounter scene",
                        category: "Tile / Scene",
                        defaultPrompt: "Glowing violet pawprints leading toward a sleeping shrine spirit beast, ancient stone shadow temple corridor, mystical chakra aura, painted shinobi RPG event scene art",
                    },
                    {
                        key: "shrine:tile-corrupted-shinobi",
                        name: "Corrupted Shinobi (normal battle scene)",
                        category: "Tile / Scene",
                        defaultPrompt: "Corrupted shinobi rising from violet chakra mist inside a shadow temple, glowing hollow eyes, fractured mask, broken kunai in hand, painted shinobi RPG combat scene art",
                    },
                    {
                        key: "shrine:tile-shrine-keeper",
                        name: "Shrine Keeper (NPC portrait)",
                        category: "Tile / Scene",
                        defaultPrompt: "Shrine Keeper, ancient hooded shinobi tending a violet chakra brazier inside a Hollow Gate shrine corridor, lined face, kind eyes, simple grey robes with purple sigils, mystical NPC portrait, painted shinobi RPG character art",
                    },
                    {
                        // Shared wild-pet portrait for Hollow Gate pet_battle
                        // encounters. When set, overrides the individual pet
                        // template's image so every Hollow Beast looks part
                        // of the same shadow-corruption aesthetic.
                        key: "shrine:tile-hollow-beast",
                        name: "Hollow Beast (wild pet portrait)",
                        category: "Tile / Scene",
                        defaultPrompt: "Hollow Beast, corrupted spirit beast bound by violet chakra mist inside a shadow shinobi shrine, eyes burning chakra-blue, fractured shadow body, faint ancient sigils orbiting it, painted shinobi RPG creature portrait",
                    },
                    {
                        // Tile-game scene + the shadow NPC opponent who runs
                        // the 3x3 card duel. Used as the modal/scene art for
                        // the Shinobi Tile encounter tile.
                        key: "shrine:tile-tile-game",
                        name: "Shinobi Tile Game (NPC + table)",
                        category: "Tile / Scene",
                        defaultPrompt: "A hooded shadow opponent sits across a glowing stone table inside a Hollow Gate shrine, nine tile-shaped slots etched into the table glowing violet, faint chakra cards floating between them, painted shinobi RPG card-game scene art",
                    },
                    {
                        key: "shrine:tile-wall",
                        name: "Wall tile texture",
                        category: "Tile / Scene",
                        defaultPrompt: "Seamless dark stone shrine wall texture tile, weathered ancient masonry with violet chakra-burned cracks, faint purple seal runes faded into the stone, top-down dungeon tile, game-ready square tile art, painted shinobi RPG environment art",
                    },
                    {
                        key: "shrine:tile-room-floor",
                        name: "Room floor tile texture",
                        category: "Tile / Scene",
                        defaultPrompt: "Seamless polished dark slate shrine room floor texture, faint violet chakra grout between stone tiles, scattered dust and old ash, gently glowing seal runes inset, top-down dungeon floor tile, game-ready square tile art, painted shinobi RPG environment art",
                    },
                    {
                        key: "shrine:tile-corridor-floor",
                        name: "Corridor floor tile texture",
                        category: "Tile / Scene",
                        defaultPrompt: "Seamless narrow shrine corridor floor texture, dark rough cobblestone with violet chakra moss in the cracks, water-stained edges, dim, claustrophobic top-down dungeon corridor tile, game-ready square tile art, painted shinobi RPG environment art",
                    },
                    {
                        key: "shrine:tile-door",
                        name: "Door / threshold tile texture",
                        category: "Tile / Scene",
                        defaultPrompt: "Top-down view of an open shrine doorway, warm warded wood threshold framed by violet seal kanji on the floor, between a dark corridor and a torchlit room, game-ready square tile art, painted shinobi RPG environment art",
                    },
                    {
                        key: "shrine:tile-story",
                        name: "Hollow Gate Echo (story / engraving scene)",
                        category: "Tile / Scene",
                        defaultPrompt: "Hollow Gate Echo, ancient stone tablet inside a shadow shinobi shrine, etched with names of the shrine's first guardians, a shattered mural in the background depicts shinobi sealing the gate from the inside, glowing violet kanji bleeding faintly across the stone, painted shinobi RPG event scene art",
                    },
                    // ── Intro Visual Novel scenes (3 pages) ───────────────────
                    {
                        key: "shrine:intro-1",
                        name: "Intro VN Page 1 — The Broken Torii",
                        category: "Tile / Scene",
                        defaultPrompt: "Broken torii arch leaning against itself, bound with glowing violet chakra rope and ancient seals, view from the player approaching with a Hollow Gate Key, dark cliffside path, cinematic painted shinobi RPG scene art",
                    },
                    {
                        key: "shrine:intro-2",
                        name: "Intro VN Page 2 — The First Step",
                        category: "Tile / Scene",
                        defaultPrompt: "First step inside the Hollow Gate Shrine, stone teeth biting the air, glowing violet pawprints pulsing down a long corridor of ancient shadow temple, dim torch light, cinematic painted shinobi RPG scene art",
                    },
                    {
                        key: "shrine:intro-3",
                        name: "Intro VN Page 3 — What Waits Below",
                        category: "Tile / Scene",
                        defaultPrompt: "Five descending floors of the Hollow Gate Shrine seen as a cross-section, with the silhouette of the Hollow Gate Warden waiting on the deepest floor, surrounded by violet chakra fire, cinematic painted shinobi RPG scene art",
                    },
                ];

                async function generateAssetImage(asset: HollowGateAsset, prompt: string) {
                    setHollowGateAssetBusy(asset.key);
                    setHollowGateAssetStatus(`Generating ${asset.name}...`);
                    try {
                        const response = await fetch("/api/generate-image", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ prompt, label: asset.name }),
                        });
                        const rawText = await response.text();
                        let data: Record<string, unknown> = {};
                        try { data = rawText ? JSON.parse(rawText) : {}; } catch { throw new Error(`Server error ${response.status}`); }
                        if (!response.ok) throw new Error((data.error as string) || `Status ${response.status}`);
                        if (!data.image) throw new Error("No image returned.");
                        const image = await compressDataUrl(data.image as string, 512, 0.82);
                        // Mirror locally first so the preview is responsive…
                        setHollowGateAssetImages(prev => ({ ...prev, [asset.key]: image }));
                        // …then verify the KV publish actually succeeded. publishSharedImage
                        // returns false on any non-OK response — without this check, a network
                        // failure would still flip the status to ✅ even though nothing was saved.
                        const published = await publishSharedImage(asset.key, image);
                        if (!published) {
                            throw new Error("KV publish failed. Image is generated locally but NOT saved to shared store. Use 'Save All Hollow Gate Assets' to retry.");
                        }
                        asset.onSave?.(image);
                        setHollowGateAssetStatus(`✅ ${asset.name} saved.`);
                        // ref read inside async handler, not during render — intentional
                        try { await onSaveRef.current(); } catch { /* ignore if no account */ }
                    } catch (err) {
                        setHollowGateAssetStatus(`❌ ${asset.name} — ${err instanceof Error ? err.message : "failed"}`);
                    } finally {
                        setHollowGateAssetBusy("");
                    }
                }

                // Force-resync every locally-cached Hollow Gate image to the shared KV.
                // Useful if (a) a previous publish failed silently, (b) you uploaded
                // images via the asset rows before the persistence bug fix landed, or
                // (c) you want a one-click "make sure everything is saved" affordance.
                async function saveAllHollowGateAssets() {
                    const haveImages = hollowGateAssets.filter(a => hollowGateAssetImages[a.key]);
                    if (haveImages.length === 0) {
                        alert("No Hollow Gate images to save. Generate some first.");
                        return;
                    }
                    setHollowGateAssetBusy("__save_all__");
                    setHollowGateAssetStatus(`Re-publishing ${haveImages.length} Hollow Gate image${haveImages.length === 1 ? "" : "s"}...`);
                    const failures: string[] = [];
                    for (const asset of haveImages) {
                        const image = hollowGateAssetImages[asset.key];
                        if (!image) continue;
                        try {
                            const ok = await publishSharedImage(asset.key, image);
                            if (!ok) failures.push(asset.name);
                            else asset.onSave?.(image); // re-mirror boss AI to creatorAis
                        } catch {
                            failures.push(asset.name);
                        }
                    }
                    try { await onSaveRef.current(); } catch { /* no account */ }
                    setHollowGateAssetBusy("");
                    if (failures.length === 0) {
                        setHollowGateAssetStatus(`✅ Saved ${haveImages.length} Hollow Gate image${haveImages.length === 1 ? "" : "s"} to shared KV.`);
                    } else {
                        setHollowGateAssetStatus(`⚠ Saved ${haveImages.length - failures.length}/${haveImages.length}. Failed: ${failures.join(", ")}`);
                    }
                }

                async function generateAllMissing() {
                    const missing = hollowGateAssets.filter(a => !hollowGateAssetImages[a.key]);
                    if (missing.length === 0) { alert("All Hollow Gate assets already have images."); return; }
                    if (!(await gameConfirm(`Generate ${missing.length} missing image${missing.length > 1 ? "s" : ""}? This costs image credits and waits 35s between calls for rate limits.`))) return;
                    for (let i = 0; i < missing.length; i += 1) {
                        const asset = missing[i];
                        const prompt = hollowGateAssetPrompts[asset.key] ?? asset.defaultPrompt;
                        await generateAssetImage(asset, prompt);
                        if (i < missing.length - 1) await new Promise(r => setTimeout(r, 35_000));
                    }
                    alert("Done generating missing Hollow Gate images.");
                }

                return (
                    <div className="admin-subpanel">
                        <div className="admin-panel-heading">
                            <h3>⛩ Hollow Gate — Asset Manager</h3>
                            <p className="hint">Every Hollow Gate Shrine asset that needs an image. Edit the prompt then Generate. Images are saved to the shared KV and become visible to all players. Generations are rate-limited — ~35 seconds between calls in batch mode.</p>
                        </div>
                        <div className="menu" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                            <button onClick={generateAllMissing} disabled={Boolean(hollowGateAssetBusy)}>
                                🪄 Generate All Missing
                            </button>
                            <button
                                onClick={saveAllHollowGateAssets}
                                disabled={Boolean(hollowGateAssetBusy)}
                                style={{ background: "linear-gradient(135deg, #14532d, #22c55e)", borderColor: "#86efac", color: "#f0fdf4" }}
                                title="Re-publish every locally-cached Hollow Gate image to the shared KV. Use this if a previous Generate silently failed, or to force-sync assets after a fix."
                            >
                                💾 Save All Hollow Gate Assets
                            </button>
                            {onTestHollowGate && (
                                <button
                                    onClick={onTestHollowGate}
                                    style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", borderColor: "#c4b5fd", color: "#faf5ff" }}
                                    title="Drops you directly into the Hollow Gate Shrine. Skips the village-unlock check and does not consume a Hollow Gate Key. Admin / test only."
                                >
                                    ⛩ Test Hollow Gate (Admin)
                                </button>
                            )}
                            {hollowGateAssetStatus && <span className="village-save-msg">{hollowGateAssetStatus}</span>}
                        </div>
                        <p className="hint" style={{ marginTop: -4 }}>
                            <strong>Test Hollow Gate (Admin)</strong> drops you directly into the shrine —
                            bypasses both the village-unlock requirement and the Hollow Gate Key. Useful for
                            verifying tile generation, the boss fight, and image hookup without burning real keys.
                        </p>
                        <div style={{ display: "grid", gap: 12 }}>
                            {(["Item", "Boss AI", "Location", "Tile / Scene"] as const).map(category => {
                                const inCategory = hollowGateAssets.filter(a => a.category === category);
                                if (inCategory.length === 0) return null;
                                return (
                                    <section key={category} className="summary-box">
                                        <h4 style={{ margin: "0 0 8px" }}>{category}</h4>
                                        <div style={{ display: "grid", gap: 10 }}>
                                            {inCategory.map(asset => {
                                                const currentImage = hollowGateAssetImages[asset.key];
                                                const prompt = hollowGateAssetPrompts[asset.key] ?? asset.defaultPrompt;
                                                const busy = hollowGateAssetBusy === asset.key;
                                                return (
                                                    <div key={asset.key} style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 10, alignItems: "center", padding: 8, background: "rgba(15,9,28,0.4)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 6 }}>
                                                        <div style={{ width: 120, height: 120, background: "rgba(0,0,0,0.45)", border: "1px dashed rgba(168,85,247,0.4)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                                                            {currentImage
                                                                ? <img src={currentImage} alt={asset.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                                : <span style={{ color: "#a78bfa", fontSize: 11, textAlign: "center", padding: 6 }}>No image yet</span>}
                                                        </div>
                                                        <div style={{ display: "grid", gap: 6 }}>
                                                            <div><strong>{asset.name}</strong> <small style={{ color: "#a78bfa" }}>· key: {asset.key}</small></div>
                                                            <textarea
                                                                rows={3}
                                                                value={prompt}
                                                                onChange={(e) => setHollowGateAssetPrompts(prev => ({ ...prev, [asset.key]: e.target.value }))}
                                                                placeholder="Image generation prompt"
                                                                style={{ width: "100%", fontSize: 12 }}
                                                            />
                                                        </div>
                                                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                            <button disabled={busy} onClick={() => generateAssetImage(asset, prompt)}>
                                                                {busy ? "Generating…" : currentImage ? "Regenerate" : "Generate"}
                                                            </button>
                                                            {currentImage && (
                                                                <button className="danger-button" onClick={async () => {
                                                                    if (!(await gameConfirm(`Clear the image for ${asset.name}? This unpublishes the shared image.`, { danger: true, confirmLabel: "Clear" }))) return;
                                                                    setHollowGateAssetImages(prev => {
                                                                        const next = { ...prev };
                                                                        delete next[asset.key];
                                                                        return next;
                                                                    });
                                                                    // Real DELETE — empty-string POST used to silently fail
                                                                    // server validation and leave the image in KV.
                                                                    try {
                                                                        await fetch(`/api/images?id=${encodeURIComponent(asset.key)}`, { method: 'DELETE' });
                                                                        try { sessionStorage.removeItem(`imgcat:shrine`); } catch { /* ignore */ }
                                                                    } catch (err) {
                                                                        console.warn("[asset clear] DELETE failed", err);
                                                                    }
                                                                }}>Clear</button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                        <p className="hint" style={{ marginTop: 12 }}>
                            Tip: images are looked up by their shared key. <code>item:&lt;id&gt;</code> for inventory icons,
                            <code> ai:&lt;id&gt;</code> for AI portraits, and <code>landmark:</code> / <code>shrine:</code> keys for shrine scenes.
                            The Hollow Gate Warden boss image is mirrored into creatorAis so the live battle picks it up.
                        </p>

                        {/* ── Atlas Tile Picker — visual coord selector ──────────────── */}
                        <KenneyAtlasPicker sharedImages={sharedImages} setSharedImages={setSharedImages} />

                        {/* ── Admin Ops — Stats, Run/State Tools, Configuration ───────── */}
                        <section className="summary-box" style={{ marginTop: 16 }}>
                            <h3>📊 Stats</h3>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, fontSize: 13 }}>
                                <div><strong>Warden Kills (this character):</strong><br/>{character.hollowGateWardenKills ?? 0}</div>
                                <div><strong>Saved Run:</strong><br/>{character.hollowGateRun ? `Floor ${character.hollowGateRun.floor} · ${character.hollowGateRun.completed ? "completed" : "in progress"}` : "None"}</div>
                                <div><strong>Intro VN Seen:</strong><br/>{character.hollowGateIntroSeen ? "Yes" : "No"}</div>
                                <div><strong>Hollow Gate Keys:</strong><br/>{countItem(character, HOLLOW_GATE_KEY_ID)}</div>
                                <div><strong>Fragments:</strong><br/>{countItem(character, DUNGEON_LEGENDARY_FRAGMENT_ID)}</div>
                                <div><strong>Veils of the Hollow:</strong><br/>{countItem(character, VEIL_OF_THE_HOLLOW_ID)}</div>
                            </div>
                        </section>

                        <section className="summary-box" style={{ marginTop: 12 }}>
                            <h3>🛠 Run / State Tools</h3>
                            <p className="hint">These act on the <strong>currently signed-in admin character</strong> (you: {character.name}, village: {character.village}).</p>
                            <div className="menu" style={{ flexWrap: "wrap", gap: 8 }}>
                                {onHollowGateForceUnlock && (
                                    <button
                                        onClick={() => onHollowGateForceUnlock(!hollowGateVillageUnlocked)}
                                        style={{ background: hollowGateVillageUnlocked ? "linear-gradient(135deg,#7f1d1d,#b91c1c)" : "linear-gradient(135deg,#14532d,#22c55e)", borderColor: hollowGateVillageUnlocked ? "#fca5a5" : "#86efac" }}
                                    >
                                        {hollowGateVillageUnlocked ? "🔒 Re-lock Hollow Gate for village" : "🔓 Force-unlock Hollow Gate for village"}
                                    </button>
                                )}
                                {onHollowGateGrantKey && (
                                    <button onClick={onHollowGateGrantKey}>🗝 Grant 1 Hollow Gate Key</button>
                                )}
                                {onHollowGateResetIntro && (
                                    <button onClick={onHollowGateResetIntro} disabled={!character.hollowGateIntroSeen}>
                                        ↺ Reset Intro VN
                                    </button>
                                )}
                                {onHollowGateClearRun && (
                                    <button onClick={onHollowGateClearRun} disabled={!character.hollowGateRun} className="danger-button">
                                        🗑 Clear Saved Run
                                    </button>
                                )}
                            </div>
                        </section>

                        <section className="summary-box" style={{ marginTop: 12 }}>
                            <h3>⚙ Configuration (runtime tunables)</h3>
                            <p className="hint">
                                These are live tunables. Changes apply immediately to your current session. They <strong>do not persist</strong> across page refresh — for permanent changes, edit the defaults in <code>App.tsx</code>.
                            </p>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
                                <label style={{ display: "grid", gap: 4 }}>
                                    <span>Kage unlock cost (Honor Seals)</span>
                                    <input
                                        type="number" min={0} step={100}
                                        defaultValue={HOLLOW_GATE_UNLOCK_COST}
                                        onChange={(e) => { setHollowGateUnlockCost(Math.max(0, Math.floor(Number(e.target.value) || 0))); }}
                                    />
                                </label>
                                <label style={{ display: "grid", gap: 4 }}>
                                    <span>Key craft cost — Dungeon Keys</span>
                                    <input
                                        type="number" min={0} step={1}
                                        defaultValue={HOLLOW_GATE_KEY_DUNGEON_KEY_COST}
                                        onChange={(e) => { setHollowGateKeyDungeonKeyCost(Math.max(0, Math.floor(Number(e.target.value) || 0))); }}
                                    />
                                </label>
                                <label style={{ display: "grid", gap: 4 }}>
                                    <span>Key craft cost — Fate Shards</span>
                                    <input
                                        type="number" min={0} step={1}
                                        defaultValue={HOLLOW_GATE_KEY_FATE_SHARD_COST}
                                        onChange={(e) => { setHollowGateKeyFateShardCost(Math.max(0, Math.floor(Number(e.target.value) || 0))); }}
                                    />
                                </label>
                                <label style={{ display: "grid", gap: 4 }}>
                                    <span>Max floor</span>
                                    <input
                                        type="number" min={1} max={20} step={1}
                                        defaultValue={HOLLOW_GATE_MAX_FLOOR}
                                        onChange={(e) => { setHollowGateMaxFloor(Math.max(1, Math.min(20, Math.floor(Number(e.target.value) || 1)))); }}
                                    />
                                </label>
                                <label style={{ display: "grid", gap: 4 }}>
                                    <span>Threat gained per step</span>
                                    <input
                                        type="number" min={0} max={100} step={1}
                                        defaultValue={HOLLOW_GATE_THREAT_PER_STEP}
                                        onChange={(e) => { setHollowGateThreatPerStep(Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0)))); }}
                                    />
                                </label>
                                <label style={{ display: "grid", gap: 4 }}>
                                    <span>Threat ambush trigger</span>
                                    <input
                                        type="number" min={1} max={500} step={1}
                                        defaultValue={HOLLOW_GATE_THREAT_AMBUSH}
                                        onChange={(e) => { setHollowGateThreatAmbush(Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 100)))); }}
                                    />
                                </label>
                                <label style={{ display: "grid", gap: 4 }}>
                                    <span>Trap damage (% of max HP, 0-1)</span>
                                    <input
                                        type="number" min={0} max={1} step={0.01}
                                        defaultValue={HOLLOW_GATE_TRAP_DMG_PCT}
                                        onChange={(e) => { setHollowGateTrapDmgPct(Math.max(0, Math.min(1, Number(e.target.value) || 0))); }}
                                    />
                                </label>
                                <label style={{ display: "grid", gap: 4 }}>
                                    <span>Boss reward boost per floor (mult)</span>
                                    <input
                                        type="number" min={0} max={2} step={0.05}
                                        defaultValue={HOLLOW_GATE_BOSS_FLOOR_REWARD_MULT}
                                        onChange={(e) => { setHollowGateBossFloorRewardMult(Math.max(0, Math.min(2, Number(e.target.value) || 0))); }}
                                    />
                                </label>
                            </div>
                            <p className="hint" style={{ marginTop: 10 }}>
                                Default values: Unlock <strong>10,000</strong> · Key (DK) <strong>5</strong> · Key (FS) <strong>10</strong> · Max Floor <strong>5</strong> · Threat/Step <strong>7</strong> · Ambush <strong>100</strong> · Trap Dmg <strong>0.33</strong> · Boss Floor Mult <strong>0.2</strong>
                            </p>
                        </section>
                    </div>
                );
            })()}

            {activeAdminPanel === "relicDungeons" && adminRole === 'full' && (() => {
                // Image slots for each of the 5 biome relic dungeons. The
                // dungeon runtime reads these via the `event:<id>:<slot>`
                // sharedImages keys (DungeonEncounter + startDungeonAiFight
                // + DungeonPetBattle). Falls back to event/page defaults
                // when a slot is empty.
                type SlotDef = { slot: string; label: string; hint: string; promptTemplate: (biome: string, dungeonName: string) => string };
                const slotTypes: SlotDef[] = [
                    {
                        slot: "backdrop",
                        label: "VN Backdrop",
                        hint: "Wide scene art (1024×512+) shown behind all 3 VN pages.",
                        promptTemplate: (biome, dungeonName) => `${biome} hidden dungeon entrance, sealed stone stairwell descending into ancient ruins, atmospheric ${biome} environment, ${dungeonName}, fantasy RPG landscape art, dramatic lighting`,
                    },
                    {
                        slot: "warden",
                        label: "Dungeon Warden",
                        hint: "Boss portrait (~512×512) shown on the right-hand VN side and in the Seal 1 arena battle.",
                        promptTemplate: (biome, dungeonName) => `Dungeon Warden of the ${dungeonName}, masked ${biome}-themed shinobi boss portrait, ominous mask and robes, glowing eyes, ${biome} chakra aura, dark fantasy RPG character art, square portrait`,
                    },
                    {
                        slot: "tilescene",
                        label: "Tile Game Scene",
                        hint: "Banner image shown above the Seal 2 card-game board.",
                        promptTemplate: (biome, dungeonName) => `Ancient ${biome} shrine altar covered with glowing stone tiles and ${biome}-themed cards floating above it, ${dungeonName} tile-shrine ritual scene, mystical fantasy RPG art, wide banner composition`,
                    },
                    {
                        slot: "pet",
                        label: "Rare Beast (Seal 3)",
                        hint: "Pet portrait (~512×512) shown for the final pet battle. Stats stay rolled from the random rare pool.",
                        promptTemplate: (biome, dungeonName) => `Rare chakra-beast spirit boss of the ${dungeonName}, ${biome}-themed mystical creature, glowing eyes, ${biome} aura, fantasy RPG pet boss portrait, square composition`,
                    },
                ];

                async function uploadDungeonImage(eventId: string, slot: string, file: File) {
                    const reader = new FileReader();
                    reader.onload = async () => {
                        try {
                            const img = await compressDataUrl(reader.result as string, 1024, 0.85);
                            const key = `event:${eventId}:${slot}`;
                            // Optimistic update so the preview refreshes
                            // before the KV round-trip lands. Mirrors the
                            // Hollow Gate atlas pattern.
                            setSharedImages(prev => ({ ...prev, [key]: img }));
                            const ok = await publishSharedImage(key, img);
                            if (!ok) alert(`Failed to publish ${key} to shared KV. The local preview will revert on refresh.`);
                        } catch (err) {
                            alert(`Upload failed: ${err instanceof Error ? err.message : "unknown"}`);
                        }
                    };
                    reader.readAsDataURL(file);
                }

                async function clearDungeonImage(eventId: string, slot: string) {
                    const key = `event:${eventId}:${slot}`;
                    if (!(await gameConfirm(`Remove the ${slot} image for this dungeon?`, { danger: true, confirmLabel: "Remove" }))) return;
                    setSharedImages(prev => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                    });
                    try {
                        await fetch(`/api/images?id=${encodeURIComponent(key)}`, { method: 'DELETE' });
                        try { sessionStorage.removeItem(`imgcat:event`); } catch { /* ignore */ }
                    } catch (err) {
                        console.warn(`[relicDungeons] DELETE ${key} failed`, err);
                    }
                }

                // ── Single-slot AI generation (used by per-slot 🎨 button + the
                // bulk generators below). Calls /api/generate-image with a
                // biome-aware prompt, compresses, then publishes under the
                // shared-image key so all clients pick it up immediately.
                async function generateDungeonSlotImage(eventId: string, slot: SlotDef, dungeonName: string, biome: string) {
                    const prompt = slot.promptTemplate(biome, dungeonName);
                    const response = await fetch("/api/generate-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt, label: `Relic Dungeon ${slot.label}` }),
                    });
                    const rawText = await response.text();
                    let data: Record<string, unknown>;
                    try { data = rawText ? JSON.parse(rawText) : {}; } catch { throw new Error(`Server error ${response.status}`); }
                    if (!response.ok) throw new Error((data.error as string) || `Status ${response.status}`);
                    if (!data.image) throw new Error("No image returned.");
                    const img = await compressDataUrl(data.image as string, 1024, 0.85);
                    const key = `event:${eventId}:${slot.slot}`;
                    setSharedImages(prev => ({ ...prev, [key]: img }));
                    const ok = await publishSharedImage(key, img);
                    if (!ok) throw new Error(`Saved locally but KV publish failed for ${key}`);
                }

                async function generateAllForDungeon(dungeon: typeof craftDungeonEvents[number], overwriteFilled: boolean) {
                    setDungeonImgBulkRunning(true);
                    setDungeonImgBulkProgress({ current: 0, total: slotTypes.length, label: `${dungeon.name} — starting…` });
                    const errors: string[] = [];
                    for (let i = 0; i < slotTypes.length; i++) {
                        const slot = slotTypes[i];
                        const key = `event:${dungeon.id}:${slot.slot}`;
                        // Skip filled slots in "missing only" mode so admins
                        // don't waste credits regenerating slots they already
                        // hand-uploaded.
                        if (!overwriteFilled && sharedImages[key]) {
                            setDungeonImgBulkProgress({ current: i + 1, total: slotTypes.length, label: `${dungeon.name} — ${slot.label} (skip, already filled)` });
                            continue;
                        }
                        setDungeonImgBulkProgress({ current: i + 1, total: slotTypes.length, label: `${dungeon.name} — ${slot.label}` });
                        try {
                            await generateDungeonSlotImage(dungeon.id, slot, dungeon.name, dungeon.biome);
                        } catch (err) {
                            errors.push(`${dungeon.name} · ${slot.label}: ${err instanceof Error ? err.message : "failed"}`);
                        }
                    }
                    setDungeonImgBulkProgress(null);
                    setDungeonImgBulkRunning(false);
                    if (errors.length > 0) alert(`Generation finished with ${errors.length} error(s):\n${errors.join("\n")}`);
                }

                async function generateAllForEveryDungeon(overwriteFilled: boolean) {
                    setDungeonImgBulkRunning(true);
                    const total = craftDungeonEvents.length * slotTypes.length;
                    let done = 0;
                    const errors: string[] = [];
                    for (const dungeon of craftDungeonEvents) {
                        for (const slot of slotTypes) {
                            const key = `event:${dungeon.id}:${slot.slot}`;
                            done += 1;
                            if (!overwriteFilled && sharedImages[key]) {
                                setDungeonImgBulkProgress({ current: done, total, label: `${dungeon.name} — ${slot.label} (skip)` });
                                continue;
                            }
                            setDungeonImgBulkProgress({ current: done, total, label: `${dungeon.name} — ${slot.label}` });
                            try {
                                await generateDungeonSlotImage(dungeon.id, slot, dungeon.name, dungeon.biome);
                            } catch (err) {
                                errors.push(`${dungeon.name} · ${slot.label}: ${err instanceof Error ? err.message : "failed"}`);
                            }
                        }
                    }
                    setDungeonImgBulkProgress(null);
                    setDungeonImgBulkRunning(false);
                    if (errors.length > 0) alert(`Bulk generation finished with ${errors.length} error(s):\n${errors.join("\n")}`);
                    else alert(`Bulk generation complete. All ${total} slot${total === 1 ? "" : "s"} processed.`);
                }

                return (
                    <div className="admin-subpanel">
                        <div className="admin-panel-heading">
                            <h3>🗝 Relic Dungeons — Image Slots</h3>
                            <p className="hint">
                                Each of the 5 biome relic dungeons has 4 image slots: VN backdrop, Dungeon Warden boss
                                portrait, Tile Game scene banner, and the Seal 3 Rare Beast portrait. Slots are stored
                                in the shared KV under <code>event:&lt;dungeon-id&gt;:&lt;slot&gt;</code> keys and overlay the
                                static event defaults at runtime. Images are downscaled to 1024px max edge. <strong>Every
                                upload and AI generation auto-saves to the shared KV</strong> — the green ✓ badge confirms
                                each slot is persisted.
                            </p>
                        </div>

                        {/* ── Bulk generator controls ───────────────────────
                            "Missing only" by default so admins don't blow
                            credits on slots they've hand-curated. Hold the
                            modifier-style "Regenerate all" button to overwrite
                            existing images. */}
                        <section className="summary-box" style={{ marginBottom: 16 }}>
                            <h4 style={{ margin: "0 0 6px" }}>🎨 Batch AI Image Generation</h4>
                            <p className="hint" style={{ marginTop: 0, fontSize: "0.8rem" }}>
                                Uses /api/generate-image with biome-themed prompts. Each generated image is auto-saved to
                                the shared KV under the same key the runtime reads. Total slots across all 5 dungeons: <strong>{craftDungeonEvents.length * slotTypes.length}</strong>.
                            </p>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                                <button
                                    style={{ background: "linear-gradient(135deg, #4f46e5, #818cf8)", color: "#fff", fontWeight: 600 }}
                                    disabled={dungeonImgBulkRunning}
                                    onClick={() => void generateAllForEveryDungeon(false)}
                                >
                                    🎨 Generate Missing (all 5 dungeons)
                                </button>
                                <button
                                    className="danger-button"
                                    disabled={dungeonImgBulkRunning}
                                    onClick={async () => {
                                        if (!(await gameConfirm("Regenerate EVERY slot for all 5 dungeons? This overwrites images you've already saved.", { danger: true, confirmLabel: "Regenerate" }))) return;
                                        void generateAllForEveryDungeon(true);
                                    }}
                                >
                                    ♻ Regenerate ALL (overwrite)
                                </button>
                            </div>
                            {dungeonImgBulkProgress && (
                                <p style={{ marginTop: 10, color: "#facc15", fontSize: "0.85rem" }}>
                                    ⏳ {dungeonImgBulkProgress.current}/{dungeonImgBulkProgress.total} · {dungeonImgBulkProgress.label}
                                </p>
                            )}
                        </section>

                        <div style={{ display: "grid", gap: 20 }}>
                            {craftDungeonEvents.map(dungeon => {
                                const filled = slotTypes.filter(s => sharedImages[`event:${dungeon.id}:${s.slot}`]).length;
                                return (
                                <section key={dungeon.id} className="summary-box">
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                                        <div>
                                            <h4 style={{ marginTop: 0, marginBottom: 4 }}>{dungeon.icon} {dungeon.name}</h4>
                                            <p className="hint" style={{ marginTop: 0 }}>
                                                Biome: <strong>{dungeon.biome}</strong> · Level Req: <strong>{dungeon.levelReq}</strong> · Event ID: <code>{dungeon.id}</code> · Slots filled: <strong>{filled}/{slotTypes.length}</strong>
                                            </p>
                                        </div>
                                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                            <button
                                                style={{ background: "linear-gradient(135deg, #4f46e5, #818cf8)", color: "#fff", fontWeight: 600, fontSize: "0.78rem", padding: "4px 10px" }}
                                                disabled={dungeonImgBulkRunning}
                                                onClick={() => void generateAllForDungeon(dungeon, false)}
                                            >
                                                🎨 Generate Missing
                                            </button>
                                            <button
                                                className="danger-button"
                                                style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                                                disabled={dungeonImgBulkRunning}
                                                onClick={async () => {
                                                    if (!(await gameConfirm(`Regenerate all 4 images for ${dungeon.name}? This overwrites existing images.`, { danger: true, confirmLabel: "Regenerate" }))) return;
                                                    void generateAllForDungeon(dungeon, true);
                                                }}
                                            >
                                                ♻ Regenerate All
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                                        {slotTypes.map(slotDef => {
                                            const key = `event:${dungeon.id}:${slotDef.slot}`;
                                            const currentImage = sharedImages[key];
                                            return (
                                                <div key={key} className="summary-box" style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
                                                    <div style={{ width: 90, height: 90, background: "rgba(0,0,0,0.45)", border: "1px dashed rgba(250,204,21,0.4)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}>
                                                        {currentImage
                                                            ? <img src={currentImage} alt={slotDef.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                            : <span style={{ color: "#facc15", fontSize: 11, textAlign: "center", padding: 4 }}>No image</span>}
                                                        {currentImage && (
                                                            <span
                                                                title="Saved to shared KV"
                                                                style={{ position: "absolute", top: 2, right: 2, background: "rgba(20,83,45,0.92)", color: "#86efac", fontSize: 10, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}
                                                            >
                                                                ✓ Saved
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <strong style={{ fontSize: "0.9rem" }}>{slotDef.label}</strong>
                                                        <p className="hint" style={{ margin: "2px 0 6px", fontSize: "0.72rem" }}>{slotDef.hint}</p>
                                                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                                            <label style={{ cursor: dungeonImgBulkRunning ? "not-allowed" : "pointer", padding: "4px 10px", background: "linear-gradient(135deg, #ca8a04, #facc15)", borderRadius: 4, color: "#1c1917", fontSize: "0.78rem", fontWeight: 600, opacity: dungeonImgBulkRunning ? 0.5 : 1 }}>
                                                                {currentImage ? "Replace" : "Upload"}
                                                                <input
                                                                    type="file"
                                                                    accept="image/*"
                                                                    style={{ display: "none" }}
                                                                    disabled={dungeonImgBulkRunning}
                                                                    onChange={(e) => {
                                                                        const file = e.target.files?.[0];
                                                                        if (file) void uploadDungeonImage(dungeon.id, slotDef.slot, file);
                                                                    }}
                                                                />
                                                            </label>
                                                            <button
                                                                style={{ padding: "4px 10px", fontSize: "0.78rem", background: "linear-gradient(135deg, #4f46e5, #818cf8)", color: "#fff" }}
                                                                disabled={dungeonImgBulkRunning}
                                                                onClick={async () => {
                                                                    setDungeonImgBulkRunning(true);
                                                                    setDungeonImgBulkProgress({ current: 1, total: 1, label: `${dungeon.name} — ${slotDef.label}` });
                                                                    try {
                                                                        await generateDungeonSlotImage(dungeon.id, slotDef, dungeon.name, dungeon.biome);
                                                                    } catch (err) {
                                                                        alert(`Generation failed: ${err instanceof Error ? err.message : "unknown"}`);
                                                                    } finally {
                                                                        setDungeonImgBulkProgress(null);
                                                                        setDungeonImgBulkRunning(false);
                                                                    }
                                                                }}
                                                            >
                                                                🎨 AI
                                                            </button>
                                                            {currentImage && (
                                                                <button
                                                                    className="danger-button"
                                                                    style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                                                                    disabled={dungeonImgBulkRunning}
                                                                    onClick={() => void clearDungeonImage(dungeon.id, slotDef.slot)}
                                                                >
                                                                    Remove
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </section>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}

            {activeAdminPanel === "professions" && (() => {
                // Profession picker image slots. Each row is a key the picker
                // reads from sharedImages; upload a file to publish to the
                // shared KV. Picker falls back to color gradients when missing.
                const slots: Array<{ key: string; label: string; hint: string }> = [
                    { key: "profession:backdrop", label: "Village backdrop (intro + choose pages)", hint: "Wide landscape — village square or elder's hall. Used as the dim backdrop behind the picker." },
                    { key: "profession:elder-portrait", label: "Elder portrait (intro page)", hint: "Square portrait of the village elder speaking to the player. ~512x512." },
                    { key: "profession:portrait-petTamer", label: "Pet Tamer choice card", hint: "Square art — shinobi with a beast companion. ~512x512." },
                    { key: "profession:portrait-healer", label: "Healer choice card", hint: "Square art — medical-nin tending to a patient. ~512x512." },
                    { key: "profession:portrait-vanguard", label: "Vanguard choice card", hint: "Square art — shinobi leading a charge. ~512x512." },
                ];

                async function uploadProfessionImage(key: string, file: File) {
                    const reader = new FileReader();
                    reader.onload = async () => {
                        try {
                            const img = await compressDataUrl(reader.result as string, 512, 0.82);
                            const ok = await publishSharedImage(key, img);
                            if (!ok) alert(`Failed to publish ${key} to shared KV. Try again.`);
                        } catch (err) {
                            alert(`Upload failed: ${err instanceof Error ? err.message : "unknown"}`);
                        }
                    };
                    reader.readAsDataURL(file);
                }

                return (
                    <div className="admin-subpanel">
                        <div className="admin-panel-heading">
                            <h3>🧑‍⚕️ Profession Picker — Image Slots</h3>
                            <p className="hint">
                                Upload images shown in the Level-13 profession picker (visual novel + choice cards).
                                Each slot is a shared image key; the picker falls back to a colored gradient when no
                                image is set. Recommended size: square 512×512 for portraits, wide 1024×512 for the backdrop.
                            </p>
                        </div>
                        <div style={{ display: "grid", gap: 10 }}>
                            {slots.map(slot => {
                                const currentImage = sharedImages[slot.key];
                                return (
                                    <div key={slot.key} className="summary-box" style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 12, alignItems: "center" }}>
                                        <div style={{ width: 120, height: 120, background: "rgba(0,0,0,0.45)", border: "1px dashed rgba(168,85,247,0.4)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                                            {currentImage
                                                ? <img src={currentImage} alt={slot.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                : <span style={{ color: "#a78bfa", fontSize: 11, textAlign: "center", padding: 6 }}>No image yet</span>}
                                        </div>
                                        <div>
                                            <strong>{slot.label}</strong>
                                            <p className="hint" style={{ margin: "4px 0 0", fontSize: "0.78rem" }}>{slot.hint}</p>
                                            <code style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{slot.key}</code>
                                        </div>
                                        <label style={{ cursor: "pointer", padding: "6px 12px", background: "linear-gradient(135deg, #7c3aed, #a855f7)", borderRadius: 4, color: "#faf5ff", fontSize: "0.85rem" }}>
                                            {currentImage ? "Replace" : "Upload"}
                                            <input
                                                type="file"
                                                accept="image/*"
                                                style={{ display: "none" }}
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) void uploadProfessionImage(slot.key, file);
                                                }}
                                            />
                                        </label>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="hint" style={{ marginTop: 12 }}>
                            Tip: portraits look best with the character centered and a transparent or color-matched background.
                            The picker uses the profession's accent color (cyan / orange / lime) on top of the uploaded image.
                        </p>
                    </div>
                );
            })()}

            {activeAdminPanel === "moderation" && adminRole === 'full' && (
                <ModerationPanel adminPw={adminPw} />
            )}

            {activeAdminPanel === "diagnostics" && (
                <AdminDiagnosticsPanel adminPw={adminPw} />
            )}

            <div className="menu">
                <button onClick={() => setScreen("worldMap")}>Test World Map</button>
                <button onClick={() => setScreen("profile")}>Test Profile</button>
                <button onClick={() => setScreen("arena")}>Test Combat</button>
                <button className="danger-button" onClick={() => {
                    // Clear admin session including the role + password so
                    // the next login starts fresh (and Admin 2 logging in
                    // after Admin 1 doesn't inherit "full" by accident).
                    sessionStorage.removeItem("admin:pw");
                    sessionStorage.removeItem("admin:role");
                    setAdminLoggedIn(false);
                    setScreen("start");
                }}>Admin Logout</button>
            </div>
            <p className="hint">Total available jutsus right now: {allGameJutsus.length}</p>
        </div>
    );
}

// ── Kenney Atlas Tile Picker (Hollow Gate admin) ───────────────────────────
// Loads /assets/dungeon/tilemap.png and renders the 29×18 tile grid as a
// clickable scrollable preview. The user clicks a tile to copy its (col, row)
// to the clipboard — then they edit the KENNEY_ATLAS const in App.tsx with
// the picked coords. This finally lets a real human visually verify which
// tile is at which atlas position, instead of me guessing blind.
// KenneyAtlasPicker (admin atlas tile picker) moved to ./components/KenneyAtlasPicker.

// JutsuDropdownList (filterable technique browser) moved to ./components/JutsuDropdownList.

// -- Clan system types & helpers --------------------------------------------
// Clan types (ClanMemberEntry, ClanData, ClanJoinRequest, NoticePostType,
// NoticePost) moved to ./types/clan (type-imported back near the top).
// makeNoticePost / normalizeNoticePosts / noticeTypeLabel moved to
// ./lib/clan-notices (imported back near the top).
// clanContribTotal + clanRankOf (pure clan scoring/rank-label helpers) moved
// to ./lib/clan-math (imported back near the top).
// CLAN_RANK_COLOR / CLAN_RANK_ICON moved to ./constants/clan.
// Clan save/load network helpers (clanSlug, fetchClanData,
// fetchClanDataDetailed, writeClanData, postGuardQueue) moved to
// ./lib/clan-api (imported back near the top).


// -- Expanded clan systems -------------------------------------------------
// Clan types (ClanRole, ClanUpgradeKey, ClanUpgradeLevels, ClanTreasury,
// ClanTreasuryCurrencyKey, ClanWarRecord, EnhancedClanData) moved to
// ./types/clan (type-imported back near the top).
// CLAN_UPGRADE_MAX_LEVEL moved to ./constants/clan.
// clanBoostTiers moved to ./lib/clan-math (imported back near the top).
// clanMissionDefinitions moved to ./constants/clan (imported back near the top).
// CLAN_ROLE_ICON moved to ./constants/clan.
// Pure clan-math helpers (defaultClanTreasury, defaultClanUpgrades,
// cleanClanTreasury, cleanClanUpgrades, defaultClanWarHistory, clanXpNeeded,
// addClanXp, clanMemberBoostPercent, clanUpgradeBonus, canManageClan,
// clanHallTier) moved to ./lib/clan-math (imported back near the top).
// clanRoleOf moved to ./lib/clan-math (clanContribTotal lives there now);
// clanLore moved to ./data/clan-lore. clanMissionProgress stays below — it
// reads the territory cache via loadAllSectorTerritories. enhanceClanData
// moved to ./lib/clan-math (imported back near the top) now that
// normalizeNoticePosts moved to ./lib/clan-notices.
// (clanXpNeeded, addClanXp, clanMemberBoostPercent, clanUpgradeBonus -> ./lib/clan-math)
// (canManageClan, clanHallTier -> ./lib/clan-math)
