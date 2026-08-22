/**
 * Shop family — item/equipment shop (ryo, with Town-Hall discount), card-pack
 * gacha, and the Grand Marketplace (Fate-Shard legendary/mythic items).
 * ShopBase is the shared workhorse; Shop/GrandMarketplace are thin wrappers.
 * Prop-driven, extracted verbatim from App.tsx with no behavior change
 * (prices/discount formulas unchanged). getAllTileCards + the TileCard type
 * are imported back from ../App.
 */
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { effectiveItemLevelReq, meetsItemLevelReq } from "../../../shared/item-level-gate";
// Shop is a lazy screen-level chunk, so it owns the CSS for the pack-opening
// cinematic (component modules must stay CSS-free for node tests). The
// chronicle-duel styles render the revealed cards themselves.
import "../styles/chronicle-duel.css";
import "../styles/card-pack-opening.css";
import { getAllItems } from "../lib/items";
import { countItem } from "../lib/inventory";
import { normalizeEquipmentSlot, equipmentSlotLabel, armorReductionForQuality, consolidateItemBonuses, consumableHoldCap } from "../lib/equipment";
import { petFeedXpForItem, stackableItemIds } from "../data/pet-config";
import { getShopDiscountPercent, discountCost } from "../lib/village-upgrades";
import { GameIcon, type GameIconName } from "./icons/GameIcon";
import { BackToVillageButton } from "./BackToVillageButton";
import type { Character, VersionedCharacterCommit } from "../types/character";
import type { GameItem, EquipmentSlot } from "../types/combat";
import { getAllTileCards, type TileCard } from "../data/tile-cards";
import { openCardPack, type CardPackType } from "../lib/card-pack";
import { displayCardsById, ownedChronicleCounts } from "../lib/chronicle-duel";
import { packArtUrl } from "../lib/card-pack-reveal";
import { CardPackOpening } from "./CardPackOpening";
import { cardGameLockStatus } from "../lib/chronicle-lock";
import { makeId } from "../lib/utils";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { AMBIGUOUS_ACTION_MESSAGE } from "../lib/ambiguous-action";
import { Modal } from "./ui/Modal";

function shopArtworkIcon(item: GameItem): GameIconName {
    switch (normalizeEquipmentSlot(item.slot)) {
        case "head":
        case "body":
        case "waist":
        case "legs":
        case "feet":
            return "shield";
        case "hand":
        case "weapon":
        case "thrown":
            return "sword";
        case "potion":
            return "hp";
        case "aura":
            return "chakra";
        case "accessory":
            return "sigil";
        default:
            return "bag";
    }
}

function ShopItemArtwork({ item }: { item: GameItem }) {
    return (
        <span className={`shop-item-visual rarity-${item.rarity}`} aria-hidden="true">
            <GameIcon name={shopArtworkIcon(item)} size={36} className="shop-item-glyph" />
            {item.image && (
                <img
                    src={item.image}
                    alt=""
                    className="shop-item-thumb"
                    // The shop renders every item of every slot group in one
                    // pass (no pagination, no virtualization), and the catalog
                    // carries ~9.7 MB of 512px art for a 64px thumbnail. Eager
                    // loading made opening the shop a multi-megabyte fetch on a
                    // phone; deferring the off-screen ones costs nothing, since
                    // the GameIcon glyph underneath already fills the frame.
                    loading="lazy"
                    decoding="async"
                    onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
            )}
        </span>
    );
}

function ShopBase({
    character, creatorItems, title, subtitle, filterRarities, currency = "ryo", onBack, backLabel, onVersionedCharacter,
}: {
    character: Character; creatorItems: GameItem[];
    title: string; subtitle: string; filterRarities: GameItem["rarity"][];
    currency?: "ryo" | "fateShards"; onBack: () => void; backLabel?: string; onVersionedCharacter: VersionedCharacterCommit;
}) {
    const [selectedItem, setSelectedItem] = useState<GameItem | null>(null);
    // Bulk-buy quantity for capped consumables/throwables/potions. Reset to 1
    // whenever a different item popup opens.
    const [buyQty, setBuyQty] = useState(1);
    const [purchaseBusy, setPurchaseBusy] = useState(false);
    const purchaseBusyRef = useRef(false);

    const closeItem = useCallback(() => { if (!purchaseBusyRef.current) setSelectedItem(null); }, []);

    // Open an item's popup, resetting the bulk-buy quantity to 1 for a fresh
    // start. (The render also clamps the shown qty to what's buyable, so a stale
    // value can never overflow the cap/wallet even before this resets it.)
    const openItem = (item: GameItem) => { setSelectedItem(item); setBuyQty(1); };

    const allItems = getAllItems(creatorItems);
    const shopSlots: EquipmentSlot[] = ["head", "body", "waist", "legs", "feet", "hand", "aura", "relic", "weapon", "thrown", "item", "potion", "accessory"];
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

    // Combat consumables (the throwable pills + any potion) share one
    // "Consumables" shop section even though they sit on different equip slots
    // ("item" for the pills, "potion" for the Rejuvenation Potion). Identified by
    // weaponEffect / restore fields so other "item"-slot entries (pet treats,
    // crafting mats, evo stones, keys) stay out.
    const isConsumable = (item: GameItem) => {
        const s = normalizeEquipmentSlot(item.slot);
        return s === "potion" || (s === "item" && (!!item.weaponEffect || item.restoreChakra != null || item.restoreStamina != null));
    };
    const slotGroups: { label: string; slots: EquipmentSlot[]; consumables?: boolean }[] = [
        { label: "Head", slots: ["head"] },
        { label: "Chest", slots: ["body", "armor"] },
        { label: "Waist", slots: ["waist"] },
        { label: "Legs", slots: ["legs"] },
        { label: "Feet", slots: ["feet"] },
        { label: "Weapon / Hand", slots: ["hand", "weapon", "thrown"] },
        { label: "Aura / Accessory", slots: ["aura", "accessory", "item"] },
        { label: "Relic", slots: ["relic"] },
        { label: "Consumables", slots: ["potion", "item"], consumables: true },
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

    async function buy(item: GameItem, qty = 1) {
        if (!requireServerSettlement("shopPurchase")) return;
        const finalCost = getShopCost(item.cost);
        // Use the shared ladder, not the raw levelReq — most high-rarity items
        // author no requirement at all, so reading the field directly would show
        // "no requirement" here and then be refused by the server.
        if (!meetsItemLevelReq(item, character.level)) return alert(`Requires Level ${effectiveItemLevelReq(item)}. You are Level ${character.level}.`);

        // Consumables/throwables/potions buy in bulk up to a per-item hold cap
        // (single shared pool — what you own is the ammo battle spends). Other
        // gear stays single-purchase. Clamp the requested amount to what's left
        // under the cap so a bulk buy can never overflow it.
        const cap = consumableHoldCap(item);
        let n = cap == null ? 1 : Math.max(1, Math.floor(qty));
        if (cap != null) {
            const capLeft = Math.max(0, cap - countItem(character, item.id));
            if (capLeft <= 0) return alert(`You can only carry ${cap} ${item.name}.`);
            n = Math.min(n, capLeft);
        }

        const total = finalCost * n;
        if (wallet < total) return alert(`Not enough ${currencyLabel}.`);
        if (purchaseBusyRef.current) return;
        purchaseBusyRef.current = true;
        setPurchaseBusy(true);
        try {
            const response = await fetch('/api/shop/purchase', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: character.name, itemId: item.id, qty: n, requestId: makeId() }),
            });
            const result = await response.json().catch(() => null) as { error?: string; character?: Character; _saveVersion?: number } | null;
            if (!response.ok || !result?.character) return alert(result?.error || AMBIGUOUS_ACTION_MESSAGE);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;

            // Keep the popup open for capped consumables so the player can watch the
            // owned/cap count update and keep buying; close it for one-off gear.
            if (cap == null) setSelectedItem(null);
            else setBuyQty(1);
        } catch {
            alert(AMBIGUOUS_ACTION_MESSAGE);
        } finally {
            purchaseBusyRef.current = false;
            setPurchaseBusy(false);
        }
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
            <BackToVillageButton onClick={onBack} label={backLabel} />
            <h2>{title}</h2>

            <p style={{ marginBottom: "0.25rem", color: "#aaa" }}>{subtitle}</p>

            <p style={{ marginBottom: "1rem" }}>
                {currency === "fateShards"
                    ? <><span style={{ color: "#ce93d8" }}>{currencyIcon} Fate Shards:</span> <strong style={{ color: "#ce93d8" }}>{character.fateShards}</strong></>
                    : <>Wallet: <strong>{character.ryo} ryo</strong> · Town Hall Shop Discount: <strong>{shopDiscountPercent.toFixed(2)}%</strong></>
                }
            </p>

            {slotGroups.map((group) => {
                const groupItems = shopItems.filter((item) =>
                    group.consumables
                        ? isConsumable(item)
                        : group.slots.includes(normalizeEquipmentSlot(item.slot)) && !isConsumable(item));
                if (groupItems.length === 0) return null;

                return (
                    <div key={group.label} style={{ marginBottom: "1.2rem" }}>
                        <h3 style={{ marginBottom: "0.4rem", color: "var(--accent, #e0a000)" }}>{group.label}</h3>

                        <div className="location-grid">
                            {groupItems.map((item) => {
                                const owned = alreadyOwned(item);
                                const finalCost = getShopCost(item.cost);
                                const canAfford = wallet >= finalCost;
                                const levelLocked = !meetsItemLevelReq(item, character.level);

                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="location-button shop-item-button"
                                        onClick={() => openItem(item)}
                                        style={{ opacity: owned || !canAfford || levelLocked ? 0.75 : 1 }}
                                    >
                                        <ShopItemArtwork item={item} />

                                        <span>{rarityIcon[item.rarity]} {item.name}</span>

                                        {item.armorQuality && (
                                            <small style={{ color: qualityColor[item.armorQuality] }}>
                                                {item.armorQuality}
                                            </small>
                                        )}

                                        <small>{isConsumable(item) ? "Consumable" : equipmentSlotLabel(item.slot)}</small>

                                        {levelLocked
                                            ? <small style={{ color: "#ef4444", fontWeight: "bold" }}>🔒 Lv.{effectiveItemLevelReq(item)} Required</small>
                                            : <small style={{ fontWeight: "bold" }}>{currencyIcon} {finalCost} {currencyLabel}{shopDiscountPercent > 0 ? ` (was ${item.cost})` : ""}{owned ? " — Owned" : ""}</small>
                                        }

                                        {consumableHoldCap(item) != null && (
                                            <small style={{ color: "#86efac", fontWeight: "bold" }}>
                                                In bag: {countItem(character, item.id)} / {consumableHoldCap(item)}
                                            </small>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {selectedItem && (
                <Modal open onClose={closeItem} ariaLabel={`${selectedItem.name} item details`} size="lg" bare className="item-popup-card" disableBackdropClose={purchaseBusy}>
                        <button
                            type="button"
                            className="item-popup-close"
                            onClick={closeItem}
                            disabled={purchaseBusy}
                            aria-label="Close"
                        >
                            ×
                        </button>

                        <div className="item-popup-top">
                            <div className="item-popup-art-box">
                                <ShopItemArtwork item={selectedItem} />
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
                                    <p><strong>Equip:</strong> {!stackableItemIds.has(selectedItem.id) && ["head", "body", "waist", "legs", "feet", "hand", "aura", "relic", "thrown"].includes(normalizeEquipmentSlot(selectedItem.slot)) ? "yes" : "no"}</p>
                                    <p><strong>Required Level:</strong> {effectiveItemLevelReq(selectedItem)}</p>
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
                                    {(() => {
                                        const cap = consumableHoldCap(selectedItem);
                                        const unit = getShopCost(selectedItem.cost);

                                        // One-off gear: single Buy button, exactly as before.
                                        if (cap == null) {
                                            return (
                                                <button
                                                    type="button"
                                                    onClick={() => { void buy(selectedItem); }}
                                                    disabled={purchaseBusy || alreadyOwned(selectedItem) || wallet < unit}
                                                >
                                                    {alreadyOwned(selectedItem)
                                                        ? "Owned"
                                                        : wallet < unit
                                                            ? `Need More ${currencyLabel}`
                                                            : <>Buy for {currencyIcon} {unit} {currencyLabel}</>}
                                                </button>
                                            );
                                        }

                                        // Capped consumable: bulk-buy stepper. Cap the selectable
                                        // amount to whatever's left under the hold cap AND what the
                                        // wallet can afford (and a 99 ceiling per the spec).
                                        const owned = countItem(character, selectedItem.id);
                                        const capLeft = Math.max(0, cap - owned);
                                        const affordable = unit > 0 ? Math.floor(wallet / unit) : 0;
                                        const maxBuyable = Math.min(99, capLeft, affordable);
                                        const qty = Math.min(Math.max(1, buyQty), Math.max(1, maxBuyable));

                                        return (
                                            <div className="shop-bulk-buy" style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                                                <small style={{ color: "#86efac", fontWeight: "bold" }}>In bag: {owned} / {cap}</small>

                                                {capLeft <= 0 ? (
                                                    <button type="button" disabled>At carry limit ({cap})</button>
                                                ) : maxBuyable < 1 ? (
                                                    <button type="button" disabled>Need More {currencyLabel}</button>
                                                ) : (
                                                    <>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                            <button type="button" aria-label="Less" onClick={() => setBuyQty(Math.max(1, qty - 1))} disabled={qty <= 1}>−</button>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                max={maxBuyable}
                                                                value={qty}
                                                                onChange={(e) => setBuyQty(Math.max(1, Math.min(maxBuyable, Math.floor(Number(e.target.value) || 1))))}
                                                                style={{ width: 64, textAlign: "center" }}
                                                            />
                                                            <button type="button" aria-label="More" onClick={() => setBuyQty(Math.min(maxBuyable, qty + 1))} disabled={qty >= maxBuyable}>+</button>
                                                            <button type="button" onClick={() => setBuyQty(maxBuyable)} disabled={qty >= maxBuyable}>Max</button>
                                                        </div>
                                                        <button type="button" disabled={purchaseBusy} onClick={() => { void buy(selectedItem, qty); }}>
                                                            Buy {qty} for {currencyIcon} {unit * qty} {currencyLabel}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    <button
                                        type="button"
                                        className="danger-button"
                                        onClick={closeItem}
                                        disabled={purchaseBusy}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                </Modal>
            )}
        </div>
    );
}

// Base (undiscounted) pack prices — must match the storefront buttons below
// and stay in sync with api/card-clash/_pack.ts.
const PACK_BASE_COST: Record<CardPackType, number> = { standard: 250, epic: 10, legendary: 30 };

function CardPackSection({ character, currency, creatorCards, onVersionedCharacter }: { character: Character; currency: "ryo" | "fateShards"; creatorCards: TileCard[]; onVersionedCharacter: VersionedCharacterCommit }) {
    const shopDiscountPercent = currency === "ryo" ? getShopDiscountPercent(character) : (character.elderFocus === "trade" ? 5 : 0);
    const packCost = (cost: number) => discountCost(cost, shopDiscountPercent);
    const [packBusy, setPackBusy] = useState(false);
    const packBusyRef = useRef(false);
    // A settled pack waiting to be ripped open in the cinematic. The save
    // already owns the cards (updateCharacter ran first), so the overlay is
    // pure presentation; ownedBefore snapshots the pre-pack collection for
    // the NEW badges. A fresh nonce remounts the overlay per pack.
    const [packReveal, setPackReveal] = useState<{ nonce: string; packType: CardPackType; cards: string[]; ownedBefore: Map<string, number> } | null>(null);
    const packCardsById = useMemo(() => displayCardsById(getAllTileCards(creatorCards)), [creatorCards]);

    // Warm this storefront's wrapper art while the player is still browsing so
    // the cinematic's pack never pops in with a bare foil.
    useEffect(() => {
        const tiers: CardPackType[] = currency === "ryo" ? ["standard"] : ["epic", "legendary"];
        for (const tier of tiers) new Image().src = packArtUrl(tier);
    }, [currency]);

    async function openPack(packType: CardPackType, cost: number) {
        if (!requireServerSettlement("shopCardPack")) return;
        const wallet = currency === "fateShards" ? character.fateShards : character.ryo;
        const label = currency === "fateShards" ? "Fate Shards" : "ryo";
        const finalCost = packCost(cost);
        if (wallet < finalCost) return alert(`Not enough ${label}.`);
        if (packBusyRef.current) return;
        packBusyRef.current = true;
        setPackBusy(true);
        try {
            const ownedBefore = ownedChronicleCounts(character.tileCards);
            const result = await openCardPack(character.name, packType);
            if (!result.ok || !result.character || !result.cards) return alert(result.error || "Could not open the card pack.");
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            setPackReveal({ nonce: makeId(), packType, cards: result.cards, ownedBefore });
        } finally {
            packBusyRef.current = false;
            setPackBusy(false);
        }
    }

    const againCost = packReveal ? packCost(PACK_BASE_COST[packReveal.packType]) : 0;
    const packWallet = currency === "fateShards" ? character.fateShards : character.ryo;
    const packCurrencyLabel = currency === "fateShards" ? "Fate Shards" : "ryo";

    // Sealed until the Chronicle Scribe event hands over the traveler's codex
    // (the server enforces the same lock on both pack-purchase endpoints).
    const packLock = cardGameLockStatus(character);
    if (packLock.locked) {
        return (
            <div className="card" style={{ marginTop: "1rem" }}>
                <h2>🃏 Card Packs</h2>
                <p style={{ color: "#aaa", marginBottom: 0 }}>{packLock.body}</p>
            </div>
        );
    }

    return (
        <div className="card" style={{ marginTop: "1rem" }}>
            <h2>🃏 Card Packs</h2>
            <p style={{ color: "#aaa", marginBottom: "0.4rem" }}>Collect cards for Shinobi Chronicle Showdown at the Card Hall.</p>
            <p style={{ marginBottom: "0.8rem" }}>Collection: <strong>{character.tileCards.length}</strong> cards</p>
            {currency === "ryo" && (
                <button onClick={() => void openPack("standard", 250)} disabled={packBusy || character.ryo < packCost(250)}>
                    Standard Pack — 5 cards (Common / Rare) — {packCost(250)} ryo{shopDiscountPercent > 0 ? " discounted" : ""}
                </button>
            )}
            {currency === "fateShards" && (
                <>
                    <button onClick={() => void openPack("epic", 10)} disabled={packBusy || character.fateShards < packCost(10)} style={{ color: "#ce93d8" }}>
                        <GameIcon name="crystal" size={13} style={{ display: "inline-block", verticalAlign: "-2px", color: "#ce93d8" }} /> Elite Pack — 1 top-tier card (Rare / Epic) — 10 Fate Shards
                    </button>
                    {/* Legendary pack — sits right next to the Elite pack, costs
                        3× as much for the corresponding tier jump. Same draw
                        mechanic, just filtered to legendary rarity. */}
                    <button
                        onClick={() => void openPack("legendary", 30)}
                        disabled={packBusy || character.fateShards < packCost(30)}
                        style={{ color: "#facc15", marginLeft: 8, borderColor: "rgba(250, 204, 21, 0.5)" }}
                    >
                        👑 Legendary Pack — 1 guaranteed Legendary card — 30 Fate Shards
                    </button>
                </>
            )}
            {packReveal && (
                <CardPackOpening
                    key={packReveal.nonce}
                    packType={packReveal.packType}
                    cards={packReveal.cards}
                    cardsById={packCardsById}
                    ownedBefore={packReveal.ownedBefore}
                    onClose={() => setPackReveal(null)}
                    onOpenAnother={() => void openPack(packReveal.packType, PACK_BASE_COST[packReveal.packType])}
                    openAnotherLabel={`Open Another — ${againCost} ${packCurrencyLabel}`}
                    openAnotherDisabled={packBusy || packWallet < againCost}
                />
            )}
        </div>
    );
}

export function Shop({ character, creatorItems, creatorCards, onBack, onVersionedCharacter }: { character: Character; creatorItems: GameItem[]; creatorCards: TileCard[]; onBack: () => void; onVersionedCharacter: VersionedCharacterCommit }) {
    return (
        <>
            <ShopBase
                character={character}
                creatorItems={creatorItems}
                title="Shop"
                subtitle="Standard gear for everyday shinobi."
                filterRarities={["common", "uncommon", "rare", "epic"]}
                currency="ryo"
                onBack={onBack}
                onVersionedCharacter={onVersionedCharacter}
            />
            <CardPackSection character={character} currency="ryo" creatorCards={creatorCards} onVersionedCharacter={onVersionedCharacter} />
        </>
    );
}

export function GrandMarketplace({ character, creatorItems, creatorCards, onBack, onVersionedCharacter }: { character: Character; creatorItems: GameItem[]; creatorCards: TileCard[]; onBack: () => void; onVersionedCharacter: VersionedCharacterCommit }) {
    return (
        <>
            <ShopBase
                character={character}
                creatorItems={creatorItems}
                title="Grand Marketplace"
                subtitle="Legendary and Mythic equipment from across the shinobi world. All items cost Fate Shards"
                filterRarities={["legendary", "mythic"]}
                currency="fateShards"
                onBack={onBack}
                backLabel="← Central Hub"
                onVersionedCharacter={onVersionedCharacter}
            />
            <CardPackSection character={character} currency="fateShards" creatorCards={creatorCards} onVersionedCharacter={onVersionedCharacter} />
        </>
    );
}
