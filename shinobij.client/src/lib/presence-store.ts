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
 *
 * Players are matched by account slug (playerSlug), never by display name: the
 * server names a departing player by slug in `presence:leave` / `presence:gone`,
 * while records carry the display name ("Shadow Fox" vs "shadowfox").
 */
import { useSyncExternalStore } from "react";
import type { PlayerRecord } from "../types/character";
import { playerSlug } from "./utils";

// Grace window: how long a player who drops out of a single snapshot stays shown
// before we believe they're gone. MUST stay far below the server offline TTL
// (OFFLINE_AFTER_MS = 90_000) so this can only smooth sub-second gaps, never show
// a ghost. An explicit presence:gone / sleeper-KO bypasses this entirely. It
// expires on a timer: with a live socket the next full roster can be a minute
// away (lib/heartbeat-roster.ts).
const LINGER_MS = 2500;

// A full roster from the HTTP beat travels separately from the socket, so it can
// be older than a socket event that reached us first. For this long after the
// socket saw a player leave, a roster does not re-add them; for this long after
// it saw them present, a roster that omits them does not start their linger.
const ROSTER_RACE_MS = 5000;

let liveArr: PlayerRecord[] = [];
let liveSig = "";
let liveSector: number | null = null;
// Membership/display-only snapshot (NO within-sector tile): its reference changes
// only when WHO is in the sector or their display fields change — NOT when a peer
// walks to a new tile. The "Players Here" panel + sleeper logic subscribe to this
// (useLiveSectorRoster) so tile-only movement re-renders just the walking overlay
// (useLiveSectorPlayers), not all of WorldMap. This is the futureproofing that
// keeps a crowded sector smooth.
let rosterArr: PlayerRecord[] = [];
let rosterSig = "";
const subscribers = new Set<() => void>();
// player key -> ms epoch at which a currently-missing player should drop.
const lingerUntil = new Map<string, number>();
let lingerTimer: ReturnType<typeof setTimeout> | null = null;
// player key -> ms epoch of the socket's last word on them (see ROSTER_RACE_MS).
const recentLeaves = new Map<string, number>();
const recentConfirms = new Map<string, number>();
// The newest complete roster adopted for the current sector, from either
// channel. lib/heartbeat-roster.ts asks for another when this is missing or old.
let lastFullRoster: { sector: number; at: number } | null = null;

/** The key presence events use for a player: the server's account slug. */
function playerKey(name: string): string {
    return playerSlug(name) || name.toLowerCase();
}
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

const localTileCorrections = new Set<(tile: number, sector?: number) => void>();
let pendingLocalCorrection: { tile: number; sector?: number } | null = null;
export function getPendingLocalSectorCorrection() { return pendingLocalCorrection; }
/** Server recovery corrects the mounted map as well as the outgoing presence
 * frame. Normal walking uses setLocalSectorTile and never feeds back here. */
export function correctLocalSectorTile(tile: unknown, sector?: number): void {
    const validTile = typeof tile === 'number' && Number.isInteger(tile) && tile >= 0 && tile < 144;
    if (!validTile && sector === undefined) return;
    setLocalSectorTile(validTile ? tile : 78);
    pendingLocalCorrection = localTileCorrections.size === 0 ? { tile: localTile, sector } : null;
    localTileCorrections.forEach((listener) => listener(localTile, sector));
}
export function subscribeLocalSectorTileCorrections(listener: (tile: number, sector?: number) => void): () => void {
    localTileCorrections.add(listener);
    if (pendingLocalCorrection) {
        const pending = pendingLocalCorrection;
        pendingLocalCorrection = null;
        listener(pending.tile, pending.sector);
    }
    return () => { localTileCorrections.delete(listener); };
}

function normalizedSector(value: unknown): number | null {
    const sector = Number(value);
    if (!Number.isFinite(sector)) return null;
    return Math.max(0, Math.floor(sector));
}

function playerSector(p: PlayerRecord): number | null {
    return normalizedSector(p.currentSector ?? (p as { sector?: unknown }).sector);
}

function normalizePlayerRecord(p: PlayerRecord): PlayerRecord {
    const sector = playerSector(p);
    if (sector == null || p.currentSector === sector) return p;
    return { ...p, currentSector: sector };
}

function clearLiveSectorPlayers(notifySubscribers: boolean): void {
    const hadState = liveArr.length > 0 || rosterArr.length > 0 || lingerUntil.size > 0 || liveSig !== "" || rosterSig !== "";
    liveArr = [];
    liveSig = "";
    rosterArr = [];
    rosterSig = "";
    lingerUntil.clear();
    if (lingerTimer !== null) clearTimeout(lingerTimer);
    lingerTimer = null;
    // Socket history is per sector: someone seen leaving the old sector may be
    // standing in the new one.
    recentLeaves.clear();
    recentConfirms.clear();
    lastFullRoster = null;
    if (notifySubscribers && hadState) notify();
}

function pruneRecent(map: Map<string, number>, now: number): void {
    for (const [key, at] of map) if (now - at >= ROSTER_RACE_MS) map.delete(key);
}

function within(map: Map<string, number>, key: string, now: number): boolean {
    const at = map.get(key);
    return at !== undefined && now - at < ROSTER_RACE_MS;
}

/**
 * The newest complete roster adopted for the current sector (null after a sector
 * change or reset). Read by lib/heartbeat-roster.ts.
 */
export function getLastFullRoster(): { sector: number; at: number } | null {
    return lastFullRoster;
}

/**
 * Tell the store which sector the viewer is currently standing in. This lets us
 * reject late HTTP/socket snapshots from the sector the player just left.
 */
export function setLiveSectorContext(sector: number | null): void {
    const nextSector = normalizedSector(sector);
    if (pendingLocalCorrection?.sector !== undefined && pendingLocalCorrection.sector !== nextSector) pendingLocalCorrection = null;
    if (nextSector === liveSector) return;
    liveSector = nextSector;
    clearLiveSectorPlayers(true);
}

/**
 * The sector the viewer is standing in, as last told to this store (null before
 * App publishes one). Read by presentation that mounts from many hosts and only
 * needs the place — the combat weather layer — never for gameplay decisions.
 */
export function getLiveSectorContext(): number | null {
    return liveSector;
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
            `${p.name.toLowerCase()}:${p.level ?? ""}:${p.currentSector ?? ""}:${p.village ?? ""}:${p.clan ?? ""}:${p.inBattle ? 1 : 0}:${p.stronghold?.sector ?? ""}:${(p.travelingUntil ?? 0) > now ? 1 : 0}:${Math.floor((p.lastSeenAt ?? 0) / SEEN_BUCKET_MS)}`,
        )
        .sort()
        .join("|");
}

// Full live signature = membership signature + per-name tile, so the overlay
// re-renders when a peer walks. Keep push/remove in sync via this one helper.
function liveSignature(list: PlayerRecord[], memberSig: string): string {
    return memberSig + "||" + list.map((p) => `${p.name.toLowerCase()}:${p.tile ?? ""}:${p.stronghold?.tile ?? ""}`).sort().join(",");
}

function notify(): void {
    subscribers.forEach((fn) => fn());
}

/**
 * Adopt a fresh live-sector roster (from the HTTP heartbeat's `sectorMates` or the
 * socket `presence:sector` push). Applies the 2B linger merge, the signature
 * short-circuit, and the avatar prefetch.
 */
export function pushLiveSectorPlayers(next: PlayerRecord[], sector?: number): void {
    const snapshotSector = normalizedSector(sector);
    next = next.map(normalizePlayerRecord);
    if (snapshotSector != null) {
        if (liveSector != null && snapshotSector !== liveSector) return;
        liveSector = snapshotSector;
        next = next.filter((p) => playerSector(p) === snapshotSector);
    }
    const now = Date.now();
    if (liveSector != null) lastFullRoster = { sector: liveSector, at: now };
    pruneRecent(recentLeaves, now);
    pruneRecent(recentConfirms, now);
    // A roster may predate the socket leave that already removed someone.
    next = next.filter((p) => !within(recentLeaves, playerKey(p.name), now));
    const nextKeys = new Set(next.map((p) => playerKey(p.name)));
    // Anyone present in this snapshot is unambiguously here — clear their linger.
    for (const key of nextKeys) lingerUntil.delete(key);
    // Carry over players who were showing but are absent from THIS snapshot, for up
    // to LINGER_MS, so a one-beat gap doesn't blink them out. One the socket
    // confirmed a moment ago is kept outright: the roster may predate them.
    const carried: PlayerRecord[] = [];
    for (const p of liveArr) {
        const key = playerKey(p.name);
        if (nextKeys.has(key)) continue;
        if (within(recentConfirms, key, now)) {
            carried.push(p);
            continue;
        }
        let until = lingerUntil.get(key);
        if (until == null) {
            until = now + LINGER_MS;
            lingerUntil.set(key, until);
        }
        if (now < until) carried.push(p);
        else lingerUntil.delete(key);
    }
    scheduleLingerExpiry(now);
    const merged = carried.length ? [...next, ...carried] : next;
    const memberSig = presenceSignature(merged);
    const sig = liveSignature(merged, memberSig);
    if (sig === liveSig) return; // unchanged — keep ref, notify nobody
    liveArr = merged;
    liveSig = sig;
    // Refresh the membership snapshot only when WHO/display changed (not on a
    // tile-only move), so panel subscribers don't re-render when a peer walks.
    if (memberSig !== rosterSig) {
        rosterArr = merged;
        rosterSig = memberSig;
    }
    if (prefetch) prefetch(merged.map((p) => p.name));
    notify();
}

/** Apply a socket join/state delta without replacing the complete sector roster. */
export function upsertLiveSectorPlayer(player: PlayerRecord, sector: number): void {
    const snapshotSector = normalizedSector(sector);
    if (snapshotSector == null || (liveSector != null && liveSector !== snapshotSector)) return;
    const normalized = normalizePlayerRecord(player);
    if (playerSector(normalized) !== snapshotSector) return;
    liveSector = snapshotSector;
    const key = playerKey(normalized.name);
    lingerUntil.delete(key);
    recentLeaves.delete(key);
    recentConfirms.set(key, Date.now());
    const index = liveArr.findIndex((p) => playerKey(p.name) === key);
    const next = index >= 0
        ? liveArr.map((p, i) => i === index ? normalized : p)
        : [...liveArr, normalized];
    const memberSig = presenceSignature(next);
    const sig = liveSignature(next, memberSig);
    if (sig === liveSig) return;
    liveArr = next;
    liveSig = sig;
    if (memberSig !== rosterSig) {
        rosterArr = next;
        rosterSig = memberSig;
    }
    if (prefetch) prefetch([normalized.name]);
    notify();
}

/** Apply a high-frequency tile delta while keeping the roster snapshot stable. */
export function moveLiveSectorPlayer(name: string, tile: number, sector: number): void {
    const snapshotSector = normalizedSector(sector);
    if (snapshotSector == null || (liveSector != null && liveSector !== snapshotSector)) return;
    const key = playerKey(name);
    const index = liveArr.findIndex((p) => playerKey(p.name) === key);
    if (index < 0 || liveArr[index].tile === tile) return;
    liveArr = liveArr.map((p, i) => i === index ? { ...p, tile } : p);
    liveSig = liveSignature(liveArr, rosterSig);
    // rosterArr intentionally remains unchanged: tile movement should only
    // re-render the peer overlay, not WorldMap's membership/status panels.
    notify();
}

/**
 * Remove players authoritatively (socket `presence:leave` / `presence:gone`).
 * Bypasses the linger grace so a real departure clears within one frame. The
 * server names them by slug; a display name works too.
 *
 * `sector` is the sector they left. A leave for any other sector is ignored:
 * the socket can still be in the old sector's room just after this client moved
 * on, and a companion who left that sector with us may be standing right here.
 */
export function removeLiveSectorPlayers(names: string[], sector?: number): void {
    if (!names.length) return;
    if (sector !== undefined && liveSector != null && normalizedSector(sector) !== liveSector) return;
    const now = Date.now();
    const gone = new Set(names.map(playerKey));
    for (const key of gone) {
        recentLeaves.set(key, now);
        recentConfirms.delete(key);
    }
    dropPlayers(gone);
}

function dropPlayers(keys: Set<string>): void {
    for (const key of keys) lingerUntil.delete(key);
    const filtered = liveArr.filter((p) => !keys.has(playerKey(p.name)));
    if (filtered.length === liveArr.length) return; // nobody removed
    const memberSig = presenceSignature(filtered);
    liveArr = filtered;
    liveSig = liveSignature(filtered, memberSig);
    rosterArr = filtered;
    rosterSig = memberSig;
    notify();
}

// Arm one timer for the earliest linger deadline, so a player missing from a
// roster drops LINGER_MS later even when no other roster follows.
function scheduleLingerExpiry(now: number): void {
    if (lingerTimer !== null) clearTimeout(lingerTimer);
    lingerTimer = null;
    let earliest = Infinity;
    for (const until of lingerUntil.values()) earliest = Math.min(earliest, until);
    if (earliest === Infinity) return;
    lingerTimer = setTimeout(expireLingering, Math.max(0, earliest - now));
    // Node test runs: never hold the process open for a presentation timer.
    (lingerTimer as { unref?: () => void }).unref?.();
}

function expireLingering(): void {
    lingerTimer = null;
    const now = Date.now();
    const expired = new Set<string>();
    for (const [key, until] of lingerUntil) if (now >= until) expired.add(key);
    if (expired.size) dropPlayers(expired);
    scheduleLingerExpiry(now);
}

/** Clear everything (logout / account switch) so no roster bleeds across sessions. */
export function resetLiveSectorPlayers(): void {
    pendingLocalCorrection = null;
    liveSector = null;
    // Notifies only when a roster was showing.
    clearLiveSectorPlayers(true);
}

/** Non-reactive snapshot read. Returns a STABLE reference until contents change. */
export function getLiveSectorPlayers(): PlayerRecord[] {
    return liveArr;
}

/** Membership/display-only snapshot (stable across tile-only moves). */
export function getLiveSectorRoster(): PlayerRecord[] {
    return rosterArr;
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

/** React binding — re-renders on ANY change incl. a peer moving tiles (overlay). */
export function useLiveSectorPlayers(): PlayerRecord[] {
    return useSyncExternalStore(subscribe, getLiveSectorPlayers);
}

/** React binding — re-renders only on membership/display change, NOT tile moves
 *  (the "Players Here" panel + sleeper logic; keeps WorldMap off the hot path). */
export function useLiveSectorRoster(): PlayerRecord[] {
    return useSyncExternalStore(subscribe, getLiveSectorRoster);
}
