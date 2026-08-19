/** Mechanically extracted from api/_legacy-defs.ts. Keep this small, browser-safe
 * source manifest in drift tests with the authoritative Legacy roster. */
export type ChronicleLegacySource = {
    id: string;
    name: string;
    rarity: "basic" | "rare" | "legendary" | "mythic";
    category: string;
    villageAffinity?: string;
    title: string;
    flavor: string;
    badge: string;
};

export const CHRONICLE_LEGACY_SOURCES = [
    {
        "id": "first-flame",
        "name": "Legacy of the First Flame",
        "rarity": "mythic",
        "category": "explorer",
        "title": "First Flame Bearer",
        "flavor": "Before the roads had names, someone had to walk them burning. The world remembers who lit the way first.",
        "badge": "first-flame"
    },
    {
        "id": "gate-opener",
        "name": "Legacy of the Sundered Seal",
        "rarity": "mythic",
        "category": "pve",
        "title": "Sundered Seal",
        "flavor": "The seal beneath Central does not crack for the curious. It cracks for the one who kept coming back.",
        "badge": "gate-opener"
    },
    {
        "id": "hundred-storms",
        "name": "Legacy of the Hundred Storms",
        "rarity": "mythic",
        "category": "ninjutsu",
        "title": "Hundred Storms",
        "flavor": "Ninjutsu, genjutsu, taijutsu, bukijutsu — the storm does not choose one wind. It is all of them at once.",
        "badge": "hundred-storms"
    },
    {
        "id": "duel-sovereign",
        "name": "Legacy of the Duel Sovereign",
        "rarity": "mythic",
        "category": "pvp",
        "title": "Duel Sovereign",
        "flavor": "Kings are crowned. Sovereigns are proven — one challenger at a time, none of them lesser, none of them lucky.",
        "badge": "duel-sovereign"
    },
    {
        "id": "silent-empire",
        "name": "Legacy of the Silent Empire",
        "rarity": "mythic",
        "category": "genjutsu",
        "title": "Silent Emperor",
        "flavor": "No banners, no borders, no decree ever spoken aloud. An empire built entirely of moments its subjects cannot remember.",
        "badge": "silent-empire"
    },
    {
        "id": "last-bastion",
        "name": "Legacy of the Last Bastion",
        "rarity": "mythic",
        "category": "support",
        "title": "The Last Bastion",
        "flavor": "When every other wall fell, the line held — because the line was a person.",
        "badge": "last-bastion"
    },
    {
        "id": "founders-shadow",
        "name": "Legacy of the Founder's Shadow",
        "rarity": "mythic",
        "category": "village",
        "title": "Founder's Shadow",
        "flavor": "Some serve a village. A very few become the thing the village quietly stands on.",
        "badge": "founders-shadow"
    },
    {
        "id": "world-awakener",
        "name": "Legacy of the World Awakener",
        "rarity": "mythic",
        "category": "pve",
        "title": "World Awakener",
        "flavor": "The great beasts do not stir for armies. They stir for the one name the world keeps repeating.",
        "badge": "world-awakener"
    },
    {
        "id": "horizons-end",
        "name": "Legacy of the Horizon's End",
        "rarity": "mythic",
        "category": "explorer",
        "title": "Horizon's End",
        "flavor": "Maps end where courage does. Somewhere past the last drawn line, the horizon finally learned this one’s name.",
        "badge": "horizons-end"
    },
    {
        "id": "deathless-ember",
        "name": "Legacy of the Deathless Ember",
        "rarity": "mythic",
        "category": "taijutsu",
        "title": "Deathless Ember",
        "flavor": "Extinguished a hundred times, and a hundred times the coal came back red. Some fires simply refuse the dark.",
        "badge": "deathless-ember"
    },
    {
        "id": "elemental-cataclysm",
        "name": "Legacy of the Elemental Cataclysm",
        "rarity": "legendary",
        "category": "ninjutsu",
        "title": "Cataclysm",
        "flavor": "Where this one fought, the weather still has not settled.",
        "badge": "elemental-cataclysm"
    },
    {
        "id": "thousand-seals",
        "name": "Legacy of the Thousand Seals",
        "rarity": "legendary",
        "category": "ninjutsu",
        "title": "Thousand Seals",
        "flavor": "Hands faster than doubt. Every seal a promise the enemy could not read in time.",
        "badge": "thousand-seals"
    },
    {
        "id": "moonlit-ghost",
        "name": "Legacy of the Moonlit Ghost",
        "rarity": "legendary",
        "category": "genjutsu",
        "villageAffinity": "Moonshadow",
        "title": "Moonlit Ghost",
        "flavor": "Seen only twice: once in the moment before, and once in the nightmare after.",
        "badge": "moonlit-ghost"
    },
    {
        "id": "void-whisper",
        "name": "Legacy of the Void Whisper",
        "rarity": "legendary",
        "category": "genjutsu",
        "title": "Void Whisper",
        "flavor": "It never raised its voice. It lowered the world’s instead.",
        "badge": "void-whisper"
    },
    {
        "id": "arena-demon",
        "name": "Legacy of the Arena Demon",
        "rarity": "legendary",
        "category": "taijutsu",
        "title": "Arena Demon",
        "flavor": "The crowd stopped betting on outcomes years ago. Now they only bet on how long.",
        "badge": "arena-demon"
    },
    {
        "id": "unbroken-body",
        "name": "Legacy of the Unbroken Body",
        "rarity": "legendary",
        "category": "taijutsu",
        "title": "Unbroken",
        "flavor": "Bones remember every fracture. These bones remember winning anyway.",
        "badge": "unbroken-body"
    },
    {
        "id": "blade-saint",
        "name": "Legacy of the Blade Saint",
        "rarity": "legendary",
        "category": "bukijutsu",
        "title": "Blade Saint",
        "flavor": "To others, ten thousand draws of the sword. To the saint, one draw — practiced ten thousand times.",
        "badge": "blade-saint"
    },
    {
        "id": "thousand-cuts",
        "name": "Legacy of the Thousand Cuts",
        "rarity": "legendary",
        "category": "bukijutsu",
        "title": "Thousand Cuts",
        "flavor": "No single wound was fatal. That was never the point.",
        "badge": "thousand-cuts"
    },
    {
        "id": "duel-king",
        "name": "Legacy of the Duel King",
        "rarity": "legendary",
        "category": "pvp",
        "title": "Duel King",
        "flavor": "The throne is a circle of scorched ground, and nobody has taken it back yet.",
        "badge": "duel-king"
    },
    {
        "id": "village-reaper",
        "name": "Legacy of the Village Reaper",
        "rarity": "legendary",
        "category": "war",
        "title": "Village Reaper",
        "flavor": "Ask a fallen sector who took it, and watch how quiet the survivors get.",
        "badge": "village-reaper"
    },
    {
        "id": "bloodstained-path",
        "name": "Legacy of the Bloodstained Path",
        "rarity": "legendary",
        "category": "pvp",
        "title": "Bloodstained",
        "flavor": "Every step of the road behind is marked. The road ahead has already started bleeding.",
        "badge": "bloodstained-path"
    },
    {
        "id": "gatebreaker",
        "name": "Legacy of the Gatebreaker",
        "rarity": "legendary",
        "category": "pve",
        "title": "Gatebreaker",
        "flavor": "Doors are a suggestion. Ancient sealed doors are a slightly longer suggestion.",
        "badge": "gatebreaker"
    },
    {
        "id": "trial-conqueror",
        "name": "Legacy of the Trial Conqueror",
        "rarity": "legendary",
        "category": "pve",
        "title": "Trial Conqueror",
        "flavor": "The trials were built to find the limit of a shinobi. They are still looking.",
        "badge": "trial-conqueror"
    },
    {
        "id": "ancient-hunter",
        "name": "Legacy of the Ancient Hunter",
        "rarity": "legendary",
        "category": "pve",
        "title": "Ancient Hunter",
        "flavor": "The old beasts teach one lesson each. This hunter finished the whole curriculum.",
        "badge": "ancient-hunter"
    },
    {
        "id": "ashen-will",
        "name": "Legacy of the Ashen Will",
        "rarity": "legendary",
        "category": "village",
        "villageAffinity": "Ashen Leaf",
        "title": "Ashen Will",
        "flavor": "Ashen Leaf endures because someone always chooses to be the ember that will not go out.",
        "badge": "ashen-will"
    },
    {
        "id": "storm-fang",
        "name": "Legacy of the Storm Fang",
        "rarity": "legendary",
        "category": "village",
        "villageAffinity": "Stormveil",
        "title": "Storm Fang",
        "flavor": "Stormveil does not wait for weather. It sends its own.",
        "badge": "storm-fang"
    },
    {
        "id": "frostbound-shield",
        "name": "Legacy of the Frostbound Shield",
        "rarity": "legendary",
        "category": "village",
        "villageAffinity": "Frostfang",
        "title": "Frostbound Shield",
        "flavor": "The north holds because its shield never asks how cold it is.",
        "badge": "frostbound-shield"
    },
    {
        "id": "moonlit-oath",
        "name": "Legacy of the Moonlit Oath",
        "rarity": "legendary",
        "category": "village",
        "villageAffinity": "Moonshadow",
        "title": "Oath of the Moon",
        "flavor": "Moonshadow keeps no written oaths. It keeps kept ones.",
        "badge": "moonlit-oath"
    },
    {
        "id": "village-guardian",
        "name": "Legacy of the Village Guardian",
        "rarity": "legendary",
        "category": "support",
        "title": "Village Guardian",
        "flavor": "Heroes are counted by the battles they won. Guardians, by the ones nobody else had to fight.",
        "badge": "village-guardian"
    },
    {
        "id": "oathkeeper",
        "name": "Legacy of the Oathkeeper",
        "rarity": "legendary",
        "category": "support",
        "title": "Oathkeeper",
        "flavor": "Promised to stand between. Has never once defined between what.",
        "badge": "oathkeeper"
    },
    {
        "id": "mapless-one",
        "name": "Legacy of the Mapless One",
        "rarity": "legendary",
        "category": "explorer",
        "title": "The Mapless One",
        "flavor": "Threw the map away at the first fork. The land has been introducing itself ever since.",
        "badge": "mapless-one"
    },
    {
        "id": "shrine-seeker",
        "name": "Legacy of the Shrine Seeker",
        "rarity": "legendary",
        "category": "explorer",
        "title": "Shrine Seeker",
        "flavor": "Every forgotten shrine has one visitor left. They are all the same visitor.",
        "badge": "shrine-seeker"
    },
    {
        "id": "beast-sovereign",
        "name": "Legacy of the Beast Sovereign",
        "rarity": "legendary",
        "category": "pets",
        "title": "Beast Sovereign",
        "flavor": "Every beast in the wild owes this one a scar, a meal, or a life — and they pay their debts in loyalty.",
        "badge": "beast-sovereign"
    },
    {
        "id": "silent-gambit",
        "name": "Legacy of the Silent Gambit",
        "rarity": "legendary",
        "category": "cards",
        "title": "The Silent Gambit",
        "flavor": "Won the hall’s deadliest hands without ever once needing the cards to be good.",
        "badge": "silent-gambit"
    },
    {
        "id": "warborn-banner",
        "name": "Legacy of the Warborn Banner",
        "rarity": "legendary",
        "category": "war",
        "title": "Bannerlord",
        "flavor": "Some carry the banner. Some are what the banner is a picture of.",
        "badge": "warborn-banner"
    },
    {
        "id": "elemental-storm",
        "name": "Legacy of the Elemental Storm",
        "rarity": "rare",
        "category": "ninjutsu",
        "title": "Elemental Storm",
        "flavor": "Five elements, one temper.",
        "badge": "elemental-storm"
    },
    {
        "id": "burning-vanguard",
        "name": "Legacy of the Burning Vanguard",
        "rarity": "rare",
        "category": "ninjutsu",
        "villageAffinity": "Ashen Leaf",
        "title": "Burning Vanguard",
        "flavor": "First through every breach, and the breach is usually on fire because of them.",
        "badge": "burning-vanguard"
    },
    {
        "id": "chakra-tempest",
        "name": "Legacy of the Chakra Tempest",
        "rarity": "rare",
        "category": "ninjutsu",
        "title": "Chakra Tempest",
        "flavor": "Too much power, aimed just well enough.",
        "badge": "chakra-tempest"
    },
    {
        "id": "stormcallers-path",
        "name": "Legacy of the Stormcaller's Path",
        "rarity": "rare",
        "category": "ninjutsu",
        "villageAffinity": "Stormveil",
        "title": "Stormcaller",
        "flavor": "Learned ninjutsu the Stormveil way: outside, mid-tempest, on purpose.",
        "badge": "stormcallers-path"
    },
    {
        "id": "shadow-strategist",
        "name": "Legacy of the Shadow Strategist",
        "rarity": "rare",
        "category": "genjutsu",
        "title": "Shadow Strategist",
        "flavor": "Wins the fight during the bow before it.",
        "badge": "shadow-strategist"
    },
    {
        "id": "silent-fang",
        "name": "Legacy of the Silent Fang",
        "rarity": "rare",
        "category": "genjutsu",
        "villageAffinity": "Moonshadow",
        "title": "Silent Fang",
        "flavor": "The bite arrives before the bark, instead of it.",
        "badge": "silent-fang"
    },
    {
        "id": "dream-weaver",
        "name": "Legacy of the Dream Weaver",
        "rarity": "rare",
        "category": "genjutsu",
        "title": "Dream Weaver",
        "flavor": "Enemies wake up defeated and rested. Nobody knows how to feel about it.",
        "badge": "dream-weaver"
    },
    {
        "id": "mirage-dancer",
        "name": "Legacy of the Mirage Dancer",
        "rarity": "rare",
        "category": "genjutsu",
        "title": "Mirage Dancer",
        "flavor": "Every step is a lie, and every lie lands.",
        "badge": "mirage-dancer"
    },
    {
        "id": "iron-fist",
        "name": "Legacy of the Iron Fist",
        "rarity": "rare",
        "category": "taijutsu",
        "title": "Iron Fist",
        "flavor": "The training posts filed a complaint. It was denied.",
        "badge": "iron-fist"
    },
    {
        "id": "bloodied-knuckle",
        "name": "Legacy of the Bloodied Knuckle",
        "rarity": "rare",
        "category": "taijutsu",
        "title": "Bloodied Knuckle",
        "flavor": "No weapon ever felt necessary.",
        "badge": "bloodied-knuckle"
    },
    {
        "id": "mountain-stance",
        "name": "Legacy of the Mountain Stance",
        "rarity": "rare",
        "category": "taijutsu",
        "villageAffinity": "Frostfang",
        "title": "Mountain Stance",
        "flavor": "Has been moved exactly once, and still disputes it.",
        "badge": "mountain-stance"
    },
    {
        "id": "crashing-wave",
        "name": "Legacy of the Crashing Wave",
        "rarity": "rare",
        "category": "taijutsu",
        "villageAffinity": "Stormveil",
        "title": "Crashing Wave",
        "flavor": "Stormveil taijutsu: hit like the tide, leave like it too.",
        "badge": "crashing-wave"
    },
    {
        "id": "warborn-blade",
        "name": "Legacy of the Warborn Blade",
        "rarity": "rare",
        "category": "bukijutsu",
        "title": "Warborn Blade",
        "flavor": "Forged in a war, quenched in the next one.",
        "badge": "warborn-blade"
    },
    {
        "id": "crimson-duelist",
        "name": "Legacy of the Crimson Duelist",
        "rarity": "rare",
        "category": "bukijutsu",
        "title": "Crimson Duelist",
        "flavor": "Accepts every duel, apologizes to none of them.",
        "badge": "crimson-duelist"
    },
    {
        "id": "quiet-scabbard",
        "name": "Legacy of the Quiet Scabbard",
        "rarity": "rare",
        "category": "bukijutsu",
        "title": "Quiet Scabbard",
        "flavor": "The blade speaks once per conversation.",
        "badge": "quiet-scabbard"
    },
    {
        "id": "hunters-edge",
        "name": "Legacy of the Hunter's Edge",
        "rarity": "rare",
        "category": "bukijutsu",
        "title": "Hunter's Edge",
        "flavor": "Every notch on the haft is a story the prey did not finish.",
        "badge": "hunters-edge"
    },
    {
        "id": "proving-grounds",
        "name": "Legacy of the Proving Grounds",
        "rarity": "rare",
        "category": "pvp",
        "title": "Proven",
        "flavor": "Never asks for a rematch. Never needs one.",
        "badge": "proving-grounds"
    },
    {
        "id": "ranked-ascendant",
        "name": "Legacy of the Ranked Ascendant",
        "rarity": "rare",
        "category": "pvp",
        "title": "Ascendant",
        "flavor": "The ladder was climbed with other climbers still on it.",
        "badge": "ranked-ascendant"
    },
    {
        "id": "giant-slayer",
        "name": "Legacy of the Giant Slayer",
        "rarity": "rare",
        "category": "pvp",
        "title": "Giant Slayer",
        "flavor": "Reads level differences as suggestions.",
        "badge": "giant-slayer"
    },
    {
        "id": "wall-of-defiance",
        "name": "Legacy of the Wall of Defiance",
        "rarity": "rare",
        "category": "pvp",
        "title": "The Wall",
        "flavor": "Challengers arrive with plans. They leave with respect for masonry.",
        "badge": "wall-of-defiance"
    },
    {
        "id": "hollow-seeker",
        "name": "Legacy of the Hollow Seeker",
        "rarity": "rare",
        "category": "pve",
        "title": "Hollow Seeker",
        "flavor": "The Gate whispers to everyone. This one whispers back.",
        "badge": "hollow-seeker"
    },
    {
        "id": "tower-climber",
        "name": "Legacy of the Endless Ascent",
        "rarity": "rare",
        "category": "pve",
        "title": "Endless Ascent",
        "flavor": "The tower is infinite. Their patience is merely very large.",
        "badge": "tower-climber"
    },
    {
        "id": "mission-hound",
        "name": "Legacy of the Mission Hound",
        "rarity": "rare",
        "category": "pve",
        "title": "Mission Hound",
        "flavor": "The board runs out of postings before they run out of morning.",
        "badge": "mission-hound"
    },
    {
        "id": "beast-tracker",
        "name": "Legacy of the Beast Tracker",
        "rarity": "rare",
        "category": "pve",
        "title": "Beast Tracker",
        "flavor": "Knows every hunt by its footprints, and several by first name.",
        "badge": "beast-tracker"
    },
    {
        "id": "boss-breaker",
        "name": "Legacy of the Boss Breaker",
        "rarity": "rare",
        "category": "pve",
        "title": "Boss Breaker",
        "flavor": "Big health bars are just long to-do lists.",
        "badge": "boss-breaker"
    },
    {
        "id": "dungeon-delver",
        "name": "Legacy of the Dungeon Delver",
        "rarity": "rare",
        "category": "pve",
        "title": "Dungeon Delver",
        "flavor": "If it is dark, locked, and humming — they are already inside.",
        "badge": "dungeon-delver"
    },
    {
        "id": "ashen-hearth",
        "name": "Legacy of the Ashen Hearth",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Ashen Leaf",
        "title": "Hearthkeeper",
        "flavor": "Ashen Leaf’s fires stay lit because someone keeps feeding them quietly.",
        "badge": "ashen-hearth"
    },
    {
        "id": "embers-discipline",
        "name": "Legacy of the Ember's Discipline",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Ashen Leaf",
        "title": "Ember Disciple",
        "flavor": "Trained where the drills end when the instructor gets bored. The instructor never gets bored.",
        "badge": "embers-discipline"
    },
    {
        "id": "tidebreaker",
        "name": "Legacy of the Tidebreaker",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Stormveil",
        "title": "Tidebreaker",
        "flavor": "Stormveil counts its storms survived. This one counts storms caused.",
        "badge": "tidebreaker"
    },
    {
        "id": "thunder-raider",
        "name": "Legacy of the Thunder Raider",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Stormveil",
        "title": "Thunder Raider",
        "flavor": "Arrives with the thunder. The lightning is just the announcement.",
        "badge": "thunder-raider"
    },
    {
        "id": "northern-fang",
        "name": "Legacy of the Northern Fang",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Frostfang",
        "title": "Northern Fang",
        "flavor": "In the north the frost bites first — and it learned the hard way who bites back.",
        "badge": "northern-fang"
    },
    {
        "id": "winter-sentinel",
        "name": "Legacy of the Winter Sentinel",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Frostfang",
        "title": "Winter Sentinel",
        "flavor": "Stood the long watch. The long watch blinked first.",
        "badge": "winter-sentinel"
    },
    {
        "id": "veiled-lantern",
        "name": "Legacy of the Veiled Lantern",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Moonshadow",
        "title": "Veiled Lantern",
        "flavor": "Moonshadow’s streets are safe because something politely unseen keeps them so.",
        "badge": "veiled-lantern"
    },
    {
        "id": "midnight-errand",
        "name": "Legacy of the Midnight Errand",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Moonshadow",
        "title": "Midnight Runner",
        "flavor": "The missions nobody logs, delivered by the shinobi nobody saw.",
        "badge": "midnight-errand"
    },
    {
        "id": "hidden-path",
        "name": "Legacy of the Hidden Path",
        "rarity": "rare",
        "category": "explorer",
        "title": "Pathfinder",
        "flavor": "Shortcuts are just long-cuts nobody was brave enough to check.",
        "badge": "hidden-path"
    },
    {
        "id": "wayfarers-mark",
        "name": "Legacy of the Wayfarer's Mark",
        "rarity": "rare",
        "category": "explorer",
        "title": "Wayfarer",
        "flavor": "Home is a direction, not an address.",
        "badge": "wayfarers-mark"
    },
    {
        "id": "rumor-chaser",
        "name": "Legacy of the Rumor Chaser",
        "rarity": "rare",
        "category": "explorer",
        "title": "Rumor Chaser",
        "flavor": "Every tall tale in every tavern gets personally fact-checked.",
        "badge": "rumor-chaser"
    },
    {
        "id": "strangers-friend",
        "name": "Legacy of the Stranger's Friend",
        "rarity": "rare",
        "category": "explorer",
        "title": "Stranger's Friend",
        "flavor": "Wanderers on every road owe this one a favor, a meal, or an apology.",
        "badge": "strangers-friend"
    },
    {
        "id": "shielding-palm",
        "name": "Legacy of the Shielding Palm",
        "rarity": "rare",
        "category": "support",
        "title": "Shielding Palm",
        "flavor": "An open hand that has stopped more blades than most swords.",
        "badge": "shielding-palm"
    },
    {
        "id": "field-medic",
        "name": "Legacy of the Field Medic",
        "rarity": "rare",
        "category": "support",
        "title": "Field Medic",
        "flavor": "Runs toward the scream. Bills nobody.",
        "badge": "field-medic"
    },
    {
        "id": "purifying-light",
        "name": "Legacy of the Purifying Light",
        "rarity": "rare",
        "category": "support",
        "title": "Purifier",
        "flavor": "Curses, poisons, despair — all laundry, all washable.",
        "badge": "purifying-light"
    },
    {
        "id": "pack-leader",
        "name": "Legacy of the Pack Leader",
        "rarity": "rare",
        "category": "pets",
        "title": "Pack Leader",
        "flavor": "Speaks fluent growl, purr, and dramatic silence.",
        "badge": "pack-leader"
    },
    {
        "id": "wild-heart",
        "name": "Legacy of the Wild Heart",
        "rarity": "rare",
        "category": "pets",
        "title": "Wild Heart",
        "flavor": "Half the menagerie followed them home. The other half is en route.",
        "badge": "wild-heart"
    },
    {
        "id": "coliseum-tamer",
        "name": "Legacy of the Colosseum Tamer",
        "rarity": "rare",
        "category": "pets",
        "title": "Colosseum Tamer",
        "flavor": "The crowd chants the pet’s name. The tamer prefers it that way.",
        "badge": "coliseum-tamer"
    },
    {
        "id": "card-sharp",
        "name": "Legacy of the Card Sharp",
        "rarity": "rare",
        "category": "cards",
        "title": "Card Sharp",
        "flavor": "Shuffles like a magician, wins like an accountant.",
        "badge": "card-sharp"
    },
    {
        "id": "tables-shadow",
        "name": "Legacy of the Table's Shadow",
        "rarity": "rare",
        "category": "cards",
        "title": "The Table's Shadow",
        "flavor": "Nobody remembers inviting them to the game. Nobody dares un-invite them.",
        "badge": "tables-shadow"
    },
    {
        "id": "sector-warden",
        "name": "Legacy of the Sector Warden",
        "rarity": "rare",
        "category": "war",
        "title": "Sector Warden",
        "flavor": "Holds ground like the ground asked them personally.",
        "badge": "sector-warden"
    },
    {
        "id": "banner-taker",
        "name": "Legacy of the Banner Taker",
        "rarity": "rare",
        "category": "war",
        "title": "Banner Taker",
        "flavor": "Collects enemy flags the way others collect excuses.",
        "badge": "banner-taker"
    },
    {
        "id": "siege-runner",
        "name": "Legacy of the Siege Runner",
        "rarity": "rare",
        "category": "war",
        "title": "Siege Runner",
        "flavor": "Between the lines, under the arrows, on schedule.",
        "badge": "siege-runner"
    },
    {
        "id": "war-drummer",
        "name": "Legacy of the War Drummer",
        "rarity": "rare",
        "category": "war",
        "title": "War Drummer",
        "flavor": "Every war has a heartbeat. Someone has to be it.",
        "badge": "war-drummer"
    },
    {
        "id": "wandering-shinobi",
        "name": "Legacy of the Wandering Shinobi",
        "rarity": "basic",
        "category": "explorer",
        "title": "Wanderer",
        "flavor": "The road never asked for credentials. Neither did they.",
        "badge": "wandering-shinobi"
    },
    {
        "id": "village-veteran",
        "name": "Legacy of the Village Veteran",
        "rarity": "basic",
        "category": "village",
        "title": "Veteran",
        "flavor": "Fifty levels of showing up. It counts for more than anyone admits.",
        "badge": "village-veteran"
    },
    {
        "id": "proven-fighter",
        "name": "Legacy of the Proven Fighter",
        "rarity": "basic",
        "category": "pvp",
        "title": "Fighter",
        "flavor": "Not the strongest in the ring. Reliably in the ring.",
        "badge": "proven-fighter"
    },
    {
        "id": "road-worn-shinobi",
        "name": "Legacy of the Road-Worn Shinobi",
        "rarity": "basic",
        "category": "explorer",
        "title": "Road-Worn",
        "flavor": "Boots resoled six times. Resolve, zero times.",
        "badge": "road-worn-shinobi"
    },
    {
        "id": "ember-student",
        "name": "Legacy of the Ember Student",
        "rarity": "basic",
        "category": "ninjutsu",
        "title": "Ember Student",
        "flavor": "The first spark was an accident. The next thousand were not.",
        "badge": "ember-student"
    },
    {
        "id": "quiet-mind",
        "name": "Legacy of the Quiet Mind",
        "rarity": "basic",
        "category": "genjutsu",
        "title": "Quiet Mind",
        "flavor": "Learned early that the loudest jutsu is rarely the one that ends it.",
        "badge": "quiet-mind"
    },
    {
        "id": "calloused-fist",
        "name": "Legacy of the Calloused Fist",
        "rarity": "basic",
        "category": "taijutsu",
        "title": "Calloused Fist",
        "flavor": "Gloves kept wearing out. The hands did not.",
        "badge": "calloused-fist"
    },
    {
        "id": "steel-apprentice",
        "name": "Legacy of the Steel Apprentice",
        "rarity": "basic",
        "category": "bukijutsu",
        "title": "Steel Apprentice",
        "flavor": "First blade: borrowed. First lesson: give it back sharper.",
        "badge": "steel-apprentice"
    },
    {
        "id": "field-hand",
        "name": "Legacy of the Field Hand",
        "rarity": "basic",
        "category": "pve",
        "title": "Field Hand",
        "flavor": "No mission too small, no ledger left unbalanced.",
        "badge": "field-hand"
    },
    {
        "id": "beast-friend",
        "name": "Legacy of the Beast Friend",
        "rarity": "basic",
        "category": "pets",
        "title": "Beast Friend",
        "flavor": "Was adopted by a pet, technically.",
        "badge": "beast-friend"
    },
    {
        "id": "table-regular",
        "name": "Legacy of the Table Regular",
        "rarity": "basic",
        "category": "cards",
        "title": "Table Regular",
        "flavor": "Has a usual seat, a usual bet, and an unusual win rate.",
        "badge": "table-regular"
    },
    {
        "id": "lantern-bearer",
        "name": "Legacy of the Lantern Bearer",
        "rarity": "basic",
        "category": "support",
        "title": "Lantern Bearer",
        "flavor": "Someone has to hold the light. Someone always did.",
        "badge": "lantern-bearer"
    },
    {
        "id": "first-steps",
        "name": "Legacy of the First Steps",
        "rarity": "basic",
        "category": "explorer",
        "title": "Trailblazer",
        "flavor": "Every map starts with somebody’s first wrong turn.",
        "badge": "first-steps"
    },
    {
        "id": "honest-ryo",
        "name": "Legacy of the Honest Ryo",
        "rarity": "basic",
        "category": "village",
        "title": "Honest Hand",
        "flavor": "Paid their dues. Then paid a little extra, quietly.",
        "badge": "honest-ryo"
    },
    {
        "id": "steadfast-neighbor",
        "name": "Legacy of the Steadfast Neighbor",
        "rarity": "basic",
        "category": "village",
        "title": "Steadfast",
        "flavor": "The village remembers who answered the bell without asking whose fire it was.",
        "badge": "steadfast-neighbor"
    }
] as const satisfies readonly ChronicleLegacySource[];
