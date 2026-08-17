export type PublicCapabilityId =
    | 'gameplay'
    | 'gameplayMutations'
    | 'registrations'
    // Which doors into the game are actually open. The login screen reads these
    // rather than rendering a button that can only answer with a 503.
    | 'googleSignIn'
    | 'guestPlay'
    | 'villageWar'
    | 'clanBoss'
    | 'clanBossParties'
    | 'legacy'
    | 'petBreedingStarts'
    | 'weeklyBossGuardCycle';

export type PublicCapabilityState = 'available' | 'temporarily-unavailable' | 'actions-paused';
export type PublicCapabilityReason =
    | 'available'
    | 'maintenance'
    | 'operations-paused'
    | 'temporarily-disabled'
    | 'configuration-unavailable';

export type PublicCapability = {
    state: PublicCapabilityState;
    reason: PublicCapabilityReason;
};

export type PublicCapabilities = Record<PublicCapabilityId, PublicCapability>;

export type PublicCapabilitiesResponse = {
    ok: true;
    capabilities: PublicCapabilities;
};
