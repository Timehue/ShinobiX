import { useState } from "react";
import {
    type Character,
    type EquipmentSlot,
    type GameItem,
    type TileCard,
    DUNGEON_KEY_ID,
    LEGENDARY_WAR_CRATE_ID,
    WARFORGED_RELIC_ID,
    armorReductionForQuality,
    equipmentSlotLabel,
    getAllItems,
    getAllTileCards,
    getItemById,
    hasCharacterElement,
    normalizeEquipmentSlot,
    petFeedXpForItem,
} from "../App";

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
        index: number;
        count: number;
        source: "backpack" | "equipped";
        equipmentSlot?: EquipmentSlot;
    }>(null);
    const [inventoryTab, setInventoryTab] = useState<"items" | "tileCards">("items");
    const [selectedTileCard, setSelectedTileCard] = useState<{ card: TileCard; count: number } | null>(null);
    const [slotFilter, setSlotFilter] = useState<EquipmentSlot | null>(null);
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
        { label: "Hand", equipmentSlot: "hand", accepts: "hand", className: "slot-left-hand" },
        { label: "Waist", equipmentSlot: "waist", accepts: "waist", className: "slot-waist" },
        { label: "Hand", className: "slot-right-hand" },
        { label: "Legs", equipmentSlot: "legs", accepts: "legs", className: "slot-legs" },
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
        if (item.weaponElement && !hasCharacterElement(character, item.weaponElement)) {
            alert(`You need the ${item.weaponElement} element to equip ${item.name}.`);
            return;
        }
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
        if (entry === LEGENDARY_WAR_CRATE_ID) {
            const rewards = [WARFORGED_RELIC_ID];
            if (Math.random() < 0.35) rewards.push(DUNGEON_KEY_ID);
            updateCharacter({
                ...character,
                inventory: [...removeInventoryIndex(index), ...rewards],
                honorSeals: (character.honorSeals ?? 0) + 10,
                ryo: character.ryo + 500,
            });
            setSelectedInventoryItem(null);
            alert(`War crate opened. +1 Warforged Relic, +500 ryo, +10 Honor Seals${rewards.includes(DUNGEON_KEY_ID) ? ", +1 Dungeon Key" : ""}.`);
            return;
        }

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

    function isSellableGear(item: GameItem) {
        const slot = normalizeEquipmentSlot(item.slot);
        return item.armorQuality || ["head", "body", "waist", "legs", "feet", "hand", "thrown", "item"].includes(slot);
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

        let remaining = qty;
        const nextInventory = character.inventory.filter((entry, index) => {
            if (remaining <= 0) return true;
            const matchesSelectedStack = entry === selected.entry || entry === item.id || index === selected.index;
            if (!matchesSelectedStack) return true;
            remaining -= 1;
            return false;
        });

        updateCharacter({
            ...character,
            ryo: character.ryo + saleValue,
            inventory: nextInventory,
        });
        setSelectedInventoryItem(null);
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
        const armorExclude = new Set(["maxChakra", "maxStamina"]);
        return Object.entries(item.bonuses)
            .filter(([stat, value]) => typeof value === "number" && value !== 0 && !(item.armorQuality && armorExclude.has(stat)))
            .map(([stat, value]) => ({
                stat: statLabel(stat),
                value: value as number,
            }));
    }

    function itemInitials(name: string) {
        return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    }

    const selected = selectedInventoryItem;
    const selectedGameItem = selected?.item;
    const selectedPetFoodXp = petFeedXpForItem(selectedGameItem?.id);
    const selectedSellValue = selectedGameItem && isSellableGear(selectedGameItem) ? sellValueForItem(selectedGameItem) : 0;

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
                                    className={`character-equip-slot ${slot.className} ${equipped ? `filled rarity-${equipped.rarity}` : ""}${slotFilter && slot.accepts === slotFilter ? " slot-filter-active" : ""}`}
                                    onClick={() => {
                                        if (!slot.equipmentSlot && !slot.accepts) return;
                                        const acceptSlot = slot.accepts ?? slot.equipmentSlot ?? null;
                                        if (equipped) {
                                            setSelectedInventoryItem({
                                                entry: equipped.id,
                                                item: equipped,
                                                index: -1,
                                                count: 1,
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
                                ?? Items
                            </button>

                            <button
                                type="button"
                                className={inventoryTab === "tileCards" ? "active" : ""}
                                onClick={() => setInventoryTab("tileCards")}
                            >
                                ?? Tile Cards
                            </button>
                        </div>
                    </div>

                    {inventoryTab === "items" && (
                        <>
                            {slotFilter && (
                                <div className="slot-filter-bar">
                                    <span>Showing <strong>{slotFilter.charAt(0).toUpperCase() + slotFilter.slice(1)}</strong> items</span>
                                    <button type="button" onClick={() => setSlotFilter(null)}>✕ Clear</button>
                                </div>
                            )}
                            {(() => {
                                const visible = slotFilter
                                    ? backpackStacks.filter(({ item }) => item && normalizeEquipmentSlot(item.slot) === slotFilter)
                                    : backpackStacks;
                                if (visible.length === 0) {
                                    return <p className="inventory-empty">{slotFilter ? `No ${slotFilter} items in inventory.` : "No items in inventory."}</p>;
                                }
                                return (
                                <div className="backpack-grid">
                                    {visible.map(({ entry, item, indices, stackKey }) => (
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
                                                    <span>??</span>
                                                )}
                                            </div>

                                            <strong>{card?.name ?? id}</strong>

                                            <div className="tile-card-mini-stats">
                                                <span>T:{card?.top ?? "?"} R:{card?.right ?? "?"}</span>
                                                <span>B:{card?.bottom ?? "?"} L:{card?.left ?? "?"}</span>
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
                                    >
                                        x
                                    </button>
                                    <strong>{selectedTileCard.card.name}</strong>
                                    <p className="hint">
                                        {selectedTileCard.card.rarity} {selectedTileCard.card.element} card | T:{selectedTileCard.card.top} R:{selectedTileCard.card.right} B:{selectedTileCard.card.bottom} L:{selectedTileCard.card.left} | Owned x{selectedTileCard.count}
                                    </p>
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
                            ?
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
                                            <p><strong>Item Type:</strong> {equipmentSlotLabel(selectedGameItem.slot)}</p>
                                            <p><strong>Hidden:</strong> no</p>
                                            <p><strong>Range:</strong> {selectedGameItem.weaponRange ?? 0}</p>
                                            <p><strong>Destroy on use:</strong> {selectedPetFoodXp ? "yes" : "no"}</p>
                                            <p><strong>Action Usage:</strong> {selectedGameItem.apCost ? `${selectedGameItem.apCost} AP` : selectedGameItem.weaponEp ? "40 AP" : "0%"}</p>
                                            <p><strong>Target:</strong> {selectedPetFoodXp ? "selected pet" : "self"}</p>
                                            <p><strong>Method:</strong> single</p>
                                            <p><strong>Weapon:</strong> {normalizeEquipmentSlot(selectedGameItem.slot) === "hand" ? "yes" : "none"}</p>
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
                                            onClick={() => consumeItem(selected.entry, selected.index)}
                                        >
                                            Open Crate
                                        </button>
                                    )}

                                    {selectedGameItem && selected.source === "backpack" && !selectedPetFoodXp && selectedGameItem.id !== LEGENDARY_WAR_CRATE_ID && (
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

                                    {selectedGameItem && selectedSellValue > 0 && (
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
                </div>
            )}
        </>
    );
}

