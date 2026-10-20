import { PERSONAL_HUNT_PORTRAITS, STORY_COMBAT_IDENTITIES } from './story-combat-identity.js';

export type NarrativeEnemyIdentity = { portrait: string; body?: string; sprite?: string; jutsuIds: readonly string[]; moveNames?: readonly string[]; moveDescriptions?: readonly string[] };
/** Existing catalog techniques: their costs, effects and cooldowns are retained.
 * A thematic loadout chooses the element; labels never promise extra mechanics. */
function kit(element: string) {
    return [`starter-nin-${element}-2`, `starter-tai-${element}-2`, `starter-buki-${element}-2`, `starter-gen-${element}-2`,
        `starter-nin-${element}-1`, `starter-gen-${element}-1`, 'starter-universal-flicker'];
}
const foe = (portrait: string, element: string, sprite?: string, body?: string, moveNames?: readonly string[], moveDescriptions?: readonly string[]): NarrativeEnemyIdentity =>
    ({ portrait, jutsuIds: kit(element), ...(sprite ? { sprite } : {}), ...(body ? { body } : {}), ...(moveNames ? { moveNames } : {}), ...(moveDescriptions ? { moveDescriptions } : {}) });
const portrait = (name: string) => `/portraits/${name}.webp`;
const quest = (name: string, element: string) => foe(`/portraits/quest-bosses/${name}.webp`, element);
export const NARRATIVE_ENEMY_IDENTITIES: Readonly<Record<string, NarrativeEnemyIdentity>> = {
    'road-ai-brask': foe('/portraits/pve/defender.webp', 'fire', 'defender'),
    'road-ai-magpie': foe('/portraits/pve/assassin.webp', 'wind', 'assassin'),
    'road-ai-havek': foe(portrait('instructor-havek'), 'earth', undefined, '/portraits/cinematic/side-stories/instructor-havek-empty-hand-v1.webp'),
    'road-ai-hela-dray': foe(portrait('captain-hela-dray'), 'lightning', undefined, '/portraits/cinematic/side-stories/captain-hela-dray.webp'),
    'road-ai-black-bridge': foe('/portraits/pve/bandit.webp', 'water', 'bandit'),
    'black-bridge-shooter': { portrait: '/combat-actors/narrative/black-bridge-shooter.webp', body: '/combat-actors/narrative/black-bridge-shooter.webp',
        jutsuIds: ['starter-buki-water-2', 'starter-buki-water-3', 'starter-universal-flicker'],
        moveNames: ['Water-Coated Crossbow Bolt', 'Draining Bolt Seal', 'Shooter’s Step'],
        moveDescriptions: ['Fire at the target and recover HP through Siphon.', 'Apply Recoil and Drain to the target.', 'Move to an empty tile.'] },
    'road-ai-anji-vesk': foe(portrait('anji-vesk'), 'water', undefined, '/portraits/cinematic/side-stories/anji-vesk.webp'),
    'road-ai-forty-first': foe('/portraits/pve/assassin.webp', 'lightning', 'assassin'),
    'road-ai-foreman-dray': foe(portrait('foreman-dray'), 'earth', undefined, '/portraits/cinematic/side-stories/foreman-dray.webp'),
    'road-ai-anchor-warden': foe(portrait('story-anchor-warden'), 'earth', 'clan-boss-golem'),
    'sunscar-raider': foe('/portraits/pve/bandit.webp', 'fire', 'bandit'),
    'sunscar-captain': foe('/portraits/pve/defender.webp', 'earth', 'defender'),
    'sunscar-wyrm': foe('/portraits/story-sand-wyrm.webp', 'earth', 'hunt-ai-moon-serpent'),
    'sunscar-scorpion': { portrait: '/combat-actors/narrative/scorpion-queen.webp', body: '/combat-actors/narrative/scorpion-queen.webp',
        jutsuIds: ['starter-tai-earth-2', 'starter-tai-fire-2', 'starter-tai-wind-2', 'starter-tai-lightning-2', 'starter-tai-water-3', 'starter-nin-earth-1', 'starter-universal-flicker'],
        moveNames: ['Venom Sting', 'Crushing Claws', 'Raking Pincers', 'Barbed Carapace', 'Queen’s Guard', 'Chitin Armor', 'Scuttling Dash'],
        moveDescriptions: ['Strike the target and apply Poison.', 'Strike the target and drain their HP and chakra.',
            'Strike the target and gain Lifesteal for later attacks.', 'Strike the target and gain Reflect.',
            'Gain Reflect and Absorb to return damage and recover HP when hit.',
            'Gain a shield and make the target take more damage.', 'Move to an empty tile.'] },
    'sunscar-rogue': foe('/portraits/pve/assassin.webp', 'wind', 'assassin'),
    'sunscar-sentinel': foe('/portraits/story-anchor-warden.webp', 'earth', 'clan-boss-golem'),
    'rift-boss-legacy-echo': foe(portrait('rift-boss-legacy-echo'), 'wind', 'rift-boss-legacy-echo'),
    'rift-boss-hollow-stalker': foe(portrait('rift-boss-hollow-stalker'), 'wind', 'rift-boss-hollow-stalker'),
    'rift-boss-warren-alpha': foe(portrait('rift-boss-warren-alpha'), 'water', 'rift-boss-warren-alpha', undefined,
        ['Warren Frost Breath', 'Alpha Fang', 'Raking Claws', 'Blighted Howl', 'Frostfang Drain', 'Alpha’s Rally', 'Alpha Lunge'],
        ['Strike the target and apply Wound.', 'Strike the target and increase the damage dealt by later attacks.',
            'Strike the target and restore HP through Siphon.', 'Harm the target and apply Poison.',
            'Gain Lifesteal for later attacks and make the target take more damage.',
            'Increase the damage dealt by later attacks and drain the target’s HP and chakra.', 'Move to an empty tile.']),
    'rift-boss-engine-echo': foe(portrait('rift-boss-engine-echo'), 'lightning', 'rift-boss-engine-echo'),
    'rift-boss-hollow-legacy': foe(portrait('rift-boss-hollow-legacy'), 'wind', 'rift-boss-hollow-legacy'),
    'rift-boss-mirror-shard': foe(portrait('rift-boss-mirror-shard'), 'water', 'rift-boss-mirror-shard'),
    'rift-boss-gate-heir': { portrait: portrait('rift-boss-gate-heir'), sprite: 'rift-boss-gate-heir',
        jutsuIds: ['starter-nin-lightning-2', 'starter-nin-fire-2', 'starter-nin-water-2', 'starter-gen-wind-2',
            'starter-nin-water-1', 'starter-gen-wind-1', 'starter-universal-flicker'] },
    'ashbound-raider': quest('ashbound-raider', 'fire'),
    'bell-wraith': quest('bell-wraith', 'wind'),
    'bandit-captain-goro': quest('bandit-captain-goro', 'earth'),
    'puppeteer-itoguchi': quest('puppeteer-itoguchi', 'wind'),
    'hunter-shirakawa': quest('hunter-shirakawa', 'water'),
    'house-kuroban': quest('house-kuroban', 'earth'),
    'ashbound-cinder': quest('ashbound-cinder', 'fire'),
    'ashbound-slag': quest('ashbound-slag', 'earth'),
    'kazan-ashbound': quest('kazan-ashbound', 'fire'),
    ...Object.fromEntries(Object.entries(PERSONAL_HUNT_PORTRAITS).map(([id, path]) => [id, foe(path,
        id.includes('vanta') ? 'lightning' : id.includes('mori') ? 'earth' : id.includes('yura') ? 'water' : 'wind')])),
    ...Object.fromEntries(['stormveil', 'ashen-leaf', 'frostfang', 'moonshadow'].map(village => {
        const identity = STORY_COMBAT_IDENTITIES[`story-ai-${village}-village-35`];
        return [`world-crisis-fourfold-breach-v1:${village}`, foe(identity.portrait, identity.element.toLowerCase(), identity.sprite, identity.body)];
    })),
};

export function narrativeEnemyIdentity(rawId: string | undefined): NarrativeEnemyIdentity | undefined {
    const id = rawId ?? '';
    if (Object.hasOwn(NARRATIVE_ENEMY_IDENTITIES, id)) return NARRATIVE_ENEMY_IDENTITIES[id];
    if (id.startsWith('world-story-')) return NARRATIVE_ENEMY_IDENTITIES[id.slice('world-story-'.length)];
    if (id.startsWith('world-questbook-')) return Object.entries(NARRATIVE_ENEMY_IDENTITIES).find(([key]) => id.endsWith(`-${key}`))?.[1];
    return undefined;
}

/** Preserve the veteran host's rotation capacity while keeping follow-ups in
 * the same element. This changes no catalog technique's numerical fields. */
export function narrativeEnemyJutsuIds(identity: NarrativeEnemyIdentity, capacity = 7): string[] {
    const element = identity.jutsuIds[0].split('-')[2];
    return [...new Set([...identity.jutsuIds, `starter-nin-${element}-3`, `starter-nin-${element}-4`,
        `starter-gen-${element}-3`, `starter-gen-${element}-4`, `starter-tai-${element}-3`])]
        .slice(0, Math.max(identity.jutsuIds.length, Math.min(12, capacity)));
}
