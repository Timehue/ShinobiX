import { useCallback, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { GameIcon, type GameIconName } from "./icons/GameIcon";
import { ClanImageMark } from "./Marks";
import { clanExchangeItemArt } from "./ClanExchangeItemArt";
import { CloseButton } from "./ui/CloseButton";
import { Modal } from "./ui/Modal";
import clanVaultHero from "../assets/clan-exchange/clan-vault-hero.webp";
import type { Character } from "../types/character";
import type { ClanTreasury, EnhancedClanData } from "../types/clan";
import type { GameItem } from "../types/combat";
import { cleanClanTreasury, enhanceClanData } from "../lib/clan-math";
import { postClanExchangePurchase, type ClanExchangePurchaseResponse } from "../lib/player-api";

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

const ARMOR_SLOTS = new Set(["armor", "head", "body", "waist", "legs", "feet"]);
const EXCHANGE_TIERS = [
    { tier: 1, level: 1, label: "Member stores", icon: "scroll" as GameIconName },
    { tier: 2, level: 5, label: "Officer stores", icon: "shield" as GameIconName },
    { tier: 3, level: 10, label: "Elite vault", icon: "sword" as GameIconName },
] as const;

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
    const art = clanExchangeItemArt(item.id);
    return (
        <div className={`clan-exchange-art ${item.rarity}`} aria-hidden="true">
            {art
                ? <img src={art} alt="" className="clan-exchange-art-img" loading="lazy" />
                : <span className="clan-exchange-art-main"><ExchangeRewardIcon item={item} /></span>}
        </div>
    );
}

function itemStatus(character: Character, clanData: EnhancedClanData, item: ExchangeItem, allItems: GameItem[]) {
    const count = purchaseCount(character, item);
    const limit = limitCount(item);
    if (item.reward.kind === "locked") return { state: "coming-soon", disabled: true, label: "Coming soon", reason: item.reward.reason, count, limit } as const;
    if (clanData.level < item.requiredClanLevel) return { state: "level-locked", disabled: true, label: `Clan Level ${item.requiredClanLevel}`, reason: `Unlocks at Clan Level ${item.requiredClanLevel}.`, count, limit } as const;
    if (count >= limit) return { state: "limit-reached", disabled: true, label: "Limit reached", reason: item.limit.kind === "oneTime" ? "Already requisitioned." : "Requisition limit reached for this period.", count, limit } as const;
    if (item.reward.kind === "cache" && eligibleCacheCount(allItems, item.reward.cache) === 0) return { state: "unavailable", disabled: true, label: "Unavailable", reason: "No eligible live catalog items are configured.", count, limit } as const;
    const pointGap = Math.max(0, item.cost - num(character.clanPoints));
    if (pointGap > 0) return { state: "need-points", disabled: true, label: `${pointGap.toLocaleString()} CP short`, reason: `${num(character.clanPoints).toLocaleString()} / ${item.cost.toLocaleString()} Clan Points`, count, limit } as const;
    return { state: "ready", disabled: false, label: "Requisition", reason: "Ready to claim", count, limit } as const;
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
    const statusPriority = { ready: 0, "need-points": 1, "limit-reached": 2, unavailable: 3, "level-locked": 4, "coming-soon": 5 } as const;
    const unlockedItems = EXCHANGE_ITEMS
        .filter((item) => item.reward.kind !== "locked" && clanData.level >= item.requiredClanLevel)
        .sort((a, b) => {
            const stateDifference = statusPriority[itemStatus(character, clanData, a, allItems).state] - statusPriority[itemStatus(character, clanData, b, allItems).state];
            return stateDifference || a.cost - b.cost;
        });
    const readyCount = unlockedItems.filter((item) => itemStatus(character, clanData, item, allItems).state === "ready").length;
    const nextTier = EXCHANGE_TIERS.find((entry) => entry.level > clanData.level);
    const futureGroups = EXCHANGE_TIERS
        .map((entry) => ({ ...entry, items: EXCHANGE_ITEMS.filter((item) => item.reward.kind !== "locked" && item.requiredClanLevel === entry.level && clanData.level < entry.level) }))
        .filter((entry) => entry.items.length > 0);
    const comingSoonItems = EXCHANGE_ITEMS.filter((item) => item.reward.kind === "locked");
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
                <img className="clan-exchange-hero-art" src={clanVaultHero} alt="" aria-hidden="true" />
                <div className="clan-exchange-hero-copy">
                    <div className="clan-exchange-identity">
                        <ClanImageMark image={clanData.image} name={clanData.name} village={clanData.village} />
                        <div>
                            <span className="clan-exchange-kicker">Quartermaster · {clanData.name}</span>
                            <h3>Clan Exchange</h3>
                            <p>Turn clan service into field-ready rewards. Live requisitions are always sorted before future unlocks.</p>
                        </div>
                    </div>
                </div>
                <aside className="clan-exchange-ledger" aria-label="Clan exchange balance and progress">
                    <div className="clan-exchange-wallet">
                        <span>Available balance</span>
                        <div><strong>{clanPoints.toLocaleString()}</strong><b>CP</b></div>
                    </div>
                    <div className="clan-exchange-next">
                        <span>Current catalog</span>
                        <strong>{readyCount} ready now · {unlockedItems.length} live</strong>
                    </div>
                </aside>
            </section>

            <section className="clan-exchange-current">
                <div className="clan-exchange-section-head">
                    <div>
                        <span>Available to you</span>
                        <h4>Your unlocked requisitions</h4>
                        <p>Ready purchases appear first, followed by rewards that only need more Clan Points.</p>
                    </div>
                </div>
                <div className="clan-exchange-grid clan-exchange-current-grid">
                    {unlockedItems.map((item) => <ExchangeCard key={item.id} item={item} character={character} clanData={clanData} allItems={allItems} busy={busyItem === item.id} onConfirm={setConfirming} />)}
                </div>
            </section>

            {(futureGroups.length > 0 || comingSoonItems.length > 0) && <section className="clan-exchange-progression">
                <div className="clan-exchange-section-head clan-exchange-progress-head">
                    <div>
                        <span>Clan progression</span>
                        <h4>{nextTier ? `Next vault access at Clan Level ${nextTier.level}` : "Every exchange tier unlocked"}</h4>
                        <p>Future stock stays below your live catalog and opens as the clan hall advances.</p>
                    </div>
                    <GameIcon name="map" size={27} />
                </div>
                <div className="clan-exchange-future-shelves">
                    {futureGroups.map((group, index) => (
                        <details className="clan-exchange-future-group" key={group.tier} open={index === 0}>
                            <summary>
                                <span><GameIcon name={group.icon} size={20} /> Tier {group.tier} · {group.label}</span>
                                <strong>Unlocks at Clan Level {group.level} · {group.items.length} rewards</strong>
                            </summary>
                            <div className="clan-exchange-locked-grid">
                                {group.items.map((item) => <LockedExchangeCard key={item.id} item={item} allItems={allItems} />)}
                            </div>
                        </details>
                    ))}
                    {comingSoonItems.length > 0 && <details className="clan-exchange-future-group clan-exchange-coming-soon">
                        <summary>
                            <span><GameIcon name="sparkle" size={20} /> In development</span>
                            <strong>{comingSoonItems.length} future reward{comingSoonItems.length === 1 ? "" : "s"}</strong>
                        </summary>
                        <div className="clan-exchange-locked-grid">
                            {comingSoonItems.map((item) => <LockedExchangeCard key={item.id} item={item} allItems={allItems} comingSoon />)}
                        </div>
                    </details>}
                </div>
            </section>}

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
        <article className={`clan-exchange-card ${item.rarity} is-${status.state}${status.disabled ? " locked" : ""}`}>
            <div className="clan-exchange-card-top">
                <span className={`clan-exchange-rarity ${item.rarity}`}>{item.rarity}</span>
                <strong><GameIcon name="sigil" size={15} /> {item.cost.toLocaleString()} CP</strong>
            </div>
            <ExchangeProductArt item={item} />
            <div className="clan-exchange-card-copy">
                <h5>{item.name}</h5>
                <p>{item.description}</p>
            </div>
            <div className="clan-exchange-reward">
                <span>You receive</span>
                <strong>{rewardSummary(item, allItems)}</strong>
            </div>
            <div className="clan-exchange-card-meta">
                <span>{item.limit.kind === "oneTime" ? "One-time claim" : item.limit.kind === "monthly" ? "Monthly stock" : "Weekly stock"}</span>
                <span>{item.limit.kind === "oneTime" ? "One-time" : `${remaining}/${status.limit} left`}</span>
            </div>
            {status.state === "need-points" && <small className="clan-exchange-status">{status.reason}</small>}
            {status.state !== "need-points" && <small className={`clan-exchange-status is-${status.state}`}>{status.reason}</small>}
            <button disabled={status.disabled || busy} onClick={() => onConfirm(item)}>
                {busy ? "Requisitioning..." : status.state === "ready" ? `${status.label} · ${item.cost.toLocaleString()} CP` : status.label}
            </button>
        </article>
    );
}

function LockedExchangeCard({ item, allItems, comingSoon = false }: { item: ExchangeItem; allItems: GameItem[]; comingSoon?: boolean }) {
    return (
        <article className={`clan-exchange-locked-card ${item.rarity}`}>
            <div className="clan-exchange-locked-copy">
                <div><span className={`clan-exchange-rarity ${item.rarity}`}>{item.rarity}</span><strong>{item.cost.toLocaleString()} CP</strong></div>
                <h5>{item.name}</h5>
                <p>{rewardSummary(item, allItems)}</p>
                <span className="clan-exchange-lock-label"><GameIcon name={comingSoon ? "sparkle" : "shield"} size={15} /> {comingSoon ? "Coming soon" : `Clan Level ${item.requiredClanLevel}`}</span>
            </div>
        </article>
    );
}
