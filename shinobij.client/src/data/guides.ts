// Static URL construction keeps the editorial catalog importable in Node tests
// while Vite still fingerprints every referenced asset for production.
const fieldManualHero = new URL("../assets/guides/field-manual.webp", import.meta.url).href;
const combatHero = new URL("../assets/guides/combat-tactics.webp", import.meta.url).href;
const worldHero = new URL("../assets/guides/living-world.webp", import.meta.url).href;
const companionHero = new URL("../assets/guides/companion-squad.webp", import.meta.url).href;
const missionHallHero = new URL("../assets/facilities/mission-hall.webp", import.meta.url).href;
const forgeHero = new URL("../assets/central/crafter-forge-v1.webp", import.meta.url).href;
const townHallHero = new URL("../assets/town-hall/town-hall-command-center.webp", import.meta.url).href;
const worldMapFigure = new URL("../assets/Maps/world_map.webp", import.meta.url).href;
const chronicleHero = new URL("../assets/card-clash/board.webp", import.meta.url).href;
const professionsHero = new URL("../assets/professions/overview.webp", import.meta.url).href;
const towersHero = new URL("../assets/towers/battle-towers-key-art-v1.webp", import.meta.url).href;
const gameHero = new URL("../assets/background-image.webp", import.meta.url).href;

export type GuideCategory =
    | "Start Here"
    | "Build Your Shinobi"
    | "World & Community"
    | "Companions & Collections"
    | "Harder Challenges"
    | "Game";

export type GuideBlock =
    | { type: "p"; text: string }
    | { type: "h"; text: string }
    | { type: "list"; items: string[] }
    | { type: "table"; caption: string; head: string[]; rows: string[][] }
    | { type: "callout"; tone: "tip" | "good" | "warn"; label: string; text: string }
    | { type: "figure"; src: string; alt: string; caption: string; objectPosition?: string };

export type GuideSection = {
    id: string;
    heading: string;
    blocks: GuideBlock[];
};

export type Guide = {
    id: string;
    category: GuideCategory;
    title: string;
    tagline: string;
    blurb: string;
    audience: string;
    readMinutes: number;
    reviewedAt: string;
    hero: string;
    heroAlt: string;
    heroPosition?: string;
    featured?: boolean;
    keywords: string[];
    quickTake: string[];
    sections: GuideSection[];
};

export const GUIDE_CATEGORIES: GuideCategory[] = [
    "Start Here",
    "Build Your Shinobi",
    "World & Community",
    "Companions & Collections",
    "Harder Challenges",
    "Game",
];

const FIRST_HOUR: Guide = {
    id: "first-hour",
    category: "Start Here",
    title: "Your First Hour",
    tagline: "Follow the Academy route from your first training session to your first trip beyond the village.",
    blurb: "A spoiler-light walkthrough of character creation, starter gear, the Academy spar, and your first objectives.",
    audience: "New shinobi",
    readMinutes: 6,
    reviewedAt: "August 2026",
    hero: fieldManualHero,
    heroAlt: "A lantern-lit shinobi field desk overlooking a mountain road at dawn.",
    featured: true,
    keywords: ["new player", "academy", "tutorial", "first hour", "logbook", "starter gear", "spar"],
    quickTake: [
        "Follow the Academy checklist in order; each step introduces a screen you will use later.",
        "For the Academy route, equip four usable jutsu and both starter items.",
        "If you lose the Academy spar, use the Hospital, adjust one thing, and try again.",
    ],
    sections: [
        {
            id: "before-you-step-out",
            heading: "Before you step outside",
            blocks: [
                { type: "p", text: "Your village choice is permanent. It determines your home and story, but it does not give a direct stat bonus. Choose the one that appeals to you. Shortly afterward, the opening sequence asks you to choose a companion." },
                { type: "p", text: "The opening sequence gives you some context, your companion, and a guided Academy route. Read the short coach prompts; they point to the same screens and systems you will use after the tutorial." },
                { type: "callout", tone: "tip", label: "A useful habit", text: "Open the Logbook whenever the next step feels unclear; it tracks your current objectives and useful next actions." },
            ],
        },
        {
            id: "academy-route",
            heading: "The Academy route, in order",
            blocks: [
                { type: "p", text: "The tutorial introduces one screen at a time. Complete the highlighted task before exploring the rest of the menus." },
                { type: "list", items: [
                    "Start a stat-training session.",
                    "Unlock one extra jutsu for free in the Training Hall.",
                    "Fill your four-jutsu combat loadout.",
                    "Spend your 20 starting stat points while you are on the Profile screen.",
                    "Equip the Rustfang Kunai and Shinobi Vest.",
                    "Win the Academy spar and follow its turn-by-turn coaching.",
                    "Recover in the Cafeteria if the spar cost you HP.",
                    "Claim the Academy Trial in the Mission Hall.",
                    "Open the Logbook to see your next goals.",
                    "Travel to any numbered sector from the World Map, then return to the village.",
                ] },
                { type: "p", text: "After that, take an E-rank mission or visit the Story Hall. At level 2, go to the Central Hub and use the Awakening Stone to roll your first random element." },
            ],
        },
        {
            id: "first-build",
            heading: "Build your first loadout",
            blocks: [
                { type: "p", text: "Choose one jutsu family first and raise its matching Offense stat. Then split the rest between its matching Defense stat and its two general stats: Ninjutsu uses Willpower and Speed; Genjutsu uses Intelligence and Willpower; Taijutsu uses Strength and Speed; Bukijutsu uses Intelligence and Strength." },
                { type: "p", text: "Chakra powers Ninjutsu and Genjutsu. Stamina powers Taijutsu and Bukijutsu. If every equipped jutsu drains the same pool, one expensive sequence can leave you unable to cast while that pool recovers." },
                { type: "callout", tone: "good", label: "Cover two ranges", text: "For the Academy, carry one action you can use up close and another that can reach a more distant target." },
            ],
        },
        {
            id: "when-you-get-stuck",
            heading: "When the first plan goes wrong",
            blocks: [
                { type: "p", text: "If a jutsu is greyed out, check its card for the reason: not enough AP or Chakra or Stamina, a target outside its range, a cooldown that is still active, or no valid target. The spar coach also walks you through Basic Attack, a ready jutsu, and using Wait when AP is low." },
                { type: "p", text: "If you are knocked out, you will wake up in the Hospital. Early on, use the free checkout after roughly a minute; a Healer can also help when one is available. Once you are back on your feet, change one part of the loadout and try again." },
                { type: "callout", tone: "warn", label: "Finish the return trip", text: "Travel is real time. Return to the village after visiting a numbered sector so the Academy coach can mark the final step complete." },
            ],
        },
    ],
};

const PROGRESSION: Guide = {
    id: "progression",
    category: "Start Here",
    title: "Levels, Ranks, and Daily Progress",
    tagline: "Levels follow the stat points you earn through training, fights, and field work.",
    blurb: "A practical overview of levels, ranks, training timers, jutsu mastery, missions, hunts, and daily limits.",
    audience: "New and returning players",
    readMinutes: 8,
    reviewedAt: "August 2026",
    hero: missionHallHero,
    heroAlt: "A mission hall lined with maps, ledgers, and hanging lanterns.",
    heroPosition: "center 56%",
    keywords: ["level", "rank", "training", "missions", "hunts", "mastery", "daily", "genin", "chunin"],
    quickTake: [
        "Level is derived from the stat points you have earned, so training is progression.",
        "The 15-minute timer earns the most base stat gain per hour; longer timers need less attention.",
        "Advancement pauses at levels 20 and 39 until you pass the required exam. Later ceremonies are optional.",
    ],
    sections: [
        {
            id: "levels-and-ranks",
            heading: "How levels and ranks work",
            blocks: [
                { type: "p", text: "Your level is derived from the stat points you have earned. Training and other activities add those points, and some rewards arrive unspent so you can choose where they go. There is no separate experience bar to fill." },
                { type: "table", caption: "Rank unlocks, exam pauses, and mastery caps", head: ["Level", "Rank", "What changes"], rows: [
                    ["1–14", "Academy Student", "Academy route; first Awakening at level 2; profession unlocks at 13; mastery cap 10"],
                    ["15–29", "Genin", "Progress pauses at level 20 until you pass the first advancement exam; mastery cap 20"],
                    ["30–49", "Chunin", "Progress pauses at level 39 until you pass the second advancement exam; mastery cap 30"],
                    ["50–79", "Jonin", "Mastery cap 50; Jonin ceremony is optional"],
                    ["80–100", "Special Jonin", "Late-game world content; Special Jonin ceremony is optional"],
                ] },
                { type: "p", text: "You become Genin at level 15 and Chunin at level 30. Your level cannot rise past 20 until you pass the Genin Advancement Exam, or past 39 until you pass the Chunin Advancement Exam. Jonin and Special Jonin ranks arrive automatically at levels 50 and 80; their ceremonies are optional." },
            ],
        },
        {
            id: "training-with-intent",
            heading: "Choosing a training timer",
            blocks: [
                { type: "p", text: "Training grows the selected stat while you are away. At level 1 the rookie boost is five times the base gain, then it eases down until level 35. Use those early gains to establish the core of your build." },
                { type: "table", caption: "Base stat gain before the rookie boost and any village, clan, or doctrine bonus", head: ["Session", "Base gain", "Stamina cost", "Best for"], rows: [
                    ["15 minutes", "+3", "5", "Active play and the best hourly rate"],
                    ["1 hour", "+10", "15", "A normal session or short break"],
                    ["4 hours", "+38", "35", "An afternoon away"],
                    ["8 hours", "+72", "60", "Work, sleep, or a long absence"],
                ] },
                { type: "p", text: "Short sessions edge out long ones per hour, but an expired timer earns nothing extra. The best timer is the one you will remember to restart. Consistency beats setting alarms for a tiny efficiency gain." },
            ],
        },
        {
            id: "daily-loop",
            heading: "A practical daily loop",
            blocks: [
                { type: "figure", src: missionHallHero, alt: "The Mission Hall interior where daily missions and the Academy Trial are claimed.", caption: "Start at the Mission Hall, choose work that fits the time you have, and plan the rest of the session from there." },
                { type: "list", items: [
                    "Restart training first, so the timer runs while you do everything else.",
                    "Complete up to 20 missions each UTC day. Choose the highest difficulty you can clear reliably.",
                    "Use the Hunter Guild when you want combat materials. You begin with 20 hunts per day, and each Hunter Rank adds one more, up to 25.",
                    "Review Posted Contracts on the World Map if you are already traveling; six rotate each UTC day.",
                    "Recover, bank, sell, craft, or adjust your loadout before committing to a boss or PvP queue.",
                ] },
                { type: "callout", tone: "tip", label: "Keep it manageable", text: "You do not need to clear every daily counter. Choose the activities whose rewards you need most." },
            ],
        },
        {
            id: "jutsu-mastery",
            heading: "How jutsu mastery increases",
            blocks: [
                { type: "p", text: "Ryo lessons in the Jutsu Training Hall stop at mastery 30, subject to your rank cap. Honor Seal Training can carry a technique from 30 to 40. Neither option raises mastery above 40; before planning for 41–50, confirm that the game currently lists another source." },
                { type: "table", caption: "Maximum jutsu mastery used in combat", head: ["Rank", "Effective mastery cap"], rows: [
                    ["Academy Student", "10"],
                    ["Genin", "20"],
                    ["Chunin", "30"],
                    ["Jonin and Special Jonin", "50"],
                ] },
                { type: "p", text: "Your rank limits how much jutsu mastery counts in combat. Train several techniques you use regularly instead of spending every resource on one finisher." },
            ],
        },
    ],
};

const COMBAT: Guide = {
    id: "combat",
    category: "Build Your Shinobi",
    title: "Combat Fundamentals: Turns, Range, and Resources",
    tagline: "Position, range, and resource management decide most fights before the damage roll does.",
    blurb: "Action Points, range, resources, statuses, terrain, and the choices that carry from Academy sparring to ranked teams.",
    audience: "All shinobi",
    readMinutes: 9,
    reviewedAt: "August 2026",
    hero: combatHero,
    heroAlt: "Two shinobi measuring distance across a rain-dark citadel arena.",
    heroPosition: "center 48%",
    keywords: ["combat", "ap", "action points", "range", "chakra", "stamina", "pvp", "ranked", "2v2", "status"],
    quickTake: [
        "You normally have 100 Action Points each turn. Review action costs before moving.",
        "Control the distance so your opponent must spend AP reaching their preferred range.",
        "Carry a reliable attack, a second range option, and one defensive or cleansing answer.",
    ],
    sections: [
        {
            id: "read-the-board",
            heading: "Plan the turn before you move",
            blocks: [
                { type: "p", text: "At the start of each turn, count the tiles between you and your opponent and note any obstacles or active zones. Then check your AP, Chakra or Stamina, and cooldowns before choosing an action." },
                { type: "p", text: "Moving, attacking, healing, cleansing, and using jutsu all draw from the same 100 AP. Stun lowers that turn to 60 AP. Every action card shows its current cost. Custom techniques made in the Bloodline Maker use one of two base types: 40 AP utility or 60 AP damage. Other actions show their own costs." },
                { type: "callout", tone: "tip", label: "If an action is greyed out", text: "Check AP, range, cooldown, Chakra or Stamina, and valid targets." },
            ],
        },
        {
            id: "resources-and-range",
            heading: "Using range to control AP",
            blocks: [
                { type: "p", text: "Ninjutsu and Genjutsu draw from Chakra; Taijutsu and Bukijutsu draw from Stamina. Both pools grow with level and recover during combat, but an expensive sequence can leave you with nothing affordable to cast. Keep at least one lower-cost jutsu in the loadout." },
                { type: "h", text: "When you want to close" },
                { type: "p", text: "Do not spend all your AP moving into attack range. Either stop short enough that the opponent must spend AP approaching, or keep enough AP to attack as soon as you arrive." },
                { type: "h", text: "When you want to kite" },
                { type: "p", text: "When kiting, attack first when possible, then move back out of the opponent's strongest range. Carry a second ranged option so one cooldown does not shut down your plan." },
            ],
        },
        {
            id: "turn-plan",
            heading: "Choose one priority each turn",
            blocks: [
                { type: "list", items: [
                    "Pressure: deal damage or make the opponent use a defensive option.",
                    "Setup: apply a status or move into position for the next turn.",
                    "Stabilize: shield, cleanse, reduce damage, or move to a safer range.",
                    "Finish: use the high-impact jutsu you saved once the opponent has no good answer.",
                ] },
                { type: "p", text: "Trying to do all four at once produces half-finished turns. If Wait preserves a better position or lets a resource pool recover, use it." },
                { type: "callout", tone: "warn", label: "Common mistake", text: "Do not spend your last AP stepping into an opponent's best range. That leaves you exposed to a full counterattack." },
            ],
        },
        {
            id: "statuses-and-loadouts",
            heading: "Balance the four loadout slots",
            blocks: [
                { type: "p", text: "A balanced loadout usually needs an opener, a reliable attack, a defensive or mobility option, and a finisher. A shield, movement effect, or Cleanse often helps more than a fourth damage jutsu." },
                { type: "p", text: "Read status timing closely. Damage over time is most valuable when it forces the opponent to spend AP on Cleanse, and a shield must be active before the heavy hit lands. Use movement when it changes range, cover, or who can be targeted." },
            ],
        },
        {
            id: "multiplayer",
            heading: "From practice to ranked teams",
            blocks: [
                { type: "p", text: "AI practice and direct player spars in the Battle Arena do not change your ranked rating. Team Arena is a four-player 2v2 mode with balanced teams, no consumables, and no rating, currency, or progression rewards. Queue solo; matchmaking finds three other live fighters and balances the teams." },
                { type: "p", text: "Ranked 1v1 is the individual ladder. Ranked 2v2 uses a chosen partner who must accept, while each player keeps a separate 2v2 rating. Matchmaking uses the pair's average rating. Before a team match starts, agree on one target and decide who will save a defensive or Cleanse option." },
                { type: "callout", tone: "tip", label: "Check before queuing", text: "These activities can close temporarily. Check the Arena District for their live availability." },
            ],
        },
    ],
};

const BUILDS: Guide = {
    id: "builds",
    category: "Build Your Shinobi",
    title: "Building a Loadout That Holds Up",
    tagline: "Choose four jutsu that cover your normal rotation, weak range, defense, and finisher.",
    blurb: "Jutsu loadouts, mastery, Awakening, Bloodline forging, gear, crafting, and late-game named equipment.",
    audience: "Growing and veteran",
    readMinutes: 10,
    reviewedAt: "August 2026",
    hero: forgeHero,
    heroAlt: "A dark cedar forge filled with tools, steel, and a restrained blue flame.",
    heroPosition: "center 54%",
    keywords: ["build", "jutsu", "bloodline", "awakening", "gear", "forge", "named weapon", "mastery", "loadout"],
    quickTake: [
        "Build around a repeatable turn before adding a high-cost finisher.",
        "Awakenings at levels 2 and 20 are free; forged Bloodlines cost rare materials, so plan them carefully.",
        "The Bloodline Maker assigns a point cost to every advantage. If the budget turns red, simplify the technique before saving it.",
    ],
    sections: [
        {
            id: "loadout-first",
            heading: "Plan your core rotation",
            blocks: [
                { type: "p", text: "Choose one plan your loadout can repeat: attack safely from range, stay close and drain Stamina, apply a status before a heavy attack, or defend while a key jutsu comes off cooldown. If one of the four techniques does not support that plan, replace the one you use least." },
                { type: "list", items: [
                    "One lower-cost action you can use regularly.",
                    "One tool for the range where your dependable action fails.",
                    "One defensive, movement, or control answer.",
                    "One finisher or payoff that benefits from the setup created by the other three.",
                ] },
                { type: "p", text: "Train mastery on the jutsu you use regularly. A maxed technique outside your four equipped slots contributes nothing to the current fight." },
            ],
        },
        {
            id: "awakening-and-forging",
            heading: "Awakenings and forged Bloodlines",
            blocks: [
                { type: "p", text: "At levels 2 and 20, claim a free random element roll at the Awakening Stone. Once you have two elements, 10 Fate Shards rerolls the primary element and keeps the secondary; 15 rerolls both. Try an unfamiliar result in a few fights before spending Fate Shards to replace it." },
                { type: "table", caption: "Forged Bloodline ranks at the Central Hub Awakening Stone", head: ["Rank", "Jutsu", "Build points", "Forge cost"], rows: [
                    ["B", "4", "7", "100 Bone Charms"],
                    ["A", "5", "10", "100 Aura Stones"],
                    ["S", "5", "11", "100 Mythic Seals"],
                ] },
                { type: "p", text: "Higher ranks provide more jutsu and build points, but a focused B-rank kit can still outperform an unfocused S-rank kit." },
            ],
        },
        {
            id: "builder-budget",
            heading: "What makes a technique cost more",
            blocks: [
                { type: "p", text: "Every custom technique starts as either 40 AP utility or 60 AP damage. Range 5, Circle Movement, Instant Effect, AOE Movement, AOE Burst, Nuke damage, and higher-cost tags add build points. Use the itemized total in the Bloodline Maker because balance values can change." },
                { type: "p", text: "Tags with adjustable percentages offer 25% or 30% on B- and A-rank Bloodlines, and 30% or 35% on S-rank Bloodlines. Pierce is different: its damage scales with offense and mastery and is capped instead of using one fixed damage number. Choose each tag for a job; filling every slot is not automatically stronger." },
                { type: "callout", tone: "tip", label: "Check the core idea", text: "Temporarily remove a tag and check whether the technique still fills its intended role. If it does not, simplify the plan before adding more effects." },
            ],
        },
        {
            id: "gear-and-crafting",
            heading: "Choosing gear and crafting materials",
            blocks: [
                { type: "p", text: "Use the Shop and Grand Marketplace for catalog purchases, and the Crafter when hunt or dungeon materials can become useful gear or consumables. Direct player transfers send currency, not items. See Choosing a Profession for banking and transfer rules." },
                { type: "p", text: "Choose gear to solve the problem you lose to. Add defense if you fall before your setup works, and improve damage or reach if opponents can safely stay away. Equip consumables for the activity ahead: healing for long runs, and smoke or control for dangerous objectives." },
                { type: "h", text: "Named equipment" },
                { type: "p", text: "At level 90, you can forge named weapons and armor. Each item costs exactly 1,000 Forge Points. Bone Charms count for 2 points, Fate Shards 5, Aura Stones 15, and Mythic Seals 75. Because the forge uses whole materials, your inventory must be able to form an exact 1,000-point payment." },
                { type: "callout", tone: "warn", label: "Inventory discipline", text: "Do not sell a rare material only because its current tooltip looks unhelpful. Hunter rank-ups, Bloodline forging, Hollow Gate keys, and named gear use different currencies and recipes, so check the relevant screen first." },
            ],
        },
    ],
};

const WORLD: Guide = {
    id: "world",
    category: "World & Community",
    title: "Travel, Exploration, and World Events",
    tagline: "Roads take time, popular hunting grounds get worked over, and other players leave evidence behind.",
    blurb: "Travel, sector richness, contracts, weather, night, wanderers, duel scars, Sunscar, and the two shared world crises.",
    audience: "All shinobi",
    readMinutes: 9,
    reviewedAt: "August 2026",
    hero: worldHero,
    heroAlt: "A lone shinobi looking across connected mountain roads, villages, and a distant storm.",
    heroPosition: "center 52%",
    keywords: ["world", "map", "sector", "travel", "weather", "contracts", "night", "crisis", "wanderer", "sunscar"],
    quickTake: [
        "The map has 66 ordinary sectors plus special destinations. You do not need to memorize them.",
        "If a sector is Picked Clean Today, move elsewhere or wait for the daily reset.",
        "Travel takes time, but a traveling shinobi cannot be attacked on the road.",
    ],
    sections: [
        {
            id: "reading-the-map",
            heading: "Learn the map by route",
            blocks: [
                { type: "figure", src: worldMapFigure, alt: "The world map showing villages, connecting roads, regions, and sector destinations.", caption: "Roads show which sectors connect and how long each trip takes." },
                { type: "p", text: "The world is made of connected sectors with different biomes, weather, ownership, events, and travel times. Start with nearby roads and use the World Map to find sectors with more exploration remaining." },
                { type: "p", text: "Travel takes the duration shown, and you cannot be attacked while in transit. Before leaving, confirm the destination, biome, and any UTC night requirement." },
            ],
        },
        {
            id: "shared-ground",
            heading: "Shared exploration and sector depletion",
            blocks: [
                { type: "p", text: "Each sector draws from a shared daily exploration pool. As players use that pool, the panel marks the sector Rich, Worked Over, or Picked Clean Today. Owners receive an exploration advantage, but everyone draws from the same finite pool. It resets with the UTC day." },
                { type: "p", text: "Recent shinobi duels can leave scars for up to 24 hours. Wanderers, merchants, medics, patrols, trackers, couriers, and Contract Hunters also move through the world. Read the sector panel before clicking Explore; the best choice may be to speak, track, wait, or leave." },
                { type: "callout", tone: "good", label: "Before leaving", text: "Review depletion, night conditions, and current visitors before leaving a quiet sector." },
            ],
        },
        {
            id: "contracts-weather-night",
            heading: "Contracts, weather, and the UTC clock",
            blocks: [
                { type: "p", text: "Six sector contracts are posted each day. Most ask for 8 to 12 successful explores in a particular kind of place; some progress only at night. Night runs from 20:00 to 05:00 UTC, and Posted Contracts reset at midnight UTC." },
                { type: "p", text: "Scheduled weather rotates each UTC day. A clan that owns a sector can set local weather there, which can change elemental matchups. Review the sector's current modifier before changing a build that worked yesterday." },
                { type: "callout", tone: "tip", label: "Sunscar route", text: "The permanent Sunscar Festival entrance is in sector 54. Its events and wagers are optional, so finish any time-sensitive contract before taking the detour." },
            ],
        },
        {
            id: "world-crises",
            heading: "Shared world crises",
            blocks: [
                { type: "p", text: "During the Fourfold Breach, each village fills its own defense target. The crisis ends after all four villages finish, and the leaderboard records the top contributors." },
                { type: "p", text: "During Hollow Gate Reckoning, choose the shinobi front or bring a ready team to the companion front. Progress on either front contributes to your village's target, and all four villages must finish their response." },
                { type: "callout", tone: "warn", label: "Prepare before entering", text: "Recover, repair your loadout, and confirm companion availability before committing an attempt." },
            ],
        },
    ],
};

const CLANS_AND_WAR: Guide = {
    id: "clans-and-war",
    category: "World & Community",
    title: "Clans, Village War & Shared Stores",
    tagline: "Clans and villages run better when members know what is being built, supplied, and defended.",
    blurb: "Clan growth, boss operations, war modes, shared stores, supplies, territory, and structures.",
    audience: "Growing and veteran",
    readMinutes: 10,
    reviewedAt: "August 2026",
    hero: townHallHero,
    heroAlt: "A village command hall with maps, supply ledgers, and a council table.",
    heroPosition: "center 50%",
    keywords: ["clan", "war", "village war", "stores", "provisions", "materials", "clan boss", "territory", "kage"],
    quickTake: [
        "Clan War is a focused rivalry; Village War is a 72-hour regional campaign with its own map and supply system.",
        "Members gather supplies and fight; village leadership decides where shared resources go.",
        "An unfed garrison receives only half of its Watchtower bonus above normal defense.",
    ],
    sections: [
        {
            id: "a-clan-is-more-than-chat",
            heading: "Using the Clan Hall",
            blocks: [
                { type: "p", text: "The Clan Hall groups four kinds of work: roster and communication; treasury, stores, boosts, and upgrades; missions and boss operations; and war, rankings, and territory. You do not need to learn every tab immediately. Ask what the clan is building or defending this week, then help with that." },
                { type: "p", text: "Clan growth unlocks better Exchange tiers at Clan Levels 1, 7, 15, 25, and 40. Ask which shared upgrade or goal comes next before choosing where to contribute." },
                { type: "callout", tone: "tip", label: "Ask what the clan needs", text: "‘What are we building or defending this week?’ gives leaders enough context to suggest a useful task." },
            ],
        },
        {
            id: "clan-war",
            heading: "How Clan War damage works",
            blocks: [
                { type: "p", text: "Leaders declare the conflict, but the roster wins it through shinobi duels, paired 2v2 fights, companion battles, and Chronicle Showdown. Because each mode deals different war-strength damage, assign members to the formats they play best." },
                { type: "p", text: "Read the Clan War Manual before a declaration. War Room levels and doctrine can change starting durability, and the manual lists the current limits on active wars, rematches, and unfinished battles." },
                { type: "callout", tone: "warn", label: "Answer pending challenges", text: "A pending challenge has a one-hour response window, and ignoring it costs the defending clan war strength. An unfilled 2v2 queue expires harmlessly, and leaving that queue does not spend war strength." },
            ],
        },
        {
            id: "village-war",
            heading: "How Village War works",
            blocks: [
                { type: "p", text: "Village War runs for 72 hours and scores action across shinobi, companion, and Chronicle modes. Terrain, mercenary bands, structures, ownership, and supplies all shape the campaign. The Kage directs strategic spending; the Kage and ANBU can manage their own village's garrison in a contested sector. Everyone else keeps the stores supplied and fights in the sectors leadership marks as priorities." },
                { type: "list", items: [
                    "Provisions come from ration packs cooked in the Cafeteria and donated through Town Hall. They feed mercenaries, garrisons, and active sectors.",
                    "Materials come from donated hunt materials and relics. The Supply Depot converts them into War Resources and supports advanced structures.",
                    "At the daily UTC store update, Provisions lose 5%, so plan donations around that loss.",
                    "Without Provisions, a garrison keeps its normal defense but receives only half of its Watchtower bonus.",
                ] },
                { type: "p", text: "Most players inspect and donate through Town Hall. Before traveling, review the shared stores there and the leadership plan on the war map." },
            ],
        },
        {
            id: "clan-boss",
            heading: "Preparing for the Clan Boss",
            blocks: [
                { type: "p", text: "The weekly Clan Boss has one shared health pool for the clan. Parties can bring one to four players, and contribution includes damage, healing, shielding, cleanses, objectives, and survival." },
                { type: "p", text: "Prepare supplies in the Crafter, agree on roles, and confirm loadouts before entering. A smaller coordinated group can be more effective than a full party without assigned roles. Weekly rewards scale with recorded contribution." },
            ],
        },
    ],
};

const COMPANIONS: Guide = {
    id: "companions",
    category: "Companions & Collections",
    title: "Raise a Squad You Trust",
    tagline: "Care for companions at Pet Home, then build different teams for Showdown, Warfront, ranked play, and expeditions.",
    blurb: "Collection, Sanctuary, training, evolution, breeding, expeditions, Showdown, Warfront, Gauntlet, and ranked pet play.",
    audience: "All companion keepers",
    readMinutes: 10,
    reviewedAt: "August 2026",
    hero: companionHero,
    heroAlt: "A shinobi handler preparing four distinct companion beasts in a lantern-lit sanctuary.",
    heroPosition: "center 44%",
    keywords: ["pets", "companions", "sanctuary", "breeding", "expedition", "showdown", "warfront", "gauntlet", "pet arena"],
    quickTake: [
        "Your carried roster holds four companions, or six with supporter capacity; Sanctuary keeps overflow safe.",
        "In Showdown, you choose actions, swaps, and targets each turn.",
        "Warfront requires four available companions, so build for role coverage instead of relying on one carry.",
    ],
    sections: [
        {
            id: "home-and-sanctuary",
            heading: "Pet Home, the carried roster, and Sanctuary",
            blocks: [
                { type: "p", text: "Pet Home contains Collection, Pet Yard, Pet Arena, Sanctuary, and the Breeding Barn. The carried roster holds four companions by default and six with supporter capacity. Companions in Sanctuary are stored safely but are not available for active squads." },
                { type: "p", text: "The Pet Yard handles training, treats, evolution, and release. Only the five starter species can evolve right now. At level 50, use an Awakening Stone for the first evolution; at level 90, use an Ascension Stone for the second." },
                { type: "p", text: "You can run one breeding pair at a time. Parents must be different carried companions of the same element, level 50 or higher, available, and each must have a breeding use remaining. After the 24-hour pairing, complete the egg's care, adventure, and elemental bonds before hatching it. If the carried roster is full, the newborn goes to Sanctuary." },
                { type: "callout", tone: "warn", label: "Availability matters", text: "A companion that is breeding, training, or away on an expedition cannot join a combat squad. Confirm status before building a Warfront formation." },
            ],
        },
        {
            id: "showdown",
            heading: "Playing a Showdown turn",
            blocks: [
                { type: "p", text: "Showdown supports 1v1, 2v2, and 3v3 formats, with two reserves in each. You choose actions, swaps, and targets. Training Grounds and current Colosseum Showdowns use AI opponents, and those matches have no turn timer. Weather, traits, roles, conditions, and elemental matchups still change how a companion performs." },
                { type: "p", text: "Each active companion has stamina. Rest restores stamina but does not heal, so resting at low health is a risk. At round 25, surviving companions, remaining HP, stamina, and the speed tiebreak decide the result." },
                { type: "list", items: [
                    "Lead with a flexible companion that can handle several matchups.",
                    "Keep a reserve for a bad elemental matchup or a disabling condition.",
                    "Overdraft stamina only when the extra damage can secure a knockout or decisive advantage.",
                    "Practice is unlimited but reward-free. Colosseum wins and ranked ladders award progression.",
                ] },
            ],
        },
        {
            id: "warfront",
            heading: "Setting up a Warfront squad",
            blocks: [
                { type: "p", text: "Hollow Warfront is always 4v4 across three lanes. Choose an opening formation and team doctrine, then fight around objectives while the rival squad follows its selected doctrine. Exactly four available carried companions are required." },
                { type: "p", text: "Cover four needs when you build the formation: holding a lane, rotating between lanes, pressuring objectives, and turning a lead into objective control. Elemental coverage matters, but objectives decide the Warfront even when one companion wins its individual duel." },
                { type: "callout", tone: "good", label: "Avoid role overlap", text: "If two companions compete for the same lane and target or run low on stamina together, change a role or swap one out." },
            ],
        },
        {
            id: "rest-of-the-roster",
            heading: "Gauntlet, ladders, expeditions, and growth",
            blocks: [
                { type: "p", text: "The Pet Gauntlet uses a fresh draft of temporary companions instead of your owned roster. Those companions last only for that run." },
                { type: "p", text: "Pet Colosseum ladder rating comes only from its separate live 1v1 ranked queue. Tactical challenges use stored four-companion defenses, including while the defender is offline. Direct Pet Arena challenges are unranked practice." },
                { type: "p", text: "Expeditions unlock for a companion at level 20. Scout lasts 45 minutes, Forage lasts two hours, and Ruins lasts four. Companions below their level cap gain XP and stats. Pet Tamers also earn the full ryo, material, and profession XP rewards." },
            ],
        },
    ],
};

const CHRONICLE: Guide = {
    id: "chronicle-showdown",
    category: "Companions & Collections",
    title: "Chronicle Showdown: Rules and Deck Basics",
    tagline: "Build a legal deck and learn what happens in each phase.",
    blurb: "Deck rules, Tribute summons, Snares, elemental matchups, target previews, packs, practice, and Legacy progress.",
    audience: "Collectors and tacticians",
    readMinutes: 8,
    reviewedAt: "August 2026",
    hero: chronicleHero,
    heroAlt: "A Shinobi Chronicle Showdown board with opposing fields and card zones.",
    heroPosition: "center center",
    keywords: ["chronicle", "showdown", "cards", "deck", "snare", "tribute", "element", "packs", "living chronicle"],
    quickTake: [
        "Bring exactly 40 cards, open with five, and protect 8,000 Health.",
        "Draw, Standby, and End are automatic; you act during Main and Battle.",
        "AI wins update your Showdown record; qualifying AI and free-play wins can count toward Legacy.",
    ],
    sections: [
        {
            id: "what-you-are-playing",
            heading: "Showdown and the Living Chronicle",
            blocks: [
                { type: "p", text: "Shinobi Chronicle Showdown is the tactical duel fought with a forty-card deck. The Living Chronicle in the Story Hall is different: it records story progress, Showdown and companion wins, mission and exploration totals, recent village and clan wars, clan contribution, and Legacy." },
                { type: "figure", src: chronicleHero, alt: "A Showdown board divided into player and opponent fields with clear summon, set, and battle areas.", caption: "The board keeps both fields visible. Read the target preview before committing a summon or attack." },
            ],
        },
        {
            id: "turn-structure",
            heading: "Turn structure",
            blocks: [
                { type: "p", text: "Draw, Standby, and End resolve automatically. In Main, you may Summon or Set once for the turn, play support, and arrange the field. In Battle, choose attacks and targets. Smart Phase Assist advances routine phases, but you still choose every summon, set, and attack." },
                { type: "p", text: "Level 1–4 Monsters need no Tribute, level 5–6 need one, and level 7–8 need two. Snares must be Set for a turn before they can respond, and only one matching Snare response can fire. Target badges show the expected result before you confirm." },
                { type: "callout", tone: "tip", label: "Before entering Battle", text: "Confirm that you used the intended normal Summon, filled the right zone, and Set the response you want." },
            ],
        },
        {
            id: "elements-and-field",
            heading: "Elemental advantage and Field Jutsu",
            blocks: [
                { type: "p", text: "The wheel is Fire over Wind, Wind over Lightning, Lightning over Earth, Earth over Water, and Water over Fire. With no Field Jutsu active, advantage adds 200 to the ATK or DEF used in that battle. A Field Jutsu replaces the wheel instead of stacking with it: its favored element gains 300 ATK and the opposed element loses 200 ATK." },
                { type: "p", text: "Include enough elemental variety that one common matchup cannot shut down the deck. Prioritize a reliable summon curve and cards that support the same strategy over perfect elemental coverage." },
            ],
        },
        {
            id: "collection-and-modes",
            heading: "Choosing packs and practice modes",
            blocks: [
                { type: "p", text: "Standard packs contain five cards and cost ryo. Elite and Legendary packs contain one card each, cost Fate Shards, and use the rarity guarantees shown in the Shop. Open packs that can improve a specific slot in your deck." },
                { type: "p", text: "Use AI spar to test sequencing and free-play PvP to practice against another player without risking rating. Neither awards ryo or rating. AI wins update your Showdown record, and qualifying AI or free-play wins can count toward Legacy. Clan and Village War can also use Showdown results toward their objectives." },
            ],
        },
    ],
};

const PROFESSIONS_AND_ECONOMY: Guide = {
    id: "professions-economy",
    category: "Build Your Shinobi",
    title: "Choosing a Profession",
    tagline: "Healer, Vanguard, and Pet Tamer each advance through different activities.",
    blurb: "Profession ranks and Mastery, money habits, the Bank, Hospital, Grand Marketplace, hunting, and crafting.",
    audience: "Level 13+",
    readMinutes: 8,
    reviewedAt: "August 2026",
    hero: professionsHero,
    heroAlt: "Three shinobi representing the Healer, Vanguard, and Pet Tamer professions.",
    heroPosition: "center 42%",
    keywords: ["profession", "healer", "vanguard", "pet tamer", "ryo", "bank", "hospital", "marketplace", "crafting"],
    quickTake: [
        "Healers treat players in the Hospital, Vanguards earn rewards through PvP and war, and Pet Tamers improve companion training and expedition rewards.",
        "Profession rank grows through rank 10; profession XP earned after that becomes Mastery.",
        "Budget separately for everyday spending, planned upgrades, and rare materials.",
    ],
    sections: [
        {
            id: "three-paths",
            heading: "Compare the three professions",
            blocks: [
                { type: "table", caption: "The three profession paths", head: ["Profession", "What the work feels like", "Where it matters"], rows: [
                    ["Healer", "Find admitted allies, restore them, and improve medical support", "Hospital, Clan Boss support, village recovery"],
                    ["Vanguard", "Seek real-player fights and front-line war work", "PvP, Honor Seals, clan and village wars"],
                    ["Pet Tamer", "Train, deploy, and support companions over time", "Companion PvE, expeditions, Clan Boss support"],
                ] },
                { type: "p", text: "Professions unlock at level 13 and advance through ten ranks. After rank 10, further profession XP earns Mastery points. Changing later requires a Profession change approval from the Grand Marketplace and resets profession rank, XP, and Mastery." },
            ],
        },
        {
            id: "profession-work",
            heading: "How each profession advances",
            blocks: [
                { type: "p", text: "Healers restore players from the Hospital's admitted list. Vanguards earn Honor Seals from eligible real-player kills, including war targets. Pet Tamers receive bonuses from companion training, PvE, and expeditions." },
                { type: "p", text: "Clan Boss actions can also award profession XP through damage, healing, shielding, cleansing, objectives, and survival." },
            ],
        },
        {
            id: "ryo-habits",
            heading: "Saving and spending ryo",
            blocks: [
                { type: "list", items: [
                    "Carry enough for the next planned purchase and recovery; bank the rest.",
                    "Bank interest requires banked ryo and at least one Town Hall Bank upgrade. A new claim becomes available after every full 24-hour interval and must be collected manually.",
                    "Direct transfers are permanent and taxed. They move currency only and do not protect item trades.",
                    "Compare item stats and effects as well as price when using the Shop or Grand Marketplace.",
                ] },
                { type: "callout", tone: "tip", label: "Budget categories", text: "Keep separate amounts for everyday spending, your next rank or upgrade, and rare materials reserved for a known recipe." },
            ],
        },
        {
            id: "materials-have-stories",
            heading: "Planning material use",
            blocks: [
                { type: "p", text: "Hunt materials are used for Hunter Rank, ordinary crafting, pet treats, and village stores. Hollow Gate keys and named commissions use different currencies and recipes. Before converting a stack, review the next rank-up, clan goal, and relevant recipe." },
                { type: "p", text: "If you enjoy gathering, a broad stockpile gives you options later. For a specific craft, start from its recipe and gather only the materials you are missing." },
            ],
        },
    ],
};

const ENDGAME: Guide = {
    id: "endgame",
    category: "Harder Challenges",
    title: "Endgame Modes and How to Prepare",
    tagline: "Compare entry costs, party sizes, failure penalties, and reward timing before choosing a mode.",
    blurb: "Entry rules, party requirements, reward timing, and risk across the Towers, Weekly Boss, relic dungeons, and Hollow Gate.",
    audience: "Veteran shinobi",
    readMinutes: 11,
    reviewedAt: "August 2026",
    hero: towersHero,
    heroAlt: "A shinobi approaching monumental battle towers under a storm-lit sky.",
    heroPosition: "center 40%",
    keywords: ["endgame", "tower", "endless", "spire", "weekly boss", "dungeon", "hollow gate", "attunement", "boss"],
    quickTake: [
        "Battle Towers use fixed objectives, Endless Tower lets you bank or risk run earnings, and Endless Spire requires four-player coordination.",
        "The Weekly Boss roams, shares one health pool, allows three attempts, and distributes rewards when its 72-hour spawn ends.",
        "Hollow Gate is a five-floor expedition. A fresh run needs a key; an unfinished run can be resumed without spending another.",
    ],
    sections: [
        {
            id: "three-towers",
            heading: "Battle Towers, Endless Tower, and Endless Spire",
            blocks: [
                { type: "figure", src: towersHero, alt: "The Battle Towers rising above a mountain settlement with a shinobi at the approach.", caption: "Review the lobby before entering; the three Tower modes have different party rules, risks, and rewards." },
                { type: "h", text: "Battle Towers" },
                { type: "p", text: "Battle Towers contain fixed squad encounters with objectives, hazards, bosses, and first-clear rewards. Your first three entries into uncleared floors each UTC day are free; later entries cost 1,500 ryo. Replaying a cleared floor is free. Build around the floor objective instead of relying on stats alone." },
                { type: "h", text: "Endless Tower" },
                { type: "p", text: "Every wave is harder. Every fifth milestone doubles that wave's ryo reward and every tenth triples it. Cash out to keep the ryo accumulated during the run; a loss clears anything you had not claimed. Milestone materials are credited as soon as you clear them and remain yours." },
                { type: "h", text: "Endless Spire" },
                { type: "p", text: "Endless Spire is a 20-stage boss climb for exactly four players, with weekly blessings, keystones, and a leaderboard. Story Tower rooms accept two to four players and can add one reduced-strength AI helper that earns no reward. Spire never adds an AI helper." },
            ],
        },
        {
            id: "weekly-boss",
            heading: "Weekly Boss location and rewards",
            blocks: [
                { type: "p", text: "The Weekly Boss has one shared health pool during its 72-hour spawn and moves to a connected sector about every thirteen minutes. Track its current location on the World Map before using one of your three attempts." },
                { type: "p", text: "After its health reaches zero, the boss becomes Broken but remains fightable until despawn. Rewards are distributed at despawn based on contribution and placement, so players can continue contributing after Broken." },
            ],
        },
        {
            id: "relic-dungeon",
            heading: "Relic dungeon stages",
            blocks: [
                { type: "p", text: "A relic dungeon runs in order: defeat the Warden, win the Chronicle match, then face the Rare Beast with a companion. Progress is saved between stages, and the relic is awarded after all three are complete." },
                { type: "p", text: "Bring an eligible companion for the final stage and make sure it is available before you begin." },
            ],
        },
        {
            id: "hollow-gate",
            heading: "Hollow Gate entry, risk, and Attunement",
            blocks: [
                { type: "p", text: "Hollow Gate is a five-floor fog-of-war expedition with ambushes, Alpha encounters, and random events. A fresh run requires an active 30-day village access seal from the seated Kage and consumes one Hollow Gate Key. You may start two fresh runs per day before Attunement bonuses; resuming a run is free." },
                { type: "p", text: "A companion used in a Hound encounter must have unlocked PvE, normally at level 50, and cannot be away on an expedition." },
                { type: "p", text: "If you die, you return to the Hospital and retain 50% of run-earned currencies; Greedy Hands raises that share to 80%. Item rewards and permanent progress are retained. The Shrine highlights ryo and Hollow Shards at risk, but the same percentage applies to every run currency." },
                { type: "p", text: "Attunement is the permanent Hollow Gate upgrade tree and includes key forging and entry upgrades. Prioritize upgrades for the obstacle ending your runs; extra entries do not improve combat." },
                { type: "callout", tone: "warn", label: "Before you enter", text: "Starting over spends another key and uses another daily entry. If a run is still active, resume it from the Hollow Gate instead." },
            ],
        },
    ],
};

const GAME_AND_COMMUNITY: Guide = {
    id: "game-and-community",
    category: "Game",
    title: "About Shinobi Journey",
    tagline: "Shinobi Journey is in public beta. Player feedback helps us find bugs and tune the game.",
    blurb: "An overview of persistent systems, public-beta changes, the Living Chronicle, and where to get help.",
    audience: "Everyone",
    readMinutes: 4,
    reviewedAt: "August 2026",
    hero: gameHero,
    heroAlt: "A wide mountain valley with a distant shinobi village beneath the clouds.",
    heroPosition: "center 48%",
    keywords: ["about", "community", "discord", "beta", "living chronicle", "help", "feedback"],
    quickTake: [
        "The game is in public beta, so systems, costs, caps, rewards, and presentation can change.",
        "The Living Chronicle records major story, mission, exploration, Showdown, companion, war, clan, and Legacy progress.",
        "For bug reports, include the screen, action, expected result, actual result, and a screenshot.",
    ],
    sections: [
        {
            id: "what-kind-of-game",
            heading: "What persists in the world",
            blocks: [
                { type: "p", text: "Shinobi Journey is a persistent browser RPG about building a shinobi, raising companions, taking work, and traveling a shared map. It combines solo progression with shared exploration, PvP, clans, and coordinated operations." },
                { type: "p", text: "The Living Chronicle gathers your story progress, Showdown and companion wins, mission and exploration totals, recent village and clan wars, clan contribution, and Legacy. Use it to review the account's completed milestones and recent activity." },
            ],
        },
        {
            id: "what-beta-means",
            heading: "What public beta means here",
            blocks: [
                { type: "p", text: "During beta, balance and presentation can change. Costs, caps, rewards, queues, and event schedules are most likely to move, so use each guide's review date for time-sensitive values." },
                { type: "p", text: "If a guide differs from the current interface, follow the in-game value and report the mismatch." },
            ],
        },
        {
            id: "getting-help",
            heading: "How to ask for help or report a bug",
            blocks: [
                { type: "list", items: [
                    "Name the exact screen and control label.",
                    "Say what you did immediately before the problem.",
                    "Include what you expected and what actually happened.",
                    "Attach a screenshot when the issue is visual or positional, after redacting private chat or account details.",
                    "Never post a password, sign-in token, or private account data.",
                ] },
                { type: "p", text: "Join the linked Discord for strategy help and feedback. When asking about a build, include your rank and the mode you are preparing for." },
            ],
        },
        {
            id: "credits",
            heading: "How player feedback helps",
            blocks: [
                { type: "p", text: "Player reports, strategy discussions, and match feedback help us improve each update. Detailed reports help us reproduce problems and fix them faster." },
            ],
        },
    ],
};

export const GUIDES: Guide[] = [
    FIRST_HOUR,
    PROGRESSION,
    COMBAT,
    BUILDS,
    WORLD,
    CLANS_AND_WAR,
    COMPANIONS,
    CHRONICLE,
    PROFESSIONS_AND_ECONOMY,
    ENDGAME,
    GAME_AND_COMMUNITY,
];
