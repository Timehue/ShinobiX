import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
    type Character,
    type EquipmentSlot,
    type GameItem,
    DUNGEON_KEY_ID,
    LEGENDARY_WAR_CRATE_ID,
    WARFORGED_RELIC_ID,
    armorReductionForQuality,
    consolidateItemBonuses,
    getAllItems,
    getItemById,
    nonVanguardCharmSubstitute,
    petFeedXpForItem,
    vanguardOnlyHonorSeals,
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
import { hasCharacterElement } from "../lib/elements";
import { getAllTileCards, type TileCard } from "../data/tile-cards";
import { deriveCardClashCard } from "../lib/card-clash";
import { addItem, addItems, countItem, removeItem, unifiedItemStacks } from "../lib/inventory";

export function Inventory({
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
        count: number;
        source: "backpack" | "equipped";
        equipmentSlot?: EquipmentSlot;
    }>(null);
    const [inventoryTab, setInventoryTab] = useState<"items" | "tileCards">("items");
    const [selectedTileCard, setSelectedTileCard] = useState<{ card: TileCard; count: number } | null>(null);
    const [slotFilter, setSlotFilter] = useState<EquipmentSlot | null>(null);
    const allItems = getAllItems(creatorItems);
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
        const nextEquipment = { ...character.equipment, gloves: handId };
        delete nextEquipment.hand;
        updateCharacter({ ...character, equipment: nextEquipment });
    }, [character, allItems, updateCharacter]);

    // One-time migration: combat items used to share a single "item" equipment
    // KEY, so only ONE of Attack Pill / Defense Pill / Smoke Bomb could be worn.
    // They now occupy three dedicated keys (item1/2/3). Re-home any legacy "item"
    // selection into the first open item slot and retire the bare key. Junk
    // stranded there by the old equip quirk (materials/collars) is just dropped.
    // Non-consuming, so no inventory stack changes. Self-terminating — once the
    // legacy key is cleared the guard fails.
    useEffect(() => {
        const legacyId = character.equipment.item;
        if (!legacyId) return;
        const nextEquipment = { ...character.equipment };
        delete nextEquipment.item;
        const open = COMBAT_ITEM_SLOTS.find((s) => !nextEquipment[s]);
        const already = COMBAT_ITEM_SLOTS.some((s) => nextEquipment[s] === legacyId);
        const legacyItem = getItemById(allItems, legacyId);
        if (open && !already && legacyItem && isCombatConsumable(legacyItem)) {
            nextEquipment[open] = legacyId;
        }
        updateCharacter({ ...character, equipment: nextEquipment });
    }, [character, allItems, updateCharacter]);

    // A consumable equip slot is just a pointer at a backpack stack (single
    // shared pool — the stack is the ammo battle spends). Once the player burns
    // the last one in a fight the count hits 0, so clear the now-empty pointer
    // and leave the slot empty. Self-terminating: once cleared the guard no
    // longer matches, so this writes at most once per depletion.
    useEffect(() => {
        const equipment = character.equipment;
        const nextEquipment = { ...equipment };
        let changed = false;
        for (const slot of combatConsumableSlots) {
            const id = equipment[slot];
            if (id && countItem(character, id) <= 0) {
                nextEquipment[slot] = undefined;
                changed = true;
            }
        }
        if (changed) updateCharacter({ ...character, equipment: nextEquipment });
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
        return { entry: itemId, item, count, stackKey: item?.id ?? itemId };
    });

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

    function consumeItem(entry: string) {
        if (entry === LEGENDARY_WAR_CRATE_ID) {
            const rewards = [WARFORGED_RELIC_ID];
            if (Math.random() < 0.35) rewards.push(DUNGEON_KEY_ID);
            // Honor Seals are Vanguard-only. Non-Vanguards get the standard
            // 8:1 Bone Charm substitute instead (matches every other grant
            // site since 510f4cb).
            const honorSealGain = vanguardOnlyHonorSeals(character, 10);
            const charmGain = nonVanguardCharmSubstitute(character, 10);
            updateCharacter({
                ...addItems(removeItem(character, LEGENDARY_WAR_CRATE_ID, 1), rewards),
                honorSeals: (character.honorSeals ?? 0) + honorSealGain,
                boneCharms: (character.boneCharms ?? 0) + charmGain,
                ryo: character.ryo + 500,
            });
            setSelectedInventoryItem(null);
            const honorMsg = honorSealGain > 0
                ? `, +${honorSealGain} Honor Seals`
                : charmGain > 0 ? `, +${charmGain} Bone Charms` : "";
            alert(`War crate opened. +1 Warforged Relic, +500 ryo${honorMsg}${rewards.includes(DUNGEON_KEY_ID) ? ", +1 Dungeon Key" : ""}.`);
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
        return Math.floor(Math.max(0, item.cost) / 2);
    }

    function sellSelectedItem(count = 1) {
        const selected = selectedInventoryItem;
        if (!selected?.item) return;
        const item = selected.item;
        if (!isSellableGear(item)) return alert("This item cannot be sold.");

        const qty = selected.source === "equipped" ? 1 : Math.max(1, Math.min(selected.count, Math.floor(count)));
        const saleValue = sellValueForItem(item) * qty;

        if (selected.source === "equipped" && selected.equipmentSlot) {
            const normalized = normalizeEquipmentSlot(selected.equipmentSlot);
            updateCharacter({
                ...character,
                ryo: character.ryo + saleValue,
                equipment: {
                    ...character.equipment,
                    [normalized]: undefined,
                    ...(normalized === "hand" ? { weapon: undefined } : {}),
                    ...(normalized === "body" ? { armor: undefined } : {}),
                    ...(normalized === "aura" ? { accessory: undefined } : {}),
                },
            });
            setSelectedInventoryItem(null);
            return;
        }

        updateCharacter({
            ...removeItem(character, item.id, qty),
            ryo: character.ryo + saleValue,
        });
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
    const selectedSellValue = selectedGameItem && isSellableGear(selectedGameItem) ? sellValueForItem(selectedGameItem) : 0;
    // Equippable to the player? Combat items authored on "item" equip into
    // item1/2/3; other slot-"item" entries (pet food / materials / collars / pet
    // gear) are not player-equippable. Every other slot equips as before.
    const selectedEquippable = !!selectedGameItem && !selectedPetFoodXp
        && (normalizeEquipmentSlot(selectedGameItem.slot) === "item" ? isCombatConsumable(selectedGameItem) : true);
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
                        <h2>{inventoryTab === "items" ? "Backpack" : "Shinobi Card Clash Cards"}</h2>

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
                                🃏 Card Clash
                            </button>
                        </div>
                    </div>

                    {inventoryTab === "items" && (
                        <>
                            {slotFilter && (
                                <div className="slot-filter-bar">
                                    <span>Showing <strong>{equipmentSlotLabel(slotFilter)}</strong> items</span>
                                    <button type="button" onClick={() => setSlotFilter(null)}>✕ Clear</button>
                                </div>
                            )}
                            {(() => {
                                // Filtering by one of the three item slots shows the
                                // combat items (Attack/Defense Pill, Smoke Bomb) — all
                                // are eligible for any item slot. Other slots match on
                                // the item's destination slot as before.
                                const visible = slotFilter
                                    ? backpackStacks.filter(({ item }) => item && (
                                        isCombatItemSlot(slotFilter)
                                            ? isCombatConsumable(item)
                                            : equipSlotForItem(item) === slotFilter
                                    ))
                                    : backpackStacks;
                                if (visible.length === 0) {
                                    return <p className="inventory-empty">{slotFilter ? `No ${equipmentSlotLabel(slotFilter)} items in inventory.` : "No items in inventory."}</p>;
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
                                    No Shinobi Card Clash cards yet. Buy card packs from the Shop or Grand Marketplace.
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
                                                <span>⏣ {card ? deriveCardClashCard(card).cost : "?"} · ⚔ {card ? deriveCardClashCard(card).power : "?"}</span>
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

                            {selectedTileCard && (
                                <div className="summary-box tile-card-selected-detail">
                                    <button
                                        type="button"
                                        className="item-popup-close"
                                        onClick={() => setSelectedTileCard(null)}
                                        title="Close card details"
                                        aria-label="Close"
                                    >
                                        ×
                                    </button>
                                    <strong>{selectedTileCard.card.name}</strong>
                                    {(() => {
                                        const clash = deriveCardClashCard(selectedTileCard.card);
                                        return (
                                            <p className="hint">
                                                {selectedTileCard.card.rarity} {selectedTileCard.card.element} · ⏣ {clash.cost} Chakra · ⚔ {clash.power} Power · {clash.role} | Owned x{selectedTileCard.count}
                                                <br />{clash.abilityText}
                                            </p>
                                        );
                                    })()}
                                </div>
                            )}
                        </>
                    )}
                </section>
            </div>

            {selected && createPortal(
                <div className="item-popup-backdrop" onClick={() => setSelectedInventoryItem(null)}>
                    <div className="item-popup-card" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            className="item-popup-close"
                            onClick={() => setSelectedInventoryItem(null)}
                            aria-label="Close"
                        >
                            ×
                        </button>

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
                                            <p><strong>Battle Type:</strong> PvE / PvP</p>
                                            <p><strong>Rarity:</strong> {selectedGameItem.rarity}</p>
                                            <p><strong>Item Type:</strong> {equipmentSlotLabel(selectedGameItem.slot)}</p>
                                            <p><strong>Hidden:</strong> no</p>
                                            <p><strong>Range:</strong> {selectedGameItem.weaponRange ?? 0}</p>
                                            <p><strong>Destroy on use:</strong> {selectedPetFoodXp ? "yes" : "no"}</p>
                                            <p><strong>Action Usage:</strong> {selectedGameItem.apCost ? `${selectedGameItem.apCost} AP` : selectedGameItem.weaponEp ? "40 AP" : "0%"}</p>
                                            <p><strong>Target:</strong> {selectedPetFoodXp ? "selected pet" : "self"}</p>
                                            <p><strong>Method:</strong> single</p>
                                            <p><strong>Weapon:</strong> {normalizeEquipmentSlot(selectedGameItem.slot) === "hand" && !isGloveItem(selectedGameItem) ? "yes" : "none"}</p>
                                            <p><strong>Equip:</strong> {selectedPetFoodXp ? "no" : "yes"}</p>
                                            <p><strong>Required Level:</strong> {selectedGameItem.levelReq ?? 1}</p>
                                            <p><strong>Shop Price:</strong> {selectedGameItem.cost} ryo</p>
                                            {selectedSellValue > 0 && <p><strong>Sell Value:</strong> {selectedSellValue} ryo</p>}
                                            {selectedGameItem.weaponEp != null && <p><strong>Damage EP:</strong> {selectedGameItem.weaponEp}</p>}
                                            {selectedGameItem.weaponEffect && <p><strong>Weapon Effect:</strong> {selectedGameItem.weaponEffect} {selectedGameItem.weaponEffectValue ?? ""}%</p>}
                                            {selectedGameItem.weaponCooldown != null && selectedGameItem.weaponCooldown > 0 && <p><strong>Cooldown:</strong> {selectedGameItem.weaponCooldown} round(s)</p>}
                                        </div>
                                        {selectedGameItem.weaponTags && selectedGameItem.weaponTags.length > 0 && (
                                            <div className="item-popup-effect-box">
                                                <h4>Named Weapon Tags</h4>
                                                <div className="item-popup-effect-grid">
                                                    {selectedGameItem.weaponTags.map((t, i) => (
                                                        <p key={i}><strong>Tag {i + 1}:</strong> {t.name} — {t.percent}%</p>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {selectedGameItem.flavorText && (
                                            <p className="item-popup-description" style={{ fontStyle: "italic", color: "#94a3b8", marginTop: 6 }}>
                                                "{selectedGameItem.flavorText}"
                                            </p>
                                        )}

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
                                        <p><strong>Target:</strong> self</p>
                                        <p><strong>Method:</strong> single</p>
                                    </div>
                                )}

                                <div className="item-popup-actions">
                                    {selectedGameItem?.id === LEGENDARY_WAR_CRATE_ID && selected.source === "backpack" && (
                                        <button
                                            type="button"
                                            onClick={() => consumeItem(selected.entry)}
                                        >
                                            Open Crate
                                        </button>
                                    )}

                                    {selectedGameItem && selectedEquippable && selected.source === "backpack" && selectedGameItem.id !== LEGENDARY_WAR_CRATE_ID && (
                                        <button
                                            type="button"
                                            onClick={() => equipItem(selectedGameItem)}
                                        >
                                            Equip to {equipmentSlotLabel(equipSlotForItem(selectedGameItem))}
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
                                            onClick={() => consumeItem(selected.entry)}
                                        >
                                            {selected.entry === "Soldier Pill" || selected.entry === "Chakra Pill" ? "Use" : "Inspect"}
                                        </button>
                                    )}

                                    {selectedGameItem && selectedSellValue > 0 && !equippedConsumableSelected && (
                                        <button
                                            type="button"
                                            onClick={() => sellSelectedItem(1)}
                                        >
                                            Sell for {selectedSellValue} ryo
                                        </button>
                                    )}

                                    {selectedGameItem && selected.source === "backpack" && selected.count > 1 && selectedSellValue > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => sellSelectedItem(selected.count)}
                                        >
                                            Sell All x{selected.count} for {selectedSellValue * selected.count} ryo
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
                </div>,
                document.body,
            )}
        </>
    );
}

