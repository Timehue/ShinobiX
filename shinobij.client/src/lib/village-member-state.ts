import { adoptVillageMemberState, villageMemberEditCount, type VillageState } from "./world-state";

/*
 * A village's members-only record: its treasury and Village Stores, upgrade
 * levels, contribution total, activity log, orders and daily agenda (owner
 * ruling 2026-10-08). The public /api/game-state frame no longer carries them;
 * GET /api/village/state serves them to the village's own members, and the
 * answer is merged into the shared village cache (lib/world-state.ts), where
 * every screen already reads village state.
 *
 * Imported only by screens that show those fields (the Town Hall and the World
 * Map), so none of it rides the startup bundle.
 */

const VILLAGE_MEMBER_STATE_API = "/api/village/state";
/** An unforced read of the same village is skipped inside this window. */
const VILLAGE_MEMBER_STATE_MIN_GAP_MS = 30_000;

let lastRead: { village: string; at: number } | null = null;
let inFlight: Promise<boolean> | null = null;

/**
 * Read the player's own village record and merge it into the shared cache.
 * Resolves true when the cached village changed, so the caller can re-render.
 * Never rejects: a failed read leaves the cache as it was. `force` skips the
 * minimum gap (the Town Hall reads on its own 10-second poll).
 */
export function refreshVillageMemberState(village: string, options: { force?: boolean } = {}): Promise<boolean> {
    const name = village.trim();
    if (!name) return Promise.resolve(false);
    if (inFlight) return inFlight;
    if (!options.force && lastRead?.village === name && Date.now() - lastRead.at < VILLAGE_MEMBER_STATE_MIN_GAP_MS) return Promise.resolve(false);
    const editsAtRead = villageMemberEditCount();
    const read = (async () => {
        try {
            const response = await fetch(`${VILLAGE_MEMBER_STATE_API}?village=${encodeURIComponent(name)}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
            if (!response.ok) return false;
            const data = await response.json() as { village?: unknown; state?: unknown };
            lastRead = { village: name, at: Date.now() };
            if (typeof data.village !== "string" || !data.village || !data.state || typeof data.state !== "object") return false;
            return adoptVillageMemberState(data.village, data.state as Partial<VillageState>, editsAtRead);
        } catch {
            return false;
        }
    })();
    inFlight = read;
    void read.then(() => { if (inFlight === read) inFlight = null; });
    return read;
}
