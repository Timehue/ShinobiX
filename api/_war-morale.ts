/*
 * Village war MORALE — the server-side half (§17.1).
 *
 * settleVillageWar stamps `warLossDebuffUntil` on the loser's village-state and
 * `warWinBuffUntil` on the winner's. The client reads both (lib/war-debuff.ts),
 * but reading them there was never enough to make them BITE:
 *
 *   · Training gains are SEALED SERVER-SIDE at start (api/training/start.ts
 *     sealedGain, api/pet/progress.ts sealedXp), so a client-side XP multiplier
 *     had no seam to act on — the training-XP half of both windows was inert.
 *   · The jutsu-training bonus is client-reported and clamped to [0, 60]
 *     server-side, so the loser's "+20% training time" could only ever shave an
 *     existing bonus and did nothing at all to a player without one.
 *
 * So morale is resolved HERE, from authoritative state, and applied at the seal.
 * The multipliers mirror shinobij.client/src/lib/war-debuff.ts exactly — KEEP THE
 * TWO IN SYNC, they are what the player is shown versus what they are given.
 *
 * Underscore-prefixed → a shared helper, not a route.
 */

import { kv } from './_storage.js';

const VILLAGE_STATE_PREFIX = 'game:village-state:';

// Loser: "demoralized". Winner: "triumphant" — gentler on the jutsu axis so a
// victor cannot snowball into the next war on top of the spoils they took.
export const WAR_DEBUFF_TRAINING_XP_MULT = 0.9;
export const WAR_DEBUFF_JUTSU_TIME_MULT = 1.2;
export const WAR_BUFF_TRAINING_XP_MULT = 1.1;
export const WAR_BUFF_JUTSU_TIME_MULT = 0.9;

export type WarMorale = 'triumphant' | 'demoralized' | 'none';

export interface VillageWarMorale {
    morale: WarMorale;
    /** Multiply a sealed training/pet XP gain by this. 1 when neutral. */
    xpMult: number;
    /** Multiply jutsu training DURATION by this. 1 when neutral. */
    jutsuTimeMult: number;
    until: number;
}

export const NEUTRAL_MORALE: VillageWarMorale = { morale: 'none', xpMult: 1, jutsuTimeMult: 1, until: 0 };

export interface WarMoraleStamps {
    warLossDebuffUntil?: unknown;
    warWinBuffUntil?: unknown;
}

/** Resolve stamps → multipliers. Pure. The LATER stamp wins, so a stale victory
 *  can never cancel a fresh defeat. Mirrors the client's resolveWarMorale. */
export function resolveWarMorale(stamps: WarMoraleStamps | null | undefined, now: number): VillageWarMorale {
    const loss = Math.floor(Number(stamps?.warLossDebuffUntil) || 0);
    const win = Math.floor(Number(stamps?.warWinBuffUntil) || 0);
    const lossLive = loss > now;
    const winLive = win > now;
    if (!lossLive && !winLive) return NEUTRAL_MORALE;
    if (lossLive && (!winLive || loss >= win)) {
        return {
            morale: 'demoralized',
            xpMult: WAR_DEBUFF_TRAINING_XP_MULT,
            jutsuTimeMult: WAR_DEBUFF_JUTSU_TIME_MULT,
            until: loss,
        };
    }
    return {
        morale: 'triumphant',
        xpMult: WAR_BUFF_TRAINING_XP_MULT,
        jutsuTimeMult: WAR_BUFF_JUTSU_TIME_MULT,
        until: win,
    };
}

/** A village's current morale, read from its village-state. Never throws — a
 *  storage hiccup must not block someone starting training, so it degrades to
 *  neutral (no buff AND no debuff). */
export async function villageWarMoraleOf(village: string, now: number = Date.now()): Promise<VillageWarMorale> {
    const name = String(village ?? '').trim();
    if (!name) return NEUTRAL_MORALE;
    try {
        const key = `${VILLAGE_STATE_PREFIX}${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        return resolveWarMorale(await kv.get<WarMoraleStamps>(key), now);
    } catch {
        return NEUTRAL_MORALE;
    }
}

/** Morale for the village on a character record. */
export async function moraleForCharacter(
    character: { village?: unknown } | null | undefined,
    now: number = Date.now(),
): Promise<VillageWarMorale> {
    return villageWarMoraleOf(String(character?.village ?? ''), now);
}

/** Apply the XP multiplier to a sealed gain. Never turns a real gain into zero —
 *  a demoralized village trains slower, not not-at-all. Pure. */
export function applyMoraleToGain(gain: number, mult: number): number {
    const base = Math.max(0, Math.floor(Number(gain) || 0));
    if (base <= 0) return 0;
    return Math.max(1, Math.round(base * (Number(mult) || 1)));
}
