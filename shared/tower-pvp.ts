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
        consumables: 'disabled';
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
