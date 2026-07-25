// Per-device record of which achievement "unlocked" toasts have already been
// shown to a given player. Persisted to localStorage so a popup that was seen
// (or dismissed) never re-appears on refresh or the next login.
//
// SCOPE: this ledger gates the POPUP only — never persistence. Whether an unlock
// is stored (and its reward paid) is decided server-side by
// /api/achievements/sync; see lib/achievement-sync.ts. An earlier version used
// this ledger to also suppress the server sync, which meant an unlock that had
// been toasted once could never persist, so the toast returned on every refresh
// and the client re-churned the save. Keep the two concerns separate.

const key = (player: string) => `ach:toasted:${player.toLowerCase()}`;

function read(player: string): Set<string> {
    try {
        const raw = localStorage.getItem(key(player));
        const arr: unknown = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
    } catch {
        return new Set();
    }
}

/** Subset of `candidates` whose toast has NOT yet been shown for this player. */
export function unseenAchievements(player: string, candidates: string[]): string[] {
    if (!player) return candidates;
    const seen = read(player);
    return candidates.filter((id) => !seen.has(id));
}

/** Mark `ids` as already-toasted for this player (persisted). No-op if empty. */
export function markAchievementsToasted(player: string, ids: string[]): void {
    if (!player || ids.length === 0) return;
    const seen = read(player);
    let changed = false;
    for (const id of ids) if (!seen.has(id)) { seen.add(id); changed = true; }
    if (!changed) return;
    try {
        localStorage.setItem(key(player), JSON.stringify([...seen]));
    } catch {
        /* quota / private-mode: best-effort, the sync gate still prevents loops */
    }
}
