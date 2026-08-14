import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv, type KvLike } from './_storage.js';
import { cors } from './_utils.js';
import { authedPlayerOrAdmin } from './_auth.js';
import { withKvLock } from './_lock.js';
import { bumpLegacyStats } from './_legacy-track.js';
import { bumpEraContribution } from './_era.js';
import { announce } from './_announce.js';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { weeklyBossGuardEnabled } from './_release-flags.js';
import { weeklyBossEnemyTemplate } from './_authoritative-pve.js';
import { loadAdminCombatContent } from './_admin-content.js';
import { loadAdminAiObjects } from './_admin-ai-catalog.js';
import { buildSoloPveAiEncounter } from './solo-pve/_ai-encounter.js';
import { compareWriteSoloPveSession, readSoloPveSession, soloPveSessionKey, writeSoloPveSession } from './solo-pve/_store.js';
import { applySoloPveUsageCosts, withSoloPveSettlementReceipt } from './solo-pve/_settlement.js';
import { settleSoloPveTerminalUsage } from './solo-pve/_usage-authority.js';
import { mutatePlayerSave } from './save/_mutate-player-save.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from './_settlement-receipts.js';
import { applyAiFightOutcomeToCharacter, resolveAiFightOutcome } from './missions/_ai-fight-outcome.js';
import { augmentSaveWithForgedDefs } from './_forged-item-registry.js';
import { findTowerBattleStartConflict, towerBattleActiveErrorBody } from './_tower-battle-guard.js';
import {
    validateAuthoritativeWeeklyBossRun,
    weeklyBossRunKey,
    type WeeklyBossAuthoritativeRun,
} from './_weekly-boss-authoritative-run.js';
import {
    chargeWeeklyBossStart,
    finalizeWeeklyBossStart,
    type WeeklyBossStartSeal,
} from './_weekly-boss-start-authority.js';
import {
    acknowledgeWeeklyBossPayout,
    applyWeeklyBossPayout,
    creditWeeklyBossPayout,
    type WeeklyBossPayout,
} from './_weekly-boss-payout-authority.js';

// bumpSaveVersion is performed by mutatePlayerSave (directly and through the
// Weekly Boss authority helpers); successful player responses echo `_saveVersion`.

// One weekly boss state per ISO week. Players damage a shared "rampage
// meter" (no HP cap — the boss cannot be killed by damage). 72h after
// spawn the boss despawns and rewards are auto-distributed:
//   • Top 25 contributors    → 1 Dungeon Key each
//   • Top 10 contributors    → 1 Weekly Boss Core each (stacks with key)
//   • All contributors       → ryo + xp share proportional to damage
//                              (×2 for the MVP — top damage dealer)
// New ISO week → boss is auto-reset (picks a random non-boss AI, or uses
// the admin-set weeklyBossOverride if present).

const WEEKLY_BOSS_STATE_KEY = 'game:weekly-boss-state';
const WEEKLY_BOSS_OVERRIDE_KEY = 'game:weekly-boss-override';
const WEEKLY_BOSS_RUN_TTL_SECONDS = 2 * 60 * 60;
// Fight window after an admin spawns the boss. Widened 24h → 72h (gameplay-loop
// audit M-3): the boss is spawned manually (the owner controls cadence — see
// loadOrInitBoss), so a single 24h window was easy for most of the roster to
// miss entirely. 72h spans a weekend so far more players get a turn before
// rewards auto-distribute. This does NOT auto-spawn — manual cadence is
// preserved. TUNABLE. (Mirrored in WeeklyBossArena.tsx copy + fallback.)
const WEEKLY_BOSS_LIFETIME_MS = 72 * 60 * 60 * 1000;
// Maximum arena attempts a player can make per boss spawn. After this
// they're locked out until the boss despawns and a new one spawns.
const WEEKLY_BOSS_MAX_ATTEMPTS = 3;
export const WEEKLY_BOSS_DAMAGE_DRAIN_GRACE_MS = 5 * 60 * 1_000;
const WEEKLY_BOSS_USAGE_SETTLEMENTS_FIELD = 'weeklyBossUsageSettlements';
const WEEKLY_BOSS_USAGE_RECOVERY_MS = 35 * 24 * 60 * 60 * 1_000;
const WEEKLY_BOSS_USAGE_SETTLEMENT_LIMIT = 256;
// Reward tier cutoffs by damage rank (1-indexed in the natural reading).
// Once-per-week stat-pool grant for every contributor (leveling-without-xp
// map §4: weekly cadence, outside the daily checklist, exactly-once via the
// per-(week,player) credit receipt).
const TOP_CORE_COUNT = 10;  // ranks 1..10 each receive 1 Weekly Boss Core
const TOP_KEY_COUNT = 25;   // ranks 1..25 each receive 1 Dungeon Key

type WeeklyBossRewardEntry = {
    name: string;
    damage: number;
    rank: number;
    ryo: number;
    xp: number;
    gotCore: boolean;
    gotKey: boolean;
    isMvp: boolean;
};

export function applyWeeklyBossReward(
    character: Record<string, unknown>,
    weekKey: string,
    aiId: string,
    bossStartedAt: number,
    entry: Pick<WeeklyBossRewardEntry, 'name' | 'ryo' | 'gotCore' | 'gotKey'>,
    now = Date.now(),
): { character: Record<string, unknown>; alreadyApplied: boolean } {
    const receiptId = `weeklyboss_${createHash('sha256').update(`${weekKey}:${bossStartedAt}:${entry.name}`).digest('hex').slice(0, 32)}`;
    const fingerprint = `weekly-boss:${weekKey}:${bossStartedAt}:${aiId}`;
    const inspected = inspectSettlementReceipt(character, receiptId, fingerprint);
    if (inspected.status === 'replay') return { character, alreadyApplied: true };
    if (inspected.status !== 'fresh') throw new Error(`weekly-boss-receipt-${inspected.status}`);

    const credited = applyWeeklyBossPayout(character, {
        playerName: entry.name,
        weekKey,
        bossStartedAt,
        aiId,
        ryo: entry.ryo,
        gotCore: entry.gotCore,
        gotKey: entry.gotKey,
    });
    return {
        character: appendSettlementReceipt(credited, inspected.receipts, {
            requestId: receiptId,
            fingerprint,
            value: { weekKey, bossStartedAt, ryo: entry.ryo, gotCore: entry.gotCore, gotKey: entry.gotKey },
            settledAt: now,
        }),
        alreadyApplied: false,
    };
}

export type WeeklyBossState = {
    weekKey: string;
    aiId: string;
    bossName?: string;
    hpMax: number;
    // Retained for back-compat with old clients that still render an HP bar.
    // The server keeps this equal to hpMax so the bar always reads "full"
    // until the new countdown UI lands.
    hpRemaining: number;
    scaleFactor: number;
    damageByPlayer: Record<string, number>;
    // How many arena attempts each player has used against this spawn.
    // Capped at WEEKLY_BOSS_MAX_ATTEMPTS. Resets every new boss spawn.
    attemptsByPlayer?: Record<string, number>;
    startedAt: number;
    expiresAt: number;
    rewardsDistributed?: boolean;
    distributedAt?: number;
    distributionSummary?: WeeklyBossRewardEntry[];
    damageProofsFrozenAt?: number;
    // Per-player credit receipts (audit #25). Names whose save credit has
    // durably succeeded. `rewardsDistributed` is only flipped true once every
    // entry in distributionSummary appears here, so a crash mid-credit leaves
    // the boss in a "summary computed, some credited" state that the next
    // GET/POST resumes — instead of marking distributed up-front and silently
    // skipping survivors forever.
    creditedPlayers?: string[];
    /** Players whose save-side payout marker has been retired after
     * `creditedPlayers` durably acknowledged their payout. This is recovery
     * bookkeeping, not payout authority. */
    payoutMarkersAcknowledgedPlayers?: string[];
    /** Per-spawn authoritative contribution receipts. Kept with the aggregate
     * so banking damage and its idempotency marker are one atomic KV write. */
    bankedRunDamage?: Record<string, number>;
    /** Non-distributable journal written before the player-save usage CAS. */
    pendingRunDamage?: Record<string, WeeklyBossPendingRunDamage>;
    /** Exact proof that each aggregate contribution followed its save CAS. */
    usageSettledRunReceipts?: Record<string, string>;
    /** Unproven rolling-worker damage removed once its liveness grace drains. */
    discardedRunDamage?: Record<string, number>;
    /** Run IDs whose attempt debit is already reflected in attemptsByPlayer.
     * This makes a prepared start resumable without spending a second attempt. */
    attemptRunReceipts?: Record<string, string>;
};

type WeeklyBossPendingRunDamage = {
    playerName: string;
    damage: number;
    fingerprint: string;
    reservedAt: number;
};

type WeeklyBossUsageSettlementMarker = {
    version: 1;
    runId: string;
    playerName: string;
    weekKey: string;
    aiId: string;
    bossStartedAt: number;
    damage: number;
    fingerprint: string;
    settledAt: number;
    recoverUntil: number;
};

export function weeklyBossUsageFingerprint(params: {
    runId: string;
    playerName: string;
    weekKey: string;
    aiId: string;
    bossStartedAt: number;
    damage: number;
}): string {
    return createHash('sha256').update(JSON.stringify({
        version: 1,
        runId: params.runId,
        playerName: params.playerName.toLowerCase(),
        weekKey: params.weekKey,
        aiId: params.aiId,
        bossStartedAt: params.bossStartedAt,
        damage: Math.max(0, Math.floor(Number(params.damage) || 0)),
    })).digest('hex');
}

function parseWeeklyBossUsageMarkers(character: Record<string, unknown>): WeeklyBossUsageSettlementMarker[] | null {
    const raw = character[WEEKLY_BOSS_USAGE_SETTLEMENTS_FIELD];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) return null;
    const markers: WeeklyBossUsageSettlementMarker[] = [];
    const runIds = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        const value = entry as Partial<WeeklyBossUsageSettlementMarker>;
        const damage = Number(value.damage);
        const bossStartedAt = Number(value.bossStartedAt);
        const settledAt = Number(value.settledAt);
        const recoverUntil = Number(value.recoverUntil);
        if (value.version !== 1
            || typeof value.runId !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(value.runId) || runIds.has(value.runId)
            || typeof value.playerName !== 'string' || !value.playerName
            || typeof value.weekKey !== 'string' || !/^\d{4}-W\d{2}$/.test(value.weekKey)
            || typeof value.aiId !== 'string' || !value.aiId
            || !Number.isSafeInteger(bossStartedAt) || bossStartedAt <= 0
            || !Number.isSafeInteger(damage) || damage < 0
            || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
            || !Number.isFinite(settledAt) || settledAt <= 0
            || !Number.isFinite(recoverUntil) || recoverUntil <= settledAt) return null;
        runIds.add(value.runId);
        markers.push({
            version: 1,
            runId: value.runId,
            playerName: value.playerName,
            weekKey: value.weekKey,
            aiId: value.aiId,
            bossStartedAt,
            damage,
            fingerprint: value.fingerprint,
            settledAt,
            recoverUntil,
        });
    }
    return markers;
}

function appendWeeklyBossUsageMarker(
    existing: WeeklyBossUsageSettlementMarker[],
    marker: WeeklyBossUsageSettlementMarker,
    now: number,
): WeeklyBossUsageSettlementMarker[] | null {
    const active = existing.filter((entry) => entry.runId !== marker.runId && entry.recoverUntil > now);
    if (active.length >= WEEKLY_BOSS_USAGE_SETTLEMENT_LIMIT) return null;
    return [marker, ...active];
}

export function reserveWeeklyBossRunDamageSettlement(
    boss: WeeklyBossState,
    runId: string,
    playerName: string,
    damage: number,
    fingerprint: string,
    now: number,
): { boss: WeeklyBossState; replayed: boolean } | null {
    const pending: WeeklyBossPendingRunDamage = {
        playerName,
        damage: Math.max(0, Math.floor(Number(damage) || 0)),
        fingerprint,
        reservedAt: now,
    };
    const prior = boss.pendingRunDamage?.[runId];
    if (prior) return prior.playerName === playerName && prior.damage === pending.damage && prior.fingerprint === fingerprint
        ? { boss, replayed: true }
        : null;
    const banked = boss.bankedRunDamage?.[runId];
    if (Number.isFinite(banked)) {
        if (banked !== pending.damage) return null;
        if (boss.usageSettledRunReceipts?.[runId] === fingerprint) return { boss, replayed: true };
        if (boss.usageSettledRunReceipts?.[runId]) return null;
        return {
            boss: { ...boss, pendingRunDamage: { ...(boss.pendingRunDamage ?? {}), [runId]: pending } },
            replayed: false,
        };
    }
    return {
        boss: { ...boss, pendingRunDamage: { ...(boss.pendingRunDamage ?? {}), [runId]: pending } },
        replayed: false,
    };
}

export function commitWeeklyBossRunDamageSettlement(
    boss: WeeklyBossState,
    runId: string,
    playerName: string,
    damage: number,
    fingerprint: string,
): { boss: WeeklyBossState; damage: number; replayed: boolean } | null {
    const logged = Math.max(0, Math.floor(Number(damage) || 0));
    const pending = boss.pendingRunDamage?.[runId];
    if (pending && (pending.playerName !== playerName || pending.damage !== logged || pending.fingerprint !== fingerprint)) return null;
    const prior = boss.bankedRunDamage?.[runId];
    if (Number.isFinite(prior) && Math.max(0, Math.floor(Number(prior))) !== logged) return null;
    const priorProof = boss.usageSettledRunReceipts?.[runId];
    if (priorProof && priorProof !== fingerprint) return null;
    if (Number.isFinite(prior) && priorProof === fingerprint && !pending) {
        return { boss, damage: logged, replayed: true };
    }
    const pendingRunDamage = { ...(boss.pendingRunDamage ?? {}) };
    delete pendingRunDamage[runId];
    if (Number.isFinite(prior)) {
        const next = {
            ...boss,
            pendingRunDamage,
            usageSettledRunReceipts: { ...(boss.usageSettledRunReceipts ?? {}), [runId]: fingerprint },
        };
        return { boss: next, damage: logged, replayed: priorProof === fingerprint && !pending };
    }
    return {
        boss: {
            ...boss,
            pendingRunDamage,
            damageByPlayer: { ...boss.damageByPlayer, [playerName]: (boss.damageByPlayer[playerName] ?? 0) + logged },
            bankedRunDamage: { ...(boss.bankedRunDamage ?? {}), [runId]: logged },
            usageSettledRunReceipts: { ...(boss.usageSettledRunReceipts ?? {}), [runId]: fingerprint },
        },
        damage: logged,
        replayed: false,
    };
}

export type WeeklyBossResetConflict = {
    code: 'weekly-boss-active' | 'weekly-boss-settlement-pending' | 'weekly-boss-same-week';
    error: string;
};

/** A reset is replacement, so it is legal only after the exact old spawn is
 * fully distributed and every player-side payout marker is acknowledged. */
export function weeklyBossResetConflict(
    boss: WeeklyBossState,
    now: number,
    nextWeekKey: string,
): WeeklyBossResetConflict | null {
    if (now < boss.expiresAt) {
        return {
            code: 'weekly-boss-active',
            error: 'The current Weekly Boss is still active. Let it expire before spawning another.',
        };
    }
    const summary = Array.isArray(boss.distributionSummary) ? boss.distributionSummary : null;
    const credited = new Set(boss.creditedPlayers ?? []);
    const acknowledged = new Set(boss.payoutMarkersAcknowledgedPlayers ?? []);
    if (!boss.rewardsDistributed || !summary
        || summary.some((entry) => !credited.has(entry.name) || !acknowledged.has(entry.name))) {
        return {
            code: 'weekly-boss-settlement-pending',
            error: 'The expired Weekly Boss is still settling rewards. Retry after every payout is acknowledged.',
        };
    }
    if (boss.weekKey === nextWeekKey) {
        return {
            code: 'weekly-boss-same-week',
            error: 'A Weekly Boss has already completed for this ISO week. Spawn the next boss after the week changes.',
        };
    }
    return null;
}

export function reserveWeeklyBossAttemptReceipt(
    boss: WeeklyBossState,
    runId: string,
    playerName: string,
    enforceLimit = true,
): { boss: WeeklyBossState; replayed: boolean } | null {
    const prior = boss.attemptRunReceipts?.[runId];
    if (prior === playerName) return { boss, replayed: true };
    if (prior) return null;
    const used = boss.attemptsByPlayer?.[playerName] ?? 0;
    if (enforceLimit && used >= WEEKLY_BOSS_MAX_ATTEMPTS) return null;
    return {
        boss: {
            ...boss,
            attemptsByPlayer: { ...(boss.attemptsByPlayer ?? {}), [playerName]: used + 1 },
            attemptRunReceipts: { ...(boss.attemptRunReceipts ?? {}), [runId]: playerName },
        },
        replayed: false,
    };
}

export function rollbackWeeklyBossAttemptReceipt(
    boss: WeeklyBossState,
    runId: string,
    playerName: string,
): WeeklyBossState {
    if (boss.attemptRunReceipts?.[runId] !== playerName) return boss;
    const attemptRunReceipts = { ...(boss.attemptRunReceipts ?? {}) };
    delete attemptRunReceipts[runId];
    const used = boss.attemptsByPlayer?.[playerName] ?? 0;
    return {
        ...boss,
        attemptsByPlayer: { ...(boss.attemptsByPlayer ?? {}), [playerName]: Math.max(0, used - 1) },
        attemptRunReceipts,
    };
}

export function applyWeeklyBossRunDamageReceipt(
    boss: WeeklyBossState,
    runId: string,
    playerName: string,
    damage: number,
): { boss: WeeklyBossState; damage: number; replayed: boolean } {
    const prior = boss.bankedRunDamage?.[runId];
    if (Number.isFinite(prior)) {
        return { boss, damage: Math.max(0, Math.floor(Number(prior))), replayed: true };
    }
    const logged = Math.max(0, Math.floor(Number(damage) || 0));
    return {
        boss: {
            ...boss,
            damageByPlayer: {
                ...boss.damageByPlayer,
                [playerName]: (boss.damageByPlayer[playerName] ?? 0) + logged,
            },
            bankedRunDamage: { ...(boss.bankedRunDamage ?? {}), [runId]: logged },
        },
        damage: logged,
        replayed: false,
    };
}

function publicWeeklyBossState(boss: WeeklyBossState | null): Omit<WeeklyBossState, 'bankedRunDamage' | 'pendingRunDamage' | 'usageSettledRunReceipts' | 'discardedRunDamage' | 'attemptRunReceipts' | 'payoutMarkersAcknowledgedPlayers'> | null {
    if (!boss) return null;
    const {
        bankedRunDamage: _privateSettlementReceipts,
        pendingRunDamage: _privatePendingDamage,
        usageSettledRunReceipts: _privateUsageProofs,
        discardedRunDamage: _privateDiscardedDamage,
        attemptRunReceipts: _privateStartReceipts,
        payoutMarkersAcknowledgedPlayers: _privatePayoutMarkerAcks,
        ...publicState
    } = boss;
    return publicState;
}

const weeklyBossActiveRunKey = (playerName: string, bossStartedAt: number) =>
    `weekly-boss-active:${bossStartedAt}:${encodeURIComponent(playerName)}`;

async function setWeeklyValueConfirmed(
    key: string,
    value: unknown,
    options?: { ex?: number; nx?: boolean },
): Promise<void> {
    try {
        const acknowledged = await kv.set(key, value, options);
        if (acknowledged === 'OK') return;
    } catch (error) {
        const readback = await kv.get(key).catch(() => null);
        if (isDeepStrictEqual(readback, value)) return;
        throw error;
    }
    const readback = await kv.get(key).catch(() => null);
    if (!isDeepStrictEqual(readback, value)) throw new Error(`weekly-boss-write-unconfirmed:${key}`);
}

/** Exact predecessor transition for attempt, run, and damage authority. */
export async function compareWeeklyValueConfirmed(
    key: string,
    expected: unknown | null,
    value: unknown,
    options?: { ex?: number },
    store: Pick<KvLike, 'compareSet' | 'get'> = kv,
): Promise<boolean> {
    try {
        return await store.compareSet(key, expected, value, options) === true;
    } catch (error) {
        const readback = await store.get(key).catch(() => null);
        if (isDeepStrictEqual(readback, value)) return true;
        throw error;
    }
}

type WeeklyBossPayoutAckDeps = {
    credit?: typeof creditWeeklyBossPayout;
    acknowledge?: typeof acknowledgeWeeklyBossPayout;
    commitAcknowledged?: (boss: WeeklyBossState, playerNames: string[]) => Promise<WeeklyBossState>;
    now?: () => number;
};

/**
 * Recover the crash window after the boss row acknowledges a payout but before
 * the player's non-evicting payout marker is retired. The boss row tracks the
 * completed cleanup so ordinary leaderboard reads do not fan out across every
 * contributor forever.
 */
export async function reconcileWeeklyBossPayoutAcknowledgements(
    boss: WeeklyBossState,
    deps: WeeklyBossPayoutAckDeps = {},
): Promise<WeeklyBossState> {
    const creditedPlayers = new Set(boss.creditedPlayers ?? []);
    const acknowledgedPlayers = new Set(boss.payoutMarkersAcknowledgedPlayers ?? []);
    const pending = (boss.distributionSummary ?? []).filter((entry) => (
        creditedPlayers.has(entry.name) && !acknowledgedPlayers.has(entry.name)
    ));
    if (pending.length === 0) return boss;

    const credit = deps.credit ?? creditWeeklyBossPayout;
    const acknowledge = deps.acknowledge ?? acknowledgeWeeklyBossPayout;
    const now = deps.now?.() ?? Date.now();
    const completed: string[] = [];
    for (const entry of pending) {
        const payout: WeeklyBossPayout = {
            playerName: entry.name,
            weekKey: boss.weekKey,
            bossStartedAt: boss.startedAt,
            aiId: boss.aiId,
            ryo: entry.ryo,
            gotCore: entry.gotCore,
            gotKey: entry.gotKey,
        };
        try {
            // This is a replay for new settlements. It also safely migrates an
            // exact pre-cutover payout whose generic receipt was evicted.
            const ensured = await credit(payout, {
                recoverUntil: Math.max(boss.expiresAt, now) + 35 * 24 * 60 * 60 * 1_000,
                migrationOnly: true,
            });
            if (!ensured.ok) {
                if (ensured.status === 404
                    || ensured.error === 'The Weekly Boss payout has no exact save-side proof to migrate.') completed.push(entry.name);
                else console.warn(`[weekly-boss] payout marker recovery ${entry.name} remains pending: ${ensured.error}`);
                continue;
            }
            const retired = await acknowledge(payout);
            if (retired.ok) completed.push(entry.name);
            else console.warn(`[weekly-boss] payout acknowledgement ${entry.name} remains pending: ${retired.error}`);
        } catch (error) {
            console.warn(`[weekly-boss] payout acknowledgement ${entry.name} remains pending:`, error);
        }
    }
    if (completed.length === 0) return boss;

    if (deps.commitAcknowledged) return deps.commitAcknowledged(boss, completed);
    return withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
        const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
        // A reset may replace the old spawn after its creditedPlayers CAS. Its
        // player markers are already retired, and the replacement must never
        // be overwritten with old-spawn bookkeeping.
        if (!fresh
            || fresh.weekKey !== boss.weekKey
            || fresh.startedAt !== boss.startedAt
            || fresh.aiId !== boss.aiId) return boss;
        const merged = new Set([...(fresh.payoutMarkersAcknowledgedPlayers ?? []), ...completed]);
        const updated: WeeklyBossState = { ...fresh, payoutMarkersAcknowledgedPlayers: [...merged] };
        if (await compareWeeklyValueConfirmed(WEEKLY_BOSS_STATE_KEY, fresh, updated)) return updated;
        const raced = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
        if (!raced
            || raced.weekKey !== fresh.weekKey
            || raced.startedAt !== fresh.startedAt
            || raced.aiId !== fresh.aiId
            || completed.some((name) => !(raced.payoutMarkersAcknowledgedPlayers ?? []).includes(name))) {
            throw new Error('weekly-boss-payout-acknowledgement-conflict');
        }
        return raced;
    }, { failClosed: true });
}

function weeklyBossStartSeal(run: WeeklyBossAuthoritativeRun): WeeklyBossStartSeal {
    return {
        runId: run.runId,
        playerName: run.playerName,
        weekKey: run.weekKey,
        aiId: run.aiId,
        bossStartedAt: run.bossStartedAt,
        createdAt: run.createdAt,
        recoverUntil: run.createdAt + WEEKLY_BOSS_RUN_TTL_SECONDS * 1_000,
    };
}


// ISO week key, e.g. "2026-W21"
function isoWeekKey(d: Date = new Date()): string {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Display HP used by the leaderboard formula (ryo/xp scale off it). Kept
// for tuning even though the boss is now unkillable. Range: 50k → 150k.
function defaultBossHp(weekKey: string): number {
    const wk = parseInt(weekKey.split('-W')[1] ?? '1', 10);
    return 50000 + Math.min(53, wk) * 1900;
}

// Builtin weekly-boss roster — mirrors the client's builtin AIs
// (shinobij.client/src/lib/combat-ai.ts weeklyBossAis) and the schedule pool
// (lib/weekly-boss.ts weeklyBossPool). The server only needs each boss's id +
// name to seal into state; the client resolves the full profile + portrait by
// id (playableAis includes builtinAis). Kept in sync by hand — a small, rarely
// changing list. This is what makes "Spawn Now" work with no admin AI setup.
const BUILTIN_WEEKLY_BOSSES: Array<{ id: string; name: string }> = [
    { id: 'ashen-dragon', name: 'Ashen Dragon' },
    { id: 'moonshadow-oni', name: 'Moonshadow Oni' },
    { id: 'frostfang-warlord', name: 'Frostfang Warlord' },
    { id: 'stormveil-beast', name: 'Stormveil Beast' },
    { id: 'deathsgate-revenant', name: 'Deathsgate Revenant' },
];

// FNV-1a over the ISO week key — the SAME hash the client schedule uses
// (lib/weekly-boss.ts seededHash) so the boss the schedule teases for a given
// week is the one that actually spawns when there's no admin override.
function seededWeeklyBossIndex(weekKey: string, len: number): number {
    let hash = 2166136261;
    for (let i = 0; i < weekKey.length; i += 1) {
        hash ^= weekKey.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % Math.max(1, len);
}

async function pickDefaultBossAi(weekKey: string): Promise<{ aiId: string; bossName?: string } | null> {
    // Prefer admin-authored boss AIs from the canonical dual-read catalog.
    try {
        const list = [...(await loadAdminAiObjects()).values()];
        if (list.length > 0) {
            // Prefer boss AIs; otherwise any AI.
            const bosses = list.filter((profile) => profile.isBossAi === true);
            const pool = bosses.length > 0 ? bosses : list;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            return { aiId: pick.id, ...(typeof pick.name === 'string' ? { bossName: pick.name } : {}) };
        }
    } catch {
        // ignore
    }
    // Fall back to the builtin roster, seeded by ISO week so the pick is stable
    // within a week and matches the client's advertised schedule.
    const pick = BUILTIN_WEEKLY_BOSSES[seededWeeklyBossIndex(weekKey, BUILTIN_WEEKLY_BOSSES.length)];
    return { aiId: pick.id, bossName: pick.name };
}

async function buildFreshBossState(weekKey: string): Promise<WeeklyBossState | null> {
    // Honor admin override first.
    const overrideId = await kv.get<string>(WEEKLY_BOSS_OVERRIDE_KEY);
    let aiId = overrideId ?? '';
    let bossName: string | undefined;
    if (!aiId) {
        const pick = await pickDefaultBossAi(weekKey);
        if (!pick) return null;
        aiId = pick.aiId;
        bossName = pick.bossName;
    }
    const hpMax = defaultBossHp(weekKey);
    const startedAt = Date.now();
    return {
        weekKey,
        aiId,
        bossName,
        hpMax,
        hpRemaining: hpMax,
        scaleFactor: 1 + Math.min(53, parseInt(weekKey.split('-W')[1] ?? '1', 10)) * 0.04,
        damageByPlayer: {},
        attemptsByPlayer: {},
        startedAt,
        expiresAt: startedAt + WEEKLY_BOSS_LIFETIME_MS,
    };
}

async function loadOrInitBoss(): Promise<WeeklyBossState | null> {
    // ⚠ Admin-only spawn model: the boss is NEVER auto-created here.
    // Previously this function would auto-build a fresh boss whenever
    // no state existed for the current ISO week, but the project owner
    // wants full control over cadence — they decide "what's been a week"
    // and trigger spawns via POST { kind: "reset" } from the admin panel.
    // GET requests therefore return whatever state is in KV (or null if
    // no boss has ever been spawned).
    const existing = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
    if (!existing) return null;
    // Old saves predate expiresAt — backfill so the despawn logic has
    // something to compare against. Treats any pre-expiresAt boss as if
    // it started at its recorded startedAt.
    if (!existing.expiresAt) {
        existing.expiresAt = (existing.startedAt ?? Date.now()) + WEEKLY_BOSS_LIFETIME_MS;
    }
    return existing;
}

export function reconcileWeeklyBossDamageProofSnapshot(
    boss: WeeklyBossState,
    provenFingerprints: Readonly<Record<string, string>>,
    now: number,
    liveRunIds: ReadonlySet<string> = new Set(),
): { boss: WeeklyBossState; blocked: boolean } {
    let next = boss;
    let blocked = false;
    for (const [runId, pending] of Object.entries(boss.pendingRunDamage ?? {})) {
        if (provenFingerprints[runId] === pending.fingerprint) {
            const committed = commitWeeklyBossRunDamageSettlement(
                next,
                runId,
                pending.playerName,
                pending.damage,
                pending.fingerprint,
            );
            if (!committed) throw new Error('weekly-boss-pending-damage-proof-conflict');
            next = committed.boss;
            continue;
        }
        if (liveRunIds.has(runId)
            || now < Math.max(boss.expiresAt, pending.reservedAt) + WEEKLY_BOSS_DAMAGE_DRAIN_GRACE_MS) {
            blocked = true;
            continue;
        }
        const pendingRunDamage = { ...(next.pendingRunDamage ?? {}) };
        delete pendingRunDamage[runId];
        next = {
            ...next,
            pendingRunDamage,
            discardedRunDamage: { ...(next.discardedRunDamage ?? {}), [runId]: pending.damage },
        };
    }

    for (const [runId, damageRaw] of Object.entries(boss.bankedRunDamage ?? {})) {
        if (next.usageSettledRunReceipts?.[runId] || next.discardedRunDamage?.[runId] !== undefined) continue;
        const playerName = boss.attemptRunReceipts?.[runId];
        if (!playerName) throw new Error('weekly-boss-banked-damage-owner-missing');
        const damage = Math.max(0, Math.floor(Number(damageRaw) || 0));
        const expectedFingerprint = weeklyBossUsageFingerprint({
            runId,
            playerName,
            weekKey: boss.weekKey,
            aiId: boss.aiId,
            bossStartedAt: boss.startedAt,
            damage,
        });
        if (provenFingerprints[runId] === expectedFingerprint) {
            next = {
                ...next,
                usageSettledRunReceipts: { ...(next.usageSettledRunReceipts ?? {}), [runId]: expectedFingerprint },
            };
            continue;
        }
        // Old rolling workers wrote the aggregate before the save. Delay the
        // freeze long enough for every live writer/lock to drain, then remove
        // any contribution that still lacks exact save-side proof.
        if (liveRunIds.has(runId) || now < boss.expiresAt + WEEKLY_BOSS_DAMAGE_DRAIN_GRACE_MS) {
            blocked = true;
            continue;
        }
        next = {
            ...next,
            damageByPlayer: {
                ...next.damageByPlayer,
                [playerName]: Math.max(0, (next.damageByPlayer[playerName] ?? 0) - damage),
            },
            discardedRunDamage: { ...(next.discardedRunDamage ?? {}), [runId]: damage },
        };
    }
    return { boss: next, blocked };
}

async function readWeeklyBossDamageProofs(boss: WeeklyBossState): Promise<{
    proofs: Record<string, string>;
    liveRunIds: Set<string>;
}> {
    const proofs: Record<string, string> = {};
    const liveRunIds = new Set<string>();
    const runIds = new Set([
        ...Object.keys(boss.pendingRunDamage ?? {}),
        ...Object.keys(boss.bankedRunDamage ?? {}).filter((runId) => !boss.usageSettledRunReceipts?.[runId]),
    ]);
    for (const runId of runIds) {
        if (await kv.get(weeklyBossRunKey(runId)).catch(() => null)) liveRunIds.add(runId);
        const pending = boss.pendingRunDamage?.[runId];
        const playerName = pending?.playerName ?? boss.attemptRunReceipts?.[runId];
        const damage = pending?.damage ?? boss.bankedRunDamage?.[runId];
        if (!playerName || !Number.isFinite(damage)) continue;
        const fingerprint = pending?.fingerprint ?? weeklyBossUsageFingerprint({
            runId,
            playerName,
            weekKey: boss.weekKey,
            aiId: boss.aiId,
            bossStartedAt: boss.startedAt,
            damage: Number(damage),
        });
        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`).catch(() => null);
        const character = save?.character;
        if (!character || typeof character !== 'object' || Array.isArray(character)) continue;
        const markers = parseWeeklyBossUsageMarkers(character as Record<string, unknown>);
        const marker = markers?.find((entry) => entry.runId === runId);
        if (marker
            && marker.playerName === playerName
            && marker.weekKey === boss.weekKey
            && marker.aiId === boss.aiId
            && marker.bossStartedAt === boss.startedAt
            && marker.damage === Number(damage)
            && marker.fingerprint === fingerprint) {
            proofs[runId] = fingerprint;
            continue;
        }
        // Rolling old-worker proof: accept only the exact generic receipt,
        // including its damage value. Missing/evicted proof is quarantined.
        const legacy = inspectSettlementReceipt(
            character as Record<string, unknown>,
            `weeklyboss-${runId}`.slice(0, 80),
            `${boss.weekKey}:${boss.aiId}:${boss.startedAt}`,
        );
        if (legacy.status === 'replay' && Number(legacy.receipt.value.damage) === Number(damage)) {
            proofs[runId] = fingerprint;
        }
    }
    return { proofs, liveRunIds };
}

// Distribute rewards once the 72-hour boss window has elapsed. Idempotent + crash-resumable
// (audit #25):
//   1. Under the boss-lock, COMPUTE the distributionSummary (once) and persist
//      it WITHOUT setting rewardsDistributed. The reward amounts are frozen at
//      this point so a re-run never recomputes a different payout.
//   2. Outside the boss-lock, credit each contributor's save. Each successful
//      credit appends the player's name to creditedPlayers and persists it,
//      so a credit is recorded the moment it lands. Already-credited players
//      are skipped on re-entry — re-runs only retry the ones that didn't land.
//   3. Once every summary entry is credited, flip rewardsDistributed = true.
// If the process dies mid-credit, the next GET/POST re-enters and finishes the
// remaining credits instead of marking distributed up-front and stranding them.
async function distributeRewardsIfExpired(boss: WeeklyBossState): Promise<WeeklyBossState> {
    if (boss.rewardsDistributed) return reconcileWeeklyBossPayoutAcknowledgements(boss);
    if (Date.now() < boss.expiresAt) return boss;

    let summary: WeeklyBossRewardEntry[] | null = null;
    let finalBoss: WeeklyBossState = boss;

    // Phase 1 — compute + freeze the summary under the boss-lock (idempotent).
    await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
        let fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY) ?? boss;
        if (fresh.rewardsDistributed) {
            finalBoss = fresh;
            return;
        }
        if (Date.now() < fresh.expiresAt) {
            // Lost the expiry race — someone else extended somehow. Bail.
            finalBoss = fresh;
            return;
        }

        // Already computed on a prior (crashed) run — resume with the FROZEN
        // summary so payouts don't change between attempts.
        if (!fresh.damageProofsFrozenAt) {
            const proofEvidence = await readWeeklyBossDamageProofs(fresh);
            const reconciled = reconcileWeeklyBossDamageProofSnapshot(
                fresh, proofEvidence.proofs, Date.now(), proofEvidence.liveRunIds,
            );
            const damageChanged = !isDeepStrictEqual(reconciled.boss.damageByPlayer, fresh.damageByPlayer);
            let proofState = reconciled.boss;
            if (damageChanged && Array.isArray(fresh.distributionSummary)) {
                if ((fresh.creditedPlayers ?? []).length > 0) {
                    throw new Error('weekly-boss-legacy-summary-has-unproven-paid-damage');
                }
                const cleared = { ...proofState };
                delete cleared.distributionSummary;
                delete cleared.distributedAt;
                proofState = cleared;
            }
            if (!reconciled.blocked) proofState = { ...proofState, damageProofsFrozenAt: Date.now() };
            if (!isDeepStrictEqual(proofState, fresh)) {
                if (!(await compareWeeklyValueConfirmed(WEEKLY_BOSS_STATE_KEY, fresh, proofState))) {
                    throw new Error('weekly-boss-damage-proof-transition-conflict');
                }
                fresh = proofState;
            }
            if (reconciled.blocked) {
                finalBoss = fresh;
                return;
            }
        }

        if (Array.isArray(fresh.distributionSummary) && fresh.distributionSummary.length >= 0 && fresh.distributedAt) {
            summary = fresh.distributionSummary;
            finalBoss = fresh;
            return;
        }

        const entries = Object.entries(fresh.damageByPlayer)
            .sort(([, a], [, b]) => (b as number) - (a as number));
        const totalDmg = entries.reduce((sum, [, dmg]) => sum + (dmg as number), 0) || 1;
        const baseRyo = Math.floor(fresh.hpMax * 0.5);
        const baseXp = Math.floor(fresh.hpMax * 0.25);

        const computed: WeeklyBossRewardEntry[] = entries.map(([name, dmg], i) => {
            const share = (dmg as number) / totalDmg;
            const isMvp = i === 0;
            return {
                name,
                damage: dmg as number,
                rank: i + 1,
                // Character XP is retired (leveling-without-xp map): the old XP
                // share folds into ryo at ~0.75:1, and every contributor gets a
                // flat once-per-week stat-pool grant below (receipt-gated).
                ryo: Math.max(100, Math.floor(baseRyo * share * (isMvp ? 2 : 1) + 200))
                    + Math.floor(Math.max(50, Math.floor(baseXp * share * (isMvp ? 2 : 1) + 100)) * 0.75),
                xp: 0,
                gotCore: i < TOP_CORE_COUNT,
                gotKey: i < TOP_KEY_COUNT,
                isMvp,
            };
        });

        const updated: WeeklyBossState = {
            ...fresh,
            // NOT distributed yet — only after all credits succeed (phase 3).
            distributedAt: Date.now(),
            distributionSummary: computed,
            damageProofsFrozenAt: fresh.damageProofsFrozenAt ?? Date.now(),
            creditedPlayers: Array.isArray(fresh.creditedPlayers) ? fresh.creditedPlayers : [],
        };
        if (await compareWeeklyValueConfirmed(WEEKLY_BOSS_STATE_KEY, fresh, updated)) {
            summary = computed;
            finalBoss = updated;
            return;
        }
        const raced = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
        if (!raced
            || raced.weekKey !== fresh.weekKey
            || raced.startedAt !== fresh.startedAt
            || !Array.isArray(raced.distributionSummary)
            || !raced.distributedAt) throw new Error('weekly-boss-summary-transition-conflict');
        summary = raced.distributionSummary;
        finalBoss = raced;
    }, { failClosed: true });

    if (!summary) return finalBoss;

    // Phase 2 — credit each contributor outside the boss-lock. Per-save locks
    // are independent of the boss-lock and only serialize that player's own
    // concurrent saves. Bots / dead players (no save row) are marked credited
    // (nothing to pay) so they don't block phase-3 completion forever.
    const alreadyCredited = new Set<string>(finalBoss.creditedPlayers ?? []);
    const newlyCredited: string[] = [];
    const weekKey = finalBoss.weekKey;
    // Era contribution: one felled boss per exact spawn.
    try {
        const counted = await kv.set(`era:boss-counted:${weekKey}:${finalBoss.startedAt}`, true, { nx: true, ex: 35 * 24 * 60 * 60 });
        if (counted) await bumpEraContribution('bossKills');
    } catch { /* best-effort */ }
    for (const entry of summary as WeeklyBossRewardEntry[]) {
        if (alreadyCredited.has(entry.name)) continue;
        try {
            const payout: WeeklyBossPayout = {
                playerName: entry.name,
                weekKey,
                bossStartedAt: finalBoss.startedAt,
                aiId: finalBoss.aiId,
                ryo: entry.ryo,
                gotCore: entry.gotCore,
                gotKey: entry.gotKey,
            };
            const credited = await creditWeeklyBossPayout(payout, {
                recoverUntil: Math.max(finalBoss.expiresAt, Date.now()) + 35 * 24 * 60 * 60 * 1_000,
            });
            const did = credited.ok
                ? { complete: true, newlyApplied: !credited.replayed }
                : credited.status === 404
                    ? { complete: true, newlyApplied: false }
                    : (() => { throw new Error(`weekly-boss-player-credit-${credited.status}:${credited.error}`); })();
            if (did.complete) {
                newlyCredited.push(entry.name);
                // Legacy tracking (ENABLE_LEGACY): the weekly boss is the live
                // source for boss/event legacy proof — contribution damage,
                // top-10 placements, event participation, and (for the MVP) a
                // server-history first-clear. Rides the exactly-once receipt
                // above; best-effort by design.
                if (did.newlyApplied) {
                    await bumpLegacyStats(entry.name, {
                        bossContribution: Math.max(0, Math.floor(entry.damage ?? 0)),
                        eventCompletions: 1,
                        ...(entry.rank <= 10 ? { weeklyBossTop10: 1, eliteKills: 5 } : {}),
                        ...(entry.isMvp ? { firstClears: 1 } : {}),
                    });
                }
            }
        } catch (err) {
            // Leave this player OUT of creditedPlayers so a later run retries.
            console.warn(`[weekly-boss] credit ${entry.name} failed (will retry):`, err);
        }
    }

    // Phase 3 — persist receipts and, if everyone is now credited, flip the
    // distributed flag. Done under the boss-lock to avoid clobbering a
    // concurrent crediting pass.
    if (newlyCredited.length > 0 || !finalBoss.rewardsDistributed) {
        await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
            const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY) ?? finalBoss;
            if (fresh.weekKey !== finalBoss.weekKey
                || fresh.startedAt !== finalBoss.startedAt
                || fresh.aiId !== finalBoss.aiId) throw new Error('weekly-boss-credit-phase-stale-spawn');
            const credited = new Set<string>([...(fresh.creditedPlayers ?? []), ...newlyCredited]);
            const summaryNames = (fresh.distributionSummary ?? summary ?? []).map(e => e.name);
            const allDone = summaryNames.every(n => credited.has(n));
            const updated: WeeklyBossState = {
                ...fresh,
                creditedPlayers: [...credited],
                rewardsDistributed: allDone ? true : fresh.rewardsDistributed,
            };
            if (await compareWeeklyValueConfirmed(WEEKLY_BOSS_STATE_KEY, fresh, updated)) {
                finalBoss = updated;
                return;
            }
            const raced = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
            if (!raced
                || raced.weekKey !== fresh.weekKey
                || raced.startedAt !== fresh.startedAt
                || raced.aiId !== fresh.aiId
                || [...credited].some((name) => !(raced.creditedPlayers ?? []).includes(name))) {
                throw new Error('weekly-boss-credit-phase-conflict');
            }
            finalBoss = raced;
        }, { failClosed: true });
    }

    // Only the proven boss-row successor may retire a pending payout marker.
    // A crash anywhere in this cleanup is resumed from the boss-side tracking
    // field on the next GET/POST.
    return reconcileWeeklyBossPayoutAcknowledgements(finalBoss);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        let boss = await loadOrInitBoss();
        // Run the expiry check on read so the leaderboard reflects the
        // post-distribution state even if no one has attacked since the
        // 72-hour mark passed. Distribution is a no-op if already done.
        if (boss) boss = await distributeRewardsIfExpired(boss);
        res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
        return res.status(200).json({
            boss: publicWeeklyBossState(boss),
            fightEnabled: true,
            fightDisabledReason: null,
        });
    }

    if (req.method === 'POST') {
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { kind, weekKey } = body as { kind?: string; weekKey?: string };

            // reset CREATES or replaces the boss, so it must run BEFORE the
            // "no boss spawned" guard below — otherwise the very first spawn on a
            // fresh server (no state in KV yet) can never bootstrap: loadOrInitBoss
            // returns null → the guard 409s → the reset branch is never reached.
            if (kind === 'reset') {
                if (!identity.admin) return res.status(403).json({ error: 'Admin only.' });
                const nextWeekKey = isoWeekKey();
                let current = await loadOrInitBoss();
                if (current && Date.now() >= current.expiresAt) {
                    current = await distributeRewardsIfExpired(current);
                }
                const preliminaryConflict = current
                    ? weeklyBossResetConflict(current, Date.now(), nextWeekKey)
                    : null;
                if (preliminaryConflict) {
                    return res.status(409).json(preliminaryConflict);
                }
                const reset = await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
                    const predecessor = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
                    if (predecessor) {
                        const conflict = weeklyBossResetConflict(predecessor, Date.now(), nextWeekKey);
                        if (conflict) return { boss: null, conflict };
                    }
                    const next = await buildFreshBossState(nextWeekKey);
                    if (!next) return { boss: null, conflict: null };
                    if (!(await compareWeeklyValueConfirmed(WEEKLY_BOSS_STATE_KEY, predecessor, next))) {
                        return {
                            boss: null,
                            conflict: {
                                code: 'weekly-boss-settlement-pending' as const,
                                error: 'Weekly Boss state changed during reset. No boss was replaced; retry after settlement completes.',
                            },
                        };
                    }
                    return { boss: next, conflict: null };
                }, { failClosed: true });
                if (reset.conflict) return res.status(409).json(reset.conflict);
                const fresh = reset.boss;
                if (!fresh) return res.status(409).json({ error: 'No AI available for reset.' });
                // Herald the spawn server-wide: the world news feed AND a World
                // Herald line in every village chat (importance 'high' always
                // lands + broadcasts). Best-effort — announce() never throws into
                // the spawn. Every weekly-boss spawn heralds the hunt.
                await announce({
                    type: 'weekly_boss',
                    importance: 'high',
                    title: `⚔️ Weekly Boss: ${fresh.bossName ?? 'A great enemy'} has appeared!`,
                    message: `${fresh.bossName ?? 'A fearsome boss'} rampages for 72 hours. Seek it out and deal all the damage you can — the top damagers claim a Weekly Boss Core, Dungeon Keys, ryo, and stat points. Enter the hunt via Central Hub → Weekly Boss.`,
                    meta: { aiId: fresh.aiId, weekKey: fresh.weekKey, expiresAt: fresh.expiresAt },
                });
                return res.status(200).json({ boss: fresh });
            }

            let boss = await loadOrInitBoss();
            if (!boss) return res.status(409).json({ error: 'No boss is currently spawned. An admin needs to hit "Spawn Now" in the admin panel.' });
            if (weekKey && weekKey !== boss.weekKey) return res.status(409).json({ error: 'Stale week — boss has reset.' });

            // Auto-despawn + distribute. Any POST after the 72-hour mark
            // triggers reward distribution before refusing further input.
            if (Date.now() >= boss.expiresAt) {
                boss = await distributeRewardsIfExpired(boss);
                return res.status(409).json({ error: 'Boss despawned. Rewards have been distributed.', boss });
            }

            const actorName = identity.admin ? 'admin' : identity.name;
            if (kind === 'damage' || kind === 'logFightLegacy') {
                return res.status(410).json({
                    error: 'Client-reported Weekly Boss damage has been retired. Start a server-authoritative fight instead.',
                    code: 'weekly-boss-client-damage-retired',
                });
            }

            if (kind === 'startFight') {
                if (!identity.admin && await findTowerBattleStartConflict([actorName])) {
                    return res.status(409).json(towerBattleActiveErrorBody());
                }
                const activeKey = weeklyBossActiveRunKey(actorName, boss.startedAt);
                const started = await withKvLock(activeKey, async () => {
                    let runId = await kv.get<string>(activeKey);
                    let run = runId ? await kv.get<WeeklyBossAuthoritativeRun>(weeklyBossRunKey(runId)) : null;
                    let session = runId ? await readSoloPveSession(runId) : null;

                    const sameSpawn = Boolean(run && session
                        && run.playerName === actorName
                        && run.weekKey === boss!.weekKey
                        && run.aiId === boss!.aiId
                        && run.bossStartedAt === boss!.startedAt
                        && session.ownerSlug === actorName
                        && session.encounter.bindingId === run.runId);
                    if (runId && (!sameSpawn || run?.settledAt)) {
                        await kv.delIfEqual(activeKey, runId).catch(() => false);
                        runId = null;
                        run = null;
                        session = null;
                    }

                    const actorSave = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${actorName}`));
                    const actorChar = actorSave?.character as Record<string, unknown> | undefined;
                    if (!actorSave || !actorChar) return { status: 404 as const, body: { error: 'Player save not found.' } };

                    // A lost HTTP response or browser reload reconnects to the
                    // same ready run. No second attempt or stamina debit occurs.
                    if (run && session && run.startState !== 'prepared') {
                        let replayCharacter = actorChar;
                        let replaySaveVersion = Number(actorSave._saveVersion ?? 0);
                        if (!identity.admin) {
                            const finalized = await finalizeWeeklyBossStart(weeklyBossStartSeal(run));
                            if (!finalized.ok) return { status: finalized.status, body: { error: finalized.error } };
                            replayCharacter = finalized.character;
                            replaySaveVersion = finalized._saveVersion;
                        }
                        return { status: 200 as const, body: {
                            ok: true,
                            replayed: true,
                            runId: run.runId,
                            session,
                            character: replayCharacter,
                            _saveVersion: replaySaveVersion,
                            expiresInSeconds: WEEKLY_BOSS_RUN_TTL_SECONDS,
                        } };
                    }

                    if (!run || !session) {
                        const used = boss!.attemptsByPlayer?.[actorName] ?? 0;
                        if (!identity.admin && used >= WEEKLY_BOSS_MAX_ATTEMPTS) {
                            return { status: 429 as const, body: { error: `Locked out — you've used your ${WEEKLY_BOSS_MAX_ATTEMPTS} attempts for this boss spawn.` } };
                        }
                        if (!identity.admin && Number(actorChar.stamina ?? 0) < 20) {
                            return { status: 400 as const, body: { error: 'You need at least 20 stamina to challenge the weekly boss.' } };
                        }

                        const profile = (await loadAdminAiObjects()).get(boss!.aiId) ?? null;
                        runId = `weekly-${randomUUID().replace(/-/g, '')}`;
                        const now = Date.now();
                        const enemyTemplate = weeklyBossEnemyTemplate(profile, { id: boss!.aiId, name: boss!.bossName });
                        session = buildSoloPveAiEncounter({
                            sessionId: runId,
                            playerName: actorName,
                            save: actorSave,
                            now,
                            profile: { id: boss!.aiId, ...enemyTemplate },
                            admin: await loadAdminCombatContent(),
                            hostLoadout: body.hostLoadout && typeof body.hostLoadout === 'object' ? body.hostLoadout : undefined,
                            difficultyMode: false,
                            encounter: {
                                kind: 'weekly-boss',
                                id: boss!.weekKey,
                                sourceId: boss!.aiId,
                                bindingId: runId,
                                metadata: { weekKey: boss!.weekKey, bossStartedAt: boss!.startedAt },
                            },
                            environment: { biome: 'central' },
                            weeklyBossRoundBudget: 20,
                            activeTtlSeconds: WEEKLY_BOSS_RUN_TTL_SECONDS,
                        });
                        // The generic builder intentionally caps ordinary AI HP.
                        // Weekly Boss is a score attack, so restore its sentinel.
                        session.enemy.hp = Math.max(1, Math.floor(enemyTemplate.hp));
                        session.enemy.maxHp = session.enemy.hp;
                        if (!weeklyBossGuardEnabled() && session.weeklyBossGuard) session.weeklyBossGuard.mechanicsEnabled = false;
                        run = {
                            runId,
                            playerName: actorName,
                            weekKey: boss!.weekKey,
                            aiId: boss!.aiId,
                            bossStartedAt: boss!.startedAt,
                            initialBossHp: session.enemy.hp,
                            createdAt: now,
                            startState: 'prepared',
                        };
                        // Persist the prepared session and active pointer before
                        // any debit. A crash from this point is resumable.
                        await writeSoloPveSession(session);
                        if (!(await compareWeeklyValueConfirmed(
                            weeklyBossRunKey(runId),
                            null,
                            run,
                            { ex: WEEKLY_BOSS_RUN_TTL_SECONDS },
                        ))) {
                            const readback = await kv.get<WeeklyBossAuthoritativeRun>(weeklyBossRunKey(runId));
                            if (!isDeepStrictEqual(readback, run)) throw new Error('weekly-boss-prepared-run-conflict');
                        }
                        if (!(await compareWeeklyValueConfirmed(
                            activeKey,
                            null,
                            runId,
                            { ex: WEEKLY_BOSS_RUN_TTL_SECONDS },
                        ))) {
                            if (await kv.get<string>(activeKey) !== runId) throw new Error('weekly-boss-active-run-conflict');
                        }
                    }

                    const preparedRun = structuredClone(run);
                    const preparedSession = structuredClone(session);

                    const reserved = await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
                        const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
                        if (!fresh || fresh.weekKey !== run!.weekKey || fresh.startedAt !== run!.bossStartedAt) return null;
                        const applied = reserveWeeklyBossAttemptReceipt(fresh, run!.runId, actorName, !identity.admin);
                        if (applied && !applied.replayed) {
                            if (!(await compareWeeklyValueConfirmed(WEEKLY_BOSS_STATE_KEY, fresh, applied.boss))) {
                                const latest = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
                                if (!latest || reserveWeeklyBossAttemptReceipt(latest, run!.runId, actorName, !identity.admin)?.replayed !== true) {
                                    throw new Error('weekly-boss-attempt-reservation-conflict');
                                }
                                return { boss: latest, replayed: true };
                            }
                        }
                        return applied;
                    }, { failClosed: true });
                    if (!reserved) {
                        await kv.delIfEqual(activeKey, run.runId).catch(() => false);
                        return { status: 409 as const, body: { error: 'The boss reset or your attempts were already used.' } };
                    }

                    let updatedCharacter = actorChar;
                    let saveVersion = Number(actorSave._saveVersion ?? 0);
                    if (!identity.admin) {
                        const staminaCharge = await chargeWeeklyBossStart(weeklyBossStartSeal(run));
                        if (!staminaCharge.ok) {
                            await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
                                const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
                                if (fresh) {
                                    const rolledBack = rollbackWeeklyBossAttemptReceipt(fresh, run!.runId, actorName);
                                    if (!isDeepStrictEqual(rolledBack, fresh)
                                        && !(await compareWeeklyValueConfirmed(WEEKLY_BOSS_STATE_KEY, fresh, rolledBack))) {
                                        throw new Error('weekly-boss-attempt-rollback-conflict');
                                    }
                                }
                            }, { failClosed: true });
                            await kv.delIfEqual(activeKey, run.runId).catch(() => false);
                            return { status: staminaCharge.status, body: { error: staminaCharge.error } };
                        }
                        updatedCharacter = staminaCharge.character;
                        saveVersion = staminaCharge._saveVersion;
                        session = {
                            ...session,
                            player: { ...session.player, stamina: Math.max(0, Number(updatedCharacter.stamina ?? 0)) },
                        };
                    }

                    if (!(await compareWriteSoloPveSession(preparedSession, session))) {
                        const readback = await readSoloPveSession(session.sessionId);
                        if (!isDeepStrictEqual(readback, session)) throw new Error('weekly-boss-ready-session-conflict');
                        session = readback;
                    }
                    run = { ...run, startState: 'ready' };
                    if (!(await compareWeeklyValueConfirmed(
                        weeklyBossRunKey(run.runId),
                        preparedRun,
                        run,
                        { ex: WEEKLY_BOSS_RUN_TTL_SECONDS },
                    ))) {
                        const readback = await kv.get<WeeklyBossAuthoritativeRun>(weeklyBossRunKey(run.runId));
                        if (!readback || !isDeepStrictEqual(readback, run)) throw new Error('weekly-boss-ready-run-conflict');
                        run = readback;
                    }
                    if (!identity.admin) {
                        const finalized = await finalizeWeeklyBossStart(weeklyBossStartSeal(run!));
                        if (!finalized.ok) return { status: finalized.status, body: { error: finalized.error } };
                        updatedCharacter = finalized.character;
                        saveVersion = finalized._saveVersion;
                    }
                    return { status: 200 as const, body: {
                        ok: true,
                        runId: run!.runId,
                        session,
                        character: updatedCharacter,
                        _saveVersion: saveVersion,
                        expiresInSeconds: WEEKLY_BOSS_RUN_TTL_SECONDS,
                    } };
                }, { failClosed: true, ttlSec: 30 });
                return res.status(started.status).json(started.body);
            }

            if (kind === 'logFight') {
                const runId = String(body.runId ?? '').slice(0, 96);
                if (!runId) return res.status(400).json({ error: 'Missing Weekly Boss run.' });

                const result = await withKvLock(weeklyBossRunKey(runId), async () => {
                    const run = await kv.get<WeeklyBossAuthoritativeRun>(weeklyBossRunKey(runId));
                    if (!run) return { status: 404 as const, body: { error: 'Weekly Boss run not found or expired.' } };
                    if (!identity.admin && run.playerName !== actorName) return { status: 403 as const, body: { error: 'That Weekly Boss run belongs to another player.' } };
                    if (run.settledAt) {
                        const current = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY) ?? boss!;
                        return { status: 200 as const, body: { ok: true, alreadySettled: true, boss: publicWeeklyBossState(current), dealt: 0, attemptsUsed: current.attemptsByPlayer?.[run.playerName] ?? 0 } };
                    }
                    let session = await readSoloPveSession(runId);
                    const validation = validateAuthoritativeWeeklyBossRun({
                        run,
                        session,
                        playerName: actorName,
                        admin: identity.admin,
                        boss: { weekKey: boss!.weekKey, aiId: boss!.aiId, startedAt: boss!.startedAt },
                    });
                    if (!validation.ok) {
                        const status = validation.reason === 'wrong-player' || validation.reason === 'not-a-member' ? 403
                            : validation.reason === 'stale-boss' ? 409
                            : validation.reason === 'not-finished' ? 400
                            : validation.reason === 'missing-boss' ? 500
                            : 404;
                        return { status, body: { error: `Weekly Boss settlement rejected: ${validation.reason}.` } };
                    }
                    const usageAuthority = await settleSoloPveTerminalUsage(session!, run.playerName);
                    if (!usageAuthority.ok) return { status: usageAuthority.status, body: { error: usageAuthority.error } };
                    session = usageAuthority.session;
                    const logged = validation.damage;
                    const usageFingerprint = weeklyBossUsageFingerprint({
                        runId,
                        playerName: run.playerName,
                        weekKey: run.weekKey,
                        aiId: run.aiId,
                        bossStartedAt: run.bossStartedAt,
                        damage: logged,
                    });
                    const reserved = await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
                        const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY) ?? boss!;
                        if (fresh.weekKey !== run.weekKey || fresh.startedAt !== run.bossStartedAt) return null;
                        if (fresh.rewardsDistributed || fresh.damageProofsFrozenAt || Date.now() >= fresh.expiresAt) return null;
                        const applied = reserveWeeklyBossRunDamageSettlement(
                            fresh, runId, run.playerName, logged, usageFingerprint, Date.now(),
                        );
                        if (!applied) return null;
                        if (!isDeepStrictEqual(applied.boss, fresh)
                            && !(await compareWeeklyValueConfirmed(WEEKLY_BOSS_STATE_KEY, fresh, applied.boss))) {
                            const latest = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
                            if (!latest || latest.weekKey !== run.weekKey || latest.startedAt !== run.bossStartedAt) return null;
                            const replay = reserveWeeklyBossRunDamageSettlement(
                                latest, runId, run.playerName, logged, usageFingerprint, Date.now(),
                            );
                            if (!replay?.replayed) throw new Error('weekly-boss-damage-reservation-conflict');
                            return replay;
                        }
                        return applied;
                    }, { failClosed: true });
                    if (!reserved) return { status: 409 as const, body: { error: 'Boss despawned or reset before settlement.' } };
                    const settlementId = `weeklyboss-${runId}`.slice(0, 80);
                    const fingerprint = `${run.weekKey}:${run.aiId}:${run.bossStartedAt}`;
                    const usageSettlement = await mutatePlayerSave(run.playerName, ({ character }) => {
                        const usageMarkers = parseWeeklyBossUsageMarkers(character);
                        if (!usageMarkers) return { ok: false as const, status: 409, error: 'weekly-boss-usage-authority-invalid' };
                        const priorUsage = usageMarkers.find((entry) => entry.runId === runId);
                        if (priorUsage) {
                            if (priorUsage.playerName !== run.playerName
                                || priorUsage.weekKey !== run.weekKey
                                || priorUsage.aiId !== run.aiId
                                || priorUsage.bossStartedAt !== run.bossStartedAt
                                || priorUsage.damage !== logged
                                || priorUsage.fingerprint !== usageFingerprint) {
                                return { ok: false as const, status: 409, error: 'weekly-boss-usage-authority-conflict' };
                            }
                            return { ok: true as const, character, value: { replayed: true }, write: false as const };
                        }
                        const inspected = inspectSettlementReceipt(character, settlementId, fingerprint);
                        if (inspected.status === 'conflict' || inspected.status === 'invalid') {
                            return { ok: false as const, status: 409, error: 'weekly-boss-receipt-conflict' };
                        }
                        if (inspected.status === 'replay' && Number(inspected.receipt.value.damage) !== logged) {
                            return { ok: false as const, status: 409, error: 'weekly-boss-receipt-damage-conflict' };
                        }
                        const now = Date.now();
                        const marker: WeeklyBossUsageSettlementMarker = {
                            version: 1,
                            runId,
                            playerName: run.playerName,
                            weekKey: run.weekKey,
                            aiId: run.aiId,
                            bossStartedAt: run.bossStartedAt,
                            damage: logged,
                            fingerprint: usageFingerprint,
                            settledAt: inspected.status === 'replay' ? inspected.receipt.settledAt : now,
                            recoverUntil: Math.max(reserved.boss.expiresAt, now) + WEEKLY_BOSS_USAGE_RECOVERY_MS,
                        };
                        const nextUsageMarkers = appendWeeklyBossUsageMarker(usageMarkers, marker, now);
                        if (!nextUsageMarkers) return { ok: false as const, status: 429, error: 'weekly-boss-usage-authority-busy' };
                        const base = inspected.status === 'replay'
                            ? character
                            : applyAiFightOutcomeToCharacter(
                                applySoloPveUsageCosts(character, session!),
                                resolveAiFightOutcome(session!),
                                session!.player,
                                now,
                            );
                        const withReceipt = inspected.status === 'replay'
                            ? base
                            : appendSettlementReceipt(base, inspected.receipts, {
                                requestId: settlementId,
                                fingerprint,
                                value: { damage: logged },
                                settledAt: now,
                            });
                        return {
                            ok: true as const,
                            character: { ...withReceipt, [WEEKLY_BOSS_USAGE_SETTLEMENTS_FIELD]: nextUsageMarkers },
                            value: { replayed: inspected.status === 'replay' },
                        };
                    });
                    if (!usageSettlement.ok) return { status: usageSettlement.status, body: { error: 'Weekly Boss usage settlement could not be committed.' } };
                    const banked = await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
                        const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY) ?? reserved.boss;
                        if (fresh.weekKey !== run.weekKey || fresh.startedAt !== run.bossStartedAt) return null;
                        const applied = commitWeeklyBossRunDamageSettlement(
                            fresh, runId, run.playerName, logged, usageFingerprint,
                        );
                        if (!applied) return null;
                        if (fresh.damageProofsFrozenAt
                            && (!applied.replayed || !isDeepStrictEqual(applied.boss, fresh))) return null;
                        if (!isDeepStrictEqual(applied.boss, fresh)
                            && !(await compareWeeklyValueConfirmed(WEEKLY_BOSS_STATE_KEY, fresh, applied.boss))) {
                            const latest = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
                            if (!latest || latest.weekKey !== run.weekKey || latest.startedAt !== run.bossStartedAt) return null;
                            const replay = commitWeeklyBossRunDamageSettlement(
                                latest, runId, run.playerName, logged, usageFingerprint,
                            );
                            if (!replay?.replayed) throw new Error('weekly-boss-damage-commit-conflict');
                            return replay;
                        }
                        return applied;
                    }, { failClosed: true });
                    if (!banked) return { status: 409 as const, body: { error: 'Weekly Boss reward distribution froze before this proven contribution could be banked.' } };
                    const settledSession = withSoloPveSettlementReceipt(session!, {
                        kind: 'weekly-boss',
                        id: runId,
                        settledAt: Date.now(),
                        rewards: { damage: banked.damage },
                    });
                    if (!(await compareWriteSoloPveSession(session!, settledSession))) {
                        const readback = await readSoloPveSession(runId);
                        if (!readback
                            || readback.settlementState !== 'settled'
                            || readback.terminalEvidence?.receipt?.kind !== 'weekly-boss'
                            || readback.terminalEvidence.receipt.id !== runId) {
                            throw new Error('weekly-boss-session-settlement-conflict');
                        }
                    }
                    const settledRun = { ...run, settledAt: Date.now() };
                    if (!(await compareWeeklyValueConfirmed(
                        weeklyBossRunKey(runId),
                        run,
                        settledRun,
                        { ex: WEEKLY_BOSS_RUN_TTL_SECONDS },
                    ))) {
                        const readback = await kv.get<WeeklyBossAuthoritativeRun>(weeklyBossRunKey(runId));
                        if (!readback?.settledAt) throw new Error('weekly-boss-run-settlement-conflict');
                    }
                    const activeKey = weeklyBossActiveRunKey(run.playerName, run.bossStartedAt);
                    await kv.delIfEqual(activeKey, runId).catch(() => false);
                    return { status: 200 as const, body: {
                        ok: true,
                        boss: publicWeeklyBossState(banked.boss),
                        dealt: banked.damage,
                        alreadySettled: banked.replayed && usageSettlement.value.replayed,
                        attemptsUsed: banked.boss.attemptsByPlayer?.[run.playerName] ?? 0,
                        character: usageSettlement.character,
                        _saveVersion: usageSettlement._saveVersion,
                    } };
                }, { failClosed: true });
                return res.status(result.status).json(result.body);
            }

            if (kind === 'claim') {
                // Legacy endpoint. Rewards are now auto-distributed at the
                // 72-hour despawn (see distributeRewardsIfExpired). Return the
                // player's summary entry if it exists so old clients can
                // still display it; otherwise tell them rewards aren't ready.
                if (!boss.rewardsDistributed) {
                    return res.status(409).json({ error: 'Boss is still alive — rewards distribute automatically when it despawns.' });
                }
                const entry = (boss.distributionSummary ?? []).find(e => e.name === actorName);
                if (!entry) return res.status(403).json({ error: 'You did not damage this boss.' });
                return res.status(200).json({ boss, reward: entry, note: 'Rewards were already credited to your save.' });
            }

            return res.status(400).json({ error: 'Unknown kind.' });
        } catch (err) {
            console.error('[weekly-boss]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
