import { kv } from '../_storage.js';
import {
    type Profession,
    type MissionKind,
    type MissionTemplate,
    pickDailyMissions,
} from './_pool.js';

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
    completedAt: number | null;
    claimed: boolean;
};

export type DailyMissionsState = {
    date: string;            // "YYYY-MM-DD" UTC
    profession: Profession;
    missions: DailyMission[];
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

export function utcDateKey(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

// Vanguard Rank 2+ perk: +10% XP on all Vanguard XP gains. Mirrored from the
// client-side professionXpMultiplier in App.tsx so both grant paths agree.
function xpMultiplierFor(profession: Profession, currentRank: number): number {
    if (profession === 'vanguard' && currentRank >= 2) return 1.1;
    return 1;
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
    const record = await kv.get<Record<string, unknown>>(saveKey);
    const char = record?.character as Record<string, unknown> | undefined;
    if (!char || char.profession !== profession) return null;
    const currentRank = Number(char.professionRank ?? 1);
    const boosted = Math.floor(amount * xpMultiplierFor(profession, currentRank));
    const nextXp = Number(char.professionXp ?? 0) + boosted;
    const nextRank = rankFor(profession, nextXp);
    const updated = {
        ...record,
        character: {
            ...char,
            professionXp: nextXp,
            professionRank: nextRank,
        },
    };
    await kv.set(saveKey, updated);
    return { xp: nextXp, rank: nextRank };
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
        completedAt: null,
        claimed: false,
    };
}

// Load (or issue) today's missions for a player. Returns null if profession
// doesn't have missions (e.g., Pet Tamer).
export async function loadOrIssueDailyMissions(
    playerName: string,
    profession: Profession,
    now = new Date(),
): Promise<DailyMissionsState | null> {
    const today = utcDateKey(now);
    const existing = await kv.get<DailyMissionsState>(dailyKey(playerName));
    if (existing && existing.date === today && existing.profession === profession) {
        return existing;
    }
    const picks = pickDailyMissions(profession, playerName, today, 3);
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
}): Promise<{ xpAwarded: number; missionsCompleted: CompletedMissionInfo[] }> {
    const { playerName, profession, kind, targetName } = opts;
    const now = opts.now ?? new Date();
    const state = await loadOrIssueDailyMissions(playerName, profession, now);
    if (!state) return { xpAwarded: 0, missionsCompleted: [] };

    let xpAwarded = 0;
    const completed: CompletedMissionInfo[] = [];
    let changed = false;

    const next = state.missions.map(m => {
        if (m.kind !== kind || m.completedAt) return m;
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

    if (changed) {
        await kv.set(dailyKey(playerName), { ...state, missions: next }, { ex: 36 * 60 * 60 });
    }

    // Auto-grant mission XP onto the player's character.
    if (xpAwarded > 0) {
        await awardProfessionXp(playerName, profession, xpAwarded);
    }

    return { xpAwarded, missionsCompleted: completed };
}
