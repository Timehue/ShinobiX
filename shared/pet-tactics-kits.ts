import type { TacticsElement } from './pet-tactics-contract.js';

/*
 * Authored Pet Arena kits for every species outside the twelve hand-built
 * profiles in pet-tactics-roster.ts (owner-approved, 2026-10-26).
 *
 * Before this, those 149 species shared one generic kit per role and element,
 * so two Water defenders were the same pet with different art. Each now adds
 * two moves to its pool and names its own signature:
 *
 *   - an ELEMENT move, by rule (petTacticsElementMove below), which the
 *     species' "Tactics" preset equips;
 *   - a FLAVOR move, authored per species from its role's allowed set
 *     (PET_TACTICS_FLAVOR_MOVES), which stays in the pool for players to pick.
 *
 * The change is additive on purpose. Every species keeps the eight moves it
 * had, so a ranked build a player already saved stays legal. Every added move
 * already exists in TACTICS_MOVES with its current numbers; the only ones no
 * species carried before are the Water, Earth and Lightning Skies, which are
 * the Fire and Wind Skies with another element. No new mechanic or number
 * enters ranked. The signature keeps its role's kind (shield, heal, damage),
 * and only its name changes.
 */

/** Role tools a species may add as its flavor move: role-appropriate moves the
 *  role's generic kit does not already carry. */
export const PET_TACTICS_FLAVOR_MOVES: Readonly<Record<string, readonly string[]>> = {
    sentinel: ['protect', 'rally', 'expose', 'mend'],
    medic: ['protect', 'rally', 'expose', 'intercept', 'open-wound'],
    striker: ['intercept', 'aegis', 'purify', 'mend'],
    scout: ['open-wound', 'aegis', 'intercept', 'mend'],
    balanced: ['intercept', 'aegis', 'purify', 'mend'],
};

/** The element move a species adds. Fire burns, Water slows, Lightning binds
 *  (only the attacking roles; the bound-control move stays off defenders and
 *  healers), and every other case takes its element's Sky. */
export function petTacticsElementMove(element: TacticsElement, role: string): string {
    if (element === 'Fire') return 'ember-scar';
    if (element === 'Water' && role !== 'medic') return 'undertow';
    if (element === 'Lightning' && role !== 'sentinel' && role !== 'medic') return 'bind';
    return `${element.toLowerCase()}-sky`;
}

/** species id → [flavor move, signature name]. */
export const PET_TACTICS_KITS: Readonly<Record<string, readonly [string, string]>> = {
    'standard-0': ['rally', 'Foxfire Bulwark'],
    'standard-1': ['mend', 'Snowdrift Bound'],
    'standard-2': ['purify', 'Nine Lives Rake'],
    'standard-3': ['expose', 'Canopy Mending'],
    'standard-4': ['mend', 'Riverstone Shell'],
    'standard-5': ['aegis', 'Bedrock Roll'],
    'standard-6': ['mend', 'Sunbaked Lunge'],
    'standard-7': ['expose', 'Ember Vigil'],
    'standard-8': ['protect', 'Lilypad Ward'],
    'standard-9': ['open-wound', 'Tusk Charge'],
    'standard-10': ['purify', 'Silent Pinion'],
    'standard-11': ['open-wound', 'Shed Skin Renewal'],
    'standard-12': ['expose', 'Fogbound Veil'],
    'standard-13': ['aegis', 'Carapace Spark'],
    'standard-14': ['aegis', 'Crane Edge'],
    'standard-15': ['rally', 'Hearth Warmth'],
    'standard-16': ['mend', 'Antler Thunderguard'],
    'standard-17': ['intercept', 'Squall Dive'],
    'standard-18': ['purify', 'Dusk Echo'],
    'standard-19': ['protect', 'Healing Mud'],
    'standard-20': ['rally', 'Canopy Guard'],
    'standard-21': ['mend', 'Hoarfrost Maul'],
    'standard-22': ['intercept', 'Shrine Wall Strike'],
    'standard-23': ['intercept', 'Den Mending'],
    'standard-24': ['expose', 'Pack Circle'],
    'standard-25': ['open-wound', 'Flint Spark Chase'],
    'standard-26': ['mend', 'Tunnel Flare'],
    'standard-27': ['expose', 'Lantern Glow'],
    'standard-28': ['protect', 'Scorched Scales'],
    'standard-29': ['aegis', 'Lava Paw Dash'],
    'standard-30': ['purify', 'Brookblade'],
    'standard-31': ['protect', 'Tidepool Rest'],
    'standard-32': ['rally', 'Shoal Screen'],
    'standard-33': ['intercept', 'Reedline Spear'],
    'standard-34': ['aegis', 'Marsh Current Lash'],
    'standard-35': ['rally', 'Morning Chorus'],
    'standard-36': ['expose', 'Dust Devil Veil'],
    'standard-37': ['aegis', 'Cliffside Swoop'],
    'standard-38': ['intercept', 'Glinting Snatch'],
    'standard-39': ['open-wound', 'Updraft Song'],
    'standard-40': ['protect', 'Static Bristle'],
    'standard-41': ['mend', 'Live Wire Scamper'],
    'standard-42': ['aegis', 'Arc Nip'],
    'standard-43': ['intercept', 'Static Lullaby'],
    'standard-44': ['rally', 'Covey Shield'],
    'standard-45': ['intercept', 'Kiln Shell Roll'],
    'standard-46': ['aegis', 'Mossquill Volley'],
    'standard-47': ['protect', 'Sandbath Renewal'],
    'standard-48': ['mend', 'Scalestone Fortress'],
    'standard-49': ['open-wound', 'Burrow Burst'],
    'rare-0': ['expose', 'Crimson Tail Ward'],
    'rare-1': ['aegis', 'Rime Leap'],
    'rare-2': ['mend', 'Moonless Pounce'],
    'rare-3': ['intercept', 'Zenith Light'],
    'rare-4': ['protect', 'Undertide Shield'],
    'rare-5': ['mend', 'Ironback Rampart Roll'],
    'rare-6': ['aegis', 'Mirage Fang'],
    'rare-7': ['open-wound', 'Augury of Ash'],
    'rare-8': ['rally', 'Azure Bubble'],
    'rare-9': ['aegis', 'Bristleback Rush'],
    'rare-10': ['mend', 'Moonsilver Talon'],
    'rare-11': ['protect', 'Prism Renewal'],
    'rare-12': ['expose', 'Veiled Lynx Guard'],
    'rare-13': ['open-wound', 'Steelhorn Surge'],
    'rare-14': ['purify', 'Pearlwing Cut'],
    'rare-15': ['intercept', 'Smolder Balm'],
    'rare-16': ['rally', 'Thornrack Bastion'],
    'rare-17': ['mend', 'Stormfin Glide'],
    'rare-18': ['intercept', 'Duskwing Shriek'],
    'rare-19': ['rally', 'Mossback Hymn'],
    'rare-20': ['mend', 'Bamboo Wall'],
    'rare-21': ['open-wound', 'Frostbite Rend'],
    'rare-22': ['purify', 'Shrinefire Strike'],
    'rare-23': ['open-wound', 'Granite Den Rite'],
    'rare-24': ['protect', 'Pack Thunderwall'],
    'rare-25': ['intercept', 'Magma Cackle'],
    'rare-26': ['aegis', 'Spotted Blaze'],
    'rare-27': ['protect', 'Rekindling Pyre'],
    'rare-28': ['mend', 'Scoria Guard'],
    'rare-29': ['mend', 'Tuftflame Bound'],
    'rare-30': ['mend', 'Riptide Slink'],
    'rare-31': ['intercept', 'Iceshelf Song'],
    'rare-32': ['rally', 'Coral Spine Guard'],
    'rare-33': ['aegis', 'Brine Dive'],
    'rare-34': ['intercept', 'Glacier Lunge'],
    'rare-35': ['protect', 'Eye of Calm'],
    'rare-36': ['protect', 'Zephyr Shelter'],
    'rare-37': ['open-wound', 'Gust Tern Plunge'],
    'rare-38': ['aegis', 'Squall Feint'],
    'rare-39': ['rally', 'Driftwing Blessing'],
    'rare-40': ['expose', 'Voltmusk Barrier'],
    'rare-41': ['intercept', 'Surge Weave'],
    'rare-42': ['mend', 'Thunderhop'],
    'rare-43': ['rally', 'Second Wind Watch'],
    'rare-44': ['mend', 'Arc Canopy'],
    'rare-45': ['intercept', 'Granite Tunnel Rush'],
    'rare-46': ['purify', 'Stoneback Trample'],
    'rare-47': ['expose', 'Quartz Glow'],
    'rare-48': ['protect', 'Terra Quill Wall'],
    'rare-49': ['mend', 'Bramble Wallow'],
    'legendary-0': ['rally', 'Glacier Wall'],
    'legendary-1': ['intercept', 'Tempest Stoop'],
    'legendary-2': ['purify', 'Umbral Foxfire'],
    'legendary-3': ['rally', 'Spirit Grove Blessing'],
    'legendary-4': ['expose', 'Ironfang Stand'],
    'legendary-5': ['mend', 'Azure Hoofbeat'],
    'legendary-6': ['mend', 'Phoenix Dive'],
    'legendary-7': ['expose', 'Moonscale Renewal'],
    'legendary-8': ['rally', 'Stormmane Guard'],
    'legendary-9': ['aegis', 'Crystal Maul'],
    'legendary-10': ['intercept', 'Void Plume'],
    'legendary-11': ['open-wound', 'Stormeye Respite'],
    'legendary-12': ['protect', 'Frost Lynx Vigil'],
    'legendary-13': ['aegis', 'Searing Polar Charge'],
    'legendary-14': ['aegis', 'Ancient Crane Dance'],
    'legendary-15': ['open-wound', 'Triad Rekindling'],
    'legendary-16': ['rally', 'Ashwing Shelter'],
    'legendary-17': ['intercept', 'Behemoth Eruption'],
    'legendary-18': ['aegis', 'Tidelord Breach'],
    'legendary-19': ['expose', 'Wyrmfrost Stillness'],
    'legendary-20': ['mend', 'Abyssal Ink Veil'],
    'legendary-21': ['open-wound', 'Roc Thunderhead'],
    'legendary-22': ['mend', 'Tempest Gallop'],
    'legendary-23': ['intercept', 'Riddle of Mending'],
    'legendary-24': ['expose', 'Raiju Stormcoat'],
    'legendary-25': ['aegis', 'Wyvern Stormdive'],
    'legendary-26': ['purify', 'Galvanic Sting'],
    'legendary-27': ['protect', 'Titan Heartstone'],
    'legendary-28': ['expose', 'Gargoyle Vigil'],
    'legendary-29': ['mend', 'Verdant Rootstep'],
    'mythic-1': ['aegis', 'Worldstorm Descent'],
    'mythic-2': ['protect', 'Titan Permafrost'],
    'mythic-3': ['mend', 'Solar Crown Charge'],
    'mythic-4': ['intercept', 'Oni Hound Rend'],
    'mythic-5': ['rally', 'Vermillion Wingrise'],
    'mythic-6': ['mend', 'Ryujin Tidegate'],
    'mythic-7': ['aegis', 'Shell and Feather'],
    'mythic-8': ['purify', 'Raijin Drumstrike'],
    'mythic-9': ['rally', 'Worldroot Embrace'],
    'mythic-10': ['intercept', 'Ash Crown Rebirth'],
    'mythic-11': ['open-wound', 'Moonwell Tide'],
    'mythic-12': ['expose', 'Skyglass Halo'],
    'mythic-13': ['open-wound', 'Thunderbloom Gallop'],
    'mythic-14': ['mend', 'Gravepeak Avalanche'],
    'mythic-15': ['mend', 'Celestial Mane'],
    'starter-fire-l': ['purify', 'Fenrir Wildfire'],
    'starter-wind-l': ['mend', 'Roc Skybreaker'],
    'starter-lightning-l': ['aegis', 'Hound of Raijin'],
    'starter-earth-l': ['intercept', 'Genbu Mountainshell'],
};
