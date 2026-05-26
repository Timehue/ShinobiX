// Clan war storage layer. KV-backed, one record per pair of warring
// clans keyed by sorted-pair ID so the same two clans always resolve
// to the same key regardless of who attacked first. Mirrors the
// village-war pattern in api/world-state.ts but scoped to clans.
//
// The challenge queue lives inside the war record. Capped at a few
// dozen pending + a couple hundred history entries so the blob
// stays well under KV size limits. Each challenge is one of five
// modes (1v1 PvP, 2v2 PvP, pet 1v1, pet 2v2, tile cards) and pays
// HP damage on completion based on the tier.

import { kv } from '../../_storage.js';

export type ChallengeMode = 'pvp1v1' | 'pvp2v2' | 'pet1v1' | 'pet2v2' | 'tilecards';

export type ChallengeStatus = 'pending' | 'accepted' | 'completed' | 'expired' | 'cancelled';

export type ChallengeResult = 'from-wins' | 'to-wins' | 'draw';

export type ClanChallenge = {
    id: string;
    mode: ChallengeMode;
    fromClan: string;
    // Challenger player name(s). Hidden from the defender's queue UI
    // until they accept — the defender sees only the clan + mode.
    fromPlayer: string;
    fromPlayer2?: string;       // populated for pvp2v2 / pet2v2
    createdAt: number;
    status: ChallengeStatus;
    expiresAt: number;
    acceptedAt?: number;
    acceptedPlayer?: string;
    acceptedPlayer2?: string;
    completedAt?: number;
    result?: ChallengeResult;
    battleId?: string;          // PvP modes get a pvp:<id> session
    petBattleSeed?: number;     // pet modes use a deterministic seed
};

export type ClanWar = {
    id: string;                 // sorted-pair slug
    clans: [string, string];    // canonical sorted alphabetically
    villages: Record<string, string>; // clan → village at war-declare time
    hp: Record<string, number>; // clan → current HP
    startedAt: number;
    updatedAt: number;
    endedAt?: number;
    winnerClan?: string;
    declaredBy: string;         // player name who declared
    pendingChallenges: ClanChallenge[];
    completedChallenges: ClanChallenge[];
    // Server-stamped at war-create so every grant path uses the same
    // canonical ID (mirrors village-war pattern).
    warCrateId?: string;
    mvpByClan?: Record<string, string>;
};

// ── Constants ───────────────────────────────────────────────────────
export const CLAN_WAR_HP_MAX = 1000;
// Damage per challenge type on win. Tier: combat > pet battle > cards.
// 2v2 modes pay double the 1v1 of the same tier — the wins represent
// two real fights happening sequentially under the hood.
export const CHALLENGE_DAMAGE: Record<ChallengeMode, number> = {
    pvp1v1: 30,
    pvp2v2: 60,
    pet1v1: 20,
    pet2v2: 40,
    tilecards: 10,
};
export const CHALLENGE_EXPIRY_MS = 2 * 60 * 60 * 1000;     // 2h to accept
export const CLAN_WAR_MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
export const CLAN_WAR_REMATCH_COOLDOWN_SEC = 7 * 24 * 60 * 60;
export const MAX_PENDING_CHALLENGES = 30;
export const MAX_COMPLETED_HISTORY = 200;

export const CLAN_WAR_KEY_PREFIX = 'clan-war:';

function normalizeClanKey(clan: string): string {
    return clan.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function clanWarPairId(clanA: string, clanB: string): string {
    return [clanA, clanB]
        .sort((a, b) => a.localeCompare(b))
        .map(normalizeClanKey)
        .join('-vs-');
}

export function clanWarKey(clanA: string, clanB: string): string {
    return `${CLAN_WAR_KEY_PREFIX}${clanWarPairId(clanA, clanB)}`;
}

export function clanWarCooldownKey(clanA: string, clanB: string): string {
    return `clan-war:cooldown:${clanWarPairId(clanA, clanB)}`;
}

export async function loadAllClanWars(): Promise<ClanWar[]> {
    try {
        const keys = await kv.keys(`${CLAN_WAR_KEY_PREFIX}*`);
        // Strip cooldown keys — those live under `clan-war:cooldown:` and
        // would otherwise show up in this scan.
        const warKeys = keys.filter(k => !k.startsWith('clan-war:cooldown:'));
        if (warKeys.length === 0) return [];
        const values = await kv.mget<ClanWar[]>(...warKeys);
        return values.filter(Boolean) as ClanWar[];
    } catch {
        return [];
    }
}

export async function clanInActiveWar(clanName: string): Promise<boolean> {
    const all = await loadAllClanWars();
    return all.some(w => !w.endedAt && w.clans.includes(clanName));
}

// Pull the actor's clan and role from their save. Used to validate
// that only clan founder / leader / officer can declare or accept;
// any member can send challenges and report results.
export async function loadClanContext(playerName: string): Promise<{
    clan: string;
    role: 'founder' | 'leader' | 'officer' | 'member' | '';
    village: string;
    name: string;
}> {
    try {
        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = (save?.character ?? null) as Record<string, unknown> | null;
        if (!char) return { clan: '', role: '', village: '', name: playerName };
        const clan = String(char.clan ?? '');
        const village = String(char.village ?? '');
        const isFounder = char.clanFounder === true;
        if (!clan) return { clan: '', role: '', village, name: String(char.name ?? playerName) };
        // Pull the clan record to inspect roleOverrides for this player.
        const clanSlug = `clan-${clan.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const clanData = await kv.get<{ founderName?: string; roleOverrides?: Record<string, string> }>(`save:${clanSlug}`);
        const founderName = String(clanData?.founderName ?? '').toLowerCase();
        const overrides = (clanData?.roleOverrides ?? {}) as Record<string, string>;
        const ovEntry = Object.entries(overrides).find(([k]) => k.toLowerCase() === playerName.toLowerCase());
        const overrideRole = ovEntry?.[1] ?? '';
        let role: 'founder' | 'leader' | 'officer' | 'member' = 'member';
        if (isFounder || founderName === playerName.toLowerCase()) role = 'founder';
        else if (overrideRole === 'Leader') role = 'leader';
        else if (overrideRole === 'Officer') role = 'officer';
        return { clan, role, village, name: String(char.name ?? playerName) };
    } catch {
        return { clan: '', role: '', village: '', name: playerName };
    }
}

export function canActAsClanLeadership(role: string): boolean {
    return role === 'founder' || role === 'leader' || role === 'officer';
}

// Lazy-expire stale wars + stale challenges on any read or write.
// Idempotent: an already-expired record passes through unchanged.
export function applyLazyClanWarExpiry(war: ClanWar, now: number = Date.now()): { war: ClanWar; changed: boolean } {
    let changed = false;
    let next = war;

    // Stale-war auto-finalize (14d max).
    if (!next.endedAt && (now - next.startedAt) > CLAN_WAR_MAX_DURATION_MS) {
        next = {
            ...next,
            endedAt: next.startedAt + CLAN_WAR_MAX_DURATION_MS,
            updatedAt: now,
        };
        changed = true;
    }

    // Stale-challenge expiry: pending challenges past their TTL flip
    // to 'expired' and move into completedChallenges. No damage.
    if (next.pendingChallenges.length > 0) {
        const stillPending: ClanChallenge[] = [];
        const newlyExpired: ClanChallenge[] = [];
        for (const ch of next.pendingChallenges) {
            if (ch.status === 'pending' && ch.expiresAt < now) {
                newlyExpired.push({ ...ch, status: 'expired' as const, completedAt: now });
            } else {
                stillPending.push(ch);
            }
        }
        if (newlyExpired.length > 0) {
            const history = [...newlyExpired, ...next.completedChallenges].slice(0, MAX_COMPLETED_HISTORY);
            next = { ...next, pendingChallenges: stillPending, completedChallenges: history, updatedAt: now };
            changed = true;
        }
    }

    return { war: next, changed };
}
