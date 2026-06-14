/**
 * Shop family — item/equipment shop (ryo, with Town-Hall discount), card-pack
 * gacha, and the Grand Marketplace (Fate-Shard legendary/mythic items).
 * ShopBase is the shared workhorse; Shop/GrandMarketplace are thin wrappers.
 * Prop-driven, extracted verbatim from App.tsx with no behavior change
 * (prices/discount formulas unchanged). getAllTileCards + the TileCard type
 * are imported back from ../App.
 */
/* eslint-disable react-hooks/purity */ // Math.random in card-pack draw; matches App.tsx's file-wide suppression (verbatim)
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { getAllItems } from "../lib/items";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import { normalizeEquipmentSlot, equipmentSlotLabel, armorReductionForQuality, consolidateItemBonuses } from "../lib/equipment";
import { petFeedXpForItem, stackableItemIds } from "../data/pet-config";
import { getShopDiscountPercent, discountCost } from "../lib/village-upgrades";
import { GameIcon } from "./icons/GameIcon";
import type { Character } from "../types/character";
import type { GameItem, EquipmentSlot } from "../types/combat";
import { getAllTileCards, type TileCard } from "../data/tile-cards";

function ShopBase({
    character, updateCharacter, creatorItems, title, subtitle, filterRarities, currency = "ryo",
}: {
    character: Character; updateCharacter: (c: Character) => void; creatorItems: GameItem[];
    title: string; subtitle: string; filterRarities: GameItem["rarity"][];
    currency?: "ryo" | "fateShards";
}) {
    const [selectedItem, setSelectedItem] = useState<GameItem | null>(null);

    // Lock background scroll + allow Escape-to-close while the item popup is open.
    useBodyScrollLock(selectedItem !== null);
    useEffect(() => {
        if (!selectedItem) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedItem(null); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selectedItem]);

    const allItems = getAllItems(creatorItems);
    const shopSlots: EquipmentSlot[] = ["head", "body", "waist", "legs", "feet", "hand", "aura", "weapon", "thrown", "item", "accessory"];
    const armorShopSlots: EquipmentSlot[] = ["body", "head", "waist", "legs", "feet"];
    const shopItems = allItems.filter((item) => {
        const craftOnlyWeapon = item.slot === "hand" && item.weaponEp != null && ["rare", "epic", "legendary"].includes(item.rarity);
        // Rare armor is craft-only — players get it from the Crafter's Armor
        // tab, not the shop. Mirrors the craftOnlyWeapon exclusion above so
        // both gear paths funnel through the crafter for rare-tier pieces.
        const craftOnlyArmor = armorShopSlots.includes(normalizeEquipmentSlot(item.slot)) && item.armorQuality != null && item.rarity === "rare";
        // Drops, crafting materials, and keys ship with cost: 0 because they're
        // earned in-game, not bought. Exclude them from shop listings.
        return shopSlots.includes(item.slot)
            && filterRarities.includes(item.rarity)
            && !craftOnlyWeapon
            && !craftOnlyArmor
            && item.cost > 0;
    });

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
        common: "○",
        uncommon: "◔",
        rare: "✦",
        epic: "✦",
        legendary: "✦",
        mythic: "✦"
    };

    const qualityColor: Record<string, string> = {
        Standard: "#aaa",
        Reinforced: "#4fc3f7",
        Rare: "#81c784",
        Elite: "#ffb74d",
        Legendary: "#ce93d8"
    };

    const currencyLabel = currency === "fateShards" ? "Fate Shards" : "ryo";
    const currencyIcon = currency === "fateShards"
        ? <GameIcon name="shard" size={12} style={{ display: "inline-block", verticalAlign: "-2px", color: "#ce93d8" }} />
        : null;
    const wallet = currency === "fateShards" ? character.fateShards : character.ryo;
    const shopDiscountPercent = currency === "ryo" ? getShopDiscountPercent(character) : (character.elderFocus === "trade" ? 5 : 0);
    const getShopCost = (cost: number) => discountCost(cost, shopDiscountPercent);

    function buy(item: GameItem) {
        const finalCost = getShopCost(item.cost);
        if (item.levelReq && character.level < item.levelReq) return alert(`Requires Level ${item.levelReq}. You are Level ${character.level}.`);
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

    function itemBonusLines(item: GameItem) {
        // Armor blocks maxChakra/maxStamina visually so the popup doesn't
        // double-report them alongside the armor reduction effect.
        const armorExclude = item.armorQuality
            ? new Set(["maxChakra", "maxStamina"])
            : undefined;
        return consolidateItemBonuses(item.bonuses, { excludeStats: armorExclude });
    }

    return (
        <div className="card">
            <h2>{title}</h2>

            <p style={{ marginBottom: "0.25rem", color: "#aaa" }}>{subtitle}</p>

            <p style={{ marginBottom: "1rem" }}>
                {currency === "fateShards"
                    ? <><span style={{ color: "#ce93d8" }}>{currencyIcon} Fate Shards:</span> <strong style={{ color: "#ce93d8" }}>{character.fateShards}</strong></>
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
                                const levelLocked = item.levelReq ? character.level < item.levelReq : false;

                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="location-button shop-item-button"
                                        onClick={() => setSelectedItem(item)}
                                        style={{ opacity: owned || !canAfford || levelLocked ? 0.75 : 1 }}
                                    >
                                        {item.image && (
                                            <img
                                                src={item.image}
                                                alt={item.name}
                                                className="shop-item-thumb"
                                                onError={(e) => { e.currentTarget.style.display = "none"; }}
                                            />
                                        )}

                                        <span>{rarityIcon[item.rarity]} {item.name}</span>

                                        {item.armorQuality && (
                                            <small style={{ color: qualityColor[item.armorQuality] }}>
                                                {item.armorQuality}
                                            </small>
                                        )}

                                        <small>{equipmentSlotLabel(item.slot)}</small>

                                        {levelLocked
                                            ? <small style={{ color: "#ef4444", fontWeight: "bold" }}>🔒 Lv.{item.levelReq} Required</small>
                                            : <small style={{ fontWeight: "bold" }}>{currencyIcon} {finalCost} {currencyLabel}{shopDiscountPercent > 0 ? ` (was ${item.cost})` : ""}{owned ? " — Owned" : ""}</small>
                                        }
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {selectedItem && createPortal(
                <div className="item-popup-backdrop" onClick={() => setSelectedItem(null)}>
                    <div className="item-popup-card" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            className="item-popup-close"
                            onClick={() => setSelectedItem(null)}
                            aria-label="Close"
                        >
                            ×
                        </button>

                        <div className="item-popup-top">
                            <div className="item-popup-art-box">
                                {selectedItem.image ? (
                                    <img src={selectedItem.image} alt={selectedItem.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />
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

                                <p className="item-popup-description">
                                    {selectedItem.description}
                                </p>

                                <div className="item-popup-detail-grid">
                                    <p><strong>Battle Type:</strong> PvE / PvP</p>
                                    <p><strong>Rarity:</strong> {selectedItem.rarity}</p>
                                    <p><strong>Item Type:</strong> {equipmentSlotLabel(selectedItem.slot)}</p>
                                    <p><strong>Hidden:</strong> no</p>
                                    <p><strong>Range:</strong> {selectedItem.weaponRange ?? 0}</p>
                                    <p><strong>Destroy on use:</strong> {stackableItemIds.has(selectedItem.id) ? "yes" : "no"}</p>
                                    <p><strong>Action Usage:</strong> {selectedItem.weaponEp ? `${selectedItem.apCost ?? 40} AP` : "0%"}</p>
                                    <p><strong>Target:</strong> self</p>
                                    <p><strong>Method:</strong> single</p>
                                    <p><strong>Weapon:</strong> {normalizeEquipmentSlot(selectedItem.slot) === "hand" ? "yes" : "none"}</p>
                                    <p><strong>Equip:</strong> {!stackableItemIds.has(selectedItem.id) && ["head", "body", "waist", "legs", "feet", "hand", "aura", "thrown"].includes(normalizeEquipmentSlot(selectedItem.slot)) ? "yes" : "no"}</p>
                                    <p><strong>Required Level:</strong> {selectedItem.levelReq ?? 1}</p>
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

                                {selectedItem.weaponEffect && (
                                    <div className="item-popup-effect-box">
                                        <h4>Weapon Effect: {selectedItem.weaponEffect}</h4>
                                        <div className="item-popup-effect-grid">
                                            <p><strong>Trigger:</strong> On use</p>
                                            <p><strong>Calculation:</strong> {typeof selectedItem.weaponEffectValue === "number" && selectedItem.weaponEffectValue > 100 ? "flat" : "percentage"}</p>
                                            <p><strong>Effect Power:</strong> {selectedItem.weaponEffectValue}{typeof selectedItem.weaponEffectValue === "number" && selectedItem.weaponEffectValue <= 100 ? "%" : ""}</p>
                                            <p><strong>Target:</strong> self / enemy</p>
                                            <p><strong>Damage EP:</strong> {selectedItem.weaponEp ?? 0}</p>
                                            <p><strong>Cooldown:</strong> {selectedItem.weaponCooldown ?? 0} rounds</p>
                                        </div>
                                    </div>
                                )}

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
                                                : <>Buy for {currencyIcon} {getShopCost(selectedItem.cost)} {currencyLabel}</>}
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
                </div>,
                document.body,
            )}
        </div>
    );
}

function CardPackSection({ character, updateCharacter, currency, creatorCards }: { character: Character; updateCharacter: (c: Character) => void; currency: "ryo" | "fateShards"; creatorCards: TileCard[] }) {
    const shopDiscountPercent = currency === "ryo" ? getShopDiscountPercent(character) : (character.elderFocus === "trade" ? 5 : 0);
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
            <p style={{ color: "#aaa", marginBottom: "0.4rem" }}>Collect cards for Shinobi Card Clash at the Card Hall.</p>
            <p style={{ marginBottom: "0.8rem" }}>Collection: <strong>{character.tileCards.length}</strong> cards</p>
            {currency === "ryo" && (
                <button onClick={() => openPack(5, ["common", "rare"], 250)} disabled={character.ryo < packCost(250)}>
                    Standard Pack — 5 cards (Common / Rare) — {packCost(250)} ryo{shopDiscountPercent > 0 ? " discounted" : ""}
                </button>
            )}
            {currency === "fateShards" && (
                <>
                    <button onClick={() => openPack(1, ["epic"], 10)} disabled={character.fateShards < 10} style={{ color: "#ce93d8" }}>
                        <GameIcon name="crystal" size={13} style={{ display: "inline-block", verticalAlign: "-2px", color: "#ce93d8" }} /> Epic Pack — 1 guaranteed Epic card — 10 Fate Shards
                    </button>
                    {/* Legendary pack — sits right next to the Epic pack, costs
                        3× as much for the corresponding tier jump. Same draw
                        mechanic, just filtered to legendary rarity. */}
                    <button
                        onClick={() => openPack(1, ["legendary"], 30)}
                        disabled={character.fateShards < 30}
                        style={{ color: "#facc15", marginLeft: 8, borderColor: "rgba(250, 204, 21, 0.5)" }}
                    >
                        👑 Legendary Pack — 1 guaranteed Legendary card — 30 Fate Shards
                    </button>
                </>
            )}
        </div>
    );
}

export function Shop({ character, updateCharacter, creatorItems, creatorCards }: { character: Character; updateCharacter: (c: Character) => void; creatorItems: GameItem[]; creatorCards: TileCard[] }) {
    return (
        <>
            <ShopBase
                character={character}
                updateCharacter={updateCharacter}
                creatorItems={creatorItems}
                title="Shop"
                subtitle="Standard gear for everyday shinobi."
                filterRarities={["common", "uncommon", "rare", "epic"]}
                currency="ryo"
            />
            <CardPackSection character={character} updateCharacter={updateCharacter} currency="ryo" creatorCards={creatorCards} />
        </>
    );
}

export function GrandMarketplace({ character, updateCharacter, creatorItems, creatorCards }: { character: Character; updateCharacter: (c: Character) => void; creatorItems: GameItem[]; creatorCards: TileCard[] }) {
    return (
        <>
            <ShopBase
                character={character}
                updateCharacter={updateCharacter}
                creatorItems={creatorItems}
                title="Grand Marketplace"
                subtitle="Legendary and Mythic equipment from across the shinobi world. All items cost Fate Shards"
                filterRarities={["legendary", "mythic"]}
                currency="fateShards"
            />
            <CardPackSection character={character} updateCharacter={updateCharacter} currency="fateShards" creatorCards={creatorCards} />
        </>
    );
}
