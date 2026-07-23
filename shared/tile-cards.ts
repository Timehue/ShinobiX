/*
 * Shinobi Tiles — the card-game catalog + element-counter table + the
 * built-in/creator card merge helper.
 *
 * Pure data and a pure function: no dependency on App state, no imports.
 * Extracted verbatim from App.tsx (card values byte-for-byte unchanged).
 * TileCard, TileCardArrow, and getAllTileCards are re-exported from App.tsx
 * for the existing "../App" import sites (components/Shop, screens/Inventory).
 */

export type TileCardArrow = "up" | "down" | "left" | "right";
export type TileCard = {
    id: string; name: string; element: string;
    top: number; right: number; bottom: number; left: number;
    rarity: "common" | "rare" | "epic" | "legendary"; description: string;
    image?: string;
};

export const ELEMENT_COUNTERS: Record<string, string> = {
    Water: "Fire", Fire: "Wind", Wind: "Earth", Earth: "Lightning", Lightning: "Water",
    Ice: "Shadow", Shadow: "Neutral", Neutral: "None"
};

export const shinobiTileCards: TileCard[] = [
    // Common (20) — values 15–45
    { id: "tc-01", name: "Training Dummy",      element: "None",    top: 15, right: 15, bottom: 15, left: 15, rarity: "common", description: "Weak starter card." },
    { id: "tc-02", name: "Leaf Cat",            element: "Wind",    top: 25, right: 30, bottom: 20, left: 30, rarity: "common", description: "Fast village pet card." },
    { id: "tc-03", name: "Stone Turtle",        element: "Earth",   top: 35, right: 20, bottom: 35, left: 20, rarity: "common", description: "Slow but sturdy." },
    { id: "tc-04", name: "Kunai Scout",         element: "Lightning", top: 30, right: 35, bottom: 20, left: 25, rarity: "common", description: "Basic ninja scout." },
    { id: "tc-05", name: "Ramen Dog",           element: "Water",   top: 20, right: 25, bottom: 20, left: 25, rarity: "common", description: "Weak power, good coverage." },
    { id: "tc-06", name: "Rookie Shinobi",      element: "Neutral", top: 25, right: 25, bottom: 25, left: 25, rarity: "common", description: "Balanced beginner card." },
    { id: "tc-07", name: "Wooden Shield Guard", element: "Earth",   top: 30, right: 15, bottom: 30, left: 15, rarity: "common", description: "Defensive corner card." },
    { id: "tc-08", name: "Paper Tag Mouse",     element: "Fire",    top: 20, right: 35, bottom: 35, left: 20, rarity: "common", description: "Tiny explosive card." },
    { id: "tc-09", name: "River Frog",          element: "Water",   top: 20, right: 30, bottom: 30, left: 20, rarity: "common", description: "Good corner water card." },
    { id: "tc-10", name: "Crow Lookout",        element: "Wind",    top: 35, right: 20, bottom: 20, left: 35, rarity: "common", description: "Good top-left card." },
    { id: "tc-11", name: "Rusty Blade Bandit",  element: "Neutral", top: 20, right: 45, bottom: 20, left: 20, rarity: "common", description: "Strong but only one direction." },
    { id: "tc-12", name: "Forest Beetle",       element: "Earth",   top: 20, right: 20, bottom: 30, left: 30, rarity: "common", description: "Small defensive bug card." },
    { id: "tc-13", name: "Candle Wisp",         element: "Fire",    top: 30, right: 35, bottom: 20, left: 20, rarity: "common", description: "Starter fire spirit." },
    { id: "tc-14", name: "Static Lizard",       element: "Lightning", top: 20, right: 35, bottom: 20, left: 35, rarity: "common", description: "Side-control card." },
    { id: "tc-15", name: "Pond Turtle",         element: "Water",   top: 35, right: 20, bottom: 35, left: 35, rarity: "common", description: "Low attack, high coverage." },
    { id: "tc-16", name: "Training Clone",      element: "Neutral", top: 30, right: 30, bottom: 30, left: 20, rarity: "common", description: "Good beginner combo card." },
    { id: "tc-17", name: "Small Spider",        element: "Neutral", top: 20, right: 20, bottom: 35, left: 35, rarity: "common", description: "Sneaky bottom-left card." },
    { id: "tc-18", name: "Wind Squirrel",       element: "Wind",    top: 30, right: 35, bottom: 20, left: 20, rarity: "common", description: "Quick movement card." },
    { id: "tc-19", name: "Clay Golem Head",     element: "Earth",   top: 20, right: 20, bottom: 45, left: 20, rarity: "common", description: "Strong single-direction card." },
    { id: "tc-20", name: "Village Messenger",   element: "Neutral", top: 30, right: 35, bottom: 20, left: 30, rarity: "common", description: "Flexible neutral card." },
    // Rare (20) — values 30–65
    { id: "tc-21", name: "Ashen Wolf",          element: "Earth",   top: 50, right: 55, bottom: 50, left: 35, rarity: "rare", description: "Reliable earth attacker." },
    { id: "tc-22", name: "Storm Crow",          element: "Lightning", top: 55, right: 50, bottom: 35, left: 55, rarity: "rare", description: "Great top-row control." },
    { id: "tc-23", name: "Frost Owl",           element: "Water",   top: 55, right: 35, bottom: 50, left: 55, rarity: "rare", description: "Strong side card." },
    { id: "tc-24", name: "Shadow Fox",          element: "Neutral", top: 40, right: 55, bottom: 55, left: 55, rarity: "rare", description: "Good for multi-flips." },
    { id: "tc-25", name: "Blue Fang Lynx",      element: "Lightning", top: 60, right: 65, bottom: 35, left: 40, rarity: "rare", description: "High pressure rare." },
    { id: "tc-26", name: "Forest Tanuki",       element: "Earth",   top: 50, right: 40, bottom: 55, left: 55, rarity: "rare", description: "Defensive rare pet." },
    { id: "tc-27", name: "Mist Serpent",        element: "Water",   top: 40, right: 60, bottom: 40, left: 60, rarity: "rare", description: "Strong lane card." },
    { id: "tc-28", name: "Ember Salamander",    element: "Fire",    top: 40, right: 60, bottom: 60, left: 35, rarity: "rare", description: "Good attack corner." },
    { id: "tc-29", name: "Moonshadow Cat",      element: "Neutral", top: 45, right: 45, bottom: 45, left: 45, rarity: "rare", description: "Low stats, all-direction." },
    { id: "tc-30", name: "Iron Mask Guard",     element: "Earth",   top: 65, right: 35, bottom: 65, left: 35, rarity: "rare", description: "Strong vertical defender." },
    { id: "tc-31", name: "Scroll Thief",        element: "Wind",    top: 40, right: 55, bottom: 55, left: 55, rarity: "rare", description: "Sneaky board-control card." },
    { id: "tc-32", name: "Lightning Hare",      element: "Lightning", top: 55, right: 60, bottom: 55, left: 35, rarity: "rare", description: "Fast pressure card." },
    { id: "tc-33", name: "Shrine Monk",         element: "Neutral", top: 50, right: 55, bottom: 35, left: 55, rarity: "rare", description: "Good support-style card." },
    { id: "tc-34", name: "Ice Shell Turtle",    element: "Water",   top: 60, right: 40, bottom: 40, left: 60, rarity: "rare", description: "Strong corner defender." },
    { id: "tc-35", name: "Wild Boar Bandit",    element: "Neutral", top: 40, right: 60, bottom: 60, left: 35, rarity: "rare", description: "Simple brute card." },
    { id: "tc-36", name: "Ashen Leaf Archer",   element: "Wind",    top: 55, right: 60, bottom: 55, left: 40, rarity: "rare", description: "Balanced ranged card." },
    { id: "tc-37", name: "Stormveil Raider",    element: "Lightning", top: 40, right: 65, bottom: 40, left: 60, rarity: "rare", description: "Aggressive side flipper." },
    { id: "tc-38", name: "Frostfang Pup",       element: "Water",   top: 55, right: 40, bottom: 55, left: 55, rarity: "rare", description: "Flexible rare pet." },
    { id: "tc-39", name: "Moonshadow Spy",      element: "Neutral", top: 60, right: 55, bottom: 35, left: 55, rarity: "rare", description: "Strong top control." },
    { id: "tc-40", name: "Golden Beetle",       element: "Neutral", top: 35, right: 60, bottom: 60, left: 60, rarity: "rare", description: "Strong bottom control." },
    // Epic (10) — values 50–90, can include Shadow
    { id: "tc-41", name: "Blue Blade Raccoon",  element: "Water",   top: 75, right: 75, bottom: 75, left: 75, rarity: "epic", description: "Strong all-around mascot card." },
    { id: "tc-42", name: "Inferno Cat",         element: "Fire",    top: 55, right: 90, bottom: 85, left: 50, rarity: "epic", description: "Huge power, limited left." },
    { id: "tc-43", name: "Iron Beetle King",    element: "Earth",   top: 80, right: 60, bottom: 80, left: 70, rarity: "epic", description: "Strong defensive control." },
    { id: "tc-44", name: "Phantom Spider Lady", element: "Shadow",  top: 80, right: 70, bottom: 55, left: 80, rarity: "epic", description: "Excellent top-side control." },
    { id: "tc-45", name: "Storm Serpent",       element: "Lightning", top: 80, right: 85, bottom: 75, left: 55, rarity: "epic", description: "Aggressive combo card." },
    { id: "tc-46", name: "Frostfang Dire Wolf", element: "Water",   top: 85, right: 80, bottom: 55, left: 60, rarity: "epic", description: "High power beast card." },
    { id: "tc-47", name: "Ashen Forest Guardian", element: "Earth", top: 75, right: 75, bottom: 75, left: 80, rarity: "epic", description: "Strong village defender." },
    { id: "tc-48", name: "Moonshadow Nine-Tail", element: "Shadow", top: 60, right: 80, bottom: 85, left: 80, rarity: "epic", description: "Dangerous bottom-row flipper." },
    { id: "tc-49", name: "Shrine Dragon Spirit", element: "Neutral", top: 80, right: 70, bottom: 55, left: 75, rarity: "epic", description: "Holy epic spirit card." },
    { id: "tc-50", name: "Crimson Tag Master",  element: "Fire",    top: 60, right: 55, bottom: 90, left: 80, rarity: "epic", description: "Big power, bottom-left angles." },

    // ─── Expansion: +100 cards spread across all 4 rarities ───────────────
    // Stat ranges per tier kept the same as the originals so existing balance
    // holds: common 15–45, rare 30–65, epic 50–90, legendary 65–99.
    // Elements use the full nine the engine supports (None, Fire, Water, Wind,
    // Earth, Lightning, Shadow, Ice, Neutral). Each tier rotates through them
    // for variety. Admin panel + image upload already supports all of these
    // out of the box — editing a tc-NN card creates an override that lets
    // an admin upload custom art via the Card Editor.

    // Common +20 (tc-51 to tc-70) — values 15–45
    { id: "tc-51", name: "Sapling Spirit",      element: "Earth",     top: 25, right: 25, bottom: 30, left: 25, rarity: "common", description: "Newborn forest sprite." },
    { id: "tc-52", name: "Spark Mouse",         element: "Lightning", top: 30, right: 30, bottom: 20, left: 20, rarity: "common", description: "Twitchy little jolt." },
    { id: "tc-53", name: "Tide Shrimp",         element: "Water",     top: 20, right: 30, bottom: 35, left: 25, rarity: "common", description: "Skitters with the surf." },
    { id: "tc-54", name: "Ash Sparrow",         element: "Fire",      top: 35, right: 25, bottom: 20, left: 25, rarity: "common", description: "Tiny ember scout." },
    { id: "tc-55", name: "Breeze Pixie",        element: "Wind",      top: 25, right: 30, bottom: 25, left: 30, rarity: "common", description: "Flighty wind spirit." },
    { id: "tc-56", name: "Twilight Moth",       element: "Shadow",    top: 30, right: 20, bottom: 30, left: 35, rarity: "common", description: "Drifts on dusk wings." },
    { id: "tc-57", name: "Snowflake Wisp",      element: "Ice",       top: 25, right: 25, bottom: 25, left: 35, rarity: "common", description: "Frigid mote of cold." },
    { id: "tc-58", name: "Calm Stone Pebble",   element: "Neutral",   top: 30, right: 25, bottom: 30, left: 25, rarity: "common", description: "Meditation aide." },
    { id: "tc-59", name: "Apprentice Genin",    element: "None",      top: 20, right: 30, bottom: 30, left: 30, rarity: "common", description: "Fresh out of the academy." },
    { id: "tc-60", name: "Pebble Crab",         element: "Earth",     top: 20, right: 35, bottom: 20, left: 35, rarity: "common", description: "Tough shell, tiny pinch." },
    { id: "tc-61", name: "Cinder Ant",          element: "Fire",      top: 35, right: 30, bottom: 25, left: 15, rarity: "common", description: "Burns where it bites." },
    { id: "tc-62", name: "Mist Newt",           element: "Water",     top: 25, right: 30, bottom: 30, left: 30, rarity: "common", description: "Slippery little wisp." },
    { id: "tc-63", name: "Static Beetle",       element: "Lightning", top: 30, right: 35, bottom: 20, left: 25, rarity: "common", description: "Sparks on its shell." },
    { id: "tc-64", name: "Whisper Bat",         element: "Wind",      top: 35, right: 25, bottom: 25, left: 30, rarity: "common", description: "Hears the wind whisper." },
    { id: "tc-65", name: "Hollow Imp",          element: "Shadow",    top: 25, right: 35, bottom: 35, left: 20, rarity: "common", description: "Mischievous shade." },
    { id: "tc-66", name: "Frost Mouse",         element: "Ice",       top: 30, right: 25, bottom: 25, left: 35, rarity: "common", description: "Tiny chill-skitter." },
    { id: "tc-67", name: "Zen Disciple",        element: "Neutral",   top: 30, right: 30, bottom: 30, left: 30, rarity: "common", description: "Perfectly balanced." },
    { id: "tc-68", name: "Bandit Recruit",      element: "None",      top: 35, right: 20, bottom: 35, left: 20, rarity: "common", description: "Wields a rusty kunai." },
    { id: "tc-69", name: "Clay Hatchling",      element: "Earth",     top: 25, right: 30, bottom: 35, left: 25, rarity: "common", description: "Tiny earth golem." },
    { id: "tc-70", name: "Ember Cricket",       element: "Fire",      top: 30, right: 35, bottom: 25, left: 20, rarity: "common", description: "Chirps in flame." },

    // Rare +25 (tc-71 to tc-95) — values 30–65
    { id: "tc-71", name: "Granite Stag",        element: "Earth",     top: 55, right: 45, bottom: 55, left: 45, rarity: "rare", description: "Antlers like cliff-edges." },
    { id: "tc-72", name: "Volt Hawk",           element: "Lightning", top: 60, right: 60, bottom: 35, left: 45, rarity: "rare", description: "Strikes from the storm." },
    { id: "tc-73", name: "Riverstone Eel",      element: "Water",     top: 40, right: 60, bottom: 45, left: 55, rarity: "rare", description: "Shocks the current." },
    { id: "tc-74", name: "Char-Blade Mantis",   element: "Fire",      top: 60, right: 55, bottom: 40, left: 45, rarity: "rare", description: "Glowing red scythes." },
    { id: "tc-75", name: "Cyclone Falcon",      element: "Wind",      top: 50, right: 65, bottom: 40, left: 45, rarity: "rare", description: "Folds wind into a spiral." },
    { id: "tc-76", name: "Dusk Wraith",         element: "Shadow",    top: 45, right: 50, bottom: 55, left: 60, rarity: "rare", description: "Slips through twilight." },
    { id: "tc-77", name: "Glacier Pup",         element: "Ice",       top: 55, right: 40, bottom: 55, left: 50, rarity: "rare", description: "Walks the frostpaths." },
    { id: "tc-78", name: "Sage Apprentice",     element: "Neutral",   top: 50, right: 50, bottom: 50, left: 50, rarity: "rare", description: "Master of fundamentals." },
    { id: "tc-79", name: "Veteran Ronin",       element: "None",      top: 60, right: 35, bottom: 60, left: 35, rarity: "rare", description: "Wandering blade-for-hire." },
    { id: "tc-80", name: "Mossback Boar",       element: "Earth",     top: 55, right: 50, bottom: 45, left: 50, rarity: "rare", description: "Tusks crusted with stone." },
    { id: "tc-81", name: "Thunder Spider",      element: "Lightning", top: 45, right: 55, bottom: 55, left: 60, rarity: "rare", description: "Webs hum with charge." },
    { id: "tc-82", name: "Coral Naga",          element: "Water",     top: 50, right: 60, bottom: 50, left: 40, rarity: "rare", description: "Reef-born serpent." },
    { id: "tc-83", name: "Inferno Toad",        element: "Fire",      top: 55, right: 50, bottom: 60, left: 35, rarity: "rare", description: "Croaks burning oil." },
    { id: "tc-84", name: "Gale Crane",          element: "Wind",      top: 60, right: 40, bottom: 45, left: 55, rarity: "rare", description: "Long-necked storm caller." },
    { id: "tc-85", name: "Eclipse Cat",         element: "Shadow",    top: 50, right: 55, bottom: 45, left: 55, rarity: "rare", description: "Vanishes mid-pounce." },
    { id: "tc-86", name: "Snowstorm Wolf",      element: "Ice",       top: 60, right: 45, bottom: 50, left: 50, rarity: "rare", description: "Howl freezes the breath." },
    { id: "tc-87", name: "Twin Blade Monk",     element: "Neutral",   top: 50, right: 55, bottom: 50, left: 55, rarity: "rare", description: "Dual-wielding ascetic." },
    { id: "tc-88", name: "Rogue Mercenary",     element: "None",      top: 55, right: 45, bottom: 55, left: 45, rarity: "rare", description: "Loyal only to the coin." },
    { id: "tc-89", name: "Crystal Cobra",       element: "Earth",     top: 45, right: 60, bottom: 40, left: 60, rarity: "rare", description: "Fang of pure quartz." },
    { id: "tc-90", name: "Plasma Fox",          element: "Lightning", top: 60, right: 55, bottom: 40, left: 50, rarity: "rare", description: "Tail trails arc-light." },
    { id: "tc-91", name: "Abyss Octopus",       element: "Water",     top: 45, right: 50, bottom: 55, left: 60, rarity: "rare", description: "Deep-sea ambusher." },
    { id: "tc-92", name: "Magma Bear",          element: "Fire",      top: 55, right: 60, bottom: 45, left: 45, rarity: "rare", description: "Fur smolders red." },
    { id: "tc-93", name: "Sky Glider",          element: "Wind",      top: 45, right: 55, bottom: 60, left: 45, rarity: "rare", description: "Rides the high currents." },
    { id: "tc-94", name: "Void Stalker",        element: "Shadow",    top: 55, right: 45, bottom: 50, left: 60, rarity: "rare", description: "Hunts in starless dark." },
    { id: "tc-95", name: "Blizzard Owl",        element: "Ice",       top: 50, right: 50, bottom: 60, left: 45, rarity: "rare", description: "Silent in the snowfall." },

    // Epic +25 (tc-96 to tc-120) — values 50–90
    { id: "tc-96",  name: "Stoneheart Titan",       element: "Earth",     top: 85, right: 65, bottom: 85, left: 65, rarity: "epic", description: "Living mountain warrior." },
    { id: "tc-97",  name: "Stormbreaker Drake",     element: "Lightning", top: 80, right: 85, bottom: 60, left: 60, rarity: "epic", description: "Wings split the thunder." },
    { id: "tc-98",  name: "Tidal Lord Manta",       element: "Water",     top: 70, right: 80, bottom: 65, left: 80, rarity: "epic", description: "Glides the open sea." },
    { id: "tc-99",  name: "Phoenix Warlord",        element: "Fire",      top: 85, right: 75, bottom: 55, left: 75, rarity: "epic", description: "Reborn in every battle." },
    { id: "tc-100", name: "Tempest Marshal",        element: "Wind",      top: 75, right: 80, bottom: 70, left: 65, rarity: "epic", description: "Commands the storm." },
    { id: "tc-101", name: "Nightveil Assassin",     element: "Shadow",    top: 60, right: 90, bottom: 80, left: 65, rarity: "epic", description: "One strike, one shadow." },
    { id: "tc-102", name: "Frostlord Berserker",    element: "Ice",       top: 80, right: 70, bottom: 80, left: 60, rarity: "epic", description: "Frozen rage incarnate." },
    { id: "tc-103", name: "Mountain Sage",          element: "Neutral",   top: 70, right: 75, bottom: 70, left: 75, rarity: "epic", description: "Speaks with the peak." },
    { id: "tc-104", name: "Wandering Master",       element: "None",      top: 80, right: 60, bottom: 80, left: 60, rarity: "epic", description: "No village, all ways." },
    { id: "tc-105", name: "Geode Behemoth",         element: "Earth",     top: 65, right: 80, bottom: 85, left: 65, rarity: "epic", description: "Crystal-spined leviathan." },
    { id: "tc-106", name: "Plasma Hydra",           element: "Lightning", top: 75, right: 70, bottom: 75, left: 85, rarity: "epic", description: "Each head sparks fresh bolts." },
    { id: "tc-107", name: "Krakenheart Diver",      element: "Water",     top: 85, right: 65, bottom: 75, left: 70, rarity: "epic", description: "Hunts the abyss." },
    { id: "tc-108", name: "Volcanic Reaper",        element: "Fire",      top: 60, right: 90, bottom: 70, left: 75, rarity: "epic", description: "Scythe of molten obsidian." },
    { id: "tc-109", name: "Sky Empress Roc",        element: "Wind",      top: 90, right: 65, bottom: 60, left: 75, rarity: "epic", description: "Wingspan blots out the sun." },
    { id: "tc-110", name: "Wraithlord Necromancer", element: "Shadow",    top: 80, right: 70, bottom: 70, left: 75, rarity: "epic", description: "Master of stilled souls." },
    { id: "tc-111", name: "Glacial Empress",        element: "Ice",       top: 70, right: 80, bottom: 75, left: 70, rarity: "epic", description: "Queen of the eternal frost." },
    { id: "tc-112", name: "Balance Keeper",         element: "Neutral",   top: 75, right: 75, bottom: 75, left: 75, rarity: "epic", description: "Perfectly even in all things." },
    { id: "tc-113", name: "Forgotten Champion",     element: "None",      top: 85, right: 60, bottom: 80, left: 65, rarity: "epic", description: "Hero of an unrecorded age." },
    { id: "tc-114", name: "Crystal Dragon",         element: "Earth",     top: 75, right: 75, bottom: 70, left: 80, rarity: "epic", description: "Scales of cut diamond." },
    { id: "tc-115", name: "Voltaic Knight",         element: "Lightning", top: 80, right: 75, bottom: 65, left: 75, rarity: "epic", description: "Armor crackles with charge." },
    { id: "tc-116", name: "Deep Sea Leviathan",     element: "Water",     top: 60, right: 80, bottom: 85, left: 70, rarity: "epic", description: "Risen from the trench." },
    { id: "tc-117", name: "Magma Colossus",         element: "Fire",      top: 85, right: 65, bottom: 70, left: 75, rarity: "epic", description: "Each step cracks the earth." },
    { id: "tc-118", name: "Skyflame Archer",        element: "Wind",      top: 70, right: 85, bottom: 65, left: 70, rarity: "epic", description: "Arrows ignite mid-air." },
    { id: "tc-119", name: "Phantom Reaper",         element: "Shadow",    top: 65, right: 75, bottom: 85, left: 80, rarity: "epic", description: "Soul-harvester from beyond." },
    { id: "tc-120", name: "Eternal Frostgiant",     element: "Ice",       top: 80, right: 70, bottom: 80, left: 65, rarity: "epic", description: "Carved from a million winters." },

    // Legendary +30 (tc-121 to tc-150) — values 65–99
    { id: "tc-121", name: "Worldroot Behemoth",     element: "Earth",     top: 95, right: 80, bottom: 95, left: 80, rarity: "legendary", description: "Roots reach the planet's core." },
    { id: "tc-122", name: "Stormgod Dragon",        element: "Lightning", top: 90, right: 95, bottom: 75, left: 80, rarity: "legendary", description: "Breath splits the sky." },
    { id: "tc-123", name: "Ocean Sovereign",        element: "Water",     top: 85, right: 90, bottom: 85, left: 90, rarity: "legendary", description: "King of every tide." },
    { id: "tc-124", name: "Inferno Sovereign",      element: "Fire",      top: 95, right: 85, bottom: 75, left: 85, rarity: "legendary", description: "Crowned in living flame." },
    { id: "tc-125", name: "Sky King Garuda",        element: "Wind",      top: 95, right: 90, bottom: 75, left: 80, rarity: "legendary", description: "Wings beat hurricanes." },
    { id: "tc-126", name: "Eclipse Sovereign",      element: "Shadow",    top: 80, right: 95, bottom: 90, left: 85, rarity: "legendary", description: "Eats the sun." },
    { id: "tc-127", name: "Eternal Glacier King",   element: "Ice",       top: 90, right: 80, bottom: 90, left: 90, rarity: "legendary", description: "Frozen since the first age." },
    { id: "tc-128", name: "Grand Sage of Balance",  element: "Neutral",   top: 85, right: 85, bottom: 85, left: 85, rarity: "legendary", description: "Equal in all dimensions." },
    { id: "tc-129", name: "Forgotten Hokage",       element: "None",      top: 90, right: 85, bottom: 90, left: 80, rarity: "legendary", description: "Lost name, undying skill." },
    { id: "tc-130", name: "World-Ender Titan",      element: "Earth",     top: 80, right: 95, bottom: 95, left: 75, rarity: "legendary", description: "A walking apocalypse." },
    { id: "tc-131", name: "Heaven-Shatter Drake",   element: "Lightning", top: 90, right: 85, bottom: 80, left: 95, rarity: "legendary", description: "One bolt, one mountain." },
    { id: "tc-132", name: "Abyssal Leviathan",      element: "Water",     top: 75, right: 95, bottom: 90, left: 90, rarity: "legendary", description: "Sleeps beneath the world." },
    { id: "tc-133", name: "Phoenix Emperor",        element: "Fire",      top: 85, right: 90, bottom: 85, left: 90, rarity: "legendary", description: "Eternal in rebirth." },
    { id: "tc-134", name: "Storm Empress",          element: "Wind",      top: 95, right: 80, bottom: 85, left: 90, rarity: "legendary", description: "Rules every cloud." },
    { id: "tc-135", name: "Void Devourer",          element: "Shadow",    top: 90, right: 90, bottom: 85, left: 85, rarity: "legendary", description: "Hungers for all light." },
    { id: "tc-136", name: "Frostfall Empress",      element: "Ice",       top: 95, right: 85, bottom: 80, left: 80, rarity: "legendary", description: "Snow obeys her hand." },
    { id: "tc-137", name: "Zen Master Eternal",     element: "Neutral",   top: 90, right: 90, bottom: 90, left: 90, rarity: "legendary", description: "Unchanging through all wars." },
    { id: "tc-138", name: "Legendary Wanderer",     element: "None",      top: 95, right: 75, bottom: 95, left: 75, rarity: "legendary", description: "Knows every blade and none." },
    { id: "tc-139", name: "Primordial Dragon",      element: "Earth",     top: 85, right: 90, bottom: 90, left: 95, rarity: "legendary", description: "Older than the villages." },
    { id: "tc-140", name: "Plasma God Beast",       element: "Lightning", top: 95, right: 80, bottom: 95, left: 75, rarity: "legendary", description: "Lightning made aware." },
    { id: "tc-141", name: "Tidal God Beast",        element: "Water",     top: 90, right: 95, bottom: 80, left: 85, rarity: "legendary", description: "The ocean given will." },
    { id: "tc-142", name: "Solar God Beast",        element: "Fire",      top: 99, right: 80, bottom: 80, left: 85, rarity: "legendary", description: "A fragment of the sun." },
    { id: "tc-143", name: "Tempest God Beast",      element: "Wind",      top: 85, right: 99, bottom: 80, left: 85, rarity: "legendary", description: "Living tornado spirit." },
    { id: "tc-144", name: "Shadow God Beast",       element: "Shadow",    top: 90, right: 85, bottom: 99, left: 80, rarity: "legendary", description: "Born in the eclipse." },
    { id: "tc-145", name: "Frost God Beast",        element: "Ice",       top: 85, right: 80, bottom: 95, left: 99, rarity: "legendary", description: "Heart of the polar night." },
    { id: "tc-146", name: "Equilibrium God",        element: "Neutral",   top: 88, right: 88, bottom: 88, left: 88, rarity: "legendary", description: "Perfect in every measure." },
    { id: "tc-147", name: "Final Shinobi",          element: "None",      top: 99, right: 70, bottom: 99, left: 70, rarity: "legendary", description: "Last living blade of legend." },
    { id: "tc-148", name: "Demon-King Slayer",      element: "Shadow",    top: 99, right: 99, bottom: 65, left: 70, rarity: "legendary", description: "The blade that ended the demon king." },
    { id: "tc-149", name: "Cosmic Phoenix",         element: "Fire",      top: 75, right: 99, bottom: 99, left: 70, rarity: "legendary", description: "Soars between stars." },
    { id: "tc-150", name: "World-Eater Naga",       element: "Water",     top: 70, right: 75, bottom: 99, left: 99, rarity: "legendary", description: "Coils swallow continents." },
];

export function getAllTileCards(creatorCards: TileCard[]): TileCard[] {
    return [...creatorCards, ...shinobiTileCards.filter((s) => !creatorCards.some((c) => c.id === s.id))];
}
