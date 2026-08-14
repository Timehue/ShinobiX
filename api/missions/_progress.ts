import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
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
// {xp, rank} after the credit. Used by both per-action XP grants and
// mission-completion rewards.
export async function awardProfessionXp(
    playerName: string,
    profession: Profession,
    amount: number,
): Promise<{ xp: number; rank: number } | null> {
    if (amount <= 0) return null;
    const saveKey = `save:${playerName}`;
    // Wrap the read-modify-write under the same lock the save endpoint uses
    // so a concurrent auto-save can't clobber the XP credit, and so two
    // concurrent reportMissionEvent calls (e.g. a Vanguard PvP win + raid
    // report landing in the same tick) don't both read the pre-grant XP
    // and one lose its credit.
    return await withKvLock(saveKey, async () => {
        const record = await kv.get<Record<string, unknown>>(saveKey);
        const char = record?.character as Record<string, unknown> | undefined;
        if (!char || char.profession !== profession) return null;
        const awarded = professionXpAfterAward(profession, char.professionXp, char.professionRank, amount);
        const updated = {
            ...record,
            character: {
                ...char,
                professionXp: awarded.xp,
                professionRank: awarded.rank,
            },
        };
        await kv.set(saveKey, bumpSaveVersion(updated));
        return { xp: awarded.xp, rank: awarded.rank };
    }, { failClosed: true });
}

function dailyKey(playerName: string): string {
    return `missions:daily:${playerName}`;
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
// doesn't have missions. Vanguard Rank 6+ gets 4 missions instead of 3
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
    const today = utcDateKey(now);
    // Look up current rank to determine daily mission slot count.
    const char = loadedCharacter === undefined
        ? (await kv.get<Record<string, unknown>>(`save:${playerName}`))?.character as Record<string, unknown> | undefined
        : loadedCharacter ?? undefined;
    const currentRank = Number(char?.professionRank ?? 1);
    const slotCount = (profession === 'vanguard' && currentRank >= 6) ? 4 : 3;

    const existing = await kv.get<DailyMissionsState>(dailyKey(playerName));
    if (existing && existing.date === today && existing.profession === profession) {
        if (!char) return existing;
        const repaired = repairDailyMissionsForEligibility({ state: existing, playerName, today, slotCount, character: char });
        if (repaired.replacements.length > 0) {
            await kv.set(dailyKey(playerName), repaired.state, { ex: 36 * 60 * 60 });
            console.warn('[missions/daily] replaced ineligible stored missions', {
                playerName,
                replacements: repaired.replacements,
            });
        }
        return repaired.state;
    }

    const picks = pickDailyMissionsForPlayer({ profession, playerName, dateKey: today, count: slotCount, character: char ?? {} });
    if (picks.length === 0) return null;
    const state: DailyMissionsState = {
        date: today,
        profession,
        missions: picks.map(t => fromTemplate(t, today)),
    };
    await kv.set(dailyKey(playerName), state, { ex: 36 * 60 * 60 });
    return state;
}

export type CompletedMissionInfo = {
    id: string;
    name: string;
    xpReward: number;
};

// Increment progress on all of a player's missions matching the given kind.
// For unique-target missions, the target name dedupes within the day.
// Returns the total profession XP awarded (auto-grant on completion).
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
        const state = await loadOrIssueDailyMissions(playerName, profession, now, char);
        if (!state) return { xpAwarded: 0, missionsCompleted: [] as CompletedMissionInfo[] };

        const receiptId = typeof opts.receiptId === 'string' ? opts.receiptId.trim().slice(0, 160) : '';
        const eventReceipts = Array.isArray(state.eventReceipts)
            ? state.eventReceipts.filter((entry) => entry && typeof entry.id === 'string').slice(-127)
            : [];
        const prior = receiptId ? eventReceipts.find((entry) => entry.id === receiptId && entry.kind === kind) : undefined;
        if (prior) return {
            xpAwarded: Math.max(0, Math.floor(Number(prior.xpAwarded) || 0)),
            missionsCompleted: Array.isArray(prior.missionsCompleted) ? prior.missionsCompleted : [],
            replayed: true,
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

        if (changed || receiptId) {
            const eventReceipt: DailyMissionEventReceipt | null = receiptId ? {
                id: receiptId,
                kind,
                xpAwarded,
                missionsCompleted: completed,
                appliedAt: Date.now(),
            } : null;
            await kv.set(dKey, {
                ...state,
                missions: next,
                ...(eventReceipt ? { eventReceipts: [...eventReceipts, eventReceipt] } : {}),
            }, { ex: 36 * 60 * 60 });
        }
        return { xpAwarded, missionsCompleted: completed };
    }, { failClosed: true });

    // Auto-grant mission XP onto the player's character. awardProfessionXp
    // takes its own lock on save:<player> so we don't nest locks here.
    if (result.xpAwarded > 0 && opts.deferXpAward !== true) {
        await awardProfessionXp(playerName, profession, result.xpAwarded);
    }

    return result;
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

function newbieDailyWriteOptions(state: NewbieDailyState): { ex: number } | undefined {
    return newbieCombatEffects(state).some((entry) => entry.acknowledgedAt === undefined)
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
    const today = utcDateKey(now);
    const existing = await kv.get<NewbieDailyState>(newbieDailyKey(playerName));
    if (existing && existing.date === today) return existing;
    const picks = pickNewbieMissions(playerName, today);
    const retainedEffects = retainedNewbieCombatEffects(existing, now.getTime());
    const state: NewbieDailyState = {
        date: today,
        missions: picks.map(t => fromNewbieTemplate(t, today)),
        ...(retainedEffects.length > 0 ? { combatMissionEffects: retainedEffects } : {}),
    };
    await kv.set(newbieDailyKey(playerName), state, newbieDailyWriteOptions(state));
    return state;
}

// Grant ryo to the player's character, under the same save lock the save
// endpoint uses (mirrors awardProfessionXp). Re-checks "no profession" inside
// the lock so a player who chose a profession between the report and the grant
// is never paid the newbie reward.
async function awardNewbieRyo(playerName: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    const saveKey = `save:${playerName}`;
    await withKvLock(saveKey, async () => {
        const record = await kv.get<Record<string, unknown>>(saveKey);
        const char = record?.character as Record<string, unknown> | undefined;
        if (!char || char.profession) return;
        const updated = {
            ...record,
            character: { ...char, ryo: Number(char.ryo ?? 0) + amount },
        };
        await kv.set(saveKey, bumpSaveVersion(updated));
    }, { failClosed: true });
}

export type NewbieCompletedInfo = { id: string; name: string; ryoReward: number };

// Progress the new-shinobi dailies for a matching event kind. No-op for players
// who have a profession. Auto-grants ryo on completion (same model as the
// profession dailies' auto-grant). Locks the newbie-daily key for the
// read-modify-write so concurrent reports can't lose an increment.
export async function reportNewbieEvent(opts: {
    playerName: string;
    kind: NewbieMissionKind;
    now?: Date;
}): Promise<{ ryoAwarded: number; completed: NewbieCompletedInfo[] }> {
    const { playerName, kind } = opts;
    const now = opts.now ?? new Date();

    // Cheap gate before taking the lock: only pre-profession players have a
    // newbie set. (Re-checked inside awardNewbieRyo under the save lock.)
    const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    const char = save?.character as Record<string, unknown> | undefined;
    if (!char || char.profession) return { ryoAwarded: 0, completed: [] };

    const dKey = newbieDailyKey(playerName);
    const result = await withKvLock(dKey, async () => {
        const state = await loadOrIssueNewbieDailies(playerName, now);
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
        if (changed) {
            const nextState = { ...state, missions: next };
            await kv.set(dKey, nextState, newbieDailyWriteOptions(nextState));
        }
        return { ryoAwarded, completed };
    }, { failClosed: true });

    if (result.ryoAwarded > 0) {
        await awardNewbieRyo(playerName, result.ryoAwarded);
    }
    return result;
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
        await loadOrIssueNewbieDailies(opts.playerName, targetDate);
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
