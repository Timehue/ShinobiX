import { clamp, sunscarHash } from './random.js';
import type { RallyArchetype, RallyElement, RallyProfile } from './rally-types.js';

export const RALLY_TECHNIQUES: Record<RallyElement, { name: string; description: string; color: string }> = {
    Fire: { name: 'Heat Burst', description: 'A sharp acceleration boost for four seconds.', color: '#ff865c' },
    Lightning: { name: 'Flash Step', description: 'Fast lane changes and extra pace for four seconds.', color: '#ffe67f' },
    Wind: { name: 'Tailwind', description: 'Carry jumps farther and cut through deep sand for five seconds.', color: '#91e3c3' },
    Earth: { name: 'Iron Charge', description: 'Break through the next obstacle without losing momentum.', color: '#d6ad79' },
    Water: { name: 'Flow State', description: 'Ignore terrain drag and recover quickly for six seconds.', color: '#81d7f2' },
};
const ARCHETYPES: Record<RallyArchetype, RallyProfile> = {
    sprinter: { archetype: 'sprinter', speed: 76, acceleration: 78, agility: 53, endurance: 43, stability: 50 },
    acrobat: { archetype: 'acrobat', speed: 60, acceleration: 61, agility: 82, endurance: 52, stability: 45 },
    bruiser: { archetype: 'bruiser', speed: 57, acceleration: 53, agility: 44, endurance: 66, stability: 80 },
    endurance: { archetype: 'endurance', speed: 63, acceleration: 48, agility: 51, endurance: 84, stability: 54 },
    trickster: { archetype: 'trickster', speed: 60, acceleration: 65, agility: 78, endurance: 50, stability: 47 },
};
/** Tuning overrides are species-wide, never per-player or based on rarity. */
export const RALLY_PROFILE_OVERRIDES: Readonly<Record<string, Partial<RallyProfile>>> = {
    'starter-fire': { archetype: 'sprinter' }, 'starter-lightning': { archetype: 'trickster' },
    'starter-water': { archetype: 'endurance' }, 'starter-earth': { archetype: 'bruiser' }, 'starter-wind': { archetype: 'acrobat' },
};
export function rallyProfile(species: { id: string; name: string; speed?: unknown; attack?: unknown; defense?: unknown; hp?: unknown }): RallyProfile {
    const override = RALLY_PROFILE_OVERRIDES[species.id] ?? RALLY_PROFILE_OVERRIDES[species.id.replace(/-[rl]$/, '')];
    const archetype: RallyArchetype = override?.archetype ??
        (/bear|boar|turtle|golem|beetle|colossus/i.test(species.name) ? 'bruiser' :
            /hawk|bird|sparrow|crane|owl|moth|raven|phoenix/i.test(species.name) ? 'acrobat' :
                /serpent|seal|eel|tortoise|wyrm/i.test(species.name) ? 'endurance' :
                    /fox|cat|ocelot|rabbit|weasel|monkey/i.test(species.name) ? 'trickster' : 'sprinter');
    const base = ARCHETYPES[archetype];
    // Species signature redistributes a tiny number of points. No rarity, growth,
    // equipment, PvP trait or instance-ID advantage enters this calculation.
    const signature = sunscarHash(species.id);
    const skew = signature % 7 - 3;
    return { ...base, speed: clamp(base.speed + skew, 40, 85), agility: clamp(base.agility - skew, 40, 85), ...override };
}
