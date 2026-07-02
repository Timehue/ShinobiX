/*
 * Era definitions — the world's chapter markers (docs/legacy-system-plan.md §14).
 *
 * Eras are SERVER HISTORY, not rebalancing: unlocking one credits the player
 * (and village) who struck the final blow, mints an announcement + permanent
 * Hall of Legends entry, and opens new content layers. Design rules from the
 * handoff + the Ahn'Qiraj-war-effort research: milestones mix several activity
 * categories (never one grindable bar), every requirement is admin-tunable at
 * runtime, one finisher is credited but the whole server is celebrated.
 *
 * Eras 1–4 ship already `unlocked`: their content (missions/bloodlines, the
 * Hollow Gate, the Village War Map, the Weekly Boss) has been live for the
 * whole playerbase — retro-locking shipped systems would be a live-ops
 * regression (plan §14.1). They stand as world history. Era 5 is the first
 * genuinely gated chapter: a server-wide effort capped by the FIRST MYTHIC
 * LEGACY AWAKENING as its credited trigger.
 */

export type EraStatus = 'locked' | 'admin_available' | 'milestone_active' | 'unlocked';

/** Global contribution counters (kv `era:contrib:<metric>`), bumped by the
 *  same settle endpoints that feed Legacy tracking. */
export type EraMetric =
    | 'missions'          // mission/hunt claims
    | 'pvpWins'           // validated PvP wins
    | 'discoveries'       // wanderer gifts/quests/ambushes claimed
    | 'warBattles'        // resolved sector-war battles
    | 'gateClears'        // Hollow Gate extractions
    | 'bossKills'         // weekly bosses brought down
    | 'legaciesAwakened'; // Stage-2 trial completions

export type EraMilestone = { metric: EraMetric; label: string; required: number };

export type EraTriggerKind = 'first-mythic-awakening';

export type EraDef = {
    id: string;
    number: 1 | 2 | 3 | 4 | 5;
    name: string;
    description: string;
    /** One-line lore shown under the banner. */
    lore: string;
    /** Chronicle beats — what actually happened, as history-book bullets. */
    chronicle: string[];
    /** Banner art (docs/legacy-assets.md §4). */
    banner: string;
    initialStatus: EraStatus;
    /** Server-wide contribution goals (all must be met). Empty = none. */
    milestones: EraMilestone[];
    /** The credited final trigger; unlock waits for it even after milestones. */
    trigger?: {
        kind: EraTriggerKind;
        label: string;
        /** Wearable title granted to the credited player. */
        title: string;
    };
    /** Announcement copy; "{player}" and "{village}" are substituted. */
    unlockTitle: string;
    unlockMessage: string;
};

export const ERA_DEFS: readonly EraDef[] = [
    {
        id: 'shinobi-awakening', number: 1, name: 'Era I — Shinobi Awakening',
        description: 'The founding age: villages rose, academies filled, and the first of this generation took their vows.',
        lore: 'Every legend in this hall began as a student watching the sunrise from a rooftop.',
        chronicle: [
            'Four villages — Stormveil, Ashen Leaf, Frostfang, Moonshadow — opened their academies to a new generation.',
            'The first sparring circles were drawn, the first jutsu misfired spectacularly, and the first rivalries were born over cafeteria seats.',
            'The Academy Trials produced this era\'s first Genin — some of whose names the Hall still carries.',
        ],
        banner: '/legacy/eras/era-1-shinobi-awakening.webp',
        initialStatus: 'unlocked', milestones: [],
        unlockTitle: 'ERA I — SHINOBI AWAKENING',
        unlockMessage: 'The villages opened their gates and a new generation of shinobi took their first steps.',
    },
    {
        id: 'hollow-gate-opens', number: 2, name: 'Era II — The Hollow Gate Opens',
        description: 'The seal beneath Central cracked, and the world learned what waits below.',
        lore: 'The Gate does not open for the curious. It opens for the ones who keep coming back.',
        chronicle: [
            'Surveyors mapping beneath Central found stonework older than any village — and a seal that hummed when touched.',
            'The first dive teams came back changed; the second came back rich; the third did not come back, and the Warden appeared soon after.',
            'Divers learned the Gate\'s one rule: the deeper floors do not forgive greed. Extraction became a discipline of its own.',
        ],
        banner: '/legacy/eras/era-2-hollow-gate-opens.webp',
        initialStatus: 'unlocked', milestones: [],
        unlockTitle: 'ERA II — THE HOLLOW GATE OPENS',
        unlockMessage: 'The seal beneath Central cracked. The Hollow Gate stands open to those willing to dive.',
    },
    {
        id: 'village-dominion', number: 3, name: 'Era III — Village Dominion',
        description: 'The four villages carried their rivalries onto the war map: sectors, sieges, and banners taken.',
        lore: 'Peace was never the plan. Balance was.',
        chronicle: [
            'The old border treaties dissolved the day the war maps were unfurled in every town hall.',
            'Sectors changed hands by blade, by pet, and — infamously — by card game. The tug-of-war never truly stops.',
            'Mercenary bands learned there was steady coin in other people\'s wars, and the roads got more interesting.',
        ],
        banner: '/legacy/eras/era-3-village-dominion.webp',
        initialStatus: 'unlocked', milestones: [],
        unlockTitle: 'ERA III — VILLAGE DOMINION',
        unlockMessage: 'The war maps unfurled. Every sector now remembers who held it, and who took it.',
    },
    {
        id: 'world-boss-awakening', number: 4, name: 'Era IV — World Boss Awakening',
        description: 'Great beasts stirred, and whole servers learned to fight one enemy together.',
        lore: 'It takes a village to raise a child — and four of them to fell what stirred beneath the mountain.',
        chronicle: [
            'The tremors were blamed on the Gate at first. Then something with a name older than the villages stood up.',
            'For the first time, four rival villages fought on the same side of a battle line — nobody called it peace, but it held.',
            'The weekly hunts began: every seven days something vast stirs, and the world queues up to disagree with it.',
        ],
        banner: '/legacy/eras/era-4-world-boss-awakening.webp',
        initialStatus: 'unlocked', milestones: [],
        unlockTitle: 'ERA IV — WORLD BOSS AWAKENING',
        unlockMessage: 'The first great beast fell to a hundred blades at once. More are stirring.',
    },
    {
        id: 'mythic-legacies', number: 5, name: 'Era V — Mythic Legacies',
        description: 'The age when the world itself begins to remember names: mythic trials, deeper floors, and legacies bound forever.',
        lore: 'Somewhere out there, a shinobi is about to do something no one has ever done. The world is holding its breath.',
        chronicle: [
            'A hooded elder with violet eyes has been seen on the roads, watching certain shinobi a moment too long.',
            'Eight strangers — a storm-caller, a masked mother, an iron pilgrim, a blade-keeper, a duel-broker, a hollow warden, a lantern-bearer, a mapless cartographer — walk the sectors with questions of their own.',
            'The world is keeping score now: every mission, duel, and dive feeds something that has not happened yet.',
        ],
        banner: '/legacy/eras/era-5-mythic-legacies.webp',
        initialStatus: 'milestone_active',
        // Mixed-category, server-wide (anti-chore-bar rule): steady numbers a
        // healthy server crosses in weeks of NORMAL play, admin-tunable live.
        milestones: [
            { metric: 'missions', label: 'Missions completed across the world', required: 5000 },
            { metric: 'pvpWins', label: 'Duels fought and won', required: 1500 },
            { metric: 'discoveries', label: 'Wanderer encounters resolved', required: 400 },
            { metric: 'gateClears', label: 'Hollow Gate extractions', required: 150 },
            { metric: 'legaciesAwakened', label: 'Legacies awakened', required: 25 },
        ],
        trigger: {
            kind: 'first-mythic-awakening',
            // Precise: the trigger is the first AWAKENING of a mythic-rarity
            // legacy (stage 1→2), not "The Mythic Trial" (the stage 4→5 kind).
            label: 'A shinobi awakens the first MYTHIC legacy',
            title: 'Herald of the Mythic Age',
        },
        unlockTitle: 'ERA V — MYTHIC LEGACIES',
        unlockMessage: '{player} has awakened the first mythic legacy, and the world crossed its threshold with them. The Mythic Age begins.',
    },
];

export const ERA_BY_ID: ReadonlyMap<string, EraDef> = new Map(ERA_DEFS.map((e) => [e.id, e]));

export const ERA_METRICS: readonly EraMetric[] = [
    'missions', 'pvpWins', 'discoveries', 'warBattles', 'gateClears', 'bossKills', 'legaciesAwakened',
];
