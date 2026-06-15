/*
 * rawPetPool — the canonical template list for all 140 built-in pets
 * (original 70 + a 70-pet expansion appended to the same generators, so the
 * second batch shares the identical kit/stat treatment):
 *   50 standard (level 1 generic kit)
 *   50 rare     (damage + utility)
 *   30 legendary (buff + damage + utility)
 *   10 mythic    (full hand-crafted 5-jutsu kits with element)
 *
 * The expansion pets keep numbering past the original count (standard-25…,
 * rare-25…, legendary-15…, mythic-5…). balanceBuiltInPetTemplate wraps the
 * id-derived variant within the per-tier count so a higher id never inflates
 * stats — the second batch reuses the same 0..N-1 spread as the first.
 *
 * Pure data. The balanceBuiltInPetTemplate transform that scales each
 * template against balancedPetBaseStats / petStatCaps / petElementByName
 * lives in App.tsx and is applied AFTER this raw list — see App.tsx
 * for the `petPool = rawPetPool.map(balanceBuiltInPetTemplate)` step.
 *
 * Extracted from App.tsx as part of the data-table extraction pass.
 */

import type { Pet } from "../types/pet";

export const rawPetPool: Pet[] = ([
    // STANDARD PETS — damage + move. Simple kit, mobile enough to close the gap.
    ...[
        "Red Fox", "Snow Rabbit", "Black Cat", "Forest Hawk", "River Otter",
        "Stone Turtle", "Desert Lizard", "Ashen Crow", "Blue Frog", "Wild Boar",
        "Pine Owl", "Sand Snake", "Mist Ferret", "Iron Beetle", "White Crane",
        "Cinder Rat", "Meadow Deer", "Storm Gull", "Shadow Bat", "Mud Toad",
        "Leaf Monkey", "Frost Cub", "Temple Gecko", "Rock Badger", "Tiny Wolf",
        // ── Expansion (standard-25…standard-49) ──
        "Flint Jackal", "Ember Mole", "Cinder Moth", "Scorch Skink", "Magma Pup",
        "Brook Newt", "Pebble Crab", "Tide Minnow", "Reed Heron", "Marsh Eel",
        "Breeze Finch", "Dust Swift", "Cliff Swallow", "Kite Magpie", "Glide Sparrow",
        "Spark Shrew", "Bolt Mouse", "Arc Vole", "Storm Shrike", "Zap Quail",
        "Clay Tortoise", "Moss Hedgehog", "Dune Armadillo", "Gravel Pangolin", "Loam Marmot"
    ].map((name, index): Pet => ({
        id: `standard-${index}`,
        name,
        rarity: "standard",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 150 + index * 4,
        attack: 18 + index,
        defense: 12 + index,
        speed: 10 + index,
        unlockedForPve: false,
        jutsus: [
            { name: `${name} Strike`, power: 35 + index, cooldown: 3, currentCooldown: 0, kind: "damage" as const },
            index % 3 === 0
                ? { name: `${name} Guard`, power: 28 + index, cooldown: 5, currentCooldown: 0, kind: "barrier"  as const }
                : index % 3 === 1
                    ? { name: `${name} Bind`,  power: 0,          cooldown: 5, currentCooldown: 0, kind: "movelock" as const }
                    : { name: `${name} Mend`,  power: 26 + index, cooldown: 5, currentCooldown: 0, kind: "heal"    as const },
            { name: `${name} Dash`,   power: 0,           cooldown: 4, currentCooldown: 0, kind: "move"   as const },
        ],
    })),

    // RARE PETS — damage + utility (heal/buff/debuff) + move.
    ...[
        "Crimson Fox", "Frost Hare", "Night Panther", "Sky Falcon", "Tide Otter",
        "Ironback Turtle", "Dune Viper", "Ashwing Raven", "Azure Toad", "Bristle Boar",
        "Silver Owl", "Glass Serpent", "Mist Lynx", "Steel Beetle", "Pearl Crane",
        "Cinder Weasel", "Thorn Stag", "Stormfin Gull", "Duskwings Bat", "Mossback Toad",
        "Bamboo Ape", "Frostbite Cub", "Shrine Salamander", "Granite Badger", "Young Direwolf",
        // ── Expansion (rare-25…rare-49) ──
        "Magma Hyena", "Ember Ocelot", "Pyre Kestrel", "Scoria Mongoose", "Blaze Caracal",
        "Tidal Mink", "Frost Seal", "Coral Serval", "Brine Cormorant", "Glacier Marten",
        "Cyclone Harrier", "Zephyr Osprey", "Gust Tern", "Squall Plover", "Drift Albatross",
        "Volt Polecat", "Surge Stoat", "Thunder Jerboa", "Static Meerkat", "Arc Buzzard",
        "Granite Wombat", "Stoneback Tapir", "Quartz Aardvark", "Terra Porcupine", "Bramble Capybara"
    ].map((name, index): Pet => ({
        id: `rare-${index}`,
        name,
        rarity: "rare",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 275 + index * 7,
        attack: 34 + index,
        defense: 24 + index,
        speed: 20 + index,
        unlockedForPve: false,
        jutsus: [
            { name: `${name} Strike`,   power: 55 + index, cooldown: 2, currentCooldown: 0, kind: "damage" as const },
            index % 3 === 0
                ? { name: `${name} Mend`,     power: 55 + index, cooldown: 4, currentCooldown: 0, kind: "heal"   as const }
                : index % 3 === 1
                    ? { name: `${name} Instinct`, power: 10,         cooldown: 4, currentCooldown: 0, kind: "buff"   as const }
                    : { name: `${name} Weaken`,   power: 42 + index, cooldown: 4, currentCooldown: 0, kind: "debuff" as const },
            index % 2 === 0
                ? { name: `${name} Ward`,       power: 50 + index, cooldown: 5, currentCooldown: 0, kind: "barrier"  as const }
                : { name: `${name} Trap Vines`, power: 0,          cooldown: 5, currentCooldown: 0, kind: "movelock" as const },
            { name: `${name} Rush`,     power: 0,           cooldown: 4, currentCooldown: 0, kind: "move"   as const },
        ],
    })),

    // LEGENDARY PETS — buff + damage + utility (heal/debuff/dot) + move.
    // Legendary dash cooldown is faster (CD3) — they're quicker to engage.
    ...[
        "Glacier Wolf", "Tempest Hawk", "Umbra Fox", "Spirit Deer", "Ironfang Tiger",
        "Azure Kirin", "Ember Phoenix", "Moon Serpent", "Storm Lion", "Crystal Bear",
        "Void Raven", "Thunder Drake", "Frost Lynx", "Armored Polar Bear", "Ancient Crane",
        // ── Expansion (legendary-15…legendary-29) ──
        "Inferno Chimera", "Ash Garuda", "Magma Behemoth",
        "Tidelord Leviathan", "Frost Wyrm", "Abyss Kraken",
        "Storm Roc", "Tempest Pegasus", "Cyclone Sphinx",
        "Thunder Raiju", "Storm Wyvern", "Galvanic Manticore",
        "Titan Golem", "Granite Gargoyle", "Verdant Treant"
    ].map((name, index): Pet => ({
        id: `legendary-${index}`,
        name,
        rarity: "legendary",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 450 + index * 12,
        attack: 55 + index * 2,
        defense: 42 + index * 2,
        speed: 35 + index,
        unlockedForPve: false,
        jutsus: [
            { name: `${name} Battle Cry`, power: 12,              cooldown: 3, currentCooldown: 0, kind: "buff"   as const },
            { name: `${name} Fang Art`,   power: 90 + index * 2,  cooldown: 3, currentCooldown: 0, kind: "damage" as const },
            index % 5 === 0
                ? { name: `${name} Life Pulse`,    power: 80 + index * 2, cooldown: 5, currentCooldown: 0, kind: "heal"     as const }
                : index % 5 === 1
                    ? { name: `${name} Curse Mark`,  power: 60 + index * 2, cooldown: 5, currentCooldown: 0, kind: "debuff"   as const }
                    : index % 5 === 2
                        ? { name: `${name} Venom Seal`,  power: 60 + index * 2, cooldown: 5, currentCooldown: 0, kind: "dot"      as const }
                        : index % 5 === 3
                            ? { name: `${name} Spirit Wall`, power: 70 + index * 2, cooldown: 5, currentCooldown: 0, kind: "barrier"  as const }
                            : { name: `${name} Root Bind`,   power: 0,              cooldown: 5, currentCooldown: 0, kind: "movelock" as const },
            { name: `${name} Lunge`,      power: 0,               cooldown: 3, currentCooldown: 0, kind: "move"   as const },
        ],
    })),

    // MYTHIC PETS — full 5-jutsu kits. Each has a unique identity.
    {
        id: "mythic-0",
        name: "Eclipse Kitsune",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1000,
        attack: 130,
        defense: 95,
        speed: 115,
        unlockedForPve: false,
        element: "Wind",
        // Identity: moon-SAGE — shields and heals its ally, wards off damage, keeps a
        // single swift fang for offense, fastest dash. (Sage role: low attack, support kit.)
        jutsus: [
            { name: "Nine Shadow Blessing", power: 25,  cooldown: 3, currentCooldown: 0, kind: "buff"    },
            { name: "Eclipse Fang",         power: 180, cooldown: 3, currentCooldown: 0, kind: "damage"  },
            { name: "Lunar Aegis",          power: 220, cooldown: 4, currentCooldown: 0, kind: "barrier" },
            { name: "Moonlit Restoration",  power: 95,  cooldown: 5, currentCooldown: 0, kind: "heal"    },
            { name: "Spirit Ward",          power: 150, cooldown: 4, currentCooldown: 0, kind: "absorb"  },
            { name: "Phantom Phase",        power: 0,   cooldown: 3, currentCooldown: 0, kind: "move"     },
        ],
    },
    {
        id: "mythic-1",
        name: "Worldstorm Dragon",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1100,
        attack: 150,
        defense: 90,
        speed: 100,
        unlockedForPve: false,
        element: "Lightning",
        // Identity: storm striker — fast heavy attacks, poison pressure, storm lunge
        jutsus: [
            { name: "Storm King Aura",    power: 22,  cooldown: 3, currentCooldown: 0, kind: "buff"    },
            { name: "Thunder Maw",        power: 200, cooldown: 2, currentCooldown: 0, kind: "damage"  },
            { name: "Sky Rupture Beam",   power: 290, cooldown: 4, currentCooldown: 0, kind: "damage"  },
            { name: "Storm Aegis",        power: 130, cooldown: 5, currentCooldown: 0, kind: "barrier" },
            { name: "Thunderstorm Venom", power: 110, cooldown: 5, currentCooldown: 0, kind: "dot"    },
            { name: "Stormrider Lunge",   power: 0,   cooldown: 3, currentCooldown: 0, kind: "move"   },
        ],
    },
    {
        id: "mythic-2",
        name: "Ancient Frost Titan",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1250,
        attack: 120,
        defense: 140,
        speed: 70,
        unlockedForPve: false,
        element: "Water",
        // Identity: immovable fortress — massive sustain, debuffs opponent, slowest dash (tank)
        jutsus: [
            { name: "Absolute Zero Guard",  power: 30,  cooldown: 3, currentCooldown: 0, kind: "buff"   },
            { name: "Glacier Crush",        power: 175, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Frozen World Slam",    power: 250, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Glacial Regeneration", power: 105, cooldown: 5, currentCooldown: 0, kind: "heal"   },
            { name: "Permafrost Slide",     power: 0,   cooldown: 4, currentCooldown: 0, kind: "move"   },
        ],
    },
    {
        id: "mythic-3",
        name: "Solar Stag",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 950,
        attack: 115,
        defense: 100,
        speed: 140,
        unlockedForPve: false,
        element: "Fire",
        // Identity: debuffer — strips enemy defense then punishes with heavy hits; fastest base speed
        jutsus: [
            { name: "Solar Spirit Blessing", power: 35,  cooldown: 3, currentCooldown: 0, kind: "buff"   },
            { name: "Radiant Horn",          power: 165, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Sunfall Judgment",      power: 245, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Blinding Flash",        power: 100, cooldown: 4, currentCooldown: 0, kind: "debuff" },
            { name: "Solar Gallop",          power: 0,   cooldown: 3, currentCooldown: 0, kind: "move"   },
        ],
    },
    {
        id: "mythic-4",
        name: "Abyssal Oni Hound",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1050,
        attack: 170,
        defense: 85,
        speed: 95,
        unlockedForPve: false,
        element: "Earth",
        // Identity: glass cannon brawler — highest attack, fast strikes, venom, no heal (all-in)
        jutsus: [
            { name: "Oni Rage Howl",       power: 28,  cooldown: 3, currentCooldown: 0, kind: "buff"   },
            { name: "Abyss Bite",          power: 210, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Hellhound Execution", power: 310, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Hellfire Corruption", power: 120, cooldown: 5, currentCooldown: 0, kind: "dot"    },
            { name: "Demon Surge",         power: 0,   cooldown: 3, currentCooldown: 0, kind: "move"   },
        ],
    },

    // ── MYTHIC EXPANSION (mythic-5…mythic-9) ── one per element, each with a
    // unique flagship signature move (see mythicSignatureByName in pet-balance).
    {
        id: "mythic-5",
        name: "Vermillion Suzaku",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1050,
        attack: 135,
        defense: 100,
        speed: 120,
        unlockedForPve: false,
        element: "Fire",
        // Identity: reborn phoenix — heavy fire damage backed by strong self-heal
        jutsus: [
            { name: "Vermillion Blessing", power: 30,  cooldown: 3, currentCooldown: 0, kind: "buff"   },
            { name: "Searing Talon",       power: 175, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Phoenix Firestorm",   power: 260, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Rebirth Flame",       power: 120, cooldown: 5, currentCooldown: 0, kind: "heal"   },
            { name: "Flame Glide",         power: 0,   cooldown: 3, currentCooldown: 0, kind: "move"   },
        ],
    },
    {
        id: "mythic-6",
        name: "Azure Ryujin",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1200,
        attack: 125,
        defense: 130,
        speed: 90,
        unlockedForPve: false,
        element: "Water",
        // Identity: sea-dragon god — bulky control bruiser with a hard barrier
        jutsus: [
            { name: "Dragon God Aura", power: 26,  cooldown: 3, currentCooldown: 0, kind: "buff"    },
            { name: "Tide Fang",       power: 180, cooldown: 2, currentCooldown: 0, kind: "damage"  },
            { name: "Tsunami Surge",   power: 255, cooldown: 4, currentCooldown: 0, kind: "damage"  },
            { name: "Abyssal Barrier", power: 130, cooldown: 5, currentCooldown: 0, kind: "barrier" },
            { name: "Current Slide",   power: 0,   cooldown: 3, currentCooldown: 0, kind: "move"    },
        ],
    },
    {
        id: "mythic-7",
        name: "Turtle Duck",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 980,
        attack: 130,
        defense: 95,
        speed: 145,
        unlockedForPve: false,
        element: "Wind",
        // Identity: trickster yokai — fastest, strips the foe then carves them up
        jutsus: [
            { name: "Tengu Focus",       power: 28,  cooldown: 3, currentCooldown: 0, kind: "buff"   },
            { name: "Gale Slash",        power: 165, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Heaven Crow Storm", power: 250, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Feather Hex",       power: 100, cooldown: 4, currentCooldown: 0, kind: "debuff" },
            { name: "Wind Leap",         power: 0,   cooldown: 3, currentCooldown: 0, kind: "move"   },
        ],
    },
    {
        id: "mythic-8",
        name: "Stormgod Raijin",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1080,
        attack: 155,
        defense: 90,
        speed: 115,
        unlockedForPve: false,
        element: "Lightning",
        // Identity: thunder god — explosive burst plus a lingering voltaic DoT
        jutsus: [
            { name: "Thunder God Aura", power: 24,  cooldown: 3, currentCooldown: 0, kind: "buff"   },
            { name: "Lightning Maw",    power: 195, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Heaven's Judgment",power: 285, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Voltaic Venom",    power: 110, cooldown: 5, currentCooldown: 0, kind: "dot"    },
            { name: "Flash Step",       power: 0,   cooldown: 3, currentCooldown: 0, kind: "move"   },
        ],
    },
    {
        id: "mythic-9",
        name: "Worldroot Colossus",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1280,
        attack: 120,
        defense: 145,
        speed: 65,
        unlockedForPve: false,
        element: "Earth",
        // Identity: immovable titan — slowest, towering bulk with steady regen
        jutsus: [
            { name: "Worldroot Aura",    power: 32,  cooldown: 3, currentCooldown: 0, kind: "buff"   },
            { name: "Boulder Fist",      power: 170, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Continental Slam",  power: 250, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Stoneheart Regen",  power: 110, cooldown: 5, currentCooldown: 0, kind: "heal"   },
            { name: "Tremor Step",       power: 0,   cooldown: 3, currentCooldown: 0, kind: "move"   },
        ],
    },
] as Pet[]);
