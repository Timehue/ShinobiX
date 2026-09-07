/*
 * Battle authority (F01): is this player PROVABLY in a fight right now?
 *
 * Presence used to take `inBattle` from the player's own heartbeat, and the
 * target-side reads of that flag grant attack immunity. Nothing corroborated
 * the claim, so a tampered client could assert it forever: visible in the
 * wild, farming the field, un-attackable, never converting to a sleeper camp.
 * The flag is now derived here from what the combat stores can prove, and the
 * client's claim is ignored (online-store.ts).
 *
 * Evidence, in the order it is consulted (cheapest first):
 *   - a pet duel, running or pending with this side committed: in-process registry, free;
 *   - `battle-lock:<slug>`: a Tower lease (refreshed per action, released at
 *     terminal) or the legacy marker the regeneration exclusion already honours;
 *   - `battle-state:<slug>`: the projection a fight host writes at start
 *     (battle-projection.ts), verified against the record it names:
 *       solo-pve     an active session not past its gameplay expiry;
 *       hollow-gate  the dive's run key (`hg-run:<slug>:<token>`), which exists
 *                    exactly while the dive is live — settled or died, it is gone;
 *       pet-showdown a showdown session that is not yet `finished`;
 *   - `pvp:pending-session:<slug>`: a fresh reservation, or an active pointer
 *     whose session is still `active` (a pointer that already carries its
 *     terminal recovery deadline is a finished duel: no read needed);
 *   - `ai-fight-active:<slug>`: the generic AI-fight pointer, for a session
 *     that started before the projection existed;
 *   - `pet:battle-active:<slug>`: the legacy pet-battle pointer, verified
 *     against the sealed token it names.
 *
 * The five KV keys are read by the heartbeat on the mget it already performs,
 * so corroboration costs no extra round trip in the common case; only a
 * pointer that needs its record verified costs one read, and that verdict is
 * cached per player for BATTLE_AUTHORITY_CACHE_MS (keyed by the exact
 * evidence, so a changed pointer is never served stale).
 *
 * A session that is still `active` but past its gameplay expiry grants NO
 * immunity and is reported as `lapsed`, so the caller can terminalize it with
 * its own evidence (F08, api/_battle-lapse.ts). A projection whose record is
 * gone or finished is reported the same way, so it is retired. Storage errors
 * while verifying are not evidence either way: the resolver throws, and the
 * heartbeat keeps the presence flag as it was.
 */
import { kv as realKv, type KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';
import { isTowerBattleLock } from '../_tower-battle-guard.js';
import { isSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';
import { soloPveSessionKey } from '../solo-pve/_store.js';
import { hollowGateRunKey } from '../hollow-gate/_run-token.js';
import { parsePvpPendingSessionPointer, pvpPendingSessionKey } from '../pvp/_pending-session.js';
import type { PvpSession } from '../pvp/session.js';
import { isPvpSessionLapsed } from '../pvp/_lapse-rules.js';
import { sessionForPlayer as petDuelSessionForPlayer } from './pet-duel-session.js';
import {
    battleStateKey,
    cachedBattleAuthority,
    isBattleStateProjection,
    rememberBattleAuthority,
    type BattleAuthority,
    type LapsedBattle,
} from './battle-projection.js';

export type { BattleAuthority, LapsedBattle } from './battle-projection.js';

export const AI_FIGHT_ACTIVE_PREFIX = 'ai-fight-active:';
export const BATTLE_LOCK_PREFIX = 'battle-lock:';
export const PET_BATTLE_ACTIVE_PREFIX = 'pet:battle-active:';

/** The sealed record a legacy pet-battle pointer names (api/pet/battle-start.ts). */
export function petBattleTokenKey(slug: string, token: string): string {
    return `pet:battle-token:${slug}:${token}`;
}

/** A showdown session row (api/pet/showdown.ts); `finished` is the terminal mark. */
export function petShowdownSessionKey(slug: string, sessionId: string): string {
    return `pet:showdown:${slug}:${sessionId}`;
}

/** The raw values of `battleAuthorityKeys(slug)`, in that order. */
export type BattleEvidence = {
    battleState: unknown;
    battleLock: unknown;
    pvpPointer: unknown;
    aiFightPointer: unknown;
    petBattleActive: unknown;
};

/** The slice of a pet-duel registry entry the resolver reads. */
export type PetDuelPresence = {
    status: string;
    p1?: { name: string; ready: boolean };
    p2?: { name: string; ready: boolean };
};

export type BattleAuthorityDeps = {
    kv?: Pick<KvLike, 'get'>;
    now?: () => number;
    petDuelFor?: (slug: string) => PetDuelPresence | null;
};

/**
 * A two-player pet duel engages a fighter while it RUNS, and while it is
 * still PENDING once that fighter has committed: the challenger from the
 * moment the invite goes out, the target from the moment they accept (the
 * socket marks each side `ready` at exactly those points, and the session
 * runs once both are). A target who has not answered is not in a fight and
 * stays attackable; an invite that lapses unanswered is swept out of the
 * registry within its 30-second window, and the flag follows on the next beat.
 */
export function petDuelEngages(duel: PetDuelPresence | null | undefined, slug: string): boolean {
    if (!duel) return false;
    if (duel.status === 'running') return true;
    if (duel.status !== 'pending') return false;
    const side = [duel.p1, duel.p2].find((p) => p && safeName(p.name) === slug);
    return side?.ready === true;
}

/** The KV keys whose values corroborate a fight, for the heartbeat's mget. */
export function battleAuthorityKeys(playerName: string): [string, string, string, string, string] {
    const slug = safeName(playerName);
    return [
        battleStateKey(slug),
        `${BATTLE_LOCK_PREFIX}${slug}`,
        pvpPendingSessionKey(slug),
        `${AI_FIGHT_ACTIVE_PREFIX}${slug}`,
        `${PET_BATTLE_ACTIVE_PREFIX}${slug}`,
    ];
}

export function battleEvidenceFrom(values: readonly unknown[]): BattleEvidence {
    return {
        battleState: values[0] ?? null,
        battleLock: values[1] ?? null,
        pvpPointer: values[2] ?? null,
        aiFightPointer: values[3] ?? null,
        petBattleActive: values[4] ?? null,
    };
}

function evidenceFingerprint(evidence: BattleEvidence): string {
    return JSON.stringify([
        evidence.battleState ?? null,
        evidence.battleLock ?? null,
        evidence.pvpPointer ?? null,
        evidence.aiFightPointer ?? null,
        evidence.petBattleActive ?? null,
    ]);
}

async function soloPveVerdict(
    store: Pick<KvLike, 'get'>,
    sessionId: string,
    now: number,
): Promise<'live' | 'lapsed' | 'none'> {
    const session = await store.get<SoloPveSession>(soloPveSessionKey(sessionId));
    if (!isSoloPveSession(session) || session.status !== 'active') return 'none';
    return session.expiresAt > now ? 'live' : 'lapsed';
}

export async function resolveBattleAuthority(
    playerName: string,
    evidence: BattleEvidence,
    deps: BattleAuthorityDeps = {},
): Promise<BattleAuthority> {
    const slug = safeName(playerName);
    const now = deps.now?.() ?? Date.now();
    const store = deps.kv ?? realKv;
    if (!slug) return { inBattle: false, source: null };

    // A pet duel is server state in this very process: running, or pending
    // with this side committed to it (petDuelEngages).
    const duel = (deps.petDuelFor ?? petDuelSessionForPlayer)(slug);
    if (petDuelEngages(duel, slug)) return { inBattle: true, source: 'pet-duel' };

    const fingerprint = evidenceFingerprint(evidence);
    const cached = cachedBattleAuthority(slug, fingerprint, now);
    if (cached) return cached;

    const verdict = await resolveUncached(slug, evidence, store, now);
    rememberBattleAuthority(slug, fingerprint, verdict, now);
    return verdict;
}

async function resolveUncached(
    slug: string,
    evidence: BattleEvidence,
    store: Pick<KvLike, 'get'>,
    now: number,
): Promise<BattleAuthority> {
    // A Tower lease is refreshed on every action and released at terminal, so
    // its presence IS the run's liveness for this account. Anything else under
    // the key is the legacy marker the regen exclusion already honours.
    if (evidence.battleLock) {
        return { inBattle: true, source: isTowerBattleLock(evidence.battleLock) ? 'tower' : 'legacy-lock' };
    }

    let lapsed: LapsedBattle | undefined;
    const projection = isBattleStateProjection(evidence.battleState) ? evidence.battleState : null;
    if (projection) {
        if (projection.kind === 'hollow-gate') {
            // A dive is live exactly while its run key exists; the projection's
            // expiry is only a hint for the sweep, never the verdict.
            const run = await store.get<unknown>(hollowGateRunKey(slug, projection.sessionId));
            if (run) return { inBattle: true, source: 'hollow-gate' };
            lapsed = { kind: 'hollow-gate', sessionId: projection.sessionId };
        } else if (projection.kind === 'pet-showdown') {
            const session = await store.get<{ finished?: boolean } | null>(petShowdownSessionKey(slug, projection.sessionId));
            if (session && !session.finished) return { inBattle: true, source: 'pet-showdown' };
            lapsed = { kind: 'pet-showdown', sessionId: projection.sessionId };
        } else if (projection.expiresAt <= now) {
            // Past its gameplay expiry by the projection's own clock; the
            // owning store decides whether it is truly lapsed (the sweep and
            // the terminalizer re-read it under the session lock).
            lapsed = { kind: projection.kind, sessionId: projection.sessionId };
        } else if (projection.kind === 'solo-pve') {
            const verdict = await soloPveVerdict(store, projection.sessionId, now);
            if (verdict === 'live') return { inBattle: true, source: 'solo-pve' };
            if (verdict === 'lapsed') lapsed = { kind: 'solo-pve', sessionId: projection.sessionId };
        }
        // 'tower' is proven by the lease above; 'pvp' by the pointer below.
    }

    const pointer = parsePvpPendingSessionPointer(evidence.pvpPointer, slug);
    if (pointer) {
        if (pointer.phase === 'reserving') {
            if (Number(pointer.reservedUntil) > now) return { inBattle: true, source: 'pvp', ...(lapsed ? { lapsed } : {}) };
        } else if (pointer.recoveryExpiresAt === undefined) {
            const session = await store.get<PvpSession>(`pvp:${pointer.battleId}`);
            if (session && session.status === 'active') {
                if (!isPvpSessionLapsed(session, now)) return { inBattle: true, source: 'pvp', ...(lapsed ? { lapsed } : {}) };
                lapsed = lapsed ?? { kind: 'pvp', sessionId: pointer.battleId };
            }
        }
    }

    const ai = evidence.aiFightPointer as { sessionId?: unknown } | null;
    const aiSessionId = ai && typeof ai === 'object' && typeof ai.sessionId === 'string' ? ai.sessionId : '';
    if (aiSessionId && aiSessionId !== projection?.sessionId) {
        const verdict = await soloPveVerdict(store, aiSessionId, now);
        if (verdict === 'live') return { inBattle: true, source: 'solo-pve', ...(lapsed ? { lapsed } : {}) };
        if (verdict === 'lapsed' && !lapsed) lapsed = { kind: 'solo-pve', sessionId: aiSessionId };
    }

    // The legacy pet battle keeps one outstanding sealed token per player; the
    // pointer names it and battle-result clears the pointer on settlement. A
    // token already tombstoned (`settledAt`) is a finished fight.
    const petToken = typeof evidence.petBattleActive === 'string' ? evidence.petBattleActive : '';
    if (petToken) {
        const sealed = await store.get<{ settledAt?: unknown } | null>(petBattleTokenKey(slug, petToken));
        if (sealed && !sealed.settledAt) return { inBattle: true, source: 'pet-battle', ...(lapsed ? { lapsed } : {}) };
    }

    return { inBattle: false, source: null, ...(lapsed ? { lapsed } : {}) };
}
