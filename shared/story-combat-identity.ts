/** Compact, server-owned character facts. Prose and numerical combat tuning
 * stay in their existing catalogs; these facts keep the same actor on screen. */
export type StoryCombatIdentity = {
    portrait: string;
    body?: string;
    sprite?: string;
    specialty: 'Ninjutsu' | 'Taijutsu' | 'Bukijutsu' | 'Genjutsu';
    element: 'Lightning' | 'Fire' | 'Earth' | 'Water' | 'Wind';
    signature: string;
};
const actor = (portrait: string, specialty: StoryCombatIdentity['specialty'], element: StoryCombatIdentity['element'], signature: string, sprite?: string, body?: string): StoryCombatIdentity =>
    ({ portrait, specialty, element, signature, ...(sprite ? { sprite } : {}), ...(body ? { body } : {}) });
const pve = (role: string) => `/portraits/pve/${role}.webp`;
const portrait = (name: string) => `/portraits/${name}.webp`;
const chapters: Record<string, StoryCombatIdentity[]> = {
    'stormveil-village': [
        actor(pve('skirmisher'), 'Genjutsu', 'Wind', 'Scout Wind Strike', 'skirmisher'),
        actor(portrait('tempest-guard-captain'), 'Taijutsu', 'Lightning', 'Tempest Guard Strike', undefined, '/portraits/cinematic/storywide/tempest-guard-captain.webp'),
        actor(pve('elementalist'), 'Genjutsu', 'Lightning', 'Lightning Seal Pulse', 'elementalist'),
        actor(pve('defender'), 'Ninjutsu', 'Lightning', 'Storm Engine Discharge', 'defender'),
        actor('/combat-actors/narrative/tempest-twins.webp', 'Bukijutsu', 'Lightning', 'Twin Tempest Assault', undefined, '/combat-actors/narrative/tempest-twins.webp'),
        actor(pve('assassin'), 'Bukijutsu', 'Lightning', 'Tempest Execution Strike', 'assassin'),
        actor(portrait('mira-volt'), 'Ninjutsu', 'Lightning', 'Mira’s Lightning Arc', undefined, '/portraits/cinematic/storywide/mira-volt-neutral.webp'),
        actor(pve('defender'), 'Ninjutsu', 'Lightning', 'Hollow Tempest Blast', 'defender'),
    ],
    'ashen-leaf-village': [
        actor('/combat-actors/narrative/wooden-root-guardian.webp', 'Genjutsu', 'Earth', 'Root Guardian Strike', undefined, '/combat-actors/narrative/wooden-root-guardian.webp'),
        actor(pve('defender'), 'Taijutsu', 'Earth', 'Rootbound Guard Strike', 'defender'),
        actor('/portraits/story-archive-spirit.webp', 'Genjutsu', 'Earth', 'Archive Echo', 'revenant'),
        actor('/combat-actors/narrative/first-flame-sentinel.webp', 'Ninjutsu', 'Fire', 'First Flame Burst', undefined, '/combat-actors/narrative/first-flame-sentinel.webp'),
        actor(pve('defender'), 'Ninjutsu', 'Earth', 'Rootbound Master’s Strike', 'defender'),
        actor(pve('skirmisher'), 'Bukijutsu', 'Earth', 'Rootbound Retrieval Assault', 'skirmisher'),
        actor('/portraits/story-flame-beast.webp', 'Ninjutsu', 'Fire', 'Ancestral Flame', 'hunt-ai-ember-drake'),
        actor(pve('defender'), 'Ninjutsu', 'Earth', 'Elder’s Root Strike', 'defender'),
    ],
    'frostfang-village': [
        actor('/portraits/story-snow-warden.webp', 'Taijutsu', 'Water', 'Snow Warden Bite', 'hunt-ai-frost-wolf'),
        actor(pve('defender'), 'Taijutsu', 'Water', 'Oathbound Ice Strike', 'defender'),
        actor('/combat-actors/narrative/frost-seal-guardian.webp', 'Ninjutsu', 'Water', 'Frost Seal Pulse', undefined, '/combat-actors/narrative/frost-seal-guardian.webp'),
        actor(pve('defender'), 'Taijutsu', 'Water', 'Ice Captain’s Strike', 'defender'),
        actor('/combat-actors/narrative/glacier-twins.webp', 'Taijutsu', 'Water', 'Glacier Twins’ Assault', undefined, '/combat-actors/narrative/glacier-twins.webp'),
        actor(pve('assassin'), 'Bukijutsu', 'Water', 'Oathbound Purge Strike', 'assassin'),
        actor(pve('assassin'), 'Bukijutsu', 'Water', 'Oathbreaker Hunter’s Cut', 'assassin'),
        actor(pve('defender'), 'Taijutsu', 'Water', 'Alpha Guard Strike', 'defender'),
    ],
    'moonshadow-village': [
        actor(pve('assassin'), 'Genjutsu', 'Wind', 'Hidden Blade Feint', 'assassin'),
        actor(portrait('veiled-hand-collector'), 'Genjutsu', 'Wind', 'Collector’s Shadow Strike'),
        actor(portrait('masked-auction-enforcer'), 'Bukijutsu', 'Wind', 'Auction Enforcer’s Cut'),
        actor('/combat-actors/narrative/contract-bound-shadow.webp', 'Genjutsu', 'Wind', 'Contract Shadow', undefined, '/combat-actors/narrative/contract-bound-shadow.webp'),
        actor(pve('assassin'), 'Genjutsu', 'Wind', 'Mirror Assassin’s Feint', 'assassin'),
        actor(portrait('veiled-hand-executioner'), 'Bukijutsu', 'Wind', 'Veiled Execution Strike'),
        actor(pve('assassin'), 'Bukijutsu', 'Wind', 'Shadow Hunter’s Cut', 'assassin'),
        actor(portrait('veiled-hand-grandmaster'), 'Genjutsu', 'Wind', 'Grandmaster’s Shadow Strike'),
    ],
};
const levels = [4, 15, 25, 35, 50, 65, 75, 85];
export const STORY_COMBAT_IDENTITIES: Readonly<Record<string, StoryCombatIdentity>> = Object.fromEntries(
    Object.entries(chapters).flatMap(([village, entries]) => entries.map((entry, i) => [`story-ai-${village}-${levels[i]}`, entry])),
);

export const PERSONAL_HUNT_PORTRAITS: Readonly<Record<string, string>> = {
    'story-reckoning-vanta-ninth': portrait('warden-sesk'),
    'story-reckoning-mori-working-copy': portrait('redactor-sella'),
    'story-reckoning-yura-exemption': portrait('meter-warden-kree'),
    'story-reckoning-iro-sealed-shelf': portrait('masked-auction-enforcer'),
    'story-reckoning-harrow-unbought': portrait('counterfeit-broker'),
};
