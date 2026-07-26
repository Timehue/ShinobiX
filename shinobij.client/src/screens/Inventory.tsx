import { useEffect, useRef, useState } from "react";
import { FiGrid, FiPackage } from "react-icons/fi";
import "../styles/profile-skin.css";
// The Chronicle card reader opened from the card tab lives in that stylesheet.
import "../styles/chronicle-duel.css";
import { CloseButton } from "../components/ui/CloseButton";
import { Modal } from "../components/ui/Modal";
import { ChronicleCardInspector } from "../components/ChronicleCardInspector";
import {
    type Character,
    type EquipmentSlot,
    type GameItem,
    LEGENDARY_WAR_CRATE_ID,
    armorReductionForQuality,
    consolidateItemBonuses,
    getAllItems,
    getItemById,
    petFeedXpForItem,
} from "../App";
import {
    COMBAT_ITEM_SLOTS,
    combatConsumableSlots,
    equipCombatItem,
    equipmentSlotLabel,
    equipSlotForItem,
    isCombatConsumable,
    isCombatItemSlot,
    isGloveItem,
    normalizeEquipmentSlot,
} from "../lib/equipment";
import { getCharacterElements, hasCharacterElement } from "../lib/elements";
import { ELEMENTAL_CORE_ID } from "../constants/game";
import { getAllTileCards, type TileCard } from "../data/tile-cards";
import { getChronicleCard } from "../lib/chronicle-duel";
import { addItem, countItem, removeItem, unifiedItemStacks } from "../lib/inventory";
import {
    type ItemCategory,
    ITEM_CATEGORY_META,
    ITEM_CATEGORY_ORDER,
    itemCategory,
    rarityWeight,
} from "../lib/item-category";
import { formatItemBonus, presentItem } from "../lib/item-presentation";
import { settleInventorySale } from "../lib/shop-settlement";
import { requireServerSettlement } from "../lib/server-settlement-gate";

function chronicleInventorySummary(id: string): string {
    const card = getChronicleCard(id);
    if (!card) return "Retired card";
    return card.cardClass === "monster"
        ? `Level ${card.level} · ATK ${card.attack}`
        : card.cardClass === "magic"
            ? "Jutsu"
            : "Snare";
}

// Rarity-tiered ryo sell value for cost:0 hunt drop materials. MUST match the
// server table in api/inventory/_sale.ts (HUNT_MATERIAL_SELL_RYO).
const HUNT_MATERIAL_SELL_RYO: Record<string, number> = {
    "hunt-torn-hide": 12, "hunt-wild-feather": 12, "hunt-small-fang": 12, "hunt-cracked-horn": 12,
    "hunt-beast-meat": 15, "hunt-frost-pelt": 40, "hunt-shadow-claw": 40, "hunt-wolf-fang": 55,
    "hunt-ash-scale": 80, "hunt-ember-scale": 180, "hunt-shadow-pelt": 220,
    "hunt-ancient-beast-core": 450, "hunt-titan-bone": 450, "hunt-legendary-material": 600,
};

export function Inventory({
    character,
    updateCharacter,
    creatorItems,
    creatorCards,
}: {
    character: Character;
    // Accepts a plain replacement OR a functional updater (computing the next
    // character from the latest `prev`). The migration effects below use the
    // functional form so two of them firing in one commit don't clobber each
    // other (each derives `nextEquipment` from `prev.equipment`, not a stale
    // captured `character`). Assignable from the parent's `setCharacter`.
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    creatorItems: GameItem[];
    creatorCards: TileCard[];
}) {
    const [selectedInventoryItem, setSelectedInventoryItem] = useState<null | {
        entry: string;
        item?: GameItem;
        count: number;
        source: "backpack" | "equipped";
        equipmentSlot?: EquipmentSlot;
    }>(null);
    const [inventoryTab, setInventoryTab] = useState<"items" | "tileCards">("items");
    const [selectedTileCard, setSelectedTileCard] = useState<{ card: TileCard; count: number } | null>(null);
    const [slotFilter, setSlotFilter] = useState<EquipmentSlot | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<"all" | ItemCategory>("all");
    const [itemSearch, setItemSearch] = useState("");
    const [openingWarCrate, setOpeningWarCrate] = useState(false);
    const openingWarCrateRef = useRef(false);
    const [attunePickFor, setAttunePickFor] = useState<string | null>(null);
    const [attuneBusy, setAttuneBusy] = useState(false);
    const [attuneMsg, setAttuneMsg] = useState("");
    const allItems = getAllItems(creatorItems, character.weaponElements);
    const allTileCards = getAllTileCards(creatorCards);

    // One-time migration: gloves used to share the weapon's "hand" slot. If a
    // glove is still equipped there (and the new "gloves" slot is free), move it
    // so it stops occupying the weapon hand. Self-terminating — once relocated
    // the condition no longer holds, so this writes at most once.
    useEffect(() => {
        const handId = character.equipment.hand;
        if (!handId || character.equipment.gloves) return;
        const handItem = getItemById(allItems, handId);
        if (!handItem || !isGloveItem(handItem)) return;
        updateCharacter((prev) => {
            if (!prev) return prev;
            // Re-check against the LATEST equipment, not the captured snapshot,
            // so a sibling migration effect in the same commit isn't clobbered.
            const equipment = prev.equipment;
            const id = equipment.hand;
            if (!id || equipment.gloves || id !== handId) return prev;
            const nextEquipment = { ...equipment, gloves: id };
            delete nextEquipment.hand;
            return { ...prev, equipment: nextEquipment };
        });
    }, [character, allItems, updateCharacter]);

    // One-time migration: combat items used to share a single "item" equipment
    // KEY, so only ONE of Attack Pill / Defense Pill / Smoke Bomb could be worn.
    // They now occupy three dedicated keys (item1/2/3). Re-home any legacy "item"
    // selection into the first open item slot and retire the bare key. Junk
    // stranded there by the old equip quirk (materials/collars) is just dropped.
    // Non-consuming, so no inventory stack changes. Self-terminating — once the
    // legacy key is cleared the guard fails.
    useEffect(() => {
        if (!character.equipment.item) return;
        updateCharacter((prev) => {
            if (!prev) return prev;
            // Derive from the LATEST equipment so a sibling migration effect in
            // the same commit isn't overwritten by a stale-snapshot write.
            const legacyId = prev.equipment.item;
            if (!legacyId) return prev;
            const nextEquipment = { ...prev.equipment };
            delete nextEquipment.item;
            const open = COMBAT_ITEM_SLOTS.find((s) => !nextEquipment[s]);
            const already = COMBAT_ITEM_SLOTS.some((s) => nextEquipment[s] === legacyId);
            const legacyItem = getItemById(allItems, legacyId);
            if (open && !already && legacyItem && isCombatConsumable(legacyItem)) {
                nextEquipment[open] = legacyId;
            }
            return { ...prev, equipment: nextEquipment };
        });
    }, [character, allItems, updateCharacter]);

    // A consumable equip slot is just a pointer at a backpack stack (single
    // shared pool — the stack is the ammo battle spends). Once the player burns
    // the last one in a fight the count hits 0, so clear the now-empty pointer
    // and leave the slot empty. Self-terminating: once cleared the guard no
    // longer matches, so this writes at most once per depletion.
    useEffect(() => {
        updateCharacter((prev) => {
            if (!prev) return prev;
            // Recompute against the LATEST character/equipment so a sibling
            // migration effect in the same commit isn't clobbered.
            const equipment = prev.equipment;
            const nextEquipment = { ...equipment };
            let changed = false;
            for (const slot of combatConsumableSlots) {
                const id = equipment[slot];
                if (id && countItem(prev, id) <= 0) {
                    nextEquipment[slot] = undefined;
                    changed = true;
                }
            }
            return changed ? { ...prev, equipment: nextEquipment } : prev;
        });
    }, [character, updateCharacter]);

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

    // Unified backpack stacks across BOTH stores (inventory[] uniques +
    // itemStacks counted bulk items). One row per distinct id, with its total
    // count — the UI is fully id/count based now, no array indices.
    const backpackStacks = unifiedItemStacks(character).map(({ itemId, count }) => {
        const item = getItemById(allItems, itemId) ?? allItems.find((candidate) => candidate.name === itemId);
        return { entry: itemId, item, count, stackKey: item?.id ?? itemId, category: itemCategory(itemId, item) };
    });

    const categoryCounts = backpackStacks.reduce<Record<string, number>>(
        (counts, { category }) => {
            counts.all = (counts.all ?? 0) + 1;
            counts[category] = (counts[category] ?? 0) + 1;
            return counts;
        },
        {},
    );

    const visualSlots: Array<{ label: string; equipmentSlot?: EquipmentSlot; accepts?: EquipmentSlot; className: string }> = [
        { label: "Aura", equipmentSlot: "aura", accepts: "aura", className: "slot-keystone" },
        { label: "Head", equipmentSlot: "head", accepts: "head", className: "slot-head" },
        { label: "Thrown", equipmentSlot: "thrown", accepts: "thrown", className: "slot-thrown" },
        { label: "Item 1", equipmentSlot: "item1", accepts: "item1", className: "slot-left-item-1" },
        { label: "Item 2", equipmentSlot: "item2", accepts: "item2", className: "slot-right-item-1" },
        { label: "Body", equipmentSlot: "body", accepts: "body", className: "slot-chest" },
        { label: "Weapon", equipmentSlot: "hand", accepts: "hand", className: "slot-left-hand" },
        { label: "Waist", equipmentSlot: "waist", accepts: "waist", className: "slot-waist" },
        { label: "Gloves", equipmentSlot: "gloves", accepts: "gloves", className: "slot-right-hand" },
        { label: "Item 3", equipmentSlot: "item3", accepts: "item3", className: "slot-right-item-2" },
        { label: "Legs", equipmentSlot: "legs", accepts: "legs", className: "slot-legs" },
        { label: "Potion", equipmentSlot: "potion", accepts: "potion", className: "slot-left-item-3" },
        { label: "Feet", equipmentSlot: "feet", accepts: "feet", className: "slot-feet" },
    ];

    // Combat consumables (thrown / the three item slots / potion) are spent ON
    // USE in battle, not on equip. Equipping one is a non-consuming SELECTION —
    // it points the slot at an item id without draining the inventory stack (the
    // stack is the ammo the battle screens decrement per use). All other gear
    // keeps the classic "equip pulls one copy from the backpack" swap behaviour.
    const consumableEquipSlots = new Set<EquipmentSlot>(combatConsumableSlots);

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

    function equipItem(item: GameItem) {
        if (item.weaponElement && !hasCharacterElement(character, item.weaponElement)) {
            alert(`You need the ${item.weaponElement} element to equip ${item.name}.`);
            return;
        }
        // Combat items (Attack/Defense Pill, Smoke Bomb) route into one of the
        // three dedicated item KEYS so all three can be worn together — equipping
        // a new one no longer evicts the others. Non-consuming selection (no stack
        // drain). Other slot-"item" entries (materials/collars/pet gear) are not
        // player-equippable and never reach here (their Equip button is hidden).
        if (isCombatConsumable(item)) {
            updateCharacter({ ...character, equipment: equipCombatItem(character.equipment, item.id) });
            setSelectedInventoryItem(null);
            return;
        }
        // Gloves route to the dedicated "gloves" slot so they no longer evict
        // (or get evicted by) the weapon on the shared "hand" slot.
        const slot = equipSlotForItem(item);
        const previousEquipped = equippedIdForSlot(slot);
        // Combat consumables: selecting one neither drains the stack nor evicts
        // a previous pick back to it (nothing was consumed at equip). Other
        // gear pulls one copy from the backpack and returns any evicted item.
        const consumable = consumableEquipSlots.has(slot);
        let next = consumable ? character : removeItem(character, item.id, 1);
        if (!consumable && previousEquipped) next = addItem(next, previousEquipped, 1);

        updateCharacter({
            ...next,
            equipment: {
                ...character.equipment,
                [slot]: item.id,
            },
        });

        setSelectedInventoryItem(null);
    }

    async function applyElementalCore(weaponId: string, element: string) {
        if (attuneBusy) return;
        setAttuneBusy(true);
        setAttuneMsg("");
        try {
            const response = await fetch("/api/weapon/apply-elemental-core", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, weaponId, element }),
            });
            const data = await response.json().catch(() => ({})) as {
                ok?: boolean;
                element?: string;
                character?: Character;
                error?: string;
            };
            if (!response.ok || !data.ok) {
                setAttuneMsg(`Attunement failed: ${data.error ?? "please try again."}`);
                return;
            }
            const canonicalElement = data.element ?? element;
            if (data.character) {
                updateCharacter(data.character);
            } else {
                updateCharacter((prev) => prev
                    ? {
                        ...removeItem(prev, ELEMENTAL_CORE_ID, 1),
                        weaponElements: { ...(prev.weaponElements ?? {}), [weaponId]: canonicalElement },
                    }
                    : prev);
            }
            setAttunePickFor(null);
            setAttuneMsg(`Attuned to ${canonicalElement}.`);
        } catch {
            setAttuneMsg("The attunement response was lost. Refresh before trying again.");
        } finally {
            setAttuneBusy(false);
        }
    }

    function unequipItem(slot: EquipmentSlot) {
        const normalized = normalizeEquipmentSlot(slot);
        const equippedId = equippedIdForSlot(normalized);
        if (!equippedId) return;

        // Consumable slots were a non-consuming selection — clearing one must
        // NOT mint a copy back into the backpack (that would dupe the item).
        const base = consumableEquipSlots.has(normalized) ? character : addItem(character, equippedId, 1);
        updateCharacter({
            ...base,
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

    async function consumeItem(entry: string) {
        if (entry === LEGENDARY_WAR_CRATE_ID) {
            if (!requireServerSettlement("warCrateOpen")) return;
            if (openingWarCrateRef.current) return;
            openingWarCrateRef.current = true;
            setOpeningWarCrate(true);
            try {
                const openWarCrate = () => fetch("/api/village/open-war-crate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerName: character.name }),
                });
                const response = await openWarCrate();
                const data = await response.json().catch(() => null) as {
                    error?: string;
                    character?: Character;
                    reward?: { honorSeals?: number; boneCharms?: number; gotDungeonKey?: boolean };
                } | null;
                if (!response.ok || !data?.character || !data.reward) {
                    throw new Error(data?.error || "War crate could not be opened.");
                }
                updateCharacter(data.character);
                setSelectedInventoryItem(null);
                const honorGain = Math.max(0, Number(data.reward.honorSeals) || 0);
                const charmGain = Math.max(0, Number(data.reward.boneCharms) || 0);
                const honorMsg = honorGain > 0 ? `, +${honorGain} Honor Seals` : `, +${charmGain} Bone Charm`;
                alert(`War crate opened. +1 Warforged Relic, +500 ryo${honorMsg}${data.reward.gotDungeonKey ? ", +1 Dungeon Key" : ""}.`);
            } catch (error) {
                alert(error instanceof Error ? error.message : "War crate could not be opened.");
            } finally {
                openingWarCrateRef.current = false;
                setOpeningWarCrate(false);
            }
            return;
        }

        if (entry === "Soldier Pill") {
            updateCharacter({
                ...removeItem(character, "Soldier Pill", 1),
                stamina: Math.min(character.maxStamina, character.stamina + 25),
            });
            setSelectedInventoryItem(null);
            return;
        }

        if (entry === "Chakra Pill") {
            updateCharacter({
                ...removeItem(character, "Chakra Pill", 1),
                chakra: Math.min(character.maxChakra, character.chakra + 25),
            });
            setSelectedInventoryItem(null);
            return;
        }

        alert("This item cannot be used yet.");
    }

    function isSellableGear(item: GameItem) {
        const slot = normalizeEquipmentSlot(item.slot);
        return item.armorQuality || ["head", "body", "waist", "legs", "feet", "hand", "gloves", "thrown", "item"].includes(slot);
    }

    function sellValueForItem(item: GameItem) {
        // Hunt drop materials are cost:0 (un-buyable) but sell for a rarity-tiered
        // ryo value. MUST match the server table in api/inventory/_sale.ts.
        if ((item.cost ?? 0) <= 0 && item.id in HUNT_MATERIAL_SELL_RYO) return HUNT_MATERIAL_SELL_RYO[item.id];
        return Math.floor(Math.max(0, (item.cost ?? 0)) / 2);
    }

    async function sellSelectedItem(count = 1) {
        if (!requireServerSettlement("inventorySale")) return;
        const selected = selectedInventoryItem;
        if (!selected?.item) return;
        const item = selected.item;
        if (!isSellableGear(item)) return alert("This item cannot be sold.");

        const qty = selected.source === "equipped" ? 1 : Math.max(1, Math.min(selected.count, Math.floor(count)));
        const equipmentSlot = selected.source === "equipped" && selected.equipmentSlot ? normalizeEquipmentSlot(selected.equipmentSlot) : undefined;
        const result = await settleInventorySale(character.name, item.id, selected.source, qty, equipmentSlot);
        if (!result.ok) return alert(result.error);
        updateCharacter(result.character);
        setSelectedInventoryItem(null);
    }

    function describeBonuses(item: GameItem) {
        const petXp = petFeedXpForItem(item.id);
        if (petXp) return `Pet XP +${petXp}`;
        // Use the shared consolidation helper so the inline card summary
        // matches what the popup shows — "All Offense +30" instead of
        // four near-identical ninjutsu/taijutsu/buki/genjutsu lines.
        const bonuses = consolidateItemBonuses(item.bonuses);
        return bonuses.length
            ? bonuses.map((b) => `${b.stat} +${b.value}`).join(", ")
            : "No bonuses";
    }

    function itemBonusLines(item: GameItem) {
        // Armor hides maxChakra/maxStamina in the popup to avoid
        // double-reporting against the armor reduction effect.
        const armorExclude = item.armorQuality
            ? new Set(["maxChakra", "maxStamina"])
            : undefined;
        return consolidateItemBonuses(item.bonuses, { excludeStats: armorExclude });
    }

    function itemInitials(name: string) {
        return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    }

    const selected = selectedInventoryItem;
    const selectedGameItem = selected?.item;
    const selectedPetFoodXp = petFeedXpForItem(selectedGameItem?.id);
    const selectedPresentation = selectedGameItem ? presentItem(selectedGameItem, selectedPetFoodXp) : null;
    const selectedSellValue = selectedGameItem && isSellableGear(selectedGameItem) ? sellValueForItem(selectedGameItem) : 0;
    const selectedActionCost = selectedGameItem
        ? (selectedGameItem.apCost ?? (selectedGameItem.weaponEp ? 40 : 0))
        : 0;
    // Equippable to the player? Combat items authored on "item" equip into
    // item1/2/3; other slot-"item" entries (pet food / materials / collars / pet
    // gear) are not player-equippable. Every other slot equips as before.
    const selectedEquippable = !!selectedGameItem && !selectedPetFoodXp
        && (normalizeEquipmentSlot(selectedGameItem.slot) === "item" ? isCombatConsumable(selectedGameItem) : true);
    const selectedPassiveBonuses = selectedGameItem ? itemBonusLines(selectedGameItem) : [];
    const selectedHasPassiveEffects = !!selectedGameItem?.armorQuality || selectedPassiveBonuses.length > 0;
    // Selling an EQUIPPED consumable would mint ryo without spending the stack
    // (the selection never pulled a copy from the backpack). Sell those from the
    // backpack instead, so hide sell on the equipped instance.
    const equippedConsumableSelected = selected?.source === "equipped"
        && selected.equipmentSlot != null
        && consumableEquipSlots.has(normalizeEquipmentSlot(selected.equipmentSlot));

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
                            const equippedId = slot.equipmentSlot ? equippedIdForSlot(slot.equipmentSlot) : undefined;
                            const equippedItem = getItemById(allItems, equippedId);
                            // Consumable slots draw from a single shared pool, so the slot shows
                            // how many are left (the backpack count). When the player has spent
                            // them all the count is 0 — render the slot EMPTY (the effect above
                            // also clears the stale pointer so it stays empty).
                            const isConsumableSlot = slot.equipmentSlot
                                ? consumableEquipSlots.has(normalizeEquipmentSlot(slot.equipmentSlot))
                                : false;
                            const remaining = isConsumableSlot && equippedId ? countItem(character, equippedId) : null;
                            const equipped = equippedItem && (!isConsumableSlot || (remaining ?? 0) > 0)
                                ? equippedItem
                                : undefined;

                            return (
                                <button
                                    key={slot.className}
                                    type="button"
                                    className={`character-equip-slot ${slot.className} ${equipped ? `filled rarity-${equipped.rarity}` : ""}${slotFilter && slot.accepts === slotFilter ? " slot-filter-active" : ""}`}
                                    onClick={() => {
                                        if (!slot.equipmentSlot && !slot.accepts) return;
                                        const acceptSlot = slot.accepts ?? slot.equipmentSlot ?? null;
                                        if (equipped) {
                                            setSelectedInventoryItem({
                                                entry: equipped.id,
                                                item: equipped,
                                                count: isConsumableSlot ? (remaining ?? 1) : 1,
                                                source: "equipped",
                                                equipmentSlot: slot.equipmentSlot,
                                            });
                                        } else if (acceptSlot) {
                                            setInventoryTab("items");
                                            setSlotFilter((current) => (current === acceptSlot ? null : acceptSlot));
                                        }
                                    }}
                                    aria-label={`${slot.label} equipment slot${equipped ? `, equipped with ${equipped.name}` : ", empty"}`}
                                    title={equipped ? `${equipped.name}: click to inspect` : `Show ${slot.label} items in backpack`}
                                >
                                    {equipped?.image ? (
                                        <img
                                            src={equipped.image}
                                            alt={equipped.name}
                                            onError={(e) => { e.currentTarget.style.display = "none"; }}
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
                                    ) : equipped ? (
                                        <span className="equip-slot-initials">{itemInitials(equipped.name)}</span>
                                    ) : null}

                                    <span className="equip-slot-label">{slot.label}</span>

                                    {equipped && (
                                        <small
                                            className="equip-slot-item-name"
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

                                    {equipped && isConsumableSlot && (
                                        <span
                                            className="equip-slot-count"
                                            style={{
                                                position: "absolute",
                                                top: 2,
                                                right: 2,
                                                zIndex: 2,
                                                background: "rgba(0,0,0,0.85)",
                                                color: "#fff",
                                                border: "1px solid rgba(255,255,255,0.35)",
                                                borderRadius: 8,
                                                padding: "0 5px",
                                                fontSize: "0.7rem",
                                                fontWeight: "bold",
                                                lineHeight: "1.35",
                                            }}
                                        >
                                            ×{remaining}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="inventory-backpack-panel">
                    <div className="inventory-panel-header">
                        <h2>{inventoryTab === "items"
                            ? (categoryFilter === "all" ? "Backpack" : `Backpack · ${ITEM_CATEGORY_META[categoryFilter].label}`)
                            : "Shinobi Chronicle Showdown Cards"}</h2>

                        <div className="inventory-tabs">
                            <button
                                type="button"
                                className={inventoryTab === "items" ? "active" : ""}
                                aria-pressed={inventoryTab === "items"}
                                onClick={() => setInventoryTab("items")}
                            >
                                <FiPackage aria-hidden="true" /> Items
                            </button>

                            <button
                                type="button"
                                className={inventoryTab === "tileCards" ? "active" : ""}
                                aria-pressed={inventoryTab === "tileCards"}
                                onClick={() => setInventoryTab("tileCards")}
                            >
                                <FiGrid aria-hidden="true" /> Chronicle Showdown
                            </button>
                        </div>
                    </div>

                    {inventoryTab === "items" && (
                        <>
                            <div className="inventory-category-bar" role="tablist" aria-label="Backpack categories">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={categoryFilter === "all"}
                                    className={categoryFilter === "all" ? "active" : ""}
                                    onClick={() => { setCategoryFilter("all"); setSlotFilter(null); }}
                                >
                                    All <span className="cat-count">{categoryCounts.all ?? 0}</span>
                                </button>
                                {ITEM_CATEGORY_ORDER.map((category) => {
                                    const count = categoryCounts[category] ?? 0;
                                    const meta = ITEM_CATEGORY_META[category];
                                    return (
                                        <button
                                            key={category}
                                            type="button"
                                            role="tab"
                                            aria-selected={categoryFilter === category}
                                            className={`${categoryFilter === category ? "active" : ""}${count === 0 ? " is-empty" : ""}`}
                                            onClick={() => { setCategoryFilter(category); setSlotFilter(null); }}
                                            title={meta.label}
                                        >
                                            <span className="cat-icon" aria-hidden="true">{meta.icon}</span>
                                            {meta.label}
                                            <span className="cat-count">{count}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="inventory-search-row">
                                <input
                                    type="search"
                                    value={itemSearch}
                                    onChange={(event) => setItemSearch(event.target.value)}
                                    placeholder="Search items by name…"
                                    aria-label="Search backpack items by name"
                                />
                                {itemSearch && (
                                    <button type="button" className="inventory-search-clear" onClick={() => setItemSearch("")} aria-label="Clear search">✕</button>
                                )}
                            </div>

                            {slotFilter && (
                                <div className="slot-filter-bar">
                                    <span>Showing <strong>{equipmentSlotLabel(slotFilter)}</strong> items</span>
                                    <button type="button" onClick={() => setSlotFilter(null)}>✕ Clear</button>
                                </div>
                            )}
                            {(() => {
                                const query = itemSearch.trim().toLowerCase();
                                const visible = backpackStacks
                                    .filter(({ item, category }) => {
                                        if (slotFilter) {
                                            return item && (
                                                isCombatItemSlot(slotFilter)
                                                    ? isCombatConsumable(item)
                                                    : equipSlotForItem(item) === slotFilter
                                            );
                                        }
                                        return categoryFilter === "all" || category === categoryFilter;
                                    })
                                    .filter(({ entry, item }) => !query || (item?.name ?? entry).toLowerCase().includes(query))
                                    .sort((a, b) =>
                                        rarityWeight(b.item?.rarity) - rarityWeight(a.item?.rarity)
                                        || (a.item?.name ?? a.entry).localeCompare(b.item?.name ?? b.entry));
                                if (visible.length === 0) {
                                    const emptyMessage = query
                                        ? `No items match "${itemSearch.trim()}".`
                                        : slotFilter
                                            ? `No ${equipmentSlotLabel(slotFilter)} items in inventory.`
                                            : categoryFilter === "all"
                                                ? "No items in inventory."
                                                : ITEM_CATEGORY_META[categoryFilter].empty;
                                    return <p className="inventory-empty">{emptyMessage}</p>;
                                }
                                return (
                                <div className="backpack-grid">
                                    {visible.map(({ entry, item, count, stackKey }) => (
                                        <div
                                            className={`backpack-item ${item ? `rarity-${item.rarity}` : "rarity-common"}`}
                                            key={stackKey}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() =>
                                                setSelectedInventoryItem({
                                                    entry,
                                                    item,
                                                    count,
                                                    source: "backpack",
                                                })
                                            }
                                            onKeyDown={(e) => {
                                                // Accept both Enter and Space — Space is required
                                                // for accessibility on a non-<button> role="button".
                                                if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault(); // stop Space from page-scrolling
                                                    setSelectedInventoryItem({
                                                        entry,
                                                        item,
                                                        count,
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
                                                        onError={(e) => { e.currentTarget.style.display = "none"; }}
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

                                            {count > 1 && (
                                                <span className="stack-count">{count}</span>
                                            )}

                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();

                                                    setSelectedInventoryItem({
                                                        entry,
                                                        item,
                                                        count,
                                                        source: "backpack",
                                                    });
                                                }}
                                            >
                                                Inspect
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                );
                            })()}
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
                                    No Shinobi Chronicle Showdown cards yet. Buy card packs from the Shop or Grand Marketplace.
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
                                                    <img src={card.image} alt={card.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                                                ) : (
                                                    <span>🃏</span>
                                                )}
                                            </div>

                                            <strong>{card?.name ?? id}</strong>

                                            <div className="tile-card-mini-stats">
                                                <span>{chronicleInventorySummary(card?.id ?? "")}</span>
                                                <span>{card?.element ?? "Unknown"}</span>
                                            </div>

                                            <small>{card?.rarity ?? "missing card"}</small>

                                            {count > 1 && (
                                                <span className="tile-card-count">x{count}</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {selectedTileCard && (() => {
                                const clash = getChronicleCard(selectedTileCard.card.id);
                                // Retired cards are still owned but have no catalog
                                // entry, so there is no frame to enlarge — those keep
                                // the plain summary box.
                                return clash ? (
                                    <ChronicleCardInspector
                                        card={{ ...clash, image: selectedTileCard.card.image }}
                                        onClose={() => setSelectedTileCard(null)}
                                        meta={`Owned ×${selectedTileCard.count}`}
                                    />
                                ) : (
                                    <div className="summary-box tile-card-selected-detail">
                                        <CloseButton
                                            className="item-popup-close"
                                            onClick={() => setSelectedTileCard(null)}
                                            title="Close card details"
                                            label="Close card details"
                                        />
                                        <strong>{selectedTileCard.card.name}</strong>
                                        <p className="hint">
                                            {selectedTileCard.card.rarity} retired card | Owned x
                                            {selectedTileCard.count}
                                            <br />
                                            This card is not part of the current Chronicle catalog.
                                        </p>
                                    </div>
                                );
                            })()}
                        </>
                    )}
                </section>
            </div>

            {selected && (
                <Modal
                    open
                    onClose={() => setSelectedInventoryItem(null)}
                    size="lg"
                    bare
                    ariaLabel={`${selectedGameItem?.name ?? selected.entry} item details`}
                    className="item-popup-modal"
                >
                    <div className="item-popup-card">
                        <CloseButton
                            className="item-popup-close"
                            onClick={() => setSelectedInventoryItem(null)}
                            label="Close item details"
                        />

                        <div className="item-popup-top">
                            <div className="item-popup-art-box">
                                {selectedGameItem?.image ? (
                                    <img src={selectedGameItem.image} alt={selectedGameItem.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />
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
                                            <p><strong>Type:</strong> {selectedPresentation?.category}</p>
                                            <p><strong>Use:</strong> {selectedPresentation?.use}</p>
                                            {selectedPresentation?.showPlayerSlot && <p><strong>Slot:</strong> {equipmentSlotLabel(equipSlotForItem(selectedGameItem))}</p>}
                                            {selectedPresentation?.showPlayerSlot && <p><strong>Level:</strong> {selectedGameItem.levelReq ?? 1}+</p>}
                                            {selectedActionCost > 0 && <p><strong>Action Cost:</strong> {selectedActionCost} AP</p>}
                                            {(selectedGameItem.weaponRange ?? 0) > 0 && <p><strong>Range:</strong> {selectedGameItem.weaponRange}</p>}
                                            {selectedGameItem.weaponEp != null && <p><strong>Damage:</strong> {selectedGameItem.weaponEp} EP</p>}
                                            {selectedGameItem.weaponCooldown != null && selectedGameItem.weaponCooldown > 0 && <p><strong>Cooldown:</strong> {selectedGameItem.weaponCooldown} rounds</p>}
                                            {selectedGameItem.restoreChakra != null && <p><strong>Restores:</strong> {selectedGameItem.restoreChakra} chakra</p>}
                                            {selectedGameItem.restoreStamina != null && <p><strong>Restores:</strong> {selectedGameItem.restoreStamina} stamina</p>}
                                            {selectedGameItem.cost > 0 && <p><strong>Value:</strong> {selectedGameItem.cost} ryo</p>}
                                            {selectedSellValue > 0 && <p><strong>Sell Value:</strong> {selectedSellValue} ryo</p>}
                                            {selectedGameItem.weaponEffect && (
                                                <p>
                                                    <strong>{selectedPresentation?.effectLabel}:</strong> {selectedGameItem.weaponEffect}
                                                    {selectedGameItem.weaponEffectValue != null ? ` ${selectedGameItem.weaponEffectValue}%` : ""}
                                                </p>
                                            )}
                                            {selectedGameItem.weaponEffectTarget === "both" && <p><strong>Target:</strong> both combatants</p>}
                                        </div>
                                        {selectedGameItem.weaponTags && selectedGameItem.weaponTags.length > 0 && (
                                            <div className="item-popup-effect-box">
                                                <h4>Weapon Traits</h4>
                                                <div className="item-popup-effect-grid">
                                                    {selectedGameItem.weaponTags.map((t, i) => (
                                                        <p key={i}><strong>{t.name}</strong> +{t.percent}%</p>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {selectedGameItem.flavorText && (
                                            <p className="item-popup-description item-popup-flavor">
                                                "{selectedGameItem.flavorText}"
                                            </p>
                                        )}

                                        {selectedPetFoodXp && (
                                            <div className="item-popup-effect-box">
                                                <h4>Pet Training</h4>
                                                <div className="item-popup-effect-grid">
                                                    <p><strong>Reward:</strong> +{selectedPetFoodXp} pet XP</p>
                                                    <p><strong>Consumed:</strong> after feeding</p>
                                                </div>
                                            </div>
                                        )}

                                        {selectedHasPassiveEffects && (
                                            <div className="item-popup-effect-box">
                                                <h4>While Equipped</h4>
                                                <div className="item-popup-effect-grid">
                                                    {selectedGameItem.armorQuality && (
                                                        <p><strong>Damage Reduction:</strong> {Math.round(armorReductionForQuality(selectedGameItem.armorQuality) * 100)}%</p>
                                                    )}
                                                    {selectedPassiveBonuses.map((bonus) => (
                                                        <p key={bonus.stat}><strong>{bonus.stat}:</strong> {formatItemBonus(bonus.stat, bonus.value)}</p>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="item-popup-detail-grid">
                                        <p><strong>Type:</strong> Field Consumable</p>
                                        <p><strong>Use:</strong> From backpack</p>
                                        <p><strong>Restores:</strong> {selected.entry === "Chakra Pill" ? "25 chakra" : selected.entry === "Soldier Pill" ? "25 stamina" : "Varies by item"}</p>
                                    </div>
                                )}

                                <div className="item-popup-actions">
                                    {selectedGameItem?.id === LEGENDARY_WAR_CRATE_ID && selected.source === "backpack" && (
                                        <button
                                            type="button"
                                            className="item-action-primary"
                                            disabled={openingWarCrate}
                                            onClick={() => void consumeItem(selected.entry)}
                                        >
                                            {openingWarCrate ? "Opening…" : "Open Crate"}
                                        </button>
                                    )}

                                    {selectedGameItem && selectedEquippable && selected.source === "backpack" && selectedGameItem.id !== LEGENDARY_WAR_CRATE_ID && (
                                        <button
                                            type="button"
                                            className="item-action-primary"
                                            onClick={() => equipItem(selectedGameItem)}
                                        >
                                            Equip to {equipmentSlotLabel(equipSlotForItem(selectedGameItem))}
                                        </button>
                                    )}

                                    {selectedGameItem && selected.source === "equipped" && selected.equipmentSlot && (
                                        <button
                                            type="button"
                                            className="item-action-secondary"
                                            onClick={() => unequipItem(selected.equipmentSlot!)}
                                        >
                                            Unequip
                                        </button>
                                    )}

                                    {selectedGameItem
                                        && normalizeEquipmentSlot(selectedGameItem.slot) === "hand"
                                        && !isGloveItem(selectedGameItem)
                                        && (selectedGameItem.rarity === "legendary" || selectedGameItem.rarity === "mythic") && (
                                        <>
                                            {(() => {
                                                const weaponId = selectedGameItem.id;
                                                const currentElement = character.weaponElements?.[weaponId];
                                                const coreCount = countItem(character, ELEMENTAL_CORE_ID);
                                                const awakenedElements = getCharacterElements(character);
                                                if (attunePickFor === weaponId) {
                                                    return (
                                                        <div className="attune-picker">
                                                            <small>Choose an awakened element. This spends 1 Elemental Core.</small>
                                                            <div className="attune-picker-actions">
                                                                {awakenedElements.map((element) => (
                                                                    <button
                                                                        key={element}
                                                                        type="button"
                                                                        disabled={attuneBusy}
                                                                        onClick={() => void applyElementalCore(weaponId, element)}
                                                                    >
                                                                        {element}
                                                                    </button>
                                                                ))}
                                                                <button
                                                                    type="button"
                                                                    className="item-action-ghost"
                                                                    disabled={attuneBusy}
                                                                    onClick={() => { setAttunePickFor(null); setAttuneMsg(""); }}
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <button
                                                        type="button"
                                                        className="item-action-secondary"
                                                        disabled={coreCount < 1 || awakenedElements.length === 0 || attuneBusy}
                                                        title={awakenedElements.length === 0
                                                            ? "Awaken an element first."
                                                            : coreCount < 1
                                                                ? "Forge an Elemental Core at the Crafter."
                                                                : "Attune this weapon to one of your awakened elements."}
                                                        onClick={() => { setAttuneMsg(""); setAttunePickFor(weaponId); }}
                                                    >
                                                        {currentElement
                                                            ? `Re-attune (currently ${currentElement}) · 1 Core`
                                                            : `Attune with Elemental Core · ${coreCount} owned`}
                                                    </button>
                                                );
                                            })()}
                                            {attuneMsg && <small className="attune-message">{attuneMsg}</small>}
                                        </>
                                    )}

                                    {!selectedGameItem && selected.source === "backpack" && (
                                        <button
                                            type="button"
                                            className="item-action-primary"
                                            onClick={() => void consumeItem(selected.entry)}
                                        >
                                            {selected.entry === "Soldier Pill" || selected.entry === "Chakra Pill" ? "Use" : "Inspect"}
                                        </button>
                                    )}

                                    {selectedGameItem && selectedSellValue > 0 && !equippedConsumableSelected && (
                                        <button
                                            type="button"
                                            className="item-action-secondary"
                                            onClick={() => sellSelectedItem(1)}
                                        >
                                            Sell for {selectedSellValue} ryo
                                        </button>
                                    )}

                                    {selectedGameItem && selected.source === "backpack" && selected.count > 1 && selectedSellValue > 0 && (
                                        <button
                                            type="button"
                                            className="item-action-secondary"
                                            onClick={() => sellSelectedItem(selected.count)}
                                        >
                                            Sell All x{selected.count} for {selectedSellValue * selected.count} ryo
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        className="item-action-ghost"
                                        onClick={() => setSelectedInventoryItem(null)}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
}

