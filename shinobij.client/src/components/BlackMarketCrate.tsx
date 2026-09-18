/*
 * Tap-to-open reveal for a Sunscar black-market pull. Purely cosmetic — the
 * server already credited the reward (api/festival/black-market.ts) before this
 * mounts; the crate just dramatises what was won. Closed crate shakes, the
 * player opens it, and it bursts into a tier-coloured reward card.
 */
import { useRef, useState, type RefObject } from "react";
import { Modal } from "./ui/Modal";
import type { BlackMarketReward } from "../lib/black-market";
import crateClosed from "../assets/festival/bm-crate-closed.webp";
import crateOpen from "../assets/festival/bm-crate-open.webp";

const TIER_META: Record<BlackMarketReward["tier"], { label: string; color: string; glow: string }> = {
    scraps:  { label: "Scraps from the Dust", color: "#9ca3af", glow: "rgba(156,163,175,0.45)" },
    trinket: { label: "A Smuggled Trinket",   color: "var(--green-400)", glow: "rgba(74,222,128,0.5)" },
    haul:    { label: "A Tidy Haul",          color: "var(--blue-400)", glow: "rgba(96,165,250,0.6)" },
    relic:   { label: "A Relic Cache",        color: "var(--purple-400)", glow: "rgba(192,132,252,0.65)" },
    fortune: { label: "A Desert Fortune",     color: "var(--gold)", glow: "rgba(250,204,21,0.7)" },
    jackpot: { label: "BLACK SUN JACKPOT",    color: "#fbbf24", glow: "rgba(251,191,36,0.95)" },
};

const CURRENCY_LABEL: Record<string, string> = { ryo: "Ryo", fateShards: "Fate Shards", boneCharms: "Bone Charms", auraStones: "Aura Stones", mythicSeals: "Mythic Seals" };
const ORDER = ["ryo", "fateShards", "boneCharms", "auraStones", "mythicSeals"] as const;

export function BlackMarketCrate({ reward, onClose, returnFocusRef }: { reward: BlackMarketReward | null; onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null> }) {
    const [openedReward, setOpenedReward] = useState<BlackMarketReward | null>(null);
    const opened = reward !== null && openedReward === reward;
    const resultRef = useRef<HTMLHeadingElement>(null);
    const tier = TIER_META[reward?.tier ?? 'scraps'];
    const isJackpot = reward?.tier === "jackpot";
    const rows = ORDER.filter((k) => (reward?.[k] ?? 0) > 0);

    return (
        <Modal open={reward !== null} onClose={onClose} bare ariaLabel="The Broker’s crate" className="bm-crate-dialog" backdropClassName="bm-crate-overlay" returnFocusRef={returnFocusRef}>
            <div className="bm-crate-stage">
                {!opened ? (
                    <>
                        <img src={crateClosed} alt="Black market crate" className="bm-crate-img bm-crate-shake" />
                        <button className="bm-crate-open-btn" onClick={() => { setOpenedReward(reward); requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true })); }}>Open the crate</button>
                        <p className="bm-crate-hint">The Broker slides a locked box across the table…</p>
                        <button className="bm-crate-dismiss" onClick={onClose}>Skip reveal</button>
                    </>
                ) : (
                    <>
                        <div className="bm-crate-burst" style={{ ["--glow" as string]: tier.glow } as React.CSSProperties}>
                            <img src={crateOpen} alt="Opened crate" className={`bm-crate-img bm-crate-pop${isJackpot ? " bm-crate-jackpot" : ""}`} />
                        </div>
                        <h2 ref={resultRef} tabIndex={-1} className="bm-crate-tier" style={{ color: tier.color, textShadow: `0 0 18px ${tier.glow}` }}>
                            {tier.label}
                        </h2>
                        <div className="bm-crate-rewards">
                            {rows.length ? rows.map((k) => (
                                <div key={k} className="bm-crate-reward-row">
                                    <span className="bm-crate-reward-amt">+{(reward?.[k] ?? 0).toLocaleString()}</span>
                                    <span className="bm-crate-reward-label">{CURRENCY_LABEL[k]}</span>
                                </div>
                            )) : <p className="bm-crate-empty">…nothing but sand.</p>}
                        </div>
                        <p className="bm-crate-hint">Rewards added to your purse.</p>
                        <button className="bm-crate-collect" onClick={onClose}>Return to the festival</button>
                    </>
                )}
            </div>
        </Modal>
    );
}
