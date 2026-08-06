export const CLAN_BOSS_PARTY_MAX = 4;
export const CLAN_BOSS_PARTY_STALE_MS = 45_000;
export const CLAN_BOSS_SOLO_FALLBACK_MS = 120_000;

export type ClanBossPartyStatus =
    | 'forming'
    | 'queued'
    | 'starting'
    | 'active'
    | 'completed'
    | 'disbanded'
    | 'expired';

export type ClanBossPartyVisibility = 'public' | 'private';
export type ClanBossPingKind = 'focus-boss' | 'clear-adds' | 'need-heal' | 'hold' | 'ready';

export type ClanBossLoadoutSnapshot = {
    saveVersion: number;
    level: number;
    profession: string | null;
    jutsuCount: number;
    combatItemCount: number;
    sealedAt: number;
};

export type ClanBossPartyMember = {
    slug: string;
    displayName: string;
    joinedAt: number;
    lastSeenAt: number;
    ready: boolean;
    snapshot?: ClanBossLoadoutSnapshot;
};

export type ClanBossPartyPing = {
    id: string;
    by: string;
    kind: ClanBossPingKind;
    at: number;
};

export type ClanBossParty = {
    id: string;
    clanName: string;
    weekId: string;
    bossId: string;
    sectorId: number;
    leaderSlug: string;
    visibility: ClanBossPartyVisibility;
    status: ClanBossPartyStatus;
    members: ClanBossPartyMember[];
    invitedSlugs: string[];
    version: number;
    createdAt: number;
    updatedAt: number;
    queuedAt?: number;
    fallbackAt?: number;
    soloFallbackAccepted?: boolean;
    startRequestId?: string;
    runId?: string;
    completedAt?: number;
    disbandReason?: string;
    pings: ClanBossPartyPing[];
};

export type ClanBossPartyMemberView = ClanBossPartyMember & {
    connection: 'online' | 'stale';
};

export type ClanBossPartyView = Omit<ClanBossParty, 'members'> & {
    members: ClanBossPartyMemberView[];
    allReady: boolean;
    canStart: boolean;
    fallbackAvailable: boolean;
};

export type ClanBossPartyEnvelope = {
    ok: boolean;
    serverNow: number;
    party: ClanBossPartyView | null;
    invitations: ClanBossPartyView[];
    publicParties: ClanBossPartyView[];
    population: {
        publicParties: number;
        openSeats: number;
    };
    error?: string;
    errorCode?: string;
};

export type ClanBossContribution = {
    actions: number;
    damage: number;
    healing: number;
    shielding: number;
    cleanses: number;
    objective: number;
};

export type ClanBossContributionResult = ClanBossContribution & {
    score: number;
    active: boolean;
    survived: boolean;
    threshold: 'none' | 'field' | 'veteran' | 'elite';
};
