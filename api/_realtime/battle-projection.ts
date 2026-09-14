/*
 * Server-owned battle projection (F01 / F08).
 *
 * `inBattle` on a presence row used to be whatever the player's own heartbeat
 * said. The target-side reads of that flag (presence-gating.ts) confer attack
 * immunity, so a tampered client could stand in the wild forever un-attackable
 * while it farmed the field. The flag is now SERVER-OWNED: the presence store
 * ignores the client's claim, and the heartbeat sets the flag from what the
 * owning combat stores can prove (battle-authority.ts).
 *
 * This module is the light half of that: the per-player `battle-state:<slug>`
 * projection every fight host writes at start and retires at terminal, the
 * in-process presence hooks, and the resolver's small cache. It imports
 * nothing heavy on purpose, so the combat stores can depend on it without a
 * cycle.
 *
 * The projection's `expiresAt` is the fight's GAMEPLAY expiry (the moment it
 * lapses unattended), not the row's storage TTL: the row deliberately outlives
 * the fight so a lapsed session is found and terminalized with evidence before
 * storage cleanup (F08) — by the owner's next beat, by any read of the session,
 * or by the scheduled sweep (api/cron/_battle-lapse-sweep.ts).
 */
import { onlineStore } from './online-store.js';
import { safeName } from '../_utils.js';

export const BATTLE_STATE_PREFIX = 'battle-state:';

export type BattleProjectionKind = 'solo-pve' | 'tower' | 'pvp' | 'hollow-gate' | 'pet-showdown' | 'card-clash';

export type BattleStateProjection = {
    version: 1;
    kind: BattleProjectionKind;
    /** The owning store's record id: a Solo-PvE sessionId, a Tower runId, a PvP battleId, a Hollow Gate run token, a showdown sessionId. */
    sessionId: string;
    startedAt: number;
    /** Gameplay expiry (ms epoch). The row itself is retained past this. */
    expiresAt: number;
};

export type BattleProjectionStore = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
    del?(key: string): Promise<unknown>;
};

export function battleStateKey(playerName: string): string {
    return `${BATTLE_STATE_PREFIX}${safeName(playerName)}`;
}

export function isBattleStateProjection(value: unknown): value is BattleStateProjection {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const p = value as Partial<BattleStateProjection>;
    return p.version === 1
        && (p.kind === 'solo-pve' || p.kind === 'tower' || p.kind === 'pvp' || p.kind === 'hollow-gate' || p.kind === 'pet-showdown' || p.kind === 'card-clash')
        && typeof p.sessionId === 'string'
        && p.sessionId.length > 0
        && Number.isFinite(p.startedAt)
        && Number.isFinite(p.expiresAt);
}

/** Publish (or refresh) the projection for one player's fight. */
export async function publishBattleProjection(
    store: BattleProjectionStore,
    playerName: string,
    projection: Omit<BattleStateProjection, 'version'>,
    retainSeconds: number,
): Promise<void> {
    const slug = safeName(playerName);
    if (!slug) return;
    const row: BattleStateProjection = { version: 1, ...projection };
    await store.set(battleStateKey(slug), row, { ex: Math.max(1, Math.floor(retainSeconds)) });
}

/**
 * Retire the projection ONLY if it still points at `sessionId`. A terminal
 * write for an old fight must never erase the projection of a newer one.
 * Returns true when a matching projection was cleared.
 */
export async function retireBattleProjection(
    store: BattleProjectionStore,
    playerName: string,
    sessionId: string,
): Promise<boolean> {
    const slug = safeName(playerName);
    if (!slug) return false;
    const key = battleStateKey(slug);
    const current = await store.get<unknown>(key);
    if (!isBattleStateProjection(current) || current.sessionId !== sessionId) return false;
    if (store.del) await store.del(key);
    else await store.set(key, { ...current, expiresAt: 0 }, { ex: 1 });
    return true;
}

// ── Presence hooks ──────────────────────────────────────────────────────────
// Fight hosts call these at start and terminal so immunity begins and ends
// with the fight itself rather than with the next heartbeat. The heartbeat
// re-derives the flag from the stores on every beat, so a missed hook is
// corrected within a beat, never left standing.

// A host's start hook and the heartbeat's own derivation can race: a beat whose
// mget ran just before the host wrote its record would otherwise clear the
// flag the hook set, leaving the player attackable for a beat or two at the
// very start of a fight. The heartbeat therefore never clears a flag within
// BATTLE_START_GRACE_MS of a host start unless the stores positively prove the
// fight is over (a terminal or voided record reports itself as lapsed).
export const BATTLE_START_GRACE_MS = 15_000;
const recentStarts = new Map<string, number>();

export function noteBattleStarted(playerName: string, now: number = Date.now()): void {
    const slug = safeName(playerName);
    if (!slug) return;
    invalidateBattleAuthority(slug);
    recentStarts.set(slug, now);
    onlineStore.setInBattle(slug, true);
}

export function noteBattleEnded(playerName: string): void {
    const slug = safeName(playerName);
    if (!slug) return;
    invalidateBattleAuthority(slug);
    recentStarts.delete(slug);
    onlineStore.setInBattle(slug, false);
}

/** True while a host started a fight for this player less than `windowMs` ago. */
export function battleStartedWithin(playerName: string, now: number = Date.now(), windowMs: number = BATTLE_START_GRACE_MS): boolean {
    const at = recentStarts.get(safeName(playerName));
    return at !== undefined && now - at < windowMs;
}

export function resetRecentBattleStartsForTests(): void {
    recentStarts.clear();
}

// ── Resolver cache ──────────────────────────────────────────────────────────
// The heartbeat fires up to once a second per online player. The evidence keys
// ride its existing mget for free; what costs a round trip is verifying that a
// pointed-at session is still live. That verdict is remembered per player for
// a few seconds, keyed by the exact evidence it was derived from, so a changed
// pointer is never answered from a stale entry.

export const BATTLE_AUTHORITY_CACHE_MS = 10_000;

export type BattleAuthoritySource = 'pet-duel' | 'solo-pve' | 'tower' | 'pvp' | 'legacy-lock' | 'hollow-gate' | 'pet-showdown' | 'pet-battle' | 'card-clash';

export type LapsedBattle = { kind: BattleProjectionKind; sessionId: string };

export type BattleAuthority = {
    inBattle: boolean;
    source: BattleAuthoritySource | null;
    /** An ACTIVE session whose gameplay expiry has passed — to be terminalized (F08). */
    lapsed?: LapsedBattle;
};

type CacheEntry = { fingerprint: string; until: number; value: BattleAuthority };
const cache = new Map<string, CacheEntry>();

export function cachedBattleAuthority(slug: string, fingerprint: string, now: number): BattleAuthority | null {
    const entry = cache.get(slug);
    if (!entry || entry.fingerprint !== fingerprint || entry.until <= now) return null;
    return entry.value;
}

export function rememberBattleAuthority(slug: string, fingerprint: string, value: BattleAuthority, now: number): void {
    cache.set(slug, { fingerprint, until: now + BATTLE_AUTHORITY_CACHE_MS, value });
    // Bound the map: presence itself evicts offline players; this just keeps a
    // long-running process from accumulating one entry per name ever seen.
    if (cache.size > 5_000) {
        for (const [key, entry] of cache) {
            if (entry.until <= now) cache.delete(key);
            if (cache.size <= 4_000) break;
        }
    }
}

export function invalidateBattleAuthority(slug: string): void {
    cache.delete(safeName(slug));
}

export function resetBattleAuthorityCacheForTests(): void {
    cache.clear();
    recentStarts.clear();
}
