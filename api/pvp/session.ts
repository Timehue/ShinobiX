import type { VercelRequest, VercelResponse } from '../_vercel.js';
import type { ActionReceipt } from '../_receipts.js';
import { createHash, randomUUID, randomBytes } from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { onlineStore } from '../_realtime/online-store.js';
import { sessionOpponentBlock, worldInteractionBlock, isBelowAttackableFloor, ATTACKABLE_MIN_LEVEL } from '../_realtime/presence-gating.js';
import {
    consumeRankedMatchTokenForBattle,
    proveRankedMatchTokenForBattle,
    provePlayerRankedMatchToken,
} from '../_ranked-match-token.js';
import {
    activatePlayerRankedAdmission,
    getPlayerRankedAdmission,
    makePlayerRankedSessionOrphanTombstone,
    markPlayerRankedSessionPublished,
    parsePlayerRankedSessionCloseTombstone,
    parsePlayerRankedSessionOrphanTombstone,
    playerRankedOrphanTombstoneMatchesAdmission,
    PLAYER_RANKED_ORPHAN_TOMBSTONE_TTL_SECONDS,
    type PlayerRankedAdmission,
} from '../pet/_ranked-preparation.js';
import { releaseChallengePvpReservation, reserveChallengeForPvpSession } from './_challenge-authorization.js';
import {
    releaseClanWarPvpReservation,
    requireClanWarPvpReservation,
    reserveClanWarPvpSession,
} from './_clan-war-authorization.js';
import { JUTSU_CATALOG } from './_jutsu-catalog.js';
import { LEGACY_JUTSU_CATALOG, LEGACY_JUTSU_ID_BY_LEGACY } from './_legacy-jutsu-catalog.js';
import { legacyEnabled } from '../_legacy-track.js';
import { deriveCombatMultipliers, deriveEquipmentStatBonuses, buildItemLookup } from './_multipliers.js';
import { characterMayUseJutsu, BUILTIN_BLOODLINES } from './_bloodline-gate.js';
import { loadAdminCombatContent, type AdminCombatContent } from '../_admin-content.js';
import { safeLogValue } from '../_safe-log.js';
import { KNOWN_TAG_NAMES, canonicalTagName, REQUIRES_DAMAGE_TAGS, jutsuHasFixedEffectPower, FIXED_EFFECT_STANDARD_EP } from './_tags.js';
import { enforceBloodlineBudget, type RawJutsu } from '../_jutsu-points.js';
import { sanitizeJutsuVisualEffect } from '../_jutsu-visuals.js';
import { battleLockFlagsForPlayers, settleSaveRecord } from '../_elapsed-state.js';
import { COMBAT_RESOURCES_V2, v2JutsuCosts } from '../_combat-resources.js';
import { CHAKRA_CAP_V2, STAMINA_CAP_V2 } from '../_xp-engine.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { maxLoadout } from '../_entitlements.js';
import { findTowerBattleStartConflict, towerBattleActiveErrorBody } from '../_tower-battle-guard.js';
import {
    PLAYER_RANKED_V2_DISABLED_MESSAGE,
    playerRankedV2AdmissionsEnabled,
} from './_player-ranked-rollout.js';
import {
    activatePvpPendingSessionPointer,
    clearPvpPendingSessionPointer,
    loadPvpPendingSessionPointer,
    pendingPointerMatchesSession,
    pendingPointerForSessionRole,
    pvpPendingReservationIsFresh,
    publishPvpPendingSessionPointer,
    requirePvpPendingSessionOwnership,
} from './_pending-session.js';
import {
    ensurePvpTerminalRecoveryPublication,
    loadPvpRewardRecoverySnapshot,
    sealPvpRewardRecoverySnapshot,
} from './_reward-recovery.js';
import { pvpRewardCompletionStatus } from './_reward-completion.js';
import {
    sectorWarRoleOf,
    type SealedWarRoleEvidence,
} from '../_war-role.js';

// combatResourcesV2: seal each jutsu's concrete one-bar cost (chakra XOR stamina)
// from the fighter's level + specialty, so move.ts's existing per-bar deduction
// splits the two bars for free. No-op (list returned unchanged) when the flag is
// off. Applied AFTER legacy stamping so 60-AP "Any" signatures already carry a
// concrete type. See docs/chakra-stamina-redesign-plan.md.
function sealV2JutsuCosts(list: unknown, level: number, specialty: string): unknown {
    if (!COMBAT_RESOURCES_V2 || !Array.isArray(list)) return list;
    return list.map((j) => {
        const jj = (j ?? {}) as { ap?: number; type?: string; chakraCost?: number; staminaCost?: number };
        return { ...jj, ...v2JutsuCosts(jj, level, specialty) };
    });
}

export type PvpStatus = {
    name: string;
    /** Server-authored jutsu, weapon, or zone that created this effect. */
    source?: string;
    rounds: number;
    activeRound?: number;
    percent?: number;
    amount?: number;
    // 'Increase Discipline' only: which offense composite the stack lifts.
    // Captured from the cast jutsu's type in applyJutsu (never client-supplied),
    // read back by disciplineBonuses when the capped fighters are built.
    discipline?: 'Taijutsu' | 'Bukijutsu' | 'Genjutsu' | 'Ninjutsu';
    kind: 'positive' | 'negative';
};

// Structured "your action did not apply" annotation. Attached ONLY to a direct
// /api/pvp/move RESPONSE (never persisted to KV, never on GET/SSE) so an invalid
// action explains itself instead of returning an unchanged session that looks
// like the game froze. `applied:false` is the contract; the client surfaces
// `reason` and keeps the player's pending selection so they can adjust.
export type PvpRejection = {
    applied: false;
    reason: string;
    serverRound: number;
    activePlayer: 'p1' | 'p2';
};

export type PvpFighter = {
    name: string;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    shield: number;
    statuses: PvpStatus[];
    character: Record<string, unknown>;
    pos: number; // hex grid position (0–119 for 12×10 grid)
};

export type PvpGroundEffect = {
    id: string;
    owner: 'p1' | 'p2';
    name: string;
    tiles: number[];
    rounds: number;
    tags: Array<{ name: string; percent?: number; amount?: number }>;
};

export type PvpSession = {
    battleId: string;
    /** Exact stable-create request generation; lets a lost POST ACK resume the original row. */
    createRequestFingerprint?: string;
    /**
     * Server-owned monotonic projection revision. Creation starts at 1 and
     * every persisted live mutation advances it exactly once. Clients use this
     * only to reject late Realtime/SSE/HTTP snapshots; it is never accepted
     * from a session-create or move request.
     *
     * Optional only for the bounded lifetime of pre-deploy sessions and older
     * test fixtures. New sessions always carry it and the first successful move
     * upgrades a legacy row to a revisioned projection.
     */
    stateRevision?: number;
    p1: PvpFighter;
    p2: PvpFighter;
    round: number;
    activePlayer: 'p1' | 'p2'; // whose turn it is
    ap: { p1: number; p2: number };
    actionsThisTurn: number;
    cooldowns: { p1: Record<string, number>; p2: Record<string, number> };
    groundEffects?: PvpGroundEffect[];
    log: string[];
    status: 'active' | 'done';
    winner: 'p1' | 'p2' | 'draw' | null;
    // Durable proof that this battle was created by a sanctioned server flow.
    // A client may still create an unsanctioned/casual session, but every reward
    // consumer fails closed unless this stamp exists AND both fighters joined.
    rewardAuthority?: 'challenge' | 'clan-war' | 'ranked' | 'world' | 'admin';
    /** Server-purpose authority independent of the caller's optional payout flag. */
    progressionAuthorityVersion?: 1;
    // World raids bind the authenticated session creator as the attacker.
    // Fighter ordering is presentation input and cannot establish raid credit.
    worldAttacker?: { side: 'p1' | 'p2'; name: string; village?: string; clan?: string };
    /** Server-sealed territory target and damage evidence at battle creation. */
    worldTerritoryEvidence?: {
        version: 1;
        sector: number;
        ownerClan: string;
        ownerVillage: string;
        raidDamage: number;
        observedAt: number;
    };
    /** Immutable server role evidence used by village-war continuation. Seats
     * or ANBU appointments granted after battle creation cannot amplify it. */
    warRoleEvidence?: SealedWarRoleEvidence;
    challengeId?: string;
    /** Server-derived official Kage duel prerequisite. Moves help it forward
     * before combat can advance; the browser cannot opt out or forge it. */
    kageDuelAuthority?: { version: 1; village: string; challengeId: string };
    clanWarId?: string;
    clanWarChallengeId?: string;
    joined?: { p1: boolean; p2: boolean };
    fleedBy?: 'p1' | 'p2';
    createdAt: number;
    /** Immutable server time sealed by the CAS that first terminalizes combat. */
    endedAt?: number;
    // Stamped every time a successful move commits. Used as a crashed-tab
    // fallback by the 'claim-afk-win' action — if the active player hasn't
    // moved in 90s the inactive player can claim the win even if the
    // round-timer never fired.
    lastMoveAt?: number;
    // Consecutive auto-waited (timer-expired) turns per player where the
    // player took ZERO real actions. Resets to 0 on any non-auto action.
    // claim-afk-win succeeds when opponent's count reaches 2 — i.e., they
    // let the 45s round timer run out twice in a row without doing anything.
    consecAutoWait?: { p1?: number; p2?: number };
    // Server-sealed combat-consumable budget. `itemCharges` is the remaining
    // uses per equipped item id for each fighter, sealed at create time from
    // their save's owned count (the Rejuvenation Potion / any "potion" slot is
    // additionally capped at POTION_USES_PER_BATTLE). move.ts decrements a
    // charge on each throw / consumable / potion use and rejects at 0;
    // `itemsUsed` tallies what was actually spent so claim-rewards can deduct it
    // from the save inventory at settlement. Absent on legacy in-flight sessions
    // (move.ts then treats every consumable as unlimited, the old behaviour).
    itemCharges?: { p1: Record<string, number>; p2: Record<string, number> };
    itemsUsed?: { p1: Record<string, number>; p2: Record<string, number> };
    /**
     * V1 disables mutable-inventory consumables for every real fighter. NPCs
     * retain their sealed combat behavior; missing-version in-flight sessions
     * keep the legacy post-battle debit during rolling deployment.
     */
    pvpConsumableAuthorityVersion?: 1;
    /** New sessions require the durable browser continuation/ACK protocol. */
    pvpCompletionAuthorityVersion?: 1;
    /** New sessions settle Vanguard rewards through the crash-recoverable save-marker saga. */
    vanguardRewardAuthorityVersion?: 2;
    // Which sides resolved to an authoritative SAVE at create time (real
    // players). claim-rewards settles a side's consumables from EITHER player's
    // claim, but ONLY for sides stamped real here — an NPC opponent that
    // happens to share a real player's name (sector wanderers mimic player
    // names) must never cause a deduction from that player's save. Absent on
    // legacy in-flight sessions → claim-rewards falls back to claimer-only.
    realFighters?: { p1: boolean; p2: boolean };
    // Environment snapshot captured at create time. /api/pvp/move reads
    // these from the session instead of trusting the request body — stops
    // clients from changing biome / weather between rounds.
    biome?: string;
    weatherPositiveElement?: string;
    weatherNegativeElement?: string;
    // Idempotency for move retries. Client generates a per-move UUID
    // and includes it in every POST /api/pvp/move. Server appends to
    // this ring buffer (capped at PVP_MOVE_TOKEN_HISTORY) after a
    // successful move. A retry that arrives with a token already in
    // the list short-circuits with the current session state instead
    // of re-applying the move.
    recentMoveTokens?: string[];
    /**
     * One replay capsule for the latest committed combat action. The capsule is
     * replaced only after the preceding action receipt has been made durable,
     * allowing a retry/next move to repair a crash immediately after combat CAS.
     */
    lastActionReceipt?: {
        version: 1;
        stateRevision: number;
        receipt: ActionReceipt;
    };
    // Server-authoritative ranked-rating snapshot (audit #7 / Stage 3).
    // Set ONLY when this session is a ranked match: `ranked` flags it,
    // `rankedKind` selects the ladder, and p1Rating/p2Rating are each
    // fighter's pre-match Elo read from their SAVE at create time (not from
    // the client body). claim-rewards uses these + the server-verified
    // winner to compute and credit the rating change, so the client can no
    // longer fake the delta. Absent on casual / clan-war / tournament fights.
    ranked?: boolean;
    rankedKind?: 'player' | 'pet';
    /**
     * Player-ranked v2 deliberately keeps `ranked !== true` so d76a claim
     * workers are economically inert during the staged rollout. Only upgraded
     * workers recognize this exact authority version and the bound gate proof.
     */
    playerRankedAuthorityVersion?: 2;
    p1Rating?: number;
    p2Rating?: number;
    rankedMatchId?: string;
    rankedSeasonId?: number;
    rankedSeasonEpoch?: number;
    // Server-authoritative base PvP-win reward (audit #7 / Stage 3 Phase 3).
    // `baseRewards` opts this session into server crediting of the winner's base
    // ryo + XP (via the ported gainXp) on claim-rewards; `rewardSector` is the
    // battle's sector, used ONLY for the Death's Gate (99) 2× bonus — everything
    // else is read from the winner's full save under the claim lock. Absent on
    // pre-Phase-3 / non-opted sessions, which keep the NX-only casual path.
    baseRewards?: boolean;
    rewardSector?: number;
    // Response-only (see PvpRejection) — present on a /api/pvp/move reply when the
    // submitted action was rejected. NEVER written to KV; stripped implicitly
    // because rejects don't persist the session.
    rejected?: PvpRejection;
    // Cosmetic floating-number events for the LAST resolved action / DoT tick:
    // the TRUE per-hit damage/heal per fighter (the same values written to the
    // combat log), NOT a client-side HP delta. `fxSeq` is a monotonic counter
    // bumped whenever a new fx batch is set, so a client renders each batch
    // exactly once regardless of poll cadence (and overkill / multi-hit reads the
    // real number instead of the post-clamp remainder). Display-only — combat
    // never reads these back.
    fx?: HitFxTarget[];
    fxSeq?: number;
    // Optional visual-only action effects for the LAST resolved action / DoT tick.
    // Kept separate from numeric fx so existing floating-number events stay stable.
    vfx?: CombatVfxTarget[];
    vfxSeq?: number;
    /** Season close exact-CAS fence. Active moves derived before it must lose. */
    rankedCloseFence?: {
        version: 'player-ranked-session-close-fence-v1';
        matchId: string;
        seasonId: number;
        seasonEpoch: number;
        transitionId: string;
        fencedAt: number;
    };
};

export const PLAYER_RANKED_SESSION_AUTHORITY_VERSION = 2 as const;

export const INITIAL_PVP_STATE_REVISION = 1 as const;

/** Advance a persisted session projection without trusting client input. */
export function nextPvpStateRevision(session: Pick<PvpSession, 'stateRevision'>): number {
    const current = session.stateRevision ?? 0;
    if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
        throw new Error('pvp-session-revision-invalid');
    }
    return current + 1;
}

export function isPlayerRankedV2Session(session: Pick<
    PvpSession,
    'ranked' | 'rankedKind' | 'playerRankedAuthorityVersion' | 'rankedMatchId'
    | 'rankedSeasonId' | 'rankedSeasonEpoch' | 'rewardAuthority' | 'baseRewards'
>): boolean {
    return session.playerRankedAuthorityVersion === PLAYER_RANKED_SESSION_AUTHORITY_VERSION
        && session.ranked !== true
        && session.rankedKind === 'player'
        && typeof session.rankedMatchId === 'string'
        && Number.isSafeInteger(session.rankedSeasonId)
        && Number(session.rankedSeasonId) > 0
        && Number.isSafeInteger(session.rankedSeasonEpoch)
        && Number(session.rankedSeasonEpoch) > 0
        && session.rewardAuthority === 'ranked'
        && session.baseRewards !== true;
}

/** A close-fenced active row is terminal no-contest control data for readers. */
export function pvpSessionHasRankedCloseFence(value: unknown): value is PvpSession {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const session = value as Partial<PvpSession>;
    const fence = session.rankedCloseFence;
    if (!fence || typeof fence !== 'object') return false;
    return session.status === 'active'
        && typeof session.battleId === 'string'
        && isPlayerRankedV2Session(session as PvpSession)
        && fence.version === 'player-ranked-session-close-fence-v1'
        && fence.matchId === session.rankedMatchId
        && fence.seasonId === session.rankedSeasonId
        && fence.seasonEpoch === session.rankedSeasonEpoch
        && typeof fence.transitionId === 'string'
        && fence.transitionId.length > 0
        && Number.isSafeInteger(fence.fencedAt)
        && fence.fencedAt > 0;
}

/** New authority plus legacy in-flight v1 rows that upgraded workers must drain. */
export function isAuthoritativePlayerRankedSession(session: PvpSession): boolean {
    return isPlayerRankedV2Session(session)
        || (session.ranked === true && session.rankedKind === 'player');
}

export function playerRankedSessionMatchesAdmission(
    session: PvpSession,
    admission: PlayerRankedAdmission,
): boolean {
    const p1 = safeName(session.p1?.name ?? '');
    const p2 = safeName(session.p2?.name ?? '');
    const pair = [p1, p2].sort();
    const p1Rating = p1 === admission.a ? admission.aRating : admission.bRating;
    const p2Rating = p2 === admission.a ? admission.aRating : admission.bRating;
    return session.battleId === admission.battleId
        && isPlayerRankedV2Session(session)
        && session.rankedMatchId === admission.matchId
        && session.rankedSeasonId === admission.seasonId
        && session.rankedSeasonEpoch === admission.seasonEpoch
        && pair[0] === admission.a
        && pair[1] === admission.b
        && session.p1Rating === p1Rating
        && session.p2Rating === p2Rating;
}

function pvpSessionMatchesCreateRetry(existing: unknown, desired: PvpSession): existing is PvpSession {
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return false;
    const row = existing as Partial<PvpSession>;
    return row.battleId === desired.battleId
        && row.createdAt === desired.createdAt
        && row.createRequestFingerprint === desired.createRequestFingerprint
        && safeName(String(row.p1?.name ?? '')) === safeName(desired.p1.name)
        && safeName(String(row.p2?.name ?? '')) === safeName(desired.p2.name)
        && row.challengeId === desired.challengeId
        && row.clanWarId === desired.clanWarId
        && row.clanWarChallengeId === desired.clanWarChallengeId
        && row.rankedMatchId === desired.rankedMatchId
        && row.rankedKind === desired.rankedKind
        && row.rewardAuthority === desired.rewardAuthority
        && row.rewardSector === desired.rewardSector
        && isDeepStrictEqual(row.worldAttacker, desired.worldAttacker)
        && (row.status === 'active' || row.status === 'done');
}

async function quarantineUnconfirmedPlayerRankedSession(
    admission: PlayerRankedAdmission,
): Promise<void> {
    if (!admission.battleId) throw new Error('player-ranked-quarantine-battle-missing');
    const key = `pvp:${admission.battleId}`;
    const tombstone = makePlayerRankedSessionOrphanTombstone(admission, Date.now());
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const current = await kv.get<unknown>(key);
        if (playerRankedOrphanTombstoneMatchesAdmission(current, admission)) return;
        if (current !== null
            && (!current || typeof current !== 'object' || Array.isArray(current)
                || !playerRankedSessionMatchesAdmission(current as PvpSession, admission))) {
            // Another exact close/cancellation capability already blocks this
            // battle id. Never overwrite a foreign row merely to improve the
            // response path.
            throw new Error('player-ranked-quarantine-authority-conflict');
        }
        try {
            if (await kv.compareSet(key, current, tombstone, {
                ex: PLAYER_RANKED_ORPHAN_TOMBSTONE_TTL_SECONDS,
            })) return;
        } catch (error) {
            const recovered = await kv.get<unknown>(key).catch(() => null);
            if (playerRankedOrphanTombstoneMatchesAdmission(recovered, admission)
                && isDeepStrictEqual(recovered, tombstone)) return;
            throw error;
        }
    }
    throw new Error('player-ranked-quarantine-busy');
}

async function rollbackExactUnownedPvpSession(expected: PvpSession): Promise<void> {
    const key = `pvp:${expected.battleId}`;
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const current = await kv.get<unknown>(key);
        if (current === null) return;
        if (!isDeepStrictEqual(current, expected)) {
            throw new Error('pvp-session-publication-rollback-conflict');
        }
        try {
            if (await kv.delIfEqual(key, current)) return;
        } catch (error) {
            const recovered = await kv.get<unknown>(key);
            if (recovered === null) return;
            throw error;
        }
    }
    throw new Error('pvp-session-publication-rollback-busy');
}

export function pvpSessionMayReward(session: Pick<PvpSession, 'rewardAuthority' | 'joined'>): boolean {
    return !!session.rewardAuthority && session.joined?.p1 === true && session.joined?.p2 === true;
}

export function sealedWorldRaidAttacker(
    session: Pick<PvpSession, 'rewardAuthority' | 'worldAttacker' | 'p1' | 'p2'>,
): { side: 'p1' | 'p2'; name: string; village: string; clan: string } | null {
    if (session.rewardAuthority !== 'world') return null;
    const side = session.worldAttacker?.side;
    const name = safeName(String(session.worldAttacker?.name ?? ''));
    if ((side !== 'p1' && side !== 'p2') || !name) return null;
    const fighterName = safeName(String(side === 'p1' ? session.p1.name : session.p2.name));
    if (fighterName !== name) return null;
    const fighter = side === 'p1' ? session.p1 : session.p2;
    const sealedVillage = String(fighter.character?.village ?? '').trim();
    const sealedClan = String(fighter.character?.clan ?? '').trim();
    if (session.worldAttacker?.village !== undefined
        && String(session.worldAttacker.village).trim() !== sealedVillage) return null;
    if (session.worldAttacker?.clan !== undefined
        && String(session.worldAttacker.clan).trim() !== sealedClan) return null;
    return { side, name, village: sealedVillage, clan: sealedClan };
}

/**
 * Ordinary PvP progression needs more than a sanctioned purpose-built duel.
 * Zero-base-reward spars and Kage duels may settle their own dedicated result,
 * but cannot be reused as bounty, mission, Legacy, or generic reward receipts.
 */
export function pvpSessionMayGrantProgress(
    session: Pick<
        PvpSession,
        'rewardAuthority' | 'joined' | 'baseRewards' | 'ranked' | 'rankedKind'
        | 'progressionAuthorityVersion'
        | 'playerRankedAuthorityVersion' | 'rankedMatchId' | 'rankedSeasonId' | 'rankedSeasonEpoch'
    >,
): boolean {
    return pvpSessionMayReward(session)
        && (session.progressionAuthorityVersion === 1
            || session.baseRewards === true
            || session.ranked === true
            || isPlayerRankedV2Session(session));
}
// A single floating-number event, already mapped to a concrete fighter slot.
export type HitFxTarget = { target: 'p1' | 'p2'; amount: number; kind: 'damage' | 'heal' };
export type CombatVfxKey =
    | 'fire'
    | 'fire60'
    | 'water'
    | 'water60'
    | 'wind'
    | 'wind60'
    | 'lightning'
    | 'lightning60'
    | 'earth'
    | 'earth60'
    | 'blood'
    | 'shadow'
    | 'poison'
    | 'magma'
    | 'metal'
    | 'slash'
    | 'impact'
    | 'pierce'
    | 'heal'
    | 'shield'
    | 'reflect'
    | 'absorb'
    | 'spark'
    | 'seal'
    | 'wound'
    | 'burn'
    | 'poisonCloud'
    | 'drain'
    | 'cleanse'
    | 'buff'
    | 'debuff'
    | 'throwable'
    | 'weapon'
    | 'namedWeapon'
    | 'heavy'
    | 'ko';
export type CombatVfxTarget = {
    target: 'p1' | 'p2';
    key: CombatVfxKey;
    anchor: 'caster' | 'target' | 'tile' | 'area';
    intensity: 'minor' | 'normal' | 'heavy' | 'finisher';
    durationMs: number;
    persistent?: boolean;
    maxParticles?: number;
    tiles?: number[];
};
export const PVP_MOVE_TOKEN_HISTORY = 20;

// Shorter TTL than the 60-min ceiling — most PvP matches finish in 5-15
// minutes, so a 15-min TTL covers the live fight plus a buffer for the
// claim flow. Each move/state action via `move.ts` refreshes the TTL via
// `writeSession`, so an actively-played match never expires; only
// abandoned sessions (a tab closed mid-fight) decay. Keeps KV usage
// proportional to actual live matches instead of accumulating an hour
// of stale rows per started fight.
const SESSION_TTL = 15 * 60;
// Cap the combat log at the last N lines. Without this the log grows
// unbounded over a long fight (typical: 1-3 lines per move × 30+
// moves = 50+ KB of payload that both clients re-download every
// state poll). Recent context is what matters; historians can scroll
// the live ticker, but the wire payload stays small.
export const PVP_LOG_MAX_LINES = 60;
export function trimPvpLog(log: string[]): string[] {
    if (log.length <= PVP_LOG_MAX_LINES) return log;
    const dropped = log.length - PVP_LOG_MAX_LINES + 1;
    return [`… (${dropped} earlier lines trimmed)`, ...log.slice(-PVP_LOG_MAX_LINES + 1)];
}

// Starting positions matching arena (p1 left side, p2 right side)
const P1_START = 62;
const P2_START = 33;

// Death's Gate is the one sector whose base PvP-win reward is doubled
// (computePvpWinGains in api/_xp-engine.ts checks `rewardSector === 99`). The
// sector is unverifiable from a session-create request, so a non-admin client
// cannot self-assign it for the 2× — see the base-reward stamp in the handler.
const DEATHS_GATE_SECTOR = 99;

// ─── Server-side sanitization of client-supplied combat data ─────────────────
// Even with auth, the player can hand-edit their localStorage / save blob, so
// the server clamps everything that matters for damage calculation to safe
// defensive bounds before the session is sealed.

function clampNumber(n: unknown, min: number, max: number, fallback: number): number {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
}

// Acceptable jutsu-tag names (canonical + aliases) come from the shared tag
// contract (api/pvp/_tags.ts), which the combat resolver in api/pvp/move.ts
// also imports — so the whitelist and the handler can't drift. Tags surviving
// the whitelist are canonicalized here, so the session is sealed with canonical
// names and combat never has to re-normalize aliases.

// A jutsu can only deal damage (and thus resolve post-damage tags like Wound /
// Siphon) when it pierces, or when it has positive effect power and isn't a
// zero-damage utility cast. Mirrors isZeroDamageFortyApJutsu in move.ts.
function jutsuCanDealDamage(out: Record<string, unknown>, canonicalTagNames: string[]): boolean {
    if (canonicalTagNames.includes('Pierce')) return true;
    const ep = Number(out.effectPower) || 0;
    if (ep <= 0) return false;
    if (out.isUtility === true) return false;
    if (out.isUtility === false) return true;
    const id = String(out.id ?? '');
    if (out.ap === 40 && id !== 'basic-attack' && !id.startsWith('item-')) return false;
    return true;
}

export function sanitizeJutsuList(rawList: unknown): unknown[] {
    if (!Array.isArray(rawList)) return [];
    // v4.3 Pierce rules: enforce ap=60 on any Pierce jutsu, and only ONE Pierce per loadout.
    let piercesSeen = 0;
    return rawList
        .filter((j): j is Record<string, unknown> => !!j && typeof j === 'object')
        .map((j) => {
            const out: Record<string, unknown> = { ...j };
            // Hard caps so a tampered jutsu can't supply an instant-kill effect.
            // Max LEGIT effectPower is 50 (player bloodline jutsu, save-clamped in
            // api/save/[name].ts; built-in catalog + starters are ≤36). Ceiling 60
            // keeps headroom above the legit max while killing the old 600 value,
            // which fed resolveBaseDamage ~12× the legit ceiling (an instant kill).
            out.effectPower = clampNumber(out.effectPower, 0, 60, 0);
            if (out.ap != null) out.ap = clampNumber(out.ap, 0, 200, 40);
            if (out.cooldown != null) out.cooldown = clampNumber(out.cooldown, 0, 50, 0);
            if (out.chakraCost != null) out.chakraCost = clampNumber(out.chakraCost, 0, 1000, 0);
            if (out.staminaCost != null) out.staminaCost = clampNumber(out.staminaCost, 0, 1000, 0);
            if (out.range != null) out.range = clampNumber(out.range, 0, 30, 1);
            // Filter, canonicalize, and cap the tag list — at most 10 known tags
            // per jutsu. Names are canonicalized HERE so the session is sealed
            // with canonical tags and the combat resolver never re-normalizes.
            const rawTags = Array.isArray(out.tags) ? out.tags : [];
            let cleanTags = (rawTags as unknown[])
                .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
                .filter((t) => typeof t.name === 'string' && KNOWN_TAG_NAMES.has(String(t.name)))
                .map((t) => ({ ...t, name: canonicalTagName(String(t.name)) }))
                .slice(0, 10);
            // Dedupe by canonical name within a single cast: a jutsu carrying the
            // same tag twice (e.g. two "Increase Damage Given") would otherwise
            // apply it twice, double-stacking the soft-capped amp pool in ONE action.
            // No legit jutsu carries a duplicate tag name, so keeping the first
            // occurrence is behavior-preserving for honest loadouts.
            {
                const seenTagNames = new Set<string>();
                cleanTags = cleanTags.filter((t) => {
                    const n = String(t.name);
                    if (seenTagNames.has(n)) return false;
                    seenTagNames.add(n);
                    return true;
                });
            }
            // v4.3 Pierce: at most one Pierce per loadout; subsequent Pierces are stripped.
            // Pierce jutsu AP is forced to 60.
            const hasPierce = cleanTags.some(t => t.name === 'Pierce');
            if (hasPierce) {
                if (piercesSeen >= 1) {
                    cleanTags = cleanTags.filter(t => t.name !== 'Pierce');
                } else {
                    piercesSeen += 1;
                    out.ap = 60;
                }
            }
            // Semantic cleanup: post-damage-only tags (Wound, Siphon) can never
            // resolve on a cast that deals no damage, so strip them instead of
            // leaving a silent no-op on the loadout. A jutsu that can deal damage
            // (pierce, or positive-EP non-utility) keeps them.
            if (!jutsuCanDealDamage(out, cleanTags.map(t => String(t.name)))) {
                cleanTags = cleanTags.filter(t => !REQUIRES_DAMAGE_TAGS.has(String(t.name)));
            }
            out.tags = cleanTags;
            // Normalize away the legacy EP-100 "fixed effect" sentinel: a jutsu
            // carrying a binary control / displacement tag deals STANDARD 60-AP
            // damage, not effectPower-100 (~3200). Clamp before the value can ever
            // reach the combat formula (also fixes the AOE Move-strip path, since
            // the EP is already honest before Move is stripped). 40-AP fixed-effect
            // jutsu stay zero-damage via the utility rule regardless.
            if (jutsuHasFixedEffectPower(cleanTags) && Number(out.effectPower) > FIXED_EFFECT_STANDARD_EP) {
                out.effectPower = FIXED_EFFECT_STANDARD_EP;
            }
            // Bloodline weather affinity — keep only a valid weather token (a base
            // element, or "None" for no interaction). An invalid value is dropped
            // so weatherMultiplier falls back to the jutsu's own `element`; "None"
            // is kept so it never matches a weather element (no buff/debuff).
            if (out.weatherElement != null && !VALID_WEATHER_ELEMENTS.has(String(out.weatherElement))) {
                delete out.weatherElement;
            }
            const visualEffect = sanitizeJutsuVisualEffect(out.visualEffect, out.ap, out.target);
            if (visualEffect) out.visualEffect = visualEffect;
            else delete out.visualEffect;
            return out;
        });
}

// Acceptable bloodline weather elements: the five base elements plus the
// explicit "None" (flavor-only, no weather interaction). Mirrors the client's
// weather-element choices in the Bloodline Maker.
const VALID_WEATHER_ELEMENTS: ReadonlySet<string> = new Set([
    'Earth', 'Wind', 'Water', 'Lightning', 'Fire', 'None',
]);

// Acceptable weapon elements — must match VALID_ELEMENTS below so the weather
// multiplier in api/pvp/move.ts treats this field consistently. Unknown
// elements are dropped (no weather interaction) rather than blocking the item.
const VALID_WEAPON_ELEMENTS: ReadonlySet<string> = new Set([
    '', 'Earth', 'Wind', 'Water', 'Lightning', 'Fire', 'Yin', 'Yang',
]);

// 'both' is the only effect-target token the move handler treats specially
// (Smoke Bomb path). 'enemy' is accepted as a legacy alias of 'opponent' —
// the client GameItem type still allows "enemy" so the sanitizer must too,
// otherwise valid items would have their target field silently dropped.
// Anything outside this set is dropped so a tampered save can't activate an
// as-yet-unwritten code path by guessing future tokens.
const VALID_WEAPON_EFFECT_TARGETS: ReadonlySet<string> = new Set([
    'self', 'opponent', 'enemy', 'both',
]);

// Mirrors sanitizeJutsuList for equipped weapons / armor / consumables /
// throwables. A pvpItem is read by api/pvp/move.ts as an authoritative source
// of damage, range, AP cost, tags, and elemental affinity, so a tampered save
// could otherwise inject a 999999-EP free-cost ranged weapon or apply unknown
// tags. Clamps numerics, whitelists tag names + element, drops anything
// suspicious.
export function sanitizePvpItems(raw: unknown): unknown[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
        .map((item) => {
            const out: Record<string, unknown> = { ...item };
            // Numeric clamps — match the jutsu sanitizer's bounds so weapons
            // can't out-scale jutsus.
            if (out.weaponEp != null)          out.weaponEp = clampNumber(out.weaponEp, 0, 60, 0);
            if (out.weaponRange != null)       out.weaponRange = clampNumber(out.weaponRange, 0, 30, 1);
            // Cooldown (rounds) — enforced server-side in move.ts for thrown
            // weapons + combat items. Clamp so a tampered save can't seal a
            // negative/absurd value; 0 = no cooldown (the melee/legacy default).
            if (out.weaponCooldown != null)    out.weaponCooldown = clampNumber(out.weaponCooldown, 0, 30, 0);
            if (out.apCost != null)            out.apCost = clampNumber(out.apCost, 0, 200, 40);
            // Flat potion restore (chakra/stamina) — clamp to the same 5000 cap
            // the vitals merge uses so a tampered pvpItem can't over-restore.
            if (out.restoreChakra != null)     out.restoreChakra  = clampNumber(out.restoreChakra,  0, 5000, 0);
            if (out.restoreStamina != null)    out.restoreStamina = clampNumber(out.restoreStamina, 0, 5000, 0);
            if (out.weaponEffectValue != null) out.weaponEffectValue = clampNumber(out.weaponEffectValue, 0, 100, 0);
            // Tag list — same whitelist + cap (10) as sanitizeJutsuList.
            if (out.weaponTags != null) {
                const rawTags = Array.isArray(out.weaponTags) ? out.weaponTags : [];
                out.weaponTags = (rawTags as unknown[])
                    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
                    .filter((t) => typeof t.name === 'string' && KNOWN_TAG_NAMES.has(String(t.name)))
                    .map((t) => {
                        // Canonicalize so the weapon-built jutsu carries canonical
                        // tags into applyJutsu, same as sanitizeJutsuList.
                        const tag: Record<string, unknown> = { name: canonicalTagName(String(t.name)) };
                        if (t.percent != null) tag.percent = clampNumber(t.percent, 0, 100, 0);
                        if (t.amount  != null) tag.amount  = clampNumber(t.amount, 0, 10000, 0);
                        return tag;
                    })
                    .slice(0, 10)
                    // Same per-cast name dedup as sanitizeJutsuList: a weapon can't
                    // carry the same amp tag twice and double-stack it in one hit.
                    .filter((() => {
                        const seen = new Set<string>();
                        return (tag: Record<string, unknown>) => {
                            const n = String(tag.name);
                            if (seen.has(n)) return false;
                            seen.add(n);
                            return true;
                        };
                    })());
            }
            // weaponEffect / weaponElement / weaponEffectTarget — drop if not
            // in their respective whitelists rather than blocking the whole
            // item, so a single bad field doesn't disarm the player. The effect
            // is canonicalized (it becomes a jutsu tag in move.ts).
            if (out.weaponEffect != null) {
                if (KNOWN_TAG_NAMES.has(String(out.weaponEffect))) {
                    out.weaponEffect = canonicalTagName(String(out.weaponEffect));
                } else {
                    delete out.weaponEffect;
                }
            }
            if (out.weaponElement != null && !VALID_WEAPON_ELEMENTS.has(String(out.weaponElement))) {
                delete out.weaponElement;
            }
            if (out.weaponEffectTarget != null && !VALID_WEAPON_EFFECT_TARGETS.has(String(out.weaponEffectTarget))) {
                delete out.weaponEffectTarget;
            }
            // String identity fields — equippedPvpItem matches on item.id and
            // item.name, so non-string values would break the lookup.
            if (out.id   != null && typeof out.id   !== 'string') delete out.id;
            if (out.name != null && typeof out.name !== 'string') delete out.name;
            if (out.slot != null && typeof out.slot !== 'string') delete out.slot;
            return out;
        });
}

// Validate the jutsu-mastery list shape before it's sealed. move.ts reads
// `character.jutsuMastery` for EP / Drain scaling; a non-array value (tampered
// KV row or NPC payload) would crash the move handler's `.find(...)` → 500 on
// every move. Levels are clamped to [0,50] here (and again at use in move.ts);
// entries without a string jutsuId are dropped. Only {jutsuId, level} survive —
// the session is a combat snapshot and never writes mastery back to the save.
function sanitizeMastery(raw: unknown): Array<{ jutsuId: string; level: number }> {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
        .filter((m) => typeof m.jutsuId === 'string')
        .map((m) => ({ jutsuId: String(m.jutsuId), level: clampNumber(m.level, 0, 50, 0) }))
        .slice(0, 1000);
}

// Fields STRIPPED from the character before it's sealed into the PvP
// session record. The session is then exposed via /api/pvp/session GET
// + /api/pvp/stream (both unauthenticated for spectator/EventSource
// compatibility), so anything not strictly needed for combat resolution
// is a leak surface. Combat needs: stats, jutsu, pvpItems, equipment,
// bloodlines/armor multipliers, specialty, name/level/village/avatar.
// It does NOT need: ryo / bankRyo / honorSeals / fateShards / boneCharms
// / mythicSeals / auraStones / auraDust, inventory, daily ledgers,
// mission journals, achievement state, creator content.
const SESSION_STRIP_CHAR_FIELDS = new Set<string>([
    // Currencies
    'ryo', 'bankRyo', 'honorSeals', 'fateShards', 'boneCharms',
    'auraStones', 'mythicSeals', 'auraDust',
    // Non-combat inventory (pvpItems and equipment ARE used by combat)
    'inventory', 'itemStacks', 'tileCards', 'savedTileDeck',
    // Daily / weekly ledgers
    'dailyAiKills', 'dailyPetWins', 'dailyTilesExplored', 'dailyMissionsCompleted',
    'dailyFateSpins', 'lastDailyReset',
    'dailyHonorSealsEarned', 'dailyHonorSealsByTarget', 'vanguardDailyResetDate',
    'lastExpeditionClaimDate', 'expeditionsClaimedToday',
    'dailyDonatedSeals', 'dailyDonationDate',
    'claimedVillageAgendaDate', 'claimedMapControlDate',
    // Mission / quest journals
    'missions', 'missionLog', 'completedMissions', 'activeMissions',
    'questLog', 'bankLog',
    'totalMissionsCompleted', 'totalStatsTrained',
    // Lifetime counters (not needed mid-fight; UI reads them from save endpoint)
    'totalPvpKills', 'monthlyPvpKills', 'pvpKillMonth',
    'totalAiKills', 'totalVillageRaids',
    'totalPetWins', 'totalEndlessTowerWins', 'totalTilesExplored',
    'totalTournamentsCompleted', 'warsWon', 'warMvpCount', 'lifetimeWarDamage',
    'unlockedAchievements', 'achievementUnlockedAt',
    // Run state for solo modes
    'hollowGateRun', 'hollowGateWardenKills', 'hollowGateIntroSeen',
    'endlessTowerRun', 'endlessTowerBestWave',
    'battleTowerBestFloor', 'battleTowerRating', 'battleTowerClearedFloors',
    'battleTowerClaimedRewards', 'battleTowerAssistRewardsClaimed', 'battleTowerMilestones',
    'weeklyBossKills', 'claimedWarCrateIds',
    'villageWarMissionDate', 'villageWarRaidProgress', 'villageWarMissionsCompleted',
    'clanBattleContrib', 'clanEventContrib', 'clanMissionContrib', 'clanContribMonth',
    'petEscortBonusReady', 'hunterRank',
    'lastBankInterestAt',
    'creatorAis', 'creatorEvents', 'creatorMissions', 'creatorRaids', 'creatorCards',
    'defeatedAiIds', 'elderFocus', 'examsPassed',
    'triggeredEvents',
    // Story-only persistence
    'storyTraits', 'storyTitle', 'storyProgress',
    // Pets are huge and not needed for a 1v1 PvP fight
    'pets', 'editablePets',
]);
// Exported so other PvP entry points that return an opponent character to the
// attacker (e.g. village-guard/challenge) can apply the SAME combat-safe
// projection instead of leaking the opponent's full private save (currencies,
// inventory, journals). Keeps stats/jutsu/equipment/bloodlines needed for the
// fight; strips everything economic / scouting-irrelevant.
export function stripNonCombatFields(character: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(character)) {
        if (SESSION_STRIP_CHAR_FIELDS.has(k)) continue;
        out[k] = v;
    }
    return out;
}

// ─── Server-authoritative loadout resolution ────────────────────────────────
// Resolve a player's equipped loadout into real jutsu objects from the SERVER's
// own catalog (built-in starters + the four built-in bloodlines) plus the jutsu
// objects the save itself carries (the player's own bloodlines + creator jutsu).
//
// This is the fix for the "defender's jutsu don't load" bug. Previously the
// server had no way to turn an `equippedJutsuIds` list into jutsu objects, so it
// trusted whatever loadout the SESSION CREATOR's client sent — which, when you
// attack someone, is only their PUBLIC projection (jutsu stripped) → an empty
// loadout, leaving the defender unable to cast anything. Now the loadout is
// rebuilt from the defender's OWN save and never depends on who created the
// session.
//
// Built-in jutsu ALWAYS use the catalog values, so a tampered save can't inflate
// a starter's effectPower/tags past the real numbers. Player-owned bloodline +
// creator jutsu come from the save; the client body is only a last-resort
// supplement for a jutsu the save somehow lacks (no worse than the old
// fully-client path, and still run through sanitizeJutsuList below).
//
// ADMIN-AUTHORED jutsu are the case the save cannot cover at all: `creatorJutsus`
// is a SERVER_LEDGER_TOPLEVEL_FIELD (api/save/[name].ts), so a regular player's
// record NEVER carries them — they live only on save:admin1/admin2. Without the
// authored catalog the authoritative branch always missed them and the loadout
// fell back to the CLIENT body (e.g. "Overload" / starter-universal-blitz); on the
// seal paths, which pass no client body, it was dropped outright. This is the jutsu
// twin of `adminItems` in resolveEquippedPvpItems below.
//
// DELIBERATE: authored jutsu still lose to JUTSU_CATALOG on a BUILT-IN id — the
// same precedence buildItemLookup gives ITEM_CATALOG. Do NOT flip it. hydrateImages
// (App.tsx) seeds full copies of starter jutsu into creatorJutsus just to carry
// their images and an admin autosave persists them to save:admin1, so that array
// holds snapshots of built-ins frozen at whatever the client bundle held when they
// were seeded; letting them win would silently revert later balance changes.
// Rebalance a built-in in shinobij.client/src/data/jutsu.ts and REGENERATE
// api/pvp/_jutsu-catalog.ts.
function jutsuObjectsById(target: Map<string, Record<string, unknown>>, arr: unknown): void {
    if (!Array.isArray(arr)) return;
    for (const j of arr) {
        if (j && typeof j === 'object' && typeof (j as Record<string, unknown>).id === 'string') {
            target.set(String((j as Record<string, unknown>).id), j as Record<string, unknown>);
        }
    }
}
export function resolveEquippedLoadout(
    saveCharacter: Record<string, unknown>,
    save: Record<string, unknown> | null,
    clientCharacter: Record<string, unknown>,
    admin: AdminCombatContent | null = null,
): unknown[] | null {
    const rawIds = saveCharacter.equippedJutsuIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) return null;
    const uniqueIds = [...new Set(rawIds.filter((id): id is string => typeof id === 'string'))];
    // A save can temporarily retain 15 persisted slot preferences after a
    // supporter lapse. Seal only the active 12/15 entitlement into combat;
    // never truncate the stored preference itself, so reactivation is lossless.
    // Save-less NPC callers keep their server-authored list unchanged.
    const equippedIds = save ? uniqueIds.slice(0, maxLoadout(saveCharacter)) : uniqueIds;
    if (equippedIds.length === 0) return null;
    // Non-catalog sources, lowest priority first so later sources overwrite:
    //   client body (weakest) → admin-authored jutsu → save's bloodlines + creator
    //   jutsu (authoritative).
    const extra = new Map<string, Record<string, unknown>>();
    jutsuObjectsById(extra, clientCharacter.jutsu);
    if (admin?.jutsu) {
        for (const [id, jutsu] of admin.jutsu) {
            if (jutsu && typeof jutsu === 'object') extra.set(id, jutsu);
        }
    }
    if (save) {
        const bloodlines = save.savedBloodlines;
        if (Array.isArray(bloodlines)) {
            // Only CARRIED bloodlines contribute jutsu definitions: the starter
            // (character.bloodline, legacy alias remapped) and the currently
            // equipped one — the same set the client's getCharacterBloodlines
            // grants access from. A save can hold up to 5 forged bloodlines;
            // folding them ALL in let a player field every kit at once while
            // only one paid the multiplier.
            const starterName = saveCharacter.bloodline === 'Blue Blade Eyes' ? 'Ashen Eyes' : String(saveCharacter.bloodline ?? '');
            const starterId = BUILTIN_BLOODLINES.find((b) => b.name === starterName)?.id;
            const equippedBloodlineId = typeof saveCharacter.equippedBloodlineId === 'string' ? saveCharacter.equippedBloodlineId : '';
            // Stamp each bloodline's rank onto its jutsu so combat reads the correct
            // per-rank Wound/amp caps (move.ts woundCapForJutsu / ampTagCapForRank).
            // The rank lives on the bloodline OBJECT, not the per-jutsu objects, and
            // is taken from the AUTHORITATIVE save (the client body is never trusted).
            // Without this, A/S bloodline jutsu fall through to the BASIC caps
            // (Wound 25 / amp 30) instead of their rank's (A 30/35, S 35/40).
            // The old BLOODLINE_RANK_CAPS rollout flag is RETIRED — the stamp is
            // always on (api/pvp/_rank-caps.test.ts pins this with the env var
            // cleared). The always-on save entitlement plus the paid, one-use
            // /bloodlines/forge path prevents forged ranks from claiming higher
            // caps than the player legitimately earned.
            const stampRank = true;
            for (const b of bloodlines) {
                if (!b || typeof b !== 'object') continue;
                const bl = b as Record<string, unknown>;
                const blId = typeof bl.id === 'string' ? bl.id : '';
                if (blId !== equippedBloodlineId && blId !== starterId) continue;
                const blRank = typeof bl.rank === 'string' ? bl.rank : null;
                let jutsus = bl.jutsus;
                // Defense-in-depth: enforce the bloodline point budget here too, so a
                // pre-existing over-budget save is still clamped down when it
                // loads into a fight.
                if (Array.isArray(jutsus)) {
                    jutsus = enforceBloodlineBudget(jutsus as RawJutsu[], blRank) as unknown[];
                }
                if (stampRank && Array.isArray(jutsus) && blRank) {
                    jutsuObjectsById(extra, (jutsus as unknown[]).map((j) =>
                        j && typeof j === 'object'
                            ? { ...(j as Record<string, unknown>), bloodlineRank: blRank }
                            : j,
                    ));
                } else {
                    jutsuObjectsById(extra, jutsus);
                }
            }
        }
        jutsuObjectsById(extra, save.creatorJutsus);
    }
    const resolved: unknown[] = [];
    const denied: string[] = [];
    const unresolved: string[] = [];
    for (const id of equippedIds) {
        const fromCatalog = JUTSU_CATALOG[id];
        const jutsu = fromCatalog ? { ...fromCatalog } : extra.get(id);
        // Unknown id (not built-in, not in the save's content) → dropped, but no
        // longer silently (P0-3): this is the signature of a lost/renamed jutsu
        // definition and it used to leave no trace at all.
        if (!jutsu) { unresolved.push(id); continue; }
        // Bloodline access gate (api/pvp/_bloodline-gate.ts): a bloodline-only
        // jutsu is sealed into the fight ONLY when the save actually carries the
        // granting bloodline — the client-side canEquipElementJutsu check alone
        // let a tampered save field any built-in/authored bloodline kit. Skipped
        // for save-less callers (NPC loadouts are server-authored).
        if (save && !characterMayUseJutsu(saveCharacter, save, jutsu as { id?: unknown; element?: unknown })) {
            denied.push(id);
            continue;
        }
        resolved.push(jutsu);
    }
    if (denied.length > 0) {
        console.warn(
            '[pvp-loadout] bloodline-gated jutsu dropped',
            safeLogValue(saveCharacter.name),
            safeLogValue(denied.join(',')),
        );
    }
    if (unresolved.length > 0) {
        console.warn(
            '[pvp-loadout] unresolved equipped jutsu id(s)',
            safeLogValue(saveCharacter.name),
            safeLogValue(unresolved.join(',')),
        );
    }
    return resolved;
}

// Resolve a fighter's equipped items (weapons / throwables / consumables / armor)
// server-side from the authoritative save — mirroring resolveEquippedLoadout for
// jutsu. The client builds pvpItems via getPvpItemLoadout (equipment ids ∩ the
// item catalog), but pvpItems is NOT persisted, so the old
// `saveCharacter.pvpItems ?? clientCharacter.pvpItems` trusted the SESSION
// CREATOR's client — a defender whose creatorItems failed to sync would fight
// WITHOUT their named weapon. Resolving from the save's own equipment +
// creatorItems (∪ the built-in ITEM_CATALOG via buildItemLookup) fixes that and
// makes weapon stats authoritative. Returns null for save-less callers (NPCs)
// so the existing client fallback still applies.
//
// `adminItems` (api/_admin-item-catalog.ts, loaded by the caller) closes the last
// hole in that resolution: an ADMIN-authored item's definition lives on the admin
// save slots, and a player's `creatorItems` is only a client-written mirror of
// them — a stale POST can erase the entry while its id stays in `equipment`, and
// under STRICT_RAW_SAVE_LEDGER=1 a new player's array never receives it at all.
// Without the admin catalog those pieces resolve to nothing and the fighter
// enters the match without their gear. (A forged `named-weapon-*` still lives
// ONLY in the player's own array — nothing else can supply it.)
function resolveEquippedPvpItems(
    saveCharacter: Record<string, unknown>,
    save: Record<string, unknown> | null,
    adminItems?: ReadonlyMap<string, Record<string, unknown>> | null,
): unknown[] | null {
    if (!save) return null;
    const equipment = saveCharacter.equipment;
    if (!equipment || typeof equipment !== 'object') return null;
    const ids = [...new Set(
        Object.values(equipment as Record<string, unknown>).filter((v): v is string => typeof v === 'string'),
    )];
    if (ids.length === 0) return null;
    const getItem = buildItemLookup(save.creatorItems, adminItems);
    // Elemental Core attunement overlay: api/weapon/apply-elemental-core.ts
    // stores the attuned element in character.weaponElements (weaponId →
    // element; server-owned — the save sanitizer forces the stored copy), but
    // catalog copies carry no weaponElement, so without this stamp the paid
    // attunement never reached server combat (move.ts / towers gate the
    // bloodline boost + weather on serverItem.weaponElement). An item whose own
    // definition already carries an authored weaponElement keeps it; the value
    // is whitelisted downstream by sanitizePvpItems (VALID_WEAPON_ELEMENTS).
    const attuned = saveCharacter.weaponElements && typeof saveCharacter.weaponElements === 'object' && !Array.isArray(saveCharacter.weaponElements)
        ? saveCharacter.weaponElements as Record<string, unknown>
        : null;
    const resolved: unknown[] = [];
    const unresolved: string[] = [];
    for (const id of ids) {
        const item = getItem(id);
        if (!item) { unresolved.push(id); continue; }
        const copy = { ...(item as Record<string, unknown>) };
        const attunedElement = attuned?.[id];
        if (copy.weaponElement == null && typeof attunedElement === 'string' && attunedElement) {
            copy.weaponElement = attunedElement;
        }
        resolved.push(copy);
    }
    // An id we can't resolve is still DROPPED (never a throw — a fight must not
    // fail to start over one piece of gear), but it no longer happens silently:
    // this is the signature of a lost item definition (erased creatorItems entry,
    // deleted admin item, or a renamed id) and it used to leave no trace at all.
    if (unresolved.length > 0) {
        console.warn(
            '[pvp-items] unresolved equipped item id(s)',
            safeLogValue(saveCharacter.name),
            safeLogValue(unresolved.join(',')),
        );
    }
    return resolved;
}

// Hydrate a fighter character from the authoritative save. The client payload
// is only used as a fallback for fields the save lacks (e.g. computed
// bloodlineMult on NPCs without a save).
//
// Exported so OTHER server-authoritative combat modes (e.g. Battle Towers' fighter
// sealing in api/towers/_seal.ts) can produce a fighter character IDENTICAL to PvP's
// — same resolved equipped loadout, mastery, armor passives, stat/vital clamps, and
// non-combat strip — instead of hand-rolling a divergent snapshot. Pure read function;
// exporting it changes zero PvP behaviour.
//
// `admin` is the admin-authored jutsu + item content (api/_admin-content.ts,
// composing the two catalogs). It is I/O, so the CALLER loads it (the
// session-create path already fans out a Promise.all) and this stays synchronous.
// Omitting it resolves exactly as before — built-ins ∪ the save's own content for
// jutsu, built-ins ∪ the player's own creatorItems for gear.
export function hydrateCharacterFromSave(saveCharacter: Record<string, unknown>, clientCharacter: Record<string, unknown>, save: Record<string, unknown> | null = null, admin: AdminCombatContent | null = null): Record<string, unknown> {
    // Start with the save (server is authority for HP, level, stats, etc.).
    const merged: Record<string, unknown> = { ...saveCharacter };
    // For derived fields the client computes, fall back to the client value
    // only when the save doesn't have a usable value. All within safe bounds.
    const pickClamped = (saveVal: unknown, clientVal: unknown, min: number, max: number, fb: number) => {
        if (saveVal != null && Number.isFinite(Number(saveVal))) return clampNumber(saveVal, min, max, fb);
        return clampNumber(clientVal, min, max, fb);
    };
    // Combat multipliers (offense/defense layer). When we have the authoritative
    // save, DERIVE them server-side from the equipped bloodline rank + equipped
    // armor/items (see api/pvp/_multipliers.ts) so a tampered client can't
    // under/over-report them for EITHER fighter — this was the one place damage
    // inputs were still client-trusted. Honest fighters get identical numbers;
    // the clamps below stay as a final ceiling. Without a save (legacy/edge
    // callers — the real PvP + Battle Towers paths always pass one; NPCs use
    // hydrateNpcCharacter) fall back to the clamped client value as before.
    const numOr = (saveVal: unknown, clientVal: unknown) =>
        saveVal != null && Number.isFinite(Number(saveVal)) ? Number(saveVal) : Number(clientVal);
    const mult = save
        ? deriveCombatMultipliers(saveCharacter, save, admin?.items ?? null)
        : {
            bloodlineMult:    numOr(saveCharacter.bloodlineMult,    clientCharacter.bloodlineMult),
            armorFactor:      numOr(saveCharacter.armorFactor,      clientCharacter.armorFactor),
            armorRawDR:       numOr(saveCharacter.armorRawDR,       clientCharacter.armorRawDR),
            itemDamagePct:    numOr(saveCharacter.itemDamagePct,    clientCharacter.itemDamagePct),
            itemAbsorbPct:    numOr(saveCharacter.itemAbsorbPct,    clientCharacter.itemAbsorbPct),
            itemReflectPct:   numOr(saveCharacter.itemReflectPct,   clientCharacter.itemReflectPct),
            itemLifeStealPct: numOr(saveCharacter.itemLifeStealPct, clientCharacter.itemLifeStealPct),
            itemShield:       numOr(saveCharacter.itemShield,       clientCharacter.itemShield),
        };
    merged.bloodlineMult = clampNumber(mult.bloodlineMult, 1.0, 3.0, 1.0);
    merged.armorFactor   = clampNumber(mult.armorFactor,   0.25, 1.0, 1.0);
    merged.armorRawDR    = clampNumber(mult.armorRawDR,    0, 1.5, 0);
    merged.itemDamagePct = clampNumber(mult.itemDamagePct, 0, 200, 0);
    // Named-armor passives. Percentage values cap at 100 (no point allowing
    // 100%+ absorb/reflect/lifesteal). Shield is flat HP — capped at 5000
    // to prevent a degenerate equipment stack from making a fighter unkillable.
    merged.itemAbsorbPct    = clampNumber(mult.itemAbsorbPct,    0, 100, 0);
    merged.itemReflectPct   = clampNumber(mult.itemReflectPct,   0, 100, 0);
    merged.itemLifeStealPct = clampNumber(mult.itemLifeStealPct, 0, 100, 0);
    merged.itemShield       = clampNumber(mult.itemShield,       0, 5000, 0);
    // Per-stat defense-in-depth clamp. Save endpoint already gates stat-gain
    // rates (api/save/[name].ts), but a tampered KV row or NPC payload could
    // still ship 999999 on a single stat. Each stat clamps to [0, MAX_STAT].
    //
    // The damage formula's getOffense/getDefense (api/pvp/move.ts) pairs each
    // school's offense vs the SAME school's defense, plus its two general
    // stats — so these all matter symmetrically:
    //   Taijutsu  → taiOff/taiDef + strength + speed
    //   Bukijutsu → bukiOff/bukiDef + intelligence + strength
    //   Genjutsu  → genOff/genDef + intelligence + willpower
    //   Ninjutsu  → ninOff/ninDef + willpower + speed
    merged.stats = clampStatsObject(saveCharacter.stats ?? clientCharacter.stats);
    // Gear specialty-stat fold (owner ruling 2026-07-31): equipped items'
    // combat-stat bonuses (a named weapon's rolled offense, armor's stat
    // grants) apply in SERVER combat exactly like the client's
    // characterCombatStats build in Arena.tsx — added on top of the clamped
    // base stats, BEFORE each engine's at-use per-rank cap, same order as the
    // client. Save-backed fighters only (NPC stats are server-authored whole).
    if (save) {
        const gearStats = deriveEquipmentStatBonuses(saveCharacter, save, admin?.items ?? null);
        const stats = merged.stats as Record<string, number>;
        for (const [field, bonus] of Object.entries(gearStats)) {
            // Keys come from the fixed EQUIPMENT_STAT_BONUS_FIELDS whitelist.
            stats[field] = clampNumber((Number(stats[field]) || 0) + bonus, 0, SESSION_MAX_STAT, 0);
        }
    }
    // Vitals defense-in-depth. A tampered save could ship a huge maxHp
    // (effectively unkillable) or maxChakra (Poison ticks scale off the victim's
    // maxChakra). Clamp to the game's hard caps — HP_CAP 10000, CHAKRA/STAMINA
    // 5000 — which no legitimate build exceeds (maxHpForLevel caps at HP_CAP).
    // NPC opponents use hydrateNpcCharacter (vitals left intact) so boss-tier HP
    // is preserved for PvP-vs-AI flows.
    merged.maxHp      = pickClamped(saveCharacter.maxHp,      clientCharacter.maxHp,      1, 10000, 100);
    // v2 raises the pool cap to CHAKRA/STAMINA_CAP_V2 (10000); legacy path stays 5000.
    merged.maxChakra  = pickClamped(saveCharacter.maxChakra,  clientCharacter.maxChakra,  0, COMBAT_RESOURCES_V2 ? CHAKRA_CAP_V2  : 5000, 50);
    merged.maxStamina = pickClamped(saveCharacter.maxStamina, clientCharacter.maxStamina, 0, COMBAT_RESOURCES_V2 ? STAMINA_CAP_V2 : 5000, 50);
    // Shape-validate the mastery list (see sanitizeMastery) — guards the move
    // handler against a non-array crash and clamps each level to [0,50].
    merged.jutsuMastery = sanitizeMastery(saveCharacter.jutsuMastery ?? clientCharacter.jutsuMastery);
    // Sanitize loadout fields (jutsu list, pvpItems) — these ARE persisted.
    // Resolve the equipped loadout server-side from the catalog + the save's own
    // content (see resolveEquippedLoadout). Falls back to the raw save/client
    // jutsu only for old saves with no equippedJutsuIds and for NPCs.
    const resolvedLoadout = resolveEquippedLoadout(saveCharacter, save, clientCharacter, admin);
    merged.jutsu = sanitizeJutsuList(resolvedLoadout ?? saveCharacter.jutsu ?? clientCharacter.jutsu);
    // ── Legacy signature slot (the dedicated 16th slot) ──────────────────────
    // A LEGACY-ONLY prestige slot. Only a Legacy's own signature jutsu can ever
    // occupy it — it is DERIVED here from the server-owned character.legacy, not
    // equipped by the player, so no regular jutsu (and no other Legacy's
    // signature) can be placed in it by any means. Written only by
    // api/legacy/sage.ts / trial.ts / admin; the save sanitizer discards client
    // legacy writes, so there is no equip field to spoof: reach Stage 3 (Bound)
    // and the signature joins the sealed loadout; lose the Legacy and it's gone.
    // Resolved from the SEPARATE legacy catalog — these ids never resolve out of
    // equippedJutsuIds, so a tampered save can't put one inside the 15 or claim
    // another Legacy's signature. Mastery is the legacy stage ×10 (3→30, 4→40,
    // 5→50): signatures deepen with the Legacy, never via the training grind.
    //
    // BALANCE (owner-documented, intentional): this is a strictly-additive 16th
    // slot on top of the 15-jutsu loadout — a Legacy player fields one more jutsu
    // than a no-Legacy player, with no offsetting loadout cost. That is accepted
    // prestige power: it is EARNED (achievement floors + a 5-stage trial arc),
    // never bought or RNG'd, so it stays inside the skill-gated-power pillar. Its
    // only in-combat cost is AP contention (it shares the 100 AP/turn) and its
    // cd 10 (vs 7 for starters) throttles cycling. See docs/legacy-launch-checklist.md.
    //
    // ORDERING: this block MUST run AFTER sanitizeMastery/sanitizeJutsuList above —
    // it appends the stage-derived mastery and the stamped signature last so they
    // are not re-clamped or dropped by the generic sanitizer. Do not move a
    // mastery cap or re-run sanitizeMastery after this point. (Guarded by
    // api/pvp/_legacy-slot.test.ts.)
    if (legacyEnabled()) {
        const lg = saveCharacter.legacy as { legacyId?: unknown; stage?: unknown } | null | undefined;
        const stage = Number(lg?.stage);
        const jutsuId = typeof lg?.legacyId === 'string' ? LEGACY_JUTSU_ID_BY_LEGACY[lg.legacyId] : undefined;
        const entry = jutsuId ? LEGACY_JUTSU_CATALOG[jutsuId] : undefined;
        if (entry && Number.isInteger(stage) && stage >= 3) {
            // Adaptive typing: non-style damage signatures store type "Any"
            // (any build can earn their Legacy) — stamp the owner's trained
            // specialty so the damage formula reads the right offense composite
            // (server getOffense has no "Any" branch and would silently scale
            // them as Ninjutsu). Mirrors the client's stampLegacyJutsuType in
            // shinobij.client/src/data/legacy-jutsu.ts — KEEP IN SYNC.
            const specialty = String(merged.specialty ?? '');
            const stamped = entry.type === 'Any' && entry.ap === 60
                ? { ...entry, type: ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'].includes(specialty) ? specialty : 'Taijutsu' }
                : { ...entry };
            const withoutDupe = (merged.jutsu as unknown[]).filter((j) => (j as { id?: unknown } | null)?.id !== entry.id);
            merged.jutsu = [...withoutDupe, ...sanitizeJutsuList([stamped])];
            // Stage-scaled mastery, overriding any stray save-side entry for the id.
            const mastery = (merged.jutsuMastery as Array<{ jutsuId: string; level: number }>).filter((m) => m.jutsuId !== entry.id);
            mastery.push({ jutsuId: entry.id, level: Math.min(50, stage * 10) });
            merged.jutsuMastery = mastery;
        }
    }
    // Resolve equipped items from the authoritative save (see resolveEquippedPvpItems);
    // fall back to the persisted/client pvpItems for save-less (NPC) callers.
    const resolvedItems = resolveEquippedPvpItems(saveCharacter, save, admin?.items ?? null);
    merged.pvpItems = sanitizePvpItems(resolvedItems ?? saveCharacter.pvpItems ?? clientCharacter.pvpItems);
    merged.jutsu = sealV2JutsuCosts(merged.jutsu, Number(merged.level) || 1, String(merged.specialty ?? ''));
    // Strip everything that isn't combat-relevant. The session is read by
    // spectators (and by the unauth /api/pvp/stream endpoint) so anything
    // sensitive (ryo, currencies, inventory, journals) would leak otherwise.
    return stripNonCombatFields(merged);
}

// MAX_STAT = 2500 (matches api/pvp/move.ts and shinobij.client/src/App.tsx).
// If this ever needs to change, update all three sites.
const SESSION_MAX_STAT = 2500;
const CLAMPED_STAT_FIELDS = [
    // Per-school offense/defense pairs — used by getOffense/getDefense in
    // api/pvp/move.ts. Each school's offense reads against the same school's
    // defense, so the cap has to be symmetric (no one stat can outrun its
    // mirror).
    'taijutsuOffense', 'taijutsuDefense',
    'bukijutsuOffense', 'bukijutsuDefense',
    'ninjutsuOffense', 'ninjutsuDefense',
    'genjutsuOffense', 'genjutsuDefense',
    // General stats — each one feeds two schools (strength → tai+buki,
    // speed → tai+nin, intelligence → buki+gen, willpower → gen+nin).
    'strength', 'speed', 'intelligence', 'willpower',
] as const;
function clampStatsObject(raw: unknown): Record<string, number> {
    const out: Record<string, number> = {};
    const src = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
    for (const key of CLAMPED_STAT_FIELDS) {
        out[key] = clampNumber(src[key], 0, SESSION_MAX_STAT, 0);
    }
    // Pass through any non-combat stat fields untouched (e.g., display-only
    // labels). Only the formula-facing stats above are clamped.
    for (const [k, v] of Object.entries(src)) {
        if (CLAMPED_STAT_FIELDS.includes(k as typeof CLAMPED_STAT_FIELDS[number])) continue;
        if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v as number;
    }
    return out;
}

// For NPC opponents (no save key in KV), we still clamp the client payload
// rather than trusting it as-is — caller already restricted this path to
// arena PvP-vs-AI flows that don't persist.
function hydrateNpcCharacter(clientCharacter: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...clientCharacter };
    out.bloodlineMult = clampNumber(out.bloodlineMult, 1.0, 3.0, 1.0);
    out.armorFactor = clampNumber(out.armorFactor, 0.25, 1.0, 1.0);
    out.armorRawDR = clampNumber(out.armorRawDR, 0, 1.5, 0);
    out.itemDamagePct    = clampNumber(out.itemDamagePct,    0, 200, 0);
    out.itemAbsorbPct    = clampNumber(out.itemAbsorbPct,    0, 100, 0);
    out.itemReflectPct   = clampNumber(out.itemReflectPct,   0, 100, 0);
    out.itemLifeStealPct = clampNumber(out.itemLifeStealPct, 0, 100, 0);
    out.itemShield       = clampNumber(out.itemShield,       0, 5000, 0);
    out.stats = clampStatsObject(out.stats);
    // Shape-validate mastery (NPC payloads are client-supplied) so a malformed
    // value can't crash the move handler. NPC vitals are left intact on purpose
    // (boss-tier HP is legitimate for PvP-vs-AI).
    out.jutsuMastery = sanitizeMastery(out.jutsuMastery);
    out.jutsu = sanitizeJutsuList(out.jutsu);
    out.jutsu = sealV2JutsuCosts(out.jutsu, Number(out.level) || 1, String(out.specialty ?? ''));
    out.pvpItems = sanitizePvpItems(out.pvpItems);
    // Same strip as real characters — NPCs can have arbitrary client-
    // supplied fields and we don't want any of the sensitive ones to land
    // in the session record either.
    return stripNonCombatFields(out);
}

// How many of an item id a save character owns across both stores (counted
// itemStacks + legacy inventory[] copies). Mirrors the client lib/inventory
// countItem so the sealed PvP consumable budget matches what the player holds.
export function ownedItemCount(char: Record<string, unknown> | null | undefined, id: string): number {
    if (!char) return 0;
    let n = 0;
    const stacks = char.itemStacks;
    if (Array.isArray(stacks)) {
        for (const s of stacks as Array<Record<string, unknown>>) {
            if (s && s.itemId === id) n += Math.max(0, Math.floor(Number(s.count) || 0));
        }
    }
    const inv = char.inventory;
    if (Array.isArray(inv)) n += (inv as unknown[]).filter((x) => x === id).length;
    return n;
}

// Per-fight consumable cap for the Rejuvenation Potion (and any "potion" slot).
const POTION_USES_PER_BATTLE = 2;

// Seal the per-fight consumable budget from a fighter's equipped throwables,
// combat items, and potion. `equipChar` supplies the equipment slot→id map
// (equipment survives stripNonCombatFields); `invChar` is the RAW save (its
// inventory/itemStacks are stripped off the fighter snapshot, so owned counts
// must come from the save). For NPCs (no save) only the potion is sealed — at
// the cap — so the AI can't infinitely chug it; its other consumables stay
// unsealed (unlimited), preserving prior AI behaviour.
export function sealItemCharges(
    equipChar: Record<string, unknown>,
    invChar: Record<string, unknown> | null,
): Record<string, number> {
    const charges: Record<string, number> = {};
    const equip = (equipChar.equipment ?? {}) as Record<string, unknown>;
    // The three combat-item slots (item1/2/3) each hold one of Attack/Defense
    // Pill or Smoke Bomb; legacy 'item' covers a not-yet-migrated single-item
    // save. Throwable + combat items seal at the owned count; the potion is
    // capped per battle (handled below).
    for (const slot of ['thrown', 'item1', 'item2', 'item3', 'item', 'potion'] as const) {
        const id = equip[slot];
        if (typeof id !== 'string' || !id) continue;
        if (slot === 'potion') {
            const owned = invChar ? ownedItemCount(invChar, id) : POTION_USES_PER_BATTLE;
            charges[id] = Math.min(owned, POTION_USES_PER_BATTLE);
        } else if (invChar) {
            charges[id] = ownedItemCount(invChar, id);
        }
    }
    return charges;
}

/** Preserve every legacy-recognized tracked id while pinning its spend to 0. */
export function zeroItemCharges(charges: Record<string, number>): Record<string, number> {
    return Object.fromEntries(Object.keys(charges).sort().map((id) => [id, 0] as const));
}

export function zeroPlayerRankedItemCharges(
    fighterCharacter: Record<string, unknown>,
    sealed: Record<string, number>,
): Record<string, number> {
    const ids = new Set(Object.keys(sealed));
    const equipment = fighterCharacter.equipment
        && typeof fighterCharacter.equipment === 'object'
        && !Array.isArray(fighterCharacter.equipment)
        ? fighterCharacter.equipment as Record<string, unknown>
        : {};
    const equippedIds = new Set(Object.values(equipment).filter((id): id is string => (
        typeof id === 'string' && !!id
    )));
    const definitions = Array.isArray(fighterCharacter.pvpItems)
        ? fighterCharacter.pvpItems as Array<Record<string, unknown>>
        : [];
    for (const item of definitions) {
        const id = typeof item.id === 'string' ? item.id : '';
        // A residual legacy worker accepts every non-hand/non-thrown definition
        // through its generic item action. Zero every authoritative equipped
        // definition id; hand ids are harmless because that path never spends.
        if (id && equippedIds.has(id)) ids.add(id);
    }
    return Object.fromEntries([...ids].sort().map((id) => [id, 0] as const));
}

function makeFighter(char: Record<string, unknown>, pos: number, useCurrentVitals: boolean): PvpFighter {
    const maxHp = Number((char.maxHp as number) ?? 100);
    const maxChakra = Number((char.maxChakra as number) ?? 50);
    const maxStamina = Number((char.maxStamina as number) ?? 50);
    // Named-armor "Shield" passive: starting flat shield, already clamped
    // to [0, 5000] during character merge.
    const startingShield = Math.max(0, Math.min(5000, Number((char.itemShield as number) ?? 0)));
    // Spar / ranked PvP fights are fresh-start contests — full HP/chakra/
    // stamina. Sector attacks and the village defense/attack system are
    // continuous engagements where the fighter brings whatever vitals they
    // currently have (so a damaged player who keeps raiding stays damaged).
    // useCurrentVitals=true preserves char.hp/chakra/stamina; false resets.
    const startHp      = useCurrentVitals ? Math.min(Number((char.hp      as number) ?? maxHp),      maxHp)      : maxHp;
    const startChakra  = useCurrentVitals ? Math.min(Number((char.chakra  as number) ?? maxChakra),  maxChakra)  : maxChakra;
    const startStamina = useCurrentVitals ? Math.min(Number((char.stamina as number) ?? maxStamina), maxStamina) : maxStamina;
    return {
        name: (char.name as string) ?? 'Unknown',
        hp: startHp,
        maxHp,
        chakra: startChakra,
        maxChakra,
        stamina: startStamina,
        maxStamina,
        shield: startingShield,
        statuses: [],
        character: char,
        pos,
    };
}

const VALID_BIOMES = new Set(['forest', 'snow', 'volcano', 'shadow', 'central']);
const VALID_ELEMENTS = new Set(['', 'Earth', 'Wind', 'Water', 'Lightning', 'Fire', 'Yin', 'Yang']);
function normalizeBiome(b: unknown): string {
    if (typeof b === 'string' && VALID_BIOMES.has(b)) return b;
    return 'central';
}
function normalizeElement(e: unknown): string {
    if (typeof e === 'string' && VALID_ELEMENTS.has(e)) return e;
    return '';
}

// Map a captured sector's leader-chosen offense stat (territory.terrainBuffStat)
// to the jutsu TYPE that earns the +10% home-terrain buff. Returns '' for an
// unknown/empty stat. KEEP IN SYNC with the client (Arena.tsx buffByType) and
// the applier in api/pvp/move.ts homeTerrainMultiplier.
function terrainBuffStatToJutsuType(stat: unknown): string {
    switch (stat) {
        case 'bukijutsuOffense': return 'Bukijutsu';
        case 'taijutsuOffense':  return 'Taijutsu';
        case 'ninjutsuOffense':  return 'Ninjutsu';
        case 'genjutsuOffense':  return 'Genjutsu';
        default:                 return '';
    }
}

// ── Town Defense guard mitigation (server-authoritative) ─────────────────────
// A Village Guard's "Town Defense" upgrade is meant to reduce the damage they
// take "while defending through the Village Guard queue". The AI-fallback path
// already folds it into the chosen AI's effective level client-side, but a
// REAL-player guard duel previously dropped it entirely. We recompute it here
// from the guard's OWN save (never the client body or the client-stamped queue
// entry) and seal it onto the defender so api/pvp/move.ts can apply it as a
// small, capped damage reduction. Mirrors getTownDefenseGuardBonus in the
// client's lib/village-upgrades.ts: townDefense level × 0.1% per level, capped
// at the upgrade max (50 levels → 5%).
const TOWN_DEFENSE_PER_LEVEL = 0.1;
const TOWN_DEFENSE_MAX_LEVEL = 50;
const GUARD_DEFENSE_MAX_PCT = TOWN_DEFENSE_PER_LEVEL * TOWN_DEFENSE_MAX_LEVEL; // 5
function townDefensePctFromSave(saveCharacter: Record<string, unknown> | null | undefined): number {
    const upgrades = (saveCharacter?.villageUpgrades ?? null) as Record<string, unknown> | null;
    const level = Math.floor(clampNumber(upgrades?.townDefense, 0, TOWN_DEFENSE_MAX_LEVEL, 0));
    return Math.max(0, Math.min(GUARD_DEFENSE_MAX_PCT, level * TOWN_DEFENSE_PER_LEVEL));
}

export function pvpSessionCreationAllowedDuringSettlement(isAdmin: boolean): boolean {
    void isAdmin;
    return true;
}

// Decide a session's sealed base-reward stamp (extracted from the handler so the
// security decision is unit-testable). Closes two client-trusted holes:
//   • baseRewards is honored ONLY when both fighters have authoritative saves
//     (real players), or the creator is admin — a fabricated no-save NPC
//     opponent cannot opt a session into base rewards.
//   • The Death's Gate (sector 99) 2× multiplier is NOT taken from the client
//     body. A claimed 99 is honored only when `deathsGateVerified` — the server
//     confirmed from presence that BOTH fighters are actually at sector 99 (see
//     the handler). An attacker controls only their OWN presence, so the
//     opponent being at 99 (which the attacker cannot fake) is what gates the
//     bonus, so it applies only to a genuine Death's Gate fight. Unverified 99
//     is neutralized to 0. Admins keep the raw value for test flows.
// `denied` marks the "requested, but opponent has no save" case so the handler
// logs it (fail-closed, not silent) instead of quietly dropping the reward.
export function sealBaseRewardStamp(opts: {
    baseRewards: boolean;
    rewardSector: unknown;
    isAdmin: boolean;
    p1HasSave: boolean;
    p2HasSave: boolean;
    deathsGateVerified: boolean;
}): { stamp: Pick<PvpSession, 'baseRewards' | 'rewardSector'>; denied: boolean } {
    if (!opts.baseRewards) return { stamp: {}, denied: false };
    const bothRealPlayers = opts.p1HasSave && opts.p2HasSave;
    if (!opts.isAdmin && !bothRealPlayers) return { stamp: {}, denied: true };
    const s = Number(opts.rewardSector);
    const rawSector = Number.isFinite(s) ? Math.floor(s) : 0;
    let sealedSector = rawSector;
    if (rawSector === DEATHS_GATE_SECTOR && !opts.isAdmin && !opts.deathsGateVerified) {
        // Client claimed Death's Gate but the server could not confirm both
        // fighters are there → drop the 2× (0 reads as "no sector bonus").
        sealedSector = 0;
    }
    return { stamp: { baseRewards: true, rewardSector: sealedSector }, denied: false };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        // Poll endpoint — clients hit this every ~1s while the battle screen
        // is open. Generous budget per IP so two players + spectators can
        // share an IP, but block obvious abuse (≥10 polls/sec sustained).
        if (!(await enforceRateLimitKv(req, res, 'pvp-session-get', 360, 60_000))) return;
        if (String(req.query.pending ?? '') === '1') {
            const identity = await authedPlayerOrAdmin(req);
            if (!identity) return res.status(401).json({ error: 'Authentication required.' });
            const requestedPlayer = safeName(String(
                req.query.playerName ?? (identity.admin ? '' : identity.name),
            ));
            if (!requestedPlayer) return res.status(400).json({ error: 'Missing playerName.' });
            if (!identity.admin && identity.name !== requestedPlayer) {
                return res.status(403).json({ error: 'Can only restore your own PvP session.' });
            }
            res.setHeader('Cache-Control', 'no-store');
            try {
                const pointer = await loadPvpPendingSessionPointer(kv, requestedPlayer);
                if (!pointer) return res.status(404).json({ error: 'No pending PvP session.' });
                const liveRaw = await kv.get<unknown>(`pvp:${pointer.battleId}`);
                if (parsePlayerRankedSessionCloseTombstone(liveRaw)?.battleId === pointer.battleId
                    || parsePlayerRankedSessionOrphanTombstone(liveRaw)?.battleId === pointer.battleId
                    || pvpSessionHasRankedCloseFence(liveRaw)) {
                    await clearPvpPendingSessionPointer(kv, requestedPlayer, pointer.battleId, pointer.createdAt, pointer.role);
                    return res.status(409).json({ error: 'This ranked match ended as a no-contest.' });
                }
                let session = liveRaw as PvpSession | null;
                if (!session) session = await loadPvpRewardRecoverySnapshot(kv, pointer.battleId);
                if (!session && pvpPendingReservationIsFresh(pointer)) {
                    return res.status(503).json({ error: 'PvP session publication is still finalizing.' });
                }
                if (!session || !pendingPointerMatchesSession(pointer, session)) {
                    await clearPvpPendingSessionPointer(kv, requestedPlayer, pointer.battleId, pointer.createdAt, pointer.role);
                    return res.status(404).json({ error: 'Pending PvP session expired.' });
                }
                if (session.status === 'done') {
                    if (liveRaw) session = await ensurePvpTerminalRecoveryPublication(
                        kv,
                        pointer.battleId,
                        session,
                    );
                    if (!session.winner) {
                        await clearPvpPendingSessionPointer(kv, requestedPlayer, pointer.battleId, pointer.createdAt, pointer.role);
                        return res.status(404).json({ error: 'PvP session has no pending completion.' });
                    }
                    const outcome = session.winner === 'draw'
                        ? 'draw'
                        : session.winner === pointer.role ? 'win' : 'loss';
                    const receipt = await kv.get<unknown>(`pvp:rewarded:${requestedPlayer}:${pointer.battleId}`);
                    const completion = pvpRewardCompletionStatus(receipt);
                    if (completion === 'invalid') {
                        return res.status(503).json({ error: 'PvP completion receipt is unavailable.' });
                    }
                    if (completion === 'completed') {
                        await clearPvpPendingSessionPointer(kv, requestedPlayer, pointer.battleId, pointer.createdAt, pointer.role);
                        return res.status(404).json({ error: 'PvP completion already confirmed.' });
                    }
                    return res.status(200).json({
                        battleId: pointer.battleId,
                        role: pointer.role,
                        outcome,
                        session,
                    });
                }
                return res.status(200).json({
                    battleId: pointer.battleId,
                    role: pointer.role,
                    session,
                });
            } catch (error) {
                console.error('[pvp/session] pending recovery failed', error);
                return res.status(503).json({ error: 'Pending PvP recovery is temporarily unavailable.' });
            }
        }
        const battleId = String(req.query.id ?? '');
        if (!battleId) return res.status(400).json({ error: 'Missing id' });
        // Absence and close-fence responses participate in mount-time
        // reconciliation too. Never let a CDN/browser cache the first 404 and
        // hide a session that finishes publishing during the bounded retry.
        res.setHeader('Cache-Control', 'no-store');
        const sessionRaw = await kv.get<unknown>(`pvp:${battleId}`);
        if (!sessionRaw) return res.status(404).json({ error: 'Session not found' });
        if (parsePlayerRankedSessionCloseTombstone(sessionRaw)?.battleId === battleId
            || parsePlayerRankedSessionOrphanTombstone(sessionRaw)?.battleId === battleId
            || pvpSessionHasRankedCloseFence(sessionRaw)) {
            return res.status(409).json({ error: 'This ranked match ended as a no-contest.' });
        }
        let session = sessionRaw as PvpSession;
        if (session.status === 'done') {
            try {
                session = await ensurePvpTerminalRecoveryPublication(kv, battleId, session);
            } catch (error) {
                console.error('[pvp/session] terminal recovery publication pending', error);
                return res.status(503).json({
                    error: 'Battle recovery publication is still finalizing. Retry this session.',
                });
            }
        }
        return res.status(200).json(session);
    }

    if (req.method === 'POST') {
        // Require a logged-in player. The creator must be one of the two
        // fighters (or admin) — otherwise anyone could fabricate a PvP session
        // with arbitrary stats (e.g. 999999 HP god mode).
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        // Cap session creation. A legit player starts a duel maybe every
        // 30s in heavy play; 6/min is comfortable headroom and stops
        // KV-fill attacks that spam-create sessions. Admins skip the cap
        // (testing scripts may legitimately create many sessions fast).
        const rlName = identity.admin ? undefined : identity.name;
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pvp-session-create', 6, 60_000, rlName))) return;
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { p1Character, p2Character, biome, weatherPositiveElement, weatherNegativeElement, battleId: clientBattleId, challengeId, clanWarId, clanWarChallengeId, useCurrentVitals, requireWorldCoLocation, ranked, rankedKind, rankedMatchId, rankedSeasonId, rankedSeasonEpoch, baseRewards, rewardSector } = body as {
                p1Character?: Record<string, unknown>;
                p2Character?: Record<string, unknown>;
                biome?: string;
                weatherPositiveElement?: string;
                weatherNegativeElement?: string;
                battleId?: string;
                challengeId?: string;
                clanWarId?: string;
                clanWarChallengeId?: string;
                // Sector attacks + village defense/attack fights are continuous
                // engagements that bring whatever HP/chakra/stamina the fighter
                // currently has. Spar / ranked / arena default to a fresh-start
                // reset (full vitals). Pass true only from sector/guard flows.
                useCurrentVitals?: boolean;
                requireWorldCoLocation?: boolean;
                // Ranked-match markers (audit #7 / Stage 3). The client asserts
                // `ranked` + which ladder; the server snapshots BOTH fighters'
                // pre-match Elo from their saves below (never trusting a
                // client-supplied rating). Casual fights omit these.
                ranked?: boolean;
                rankedKind?: 'player' | 'pet';
                rankedMatchId?: string;
                rankedSeasonId?: number;
                rankedSeasonEpoch?: number;
                // Base PvP-win reward opt-in (audit #7 / Stage 3 Phase 3). When
                // the client sends baseRewards:true the server credits the
                // winner's base ryo + XP on claim-rewards; rewardSector feeds the
                // Death's Gate (99) 2× bonus. Omitted by pre-Phase-3 clients.
                baseRewards?: boolean;
                rewardSector?: number;
            };
            if (typeof challengeId === 'string' && (typeof clanWarId === 'string' || typeof clanWarChallengeId === 'string')) {
                return res.status(400).json({ error: 'Choose either a player challenge receipt or a Clan War receipt, not both.' });
            }
            if (!p1Character || !p2Character) return res.status(400).json({ error: 'Missing characters' });

            const p1Name = (p1Character.name as string) ?? 'Player 1';
            const p2Name = (p2Character.name as string) ?? 'Player 2';

            const p1Norm = safeName(String(p1Name));
            const p2Norm = safeName(String(p2Name));
            const creatorRole: 'p1' | 'p2' | null = identity.admin
                ? null
                : identity.name === p1Norm ? 'p1' : 'p2';

            const requestedBattleId = String(clientBattleId ?? '').trim().toLowerCase();
            const stableBattleIdRequested = /^pvp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestedBattleId);
            let battleId = stableBattleIdRequested ? requestedBattleId : `pvp-${randomUUID()}`;
            const createRequestFingerprintFor = (candidateBattleId: string) => createHash('sha256').update(JSON.stringify({
                version: 1,
                battleId: candidateBattleId,
                creator: identity.admin ? 'admin' : identity.name,
                p1: p1Norm,
                p2: p2Norm,
                challengeId: typeof challengeId === 'string' ? challengeId : null,
                clanWarId: typeof clanWarId === 'string' ? clanWarId : null,
                clanWarChallengeId: typeof clanWarChallengeId === 'string' ? clanWarChallengeId : null,
                useCurrentVitals: useCurrentVitals === true,
                requireWorldCoLocation: requireWorldCoLocation === true,
                ranked: ranked === true,
                rankedKind: rankedKind ?? null,
                rankedMatchId: rankedMatchId ?? null,
                rankedSeasonId: rankedSeasonId ?? null,
                rankedSeasonEpoch: rankedSeasonEpoch ?? null,
                baseRewards: baseRewards === true,
                rewardSector: Number.isFinite(Number(rewardSector)) ? Math.floor(Number(rewardSector)) : null,
                biome: typeof biome === 'string' ? biome : null,
                weatherPositiveElement: typeof weatherPositiveElement === 'string' ? weatherPositiveElement : null,
                weatherNegativeElement: typeof weatherNegativeElement === 'string' ? weatherNegativeElement : null,
            })).digest('hex');

            if (!identity.admin) {
                const me = identity.name;
                if (me !== p1Norm && me !== p2Norm) {
                    return res.status(403).json({ error: 'Can only create sessions you are a fighter in.' });
                }
                // Reject self-duels. With p1 and p2 resolving to the SAME
                // account, a player controls both sides — letting them farm a
                // guaranteed win on the ranked / vanguard / base-reward paths
                // (and the reward settlement would read+write one save as both
                // winner and loser). Admins keep the override (test fights).
                if (p1Norm && p2Norm && p1Norm === p2Norm) {
                    return res.status(400).json({ error: 'You cannot duel yourself.' });
                }
                if (stableBattleIdRequested) {
                    const existing = await kv.get<PvpSession>(`pvp:${battleId}`);
                    if (existing) {
                        const exactRetry = existing.battleId === battleId
                            && safeName(existing.p1?.name ?? '') === p1Norm
                            && safeName(existing.p2?.name ?? '') === p2Norm
                            && existing.createRequestFingerprint === createRequestFingerprintFor(battleId)
                            && (existing.status === 'active' || existing.status === 'done');
                        if (!exactRetry) {
                            return res.status(409).json({ error: 'That stable battle capability is already bound to another session.' });
                        }
                        if (existing.status === 'done') {
                            const completion = pvpRewardCompletionStatus(await kv.get<unknown>(
                                `pvp:rewarded:${identity.name}:${battleId}`,
                            ));
                            if (completion === 'invalid') {
                                return res.status(503).json({ error: 'The completed battle receipt is malformed.' });
                            }
                            if (completion === 'completed') {
                                return res.status(200).json({
                                    battleId,
                                    session: existing,
                                    rewardAuthorized: !!existing.rewardAuthority,
                                    resumed: true,
                                    completionConfirmed: true,
                                });
                            }
                        }
                        const pointer = pendingPointerForSessionRole(existing, creatorRole!, 'active');
                        if (pointer) {
                            await publishPvpPendingSessionPointer(kv, pointer);
                            await activatePvpPendingSessionPointer(
                                kv,
                                pointer.playerName,
                                pointer.battleId,
                                pointer.createdAt,
                                pointer.createRequestFingerprint,
                            );
                        }
                        return res.status(200).json({
                            battleId,
                            session: existing,
                            rewardAuthorized: !!existing.rewardAuthority,
                            resumed: true,
                        });
                    }
                }
                if (await findTowerBattleStartConflict([p1Norm, p2Norm])) {
                    return res.status(409).json(towerBattleActiveErrorBody());
                }

                // #4: enforce the anti-grief presence gate HERE, at session
                // creation — the real gate. The client creates the session
                // BEFORE /api/player/challenge (which skips its own gate once a
                // battleId exists) or /api/player/attack, so without this a
                // player could fight a traveling / already-in-battle / engaged
                // target by pre-creating the session. Only the opponent (the
                // fighter who is NOT the creator) is gated, only when they're a
                // real ONLINE player; offline targets stay optimistic/queued.
                const opponentNorm = me === p1Norm ? p2Norm : p1Norm;
                if (opponentNorm) {
                    const opponentPresence = onlineStore.get(opponentNorm);
                    if (requireWorldCoLocation === true) {
                        const locationBlock = worldInteractionBlock(onlineStore.get(me), opponentPresence);
                        if (locationBlock) return res.status(locationBlock.status).json({ error: locationBlock.error });
                    }
                    const block = sessionOpponentBlock(opponentPresence, me);
                    if (block) return res.status(block.status).json({ error: block.error });
                }
            }

            // ── Hydrate both fighters from authoritative saves ───────────────
            // The creator only really supplies the names (and an NPC payload
            // for AI fights). We load each fighter's persisted save and pull
            // jutsu / pvpItems / armor / bloodlineMult / itemDamagePct from
            // there. The client's character body is only consulted as a
            // fallback for fighters who don't have a save record (NPCs).
            // Admins keep their override path (admin acts as anyone for tests).
            let finalP1Character: Record<string, unknown>;
            let finalP2Character: Record<string, unknown>;

            // admin: the authoritative definitions for admin-authored jutsu AND gear
            // (60s-memoized read of both admin slots). Fetched alongside the saves
            // so an equipped custom item resolves even when the fighter's own
            // creatorItems mirror is stale/empty — see resolveEquippedPvpItems.
            const [p1SaveRaw, p2SaveRaw, battleLocks, admin] = await Promise.all([
                p1Norm ? kv.get<Record<string, unknown>>(`save:${p1Norm}`) : Promise.resolve(null),
                p2Norm ? kv.get<Record<string, unknown>>(`save:${p2Norm}`) : Promise.resolve(null),
                battleLockFlagsForPlayers([p1Norm ?? '', p2Norm ?? '']),
                loadAdminCombatContent(),
            ]);
            // P0-3: graft any equipped-but-missing forged definitions back from
            // the durable registry before hydration (named-weapon drop fix).
            const p1Save = await augmentSaveWithForgedDefs(p1SaveRaw
                ? settleSaveRecord(p1SaveRaw, { battleLocked: p1Norm ? battleLocks.get(p1Norm) === true : false }).record
                : p1SaveRaw);
            const p2Save = await augmentSaveWithForgedDefs(p2SaveRaw
                ? settleSaveRecord(p2SaveRaw, { battleLocked: p2Norm ? battleLocks.get(p2Norm) === true : false }).record
                : p2SaveRaw);

            if (p1Save?.character) {
                finalP1Character = hydrateCharacterFromSave(p1Save.character as Record<string, unknown>, p1Character, p1Save, admin);
            } else if (identity.admin) {
                finalP1Character = hydrateNpcCharacter(p1Character);
            } else if (identity.name === p1Norm) {
                return res.status(400).json({ error: 'Your character save was not found on the server.' });
            } else {
                // Opponent has no save → NPC. Clamp client payload defensively.
                finalP1Character = hydrateNpcCharacter(p1Character);
            }

            if (p2Save?.character) {
                finalP2Character = hydrateCharacterFromSave(p2Save.character as Record<string, unknown>, p2Character, p2Save, admin);
            } else if (identity.admin) {
                finalP2Character = hydrateNpcCharacter(p2Character);
            } else if (identity.name === p2Norm) {
                return res.status(400).json({ error: 'Your character save was not found on the server.' });
            } else {
                finalP2Character = hydrateNpcCharacter(p2Character);
            }

            // #4 (newcomer protection / "below level 10 can't be attacked"):
            // a sub-ATTACKABLE_MIN_LEVEL shinobi can't be pulled into a sector
            // raid (useCurrentVitals) or a ranked battle as EITHER fighter.
            // Read from the AUTHORITATIVE save level (not the online store, which
            // can momentarily race to level 0), so a directly-POSTed / pre-created
            // session can't bypass the attack.ts / ranked-queue gates. Consensual
            // spars (useCurrentVitals=false & not ranked) stay open to everyone;
            // admins keep their test override.
            if (!identity.admin && (useCurrentVitals === true || ranked === true)) {
                const p1Level = Number((finalP1Character.level as number) ?? 0);
                const p2Level = Number((finalP2Character.level as number) ?? 0);
                if (isBelowAttackableFloor(p1Level) || isBelowAttackableFloor(p2Level)) {
                    return res.status(403).json({
                        error: `Shinobi below level ${ATTACKABLE_MIN_LEVEL} are under newcomer protection — they can't take part in sector raids or ranked battles yet.`,
                    });
                }
            }

            // Sector / guard fights bring current vitals — refuse to start
            // one with a 0-HP fighter so a dead attacker can't be created
            // via direct API calls (the client UI should already gate this,
            // this is the server-side belt). Spar / ranked / arena reset to
            // max anyway so they're unaffected.
            if (useCurrentVitals === true) {
                const p1Hp = Number((finalP1Character.hp as number) ?? 0);
                const p2Hp = Number((finalP2Character.hp as number) ?? 0);
                if (p1Hp <= 0) {
                    return res.status(400).json({ error: `${p1Name} is unconscious and cannot enter this fight.` });
                }
                if (p2Hp <= 0) {
                    return res.status(400).json({ error: `${p2Name} is unconscious and cannot enter this fight.` });
                }
            }

            // ── Seal the defending guard's Town Defense bonus ────────────────
            // Only for continuous (sector / guard) fights, only for the DEFENDER
            // (the fighter who is NOT the session creator / attacker), and only
            // while that defender is actually in the Village Guard rotation — so
            // an attacker can neither grant the bonus to themselves nor deny it
            // to the guard. The value is recomputed from the guard's OWN save;
            // the move resolver applies it as a ≤5% damage reduction.
            if (!identity.admin && useCurrentVitals === true) {
                const defenderRole: 'p1' | 'p2' | null =
                    identity.name === p1Norm ? 'p2' : identity.name === p2Norm ? 'p1' : null;
                if (defenderRole) {
                    const defenderNorm = defenderRole === 'p1' ? p1Norm : p2Norm;
                    const defenderSave = defenderRole === 'p1' ? p1Save : p2Save;
                    const onGuardDuty = defenderNorm ? await kv.get(`guard:${defenderNorm}`) : null;
                    if (onGuardDuty) {
                        const pct = townDefensePctFromSave(defenderSave?.character as Record<string, unknown> | undefined);
                        if (pct > 0) {
                            if (defenderRole === 'p1') finalP1Character.guardDefensePct = pct;
                            else finalP2Character.guardDefensePct = pct;
                        }
                    }
                }
            }

            const clanWarRequested = typeof clanWarId === 'string' || typeof clanWarChallengeId === 'string';
            const clanWarReservation = !identity.admin && typeof clanWarId === 'string' && typeof clanWarChallengeId === 'string'
                ? await reserveClanWarPvpSession({
                    warId: clanWarId,
                    challengeId: clanWarChallengeId,
                    creator: identity.name,
                    p1: p1Norm,
                    p2: p2Norm,
                    battleId,
                })
                : null;
            if (clanWarRequested && !clanWarReservation) {
                return res.status(409).json({ error: 'That accepted clan-war challenge cannot authorize this PvP session.' });
            }
            if (clanWarReservation && !clanWarReservation.owned) {
                const existing = await kv.get<PvpSession>(`pvp:${clanWarReservation.battleId}`);
                if (existing) {
                    const canonical = existing.battleId === clanWarReservation.battleId
                        && existing.rewardAuthority === 'clan-war'
                        && existing.clanWarId === clanWarReservation.warId
                        && existing.clanWarChallengeId === clanWarReservation.challengeId
                        && safeName(existing.p1?.name ?? '') === clanWarReservation.p1
                        && safeName(existing.p2?.name ?? '') === clanWarReservation.p2;
                    if (!canonical) {
                        return res.status(409).json({ error: 'The canonical Clan War battle authority is inconsistent.' });
                    }
                    return res.status(200).json({
                        battleId: existing.battleId,
                        session: existing,
                        rewardAuthorized: !!existing.rewardAuthority,
                        canonicalResume: true,
                    });
                }
                return res.status(409).json({ error: 'The clan-war battle is still being created. Retry in a moment.' });
            }

            // True 50/50 coin flip — going first is a meaningful turn-based
            // advantage and previously the attacker (always p1) won by default.
            // Now both sides have an equal shot at the opening move; the
            // prefight overlay's "X goes first!" reveal matches the server roll.
            // Use crypto.randomBytes for the coin flip — Math.random() is
            // V8-seeded and at session-creation rates could in principle be
            // biased/predicted via timing correlation.
            const firstActor: 'p1' | 'p2' = (randomBytes(1)[0] & 1) === 0 ? 'p1' : 'p2';
            const firstActorName = firstActor === 'p1' ? p1Name : p2Name;

            // ── Ranked snapshot (audit #7 / Stage 3; gated by audit #10) ──────
            // When the match is honored as ranked, record each fighter's
            // pre-match Elo read from their SAVE (authoritative), keyed to the
            // ladder. claim-rewards reads these back + the server winner to
            // compute and durably credit the rating change — the client can no
            // longer compute or self-apply the delta. NPC fighters (no save)
            // default to 1000, matching the client's `?? 1000`.
            //
            // #10: `ranked` from the body is only a client CLAIM. Require a
            // server-minted match token (from the ranked queue, sealed to THESE
            // two fighters on THIS ladder) and consume it single-use before
            // honoring it. No token → record the session as CASUAL (no stamp); the
            // battle still runs, and the RATINGS, WINNER and MAGNITUDE stay
            // server-authoritative regardless. Admins keep their override (test
            // fights never queue, so they'd have no token).
            let rankedStamp: Pick<PvpSession,
                'ranked' | 'rankedKind' | 'p1Rating' | 'p2Rating'
                | 'rankedMatchId' | 'rankedSeasonId' | 'rankedSeasonEpoch'> = {};
            let playerRankedAdmissionAuthority: PlayerRankedAdmission | null = null;
            let petRankedProofPending = false;
            if (ranked === true && (rankedKind === 'player' || rankedKind === 'pet')) {
                if (rankedKind === 'player') {
                    if (typeof rankedMatchId !== 'string'
                        || !Number.isSafeInteger(rankedSeasonId)
                        || Number(rankedSeasonId) <= 0
                        || !Number.isSafeInteger(rankedSeasonEpoch)
                        || Number(rankedSeasonEpoch) <= 0) {
                        return res.status(409).json({ error: 'A current server-ranked match proof is required.' });
                    }
                    const prior = await getPlayerRankedAdmission(kv, rankedMatchId);
                    const pair = [p1Norm, p2Norm].sort();
                    if (prior?.phase === 'active'
                        && prior.a === pair[0]
                        && prior.b === pair[1]
                        && prior.seasonId === rankedSeasonId
                        && prior.seasonEpoch === rankedSeasonEpoch
                        && prior.battleId) {
                        const existingRaw = await kv.get<unknown>(`pvp:${prior.battleId}`);
                        if (playerRankedOrphanTombstoneMatchesAdmission(existingRaw, prior)) {
                            throw new Error('player-ranked-session-cancelled');
                        }
                        const existing = existingRaw as PvpSession | null;
                        if (existing) {
                            if (!playerRankedSessionMatchesAdmission(existing, prior)) {
                                throw new Error('player-ranked-session-authority-conflict');
                            }
                            return res.status(200).json({
                                battleId: existing.battleId,
                                session: existing,
                                rewardAuthorized: !!existing.rewardAuthority,
                                resumed: true,
                            });
                        }
                        // Crash after admission activation but before session
                        // publication: rebuild the same battle capability. Do
                        // not heartbeat the gate before the session NX CAS;
                        // orphan cleanup must serialize on the session key
                        // first, otherwise a fresh active row can be stranded
                        // behind its own cancellation tombstone.
                        battleId = prior.battleId;
                        playerRankedAdmissionAuthority = prior;
                        rankedStamp = {
                            ranked: true,
                            rankedKind: 'player',
                            p1Rating: p1Norm === prior.a ? prior.aRating : prior.bRating,
                            p2Rating: p2Norm === prior.a ? prior.aRating : prior.bRating,
                            rankedMatchId: prior.matchId,
                            rankedSeasonId: prior.seasonId,
                            rankedSeasonEpoch: prior.seasonEpoch,
                        };
                    } else {
                        if (!playerRankedV2AdmissionsEnabled()) {
                            return res.status(503).json({ error: PLAYER_RANKED_V2_DISABLED_MESSAGE });
                        }
                        const proof = await provePlayerRankedMatchToken({
                            a: p1Norm,
                            b: p2Norm,
                            matchId: rankedMatchId,
                        });
                        if (!proof) {
                            return res.status(409).json({ error: 'That ranked proof is invalid, stale, or from another season.' });
                        }
                        if (proof.token.seasonId !== rankedSeasonId
                            || proof.token.seasonEpoch !== rankedSeasonEpoch) {
                            return res.status(409).json({ error: 'That ranked proof is invalid, stale, or from another season.' });
                        }
                        const active = await activatePlayerRankedAdmission(kv, proof.token.matchId, battleId, Date.now());
                        playerRankedAdmissionAuthority = active;
                        rankedStamp = {
                            ranked: true,
                            rankedKind: 'player',
                            p1Rating: p1Norm === active.a ? active.aRating : active.bRating,
                            p2Rating: p2Norm === active.a ? active.aRating : active.bRating,
                            rankedMatchId: active.matchId,
                            rankedSeasonId: active.seasonId,
                            rankedSeasonEpoch: active.seasonEpoch,
                        };
                    }
                } else {
                    const proven = await proveRankedMatchTokenForBattle(
                        p1Norm,
                        p2Norm,
                        'pet',
                        battleId,
                    );
                    if (!proven) {
                        return res.status(409).json({ error: 'A current server-ranked match proof is required.' });
                    }
                    petRankedProofPending = true;
                    const ratingOf = (save: Record<string, unknown> | null): number => {
                        const c = (save?.character ?? null) as Record<string, unknown> | null;
                        const r = Number(c?.petRankedRating);
                        return Number.isFinite(r) ? r : 1000;
                    };
                    rankedStamp = {
                        ranked: true,
                        rankedKind: 'pet',
                        p1Rating: ratingOf(p1Save),
                        p2Rating: ratingOf(p2Save),
                    };
                }
            }

            // Bind a normal challenge exactly once. The responder creates the
            // session; the durable challenge record proves both identity and
            // consent. This reservation is also what later authorizes the
            // accepted notice sent back to the challenger.
            const challengeReservation = !identity.admin && typeof challengeId === 'string'
                ? await reserveChallengeForPvpSession({
                    challengeId,
                    creator: identity.name,
                    p1: p1Norm,
                    p2: p2Norm,
                    mode: undefined,
                    battleId,
                })
                : null;

            // A world attack gets authority only from live server presence:
            // both real fighters must be co-located in the claimed non-village
            // sector, and the continuous-vitals/co-location flags must be set.
            // Merely naming two real saves is never enough.
            const p1Presence = onlineStore.get(p1Norm);
            const p2Presence = onlineStore.get(p2Norm);
            const claimedRewardSector = Math.floor(Number(rewardSector));
            let sessionCreatedAt = Date.now();
            if (stableBattleIdRequested && creatorRole) {
                const priorPointer = await loadPvpPendingSessionPointer(kv, identity.admin ? '' : identity.name);
                const expectedFingerprint = createRequestFingerprintFor(battleId);
                if (priorPointer?.battleId === battleId
                    && priorPointer.role === creatorRole
                    && priorPointer.phase === 'reserving'
                    && pvpPendingReservationIsFresh(priorPointer)
                    && priorPointer.createRequestFingerprint === expectedFingerprint) {
                    const existingRow = await kv.get<unknown>(`pvp:${battleId}`);
                    if (existingRow === null) sessionCreatedAt = priorPointer.createdAt;
                }
            }
            let worldAttackVerified =
                useCurrentVitals === true
                && requireWorldCoLocation === true
                && !!p1Save?.character
                && !!p2Save?.character
                && Number.isFinite(claimedRewardSector)
                && claimedRewardSector > 0
                && p1Presence?.sector === claimedRewardSector
                && p2Presence?.sector === claimedRewardSector;
            let worldTerritoryEvidence: PvpSession['worldTerritoryEvidence'];
            if (worldAttackVerified) {
                try {
                    const worldActorName = identity.admin ? '' : identity.name;
                    const attackerSave = worldActorName === p1Norm ? p1Save : p2Save;
                    const attackerChar = attackerSave?.character as Record<string, unknown>;
                    const attackerClan = String(attackerChar?.clan ?? '').trim();
                    const attackerVillage = String(attackerChar?.village ?? '').trim();
                    const territory = await kv.get<Record<string, unknown>>(`world:territory:${claimedRewardSector}`);
                    const ownerClan = String(territory?.ownerClan ?? '').trim();
                    const ownerVillage = String(territory?.ownerVillage ?? '').trim();
                    const controls = (!!ownerClan && ownerClan === attackerClan)
                        || (!!ownerVillage && ownerVillage === attackerVillage);
                    const guards = Array.isArray(territory?.guards)
                        ? territory!.guards!.map((guard) => safeName(String(guard))).filter(Boolean).slice(0, 20)
                        : [];
                    let raidDamage = 0;
                    if (ownerClan && !controls) {
                        const villageKey = ownerVillage.toLowerCase().replace(/[^a-z0-9]/g, '');
                        const villageState = await kv.get<{ anbuAppointees?: unknown }>(
                            `game:village-state:${villageKey}`,
                        );
                        const anbu = new Set(Array.isArray(villageState?.anbuAppointees)
                            ? villageState.anbuAppointees.map((name) => safeName(String(name))).filter(Boolean)
                            : []);
                        const anbuCount = guards.filter((guard) => anbu.has(guard)).length;
                        raidDamage = anbuCount > 0
                            ? Math.max(50, 250 - anbuCount * 50)
                            : guards.length > 0 ? 150 : 250;
                    }
                    worldTerritoryEvidence = {
                        version: 1,
                        sector: claimedRewardSector,
                        ownerClan,
                        ownerVillage,
                        raidDamage,
                        observedAt: sessionCreatedAt,
                    };
                } catch (error) {
                    console.error('[pvp/session] world territory evidence unavailable', error);
                    worldAttackVerified = false;
                }
            }

            const rewardAuthority: PvpSession['rewardAuthority'] = identity.admin
                ? 'admin'
                : rankedStamp.ranked === true
                    ? 'ranked'
                    : clanWarReservation
                        ? 'clan-war'
                    : challengeReservation
                        ? 'challenge'
                        : worldAttackVerified
                            ? 'world'
                            : undefined;
            const worldAttacker = rewardAuthority === 'world' && !identity.admin
                ? identity.name === p1Norm
                    ? {
                        side: 'p1' as const,
                        name: p1Norm,
                        village: String((p1Save?.character as Record<string, unknown>)?.village ?? '').trim(),
                        clan: String((p1Save?.character as Record<string, unknown>)?.clan ?? '').trim(),
                    }
                    : identity.name === p2Norm
                        ? {
                            side: 'p2' as const,
                            name: p2Norm,
                            village: String((p2Save?.character as Record<string, unknown>)?.village ?? '').trim(),
                            clan: String((p2Save?.character as Record<string, unknown>)?.clan ?? '').trim(),
                        }
                        : null
                : null;

            // ── Base-reward stamp (audit #7 / Stage 3 Phase 3; #1A hardening) ─
            // Opt this session into server crediting of the winner's base ryo +
            // XP. Two client-trusted holes are closed here:
            //
            //   1. baseRewards is honored ONLY when BOTH fighters resolve to
            //      authoritative SAVES (real players), or the creator is admin. A
            //      fabricated no-save NPC opponent — the "mint ryo vs a bot you
            //      invented" exploit — no longer opts a session into base rewards.
            //      Every legitimate base-reward flow is player-vs-real-player
            //      (challenge accept, sector raid vs a real defender); save-less
            //      AI guards take a separate (raidAi) client path that never sets
            //      baseRewards here. claim-rewards re-checks the loser's save at
            //      settlement, so this is not the only enforcement point.
            //   2. rewardSector's only reward effect is the Death's Gate (sector
            //      99) 2× multiplier, and the sector is unverifiable from the
            //      request — so a non-admin client CANNOT self-assign 99 for the
            //      2×: a claimed 99 is neutralized to 0 for reward purposes. (The
            //      home-terrain buff above reads the RAW body sector and is
            //      separately gated on server-verified territory ownership, so it
            //      is unaffected.) Admins keep the full value for test fights.
            //
            // Fail-closed and NOT silent: a base-reward request whose opponent
            // has no save runs the fight but grants no base rewards, and logs a
            // clear marker. See docs/auth-and-anti-cheat-patterns.md.
            // Death's Gate (sector 99) 2× is verified from PRESENCE, not the
            // client body: BOTH fighters must be reported at sector 99. The
            // attacker controls only their own presence, so the OPPONENT being
            // at 99 (which they cannot fake) is what actually gates the bonus —
            // it applies only when the opponent is genuinely at Death's Gate.
            const deathsGateVerified =
                onlineStore.get(p1Norm)?.sector === DEATHS_GATE_SECTOR
                && onlineStore.get(p2Norm)?.sector === DEATHS_GATE_SECTOR;
            // Consent to a standard player challenge proves the duel is real,
            // but it is still a no-reward spar. Generic progression is enabled
            // only by a purpose-built server receipt (ranked/world/Clan War) or
            // an explicit admin test session.
            const progressionAuthority = identity.admin
                || rankedStamp.ranked === true
                || !!clanWarReservation
                || worldAttackVerified;
            const { stamp: baseRewardStamp, denied: baseRewardDeniedBySave } = sealBaseRewardStamp({
                baseRewards: baseRewards === true && progressionAuthority,
                rewardSector,
                isAdmin: identity.admin,
                p1HasSave: !!p1Save?.character,
                p2HasSave: !!p2Save?.character,
                deathsGateVerified,
            });
            const baseRewardDenied = baseRewards === true && (!progressionAuthority || baseRewardDeniedBySave);
            if (baseRewardDenied) {
                const creatorName = identity.admin ? 'admin' : identity.name;
                console.warn(
                    `[pvp/session] base-reward request denied — no progression authority or authoritative opponent save `
                    + `(creator=${creatorName}, p1=${p1Norm || '∅'}, p2=${p2Norm || '∅'}). `
                    + `Fight runs WITHOUT base rewards.`,
                );
            }

            // Ranked fights are fought on NEUTRAL ground. A session creator could
            // otherwise seal a biome/weather that boosts their own school/element
            // (+10% terrain dmg per matching cast, plus a weather edge) for the whole
            // ranked match — a persistent ladder advantage that bypasses the
            // element-of-the-day fairness goal. Mirror the client's ranked-neutral
            // rule (shinobij.client/src/lib/pvp-session.ts) on the server so a
            // tampered client holding a valid match token can't pick favorable
            // terrain. Casual fights keep the client-chosen environment.
            const isRankedSession = rankedStamp.ranked === true;
            const sealedBiome = isRankedSession ? 'central' : normalizeBiome(biome);
            const sealedWeatherPos = isRankedSession ? '' : normalizeElement(weatherPositiveElement);
            const sealedWeatherNeg = isRankedSession ? '' : normalizeElement(weatherNegativeElement);

            // Home-terrain buff (PvE↔PvP parity). On a CASUAL sector fight, members
            // of the clan that OWNS the reward sector get +10% to the leader-chosen
            // offense type. Derived server-side from the authoritative territory
            // record + each fighter's SAVED clan (never the client body) and sealed
            // onto the fighter as `homeTerrainType` so move.ts can apply it. Ranked
            // stays neutral. Mirrors the client PvE territoryDamageMultiplier.
            let p1HomeTerrain = '';
            let p2HomeTerrain = '';
            if (!isRankedSession) {
                const secNum = Math.floor(Number(rewardSector));
                if (Number.isFinite(secNum) && secNum > 0) {
                    try {
                        const territory = await kv.get<Record<string, unknown>>(`world:territory:${secNum}`);
                        const ownerClan = String(territory?.ownerClan ?? '').trim();
                        const buffType = ownerClan ? terrainBuffStatToJutsuType(territory?.terrainBuffStat) : '';
                        if (ownerClan && buffType) {
                            const clanOf = (save: Record<string, unknown> | null) =>
                                String(((save?.character ?? null) as Record<string, unknown> | null)?.clan ?? '').trim();
                            if (clanOf(p1Save) === ownerClan) p1HomeTerrain = buffType;
                            if (clanOf(p2Save) === ownerClan) p2HomeTerrain = buffType;
                        }
                    } catch { /* territory read failed — grant no buff (fail-safe; never blocks the fight) */ }
                }
            }

            const playerRankedV2 = rankedStamp.rankedKind === 'player'
                && typeof rankedStamp.rankedMatchId === 'string';
            const realFighters = { p1: !!p1Save?.character, p2: !!p2Save?.character };
            let warRoleEvidence: SealedWarRoleEvidence | undefined;
            if (rewardAuthority && realFighters.p1 && realFighters.p2) {
                const p1Village = String((p1Save?.character as Record<string, unknown>)?.village ?? '').trim();
                const p2Village = String((p2Save?.character as Record<string, unknown>)?.village ?? '').trim();
                if (p1Village && p2Village) {
                    const [p1Role, p2Role] = await Promise.all([
                        sectorWarRoleOf(p1Norm, p1Village),
                        sectorWarRoleOf(p2Norm, p2Village),
                    ]);
                    warRoleEvidence = {
                        version: 1,
                        sealedAt: sessionCreatedAt,
                        p1: { village: p1Village, role: { ...p1Role } },
                        p2: { village: p2Village, role: { ...p2Role } },
                    };
                }
            }
            const p1SealedCharges = sealItemCharges(
                finalP1Character,
                (p1Save?.character as Record<string, unknown>) ?? null,
            );
            const p2SealedCharges = sealItemCharges(
                finalP2Character,
                (p2Save?.character as Record<string, unknown>) ?? null,
            );
            const session: PvpSession = {
                battleId,
                createRequestFingerprint: createRequestFingerprintFor(battleId),
                stateRevision: INITIAL_PVP_STATE_REVISION,
                p1: makeFighter(p1HomeTerrain ? { ...finalP1Character, homeTerrainType: p1HomeTerrain } : finalP1Character, P1_START, useCurrentVitals === true),
                p2: makeFighter(p2HomeTerrain ? { ...finalP2Character, homeTerrainType: p2HomeTerrain } : finalP2Character, P2_START, useCurrentVitals === true),
                round: 1,
                activePlayer: firstActor,
                ap: { p1: 100, p2: 100 },
                actionsThisTurn: 0,
                cooldowns: { p1: {}, p2: {} },
                log: [`⚔️ ${p1Name} vs ${p2Name} — Battle begins! 🪙 ${firstActorName} wins the coin flip and goes first.`],
                status: 'active',
                winner: null,
                ...(rewardAuthority ? { rewardAuthority } : {}),
                ...(progressionAuthority ? { progressionAuthorityVersion: 1 as const } : {}),
                ...(worldAttacker ? { worldAttacker } : {}),
                ...(rewardAuthority === 'world' && worldTerritoryEvidence ? { worldTerritoryEvidence } : {}),
                ...(warRoleEvidence ? { warRoleEvidence } : {}),
                ...(challengeReservation ? { challengeId: challengeReservation.id } : {}),
                ...(challengeReservation?.kageDuelAuthority
                    ? { kageDuelAuthority: challengeReservation.kageDuelAuthority }
                    : {}),
                ...(clanWarReservation ? {
                    clanWarId: clanWarReservation.warId,
                    clanWarChallengeId: clanWarReservation.challengeId,
                } : {}),
                joined: {
                    p1: identity.admin || identity.name === p1Norm,
                    p2: identity.admin || identity.name === p2Norm,
                },
                createdAt: sessionCreatedAt,
                lastMoveAt: sessionCreatedAt,
                // Snapshot environment so /api/pvp/move can't be tricked into
                // applying a different biome / weather mid-fight.
                biome: sealedBiome,
                weatherPositiveElement: sealedWeatherPos,
                weatherNegativeElement: sealedWeatherNeg,
                // Real-player inventory is mutable outside the battle and cannot
                // be atomically escrowed with this two-save session creation.
                // V1 therefore pins every real-side consumable/throwable to zero;
                // NPC behavior stays sealed as before.
                itemCharges: {
                    p1: realFighters.p1
                        ? zeroPlayerRankedItemCharges(finalP1Character, p1SealedCharges)
                        : p1SealedCharges,
                    p2: realFighters.p2
                        ? zeroPlayerRankedItemCharges(finalP2Character, p2SealedCharges)
                        : p2SealedCharges,
                },
                itemsUsed: { p1: {}, p2: {} },
                pvpConsumableAuthorityVersion: 1,
                pvpCompletionAuthorityVersion: 1,
                vanguardRewardAuthorityVersion: 2,
                // Which sides are real players (see the type). Sealed here so
                // claim-rewards can settle BOTH fighters' consumables from either
                // claim without ever touching a same-named NPC's "save".
                realFighters,
                ...rankedStamp,
                ...baseRewardStamp,
                ...(playerRankedV2 ? {
                    // Do not restore either legacy payout bit. A d76a claim
                    // worker sees a verified but non-paying session; upgraded
                    // journal recovery remains the only Elo authority.
                    ranked: false,
                    baseRewards: false,
                    playerRankedAuthorityVersion: PLAYER_RANKED_SESSION_AUTHORITY_VERSION,
                    // Ranked V2 starts with consumable and throwable charges
                    // pinned off. Inventory is mutable outside this battle, so
                    // post-terminal charging could otherwise be double-spent
                    // to wedge both the opponent and season settlement.
                    itemCharges: {
                        p1: zeroPlayerRankedItemCharges(
                            finalP1Character,
                            sealItemCharges(
                                finalP1Character,
                                (p1Save?.character as Record<string, unknown>) ?? null,
                            ),
                        ),
                        p2: zeroPlayerRankedItemCharges(
                            finalP2Character,
                            sealItemCharges(
                                finalP2Character,
                                (p2Save?.character as Record<string, unknown>) ?? null,
                            ),
                        ),
                    },
                    itemsUsed: { p1: {}, p2: {} },
                } : {}),
            };

            // Reserve only the authenticated creator's recovery slot before the
            // session row becomes visible. The unjoined opponent is never
            // indexed by an unsolicited create; their own authenticated join
            // reserves their slot before publishing joined=true in move.ts.
            const creatorPointer = creatorRole
                ? pendingPointerForSessionRole(session, creatorRole, 'reserving')
                : null;
            let creatorPointerCreated = false;
            let creatorReservation = creatorPointer;
            if (creatorPointer) {
                try {
                    const reservation = await publishPvpPendingSessionPointer(kv, creatorPointer);
                    creatorPointerCreated = reservation.created;
                    creatorReservation = reservation.pointer;
                } catch (error) {
                    if (!(error instanceof Error) || !error.message.startsWith('pvp-pending-session-conflict:')) {
                        throw error;
                    }
                    const current = await loadPvpPendingSessionPointer(kv, creatorPointer.playerName);
                    const currentRaw = current
                        ? await kv.get<unknown>(`pvp:${current.battleId}`)
                        : null;
                    const currentSession = current && currentRaw && !pvpSessionHasRankedCloseFence(currentRaw)
                        ? currentRaw as PvpSession
                        : current
                            ? await loadPvpRewardRecoverySnapshot(kv, current.battleId)
                            : null;
                    let stale = !current;
                    if (current && !currentSession) stale = !pvpPendingReservationIsFresh(current);
                    if (current && currentSession) stale = !pendingPointerMatchesSession(current, currentSession);
                    if (!stale && currentSession?.status === 'done') {
                        if (!currentSession.winner) {
                            stale = true;
                        } else {
                            const receipt = await kv.get<unknown>(
                                `pvp:rewarded:${current!.playerName}:${current!.battleId}`,
                            );
                            stale = pvpRewardCompletionStatus(receipt) === 'completed';
                        }
                    }
                    if (stale && current) {
                        await clearPvpPendingSessionPointer(
                            kv,
                            current.playerName,
                            current.battleId,
                            current.createdAt,
                            current.role,
                        );
                        const reservation = await publishPvpPendingSessionPointer(kv, creatorPointer);
                        creatorPointerCreated = reservation.created;
                        creatorReservation = reservation.pointer;
                    } else {
                        if (challengeReservation) {
                            await releaseChallengePvpReservation(challengeReservation.id, battleId).catch(() => undefined);
                        }
                        if (clanWarReservation) {
                            await releaseClanWarPvpReservation(clanWarReservation);
                        }
                        return res.status(409).json({
                            error: 'Finish the pending PvP battle settlement before starting another battle.',
                            ...(current ? { battleId: current.battleId, role: current.role } : {}),
                        });
                    }
                }
            }

            // Reserve the recovery slot before consuming the one-shot pet
            // admission. Consumption is bound to this stable battle id, so an
            // ambiguous response retries instead of burning a fresh proof.
            if (petRankedProofPending) {
                const consumed = await consumeRankedMatchTokenForBattle(
                    p1Norm,
                    p2Norm,
                    'pet',
                    battleId,
                );
                if (!consumed) {
                    if (creatorPointer) {
                        await clearPvpPendingSessionPointer(
                            kv,
                            creatorPointer.playerName,
                            creatorPointer.battleId,
                            creatorPointer.createdAt,
                            creatorPointer.role,
                        );
                    }
                    if (challengeReservation) {
                        await releaseChallengePvpReservation(challengeReservation.id, battleId).catch(() => undefined);
                    }
                    if (clanWarReservation) {
                        await releaseClanWarPvpReservation(clanWarReservation);
                    }
                    return res.status(409).json({ error: 'That pet-ranked proof was already bound to another battle.' });
                }
            }

            let publishedSession = session;
            try {
                const sessionKey = `pvp:${battleId}`;
                if (creatorReservation) {
                    await requirePvpPendingSessionOwnership(kv, creatorReservation);
                }
                if (clanWarReservation?.owned) {
                    await requireClanWarPvpReservation(clanWarReservation);
                }
                if (rankedStamp.rankedKind === 'player' && rankedStamp.rankedMatchId) {
                    const placed = await kv.set(sessionKey, session, { nx: true, ex: SESSION_TTL } as never);
                    if (!placed) {
                        const rawExisting = await kv.get<unknown>(sessionKey);
                        const admission = await getPlayerRankedAdmission(kv, rankedStamp.rankedMatchId);
                        if (admission && playerRankedOrphanTombstoneMatchesAdmission(rawExisting, admission)) {
                            throw new Error('player-ranked-session-cancelled');
                        }
                        const existing = rawExisting as PvpSession | null;
                        if (!existing || !admission || !playerRankedSessionMatchesAdmission(existing, admission)) {
                            throw new Error('player-ranked-session-immutable-conflict');
                        }
                        publishedSession = existing;
                    }
                } else {
                    const placed = await kv.set(sessionKey, session, { nx: true, ex: SESSION_TTL } as never);
                    if (!placed) {
                        let existing = await kv.get<unknown>(sessionKey);
                        if (!pvpSessionMatchesCreateRetry(existing, session)) {
                            throw new Error('pvp-session-capability-conflict');
                        }
                        publishedSession = existing;
                    }
                }
            } catch (writeError) {
                const recovered = await kv.get<PvpSession>(`pvp:${battleId}`).catch(() => null);
                const admission = rankedStamp.rankedKind === 'player' && rankedStamp.rankedMatchId
                    ? await getPlayerRankedAdmission(kv, rankedStamp.rankedMatchId).catch(() => null)
                    : null;
                if (recovered && (
                    (admission && playerRankedSessionMatchesAdmission(recovered, admission))
                    || (!admission && isDeepStrictEqual(recovered, session))
                )) {
                    publishedSession = recovered;
                } else {
                    if (challengeReservation) {
                        await releaseChallengePvpReservation(challengeReservation.id, battleId).catch(() => undefined);
                    }
                    if (clanWarReservation) {
                        await releaseClanWarPvpReservation(clanWarReservation);
                    }
                    if (creatorPointerCreated && creatorPointer) {
                        await clearPvpPendingSessionPointer(
                            kv,
                            creatorPointer.playerName,
                            creatorPointer.battleId,
                            creatorPointer.createdAt,
                            creatorPointer.role,
                        );
                    }
                    throw writeError;
                }
            }
            if (clanWarReservation?.owned) {
                try {
                    await requireClanWarPvpReservation(clanWarReservation);
                } catch (error) {
                    if (isDeepStrictEqual(publishedSession, session)) await rollbackExactUnownedPvpSession(session);
                    if (creatorPointer) {
                        await clearPvpPendingSessionPointer(
                            kv,
                            creatorPointer.playerName,
                            creatorPointer.battleId,
                            creatorPointer.createdAt,
                            creatorPointer.role,
                        );
                    }
                    console.error('[pvp/session] Clan War reservation lost during publication', error);
                    return res.status(503).json({
                        error: 'The Clan War battle reservation changed before publication. Retry the challenge.',
                    });
                }
            }
            if (rankedStamp.rankedKind === 'player' && rankedStamp.rankedMatchId) {
                const confirmed = await markPlayerRankedSessionPublished(
                    kv,
                    rankedStamp.rankedMatchId,
                    battleId,
                    Date.now(),
                );
                if (!confirmed
                    || confirmed.phase !== 'active'
                    || confirmed.battleId !== battleId
                    || confirmed.seasonId !== rankedStamp.rankedSeasonId
                    || confirmed.seasonEpoch !== rankedStamp.rankedSeasonEpoch) {
                    if (playerRankedAdmissionAuthority) {
                        await quarantineUnconfirmedPlayerRankedSession(playerRankedAdmissionAuthority);
                    }
                    if (creatorPointerCreated && creatorPointer) {
                        await clearPvpPendingSessionPointer(
                            kv,
                            creatorPointer.playerName,
                            creatorPointer.battleId,
                            creatorPointer.createdAt,
                            creatorPointer.role,
                        );
                    }
                    return res.status(409).json({ error: 'The season closed before this ranked session became authoritative.' });
                }
            }
            if (creatorPointer) {
                try {
                    if (creatorReservation) {
                        await requirePvpPendingSessionOwnership(kv, creatorReservation);
                    }
                    await activatePvpPendingSessionPointer(
                        kv,
                        creatorPointer.playerName,
                        creatorPointer.battleId,
                        creatorPointer.createdAt,
                        creatorPointer.createRequestFingerprint,
                    );
                } catch (error) {
                    const recoveredPointer = await loadPvpPendingSessionPointer(
                        kv,
                        creatorPointer.playerName,
                    );
                    const exactPointer = recoveredPointer
                        && recoveredPointer.battleId === creatorPointer.battleId
                        && recoveredPointer.role === creatorPointer.role
                        && recoveredPointer.createdAt === creatorPointer.createdAt
                        && recoveredPointer.createRequestFingerprint === creatorPointer.createRequestFingerprint
                        ? recoveredPointer
                        : null;
                    // A lost activation acknowledgement is successful only when
                    // the exact body transition is readable. Otherwise remove
                    // the exact unpublished generation and its still-reserving
                    // pointer so the same stable request can retry immediately.
                    if (exactPointer?.phase === 'active') {
                        // Exact readback proves activation; continue to success.
                    } else {
                        if (isDeepStrictEqual(publishedSession, session)) {
                            await rollbackExactUnownedPvpSession(session);
                        }
                        if (exactPointer?.phase === 'reserving') {
                            await clearPvpPendingSessionPointer(
                                kv,
                                exactPointer.playerName,
                                exactPointer.battleId,
                                exactPointer.createdAt,
                                exactPointer.role,
                            );
                        }
                        console.error('[pvp/session] pending-session activation failed', error);
                        return res.status(503).json({
                            error: 'The battle is published but its recovery pointer is still finalizing. Retry the same request.',
                            battleId,
                        });
                    }
                }
            }
            // Return the full session alongside the id so the client can seed
            // PvpBattleScreen's state on mount and skip the redundant GET
            // round trip that immediately follows a POST. Same data the GET
            // endpoint returns (and GET is unauthenticated for spectator-by-id
            // / EventSource compat), so no new exposure here — POST itself is
            // already gated to a fighter or admin via authedPlayerOrAdmin.
            return res.status(200).json({
                battleId,
                session: publishedSession,
                rewardAuthorized: !!publishedSession.rewardAuthority,
                ...(publishedSession === session ? {} : { resumed: true }),
            });
        } catch (err) {
            console.error('[pvp/session]', err);
            if (err instanceof Error && (
                err.message.startsWith('player-ranked-')
                || err.message.includes('activation-')
            )) {
                if (err.message.includes('session-cancelled')) {
                    return res.status(409).json({ error: 'This ranked match was cancelled before its session became authoritative.' });
                }
                return res.status(503).json({ error: 'Could not confirm the ranked session. Retry the same match proof.' });
            }
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
