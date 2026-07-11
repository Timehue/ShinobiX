"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INFILTRATION_ROUND_BUDGET = exports.INFILTRATION_MAP = exports.INFILTRATION_FLOOR_ID = void 0;
exports.biomeForTerrain = biomeForTerrain;
exports.makeInfiltrationFloor = makeInfiltrationFloor;
exports.buildInfiltrationEncounter = buildInfiltrationEncounter;
/*
 * Anbu Vault Infiltration — encounter builder (combat construction).
 *
 * Builds the vault fight as a Battle Towers session (reusing the shared engine,
 * exactly like the clan-boss assault) but with the DEFENDER being a sealed real
 * player — one of the target village's appointed Anbu — instead of a static
 * template boss. An enemy is just a TowerActor with a `character`, so we seal the
 * Anbu with sealTowerFighter and drop it in as the boss actor; the engine then runs
 * it at full strength with its real loadout and boss focus-fire targeting. No engine
 * change — this is construction, mirroring api/towers/_encounter.ts squadActor.
 *
 * Pure + deterministic (runId/seed/now passed in), so it is unit-testable and a
 * settle recompute reproduces it. The synthetic floor it returns is NOT in the
 * public FLOOR_CATALOG (getFloor never resolves it); the infiltration endpoints
 * hand it straight to the engine + their own settle (never the public tower flow).
 */
const _tower_session_js_1 = require("./towers/_tower-session.js");
/** Reserved floor id for infiltration runs — distinct from the public 1..N floors
 *  and the clan-boss range (9001+). Only ever used as a session tag / engine handle;
 *  the boss identity lives on the sealed actor, not the floor. */
exports.INFILTRATION_FLOOR_ID = 9101;
/** A roomy 1v1 arena. The fight ends on a KO, not the clock, so the budget is generous. */
exports.INFILTRATION_MAP = { width: 12, height: 9 };
exports.INFILTRATION_ROUND_BUDGET = 24;
const VALID_BIOMES = ['forest', 'snow', 'volcano', 'shadow', 'central'];
function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
/** Map the sector's stored terrain to a valid tower biome so the +10% home-terrain
 *  school edge applies (identical mechanic to sector wars); anything else is neutral. */
function biomeForTerrain(terrain) {
    const t = String(terrain ?? '').toLowerCase();
    return VALID_BIOMES.includes(t) ? t : 'central';
}
function vitals(character) {
    return {
        maxHp: Math.max(1, num(character.maxHp, 1000) || 1000),
        maxChakra: Math.max(0, num(character.maxChakra, 50) || 50),
        maxStamina: Math.max(0, num(character.maxStamina, 50) || 50),
    };
}
/** Build a full-strength combat actor from a sealed fighter. The raider is the live
 *  human squad member; the Anbu is the AI-driven enemy boss (focus-fire targeting).
 *  Mirrors api/towers/_encounter.ts squadActor so the actor shape matches the engine. */
function fighterActor(id, side, f, pos, opts) {
    const { maxHp, maxChakra, maxStamina } = vitals(f.character);
    const character = { ...f.character };
    if (opts.boss) {
        // Cosmetic client hint + the smartest available AI target policy. The engine
        // reads these off the actor's character (see _encounter.ts boss wiring). No
        // enrage/summon mechanic in v1 — a full-strength real loadout is the difficulty;
        // mechanics stay a balance knob.
        character.boss = true;
        character.aiTargetMode = 'lowest-hp';
    }
    return {
        id, side, name: f.name,
        // Enemy AI carries no ownerSlug (matches the template-enemy contract); the run
        // record tracks WHICH Anbu defended separately.
        ownerSlug: opts.ai ? null : f.slug,
        ai: opts.ai,
        hp: maxHp, maxHp, chakra: maxChakra, maxChakra, stamina: maxStamina, maxStamina,
        shield: 0, statuses: [], cooldowns: {}, pos, character,
        itemCharges: opts.ai ? {} : (f.itemCharges ? { ...f.itemCharges } : {}),
    };
}
/** The synthetic floor the engine runs the vault fight on. Static shell (objective,
 *  map, biome, round budget); the boss's combat identity is the sealed actor, so
 *  `boss.aiId` is an opaque handle the engine never resolves to a template here. */
function makeInfiltrationFloor(biome) {
    return {
        id: exports.INFILTRATION_FLOOR_ID,
        name: 'Anbu Vault',
        biome,
        objective: 'defeat-boss',
        roundBudget: exports.INFILTRATION_ROUND_BUDGET,
        map: { width: exports.INFILTRATION_MAP.width, height: exports.INFILTRATION_MAP.height },
        fieldRule: { kind: 'none' },
        enemies: [],
        boss: { aiId: 'anbu-defender', phases: [], targetMode: 'lowest-hp' },
        firstClearReward: {},
    };
}
/**
 * Build the vault-fight session: the raider (squad, left) vs the sealed Anbu (enemy
 * boss, right) on a `terrain`-biomed arena. Returns the session AND the synthetic
 * floor — the run/action/settle endpoints need the floor to drive the shared engine
 * (applyAction / checkTowerWinner take a TowerFloor). Deterministic.
 */
function buildInfiltrationEncounter(p) {
    const biome = biomeForTerrain(p.terrain);
    const floor = makeInfiltrationFloor(biome);
    const W = floor.map.width, H = floor.map.height;
    const midRow = Math.floor(H / 2);
    const raiderPos = midRow * W + 1; // left flank
    const anbuPos = midRow * W + (W - 2); // right flank (defending the vault)
    const raider = fighterActor('sq-0', 'squad', p.raider, raiderPos, { ai: false });
    const anbu = fighterActor('boss', 'enemy', p.anbu, anbuPos, { ai: true, boss: true });
    const map = {
        width: W, height: H, biome,
        blockedTiles: [], hazardTiles: [], objectiveTiles: [],
    };
    const session = (0, _tower_session_js_1.createTowerSession)({
        towerId: 'anbu-infiltration',
        runId: p.runId,
        floor: floor.id,
        seed: p.seed,
        partySize: 1,
        map,
        actors: [raider, anbu],
        objectiveKind: floor.objective,
        bossId: 'boss',
        bossPhases: [],
        now: p.now,
    });
    return { session, floor };
}
