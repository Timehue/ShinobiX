import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { mergePreservingImages, safeName } from './_utils.js';
import { bumpSaveVersion } from './save/_save-version.js';

export const CLAN_POINTS_WEEKLY_CAP = 1_000;
export const CLAN_POINT_HISTORY_LIMIT = 30;
export const MAX_CLAN_POINTS_AWARD = 250;

export const CLAN_POINT_SOURCES = [
    'clanMissionContribution',
    'clanMissionClaim',
    'clanBossParticipation',
    'clanBossDefeat',
    'clanWarParticipation',
    'clanWarWin',
    'territoryCapture',
    'territoryDefense',
    'guardDuty',
    'mentorMilestone',
    'clanRaid',
] as const;

export type ClanPointSource = typeof CLAN_POINT_SOURCES[number];

export const DISALLOWED_CLAN_POINT_SOURCES = [
    'missionComplete',
    'trainingComplete',
    'jutsuTrainingComplete',
    'pveWin',
    'storyBoss',
    'donation',
    'login',
    'shopPurchase',
    'bankAction',
] as const;

const SOURCE_SET = new Set<string>(CLAN_POINT_SOURCES);

export type ClanPointHistoryEntry = {
    id: string;
    ts: number;
    source: ClanPointSource;
    amount: number;
    weekKey: string;
    metadata?: Record<string, unknown>;
};

export type ClanPointAwardResult<T extends Record<string, unknown> = Record<string, unknown>> = {
    character: T;
    awarded: number;
    requested: number;
    weekKey: string;
    weeklyEarned: number;
    weeklyCap: number;
    reason?: 'not-in-clan' | 'invalid-source' | 'invalid-amount' | 'duplicate-event' | 'weekly-cap';
};

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function floorNonNegative(v: unknown): number {
    return Math.max(0, Math.floor(num(v)));
}

function isoWeekParts(date: Date): { year: number; week: number } {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
    return { year: d.getUTCFullYear(), week };
}

export function clanPointWeekKey(date: Date = new Date()): string {
    const { year, week } = isoWeekParts(date);
    return `${year}-W${String(week).padStart(2, '0')}`;
}

export function clanPointMonthKey(date: Date = new Date()): string {
    return date.toISOString().slice(0, 7);
}

export function isAllowedClanPointSource(source: unknown): source is ClanPointSource {
    return typeof source === 'string' && SOURCE_SET.has(source);
}

export function awardClanPoints<T extends Record<string, unknown>>(
    character: T,
    source: ClanPointSource,
    amount: number,
    metadata: Record<string, unknown> = {},
    now: Date = new Date(),
): ClanPointAwardResult<T> {
    const weekKey = clanPointWeekKey(now);
    const requested = Math.min(MAX_CLAN_POINTS_AWARD, Math.max(0, Math.floor(Number(amount) || 0)));

    if (!character.clan) {
        return { character, awarded: 0, requested, weekKey, weeklyEarned: floorNonNegative(character.weeklyClanPoints), weeklyCap: CLAN_POINTS_WEEKLY_CAP, reason: 'not-in-clan' };
    }
    if (!isAllowedClanPointSource(source)) {
        return { character, awarded: 0, requested, weekKey, weeklyEarned: floorNonNegative(character.weeklyClanPoints), weeklyCap: CLAN_POINTS_WEEKLY_CAP, reason: 'invalid-source' };
    }
    if (requested <= 0) {
        return { character, awarded: 0, requested, weekKey, weeklyEarned: floorNonNegative(character.weeklyClanPoints), weeklyCap: CLAN_POINTS_WEEKLY_CAP, reason: 'invalid-amount' };
    }

    const prevWeek = String(character.weeklyClanPointsWeek ?? '');
    const currentWeekly = prevWeek === weekKey ? floorNonNegative(character.weeklyClanPoints) : 0;
    const existingHistory = Array.isArray(character.clanPointHistory)
        ? character.clanPointHistory.filter((entry): entry is ClanPointHistoryEntry => !!entry && typeof entry === 'object')
        : [];
    const ts = now.getTime();
    const eventId = typeof metadata.eventId === 'string' && metadata.eventId.trim()
        ? metadata.eventId.trim()
        : `${source}:${ts}`;
    if (existingHistory.some((entry) => entry.id === eventId)) {
        return { character, awarded: 0, requested, weekKey, weeklyEarned: currentWeekly, weeklyCap: CLAN_POINTS_WEEKLY_CAP, reason: 'duplicate-event' };
    }
    if (currentWeekly >= CLAN_POINTS_WEEKLY_CAP || currentWeekly + requested > CLAN_POINTS_WEEKLY_CAP) {
        return {
            character: { ...character, weeklyClanPointsWeek: weekKey, weeklyClanPoints: currentWeekly } as T,
            awarded: 0,
            requested,
            weekKey,
            weeklyEarned: currentWeekly,
            weeklyCap: CLAN_POINTS_WEEKLY_CAP,
            reason: 'weekly-cap',
        };
    }
    const historyEntry: ClanPointHistoryEntry = {
        id: eventId,
        ts,
        source,
        amount: requested,
        weekKey,
        metadata: Object.keys(metadata).length ? metadata : undefined,
    };

    const next = {
        ...character,
        clanPoints: floorNonNegative(character.clanPoints) + requested,
        weeklyClanPoints: currentWeekly + requested,
        weeklyClanPointsWeek: weekKey,
        lifetimeClanPoints: floorNonNegative(character.lifetimeClanPoints) + requested,
        clanPointHistory: [historyEntry, ...existingHistory].slice(0, CLAN_POINT_HISTORY_LIMIT),
    } as T;

    return { character: next, awarded: requested, requested, weekKey, weeklyEarned: currentWeekly + requested, weeklyCap: CLAN_POINTS_WEEKLY_CAP };
}

export async function awardClanPointsToPlayerSave(
    playerNameRaw: string,
    source: ClanPointSource,
    amount: number,
    metadata: Record<string, unknown> = {},
): Promise<ClanPointAwardResult & { playerName: string; found: boolean; _saveVersion?: number }> {
    const playerName = safeName(playerNameRaw);
    if (!playerName) {
        const weekKey = clanPointWeekKey();
        return { playerName, found: false, character: {}, awarded: 0, requested: 0, weekKey, weeklyEarned: 0, weeklyCap: CLAN_POINTS_WEEKLY_CAP, reason: 'invalid-amount' };
    }
    return await withKvLock(`save:${playerName}`, async () => {
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = (record?.character ?? null) as Record<string, unknown> | null;
        if (!record || !character) {
            const weekKey = clanPointWeekKey();
            return { playerName, found: false, character: {}, awarded: 0, requested: 0, weekKey, weeklyEarned: 0, weeklyCap: CLAN_POINTS_WEEKLY_CAP };
        }
        const result = awardClanPoints(character, source, amount, metadata);
        const changed = result.character !== character;
        let saveVersion = Number(record._saveVersion ?? 0);
        if (changed) {
            const nextRecord = bumpSaveVersion({ ...record, character: result.character });
            await kv.set(
                `save:${playerName}`,
                mergePreservingImages(nextRecord, record),
            );
            // Return the stamp from the exact record written while this save lock
            // is held. Callers must never re-read after releasing the lock to
            // guess which concurrent version their response should acknowledge.
            saveVersion = Number(nextRecord._saveVersion ?? 0);
        }
        if (result.awarded > 0) {
            await kv.set(`audit:clan-points:${playerName}:${Date.now()}`, {
                ts: Date.now(),
                playerName,
                source,
                amount: result.awarded,
                weekKey: result.weekKey,
                metadata,
            }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);
        }
        return { ...result, playerName, found: true, _saveVersion: saveVersion };
    }, { failClosed: true });
}
