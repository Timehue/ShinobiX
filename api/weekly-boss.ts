import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv } from './_storage.js';
import { cors, mergePreservingImages } from './_utils.js';
import { authedPlayerOrAdmin, isFullAdmin } from './_auth.js';
import { LockContendedError, withKvLock } from './_lock.js';
import { applyDerivedLevel, type XpCharacter } from './_xp-engine.js';
import { bumpSaveVersion } from './save/_save-version.js';
import { bumpLegacyStats } from './_legacy-track.js';
import { bumpEraContribution } from './_era.js';
import { announce } from './_announce.js';
import { createHash, randomUUID } from 'node:crypto';
import { weeklyBossGuardEnabled } from './_release-flags.js';
import { weeklyBossEnemyTemplate } from './_authoritative-pve.js';
import { loadAdminCombatContent } from './_admin-content.js';
import { loadAdminAiObjects } from './_admin-ai-catalog.js';
import { buildSoloPveAiEncounter } from './solo-pve/_ai-encounter.js';
import type { SoloPveSession } from './solo-pve/_session.js';
import { readSoloPveSession, soloPveSessionKey, writeSoloPveSession } from './solo-pve/_store.js';
import { applySoloPveUsageCosts, withSoloPveSettlementReceipt } from './solo-pve/_settlement.js';
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
// Reward tier cutoffs by damage rank (1-indexed in the natural reading).
// Once-per-week stat-pool grant for every contributor (leveling-without-xp
// map §4: weekly cadence, outside the daily checklist, exactly-once via the
// per-(week,player) credit receipt).
const WEEKLY_BOSS_STAT_POINTS = 10;
const TOP_CORE_COUNT = 10;  // ranks 1..10 each receive 1 Weekly Boss Core
const TOP_KEY_COUNT = 25;   // ranks 1..25 each receive 1 Dungeon Key
const WEEKLY_BOSS_CORE_ID = 'weekly-boss-core';
const DUNGEON_KEY_ID = 'dungeon-key';
/*
 * The Hollow-Gate Cinder is the one relic the world does NOT give up from the
 * ground — it fell out of a rift, so it comes off the Weekly Boss instead of an
 * Ancient Chest (every other relic is biome-locked to chests, see
 * api/world/_chest.ts RELICS_BY_BIOME). Restricted to the same top-10 cohort as
 * the Core and rolled at WEEKLY_BOSS_RELIC_CHANCE, i.e. under one a week across
 * the whole server.
 *
 * The roll is a stable HASH of (week, boss, player), never live RNG: this
 * settlement is receipt-guarded and may be recomputed on a retry, and a fresh
 * random each time would let a player re-roll a loss. Same input, same answer,
 * forever.
 */
const WEEKLY_BOSS_RELIC_ID = 'relic-hollow-gate-cinder';
const WEEKLY_BOSS_RELIC_CHANCE = 0.08;
/** Matches DUPLICATE_RELIC_FATE_SHARDS in api/world/_chest.ts. */
const DUPLICATE_RELIC_FATE_SHARDS = 15;

function weeklyBossRelicRoll(weekKey: string, aiId: string, name: string): boolean {
    const digest = createHash('sha256').update(`relic:${weekKey}:${aiId}:${name}`).digest();
    // First 4 bytes → a uniform [0,1). Deterministic across processes and retries.
    return digest.readUInt32BE(0) / 0x1_0000_0000 < WEEKLY_BOSS_RELIC_CHANCE;
}

type WeeklyBossRewardEntry = {
    name: string;
    damage: number;
    rank: number;
    ryo: number;
    xp: number;
    gotCore: boolean;
    gotKey: boolean;
    gotRelic: boolean;
    isMvp: boolean;
};

export function applyWeeklyBossReward(
    character: Record<string, unknown>,
    weekKey: string,
    aiId: string,
    entry: Pick<WeeklyBossRewardEntry, 'name' | 'ryo' | 'gotCore' | 'gotKey' | 'gotRelic'>,
    now = Date.now(),
): { character: Record<string, unknown>; alreadyApplied: boolean } {
    // The event can be administratively respawned, but its economy authority
    // remains weekly: a replacement generation must never mint a second pool
    // grant, Core, or Dungeon Key for the same contributor in the ISO week.
    const receiptId = `weeklyboss_${createHash('sha256').update(`${weekKey}:${entry.name}`).digest('hex').slice(0, 32)}`;
    const priorKills = character.weeklyBossKills && typeof character.weeklyBossKills === 'object'
        ? character.weeklyBossKills as Record<string, unknown>
        : {};
    if (Object.prototype.hasOwnProperty.call(priorKills, weekKey)) {
        return { character, alreadyApplied: true };
    }
    const fingerprint = `weekly-boss:${weekKey}`;
    const inspected = inspectSettlementReceipt(character, receiptId, fingerprint);
    if (inspected.status === 'replay') return { character, alreadyApplied: true };
    if (inspected.status !== 'fresh') throw new Error(`weekly-boss-receipt-${inspected.status}`);

    const inventory = Array.isArray(character.inventory) ? [...(character.inventory as string[])] : [];
    if (entry.gotCore) inventory.push(WEEKLY_BOSS_CORE_ID);
    if (entry.gotKey) inventory.push(DUNGEON_KEY_ID);
    // A relic is unique gear: a second copy is worthless, so a duplicate pays
    // Fate Shards instead of vanishing (same rule as the chest faucet).
    const duplicateRelic = entry.gotRelic && inventory.includes(WEEKLY_BOSS_RELIC_ID);
    if (entry.gotRelic && !duplicateRelic) inventory.push(WEEKLY_BOSS_RELIC_ID);
    const leveled = applyDerivedLevel({
        ...character,
        unspentStats: Math.max(0, Math.floor(Number(character.unspentStats) || 0)) + WEEKLY_BOSS_STAT_POINTS,
    } as unknown as XpCharacter) as unknown as Record<string, unknown>;
    const credited = {
        ...character,
        unspentStats: leveled.unspentStats,
        level: leveled.level,
        maxHp: leveled.maxHp,
        maxChakra: leveled.maxChakra,
        maxStamina: leveled.maxStamina,
        hp: leveled.hp,
        chakra: leveled.chakra,
        stamina: leveled.stamina,
        rankTitle: leveled.rankTitle,
        ryo: Math.max(0, Number(character.ryo ?? 0)) + entry.ryo,
        ...(duplicateRelic
            ? { fateShards: Math.max(0, Number(character.fateShards) || 0) + DUPLICATE_RELIC_FATE_SHARDS }
            : {}),
        inventory,
        weeklyBossKills: {
            ...priorKills,
            [weekKey]: aiId,
        },
    };
    return {
        character: appendSettlementReceipt(credited, inspected.receipts, {
            requestId: receiptId,
            fingerprint,
            value: { weekKey, ryo: entry.ryo, gotCore: entry.gotCore, gotKey: entry.gotKey, gotRelic: entry.gotRelic },
            settledAt: now,
        }),
        alreadyApplied: false,
    };
}

export type WeeklyBossState = {
    /** Immutable identity for this exact admin spawn. Legacy states without the
     * field receive a deterministic read-only identity via
     * weeklyBossSpawnIdentity so reset/distribution CAS remains compatible. */
    readonly spawnId?: string;
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
    // Per-player credit receipts (audit #25). Names whose save credit has
    // durably succeeded. `rewardsDistributed` is only flipped true once every
    // entry in distributionSummary appears here, so a crash mid-credit leaves
    // the boss in a "summary computed, some credited" state that the next
    // GET/POST resumes — instead of marking distributed up-front and silently
    // skipping survivors forever.
    creditedPlayers?: string[];
    /** Per-spawn authoritative contribution receipts. Kept with the aggregate
     * so banking damage and its idempotency marker are one atomic KV write. */
    bankedRunDamage?: Record<string, number>;
    /** Run IDs whose attempt debit is already reflected in attemptsByPlayer.
     * This makes a prepared start resumable without spending a second attempt. */
    attemptRunReceipts?: Record<string, string>;
};

type WeeklyBossIdentityFields = Pick<WeeklyBossState, 'spawnId' | 'weekKey' | 'aiId' | 'startedAt'>;

export function weeklyBossSpawnIdentity(boss: WeeklyBossIdentityFields): string {
    const explicit = typeof boss.spawnId === 'string' ? boss.spawnId.trim() : '';
    if (explicit) return explicit;
    const legacyIdentity = `${boss.weekKey}\u0000${boss.aiId}\u0000${boss.startedAt}`;
    return `legacy-${createHash('sha256').update(legacyIdentity).digest('hex').slice(0, 32)}`;
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

function publicWeeklyBossState(boss: WeeklyBossState | null): (Omit<WeeklyBossState, 'bankedRunDamage' | 'attemptRunReceipts'> & { spawnId: string }) | null {
    if (!boss) return null;
    const {
        bankedRunDamage: _privateSettlementReceipts,
        attemptRunReceipts: _privateStartReceipts,
        ...publicState
    } = boss;
    return { ...publicState, spawnId: weeklyBossSpawnIdentity(boss) };
}

const weeklyBossActiveRunKey = (playerName: string, bossStartedAt: number) =>
    `weekly-boss-active:${bossStartedAt}:${encodeURIComponent(playerName)}`;

type WeeklyBossRecoveryProbe =
    | { state: 'ready'; runId: string; session: SoloPveSession; character: Record<string, unknown>; saveVersion: number }
    | { state: 'prepared'; runId: string };

function isCurrentWeeklyBossRun(params: {
    activeRunId: string;
    run: WeeklyBossAuthoritativeRun | null;
    session: SoloPveSession | null;
    playerName: string;
    boss: WeeklyBossState;
}): params is typeof params & { run: WeeklyBossAuthoritativeRun; session: SoloPveSession } {
    const { activeRunId, run, session, playerName, boss } = params;
    return Boolean(run && session
        && run.runId === activeRunId
        && run.playerName === playerName
        && run.weekKey === boss.weekKey
        && run.aiId === boss.aiId
        && run.bossStartedAt === boss.startedAt
        && !run.settledAt
        && session.runtime === 'solo-pve'
        && session.ownerSlug === playerName
        && session.encounter.kind === 'weekly-boss'
        && session.encounter.bindingId === run.runId
        && session.encounter.sourceId === run.aiId
        && session.encounter.metadata?.weekKey === run.weekKey
        && Number(session.encounter.metadata?.bossStartedAt) === run.bossStartedAt);
}

/** Read-only discovery for a lost Weekly Boss start response. It deliberately
 * receives no writer and never repairs stale pointers: a probe may reveal an
 * accepted run, but it cannot mint a run, reserve an attempt, or debit stamina. */
async function probeWeeklyBossRecovery(playerName: string, boss: WeeklyBossState): Promise<WeeklyBossRecoveryProbe | null> {
    const activeRunId = await kv.get<string>(weeklyBossActiveRunKey(playerName, boss.startedAt));
    if (!activeRunId) return null;
    const [run, session] = await Promise.all([
        kv.get<WeeklyBossAuthoritativeRun>(weeklyBossRunKey(activeRunId)),
        readSoloPveSession(activeRunId),
    ]);
    const candidate = { activeRunId, run, session, playerName, boss };
    if (!isCurrentWeeklyBossRun(candidate)) return null;
    if (candidate.run.startState === 'prepared') return { state: 'prepared', runId: activeRunId };

    const actorSave = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${playerName}`));
    const character = actorSave?.character as Record<string, unknown> | undefined;
    if (!actorSave || !character) return null;
    return {
        state: 'ready',
        runId: activeRunId,
        session: candidate.session,
        character,
        saveVersion: Number(actorSave._saveVersion ?? 0),
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

async function buildFreshBossState(weekKey: string, spawnId: string): Promise<WeeklyBossState | null> {
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
        spawnId,
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
    if (boss.rewardsDistributed) return boss;
    if (Date.now() < boss.expiresAt) return boss;

    const distributionSpawnId = weeklyBossSpawnIdentity(boss);
    let summary: WeeklyBossRewardEntry[] | null = null;
    let finalBoss: WeeklyBossState = boss;

    // Phase 1 — compute + freeze the summary under the boss-lock (idempotent).
    await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
        const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
        if (!fresh) return;
        if (weeklyBossSpawnIdentity(fresh) !== distributionSpawnId) {
            finalBoss = fresh;
            return;
        }
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
                gotRelic: i < TOP_CORE_COUNT && weeklyBossRelicRoll(fresh.weekKey, fresh.aiId, name),
                isMvp,
            };
        });

        const updated: WeeklyBossState = {
            ...fresh,
            // NOT distributed yet — only after all credits succeed (phase 3).
            distributedAt: Date.now(),
            distributionSummary: computed,
            creditedPlayers: Array.isArray(fresh.creditedPlayers) ? fresh.creditedPlayers : [],
        };
        await kv.set(WEEKLY_BOSS_STATE_KEY, updated);
        summary = computed;
        finalBoss = updated;
    }, { failClosed: true });

    if (!summary) return finalBoss;

    // Phase 2 — credit each contributor outside the boss-lock. Per-save locks
    // are independent of the boss-lock and only serialize that player's own
    // concurrent saves. Bots / dead players (no save row) are marked credited
    // (nothing to pay) so they don't block phase-3 completion forever.
    const alreadyCredited = new Set<string>(finalBoss.creditedPlayers ?? []);
    const newlyCredited: string[] = [];
    const weekKey = finalBoss.weekKey;
    // Era contribution is weekly even if staff replace the active generation.
    try {
        const counted = await kv.set(`era:boss-counted:${weekKey}`, true, { nx: true, ex: 35 * 24 * 60 * 60 });
        if (counted) await bumpEraContribution('bossKills');
    } catch { /* best-effort */ }
    for (const entry of summary as WeeklyBossRewardEntry[]) {
        if (alreadyCredited.has(entry.name)) continue;
        try {
            const did = await withKvLock(saveKeyCreditScope(entry.name), async () => {
                const saveKey = `save:${entry.name}`;
                const fresh = await kv.get<Record<string, unknown>>(saveKey);
                const freshChar = fresh?.character as Record<string, unknown> | undefined;
                if (!fresh || !freshChar) return { complete: true, newlyApplied: false }; // no save → nothing to credit; count as done

                // Exactly-once is proven by a receipt committed in the same
                // save write as the payout. A separate NX reservation is not
                // sufficient: a process stop between that reservation and this
                // write permanently burns the reward.
                // Character XP is retired: contributors receive a flat weekly
                // stat-pool grant. The helper commits that grant, items, ryo,
                // and its idempotency receipt in this one player-save write.
                const applied = applyWeeklyBossReward(
                    freshChar,
                    weekKey,
                    finalBoss.aiId,
                    entry,
                    Date.now(),
                );
                if (applied.alreadyApplied) return { complete: true, newlyApplied: false };
                const updated = {
                    ...fresh,
                    character: applied.character,
                };
                await kv.set(saveKey, mergePreservingImages(bumpSaveVersion(updated), fresh));
                return { complete: true, newlyApplied: true };
            }, { failClosed: true });
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
            const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
            if (!fresh) return;
            if (weeklyBossSpawnIdentity(fresh) !== distributionSpawnId) {
                finalBoss = fresh;
                return;
            }
            const credited = new Set<string>([...(fresh.creditedPlayers ?? []), ...newlyCredited]);
            const summaryNames = (fresh.distributionSummary ?? summary ?? []).map(e => e.name);
            const allDone = summaryNames.every(n => credited.has(n));
            const updated: WeeklyBossState = {
                ...fresh,
                creditedPlayers: [...credited],
                rewardsDistributed: allDone ? true : fresh.rewardsDistributed,
            };
            await kv.set(WEEKLY_BOSS_STATE_KEY, updated);
            finalBoss = updated;
        }, { failClosed: true });
    }

    return finalBoss;
}

// The per-player save credit serializes on the same logical lock target as
// the save endpoint's own lock so a weekly-boss credit and a concurrent
// player autosave don't interleave a lost update. (save endpoint locks on
// `save:<name>`; we mirror that target string here.)
function saveKeyCreditScope(name: string): string {
    return `save:${name}`;
}

type WeeklyBossResetOutcome =
    | { kind: 'spawned'; boss: WeeklyBossState }
    | { kind: 'stale'; boss: WeeklyBossState | null }
    | { kind: 'distribution-pending'; boss: WeeklyBossState }
    | { kind: 'unavailable' };

const WEEKLY_BOSS_RESET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function announceWeeklyBossSpawn(boss: WeeklyBossState): Promise<void> {
    const spawnId = weeklyBossSpawnIdentity(boss);
    const delivered = await announce({
        type: 'weekly_boss',
        importance: 'high',
        title: `⚔️ Weekly Boss: ${boss.bossName ?? 'A great enemy'} has appeared!`,
        message: `${boss.bossName ?? 'A fearsome boss'} rampages for 72 hours. Seek it out and deal all the damage you can — the top damagers claim a Weekly Boss Core, Dungeon Keys, ryo, and stat points. Enter the hunt via Central Hub → Weekly Boss.`,
        meta: { spawnId, aiId: boss.aiId, weekKey: boss.weekKey, expiresAt: boss.expiresAt },
    }, { receiptId: `weekly-boss-spawn:${spawnId}` });
    if (!delivered) throw new Error(`Weekly Boss ${spawnId} was committed but its herald is still pending.`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        // Recovery discovery is intentionally a safe-method, authenticated,
        // no-store read. Keep it ahead of loadOrInitBoss()/expiry distribution:
        // even those otherwise-helpful writes would violate probe semantics.
        if (req.query.recoverFight === '1') {
            const identity = await authedPlayerOrAdmin(req);
            if (!identity) return res.status(401).json({ error: 'Authentication required.' });
            const boss = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
            res.setHeader('Cache-Control', 'private, no-store');
            if (!boss) {
                return res.status(404).json({
                    error: 'No interrupted Weekly Boss fight is available.',
                    code: 'weekly-boss-recovery-not-found',
                });
            }
            const requestedWeekKey = typeof req.query.weekKey === 'string' ? req.query.weekKey : '';
            if ((requestedWeekKey && requestedWeekKey !== boss.weekKey)
                || boss.rewardsDistributed
                || Date.now() >= boss.expiresAt) {
                return res.status(409).json({
                    error: 'That Weekly Boss fight is no longer recoverable.',
                    code: 'weekly-boss-recovery-stale',
                });
            }
            const actorName = identity.admin ? 'admin' : identity.name;
            const recovery = await probeWeeklyBossRecovery(actorName, boss);
            if (!recovery) {
                return res.status(404).json({
                    error: 'No interrupted Weekly Boss fight is available.',
                    code: 'weekly-boss-recovery-not-found',
                });
            }
            if (recovery.state === 'prepared') {
                return res.status(409).json({
                    error: 'Your accepted Weekly Boss fight still needs finalization.',
                    code: 'weekly-boss-recovery-needs-finalization',
                    runId: recovery.runId,
                });
            }
            return res.status(200).json({
                ok: true,
                replayed: true,
                runId: recovery.runId,
                session: recovery.session,
                character: recovery.character,
                _saveVersion: recovery.saveVersion,
                expiresInSeconds: WEEKLY_BOSS_RUN_TTL_SECONDS,
            });
        }

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
                if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin only.' });
                const hasExpectedSpawnId = Object.prototype.hasOwnProperty.call(body, 'expectedSpawnId');
                const expectedRaw = (body as { expectedSpawnId?: unknown }).expectedSpawnId;
                const requestedRaw = (body as { requestedSpawnId?: unknown }).requestedSpawnId;
                if (!hasExpectedSpawnId) {
                    return res.status(400).json({
                        error: 'Expected Weekly Boss spawn identity is required.',
                        code: 'weekly-boss-reset-expected-required',
                    });
                }
                const expectedSpawnId = expectedRaw === null
                    ? null
                    : (typeof expectedRaw === 'string' && expectedRaw.trim() && expectedRaw.trim().length <= 128
                        ? expectedRaw.trim()
                        : undefined);
                if (expectedSpawnId === undefined) {
                    return res.status(400).json({
                        error: 'Invalid expected Weekly Boss spawn identity.',
                        code: 'weekly-boss-reset-expected-invalid',
                    });
                }
                const requestedSpawnId = typeof requestedRaw === 'string' && WEEKLY_BOSS_RESET_ID_PATTERN.test(requestedRaw.trim())
                    ? requestedRaw.trim().toLowerCase()
                    : null;
                if (!requestedSpawnId) {
                    return res.status(400).json({
                        error: 'A valid Weekly Boss reset request identity is required.',
                        code: 'weekly-boss-reset-request-invalid',
                    });
                }

                // Settle an expired generation before attempting replacement.
                // A stale request never gets to settle or mutate the generation
                // that replaced the one it observed.
                const observed = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
                const observedSpawnId = observed ? weeklyBossSpawnIdentity(observed) : null;
                if (observedSpawnId !== expectedSpawnId && observedSpawnId !== requestedSpawnId) {
                    return res.status(409).json({
                        error: 'Weekly Boss changed before reset. Refresh and try again.',
                        code: 'weekly-boss-reset-stale-generation',
                        boss: publicWeeklyBossState(observed),
                    });
                }
                if (observed && Date.now() >= observed.expiresAt && !observed.rewardsDistributed) {
                    try {
                        await distributeRewardsIfExpired(observed);
                    } catch (error) {
                        if (error instanceof LockContendedError) {
                            return res.status(409).json({
                                error: 'Weekly Boss distribution is already in progress. Retry shortly.',
                                code: 'weekly-boss-reset-distribution-in-progress',
                            });
                        }
                        throw error;
                    }
                }

                let outcome: WeeklyBossResetOutcome;
                try {
                    outcome = await withKvLock<WeeklyBossResetOutcome>(WEEKLY_BOSS_STATE_KEY, async () => {
                        const current = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
                        const currentSpawnId = current ? weeklyBossSpawnIdentity(current) : null;
                        // The requested spawn identity is the durable reset
                        // receipt. A committed response-loss retry replays the
                        // exact boss and repairs its idempotent herald before
                        // considering the now-stale predecessor expectation.
                        if (current && currentSpawnId === requestedSpawnId) {
                            await announceWeeklyBossSpawn(current);
                            return { kind: 'spawned', boss: current };
                        }
                        if (currentSpawnId !== expectedSpawnId) return { kind: 'stale', boss: current };
                        if (current && Date.now() >= current.expiresAt && !current.rewardsDistributed) {
                            return { kind: 'distribution-pending', boss: current };
                        }
                        const next = await buildFreshBossState(isoWeekKey(), requestedSpawnId);
                        if (!next) return { kind: 'unavailable' };
                        await kv.set(WEEKLY_BOSS_STATE_KEY, next);

                        // Keep herald ordering inside the same generation lock. A
                        // competing reset cannot replace this spawn and then let an
                        // older continuation announce it afterward. The spawn ID is
                        // also the announcement receipt, making retries idempotent.
                        await announceWeeklyBossSpawn(next);
                        return { kind: 'spawned', boss: next };
                    }, { failClosed: true, ttlSec: 30, maxAttempts: 8 });
                } catch (error) {
                    if (error instanceof LockContendedError) {
                        return res.status(409).json({
                            error: 'Another Weekly Boss reset is already in progress. Refresh and try again.',
                            code: 'weekly-boss-reset-in-progress',
                        });
                    }
                    throw error;
                }
                if (outcome.kind === 'stale') {
                    return res.status(409).json({
                        error: 'Weekly Boss changed before reset. Refresh and try again.',
                        code: 'weekly-boss-reset-stale-generation',
                        boss: publicWeeklyBossState(outcome.boss),
                    });
                }
                if (outcome.kind === 'distribution-pending') {
                    return res.status(409).json({
                        error: 'Expired Weekly Boss rewards are still pending. Retry after distribution completes.',
                        code: 'weekly-boss-reset-distribution-pending',
                        boss: publicWeeklyBossState(outcome.boss),
                    });
                }
                if (outcome.kind === 'unavailable') return res.status(409).json({ error: 'No AI available for reset.' });
                return res.status(200).json({ boss: publicWeeklyBossState(outcome.boss) });
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

            if (kind === 'startFight' || kind === 'resumeFight') {
                const recoveryOnly = kind === 'resumeFight';
                const requestedRunId = recoveryOnly ? String(body.runId ?? '').slice(0, 96) : '';
                if (recoveryOnly && !requestedRunId) {
                    return res.status(400).json({ error: 'Missing Weekly Boss run.', code: 'weekly-boss-recovery-run-required' });
                }
                if (!recoveryOnly && !identity.admin && await findTowerBattleStartConflict([actorName])) {
                    return res.status(409).json(towerBattleActiveErrorBody());
                }
                const activeKey = weeklyBossActiveRunKey(actorName, boss.startedAt);
                const started = await withKvLock(activeKey, async () => {
                    let runId = await kv.get<string>(activeKey);
                    if (recoveryOnly && runId !== requestedRunId) {
                        return { status: 404 as const, body: {
                            error: 'No matching interrupted Weekly Boss fight is available.',
                            code: 'weekly-boss-recovery-not-found',
                        } };
                    }
                    let run = runId ? await kv.get<WeeklyBossAuthoritativeRun>(weeklyBossRunKey(runId)) : null;
                    let session = runId ? await readSoloPveSession(runId) : null;

                    const sameSpawn = Boolean(runId && isCurrentWeeklyBossRun({
                        activeRunId: runId,
                        run,
                        session,
                        playerName: actorName,
                        boss: boss!,
                    }));
                    if (runId && (!sameSpawn || run?.settledAt)) {
                        if (recoveryOnly) {
                            return { status: 404 as const, body: {
                                error: 'No matching interrupted Weekly Boss fight is available.',
                                code: 'weekly-boss-recovery-not-found',
                            } };
                        }
                        await kv.del(activeKey);
                        runId = null;
                        run = null;
                        session = null;
                    }

                    // A resume-only request may finish the already-persisted
                    // prepared saga below, but it can never enter the creation
                    // branch and mint a run from stale client-side blockers.
                    if (recoveryOnly && (!run || !session)) {
                        return { status: 404 as const, body: {
                            error: 'No matching interrupted Weekly Boss fight is available.',
                            code: 'weekly-boss-recovery-not-found',
                        } };
                    }

                    const actorSave = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${actorName}`));
                    const actorChar = actorSave?.character as Record<string, unknown> | undefined;
                    if (!actorSave || !actorChar) return { status: 404 as const, body: { error: 'Player save not found.' } };

                    // A lost HTTP response or browser reload reconnects to the
                    // same ready run. No second attempt or stamina debit occurs.
                    if (run && session && run.startState !== 'prepared') {
                        return { status: 200 as const, body: {
                            ok: true,
                            replayed: true,
                            runId: run.runId,
                            session,
                            character: actorChar,
                            _saveVersion: Number(actorSave._saveVersion ?? 0),
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
                        await kv.set(weeklyBossRunKey(runId), run, { ex: WEEKLY_BOSS_RUN_TTL_SECONDS });
                        await kv.set(activeKey, runId, { ex: WEEKLY_BOSS_RUN_TTL_SECONDS });
                    }

                    const reserved = await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
                        const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
                        if (!fresh || fresh.weekKey !== run!.weekKey || fresh.startedAt !== run!.bossStartedAt) return null;
                        const applied = reserveWeeklyBossAttemptReceipt(fresh, run!.runId, actorName, !identity.admin);
                        if (applied && !applied.replayed) await kv.set(WEEKLY_BOSS_STATE_KEY, applied.boss);
                        return applied;
                    }, { failClosed: true });
                    if (!reserved) {
                        await kv.del(activeKey, soloPveSessionKey(run.runId), weeklyBossRunKey(run.runId)).catch(() => 0);
                        return { status: 409 as const, body: { error: 'The boss reset or your attempts were already used.' } };
                    }

                    let updatedCharacter = actorChar;
                    let saveVersion = Number(actorSave._saveVersion ?? 0);
                    if (!identity.admin) {
                        const staminaCharge = await withKvLock(`save:${actorName}`, async () => {
                            const freshSave = await kv.get<Record<string, unknown>>(`save:${actorName}`);
                            const freshChar = freshSave?.character as Record<string, unknown> | undefined;
                            if (!freshSave || !freshChar) return null;
                            const startReceiptId = `weekly-start-${run!.runId}`;
                            const startFingerprint = `${run!.weekKey}:${run!.aiId}:${run!.bossStartedAt}`;
                            const inspected = inspectSettlementReceipt(freshChar, startReceiptId, startFingerprint);
                            if (inspected.status === 'replay') {
                                return { character: freshChar, saveVersion: Number(freshSave._saveVersion ?? 0) };
                            }
                            if (inspected.status !== 'fresh') return null;
                            if (Number(freshChar.stamina ?? 0) < 20) return null;
                            const nextChar = appendSettlementReceipt(
                                { ...freshChar, stamina: Number(freshChar.stamina ?? 0) - 20 },
                                inspected.receipts,
                                {
                                    requestId: startReceiptId,
                                    fingerprint: startFingerprint,
                                    value: { kind: 'weekly-boss-start', stamina: 20 },
                                    settledAt: Date.now(),
                                },
                            );
                            const updated = bumpSaveVersion({
                                ...freshSave,
                                character: nextChar,
                            });
                            await kv.set(`save:${actorName}`, mergePreservingImages(updated, freshSave));
                            return { character: nextChar, saveVersion: Number((updated as Record<string, unknown>)._saveVersion ?? 0) };
                        }, { failClosed: true });
                        if (!staminaCharge) {
                            await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
                                const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
                                if (fresh) await kv.set(WEEKLY_BOSS_STATE_KEY, rollbackWeeklyBossAttemptReceipt(fresh, run!.runId, actorName));
                            }, { failClosed: true });
                            await kv.del(activeKey, soloPveSessionKey(run.runId), weeklyBossRunKey(run.runId)).catch(() => 0);
                            return { status: 409 as const, body: { error: 'Stamina changed before the fight could start. Try again.' } };
                        }
                        updatedCharacter = staminaCharge.character;
                        saveVersion = staminaCharge.saveVersion;
                        session.player.stamina = Math.max(0, Number(updatedCharacter.stamina ?? 0));
                    }

                    await writeSoloPveSession(session);
                    run = { ...run, startState: 'ready' };
                    await kv.set(weeklyBossRunKey(run.runId), run, { ex: WEEKLY_BOSS_RUN_TTL_SECONDS });
                    await kv.set(activeKey, run.runId, { ex: WEEKLY_BOSS_RUN_TTL_SECONDS });
                    return { status: 200 as const, body: {
                        ok: true,
                        runId: run.runId,
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
                    const session = await readSoloPveSession(runId);
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
                    const logged = validation.damage;
                    const banked = await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
                        const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY) ?? boss!;
                        if (fresh.weekKey !== run.weekKey || fresh.startedAt !== run.bossStartedAt) return null;
                        if (fresh.rewardsDistributed || Date.now() >= fresh.expiresAt) return null;
                        const applied = applyWeeklyBossRunDamageReceipt(fresh, runId, run.playerName, logged);
                        if (!applied.replayed) await kv.set(WEEKLY_BOSS_STATE_KEY, applied.boss);
                        return applied;
                    }, { failClosed: true });
                    if (!banked) return { status: 409 as const, body: { error: 'Boss despawned or reset before settlement.' } };
                    const settlementId = `weeklyboss-${runId}`.slice(0, 80);
                    const fingerprint = `${run.weekKey}:${run.aiId}:${run.bossStartedAt}`;
                    const usage = await mutatePlayerSave(run.playerName, ({ character }) => {
                        const inspected = inspectSettlementReceipt(character, settlementId, fingerprint);
                        if (inspected.status === 'conflict' || inspected.status === 'invalid') {
                            return { ok: false as const, status: 409, error: 'weekly-boss-receipt-conflict' };
                        }
                        if (inspected.status === 'replay') return { ok: true as const, character, value: { replayed: true } };
                        const charged = applySoloPveUsageCosts(character, session!);
                        const withOutcome = applyAiFightOutcomeToCharacter(
                            charged,
                            resolveAiFightOutcome(session!),
                            session!.player,
                            Date.now(),
                        );
                        return {
                            ok: true as const,
                            character: appendSettlementReceipt(withOutcome, inspected.receipts, {
                                requestId: settlementId,
                                fingerprint,
                                value: { damage: banked.damage },
                                settledAt: Date.now(),
                            }),
                            value: { replayed: false },
                        };
                    });
                    if (!usage.ok) return { status: usage.status, body: { error: 'Weekly Boss usage settlement could not be committed.' } };
                    await writeSoloPveSession(withSoloPveSettlementReceipt(session!, {
                        kind: 'weekly-boss',
                        id: runId,
                        settledAt: Date.now(),
                        rewards: { damage: banked.damage },
                    }));
                    await kv.set(weeklyBossRunKey(runId), { ...run, settledAt: Date.now() }, { ex: WEEKLY_BOSS_RUN_TTL_SECONDS });
                    const activeKey = weeklyBossActiveRunKey(run.playerName, run.bossStartedAt);
                    await withKvLock(activeKey, async () => {
                        if (await kv.get<string>(activeKey) === runId) await kv.del(activeKey);
                    }, { failClosed: true }).catch(() => undefined);
                    return { status: 200 as const, body: {
                        ok: true,
                        boss: publicWeeklyBossState(banked.boss),
                        dealt: banked.damage,
                        alreadySettled: banked.replayed && usage.value.replayed,
                        attemptsUsed: banked.boss.attemptsByPlayer?.[run.playerName] ?? 0,
                        character: usage.character,
                        _saveVersion: usage._saveVersion,
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
