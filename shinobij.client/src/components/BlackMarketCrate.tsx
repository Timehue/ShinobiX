import type { RefObject } from "react";
import { CacheRewardReveal } from "./CacheRewardReveal";
import type { GameArtIconKind } from "./GameArtIcon";
import type { BlackMarketReward } from "../lib/black-market";

const TIER_META: Record<BlackMarketReward["tier"], { label: string; color: string; glow: string }> = {
    scraps:  { label: "Scraps from the Dust", color: "#9ca3af", glow: "rgba(156,163,175,0.45)" },
    trinket: { label: "A Smuggled Trinket",   color: "#4ade80", glow: "rgba(74,222,128,0.5)" },
    haul:    { label: "A Tidy Haul",          color: "#60a5fa", glow: "rgba(96,165,250,0.6)" },
    relic:   { label: "A Relic Cache",        color: "#c084fc", glow: "rgba(192,132,252,0.65)" },
    fortune: { label: "A Desert Fortune",     color: "#facc15", glow: "rgba(250,204,21,0.7)" },
    jackpot: { label: "BLACK SUN JACKPOT",    color: "#fbbf24", glow: "rgba(251,191,36,0.95)" },
};

const CURRENCY_LABEL: Record<string, string> = {
    ryo: "Ryo",
    fateShards: "Fate Shards",
    boneCharms: "Bone Charms",
    auraStones: "Aura Stones",
    mythicSeals: "Mythic Seals",
};
const CURRENCY_ICON: Record<keyof Pick<BlackMarketReward, "ryo" | "fateShards" | "boneCharms" | "auraStones" | "mythicSeals">, GameArtIconKind> = {
    ryo: "ryo",
    fateShards: "fateShard",
    boneCharms: "boneCharm",
    auraStones: "auraStone",
    mythicSeals: "crown",
};
const ORDER = ["ryo", "fateShards", "boneCharms", "auraStones", "mythicSeals"] as const;

/* The Broker's pull uses the same chest animation and reward list as inventory caches. */
export function BlackMarketCrate({ reward, onClose, returnFocusRef }: { reward: BlackMarketReward | null; onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null> }) {
    const tier = TIER_META[reward?.tier ?? "scraps"];
    const rewards = reward
        ? ORDER.filter((key) => reward[key] > 0).map((key) => ({
            id: key,
            name: CURRENCY_LABEL[key],
            quantity: reward[key],
            prefix: "+" as const,
            iconKind: CURRENCY_ICON[key],
        }))
        : [];

    return <CacheRewardReveal
        open={reward !== null}
        title={tier.label}
        rewards={rewards}
        onClose={onClose}
        rewardKey={reward ? JSON.stringify(reward) : undefined}
        returnFocusRef={returnFocusRef}
        intro="The Broker slides a locked box across the table…"
        deliveryCopy="Rewards have been added to your purse."
        revealLabel="Open the crate"
        collectLabel="Return to the festival"
        emptyCopy="…nothing but sand."
        accent={tier.color}
        glow={tier.glow}
        jackpot={reward?.tier === "jackpot"}
    />;
}
