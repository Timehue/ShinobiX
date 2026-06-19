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
import {
    createTowerSession,
    type TowerActor,
    type TowerSession,
    type TowerMap,
} from './_tower-session.js';
import { applyPartyScaling } from './_engine.js';
import { getEnemyTemplate, type EnemyTemplate } from './_enemy-templates.js';
import type { TowerFloor } from './_floor-catalog.js';

// A sealed squad member: the host's + allies' COMBAT-SANITIZED character (start.ts runs
// the session.ts sanitizers before sealing — this builder trusts the snapshot it's given).
export type SquadMemberInput = {
    /** stable actor id within the run (e.g. "sq-0") */
    id: string;
    name: string;
    /** controlling player's slug (the host or a borrowed ally) */
    ownerSlug: string;
    /** AI-driven? false for the live human host; true for async/borrowed allies */
    ai: boolean;
    character: Record<string, unknown>;
};

const SQUAD_COL = 0;
const NPC_COL = 1;

// Deterministic spawn: squad on the left edge, npc one column in, enemies on the right
// edge — rows fill top-down (wrapping by height). For v1 floors (≤ height actors per
// side) there are no collisions; distinct columns keep sides apart on any width ≥ 3.
function spawnTile(map: TowerMap, index: number, side: 'squad' | 'enemy' | 'npc'): number {
    const w = map.width;
    const h = map.height;
    const row = index % h;
    const col = side === 'squad' ? SQUAD_COL : side === 'npc' ? NPC_COL : w - 1;
    return row * w + col;
}

function vitals(character: Record<string, unknown>, fallbackHp: number) {
    const maxHp = Math.max(1, Number(character.maxHp ?? fallbackHp) || fallbackHp);
    const maxChakra = Math.max(0, Number(character.maxChakra ?? 50) || 50);
    const maxStamina = Math.max(0, Number(character.maxStamina ?? 50) || 50);
    return { maxHp, maxChakra, maxStamina };
}

function squadActor(m: SquadMemberInput, pos: number): TowerActor {
    const { maxHp, maxChakra, maxStamina } = vitals(m.character, 1000);
    return {
        id: m.id, side: 'squad', name: m.name, ownerSlug: m.ownerSlug, ai: m.ai,
        hp: maxHp, maxHp, chakra: maxChakra, maxChakra, stamina: maxStamina, maxStamina,
        shield: 0, statuses: [], cooldowns: {}, pos, character: m.character,
    };
}

function templateActor(
    id: string, side: 'enemy' | 'npc', tpl: EnemyTemplate, pos: number, ownerSlug: string | null = null,
): TowerActor {
    return {
        id, side, name: tpl.name, ownerSlug, ai: true,
        hp: tpl.hp, maxHp: tpl.hp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], cooldowns: {}, pos,
        character: { specialty: tpl.specialty, stats: { ...tpl.stats } },
    };
}

export type BuildEncounterParams = {
    floor: TowerFloor;
    squad: SquadMemberInput[];
    runId: string;
    seed: number;
    partySize: number;
    /** wall-clock from the handler (kept out of the deterministic engine) */
    now: number;
};

export function buildTowerEncounter(p: BuildEncounterParams): TowerSession {
    const { floor, squad } = p;
    const map: TowerMap = {
        width: floor.map.width,
        height: floor.map.height,
        blockedTiles: [],
        hazardTiles: [],
        objectiveTiles: typeof floor.goalTile === 'number' ? [floor.goalTile] : [],
    };

    const actors: TowerActor[] = [];
    squad.forEach((m, i) => actors.push(squadActor(m, spawnTile(map, i, 'squad'))));

    let enemyIdx = 0;
    for (const pod of floor.enemies) {
        const tpl = getEnemyTemplate(pod.aiId);
        for (let k = 0; k < pod.count; k++) {
            actors.push(templateActor(`en-${enemyIdx}`, 'enemy', tpl, spawnTile(map, enemyIdx, 'enemy')));
            enemyIdx++;
        }
    }

    let bossId: string | undefined;
    let bossPhases: number[] | undefined;
    if (floor.boss) {
        bossId = 'boss';
        bossPhases = floor.boss.phases;
        actors.push(templateActor('boss', 'enemy', getEnemyTemplate(floor.boss.aiId), spawnTile(map, enemyIdx, 'enemy')));
        enemyIdx++;
    }

    if (floor.npc) {
        const pos = typeof floor.npc.pos === 'number' && floor.npc.pos >= 0 && floor.npc.pos < map.width * map.height
            ? floor.npc.pos
            : spawnTile(map, 0, 'npc');
        actors.push(templateActor('npc-0', 'npc', getEnemyTemplate(floor.npc.aiId), pos));
    }

    const session = createTowerSession({
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
    applyPartyScaling(session, floor);
    return session;
}
