import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { settlementFingerprint } from '../_durable-settlement.js';
import { receiptAbsenceProvable } from '../_save-debit-saga.js';
import {
    SERVER_SETTLEMENT_RECEIPT_LIMIT,
    SERVER_SETTLEMENT_RECEIPTS_FIELD,
    appendSettlementReceipt,
    inspectSettlementReceipt,
    parseSettlementRequestId,
} from '../_settlement-receipts.js';
import { mutatePlayerSave, type PlayerCharacter } from '../save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from '../save/_projected-write.js';
import {
    type Profession,
    type MissionKind,
    type MissionTemplate,
    type NewbieMissionKind,
    type NewbieMissionTemplate,
    getMissionTemplateById,
    pickDailyMissionsForPlayer,
    pickNewbieMissions,
} from './_pool.js';
import { canPlayerReceiveMission, type MissionEligibility } from './_eligibility.js';

export type DailyMission = {
    id: string;
    templateId: string;
    kind: MissionKind;
    name: string;
    description: string;
    target: number;
    progress: number;
    uniqueTargets?: string[];
    xpReward: number;
    eligibility?: MissionEligibility;
    completedAt: number | null;
    claimed: boolean;
};

export type DailyMissionReplacement = {
    replacedMissionId: string;
    replacedTemplateId: string;
    replacementTemplateId: string;
    reason: string;
};

export type DailyMissionsState = {
    date: string;            // "YYYY-MM-DD" UTC
    profession: Profession;
    missions: DailyMission[];
    replacements?: DailyMissionReplacement[];
    /** Exact event receipts for crash-recoverable cross-handler producers. */
    eventReceipts?: DailyMissionEventReceipt[];
    /** Completions whose profession XP is not yet proven paid (see "Exactly-once mission rewards"). */
    pendingXpGrants?: PendingMissionXpGrant[];
};

/** Profession XP owed for missions this row records as complete. */
export type PendingMissionXpGrant = {
    /** Settlement request id; the save stamps it into serverSettlementReceipts with the credit. */
    id: string;
    profession: Profession;
    /** The missions' xpReward total, before the rank multiplier the credit applies. */
    xp: number;
    missionIds: string[];
    /** When the completion committed: the lower bound for proving a receipt absent. */
    at: number;
};

export type DailyMissionEventReceipt = {
    id: string;
    kind: MissionKind;
    xpAwarded: number;
    missionsCompleted: CompletedMissionInfo[];
    appliedAt: number;
};

// Healer uses a 1.5× XP curve; baseline used by Vanguard. Keep in sync with
// the client-side getProfessionRankForXp in shinobij.client/src/App.tsx.
const XP_BASELINE = [0, 100, 350, 850, 1850, 3850, 7350, 12850, 20850, 32850, Infinity];
const XP_HEALER = XP_BASELINE.map(v => v === Infinity ? v : Math.floor(v * 1.5));
const MAX_RANK = 10;

function thresholdsFor(profession: Profession): readonly number[] {
    return profession === 'healer' ? XP_HEALER : XP_BASELINE;
}

function rankFor(profession: Profession, xp: number): number {
    const t = thresholdsFor(profession);
    let rank = 1;
    for (let i = 1; i <= MAX_RANK; i += 1) {
        if (xp >= t[i]) rank = Math.min(MAX_RANK, i + 1);
    }
    return Math.min(MAX_RANK, rank);
}

// Exported so security-sensitive endpoints (injured-villagers, heal,
// anywhere a rank gates a privileged action) can derive the trustworthy
// rank from professionXp instead of trusting a potentially-tampered
// professionRank field on the character record.
export function professionRankForXp(profession: Profession, xp: number): number {
    return rankFor(profession, xp);
}

// ── Healer rank perks — server-side mirror of shinobij.client/src/professionLogic.ts ──
// Keep arrays IN SYNC with the client file. Idx = rank (0 unused).
export const HEALER_PER_TARGET_COOLDOWN_SEC = [0, 300, 285, 270, 240, 210, 180, 150, 120, 105, 90] as const;
export const HEALER_HEAL_XP_BONUS_PCT = [0, 0, 5, 10, 15, 20, 25, 30, 35, 40, 50] as const;
// (A former rank-scaled HEALER_HOSPITAL_TIMER_SEC was removed — Healers now
//  discharge instantly for free, so there is no Healer hospital timer to mirror.)
export const HEALER_WORLDWIDE_RANK = 10;
function clampRank(rank: number): number {
    if (!Number.isFinite(rank) || rank < 1) return 1;
    if (rank > MAX_RANK) return MAX_RANK;
    return Math.floor(rank);
}
export function healerHealXpBonusPct(rank: number): number {
    return HEALER_HEAL_XP_BONUS_PCT[clampRank(rank)];
}
export function healerPerTargetCooldownMs(rank: number): number {
    return HEALER_PER_TARGET_COOLDOWN_SEC[clampRank(rank)] * 1000;
}

export function utcDateKey(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

const UTC_DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Vanguard Rank 2+ perk: +10% XP on all Vanguard XP gains. Mirrored from the
// client-side professionXpMultiplier in App.tsx so both grant paths agree.
function xpMultiplierFor(profession: Profession, currentRank: number): number {
    if (profession === 'vanguard' && currentRank >= 2) return 1.1;
    return 1;
}

export function professionXpAfterAward(
    profession: Profession,
    currentXpRaw: unknown,
    currentRankRaw: unknown,
    amountRaw: unknown,
): { xp: number; rank: number; granted: number } {
    const currentXp = Math.max(0, Math.floor(Number(currentXpRaw) || 0));
    const currentRank = Math.max(1, Math.floor(Number(currentRankRaw) || 1));
    const amount = Math.max(0, Math.floor(Number(amountRaw) || 0));
    const granted = Math.floor(amount * xpMultiplierFor(profession, currentRank));
    const xp = currentXp + granted;
    return { xp, rank: rankFor(profession, xp), granted };
}

// Award profession XP directly to the player's character record. Returns
// {xp, rank} after the credit. Used by per-action XP grants (a pet
// expedition's Tamer XP). A daily mission completion does NOT pay through
// here: its XP is a receipted grant, so a failed credit is retried rather than
// lost (see "Exactly-once mission rewards" below).
export async function awardProfessionXp(
    playerName: string,
    profession: Profession,
    amount: number,
): Promise<{ xp: number; rank: number } | null> {
    if (amount <= 0) return null;
    // Commit through mutatePlayerSave, under the same lock the save endpoint
    // uses, so a concurrent auto-save can't clobber the XP credit, and so two
    // concurrent reportMissionEvent calls (e.g. a Vanguard PvP win + raid
    // report landing in the same tick) don't both read the pre-grant XP and
    // one lose its credit. A lost compare-and-set committed nothing, so
    // running the grant once more cannot pay it twice.
    const out = await retryOnSaveVersionConflict(() => mutatePlayerSave<{ xp: number; rank: number } | null>(playerName, ({ character: char }) => {
        if (char.profession !== profession) return { ok: true, write: false, character: char, value: null };
        const awarded = professionXpAfterAward(profession, char.professionXp, char.professionRank, amount);
        return {
            ok: true,
            character: { ...char, professionXp: awarded.xp, professionRank: awarded.rank },
            value: { xp: awarded.xp, rank: awarded.rank },
        };
    }));
    return out.ok ? out.value : null;
}

function dailyKey(playerName: string): string {
    return `missions:daily:${playerName}`;
}

const DAILY_MISSIONS_TTL_SECONDS = 36 * 60 * 60;

function pendingXpGrants(state: DailyMissionsState | null | undefined): PendingMissionXpGrant[] {
    return Array.isArray(state?.pendingXpGrants)
        ? state.pendingXpGrants.filter((grant) => Boolean(grant)
            && parseSettlementRequestId(grant.id) === grant.id
            && (grant.profession === 'vanguard' || grant.profession === 'healer' || grant.profession === 'petTamer')
            && Number.isSafeInteger(grant.xp)
            && grant.xp > 0
            && Array.isArray(grant.missionIds)
            && Number.isFinite(grant.at)
            && grant.at > 0)
        : [];
}

// A row that still owes XP must outlive the day window it was written in, so it
// is kept without a TTL until the grant settles (mirrors newbieDailyWriteOptions).
function dailyWriteOptions(state: DailyMissionsState): { ex: number } | undefined {
    return pendingXpGrants(state).length > 0 ? undefined : { ex: DAILY_MISSIONS_TTL_SECONDS };
}

function fromTemplate(t: MissionTemplate, dateKey: string): DailyMission {
    return {
        id: `${t.templateId}:${dateKey}`,
        templateId: t.templateId,
        kind: t.kind,
        name: t.name,
        description: t.description,
        target: t.target,
        progress: 0,
        uniqueTargets: (t.kind === 'healer-heal-unique' || t.kind === 'vanguard-pvp-unique') ? [] : undefined,
        xpReward: t.xpReward,
        eligibility: t.eligibility,
        completedAt: null,
        claimed: false,
    };
}

function missionTemplateForDaily(mission: DailyMission): MissionTemplate | undefined {
    return getMissionTemplateById(mission.templateId);
}

function dailyMissionEligibilityInput(mission: DailyMission): DailyMission | MissionTemplate {
    return missionTemplateForDaily(mission) ?? mission;
}

export function repairDailyMissionsForEligibility(opts: {
    state: DailyMissionsState;
    playerName: string;
    today: string;
    slotCount: number;
    character: Record<string, unknown>;
}): { state: DailyMissionsState; replacements: DailyMissionReplacement[] } {
    const candidateTemplates = pickDailyMissionsForPlayer({
        profession: opts.state.profession,
        playerName: opts.playerName,
        dateKey: opts.today,
        count: getMissionPoolSafeCount(opts.state.profession),
        character: opts.character,
    });
    const used = new Set(opts.state.missions.map((m) => m.templateId));
    const replacements: DailyMissionReplacement[] = [];

    const missions = opts.state.missions.map((mission) => {
        if (mission.completedAt || mission.claimed) return mission;
        const check = canPlayerReceiveMission(opts.character, dailyMissionEligibilityInput(mission));
        if (check.ok) return mission;

        const replacement = candidateTemplates.find((template) => !used.has(template.templateId));
        if (!replacement) return mission;
        used.delete(mission.templateId);
        used.add(replacement.templateId);
        replacements.push({
            replacedMissionId: mission.id,
            replacedTemplateId: mission.templateId,
            replacementTemplateId: replacement.templateId,
            reason: check.reason ?? 'not-yet-unlocked',
        });
        return fromTemplate(replacement, opts.today);
    });

    return {
        state: {
            ...opts.state,
            missions: missions.slice(0, opts.slotCount),
            ...(replacements.length > 0 ? { replacements } : {}),
        },
        replacements,
    };
}

function getMissionPoolSafeCount(profession: Profession): number {
    // Keep this local to avoid exposing a second "all eligible" picker surface.
    if (profession === 'vanguard') return 12;
    if (profession === 'healer') return 8;
    if (profession === 'petTamer') return 8;
    return 3;
}

// Load (or issue) today's missions for a player. Returns null if profession
// doesn't have missions, or if `now` falls on an earlier UTC day than the set
// already stored. Vanguard Rank 6+ gets 4 missions instead of 3
// (the Rank 6 even-rank perk).
// The daily endpoint and progress reporters can pass the trusted character they
// already loaded, avoiding a duplicate save:<player> database round trip.
// `undefined` preserves standalone behavior; `null` means the caller already
// checked and there is no character record.
export async function loadOrIssueDailyMissions(
    playerName: string,
    profession: Profession,
    now = new Date(),
    loadedCharacter: Record<string, unknown> | null | undefined = undefined,
): Promise<DailyMissionsState | null> {
    return withKvLock(dailyKey(playerName), () =>
        loadOrIssueDailyMissionsUnderLock(playerName, profession, now, loadedCharacter), { failClosed: true });
}

// Issuance, eligibility repairs and progress must share one daily-key lease.
async function loadOrIssueDailyMissionsUnderLock(
    playerName: string,
    profession: Profession,
    now: Date,
    loadedCharacter: Record<string, unknown> | null | undefined,
): Promise<DailyMissionsState | null> {
    const today = utcDateKey(now);
    // Look up current rank to determine daily mission slot count.
    const char = loadedCharacter === undefined
        ? (await kv.get<Record<string, unknown>>(`save:${playerName}`))?.character as Record<string, unknown> | undefined
        : loadedCharacter ?? undefined;
    const currentRank = Number(char?.professionRank ?? 1);
    const slotCount = (profession === 'vanguard' && currentRank >= 6) ? 4 : 3;

    const existing = await kv.get<DailyMissionsState>(dailyKey(playerName));
    // An event dated before the stored set must not replace it. The raid saga
    // reports at its proof time, which can fall on the previous UTC day, and
    // issuing that day's set here overwrote the current one: its progress and
    // event receipts were wiped, and the next report reissued the day's
    // missions fresh, so ones already completed and paid could pay again. The
    // older day's set is gone, so whether the event already counted there
    // cannot be proven. It counts nothing instead (loss-only).
    if (existing && UTC_DATE_KEY.test(String(existing.date)) && existing.date > today) return null;
    if (existing && existing.date === today && existing.profession === profession) {
        if (!char) return existing;
        const repaired = repairDailyMissionsForEligibility({ state: existing, playerName, today, slotCount, character: char });
        if (repaired.replacements.length > 0) {
            await kv.set(dailyKey(playerName), repaired.state, dailyWriteOptions(repaired.state));
            console.warn('[missions/daily] replaced ineligible stored missions', {
                playerName,
                replacements: repaired.replacements,
            });
        }
        return repaired.state;
    }

    const picks = pickDailyMissionsForPlayer({ profession, playerName, dateKey: today, count: slotCount, character: char ?? {} });
    if (picks.length === 0) return null;
    // A new day (or profession) starts a fresh set, but XP still owed for an
    // earlier completion moves onto it until it settles.
    const owed = pendingXpGrants(existing);
    const state: DailyMissionsState = {
        date: today,
        profession,
        missions: picks.map(t => fromTemplate(t, today)),
        ...(owed.length > 0 ? { pendingXpGrants: owed } : {}),
    };
    await kv.set(dailyKey(playerName), state, dailyWriteOptions(state));
    return state;
}

export type CompletedMissionInfo = {
    id: string;
    name: string;
    xpReward: number;
};

// Increment progress on all of a player's missions matching the given kind.
// For unique-target missions, the target name dedupes within the day.
// Returns the total profession XP the completions earned. That XP is paid as a
// receipted grant: committed with the completion, credited right after, and
// retried by the next report or panel read if the credit fails.
export async function reportMissionEvent(opts: {
    playerName: string;
    profession: Profession;
    kind: MissionKind;
    /** For unique-target missions — must be lowercased. */
    targetName?: string;
    now?: Date;
    /** Stable server proof. Identical retries return the stored event result. */
    receiptId?: string;
    /** Caller commits XP in its own exact-once save settlement. */
    deferXpAward?: boolean;
}): Promise<{ xpAwarded: number; missionsCompleted: CompletedMissionInfo[]; replayed?: boolean }> {
    const { playerName, profession, kind, targetName } = opts;
    const now = opts.now ?? new Date();
    const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    const char = (save?.character ?? {}) as Record<string, unknown>;
    // Lock the daily-missions key for the entire read-modify-write so two
    // concurrent reports for the same player can't both read progress=N,
    // both increment to N+1, and the second write clobber the first.
    const dKey = dailyKey(playerName);
    const result = await withKvLock(dKey, async () => {
        const state = await loadOrIssueDailyMissionsUnderLock(playerName, profession, now, char);
        if (!state) return { xpAwarded: 0, missionsCompleted: [] as CompletedMissionInfo[], grantsOwed: false };
        const owed = pendingXpGrants(state);

        const receiptId = typeof opts.receiptId === 'string' ? opts.receiptId.trim().slice(0, 160) : '';
        const eventReceipts = Array.isArray(state.eventReceipts)
            ? state.eventReceipts.filter((entry) => entry && typeof entry.id === 'string').slice(-127)
            : [];
        const prior = receiptId ? eventReceipts.find((entry) => entry.id === receiptId && entry.kind === kind) : undefined;
        if (prior) return {
            xpAwarded: Math.max(0, Math.floor(Number(prior.xpAwarded) || 0)),
            missionsCompleted: Array.isArray(prior.missionsCompleted) ? prior.missionsCompleted : [],
            replayed: true,
            grantsOwed: owed.length > 0,
        };

        let xpAwarded = 0;
        const completed: CompletedMissionInfo[] = [];
        let changed = false;

        const next = state.missions.map(m => {
            if (m.kind !== kind || m.completedAt) return m;
            if (!canPlayerReceiveMission(char, dailyMissionEligibilityInput(m)).ok) return m;
            // Unique-target dedup.
            let nextProgress = m.progress;
            let nextUnique = m.uniqueTargets;
            if (m.uniqueTargets) {
                if (!targetName) return m;
                if (m.uniqueTargets.includes(targetName)) return m;
                nextUnique = [...m.uniqueTargets, targetName];
                nextProgress = nextUnique.length;
            } else {
                nextProgress = m.progress + 1;
            }
            changed = true;
            const justCompleted = nextProgress >= m.target;
            if (justCompleted) {
                xpAwarded += m.xpReward;
                completed.push({ id: m.id, name: m.name, xpReward: m.xpReward });
                return { ...m, progress: m.target, uniqueTargets: nextUnique, completedAt: Date.now() };
            }
            return { ...m, progress: nextProgress, uniqueTargets: nextUnique };
        });

        // The completion and the XP it is owed commit in this one write. A
        // caller that settles the XP in its own receipted save write
        // (deferXpAward) records no grant here.
        const grant: PendingMissionXpGrant | null = xpAwarded > 0 && opts.deferXpAward !== true ? {
            id: newMissionGrantId('mxp'),
            profession,
            xp: xpAwarded,
            missionIds: completed.map((mission) => mission.id),
            at: Date.now(),
        } : null;
        // Refuse the event rather than record a completion whose XP has nowhere
        // to go. Missions complete once a day, so only a credit that has failed
        // for days on end can fill this.
        if (grant && owed.length >= MAX_PENDING_MISSION_GRANTS) throw new Error('mission-xp-grants-pending-overflow');

        if (changed || receiptId) {
            const eventReceipt: DailyMissionEventReceipt | null = receiptId ? {
                id: receiptId,
                kind,
                xpAwarded,
                missionsCompleted: completed,
                appliedAt: Date.now(),
            } : null;
            const nextState: DailyMissionsState = {
                ...state,
                missions: next,
                ...(eventReceipt ? { eventReceipts: [...eventReceipts, eventReceipt] } : {}),
                ...(grant ? { pendingXpGrants: [...owed, grant] } : {}),
            };
            await kv.set(dKey, nextState, dailyWriteOptions(nextState));
        }
        return { xpAwarded, missionsCompleted: completed, grantsOwed: owed.length > 0 || grant !== null };
    }, { failClosed: true });

    // Pay what the row owes: this event's grant, and any an earlier report
    // left behind. The credit takes its own lock on save:<player>, so it runs
    // after the daily lock is released (no nested locks). A credit that fails
    // stays owed for the next report or read; it does not fail this event,
    // whose completion is already committed.
    const { grantsOwed, ...event } = result;
    if (grantsOwed) await settlePendingMissionXpGrants(playerName);
    return event;
}

// ── New-shinobi (pre-profession) daily track ───────────────────────────────────
// A parallel, self-contained daily set for players who haven't chosen a
// profession. Mirrors the profession track's shape and auto-grant model, but
// pays RYO (not profession XP, which they don't have) and lives under its own
// storage key so the profession system is untouched. Gated on "no profession":
// every entry point no-ops the moment a player has chosen one.

export type NewbieDailyMission = {
    id: string;
    templateId: string;
    kind: NewbieMissionKind;
    name: string;
    description: string;
    target: number;
    progress: number;
    ryoReward: number;
    completedAt: number | null;
};

export type NewbieDailyState = {
    date: string;            // "YYYY-MM-DD" UTC
    missions: NewbieDailyMission[];
    combatMissionEffects?: NewbieCombatMissionEffect[];
    /** Completions whose ryo is not yet proven paid (see "Exactly-once mission rewards"). */
    pendingRyoGrants?: PendingNewbieRyoGrant[];
};

/** Ryo owed for newbie missions this row records as complete. */
export type PendingNewbieRyoGrant = {
    /** Settlement request id; the save stamps it into serverSettlementReceipts with the credit. */
    id: string;
    ryo: number;
    missionIds: string[];
    /** When the completion committed: the lower bound for proving a receipt absent. */
    at: number;
};

export type NewbieCombatMissionEffect = {
    version: 1;
    runId: string;
    kinds: NewbieMissionKind[];
    ryoAwarded: number;
    appliedAt: number;
    acknowledgedAt?: number;
};

const MAX_PENDING_NEWBIE_COMBAT_EFFECTS = 40;
const MAX_SETTLED_NEWBIE_COMBAT_EFFECTS = 64;
const NEWBIE_DAILY_TTL_SECONDS = 36 * 60 * 60;
const NEWBIE_COMBAT_EFFECT_RETENTION_MS = NEWBIE_DAILY_TTL_SECONDS * 1000;

function newbieDailyKey(playerName: string): string {
    return `missions:newbie-daily:${playerName}`;
}

function newbieCombatEffects(state: NewbieDailyState | null | undefined): NewbieCombatMissionEffect[] {
    return Array.isArray(state?.combatMissionEffects)
        ? state.combatMissionEffects.filter((entry) => entry?.version === 1
            && typeof entry.runId === 'string'
            && entry.runId.length > 0
            && Number.isSafeInteger(entry.ryoAwarded)
            && entry.ryoAwarded >= 0
            && Number.isFinite(entry.appliedAt)
            && entry.appliedAt > 0
            && (entry.acknowledgedAt === undefined
                || (Number.isFinite(entry.acknowledgedAt) && entry.acknowledgedAt > 0)))
        : [];
}

function retainedNewbieCombatEffects(
    state: NewbieDailyState | null | undefined,
    now = Date.now(),
): NewbieCombatMissionEffect[] {
    const effects = newbieCombatEffects(state);
    const pending = effects.filter((entry) => entry.acknowledgedAt === undefined);
    const settled = effects
        .filter((entry) => entry.acknowledgedAt !== undefined
            && Number(entry.acknowledgedAt) >= now - NEWBIE_COMBAT_EFFECT_RETENTION_MS)
        .sort((a, b) => Number(b.acknowledgedAt) - Number(a.acknowledgedAt))
        .slice(0, MAX_SETTLED_NEWBIE_COMBAT_EFFECTS);
    return [...pending, ...settled];
}

function pendingRyoGrants(state: NewbieDailyState | null | undefined): PendingNewbieRyoGrant[] {
    return Array.isArray(state?.pendingRyoGrants)
        ? state.pendingRyoGrants.filter((grant) => Boolean(grant)
            && parseSettlementRequestId(grant.id) === grant.id
            && Number.isSafeInteger(grant.ryo)
            && grant.ryo > 0
            && Array.isArray(grant.missionIds)
            && Number.isFinite(grant.at)
            && grant.at > 0)
        : [];
}

function newbieDailyWriteOptions(state: NewbieDailyState): { ex: number } | undefined {
    return newbieCombatEffects(state).some((entry) => entry.acknowledgedAt === undefined)
        || pendingRyoGrants(state).length > 0
        ? undefined
        : { ex: NEWBIE_DAILY_TTL_SECONDS };
}

function fromNewbieTemplate(t: NewbieMissionTemplate, dateKey: string): NewbieDailyMission {
    return {
        id: `${t.templateId}:${dateKey}`,
        templateId: t.templateId,
        kind: t.kind,
        name: t.name,
        description: t.description,
        target: t.target,
        progress: 0,
        ryoReward: t.ryoReward,
        completedAt: null,
    };
}

// Load (or issue) today's new-shinobi dailies. Callers should only invoke this
// for players WITHOUT a profession.
export async function loadOrIssueNewbieDailies(
    playerName: string,
    now = new Date(),
): Promise<NewbieDailyState> {
    return withKvLock(newbieDailyKey(playerName), () => loadOrIssueNewbieDailiesUnderLock(playerName, now), { failClosed: true });
}

async function loadOrIssueNewbieDailiesUnderLock(playerName: string, now: Date): Promise<NewbieDailyState> {
    const today = utcDateKey(now);
    const existing = await kv.get<NewbieDailyState>(newbieDailyKey(playerName));
    if (existing && existing.date === today) return existing;
    const picks = pickNewbieMissions(playerName, today);
    const retainedEffects = retainedNewbieCombatEffects(existing, now.getTime());
    const owed = pendingRyoGrants(existing);
    const state: NewbieDailyState = {
        date: today,
        missions: picks.map(t => fromNewbieTemplate(t, today)),
        ...(retainedEffects.length > 0 ? { combatMissionEffects: retainedEffects } : {}),
        ...(owed.length > 0 ? { pendingRyoGrants: owed } : {}),
    };
    await kv.set(newbieDailyKey(playerName), state, newbieDailyWriteOptions(state));
    return state;
}

export type NewbieCompletedInfo = { id: string; name: string; ryoReward: number };

// Progress the new-shinobi dailies for a matching event kind. No-op for players
// who have a profession, apart from paying ryo they were already owed.
// Completions are paid as receipted grants, the same model as the profession
// dailies. Locks the newbie-daily key for the read-modify-write so concurrent
// reports can't lose an increment.
export async function reportNewbieEvent(opts: {
    playerName: string;
    kind: NewbieMissionKind;
    now?: Date;
}): Promise<{ ryoAwarded: number; completed: NewbieCompletedInfo[] }> {
    const { playerName, kind } = opts;
    const now = opts.now ?? new Date();

    // Cheap gate before taking the lock: only pre-profession players have a
    // newbie set.
    const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    const char = save?.character as Record<string, unknown> | undefined;
    if (!char) return { ryoAwarded: 0, completed: [] };
    if (char.profession) {
        // Ryo a completion earned before the player chose a profession is still
        // theirs (the combat-claim saga pays its newbie ryo by the same rule).
        // claim-mission keeps calling this after the choice, so it is where a
        // grant left owed across that choice gets paid.
        await settlePendingNewbieRyoGrants(playerName);
        return { ryoAwarded: 0, completed: [] };
    }

    const dKey = newbieDailyKey(playerName);
    const result = await withKvLock(dKey, async () => {
        const state = await loadOrIssueNewbieDailiesUnderLock(playerName, now);
        const owed = pendingRyoGrants(state);
        let ryoAwarded = 0;
        const completed: NewbieCompletedInfo[] = [];
        let changed = false;
        const next = state.missions.map(m => {
            if (m.kind !== kind || m.completedAt) return m;
            const nextProgress = m.progress + 1;
            changed = true;
            if (nextProgress >= m.target) {
                ryoAwarded += m.ryoReward;
                completed.push({ id: m.id, name: m.name, ryoReward: m.ryoReward });
                return { ...m, progress: m.target, completedAt: Date.now() };
            }
            return { ...m, progress: nextProgress };
        });
        // The completion and the ryo it is owed commit in this one write.
        const grant: PendingNewbieRyoGrant | null = ryoAwarded > 0 ? {
            id: newMissionGrantId('nry'),
            ryo: ryoAwarded,
            missionIds: completed.map((mission) => mission.id),
            at: Date.now(),
        } : null;
        if (grant && owed.length >= MAX_PENDING_MISSION_GRANTS) throw new Error('newbie-ryo-grants-pending-overflow');
        if (changed) {
            const nextState: NewbieDailyState = {
                ...state,
                missions: next,
                ...(grant ? { pendingRyoGrants: [...owed, grant] } : {}),
            };
            await kv.set(dKey, nextState, newbieDailyWriteOptions(nextState));
        }
        return { ryoAwarded, completed, grantsOwed: owed.length > 0 || grant !== null };
    }, { failClosed: true });

    // As in reportMissionEvent: credit outside the daily lock, and leave a
    // failed credit owed for the next report or read.
    const { grantsOwed, ...event } = result;
    if (grantsOwed) await settlePendingNewbieRyoGrants(playerName);
    return event;
}

/** Apply both mission-combat newbie signals exactly once for a sealed run. */
export async function reportNewbieCombatRunOnce(opts: {
    playerName: string;
    runId: string;
    settledAt: number;
}): Promise<{ applied: boolean; ryoAwarded: number }> {
    const dKey = newbieDailyKey(opts.playerName);
    return withKvLock(dKey, async () => {
        const eventDate = new Date(opts.settledAt);
        const eventDateKey = utcDateKey(eventDate);
        const beforeIssue = await kv.get<NewbieDailyState>(dKey);
        const priorEffect = newbieCombatEffects(beforeIssue).find((entry) => entry.runId === opts.runId);
        if (priorEffect) return { applied: false, ryoAwarded: priorEffect.ryoAwarded };
        const save = await kv.get<Record<string, unknown>>(`save:${opts.playerName}`);
        const char = save?.character as Record<string, unknown> | undefined;
        if (!char || char.profession) return { applied: false, ryoAwarded: 0 };
        const targetDate = beforeIssue && beforeIssue.date > eventDateKey
            ? new Date(`${beforeIssue.date}T00:00:00.000Z`)
            : eventDate;
        await loadOrIssueNewbieDailiesUnderLock(opts.playerName, targetDate);
        const expected = await kv.get<NewbieDailyState>(dKey);
        if (!expected || expected.date !== utcDateKey(targetDate)) {
            throw new Error('newbie-combat-effect-daily-state-unavailable');
        }
        const effects = retainedNewbieCombatEffects(expected);
        const replay = effects.find((entry) => entry.runId === opts.runId);
        if (replay) return { applied: false, ryoAwarded: replay.ryoAwarded };
        if (effects.filter((entry) => entry.acknowledgedAt === undefined).length >= MAX_PENDING_NEWBIE_COMBAT_EFFECTS) {
            throw new Error('newbie-combat-effect-pending-overflow');
        }
        const kinds: NewbieMissionKind[] = ['newbie-missions', 'newbie-battle-wins'];
        let ryoAwarded = 0;
        const appliedAt = Date.now();
        const missions = expected.missions.map((mission) => {
            if (!kinds.includes(mission.kind) || mission.completedAt) return mission;
            const progress = mission.progress + 1;
            if (progress >= mission.target) {
                ryoAwarded += mission.ryoReward;
                return { ...mission, progress: mission.target, completedAt: appliedAt };
            }
            return { ...mission, progress };
        });
        const next: NewbieDailyState = {
            ...expected,
            missions,
            combatMissionEffects: [...effects, {
                version: 1,
                runId: opts.runId,
                kinds,
                ryoAwarded,
                appliedAt,
            }],
        };
        let writeError: unknown;
        let swapped = false;
        try {
            swapped = await kv.compareSet(dKey, expected, next, newbieDailyWriteOptions(next));
        } catch (error) {
            writeError = error;
        }
        const confirmed = newbieCombatEffects(await kv.get<NewbieDailyState>(dKey))
            .find((entry) => entry.runId === opts.runId);
        if (swapped || (confirmed && confirmed.ryoAwarded === ryoAwarded)) {
            return { applied: true, ryoAwarded };
        }
        if (writeError) throw writeError;
        throw new Error('newbie-combat-effect-write-conflict');
    }, { failClosed: true });
}

/** Mark the cross-row newbie effect recoverably complete after save credit. */
export async function acknowledgeNewbieCombatRun(playerName: string, runId: string): Promise<void> {
    const dKey = newbieDailyKey(playerName);
    await withKvLock(dKey, async () => {
        const expected = await kv.get<NewbieDailyState>(dKey);
        if (!expected) return;
        const effects = retainedNewbieCombatEffects(expected);
        const target = effects.find((entry) => entry.runId === runId);
        if (!target || target.acknowledgedAt !== undefined) return;
        const next: NewbieDailyState = {
            ...expected,
            combatMissionEffects: retainedNewbieCombatEffects({
                ...expected,
                combatMissionEffects: effects.map((entry) => entry.runId === runId
                    ? { ...entry, acknowledgedAt: Date.now() }
                    : entry),
            }),
        };
        const swapped = await kv.compareSet(dKey, expected, next, newbieDailyWriteOptions(next));
        if (swapped) return;
        const readback = await kv.get<NewbieDailyState>(dKey);
        if (newbieCombatEffects(readback).some((entry) => entry.runId === runId
            && entry.acknowledgedAt !== undefined)) return;
        throw new Error('newbie-combat-effect-ack-conflict');
    }, { failClosed: true });
}

// ── Exactly-once mission rewards ───────────────────────────────────────────────
// A completion and its reward live in two rows: the daily row records the
// mission complete, and the save holds the profession XP or ryo. No write spans
// both, so the reward settles in three steps, each safe to repeat:
//
//   1. The daily-row write that completes a mission also records a pending
//      grant: a fresh id, the amount and the mission ids. Nothing is paid yet.
//   2. One save write credits the grant AND stamps its id into the save's
//      serverSettlementReceipts. A retry that finds the stamp pays nothing.
//   3. The grant is removed from the daily row.
//
// Every report settles what its row still owes, and so does the daily panel
// read. A credit that fails after step 1 (a contended save lock, a crash, a
// transport error, a lost compare-and-set) is paid by the next attempt instead
// of being dropped. A step 3 that fails only means the next attempt finds the
// stamp and clears the grant. The receipt list is capped, so a missing stamp
// proves "unpaid" only while receiptAbsenceProvable shows nothing newer was
// evicted. Otherwise the grant is refused and logged, never paid twice.

const MAX_PENDING_MISSION_GRANTS = 32;
const MISSION_XP_RECEIPT_KIND = 'daily-mission-xp';
const NEWBIE_RYO_RECEIPT_KIND = 'newbie-mission-ryo';

function newMissionGrantId(prefix: 'mxp' | 'nry'): string {
    // Random rather than derived from the mission ids: switching profession
    // away and back re-issues the same mission ids on the same day, and that
    // second completion is owed its own payment.
    return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

type MissionGrantPayment =
    /** Credited by this call, in the write that committed `saveVersion`. */
    | { status: 'paid'; saveVersion: number }
    /** The save already carries this grant's receipt. */
    | { status: 'replayed' }
    /** Nothing to credit: the save is gone, or (XP) the player changed profession. */
    | { status: 'void'; reason: string }
    /** The receipt may have aged out of the capped list, so paying could pay twice. */
    | { status: 'unprovable'; reason: string };

type MissionGrantCredit =
    | { character: PlayerCharacter; receipt: Record<string, unknown> }
    | { void: string };

async function payMissionGrant(
    playerName: string,
    grant: { id: string; at: number },
    fingerprint: string,
    credit: (character: PlayerCharacter) => MissionGrantCredit,
): Promise<MissionGrantPayment> {
    // The decision is keyed by the grant's receipt, so running it again after a
    // lost compare-and-set cannot pay twice.
    const out = await retryOnSaveVersionConflict(() => mutatePlayerSave<MissionGrantPayment>(playerName, ({ character }) => {
        const inspected = inspectSettlementReceipt(character, grant.id, fingerprint);
        if (inspected.status === 'replay') return { ok: true, write: false, character, value: { status: 'replayed' } };
        const credited = credit(character);
        if ('void' in credited) return { ok: true, write: false, character, value: { status: 'void', reason: credited.void } };
        if (inspected.status !== 'fresh') {
            return { ok: true, write: false, character, value: { status: 'unprovable', reason: `settlement receipts are ${inspected.status}` } };
        }
        const receipts = Array.isArray(character[SERVER_SETTLEMENT_RECEIPTS_FIELD])
            ? character[SERVER_SETTLEMENT_RECEIPTS_FIELD] as unknown[]
            : [];
        if (!receiptAbsenceProvable(receipts, SERVER_SETTLEMENT_RECEIPT_LIMIT, 'settledAt', grant.at)) {
            return { ok: true, write: false, character, value: { status: 'unprovable', reason: 'the receipt may have aged out' } };
        }
        return {
            ok: true,
            character: appendSettlementReceipt(credited.character, inspected.receipts, {
                requestId: grant.id,
                fingerprint,
                value: credited.receipt,
                settledAt: Date.now(),
            }),
            value: { status: 'paid', saveVersion: 0 },
        };
    }));
    if (!out.ok) {
        if (out.status === 404) return { status: 'void', reason: 'no save' };
        throw new Error(`mission grant credit refused (${out.status}): ${out.error}`);
    }
    return out.value.status === 'paid' ? { status: 'paid', saveVersion: out._saveVersion } : out.value;
}

async function clearSettledXpGrants(playerName: string, ids: readonly string[]): Promise<void> {
    const dKey = dailyKey(playerName);
    await withKvLock(dKey, async () => {
        const state = await kv.get<DailyMissionsState>(dKey);
        if (!state) return;
        const owed = pendingXpGrants(state);
        const remaining = owed.filter((grant) => !ids.includes(grant.id));
        if (remaining.length === owed.length) return;
        const next: DailyMissionsState = { ...state, pendingXpGrants: remaining };
        if (remaining.length === 0) delete next.pendingXpGrants;
        await kv.set(dKey, next, dailyWriteOptions(next));
    }, { failClosed: true });
}

async function clearSettledRyoGrants(playerName: string, ids: readonly string[]): Promise<void> {
    const dKey = newbieDailyKey(playerName);
    await withKvLock(dKey, async () => {
        const state = await kv.get<NewbieDailyState>(dKey);
        if (!state) return;
        const owed = pendingRyoGrants(state);
        const remaining = owed.filter((grant) => !ids.includes(grant.id));
        if (remaining.length === owed.length) return;
        const next: NewbieDailyState = { ...state, pendingRyoGrants: remaining };
        if (remaining.length === 0) delete next.pendingRyoGrants;
        await kv.set(dKey, next, newbieDailyWriteOptions(next));
    }, { failClosed: true });
}

export type MissionGrantSettlement = {
    /** The save version the last credit committed, or null when this call credited nothing. */
    saveVersion: number | null;
    /** True when a grant is still owed after this attempt; the next report or read retries it. */
    deferred: boolean;
};

async function settleOwedGrants<G extends { id: string }>(
    playerName: string,
    track: string,
    owed: readonly G[],
    pay: (grant: G) => Promise<MissionGrantPayment>,
    clear: (ids: readonly string[]) => Promise<void>,
): Promise<MissionGrantSettlement> {
    let saveVersion: number | null = null;
    let deferred = false;
    const settled: string[] = [];
    for (const grant of owed) {
        let payment: MissionGrantPayment;
        try {
            payment = await pay(grant);
        } catch (error) {
            // Usually the save lock is contended, and the grants after this one
            // would fail the same way. Each stays owed for the next attempt.
            console.warn(`[missions] ${track} grant deferred`, {
                playerName,
                grantId: grant.id,
                error: error instanceof Error ? error.message : String(error),
            });
            deferred = true;
            break;
        }
        if (payment.status === 'paid') saveVersion = payment.saveVersion;
        if (payment.status === 'unprovable') {
            console.error(`[missions] ${track} grant needs reconciliation; it was not paid`, { playerName, grant, reason: payment.reason });
        } else if (payment.status === 'void') {
            console.warn(`[missions] ${track} grant void`, { playerName, grant, reason: payment.reason });
        }
        settled.push(grant.id);
    }
    if (settled.length > 0) {
        try {
            await clear(settled);
        } catch (error) {
            // The credits stand. The next attempt finds their receipts and only clears.
            console.warn(`[missions] ${track} grant cleanup deferred`, {
                playerName,
                grantIds: settled,
                error: error instanceof Error ? error.message : String(error),
            });
            deferred = true;
        }
    }
    return { saveVersion, deferred };
}

/** Pay the profession XP a player's daily row still owes. Never throws. */
export async function settlePendingMissionXpGrants(playerName: string): Promise<MissionGrantSettlement> {
    let owed: PendingMissionXpGrant[];
    try {
        owed = pendingXpGrants(await kv.get<DailyMissionsState>(dailyKey(playerName)));
    } catch (error) {
        console.warn('[missions] profession XP grants unreadable', { playerName, error: error instanceof Error ? error.message : String(error) });
        return { saveVersion: null, deferred: true };
    }
    if (owed.length === 0) return { saveVersion: null, deferred: false };
    return settleOwedGrants(playerName, 'profession XP', owed, (grant) => payMissionGrant(
        playerName,
        grant,
        settlementFingerprint({ kind: MISSION_XP_RECEIPT_KIND, profession: grant.profession, xp: grant.xp, missionIds: grant.missionIds }),
        (character) => {
            // XP earned in one profession is never credited to another, the same
            // rule the grant applied before it could be retried.
            if (character.profession !== grant.profession) return { void: 'the player changed profession' };
            const awarded = professionXpAfterAward(grant.profession, character.professionXp, character.professionRank, grant.xp);
            return {
                character: { ...character, professionXp: awarded.xp, professionRank: awarded.rank },
                receipt: { kind: MISSION_XP_RECEIPT_KIND, missionIds: grant.missionIds, xp: awarded.granted },
            };
        },
    ), (ids) => clearSettledXpGrants(playerName, ids));
}

/** Pay the ryo a player's newbie daily row still owes. Never throws. */
export async function settlePendingNewbieRyoGrants(playerName: string): Promise<MissionGrantSettlement> {
    let owed: PendingNewbieRyoGrant[];
    try {
        owed = pendingRyoGrants(await kv.get<NewbieDailyState>(newbieDailyKey(playerName)));
    } catch (error) {
        console.warn('[missions] newbie ryo grants unreadable', { playerName, error: error instanceof Error ? error.message : String(error) });
        return { saveVersion: null, deferred: true };
    }
    if (owed.length === 0) return { saveVersion: null, deferred: false };
    return settleOwedGrants(playerName, 'newbie ryo', owed, (grant) => payMissionGrant(
        playerName,
        grant,
        settlementFingerprint({ kind: NEWBIE_RYO_RECEIPT_KIND, ryo: grant.ryo, missionIds: grant.missionIds }),
        // Ryo belongs to no profession: a completion earned before the player
        // chose one is still paid (see reportNewbieEvent).
        (character) => ({
            character: { ...character, ryo: Number(character.ryo ?? 0) + grant.ryo },
            receipt: { kind: NEWBIE_RYO_RECEIPT_KIND, missionIds: grant.missionIds, ryo: grant.ryo },
        }),
    ), (ids) => clearSettledRyoGrants(playerName, ids));
}
