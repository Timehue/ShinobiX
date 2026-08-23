/**
 * Stable wire contract for Battle Towers public team PvP.
 *
 * The combat payload is generic so the server can use its authoritative
 * TowerSession type while the browser supplies its local mirror without making
 * shared code depend on either runtime.
 */

export const TOWER_PVP_TEAM_SIZE = 2 as const;
export const TOWER_PVP_MATCH_SIZE = 4 as const;
export const TOWER_PVP_TURN_MS = 75_000 as const;
export const TOWER_PVP_REQUEST_ID = /^[A-Za-z0-9_-]{16,80}$/;

/**
 * Level at which Battle Towers unlocks as a whole — Story floors, the Endless
 * Spire, and the public Team Arena queue alike. It lives in shared/ because it
 * is enforced on BOTH sides: the lobby hides locked surfaces with it and the
 * server re-checks it from the authoritative save. Previously the browser held
 * its own literal, so the gate could drift out of agreement with the server.
 */
export const BATTLE_TOWERS_MIN_LEVEL = 30 as const;

export type TowerPvpTeamId = 'amber' | 'violet';
export type TowerPvpMatchStatus = 'ready' | 'active' | 'done' | 'cancelled';

export type TowerPvpRosterMember = {
    slug: string;
    displayName: string;
    teamId: TowerPvpTeamId;
    actorId: string;
    controllerId: string;
    ready: boolean;
};

/**
 * Who owns this match's outcome.
 *
 * `public-queue` is the open Team Arena ladder-less queue: server-balanced
 * teams, zero progression, settlement is a bare acknowledgement.
 *
 * `clan-war` is a specific accepted 2v2 challenge. Teams are FIXED by clan
 * rather than skill-balanced, and the terminal winner is consumed by the
 * clan-war settlement adapter. The match modules themselves still write no
 * rewards — the adapter on the clan-war side does, exactly like the existing
 * 1v1 continuation in api/clan/war/_pvp-settlement.ts.
 */
export type TowerPvpBinding =
    | { kind: 'public-queue' }
    | { kind: 'clan-war'; warId: string; challengeId: string; fromClan: string; toClan: string }
    /**
     * Ranked 2v2. Teams are the two QUEUED DUOS, so the split is a fact of who
     * paired up, not a fairness shuffle. `amberDuoId`/`violetDuoId` are carried so
     * settlement can credit the right pair without re-deriving it from the roster.
     */
    | { kind: 'ranked-2v2'; amberDuoId: string; violetDuoId: string; amberRating: number; violetRating: number };

/** True for any binding whose outcome moves a persistent ladder or war score. */
export function isRatedTowerPvpMatch(match: { binding?: TowerPvpBinding }): boolean {
    const kind = towerPvpBindingOf(match).kind;
    return kind === 'clan-war' || kind === 'ranked-2v2';
}

/** Public matchmaking is the default so existing stored matches stay valid. */
export function towerPvpBindingOf(match: { binding?: TowerPvpBinding }): TowerPvpBinding {
    return match.binding ?? { kind: 'public-queue' };
}

export function isPublicQueueTowerPvpMatch(match: { binding?: TowerPvpBinding }): boolean {
    return towerPvpBindingOf(match).kind === 'public-queue';
}

export type TowerPvpSettlement = {
    policy: 'no-progression-v1';
    acknowledgements: string[];
};

export type TowerPvpMatch<TCombat = unknown> = {
    contractVersion: 1;
    matchId: string;
    status: TowerPvpMatchStatus;
    version: number;
    createdAt: number;
    updatedAt: number;
    readyDeadlineAt: number;
    roster: TowerPvpRosterMember[];
    /** Absent on matches published before clan-war 2v2; read via towerPvpBindingOf. */
    binding?: TowerPvpBinding;
    /**
     * Per-fighter STARTING consumable budget, slug -> itemId -> count.
     * Settlement subtracts what each actor has left to learn what was spent, so
     * a consumable costs the same here as in 1v1 PvP. Absent on consumable-free
     * matches (the open Team Arena), where nothing is spent and nothing is owed.
     */
    sealedItemCharges?: Record<string, Record<string, number>>;
    combat: TCombat;
    winner: TowerPvpTeamId | 'draw' | null;
    cancellationReason?: 'ready-timeout' | 'player-left' | 'publication-failed';
    afkStrikes: Record<string, number>;
    recentCommands: Array<{
        requestId: string;
        playerSlug: string;
        fingerprint: string;
    }>;
    settlement: TowerPvpSettlement;
    rules: {
        teamSize: typeof TOWER_PVP_TEAM_SIZE;
        /** 'disabled' in the open queue, which settles no economy; a reward-bearing
         *  bound match seals real charges like every other rated fight. */
        consumables: 'disabled' | 'enabled';
        rewards: 'none';
        afkStrikesToForfeit: 2;
    };
};

/** Member-specific wire projection. Absolute team IDs remain in the roster. */
export type TowerPvpMatchView<TCombat = unknown> = TowerPvpMatch<TCombat> & {
    viewer: { teamId: TowerPvpTeamId; actorId: string };
    turnDeadlineAt: number | null;
};

export type TowerPvpPresence<TCombat = unknown> =
    | { state: 'idle'; match: null; queuePosition: null }
    | { state: 'queued'; match: null; queuePosition: number; queuedAt: number }
    | { state: 'matched'; match: TowerPvpMatch<TCombat>; queuePosition: null };

export type TowerPvpQueueCommand =
    | { action: 'join'; playerName: string; requestId: string }
    | {
        action: 'ready';
        playerName: string;
        matchId: string;
        ready: boolean;
        requestId: string;
        expectedVersion: number;
    }
    | {
        action: 'leave';
        playerName: string;
        matchId?: string;
        requestId: string;
        expectedVersion?: number;
    };

export type TowerPvpActionType =
    | 'move' | 'dash' | 'attack' | 'jutsu' | 'weapon'
    | 'heal' | 'cleanse' | 'clear' | 'wait' | 'forfeit';

export type TowerPvpActionCommand = {
    playerName: string;
    matchId: string;
    type: TowerPvpActionType;
    targetId?: string;
    tile?: number;
    jutsuId?: string;
    itemId?: string;
    moveToken: string;
    expectedVersion: number;
};

export type TowerPvpActionResponse<TCombat = unknown> = {
    applied: boolean;
    replayed: boolean;
    reason?: string;
    currentVersion: number;
    match: TowerPvpMatch<TCombat>;
};

export type TowerPvpSettleResponse<TCombat = unknown> = {
    settled: true;
    replayed: boolean;
    progressionApplied: false;
    rewards: { ryo: 0; xp: 0; fateShards: 0; rating: 0 };
    match: TowerPvpMatch<TCombat>;
};
