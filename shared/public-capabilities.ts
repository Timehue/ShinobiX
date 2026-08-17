// Kept as a frozen ARRAY with the id type derived from it, rather than a bare
// union: the list is enumerated at runtime (the capability producer builds its
// response from it, and the e2e fixtures grant "every public capability" by
// mapping over it). A union alone cannot be iterated, so the consumers would
// each need their own hand-maintained copy of the list to drift out of.
export const PUBLIC_CAPABILITY_IDS = Object.freeze([
    'gameplay',
    /** Admission of new unsafe-method player HTTP action requests. This is not
     * a process/storage quiescence fence for GET settlement, cron, or realtime. */
    'gameplayMutations',
    'registrations',
    // Which doors into the game are actually open. The login screen reads these
    // rather than rendering a button that can only answer with a 503.
    'googleSignIn',
    'guestPlay',
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
