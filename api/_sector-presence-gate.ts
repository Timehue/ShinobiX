/*
 * "You must actually be standing there" — the sector gate for wild-field rewards.
 *
 * ── The hole this closes ────────────────────────────────────────────────────
 * Whether a player is attackable is decided by their PRESENCE sector: sector 0
 * means a town screen (village / Central / festival) where PvP cannot reach
 * them, and >= 1 means the wild, where they can be attacked live and, once the
 * 90s sweep converts them, killed as a sleeper camp.
 *
 * The presence store is strict about sector CHANGES — a live session can only
 * move via a server-minted travel lease — but it accepts a claim of sector 0
 * unconditionally, because "I walked into a village" is pure client-side UI
 * navigation with no server call behind it.
 *
 * Wild-field reward endpoints, meanwhile, took the sector from the REQUEST
 * BODY and never consulted presence at all. Those two facts compose into an
 * exploit: a tampered client heartbeats `sector: 0` — invisible, unattackable,
 * un-sleeper-killable — while calling /api/world/explore with `sector: 12` to
 * farm the wild. Full PvE income, total PvP immunity. In a game whose danger
 * budget is "the wild is risky", that is not a small thing.
 *
 * ── The gate ────────────────────────────────────────────────────────────────
 * Reward the field only for a player whose LIVE presence puts them in the
 * sector they are claiming. This is deliberately the same rule attacking
 * already follows (api/player/sleeper-kill.ts: `attacker.sector !== campSector`
 * → 409), so farming and fighting now agree on what "being somewhere" means:
 * if you are present enough to take the sector's rewards, you are present
 * enough to be attacked for them.
 *
 * For an honest client this is a no-op — exploring happens on the world map,
 * where the client already reports that exact sector every heartbeat.
 */
import { onlineStore } from './_realtime/online-store.js';

export type SectorPresenceBlock = { status: number; error: string; reason: string };

/**
 * Null when the player may act in `claimedSector`; otherwise the response to
 * return. Callers should treat a block as a normal 409, not an error.
 *
 * `claimedSector` below 1 is not gated: town-side actions are not wild-field
 * rewards and have their own rules.
 */
export function sectorPresenceBlock(playerName: string, claimedSector: unknown): SectorPresenceBlock | null {
    const sector = Math.floor(Number(claimedSector));
    if (!Number.isFinite(sector) || sector < 1) return null;

    const presence = onlineStore.get(playerName);
    if (!presence) {
        // Same phrasing and status the attack path uses for the same condition.
        // The window is small in practice — the client heartbeats every few
        // seconds and must reach the world map to explore at all — and the
        // client already handles this response from sleeper-kill.
        return {
            status: 409,
            error: 'Your world presence is not ready — give it a moment and try again.',
            reason: 'no-presence',
        };
    }
    if (presence.sector !== sector) {
        return {
            status: 409,
            error: 'You are not in that sector.',
            reason: 'sector-mismatch',
        };
    }
    return null;
}
