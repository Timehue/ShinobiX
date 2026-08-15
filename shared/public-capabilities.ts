export const PUBLIC_CAPABILITY_IDS = Object.freeze([
    'gameplay',
    /** Admission of new unsafe-method player HTTP action requests. This is not
     * a process/storage quiescence fence for GET settlement, cron, or realtime. */
    'gameplayMutations',
    'registrations',
    'villageWar',
    'anbuInfiltration',
    'clanBoss',
    'clanBossParties',
    'legacy',
    'petBreedingStarts',
    'weeklyBossGuardCycle',
] as const);

export type PublicCapabilityId = typeof PUBLIC_CAPABILITY_IDS[number];

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
