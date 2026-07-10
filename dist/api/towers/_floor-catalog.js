"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PARTY_SCALE_FLOOR = exports.DEFAULT_PARTY_SIZE = exports.MAX_PARTY_SIZE = exports.MIN_PARTY_SIZE = exports.TOWER_FLOOR_COUNT = exports.CLAN_BOSS_FLOORS = exports.CLAN_BOSS_FLOOR_BASE = exports.FLOOR_CATALOG = exports.TOWER_STRIKE_KINDS = exports.TOWER_TARGET_MODES = exports.TOWER_BOSS_MECHANICS = exports.TOWER_BIOMES = exports.OBJECTIVES_NEEDING_GOAL = exports.OBJECTIVES_NEEDING_NPC = exports.OBJECTIVES_NEEDING_BOSS = exports.TOWER_OBJECTIVES = void 0;
exports.hexZone = hexZone;
exports.getFloor = getFloor;
exports.isPublicFloor = isPublicFloor;
exports.getFloorBalanceFor = getFloorBalanceFor;
exports.partyScaleFactor = partyScaleFactor;
exports.scaleEnemyStat = scaleEnemyStat;
exports.TOWER_OBJECTIVES = [
    'defeat-all', // clear every enemy
    'defeat-boss', // kill the boss; trash optional
    'defeat-all-then-boss', // clear trash, then the boss
    'protect-npc', // an allied NPC must survive
    'kill-escort', // clear all enemies AND keep the NPC alive
    'reach-tile', // reach the goal tile within the round budget
    'break-objective', // destroy a staged objective across phase gates
    'survive', // survive `roundBudget` rounds (boss unkillable)
    'kill-adds-first', // boss shielded until summoned adds die
];
// Objectives that REQUIRE a boss / npc / goal tile (cross-checked by the validator).
exports.OBJECTIVES_NEEDING_BOSS = new Set([
    'defeat-boss', 'defeat-all-then-boss', 'break-objective', 'kill-adds-first',
]);
exports.OBJECTIVES_NEEDING_NPC = new Set([
    'protect-npc', 'kill-escort',
]);
exports.OBJECTIVES_NEEDING_GOAL = new Set([
    'reach-tile',
]);
// Map biomes mirror the PvP session's valid biomes (api/pvp/session.ts).
exports.TOWER_BIOMES = ['forest', 'snow', 'volcano', 'shadow', 'central'];
// A boss's signature mechanic — what makes each fight distinct + tough. Resolved by
// the engine deterministically: 'enrage' ramps the boss's damage at each phase gate;
// 'summon' spawns reinforcements at each gate; 'regen' heals it every round; 'bulwark'
// makes it take half damage while any of its guards still live (kill the adds first).
exports.TOWER_BOSS_MECHANICS = ['enrage', 'summon', 'regen', 'bulwark'];
// A boss's AI target-selection policy — how it CHOOSES whom to strike. Absent = the
// default nearest-opponent policy (byte-identical to the pre-focus engine). All three
// modes are deterministic priority picks resolved by the engine (see api/towers/_engine.ts
// pickFocusTarget), and all prefer a target the boss can actually hit THIS turn so it never
// walks past a kill to chase a far one:
//   'lowest-hp'   — finish the wounded (classic focus-fire; ties fall to nearest).
//   'squishiest'  — hunt the lowest-defense squad member.
//   'support'     — prioritize whoever carries sustain jutsu (Heal/Lifesteal/Siphon/Shield/
//                   Absorb/Reflect); degrades to lowest-hp when no one runs sustain.
exports.TOWER_TARGET_MODES = ['lowest-hp', 'squishiest', 'support'];
// A recurring TELEGRAPHED boss strike (the "board attacks back" layer). Every `everyRounds`
// rounds (from `firstRound`) the boss paints a blast zone at round start — the squad gets that
// round to step off before it detonates at round end for a flat % of maxHp (OUTSIDE the wMult
// product, so it never interacts with enrage/statFactor). 'nova' centres on the boss (punishes
// melee stacking); 'volley' centres on the nearest squad member's tile (forces them to scatter).
exports.TOWER_STRIKE_KINDS = ['nova', 'volley'];
// Hex geometry (mirrors _engine.towerNeighbors) for laying out feature ZONES in
// the static catalog without depending on the engine module. Used by hexZone to
// build a pylon's 7-hex "flower" (centre + the 6 touching tiles).
function catalogHexNeighbors(pos, w, h) {
    const x = pos % w, y = Math.floor(pos / w);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas
        .map(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx < 0 || nx >= w || ny < 0 || ny >= h ? -1 : ny * w + nx; })
        .filter(n => n >= 0);
}
/** A pylon "flower" zone: a centre tile + the (up to) 6 hexes touching it. */
function hexZone(center, w, h) {
    return [center, ...catalogHexNeighbors(center, w, h)];
}
/** Valid PLACEHOLDER tiles for a catalog feature (a centred flower). The encounter
 *  builder re-places every feature procedurally, so these positions are never used at
 *  runtime — they only satisfy the validator's "non-empty, in-bounds tiles" check. */
function ph(w, h) {
    return hexZone(Math.floor(h / 2) * w + Math.floor(w / 2), w, h);
}
// ─── Seed catalog: 10 escalating floors on a roomy 20×14 board (22×16 / 24×16 for
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
const pylon = (w, h) => ({ kind: 'pylon', tiles: ph(w, h), element: 'Fire', weakenElement: 'Water', percent: 25, label: 'Pylon' });
const ward = (w, h, percent = 22) => ({ kind: 'ward', tiles: ph(w, h), percent, label: 'Warded Stone' });
const hazard = (w, h, percent = 12) => ({ kind: 'hazard', tiles: ph(w, h), percent, label: 'Hazard' });
exports.FLOOR_CATALOG = [
    {
        id: 1, name: 'Foothold', biome: 'forest', objective: 'defeat-all',
        roundBudget: 8, map: { width: 20, height: 14 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-bandit', count: 8 }],
        features: [pylon(20, 14), pylon(20, 14)],
        firstClearReward: { ryo: 400, xp: 150 },
    },
    {
        id: 2, name: 'Crossfire Glade', biome: 'forest', objective: 'defeat-all',
        roundBudget: 8, map: { width: 20, height: 14 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 15 },
        terrainPillars: 6, // terrain debuts here — light cover, learn to use it
        enemies: [{ aiId: 'grunt-bandit', count: 5 }, { aiId: 'grunt-archer', count: 4, spawnRound: 2 }],
        features: [pylon(20, 14), pylon(20, 14), pylon(20, 14), ward(20, 14, 20)],
        firstClearReward: { ryo: 600, xp: 220, boneCharms: 5 },
    },
    {
        id: 3, name: 'Frozen Gauntlet', biome: 'snow', objective: 'defeat-all',
        roundBudget: 9, map: { width: 20, height: 14 }, fieldRule: { kind: 'hazard', tag: 'Drain', percent: 5 },
        terrainPillars: 8,
        // Reworked off "reach the goal" (too easy here) into a hazard-strewn brawl. The Drain
        // field rule bleeds chakra — the well is the counter-play if you go claim it.
        boardObjects: [{ kind: 'font', resource: 'chakra', percent: 20, cap: 40, label: 'Chakra Well' }],
        enemies: [{ aiId: 'grunt-blocker', count: 6 }, { aiId: 'grunt-archer', count: 4 }],
        features: [pylon(20, 14), hazard(20, 14), hazard(20, 14)],
        firstClearReward: { ryo: 800, xp: 300 },
    },
    {
        id: 4, name: 'Hold the Line', biome: 'central', objective: 'protect-npc',
        roundBudget: 8, map: { width: 20, height: 14 }, fieldRule: { kind: 'debuff', tag: 'Increase Damage Taken', percent: 10 },
        enemies: [{ aiId: 'grunt-bandit', count: 5 }, { aiId: 'grunt-brute', count: 2 }, { aiId: 'grunt-archer', count: 2, spawnRound: 2 }],
        npc: { aiId: 'npc-genin' },
        features: [pylon(20, 14), pylon(20, 14), ward(20, 14, 25)],
        firstClearReward: { ryo: 1000, xp: 380, fateShards: 5 },
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
        boss: { aiId: 'boss-warden', phases: [60, 30], mechanic: 'bulwark', targetMode: 'squishiest', aegis: { shieldPct: 17 }, strike: { kind: 'volley', pct: 8, radius: 1, everyRounds: 3 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), ward(22, 16, 25)],
        firstClearReward: { ryo: 2000, xp: 800, fateShards: 10, milestone: 'tower-floor-5' },
    },
    {
        id: 6, name: 'The Acolyte Coven', biome: 'shadow', objective: 'defeat-all',
        roundBudget: 10, map: { width: 20, height: 14 }, fieldRule: { kind: 'none' },
        terrainPillars: 8,
        // A contested battle shrine mid-board: whoever holds it hits harder — take it and keep it.
        boardObjects: [{ kind: 'shrine', percent: 10, label: 'Battle Shrine' }, { kind: 'font', resource: 'chakra', percent: 20, cap: 40, label: 'Chakra Well' }],
        enemies: [{ aiId: 'grunt-acolyte', count: 5 }, { aiId: 'grunt-brute', count: 4 }],
        features: [pylon(20, 14), pylon(20, 14), pylon(20, 14), hazard(20, 14)],
        firstClearReward: { ryo: 1400, xp: 550, boneCharms: 8 },
    },
    {
        id: 7, name: 'The Hollow Revenant', biome: 'shadow', objective: 'defeat-boss',
        roundBudget: 16, map: { width: 22, height: 16 }, fieldRule: { kind: 'none' },
        terrainPillars: 10,
        // REGEN: the Revenant heals every round — burst it down through the heal. It hunts the
        // squad's sustain (Heal/Lifesteal/Siphon/Shield carriers) to win the attrition race.
        // A healing spring + chakra well are the squad's own sustain to contest back with.
        boardObjects: [{ kind: 'font', resource: 'hp', percent: 8, cap: 120, label: 'Healing Spring' }, { kind: 'font', resource: 'chakra', percent: 20, cap: 40, label: 'Chakra Well' }],
        enemies: [{ aiId: 'grunt-acolyte', count: 3 }],
        // VOLLEY — telegraphed strikes DEBUT here: a barrage at the nearest shinobi every 3
        // rounds. Violet tiles + a full round to scatter teach the read on a forgiving 8%.
        boss: { aiId: 'boss-revenant', phases: [66, 33], mechanic: 'regen', targetMode: 'support', strike: { kind: 'volley', pct: 11, radius: 1, everyRounds: 3 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), ward(22, 16, 25)],
        firstClearReward: { ryo: 2400, xp: 950, fateShards: 12 },
    },
    {
        id: 8, name: 'Escort the Vanguard', biome: 'central', objective: 'kill-escort',
        roundBudget: 12, map: { width: 20, height: 14 }, fieldRule: { kind: 'debuff', tag: 'Increase Damage Taken', percent: 10 },
        // Clear EVERY enemy while the ally survives.
        enemies: [{ aiId: 'grunt-bandit', count: 4 }, { aiId: 'grunt-brute', count: 2 }, { aiId: 'grunt-archer', count: 3, spawnRound: 2 }],
        npc: { aiId: 'npc-genin' },
        features: [pylon(20, 14), pylon(20, 14), ward(20, 14, 25), hazard(20, 14)],
        firstClearReward: { ryo: 1800, xp: 700, fateShards: 8 },
    },
    {
        id: 9, name: 'Pit of Embers', biome: 'volcano', objective: 'defeat-boss',
        roundBudget: 16, map: { width: 22, height: 16 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 10 },
        terrainPillars: 11,
        // SUMMON: the Ravager calls reinforcements at each phase — don't get swarmed. It presses
        // whoever's already wounded to snowball a kill through the swarm; the spring keeps the
        // line alive. (Nova debuts here — kept to ONE object so the swarm stays the story.)
        boardObjects: [{ kind: 'font', resource: 'hp', percent: 8, cap: 120, label: 'Healing Spring' }],
        enemies: [{ aiId: 'grunt-brute', count: 2 }],
        // NOVA debut: the Ravager erupts a boss-centred slam — melee learns to back off mid-swarm.
        boss: { aiId: 'boss-ravager', phases: [66, 33], mechanic: 'summon', summonAiId: 'grunt-bandit', summonCount: 3, targetMode: 'lowest-hp', strike: { kind: 'volley', pct: 14, radius: 1, everyRounds: 2, firstRound: 2 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), hazard(22, 16), hazard(22, 16)],
        firstClearReward: { ryo: 3000, xp: 1200, fateShards: 15 },
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
        boss: { aiId: 'boss-sovereign', phases: [75, 50, 25], mechanic: 'enrage', targetMode: 'lowest-hp', strike: { kind: 'nova', pct: 14, radius: 1, everyRounds: 2 }, phasePillars: 2 },
        closingRing: { pct: 3, fromRound: 11, minRadius: 3 },
        features: [pylon(24, 16), pylon(24, 16), pylon(24, 16), pylon(24, 16), ward(24, 16, 25), hazard(24, 16)],
        firstClearReward: { ryo: 6000, xp: 2500, fateShards: 30, milestone: 'tower-floor-10' },
    },
];
// ─── Clan Boss floors (api/clan-boss) ────────────────────────────────────────
// A SEPARATE registry in a reserved id range (9001+), so the public tower catalog
// (FLOOR_CATALOG / TOWER_FLOOR_COUNT / the floor-list UI) is untouched. getFloor()
// resolves these so the shared action/engine loop drives a clan-boss assault; the
// public /api/towers/start rejects them (isPublicFloor). Order + mechanic MUST match
// CLAN_BOSSES in api/clan-boss/_storage.ts (a test pins it). balanceFor: 3 (party of
// 3 clanmates). No firstClearReward — clan-boss rewards are paid weekly by the cron.
exports.CLAN_BOSS_FLOOR_BASE = 9001;
exports.CLAN_BOSS_FLOORS = [
    {
        id: exports.CLAN_BOSS_FLOOR_BASE + 0, name: 'The Oni Warlord', biome: 'volcano', objective: 'defeat-boss',
        roundBudget: 18, map: { width: 22, height: 16 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-brute', count: 3 }],
        // Elite kit (mirrors the story Sovereign): focus-fires the wounded + a periodic nova.
        // Gentle cadence (every 4) keeps the weekly chip economy intact — tune with clan-boss balance.
        boss: { aiId: 'clan-boss-oni', phases: [75, 50, 25], mechanic: 'enrage', targetMode: 'lowest-hp', strike: { kind: 'nova', pct: 8, radius: 1, everyRounds: 4 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), ward(22, 16, 25)],
        balanceFor: 3, firstClearReward: {},
    },
    {
        id: exports.CLAN_BOSS_FLOOR_BASE + 1, name: 'Abyssal Leviathan', biome: 'snow', objective: 'defeat-boss',
        roundBudget: 18, map: { width: 22, height: 16 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-acolyte', count: 2 }],
        boss: { aiId: 'clan-boss-leviathan', phases: [66, 33], mechanic: 'summon', summonAiId: 'grunt-bandit', summonCount: 2, targetMode: 'lowest-hp', strike: { kind: 'nova', pct: 8, radius: 1, everyRounds: 4 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), hazard(22, 16)],
        balanceFor: 3, firstClearReward: {},
    },
    {
        id: exports.CLAN_BOSS_FLOOR_BASE + 2, name: 'The Fallen Kage', biome: 'shadow', objective: 'defeat-boss',
        roundBudget: 18, map: { width: 22, height: 16 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-acolyte', count: 3 }],
        boss: { aiId: 'clan-boss-kage', phases: [66, 33], mechanic: 'regen', targetMode: 'support', strike: { kind: 'volley', pct: 8, radius: 1, everyRounds: 4 } },
        features: [pylon(22, 16), pylon(22, 16), pylon(22, 16), ward(22, 16, 25)],
        balanceFor: 3, firstClearReward: {},
    },
    {
        id: exports.CLAN_BOSS_FLOOR_BASE + 3, name: 'Ancient Stone Golem', biome: 'central', objective: 'defeat-boss',
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
function getFloor(id) {
    return exports.FLOOR_CATALOG.find(f => f.id === id) ?? exports.CLAN_BOSS_FLOORS.find(f => f.id === id);
}
/** True only for the public 1..N tower floors — clan-boss floors are excluded so the
 *  normal /api/towers/start can't launch a clan-boss assault outside the clan flow. */
function isPublicFloor(id) {
    return exports.FLOOR_CATALOG.some(f => f.id === id);
}
exports.TOWER_FLOOR_COUNT = exports.FLOOR_CATALOG.length;
// ─── Party size (2–4 scalable squad) ─────────────────────────────────────────
// The engine is N-actor, so party size is a RUN PARAMETER, not a fixed count — a
// duo, trio, or full squad all run the same floors. Floors are authored at
// MAX_PARTY_SIZE; smaller parties face enemies scaled by partyScaleFactor (the map,
// enemy positions, and objective are preserved — only enemy HP/damage scale, so the
// tactical puzzle stays intact). See docs/battle-towers-plan.md §28.
exports.MIN_PARTY_SIZE = 2;
exports.MAX_PARTY_SIZE = 4;
exports.DEFAULT_PARTY_SIZE = 4;
// A small party never faces enemies weaker than this fraction of the 4-balance — keeps
// a duo a real fight, not a pushover. Starting curve; tune in the balance pass.
exports.PARTY_SCALE_FLOOR = 0.6;
function clampPartySize(n) {
    return Math.max(exports.MIN_PARTY_SIZE, Math.min(exports.MAX_PARTY_SIZE, Math.floor(Number(n) || exports.DEFAULT_PARTY_SIZE)));
}
/** The party size a floor is balanced for (default MAX_PARTY_SIZE), clamped to [2,4]. */
function getFloorBalanceFor(floor) {
    return clampPartySize(floor.balanceFor ?? exports.DEFAULT_PARTY_SIZE);
}
/**
 * Enemy-strength multiplier for a party smaller than the floor's balance baseline.
 * Sub-linear: a smaller party has fewer actions, but co-op coordination means enemies
 * shouldn't drop to a strict head-count ratio. `partySize >= balanceFor` → 1.0 (floors
 * are authored at the max party and are never scaled UP). Tunable starting curve.
 */
function partyScaleFactor(partySize, balanceFor = exports.DEFAULT_PARTY_SIZE) {
    const p = clampPartySize(partySize);
    const base = clampPartySize(balanceFor);
    if (p >= base)
        return 1;
    return Math.max(exports.PARTY_SCALE_FLOOR, p / base);
}
/** Apply a party-scale factor to an enemy's scalar stat (HP / damage). Never scales up; floor of 1. */
function scaleEnemyStat(value, factor) {
    const f = Math.min(1, Math.max(0, factor));
    return Math.max(1, Math.round((Number(value) || 0) * f));
}
