/*
 * Village war MORALE — the settlement aftermath for both sides.
 *
 * At war settlement the server stamps the legacy `warLossDebuffUntil` field on
 * the losing village for a three-day comeback rally. Historical winner stamps
 * remain readable but progression-neutral.
 *
 * A village is only ever one or the other, but a stale stamp from an older war
 * can linger beside a fresh one — so we resolve whichever settled MOST RECENTLY.
 *
 * KEEP MULTIPLIERS in sync with any design change.
 */
import { useState, useEffect } from "react";

// Both windows are now applied SERVER-SIDE (api/_war-morale.ts) at the point each
// reward is sealed: stat training (api/training/start.ts sealedGain), pet training
// (api/pet/progress.ts sealedXp), and jutsu training time (api/training/jutsu-ryo.ts,
// as its OWN duration multiplier — folding it into the client-reported bonus meant
// the debuff could only shave an existing bonus and did nothing to a player without
// one). These constants are the DISPLAY mirror; KEEP THEM IN SYNC with that file.
//
// ── Loser: comeback rally ──
export const WAR_DEBUFF_TRAINING_XP_MULT = 1.1; // +10% comeback training gain
export const WAR_DEBUFF_JUTSU_TIME_MULT = 0.9;  // -10% comeback training time

// ── Winner: neutral progression (victory has its own rewards) ──
export const WAR_BUFF_TRAINING_XP_MULT = 1;
export const WAR_BUFF_JUTSU_TIME_MULT = 1;

export type WarMorale = "triumphant" | "rallying" | "none";

export interface VillageWarMorale {
    morale: WarMorale;
    /** True while the legacy loss-window field is active. */
    active: boolean;
    /** Multiply training XP by this. 1 when neutral, so callers can apply it blind. */
    xpMult: number;
    /** Multiply jutsu training TIME by this. 1 when neutral. */
    jutsuTimeMult: number;
    /** When the current window ends (0 when neutral). */
    until: number;
}

const NEUTRAL: VillageWarMorale = { morale: "none", active: false, xpMult: 1, jutsuTimeMult: 1, until: 0 };

export interface WarMoraleStamps {
    warLossDebuffUntil?: number;
    warWinBuffUntil?: number;
}

/** Fetch both morale stamps for a village (each 0 when none / already expired). */
export async function fetchWarMorale(village: string): Promise<WarMoraleStamps> {
    if (!village) return {};
    try {
        const res = await fetch(`/api/village/war-debuff?village=${encodeURIComponent(village)}`);
        const data = await res.json().catch(() => ({})) as WarMoraleStamps;
        return {
            warLossDebuffUntil: Number(data.warLossDebuffUntil ?? 0) || 0,
            warWinBuffUntil: Number(data.warWinBuffUntil ?? 0) || 0,
        };
    } catch {
        return {};
    }
}

/** Back-compat: the loser-debuff expiry alone. */
export async function fetchWarLossDebuff(village: string): Promise<number> {
    return (await fetchWarMorale(village)).warLossDebuffUntil ?? 0;
}

export function isWarDebuffActive(until: number): boolean {
    return until > Date.now();
}

/**
 * Resolve stamps into the multipliers to apply. Pure, so "which window wins" and
 * "what it does" are unit-testable without React.
 *
 * The LATER stamp wins: whichever war settled most recently defines how the
 * village currently feels, so an old victory can't cancel a fresh defeat.
 */
export function resolveWarMorale(stamps: WarMoraleStamps, now: number = Date.now()): VillageWarMorale {
    const loss = Number(stamps.warLossDebuffUntil ?? 0) || 0;
    const win = Number(stamps.warWinBuffUntil ?? 0) || 0;
    const lossLive = loss > now;
    const winLive = win > now;
    if (!lossLive && !winLive) return NEUTRAL;
    if (lossLive && (!winLive || loss >= win)) {
        return {
            morale: "rallying",
            active: true,
            xpMult: WAR_DEBUFF_TRAINING_XP_MULT,
            jutsuTimeMult: WAR_DEBUFF_JUTSU_TIME_MULT,
            until: loss,
        };
    }
    return {
        morale: "triumphant",
        active: false,
        xpMult: WAR_BUFF_TRAINING_XP_MULT,
        jutsuTimeMult: WAR_BUFF_JUTSU_TIME_MULT,
        until: win,
    };
}

/**
 * React hook: resolve a village's war morale once and expose ready-to-apply
 * multipliers. Returns the neutral 1× values until the fetch lands, so callers
 * can multiply unconditionally.
 */
export function useVillageWarMorale(village: string | undefined): VillageWarMorale {
    const [stamps, setStamps] = useState<WarMoraleStamps>({});
    useEffect(() => {
        let live = true;
        fetchWarMorale(village ?? "").then((s) => { if (live) setStamps(s); });
        return () => { live = false; };
    }, [village]);
    return resolveWarMorale(stamps);
}

/** Back-compat alias for callers still using the old hook name. */
export const useWarLossDebuff = useVillageWarMorale;
