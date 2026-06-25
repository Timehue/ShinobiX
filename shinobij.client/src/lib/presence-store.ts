/**
 * Live sector-roster external store (sector smoothness — Phase 1A + 2B).
 *
 * The list of players standing in your current sector used to live in a
 * `useState` on the top-level <App>. The multiplayer heartbeat refreshes it as
 * often as ~1×/sec (and the Socket.IO `presence:sector` push fires on top), and
 * each refresh handed React a brand-new array — so every beat re-rendered ALL of
 * App, even when nothing in the roster had actually changed.
 *
 * Moving it into a `useSyncExternalStore`-backed module store fixes two things at
 * once, with ZERO change to what the sector view shows:
 *
 *   1. (1A) Only the component that reads `useLiveSectorPlayers()` (the WorldMap
 *      sector view) re-renders when the roster changes — not the whole App tree.
 *   2. (2B) A cheap content signature gates notifications: an unchanged beat
 *      keeps the SAME array reference and notifies nobody, so React bails.
 *      A short per-name "linger" also keeps a player visible for a beat or two
 *      when a single snapshot momentarily omits them, killing the sub-second
 *      pop-in/out blink — WITHOUT ever resurrecting a player who truly left
 *      (an explicit `presence:gone` / sleeper-KO removes immediately, and the
 *      linger window is far shorter than the server's 60s offline TTL).
 *
 * Renderer/data-flow only: no network, no gameplay, no balance, no saves. The
 * authoritative membership decisions still come from the heartbeat + socket; this
 * just smooths how that membership is presented.
 */
import { useSyncExternalStore } from "react";
import type { PlayerRecord } from "../types/character";

// Grace window: how long a player who drops out of a single snapshot stays shown
// before we believe they're gone. MUST stay far below the server offline TTL
// (OFFLINE_AFTER_MS = 60_000) so this can only smooth sub-second gaps, never show
// a ghost. An explicit presence:gone / sleeper-KO bypasses this entirely.
const LINGER_MS = 2500;

let liveArr: PlayerRecord[] = [];
let liveSig = "";
const subscribers = new Set<() => void>();
// lowercased name -> ms epoch at which a currently-missing player should drop.
const lingerUntil = new Map<string, number>();
// Avatar prefetch hook: App registers ensureAvatarsCached so a newly-seen
// player's portrait loads the instant they appear, without re-rendering App.
let prefetch: ((names: string[]) => void) | null = null;

// The local player's current within-sector tile (0..143). WorldMap owns the tile
// state (sectorPlayerPos) but the heartbeat that broadcasts presence lives in App,
// so this module bridges the two: WorldMap writes it on every move, App reads it
// into the heartbeat/socket frame. Defaults to the grid centre (SectorAvatar's
// default) so a fresh session broadcasts a sane tile before the first move.
let localTile = 78;
export function setLocalSectorTile(tile: number): void {
    if (Number.isFinite(tile)) localTile = Math.max(0, Math.min(143, Math.floor(tile)));
}
export function getLocalSectorTile(): number {
    return localTile;
}

// lastSeenAt advances every beat, so including it raw would defeat the
// short-circuit (every beat would look "changed"). Bucket it to 30s instead: the
// roster still refreshes at least every ~30s, which keeps the Scout Network
// overlay's 90s "drop stale presence" check (WorldMap) accurate with a safe 60s
// margin, while the rapid no-change beats in between collapse to one reference.
const SEEN_BUCKET_MS = 30_000;

/**
 * Cheap, order-insensitive content signature over the fields consumers actually
 * read (sector dots + the Scout Network overlay: name, level, sector, village,
 * clan, travel state, coarse freshness) — NOT a deep compare of the nested
 * character blob. If two rosters share a signature, swapping the array would
 * change nothing observable, so we keep the old reference and skip the re-render.
 * Exported so the broader playerRoster merge in App reuses the exact same
 * short-circuit (Phase 1B).
 */
export function presenceSignature(list: PlayerRecord[]): string {
    const now = Date.now();
    return list
        .map((p) =>
            `${p.name.toLowerCase()}:${p.level ?? ""}:${p.currentSector ?? ""}:${p.village ?? ""}:${p.clan ?? ""}:${(p.travelingUntil ?? 0) > now ? 1 : 0}:${Math.floor((p.lastSeenAt ?? 0) / SEEN_BUCKET_MS)}`,
        )
        .sort()
        .join("|");
}

function notify(): void {
    subscribers.forEach((fn) => fn());
}

/**
 * Adopt a fresh live-sector roster (from the HTTP heartbeat's `sectorMates` or the
 * socket `presence:sector` push). Applies the 2B linger merge, the signature
 * short-circuit, and the avatar prefetch.
 */
export function pushLiveSectorPlayers(next: PlayerRecord[]): void {
    const now = Date.now();
    const nextNames = new Set(next.map((p) => p.name.toLowerCase()));
    // Anyone present in this snapshot is unambiguously here — clear their linger.
    for (const lname of nextNames) lingerUntil.delete(lname);
    // Carry over players who were showing but are absent from THIS snapshot, for up
    // to LINGER_MS, so a one-beat gap doesn't blink them out.
    const carried: PlayerRecord[] = [];
    for (const p of liveArr) {
        const lname = p.name.toLowerCase();
        if (nextNames.has(lname)) continue;
        let until = lingerUntil.get(lname);
        if (until == null) {
            until = now + LINGER_MS;
            lingerUntil.set(lname, until);
        }
        if (now < until) carried.push(p);
        else lingerUntil.delete(lname);
    }
    const merged = carried.length ? [...next, ...carried] : next;
    // Append a tile component to the live signature ONLY (not the exported
    // presenceSignature, which App's playerRoster 1B short-circuit reuses): the
    // sector overlay must re-render when a peer walks to a new tile, but the broad
    // roster must NOT churn App every time anyone moves.
    const sig = presenceSignature(merged) + "||" +
        merged.map((p) => `${p.name.toLowerCase()}:${p.tile ?? ""}`).sort().join(",");
    if (sig === liveSig) return; // unchanged — keep ref, notify nobody
    liveArr = merged;
    liveSig = sig;
    if (prefetch) prefetch(merged.map((p) => p.name));
    notify();
}

/**
 * Remove players authoritatively (socket `presence:gone` sweep). Bypasses the
 * linger grace so a real departure clears within one frame.
 */
export function removeLiveSectorPlayers(names: string[]): void {
    if (!names.length) return;
    const goneLower = new Set(names.map((n) => n.toLowerCase()));
    for (const lname of goneLower) lingerUntil.delete(lname);
    const filtered = liveArr.filter((p) => !goneLower.has(p.name.toLowerCase()));
    if (filtered.length === liveArr.length) return; // nobody removed
    liveArr = filtered;
    liveSig = presenceSignature(filtered);
    notify();
}

/** Clear everything (logout / account switch) so no roster bleeds across sessions. */
export function resetLiveSectorPlayers(): void {
    if (!liveArr.length && !lingerUntil.size) return;
    liveArr = [];
    liveSig = "";
    lingerUntil.clear();
    notify();
}

/** Non-reactive snapshot read. Returns a STABLE reference until contents change. */
export function getLiveSectorPlayers(): PlayerRecord[] {
    return liveArr;
}

/** Register the avatar prefetch (App passes ensureAvatarsCached). Pass null to clear. */
export function setLiveAvatarPrefetch(fn: ((names: string[]) => void) | null): void {
    prefetch = fn;
}

function subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => {
        subscribers.delete(fn);
    };
}

/** React binding — only components that call this re-render on a roster change. */
export function useLiveSectorPlayers(): PlayerRecord[] {
    return useSyncExternalStore(subscribe, getLiveSectorPlayers);
}
