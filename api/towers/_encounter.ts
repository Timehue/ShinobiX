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
import { hexZone, type TowerFloor, type TowerFeature } from './_floor-catalog.js';

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
    /** sealed per-fight consumable budget {itemId: charges} (thrown/item/potion). */
    itemCharges?: Record<string, number>;
};

// ── Elemental pylons (5 elements; 3 chosen per run) ──────────────────────────
const TOWER_ELEMENTS = ['Fire', 'Water', 'Earth', 'Lightning', 'Wind'] as const;
// Naruto-style counter cycle (Fire>Wind>Lightning>Earth>Water>Fire): a pylon boosts
// its element and weakens the one that BEATS it (so a counter-element on the pylon
// is punished). Drives both the engine math and the pylon's displayed label.
const ELEMENT_WEAKENS: Record<string, string> = {
    Fire: 'Water', Wind: 'Fire', Lightning: 'Wind', Earth: 'Lightning', Water: 'Earth',
};
const ELEMENT_PYLON_LABEL: Record<string, string> = {
    Fire: 'Flame Pylon', Water: 'Tide Pylon', Earth: 'Stone Pylon', Lightning: 'Storm Pylon', Wind: 'Gale Pylon',
};
/** Deterministically pick 3 of the 5 elements from the run seed (seeded Fisher–Yates). */
export function pickTowerElements(seed: number): string[] {
    const arr = [...TOWER_ELEMENTS] as string[];
    let s = (seed >>> 0) || 1;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr.slice(0, 3);
}

// Columns reserved for the player squad (+ a protected npc) on the LEFT — feature
// flowers never land here, so a unit never spawns inside a hazard/pylon/ward.
const SPAWN_LEFT_COLS = 3;

// Scatter each feature as a 7-hex FLOWER at a random interior centre: anywhere on the
// board EXCEPT the left spawn band, never overlapping another feature or a reserved
// tile (e.g. the reach-tile goal). Deterministic by seed (its own LCG stream), so the
// settle recompute reproduces the exact layout. Overwrites the catalog's placeholder
// tiles; a feature that can't be placed after many tries keeps its catalog tiles.
function placeFeatureFlowers(features: TowerFeature[], w: number, h: number, seed: number, reserved: number[]): void {
    if (!features.length) return;
    const taken = new Set<number>(reserved);
    let s = (((seed >>> 0) ^ 0x9e3779b9) >>> 0) || 1;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
    for (const f of features) {
        for (let attempt = 0; attempt < 400; attempt++) {
            const cx = (SPAWN_LEFT_COLS + 2) + Math.floor(rnd() * Math.max(1, w - SPAWN_LEFT_COLS - 3)); // centre cols 5..w-2
            const cy = 1 + Math.floor(rnd() * Math.max(1, h - 2));                                       // centre rows 1..h-2
            const zone = hexZone(cx + cy * w, w, h);
            if (zone.length < 7) continue;                                  // interior centres only (full flower)
            if (zone.some(t => (t % w) <= SPAWN_LEFT_COLS)) continue;       // keep clear of the player spawn band
            if (zone.some(t => taken.has(t))) continue;                     // no overlap with another feature / reserved
            f.tiles = zone;
            for (const t of zone) taken.add(t);
            break;
        }
    }
}

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
        itemCharges: m.itemCharges ? { ...m.itemCharges } : {},
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

    // Per-run elements: assign the tower's 3 seeded elements round-robin to the pylon
    // flowers (the catalog elements are placeholders). Deterministic by seed, so the
    // settle recompute reproduces the same pylons.
    const towerElements = pickTowerElements(p.seed);
    let pIdx = 0;
    for (const f of map.features ?? []) {
        if (f.kind !== 'pylon') continue;
        const el = towerElements[pIdx % towerElements.length]!;
        f.element = el;
        f.weakenElement = ELEMENT_WEAKENS[el] ?? 'Water';
        f.label = ELEMENT_PYLON_LABEL[el] ?? 'Pylon';
        pIdx++;
    }

    const W = map.width, H = map.height;
    // Scatter the feature flowers across the board — anywhere EXCEPT the player spawn band,
    // never overlapping each other / the goal / the protected npc. Then seed `used` with the
    // feature tiles so no squad member, enemy, or boss ever spawns inside a flower.
    const reserved = [...map.objectiveTiles];
    if (typeof floor.npc?.pos === 'number') reserved.push(floor.npc.pos);
    placeFeatureFlowers(map.features ?? [], W, H, p.seed, reserved);

    const used = new Set<number>();
    for (const f of map.features ?? []) for (const t of f.tiles) used.add(t);
    const actors: TowerActor[] = [];
    // Squad in a 2-wide LEFT band, spaced every ~3 rows down the middle of the board.
    squad.forEach((m, i) => actors.push(squadActor(m, placeInBand(used, W, H, i % 2, 3 + i * 3))));

    // Enemies stand in a FORMATION: the boss anchors the back (right edge, centre row),
    // and the grunts form centred ranks just in front of it. Reserve the boss tile first
    // so the grunt block builds ahead of it.
    let bossId: string | undefined;
    let bossPhases: number[] | undefined;
    let bossTile = -1;
    if (floor.boss) bossTile = placeInBand(used, W, H, W - 1, Math.floor(H / 2));

    const gruntCount = floor.enemies.reduce((s, pod) => s + pod.count, 0);
    const ranks = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(gruntCount))));
    const rowGap = H >= 14 ? 2 : 1;
    const files = Math.max(1, Math.ceil(gruntCount / ranks));
    const blockStart = Math.max(0, Math.floor((H - (files - 1) * rowGap) / 2));

    let enemyIdx = 0;
    for (const pod of floor.enemies) {
        const tpl = getEnemyTemplate(pod.aiId);
        for (let k = 0; k < pod.count; k++) {
            const rank = enemyIdx % ranks;                 // 0 = front rank (closest to the squad)
            const file = Math.floor(enemyIdx / ranks);
            const col = (W - 2) - rank;                     // ranks step back toward the boss column
            const row = blockStart + file * rowGap;
            actors.push(templateActor(`en-${enemyIdx}`, 'enemy', tpl, placeInBand(used, W, H, col, row)));
            enemyIdx++;
        }
    }

    if (floor.boss) {
        bossId = 'boss';
        bossPhases = floor.boss.phases;
        const bossActor = templateActor('boss', 'enemy', getEnemyTemplate(floor.boss.aiId), bossTile);
        // Attach the boss's signature mechanic (the engine resolves it deterministically).
        if (floor.boss.mechanic) {
            bossActor.character.mechanic = floor.boss.mechanic;
            if (floor.boss.mechanic === 'summon') {
                // Pre-resolve the add template so the engine can clone it without a lookup.
                bossActor.character.summonTemplate = getEnemyTemplate(floor.boss.summonAiId ?? 'grunt-bandit');
                bossActor.character.summonCount = Math.max(1, Math.min(4, Number(floor.boss.summonCount ?? 2)));
            }
        }
        actors.push(bossActor);
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
