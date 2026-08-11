/*
 * Battle Towers — floor catalog (schema + v1 seed floors).
 *
 * Each floor is a curated tactical map: an objective, a map size, a field-rule
 * affix, enemy pods (+ an optional boss / NPC / goal tile), and a one-time
 * first-clear reward. The engine (api/towers/_engine.ts, Phase 1) INTERPRETS this
 * data — so new floors are content, not code. See docs/battle-towers-plan.md §19/§24.
 *
 * `aiId` / `npc.aiId` reference enemy templates that Phase 1 resolves from the
 * existing AI catalog (lib/combat-ai.ts builtinAis); here they are opaque ids the
 * validator only shape-checks. Rewards are ONE-TIME first-clear (Option A / no
 * seasons, Decision 5) and are paid server-side in api/towers/settle.ts, never
 * from the client.
 */

/** Increment only when shipped Story-Tower rules/rewards change. Active runs seal this value. */
export const TOWER_CATALOG_VERSION = 'story-tower-v2' as const;

export const TOWER_OBJECTIVES = [
    'defeat-all',           // clear every enemy
    'defeat-boss',          // kill the boss; trash optional
    'defeat-all-then-boss', // clear trash, then the boss
    'protect-npc',          // keep an allied NPC alive through `roundBudget` rounds
    'kill-escort',          // clear all enemies AND keep the NPC alive
    'reach-tile',           // reach the goal tile within the round budget
    'break-objective',      // destroy a staged objective across phase gates
    'survive',              // survive `roundBudget` rounds (boss unkillable)
    'kill-adds-first',      // boss shielded until summoned adds die
] as const;
export type TowerObjective = (typeof TOWER_OBJECTIVES)[number];

// Objectives that REQUIRE a boss / npc / goal tile (cross-checked by the validator).
export const OBJECTIVES_NEEDING_BOSS: ReadonlySet<TowerObjective> = new Set([
    'defeat-boss', 'defeat-all-then-boss', 'break-objective', 'kill-adds-first',
]);
export const OBJECTIVES_NEEDING_NPC: ReadonlySet<TowerObjective> = new Set([
    'protect-npc', 'kill-escort',
]);
export const OBJECTIVES_NEEDING_GOAL: ReadonlySet<TowerObjective> = new Set([
    'reach-tile',
]);

// Map biomes mirror the PvP session's valid biomes (api/pvp/session.ts).
export const TOWER_BIOMES = ['forest', 'snow', 'volcano', 'shadow', 'central'] as const;
export type TowerBiome = (typeof TOWER_BIOMES)[number];

// A per-floor passive "field rule" (Ley-Line-Disorder style, plan §19): one of
// hazard / debuff / buff, applied each round. `none` for warm-up floors.
export type TowerFieldRule =
    | { kind: 'none' }
    | { kind: 'hazard'; tag: string; percent?: number }
    | { kind: 'debuff'; tag: string; percent?: number }
    | { kind: 'buff'; tag: string; percent?: number };

// ── Positional battlefield features (a light tactical layer, server-authoritative) ──
// A handful of special tiles per floor that reward positioning — distinct from the
// floor-wide `fieldRule`. The engine (_engine.ts) applies these deterministically by
// position; the client (BattleTowerFight) draws them so they're actually usable. Kept
// deliberately small — a couple per floor, not a puzzle.
//   pylon  — a unit attacking FROM this tile deals +percent% with `element` and
//            −percent% with `weakenElement` (rewards standing your elementalist here).
//   ward   — a unit standing ON this tile takes −percent% damage (a cover anchor).
//   hazard — a living unit standing ON this tile at ROUND END takes percent% of its
//            max HP (zone control; "don't end the round in the fire").
export type TowerFeature =
    | { kind: 'pylon'; tiles: number[]; element: string; weakenElement: string; percent: number; label?: string }
    | { kind: 'ward'; tiles: number[]; percent: number; label?: string }
    | { kind: 'hazard'; tiles: number[]; percent: number; label?: string };

export type TowerEnemyPod = {
    aiId: string;
    count: number;
    /** spawn at the start of this round (waves/reinforcements); default round 1 */
    spawnRound?: number;
};

// ── Board objects (Layer-3 grid content: tiles worth GOING to) ───────────────
// Single-tile interactables the encounter builder scatters and the engine resolves
// each round by pure occupancy — no new actions, no state beyond who stands where:
//   font   — at ROUND END the living unit standing on it (any side) restores
//            min(cap, percent% of its max) of `resource`. `cap` is an ABSOLUTE
//            per-tick ceiling so a high-max unit can't out-sustain incoming DPS
//            and stall past the round cap (the regen-boss lesson). Squad HP
//            restores honour the Endless Spire heal-cut.
//   shrine — while a living squad/enemy unit HOLDS the tile, its whole team's
//            OUTGOING damage gains +percent%. Folded into the engine's wMult with
//            the summed product hard-capped (SHRINE_TEAM_CAP) and SKIPPED for any
//            enraged attacker, so it can never compound uncapped story enrage.
// `tiles` are resolved by the encounter builder (authored entries omit them).
export type TowerBoardObject =
    | { kind: 'font'; resource: 'hp' | 'chakra' | 'stamina'; percent: number; cap: number; tiles?: number[]; label?: string }
    | { kind: 'shrine'; percent: number; tiles?: number[]; label?: string };

// ── Dynamic hazards (recurring, round-timed board danger — fills the empty grid) ──
// A GEYSER is a fixed vent that erupts on a cadence: every `everyRounds` rounds (from
// `firstRound`) the tiles it occupies chip ANY living unit standing on them for `pct`% of maxHp
// at round end, telegraphed a round ahead via the crimson channel so both sides can step off
// (the AI avoids them). The encounter builder scatters `count` vents; the engine derives the
// eruption purely from the round number, so settle reproduces it. Absent = nothing (byte-identical).
export type TowerDynamicHazard = { kind: 'geyser'; count: number; pct: number; everyRounds: number; firstRound?: number };

// A boss's signature mechanic — what makes each fight distinct + tough. Resolved by
// the engine deterministically: 'enrage' ramps the boss's damage at each phase gate;
// 'summon' spawns reinforcements at each gate; 'regen' heals it every round; 'bulwark'
// makes it take half damage while any of its guards still live (kill the adds first).
export const TOWER_BOSS_MECHANICS = ['enrage', 'summon', 'regen', 'bulwark'] as const;
export type TowerBossMechanic = (typeof TOWER_BOSS_MECHANICS)[number];

// A boss's AI target-selection policy — how it CHOOSES whom to strike. Absent = the
// default nearest-opponent policy (byte-identical to the pre-focus engine). All three
// modes are deterministic priority picks resolved by the engine (see api/towers/_engine.ts
// pickFocusTarget), and all prefer a target the boss can actually hit THIS turn so it never
// walks past a kill to chase a far one:
//   'lowest-hp'   — finish the wounded (classic focus-fire; ties fall to nearest).
//   'squishiest'  — hunt the lowest-defense squad member.
//   'support'     — prioritize whoever carries sustain jutsu (Heal/Lifesteal/Siphon/Shield/
//                   Absorb/Reflect); degrades to lowest-hp when no one runs sustain.
export const TOWER_TARGET_MODES = ['lowest-hp', 'squishiest', 'support'] as const;
export type TowerTargetMode = (typeof TOWER_TARGET_MODES)[number];

// A recurring TELEGRAPHED boss strike (the "board attacks back" layer). Every `everyRounds`
// rounds (from `firstRound`) the boss paints a blast zone at round start — the squad gets that
// round to step off before it detonates at round end for a flat % of maxHp (OUTSIDE the wMult
// product, so it never interacts with enrage/statFactor). 'nova' centres on the boss (punishes
// melee stacking); 'volley' centres on the nearest squad member's tile (forces them to scatter);
// 'slam' is a boss-centred blast that ALSO knocks the caught squad away from the boss (combos
// with hazards — a slam into a geyser/hazard tile).
export const TOWER_STRIKE_KINDS = ['nova', 'volley', 'slam'] as const;
export type TowerStrikeKind = (typeof TOWER_STRIKE_KINDS)[number];
export type TowerBossStrike = {
    kind: TowerStrikeKind;
    /** % of each caught squad member's maxHp (capped in-engine at BOSS_STRIKE_MAX_PCT) */
    pct?: number;
    /** blast radius in hexes (0–2; default 1 → a 7-hex flower) */
    radius?: number;
    /** cadence: fires every N rounds (default 3) */
    everyRounds?: number;
    /** first round it can fire (default = everyRounds, so never round 1) */
    firstRound?: number;
};

export type TowerBoss = {
    aiId: string;
    /** HP-threshold phase gates as percentages, descending (e.g. [66, 33]) */
    phases?: number[];
    /** signature mechanic fired at each phase gate (or per-round for regen / passive for bulwark) */
    mechanic?: TowerBossMechanic;
    /** AI target-selection policy (absent = nearest-opponent; the engine focus-fires when set) */
    targetMode?: TowerTargetMode;
    /** recurring telegraphed AOE strike (absent = none; the boss just attacks normally) */
    strike?: TowerBossStrike;
    /** pillars erupted at EACH HP phase gate (1–3; absent = none). The engine drops them
     *  non-adjacent to all existing blocked tiles, so the arena provably stays connected. */
    phasePillars?: number;
    /** Aegis: a one-time SHIELD granted at each HP phase gate (percent of the boss's maxHp,
     *  hard-capped in-engine). Pure shield points — consumed by the normal damage pipeline,
     *  so it delays the kill without any stall/regen risk. Absent = none. */
    aegis?: { shieldPct: number };
    /** for 'summon': which add to spawn + how many per phase gate (default 2 grunt-bandit) */
    summonAiId?: string;
    summonCount?: number;
    /** per-floor authored boss max HP (Endless Spire): overrides the template hp so the same
     *  boss can be tuned floor-by-floor without an HP-scaled mechanic × big-HP blow-up. */
    hp?: number;
    /** per-round regen flat cap (Endless Spire regen boss) so 7%-of-maxHp can't outrun squad DPS
     *  at high floors; read by the engine's applyBossRegen. Absent = uncapped (story bosses). */
    regenFlatCap?: number;
};

export type TowerNpc = {
    aiId: string;
    /** tile index on the map; resolved/placed by the engine if omitted */
    pos?: number;
};

export type TowerReward = {
    ryo?: number;
    xp?: number;
    fateShards?: number;
    boneCharms?: number;
    /** One-time progression badge key. This is not a wearable/title entitlement. */
    milestone?: string;
};

/** Player-facing authored setup sealed beside the encounter rules. Keeping the briefing
 *  on the floor prevents lobby copy from drifting away from the waves/mechanics that the
 *  server actually runs. */
export type TowerFloorBriefing = {
    situation: string;
    tactics: string[];
    warnings: string[];
};

export type TowerFloor = {
    /** 1-based floor number, unique + contiguous within the catalog */
    id: number;
    name: string;
    biome: TowerBiome;
    objective: TowerObjective;
    /** round budget — a star-tier threshold for most objectives; the survive-count for `survive` */
    roundBudget: number;
    map: { width: number; height: number };
    fieldRule: TowerFieldRule;
    enemies: TowerEnemyPod[];
    boss?: TowerBoss;
    npc?: TowerNpc;
    /** positional battlefield features (pylons / wards / hazards) — optional tactical layer */
    features?: TowerFeature[];
    /** number of impassable terrain pillars to scatter into map.blockedTiles (cover; absent/0 =
     *  a clear board, byte-identical to the pre-terrain engine). The encounter builder places them
     *  deterministically + pairwise non-adjacent so the arena always stays connected. */
    terrainPillars?: number;
    /** closing-ring hazard (a shrinking safe zone that herds the fight to centre; absent = none).
     *  `pct` = %maxHp chip on the squad outside the ring, `fromRound` when it starts closing,
     *  `minRadius` the smallest safe core it collapses to. Pure (map, round) → settle reproduces it. */
    closingRing?: { pct?: number; fromRound?: number; minRadius?: number };
    /** board objects (fonts / shrines) scattered by the encounter builder — tiles worth
     *  holding. NEVER author a shrine on an uncapped-enrage floor (10 / clan bosses); the
     *  engine also skips the shrine term for enraged attackers as a second guard. */
    boardObjects?: TowerBoardObject[];
    /** dynamic hazards (geyser vents) scattered by the encounter builder — recurring, telegraphed
     *  round-timed tile danger that makes the board a live decision every round. Absent = none. */
    dynamicHazards?: TowerDynamicHazard[];
    /** goal tile index for `reach-tile` objectives */
    goalTile?: number;
    /** party size the enemy counts / boss HP are tuned for (2–4); default 4. Smaller
     *  parties face enemies scaled by partyScaleFactor(partySize, balanceFor). */
    balanceFor?: number;
    firstClearReward: TowerReward;
    /** Optional story presentation metadata. It is cosmetic, but sealed with the floor so
     *  an active run always retains the chapter copy it launched with across deploys. */
    chapter?: number;
    chapterTitle?: string;
    chapterSubtitle?: string;
    chapterSummary?: string;
    artKey?: string;
    briefing?: TowerFloorBriefing;
};

// Hex geometry (mirrors _engine.towerNeighbors) for laying out feature ZONES in
// the static catalog without depending on the engine module. Used by hexZone to
// build a pylon's 7-hex "flower" (centre + the 6 touching tiles).
function catalogHexNeighbors(pos: number, w: number, h: number): number[] {
    const x = pos % w, y = Math.floor(pos / w);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas
        .map(([dx, dy]) => { const nx = x + dx!, ny = y + dy!; return nx < 0 || nx >= w || ny < 0 || ny >= h ? -1 : ny * w + nx; })
        .filter(n => n >= 0);
}
/** A pylon "flower" zone: a centre tile + the (up to) 6 hexes touching it. */
export function hexZone(center: number, w: number, h: number): number[] {
    return [center, ...catalogHexNeighbors(center, w, h)];
}
/** Valid PLACEHOLDER tiles for a catalog feature (a centred flower). The encounter
 *  builder re-places every feature procedurally, so these positions are never used at
 *  runtime — they only satisfy the validator's "non-empty, in-bounds tiles" check. */
function ph(w: number, h: number): number[] {
    return hexZone(Math.floor(h / 2) * w + Math.floor(w / 2), w, h);
}

// ─── Chapter 1 seed catalog: 10 escalating floors on a roomy 20×14 board (22×16 / 24×16 for
// bosses). Varied objectives + 4 boss floors, each boss with a DISTINCT mechanic
// (bulwark / regen / summon / enrage). Features carry placeholder tiles (ph); the
// encounter builder scatters them procedurally each run and assigns 3-of-5 pylon
// elements. Milestones at floor 5 + floor 10.
//
// MECHANIC PACING (deliberate — don't stack everything on every floor): each system
// debuts ONCE, gets a floor to breathe, and only the finale converges them all.
//   F1  clean brawl (tutorial)              F6  + SHRINE (contested ground) + well
//   F2  + TERRAIN (light cover, 6)          F7  boss 2: regen/support-hunt + VOLLEY
//   F3  + FONT (chakra well vs Drain)           (telegraphed strikes debut) + sustain war
//   F4  protect-npc focus (no clutter)      F8  escort focus (no clutter)
//   F5  boss 1: bulwark + AEGIS +           F9  boss 3: summon/lowest-hp + NOVA debut
//       squishiest-hunt (NO strike yet)         + spring
//                                           F10 CONVERGENCE: enrage + nova + phase
//                                               pillars + closing ring (everything).
const pylon = (w: number, h: number): TowerFeature => ({ kind: 'pylon', tiles: ph(w, h), element: 'Fire', weakenElement: 'Water', percent: 25, label: 'Pylon' });
const ward = (w: number, h: number, percent = 22): TowerFeature => ({ kind: 'ward', tiles: ph(w, h), percent, label: 'Warded Stone' });
const hazard = (w: number, h: number, percent = 12): TowerFeature => ({ kind: 'hazard', tiles: ph(w, h), percent, label: 'Hazard' });
const CHAPTER_ONE_PRESENTATION = {
    chapter: 1,
    chapterTitle: 'The Celestial Ascent',
    chapterSubtitle: 'Ten trials stand between the forest gate and the throne above.',
    chapterSummary: 'Secure the lower ascent, defend its stranded shinobi, master four signature wardens, and dethrone the Sovereign before the summit collapses.',
} as const;
export const FLOOR_CATALOG: readonly TowerFloor[] = [
    {
        id: 1, name: 'Foothold', biome: 'forest', objective: 'defeat-all',
        roundBudget: 8, map: { width: 20, height: 14 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-bandit', count: 8 }],
        features: [pylon(20, 14), pylon(20, 14)],
        firstClearReward: { ryo: 400, xp: 150 },
        ...CHAPTER_ONE_PRESENTATION,
        artKey: 'foothold',
        briefing: {
            situation: 'Bandit outriders hold the forest gate and its two elemental Pylons. Take the first platform before the Tower can reinforce it.',
            tactics: [
                'Read each Pylon\'s element before committing a technique into its lane.',
                'Rotate wounded allies out of the Bandits\' Hamstring pressure instead of trading in place.',
                'Establish two attack lanes so the squad cannot be surrounded at the gate.',
            ],
            warnings: ['All eight Bandits begin on the field; this opening trial has no reinforcement wave or recurring floor hazard.'],
        },
    },
    {
        id: 2, name: 'Crossfire Glade', biome: 'forest', objective: 'defeat-all',
        roundBudget: 8, map: { width: 20, height: 14 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 15 },
        terrainPillars: 6, // terrain debuts here — light cover, learn to use it
        dynamicHazards: [{ kind: 'geyser', count: 3, pct: 4, everyRounds: 3 }], // geysers debut — learn the beat
        enemies: [{ aiId: 'grunt-bandit', count: 5 }, { aiId: 'grunt-archer', count: 4, spawnRound: 2 }],
        features: [pylon(20, 14), pylon(20, 14), pylon(20, 14), ward(20, 14, 20)],
        firstClearReward: { ryo: 600, xp: 220, boneCharms: 5 },
        ...CHAPTER_ONE_PRESENTATION,
        artKey: 'crossfire-glade',
        briefing: {
            situation: 'Bandits pin the glade while Archers prepare converging fire from the upper ruins.',
            tactics: [
                'Use the six stone pillars and Warded Stone to break the Archers\' sightlines.',
                'Exploit the 15% squad damage boon to remove the first Bandit line quickly.',
                'Leave glowing vent tiles before their eruption instead of spending healing through them.',
            ],
            warnings: ['Five Bandits open the fight; four Archers enter on round 2.', 'Three geysers first erupt on round 3, then repeat every 3 rounds.'],
        },
    },
    {
        id: 3, name: 'Frozen Gauntlet', biome: 'snow', objective: 'defeat-all',
        roundBudget: 9, map: { width: 20, height: 14 }, fieldRule: { kind: 'hazard', tag: 'Drain', percent: 5 },
        terrainPillars: 8,
        // Reworked off "reach the goal" (too easy here) into a hazard-strewn brawl. The Drain
        // field rule bleeds chakra — the well is the counter-play if you go claim it.
        boardObjects: [{ kind: 'font', resource: 'chakra', percent: 20, cap: 40, label: 'Chakra Well' }],
        dynamicHazards: [{ kind: 'geyser', count: 4, pct: 4, everyRounds: 3 }],
        enemies: [{ aiId: 'grunt-blocker', count: 6 }, { aiId: 'grunt-archer', count: 4 }],
        features: [pylon(20, 14), hazard(20, 14), hazard(20, 14)],
        firstClearReward: { ryo: 800, xp: 300 },
        ...CHAPTER_ONE_PRESENTATION,
        artKey: 'frozen-gauntlet',
        briefing: {
            situation: 'Shieldmen lock the frozen court while the Tower\'s Drain bleeds both health and chakra from every exposed shinobi.',
            tactics: [
                'Control the Chakra Well early so the squad can sustain techniques through the Drain.',
                'Flank Iron Brace and avoid Shield Bash rather than feeding attacks into the shield wall.',
                'Use safe pillar lanes to close on the Archers before crossfire overwhelms the court.',
            ],
            warnings: ['All ten enemies begin together.', 'Drain returns every round; four geysers begin on round 3 and two static hazard zones remain active.'],
        },
    },
    {
        id: 4, name: 'Hold the Line', biome: 'central', objective: 'protect-npc',
        roundBudget: 8, map: { width: 20, height: 14 }, fieldRule: { kind: 'debuff', tag: 'Increase Damage Taken', percent: 10 },
        // Timed defense, deliberately distinct from F8's kill-all escort: pressure arrives in
        // escalating lanes through round 6 and the squad wins by keeping the Genin alive for 8.
        enemies: [
            { aiId: 'grunt-bandit', count: 3 }, { aiId: 'grunt-brute', count: 1 },
            { aiId: 'grunt-archer', count: 2, spawnRound: 2 },
            { aiId: 'grunt-bandit', count: 2, spawnRound: 4 },
            { aiId: 'grunt-brute', count: 1, spawnRound: 6 },
        ],
        npc: { aiId: 'npc-genin' },
        features: [pylon(20, 14), pylon(20, 14), ward(20, 14, 25)],
        firstClearReward: { ryo: 1000, xp: 380, fateShards: 5 },
        ...CHAPTER_ONE_PRESENTATION,
        artKey: 'hold-the-line',
        briefing: {
            situation: 'A stranded Genin is transmitting the route upward. Hold the central court until the message clears the Tower.',
            tactics: [
                'Form an interception screen and keep every hostile lane away from the Genin.',
                'Use the Warded Stone to absorb the Archers\' ranged pressure when their wave appears.',
                'Rotate damaged defenders because the exposed court increases squad damage taken by 10%.',
            ],
            warnings: ['Hold through 8 completed rounds; clearing an early wave does not end the defense.', 'Waves arrive on rounds 2, 4, and 6 after the opening Bandits and Brute.'],
        },
    },
    {
        id: 5, name: 'Warden of the Spire', biome: 'volcano', objective: 'defeat-boss',
        roundBudget: 14, map: { width: 22, height: 16 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 10 },
        terrainPillars: 10,
        // FIRST BOSS — the wall. BULWARK (half damage while guards live) + AEGIS (fresh shield
        // at each gate) + hunts the softest guard. Deliberately NO telegraphed strike yet:
        // the player's first boss teaches "break the guards, burn the shield, protect your
        // squishy" — strikes debut on floor 7.
        enemies: [{ aiId: 'grunt-bandit', count: 3 }, { aiId: 'grunt-acolyte', count: 2, spawnRound: 2 }],
        boss: { aiId: 'boss-warden', phases: [60, 30], mechanic: 'bulwark', targetMode: 'squishiest', aegis: { shieldPct: 17 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), ward(22, 16, 25)],
        firstClearReward: { ryo: 2000, xp: 800, fateShards: 10, milestone: 'tower-floor-5' },
        ...CHAPTER_ONE_PRESENTATION,
        artKey: 'spire-warden',
        briefing: {
            situation: 'The Warden advances behind living guards and layered Aegis shields, testing whether the squad can coordinate a boss burn.',
            tactics: [
                'Remove every guard to end Bulwark\'s 50% damage reduction before committing major techniques.',
                'Protect the lowest-defense ally from the Warden\'s focus and pulling strike.',
                'Coordinate burst windows after the Aegis rises at 60% and 30% health.',
            ],
            warnings: ['Three Bandits open the chamber and two Acolytes enter on round 2.', 'The Warden has no recurring telegraphed strike, but each phase shield must be broken.'],
        },
    },
    {
        id: 6, name: 'The Acolyte Coven', biome: 'shadow', objective: 'defeat-all',
        roundBudget: 10, map: { width: 20, height: 14 }, fieldRule: { kind: 'none' },
        terrainPillars: 8,
        // A contested battle shrine mid-board: whoever holds it hits harder — take it and keep it.
        boardObjects: [{ kind: 'shrine', percent: 10, label: 'Battle Shrine' }, { kind: 'font', resource: 'chakra', percent: 20, cap: 40, label: 'Chakra Well' }],
        dynamicHazards: [{ kind: 'geyser', count: 4, pct: 4, everyRounds: 3 }],
        enemies: [{ aiId: 'grunt-acolyte', count: 5 }, { aiId: 'grunt-brute', count: 4 }],
        features: [pylon(20, 14), pylon(20, 14), pylon(20, 14), hazard(20, 14)],
        firstClearReward: { ryo: 1400, xp: 550, boneCharms: 8 },
        ...CHAPTER_ONE_PRESENTATION,
        artKey: 'acolyte-coven',
        briefing: {
            situation: 'The Coven and its Brute enforcers are fighting for a shrine that empowers whichever side controls it.',
            tactics: [
                'Remove Acolytes before their ground control divides the squad.',
                'Contest the Battle Shrine for its 10% team damage bonus instead of yielding the center.',
                'Rotate through the Chakra Well and keep Brute knockbacks away from active vents.',
            ],
            warnings: ['All nine enemies begin together and either team can benefit from the shrine.', 'Four geysers first erupt on round 3 while one static hazard remains active.'],
        },
    },
    {
        id: 7, name: 'The Hollow Revenant', biome: 'shadow', objective: 'defeat-all-then-boss',
        roundBudget: 16, map: { width: 22, height: 16 }, fieldRule: { kind: 'none' },
        terrainPillars: 10,
        // REGEN: the Revenant heals every round — burst it down through the heal. It hunts the
        // squad's sustain (Heal/Lifesteal/Siphon/Shield carriers) to win the attrition race.
        // A healing spring + chakra well are the squad's own sustain to contest back with.
        boardObjects: [{ kind: 'font', resource: 'hp', percent: 8, cap: 120, label: 'Healing Spring' }, { kind: 'font', resource: 'chakra', percent: 20, cap: 40, label: 'Chakra Well' }],
        enemies: [{ aiId: 'grunt-acolyte', count: 3 }],
        // VOLLEY — telegraphed strikes DEBUT here: a barrage at the nearest shinobi every 3
        // rounds. Violet tiles + a full round to scatter teach the read on a forgiving 11%.
        boss: { aiId: 'boss-revenant', phases: [66, 33], mechanic: 'regen', regenFlatCap: 650, targetMode: 'support', strike: { kind: 'volley', pct: 11, radius: 1, everyRounds: 3 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), ward(22, 16, 25)],
        firstClearReward: { ryo: 2400, xp: 950, fateShards: 12 },
        ...CHAPTER_ONE_PRESENTATION,
        artKey: 'hollow-revenant',
        briefing: {
            situation: 'Three Acolytes seal the Hollow Revenant while it rebuilds itself from the flooded catacomb.',
            tactics: [
                'Defeat the Acolytes to lower the boss barrier before attempting a burn.',
                'Contest both recovery fonts; hostile actors can exploit them if the squad yields the ground.',
                'Scatter from the violet volley marker and Clear Grave Mirror before resuming damage.',
            ],
            warnings: ['The Revenant regenerates up to 650 health every round and hunts support-oriented shinobi.', 'Its radius-one volley begins on round 3 and repeats every 3 rounds.'],
        },
    },
    {
        id: 8, name: 'Escort the Vanguard', biome: 'central', objective: 'kill-escort',
        roundBudget: 12, map: { width: 20, height: 14 }, fieldRule: { kind: 'debuff', tag: 'Increase Damage Taken', percent: 10 },
        // Clear EVERY enemy while the ally survives.
        enemies: [{ aiId: 'grunt-bandit', count: 4 }, { aiId: 'grunt-brute', count: 2 }, { aiId: 'grunt-archer', count: 3, spawnRound: 2 }],
        npc: { aiId: 'npc-genin' },
        features: [pylon(20, 14), pylon(20, 14), ward(20, 14, 25), hazard(20, 14)],
        firstClearReward: { ryo: 1800, xp: 700, fateShards: 8 },
        ...CHAPTER_ONE_PRESENTATION,
        artKey: 'escort-vanguard',
        briefing: {
            situation: 'The Vanguard must cross the central ruin while the squad clears every hostile lane around them.',
            tactics: [
                'Keep the squad between the Genin and every enemy instead of racing ahead.',
                'Eliminate the round-2 Archers before their crossfire settles on the escort.',
                'Prevent Brute knockbacks from driving the Genin or defenders into the static hazard.',
            ],
            warnings: ['Four Bandits and two Brutes begin the escort; three Archers enter on round 2.', 'Every enemy must fall and the Genin must survive; 12 rounds is the par pace, not a time limit.'],
        },
    },
    {
        id: 9, name: 'Pit of Embers', biome: 'volcano', objective: 'kill-adds-first',
        roundBudget: 16, map: { width: 22, height: 16 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 10 },
        terrainPillars: 11,
        // SUMMON: the Ravager calls reinforcements at each phase — don't get swarmed. It presses
        // whoever's already wounded to snowball a kill through the swarm; the spring keeps the
        // line alive. (Nova debuts here — kept to ONE object so the swarm stays the story.)
        boardObjects: [{ kind: 'font', resource: 'hp', percent: 8, cap: 120, label: 'Healing Spring' }],
        dynamicHazards: [{ kind: 'geyser', count: 4, pct: 5, everyRounds: 3, firstRound: 2 }], // the pit erupts
        enemies: [{ aiId: 'grunt-brute', count: 2 }],
        // NOVA debut: the Ravager erupts a boss-centred blast — melee learns to back off mid-swarm.
        boss: { aiId: 'boss-ravager', phases: [66, 33], mechanic: 'summon', summonAiId: 'grunt-bandit', summonCount: 3, targetMode: 'lowest-hp', strike: { kind: 'nova', pct: 14, radius: 1, everyRounds: 2, firstRound: 2 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), hazard(22, 16), hazard(22, 16)],
        firstClearReward: { ryo: 3000, xp: 1200, fateShards: 15 },
        ...CHAPTER_ONE_PRESENTATION,
        artKey: 'pit-of-embers',
        briefing: {
            situation: 'The Pit Ravager\'s living adds sustain its barrier, then return at both health gates to trap the squad inside the eruption cycle.',
            tactics: [
                'Clear the opening Brutes, push to one phase gate, then immediately swap to the summoned Bandits.',
                'Back away from the boss before each even-round nova and leave vent tiles before they erupt.',
                'Control the Healing Spring so lowest-health focus cannot snowball into a defeat.',
            ],
            warnings: ['Three Bandits appear at both 66% and 33% health, making the boss untargetable while they live.', 'The nova begins on round 2 every 2 rounds; four vents begin on round 2 every 3 rounds.'],
        },
    },
    {
        id: 10, name: 'The Spire Sovereign', biome: 'shadow', objective: 'defeat-boss',
        roundBudget: 18, map: { width: 24, height: 16 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 10 },
        terrainPillars: 12,
        // ENRAGE: the Sovereign hits harder at every phase gate — race the clock. It focus-fires
        // the wounded, ruthlessly closing out kills as its damage escalates.
        enemies: [{ aiId: 'grunt-acolyte', count: 2 }, { aiId: 'grunt-brute', count: 2 }],
        // NOVA + CLOSING RING + PHASE PILLARS: the Sovereign slams the arena while it collapses
        // inward and stone erupts at every phase gate — the whole battlefield escalates with it.
        // The chips are flat %-maxHp OUTSIDE wMult, so nothing compounds the uncapped story enrage.
        // NOT a slam: a knockback would un-cluster the party away from the Sovereign's radius nuke,
        // trivializing the final wall. Its threat is the collapsing ring squeezing you IN — a nova fits.
        boss: { aiId: 'boss-sovereign', phases: [75, 50, 25], mechanic: 'enrage', targetMode: 'lowest-hp', strike: { kind: 'nova', pct: 14, radius: 1, everyRounds: 2 }, phasePillars: 2 },
        closingRing: { pct: 3, fromRound: 11, minRadius: 3 },
        features: [pylon(24, 16), pylon(24, 16), pylon(24, 16), pylon(24, 16), ward(24, 16, 25), hazard(24, 16)],
        firstClearReward: { ryo: 6000, xp: 2500, fateShards: 30, milestone: 'tower-floor-10' },
        ...CHAPTER_ONE_PRESENTATION,
        artKey: 'spire-sovereign',
        briefing: {
            situation: 'The Spire Sovereign escalates through three enrage gates while the summit erupts into new walls and collapses around the squad.',
            tactics: [
                'Neutralize the Acolyte controllers and Brute displacement threats even though the boss is the only required kill.',
                'Move toward the safe core before the outer ring becomes lethal after round 11.',
                'Clear Reflect and cleanse Wound or Poison before committing to the final enrage burn.',
            ],
            warnings: ['At 75%, 50%, and 25% health the Sovereign gains 35% damage and raises two new pillars.', 'Its nova repeats every 2 rounds; the 3% closing ring first damages outer tiles on round 12.'],
        },
    },
    // ─── Chapter 2: The Stormglass Rebellion ───────────────────────────────────────
    // The Sovereign's defeat opens a second ascent rather than resetting the lessons of
    // F1-F10. Each floor composes familiar, already-canonical systems into a new tactical
    // problem: layered waves → staged boss break → timed protection → collapsing gauntlet →
    // add-gated phase finale. No Chapter 2 rule exists outside Tower combat.
    {
        id: 11, name: 'Stormglass Breach', biome: 'forest', objective: 'defeat-all',
        roundBudget: 12, map: { width: 22, height: 16 }, fieldRule: { kind: 'none' },
        terrainPillars: 9,
        boardObjects: [{ kind: 'font', resource: 'stamina', percent: 18, cap: 45, label: 'Grounding Font' }],
        dynamicHazards: [{ kind: 'geyser', count: 5, pct: 5, everyRounds: 3, firstRound: 2 }],
        enemies: [
            { aiId: 'stormglass-lancer', count: 4 },
            { aiId: 'stormglass-marksman', count: 3, spawnRound: 2 },
            { aiId: 'stormglass-weaver', count: 2, spawnRound: 4 },
        ],
        features: [pylon(22, 16), pylon(22, 16), ward(22, 16, 24), hazard(22, 16, 10)],
        firstClearReward: { ryo: 3500, xp: 1400, boneCharms: 10 },
        chapter: 2,
        chapterTitle: 'The Stormglass Rebellion',
        chapterSubtitle: 'Beyond the fallen throne, a weather-forged court awakens.',
        chapterSummary: "Breach the Regent's stormglass citadel, carry its warning across the lightning bridge, and break the crown directing the endless storm.",
        artKey: 'stormglass-breach',
        briefing: {
            situation: "The Sovereign's fall fractures a sealed gate, but the Regent's advance guard forms three lines inside the breach.",
            tactics: [
                'Dislodge Lancers before their driving attacks pin the squad against charged ground.',
                'Close on Marksmen before their crossfire settles, then cleanse the Weavers\' seals.',
                'Use the Grounding Font to sustain movement through the final wave.',
            ],
            warnings: ['Marksmen arrive on round 2; Weavers enter on round 4.', 'Storm vents begin erupting on round 2, then repeat every 3 rounds.'],
        },
    },
    {
        id: 12, name: 'The Thunder Archive', biome: 'snow', objective: 'break-objective',
        roundBudget: 17, map: { width: 24, height: 16 }, fieldRule: { kind: 'hazard', tag: 'Drain', percent: 3 },
        terrainPillars: 10,
        boardObjects: [{ kind: 'font', resource: 'chakra', percent: 20, cap: 45, label: 'Mnemonic Well' }],
        enemies: [{ aiId: 'stormglass-bastion', count: 2 }, { aiId: 'stormglass-weaver', count: 1, spawnRound: 3 }],
        boss: {
            aiId: 'boss-thunder-archivist', phases: [75, 50, 25], mechanic: 'bulwark',
            targetMode: 'support', strike: { kind: 'volley', pct: 12, radius: 1, everyRounds: 3, firstRound: 3 },
            phasePillars: 1, aegis: { shieldPct: 12 },
        },
        features: [pylon(24, 16), pylon(24, 16), pylon(24, 16), ward(24, 16, 25)],
        firstClearReward: { ryo: 4500, xp: 1800, fateShards: 14 },
        chapter: 2,
        chapterTitle: 'The Stormglass Rebellion',
        chapterSubtitle: 'Beyond the fallen throne, a weather-forged court awakens.',
        chapterSummary: "Breach the Regent's stormglass citadel, carry its warning across the lightning bridge, and break the crown directing the endless storm.",
        artKey: 'thunder-archive',
        briefing: {
            situation: 'The Thunder Archivist has bound the bridge route behind three living seals protected by mirrored sentinels.',
            tactics: [
                'Remove the Bastions to collapse the Archivist\'s Bulwark before burning each seal gate.',
                'Claim the Mnemonic Well to offset the Archive\'s chakra drain.',
                'Scatter from the violet volley marker before it detonates.',
            ],
            warnings: [
                'The objective clears at the third phase seal; killing the Archivist is not required.',
                'A Weaver enters on round 3 and sustains the Bulwark until removed.',
                'Every broken seal raises an Aegis and changes the arena with a new pillar.',
            ],
        },
    },
    {
        id: 13, name: 'Bridge of a Thousand Bolts', biome: 'central', objective: 'protect-npc',
        roundBudget: 10, map: { width: 22, height: 16 }, fieldRule: { kind: 'debuff', tag: 'Increase Damage Taken', percent: 8 },
        terrainPillars: 7,
        boardObjects: [{ kind: 'font', resource: 'hp', percent: 8, cap: 140, label: 'Wayfarer Spring' }],
        dynamicHazards: [{ kind: 'geyser', count: 6, pct: 5, everyRounds: 2, firstRound: 2 }],
        enemies: [
            { aiId: 'stormglass-lancer', count: 2 }, { aiId: 'stormglass-marksman', count: 1 },
            { aiId: 'stormglass-lancer', count: 2, spawnRound: 2 },
            { aiId: 'stormglass-marksman', count: 2, spawnRound: 4 },
            { aiId: 'stormglass-bastion', count: 1, spawnRound: 6 },
            { aiId: 'stormglass-weaver', count: 2, spawnRound: 8 },
        ],
        npc: { aiId: 'npc-tower-scout' },
        features: [pylon(22, 16), pylon(22, 16), ward(22, 16, 28), hazard(22, 16, 10)],
        firstClearReward: { ryo: 4200, xp: 1700, fateShards: 10 },
        chapter: 2,
        chapterTitle: 'The Stormglass Rebellion',
        chapterSubtitle: 'Beyond the fallen throne, a weather-forged court awakens.',
        chapterSummary: "Breach the Regent's stormglass citadel, carry its warning across the lightning bridge, and break the crown directing the endless storm.",
        artKey: 'thousand-bolt-bridge',
        briefing: {
            situation: 'A wounded Tower Scout carries the route to the crown. Hold the lightning bridge until the message is transmitted.',
            tactics: [
                'Anchor the Scout near the ward and intercept Lancers before they reach the squad line.',
                'Break away to eliminate Marksmen and Weavers when their waves appear.',
                'Rotate injured defenders through the Wayfarer Spring instead of abandoning the Scout.',
            ],
            warnings: ['The Scout must survive through round 10; clearing every enemy early is optional.', 'Attack waves arrive on rounds 2, 4, 6, and 8 while bridge vents erupt every even round.'],
        },
    },
    {
        id: 14, name: 'Hall of Broken Reflections', biome: 'shadow', objective: 'defeat-all',
        roundBudget: 14, map: { width: 24, height: 16 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 8 },
        terrainPillars: 12,
        closingRing: { pct: 3, fromRound: 8, minRadius: 4 },
        boardObjects: [{ kind: 'shrine', percent: 8, label: 'Prism Shrine' }],
        dynamicHazards: [{ kind: 'geyser', count: 5, pct: 5, everyRounds: 3, firstRound: 3 }],
        enemies: [
            { aiId: 'stormglass-bastion', count: 3 }, { aiId: 'stormglass-marksman', count: 2 },
            { aiId: 'stormglass-weaver', count: 3, spawnRound: 3 },
            { aiId: 'stormglass-lancer', count: 3, spawnRound: 5 },
        ],
        features: [pylon(24, 16), pylon(24, 16), pylon(24, 16), ward(24, 16, 24), hazard(24, 16, 11)],
        firstClearReward: { ryo: 5000, xp: 2100, fateShards: 12, boneCharms: 12 },
        chapter: 2,
        chapterTitle: 'The Stormglass Rebellion',
        chapterSubtitle: 'Beyond the fallen throne, a weather-forged court awakens.',
        chapterSummary: "Breach the Regent's stormglass citadel, carry its warning across the lightning bridge, and break the crown directing the endless storm.",
        artKey: 'broken-reflections',
        briefing: {
            situation: 'The inner hall folds the Regiment into overlapping firing lanes while its mirrored walls close toward the central shrine.',
            tactics: [
                'Break a Bastion lane, then contest the Prism Shrine before the ranged wave arrives.',
                'Use pillars to shorten sightlines and force Marksmen toward the squad.',
                'Move inward before the closing ring leaves the outer galleries unsafe.',
            ],
            warnings: ['Weavers enter on round 3; Lancers flank on round 5.', 'The safe area contracts after round 8.'],
        },
    },
    {
        id: 15, name: 'The Stormglass Crown', biome: 'volcano', objective: 'kill-adds-first',
        roundBudget: 20, map: { width: 24, height: 18 }, fieldRule: { kind: 'none' },
        terrainPillars: 13,
        closingRing: { pct: 3, fromRound: 11, minRadius: 3 },
        boardObjects: [{ kind: 'font', resource: 'hp', percent: 8, cap: 150, label: 'Eye of the Storm' }],
        dynamicHazards: [{ kind: 'geyser', count: 6, pct: 5, everyRounds: 3, firstRound: 2 }],
        enemies: [{ aiId: 'stormglass-bastion', count: 2 }, { aiId: 'stormglass-marksman', count: 2 }],
        boss: {
            aiId: 'boss-stormglass-regent', phases: [70, 40], mechanic: 'summon',
            summonAiId: 'stormglass-weaver', summonCount: 2, targetMode: 'support',
            strike: { kind: 'slam', pct: 12, radius: 1, everyRounds: 3, firstRound: 2 },
            phasePillars: 2, aegis: { shieldPct: 10 },
        },
        features: [pylon(24, 18), pylon(24, 18), pylon(24, 18), pylon(24, 18), ward(24, 18, 25), hazard(24, 18, 12), hazard(24, 18, 12)],
        firstClearReward: { ryo: 9000, xp: 3600, fateShards: 45, boneCharms: 15, milestone: 'tower-floor-15' },
        chapter: 2,
        chapterTitle: 'The Stormglass Rebellion',
        chapterSubtitle: 'Beyond the fallen throne, a weather-forged court awakens.',
        chapterSummary: "Breach the Regent's stormglass citadel, carry its warning across the lightning bridge, and break the crown directing the endless storm.",
        artKey: 'stormglass-crown',
        briefing: {
            situation: 'The Stormglass Regent conducts the endless storm from a crown of mirrored pylons. Break the court, then the crown.',
            tactics: [
                'Destroy every retainer to lower the Crown Barrier before attacking the Regent.',
                'At each phase gate, eliminate the summoned Weavers before resuming damage.',
                'Read the Regent\'s slam and avoid being knocked from the safe core into an active vent.',
            ],
            warnings: ['Living adds make the Regent completely untargetable, including after phase summons.', 'The arena reshapes at 70% and 40% HP, then contracts after round 11.'],
        },
    },
];

// ─── Clan Boss floors (api/clan-boss) ────────────────────────────────────────
// A SEPARATE registry in a reserved id range (9001+), so the public tower catalog
// (FLOOR_CATALOG / TOWER_FLOOR_COUNT / the floor-list UI) is untouched. getFloor()
// resolves these so the shared action/engine loop drives a clan-boss assault; the
// public /api/towers/start rejects them (isPublicFloor). Order + mechanic MUST match
// CLAN_BOSSES in api/clan-boss/_storage.ts (a test pins it). balanceFor: 3 (party of
// 3 clanmates). No firstClearReward — clan-boss rewards are paid weekly by the cron.
export const CLAN_BOSS_FLOOR_BASE = 9001;
export const CLAN_BOSS_FLOORS: readonly TowerFloor[] = [
    {
        id: CLAN_BOSS_FLOOR_BASE + 0, name: 'The Oni Warlord', biome: 'volcano', objective: 'defeat-boss',
        roundBudget: 18, map: { width: 22, height: 16 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-brute', count: 3 }],
        // Elite kit: focus-fires the wounded + a periodic SEISMIC SLAM — the Warlord's ground-pound
        // hurls the caught back (fits a melee brute, and scatter costs less here than on the razor-tuned
        // story floors). Gentle cadence (every 4) keeps the weekly chip economy intact — tune with clan balance.
        boss: { aiId: 'clan-boss-oni', phases: [75, 50, 25], mechanic: 'enrage', targetMode: 'lowest-hp', strike: { kind: 'slam', pct: 8, radius: 1, everyRounds: 4 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), ward(22, 16, 25)],
        balanceFor: 3, firstClearReward: {},
    },
    {
        id: CLAN_BOSS_FLOOR_BASE + 1, name: 'Abyssal Leviathan', biome: 'snow', objective: 'defeat-boss',
        roundBudget: 18, map: { width: 22, height: 16 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-acolyte', count: 2 }],
        boss: { aiId: 'clan-boss-leviathan', phases: [66, 33], mechanic: 'summon', summonAiId: 'grunt-bandit', summonCount: 2, targetMode: 'lowest-hp', strike: { kind: 'nova', pct: 8, radius: 1, everyRounds: 4 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), hazard(22, 16)],
        balanceFor: 3, firstClearReward: {},
    },
    {
        id: CLAN_BOSS_FLOOR_BASE + 2, name: 'The Fallen Kage', biome: 'shadow', objective: 'defeat-boss',
        roundBudget: 18, map: { width: 22, height: 16 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-acolyte', count: 3 }],
        // The operation can be entered solo. Cap regeneration below a competent
        // solo player's per-round pressure so the low-population fallback always
        // banks progress instead of hitting a binary percentage-heal wall.
        boss: { aiId: 'clan-boss-kage', phases: [66, 33], mechanic: 'regen', regenFlatCap: 150, targetMode: 'support', strike: { kind: 'volley', pct: 8, radius: 1, everyRounds: 4 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), ward(22, 16, 25)],
        balanceFor: 3, firstClearReward: {},
    },
    {
        id: CLAN_BOSS_FLOOR_BASE + 3, name: 'Ancient Stone Golem', biome: 'central', objective: 'defeat-boss',
        roundBudget: 20, map: { width: 22, height: 16 }, fieldRule: { kind: 'none' },
        // BULWARK: the golem takes half damage while its guards live — break them first.
        // Elite kit hunts the softest guard + a periodic nova (no aegis — a shield would absorb
        // boss-HP damage and shrink the weekly chip pool).
        enemies: [{ aiId: 'grunt-blocker', count: 3 }],
        boss: { aiId: 'clan-boss-golem', phases: [60, 30], mechanic: 'bulwark', targetMode: 'squishiest', strike: { kind: 'nova', pct: 8, radius: 1, everyRounds: 4 } },
        features: [pylon(22, 16), pylon(22, 16), ward(22, 16, 25), ward(22, 16, 25)],
        balanceFor: 3, firstClearReward: {},
    },
];

export function getFloor(id: number): TowerFloor | undefined {
    return FLOOR_CATALOG.find(f => f.id === id) ?? CLAN_BOSS_FLOORS.find(f => f.id === id);
}

/** True only for the public 1..N tower floors — clan-boss floors are excluded so the
 *  normal /api/towers/start can't launch a clan-boss assault outside the clan flow. */
export function isPublicFloor(id: number): boolean {
    return FLOOR_CATALOG.some(f => f.id === id);
}

export const TOWER_FLOOR_COUNT = FLOOR_CATALOG.length;

// ─── Party size (2–4 scalable squad) ─────────────────────────────────────────
// The engine is N-actor, so party size is a RUN PARAMETER, not a fixed count — a
// duo, trio, or full squad all run the same floors. Floors are authored at
// MAX_PARTY_SIZE; smaller parties face enemies scaled by partyScaleFactor (the map,
// enemy positions, and objective are preserved — only enemy HP/damage scale, so the
// tactical puzzle stays intact). See docs/battle-towers-plan.md §28.
export const MIN_PARTY_SIZE = 2;
export const MAX_PARTY_SIZE = 4;
export const DEFAULT_PARTY_SIZE = 4;
// A small party never faces enemies weaker than this fraction of the 4-balance — keeps
// a duo a real fight, not a pushover. Starting curve; tune in the balance pass.
export const PARTY_SCALE_FLOOR = 0.6;

function clampPartySize(n: number): number {
    return Math.max(MIN_PARTY_SIZE, Math.min(MAX_PARTY_SIZE, Math.floor(Number(n) || DEFAULT_PARTY_SIZE)));
}

/** The party size a floor is balanced for (default MAX_PARTY_SIZE), clamped to [2,4]. */
export function getFloorBalanceFor(floor: TowerFloor): number {
    return clampPartySize(floor.balanceFor ?? DEFAULT_PARTY_SIZE);
}

/**
 * Enemy-strength multiplier for a party smaller than the floor's balance baseline.
 * Sub-linear: a smaller party has fewer actions, but co-op coordination means enemies
 * shouldn't drop to a strict head-count ratio. `partySize >= balanceFor` → 1.0 (floors
 * are authored at the max party and are never scaled UP). Tunable starting curve.
 */
export function partyScaleFactor(partySize: number, balanceFor: number = DEFAULT_PARTY_SIZE): number {
    const p = clampPartySize(partySize);
    const base = clampPartySize(balanceFor);
    if (p >= base) return 1;
    return Math.max(PARTY_SCALE_FLOOR, p / base);
}

/** Apply a party-scale factor to an enemy's scalar stat (HP / damage). Never scales up; floor of 1. */
export function scaleEnemyStat(value: number, factor: number): number {
    const f = Math.min(1, Math.max(0, factor));
    return Math.max(1, Math.round((Number(value) || 0) * f));
}
