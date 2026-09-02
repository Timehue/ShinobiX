/*
 * Premium offers — the real-money products: Fate Shard tiers and the
 * recurring Shinobi Supporter tier.
 *
 * Deliberately a SECTION of the existing Shop rather than a screen of its own,
 * matching CardPackSection directly above it: the nav's "Shop" button is where
 * players already go to spend, so that is where buying belongs.
 *
 * Nothing here grants currency. A tile opens a Tebex checkout bound server-side
 * to the signed-in player; shards arrive later via the webhook. The only local
 * write is re-reading the authoritative save afterwards — see
 * refreshPurchasedSave for why that re-read is load-bearing rather than polish.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import { GameIcon } from "./icons/GameIcon";
import shards35Art from "../assets/premium-shop/shards-35.webp";
import shards155Art from "../assets/premium-shop/shards-155.webp";
import shards420Art from "../assets/premium-shop/shards-420.webp";
import shards900Art from "../assets/premium-shop/shards-900.webp";
import supporterArt from "../assets/premium-shop/supporter.webp";
import {
    buildShardTiers,
    fetchShardPrices,
    formatPrice,
    openShardCheckout,
    refreshPurchasedSave,
    shardRail,
    type ShardTier,
} from "../lib/shard-store";
import { SUBSCRIPTION_ID } from "../../../shared/shard-packages";

/*
 * Tile art. The shard COUNT is painted into each image, but the PRICE
 * deliberately is not: the price lives as live text underneath, read from the
 * storefront, so repricing a tier in the Tebex dashboard does not leave four
 * images quietly advertising the old amount.
 */
const TIER_ART: Record<string, string> = {
    "shards-35": shards35Art,
    "shards-155": shards155Art,
    "shards-420": shards420Art,
    "shards-900": shards900Art,
};

export function PremiumOffers({ character, onVersionedCharacter }: {
    character: Character;
    onVersionedCharacter: VersionedCharacterCommit;
}) {
    const [tiers, setTiers] = useState<ShardTier[]>(() => buildShardTiers([]));
    const [busyId, setBusyId] = useState<string | null>(null);
    const [status, setStatus] = useState<string>("");
    const [awaitingPurchase, setAwaitingPurchase] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const rail = shardRail();
    // `character.patreon` keeps its original storage key — it is live save data
    // and provider-agnostic; only the rail that writes it changed.
    const isSupporter = (character as { patreon?: { active?: boolean } }).patreon?.active === true;
    const [supporterPrice, setSupporterPrice] = useState<{ amount: number; currency: string } | null>(null);

    // Prices come from Tebex, not from the catalogue's reference USD — a player
    // in France is charged euros including VAT, and showing them dollars would
    // be wrong. An empty result just means the tiles render without a price.
    useEffect(() => {
        const abort = new AbortController();
        void fetchShardPrices(abort.signal).then((prices) => {
            if (abort.signal.aborted) return;
            setTiers(buildShardTiers(prices));
            const sub = prices.find((row) => row.packageId === SUBSCRIPTION_ID);
            setSupporterPrice(sub ? { amount: sub.amount, currency: sub.currency } : null);
        });
        return () => abort.abort();
    }, []);

    const refreshBalance = useCallback(async (quiet: boolean) => {
        setRefreshing(true);
        try {
            const fresh = await refreshPurchasedSave(character.name);
            if (!fresh) {
                if (!quiet) setStatus("Could not reach the server to check your balance. Try again in a moment.");
                return;
            }
            const before = character.fateShards;
            const after = fresh.character.fateShards ?? before;
            onVersionedCharacter(fresh.character, fresh.version);
            if (after > before) {
                setStatus(`${after - before} Fate Shards added. Thank you for supporting Shinobi Journey.`);
                setAwaitingPurchase(false);
            } else if (!quiet) {
                setStatus("No new shards yet. Payments can take a moment to clear — try again shortly.");
            }
        } finally {
            setRefreshing(false);
        }
    }, [character.name, character.fateShards, onVersionedCharacter]);

    // Coming back to this tab is the signal that checkout is over — the buyer
    // finished or abandoned it in the other tab, and either way the stored save
    // is now the truth. Quiet, so an incidental tab switch says nothing.
    const refreshRef = useRef(refreshBalance);
    useEffect(() => { refreshRef.current = refreshBalance; });
    useEffect(() => {
        if (!awaitingPurchase) return;
        const onFocus = () => { void refreshRef.current(true); };
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [awaitingPurchase]);

    async function buy(packageId: string) {
        if (busyId) return;
        // Opened SYNCHRONOUSLY, before any await: a popup blocker only trusts a
        // window opened directly from the click. The tab sits blank while the
        // basket is created, then gets pointed at checkout.
        const tab = window.open("about:blank", "_blank");
        if (tab) tab.opener = null;
        setBusyId(packageId);
        setStatus("");
        try {
            const result = await openShardCheckout(packageId, tab);
            if (!result.ok) {
                setStatus(result.error ?? "Could not open checkout.");
                return;
            }
            if (!tab) {
                // The blocker won. Give them the reason rather than a dead button.
                setStatus("Your browser blocked the checkout window. Allow pop-ups for this site and try again.");
                return;
            }
            setAwaitingPurchase(true);
            setStatus("Checkout opened in a new tab. Come back here when you are done and your shards will appear.");
        } finally {
            setBusyId(null);
        }
    }

    /*
     * ⛔ ONLY the web rail may render a web checkout.
     *
     * Written as `!== "web"` rather than `=== "blocked"` on purpose. The
     * original form let EVERY other rail fall through to the Tebex tiles,
     * including `"play"` — so the moment the Android build shipped with Play
     * Billing enabled, the app would have offered an external payment page for
     * digital goods. That is the exact Play policy breach shardRail() exists to
     * prevent, and grounds for removal. Enumerating the safe case instead of
     * the unsafe one means a rail added later is refused until someone
     * deliberately handles it.
     *
     * `"play"` lands here today because there are no Play products yet
     * (PROVIDER_PACKAGE_IDS.play is empty), so there is genuinely nothing to
     * sell in-app. When those exist, this branch becomes the Digital Goods
     * purchase flow — it must never become a fall-through to the web.
     */
    if (rail !== "web") {
        return (
            <div className="card" style={{ marginTop: "1rem" }}>
                <h2><GameIcon name="crystal" size={18} style={{ display: "inline-block", verticalAlign: "-3px" }} /> Fate Shards</h2>
                <p style={{ marginBottom: "0.4rem" }}>Balance: <strong>{character.fateShards}</strong> Fate Shards</p>
                <p style={{ color: "#8b98a8", fontSize: "0.85rem", marginBottom: 0 }}>
                    Fate Shard purchases are not available in this version of the app yet. Everything shards buy can
                    still be earned in game.
                </p>
            </div>
        );
    }

    return (
        <div className="card" style={{ marginTop: "1rem" }}>
            <h2><GameIcon name="crystal" size={18} style={{ display: "inline-block", verticalAlign: "-3px" }} /> Fate Shards</h2>
            <p style={{ color: "#aaa", marginBottom: "0.4rem" }}>
                Fate Shards buy card packs, legendary gear and forge rolls at the Grand Marketplace.
            </p>
            <p style={{ marginBottom: "0.8rem" }}>Balance: <strong>{character.fateShards}</strong> Fate Shards</p>

            {/* Auto-fit rather than fixed columns: four tiles on a desktop rail,
                two on a phone, without a media query or a new stylesheet. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                {tiers.map((tier) => (
                    <button
                        key={tier.pack.id}
                        onClick={() => void buy(tier.pack.id)}
                        disabled={busyId !== null}
                        // The tile's words live inside the artwork, which a screen
                        // reader cannot read, so the button carries the whole offer.
                        aria-label={`Buy ${tier.pack.shards} Fate Shards${tier.bonusPercent > 0 ? `, ${tier.bonusPercent}% extra` : ""}${tier.price ? ` for ${formatPrice(tier.price)}` : ""}`}
                        style={{
                            display: "flex", flexDirection: "column", alignItems: "stretch",
                            gap: 8, padding: 8, height: "auto", textAlign: "center",
                        }}
                    >
                        <span style={{ position: "relative", display: "block" }}>
                            <img
                                src={TIER_ART[tier.pack.id]}
                                alt=""
                                loading="lazy"
                                style={{ width: "100%", height: "auto", display: "block", borderRadius: 6 }}
                            />
                            {tier.bonusPercent > 0 && (
                                <span style={{
                                    position: "absolute", top: 6, right: 6,
                                    background: "rgba(9,12,24,0.86)", color: "#facc15",
                                    border: "1px solid rgba(250,204,21,0.55)", borderRadius: 999,
                                    padding: "2px 8px", fontSize: "0.72rem", fontWeight: 700,
                                }}>+{tier.bonusPercent}% extra</span>
                            )}
                        </span>
                        <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#e8eef6" }}>
                            {tier.price
                                ? formatPrice(tier.price)
                                /* No provider price yet — labelled as an estimate
                                   rather than presented as the amount charged. */
                                : `about $${tier.pack.usd} USD`}
                        </span>
                    </button>
                ))}
            </div>

            <h2 style={{ marginTop: "1.4rem" }}>Shinobi Supporter</h2>
            <p style={{ color: "#aaa", marginBottom: "0.8rem" }}>
                A monthly subscription: a larger jutsu loadout, an extra pet and bloodline slot, and a custom avatar.
                Convenience and cosmetics — it buys no combat power.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 232px)", gap: 12 }}>
                <button
                    onClick={() => void buy(SUBSCRIPTION_ID)}
                    disabled={busyId !== null || isSupporter}
                    aria-label={isSupporter ? "Shinobi Supporter is already active" : "Subscribe to Shinobi Supporter"}
                    style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, padding: 8, height: "auto", textAlign: "center" }}
                >
                    <span style={{ position: "relative", display: "block" }}>
                        <img src={supporterArt} alt="" loading="lazy" style={{ width: "100%", height: "auto", display: "block", borderRadius: 6, opacity: isSupporter ? 0.55 : 1 }} />
                        {isSupporter && (
                            <span style={{
                                position: "absolute", top: 6, right: 6, background: "rgba(9,12,24,0.86)",
                                color: "#86efac", border: "1px solid rgba(134,239,172,0.55)", borderRadius: 999,
                                padding: "2px 8px", fontSize: "0.72rem", fontWeight: 700,
                            }}>Active</span>
                        )}
                    </span>
                    <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#e8eef6" }}>
                        {isSupporter
                            ? "Already active"
                            : supporterPrice
                                ? `${formatPrice(supporterPrice)} / month`
                                : "about $15 USD / month"}
                    </span>
                </button>
            </div>

            {awaitingPurchase && (
                <p style={{ marginTop: "0.8rem", marginBottom: 0 }}>
                    <button onClick={() => void refreshBalance(false)} disabled={refreshing}>
                        {refreshing ? "Checking…" : "I have paid — check my balance"}
                    </button>
                </p>
            )}

            {status && (
                <p role="status" style={{ marginTop: "0.7rem", marginBottom: 0, color: "#aab4c2", fontSize: "0.85rem" }}>
                    {status}
                </p>
            )}

            <p style={{ color: "#8b98a8", fontSize: "0.78rem", lineHeight: 1.5, marginTop: "0.9rem", marginBottom: 0 }}>
                Payments are handled by Tebex, who are the merchant of record. Prices are listed in US dollars; if
                you pay in another currency, the exact amount and any tax are shown at checkout before you pay.
                Purchases are added to the account you are signed in as, usually within a few seconds. The
                subscription renews monthly until you cancel it, which you can do at any time from the receipt Tebex
                emails you. Everything Fate Shards buy can also be earned in game.
            </p>
        </div>
    );
}
