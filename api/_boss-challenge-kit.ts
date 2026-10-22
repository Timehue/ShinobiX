import { resolveAiProfileJutsu, MAX_CHALLENGE_AI_LOADOUT_JUTSU, type AiOpponentJutsu } from './_ai-opponent-loadout.js';
import { COMBAT_RESOURCES_V2, v2JutsuCosts } from './_combat-resources.js';
import { maxChakraForLevel, maxStaminaForLevel } from './_xp-engine.js';
import { pveAiMasteryForLevel } from './_pve-difficulty.js';
import { aiStatsForLevel } from './_ai-level-curves.js';
import type { TowerActor } from './towers/_tower-session.js';

/** Fixed trained boss curriculum. Catalog EP, AP, tags, durations and cooldowns
 * are preserved. Existing authored signatures remain the boss's identity. */
export function bossChallengeCatalogKit(specialty: string) {
    const school = specialty === 'Taijutsu' ? 'tai' : specialty === 'Bukijutsu' ? 'buki' : specialty === 'Genjutsu' ? 'gen' : 'nin';
    return resolveAiProfileJutsu([
        ...['earth', 'water', 'fire', 'wind', 'lightning'].map(element => `starter-${school}-${element}-2`),
        `starter-${school}-earth-aoe`, 'starter-buki-earth-3', 'starter-gen-earth-4', 'starter-universal-flicker',
    ], null, MAX_CHALLENGE_AI_LOADOUT_JUTSU);
}

/** Used only by newly sealed cooperative boss adapters. It grants a legal
 * cooldown rotation and shared level resource pools. Bosses spend their legal
 * level stat budget; adds, HP, armor and authored source levels stay unchanged. */
export function sealTeamBossChallengeKit(actor: TowerActor, boss: boolean, index = 0, masteryEnabled = true): void {
    if (actor.character.bossChallengeKit === 'cooperative-v1') return;
    const level = Math.max(1, Math.min(100, Math.floor(Number(actor.character.level) || 1)));
    if (level < 61) return;
    const specialty = String(actor.character.specialty ?? 'Ninjutsu');
    const original = Array.isArray(actor.character.jutsu) ? actor.character.jutsu as AiOpponentJutsu[] : [];
    // Authored repeatable signatures get a visible recovery window. Catalog
    // techniques fill that window rather than making a boss basic-attack only.
    const signatures = original.map(j => ({ ...j, cooldown: Number(j.cooldown) > 0 ? Number(j.cooldown) : 2, aiPriority: 60 }));
    const kit = bossChallengeCatalogKit(specialty).filter(j => !String(j.id).includes('flicker'));
    // Adds retain their authored attack, plus one role setup and two attacks.
    const selected = boss ? [...signatures, ...kit] : [
        ...signatures, ...kit.filter(j => Number(j.effectPower) > 0).slice(index % 3, index % 3 + 2),
        ...kit.filter(j => j.id === 'starter-buki-earth-3'),
    ];
    actor.character.jutsu = selected.slice(0, 12).map(j => ({ ...j,
        ...(COMBAT_RESOURCES_V2 ? v2JutsuCosts(j, level, specialty) : {}),
    }));
    if (masteryEnabled) actor.character.jutsuMastery = selected.slice(0, 12).map(j => ({ jutsuId: j.id, level: pveAiMasteryForLevel(level) }));
    // Sparse legacy sheets specified only four of twelve stats, leaving an
    // L80 boss with a small fraction of its legal budget. Rebuild only these
    // explicitly sealed boss actors, from their own level and actual kit.
    if (boss) actor.character.stats = aiStatsForLevel(level, selected);
    actor.maxChakra = actor.chakra = maxChakraForLevel(level);
    actor.maxStamina = actor.stamina = maxStaminaForLevel(level);
    actor.character.bossChallengeKit = 'cooperative-v1';
}
