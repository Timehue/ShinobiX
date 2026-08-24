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
        "flavor": "Road wardens in five countries copied routes from this shinobi’s field notes. Witnesses remember who carried the first torch into places patrols had abandoned.",
        "badge": "first-flame"
    },
    {
        "id": "gate-opener",
        "name": "Legacy of the Sundered Seal",
        "rarity": "mythic",
        "category": "pve",
        "title": "Sundered Seal",
        "flavor": "The Central keepers logged seventy-five descents under the same name. Most shinobi stop returning after the first bad extraction.",
        "badge": "gate-opener"
    },
    {
        "id": "hundred-storms",
        "name": "Legacy of the Hundred Storms",
        "rarity": "mythic",
        "category": "ninjutsu",
        "title": "Hundred Storms",
        "flavor": "Mission reports credit this shinobi with victories in all four combat disciplines. None of those victories reads like improvisation.",
        "badge": "hundred-storms"
    },
    {
        "id": "duel-sovereign",
        "name": "Legacy of the Duel Sovereign",
        "rarity": "mythic",
        "category": "pvp",
        "title": "Duel Sovereign",
        "flavor": "Arena clerks checked the record twice: four hundred wins, including ranked rivals and shinobi with every advantage on paper.",
        "badge": "duel-sovereign"
    },
    {
        "id": "silent-empire",
        "name": "Legacy of the Silent Empire",
        "rarity": "mythic",
        "category": "genjutsu",
        "title": "Silent Emperor",
        "flavor": "Opponents describe missing seconds, false orders, and fights decided before they understood the genjutsu. The reports come from every border.",
        "badge": "silent-empire"
    },
    {
        "id": "last-bastion",
        "name": "Legacy of the Last Bastion",
        "rarity": "mythic",
        "category": "support",
        "title": "The Last Bastion",
        "flavor": "Medics and defenders keep placing the same shinobi at the last unbroken position. Hundreds of people reached shelter behind that line.",
        "badge": "last-bastion"
    },
    {
        "id": "founders-shadow",
        "name": "Legacy of the Founder's Shadow",
        "rarity": "mythic",
        "category": "village",
        "title": "Founder's Shadow",
        "flavor": "Donation ledgers, war rolls, and mission books all carry this name. The village has leaned on the same person for years.",
        "badge": "founders-shadow"
    },
    {
        "id": "world-awakener",
        "name": "Legacy of the World Awakener",
        "rarity": "mythic",
        "category": "pve",
        "title": "World Awakener",
        "flavor": "Great-beast hunt reports from eight seasons place this shinobi near the decisive strike. Rival villages agree on the name, which is rare enough.",
        "badge": "world-awakener"
    },
    {
        "id": "horizons-end",
        "name": "Legacy of the Horizon's End",
        "rarity": "mythic",
        "category": "explorer",
        "title": "Horizon's End",
        "flavor": "Surveyors have redrawn their outer lines around this shinobi’s discoveries. Their oldest boots have crossed more blank country than most maps contain.",
        "badge": "horizons-end"
    },
    {
        "id": "deathless-ember",
        "name": "Legacy of the Deathless Ember",
        "rarity": "mythic",
        "category": "taijutsu",
        "title": "Deathless Ember",
        "flavor": "Healers recorded injuries that should have ended the fight. Witnesses recorded the same shinobi standing up and finishing it.",
        "badge": "deathless-ember"
    },
    {
        "id": "elemental-cataclysm",
        "name": "Legacy of the Elemental Cataclysm",
        "rarity": "legendary",
        "category": "ninjutsu",
        "title": "Cataclysm",
        "flavor": "Field teams still identify this shinobi’s battles by scorched ground, flash-frozen stone, and trees split by lightning.",
        "badge": "elemental-cataclysm"
    },
    {
        "id": "thousand-seals",
        "name": "Legacy of the Thousand Seals",
        "rarity": "legendary",
        "category": "ninjutsu",
        "title": "Thousand Seals",
        "flavor": "Witnesses describe complete hand-seal chains formed under pressure, with no wasted motion and no need to begin again.",
        "badge": "thousand-seals"
    },
    {
        "id": "moonlit-ghost",
        "name": "Legacy of the Moonlit Ghost",
        "rarity": "legendary",
        "category": "genjutsu",
        "villageAffinity": "Moonshadow",
        "title": "Moonlit Ghost",
        "flavor": "Moonshadow booth records show opponents striking the wrong position again and again. Most never saw the real shinobi until the bout ended.",
        "badge": "moonlit-ghost"
    },
    {
        "id": "void-whisper",
        "name": "Legacy of the Void Whisper",
        "rarity": "legendary",
        "category": "genjutsu",
        "title": "Void Whisper",
        "flavor": "Opponents remember the field going quiet before their senses failed. The same detail appears in reports from unrelated fights.",
        "badge": "void-whisper"
    },
    {
        "id": "arena-demon",
        "name": "Legacy of the Arena Demon",
        "rarity": "legendary",
        "category": "taijutsu",
        "title": "Arena Demon",
        "flavor": "Stormveil bookies still post a duration line, but few will take the opposing name anymore.",
        "badge": "arena-demon"
    },
    {
        "id": "unbroken-body",
        "name": "Legacy of the Unbroken Body",
        "rarity": "legendary",
        "category": "taijutsu",
        "title": "Unbroken",
        "flavor": "The hospital has treated this shinobi for fractures, torn joints, and worse. Several intake forms were signed after a victory.",
        "badge": "unbroken-body"
    },
    {
        "id": "blade-saint",
        "name": "Legacy of the Blade Saint",
        "rarity": "legendary",
        "category": "bukijutsu",
        "title": "Blade Saint",
        "flavor": "Armorers who watched the bouts noted the same clean draw under ten different pressures. Practice made it reliable, not decorative.",
        "badge": "blade-saint"
    },
    {
        "id": "thousand-cuts",
        "name": "Legacy of the Thousand Cuts",
        "rarity": "legendary",
        "category": "bukijutsu",
        "title": "Thousand Cuts",
        "flavor": "Hunt reports show a patient fighter who opens small wounds, controls the escape, and lets the target exhaust itself.",
        "badge": "thousand-cuts"
    },
    {
        "id": "duel-king",
        "name": "Legacy of the Duel King",
        "rarity": "legendary",
        "category": "pvp",
        "title": "Duel King",
        "flavor": "The challenge board has carried this name through two hundred victories. Every open challenge was answered in public.",
        "badge": "duel-king"
    },
    {
        "id": "village-reaper",
        "name": "Legacy of the Village Reaper",
        "rarity": "legendary",
        "category": "war",
        "title": "Village Reaper",
        "flavor": "War rolls credit this shinobi with a hundred enemy defeats and repeated captures at the front. Survivors recognize the field sign.",
        "badge": "village-reaper"
    },
    {
        "id": "bloodstained-path",
        "name": "Legacy of the Bloodstained Path",
        "rarity": "legendary",
        "category": "pvp",
        "title": "Bloodstained",
        "flavor": "The record follows one fighter through duels, hunts, and ambushes. Too many entries end with the other name crossed out.",
        "badge": "bloodstained-path"
    },
    {
        "id": "gatebreaker",
        "name": "Legacy of the Gatebreaker",
        "rarity": "legendary",
        "category": "pve",
        "title": "Gatebreaker",
        "flavor": "Hollow Gate keepers have replaced hinges, seals, and warning boards after this shinobi’s descents. The repair ledger is unusually thick.",
        "badge": "gatebreaker"
    },
    {
        "id": "trial-conqueror",
        "name": "Legacy of the Trial Conqueror",
        "rarity": "legendary",
        "category": "pve",
        "title": "Trial Conqueror",
        "flavor": "Dungeon wardens and tower clerks agree that this shinobi finishes trials after most candidates turn back.",
        "badge": "trial-conqueror"
    },
    {
        "id": "ancient-hunter",
        "name": "Legacy of the Ancient Hunter",
        "rarity": "legendary",
        "category": "pve",
        "title": "Ancient Hunter",
        "flavor": "Hunter Guild records show old beasts tracked through broken country and brought down without losing the trail.",
        "badge": "ancient-hunter"
    },
    {
        "id": "ashen-will",
        "name": "Legacy of the Ashen Will",
        "rarity": "legendary",
        "category": "village",
        "villageAffinity": "Ashen Leaf",
        "title": "Ashen Will",
        "flavor": "Ashen Leaf’s Branch Register shows the same shinobi funding repairs, holding threatened ground, and changing old practice when it failed people.",
        "badge": "ashen-will"
    },
    {
        "id": "storm-fang",
        "name": "Legacy of the Storm Fang",
        "rarity": "legendary",
        "category": "village",
        "villageAffinity": "Stormveil",
        "title": "Storm Fang",
        "flavor": "Stormveil’s Challenge Board records this shinobi answering raids and posted grievances in the open, usually before the rain cleared.",
        "badge": "storm-fang"
    },
    {
        "id": "frostbound-shield",
        "name": "Legacy of the Frostbound Shield",
        "rarity": "legendary",
        "category": "village",
        "villageAffinity": "Frostfang",
        "title": "Frostbound Shield",
        "flavor": "Frostfang rescue rolls place this shinobi at failed walls and frozen crossings. Every name assigned behind them returned to the Count.",
        "badge": "frostbound-shield"
    },
    {
        "id": "moonlit-oath",
        "name": "Legacy of the Moonlit Oath",
        "rarity": "legendary",
        "category": "village",
        "villageAffinity": "Moonshadow",
        "title": "Oath of the Moon",
        "flavor": "Moonshadow brokers trusted this shinobi with names that could ruin families. The sealed receipts show every trust returned intact.",
        "badge": "moonlit-oath"
    },
    {
        "id": "village-guardian",
        "name": "Legacy of the Village Guardian",
        "rarity": "legendary",
        "category": "support",
        "title": "Village Guardian",
        "flavor": "Village medics list hundreds of wounds prevented by this shinobi’s shields. Many civilians never knew how close the fighting came.",
        "badge": "village-guardian"
    },
    {
        "id": "oathkeeper",
        "name": "Legacy of the Oathkeeper",
        "rarity": "legendary",
        "category": "support",
        "title": "Oathkeeper",
        "flavor": "Witnesses keep finding this shinobi between danger and someone who cannot take the hit. The protected names keep changing.",
        "badge": "oathkeeper"
    },
    {
        "id": "mapless-one",
        "name": "Legacy of the Mapless One",
        "rarity": "legendary",
        "category": "explorer",
        "title": "The Mapless One",
        "flavor": "Survey teams use this shinobi’s trail marks beyond the last reliable chart. They also note a habit of checking the way home.",
        "badge": "mapless-one"
    },
    {
        "id": "shrine-seeker",
        "name": "Legacy of the Shrine Seeker",
        "rarity": "legendary",
        "category": "explorer",
        "title": "Shrine Seeker",
        "flavor": "Shrine keepers across the countries remember the same visitor clearing steps, copying inscriptions, and asking who still tends the place.",
        "badge": "shrine-seeker"
    },
    {
        "id": "beast-sovereign",
        "name": "Legacy of the Beast Sovereign",
        "rarity": "legendary",
        "category": "pets",
        "title": "Beast Sovereign",
        "flavor": "Stable hands report a tamer who wins hard bouts, brings injured companions home, and earns obedience without breaking temperament.",
        "badge": "beast-sovereign"
    },
    {
        "id": "silent-gambit",
        "name": "Legacy of the Silent Gambit",
        "rarity": "legendary",
        "category": "cards",
        "title": "The Silent Gambit",
        "flavor": "Card Hall ledgers show repeated wins from weak opening hands. The dealers blame patience and very careful counting.",
        "badge": "silent-gambit"
    },
    {
        "id": "warborn-banner",
        "name": "Legacy of the Warborn Banner",
        "rarity": "legendary",
        "category": "war",
        "title": "Bannerlord",
        "flavor": "War clerks record this shinobi carrying orders through raids, winning ground, and returning with the village banner still upright.",
        "badge": "warborn-banner"
    },
    {
        "id": "elemental-storm",
        "name": "Legacy of the Elemental Storm",
        "rarity": "rare",
        "category": "ninjutsu",
        "title": "Elemental Storm",
        "flavor": "Mission ledgers show five elemental natures used with the same disciplined timing.",
        "badge": "elemental-storm"
    },
    {
        "id": "burning-vanguard",
        "name": "Legacy of the Burning Vanguard",
        "rarity": "rare",
        "category": "ninjutsu",
        "villageAffinity": "Ashen Leaf",
        "title": "Burning Vanguard",
        "flavor": "Raid captains keep assigning this shinobi to the first breach because the entry is usually clear by the time the squad arrives.",
        "badge": "burning-vanguard"
    },
    {
        "id": "chakra-tempest",
        "name": "Legacy of the Chakra Tempest",
        "rarity": "rare",
        "category": "ninjutsu",
        "title": "Chakra Tempest",
        "flavor": "Damage reports describe unusually heavy ninjutsu placed close enough to allies that careful aim clearly mattered.",
        "badge": "chakra-tempest"
    },
    {
        "id": "stormcallers-path",
        "name": "Legacy of the Stormcaller's Path",
        "rarity": "rare",
        "category": "ninjutsu",
        "villageAffinity": "Stormveil",
        "title": "Stormcaller",
        "flavor": "Stormveil instructors remember this shinobi drilling ninjutsu outdoors through rain, crosswind, and live banner cables.",
        "badge": "stormcallers-path"
    },
    {
        "id": "shadow-strategist",
        "name": "Legacy of the Shadow Strategist",
        "rarity": "rare",
        "category": "genjutsu",
        "title": "Shadow Strategist",
        "flavor": "Opponents often misread the opening bow, the distance, or the first signal. By the correction, the genjutsu is already set.",
        "badge": "shadow-strategist"
    },
    {
        "id": "silent-fang",
        "name": "Legacy of the Silent Fang",
        "rarity": "rare",
        "category": "genjutsu",
        "villageAffinity": "Moonshadow",
        "title": "Silent Fang",
        "flavor": "Fight reports rarely record a warning before this shinobi’s genjutsu lands.",
        "badge": "silent-fang"
    },
    {
        "id": "dream-weaver",
        "name": "Legacy of the Dream Weaver",
        "rarity": "rare",
        "category": "genjutsu",
        "title": "Dream Weaver",
        "flavor": "Several enemies woke restrained instead of dead, while allies remember the same shinobi treating their wounds.",
        "badge": "dream-weaver"
    },
    {
        "id": "mirage-dancer",
        "name": "Legacy of the Mirage Dancer",
        "rarity": "rare",
        "category": "genjutsu",
        "title": "Mirage Dancer",
        "flavor": "Witnesses describe false footsteps, doubled silhouettes, and opponents striking safe ground while the real attack arrived elsewhere.",
        "badge": "mirage-dancer"
    },
    {
        "id": "iron-fist",
        "name": "Legacy of the Iron Fist",
        "rarity": "rare",
        "category": "taijutsu",
        "title": "Iron Fist",
        "flavor": "Training staff replaced enough split posts to start recording this shinobi’s practice hours separately.",
        "badge": "iron-fist"
    },
    {
        "id": "bloodied-knuckle",
        "name": "Legacy of the Bloodied Knuckle",
        "rarity": "rare",
        "category": "taijutsu",
        "title": "Bloodied Knuckle",
        "flavor": "Arena records show repeated armed opponents disarmed by a shinobi who entered with empty hands.",
        "badge": "bloodied-knuckle"
    },
    {
        "id": "mountain-stance",
        "name": "Legacy of the Mountain Stance",
        "rarity": "rare",
        "category": "taijutsu",
        "villageAffinity": "Frostfang",
        "title": "Mountain Stance",
        "flavor": "Witnesses remember this shinobi holding position through impacts that broke the ground around both feet.",
        "badge": "mountain-stance"
    },
    {
        "id": "crashing-wave",
        "name": "Legacy of the Crashing Wave",
        "rarity": "rare",
        "category": "taijutsu",
        "villageAffinity": "Stormveil",
        "title": "Crashing Wave",
        "flavor": "Stormveil bouts show the same rhythm: absorb the first rush, turn the footing, then drive the opponent back across the chalk.",
        "badge": "crashing-wave"
    },
    {
        "id": "warborn-blade",
        "name": "Legacy of the Warborn Blade",
        "rarity": "rare",
        "category": "bukijutsu",
        "title": "Warborn Blade",
        "flavor": "Weapon masters from two separate wars signed the same field assessment: reliable edge, disciplined recovery.",
        "badge": "warborn-blade"
    },
    {
        "id": "crimson-duelist",
        "name": "Legacy of the Crimson Duelist",
        "rarity": "rare",
        "category": "bukijutsu",
        "title": "Crimson Duelist",
        "flavor": "Challenge clerks record a wandering swordsman who accepts posted duels and leaves each result under a real name.",
        "badge": "crimson-duelist"
    },
    {
        "id": "quiet-scabbard",
        "name": "Legacy of the Quiet Scabbard",
        "rarity": "rare",
        "category": "bukijutsu",
        "title": "Quiet Scabbard",
        "flavor": "Most witnesses remember a single decisive draw, followed by the sound of the weapon returning to its sheath.",
        "badge": "quiet-scabbard"
    },
    {
        "id": "hunters-edge",
        "name": "Legacy of the Hunter's Edge",
        "rarity": "rare",
        "category": "bukijutsu",
        "title": "Hunter's Edge",
        "flavor": "Hunter Guild notes praise a polearm user who reads a charging beast, controls the distance, and ends the hunt cleanly.",
        "badge": "hunters-edge"
    },
    {
        "id": "proving-grounds",
        "name": "Legacy of the Proving Grounds",
        "rarity": "rare",
        "category": "pvp",
        "title": "Proven",
        "flavor": "The proving-ground ledger shows seventy-five wins and very few disputed results.",
        "badge": "proving-grounds"
    },
    {
        "id": "ranked-ascendant",
        "name": "Legacy of the Ranked Ascendant",
        "rarity": "rare",
        "category": "pvp",
        "title": "Ascendant",
        "flavor": "Ranked clerks watched this shinobi advance through active challengers instead of waiting for easier pairings.",
        "badge": "ranked-ascendant"
    },
    {
        "id": "giant-slayer",
        "name": "Legacy of the Giant Slayer",
        "rarity": "rare",
        "category": "pvp",
        "title": "Giant Slayer",
        "flavor": "Ten verified bouts ended with this shinobi defeating an opponent whose record looked stronger before the bell.",
        "badge": "giant-slayer"
    },
    {
        "id": "wall-of-defiance",
        "name": "Legacy of the Wall of Defiance",
        "rarity": "rare",
        "category": "pvp",
        "title": "The Wall",
        "flavor": "Opponents prepared ways around this guard and still spent the bout trying to move it.",
        "badge": "wall-of-defiance"
    },
    {
        "id": "hollow-seeker",
        "name": "Legacy of the Hollow Seeker",
        "rarity": "rare",
        "category": "pve",
        "title": "Hollow Seeker",
        "flavor": "Gate keepers logged ten completed descents and careful notes on the intake patterns encountered below.",
        "badge": "hollow-seeker"
    },
    {
        "id": "tower-climber",
        "name": "Legacy of the Endless Ascent",
        "rarity": "rare",
        "category": "pve",
        "title": "Endless Ascent",
        "flavor": "Tower clerks watched this shinobi clear twenty-five floors by conserving supplies and refusing unnecessary fights.",
        "badge": "tower-climber"
    },
    {
        "id": "mission-hound",
        "name": "Legacy of the Mission Hound",
        "rarity": "rare",
        "category": "pve",
        "title": "Mission Hound",
        "flavor": "Mission clerks know this shinobi by the stack of completed orders returned before midday.",
        "badge": "mission-hound"
    },
    {
        "id": "beast-tracker",
        "name": "Legacy of the Beast Tracker",
        "rarity": "rare",
        "category": "pve",
        "title": "Beast Tracker",
        "flavor": "Guild trackers trust this shinobi to identify a target from damaged brush, spoor, and one partial print.",
        "badge": "beast-tracker"
    },
    {
        "id": "boss-breaker",
        "name": "Legacy of the Boss Breaker",
        "rarity": "rare",
        "category": "pve",
        "title": "Boss Breaker",
        "flavor": "Great-beast teams record this shinobi staying in the fight long enough to create a hundred thousand points of damage.",
        "badge": "boss-breaker"
    },
    {
        "id": "dungeon-delver",
        "name": "Legacy of the Dungeon Delver",
        "rarity": "rare",
        "category": "pve",
        "title": "Dungeon Delver",
        "flavor": "Dungeon wardens keep finding this shinobi beyond doors their own survey teams had marked unopened.",
        "badge": "dungeon-delver"
    },
    {
        "id": "ashen-hearth",
        "name": "Legacy of the Ashen Hearth",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Ashen Leaf",
        "title": "Hearthkeeper",
        "flavor": "Ashen Leaf’s Register shows three weeks of duties kept and repairs funded without a public claim for credit.",
        "badge": "ashen-hearth"
    },
    {
        "id": "embers-discipline",
        "name": "Legacy of the Ember's Discipline",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Ashen Leaf",
        "title": "Ember Disciple",
        "flavor": "Ashen Leaf instructors remember a student who stayed after formal drills to repeat the parts that still failed.",
        "badge": "embers-discipline"
    },
    {
        "id": "tidebreaker",
        "name": "Legacy of the Tidebreaker",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Stormveil",
        "title": "Tidebreaker",
        "flavor": "Stormveil’s board records this shinobi carrying twenty-five war challenges back across the bell line.",
        "badge": "tidebreaker"
    },
    {
        "id": "thunder-raider",
        "name": "Legacy of the Thunder Raider",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Stormveil",
        "title": "Thunder Raider",
        "flavor": "Raid parties learned to watch for this shinobi at the front whenever Stormveil’s thunder covered an approach.",
        "badge": "thunder-raider"
    },
    {
        "id": "northern-fang",
        "name": "Legacy of the Northern Fang",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Frostfang",
        "title": "Northern Fang",
        "flavor": "Frostfang’s Count lists eight threatened sectors where this shinobi held until the missing names came home.",
        "badge": "northern-fang"
    },
    {
        "id": "winter-sentinel",
        "name": "Legacy of the Winter Sentinel",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Frostfang",
        "title": "Winter Sentinel",
        "flavor": "Watch captains recorded this shinobi completing the full northern rotation through cold, injury, and repeated attacks.",
        "badge": "winter-sentinel"
    },
    {
        "id": "veiled-lantern",
        "name": "Legacy of the Veiled Lantern",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Moonshadow",
        "title": "Veiled Lantern",
        "flavor": "Moonshadow route books show thirty quiet discoveries turned over to the people responsible for keeping those streets safe.",
        "badge": "veiled-lantern"
    },
    {
        "id": "midnight-errand",
        "name": "Legacy of the Midnight Errand",
        "rarity": "rare",
        "category": "village",
        "villageAffinity": "Moonshadow",
        "title": "Midnight Runner",
        "flavor": "Moonshadow’s sealed office has one hundred fifty completed orders under this mark, most returned without public notice.",
        "badge": "midnight-errand"
    },
    {
        "id": "hidden-path",
        "name": "Legacy of the Hidden Path",
        "rarity": "rare",
        "category": "explorer",
        "title": "Pathfinder",
        "flavor": "Survey notes show this shinobi checking side routes others dismissed, then marking which ones actually saved time.",
        "badge": "hidden-path"
    },
    {
        "id": "wayfarers-mark",
        "name": "Legacy of the Wayfarer's Mark",
        "rarity": "rare",
        "category": "explorer",
        "title": "Wayfarer",
        "flavor": "Road journals place this shinobi a thousand tiles from familiar ground, still carrying clear return marks.",
        "badge": "wayfarers-mark"
    },
    {
        "id": "rumor-chaser",
        "name": "Legacy of the Rumor Chaser",
        "rarity": "rare",
        "category": "explorer",
        "title": "Rumor Chaser",
        "flavor": "Tavern rumors sent this shinobi to forty sites. The returned notes separate what was true from what merely sold drinks.",
        "badge": "rumor-chaser"
    },
    {
        "id": "strangers-friend",
        "name": "Legacy of the Stranger's Friend",
        "rarity": "rare",
        "category": "explorer",
        "title": "Stranger's Friend",
        "flavor": "Couriers, medics, and road merchants in every country recognize this shinobi and can name a favor completed for them.",
        "badge": "strangers-friend"
    },
    {
        "id": "shielding-palm",
        "name": "Legacy of the Shielding Palm",
        "rarity": "rare",
        "category": "support",
        "title": "Shielding Palm",
        "flavor": "Combat medics credit this shinobi’s shields with stopping injuries their supplies could not have treated in time.",
        "badge": "shielding-palm"
    },
    {
        "id": "field-medic",
        "name": "Legacy of the Field Medic",
        "rarity": "rare",
        "category": "support",
        "title": "Field Medic",
        "flavor": "Field reports repeatedly place this medic at the first cry for help, treating whoever was bleeding before asking for a name.",
        "badge": "field-medic"
    },
    {
        "id": "purifying-light",
        "name": "Legacy of the Purifying Light",
        "rarity": "rare",
        "category": "support",
        "title": "Purifier",
        "flavor": "Patients remember poison drawn, genjutsu broken, and panic treated with the same steady hands.",
        "badge": "purifying-light"
    },
    {
        "id": "pack-leader",
        "name": "Legacy of the Pack Leader",
        "rarity": "rare",
        "category": "pets",
        "title": "Pack Leader",
        "flavor": "Stable hands watch this tamer read flattened ears, stiff tails, and warning growls before a companion has to bite.",
        "badge": "pack-leader"
    },
    {
        "id": "wild-heart",
        "name": "Legacy of the Wild Heart",
        "rarity": "rare",
        "category": "pets",
        "title": "Wild Heart",
        "flavor": "Expedition records show companions returning fed, treated, and willing to leave with the same tamer again.",
        "badge": "wild-heart"
    },
    {
        "id": "coliseum-tamer",
        "name": "Legacy of the Colosseum Tamer",
        "rarity": "rare",
        "category": "pets",
        "title": "Colosseum Tamer",
        "flavor": "Colosseum crowds know the companion’s name first. The tamer keeps pointing back to it after every win.",
        "badge": "coliseum-tamer"
    },
    {
        "id": "card-sharp",
        "name": "Legacy of the Card Sharp",
        "rarity": "rare",
        "category": "cards",
        "title": "Card Sharp",
        "flavor": "Card Hall dealers remember a neat shuffle, exact counts, and very few wagers made without a reason.",
        "badge": "card-sharp"
    },
    {
        "id": "tables-shadow",
        "name": "Legacy of the Table's Shadow",
        "rarity": "rare",
        "category": "cards",
        "title": "The Table's Shadow",
        "flavor": "Road games and formal halls both record this player taking a seat, stating the stake, and leaving with more wins than losses.",
        "badge": "tables-shadow"
    },
    {
        "id": "sector-warden",
        "name": "Legacy of the Sector Warden",
        "rarity": "rare",
        "category": "war",
        "title": "Sector Warden",
        "flavor": "War reports place this defender on eight sectors through the final signal, even after relief was late.",
        "badge": "sector-warden"
    },
    {
        "id": "banner-taker",
        "name": "Legacy of the Banner Taker",
        "rarity": "rare",
        "category": "war",
        "title": "Banner Taker",
        "flavor": "Quartermasters have logged enemy flags from twenty raids under this shinobi’s return receipts.",
        "badge": "banner-taker"
    },
    {
        "id": "siege-runner",
        "name": "Legacy of the Siege Runner",
        "rarity": "rare",
        "category": "war",
        "title": "Siege Runner",
        "flavor": "Commanders kept receiving orders through broken lines because this runner changed routes without losing the schedule.",
        "badge": "siege-runner"
    },
    {
        "id": "war-drummer",
        "name": "Legacy of the War Drummer",
        "rarity": "rare",
        "category": "war",
        "title": "War Drummer",
        "flavor": "Supply, signal, and casualty rolls from three wars all depend on work this shinobi kept moving behind the front.",
        "badge": "war-drummer"
    },
    {
        "id": "wandering-shinobi",
        "name": "Legacy of the Wandering Shinobi",
        "rarity": "basic",
        "category": "explorer",
        "title": "Wanderer",
        "flavor": "Four hundred explored tiles show a shinobi who kept reliable notes after the marked patrol roads ended.",
        "badge": "wandering-shinobi"
    },
    {
        "id": "village-veteran",
        "name": "Legacy of the Village Veteran",
        "rarity": "basic",
        "category": "village",
        "title": "Veteran",
        "flavor": "For ten days of village work, this shinobi showed up when assigned and stayed until the task was signed closed.",
        "badge": "village-veteran"
    },
    {
        "id": "proven-fighter",
        "name": "Legacy of the Proven Fighter",
        "rarity": "basic",
        "category": "pvp",
        "title": "Fighter",
        "flavor": "The arena ledger shows fifteen wins from a shinobi who kept answering the next bell.",
        "badge": "proven-fighter"
    },
    {
        "id": "road-worn-shinobi",
        "name": "Legacy of the Road-Worn Shinobi",
        "rarity": "basic",
        "category": "explorer",
        "title": "Road-Worn",
        "flavor": "Guild cobblers resoled the same boots through twenty-five completed hunts.",
        "badge": "road-worn-shinobi"
    },
    {
        "id": "ember-student",
        "name": "Legacy of the Ember Student",
        "rarity": "basic",
        "category": "ninjutsu",
        "title": "Ember Student",
        "flavor": "Instructors recorded the first unstable spark, then sixty field victories earned through deliberate control.",
        "badge": "ember-student"
    },
    {
        "id": "quiet-mind",
        "name": "Legacy of the Quiet Mind",
        "rarity": "basic",
        "category": "genjutsu",
        "title": "Quiet Mind",
        "flavor": "Sixty fights ended after this shinobi made the enemy trust the wrong sight or sound.",
        "badge": "quiet-mind"
    },
    {
        "id": "calloused-fist",
        "name": "Legacy of the Calloused Fist",
        "rarity": "basic",
        "category": "taijutsu",
        "title": "Calloused Fist",
        "flavor": "Training staff replaced several pairs of gloves while the same hands kept improving.",
        "badge": "calloused-fist"
    },
    {
        "id": "steel-apprentice",
        "name": "Legacy of the Steel Apprentice",
        "rarity": "basic",
        "category": "bukijutsu",
        "title": "Steel Apprentice",
        "flavor": "The first blade was borrowed and returned sharper. Later weapon loans came without hesitation.",
        "badge": "steel-apprentice"
    },
    {
        "id": "field-hand",
        "name": "Legacy of the Field Hand",
        "rarity": "basic",
        "category": "pve",
        "title": "Field Hand",
        "flavor": "Mission clerks count sixty completed orders, including the small jobs experienced shinobi often ignore.",
        "badge": "field-hand"
    },
    {
        "id": "beast-friend",
        "name": "Legacy of the Beast Friend",
        "rarity": "basic",
        "category": "pets",
        "title": "Beast Friend",
        "flavor": "Stable hands joke that the companion chose first. Ten duel wins suggest the arrangement works.",
        "badge": "beast-friend"
    },
    {
        "id": "table-regular",
        "name": "Legacy of the Table Regular",
        "rarity": "basic",
        "category": "cards",
        "title": "Table Regular",
        "flavor": "The Card Hall keeps a usual seat open for this player and has recorded ten wins from it.",
        "badge": "table-regular"
    },
    {
        "id": "lantern-bearer",
        "name": "Legacy of the Lantern Bearer",
        "rarity": "basic",
        "category": "support",
        "title": "Lantern Bearer",
        "flavor": "Patients remember this shinobi holding the lamp steady while treating wounds after dark.",
        "badge": "lantern-bearer"
    },
    {
        "id": "first-steps",
        "name": "Legacy of the First Steps",
        "rarity": "basic",
        "category": "explorer",
        "title": "Trailblazer",
        "flavor": "Ten discoveries began as wrong turns that this shinobi marked clearly for the next traveler.",
        "badge": "first-steps"
    },
    {
        "id": "honest-ryo",
        "name": "Legacy of the Honest Ryo",
        "rarity": "basic",
        "category": "village",
        "title": "Honest Hand",
        "flavor": "Village receipts show every due paid and several repairs funded without a name on the notice board.",
        "badge": "honest-ryo"
    },
    {
        "id": "steadfast-neighbor",
        "name": "Legacy of the Steadfast Neighbor",
        "rarity": "basic",
        "category": "village",
        "title": "Steadfast",
        "flavor": "Four defense rolls show this shinobi answering the alarm before asking whose street was threatened.",
        "badge": "steadfast-neighbor"
    }
] as const satisfies readonly ChronicleLegacySource[];
