/*
 * Fate Shard purchasing — the real-money tile row on the Shop screen.
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
import {
    buildShardTiers,
    fetchShardPrices,
    formatPrice,
    openShardCheckout,
    refreshPurchasedSave,
    shardRail,
    type ShardTier,
} from "../lib/shard-store";

export function FateShardSection({ character, onVersionedCharacter }: {
    character: Character;
    onVersionedCharacter: VersionedCharacterCommit;
}) {
    const [tiers, setTiers] = useState<ShardTier[]>(() => buildShardTiers([]));
    const [busyId, setBusyId] = useState<string | null>(null);
    const [status, setStatus] = useState<string>("");
    const [awaitingPurchase, setAwaitingPurchase] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const rail = shardRail();

    // Prices come from Tebex, not from the catalogue's reference USD — a player
    // in France is charged euros including VAT, and showing them dollars would
    // be wrong. An empty result just means the tiles render without a price.
    useEffect(() => {
        const abort = new AbortController();
        void fetchShardPrices(abort.signal).then((prices) => {
            if (!abort.signal.aborted) setTiers(buildShardTiers(prices));
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

    async function buy(tier: ShardTier) {
        if (busyId) return;
        // Opened SYNCHRONOUSLY, before any await: a popup blocker only trusts a
        // window opened directly from the click. The tab sits blank while the
        // basket is created, then gets pointed at checkout.
        const tab = window.open("about:blank", "_blank");
        if (tab) tab.opener = null;
        setBusyId(tier.pack.id);
        setStatus("");
        try {
            const result = await openShardCheckout(tier.pack.id, tab);
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

    // Inside the Android app without Play Billing there is no lawful rail:
    // Play's policy forbids sending players to a web checkout for digital
    // goods. Show the balance, offer nothing, and say nothing that reads as a
    // workaround.
    if (rail === "blocked") {
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

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {tiers.map((tier) => (
                    <button
                        key={tier.pack.id}
                        onClick={() => void buy(tier)}
                        disabled={busyId !== null}
                        style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minWidth: 132 }}
                    >
                        <span style={{ color: "#7dd3fc", fontWeight: 600 }}>
                            {tier.pack.shards} Fate Shards
                            {tier.bonusPercent > 0 ? <span style={{ color: "#facc15" }}> +{tier.bonusPercent}%</span> : null}
                        </span>
                        <span style={{ fontSize: "0.82rem", color: "#c8d2de" }}>
                            {tier.price
                                ? formatPrice(tier.price)
                                /* No provider price available — label it as an
                                   approximation rather than presenting the
                                   planning figure as the amount charged. */
                                : `about $${tier.pack.usd} USD`}
                        </span>
                    </button>
                ))}
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
                Payments are handled by Tebex, who are the merchant of record. Prices are shown in your local currency
                where available, and the exact amount is confirmed at checkout before you pay. Shards are added to the
                account you are signed in as, usually within a few seconds. Everything Fate Shards buy can also be
                earned in game.
            </p>
        </div>
    );
}
