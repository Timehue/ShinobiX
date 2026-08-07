export type PublicCapabilityId =
    | 'gameplay'
    | 'gameplayMutations'
    | 'registrations'
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
