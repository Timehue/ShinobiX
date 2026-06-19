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

// Deterministic spawn placement: from a desired (col,row), scan outward (down rows,
// then wrap to the next column) to the first FREE tile, so squad + enemies spread
// across spawn BANDS and never collide. Pure + deterministic (no RNG / wall-clock).
function placeInBand(used: Set<number>, w: number, h: number, col: number, row: number): number {
    let c = Math.max(0, Math.min(w - 1, Math.floor(col)));
    let r = Math.max(0, Math.min(h - 1, Math.floor(row)));
    let tile = r * w + c;
    let guard = 0;
    while (used.has(tile) && guard++ < w * h) {
        r += 1;
        if (r >= h) { r = 0; c = (c + 1) % w; }
        tile = r * w + c;
    }
    used.add(tile);
    return tile;
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
        // `visual` (sprite key) + `boss` are cosmetic-only hints the client renders; they
        // never touch combat math. The boss is also tracked authoritatively via phaseState.
        character: { specialty: tpl.specialty, stats: { ...tpl.stats }, visual: tpl.visual, ...(tpl.boss ? { boss: true } : {}) },
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
        biome: floor.biome,
        blockedTiles: [],
        hazardTiles: [],
        objectiveTiles: typeof floor.goalTile === 'number' ? [floor.goalTile] : [],
        features: floor.features ? floor.features.map(f => ({ ...f, tiles: [...f.tiles] })) : [],
    };

    const W = map.width, H = map.height;
    const used = new Set<number>();
    const actors: TowerActor[] = [];
    // Squad in a 2-wide LEFT band, spaced every ~3 rows down the middle of the board.
    squad.forEach((m, i) => actors.push(squadActor(m, placeInBand(used, W, H, i % 2, 3 + i * 3))));

    let enemyIdx = 0;
    for (const pod of floor.enemies) {
        const tpl = getEnemyTemplate(pod.aiId);
        for (let k = 0; k < pod.count; k++) {
            // Enemies scattered across a 3-deep RIGHT band, rows stepped by 5 (wraps) so
            // they're spread vertically rather than stacked in one column.
            const col = W - 1 - (enemyIdx % 3);
            const row = 1 + (enemyIdx * 5) % (H - 1);
            actors.push(templateActor(`en-${enemyIdx}`, 'enemy', tpl, placeInBand(used, W, H, col, row)));
            enemyIdx++;
        }
    }

    let bossId: string | undefined;
    let bossPhases: number[] | undefined;
    if (floor.boss) {
        bossId = 'boss';
        bossPhases = floor.boss.phases;
        // Boss anchors the centre-right so it reads as the centrepiece.
        actors.push(templateActor('boss', 'enemy', getEnemyTemplate(floor.boss.aiId), placeInBand(used, W, H, W - 2, Math.floor(H / 2))));
        enemyIdx++;
    }

    if (floor.npc) {
        const pos = typeof floor.npc.pos === 'number' && floor.npc.pos >= 0 && floor.npc.pos < map.width * map.height
            ? floor.npc.pos
            : placeInBand(used, W, H, 2, Math.floor(H / 2));
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
