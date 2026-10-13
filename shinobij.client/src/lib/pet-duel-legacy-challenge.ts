// ─────────────────────────────────────────────────────────────────────────────
// pet-duel-legacy-challenge.ts — retire the pre-live-PvP pet challenge
// (docs/pet-coliseum-player-control-plan.md §10).
//
// Player-controlled duels use Pet Arena codes and private round orders.
// Nothing in this build creates the old queued
// `clanWarPet` challenge any more — but challenges are stored SERVER-side, so one
// minted before the deploy (or by a client still on a cached bundle) is still
// sitting in a player's list. Accepting it would start a precomputed PvP fight,
// which is why these obsolete invites must be retired.
//
// Tactical Arena matches ride the same `clanWarPet` mode with `arenaMatch: true`.
// They are a different game mode and pass straight through.
// ─────────────────────────────────────────────────────────────────────────────

export const STALE_PET_DUEL_MESSAGE =
    "This pet challenge has been retired. Open Pet Arena, create an arena code, and share it with the other player.";

/** Legacy pet-duel challenge shape — structural, so this module never has to
 *  import the DuelChallenge type out of App.tsx and create a cycle. */
export interface RetirableChallenge { id: string; arenaMatch?: boolean }

/**
 * Drop a stale pet-duel challenge and tell the player why. Returns true when the
 * challenge was retired, so the caller can `return` on it in one line.
 */
export function retireStalePetDuel<T extends RetirableChallenge>(
    challenge: T,
    all: readonly T[],
    setAll: (next: T[]) => void,
    notify: (message: string) => void = (m) => globalThis.alert?.(m),
): boolean {
    if (challenge.arenaMatch) return false;
    setAll(all.filter((c) => c.id !== challenge.id));
    notify(STALE_PET_DUEL_MESSAGE);
    return true;
}
