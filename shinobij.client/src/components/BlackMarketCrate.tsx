/*
 * Tap-to-open reveal for a Sunscar black-market pull. Purely cosmetic — the
 * server already credited the reward (api/festival/black-market.ts) before this
 * mounts; the crate just dramatises what was won. Closed crate shakes, the
 * player opens it, and it bursts into a tier-coloured reward card.
 */
import { useState } from "react";
import type { BlackMarketReward } from "../lib/black-market";
import crateClosed from "../assets/festival/bm-crate-closed.webp";
import crateOpen from "../assets/festival/bm-crate-open.webp";

const TIER_META: Record<BlackMarketReward["tier"], { label: string; color: string; glow: string }> = {
    scraps:  { label: "Scraps from the Dust", color: "#9ca3af", glow: "rgba(156,163,175,0.45)" },
    trinket: { label: "A Smuggled Trinket",   color: "#4ade80", glow: "rgba(74,222,128,0.5)" },
    haul:    { label: "A Tidy Haul",          color: "#60a5fa", glow: "rgba(96,165,250,0.6)" },
    relic:   { label: "A Relic Cache",        color: "#c084fc", glow: "rgba(192,132,252,0.65)" },
    fortune: { label: "A Desert Fortune",     color: "#facc15", glow: "rgba(250,204,21,0.7)" },
    jackpot: { label: "BLACK SUN JACKPOT",    color: "#fbbf24", glow: "rgba(251,191,36,0.95)" },
};

const CURRENCY_EMOJI: Record<string, string> = { ryo: "🪙", fateShards: "🔮", boneCharms: "🦴", auraStones: "🔷", mythicSeals: "🌟" };
const CURRENCY_LABEL: Record<string, string> = { ryo: "Ryo", fateShards: "Fate Shards", boneCharms: "Bone Charms", auraStones: "Aura Stones", mythicSeals: "Mythic Seals" };
const ORDER = ["ryo", "fateShards", "boneCharms", "auraStones", "mythicSeals"] as const;

export function BlackMarketCrate({ reward, onClose }: { reward: BlackMarketReward; onClose: () => void }) {
    const [opened, setOpened] = useState(false);
    const tier = TIER_META[reward.tier];
    const isJackpot = reward.tier === "jackpot";
    const rows = ORDER.filter((k) => (reward[k] ?? 0) > 0);

    return (
        <div className="bm-crate-overlay" onClick={opened ? onClose : undefined}>
            <div className="bm-crate-stage" onClick={(e) => e.stopPropagation()}>
                {!opened ? (
                    <>
                        <img src={crateClosed} alt="Black market crate" className="bm-crate-img bm-crate-shake" />
                        <button className="bm-crate-open-btn" onClick={() => setOpened(true)}>Open the crate</button>
                        <p className="bm-crate-hint">The Broker slides a locked box across the table…</p>
                    </>
                ) : (
                    <>
                        <div className="bm-crate-burst" style={{ ["--glow" as string]: tier.glow } as React.CSSProperties}>
                            <img src={crateOpen} alt="Opened crate" className={`bm-crate-img bm-crate-pop${isJackpot ? " bm-crate-jackpot" : ""}`} />
                        </div>
                        <h2 className="bm-crate-tier" style={{ color: tier.color, textShadow: `0 0 18px ${tier.glow}` }}>
                            {isJackpot ? "💥 " : ""}{tier.label}{isJackpot ? " 💥" : ""}
                        </h2>
                        <div className="bm-crate-rewards">
                            {rows.length ? rows.map((k) => (
                                <div key={k} className="bm-crate-reward-row">
                                    <span className="bm-crate-reward-emoji">{CURRENCY_EMOJI[k]}</span>
                                    <span className="bm-crate-reward-amt">+{(reward[k] ?? 0).toLocaleString()}</span>
                                    <span className="bm-crate-reward-label">{CURRENCY_LABEL[k]}</span>
                                </div>
                            )) : <p className="bm-crate-empty">…nothing but sand.</p>}
                        </div>
                        <button className="bm-crate-collect" onClick={onClose}>Collect</button>
                    </>
                )}
            </div>
        </div>
    );
}
