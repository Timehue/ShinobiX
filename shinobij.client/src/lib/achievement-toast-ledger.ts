// Per-device record of which achievement "unlocked" toasts have already been
// shown to a given player. Persisted to localStorage so a popup that was seen
// (or dismissed) NEVER re-appears on refresh or the next login — regardless of
// whether the server managed to persist the unlock. This is the durable guard
// behind the achievement toasts in App.tsx.

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
        /* quota / private-mode: best-effort, the in-session guard still holds */
    }
}
