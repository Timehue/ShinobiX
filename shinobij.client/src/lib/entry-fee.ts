/*
 * Entry-fee quotes for repeatable PvE modes. Endless Tower, Battle Towers and
 * Pet Gauntlet all debit the stored wallet in their server start endpoints
 * (api/endless/_run.ts, api/towers/_entry-fee.ts, api/pet/_gauntlet-entry.ts);
 * these calculations are only an immediate UI preview. Nothing here spends ryo.
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
