/*
 * Shinobi Chronicle Showdown — the card-game catalog (identity, element, rarity,
 * art) + the built-in/creator card merge helper.
 *
 * Pure data and a pure function: no dependency on App state, no imports.
 * TileCard and getAllTileCards are re-exported from App.tsx for the existing
 * "../App" import sites (components/Shop, screens/Inventory).
 *
 * Descriptions are the card's printed lore: one cool, epic line about the
 * subject itself (the Blue Blade Raccoon register). No board-strategy talk, no
 * meta references to the game — the Chronicle records the world.
 */

export type TileCard = {
    id: string; name: string; element: string;
    rarity: "common" | "rare" | "epic" | "legendary"; description: string;
    image?: string;
};

export const shinobiTileCards: TileCard[] = [
    // Common (20)
    { id: "tc-01", name: "Training Dummy",      element: "None",    rarity: "common", description: "Straw shoulders patched a hundred times, and never once seen to flinch." },
    { id: "tc-02", name: "Leaf Cat",            element: "Wind",    rarity: "common", description: "A gutter-born mouser that rides the rooftop winds faster than any messenger." },
    { id: "tc-03", name: "Stone Turtle",        element: "Earth",   rarity: "common", description: "Old enough to wear moss like armor; its shell has turned blades since before the walls went up." },
    { id: "tc-04", name: "Kunai Scout",         element: "Lightning", rarity: "common", description: "First over the wall and first back, kunai drawn before the alarm bell settles." },
    { id: "tc-05", name: "Ramen Dog",           element: "Water",   rarity: "common", description: "The noodle stall's storm-proof guardian, fiercely loyal to anyone holding a bowl." },
    { id: "tc-06", name: "Rookie Shinobi",      element: "Neutral", rarity: "common", description: "Fresh headband, borrowed blade, and more nerve than sense — every legend starts here." },
    { id: "tc-07", name: "Wooden Shield Guard", element: "Earth",   rarity: "common", description: "He holds the gate line behind a shield his grandfather carved, and he does not step back." },
    { id: "tc-08", name: "Paper Tag Mouse",     element: "Fire",    rarity: "common", description: "It scurries in with a lit seal on its back and no plans for a return trip." },
    { id: "tc-09", name: "River Frog",          element: "Water",   rarity: "common", description: "Squat king of the shallows, swallowing dragonflies and insults with equal calm." },
    { id: "tc-10", name: "Crow Lookout",        element: "Wind",    rarity: "common", description: "Nothing crosses the valley unseen while this sharp-eyed sentry keeps its post." },
    { id: "tc-11", name: "Rusty Blade Bandit",  element: "Neutral", rarity: "common", description: "His sword has seen better decades. His grip has not loosened once." },
    { id: "tc-12", name: "Forest Beetle",       element: "Earth",   rarity: "common", description: "A lacquered little tank that hauls thorn-branches ten times its own weight." },
    { id: "tc-13", name: "Candle Wisp",         element: "Fire",    rarity: "common", description: "A shrine flame that slipped its lantern and wanders looking for something to light." },
    { id: "tc-14", name: "Static Lizard",       element: "Lightning", rarity: "common", description: "Its scales crackle before a storm breaks; hunters read the weather off its back." },
    { id: "tc-15", name: "Pond Turtle",         element: "Water",   rarity: "common", description: "Slow, certain, and impossible to argue with once it has planted its feet." },
    { id: "tc-16", name: "Training Clone",      element: "Neutral", rarity: "common", description: "A perfect copy with one flaw — it fights like you did yesterday." },
    { id: "tc-17", name: "Small Spider",        element: "Neutral", rarity: "common", description: "It waits in the low dark, patient as winter, and its web is never empty long." },
    { id: "tc-18", name: "Wind Squirrel",       element: "Wind",    rarity: "common", description: "Branch to wall to windowsill — gone before the leaves it kicked loose touch ground." },
    { id: "tc-19", name: "Clay Golem Head",     element: "Earth",   rarity: "common", description: "All that remains of a war construct, still grinding its teeth on old orders." },
    { id: "tc-20", name: "Village Messenger",   element: "Neutral", rarity: "common", description: "Rain, ambush, or festival crowd — the letter arrives, sealed and on time." },
    // Rare (20)
    { id: "tc-21", name: "Ashen Wolf",          element: "Earth",   rarity: "rare", description: "Gray-coated and unhurried, it walks the burn-line where the forest died, and nothing follows it out." },
    { id: "tc-22", name: "Storm Crow",          element: "Lightning", rarity: "rare", description: "It nests in thunderheads and drops with the first bolt, beak-first and screaming." },
    { id: "tc-23", name: "Frost Owl",           element: "Water",   rarity: "rare", description: "Silent wings over frozen water — the last warmth a field mouse never feels." },
    { id: "tc-24", name: "Shadow Fox",          element: "Neutral", rarity: "rare", description: "Seven tricks in every tail-flick, and its shadow arrives a heartbeat before it does." },
    { id: "tc-25", name: "Blue Fang Lynx",      element: "Lightning", rarity: "rare", description: "Its bite leaves the taste of copper and ozone; few stay standing to describe it." },
    { id: "tc-26", name: "Forest Tanuki",       element: "Earth",   rarity: "rare", description: "A round trickster with a drum-tight belly and an uncanny gift for being elsewhere." },
    { id: "tc-27", name: "Mist Serpent",        element: "Water",   rarity: "rare", description: "It swims through fog the way rivers swim through valleys — everywhere at once." },
    { id: "tc-28", name: "Ember Salamander",    element: "Fire",    rarity: "rare", description: "Born in a kiln fire and never cooled; its footprints smolder for hours." },
    { id: "tc-29", name: "Moonshadow Cat",      element: "Neutral", rarity: "rare", description: "It steps only where the moonlight breaks, and locked doors mean nothing to it." },
    { id: "tc-30", name: "Iron Mask Guard",     element: "Earth",   rarity: "rare", description: "No one has ever seen his face. A wall does not need one." },
    { id: "tc-31", name: "Scroll Thief",        element: "Wind",    rarity: "rare", description: "Vaults, seals, sworn oaths — all of it just paper to the fastest hands in the trade." },
    { id: "tc-32", name: "Lightning Hare",      element: "Lightning", rarity: "rare", description: "Blink and it has lapped the field, its zigzag scorched into the wet grass." },
    { id: "tc-33", name: "Shrine Monk",         element: "Neutral", rarity: "rare", description: "He sweeps the same stone steps every dawn, and armies go around his mountain." },
    { id: "tc-34", name: "Ice Shell Turtle",    element: "Water",   rarity: "rare", description: "Winter built it a fortress, and it has never once opened the gates." },
    { id: "tc-35", name: "Wild Boar Bandit",    element: "Neutral", rarity: "rare", description: "Subtle as an avalanche, twice as loud, and considerably harder to stop." },
    { id: "tc-36", name: "Ashen Leaf Archer",   element: "Wind",    rarity: "rare", description: "She looses from the high branches, and the wind bends politely around her arrows." },
    { id: "tc-37", name: "Stormveil Raider",    element: "Lightning", rarity: "rare", description: "He strikes under thunder cover, timing every blow to the crack of the sky." },
    { id: "tc-38", name: "Frostfang Pup",       element: "Water",   rarity: "rare", description: "Small enough to carry, stubborn enough to bite a glacier — a dire wolf in the making." },
    { id: "tc-39", name: "Moonshadow Spy",      element: "Neutral", rarity: "rare", description: "Every court keeps one servant nobody remembers hiring. This is that one." },
    { id: "tc-40", name: "Golden Beetle",       element: "Neutral", rarity: "rare", description: "Misers have gone broke chasing it; its shell is worth a farm, and it knows." },
    // Epic (10)
    { id: "tc-41", name: "Blue Blade Raccoon",  element: "Water",   rarity: "legendary", description: "Azure-bladed champion of the rushing rivers, whose dance of steel has never met its equal." },
    { id: "tc-42", name: "Inferno Cat",         element: "Fire",    rarity: "epic", description: "House-cat sized until provoked. The last provocation burned a granary district flat." },
    { id: "tc-43", name: "Iron Beetle King",    element: "Earth",   rarity: "epic", description: "Crowned under the mountain and armored in raw ore, it bows to nothing lighter than a landslide." },
    { id: "tc-44", name: "Phantom Spider Lady", element: "Shadow",  rarity: "epic", description: "Half noble, half nightmare, she spins silk from stolen shadows and wears her rivals' secrets." },
    { id: "tc-45", name: "Storm Serpent",       element: "Lightning", rarity: "epic", description: "It threads the gap between cloud and sea, stitching the horizon shut with lightning." },
    { id: "tc-46", name: "Frostfang Dire Wolf", element: "Water",   rarity: "epic", description: "Pack-mother of the northern shelf; her howl turns breath to frost a valley away." },
    { id: "tc-47", name: "Ashen Forest Guardian", element: "Earth", rarity: "epic", description: "The burned wood grew a warden instead of new trees, and it remembers every axe." },
    { id: "tc-48", name: "Moonshadow Nine-Tail", element: "Shadow", rarity: "epic", description: "Nine tails, nine grudges — each one repaid a century late, and with interest." },
    { id: "tc-49", name: "Shrine Dragon Spirit", element: "Neutral", rarity: "epic", description: "It coils above the mountain shrine, drinking prayer-smoke and granting exactly what was earned." },
    { id: "tc-50", name: "Crimson Tag Master",  element: "Fire",    rarity: "epic", description: "Every seal he throws lands true, and every one of them is already burning." },

    // ─── Expansion: +100 cards spread across all 4 rarities ───────────────
    // Elements use the full nine the game supports (None, Fire, Water, Wind,
    // Earth, Lightning, Shadow, Ice, Neutral). Admin panel + image upload
    // support all of these — editing a tc-NN card creates an override that lets
    // an admin upload custom art via the Card Editor.

    // Common +20 (tc-51 to tc-70)
    { id: "tc-51", name: "Sapling Spirit",      element: "Earth",     rarity: "common", description: "A green shoot that woke up ambitious. Someday it means to be a forest." },
    { id: "tc-52", name: "Spark Mouse",         element: "Lightning", rarity: "common", description: "It nests in lantern wire and hiccups static that stands your hair on end." },
    { id: "tc-53", name: "Tide Shrimp",         element: "Water",     rarity: "common", description: "It rides the surf-line snapping at whatever the ocean forgot to warn." },
    { id: "tc-54", name: "Ash Sparrow",         element: "Fire",      rarity: "common", description: "It bathes in cooling cinders and carries a live ember home to the nest." },
    { id: "tc-55", name: "Breeze Pixie",        element: "Wind",      rarity: "common", description: "A giggle on the wind that unties knots, lifts hats, and is gone." },
    { id: "tc-56", name: "Twilight Moth",       element: "Shadow",    rarity: "common", description: "It drinks the last light of dusk and dreams the night a little darker." },
    { id: "tc-57", name: "Snowflake Wisp",      element: "Ice",       rarity: "common", description: "A drifting mote of deep-winter cold that never melts, even in cupped hands." },
    { id: "tc-58", name: "Calm Stone Pebble",   element: "Neutral",   rarity: "common", description: "Monks pass it hand to hand for luck. It has outlasted every one of them." },
    { id: "tc-59", name: "Apprentice Genin",    element: "None",      rarity: "common", description: "Diploma ink still wet, guard still too low, heart already all the way in." },
    { id: "tc-60", name: "Pebble Crab",         element: "Earth",     rarity: "common", description: "It armors itself in riverbed gravel and pinches far above its weight." },
    { id: "tc-61", name: "Cinder Ant",          element: "Fire",      rarity: "common", description: "One is a spark. A column of them is a house fire on the march." },
    { id: "tc-62", name: "Mist Newt",           element: "Water",     rarity: "common", description: "Catch it if you like — your hands will close on cold fog." },
    { id: "tc-63", name: "Static Beetle",       element: "Lightning", rarity: "common", description: "Its shell hums like a struck bell and bites like a live wire." },
    { id: "tc-64", name: "Whisper Bat",         element: "Wind",      rarity: "common", description: "It hears a held breath across a canyon, and it tells the wind about it." },
    { id: "tc-65", name: "Hollow Imp",          element: "Shadow",    rarity: "common", description: "A pocket of mischief that slipped out of the Hollow and declined to go back." },
    { id: "tc-66", name: "Frost Mouse",         element: "Ice",       rarity: "common", description: "It tunnels the snowpack all winter, whiskers stiff with rime, entirely unbothered." },
    { id: "tc-67", name: "Zen Disciple",        element: "Neutral",   rarity: "common", description: "He has practiced one stance ten thousand times, and it shows." },
    { id: "tc-68", name: "Bandit Recruit",      element: "None",      rarity: "common", description: "New to the trade, loyal to no one, and dangerous mostly by accident." },
    { id: "tc-69", name: "Clay Hatchling",      element: "Earth",     rarity: "common", description: "A golem fresh from the mold, still deciding what shape its strength should take." },
    { id: "tc-70", name: "Ember Cricket",       element: "Fire",      rarity: "common", description: "Its night-song works like a tiny bellows; the fields it winters in bloom early." },

    // Rare +25 (tc-71 to tc-95)
    { id: "tc-71", name: "Granite Stag",        element: "Earth",     rarity: "rare", description: "Its antlers are cliff-edge stone. It duels rockslides for territory, and wins." },
    { id: "tc-72", name: "Volt Hawk",           element: "Lightning", rarity: "rare", description: "It hunts inside the storm wall, beating the lightning to its own prey." },
    { id: "tc-73", name: "Riverstone Eel",      element: "Water",     rarity: "rare", description: "It sleeps coiled beneath smooth stones and wakes the whole river when disturbed." },
    { id: "tc-74", name: "Char-Blade Mantis",   element: "Fire",      rarity: "rare", description: "Its scythes glow forge-red; whatever it cuts is seared before it falls." },
    { id: "tc-75", name: "Cyclone Falcon",      element: "Wind",      rarity: "rare", description: "It folds the wind into a spiral dive that leaves a groove across the field." },
    { id: "tc-76", name: "Dusk Wraith",         element: "Shadow",    rarity: "rare", description: "It walks the seam between day and night, collecting what either side drops." },
    { id: "tc-77", name: "Glacier Pup",         element: "Ice",       rarity: "rare", description: "Born on blue ice and teething on frost — the glacier considers it family." },
    { id: "tc-78", name: "Sage Apprentice",     element: "Neutral",   rarity: "rare", description: "She mastered the fundamentals so completely that masters ask her to demonstrate." },
    { id: "tc-79", name: "Veteran Ronin",       element: "None",      rarity: "rare", description: "No banner, no village, no wasted motion — just a blade that has outlived everything." },
    { id: "tc-80", name: "Mossback Boar",       element: "Earth",     rarity: "rare", description: "Old growth on its back and old anger in its tusks; trees lean away as it passes." },
    { id: "tc-81", name: "Thunder Spider",      element: "Lightning", rarity: "rare", description: "Its web hums with stored charge, and the morning dew turns every strand into a fuse." },
    { id: "tc-82", name: "Coral Naga",          element: "Water",     rarity: "rare", description: "Reef-born and reef-patient, it grows its armor one bright year at a time." },
    { id: "tc-83", name: "Inferno Toad",        element: "Fire",      rarity: "rare", description: "It croaks burning oil across the marsh, then suns itself in the aftermath." },
    { id: "tc-84", name: "Gale Crane",          element: "Wind",      rarity: "rare", description: "When it calls, the high winds answer. Sailors curse at the sight of it." },
    { id: "tc-85", name: "Eclipse Cat",         element: "Shadow",    rarity: "rare", description: "It pounces from the moment between blink and sight, and it rarely misses." },
    { id: "tc-86", name: "Snowstorm Wolf",      element: "Ice",       rarity: "rare", description: "Its howl rides the blizzard for miles, freezing the breath of everything that hears it." },
    { id: "tc-87", name: "Twin Blade Monk",     element: "Neutral",   rarity: "rare", description: "Two swords, one breath. His temple forbade the style, then built a hall for it." },
    { id: "tc-88", name: "Rogue Mercenary",     element: "None",      rarity: "rare", description: "Loyal to the coin, honest about it, and worth every single piece." },
    { id: "tc-89", name: "Crystal Cobra",       element: "Earth",     rarity: "rare", description: "Its quartz fangs shear through mail. Collectors pay fortunes and lose fingers." },
    { id: "tc-90", name: "Plasma Fox",          element: "Lightning", rarity: "rare", description: "Its tail scrawls arc-light across the dark; hunters chase the afterimage, never the fox." },
    { id: "tc-91", name: "Abyss Octopus",       element: "Water",     rarity: "rare", description: "It hunts where the light gives up, and no diver has ever seen it twice." },
    { id: "tc-92", name: "Magma Bear",          element: "Fire",      rarity: "rare", description: "It dens in cooling lava tubes. Its fur smolders, and its temper does worse." },
    { id: "tc-93", name: "Sky Glider",          element: "Wind",      rarity: "rare", description: "It lives on the high currents for seasons at a stretch, landing only when it chooses." },
    { id: "tc-94", name: "Void Stalker",        element: "Shadow",    rarity: "rare", description: "It hunts in the starless hours, and its prey learn of it exactly once." },
    { id: "tc-95", name: "Blizzard Owl",        element: "Ice",       rarity: "rare", description: "In whiteout snow its wingbeats vanish entirely. The silence is the warning." },

    // Epic +25 (tc-96 to tc-120)
    { id: "tc-96",  name: "Stoneheart Titan",       element: "Earth",     rarity: "epic", description: "A mountain that chose a shape and a quarrel; city walls are a suggestion to it." },
    { id: "tc-97",  name: "Stormbreaker Drake",     element: "Lightning", rarity: "epic", description: "It flies straight through thunderheads and leaves them split and grumbling behind it." },
    { id: "tc-98",  name: "Tidal Lord Manta",       element: "Water",     rarity: "epic", description: "Its wingspan shadows whole reefs, and the tides adjust their schedule around it." },
    { id: "tc-99",  name: "Phoenix Warlord",        element: "Fire",      rarity: "epic", description: "Slain in a dozen campaigns, and crowned again in the ashes of every one." },
    { id: "tc-100", name: "Tempest Marshal",        element: "Wind",      rarity: "epic", description: "He drills the four winds like recruits, and the four winds have learned to obey." },
    { id: "tc-101", name: "Nightveil Assassin",     element: "Shadow",    rarity: "epic", description: "One strike, one shadow, one name crossed out — and the veil never lifts." },
    { id: "tc-102", name: "Frostlord Berserker",    element: "Ice",       rarity: "epic", description: "Rage kept at absolute zero. When it finally boils, the cold only deepens." },
    { id: "tc-103", name: "Mountain Sage",          element: "Neutral",   rarity: "epic", description: "He speaks rarely, and the peak answers; avalanches wait for him to finish." },
    { id: "tc-104", name: "Wandering Master",       element: "None",      rarity: "epic", description: "Every dojo claims he studied there. He has signed none of the guest books." },
    { id: "tc-105", name: "Geode Behemoth",         element: "Earth",     rarity: "epic", description: "Split its hide and find cathedrals of crystal. None who tried kept the sample." },
    { id: "tc-106", name: "Plasma Hydra",           element: "Lightning", rarity: "epic", description: "Cut one head away and two more arc to life, angrier and brighter than the first." },
    { id: "tc-107", name: "Krakenheart Diver",      element: "Water",     rarity: "epic", description: "He swam into the abyss after a legend and came back wearing part of it." },
    { id: "tc-108", name: "Volcanic Reaper",        element: "Fire",      rarity: "epic", description: "Its obsidian scythe is still molten along the edge. Its harvests end quickly." },
    { id: "tc-109", name: "Sky Empress Roc",        element: "Wind",      rarity: "epic", description: "Her wingspan turns noon to dusk, and whole flocks reroute their migrations beneath her." },
    { id: "tc-110", name: "Wraithlord Necromancer", element: "Shadow",    rarity: "epic", description: "The stilled souls answer his roll call, rank upon gray rank." },
    { id: "tc-111", name: "Glacial Empress",        element: "Ice",       rarity: "epic", description: "Her court is carved from a single iceberg, and her verdicts never thaw." },
    { id: "tc-112", name: "Balance Keeper",         element: "Neutral",   rarity: "epic", description: "Set anything on his scales — armies, grudges, storms — and watch it level." },
    { id: "tc-113", name: "Forgotten Champion",     element: "None",      rarity: "epic", description: "The age that sang his deeds burned away. The deeds did not." },
    { id: "tc-114", name: "Crystal Dragon",         element: "Earth",     rarity: "epic", description: "Scaled in cut diamond, it hoards nothing — it is the treasure." },
    { id: "tc-115", name: "Voltaic Knight",         element: "Lightning", rarity: "epic", description: "His armor drinks the storm, and his lance repays it bolt for bolt." },
    { id: "tc-116", name: "Deep Sea Leviathan",     element: "Water",     rarity: "epic", description: "Risen from the trench wearing barnacled scars older than any chart." },
    { id: "tc-117", name: "Magma Colossus",         element: "Fire",      rarity: "epic", description: "Each footfall opens a vent. It crossed a province once and left a mountain range." },
    { id: "tc-118", name: "Skyflame Archer",        element: "Wind",      rarity: "epic", description: "Her arrows ignite mid-flight and fall on distant lines like slow meteors." },
    { id: "tc-119", name: "Phantom Reaper",         element: "Shadow",    rarity: "epic", description: "It harvests at the border of sleep, and some mornings, fewer wake." },
    { id: "tc-120", name: "Eternal Frostgiant",     element: "Ice",       rarity: "epic", description: "Carved by a million winters, and finished by none of them." },

    // Legendary +30 (tc-121 to tc-150)
    { id: "tc-121", name: "Worldroot Behemoth",     element: "Earth",     rarity: "legendary", description: "Its roots grip the planet's bones; when it shifts its weight, coastlines move." },
    { id: "tc-122", name: "Stormgod Dragon",        element: "Lightning", rarity: "legendary", description: "Its breath splits the sky into before and after. Thunder is only its slow echo." },
    { id: "tc-123", name: "Ocean Sovereign",        element: "Water",     rarity: "legendary", description: "Every tide reports to its court, and every drowned fleet flies its colors." },
    { id: "tc-124", name: "Inferno Sovereign",      element: "Fire",      rarity: "legendary", description: "Crowned in living flame that has never once dimmed to embers." },
    { id: "tc-125", name: "Sky King Garuda",        element: "Wind",      rarity: "legendary", description: "One wingbeat raises a hurricane. No witness to the full dive has remained to describe it." },
    { id: "tc-126", name: "Eclipse Sovereign",      element: "Shadow",    rarity: "legendary", description: "It swallowed the sun once, briefly, to make a point the world still remembers." },
    { id: "tc-127", name: "Eternal Glacier King",   element: "Ice",       rarity: "legendary", description: "Frozen since the first age, patient as the ice itself, and slowly winning." },
    { id: "tc-128", name: "Grand Sage of Balance",  element: "Neutral",   rarity: "legendary", description: "He weighed the five elements against one another, and taught them to share." },
    { id: "tc-129", name: "Forgotten Kage",         element: "None",      rarity: "legendary", description: "His village, his war, and his name are gone. His technique is not." },
    { id: "tc-130", name: "World-Ender Titan",      element: "Earth",     rarity: "legendary", description: "The prophets argue only about the date. Its stride is already measured in ruins." },
    { id: "tc-131", name: "Heaven-Shatter Drake",   element: "Lightning", rarity: "legendary", description: "One bolt from its jaws unmade a mountain. The crater is a pilgrimage site now." },
    { id: "tc-132", name: "Abyssal Leviathan",      element: "Water",     rarity: "legendary", description: "It sleeps beneath the world's weight, and the deep places keep respectfully quiet." },
    { id: "tc-133", name: "Phoenix Emperor",        element: "Fire",      rarity: "legendary", description: "Emperor of a dynasty of one, reborn from his own pyre a hundred times unbowed." },
    { id: "tc-134", name: "Storm Empress",          element: "Wind",      rarity: "legendary", description: "Every cloud is a province of her empire, and the weather is her decree." },
    { id: "tc-135", name: "Void Devourer",          element: "Shadow",    rarity: "legendary", description: "It eats light the way famine eats years, and it has never once been full." },
    { id: "tc-136", name: "Frostfall Empress",      element: "Ice",       rarity: "legendary", description: "Snow falls when she lowers her hand, and stops when she remembers to raise it." },
    { id: "tc-137", name: "Zen Master Eternal",     element: "Neutral",   rarity: "legendary", description: "Empires rose, warred, and fell. His morning practice was not interrupted." },
    { id: "tc-138", name: "Legendary Wanderer",     element: "None",      rarity: "legendary", description: "He has mastered every blade and kept none. The road is his only school." },
    { id: "tc-139", name: "Primordial Dragon",      element: "Earth",     rarity: "legendary", description: "Older than the villages and the words for it; the first maps used its spine as a border." },
    { id: "tc-140", name: "Plasma God Beast",       element: "Lightning", rarity: "legendary", description: "Lightning that woke up, looked around, and decided to stay." },
    { id: "tc-141", name: "Tidal God Beast",        element: "Water",     rarity: "legendary", description: "The ocean given will and appetite. Harbors pray that it stays offshore." },
    { id: "tc-142", name: "Solar God Beast",        element: "Fire",      rarity: "legendary", description: "A fragment of the sun that fell burning, and refused to go out." },
    { id: "tc-143", name: "Tempest God Beast",      element: "Wind",      rarity: "legendary", description: "A living storm that circles the world, growing louder with every lap." },
    { id: "tc-144", name: "Shadow God Beast",       element: "Shadow",    rarity: "legendary", description: "Born in the eclipse-gap between light and dark, and loyal to neither." },
    { id: "tc-145", name: "Frost God Beast",        element: "Ice",       rarity: "legendary", description: "The heart of the polar night — beating once a winter, and felt everywhere." },
    { id: "tc-146", name: "Equilibrium God",        element: "Neutral",   rarity: "legendary", description: "Perfect in every measure; its stillness is the point the elements orbit." },
    { id: "tc-147", name: "Final Shinobi",          element: "None",      rarity: "legendary", description: "When the last war ends, one blade will still be standing. This one." },
    { id: "tc-148", name: "Demon-King Slayer",      element: "Shadow",    rarity: "legendary", description: "The blade that ended the demon king, still dark along the edge that did it." },
    { id: "tc-149", name: "Cosmic Phoenix",         element: "Fire",      rarity: "legendary", description: "It soars between the stars and nests in dying suns, ferrying fire across the dark." },
    { id: "tc-150", name: "World-Eater Naga",       element: "Water",     rarity: "legendary", description: "Its coils ring the deepest trenches. Sailors call the horizon its smaller circle." },
];

export function getAllTileCards(creatorCards: TileCard[]): TileCard[] {
    return [...creatorCards, ...shinobiTileCards.filter((s) => !creatorCards.some((c) => c.id === s.id))];
}
