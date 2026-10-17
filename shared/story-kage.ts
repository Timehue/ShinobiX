/** The four authored village finales. These are story NPCs, never elected Kage. */
import { STORY_KAGE_PORTRAITS } from './story-kage-art.js';
export const STORY_KAGE_ENCOUNTERS = {
    'Stormveil Village': {
        name: 'Kage Raiko Veyr, Hollow Storm Tyrant',
        specialty: 'Ninjutsu',
        portrait: STORY_KAGE_PORTRAITS['story-ai-stormveil-village-100'],
        jutsuIds: [
            'starter-nin-lightning-2', 'starter-nin-lightning-aoe',
            'starter-nin-water-2', 'starter-nin-wind-2', 'starter-nin-wind-aoe',
            'starter-nin-lightning-4', 'starter-buki-water-1', 'starter-universal-flicker',
            'starter-gen-lightning-3', 'starter-tai-lightning-3', 'starter-nin-water-1', 'starter-nin-water-aoe',
        ],
        tell: 'Voltaic Surge Focus charges the next assault. Watch the lightning aura; spent signatures must recover before they can repeat.',
    },
    'Ashen Leaf Village': {
        name: 'Kage Hoshina Enju, First Flame Vessel',
        specialty: 'Ninjutsu',
        portrait: STORY_KAGE_PORTRAITS['story-ai-ashen-leaf-village-100'],
        jutsuIds: [
            'starter-nin-fire-2', 'starter-nin-fire-aoe',
            'starter-nin-earth-2', 'starter-nin-earth-aoe', 'starter-tai-fire-2',
            'starter-nin-fire-3', 'starter-nin-earth-1', 'starter-universal-flicker',
            'starter-nin-fire-4', 'starter-buki-earth-3', 'starter-tai-earth-1', 'starter-buki-earth-2',
        ],
        tell: 'Ash Cloud Breaker kindles the next assault. Fire and earth signatures leave their own cooldown openings.',
    },
    'Frostfang Village': {
        name: 'Kage Kael Whitefang, Hollow Oath Tyrant',
        specialty: 'Taijutsu',
        portrait: STORY_KAGE_PORTRAITS['story-ai-frostfang-village-100'],
        jutsuIds: [
            'starter-tai-water-2', 'starter-tai-water-aoe',
            'starter-tai-lightning-2', 'starter-tai-wind-2', 'starter-buki-wind-2',
            'starter-tai-lightning-4', 'starter-buki-water-1', 'starter-universal-flicker',
            'starter-tai-lightning-3', 'starter-buki-water-3', 'starter-gen-lightning-3', 'starter-buki-water-2',
        ],
        tell: 'Thunderpulse Overdrive signals a stronger follow-up. Break the water guard or create distance while signatures recover.',
    },
    'Moonshadow Village': {
        name: 'Kage Sable Nocturne, Hollow Moon Sovereign',
        specialty: 'Genjutsu',
        portrait: STORY_KAGE_PORTRAITS['story-ai-moonshadow-village-100'],
        jutsuIds: [
            'starter-gen-lightning-2', 'starter-gen-lightning-aoe',
            'starter-gen-wind-2', 'starter-gen-wind-aoe', 'starter-buki-wind-2',
            'starter-gen-water-1', 'starter-gen-wind-1', 'starter-universal-flicker',
            'starter-gen-water-3', 'starter-gen-wind-4', 'starter-nin-wind-3', 'starter-gen-water-2',
        ],
        tell: 'Drowning Reflection prepares stronger illusions. A spent cyclone and a broken whispering guard create an opening.',
    },
} as const;

export const STORY_KAGE_DIFFICULTY = 'final-kage' as const;
export const STORY_KAGE_DIFFICULTY_LABEL = 'Final Kage - Apex tactics';
export const STORY_KAGE_RECOVERY = 'Each signature costs 60 AP and has a seven-round cooldown. Track spent techniques, clear the offensive setup or break the guard, then commit during the recovery window.';

export type StoryKageVillage = keyof typeof STORY_KAGE_ENCOUNTERS;

export function storyKageForVillage(village: string) {
    return Object.prototype.hasOwnProperty.call(STORY_KAGE_ENCOUNTERS, village)
        ? STORY_KAGE_ENCOUNTERS[village as StoryKageVillage]
        : undefined;
}

export function isFinalStoryKageId(id: string): boolean {
    return Object.keys(STORY_KAGE_ENCOUNTERS).some((village) =>
        id === `story-ai-${village.toLowerCase().replace(/\W+/g, '-')}-100`);
}
