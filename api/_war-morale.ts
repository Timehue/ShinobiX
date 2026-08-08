/*
 * Village war MORALE — the server-side half (§17.1).
 *
 * settleVillageWar stamps the legacy `warLossDebuffUntil` field on the losing
 * village. It now means a three-day comeback rally, not a growth punishment.
 * Old winner stamps remain readable but progression-neutral. Morale is resolved
 * here from authoritative state and applied when each gain is sealed.
 * The multipliers mirror shinobij.client/src/lib/war-debuff.ts exactly — KEEP THE
 * TWO IN SYNC, they are what the player is shown versus what they are given.
 *
 * Underscore-prefixed → a shared helper, not a route.
 */

import { kv } from './_storage.js';

const VILLAGE_STATE_PREFIX = 'game:village-state:';

// A losing village receives a short comeback boost. Winner multipliers remain
// neutral because victory already awards map control, spoils, crates, and standing.
export const WAR_DEBUFF_TRAINING_XP_MULT = 1.1;
export const WAR_DEBUFF_JUTSU_TIME_MULT = 0.9;
export const WAR_BUFF_TRAINING_XP_MULT = 1;
export const WAR_BUFF_JUTSU_TIME_MULT = 1;

export type WarMorale = 'triumphant' | 'rallying' | 'none';

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

export const WAR_COMEBACK_RALLY_MS = 3 * 24 * 60 * 60 * 1000;

/** Stamp the morale side of a settlement. A later victory explicitly ends an
 * active loss rally; otherwise a village could keep its comeback boost after it
 * had already won the rematch. The legacy field name remains storage-compatible. */
export function settlementMoralePatch(
    side: 'winner' | 'loser',
    now: number,
): Pick<WarMoraleStamps, 'warLossDebuffUntil'> {
    return side === 'loser'
        ? { warLossDebuffUntil: now + WAR_COMEBACK_RALLY_MS }
        : { warLossDebuffUntil: 0 };
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
            morale: 'rallying',
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

/** Apply the XP multiplier to a sealed gain. Never turns a real gain into zero. */
export function applyMoraleToGain(gain: number, mult: number): number {
    const base = Math.max(0, Math.floor(Number(gain) || 0));
    if (base <= 0) return 0;
    return Math.max(1, Math.round(base * (Number(mult) || 1)));
}
