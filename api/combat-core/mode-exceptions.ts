/**
 * Explicit, reviewable deviations from the shared PvP/Solo-PvE cast contract.
 * None of these entries may change ordinary jutsu AP, resources, targeting,
 * cooldowns, tags, status timing, or VFX semantics.
 */
export const COMBAT_MODE_EXCEPTIONS = {
    'solo-difficulty-guard': {
        scope: 'incoming-damage-cap',
        runtimeGate: 'SoloPveSession.difficultyGuard',
        reason: 'Keeps generated mission opponents inside the selected difficulty budget.',
        allowedEffects: ['cap enemy damage per hit and per turn'],
    },
    'weekly-boss-score-attack': {
        scope: 'damage-envelope-and-round-budget',
        runtimeGate: 'SoloPveSession.weeklyBossGuard',
        reason: 'Weekly bosses are survival score attacks with a sealed round budget.',
        allowedEffects: ['multiply player outgoing damage by round', 'cap boss damage', 'end at round budget'],
    },
    'hollow-gate-director': {
        scope: 'encounter-directive-and-hazard',
        runtimeGate: 'encounter.kind=hollow-gate',
        reason: 'Hollow Gate hounds have floor-sealed directives, hazards, and retreat rules.',
        allowedEffects: ['multiply outgoing damage', 'apply positional hazard damage', 'block retreat when sealed'],
    },
} as const;

export type CombatModeExceptionId = keyof typeof COMBAT_MODE_EXCEPTIONS;

export const SHARED_JUTSU_FIELDS_EXCLUDED_FROM_MODE_EXCEPTIONS = [
    'ap',
    'chakraCost',
    'staminaCost',
    'cooldown',
    'range',
    'target',
    'method',
    'tags',
    'statusDuration',
    'groundFootprint',
    'vfxSemantic',
] as const;
