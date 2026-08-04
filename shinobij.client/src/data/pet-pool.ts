/*
 * rawPetPool — the canonical template list for all 145 built-in pets
 * (original 70 + a 70-pet expansion appended to the same generators, so the
 * second batch shares the identical kit/stat treatment):
 *   50 standard (level 1 generic kit)
 *   50 rare     (damage + utility)
 *   30 legendary (buff + damage + utility)
 *   15 mythic    (full hand-crafted 5-jutsu kits with element; five breeding-only candidates)
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

/*
 * One line of field-note flavor per wild species, keyed by template name and
 * stamped onto every template at the bottom of this file. Renders wherever
 * `pet.description` shows (Pet Yard detail panel, admin Pet Editor) and is
 * backfilled onto already-owned pets by normalizePetTemplate. Cosmetic only.
 *
 * Voice contract (docs/world-cohesion.md + docs/sector-wanderers-content.md):
 * concrete, dry, human — a thing someone saw or said, not a riddle. A handful
 * of lines nod at the canon that coliseum-proven beasts get printed into
 * Chronicle cards.
 */
const wildPetFlavor: Record<string, string> = {
    // ── Standard ──
    "Red Fox": "Steals the bait, skips the snare, and watches you reset it. Trackers swear it keeps count.",
    "Snow Rabbit": "White on white until it moves. Mountain scouts follow its prints to find the safe crossings.",
    "Black Cat": "No one in the village owns it. It has never once gone hungry.",
    "Forest Hawk": "Works the canopy line at dawn. Falconers say it picks its shinobi, not the other way around.",
    "River Otter": "Works the flood pools in pairs and shares the catch. Will trade a fish for anything that glints.",
    "Stone Turtle": "Older than the fence it suns on. Takes a hit like a wall and forgets it by noon.",
    "Desert Lizard": "Sleeps under hot rock and moves only when it matters. Sand caravans step around it, not over.",
    "Ashen Crow": "Roosts in burn scars while they're still warm. Steals anything it can lift, and some things it can't.",
    "Blue Frog": "Bright as a warning sign, and it is one. Handled wrong, it numbs a grown arm for a day.",
    "Wild Boar": "Goes through what it can't go around. Fence posts included.",
    "Pine Owl": "Doesn't make a sound in the air. Night patrols skip any stretch of woods it won't roost in.",
    "Sand Snake": "Swims the dune face just under the surface. You see the ripple, then you don't.",
    "Mist Ferret": "Slips through fog banks and locked pantries alike. Ask any riverside innkeeper.",
    "Iron Beetle": "Its shell turns a kunai edge. Smiths keep one in the forge out of professional respect.",
    "White Crane": "Stands in the shallows for an hour and moves once. It rarely needs twice.",
    "Cinder Rat": "Nests in forge ash while the coals still tick. The smiths' apprentices name every one.",
    "Meadow Deer": "First to freeze when something's wrong in the grass. Scouts trust it over each other.",
    "Storm Gull": "Rides the front edge of bad weather. Harbor crews haul nets when it lands.",
    "Shadow Bat": "Maps a cave by ear in one pass. Miners follow it out when the lamps die.",
    "Mud Toad": "Sits in the paddy muck all season. One croak before rain, two before worse.",
    "Leaf Monkey": "Works in threes: one begs, one distracts, one empties your pack.",
    "Frost Cub": "A winter cub with paws it hasn't grown into. Already shrugs off cold that drops grown men.",
    "Temple Gecko": "Lives behind the shrine lanterns and eats what the incense draws. The monks count it as staff.",
    "Rock Badger": "Digs through packed clay like loose snow. Its old dens double as ambush pits.",
    "Tiny Wolf": "Runt of the litter, first to the kill. The rest of the pack follows it anyway.",
    "Flint Jackal": "Cracks marrow bones on the flint outcrops. You hear dinner from a ridge away.",
    "Ember Mole": "Tunnels the warm ground near the vents. Farmers borrow one to thaw the seed rows early.",
    "Cinder Moth": "Drawn to campfires, never burned by them. Old hands read the swarm for wind shifts.",
    "Scorch Skink": "Suns itself on cooling lava crust. Its tail heat will light kindling in a pinch.",
    "Magma Pup": "Whelped near the vents. Chews slag the way other pups chew boots.",
    "Brook Newt": "Lives under one particular stone in one particular stream, and defends both.",
    "Pebble Crab": "Indistinguishable from the riverbed until your toe finds out.",
    "Tide Minnow": "The school flashes silver a heartbeat before the wave lands. Divers time their breath by it.",
    "Reed Heron": "Stands in the reeds like it's paid to. One strike, one frog.",
    "Marsh Eel": "Moves through flooded grass without bending a blade. Trap-fishers count their catch twice.",
    "Breeze Finch": "Nests in wind chimes and prayer flags. Sings whichever way the weather is turning.",
    "Dust Swift": "Skims the dry flats faster than a courier hawk. The couriers are still sore about it.",
    "Cliff Swallow": "Builds mud nests on sheer rock over a killing drop. The rent up there is cheap.",
    "Kite Magpie": "Has stolen coins, buttons, and one chunin's forehead protector. It keeps a collection.",
    "Glide Sparrow": "Crosses ravines on locked wings. The landing is negotiable.",
    "Spark Shrew": "Its fur crackles in dry weather. Handlers learn to wear leather.",
    "Bolt Mouse": "You don't see it move. You see where it was, and the singe mark.",
    "Arc Vole": "Its burrows follow old lightning strikes. Diggers find the tunnels fused to glass.",
    "Storm Shrike": "Pins its catch on lightning-split branches. Tidy, in an unsettling way.",
    "Zap Quail": "Startles into a flash of static. A whole covey goes off like a signal flare.",
    "Clay Tortoise": "Suns itself by the kiln yards until its shell rings like fired pottery.",
    "Moss Hedgehog": "Wears a living coat of moss. In the rains, it flowers.",
    "Dune Armadillo": "Rolls up tight and lets the sandstorm do the traveling.",
    "Gravel Pangolin": "Scaled like river stones. Curls up mid-path and gets mistaken for a cairn.",
    "Loam Marmot": "One whistle from its burrow and the whole hillside goes quiet.",
    // ── Rare ──
    "Crimson Fox": "Fur like a dropped ember. Trappers set double lines for it and still come home empty.",
    "Frost Hare": "Outruns the avalanche it started. Snow scouts trace its line down the safe face.",
    "Night Panther": "You hear the second step, never the first. Caravan guards double the watch for it.",
    "Sky Falcon": "Stoops from above the cloud deck. Message hawks fly wide around its ridge.",
    "Tide Otter": "Works the surf line like it's paid by the shell. The pearl divers count it as crew.",
    "Ironback Turtle": "Took a loaded wagon wheel across the shell once. The wagon lost.",
    "Dune Viper": "Strikes from under a handspan of sand. Caravans stake their lines wide of any ripple.",
    "Ashwing Raven": "Turns up a day ahead of the smoke. Fire wardens trust it enough to start packing.",
    "Azure Toad": "Deep blue and dead calm. Apothecaries pay well for the sweat off its back.",
    "Bristle Boar": "Quills punch through a training post. It sheds them like thrown senbon when it charges.",
    "Silver Owl": "Hunts the snowfields by moonlight. Old scouts say if it lands on your gate, take the watch seriously.",
    "Glass Serpent": "Near invisible at rest. Most bites get filed under 'stepped on it.'",
    "Mist Lynx": "Hunts in fog thick enough to lose your own hands in. Nothing about that fight is fair.",
    "Steel Beetle": "Its shed plates go straight to the smiths for lamellar. There's a finder's fee.",
    "Pearl Crane": "Feathers with an oyster-shell sheen. Coast shrines call one on the roof a good season.",
    "Cinder Weasel": "Sleeps in the forge stacks and comes out trailing sparks. Two smithy fires this year. Allegedly.",
    "Thorn Stag": "The antlers grow back barbed every spring. It hones them on ironwood.",
    "Stormfin Gull": "Fishes in weather that sinks boats. Harbormasters watch where it dares to dive.",
    "Duskwings Bat": "A wingspan like a cloak thrown over the lamplight. Night couriers log it as a hazard.",
    "Mossback Toad": "Old enough that a garden grows on its back. It remembers ponds that dried up.",
    "Bamboo Ape": "Fights with a cut stave and holds the high ground. The woodcutters just leave it the grove.",
    "Frostbite Cub": "From the black-ice country. Its breath rimes steel, so the kennel masters feed it outside.",
    "Shrine Salamander": "Most winter mornings the monks find it curled in the lit brazier, unburnt.",
    "Granite Badger": "Digs setts through quarry fill. The crews just work around the holes now.",
    "Young Direwolf": "A yearling off a direwolf litter. The village kennels won't board it twice.",
    "Magma Hyena": "Its laugh carries across the vent fields. Prospectors pack up when they hear it twice.",
    "Ember Ocelot": "Coat patterned like banked coals. Whole camps have stared straight at it and seen only the fire.",
    "Pyre Kestrel": "Hovers over the fire line hunting whatever runs. The burn crews call it the foreman.",
    "Scoria Mongoose": "Kills vent-adders on their own rock. The miners leave it eggs. Cheap insurance.",
    "Blaze Caracal": "Won three coliseum seasons before anyone knew it was wild. The scribes had to reprint its card.",
    "Tidal Mink": "Raids the fish traps on the ebb, gone by the flood. The weir keepers respect the schedule.",
    "Frost Seal": "Hauls out on ice that won't hold a man. Then watches you work that out.",
    "Coral Serval": "Stalks the reef pools at low tide, patterned like the coral it robs.",
    "Brine Cormorant": "Dives deeper than the pearl crews and surfaces first. They've stopped racing it.",
    "Glacier Marten": "Dens in crevasse ice and hunts the tunnels under the glacier. Rope teams follow its bolt-holes.",
    "Cyclone Harrier": "Circles the eye of a storm cell. The weather watchers chart the bird, not the sky.",
    "Zephyr Osprey": "Fishes on the offshore wind and never wets more than its talons.",
    "Gust Tern": "Threads gusts that ground every other wing. The lighthouse keepers keep tallies.",
    "Squall Plover": "Somehow always nests above where the flood will reach. Fishermen check where it lays, then the sky.",
    "Drift Albatross": "Crosses open water on a wingbeat an hour. Sailors write the sighting into the ship's log.",
    "Volt Polecat": "Static snaps off its fur in dry wind. The granary cats moved out.",
    "Surge Stoat": "Winter coat goes white with a blue crackle. Kills above its weight and drags it home uphill.",
    "Thunder Jerboa": "Jumps between strikes out on the flats. Locals swear the lightning misses on purpose.",
    "Static Meerkat": "The sentry's fur lifts before the storm clears the dunes. The colony digs in early. So do the caravans.",
    "Arc Buzzard": "Circles storm wrecks the way its cousins circle carrion. Salvage crews follow it out.",
    "Granite Wombat": "Plugs its burrow with a stone cut to fit. Masons have checked the fit. It's good.",
    "Stoneback Tapir": "The hide sets harder with age. Old ones scratch themselves on standing stones and win.",
    "Quartz Aardvark": "Digs out nests behind the quartz seams. Prospectors trail it with pans.",
    "Terra Porcupine": "Quills like flaked flint. It stamps a ring of them loose; trackers harvest the circles.",
    "Bramble Capybara": "Sits in thorn brakes nothing else can enter, calm as a fed monk.",
    // ── Legendary ──
    "Glacier Wolf": "Runs the high ice alone. Herders find its prints circling the camp — never inside.",
    "Tempest Hawk": "Rides the drafts ahead of the lightning. Falconers retired the lure — nothing brings it down but weather.",
    "Umbra Fox": "Steps out of one shadow and into another a field away. Kennel masters won't say its name twice after dark.",
    "Spirit Deer": "Crosses battlefields untouched. Both sides hold fire without agreeing to.",
    "Ironfang Tiger": "Bit through a cart axle to reach the salted fish. The axle hangs behind a tavern bar now.",
    "Azure Kirin": "Seen once a generation, always before a good harvest. The shrine keepers fill its bowl anyway.",
    "Ember Phoenix": "Every few winters the caldera goes cold and word spreads that it's dead. Come spring, it never is.",
    "Moon Serpent": "Surfaces in still water on full-moon nights. Ferrymen pole around the wake and don't discuss it.",
    "Storm Lion": "Its roar carries thunder one valley over. The herds move a day before it does.",
    "Crystal Bear": "Hide grown through with quartz. Blades skate off it; trappers stopped billing for lost gear.",
    "Void Raven": "Casts no reflection in shrine mirrors. It keeps landing where history's about to happen, so the scribes follow it.",
    "Thunder Drake": "Roosts where lightning strikes twice. The glassed sand under its ridge lies knee-deep.",
    "Frost Lynx": "Hunts inside the white-out where no tracker follows. What it leaves, the cold finishes.",
    "Armored Polar Bear": "Plated in old blue ice. One held a coliseum gate alone; the scribes printed its card that season.",
    "Ancient Crane": "Was old when the village walls went up. Still nests on the roof beam its card was inked from.",
    "Inferno Chimera": "Three tempers, one body, no safe angle. The hunt logs end mid-sentence.",
    "Ash Garuda": "Its wings shed cinders for miles. Watchtowers report it as a moving dusk.",
    "Magma Behemoth": "Wades the caldera like a paddy field. The new roads bend around its walking line.",
    "Tidelord Leviathan": "The old charts mark its feeding grounds with an anchor and the word DON'T.",
    "Frost Wyrm": "Tunnels the glacier into blue-lit halls. Ice cutters harvest the walls and leave before dark.",
    "Abyss Kraken": "Deep crews tell of arms thicker than masts. Some crews never got the chance to tell anyone.",
    "Storm Roc": "Lifts livestock through a gale. The herders file it under storm damage and everyone lets them.",
    "Tempest Pegasus": "Runs the cloud banks like open steppe. Cavalry masters have offered fortunes for one. Nobody's ever collected.",
    "Cyclone Sphinx": "Waits in the eye of the storm and asks nothing. Somehow that's worse.",
    "Thunder Raiju": "Falls with the bolt and lopes off through the burn. The fields it crosses come up green early.",
    "Storm Wyvern": "Its dive whistles a note the hill kids copy all summer. The herds never learn it in time.",
    "Galvanic Manticore": "Throws tail spikes trailing arc-light. The bounty board reposts it every season. Nobody collects.",
    "Titan Golem": "Stood still long enough for a shrine to go up on its shoulder. It walks carefully now.",
    "Granite Gargoyle": "Counts as architecture until dusk. Masons check their rooflines by daylight.",
    "Verdant Treant": "A grove that walks. The loggers mark where it stood and cut anywhere else.",
    // ── Mythic ──
    "Eclipse Kitsune": "Shrine ledgers list nine chosen companions in nine hundred years. The scribes keep its card inked and waiting.",
    "Worldstorm Dragon": "Old sailors swear every great storm is the same storm, coming back. They're right, and it has a name.",
    "Ancient Frost Titan": "The mountain shrines were built to calm something under the ice. It got up anyway. It just wasn't angry.",
    "Solar Stag": "Crests the ridge at first light with antlers too bright to look at straight. Dawn patrols set their watch by it.",
    "Abyssal Oni Hound": "Slipped its chain when the Gate first cracked, the story goes. Nobody ever found the other end of the chain.",
    "Vermillion Suzaku": "The south wind's firebird. A molted feather won't cool — the coliseum keeps one burning as its eternal flame.",
    "Azure Ryujin": "Coast folk call every wreck its tribute. They pay theirs in rice wine and get better weather for it. Most years.",
    "Turtle Duck": "Waddles like a joke until the wind picks up. The mountain tengu deny teaching it anything, which settles it.",
    "Stormgod Raijin": "Festival drummers copy its thunder, hoping the real thing takes the compliment and passes by. Some years it does.",
    "Worldroot Colossus": "Moves once a season, and the valleys adjust. Mapmakers gave up and started dating their maps instead.",
};

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
    // Breeding-only mythic candidates. They are intentionally not wild
    // encounter species, but remain valid breedable alternatives so each
    // same-element mythic pair has a non-parent candidate in the 9% branch.
    {
        id: "mythic-10",
        name: "Ash Crown Phoenix",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1120,
        attack: 150,
        defense: 92,
        speed: 118,
        unlockedForPve: false,
        element: "Fire",
        wildSpawnable: false,
        description: "A cinder-crowned heir that only appears when two fire myths have exhausted every ordinary omen.",
        jutsus: [
            { name: "Ash Crown Aura", power: 28, cooldown: 3, currentCooldown: 0, kind: "buff" },
            { name: "Crownfire Talon", power: 190, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Phoenix Ashfall", power: 275, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Ember Rebirth", power: 115, cooldown: 5, currentCooldown: 0, kind: "heal" },
            { name: "Cinder Wing", power: 0, cooldown: 3, currentCooldown: 0, kind: "move" },
        ],
    },
    {
        id: "mythic-11",
        name: "Moonwell Leviathan",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1240,
        attack: 132,
        defense: 126,
        speed: 88,
        unlockedForPve: false,
        element: "Water",
        wildSpawnable: false,
        description: "A moon-fed leviathan whose first tide is said to rise from a sealed breeding pool.",
        jutsus: [
            { name: "Moonwell Aura", power: 28, cooldown: 3, currentCooldown: 0, kind: "buff" },
            { name: "Tidal Coil", power: 185, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Leviathan Deluge", power: 270, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Moonwell Barrier", power: 135, cooldown: 5, currentCooldown: 0, kind: "barrier" },
            { name: "Undertow Slide", power: 0, cooldown: 3, currentCooldown: 0, kind: "move" },
        ],
    },
    {
        id: "mythic-12",
        name: "Skyglass Kirin",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1010,
        attack: 142,
        defense: 94,
        speed: 138,
        unlockedForPve: false,
        element: "Wind",
        wildSpawnable: false,
        description: "A glass-hoofed kirin glimpsed between two gusts, never on a wild trail.",
        jutsus: [
            { name: "Skyglass Focus", power: 28, cooldown: 3, currentCooldown: 0, kind: "buff" },
            { name: "Kirin Gale", power: 180, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Skyglass Tempest", power: 268, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Horizon Mirage", power: 105, cooldown: 4, currentCooldown: 0, kind: "debuff" },
            { name: "Cloudstep", power: 0, cooldown: 3, currentCooldown: 0, kind: "move" },
        ],
    },
    {
        id: "mythic-13",
        name: "Thunderbloom Kirin",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1060,
        attack: 158,
        defense: 88,
        speed: 116,
        unlockedForPve: false,
        element: "Lightning",
        wildSpawnable: false,
        description: "A thunderbloom that flowers only in the charged space between two lightning myths.",
        jutsus: [
            { name: "Thunderbloom Aura", power: 26, cooldown: 3, currentCooldown: 0, kind: "buff" },
            { name: "Blooming Bolt", power: 200, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Stormgarden Judgment", power: 290, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Static Thorn", power: 112, cooldown: 5, currentCooldown: 0, kind: "dot" },
            { name: "Flash Bloom", power: 0, cooldown: 3, currentCooldown: 0, kind: "move" },
        ],
    },
    {
        id: "mythic-14",
        name: "Gravepeak Behemoth",
        rarity: "mythic",
        level: 1,
        xp: 0,
        maxLevel: 100,
        hp: 1330,
        attack: 126,
        defense: 150,
        speed: 62,
        unlockedForPve: false,
        element: "Earth",
        wildSpawnable: false,
        description: "A gravepeak behemoth bred from stone-deep echoes rather than found in the wild.",
        jutsus: [
            { name: "Gravepeak Aura", power: 30, cooldown: 3, currentCooldown: 0, kind: "buff" },
            { name: "Basalt Fist", power: 176, cooldown: 2, currentCooldown: 0, kind: "damage" },
            { name: "Mountainwake", power: 258, cooldown: 4, currentCooldown: 0, kind: "damage" },
            { name: "Deepstone Regen", power: 118, cooldown: 5, currentCooldown: 0, kind: "heal" },
            { name: "Faultstep", power: 0, cooldown: 3, currentCooldown: 0, kind: "move" },
        ],
    },
] as Pet[]).map((pet) => ({
    // Stamp the species flavor line onto every template (an inline
    // description, if a template ever declares one, wins).
    ...pet,
    description: pet.description ?? wildPetFlavor[pet.name],
}));
