"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateFloor = validateFloor;
exports.validateCatalog = validateCatalog;
/*
 * Battle Towers — floor-catalog validator.
 *
 * Pure shape + cross-field checks so a malformed floor can't reach the engine or
 * the reward path. `validateFloor` returns a list of human-readable errors (empty
 * = valid); `validateCatalog` adds catalog-wide invariants (unique + contiguous
 * ids). Mirrors the api/missions/_mission-catalog validity pattern.
 */
const _floor_catalog_js_1 = require("./_floor-catalog.js");
const BOSS_MECHANIC_SET = new Set(_floor_catalog_js_1.TOWER_BOSS_MECHANICS);
const TARGET_MODE_SET = new Set(_floor_catalog_js_1.TOWER_TARGET_MODES);
const STRIKE_KIND_SET = new Set(_floor_catalog_js_1.TOWER_STRIKE_KINDS);
const OBJECTIVE_SET = new Set(_floor_catalog_js_1.TOWER_OBJECTIVES);
const BIOME_SET = new Set(_floor_catalog_js_1.TOWER_BIOMES);
const FIELD_RULE_KINDS = new Set(['none', 'hazard', 'debuff', 'buff']);
// Sane board bounds: at least room for 4 spawns + pods, no larger than the
// plan's 4× aspiration (24×20 = 480).
const MIN_DIM = 8;
const MAX_DIM = 24;
const MAX_TILES = 24 * 20;
function validateFloor(floor) {
    const errs = [];
    const where = `floor ${floor?.id ?? '?'}`;
    if (!Number.isInteger(floor.id) || floor.id < 1)
        errs.push(`${where}: id must be a positive integer`);
    if (typeof floor.name !== 'string' || floor.name.trim() === '')
        errs.push(`${where}: name required`);
    if (!BIOME_SET.has(floor.biome))
        errs.push(`${where}: invalid biome "${floor.biome}"`);
    if (!OBJECTIVE_SET.has(floor.objective))
        errs.push(`${where}: invalid objective "${floor.objective}"`);
    if (!Number.isInteger(floor.roundBudget) || floor.roundBudget < 1)
        errs.push(`${where}: roundBudget must be a positive integer`);
    if (floor.balanceFor != null && (!Number.isInteger(floor.balanceFor) || floor.balanceFor < 2 || floor.balanceFor > 4)) {
        errs.push(`${where}: balanceFor must be an integer in [2,4]`);
    }
    // Map dims
    const w = floor.map?.width;
    const h = floor.map?.height;
    if (!Number.isInteger(w) || w < MIN_DIM || w > MAX_DIM)
        errs.push(`${where}: map.width ${w} out of [${MIN_DIM},${MAX_DIM}]`);
    if (!Number.isInteger(h) || h < MIN_DIM || h > MAX_DIM)
        errs.push(`${where}: map.height ${h} out of [${MIN_DIM},${MAX_DIM}]`);
    const tiles = (w | 0) * (h | 0);
    if (tiles > MAX_TILES)
        errs.push(`${where}: map ${w}×${h} = ${tiles} tiles exceeds ${MAX_TILES}`);
    // Field rule
    if (!floor.fieldRule || !FIELD_RULE_KINDS.has(floor.fieldRule.kind)) {
        errs.push(`${where}: fieldRule.kind invalid`);
    }
    else if (floor.fieldRule.kind !== 'none') {
        const fr = floor.fieldRule;
        if (typeof fr.tag !== 'string' || fr.tag.trim() === '')
            errs.push(`${where}: fieldRule needs a tag`);
        if (fr.percent != null && (typeof fr.percent !== 'number' || fr.percent < 0 || fr.percent > 100)) {
            errs.push(`${where}: fieldRule.percent out of [0,100]`);
        }
    }
    // Enemy pods
    if (!Array.isArray(floor.enemies)) {
        errs.push(`${where}: enemies must be an array`);
    }
    else {
        floor.enemies.forEach((pod, i) => {
            if (!pod || typeof pod.aiId !== 'string' || pod.aiId.trim() === '')
                errs.push(`${where}: enemies[${i}].aiId required`);
            if (!Number.isInteger(pod.count) || pod.count < 1)
                errs.push(`${where}: enemies[${i}].count must be ≥1`);
            if (pod.spawnRound != null && (!Number.isInteger(pod.spawnRound) || pod.spawnRound < 1 || pod.spawnRound > floor.roundBudget)) {
                errs.push(`${where}: enemies[${i}].spawnRound out of [1,roundBudget]`);
            }
        });
    }
    // Cross-field: objective ⇒ required companions
    if (_floor_catalog_js_1.OBJECTIVES_NEEDING_BOSS.has(floor.objective)) {
        if (!floor.boss || typeof floor.boss.aiId !== 'string' || floor.boss.aiId.trim() === '') {
            errs.push(`${where}: objective "${floor.objective}" requires a boss.aiId`);
        }
    }
    if (floor.boss?.phases) {
        if (!Array.isArray(floor.boss.phases) || floor.boss.phases.some(p => typeof p !== 'number' || p <= 0 || p >= 100)) {
            errs.push(`${where}: boss.phases must be percentages in (0,100)`);
        }
    }
    if (floor.boss?.mechanic && !BOSS_MECHANIC_SET.has(floor.boss.mechanic)) {
        errs.push(`${where}: boss.mechanic "${floor.boss.mechanic}" is not a known mechanic`);
    }
    if (floor.boss?.summonAiId != null && typeof floor.boss.summonAiId !== 'string') {
        errs.push(`${where}: boss.summonAiId must be a string`);
    }
    if (floor.boss?.targetMode != null && !TARGET_MODE_SET.has(floor.boss.targetMode)) {
        errs.push(`${where}: boss.targetMode "${floor.boss.targetMode}" is not a known target mode`);
    }
    if (floor.boss?.strike != null) {
        const st = floor.boss.strike;
        if (!STRIKE_KIND_SET.has(st.kind))
            errs.push(`${where}: boss.strike.kind "${st.kind}" is not a known strike`);
        if (st.pct != null && (typeof st.pct !== 'number' || st.pct <= 0 || st.pct > 100))
            errs.push(`${where}: boss.strike.pct out of (0,100]`);
        if (st.radius != null && (!Number.isInteger(st.radius) || st.radius < 0 || st.radius > 2))
            errs.push(`${where}: boss.strike.radius out of [0,2]`);
        if (st.everyRounds != null && (!Number.isInteger(st.everyRounds) || st.everyRounds < 2))
            errs.push(`${where}: boss.strike.everyRounds must be an integer ≥2`);
        if (st.firstRound != null && (!Number.isInteger(st.firstRound) || st.firstRound < 1))
            errs.push(`${where}: boss.strike.firstRound must be a positive integer`);
    }
    if (floor.boss?.phasePillars != null && (!Number.isInteger(floor.boss.phasePillars) || floor.boss.phasePillars < 1 || floor.boss.phasePillars > 3)) {
        errs.push(`${where}: boss.phasePillars must be an integer in [1,3]`);
    }
    if (floor.boss?.aegis != null) {
        const ag = floor.boss.aegis;
        if (typeof ag.shieldPct !== 'number' || ag.shieldPct <= 0 || ag.shieldPct > 25) {
            errs.push(`${where}: boss.aegis.shieldPct out of (0,25]`);
        }
    }
    // Board objects (fonts / shrines): sane percents + a REQUIRED absolute cap on fonts.
    if (floor.boardObjects != null) {
        if (!Array.isArray(floor.boardObjects)) {
            errs.push(`${where}: boardObjects must be an array`);
        }
        else {
            if (floor.boardObjects.length > 3)
                errs.push(`${where}: at most 3 boardObjects per floor`);
            floor.boardObjects.forEach((o, i) => {
                const w2 = `${where}: boardObjects[${i}]`;
                const kind = o?.kind;
                if (kind === 'font') {
                    const f = o;
                    if (!['hp', 'chakra', 'stamina'].includes(String(f.resource)))
                        errs.push(`${w2}.resource invalid`);
                    if (typeof f.percent !== 'number' || f.percent <= 0 || f.percent > 25)
                        errs.push(`${w2}.percent out of (0,25]`);
                    if (!Number.isInteger(f.cap) || f.cap < 1 || f.cap > 500)
                        errs.push(`${w2}.cap must be an integer in [1,500]`);
                }
                else if (kind === 'shrine') {
                    const s2 = o;
                    if (typeof s2.percent !== 'number' || s2.percent <= 0 || s2.percent > 12)
                        errs.push(`${w2}.percent out of (0,12]`);
                    // Hard rule: never a shrine beside an uncapped-enrage boss (the engine also
                    // skips enraged attackers, but don't even author the temptation).
                    if (floor.boss?.mechanic === 'enrage')
                        errs.push(`${w2}: no shrine on an enrage-boss floor`);
                }
                else {
                    errs.push(`${w2}.kind invalid`);
                }
            });
        }
    }
    if (floor.closingRing != null) {
        const cr = floor.closingRing;
        if (cr.pct != null && (typeof cr.pct !== 'number' || cr.pct <= 0 || cr.pct > 100))
            errs.push(`${where}: closingRing.pct out of (0,100]`);
        if (cr.fromRound != null && (!Number.isInteger(cr.fromRound) || cr.fromRound < 1))
            errs.push(`${where}: closingRing.fromRound must be a positive integer`);
        if (cr.minRadius != null && (!Number.isInteger(cr.minRadius) || cr.minRadius < 1))
            errs.push(`${where}: closingRing.minRadius must be a positive integer`);
    }
    if (_floor_catalog_js_1.OBJECTIVES_NEEDING_NPC.has(floor.objective)) {
        if (!floor.npc || typeof floor.npc.aiId !== 'string' || floor.npc.aiId.trim() === '') {
            errs.push(`${where}: objective "${floor.objective}" requires an npc.aiId`);
        }
    }
    if (floor.npc?.pos != null && (!Number.isInteger(floor.npc.pos) || floor.npc.pos < 0 || floor.npc.pos >= tiles)) {
        errs.push(`${where}: npc.pos out of board`);
    }
    if (_floor_catalog_js_1.OBJECTIVES_NEEDING_GOAL.has(floor.objective)) {
        if (!Number.isInteger(floor.goalTile) || floor.goalTile < 0 || floor.goalTile >= tiles) {
            errs.push(`${where}: objective "${floor.objective}" requires goalTile within the board`);
        }
    }
    // Static terrain pillars (optional): a non-negative count, capped so the board can never
    // be more than a tenth blocked (the encounter builder clamps to the same fraction).
    if (floor.terrainPillars != null) {
        if (!Number.isInteger(floor.terrainPillars) || floor.terrainPillars < 0) {
            errs.push(`${where}: terrainPillars must be a non-negative integer`);
        }
        else if (floor.terrainPillars > Math.floor(tiles * 0.10)) {
            errs.push(`${where}: terrainPillars ${floor.terrainPillars} exceeds 10% of the ${tiles}-tile board`);
        }
    }
    // Battlefield features (optional tactical layer): in-board tiles, sane percent,
    // and pylons need an element pair. Keeps a malformed feature off the board.
    if (floor.features != null) {
        if (!Array.isArray(floor.features)) {
            errs.push(`${where}: features must be an array`);
        }
        else {
            floor.features.forEach((f, i) => {
                const w2 = `${where}: features[${i}]`;
                const kind = f?.kind;
                if (!f || (kind !== 'pylon' && kind !== 'ward' && kind !== 'hazard')) {
                    errs.push(`${w2}.kind invalid`);
                    return;
                }
                if (!Array.isArray(f.tiles) || f.tiles.length === 0 ||
                    f.tiles.some(t => !Number.isInteger(t) || t < 0 || t >= tiles)) {
                    errs.push(`${w2}.tiles must be non-empty in-board indices`);
                }
                if (typeof f.percent !== 'number' || f.percent < 0 || f.percent > 100) {
                    errs.push(`${w2}.percent out of [0,100]`);
                }
                if (f.kind === 'pylon') {
                    if (typeof f.element !== 'string' || f.element.trim() === '')
                        errs.push(`${w2}.element required for pylon`);
                    if (typeof f.weakenElement !== 'string' || f.weakenElement.trim() === '')
                        errs.push(`${w2}.weakenElement required for pylon`);
                }
            });
        }
    }
    // Reward shape
    const r = floor.firstClearReward;
    if (!r || typeof r !== 'object') {
        errs.push(`${where}: firstClearReward required`);
    }
    else {
        for (const k of ['ryo', 'xp', 'fateShards', 'boneCharms']) {
            const v = r[k];
            if (v != null && (typeof v !== 'number' || v < 0))
                errs.push(`${where}: firstClearReward.${k} must be ≥0`);
        }
        if (r.itemId != null && typeof r.itemId !== 'string')
            errs.push(`${where}: firstClearReward.itemId must be a string`);
        if (r.milestone != null && typeof r.milestone !== 'string')
            errs.push(`${where}: firstClearReward.milestone must be a string`);
    }
    return errs;
}
function validateCatalog(floors) {
    const errs = [];
    if (!Array.isArray(floors) || floors.length === 0) {
        errs.push('catalog: must be a non-empty array');
        return errs;
    }
    for (const f of floors)
        errs.push(...validateFloor(f));
    // Unique ids
    const ids = floors.map(f => f.id);
    const seen = new Set();
    for (const id of ids) {
        if (seen.has(id))
            errs.push(`catalog: duplicate floor id ${id}`);
        seen.add(id);
    }
    // Contiguous from 1 (so progression has no gaps)
    const sorted = [...ids].sort((a, b) => a - b);
    sorted.forEach((id, i) => {
        if (id !== i + 1)
            errs.push(`catalog: floor ids must be contiguous from 1 (got ${id} at position ${i + 1})`);
    });
    // Unique milestone keys (one-time rewards must not collide)
    const milestones = floors.map(f => f.firstClearReward?.milestone).filter((m) => !!m);
    const mSeen = new Set();
    for (const m of milestones) {
        if (mSeen.has(m))
            errs.push(`catalog: duplicate milestone key "${m}"`);
        mSeen.add(m);
    }
    return errs;
}
