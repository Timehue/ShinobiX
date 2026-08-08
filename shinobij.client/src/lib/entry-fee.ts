/*
 * Entry-fee quotes for repeatable PvE modes. Battle Towers and Pet Gauntlet
 * debit the stored wallet in their server start endpoints; these calculations
 * are only an immediate UI preview. Endless Tower still uses its legacy flow.
 *
 * Why client-side: ryo is client-owned — the client autosaves character.ryo — so
 * a SERVER-side debit would be clobbered by the client's next autosave of its
 * stale (un-debited) ryo. Debiting client-side is the same trust model as every
 * other spend in the game (shop, jutsu training).
 *
 * Each mode keeps its OWN daily {count, date} stamp rather than the shared
 * character.lastDailyReset, so charging one mode can never reset another mode's
 * (or pet-win / tower-XP) daily counters.
 */
import type { Character } from "../types/character";

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

// ── Endless Tower ────────────────────────────────────────────────────────────
// First FRESH run each day is free; each additional fresh run costs +3000 ryo
// (2nd = 3000, 3rd = 6000 …). Resuming an in-progress run is always free — only
// fresh runs are charged. Tightens the Tower's otherwise-uncapped ryo farming.
const ENDLESS_FEE_STEP = 3000;

export function endlessEntryCost(character: Character): number {
    const used = character.dailyEndlessDate === todayKey() ? (character.dailyEndlessRuns ?? 0) : 0;
    return used * ENDLESS_FEE_STEP;
}

/**
 * Returns the character with the Endless entry fee debited + the daily fresh-run
 * counter bumped, or null if they can't afford it (the caller surfaces
 * endlessEntryCost to the player). Call this ONLY when starting a fresh run.
 */
export function payEndlessEntry(character: Character): Character | null {
    const cost = endlessEntryCost(character);
    if ((character.ryo ?? 0) < cost) return null;
    const day = todayKey();
    const used = character.dailyEndlessDate === day ? (character.dailyEndlessRuns ?? 0) : 0;
    return { ...character, ryo: (character.ryo ?? 0) - cost, dailyEndlessRuns: used + 1, dailyEndlessDate: day };
}

// ── Battle Tower ─────────────────────────────────────────────────────────────
// Free first BATTLE_FREE_FLOORS floor-entries each day, then a flat ryo toll per
// entry (retries included). A per-entry sink for heavy climbers; the daily free
// allowance keeps casual play untaxed.
export const BATTLE_FREE_FLOORS = 3;
const BATTLE_FLOOR_FEE = 1500;

export function battleEntryCost(character: Character): number {
    const used = character.dailyBattleDate === todayKey() ? (character.dailyBattleFloors ?? 0) : 0;
    return used < BATTLE_FREE_FLOORS ? 0 : BATTLE_FLOOR_FEE;
}

// ── Pet Gauntlet ─────────────────────────────────────────────────────────────
// The first run each UTC day is free; every later server-minted run costs this
// flat amount. The server owns the counter and debit.
export const GAUNTLET_NEW_RUN_FEE = 1500;
