"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTowerEncounter = buildTowerEncounter;
/*
 * Battle Towers — encounter builder (Phase 1, P1.B).
 *
 * Bridges the floor catalog → the engine: given a floor, a sealed squad roster, a seed,
 * and party size, it builds a ready-to-run TowerSession — squad actors from sanitized
 * save snapshots, enemy/boss/npc actors from _enemy-templates, deterministic spawn
 * placement, and party-scaled enemy stats. This is what api/towers/start.ts calls after
 * it snapshots + seals the roster. Pure + deterministic (no kv, no Math.random/Date.now;
 * runId/seed/now are passed in by the handler). See docs/battle-towers-plan.md §4, §28.
 */
const _tower_session_js_1 = require("./_tower-session.js");
const _engine_js_1 = require("./_engine.js");
const _enemy_templates_js_1 = require("./_enemy-templates.js");
const SQUAD_COL = 0;
const NPC_COL = 1;
// Deterministic spawn: squad on the left edge, npc one column in, enemies on the right
// edge — rows fill top-down (wrapping by height). For v1 floors (≤ height actors per
// side) there are no collisions; distinct columns keep sides apart on any width ≥ 3.
function spawnTile(map, index, side) {
    const w = map.width;
    const h = map.height;
    const row = index % h;
    const col = side === 'squad' ? SQUAD_COL : side === 'npc' ? NPC_COL : w - 1;
    return row * w + col;
}
function vitals(character, fallbackHp) {
    const maxHp = Math.max(1, Number(character.maxHp ?? fallbackHp) || fallbackHp);
    const maxChakra = Math.max(0, Number(character.maxChakra ?? 50) || 50);
    const maxStamina = Math.max(0, Number(character.maxStamina ?? 50) || 50);
    return { maxHp, maxChakra, maxStamina };
}
function squadActor(m, pos) {
    const { maxHp, maxChakra, maxStamina } = vitals(m.character, 1000);
    return {
        id: m.id, side: 'squad', name: m.name, ownerSlug: m.ownerSlug, ai: m.ai,
        hp: maxHp, maxHp, chakra: maxChakra, maxChakra, stamina: maxStamina, maxStamina,
        shield: 0, statuses: [], cooldowns: {}, pos, character: m.character,
    };
}
function templateActor(id, side, tpl, pos, ownerSlug = null) {
    return {
        id, side, name: tpl.name, ownerSlug, ai: true,
        hp: tpl.hp, maxHp: tpl.hp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], cooldowns: {}, pos,
        character: { specialty: tpl.specialty, stats: { ...tpl.stats } },
    };
}
function buildTowerEncounter(p) {
    const { floor, squad } = p;
    const map = {
        width: floor.map.width,
        height: floor.map.height,
        blockedTiles: [],
        hazardTiles: [],
        objectiveTiles: typeof floor.goalTile === 'number' ? [floor.goalTile] : [],
    };
    const actors = [];
    squad.forEach((m, i) => actors.push(squadActor(m, spawnTile(map, i, 'squad'))));
    let enemyIdx = 0;
    for (const pod of floor.enemies) {
        const tpl = (0, _enemy_templates_js_1.getEnemyTemplate)(pod.aiId);
        for (let k = 0; k < pod.count; k++) {
            actors.push(templateActor(`en-${enemyIdx}`, 'enemy', tpl, spawnTile(map, enemyIdx, 'enemy')));
            enemyIdx++;
        }
    }
    let bossId;
    let bossPhases;
    if (floor.boss) {
        bossId = 'boss';
        bossPhases = floor.boss.phases;
        actors.push(templateActor('boss', 'enemy', (0, _enemy_templates_js_1.getEnemyTemplate)(floor.boss.aiId), spawnTile(map, enemyIdx, 'enemy')));
        enemyIdx++;
    }
    if (floor.npc) {
        const pos = typeof floor.npc.pos === 'number' && floor.npc.pos >= 0 && floor.npc.pos < map.width * map.height
            ? floor.npc.pos
            : spawnTile(map, 0, 'npc');
        actors.push(templateActor('npc-0', 'npc', (0, _enemy_templates_js_1.getEnemyTemplate)(floor.npc.aiId), pos));
    }
    const session = (0, _tower_session_js_1.createTowerSession)({
        towerId: 'celestial',
        runId: p.runId,
        floor: floor.id,
        seed: p.seed,
        partySize: p.partySize,
        map,
        actors,
        objectiveKind: floor.objective,
        bossId,
        bossPhases,
        now: p.now,
    });
    // Scale enemy HP/damage down for a party smaller than the floor's balance baseline.
    (0, _engine_js_1.applyPartyScaling)(session, floor);
    return session;
}
