import { playerSlug } from "./utils";
import type { Character } from "../types/character";

export type RaidReportOutboxStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY_PREFIX = "pvpRaidReportOutbox.v1:";
export const RAID_REPORT_OUTBOX_MAX_AGE_MS = 25 * 60 * 60 * 1000;

export type RaidReportOutboxEntry = {
    battleId: string;
    sector: number;
    addedAt: number;
};

export type RaidReportMissionComplete = { id: string; name: string; xpReward: number };

export type RaidReportAcknowledgement = {
    entry: RaidReportOutboxEntry;
    fetchMissionsCredited: string[];
    missionsCompleted: RaidReportMissionComplete[];
    character?: Character;
    saveVersion?: number;
    territoryDamage: number;
    sector: number | null;
};

export type RaidReportDrainResult = {
    playerName: string;
    acknowledgements: RaidReportAcknowledgement[];
};

const liveEntries = new Map<string, RaidReportOutboxEntry[]>();
const flushInFlight = new Map<string, Promise<RaidReportDrainResult | undefined>>();

const storageKey = (player: string) => `${KEY_PREFIX}${playerSlug(player)}`;

function defaultStorage(): RaidReportOutboxStorage | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

function cleanEntries(value: unknown, now = Date.now()): RaidReportOutboxEntry[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
        .filter((entry): entry is RaidReportOutboxEntry => !!entry && typeof entry === "object"
            && typeof (entry as RaidReportOutboxEntry).battleId === "string"
            && (entry as RaidReportOutboxEntry).battleId.trim().length > 0
            && (entry as RaidReportOutboxEntry).battleId.length <= 160
            && Number.isInteger((entry as RaidReportOutboxEntry).sector)
            && (entry as RaidReportOutboxEntry).sector >= 0
            && (entry as RaidReportOutboxEntry).sector <= 999
            && Number.isFinite((entry as RaidReportOutboxEntry).addedAt)
            && (entry as RaidReportOutboxEntry).addedAt > 0
            && (entry as RaidReportOutboxEntry).addedAt <= now + 5 * 60 * 1000
            && now - (entry as RaidReportOutboxEntry).addedAt <= RAID_REPORT_OUTBOX_MAX_AGE_MS)
        .map((entry) => ({ ...entry, battleId: entry.battleId.trim() }))
        .filter((entry) => {
            if (seen.has(entry.battleId)) return false;
            seen.add(entry.battleId);
            return true;
        })
        .slice(-20);
}

function writeEntries(
    player: string,
    entries: RaidReportOutboxEntry[],
    storage: RaidReportOutboxStorage | null,
): void {
    const key = playerSlug(player);
    if (!key) return;
    const cleaned = cleanEntries(entries);
    if (cleaned.length > 0) liveEntries.set(key, cleaned);
    else liveEntries.delete(key);
    if (!storage) return;
    try {
        if (cleaned.length > 0) storage.setItem(storageKey(player), JSON.stringify(cleaned));
        else storage.removeItem(storageKey(player));
    } catch { /* live memory still preserves same-session retry in private mode */ }
}

export function readRaidReportOutbox(
    player: string,
    storage: RaidReportOutboxStorage | null = defaultStorage(),
): RaidReportOutboxEntry[] {
    const key = playerSlug(player);
    if (!key) return [];
    let stored: unknown[] = [];
    if (storage) {
        try {
            const raw = storage.getItem(storageKey(player));
            stored = raw ? JSON.parse(raw) as unknown[] : [];
        } catch { stored = []; }
    }
    const merged = cleanEntries([...(stored ?? []), ...(liveEntries.get(key) ?? [])]);
    writeEntries(player, merged, storage);
    return merged;
}

export function enqueueRaidReport(
    player: string,
    battleId: string,
    sector: number,
    storage: RaidReportOutboxStorage | null = defaultStorage(),
): void {
    const id = battleId.trim();
    if (!playerSlug(player) || !id || id.length > 160 || !Number.isInteger(sector) || sector < 0 || sector > 999) return;
    const entries = readRaidReportOutbox(player, storage);
    if (entries.some((entry) => entry.battleId === id)) return;
    writeEntries(player, [...entries, { battleId: id, sector, addedAt: Date.now() }], storage);
}

export function removeRaidReport(
    player: string,
    battleId: string,
    storage: RaidReportOutboxStorage | null = defaultStorage(),
): void {
    writeEntries(player, readRaidReportOutbox(player, storage).filter((entry) => entry.battleId !== battleId), storage);
}

type Reporter = (playerName: string, entry: RaidReportOutboxEntry) => Promise<RaidReportAcknowledgement | null>;

export async function postPvpRaidReport(
    playerName: string,
    entry: RaidReportOutboxEntry,
): Promise<RaidReportAcknowledgement | null> {
    try {
        const response = await fetch("/api/missions/report-raid", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, battleId: entry.battleId }),
        });
        const data = await response.json().catch(() => null) as {
            ok?: boolean;
            fetchMissionsCredited?: unknown;
            missionsCompleted?: unknown;
            raidProgression?: {
                fetchMissionsCredited?: unknown;
                missionsCompleted?: unknown;
                territoryDamage?: unknown;
                sector?: unknown;
            };
            character?: unknown;
            _saveVersion?: unknown;
            territoryDamage?: unknown;
            sector?: unknown;
        } | null;
        // The exact credited-id array is the authoritative ACK, including an
        // empty array. Bare HTTP 200 or alreadyReported without that projection
        // stays parked so a rolling server cannot silently discard mission UI.
        const projectedCredits = data?.raidProgression?.fetchMissionsCredited ?? data?.fetchMissionsCredited;
        if (!response.ok || data?.ok !== true || !Array.isArray(projectedCredits)) return null;
        const credited = Array.from(new Set(projectedCredits
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter(Boolean)));
        const projectedCompletions = data.raidProgression?.missionsCompleted ?? data.missionsCompleted;
        const missionsCompleted = Array.isArray(projectedCompletions)
            ? projectedCompletions.filter((mission): mission is RaidReportMissionComplete => !!mission
                && typeof mission === "object"
                && typeof (mission as RaidReportMissionComplete).id === "string"
                && typeof (mission as RaidReportMissionComplete).name === "string"
                && Number.isFinite((mission as RaidReportMissionComplete).xpReward))
            : [];
        const saveVersion = Number(data._saveVersion);
        const territoryDamage = Math.max(0, Number(data.raidProgression?.territoryDamage ?? data.territoryDamage) || 0);
        const projectedSector = Number(data.raidProgression?.sector ?? data.sector);
        const sector = Number.isSafeInteger(projectedSector) ? Math.floor(projectedSector) : null;
        return {
            entry,
            fetchMissionsCredited: credited,
            missionsCompleted,
            ...(data.character && typeof data.character === "object" ? { character: data.character as Character } : {}),
            ...(Number.isFinite(saveVersion) ? { saveVersion } : {}),
            territoryDamage,
            sector,
        };
    } catch {
        return null;
    }
}

export async function flushRaidReportOutbox(
    playerName: string,
    storage: RaidReportOutboxStorage | null = defaultStorage(),
    reporter: Reporter = postPvpRaidReport,
): Promise<RaidReportDrainResult | undefined> {
    const key = playerSlug(playerName);
    if (!key) return undefined;
    const existing = flushInFlight.get(key);
    if (existing) return existing;
    const entries = readRaidReportOutbox(playerName, storage);
    if (entries.length === 0) return undefined;
    const flight = (async () => {
        const acknowledgements: RaidReportAcknowledgement[] = [];
        for (const entry of entries) {
            const acknowledged = await reporter(playerName, entry);
            if (!acknowledged) continue;
            removeRaidReport(playerName, entry.battleId, storage);
            acknowledgements.push(acknowledged);
        }
        return { playerName, acknowledgements };
    })();
    flushInFlight.set(key, flight);
    try {
        return await flight;
    } finally {
        if (flushInFlight.get(key) === flight) flushInFlight.delete(key);
    }
}
