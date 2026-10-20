import { clanBossAcceptanceFixture } from './clan-boss-balance-sim.js';
import { buildTowerEncounter } from '../api/towers/_encounter.js';
import { configureClanBossEncounter } from '../api/clan-boss/_encounter-config.js';
import { CLAN_BOSS_FLOORS } from '../api/towers/_floor-catalog.js';

export function clanBossEncounterFixture(bossIndex = 0, size = 3, seed = 41000, bossHp = 72000,
    options: { level?: number; build?: 'maxed' | 'offense' | 'midgame'; sustain?: boolean; pool?: number; poolMax?: number; rulesVersion?: 1 | 2; slugs?: string[] } = {}) {
    const floor = CLAN_BOSS_FLOORS[bossIndex]!;
    const squad = Array.from({ length: size }, (_, i) => ({ id: `sq-${i}`, name: `Hero${i}`,
        ownerSlug: options.slugs?.[i] ?? `hero${i}`, ai: false,
        character: clanBossAcceptanceFixture(options.level ?? 100, options.build ?? 'maxed', options.sustain ?? true).hydrated }));
    const session = buildTowerEncounter({ floor, squad, runId: `cboss-acceptance-${bossIndex}-${size}-${seed}`,
        seed, partySize: size, towerId: 'clan-boss', clanBossRulesVersion: options.rulesVersion ?? 2, now: 0 });
    configureClanBossEncounter(session, floor, bossHp, { rulesVersion: options.rulesVersion ?? 2,
        poolAtStart: options.pool ?? bossHp, poolMax: options.poolMax ?? bossHp });
    return { session, floor };
}
