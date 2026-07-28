// Public, query-friendly player summary stored in `player:registry`.
//
// This is intentionally a tiny derived index, not a replacement for save:*.
// The full save remains authoritative; this row exists so public leaderboards
// and roster/admin summaries do not need to deserialize every save blob just to
// sort on a handful of display-safe counters.

import { safeName } from '../_utils.js';
import { earnedStatPoints } from '../_xp-engine.js';

export const REGISTRY_KEY = 'player:registry';
// v2: the `xp` slot changed MEANING with the XP removal — it now carries the
// earned stat-point ledger (docs/leveling-without-xp-map.md), which tops out at
// ~29,880, while v1 rows hold cumulative character XP that ran into the
// millions. Bumping the version marks every v1 row stale
// (needsPublicPlayerIndexBackfill) so dormant accounts get rebuilt from their
// save instead of sitting permanently at the top of the "Total Stat Points
// Earned" board on a dead number.
export const PUBLIC_INDEX_VERSION = 2;

export type PublicPlayerIndexEntry = {
    _publicIndexVersion: number;
    name: string;
    level: number;
    village: string;
    specialty: string;
    clan: string;
    lastSeen: number;
    rankedRating: number;
    rankedWins: number;
    rankedLosses: number;
    petRankedRating: number;
    petRankedWins: number;
    petRankedLosses: number;
    totalPvpKills: number;
    xp: number;
    totalPetWins: number;
    totalEndlessTowerWins: number;
    totalVillageRaids: number;
    professionXp: number;
    battleTowerBestFloor: number;
    battleTowerRating: number;
};

export type PublicLeaderboardBoardId =
    | 'online'
    | 'ranked'
    | 'petRanked'
    | 'level'
    | 'xp'
    | 'kills'
    | 'pets'
    | 'endless'
    | 'villageWars'
    | 'professions'
    | 'battleTower'
    | 'clans';

export type PublicLeaderboardRow = {
    rank: number;
    name: string;
    value: number;
    label: string;
    level?: number;
    village?: string;
    specialty?: string;
    clan?: string;
    online?: boolean;
    lastSeenAt?: number;
    members?: number;
    onlineMembers?: number;
};

export type PublicLeaderboardBoard = {
    id: PublicLeaderboardBoardId;
    label: string;
    valueLabel: string;
    suffix: string;
    rows: PublicLeaderboardRow[];
};

export type PublicPlayerIndexHealth = {
    version: number;
    generatedAt: number;
    totalRegistryEntries: number;
    publicRegistryEntries: number;
    validEntries: number;
    malformedEntries: number;
    staleEntries: number;
    oldVersionEntries: number;
    missingFieldEntries: number;
    nonPublicEntries: number;
    adminEntries: number;
    clanEntries: number;
    emptyNameEntries: number;
    oldestLastSeen: number;
    newestLastSeen: number;
    scannedSaves: boolean;
    saveKeyCount?: number;
    missingRegistryCount?: number;
    orphanRegistryCount?: number;
    missingRegistryKeys: string[];
    orphanRegistryKeys: string[];
    sampleMalformed: string[];
    sampleStale: string[];
    sampleNonPublic: string[];
    sampleMissingFields: Array<{ key: string; fields: string[] }>;
};

const PUBLIC_LEADERBOARD_META: Record<PublicLeaderboardBoardId, Omit<PublicLeaderboardBoard, 'rows'>> = {
    online: { id: 'online', label: 'Online Now', valueLabel: 'Presence', suffix: '' },
    ranked: { id: 'ranked', label: 'Ranked Battle Rating', valueLabel: 'Elo', suffix: ' Elo' },
    petRanked: { id: 'petRanked', label: 'Pet Arena Rating', valueLabel: 'Pet Elo', suffix: ' Elo' },
    level: { id: 'level', label: 'Highest Level', valueLabel: 'Level', suffix: '' },
    // Board id stays 'xp' (client tab ids/deep links), but the metric is now the
    // earned stat-point ledger — character XP is retired (leveling-without-xp map).
    xp: { id: 'xp', label: 'Total Stat Points Earned', valueLabel: 'Points', suffix: ' pts' },
    kills: { id: 'kills', label: 'Total PvP Kills', valueLabel: 'Kills', suffix: ' kills' },
    pets: { id: 'pets', label: 'Pet Coliseum Wins', valueLabel: 'Wins', suffix: ' wins' },
    endless: { id: 'endless', label: 'Endless Tower Wins', valueLabel: 'Wins', suffix: ' wins' },
    villageWars: { id: 'villageWars', label: 'Village War Raids', valueLabel: 'Raids', suffix: ' raids' },
    professions: { id: 'professions', label: 'Profession XP', valueLabel: 'XP', suffix: ' XP' },
    battleTower: { id: 'battleTower', label: 'Battle Tower Floor', valueLabel: 'Floor', suffix: ' floor' },
    clans: { id: 'clans', label: 'Clan Power', valueLabel: 'Power', suffix: ' pts' },
};

type NumberField = {
    key: keyof Pick<
        PublicPlayerIndexEntry,
        | 'level'
        | 'rankedRating'
        | 'rankedWins'
        | 'rankedLosses'
        | 'petRankedRating'
        | 'petRankedWins'
        | 'petRankedLosses'
        | 'totalPvpKills'
        | 'xp'
        | 'totalPetWins'
        | 'totalEndlessTowerWins'
        | 'totalVillageRaids'
        | 'professionXp'
        | 'battleTowerBestFloor'
        | 'battleTowerRating'
    >;
    fallback: number;
};

const NUMBER_FIELDS: readonly NumberField[] = [
    { key: 'level', fallback: 1 },
    { key: 'rankedRating', fallback: 1000 },
    { key: 'rankedWins', fallback: 0 },
    { key: 'rankedLosses', fallback: 0 },
    { key: 'petRankedRating', fallback: 1000 },
    { key: 'petRankedWins', fallback: 0 },
    { key: 'petRankedLosses', fallback: 0 },
    { key: 'totalPvpKills', fallback: 0 },
    { key: 'xp', fallback: 0 },
    { key: 'totalPetWins', fallback: 0 },
    { key: 'totalEndlessTowerWins', fallback: 0 },
    { key: 'totalVillageRaids', fallback: 0 },
    { key: 'professionXp', fallback: 0 },
    { key: 'battleTowerBestFloor', fallback: 0 },
    { key: 'battleTowerRating', fallback: 0 },
];

const STRING_FIELDS = ['name', 'village', 'specialty', 'clan'] as const;
const MAX_PUBLIC_NUMBER = 9_000_000_000_000;
const NON_PUBLIC_PLAYER_KEYS = new Set(['admin', 'admin1', 'admin2', 'system', 'server']);

function publicString(value: unknown, fallback = ''): string {
    return (typeof value === 'string' ? value : fallback).slice(0, 80);
}

function publicNumber(value: unknown, fallback: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(MAX_PUBLIC_NUMBER, Math.floor(n)));
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function publicIndexKey(name: string): string {
    return safeName(name);
}

export function isPublicPlayerIndexKey(name: string): boolean {
    const key = publicIndexKey(name);
    if (!key) return false;
    if (NON_PUBLIC_PLAYER_KEYS.has(key)) return false;
    if (key.startsWith('admin-') || key.startsWith('admin_')) return false;
    if (key.startsWith('clan-')) return false;
    return true;
}

export function buildPublicPlayerIndexEntry(
    character: unknown,
    fallbackName: string,
    now: number = Date.now(),
    lastSeen: number = now,
): PublicPlayerIndexEntry {
    const char = asRecord(character);
    const displayName = publicString(char.name, fallbackName) || publicString(fallbackName);
    return {
        _publicIndexVersion: PUBLIC_INDEX_VERSION,
        name: displayName,
        level: publicNumber(char.level, 1),
        village: publicString(char.village),
        specialty: publicString(char.specialty),
        clan: publicString(char.clan),
        lastSeen: publicNumber(lastSeen, now),
        rankedRating: publicNumber(char.rankedRating, 1000),
        rankedWins: publicNumber(char.rankedWins, 0),
        rankedLosses: publicNumber(char.rankedLosses, 0),
        petRankedRating: publicNumber(char.petRankedRating, 1000),
        petRankedWins: publicNumber(char.petRankedWins, 0),
        petRankedLosses: publicNumber(char.petRankedLosses, 0),
        totalPvpKills: publicNumber(char.totalPvpKills, 0),
        // Earned stat points (allocated + pool) when built from a full character;
        // falls back to the stored entry value when re-parsing an index row
        // (rows carry no stats object). Field name stays `xp` to avoid an index
        // schema/backfill churn — semantics changed with the XP removal.
        xp: char.stats && typeof char.stats === 'object'
            ? publicNumber(earnedStatPoints(char), 0)
            : publicNumber(char.xp, 0),
        totalPetWins: publicNumber(char.totalPetWins, 0),
        totalEndlessTowerWins: publicNumber(char.totalEndlessTowerWins, 0),
        totalVillageRaids: publicNumber(char.totalVillageRaids, 0),
        professionXp: publicNumber(char.professionXp, 0),
        battleTowerBestFloor: publicNumber(char.battleTowerBestFloor, 0),
        battleTowerRating: publicNumber(char.battleTowerRating, 0),
    };
}

export function parsePublicPlayerIndexEntry(raw: unknown, fallbackName: string): PublicPlayerIndexEntry | null {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value) as unknown;
        } catch {
            return null;
        }
    }
    const rec = asRecord(value);
    const lastSeen = publicNumber(rec.lastSeen, 0);
    return buildPublicPlayerIndexEntry(rec, fallbackName, Date.now(), lastSeen);
}

export function needsPublicPlayerIndexBackfill(raw: unknown): boolean {
    const rec = asRecord(typeof raw === 'string' ? tryParse(raw) : raw);
    if (rec._publicIndexVersion !== PUBLIC_INDEX_VERSION) return true;
    return NUMBER_FIELDS.some(({ key }) => !(key in rec)) || STRING_FIELDS.some((key) => !(key in rec));
}

export function publicPlayerIndexChanged(existingCharacter: Record<string, unknown> | null, next: PublicPlayerIndexEntry): boolean {
    const existing = existingCharacter ?? {};
    for (const key of STRING_FIELDS) {
        if (publicString(existing[key]) !== next[key]) return true;
    }
    for (const { key, fallback } of NUMBER_FIELDS) {
        if (publicNumber(existing[key], fallback) !== next[key]) return true;
    }
    return false;
}

export function buildPublicLeaderboards(
    entries: Iterable<PublicPlayerIndexEntry>,
    onlineNames: Iterable<string> = [],
    limit = 25,
): PublicLeaderboardBoard[] {
    const rowLimit = Math.max(1, Math.min(Math.floor(limit) || 25, 100));
    const onlineKeys = new Set([...onlineNames].map(publicIndexKey).filter(Boolean));
    const publicEntries = [...entries].filter((entry) => isPublicPlayerIndexKey(entry.name));
    const online = (entry: PublicPlayerIndexEntry) => onlineKeys.has(publicIndexKey(entry.name));

    return [
        buildPlayerLeaderboard('online', publicEntries, (entry) => entry.lastSeen, rowLimit, {
            includeZero: true,
            filter: online,
            label: () => 'Online',
        }),
        buildPlayerLeaderboard('ranked', publicEntries, (entry) => entry.rankedRating, rowLimit, { includeZero: true }),
        buildPlayerLeaderboard('petRanked', publicEntries, (entry) => entry.petRankedRating, rowLimit, { includeZero: true }),
        buildPlayerLeaderboard('level', publicEntries, (entry) => entry.level, rowLimit, { includeZero: true, label: (value) => `Level ${value.toLocaleString()}` }),
        buildPlayerLeaderboard('kills', publicEntries, (entry) => entry.totalPvpKills, rowLimit),
        buildPlayerLeaderboard('xp', publicEntries, (entry) => entry.xp, rowLimit),
        buildPlayerLeaderboard('clans', publicEntries, () => 0, rowLimit, {
            customRows: () => buildClanRows(publicEntries, online, rowLimit),
        }),
        buildPlayerLeaderboard('pets', publicEntries, (entry) => entry.totalPetWins, rowLimit),
        buildPlayerLeaderboard('endless', publicEntries, (entry) => entry.totalEndlessTowerWins, rowLimit),
        buildPlayerLeaderboard('villageWars', publicEntries, (entry) => entry.totalVillageRaids, rowLimit),
        buildPlayerLeaderboard('professions', publicEntries, (entry) => entry.professionXp, rowLimit),
        buildPlayerLeaderboard('battleTower', publicEntries, (entry) => entry.battleTowerBestFloor, rowLimit, {
            label: (value) => `Floor ${value.toLocaleString()}`,
        }),
    ];
}

type LeaderboardOptions = {
    includeZero?: boolean;
    filter?: (entry: PublicPlayerIndexEntry) => boolean;
    label?: (value: number, entry: PublicPlayerIndexEntry) => string;
    customRows?: () => PublicLeaderboardRow[];
};

function buildPlayerLeaderboard(
    id: PublicLeaderboardBoardId,
    entries: PublicPlayerIndexEntry[],
    valueOf: (entry: PublicPlayerIndexEntry) => number,
    limit: number,
    options: LeaderboardOptions = {},
): PublicLeaderboardBoard {
    const meta = PUBLIC_LEADERBOARD_META[id];
    if (options.customRows) return { ...meta, rows: options.customRows() };

    const rows = entries
        .filter((entry) => !options.filter || options.filter(entry))
        .map((entry) => ({ entry, value: valueOf(entry) }))
        .filter(({ value }) => options.includeZero || value > 0)
        .sort((a, b) => (
            b.value - a.value
            || b.entry.level - a.entry.level
            || b.entry.lastSeen - a.entry.lastSeen
            || a.entry.name.localeCompare(b.entry.name)
        ))
        .slice(0, limit)
        .map(({ entry, value }, index) => ({
            rank: index + 1,
            name: entry.name,
            value,
            label: options.label ? options.label(value, entry) : formatLeaderboardValue(value, meta.suffix),
            level: entry.level,
            village: entry.village,
            specialty: entry.specialty,
            clan: entry.clan,
            lastSeenAt: entry.lastSeen,
        }));

    return { ...meta, rows };
}

function buildClanRows(
    entries: PublicPlayerIndexEntry[],
    online: (entry: PublicPlayerIndexEntry) => boolean,
    limit: number,
): PublicLeaderboardRow[] {
    const clans = new Map<string, { score: number; members: number; onlineMembers: number; village: string }>();
    for (const entry of entries) {
        const clan = entry.clan.trim().slice(0, 80);
        if (!clan) continue;
        const current = clans.get(clan) ?? { score: 0, members: 0, onlineMembers: 0, village: entry.village };
        current.score += entry.rankedWins + entry.totalPvpKills;
        current.members += 1;
        if (online(entry)) current.onlineMembers += 1;
        if (!current.village && entry.village) current.village = entry.village;
        clans.set(clan, current);
    }

    return [...clans.entries()]
        .sort((a, b) => (
            b[1].score - a[1].score
            || b[1].members - a[1].members
            || a[0].localeCompare(b[0])
        ))
        .slice(0, limit)
        .map(([name, data], index) => ({
            rank: index + 1,
            name,
            value: data.score,
            label: formatLeaderboardValue(data.score, PUBLIC_LEADERBOARD_META.clans.suffix),
            village: data.village,
            members: data.members,
            onlineMembers: data.onlineMembers,
        }));
}

function formatLeaderboardValue(value: number, suffix: string): string {
    return `${value.toLocaleString()}${suffix}`;
}

export function summarizePublicIndexHealth(
    rawRegistry: Record<string, unknown>,
    saveKeys?: string[],
    now = Date.now(),
): PublicPlayerIndexHealth {
    const health: PublicPlayerIndexHealth = {
        version: PUBLIC_INDEX_VERSION,
        generatedAt: now,
        totalRegistryEntries: Object.keys(rawRegistry).length,
        publicRegistryEntries: 0,
        validEntries: 0,
        malformedEntries: 0,
        staleEntries: 0,
        oldVersionEntries: 0,
        missingFieldEntries: 0,
        nonPublicEntries: 0,
        adminEntries: 0,
        clanEntries: 0,
        emptyNameEntries: 0,
        oldestLastSeen: 0,
        newestLastSeen: 0,
        scannedSaves: Array.isArray(saveKeys),
        missingRegistryKeys: [],
        orphanRegistryKeys: [],
        sampleMalformed: [],
        sampleStale: [],
        sampleNonPublic: [],
        sampleMissingFields: [],
    };

    const publicRegistryKeys = new Set<string>();
    for (const [key, raw] of Object.entries(rawRegistry)) {
        const normalizedKey = publicIndexKey(key);
        if (!normalizedKey) health.emptyNameEntries += 1;
        if (normalizedKey === 'admin' || normalizedKey === 'admin1' || normalizedKey === 'admin2' || normalizedKey.startsWith('admin-') || normalizedKey.startsWith('admin_')) {
            health.adminEntries += 1;
        }
        if (normalizedKey.startsWith('clan-')) health.clanEntries += 1;

        if (!isPublicPlayerIndexKey(key)) {
            health.nonPublicEntries += 1;
            pushSample(health.sampleNonPublic, key);
            continue;
        }

        health.publicRegistryEntries += 1;
        publicRegistryKeys.add(normalizedKey);
        const parsed = parsePublicPlayerIndexEntry(raw, key);
        if (!parsed) {
            health.malformedEntries += 1;
            pushSample(health.sampleMalformed, key);
            continue;
        }

        health.validEntries += 1;
        if (parsed.lastSeen > 0) {
            health.oldestLastSeen = health.oldestLastSeen === 0 ? parsed.lastSeen : Math.min(health.oldestLastSeen, parsed.lastSeen);
            health.newestLastSeen = Math.max(health.newestLastSeen, parsed.lastSeen);
        }

        const rawRec = asRecord(typeof raw === 'string' ? tryParse(raw) : raw);
        if (rawRec._publicIndexVersion !== PUBLIC_INDEX_VERSION) health.oldVersionEntries += 1;
        const missing = missingPublicIndexFields(raw);
        if (missing.length > 0) {
            health.missingFieldEntries += 1;
            if (health.sampleMissingFields.length < 10) health.sampleMissingFields.push({ key, fields: missing.slice(0, 8) });
        }
        if (needsPublicPlayerIndexBackfill(raw)) {
            health.staleEntries += 1;
            pushSample(health.sampleStale, key);
        }
    }

    if (Array.isArray(saveKeys)) {
        const publicSaveKeys = new Set(
            saveKeys
                .map((key) => publicIndexKey(key.startsWith('save:') ? key.slice(5) : key))
                .filter((key) => key && isPublicPlayerIndexKey(key)),
        );
        health.saveKeyCount = publicSaveKeys.size;
        health.missingRegistryKeys = [...publicSaveKeys].filter((key) => !publicRegistryKeys.has(key)).slice(0, 50);
        health.orphanRegistryKeys = [...publicRegistryKeys].filter((key) => !publicSaveKeys.has(key)).slice(0, 50);
        health.missingRegistryCount = [...publicSaveKeys].filter((key) => !publicRegistryKeys.has(key)).length;
        health.orphanRegistryCount = [...publicRegistryKeys].filter((key) => !publicSaveKeys.has(key)).length;
    }

    return health;
}

function missingPublicIndexFields(raw: unknown): string[] {
    const rec = asRecord(typeof raw === 'string' ? tryParse(raw) : raw);
    const missing: string[] = [];
    if (rec._publicIndexVersion !== PUBLIC_INDEX_VERSION) missing.push('_publicIndexVersion');
    for (const { key } of NUMBER_FIELDS) if (!(key in rec)) missing.push(key);
    for (const key of STRING_FIELDS) if (!(key in rec)) missing.push(key);
    return missing;
}

function pushSample(samples: string[], key: string): void {
    if (samples.length < 10) samples.push(key);
}

export function publicIndexToLeaderboardRosterEntry(entry: PublicPlayerIndexEntry, online = false) {
    const character = {
        rankedRating: entry.rankedRating,
        rankedWins: entry.rankedWins,
        rankedLosses: entry.rankedLosses,
        petRankedRating: entry.petRankedRating,
        petRankedWins: entry.petRankedWins,
        petRankedLosses: entry.petRankedLosses,
        totalPvpKills: entry.totalPvpKills,
        xp: entry.xp,
        totalPetWins: entry.totalPetWins,
        totalEndlessTowerWins: entry.totalEndlessTowerWins,
        totalVillageRaids: entry.totalVillageRaids,
        professionXp: entry.professionXp,
        battleTowerBestFloor: entry.battleTowerBestFloor,
        battleTowerRating: entry.battleTowerRating,
        clan: entry.clan,
    };
    return {
        name: entry.name,
        level: entry.level,
        village: entry.village,
        specialty: entry.specialty,
        online,
        character,
        lastSeenAt: entry.lastSeen,
    };
}

function tryParse(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return null;
    }
}
