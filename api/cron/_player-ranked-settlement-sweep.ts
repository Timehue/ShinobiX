/**
 * Server-side recovery for player-ranked settlements.
 *
 * Every other path that finishes a ranked terminal saga is request-triggered:
 * a move retry, either player's claim, ranked-queue traffic (and only while the
 * gate still holds the match's admission), or season close. A saga cut off by
 * a restart therefore waited for somebody to come back, and one whose gate
 * admission was lost could not be finished by anyone. This sweep finishes both
 * from durable state alone, on the in-process scheduler, under a cron lease.
 *
 * Work is found through `player:ranked-settling:<matchId>` pointers, which are
 * proportional to unsettled work, so an idle pass costs one index probe plus
 * one gate read. A pointer is
 *   - written before each journal is created (materializeJournal), and deleted
 *     when the whole saga is proven (compactSettledPlayerRankedSession);
 *   - ensured here for any gate admission that is terminal, or active with a
 *     done session, once it is older than the minimum age;
 *   - published once by the discovery pass for journals older than pointers.
 * Each due pointer runs resumePlayerRankedSettlement: the confirm path a claim
 * or move runs, with the same locks and receipts, so it is safe to race them.
 * The minimum age leaves a live saga to finish its own work; failures back off.
 */
import { kv as realKv, type KvLike } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { hasRecentIpOrFpOverlapStrict } from '../_player-ips.js';
import { readPetRankedSeasonGateFresh } from '../pet/_ranked-preparation.js';
import type { SaveLockRunner } from '../pvp/_consumable-settlement.js';
import type { PvpSession } from '../pvp/session.js';
import {
    ensurePlayerRankedSettlingPointer,
    parsePlayerRankedJournal,
    parsePlayerRankedSettlingPointer,
    playerRankedSettlingKey,
    PLAYER_RANKED_JOURNAL_PREFIX,
    PLAYER_RANKED_JOURNAL_TTL_SECONDS,
    PLAYER_RANKED_SETTLING_PREFIX,
    type PlayerRankedSettlingPointer,
} from '../pvp/_player-ranked-journal.js';
import {
    resumePlayerRankedSettlement,
    type PlayerRankedResumeOutcome,
} from '../pvp/_ranked-terminal-effects.js';

/** Younger work belongs to the saga (claim, move, queue) still running it. */
export const PLAYER_RANKED_SETTLEMENT_MIN_AGE_MS = 3 * 60_000;
/** Set once a discovery pass has read every journal without a failure. */
export const PLAYER_RANKED_SETTLEMENT_DISCOVERY_KEY = 'player:ranked-settling-discovery:v1';
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 6 * 60 * 60_000;
const MGET_CHUNK = 100;

type SweepStore = Pick<KvLike, 'get' | 'set' | 'compareSet' | 'del' | 'delIfEqual' | 'keys' | 'mget' | 'hset'>;

export type PlayerRankedSettlementSweepResult = {
    /** Null unless this pass was asked to discover pre-pointer journals. */
    discovery: { journals: number; published: number; failures: number; complete: boolean } | null;
    /** Pointers newly published for stranded gate admissions. */
    gatePublished: number;
    /** Pointers present when the pass listed them. */
    pointers: number;
    /** Not yet due: still inside the minimum age or a failure backoff. */
    deferred: number;
    attempted: number;
    settled: string[];
    voided: string[];
    /** Unreadable pointer rows removed (a pointer is discovery, never authority). */
    discarded: number;
    failures: Array<{ matchId: string; error: string; attempts: number }>;
    truncated: boolean;
};

export type PlayerRankedSettlementSweepDeps = {
    store?: SweepStore;
    lock?: SaveLockRunner;
    /** Seals anti-alt eligibility for an admission the sweep terminalizes. */
    eligible?: (a: string, b: string) => Promise<boolean>;
    now?: () => number;
    minAgeMs?: number;
    /** Maximum matches resumed per pass. */
    budget?: number;
    budgetMs?: number;
    discover?: boolean;
};

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function playerRankedSettlementBackoffMs(attempts: number): number {
    const exponent = Math.max(0, Math.min(16, Math.floor(attempts) - 1));
    return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
}

function isDoneSessionRow(value: unknown, battleId: string): value is PvpSession {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Partial<PvpSession>;
    return row.battleId === battleId && row.status === 'done' && !!row.p1 && !!row.p2;
}

/**
 * One-time backfill for journals created before pointers existed (and a
 * safety net for any written by an older worker during the deploy that
 * introduced them). A pending journal owes its whole saga. A completed one can
 * still owe its session compaction — and, when season close completed it
 * without the session saga, its Vanguard and council credit — which a live
 * terminal row betrays: those rows never expire until the saga compacts them.
 */
async function discoverUnpointedJournals(
    store: SweepStore,
    now: number,
): Promise<NonNullable<PlayerRankedSettlementSweepResult['discovery']>> {
    if (await store.get<unknown>(PLAYER_RANKED_SETTLEMENT_DISCOVERY_KEY) !== null) {
        return { journals: 0, published: 0, failures: 0, complete: true };
    }
    const keys = (await store.keys(`${PLAYER_RANKED_JOURNAL_PREFIX}*`))
        .filter((key) => key.startsWith(PLAYER_RANKED_JOURNAL_PREFIX))
        .sort();
    let published = 0;
    let failures = 0;
    for (let index = 0; index < keys.length; index += MGET_CHUNK) {
        const chunk = keys.slice(index, index + MGET_CHUNK);
        const values = await store.mget(...chunk);
        for (let offset = 0; offset < chunk.length; offset += 1) {
            const raw = values[offset];
            if (raw === null) continue; // expired between the listing and the read
            const matchId = chunk[offset].slice(PLAYER_RANKED_JOURNAL_PREFIX.length);
            const journal = parsePlayerRankedJournal(raw);
            if (!journal || journal.terminal.matchId !== matchId) {
                failures += 1;
                console.warn('[ranked-settlement] unreadable journal left for review', matchId);
                continue;
            }
            const { battleId, terminalAt } = journal.terminal;
            const owesWork = journal.state === 'pending'
                || isDoneSessionRow(await store.get<unknown>(`pvp:${battleId}`), battleId);
            if (owesWork && await ensurePlayerRankedSettlingPointer(store, { matchId, battleId, since: terminalAt })) {
                published += 1;
            }
        }
    }
    const complete = failures === 0;
    if (complete) {
        await store.set(PLAYER_RANKED_SETTLEMENT_DISCOVERY_KEY, {
            version: 1,
            completedAt: now,
            journals: keys.length,
            published,
        }, { ex: PLAYER_RANKED_JOURNAL_TTL_SECONDS });
    }
    return { journals: keys.length, published, failures, complete };
}

/**
 * The gate is the authority for admissions that never reached a journal: a
 * worker that died right after the terminal session CAS leaves an `active`
 * admission over a done session, and one that died after the gate's terminal
 * CAS leaves a `terminal` admission. Point the sweep at both once old enough.
 */
async function publishStrandedAdmissionPointers(
    store: SweepStore,
    now: number,
    minAgeMs: number,
): Promise<number> {
    const gate = await readPetRankedSeasonGateFresh(store);
    let published = 0;
    for (const admission of gate?.playerAdmissions ?? []) {
        const battleId = admission.battleId;
        if (!battleId) continue;
        let since: number | null = null;
        if (admission.phase === 'terminal') {
            since = admission.terminalAt;
        } else if (admission.phase === 'active') {
            const activeSince = admission.sessionPublishedAt ?? admission.activatedAt ?? admission.createdAt;
            if (now - activeSince < minAgeMs) continue;
            const session = await store.get<unknown>(`pvp:${battleId}`);
            if (!isDoneSessionRow(session, battleId)) continue;
            const endedAt = Number(session.endedAt);
            since = Number.isSafeInteger(endedAt) && endedAt > 0 ? endedAt : activeSince;
        }
        if (since === null || now - since < minAgeMs) continue;
        if (await ensurePlayerRankedSettlingPointer(store, { matchId: admission.matchId, battleId, since })) {
            published += 1;
        }
    }
    return published;
}

export async function runPlayerRankedSettlementSweep(
    deps: PlayerRankedSettlementSweepDeps = {},
): Promise<PlayerRankedSettlementSweepResult> {
    const store = deps.store ?? realKv;
    const lock: SaveLockRunner = deps.lock
        ?? ((saveKey, action) => withKvLock(saveKey, action, { failClosed: true }));
    const eligible = deps.eligible
        ?? (async (a: string, b: string) => !(await hasRecentIpOrFpOverlapStrict(a, b, store)));
    const started = Date.now();
    const now = deps.now?.() ?? started;
    const minAgeMs = Math.max(0, Math.floor(deps.minAgeMs ?? PLAYER_RANKED_SETTLEMENT_MIN_AGE_MS));
    const budget = Math.max(1, Math.floor(deps.budget ?? 10));
    const budgetMs = Math.max(1_000, Math.floor(deps.budgetMs ?? 60_000));
    const result: PlayerRankedSettlementSweepResult = {
        discovery: null,
        gatePublished: 0,
        pointers: 0,
        deferred: 0,
        attempted: 0,
        settled: [],
        voided: [],
        discarded: 0,
        failures: [],
        truncated: false,
    };

    if (deps.discover) result.discovery = await discoverUnpointedJournals(store, now);
    result.gatePublished = await publishStrandedAdmissionPointers(store, now, minAgeMs);

    const keys = (await store.keys(`${PLAYER_RANKED_SETTLING_PREFIX}*`))
        .filter((key) => key.startsWith(PLAYER_RANKED_SETTLING_PREFIX))
        .sort();
    result.pointers = keys.length;
    const due: Array<{ key: string; raw: unknown; pointer: PlayerRankedSettlingPointer }> = [];
    for (let index = 0; index < keys.length; index += MGET_CHUNK) {
        const chunk = keys.slice(index, index + MGET_CHUNK);
        const values = await store.mget(...chunk);
        for (let offset = 0; offset < chunk.length; offset += 1) {
            const key = chunk[offset];
            const raw = values[offset];
            if (raw === null) continue; // settled between the listing and the read
            const pointer = parsePlayerRankedSettlingPointer(raw);
            if (!pointer || playerRankedSettlingKey(pointer.matchId) !== key) {
                if (await store.delIfEqual(key, raw).catch(() => false)) result.discarded += 1;
                continue;
            }
            if (pointer.nextAttemptAt > now || now - pointer.since < minAgeMs) {
                result.deferred += 1;
                continue;
            }
            due.push({ key, raw, pointer });
        }
    }
    due.sort((left, right) => left.pointer.nextAttemptAt - right.pointer.nextAttemptAt
        || left.pointer.since - right.pointer.since
        || left.pointer.matchId.localeCompare(right.pointer.matchId));

    for (const entry of due) {
        if (result.attempted >= budget || Date.now() - started > budgetMs) {
            result.truncated = true;
            break;
        }
        result.attempted += 1;
        const { matchId } = entry.pointer;
        let outcome: PlayerRankedResumeOutcome;
        try {
            outcome = await resumePlayerRankedSettlement(store, matchId, { lock, eligible, now });
        } catch (error) {
            const attempts = entry.pointer.attempts + 1;
            const message = errorText(error);
            result.failures.push({ matchId, error: message, attempts });
            const retry: PlayerRankedSettlingPointer = {
                ...entry.pointer,
                attempts,
                nextAttemptAt: now + playerRankedSettlementBackoffMs(attempts),
                lastError: message.slice(0, 200),
            };
            // Exact CAS: a saga that settled the match meanwhile deleted this
            // pointer, and the backoff must never resurrect it. The TTL is
            // re-stated because a CAS without one would clear it.
            await store.compareSet(entry.key, entry.raw, retry, { ex: PLAYER_RANKED_JOURNAL_TTL_SECONDS })
                .catch(() => false);
            continue;
        }
        // Settlement already cleared it on the compaction path; this covers
        // proofs reached without one (void, or a row already gone). A delete
        // that fails only costs the next pass one more re-verification.
        await store.del(entry.key).catch(() => 0);
        (outcome === 'settled' ? result.settled : result.voided).push(matchId);
    }
    return result;
}
