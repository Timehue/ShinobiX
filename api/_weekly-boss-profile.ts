import { weeklyBossEnemyTemplate } from './_authoritative-pve.js';
import { bossChallengeCatalogKit } from './_boss-challenge-kit.js';
import { maxChakraForLevel, maxStaminaForLevel } from './_xp-engine.js';

/** New weekly score attacks get a complete fixed legal rotation. This does not
 * change unlimited health, guard cycle, hit ceilings, attempts or scoring. */
export function weeklyBossChallengeProfile(profile: Record<string, unknown> | null | undefined, fallback: { id: string; name?: string }) {
    const base = weeklyBossEnemyTemplate(profile, fallback);
    if (base.level < 61) return { id: fallback.id, ...base };
    return { id: fallback.id, ...base,
        pveNamedChallenge: true, pveDifficulty: 'elite',
        maxChakra: maxChakraForLevel(base.level), maxStamina: maxStaminaForLevel(base.level),
        jutsu: [...(base.jutsu ?? []), ...bossChallengeCatalogKit(base.specialty)],
    };
}
