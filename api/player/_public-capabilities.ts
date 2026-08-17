import type { PublicCapabilities, PublicCapabilityReason } from '../../shared/public-capabilities.js';
import {
    anbuInfiltrationEnabled,
    clanBossEnabled,
    clanBossPartiesEnabled,
    petBreedingStartsEnabled,
    villageWarMapEnabled,
    weeklyBossGuardEnabled,
} from '../_release-flags.js';
import { googleAuthEnabled } from '../_google-auth.js';
import { playerSessionsEnabled } from '../_auth.js';

const available = { state: 'available', reason: 'available' } as const;

function unavailable(reason: PublicCapabilityReason = 'temporarily-disabled') {
    return { state: 'temporarily-unavailable', reason } as const;
}

export function publicCapabilities(env: NodeJS.ProcessEnv = process.env): PublicCapabilities {
    const maintenance = env.MAINTENANCE_MODE === '1';
    // This public state mirrors the shared Express unsafe-method admission gate.
    // It deliberately does not claim that GET settlement, cron, realtime, or
    // storage writers are quiescent.
    const unsafeHttpActionsPaused = env.FREEZE_ECONOMY_REWARDS === '1';
    return {
        gameplay: maintenance ? unavailable('maintenance') : available,
        gameplayMutations: maintenance
            ? unavailable('maintenance')
            : unsafeHttpActionsPaused
                ? { state: 'actions-paused', reason: 'operations-paused' }
                : available,
        registrations: maintenance
            ? unavailable('maintenance')
            : env.DISABLE_NEW_REGISTRATIONS === '1'
                ? unavailable()
                : available,
        // Both passwordless doors need session tokens to exist at all: those
        // accounts have no password to fall back on, so without SESSION_SECRET
        // they would be created and then never enterable. Reporting that here
        // keeps the login screen from offering a button that cannot work.
        googleSignIn: maintenance
            ? unavailable('maintenance')
            : googleAuthEnabled(env) && playerSessionsEnabled(env)
                ? available
                : unavailable('configuration-unavailable'),
        guestPlay: maintenance
            ? unavailable('maintenance')
            : env.DISABLE_GUEST_PLAY === '1'
                ? unavailable()
                : playerSessionsEnabled(env)
                    ? available
                    : unavailable('configuration-unavailable'),
        // Kept on the release-flag helpers rather than main's inline env reads:
        // those helpers are this repo's single definition of each flag, they are
        // covered by _release-flags.test.ts, and main's version referenced local
        // `villageWar` / `clanBoss` bindings that do not exist on this branch.
        villageWar: villageWarMapEnabled(env) ? available : unavailable(),
        anbuInfiltration: anbuInfiltrationEnabled(env) ? available : unavailable(),
        clanBoss: clanBossEnabled(env) ? available : unavailable(),
        clanBossParties: clanBossPartiesEnabled(env) ? available : unavailable(),
        legacy: env.ENABLE_LEGACY === '1' ? available : unavailable('configuration-unavailable'),
        petBreedingStarts: petBreedingStartsEnabled(env) ? available : unavailable(),
        weeklyBossGuardCycle: weeklyBossGuardEnabled(env) ? available : unavailable(),
    };
}
