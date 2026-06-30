/*
 * In-app player guides — the structured content behind the Guides library
 * (GuidesLibrary.tsx), reachable from the start screen's GUIDES button and the
 * in-game side menu. Pure data: a small block model (paragraphs, lists, tables,
 * callouts) that the renderer walks. Every value here is kept accurate to the
 * live game code (combat-math, jutsu-points/tags, constants/game, constants/clan,
 * pet-config, card-clash, world-state, etc.) — when balance or systems change,
 * update the matching section here so the guides never drift.
 */

export type GuideBlock =
    | { type: "p"; text: string }
    | { type: "h"; text: string }
    | { type: "list"; items: string[] }
    | { type: "table"; head: string[]; rows: string[][] }
    | { type: "callout"; tone: "tip" | "warn" | "good"; label: string; text: string };

export type GuideSection = { heading: string; blocks: GuideBlock[] };

export type Guide = {
    id: string;
    title: string;
    tagline: string;
    icon: string;
    /** One-line blurb for the library card. */
    blurb: string;
    sections: GuideSection[];
};

// ── 1. Beginner ─────────────────────────────────────────────────────────────
const BEGINNER: Guide = {
    id: "beginner",
    title: "New Player Field Manual",
    tagline: "Everything you need to survive your first day in the village.",
    icon: "🌱",
    blurb: "Character creation, your stats, combat, training, and the daily loop that levels you fastest.",
    sections: [
        {
            heading: "1 · Create Your Character",
            blocks: [
                { type: "p", text: "You choose a name, a password, a home village, and a starter bloodline. Your bloodline is the big decision — it sets your combat discipline and you start already knowing its jutsu." },
                { type: "p", text: "Pick the village whose path speaks to you:" },
                { type: "table", head: ["Village", "Path"], rows: [
                    ["Stormveil", "The Chaotic Path — a lawless proving ground of outcasts. Raw strength, shifting alliances."],
                    ["Ashen Leaf", "The Traditional Path — discipline, balance and the old ways. Strength is cultivated, not seized."],
                    ["Frostfang", "The Loyal Path — forged in ice, bound by unbreakable unity. No one survives alone."],
                    ["Moonshadow", "The Selfish Path — masters of stealth and deception who trust no one."],
                ] },
                { type: "p", text: "Your starter bloodline sets your combat style:" },
                { type: "table", head: ["Bloodline", "Discipline", "Element", "Plays like"], rows: [
                    ["Ashen Eyes", "Genjutsu", "Blood", "Illusions that break the enemy's mind"],
                    ["Inferno Cataclysm", "Ninjutsu", "Lava", "Explosive ranged chakra blasts"],
                    ["Shadow Lotus", "Bukijutsu", "Shadow", "Weapon & tool specialist"],
                    ["Iron Fang", "Taijutsu", "Iron", "Brutal close-range hand-to-hand"],
                ] },
                { type: "callout", tone: "tip", label: "Tip", text: "There is no single “best” bloodline — pick the discipline that sounds the most fun. You can forge a custom bloodline later (see the Bloodline Builder guide)." },
            ],
        },
        {
            heading: "2 · Your First 10 Minutes",
            blocks: [
                { type: "list", items: [
                    "Equip your jutsu — you already know your bloodline's techniques.",
                    "Run the E-rank Drill at the Mission Hall — a near-guaranteed win for easy XP and ryo while you learn the ropes.",
                    "Win a fight in the Battle Arena (vs. AI) to level up fast.",
                    "Train a stat at the Training Grounds.",
                    "Hit Level 2 and claim your free Element Awakening at the Awakening Stone.",
                ] },
            ],
        },
        {
            heading: "3 · Your Four Resource Pools",
            blocks: [
                { type: "table", head: ["Pool", "What it does"], rows: [
                    ["Health (HP)", "Your life in battle. Drop to 0 and you're knocked out and sent to the Hospital."],
                    ["Chakra", "Energy that powers your jutsu — every technique spends chakra."],
                    ["Stamina", "Also powers your jutsu (every technique spends both chakra and stamina). Also spent on stat training and to enter the Weekly Boss."],
                    ["Action Points (AP)", "Your turn budget in battle only — 100 AP per turn. Every move costs AP; when you run out, your turn ends."],
                ] },
                { type: "callout", tone: "good", label: "Good to know", text: "HP, chakra and stamina refill over time, and a Hospital checkout restores them fully. Missions are gated by a daily cap and your level — they do not cost stamina (some even reward it)." },
            ],
        },
        {
            heading: "4 · Stats & Disciplines",
            blocks: [
                { type: "p", text: "There are four combat disciplines: Ninjutsu, Taijutsu, Genjutsu, and Bukijutsu. Each has an Offense stat (how hard you hit with it) and a Defense stat (how well you shrug it off)." },
                { type: "p", text: "On top of those, four General stats each empower two disciplines:" },
                { type: "table", head: ["General Stat", "Strengthens"], rows: [
                    ["Strength", "Taijutsu & Bukijutsu"],
                    ["Speed", "Ninjutsu & Taijutsu"],
                    ["Intelligence", "Genjutsu & Bukijutsu"],
                    ["Willpower", "Ninjutsu & Genjutsu"],
                ] },
                { type: "p", text: "So your real power in a discipline = its Offense stat plus the two General stats that feed it. Damage is decided by your offense vs. the target's matching defense:" },
                { type: "table", head: ["Attack with…", "Power comes from…"], rows: [
                    ["Ninjutsu", "Ninjutsu Offense + Willpower + Speed"],
                    ["Taijutsu", "Taijutsu Offense + Strength + Speed"],
                    ["Genjutsu", "Genjutsu Offense + Intelligence + Willpower"],
                    ["Bukijutsu", "Bukijutsu Offense + Intelligence + Strength"],
                ] },
                { type: "callout", tone: "tip", label: "Where to put points", text: "Your bloodline locks you into one discipline — focus it. Raise its Offense and Defense and the two General stats that power it. Don't spread points thin across all four." },
            ],
        },
        {
            heading: "5 · Combat Basics",
            blocks: [
                { type: "list", items: [
                    "Battles are turn-based on a tile grid. You get 100 AP each turn.",
                    "Each jutsu has an AP cost, a range, a cooldown, and spends both chakra and stamina — get in range before you cast.",
                    "AP cost scales with the technique's strength: the Flicker move jutsu is cheap (20 AP) and repositions you; standard techniques cost 40; the heaviest cost 60.",
                    "There's a per-turn timer, so don't freeze up.",
                    "Win by dropping the enemy to 0 HP. Lose first and it's off to the Hospital.",
                ] },
            ],
        },
        {
            heading: "6 · Awakening Your Element",
            blocks: [
                { type: "p", text: "At Level 2 and again at Level 20 you get a free awakening that grants one random element: Water, Wind, Earth, Lightning, or Fire. Your element lets you learn and equip jutsu of that element, expanding your kit beyond your bloodline. Re-rolling your elements later costs premium currency (Fate Shards)." },
            ],
        },
        {
            heading: "7 · Training",
            blocks: [
                { type: "p", text: "Stat Training (Training Grounds) — pick a stat and a duration. When the timer finishes you gain XP and stat points. Only one training runs at a time, and you can cancel early for partial credit." },
                { type: "table", head: ["Duration", "Stat points (base)"], rows: [
                    ["15 minutes", "+1"],
                    ["1 hour", "+3"],
                    ["4 hours", "+8"],
                    ["8 hours", "+14"],
                ] },
                { type: "p", text: "Jutsu Training (Jutsu Hall) — a jutsu's first level is free and instant, so go unlock some. Higher levels cost ryo and time." },
                { type: "callout", tone: "tip", label: "Tip", text: "The fastest way to grow a jutsu is to use it in battle. Every cast builds its mastery, which raises its effect and lowers its cost." },
            ],
        },
        {
            heading: "8 · Missions & Hunts — your daily bread",
            blocks: [
                { type: "list", items: [
                    "Missions (Mission Hall) come in ranks E → D → C → B → A → S — start with the E-rank Drill (a guaranteed-win trainer for levels 1-5). Up to 20 per day. Your main source of XP and ryo.",
                    "Hunts (Hunter Guild) are a separate pool of 20 per day — beast contracts that rank you up and drop rare materials.",
                    "Story Hall has story missions for lore and rewards.",
                ] },
                { type: "callout", tone: "good", label: "Habit", text: "These caps reset every day at midnight UTC. Logging in to clear your missions and hunts (40 total) is the single fastest way to level." },
            ],
        },
        {
            heading: "9 · Levels & Ranks",
            blocks: [
                { type: "table", head: ["Rank", "Reached at level"], rows: [
                    ["Academy Student", "1 – 14"],
                    ["Genin", "15"],
                    ["Chunin", "30"],
                    ["Jonin", "50"],
                    ["Special Jonin", "80"],
                ] },
                { type: "p", text: "The level cap is 100. Early levels come quickly — enjoy the climb." },
            ],
        },
        {
            heading: "10 · Getting Knocked Out",
            blocks: [
                { type: "p", text: "Lose a fight and you're hospitalized. Either wait about 60 seconds for a free recovery, or pay 2,500 ryo to skip the timer (a Town Hall upgrade lowers this, and Healers discharge for free). No lasting penalty — dust yourself off and get back out there." },
            ],
        },
        {
            heading: "11 · Pick a Path: Professions (Level 13)",
            blocks: [
                { type: "p", text: "At Level 13 you choose one permanent profession. Choose the one that matches how you like to play:" },
                { type: "list", items: [
                    "Healer — mend other players and support your village.",
                    "Vanguard — PvP raider who earns Honor Seals from real-player kills.",
                    "Pet Tamer — stronger pets in PvE and better expedition rewards.",
                ] },
                { type: "callout", tone: "warn", label: "Heads up", text: "Your profession choice is permanent, so don't rush it — play a bit first and pick the path that fits you." },
            ],
        },
        {
            heading: "12 · The Rest of the Village",
            blocks: [
                { type: "table", head: ["Spot", "What it's for"], rows: [
                    ["Bank", "Store your ryo safely and earn daily interest."],
                    ["Shop", "Buy gear, items, and Card Packs."],
                    ["Clan Hall", "Join or form a clan and fight for territory."],
                    ["Pet Yard", "Raise pets that fight alongside you."],
                    ["World Map", "Explore sectors and contest territory."],
                    ["Town Hall", "Village upgrades and bonuses."],
                    ["Card Hall", "Play Shinobi Card Clash with your collected cards."],
                    ["Tavern", "Village chat and social features."],
                ] },
                { type: "p", text: "Currencies: Ryo (everyday money) · Fate Shards (rare / premium) · Honor Seals (earned by Vanguards in PvP)." },
            ],
        },
    ],
};

// ── 2. Bloodline Builder ────────────────────────────────────────────────────
const BLOODLINE: Guide = {
    id: "bloodline",
    title: "Bloodline Builder",
    tagline: "Forge your own kekkei genkai — your element, your jutsu, your power.",
    icon: "🧬",
    blurb: "Design a custom bloodline: pick its element and discipline, then build unique jutsu from scratch.",
    sections: [
        {
            heading: "1 · Forge It at the Awakening Stone",
            blocks: [
                { type: "p", text: "A custom bloodline is your own designed kekkei genkai: you pick its element and combat discipline, then build a set of unique jutsu — choosing their damage, tags, range and targeting. Equipping it grants a flat damage multiplier on top of your kit and unlocks its jutsu no matter which elements you've awakened." },
                { type: "list", items: [
                    "Open the Awakening Stone in the Central Hub.",
                    "In the Bloodline Forge, pay the material cost for the rank you want — there is no ryo cost.",
                    "Forging opens the Bloodline Maker, where you finish designing it (you can re-open and edit later).",
                ] },
                { type: "table", head: ["Rank", "Forge cost", "Where the material drops"], rows: [
                    ["B Rank", "100 Bone Charms", "Hunts & lower-tier beasts"],
                    ["A Rank", "100 Aura Stones", "Bosses, dungeons & tougher content"],
                    ["S Rank", "100 Mythic Seals", "Top-end bosses, dungeons & war rewards"],
                ] },
                { type: "callout", tone: "warn", label: "Heads up", text: "Your saved custom bloodline is replaced if you forge a brand-new one, and swapping bloodlines wipes those jutsu's mastery (you re-train them). Build deliberately." },
            ],
        },
        {
            heading: "2 · What Each Rank Gives You",
            blocks: [
                { type: "table", head: ["Rank", "Damage mult.", "Jutsu slots", "Point budget", "% buff/debuff cap"], rows: [
                    ["B Rank", "×1.10", "4", "7", "35%"],
                    ["A Rank", "×1.15", "5", "10", "35%"],
                    ["S Rank", "×1.20", "5", "11", "40%"],
                ] },
                { type: "p", text: "The damage multiplier applies to every jutsu in the bloodline while it's equipped (your starter bloodline is ×1.08 for comparison). The point budget is your design currency — every choice below costs points, and you can't save a bloodline that goes over." },
            ],
        },
        {
            heading: "3 · Set Your Bloodline's Identity",
            blocks: [
                { type: "list", items: [
                    "Special Element — free text (e.g. Crystal, Storm, Shadow Flame). Owning the bloodline lets you equip its jutsu even if you never awakened that element.",
                    "Offense / Discipline — one of Ninjutsu, Taijutsu, Genjutsu, Bukijutsu. All its jutsu use this discipline, so build around the stats you train.",
                    "Name, lore & image — flavor; you can AI-generate the art in the maker.",
                ] },
            ],
        },
        {
            heading: "4 · Build Each Jutsu",
            blocks: [
                { type: "p", text: "Each jutsu slot is fully configurable. Start with its AP type — that decides everything else:" },
                { type: "table", head: ["AP type", "Damage", "Tag slots", "Best for"], rows: [
                    ["40 AP — Utility", "None", "3 tags", "Buffs, debuffs, heals, control, seals"],
                    ["60 AP — Damage", "Yes", "2 tags", "Your attacks (pick a Damage mode below)"],
                ] },
                { type: "p", text: "Damage modes (60 AP only):" },
                { type: "table", head: ["Mode", "Cost", "Effect"], rows: [
                    ["Standard", "0 pts", "Solid damage that scales as the jutsu masters. Your bread-and-butter."],
                    ["Nuke", "+1 pt", "Bigger hit that scales with level. Only one Nuke per bloodline."],
                    ["Pierce", "+1 pt", "900 true damage that ignores shields, armor and all damage modifiers. One per bloodline, 60 AP only."],
                ] },
                { type: "p", text: "The other per-jutsu dials:" },
                { type: "list", items: [
                    "Range — 4 (free) or 5 (+0.5 pt). A Self-targeted jutsu is range 0.",
                    "Cooldown — locked at 7 rounds for all bloodline jutsu.",
                    "Chakra / Stamina cost — set automatically by the AP tier (drops slightly as the jutsu masters).",
                    "Targeting & method — Single (normal), Circle Movement (blink to a tile and hit the hexes around your landing spot; auto-adds Move; +0.5 pt), AOE Movement (blink to a tile and erupt a wide 2-round spiral ground zone; auto-adds Move; +1 pt), or Instant Effect (drop a 2-round zone on open ground; +1 pt).",
                ] },
            ],
        },
        {
            heading: "5 · How Your Points Are Spent",
            blocks: [
                { type: "table", head: ["Design choice", "Point cost"], rows: [
                    ["Making a jutsu 40 AP (Utility)", "+1 pt each"],
                    ["Nuke or Pierce damage mode", "+1 pt each"],
                    ["Range 5 (instead of 4)", "+0.5 pt"],
                    ["Circle Movement method", "+0.5 pt"],
                    ["Instant Effect or AOE Movement method", "+1 pt"],
                    ["Standard 60 AP damage", "0 pts"],
                    ["Tags", "varies — see the tag tables"],
                ] },
                { type: "callout", tone: "tip", label: "Rule of thumb", text: "Damage attacks are cheap; control and lockdown tags are expensive. A focused bloodline (one strong attack + a couple of signature effects) beats spreading your budget thin." },
            ],
        },
        {
            heading: "6 · Tag Reference",
            blocks: [
                { type: "p", text: "Tags are what make a bloodline yours. Costs below are the point cost to add the tag. A ★ marks a signature tag — only one jutsu in the whole bloodline may carry it. Magnitudes scale with your rank and the jutsu's mastery." },
                { type: "h", text: "Offense & damage-over-time" },
                { type: "table", head: ["Tag", "Cost", "What it does"], rows: [
                    ["Wound", "0.5–1", "Lingering bleed that keeps damaging after the hit (60 AP only)."],
                    ["Poison", "0.5", "Damage over several rounds."],
                    ["Increase Damage Given", "0–0.75", "You deal more damage (free below the cap, +0.75 at max)."],
                    ["Increase Damage Taken", "0–0.75", "The enemy takes more damage from all sources."],
                    ["Ignition", "0–0.75", "Amplifies the damage the enemy takes."],
                    ["Recoil", "0–0.75", "You take a slice of the damage you deal (a drawback)."],
                ] },
                { type: "h", text: "Defense & sustain" },
                { type: "table", head: ["Tag", "Cost", "What it does"], rows: [
                    ["Heal", "1.5", "Restore HP."],
                    ["Increase Heal", "1", "Boosts the healing you do."],
                    ["Shield", "1", "Absorbs a chunk of incoming damage."],
                    ["Decrease Damage Taken", "0–0.75", "You take less damage."],
                    ["Decrease Damage Given", "0–0.75", "The enemy hits softer (allowed in Instant-Effect zones)."],
                    ["Absorb", "0–0.75", "Turn some incoming damage into recovery."],
                    ["Lifesteal", "0–0.75", "Heal for a share of the damage you deal."],
                    ["Drain", "1", "Saps the enemy's chakra / stamina."],
                    ["Siphon", "0–0.75", "Drain enemy resources to yourself (60 AP only)."],
                    ["Reflect", "0–0.75", "Bounce a share of damage back at the attacker."],
                ] },
                { type: "h", text: "Control, movement & tempo" },
                { type: "table", head: ["Tag", "Cost", "What it does"], rows: [
                    ["Stun ★", "2", "The enemy loses their next action."],
                    ["Lag ★", "2", "Slows the enemy's AP tempo (bloodline-exclusive lever)."],
                    ["Overclock ★", "2", "Speeds up your own AP tempo (bloodline-exclusive lever)."],
                    ["Move", "0.5", "Reposition on the grid (required by the Circle Movement and AOE Movement methods)."],
                    ["Push / Pull", "1 / 0.75", "Knock the enemy back, or drag them toward you."],
                    ["Stun Prevent", "1", "Immunity to being stunned."],
                ] },
                { type: "h", text: "Seals & prevents (lockdown)" },
                { type: "table", head: ["Tag", "Cost", "What it does"], rows: [
                    ["Bloodline Seal ★", "2", "Blocks the enemy from using their bloodline."],
                    ["Elemental Seal ★", "1.5", "Blocks the enemy's element jutsu."],
                    ["Buff Prevent ★", "2", "Stops the enemy from buffing themselves."],
                    ["Debuff Prevent ★", "2", "Stops the enemy from cleansing your debuffs."],
                    ["Cleanse / Clear Prevent", "1.5", "Stops the enemy from removing your effects."],
                    ["Copy ★", "3", "Copy an enemy technique."],
                    ["Mirror ★", "3", "Mirror an effect back (60 AP only)."],
                ] },
            ],
        },
        {
            heading: "7 · Rules & Restrictions",
            blocks: [
                { type: "list", items: [
                    "Signature tags are one-per-bloodline: Stun, Lag, Overclock, Bloodline Seal, Elemental Seal, Buff Prevent, Debuff Prevent, Copy, Mirror, and Pierce.",
                    "40 AP jutsu can't use: Pierce, Siphon, Mirror, Copy, or Wound (those are 60 AP only).",
                    "Instant-Effect zones accept only Decrease Damage Given, Recoil, or Poison.",
                    "No duplicate tag on the same jutsu.",
                    "You can't save a bloodline that goes over its point budget — the maker shows your total.",
                ] },
            ],
        },
        {
            heading: "8 · Example Builds",
            blocks: [
                { type: "p", text: "Budget-legal templates to copy or remix. Mix damage, sustain and one signature effect — don't blow the whole budget on lockdown." },
                { type: "h", text: "S Rank — “The Assassin” (11 / 11 points)" },
                { type: "table", head: ["Jutsu", "Build", "Pts"], rows: [
                    ["1 — Finisher", "60 AP · Nuke + Wound", "2"],
                    ["2 — Pierce strike", "60 AP · Pierce mode", "1"],
                    ["3 — Lockdown", "40 AP · Stun", "3"],
                    ["4 — War cry", "40 AP · Increase Damage Given + Decrease Damage Taken", "2.5"],
                    ["5 — Mend", "40 AP · Heal", "2.5"],
                ] },
                { type: "h", text: "B Rank — “The Bruiser” (7 / 7 points)" },
                { type: "table", head: ["Jutsu", "Build", "Pts"], rows: [
                    ["1 — Heavy hit", "60 AP · Nuke", "1"],
                    ["2 — Drain blow", "60 AP · Standard + Drain", "1"],
                    ["3 — Momentum", "40 AP · Increase Damage Given + Decrease Damage Taken", "2.5"],
                    ["4 — Guard", "40 AP · Shield", "2.5"],
                ] },
            ],
        },
    ],
};

// ── 3. Combat & Jutsu ───────────────────────────────────────────────────────
const COMBAT: Guide = {
    id: "combat",
    title: "Combat & Jutsu",
    tagline: "AP, tags, the damage math, and how mastery makes a jutsu hit harder.",
    icon: "⚔️",
    blurb: "A deeper look under the hood: the AP economy, the damage formula, jutsu tags, and mastery scaling.",
    sections: [
        {
            heading: "1 · The Turn & the AP Economy",
            blocks: [
                { type: "p", text: "Battles are turn-based on a hex grid. Each turn you get 100 Action Points (AP). Every action spends AP, and your turn ends when you can no longer afford even the cheapest move." },
                { type: "table", head: ["Action", "AP cost"], rows: [
                    ["Move one tile", "30"],
                    ["Flicker (move jutsu)", "20"],
                    ["Standard jutsu", "40"],
                    ["Heaviest jutsu", "60"],
                ] },
                { type: "p", text: "AP cost tracks a technique's strength, not whether it deals damage — most attacks and most utility jutsu share the 40-AP tier. Plan your turn: a 60-AP nuke plus a 30-AP reposition already spends 90 of your 100." },
                { type: "callout", tone: "tip", label: "Tip", text: "Stun also bites into AP. If you're stunned your turn starts with less than 100 AP, so a clean stun can deny a whole action." },
            ],
        },
        {
            heading: "2 · How Damage Is Calculated",
            blocks: [
                { type: "p", text: "Every attack pits your offense power against the target's matching defense. Your offense power is the discipline's Offense stat plus its two feeder General stats (see the Beginner guide). The defender's matching defense is built the same way." },
                { type: "p", text: "The closer-to-even the stats, the closer to 1× the damage. Out-stat their defense and you hit much harder; fall behind and you hit softer — but it's clamped, so you always do something and never one-shot purely on stats (roughly a 0.35×–1.85× band). On top of that sits the jutsu's own power, your bloodline multiplier, element matchups, and any active tags." },
                { type: "callout", tone: "good", label: "Takeaway", text: "Train the Offense stat AND both feeder stats for your discipline. Defense matters just as much on the receiving end — a glass cannon folds to anyone who out-stats your defense." },
            ],
        },
        {
            heading: "3 · Chakra, Stamina, Range & Cooldown",
            blocks: [
                { type: "list", items: [
                    "Every jutsu spends both chakra and stamina (a percentage of your pools). Run either dry and you can't cast it.",
                    "Each jutsu has a range — you must be within it to cast. Move or Flicker to close the gap.",
                    "Each jutsu has a cooldown in rounds. After casting, it's locked until the cooldown clears.",
                ] },
            ],
        },
        {
            heading: "4 · Mastery — use it to grow it",
            blocks: [
                { type: "p", text: "Casting a jutsu in battle earns it mastery XP, raising its level (up to 50). As a jutsu masters, its effect power climbs and its resource cost drops slightly. You can also pay ryo + time at the Jutsu Hall to level it, but the first level is free and instant, and fighting is the cheapest way to grow." },
                { type: "callout", tone: "tip", label: "Tip", text: "Lean on a small core of jutsu rather than constantly swapping. Concentrated use levels them faster, and a high-mastery kit outdamages a wide-but-shallow one." },
            ],
        },
        {
            heading: "5 · Reading Tags",
            blocks: [
                { type: "p", text: "Tags are the verbs of combat — what a technique does beyond raw damage. You'll see them on enemy jutsu and on your own. The common families:" },
                { type: "list", items: [
                    "Damage-over-time — Poison, Wound (bleed): keep ticking after the hit.",
                    "Damage shaping — Increase/Decrease Damage Given & Taken, Ignition: bend how hard hits land.",
                    "Sustain — Heal, Shield, Absorb, Lifesteal, Reflect: keep you standing.",
                    "Resource — Drain, Siphon: starve the enemy's chakra/stamina.",
                    "Tempo & control — Stun, Lag, Overclock, Push/Pull, Move: warp the turn order and the grid.",
                    "Lockdown — Bloodline Seal, Elemental Seal, Buff/Debuff Prevent, Cleanse/Clear Prevent: shut off the enemy's options.",
                ] },
                { type: "p", text: "The Bloodline Builder guide lists every tag with its exact effect and point cost." },
            ],
        },
    ],
};

// ── 4. Pet Battles ──────────────────────────────────────────────────────────
const PETS: Guide = {
    id: "pets",
    title: "Pet Battles",
    tagline: "Befriend, train, and fight elemental companions in the arena.",
    icon: "🐾",
    blurb: "Where pets come from, the element wheel, the auto-battler arena, traits, and expeditions.",
    sections: [
        {
            heading: "1 · Getting & Raising Pets",
            blocks: [
                { type: "list", items: [
                    "Befriend wild pets you meet exploring the world map and inside the Hollow Gate dungeon. You can keep up to 5.",
                    "Rarity runs Standard → Rare → Legendary → Mythic. Mythics come with full, hand-crafted kits.",
                    "Train pets in the Pet Yard (15 min / 1 hr / 4 hr / 8 hr sessions) or feed treats for instant XP. Pets level up to 100.",
                ] },
                { type: "p", text: "Each pet rolls a permanent trait when you befriend it, which buffs it (and sometimes you):" },
                { type: "table", head: ["Trait", "Feel"], rows: [
                    ["Loyal", "Bonds with its owner"],
                    ["Aggressive", "Hits harder"],
                    ["Swift", "Moves & acts faster"],
                    ["Lucky", "Tips the rolls your way"],
                    ["Battleborn", "Tougher in a fight"],
                    ["Guardian", "Protective — rolls only on Mythic pets"],
                ] },
            ],
        },
        {
            heading: "2 · The Element Wheel",
            blocks: [
                { type: "p", text: "Pet combat is rock-paper-scissors: Fire → Wind → Lightning → Earth → Water → Fire." },
                { type: "list", items: [
                    "Hitting a weakness (you beat their element) deals +25% damage.",
                    "Hitting a resistance (they beat yours) deals −20% damage.",
                ] },
                { type: "callout", tone: "tip", label: "Tip", text: "Element advantage is the single biggest lever in a pet fight. Match your pet — and the location — against what you expect to face." },
            ],
        },
        {
            heading: "3 · The Pet Coliseum",
            blocks: [
                { type: "p", text: "The arena is an auto-battler on a 14×7 obstacle grid: pick your pet and it moves and casts on its own with AI — element advantage and positioning decide it. You direct the draft, the pet fights the fight." },
                { type: "p", text: "Where you can battle:" },
                { type: "list", items: [
                    "Casual duels against other players' pets.",
                    "The ranked pet ladder (a separate Elo from your shinobi rank).",
                    "Clan War pet challenges.",
                    "Wild Hollow Beasts inside the Hollow Gate.",
                ] },
            ],
        },
        {
            heading: "4 · Expeditions & Summoning",
            blocks: [
                { type: "p", text: "Send a level-50+ pet on a timed expedition for pet XP, ryo and rare materials:" },
                { type: "table", head: ["Expedition", "Duration"], rows: [
                    ["Scout Routes", "45 minutes"],
                    ["Forage Wilds", "2 hours"],
                    ["Explore Old Ruins", "4 hours"],
                ] },
                { type: "callout", tone: "good", label: "Pet Tamer perk", text: "Pet Tamers earn the full rewards plus a 2× bonus on their first expedition each day." },
                { type: "p", text: "A level-50+ pet can also be summoned to fight beside you in PvE — a real edge on tough hunts and bosses." },
            ],
        },
    ],
};

// ── 5. Shinobi Card Clash ───────────────────────────────────────────────────
const CARDCLASH: Guide = {
    id: "cardclash",
    title: "Shinobi Card Clash",
    tagline: "A fast 3-location card duel played with your collected shinobi cards.",
    icon: "🎴",
    blurb: "The Card Hall game: 6 turns, a ramping chakra economy, three locations, win 2 of 3.",
    sections: [
        {
            heading: "1 · The Goal",
            blocks: [
                { type: "p", text: "Shinobi Card Clash is a 6-turn battle for control of 3 locations. At the end of Turn 6, the side with more total Power at a location wins it — win 2 of the 3 to win the match." },
                { type: "p", text: "If it's 1–1 with one tied location, the higher total board Power wins; a full tie is a draw." },
            ],
        },
        {
            heading: "2 · Chakra Ramps Each Turn",
            blocks: [
                { type: "list", items: [
                    "You get 1 Chakra on Turn 1, 2 on Turn 2 … up to 6 on Turn 6.",
                    "Each card costs Chakra to play.",
                    "Unused Chakra does NOT carry over — spend it each turn.",
                ] },
            ],
        },
        {
            heading: "3 · Cards & Hand",
            blocks: [
                { type: "list", items: [
                    "You open with 3 cards and draw 1 at the start of each new turn (max hand of 7).",
                    "Each location holds up to 4 of your cards (and 4 of the opponent's).",
                    "Cards have a Cost and Power, a Role (fighter, defender, support, assassin, summoner, control), and often an On-Reveal ability — buffing allies, weakening enemies, drawing cards, or summoning clones.",
                ] },
            ],
        },
        {
            heading: "4 · Locations",
            blocks: [
                { type: "p", text: "Three random locations are drawn each match from a pool of 13. Most give a Power bonus to certain cards — play into them:" },
                { type: "table", head: ["Location", "Bonus"], rows: [
                    ["Training Ground", "No special effect"],
                    ["Volcano Pass / River Shrine / Stone Gate / Wind Bridge / Storm Peak / Moonshadow Ruins / Frozen Lake", "+2 Power to matching-element cards (Fire / Water / Earth / Wind / Lightning / Shadow / Ice)"],
                    ["Ninja Academy", "Common cards +2 Power"],
                    ["Black Market", "Rare cards +2 Power"],
                    ["Hollow Gate", "Epic & Legendary cards +2 Power"],
                    ["Hidden Dojo", "Cards costing 1–2 get +1 Power"],
                    ["Kage Summit", "Cards costing 5–6 get +2 Power"],
                ] },
            ],
        },
        {
            heading: "5 · Building a Deck",
            blocks: [
                { type: "list", items: [
                    "A deck is exactly 12 cards.",
                    "Common / Rare: up to 2 copies each. Epic / Legendary: 1 copy each.",
                    "At most 2 Legendary cards per deck.",
                ] },
                { type: "p", text: "Collect cards from Card Packs in the Shop or Grand Marketplace — the pool is 150+ cards across Common, Rare, Epic and Legendary. Card Clash also appears as a Clan War challenge mode, so a sharp deck pays off in more than casual play." },
            ],
        },
        {
            heading: "6 · Rewards",
            blocks: [
                { type: "table", head: ["Result", "Ryo"], rows: [
                    ["Win", "50"],
                    ["Draw", "15"],
                    ["Loss", "5"],
                ] },
                { type: "callout", tone: "good", label: "Daily bonus", text: "Your first win each day earns a bonus 250 ryo on top of the base payout." },
            ],
        },
    ],
};

// ── 6. World Map & Sector War ───────────────────────────────────────────────
const WORLD: Guide = {
    id: "world",
    title: "World Map & Sector War",
    tagline: "Wage war over 60 sectors across five biomes.",
    icon: "🗺️",
    blurb: "Capture and defend territory, generate War Supply, and contest the map for your village and clan.",
    sections: [
        {
            heading: "1 · The World",
            blocks: [
                { type: "p", text: "The world is 60 sectors across five biomes, each with its own terrain combat bonus and weather. Sectors can be captured and held by villages and clans." },
                { type: "table", head: ["Biome", "Sectors"], rows: [
                    ["Shadow (Moonshadow darklands)", "1 – 20"],
                    ["Forest (Stormveil coast & woods)", "21 – 35"],
                    ["Volcano (Ashen Leaf fire-lands)", "36 – 45"],
                    ["Snow (Frostfang icefields)", "46 – 55"],
                    ["Central (contested heartland)", "56 – 60"],
                ] },
            ],
        },
        {
            heading: "2 · Capturing & Holding",
            blocks: [
                { type: "list", items: [
                    "Capture a sector by collecting Territory Control Scrolls (from missions) and donating them through the Clan Hall to push its Control Score toward the cap.",
                    "Holding a sector generates daily War Supply — a clan-treasury resource collected by your clan's leaders — plus a terrain bonus (+10% offense in a chosen discipline) for fights there.",
                    "If your village holds territory, claim your daily map-control reward.",
                ] },
            ],
        },
        {
            heading: "3 · Raiding & Defense",
            blocks: [
                { type: "list", items: [
                    "Raid enemy-held sectors to drain their territory HP; knock it to zero and the sector falls, then enters a 2-hour rebuild cooldown before it can be retaken.",
                    "Defense: players can queue as guards on a sector. Raiders face a real human defender if one is on duty, otherwise an AI guard.",
                ] },
            ],
        },
        {
            heading: "4 · The Kage",
            blocks: [
                { type: "callout", tone: "good", label: "The Kage", text: "At the very top, a village can be led by a Kage — earned by hitting max level (100) and finishing your village storyline. The Kage can declare village wars on rivals and rally everyone to fight." },
            ],
        },
    ],
};

// ── 7. Clans & Clan War ─────────────────────────────────────────────────────
const CLANS: Guide = {
    id: "clans",
    title: "Clans & War",
    tagline: "Band together, climb the ranks, and drain a rival clan's War HP.",
    icon: "🏴",
    blurb: "Clan roles, treasury and missions, the Honor Seal Pool, and how clan wars are won.",
    sections: [
        {
            heading: "1 · Joining & Running a Clan",
            blocks: [
                { type: "list", items: [
                    "Create a clan with a unique name, or request to join one — the Founder and leaders approve members.",
                    "Your standing is set by your contribution: roles run Founder → Leader → Officer → Elite Member → Member → Recruit.",
                    "Clans level up (upgrading the hall), and bigger clans grant member-count stat bonuses to everyone.",
                    "Grow the Clan Treasury with ryo donations to fund clan upgrades.",
                ] },
            ],
        },
        {
            heading: "2 · Clan Missions & the Seal Pool",
            blocks: [
                { type: "list", items: [
                    "Clan missions are shared goals — e.g. win 20 battles, complete 50 missions, defend the village 10 times, donate 25,000 ryo — paying Clan XP and treasury rewards.",
                    "Honor Seal Pool: Vanguards donate Honor Seals; the Founder hands them out to members, who spend them on jutsu-training perks.",
                ] },
            ],
        },
        {
            heading: "3 · Clan War",
            blocks: [
                { type: "p", text: "A clan leader can declare war on a rival clan (paid in Honor Seals). Each war is a race to drain the enemy clan's shared War HP (1,000). Members deal damage by winning challenges — and it isn't only PvP, so everyone can pitch in:" },
                { type: "table", head: ["Challenge mode", "Damage to enemy clan"], rows: [
                    ["2v2 PvP", "60"],
                    ["1v1 PvP", "30"],
                    ["Pet 2v2", "40"],
                    ["Pet 1v1", "20"],
                    ["Card Clash", "10"],
                ] },
                { type: "p", text: "First clan to drop the enemy's War HP to 0 wins. Results, the MVP and your war record are saved to clan history. The same two clans can't immediately rematch — there's a cooldown before another war." },
            ],
        },
    ],
};

// ── 8. Hollow Gate & Materials ──────────────────────────────────────────────
const HOLLOWGATE: Guide = {
    id: "hollowgate",
    title: "Hollow Gate & Materials",
    tagline: "The roguelike dungeon — your main source of pets and forge materials.",
    icon: "🌀",
    blurb: "Run the gate, befriend pets, dodge ambushes, and farm the materials that forge bloodlines.",
    sections: [
        {
            heading: "1 · The Run",
            blocks: [
                { type: "list", items: [
                    "Enter with a Hollow Gate Key (consumed on a fresh run). You get up to 2 fresh runs per day; resuming a run already in progress is free.",
                    "Explore a generated 15×11 grid with fog of war, climbing 5 floors to the final boss — the Hollow Gate Warden.",
                    "Along the way: shinobi battles, elite fights, traps, treasure chests, wild Hollow Beasts to befriend (a key source of pets), and card duels.",
                ] },
                { type: "callout", tone: "warn", label: "Watch the Threat meter", text: "A Threat meter rises as you move — fill it and you get ambushed, so don't wander aimlessly. Take efficient routes and grab what matters." },
            ],
        },
        {
            heading: "2 · What You Earn",
            blocks: [
                { type: "p", text: "Rewards: ryo, gear, pet treats, tile cards, and the premium materials you need to forge bloodlines — Bone Charms, Aura Stones, and Fate Shards." },
                { type: "callout", tone: "good", label: "Why it matters", text: "The Hollow Gate is your main source of pets and bloodline-forging materials at once. If you want a custom bloodline or a strong pet roster, this is where you grind." },
            ],
        },
        {
            heading: "3 · Forge Materials at a Glance",
            blocks: [
                { type: "table", head: ["Material", "Mainly forges", "Where it drops"], rows: [
                    ["Bone Charms", "B-Rank bloodline", "Hunts, lower-tier beasts, Endless Tower milestones, Hollow Gate"],
                    ["Aura Stones", "A-Rank bloodline", "Bosses, dungeons, Hollow Gate"],
                    ["Mythic Seals", "S-Rank bloodline", "Top-end bosses, dungeons & war rewards"],
                    ["Fate Shards", "Premium currency", "Hollow Gate, high-rank hunts, milestones"],
                ] },
            ],
        },
        {
            heading: "4 · Other Endgame Loops",
            blocks: [
                { type: "h", text: "Weekly Boss" },
                { type: "p", text: "A world boss the whole server fights together, with a few attempts per spawn and damage tracked on a shared leaderboard. Rewards are tiered by contribution and pay out when the boss falls: the top damage dealers earn a rare Weekly Boss Core, the next tier earns a Dungeon Key, and everyone who contributed shares ryo + XP — the #1 MVP earns double." },
                { type: "h", text: "Endless Tower" },
                { type: "p", text: "An infinite survival gauntlet of escalating waves with no daily limit. Each wave pays ryo + XP that grows as you climb; every 5th wave drops premium materials, and every 10th wave restores 33% of your HP and 50% of your chakra and stamina. Your wave winnings bank as you go, but you lose the banked ryo/XP if you're defeated — retreat any time to lock in your haul. Milestone materials are yours to keep either way." },
                { type: "h", text: "Ranked PvP & Raids" },
                { type: "p", text: "Ranked PvP is a skill ladder — win to climb your rating, lose and it dips, with a separate pet ranked ladder. Vanguards run Raids on enemy villages and players for Honor Seals and profession XP (a daily cap applies; higher Vanguard ranks earn bonus ryo and extra seals). Top ratings are immortalized in the Hall of Legends." },
            ],
        },
    ],
};

// ── About & Credits ─────────────────────────────────────────────────────────
// Kept last in the library. Holds the project blurb, the third-party attributions
// we're obligated to surface (game-icons.net is CC BY 3.0 → attribution required),
// and the community links.
const ABOUT: Guide = {
    id: "about",
    title: "About & Credits",
    tagline: "What powers Shinobi Journey — and who to thank.",
    icon: "🏮",
    blurb: "The game, its credits & third-party attributions, and where to find the community.",
    sections: [
        {
            heading: "About the Game",
            blocks: [
                { type: "p", text: "Shinobi Journey is a browser-based shinobi RPG — forge a character, master jutsu and bloodlines, raise pets, climb the ranks, and shape your village's fate in a shared world." },
                { type: "p", text: "It's an actively developed, community-supported project: new systems, balance passes, and content land regularly." },
            ],
        },
        {
            heading: "Credits & Attributions",
            blocks: [
                { type: "h", text: "Icons" },
                { type: "p", text: "Menu and interface icons are from game-icons.net, used under the Creative Commons Attribution 3.0 Unported license (CC BY 3.0). See game-icons.net for the full author list and the license text." },
                { type: "h", text: "Fonts" },
                { type: "p", text: "Display headings use Cinzel, served via Google Fonts under the SIL Open Font License." },
                { type: "h", text: "Built With" },
                { type: "p", text: "React, Vite, three.js, react-icons, Supabase, and other open-source software." },
            ],
        },
        {
            heading: "Community",
            blocks: [
                { type: "p", text: "Join the Discord: discord.gg/bCQGs8r6SK" },
                { type: "p", text: "Support development on Patreon: patreon.com/c/shinobijourney" },
            ],
        },
    ],
};

export const GUIDES: Guide[] = [
    BEGINNER,
    COMBAT,
    BLOODLINE,
    PETS,
    CARDCLASH,
    WORLD,
    CLANS,
    HOLLOWGATE,
    ABOUT,
];
