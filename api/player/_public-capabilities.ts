import type { PublicCapabilities, PublicCapabilityReason } from '../../shared/public-capabilities.js';
import { petBreedingStartsEnabled, weeklyBossGuardEnabled } from '../_release-flags.js';
import { googleAuthEnabled } from '../_google-auth.js';
import { playerSessionsEnabled } from '../_auth.js';

const available = { state: 'available', reason: 'available' } as const;

function unavailable(reason: PublicCapabilityReason = 'temporarily-disabled') {
    return { state: 'temporarily-unavailable', reason } as const;
}

export function publicCapabilities(env: NodeJS.ProcessEnv = process.env): PublicCapabilities {
    const maintenance = env.MAINTENANCE_MODE === '1';
    const mutationsFrozen = env.FREEZE_ECONOMY_REWARDS === '1';
    const villageWar = env.DISABLE_VILLAGE_WAR !== '1';
    const clanBoss = env.DISABLE_CLAN_BOSS !== '1';

    return {
        gameplay: maintenance ? unavailable('maintenance') : available,
        gameplayMutations: maintenance
            ? unavailable('maintenance')
            : mutationsFrozen
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
        villageWar: villageWar ? available : unavailable(),
        clanBoss: clanBoss ? available : unavailable(),
        clanBossParties: clanBoss && env.DISABLE_CLAN_BOSS_PARTIES !== '1' ? available : unavailable(),
        legacy: env.ENABLE_LEGACY === '1' ? available : unavailable('configuration-unavailable'),
        petBreedingStarts: petBreedingStartsEnabled(env) ? available : unavailable(),
        weeklyBossGuardCycle: weeklyBossGuardEnabled(env) ? available : unavailable(),
    };
}
