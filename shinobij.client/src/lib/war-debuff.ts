/*
 * Village "demoralized" debuff after losing a war. The server stamps
 * warLossDebuffUntil on the loser's village-state at settlement
 * (api/world-state.ts); the client reads it here and Training/PetYard apply the
 * penalties for 3 days. KEEP MULTIPLIERS in sync with any design change.
 */
import { useState, useEffect } from "react";

export const WAR_DEBUFF_TRAINING_XP_MULT = 0.9; // -10% stat / pet training XP
export const WAR_DEBUFF_JUTSU_TIME_MULT = 1.2;  // +20% jutsu training time

// Fetch the loser-debuff expiry for a village (0 if none / already expired).
export async function fetchWarLossDebuff(village: string): Promise<number> {
    if (!village) return 0;
    try {
        const res = await fetch(`/api/village/war-debuff?village=${encodeURIComponent(village)}`);
        const data = await res.json().catch(() => ({})) as { warLossDebuffUntil?: number };
        return Number(data.warLossDebuffUntil ?? 0) || 0;
    } catch {
        return 0;
    }
}

export function isWarDebuffActive(until: number): boolean {
    return until > Date.now();
}

// React hook: resolve the village war-loss debuff once and expose the ready-to-
// apply multipliers. Returns mult=1 (no-op) until the fetch lands or when the
// village isn't currently demoralized, so callers can multiply unconditionally.
export function useWarLossDebuff(village: string | undefined): {
    active: boolean;
    xpMult: number;
    jutsuTimeMult: number;
} {
    const [until, setUntil] = useState(0);
    useEffect(() => {
        let live = true;
        fetchWarLossDebuff(village ?? "").then((u) => { if (live) setUntil(u); });
        return () => { live = false; };
    }, [village]);
    const active = isWarDebuffActive(until);
    return {
        active,
        xpMult: active ? WAR_DEBUFF_TRAINING_XP_MULT : 1,
        jutsuTimeMult: active ? WAR_DEBUFF_JUTSU_TIME_MULT : 1,
    };
}
