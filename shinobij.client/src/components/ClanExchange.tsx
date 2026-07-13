import { useCallback, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { GameIcon, type GameIconName } from "./icons/GameIcon";
import { ClanImageMark } from "./Marks";
import { CloseButton } from "./ui/CloseButton";
import { Modal } from "./ui/Modal";
import type { Character } from "../types/character";
import type { ClanTreasury, EnhancedClanData } from "../types/clan";
import type { GameItem } from "../types/combat";
import { cleanClanTreasury, clanXpNeeded, enhanceClanData } from "../lib/clan-math";
import { postClanExchangePurchase, type ClanExchangePurchaseResponse } from "../lib/player-api";

const CLAN_POINTS_WEEKLY_CAP = 1000;

type ExchangeLimit =
    | { kind: "weekly"; count: number }
    | { kind: "monthly"; count: number }
    | { kind: "oneTime" };

type ExchangeReward =
    | { kind: "currency"; currency: "ryo" | "boneCharms" | "fateShards" | "auraStones" | "honorSeals"; amount: number }
    | { kind: "item"; itemId: string; count: number }
    | { kind: "treasury"; currency: "warSupply"; amount: number }
    | { kind: "cache"; cache: "weapon" | "armor" }
    | { kind: "locked"; reason: string };

type ExchangeItem = {
    id: string;
    tier: 1 | 2 | 3;
    requiredClanLevel: number;
    name: string;
    description: string;
    cost: number;
    limit: ExchangeLimit;
    rarity: "standard" | "rare" | "epic" | "legendary";
    reward: ExchangeReward;
};

const EXCHANGE_ITEMS: ExchangeItem[] = [
    { id: "smallRyoPouch", tier: 1, requiredClanLevel: 1, name: "Small Ryo Pouch", description: "A sealed clan stipend for active members.", cost: 100, limit: { kind: "weekly", count: 5 }, rarity: "standard", reward: { kind: "currency", currency: "ryo", amount: 2500 } },
    { id: "boneCharmBundle", tier: 1, requiredClanLevel: 1, name: "Bone Charm Bundle", description: "Ten ritual charms used in bloodline and event progression.", cost: 150, limit: { kind: "weekly", count: 5 }, rarity: "rare", reward: { kind: "currency", currency: "boneCharms", amount: 10 } },
    { id: "fateShardBundle", tier: 1, requiredClanLevel: 1, name: "Fate Shard Bundle", description: "Five Fate Shards from the clan vault.", cost: 250, limit: { kind: "weekly", count: 3 }, rarity: "rare", reward: { kind: "currency", currency: "fateShards", amount: 5 } },
    { id: "clanBannerFrame", tier: 1, requiredClanLevel: 1, name: "Clan Banner Frame", description: "A profile banner cosmetic reserved for a future cosmetic frame system.", cost: 500, limit: { kind: "oneTime" }, rarity: "epic", reward: { kind: "locked", reason: "Coming Soon" } },
    { id: "largeRyoPouch", tier: 2, requiredClanLevel: 5, name: "Large Ryo Pouch", description: "A heavier stipend for proven clan contributors.", cost: 400, limit: { kind: "weekly", count: 3 }, rarity: "rare", reward: { kind: "currency", currency: "ryo", amount: 10000 } },
    { id: "boneCharmCrate", tier: 2, requiredClanLevel: 5, name: "Bone Charm Crate", description: "A lacquered crate containing thirty-five Bone Charms.", cost: 450, limit: { kind: "weekly", count: 3 }, rarity: "epic", reward: { kind: "currency", currency: "boneCharms", amount: 35 } },
    { id: "fateShardCrate", tier: 2, requiredClanLevel: 5, name: "Fate Shard Crate", description: "A protected shipment of fifteen Fate Shards.", cost: 650, limit: { kind: "weekly", count: 2 }, rarity: "epic", reward: { kind: "currency", currency: "fateShards", amount: 15 } },
    { id: "auraStone", tier: 2, requiredClanLevel: 5, name: "Aura Stone", description: "A focused Aura Stone for advanced shinobi growth.", cost: 800, limit: { kind: "weekly", count: 2 }, rarity: "epic", reward: { kind: "currency", currency: "auraStones", amount: 1 } },
    { id: "warSupplyGrant", tier: 2, requiredClanLevel: 5, name: "War Supply Grant", description: "Send five hundred War Supply directly to your clan treasury.", cost: 750, limit: { kind: "weekly", count: 2 }, rarity: "epic", reward: { kind: "treasury", currency: "warSupply", amount: 500 } },
    { id: "territoryControlScroll", tier: 2, requiredClanLevel: 5, name: "Territory Control Scroll", description: "A real territory scroll used to reinforce clan sector control.", cost: 900, limit: { kind: "weekly", count: 2 }, rarity: "epic", reward: { kind: "item", itemId: "territory-control-scroll", count: 1 } },
    { id: "honorSealBundle", tier: 2, requiredClanLevel: 5, name: "Honor Seal Bundle", description: "Ten Honor Seals for high-value shinobi development.", cost: 1000, limit: { kind: "weekly", count: 1 }, rarity: "epic", reward: { kind: "currency", currency: "honorSeals", amount: 10 } },
    { id: "premiumFateShardCrate", tier: 3, requiredClanLevel: 10, name: "Premium Fate Shard Crate", description: "A ceremonial crate packed with thirty-five Fate Shards.", cost: 1200, limit: { kind: "weekly", count: 1 }, rarity: "legendary", reward: { kind: "currency", currency: "fateShards", amount: 35 } },
    { id: "auraStoneBundle", tier: 3, requiredClanLevel: 10, name: "Aura Stone Bundle", description: "Three Aura Stones bound in a clan exchange scroll.", cost: 1500, limit: { kind: "weekly", count: 1 }, rarity: "legendary", reward: { kind: "currency", currency: "auraStones", amount: 3 } },
    { id: "greaterWarSupplyGrant", tier: 3, requiredClanLevel: 10, name: "Greater War Supply Grant", description: "Send fifteen hundred War Supply directly to your clan treasury.", cost: 1750, limit: { kind: "weekly", count: 1 }, rarity: "legendary", reward: { kind: "treasury", currency: "warSupply", amount: 1500 } },
    { id: "weaponCache", tier: 3, requiredClanLevel: 10, name: "Weapon Cache", description: "Roll one existing Epic or Legendary weapon from the live item catalog.", cost: 6000, limit: { kind: "weekly", count: 1 }, rarity: "legendary", reward: { kind: "cache", cache: "weapon" } },
    { id: "armorCache", tier: 3, requiredClanLevel: 10, name: "Armor Cache", description: "Roll one existing Epic or Legendary armor piece from the live item catalog.", cost: 8000, limit: { kind: "weekly", count: 1 }, rarity: "legendary", reward: { kind: "cache", cache: "armor" } },
];

const FEATURED_IDS = new Set(["weaponCache", "armorCache", "premiumFateShardCrate", "auraStoneBundle"]);
const ARMOR_SLOTS = new Set(["armor", "head", "body", "waist", "legs", "feet"]);

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function isoWeekKey(date = new Date()): string {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthKey(date = new Date()): string {
    return date.toISOString().slice(0, 7);
}

function purchaseCount(character: Character, item: ExchangeItem): number {
    const purchases = character.clanExchangePurchases ?? {};
    if (item.limit.kind === "weekly") return num(purchases.weekly?.[isoWeekKey()]?.[item.id]);
    if (item.limit.kind === "monthly") return num(purchases.monthly?.[monthKey()]?.[item.id]);
    return purchases.oneTime?.[item.id] ? 1 : 0;
}

function limitCount(item: ExchangeItem): number {
    return item.limit.kind === "oneTime" ? 1 : item.limit.count;
}

function currencyIcon(currency: string): GameIconName {
    if (currency === "ryo") return "ryo";
    if (currency === "boneCharms") return "bone";
    if (currency === "auraStones") return "crystal";
    if (currency === "honorSeals") return "medal";
    return "shard";
}

function rewardSummary(item: ExchangeItem, allItems: GameItem[]): string {
    const reward = item.reward;
    if (reward.kind === "currency") return `${reward.amount.toLocaleString()} ${currencyLabel(reward.currency)}`;
    if (reward.kind === "treasury") return `${reward.amount.toLocaleString()} War Supply to clan`;
    if (reward.kind === "item") return `${reward.count}x ${allItems.find((entry) => entry.id === reward.itemId)?.name ?? item.name}`;
    if (reward.kind === "cache") return reward.cache === "weapon" ? "Epic/Legendary weapon roll" : "Epic/Legendary armor roll";
    return reward.reason;
}

function currencyLabel(currency: string): string {
    if (currency === "boneCharms") return "Bone Charms";
    if (currency === "fateShards") return "Fate Shards";
    if (currency === "auraStones") return "Aura Stones";
    if (currency === "honorSeals") return "Honor Seals";
    return "Ryo";
}

function eligibleCacheCount(allItems: GameItem[], cache: "weapon" | "armor"): number {
    return allItems.filter((item) => {
        if (item.rarity !== "epic" && item.rarity !== "legendary") return false;
        if (cache === "weapon") return item.slot === "weapon" || (item.slot === "hand" && Number.isFinite(Number(item.weaponEp)));
        return ARMOR_SLOTS.has(item.slot);
    }).length;
}

function ExchangeRewardIcon({ item }: { item: ExchangeItem }) {
    const reward = item.reward;
    if (reward.kind === "currency") return <GameIcon name={currencyIcon(reward.currency)} size={34} />;
    if (reward.kind === "item") return <GameIcon name="scroll" size={34} />;
    if (reward.kind === "treasury") return <GameIcon name="sigil" size={34} />;
    if (reward.kind === "cache" && reward.cache === "weapon") return <GameIcon name="sword" size={34} />;
    if (reward.kind === "cache" && reward.cache === "armor") return <GameIcon name="shield" size={34} />;
    return <GameIcon name="sparkle" size={34} />;
}

function ExchangeProductArt({ item }: { item: ExchangeItem }) {
    const reward = item.reward;
    const accentIcon = reward.kind === "currency"
        ? currencyIcon(reward.currency)
        : reward.kind === "treasury"
            ? "sigil"
            : reward.kind === "cache"
                ? reward.cache === "weapon" ? "sword" : "shield"
                : reward.kind === "item"
                    ? "scroll"
                    : "sparkle";
    const theme =
        reward.kind === "currency" ? reward.currency :
        reward.kind === "treasury" ? "treasury" :
        reward.kind === "cache" ? reward.cache :
        reward.kind === "item" ? "scroll" :
        "locked";

    return (
        <div className={`clan-exchange-art ${item.rarity} ${theme}`} aria-hidden="true">
            <span className="clan-exchange-art-ring" />
            <span className="clan-exchange-art-glow" />
            <span className="clan-exchange-art-main"><ExchangeRewardIcon item={item} /></span>
            <span className="clan-exchange-art-mini top"><GameIcon name={accentIcon} size={18} /></span>
            <span className="clan-exchange-art-mini bottom"><GameIcon name={item.tier >= 3 ? "sigil" : item.tier === 2 ? "scroll" : "sparkle"} size={16} /></span>
        </div>
    );
}

function itemStatus(character: Character, clanData: EnhancedClanData, item: ExchangeItem, allItems: GameItem[]) {
    const count = purchaseCount(character, item);
    const limit = limitCount(item);
    if (item.reward.kind === "locked") return { disabled: true, label: "Coming Soon", reason: item.reward.reason, count, limit };
    if (clanData.level < item.requiredClanLevel) return { disabled: true, label: `Level ${item.requiredClanLevel}`, reason: `Requires Clan Level ${item.requiredClanLevel}.`, count, limit };
    if (count >= limit) return { disabled: true, label: "Limit Reached", reason: item.limit.kind === "oneTime" ? "Already purchased." : "Limit reached for this period.", count, limit };
    if (item.reward.kind === "cache" && eligibleCacheCount(allItems, item.reward.cache) === 0) return { disabled: true, label: "No Items", reason: "No eligible live catalog items are configured.", count, limit };
    if (num(character.clanPoints) < item.cost) return { disabled: true, label: "Need Points", reason: `${item.cost.toLocaleString()} Clan Points required.`, count, limit };
    return { disabled: false, label: "Purchase", reason: "", count, limit };
}

function applyExchangeResponse(
    result: ClanExchangePurchaseResponse,
    updateCharacter: Dispatch<SetStateAction<Character | null>>,
    setClanData: Dispatch<SetStateAction<EnhancedClanData | null>>,
) {
    updateCharacter(result.character);
    if (!result.clan) return;
    setClanData((prev) => {
        if (!prev) return prev;
        return enhanceClanData({
            ...prev,
            xp: result.clan?.xp ?? prev.xp,
            level: result.clan?.level ?? prev.level,
            treasury: result.clan?.treasury
                ? cleanClanTreasury(result.clan.treasury as Partial<ClanTreasury>)
                : prev.treasury,
        });
    });
}

export function ClanExchange({
    character,
    clanData,
    allItems,
    updateCharacter,
    setClanData,
    children,
}: {
    character: Character;
    clanData: EnhancedClanData;
    allItems: GameItem[];
    updateCharacter: Dispatch<SetStateAction<Character | null>>;
    setClanData: Dispatch<SetStateAction<EnhancedClanData | null>>;
    children?: ReactNode;
}) {
    const [confirming, setConfirming] = useState<ExchangeItem | null>(null);
    const [busyItem, setBusyItem] = useState<string | null>(null);
    const [reveal, setReveal] = useState<ClanExchangePurchaseResponse["reveal"] | null>(null);
    const purchaseBusyRef = useRef(false);
    const clanPoints = num(character.clanPoints);
    const weeklyEarned = character.weeklyClanPointsWeek === isoWeekKey() ? num(character.weeklyClanPoints) : 0;
    const weekPct = Math.min(100, (weeklyEarned / CLAN_POINTS_WEEKLY_CAP) * 100);
    const xpNeed = clanXpNeeded(clanData.level);
    const tier = clanData.level >= 10 ? 3 : clanData.level >= 5 ? 2 : 1;
    const itemsByTier = useMemo(() => [1, 2, 3].map((t) => EXCHANGE_ITEMS.filter((item) => item.tier === t)), []);
    const featured = useMemo(() => EXCHANGE_ITEMS.filter((item) => FEATURED_IDS.has(item.id)), []);
    const closeConfirmation = useCallback(() => {
        if (!purchaseBusyRef.current) setConfirming(null);
    }, []);
    const closeReveal = useCallback(() => setReveal(null), []);

    async function purchase(item: ExchangeItem) {
        if (purchaseBusyRef.current) return;
        purchaseBusyRef.current = true;
        setBusyItem(item.id);
        try {
            const result = await postClanExchangePurchase(character.name, clanData.name, item.id);
            if (!result) return;
            applyExchangeResponse(result, updateCharacter, setClanData);
            if (result.reveal) setReveal(result.reveal);
            setConfirming(null);
        } finally {
            purchaseBusyRef.current = false;
            setBusyItem(null);
        }
    }

    return (
        <div className="clan-exchange">
            <section className="clan-exchange-hero">
                <div className="clan-exchange-identity">
                    <ClanImageMark image={clanData.image} name={clanData.name} village={clanData.village} />
                    <div>
                        <span className="clan-exchange-kicker">Clan Exchange</span>
                        <h3>{clanData.name}</h3>
                        <p>{clanData.village} exchange tier {tier} unlocked</p>
                    </div>
                </div>
                <div className="clan-exchange-wallet">
                    <div>
                        <span>Clan Points</span>
                        <strong>{clanPoints.toLocaleString()}</strong>
                    </div>
                    <div className="clan-exchange-week">
                        <span>{weeklyEarned.toLocaleString()} / {CLAN_POINTS_WEEKLY_CAP.toLocaleString()} this week</span>
                        <div><i style={{ width: `${weekPct}%` }} /></div>
                    </div>
                </div>
                <div className="clan-exchange-level">
                    <GameIcon name="medal" size={35} />
                    <div>
                        <span>Clan Level {clanData.level}</span>
                        <div><i style={{ width: `${Math.min(100, (clanData.xp / xpNeed) * 100)}%` }} /></div>
                    </div>
                </div>
            </section>

            <section className="clan-exchange-featured">
                <div className="clan-exchange-section-head">
                    <div>
                        <span>Featured requisitions</span>
                        <h4>High-value clan rewards</h4>
                    </div>
                    <GameIcon name="map" size={27} />
                </div>
                <div className="clan-exchange-feature-grid">
                    {featured.map((item) => <ExchangeCard key={item.id} item={item} character={character} clanData={clanData} allItems={allItems} busy={busyItem === item.id} onConfirm={setConfirming} />)}
                </div>
            </section>

            {itemsByTier.map((items, index) => (
                <section className="clan-exchange-tier" key={index + 1}>
                    <div className="clan-exchange-section-head">
                        <div>
                            <span>Tier {index + 1}</span>
                            <h4>{index === 0 ? "Member issue" : index === 1 ? "Officer stores" : "Elite vault"}</h4>
                        </div>
                        {index === 0 ? <GameIcon name="scroll" size={26} /> : index === 1 ? <GameIcon name="shield" size={27} /> : <GameIcon name="sword" size={27} />}
                    </div>
                    <div className="clan-exchange-grid">
                        {items.map((item) => <ExchangeCard key={item.id} item={item} character={character} clanData={clanData} allItems={allItems} busy={busyItem === item.id} onConfirm={setConfirming} />)}
                    </div>
                </section>
            ))}

            {children}

            <Modal
                open={confirming !== null}
                onClose={closeConfirmation}
                ariaLabel={confirming ? `Confirm purchase of ${confirming.name}` : "Confirm clan exchange purchase"}
                size="md"
                bare
                disableBackdropClose={busyItem !== null}
                className="clan-exchange-modal"
            >
                {confirming && (
                    <>
                        <CloseButton className="modal-close" onClick={closeConfirmation} disabled={busyItem !== null} />
                        <span className={`clan-exchange-rarity ${confirming.rarity}`}>{confirming.rarity}</span>
                        <h3>{confirming.name}</h3>
                        <p>{confirming.description}</p>
                        <div className="clan-exchange-confirm-row">
                            <span>Cost</span>
                            <strong>{confirming.cost.toLocaleString()} Clan Points</strong>
                        </div>
                        <div className="clan-exchange-confirm-row">
                            <span>Reward</span>
                            <strong>{rewardSummary(confirming, allItems)}</strong>
                        </div>
                        <div className="menu">
                            <button onClick={() => void purchase(confirming)} disabled={busyItem === confirming.id}>{busyItem === confirming.id ? "Purchasing..." : "Confirm Purchase"}</button>
                            <button className="ghost-button" onClick={closeConfirmation} disabled={busyItem !== null}>Cancel</button>
                        </div>
                    </>
                )}
            </Modal>

            <Modal
                open={reveal !== null}
                onClose={closeReveal}
                ariaLabel={reveal ? `${reveal.name} added to inventory` : "Clan exchange reward"}
                size="md"
                bare
                className="clan-exchange-modal clan-exchange-reveal"
            >
                {reveal && (
                    <>
                        <CloseButton className="modal-close" onClick={closeReveal} />
                        <span className={`clan-exchange-rarity ${reveal.rarity.toLowerCase()}`}>{reveal.rarity}</span>
                        <h3>{reveal.name}</h3>
                        <p>{reveal.slot} cache item added to inventory.</p>
                        <div className="clan-exchange-reveal-mark">{reveal.slot === "hand" || reveal.slot === "weapon" ? <GameIcon name="sword" size={58} /> : <GameIcon name="shield" size={58} />}</div>
                        <button onClick={closeReveal}>Claimed</button>
                    </>
                )}
            </Modal>
        </div>
    );
}

function ExchangeCard({
    item,
    character,
    clanData,
    allItems,
    busy,
    onConfirm,
}: {
    item: ExchangeItem;
    character: Character;
    clanData: EnhancedClanData;
    allItems: GameItem[];
    busy: boolean;
    onConfirm: (item: ExchangeItem) => void;
}) {
    const status = itemStatus(character, clanData, item, allItems);
    const remaining = Math.max(0, status.limit - status.count);
    return (
        <article className={`clan-exchange-card ${item.rarity}${status.disabled ? " locked" : ""}`}>
            <div className="clan-exchange-card-top">
                <span className={`clan-exchange-rarity ${item.rarity}`}>{item.rarity}</span>
                <span>{item.cost.toLocaleString()} CP</span>
            </div>
            <ExchangeProductArt item={item} />
            <h5>{item.name}</h5>
            <p>{item.description}</p>
            <div className="clan-exchange-reward">
                <span>Reward</span>
                <strong>{rewardSummary(item, allItems)}</strong>
            </div>
            <div className="clan-exchange-card-meta">
                <span>Level {item.requiredClanLevel}+</span>
                <span>{item.limit.kind === "oneTime" ? "One-time" : `${remaining}/${status.limit} left`}</span>
            </div>
            {status.reason && <small>{status.reason}</small>}
            <button disabled={status.disabled || busy} onClick={() => onConfirm(item)}>
                {busy ? "Purchasing..." : status.label}
            </button>
        </article>
    );
}
