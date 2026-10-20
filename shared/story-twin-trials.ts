/** The two Jonin pair trials are real simultaneous encounters, not group portraits. */
export type StoryTwin = {
    id: string;
    name: string;
    role: string;
    specialty: 'Bukijutsu' | 'Ninjutsu';
    art: string;
    jutsuIds: readonly string[];
    moveNames: readonly string[];
    descriptions: readonly string[];
};
const art = (id: string) => `/combat-actors/narrative/${id}.webp`;
export const STORY_TWIN_TRIALS: Readonly<Record<string, readonly [StoryTwin, StoryTwin]>> = {
    'story-ai-stormveil-village-50': [
        { id: 'tempest-twin-blade', name: 'Tempest Twin: Stormblade', role: 'Blade fighter', specialty: 'Bukijutsu', art: art('tempest-twin-blade'),
            jutsuIds: ['starter-buki-lightning-2', 'starter-buki-lightning-3', 'starter-universal-flicker'],
            moveNames: ['Stormblade Slash', 'Stormblade Guard', 'Stormblade Step'],
            descriptions: ['Strike the target and restore HP through Siphon.', 'Take less damage and weaken the target’s attacks.', 'Move to an empty tile.'] },
        { id: 'tempest-twin-seal', name: 'Tempest Twin: Stormseal', role: 'Lightning caster', specialty: 'Ninjutsu', art: art('tempest-twin-seal'),
            jutsuIds: ['starter-nin-lightning-2', 'starter-nin-lightning-3', 'starter-universal-flicker'],
            moveNames: ['Tempest Lance', 'Disrupting Storm Seal', 'Stormseal Step'],
            descriptions: ['Strike the target and apply Wound.', 'Drain the target’s HP and chakra and apply Poison.', 'Move to an empty tile.'] },
    ],
    'story-ai-frostfang-village-50': [
        { id: 'glacier-twin-blade', name: 'Glacier Twin: Iceblade', role: 'Blade fighter', specialty: 'Bukijutsu', art: art('glacier-twin-blade'),
            jutsuIds: ['starter-buki-water-2', 'starter-buki-water-1', 'starter-universal-flicker'],
            moveNames: ['Iceblade Slash', 'Iceblade Screen', 'Iceblade Step'],
            descriptions: ['Strike the target and restore HP through Siphon.', 'Gain a shield and take less damage.', 'Move to an empty tile.'] },
        { id: 'glacier-twin-seal', name: 'Glacier Twin: Frostseal', role: 'Ice caster', specialty: 'Ninjutsu', art: art('glacier-twin-seal'),
            jutsuIds: ['starter-nin-water-2', 'starter-nin-water-3', 'starter-universal-flicker'],
            moveNames: ['Glacier Lance', 'Fracturing Frost Seal', 'Frostseal Step'],
            descriptions: ['Strike the target and apply Wound.', 'Make the target take stronger later hits and suffer Recoil when attacking.', 'Move to an empty tile.'] },
    ],
};
export function storyTwinTrial(opponentId: string): readonly [StoryTwin, StoryTwin] | undefined {
    return STORY_TWIN_TRIALS[opponentId];
}
