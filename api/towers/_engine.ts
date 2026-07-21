/*
 * Battle Towers — N-actor combat ENGINE (Phase 1, P1.A2).
 *
 * The generalization of api/pvp/move.ts from 2 fighters (p1/p2) to N actors across
 * sides. It owns: the turn scheduler, explicit-target action resolution, the faithful
 * (ported) deterministic damage formula, team/last-standing win-check, party scaling,
 * and a deterministic auto-run used for async resolution + the settle recompute.
 *
 * DETERMINISM (Decision 2): no Math.random / Date.now anywhere; the seeded RNG is
 * threaded explicitly and used ONLY for AI tie-breaking — damage is a pure function of
 * stats (matching PvP, which has no damage RNG). Same (session, seed) → identical run.
 *
 * V1 SCOPE (faithful core): move / basic-attack / single-target jutsu damage, the
 * scaledEp × EP_MULTIPLIER × statFactor formula + armor DR pool, side-based rounds,
 * team win-check + defeat/protect/reach objectives, party-scaled enemy HP.
 * DEFERRED to Phase 1b/3 (additive layers, documented in the plan): the full tag/status
 * system (Wound/Poison/Reflect/Absorb/Lifesteal/Pierce/Stun-on-cast), AOE, weather/terrain
 * mults, chakra/stamina resource costs, interleaved boss-interrupt turns, boss-phase
 * mechanics, and the kill-adds-first / break-objective / defeat-all-then-boss gating
 * (these currently resolve as "all enemies dead"; the v1 catalog ships none of them).
 */
import { hexDistance, filledDiskTiles } from '../pvp/_aoe.js';
import { applyJutsu as applyPvpJutsu, applyDoTs, tickStatuses, applyGroundEffectToFighter, tickGroundEffects, characterOwnsElement } from '../pvp/move.js';
import { resolveTowerPlayerJutsu } from '../combat-adapters/clanBossAdapter.js';
import { weatherMultiplier } from '../combat-core/formulas.js';
import {
    COMPANION_ACTOR_ID, COMPANION_MAX_DAMAGE_FRAC, COMPANION_RANGE, companionActor, companionGearDamageMult,
    companionHealOnSummonPct, companionMoveDamage, companionObeys, companionOwnerLifestealPct,
    isCompanionActor, pickCompanionMove, type CompanionMove,
} from './_companion.js';
import { directDamageBaseFormula } from '../combat-core/formulas.js';
import { deleteSafeRecordValue, setSafeRecordValue } from '../_utils.js';
import { GROUND_EFFECT_TAGS, STACKABLE_STATUS, canonicalTagName } from '../pvp/_tags.js';
import type { PvpFighter, PvpGroundEffect, PvpStatus } from '../pvp/session.js';
import { partyScaleFactor, scaleEnemyStat, getFloorBalanceFor, type TowerFloor, type TowerTargetMode } from './_floor-catalog.js';
import {
    type TowerSession,
    type TowerActor,
    type TowerSide,
    getActor,
    livingOnSide,
    isSideAlive,
    activeActor,
} from './_tower-session.js';
import { COMBAT_RESOURCES_V2, v2ResourceRegen, v2PoisonOnSpend } from '../_combat-resources.js';
import {
    DEBUFF_TAKEN_CAP, HEALCUT_MAX, EXTRA_PHASE_BLAST_PCT, SUDDEN_DEATH_WINDOW, SUDDEN_DEATH_PCT,
    DUAL_AUGMENT_HAZARD_BONUS, DUAL_AUGMENT_DEBUFF_BONUS, type TowerModifier,
} from './_modifiers.js';

// ─── Constants (ported from api/pvp/move.ts, verified @ 586f0560) ────────────
export const BASE_AP = 100;
export const MAX_ACTIONS = 5;
export const MAX_ROUNDS = 25;
export const STUN_AP_PENALTY = 40;
export const MOVE_AP = 30;
export const BASIC_ATTACK_AP = 40;
// Basic actions ported from PvP move.ts (heal / clear / cleanse / dash).
export const DASH_AP = 30;
export const DASH_RANGE = 3;
export const HEAL_AP = 60;
export const HEAL_CHAKRA = 10;
export const HEAL_CD = 5;
export const HEAL_PCT = 0.1;
export const CLEAR_AP = 60;
export const CLEAR_CD = 10;
export const CLEANSE_AP = 60;
export const CLEANSE_CD = 10;

export type TowerAction =
    | { actorId: string; type: 'move'; tile: number; token?: string }
    | { actorId: string; type: 'dash'; tile: number; token?: string }
    | { actorId: string; type: 'attack'; targetId: string; token?: string }
    | { actorId: string; type: 'jutsu'; jutsuId: string; targetId?: string; tile?: number; token?: string }
    | { actorId: string; type: 'weapon'; targetId: string; itemId?: string; token?: string }
    | { actorId: string; type: 'item'; itemId?: string; token?: string }
    | { actorId: string; type: 'heal'; token?: string }
    | { actorId: string; type: 'cleanse'; token?: string }
    | { actorId: string; type: 'clear'; targetId: string; token?: string }
    | { actorId: string; type: 'summon'; token?: string }
    | { actorId: string; type: 'wait'; token?: string };

export type ActionResult = { applied: boolean; reason?: string };

type JutsuLike = {
    id?: string; name?: string; effectPower?: number; type?: string; ap?: number;
    range?: number; element?: string; chakraCost?: number; staminaCost?: number;
    cooldown?: number; isUtility?: boolean; method?: string; target?: string; tags?: unknown[];
    // Weapon synth sets this when the wielder lacks the weapon's element → the swing
    // gets no bloodline damage multiplier (parity with api/pvp/move.ts resolveBaseDamage).
    suppressBloodline?: boolean;
};
// Equipped weapon / consumable shape (subset of PvP's PvpItem — the sealed loadout
// carries these). `slot` drives weapon (hand/thrown) vs consumable (item/potion).
type PvpItemLike = {
    id?: string; name?: string; slot?: string;
    weaponEp?: number; weaponElement?: string; weaponRange?: number; apCost?: number; weaponCooldown?: number;
    weaponTags?: unknown[]; weaponEffect?: string; weaponEffectValue?: number; weaponEffectTarget?: string;
    restoreChakra?: number; restoreStamina?: number;
};

const STATUS_DURATIONS_OVERRIDE: Record<string, number> = {
    'Increase Damage Given': 2,
    'Increase Damage Taken': 2,
    'Decrease Damage Given': 2,
    'Decrease Damage Taken': 2,
    'Increase Generals': 2,
    'Increase Discipline': 2,
};
function statusDurationFor(name: string, fallback: number = 2): number {
    return STATUS_DURATIONS_OVERRIDE[name] ?? fallback;
}
function towerStatusMatches(name: string, canonicalName: string): boolean {
    return canonicalTagName(name) === canonicalName;
}
function addTowerStatus(actor: TowerActor, status: PvpStatus): void {
    const name = canonicalTagName(status.name);
    const adjusted: PvpStatus = { ...status, name, rounds: statusDurationFor(name, status.rounds) };
    if (STACKABLE_STATUS.has(name)) {
        actor.statuses = [...actor.statuses, adjusted];
        return;
    }
    actor.statuses = [...actor.statuses.filter(s => !towerStatusMatches(s.name, name)), adjusted];
}
function spendItemCharge(actor: TowerActor, itemId: string): boolean {
    if (!itemId) return true;
    const have = actor.itemCharges?.[itemId] ?? 0;
    if (have <= 0) return false;
    setSafeRecordValue((actor.itemCharges ??= {}), itemId, Math.max(0, have - 1));
    setSafeRecordValue((actor.itemsUsed ??= {}), itemId, Math.max(0, Math.floor(Number(actor.itemsUsed?.[itemId] ?? 0))) + 1);
    return true;
}

// ─── Hex geometry (generalized to arbitrary width/height; mirrors move.ts) ───
function xy(pos: number, w: number) { return { x: pos % w, y: Math.floor(pos / w) }; }
function posFromXY(x: number, y: number, w: number, h: number): number {
    if (x < 0 || x >= w || y < 0 || y >= h) return -1;
    return y * w + x;
}
export function towerNeighbors(pos: number, w: number, h: number): number[] {
    const { x, y } = xy(pos, w);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas.map(([dx, dy]) => posFromXY(x + dx!, y + dy!, w, h)).filter(n => n >= 0);
}

function occupantAt(session: TowerSession, tile: number, ignoreId?: string): TowerActor | undefined {
    return session.actors.find(a => a.hp > 0 && a.pos === tile && a.id !== ignoreId);
}
function isTileBlocked(session: TowerSession, tile: number, ignoreId?: string): boolean {
    if (session.map.blockedTiles.includes(tile)) return true;
    return !!occupantAt(session, tile, ignoreId);
}

// One-step move toward `to`, avoiding blocked/occupied tiles. Deterministic (ties broken
// by lowest tile index). Returns `from` if no step gets closer.
// When the floor has NO static terrain (blockedTiles empty — every shipped story / spire /
// clan floor), this is the ORIGINAL greedy step, byte-for-byte, so those runs recompute
// identically. Only floors that scatter terrain fall through to the BFS path, which routes
// AROUND walls/dead-ends the single-step greedy would stall on (a stall would time the floor
// out and score it as a squad loss — an unfair, non-combat lockout).
function nextStepToward(session: TowerSession, from: number, to: number, ignoreId?: string): number {
    const w = session.map.width;
    if (session.map.blockedTiles.length === 0) {
        const here = hexDistance(from, to, w);
        let best = from;
        let bestD = here;
        for (const n of towerNeighbors(from, w, session.map.height).sort((a, b) => a - b)) {
            if (isTileBlocked(session, n, ignoreId)) continue;
            const d = hexDistance(n, to, w);
            if (d < bestD) { bestD = d; best = n; }
        }
        return best;
    }
    return bfsNextStepToward(session, from, to, ignoreId);
}

// Terrain-aware next step: a deterministic BFS over free tiles returning the FIRST hop of a
// shortest path toward whichever reachable tile sits CLOSEST to `to` — so a unit walled off
// from its target routes around the obstacle instead of stalling. Neighbours expand in
// ascending tile-index order and the goal tile is chosen by (hexDistance-to-`to` asc,
// tile-index asc), so the pick is a pure function of board state (no RNG / wall-clock) and the
// settle recompute reproduces it byte-for-byte. Frontier is bounded by w*h (each tile visited
// once). Returns `from` when nothing gets closer (pickAiAction then falls through to `wait`,
// exactly as the greedy step did on a dead end).
function bfsNextStepToward(session: TowerSession, from: number, to: number, ignoreId?: string): number {
    const w = session.map.width, h = session.map.height;
    const parent = new Int32Array(w * h).fill(-2); // -2 = unvisited, -1 = root (`from`)
    parent[from] = -1;
    const queue: number[] = [from];
    let best = from;
    let bestD = hexDistance(from, to, w);
    for (let head = 0; head < queue.length; head++) {
        const cur = queue[head]!;
        const d = hexDistance(cur, to, w);
        if (d < bestD || (d === bestD && cur < best)) { bestD = d; best = cur; }
        for (const nb of towerNeighbors(cur, w, h).sort((a, b) => a - b)) {
            if (parent[nb] !== -2 || isTileBlocked(session, nb, ignoreId)) continue;
            parent[nb] = cur;
            queue.push(nb);
        }
    }
    if (best === from) return from;
    let node = best; // walk parent pointers back to the first hop out of `from`
    while (parent[node] !== from) {
        if (parent[node]! < 0) return from; // safety (best is always in from's tree, so unreachable in practice)
        node = parent[node]!;
    }
    return node;
}

// ─── Damage (faithful port of resolveBaseDamage core; deterministic) ─────────
export function computeDamage(attacker: TowerActor, defender: TowerActor, jutsu: JutsuLike, masteryLevel: number): number {
    const offStats = (attacker.character.stats as Record<string, number>) ?? {};
    const defStats = (defender.character.stats as Record<string, number>) ?? {};
    const attackerCharacter = { ...attacker.character, homeTerrainType: undefined };
    const result = directDamageBaseFormula({
        jutsu: {
            id: String(jutsu.id ?? ''),
            type: String(jutsu.type ?? 'Taijutsu'),
            ap: jutsu.ap,
            effectPower: jutsu.effectPower,
            isUtility: jutsu.isUtility,
        },
        attackerStats: offStats,
        defenderStats: defStats,
        attackerCharacter,
        defenderCharacter: defender.character as Record<string, unknown>,
        masteryLevel,
        partyDamageScale: Math.max(0, Number(attacker.character.towerDmgScale ?? 1)),
    });
    return Math.max(0, Math.floor(result.baseDmg * (1 - result.effectiveDR)));
}

// ─── Positional battlefield features (deterministic; position-based) ─────────
// A light tactical layer (a couple tiles per floor): pylons boost/weaken an
// element for a unit attacking FROM the tile, wards reduce damage TAKEN on the
// tile, hazards chip a unit standing on the tile at round end. All are pure
// functions of position + the floor's feature list — no RNG, no wall-clock — so
// the settle recompute reproduces them byte-for-byte. Floors without features
// (map.features undefined/empty) pay nothing here.
function mapFeatures(session: TowerSession) {
    return session.map.features ?? [];
}
/** Element boost/weaken for an attacker standing on a pylon tile. 1 when none apply. */
function pylonAttackMult(session: TowerSession, attacker: TowerActor, jutsu: JutsuLike): number {
    const el = String(jutsu.element ?? 'None');
    if (el === 'None' || !el) return 1; // basic attacks + non-elemental jutsu ignore pylons
    let mult = 1;
    for (const f of mapFeatures(session)) {
        if (f.kind !== 'pylon' || !f.tiles.includes(attacker.pos)) continue;
        if (el === f.element) mult *= 1 + f.percent / 100;
        else if (el === f.weakenElement) mult *= 1 - f.percent / 100;
    }
    return Math.max(0, mult);
}
/** Damage-taken reduction for a defender standing on a ward tile. 1 when none apply. */
function wardDefendMult(session: TowerSession, target: TowerActor): number {
    let mult = 1;
    for (const f of mapFeatures(session)) {
        if (f.kind === 'ward' && f.tiles.includes(target.pos)) mult *= 1 - f.percent / 100;
    }
    return Math.max(0, mult);
}
// ─── Board objects (fonts / shrines) — pure occupancy each round ─────────────────
// Hard ceiling on the combined shrine buff so multi-shrine stacking can never approach the
// one-shot ceiling (the analog of SPIRE_ENRAGE_CAP / DEBUFF_TAKEN_CAP for held ground).
export const SHRINE_TEAM_CAP = 1.12;
/** Team damage bonus while the attacker's SIDE holds a shrine (a living squad/enemy unit
 *  standing on its tile). Product over held shrines, hard-capped at SHRINE_TEAM_CAP, and
 *  SKIPPED entirely for an enraged attacker — story enrage is uncapped, so the shrine term
 *  must never compound it (the floor-10 guard; the validator also bans authoring that mix). */
function shrineAttackMult(session: TowerSession, attacker: TowerActor): number {
    const objects = session.map.boardObjects;
    if (!objects || objects.length === 0) return 1;
    if (attacker.side !== 'squad' && attacker.side !== 'enemy') return 1;
    if (Number(attacker.character.enrage ?? 0) > 0) return 1;
    let mult = 1;
    for (const o of objects) {
        if (o.kind !== 'shrine' || !o.tiles || o.tiles.length === 0) continue;
        const held = session.actors.some(a => a.hp > 0 && a.side === attacker.side && o.tiles!.includes(a.pos));
        if (held) mult *= 1 + Math.max(0, o.percent) / 100;
    }
    return Math.min(mult, SHRINE_TEAM_CAP);
}
/** Round-end font restore: the living unit standing on a font (any side) recovers
 *  min(cap, percent% of its max) of the font's resource. The absolute `cap` is the
 *  anti-stall guard (a high-max unit can't out-sustain incoming DPS camping a font);
 *  squad HP restores honour the Endless Spire heal-cut like Basic Heal does. */
function applyRoundFonts(session: TowerSession): void {
    const objects = session.map.boardObjects;
    if (!objects || objects.length === 0) return;
    for (const o of objects) {
        if (o.kind !== 'font' || !o.tiles || o.tiles.length === 0) continue;
        for (const a of session.actors) {
            if (a.hp <= 0 || !o.tiles.includes(a.pos)) continue;
            const label = o.label ?? 'the font';
            if (o.resource === 'hp') {
                let amt = Math.min(Math.max(1, Math.floor(o.cap)), Math.max(1, Math.floor((a.maxHp * o.percent) / 100)));
                if (a.side === 'squad') {
                    const cut = healcutPct(session);
                    if (cut > 0) amt = Math.max(0, Math.floor(amt * (1 - cut / 100)));
                }
                const before = a.hp;
                a.hp = Math.min(a.maxHp, a.hp + amt);
                if (a.hp > before) session.log.push(`${a.name} restores ${a.hp - before} HP at ${label}.`);
            } else if (o.resource === 'chakra') {
                const amt = Math.min(Math.max(1, Math.floor(o.cap)), Math.max(1, Math.floor((a.maxChakra * o.percent) / 100)));
                const before = a.chakra;
                a.chakra = Math.min(a.maxChakra, a.chakra + amt);
                if (a.chakra > before) session.log.push(`${a.name} draws ${a.chakra - before} chakra from ${label}.`);
            } else {
                const amt = Math.min(Math.max(1, Math.floor(o.cap)), Math.max(1, Math.floor((a.maxStamina * o.percent) / 100)));
                const before = a.stamina;
                a.stamina = Math.min(a.maxStamina, a.stamina + amt);
                if (a.stamina > before) session.log.push(`${a.name} recovers ${a.stamina - before} stamina at ${label}.`);
            }
        }
    }
}
/** Endless Spire 'debuff' keystones raise INCOMING damage on a squad target. The summed
 *  vulnerability is HARD-CAPPED at DEBUFF_TAKEN_CAP — the direct analog of SPIRE_ENRAGE_CAP:
 *  debuff is a new multiplicative term on the same wMult product as enrage × dmgMult, so an
 *  uncapped stack could cold-one-shot a maxed squad. 'positional' debuffs are nullified while
 *  the target stands on a ward (wards are safe tiles); 'flat' always applies. 1 when none. */
function debuffTakenMult(session: TowerSession, target: TowerActor): number {
    const stack = session.modifierStack;
    if (!Array.isArray(stack) || stack.length === 0) return 1;
    const onWard = wardDefendMult(session, target) < 1;
    let pct = 0;
    for (const m of stack) {
        if (m.kind !== 'debuff') continue;
        if (m.variant === 'positional' && onWard) continue; // ward tiles negate positional vulnerability
        pct += Math.max(0, Number(m.value) || 0);
    }
    // Wave 3 'Cataclysm' (dualAugment) amplifies the vulnerability — but the DEBUFF_TAKEN_CAP
    // clamp below still hard-bounds it, so the one-shot ceiling is unchanged.
    if (pct > 0 && hasDualAugment(session)) pct += DUAL_AUGMENT_DEBUFF_BONUS;
    return pct > 0 ? 1 + Math.min(pct / 100, DEBUFF_TAKEN_CAP) : 1;
}
/** Endless Spire 'healcut' keystones reduce net healing the squad receives (percent, summed,
 *  clamped to HEALCUT_MAX so it can never invert into a net negative heal). 0 when none. */
function healcutPct(session: TowerSession): number {
    const stack = session.modifierStack;
    if (!Array.isArray(stack) || stack.length === 0) return 0;
    let pct = 0;
    for (const m of stack) if (m.kind === 'healcut') pct += Math.max(0, Number(m.value) || 0);
    return Math.min(pct, HEALCUT_MAX);
}
/** Wave 3 'Cataclysm' (dualAugment) — hazard + vulnerability keystones amplify each other. */
function hasDualAugment(session: TowerSession): boolean {
    const stack = session.modifierStack;
    return Array.isArray(stack) && stack.some(m => m.kind === 'dualAugment');
}
// ─── Endless Spire hazard keystones (Wave 2) ─────────────────────────────────
// A modifierStack hazard carries only its variant + percent; the engine owns the tile
// GEOMETRY (the seal has no map). Every derivation is a pure function of (map, variant,
// round[, squad positions]) so settle reproduces the run. Story runs have no modifierStack
// → these never fire → byte-identical.
/** Which tiles a hazard keystone lights up for `round`. Deterministic per variant. */
function spireHazardTiles(session: TowerSession, mod: TowerModifier, round: number): number[] {
    const w = session.map.width, h = session.map.height;
    const blocked = new Set(session.map.blockedTiles);
    const cells: number[] = [];
    switch (mod.variant) {
        case 'rotating': { // a single column of fire that sweeps across the board each round
            const hot = ((round % w) + w) % w;
            for (let i = 0; i < w * h; i++) if (!blocked.has(i) && (i % w) === hot) cells.push(i);
            break;
        }
        case 'escalating': { // a fixed central band whose BITE (not tiles) grows with the round
            const mid = Math.floor(w / 2);
            for (let i = 0; i < w * h; i++) if (!blocked.has(i) && Math.abs((i % w) - mid) <= 1) cells.push(i);
            break;
        }
        case 'proximity': { // arcs to any tile touching ≥2 living squad members — punishes clumping
            const count = new Map<number, number>();
            for (const s of livingOnSide(session, 'squad'))
                for (const n of towerNeighbors(s.pos, w, h)) {
                    if (blocked.has(n)) continue;
                    count.set(n, (count.get(n) ?? 0) + 1);
                }
            for (const [t, c] of count) if (c >= 2) cells.push(t);
            break;
        }
        default: { // 'static' — a central cross of scorched tiles
            const mc = Math.floor(w / 2), mr = Math.floor(h / 2);
            for (let i = 0; i < w * h; i++) if (!blocked.has(i) && ((i % w) === mc || Math.floor(i / w) === mr)) cells.push(i);
        }
    }
    return cells;
}
/** Effective chip percent for a hazard this round (only 'escalating' grows; capped at 3× base). */
function spireHazardPct(mod: TowerModifier, round: number): number {
    const base = Math.max(0, Number(mod.value) || 0);
    if (mod.variant === 'escalating') return Math.min(base + Math.floor(round / 2), base * 3);
    return base;
}
/** Round-end chip to every living unit standing on a hazard tile. */
function applyRoundHazards(session: TowerSession): void {
    for (const f of mapFeatures(session)) {
        if (f.kind !== 'hazard') continue;
        for (const a of session.actors) {
            if (a.hp <= 0 || !f.tiles.includes(a.pos)) continue;
            const dmg = Math.max(1, Math.floor((a.maxHp * f.percent) / 100));
            a.hp = Math.max(0, a.hp - dmg);
            session.log.push(`${a.name} takes ${dmg} from ${f.label ?? 'the hazard'} (${a.hp}/${a.maxHp}).`);
        }
    }
    // Endless Spire ascension hazards: a SQUAD-side tax that pressures positioning (never
    // chips the boss/adds or the escort). Story runs have no modifierStack → loop is empty.
    const dualAug = hasDualAugment(session); // Wave 3 'Cataclysm' bumps every hazard chip
    for (const m of session.modifierStack ?? []) {
        if (m.kind !== 'hazard') continue;
        const tiles = new Set(spireHazardTiles(session, m, session.round));
        if (tiles.size === 0) continue;
        const pct = spireHazardPct(m, session.round) + (dualAug ? DUAL_AUGMENT_HAZARD_BONUS : 0);
        for (const a of session.actors) {
            if (a.hp <= 0 || a.side !== 'squad' || !tiles.has(a.pos)) continue;
            const dmg = Math.max(1, Math.floor((a.maxHp * pct) / 100));
            a.hp = Math.max(0, a.hp - dmg);
            session.log.push(`${a.name} takes ${dmg} from ${m.label ?? 'the hazard'} (${a.hp}/${a.maxHp}).`);
        }
    }
    // Wave 3 'Sudden Death' (objective): in the last SUDDEN_DEATH_WINDOW rounds before the cap,
    // the arena collapses — a whole-squad chip so running out the clock is fatal, not safe. Only
    // fires on a spire floor that sealed the 'objective' keystone AND has a roundCap. Bounded %.
    if (typeof session.roundCap === 'number' && (session.modifierStack ?? []).some(m => m.kind === 'objective')) {
        const collapseFrom = session.roundCap - SUDDEN_DEATH_WINDOW;
        if (session.round > collapseFrom) {
            for (const a of session.actors) {
                if (a.hp <= 0 || a.side !== 'squad') continue;
                const dmg = Math.max(1, Math.floor((a.maxHp * SUDDEN_DEATH_PCT) / 100));
                a.hp = Math.max(0, a.hp - dmg);
            }
            session.log.push(`⚠ The floor is collapsing — finish it! (Sudden Death, round ${session.round}/${session.roundCap})`);
        }
    }
}
/** Telegraph: EXACT tiles that will burn at the END of the current round (proximity hazards
 *  are reactive → intentionally excluded so the field is a hard guarantee, never an estimate).
 *  Empty when no deterministic hazard is live (story or sub-tier-9 spire). */
function computeHazardTelegraph(session: TowerSession): number[] {
    const out = new Set<number>();
    for (const m of session.modifierStack ?? []) {
        if (m.kind !== 'hazard' || m.variant === 'proximity') continue;
        for (const t of spireHazardTiles(session, m, session.round)) out.add(t);
    }
    // Story "board attacks back": paint the closing ring + a primed boss strike + any geyser
    // erupting this round so the squad gets this round to step off. Absent → adds nothing.
    for (const t of closingRingTiles(session, session.round)) out.add(t);
    for (const t of dynamicHazardTiles(session, session.round)) out.add(t);
    if (session.bossStrike && session.bossStrike.round === session.round) for (const t of session.bossStrike.tiles) out.add(t);
    return [...out].sort((a, b) => a - b);
}

// ─── Boss mechanics (deterministic; tower-only) ──────────────────────────────
// Each boss has a signature mechanic that makes the fight distinct + tough. These are
// pure functions of the session state (no RNG / wall-clock), so settle reproduces them.
/** Enrage stacks ramp the boss's OUTGOING damage (+35% per stack). The Endless Spire seals a
 *  stack cap on the session (SPIRE_ENRAGE_CAP) so uncapped enrage × dmgMult can't cold-one-shot
 *  a maxed squad; story runs leave session.enrageCap unset → uncapped, byte-identical to before. */
function attackerEnrageMult(session: TowerSession, attacker: TowerActor): number {
    const cap = Number(session.enrageCap ?? Infinity);
    const e = Math.min(Number(attacker.character.enrage ?? 0), cap);
    return e > 0 ? 1 + 0.35 * e : 1;
}
/** A 'bulwark' boss takes HALF the damage while any of its guards (other enemies) live. */
function bulwarkMult(session: TowerSession, target: TowerActor): number {
    if (String(target.character.mechanic ?? '') !== 'bulwark') return 1;
    const guardsAlive = session.actors.some(a => a.side === 'enemy' && a.id !== target.id && a.hp > 0);
    return guardsAlive ? 0.5 : 1;
}
/** Spawn the boss's reinforcements on free tiles around it (summon mechanic). */
function summonAdds(session: TowerSession): void {
    const id = session.phaseState.bossId;
    const boss = id ? getActor(session, id) : undefined;
    if (!boss) return;
    const tpl = boss.character.summonTemplate as { name?: string; specialty?: string; hp?: number; stats?: Record<string, number>; visual?: string } | undefined;
    if (!tpl) return;
    const count = Math.max(1, Number(boss.character.summonCount ?? 2));
    const w = session.map.width, h = session.map.height;
    const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
    const blocked = new Set(session.map.blockedTiles);
    const scale = Math.max(0, Number(boss.character.towerDmgScale ?? 1)); // adds inherit the boss's party scaling
    let n = session.actors.filter(a => a.id.startsWith('add-')).length;
    let added = 0;
    for (const tile of towerNeighbors(boss.pos, w, h)) {
        if (added >= count) break;
        if (occupied.has(tile) || blocked.has(tile)) continue;
        const hp = Math.max(1, Math.round(Number(tpl.hp ?? 300) * (scale < 1 ? scale : 1)));
        session.actors.push({
            id: `add-${n++}`, side: 'enemy', name: tpl.name ?? 'Add', ownerSlug: null, ai: true,
            hp, maxHp: hp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            shield: 0, statuses: [], cooldowns: {}, pos: tile,
            character: { specialty: tpl.specialty ?? 'Taijutsu', stats: { ...(tpl.stats ?? {}) }, visual: tpl.visual ?? 'bandit', ...(scale < 1 ? { towerDmgScale: scale } : {}) },
        });
        occupied.add(tile);
        added++;
    }
    if (added > 0) session.log.push(`${boss.name} summons ${added} reinforcement${added !== 1 ? 's' : ''}!`);
}
/** Phase-drop pillars: a boss with `phasePillars` SHATTERS the arena at each HP gate, erupting
 *  up to N impassable stone pillars from the ground. The board reshapes as the fight escalates.
 *  Safety is load-bearing and mirrors scatterTerrain's geometric argument:
 *    • every new pillar is NON-ADJACENT to every existing blocked tile (and each other), so the
 *      global "no two blocked cells touch" invariant holds → the free region can never be
 *      bisected and the arena stays fully connected, with no flood-fill needed;
 *    • never on a living unit, a feature flower, an objective/goal tile or its neighbours;
 *    • never seals a living unit's LAST free neighbour (no soft-lock);
 *    • total blocked capped at 10% of the board (same ceiling as scatterTerrain).
 *  Deterministic: an LCG salted from (session.seed, gates fired so far) — no RNG/wall-clock —
 *  so the settle recompute reproduces every eruption. Bosses without phasePillars never call this. */
function dropPhasePillars(session: TowerSession, boss: TowerActor): void {
    const want = Math.max(0, Math.min(3, Math.floor(Number(boss.character.phasePillars ?? 0))));
    if (want <= 0) return;
    const w = session.map.width, h = session.map.height;
    const maxBlocked = Math.floor(w * h * 0.10);
    const blocked = new Set(session.map.blockedTiles);
    const reserved = new Set<number>();
    for (const t of session.map.objectiveTiles) { reserved.add(t); for (const nb of towerNeighbors(t, w, h)) reserved.add(nb); }
    for (const f of session.map.features ?? []) for (const t of f.tiles) reserved.add(t);
    // never bury a board object (a shrine/font must stay reachable + visible)
    for (const o of session.map.boardObjects ?? []) for (const t of o.tiles ?? []) reserved.add(t);
    const living = session.actors.filter(a => a.hp > 0);
    const occupied = new Set(living.map(a => a.pos));
    const freeNeighbors = (pos: number, minus: number) =>
        towerNeighbors(pos, w, h).filter(t => t !== minus && !blocked.has(t) && !occupied.has(t)).length;
    let s = (((session.seed >>> 0) ^ 0x27d4eb2f ^ Math.imul(session.phaseState.triggeredPhases.length, 0x9e3779b9)) >>> 0) || 1;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
    let added = 0;
    for (let attempt = 0; attempt < 200 && added < want && blocked.size < maxBlocked; attempt++) {
        const cx = 1 + Math.floor(rnd() * Math.max(1, w - 2));
        const cy = 1 + Math.floor(rnd() * Math.max(1, h - 2));
        const t = cy * w + cx;
        if (blocked.has(t) || occupied.has(t) || reserved.has(t)) continue;
        if (towerNeighbors(t, w, h).some(nb => blocked.has(nb))) continue; // non-adjacency invariant
        // never seal an adjacent living unit's last exit
        if (living.some(a => a.pos !== t && towerNeighbors(a.pos, w, h).includes(t) && freeNeighbors(a.pos, t) === 0)) continue;
        blocked.add(t);
        session.map.blockedTiles.push(t);
        added++;
    }
    if (added > 0) session.log.push(`${boss.name} shatters the arena — ${added} stone pillar${added !== 1 ? 's' : ''} erupt${added === 1 ? 's' : ''} from the ground!`);
}

/** Fired when the boss crosses an HP-phase gate. */
function applyBossPhaseMechanic(session: TowerSession, boss: TowerActor): void {
    const m = String(boss.character.mechanic ?? '');
    if (m === 'enrage') {
        boss.character.enrage = Number(boss.character.enrage ?? 0) + 1;
        session.log.push(`${boss.name} enrages — its blows hit harder!`);
    } else if (m === 'summon') {
        summonAdds(session);
    }
    // 'bulwark' is passive (damage reduction while guards live); 'regen' fires per round.
}

/** Aegis: a fresh SHIELD at each phase gate — pure shield points consumed by the normal
 *  damage pipeline (the resolver already spends boss.shield), so it delays the kill without
 *  any regen/stall risk. Total live shield is hard-capped at AEGIS_SHIELD_MAX_PCT of maxHp
 *  so back-to-back gates can't stack a wall. Bosses without `aegis` never enter (byte-identical). */
export const AEGIS_SHIELD_MAX_PCT = 25;
function applyBossAegis(session: TowerSession, boss: TowerActor): void {
    const cfg = boss.character.aegis as { shieldPct?: number } | undefined;
    const pct = Math.max(0, Math.min(AEGIS_SHIELD_MAX_PCT, Math.floor(Number(cfg?.shieldPct ?? 0))));
    if (pct <= 0) return;
    const ceiling = Math.floor((boss.maxHp * AEGIS_SHIELD_MAX_PCT) / 100);
    const grant = Math.min(Math.floor((boss.maxHp * pct) / 100), Math.max(0, ceiling - boss.shield));
    if (grant <= 0) return;
    boss.shield += grant;
    session.log.push(`${boss.name} raises an aegis — a shield of ${grant} forms around it!`);
}
/** Per-round heal for a 'regen' boss. In the ENDLESS SPIRE the heal is 7% of CURRENT HP (self-
 *  limiting), plus the sealed FLAT cap (session.regenFlatCap): a boss near full still drains you
 *  hard, but a wounded boss heals proportionally LESS, so a competent squad can always finish it —
 *  this kills the "unkillable regen" DPS-cliff the balance sim exposed (a flat %-of-MAX heal makes
 *  a regen boss binary: impossible below a DPS threshold, trivial above). STORY runs (no
 *  ascensionTier) keep the old 7%-of-MAX behaviour → byte-identical. */
function applyBossRegen(session: TowerSession): void {
    const id = session.phaseState.bossId;
    const boss = id ? getActor(session, id) : undefined;
    if (!boss || boss.hp <= 0 || String(boss.character.mechanic ?? '') !== 'regen') return;
    const cap = Number(session.regenFlatCap ?? Infinity);
    const regenBase = session.ascensionTier ? boss.hp : boss.maxHp; // spire: % of CURRENT hp; story: % of max
    const heal = Math.min(Math.max(1, Math.floor(regenBase * 0.07)), cap);
    const before = boss.hp;
    boss.hp = Math.min(boss.maxHp, boss.hp + heal);
    if (boss.hp > before) session.log.push(`${boss.name} regenerates ${boss.hp - before} HP.`);
}
/** Wave 3 'Second Wind' (extraPhase): a ONE-TIME desperation blast when the boss crosses its
 *  sealed extra HP-gate — a bounded % chip to every living SQUAD member (never regen/heal, so
 *  it can't stall past the round cap). Fires once (the gate is popped from pendingPhases once);
 *  boss/adds/escort are untouched. Story + floors < 15 seal no extraPhaseThreshold → never fires. */
function applyExtraPhaseShockwave(session: TowerSession, boss: TowerActor): void {
    session.log.push(`${boss.name} steels itself and unleashes a desperation blast!`);
    for (const a of session.actors) {
        if (a.hp <= 0 || a.side !== 'squad') continue;
        const dmg = Math.max(1, Math.floor((a.maxHp * EXTRA_PHASE_BLAST_PCT) / 100));
        a.hp = Math.max(0, a.hp - dmg);
        session.log.push(`${a.name} is caught in the blast for ${dmg} (${a.hp}/${a.maxHp}).`);
    }
}

// ─── Telegraphed boss strikes + closing ring (story "board attacks back") ────────
// A recurring, DODGEABLE AOE the boss telegraphs at round start and detonates at round end, plus
// a shrinking safe-zone finale. Both chip the SQUAD for a flat % of maxHp applied OUTSIDE the wMult
// product (like applyRoundHazards / EXTRA_PHASE_BLAST_PCT), so they never interact with enrage /
// statFactor and can't one-shot. Both are pure functions of (map, round[, snapshotted boss pos]),
// so settle recompute reproduces them; a boss/floor with no config never sets state → byte-identical.
export const BOSS_STRIKE_MAX_PCT = 14; // hard ceiling on a single strike's chip

function bossStrikeConfig(boss: TowerActor): { kind: string; pct: number; radius: number; everyRounds: number; firstRound: number } | undefined {
    const c = boss.character.bossStrike as { kind?: string; pct?: number; radius?: number; everyRounds?: number; firstRound?: number } | undefined;
    if (!c || !c.kind) return undefined;
    const everyRounds = Math.max(2, Math.floor(Number(c.everyRounds ?? 3)));
    return {
        kind: String(c.kind),
        pct: Math.max(1, Math.min(BOSS_STRIKE_MAX_PCT, Math.floor(Number(c.pct ?? 8)))),
        radius: Math.max(0, Math.min(2, Math.floor(Number(c.radius ?? 1)))),
        everyRounds,
        firstRound: Math.max(1, Math.floor(Number(c.firstRound ?? everyRounds))),
    };
}
/** Where a strike centres, snapshotted at prime time: on the boss ('nova') or the nearest living
 *  squad member ('volley'). Deterministic (min distance, id tie-break). */
function bossStrikeCenter(session: TowerSession, boss: TowerActor, kind: string): number {
    if (kind !== 'volley') return boss.pos;
    const w = session.map.width;
    let center = boss.pos, bestD = Infinity;
    for (const s of livingOnSide(session, 'squad').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
        const d = hexDistance(boss.pos, s.pos, w);
        if (d < bestD) { bestD = d; center = s.pos; }
    }
    return center;
}
/** Prime the boss's telegraphed strike for THIS round when its cadence hits. Snapshots the blast
 *  tiles NOW (round start), so the telegraph the squad sees is exactly what detonates at round end
 *  even if the boss moves. No-op when the boss is dead / has no strike / is off-cadence. */
function primeBossStrike(session: TowerSession): void {
    const id = session.phaseState.bossId;
    const boss = id ? getActor(session, id) : undefined;
    if (!boss || boss.hp <= 0) return;
    const cfg = bossStrikeConfig(boss);
    if (!cfg) return;
    const round = session.round;
    if (round < cfg.firstRound || (round - cfg.firstRound) % cfg.everyRounds !== 0) return;
    const center = bossStrikeCenter(session, boss, cfg.kind);
    const blocked = new Set(session.map.blockedTiles);
    const tiles = [...filledDiskTiles(center, cfg.radius, session.map.width, session.map.height)]
        .filter(t => !blocked.has(t)).sort((a, b) => a - b);
    if (tiles.length === 0) return;
    session.bossStrike = {
        tiles, round, pct: cfg.pct, kind: cfg.kind, center,
        label: cfg.kind === 'volley' ? `${boss.name}'s barrage` : cfg.kind === 'slam' ? `${boss.name}'s seismic slam` : `${boss.name}'s nova`,
    };
    session.log.push(`⚠ ${session.bossStrike.label} charges — the marked ground erupts at round's end!`);
}
/** Max hex distance from the board centre to any corner — the ring's fully-open start radius. */
function boardRingRadius(w: number, h: number): number {
    const center = Math.floor(h / 2) * w + Math.floor(w / 2);
    let m = 0;
    for (const corner of [0, w - 1, (h - 1) * w, (h - 1) * w + (w - 1)]) m = Math.max(m, hexDistance(center, corner, w));
    return m;
}
/** Tiles OUTSIDE the closing ring's safe radius for `round` — empty until it starts shrinking, and
 *  the safe core never drops below minRadius. Pure function of (map, round). */
function closingRingTiles(session: TowerSession, round: number): number[] {
    const cfg = session.map.closingRing;
    if (!cfg) return [];
    const w = session.map.width, h = session.map.height;
    const center = Math.floor(h / 2) * w + Math.floor(w / 2);
    const fromRound = Math.max(1, Math.floor(Number(cfg.fromRound ?? 6)));
    const minRadius = Math.max(1, Math.floor(Number(cfg.minRadius ?? 3)));
    const maxR = boardRingRadius(w, h);
    const radius = Math.max(minRadius, maxR - Math.max(0, round - fromRound));
    if (radius >= maxR) return []; // nothing lethal yet
    const blocked = new Set(session.map.blockedTiles);
    const out: number[] = [];
    for (let t = 0; t < w * h; t++) if (!blocked.has(t) && hexDistance(t, center, w) > radius) out.push(t);
    return out;
}
// ─── Dynamic hazards (geyser vents — recurring, round-timed board danger) ─────────
/** A geyser erupts at the END of a round on its fixed cadence. Pure predicate of the round. */
function geyserErupts(hz: { everyRounds: number; firstRound?: number }, round: number): boolean {
    const every = Math.max(2, Math.floor(Number(hz.everyRounds) || 3));
    const first = Math.max(1, Math.floor(Number(hz.firstRound ?? every)));
    return round >= first && (round - first) % every === 0;
}
/** The vent tiles erupting at the END of `round` (for the telegraph + AI avoidance). Pure. */
function dynamicHazardTiles(session: TowerSession, round: number): number[] {
    const hazards = session.map.dynamicHazards;
    if (!hazards || hazards.length === 0) return [];
    const out = new Set<number>();
    for (const hz of hazards) if (geyserErupts(hz, round)) for (const t of hz.tiles ?? []) out.add(t);
    return [...out].sort((a, b) => a - b);
}
/** Round-end: an erupting geyser scalds EVERY living unit standing on it (any side — neutral board
 *  danger the AI dodges), flat %-maxHp. Absent → no-op (byte-identical). */
function applyRoundDynamicHazards(session: TowerSession): void {
    const hazards = session.map.dynamicHazards;
    if (!hazards || hazards.length === 0) return;
    for (const hz of hazards) {
        if (!geyserErupts(hz, session.round)) continue;
        const tiles = new Set(hz.tiles ?? []);
        const pct = Math.max(1, Math.floor(Number(hz.pct) || 4));
        for (const a of session.actors) {
            if (a.hp <= 0 || !tiles.has(a.pos)) continue;
            const dmg = Math.max(1, Math.floor((a.maxHp * pct) / 100));
            a.hp = Math.max(0, a.hp - dmg);
            session.log.push(`${a.name} is scalded by an erupting geyser for ${dmg} (${a.hp}/${a.maxHp}).`);
        }
    }
}
/** Shove `actor` up to `dist` tiles directly AWAY from `centerTile` (seismic-slam knockback).
 *  Deterministic (first legal outward neighbour in tile-index order); stops at walls/edges/units. */
function pushAwayFrom(session: TowerSession, actor: TowerActor, centerTile: number, dist: number): void {
    const w = session.map.width, h = session.map.height;
    const distTo = (t: number) => hexDistance(t, centerTile, w);
    let pos = actor.pos;
    for (let step = 0; step < dist; step++) {
        const here = distTo(pos);
        const next = towerNeighbors(pos, w, h).sort((a, b) => a - b)
            .find(t => t !== centerTile && !isTileBlocked(session, t, actor.id) && distTo(t) > here);
        if (next === undefined) break;
        pos = next;
    }
    if (pos !== actor.pos) { actor.pos = pos; session.log.push(`${actor.name} is hurled back by the shockwave!`); }
}
/** Round-end: detonate a primed boss strike + chip anyone caught outside the closing ring. Squad
 *  only (boss/adds/escort exempt), flat %-maxHp outside wMult; the strike is cleared so it fires once. */
function applyBossStrikeAndRing(session: TowerSession): void {
    const strike = session.bossStrike;
    if (strike && strike.round === session.round) {
        const zone = new Set(strike.tiles);
        const isSlam = strike.kind === 'slam';
        for (const a of session.actors) {
            if (a.hp <= 0 || a.side !== 'squad' || !zone.has(a.pos)) continue;
            const dmg = Math.max(1, Math.floor((a.maxHp * strike.pct) / 100));
            a.hp = Math.max(0, a.hp - dmg);
            session.log.push(`${a.name} is caught in ${strike.label} for ${dmg} (${a.hp}/${a.maxHp}).`);
            // Seismic slam: hurl the caught shinobi away from the blast centre (can toss them into a
            // hazard/geyser — the combo). Only when the boss is alive to have thrown it.
            if (isSlam && a.hp > 0 && typeof strike.center === 'number') pushAwayFrom(session, a, strike.center, 2);
        }
        session.bossStrike = undefined;
    }
    const ring = session.map.closingRing;
    if (ring) {
        const lethal = new Set(closingRingTiles(session, session.round));
        if (lethal.size) for (const a of session.actors) {
            if (a.hp <= 0 || a.side !== 'squad' || !lethal.has(a.pos)) continue;
            const dmg = Math.max(1, Math.floor((a.maxHp * Math.max(1, Number(ring.pct ?? SUDDEN_DEATH_PCT))) / 100));
            a.hp = Math.max(0, a.hp - dmg);
            session.log.push(`${a.name} is caught in the closing ring for ${dmg} (${a.hp}/${a.maxHp}).`);
        }
    }
}

// ─── Targeting / sides ───────────────────────────────────────────────────────
function hostileSidesFor(side: TowerSide): TowerSide[] {
    // Squad fights enemies; enemies fight squad + the protected npc.
    return side === 'squad' ? ['enemy'] : ['squad', 'npc'];
}
function opponentsOf(session: TowerSession, actor: TowerActor): TowerActor[] {
    const sides = hostileSidesFor(actor.side);
    return session.actors.filter(a => a.hp > 0 && sides.includes(a.side));
}
function nearestOpponent(session: TowerSession, actor: TowerActor): TowerActor | undefined {
    const w = session.map.width;
    let best: TowerActor | undefined;
    let bestD = Infinity;
    for (const o of opponentsOf(session, actor).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        const d = hexDistance(actor.pos, o.pos, w);
        if (d < bestD) { bestD = d; best = o; }
    }
    return best;
}

// ─── Loadout helpers ─────────────────────────────────────────────────────────
function actorSpecialty(actor: TowerActor): string {
    const s = String(actor.character.specialty ?? 'Taijutsu');
    return ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'].includes(s) ? s : 'Taijutsu';
}
function findJutsu(actor: TowerActor, jutsuId: string): JutsuLike | undefined {
    const list = actor.character.jutsu;
    if (!Array.isArray(list)) return undefined;
    return (list as JutsuLike[]).find(j => j && j.id === jutsuId);
}
function normalizeSlot(slot?: string): string {
    if (slot === 'weapon') return 'hand';
    if (slot === 'armor') return 'body';
    if (slot === 'accessory') return 'aura';
    return slot ?? '';
}
/** The actor's equipped item matching `itemId` (or the first equipped, if unspecified).
 *  Mirrors api/pvp/move.ts equippedPvpItem: only items in an `equipment` slot count. */
function equippedItem(actor: TowerActor, itemId?: string): PvpItemLike | null {
    const items = (actor.character.pvpItems as PvpItemLike[] | undefined) ?? [];
    const equipment = (actor.character.equipment as Record<string, string | undefined> | undefined) ?? {};
    const equippedIds = new Set(Object.values(equipment).filter((id): id is string => Boolean(id)));
    return items.find(it => Boolean(it.id) && equippedIds.has(it.id!) && (!itemId || it.id === itemId)) ?? null;
}

// ─── Player-combat reuse: tower/clan-boss adapter → PvP source → combat-core ──
// A TowerActor is structurally a PvpFighter superset (same name/hp/chakra/stamina/
// shield/statuses/character/pos, and the SAME PvpStatus shape). So instead of
// re-implementing the intricate, load-bearing tag pipeline (Heal/Shield/Pierce/Stun/
// Poison/Drain/Absorb/Reflect/Lifesteal/IDG/IDT/DDG/DDT/Wound/Recoil/…), the tower
// adapts each attacker→target pair and calls the shared player-side resolver path.
// The underlying PvP resolver now delegates phase order to combat-core resolveJutsu;
// it remains deterministic (no RNG / wall-clock), so settle recompute still
// reproduces a run byte-for-byte. Positional tower features (pylons/wards/enrage/
// bulwark/party-scale) are folded into `wMult`; terrain via the session biome.
function actorToFighter(a: TowerActor): PvpFighter {
    return {
        name: a.name, hp: a.hp, maxHp: a.maxHp, chakra: a.chakra, maxChakra: a.maxChakra,
        stamina: a.stamina, maxStamina: a.maxStamina, shield: a.shield,
        statuses: a.statuses.map(s => ({ ...s })), character: a.character, pos: a.pos,
    };
}
function writeBackFighter(a: TowerActor, f: PvpFighter): void {
    a.hp = Math.max(0, Math.min(a.maxHp, Math.floor(f.hp)));
    a.chakra = Math.max(0, Math.floor(f.chakra));
    a.stamina = Math.max(0, Math.floor(f.stamina));
    a.shield = Math.max(0, Math.floor(f.shield));
    a.statuses = f.statuses;
    // pos is intentionally NOT written back: applyJutsu's Push/Pull/Barrier operate on the PvP
    // grid, whose coordinates are meaningless on the tower board. Push/Pull are re-applied on the
    // TOWER grid by applyDisplacement (called from resolveHit); Barrier tile-blocking is not yet
    // ported (tracked separately).
}
/** Resolve one jutsu/weapon/attack from `actor` onto `target` (target===actor for a
 *  self-cast buff/heal) through the PvP resolver, with the tower env multiplier folded in. */
function runJutsu(session: TowerSession, actor: TowerActor, target: TowerActor, jutsu: JutsuLike, wMult: number): void {
    const selfCast = actor.id === target.id;
    // A summoned companion (pet) hits for the Arena's FLAT petCombatDamage figure,
    // capped at a fraction of the target's max HP — never the shinobi stat formula.
    // Deterministic (no rng), so a settle-recompute reproduces it exactly.
    if (!selfCast && isCompanionActor(actor)) {
        const flat = Math.max(1, Math.floor(Number(actor.character.companionDamage ?? 0)));
        const cap = Math.max(1, Math.floor(target.maxHp * COMPANION_MAX_DAMAGE_FRAC));
        const dealt = Math.min(flat, cap);
        target.hp = Math.max(0, target.hp - dealt);
        session.log.push(`${actor.name} strikes ${target.name} for ${dealt}.`);
        return;
    }
    const sf = actorToFighter(actor);
    const res = resolveTowerPlayerJutsu({
        session,
        actor,
        target: selfCast ? actor : target,
        jutsu: jutsu as Parameters<typeof applyPvpJutsu>[2],
        wMult,
        resolver: applyPvpJutsu,
    });
    writeBackFighter(actor, res.self);
    if (!selfCast) writeBackFighter(target, res.opponent);
    // Endless Spire heal-cut: throttle net HEALING a squad caster receives (self-heal / Lifesteal
    // / Siphon all land on res.self → actor.hp). `gained` is the realized post-writeback delta, so
    // max(0,…) is load-bearing: a Recoil / self-damage cast is a NEGATIVE delta that must NOT be
    // "cut" upward. Absorb heals the OPPONENT (never the squad caster) and boss regen lives outside
    // runJutsu, so both are correctly untouched. Story runs have no modifierStack → cut is 0.
    if (actor.side === 'squad') {
        const cut = healcutPct(session);
        const gained = actor.hp - sf.hp;
        if (cut > 0 && gained > 0) {
            const removed = gained - Math.floor(gained * (1 - cut / 100));
            actor.hp = Math.max(0, actor.hp - removed);
        }
    }
    session.log.push(...res.lines);
}
// Area radius for an AOE / ground / displacement jutsu (0 = single-target). Bloodline/
// creator jutsu carry these methods; the built-in catalog is all SINGLE. Ground-target
// + Move jutsu resolve as an area burst centred on the struck foe (the tower owns
// positioning, so the zone is applied immediately rather than placed on a tile).
function jutsuAreaRadius(jutsu: JutsuLike): number {
    const m = String(jutsu.method ?? 'SINGLE');
    // AOE_BURST: a target-centred blast on a 60-AP OPPONENT-targeted damage jutsu (no
    // movement / no ground tile). Radius 1 = full-damage splash to the struck foe plus
    // the 6 hexes touching them (resolveHit → applyAoeSplash). In 1v1 modes there is only
    // one enemy, so it behaves as a normal single-target nuke.
    if (m === 'AOE_BURST') return 1;
    if (m === 'AOE_SPIRAL') return 2;
    if (m === 'AOE_CIRCLE' || m === 'INSTANT_EFFECT' || m === 'AOE_LINE') return 1;
    if (String(jutsu.target ?? '') === 'EMPTY_GROUND') return 1;
    if (Array.isArray(jutsu.tags) && (jutsu.tags as Array<{ name?: string }>).some(t => t?.name === 'Move')) return 1;
    return 0;
}
/** Splash an AOE jutsu to every OTHER hostile in the blast (opponent-effects only, so the
 *  caster's heal/buff isn't re-applied per victim). Returns the names caught. */
function applyAoeSplash(session: TowerSession, actor: TowerActor, primary: TowerActor, jutsu: JutsuLike, wMult: number, radius: number): string[] {
    const area = new Set(filledDiskTiles(primary.pos, radius, session.map.width, session.map.height));
    const caught: string[] = [];
    for (const e of session.actors) {
        if (e.id === primary.id || e.hp <= 0 || !hostileSidesFor(actor.side).includes(e.side) || !area.has(e.pos)) continue;
        const res = resolveTowerPlayerJutsu({
            session,
            actor,
            target: e,
            jutsu: jutsu as Parameters<typeof applyPvpJutsu>[2],
            wMult,
            resolver: applyPvpJutsu,
        });
        writeBackFighter(e, res.opponent); // only the victim — caster effects already applied on the primary
        caught.push(e.name);
    }
    return caught;
}

// ─── Persistent ground-effect zones (EMPTY_GROUND jutsu placed on a tile) ─────
// A faithful tower port of PvP's ground zones: a tile-targeted jutsu lays a 2-round
// zone carrying its ground-eligible tags (Decrease Damage Given / Recoil / Poison);
// any HOSTILE standing in the zone re-suffers the tags each round (reusing the EXACT
// PvP applyGroundEffectToFighter), then the zone ticks down. Deterministic (no RNG/
// clock — the id is derived from round + caster + jutsu so settle reproduces it).
function towerGroundTags(tags: unknown): Array<{ name: string; percent?: number }> {
    if (!Array.isArray(tags)) return [];
    return (tags as Array<{ name?: string; percent?: number }>)
        .filter(t => t && typeof t.name === 'string')
        .map(t => ({ ...t, name: canonicalTagName(t.name!) }))
        .filter(t => GROUND_EFFECT_TAGS.has(t.name));
}
function groundZoneTiles(center: number, w: number, h: number): number[] {
    return [center, ...towerNeighbors(center, w, h)];
}
/** Living actors a zone affects — the HOSTILES of the side that cast it (squad→'p1'). */
function groundZoneTargets(session: TowerSession, effect: PvpGroundEffect): TowerActor[] {
    const victimSides: TowerSide[] = effect.owner === 'p1' ? ['enemy'] : ['squad', 'npc'];
    return session.actors.filter(a => a.hp > 0 && victimSides.includes(a.side));
}
function applyZoneToUnits(session: TowerSession, effect: PvpGroundEffect): void {
    for (const a of groundZoneTargets(session, effect)) {
        if (!effect.tiles.includes(a.pos)) continue;
        const r = applyGroundEffectToFighter(actorToFighter(a), effect, session.round);
        a.statuses = r.fighter.statuses;
        if (r.lines.length) session.log.push(...r.lines);
    }
}
/** Place a ground zone at `tile` from a ground-target (EMPTY_GROUND) jutsu, and bite anyone
 *  already standing in it. Returns false if the jutsu carries no ground-eligible tags. */
function layGroundZone(session: TowerSession, actor: TowerActor, jutsuId: string, jutsu: JutsuLike, tile: number): boolean {
    const tags = towerGroundTags(jutsu.tags);
    if (!tags.length) return false;
    const effect: PvpGroundEffect = {
        id: `gz-${session.round}-${actor.id}-${jutsuId}`,
        owner: actor.side === 'squad' ? 'p1' : 'p2',
        name: jutsu.name ?? 'Ground Effect',
        tiles: groundZoneTiles(tile, session.map.width, session.map.height),
        rounds: 2,
        tags,
    };
    session.groundEffects = [...(session.groundEffects ?? []), effect];
    session.log.push(`${actor.name} lays ${effect.name} across ${effect.tiles.length} tiles for 2 rounds.`);
    applyZoneToUnits(session, effect);
    return true;
}
/** Round-end: re-apply every live zone to units standing in it, then expire spent zones. */
function applyRoundGroundEffects(session: TowerSession): void {
    for (const effect of session.groundEffects ?? []) applyZoneToUnits(session, effect);
    session.groundEffects = tickGroundEffects(session.groundEffects);
}
// PvP-parity displacement: a Push/Pull-tagged jutsu shoves the struck target across the tower hex
// grid — Push AWAY from the attacker, Pull TOWARD it, by `jutsu.range` tiles (mirrors api/pvp/
// move.ts:812-813). The PvP-grid pos in applyJutsu's result is meaningless on the tower board (a
// different grid), so writeBackFighter drops it; THIS re-derives the move on the tower grid with
// the tower's own neighbour/distance/blocked helpers. Deterministic (first legal neighbour in the
// fixed towerNeighbors order, like PvP's away[0]/toward[0]); gated on Debuff Prevent like PvP;
// never displaces on a self-cast. Only the built-in bosses lack Push/Pull — bloodline/creator
// jutsu carry it, so this brings tower displacement to parity with PvP/PvE.
function applyDisplacement(session: TowerSession, attacker: TowerActor, target: TowerActor, jutsu: JutsuLike): void {
    if (attacker.id === target.id) return;
    const tags = Array.isArray(jutsu.tags) ? (jutsu.tags as Array<{ name?: string }>) : [];
    const isPush = tags.some(t => canonicalTagName(String(t?.name ?? '')) === 'Push');
    const isPull = tags.some(t => canonicalTagName(String(t?.name ?? '')) === 'Pull');
    if (!isPush && !isPull) return;
    if (hasActiveStatus(target, 'Debuff Prevent', session.round)) return; // PvP gates displacement on Debuff Prevent
    const w = session.map.width, h = session.map.height;
    const dist = Math.max(1, Math.floor(Number(jutsu.range) || 1));
    const distTo = (t: number) => hexDistance(t, attacker.pos, w);
    let pos = target.pos;
    for (let step = 0; step < dist; step++) {
        const here = distTo(pos);
        const next = towerNeighbors(pos, w, h).find(t =>
            t !== attacker.pos && !isTileBlocked(session, t, target.id) &&
            (isPush ? distTo(t) > here : distTo(t) < here));
        if (next === undefined) break; // wall / edge / occupied — can't move further
        pos = next;
    }
    if (pos !== target.pos) {
        target.pos = pos;
        session.log.push(`${isPush ? 'Push' : 'Pull'}: ${target.name} is ${isPush ? 'pushed' : 'pulled'} ${dist} tile${dist !== 1 ? 's' : ''}.`);
    }
}
// Shared resolution for attack / jutsu / weapon (and self-cast jutsu). Folds the
// positional tower multipliers into applyJutsu's wMult (terrain handled by its biome
// arg), then deducts AP/actions and advances boss phases + the win-check. Resource
// (chakra/stamina) + cooldown bookkeeping is the caller's job (it differs per action).
// Sealed-weather term (combat missions): +5% matching-element / −2% opposed-element
// on the attacker's OUTGOING jutsu, mirroring the Arena's weather rule. session.weather
// is absent for every other tower/spire/clan-boss run → ×1, byte-identical.
function weatherMult(session: TowerSession, jutsu: JutsuLike): number {
    const w = session.weather;
    if (!w) return 1;
    return weatherMultiplier(String(jutsu.element ?? ''), String(w.positiveElement ?? ''), String(w.negativeElement ?? ''));
}

function resolveHit(
    session: TowerSession, floor: TowerFloor, actor: TowerActor, target: TowerActor,
    jutsu: JutsuLike, cost: number,
): void {
    const selfCast = actor.id === target.id;
    // Endless Spire: enemy attackers hit harder by the sealed ascension dmgMult (the tier's
    // outgoing-damage spine). Story runs leave session.dmgMult unset → ×1, unchanged.
    const ascensionDmgMult = actor.side === 'enemy' ? Math.max(1, Number(session.dmgMult ?? 1)) : 1;
    // Endless Spire vulnerability: a squad target takes MORE damage per the sealed 'debuff'
    // keystones. Orthogonal to ascensionDmgMult (which scales the ENEMY attacker's output);
    // this scales what a SQUAD DEFENDER receives, and is capped inside debuffTakenMult so the
    // combined enrage × dmgMult × debuff product stays under the one-shot ceiling. ×1 for story.
    const incomingDebuffMult = (!selfCast && target.side === 'squad') ? debuffTakenMult(session, target) : 1;
    const wMult = selfCast ? 1 : (
        pylonAttackMult(session, actor, jutsu) * wardDefendMult(session, target)
        * attackerEnrageMult(session, actor) * bulwarkMult(session, target)
        * shrineAttackMult(session, actor)
        * Math.max(0, Number(actor.character.towerDmgScale ?? 1))
        * ascensionDmgMult * incomingDebuffMult
        * weatherMult(session, jutsu)
    );
    const verb = jutsu.id === 'basic-attack' ? 'attacks'
        : jutsu.id === 'weapon' ? `strikes with ${jutsu.name ?? 'a weapon'}`
        : `uses ${jutsu.name ?? 'a jutsu'}`;
    session.log.push(selfCast ? `${actor.name} ${verb}.` : `${actor.name} ${verb} → ${target.name}.`);
    runJutsu(session, actor, target, jutsu, wMult);
    // AOE / ground / Move jutsu also strike the other hostiles in the blast radius.
    const radius = selfCast ? 0 : jutsuAreaRadius(jutsu);
    if (radius > 0) {
        const caught = applyAoeSplash(session, actor, target, jutsu, wMult, radius);
        if (caught.length) session.log.push(`The blast also catches ${caught.join(', ')}.`);
    }
    // Push/Pull displacement resolves AFTER the hit + splash (so the blast still centred on the
    // struck tile) — moves the primary target on the tower grid to parity with PvP.
    if (!selfCast) applyDisplacement(session, actor, target, jutsu);
    session.activeAp -= cost;
    session.actionsThisTurn += 1;
    tickBossPhases(session);
    checkTowerWinner(session, floor);
}
// Round-end: tick Wound/Poison/Drain DoTs and expire statuses for every living actor,
// reusing the EXACT PvP helpers so timing/mitigation match the live game.
function applyRoundStatusTicks(session: TowerSession): void {
    for (const a of session.actors) {
        if (a.hp <= 0) continue;
        const dot = applyDoTs(actorToFighter(a), session.round);
        a.hp = Math.max(0, Math.min(a.maxHp, Math.floor(dot.fighter.hp)));
        a.chakra = Math.max(0, Math.floor(dot.fighter.chakra));
        if (dot.lines.length) session.log.push(...dot.lines);
        a.statuses = tickStatuses(actorToFighter(a), session.round).statuses;
    }
}

// ─── Turn scheduler (side-based rounds; interleaved boss-interrupt is Phase 3) ─
function rebuildTurnQueue(session: TowerSession): void {
    const byId = (a: TowerActor, b: TowerActor) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const squad = livingOnSide(session, 'squad').sort(byId).map(a => a.id);
    const enemy = livingOnSide(session, 'enemy').sort(byId).map(a => a.id);
    session.turnQueue = [...squad, ...enemy]; // npc actors are passive in v1 (protect targets)
}
function canAct(session: TowerSession, cost: number): boolean {
    return session.activeAp >= cost && session.actionsThisTurn < MAX_ACTIONS;
}
// Round-aware: a Stun applied THIS round (activeRound = round+1) defers to next turn,
// matching PvP — so an earlier actor stunning a later one doesn't rob the same round.
function isStunActive(s: { name: string; activeRound?: number }, round: number): boolean {
    return (s.name === 'Stun' || s.name === 'Stunned') && (s.activeRound === undefined || s.activeRound <= round);
}
function isStunned(actor: TowerActor, round: number): boolean {
    return actor.statuses.some(s => isStunActive(s, round));
}
/** True when the actor has an ACTIVE status of the given name (activeRound-aware, so a
 *  Prevent applied this turn doesn't block until next round — mirrors PvP hasStatus). */
function hasActiveStatus(actor: TowerActor, name: string, round: number): boolean {
    return actor.statuses.some(s => s.name === name && (s.activeRound === undefined || s.activeRound <= round));
}
// combatResourcesV2: Poison feeds on exertion — spending chakra/stamina to cast a jutsu
// deals HP damage scaled by the spend + the actor's active Poison (turtling avoids it).
// No-op when the flag is off, the actor isn't poisoned, or the jutsu was free. Mirrors the
// PvP move.ts handler + the PvE Arena on-spend hooks.
function spendPoison(session: TowerSession, actor: TowerActor, ck: number, st: number, round: number): void {
    if (!COMBAT_RESOURCES_V2) return;
    const pct = actor.statuses
        .filter(s => s.name === 'Poison' && (s.activeRound === undefined || s.activeRound <= round))
        .reduce((sum, s) => sum + (s.percent ?? 6), 0);
    if (pct <= 0) return;
    const dmg = v2PoisonOnSpend((ck || 0) + (st || 0), pct);
    if (dmg <= 0) return;
    actor.hp = Math.max(0, actor.hp - dmg);
    session.log.push(`${actor.name} takes ${dmg} Poison damage from exertion.`);
}
/** Tick down an actor's jutsu cooldowns at the START of their turn (mirrors PvP's
 *  per-caster tickCooldowns). Removes lapsed entries so the map stays small. */
function tickCooldowns(actor: TowerActor): void {
    for (const k of Object.keys(actor.cooldowns)) {
        const n = (actor.cooldowns[k] ?? 0) - 1;
        if (n > 0) setSafeRecordValue(actor.cooldowns, k, n); else deleteSafeRecordValue(actor.cooldowns, k);
    }
}
function refreshAp(session: TowerSession): void {
    const actor = activeActor(session);
    if (actor) tickCooldowns(actor);
    if (actor && COMBAT_RESOURCES_V2) {
        // combatResourcesV2: the active actor regenerates chakra/stamina at turn start
        // (mirrors PvP move.ts endTurn regen). Costs + the bigger pool are already sealed
        // via _seal.ts → the PvP hydrator.
        const rgLvl = Number((actor.character as { level?: number } | undefined)?.level) || 1;
        const rg = v2ResourceRegen(rgLvl);
        actor.chakra = Math.min(actor.maxChakra, actor.chakra + rg);
        actor.stamina = Math.min(actor.maxStamina, actor.stamina + rg);
    }
    if (actor && isStunned(actor, session.round)) {
        // Stun costs AP once and is CONSUMED at the start of the penalized turn (mirrors
        // api/pvp/move.ts:893-902) — never re-penalizing a lingering Stun every round.
        session.activeAp = Math.max(0, BASE_AP - STUN_AP_PENALTY);
        actor.statuses = actor.statuses.filter(s => !isStunActive(s, session.round));
    } else {
        session.activeAp = BASE_AP;
    }
    session.actionsThisTurn = 0;
}
// A summoned companion only holds the field for COMPANION_FIELD_ROUNDS rounds (the
// Arena's PET_FIELD_TURNS). Ticked at the top of each round — BEFORE the queue is
// rebuilt — so an expired or KO'd pet is off the board rather than queued for a turn.
// No-op (and no allocation) for the runs that never summon one.
function expireCompanions(session: TowerSession): void {
    if (!session.actors.some(isCompanionActor)) return;
    for (const a of session.actors) {
        if (!isCompanionActor(a) || a.hp <= 0) continue;
        // Tick the pet's own PetJutsu cooldowns (keyed by move name) once per round.
        const cds = (a.cooldowns ?? {}) as Record<string, number>;
        for (const k of Object.keys(cds)) cds[k] = Math.max(0, Number(cds[k] ?? 0) - 1);
        const left = Math.floor(Number(a.character.companionRoundsLeft ?? 0)) - 1;
        a.character.companionRoundsLeft = left;
        if (left <= 0) {
            a.hp = 0;
            session.log.push(`${a.name} returns to its scroll.`);
        }
    }
    session.actors = session.actors.filter(a => !(isCompanionActor(a) && a.hp <= 0));
}

export function startRound(session: TowerSession): void {
    expireCompanions(session);
    rebuildTurnQueue(session);
    session.activeIndex = 0;
    refreshAp(session);
    // Prime the boss's telegraphed strike (if its cadence hits this round) BEFORE computing the
    // telegraph, so the freshly-snapshotted blast is surfaced to the squad this round.
    primeBossStrike(session);
    // Surface the tiles that will burn at THIS round's end (spire hazards + closing ring + boss
    // strike) so the squad can pre-position during their turns. Deterministic hazards only
    // (proximity is reactive). Floors with none leave the field undefined → unchanged wire.
    const tele = computeHazardTelegraph(session);
    if (tele.length) session.map.nextRoundHazardTiles = tele;
    else delete session.map.nextRoundHazardTiles;
}

// ─── Win-check + objectives ──────────────────────────────────────────────────
function bossDead(session: TowerSession): boolean {
    const id = session.phaseState.bossId;
    if (!id) return false;
    const boss = getActor(session, id);
    return !!boss && boss.hp <= 0;
}
function squadWinsByObjective(session: TowerSession, floor: TowerFloor): boolean {
    switch (floor.objective) {
        case 'defeat-boss':
            // If a boss is resolved, the boss must die; if a floor was misconfigured with no
            // bossId, fall back to a full wipe so a genuine clear is never scored as a loss.
            return session.phaseState.bossId ? bossDead(session) : !isSideAlive(session, 'enemy');
        case 'reach-tile':
            // Robust to spawn-on-goal + (future) displacement: a LIVING squad actor on the
            // goal tile wins, not just one that *moved* there this turn.
            return typeof floor.goalTile === 'number'
                ? session.actors.some(a => a.side === 'squad' && a.hp > 0 && a.pos === floor.goalTile)
                : !!session.objectiveState.reachedGoal;
        case 'survive':
            return (session.objectiveState.roundsSurvived ?? 0) >= floor.roundBudget;
        case 'protect-npc':
        case 'kill-escort':
            return !isSideAlive(session, 'enemy') && isSideAlive(session, 'npc');
        // defeat-all / defeat-all-then-boss / kill-adds-first / break-objective
        default:
            return !isSideAlive(session, 'enemy');
    }
}
function objectiveFailed(session: TowerSession, floor: TowerFloor): boolean {
    if (floor.objective === 'protect-npc' || floor.objective === 'kill-escort') {
        // npc(s) existed and are all down
        return session.actors.some(a => a.side === 'npc') && !isSideAlive(session, 'npc');
    }
    return false;
}
/** A summoned companion (pet) never holds the run open: the squad is wiped once every
 *  REAL fighter is down, even if a temporary pet is still standing. Deliberately scoped
 *  to the wipe-check — isSideAlive keeps its plain meaning for the enemy/npc checks, and
 *  livingOnSide still queues + targets the pet like any other on-field unit. */
function squadFightersAlive(session: TowerSession): boolean {
    return session.actors.some(a => a.side === 'squad' && a.hp > 0 && !isCompanionActor(a));
}

export function checkTowerWinner(session: TowerSession, floor: TowerFloor): void {
    if (session.status !== 'active') return;
    if (!squadFightersAlive(session)) {
        session.status = 'done'; session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Squad wiped — floor failed.');
        return;
    }
    if (objectiveFailed(session, floor)) {
        session.status = 'done'; session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Objective failed.');
        return;
    }
    if (squadWinsByObjective(session, floor)) {
        session.status = 'done'; session.winner = 'squad';
        session.objectiveState.completed = true;
        session.log.push(`Floor ${floor.id} cleared!`);
    }
}

// Move crossed boss HP-phase thresholds from pending → triggered (hook for Phase 3 mechanics).
function tickBossPhases(session: TowerSession): void {
    const id = session.phaseState.bossId;
    if (!id) return;
    const boss = getActor(session, id);
    if (!boss || boss.maxHp <= 0) return;
    const pct = (boss.hp / boss.maxHp) * 100;
    while (session.phaseState.pendingPhases.length && pct <= session.phaseState.pendingPhases[0]!) {
        const t = session.phaseState.pendingPhases.shift()!;
        session.phaseState.triggeredPhases.push(t);
        session.log.push(`${boss.name} enters a new phase (${t}% HP).`);
        applyBossPhaseMechanic(session, boss); // enrage / summon fire at each gate
        dropPhasePillars(session, boss); // a 'phasePillars' boss reshapes the arena at each gate
        applyBossAegis(session, boss); // an 'aegis' boss raises a fresh (capped) shield at each gate
        // Wave 3: the desperation blast fires on the sealed extra gate (once).
        if (session.extraPhaseThreshold != null && t === session.extraPhaseThreshold) applyExtraPhaseShockwave(session, boss);
    }
}

// ─── Action application ──────────────────────────────────────────────────────
export function applyAction(session: TowerSession, floor: TowerFloor, action: TowerAction, rng: () => number): ActionResult {
    void rng; // reserved: AI tie-breaking / future variance — damage stays deterministic
    if (session.status !== 'active') return { applied: false, reason: 'session-done' };
    const actor = activeActor(session);
    if (!actor || actor.id !== action.actorId) return { applied: false, reason: 'not-your-turn' };
    if (actor.hp <= 0) return { applied: false, reason: 'down' };

    if (action.type === 'wait') return { applied: true };

    // Summon the sealed companion (pet) beside the caller. Free (no AP / no action
    // charge), once per fight — matching the Arena's summon button. The pet is
    // spliced in directly AFTER the summoner so the order reads You → Pet → Enemy
    // like the Arena, instead of rebuilding the queue mid-turn.
    if (action.type === 'summon') {
        if (isCompanionActor(actor)) return { applied: false, reason: 'companion-cannot-summon' };
        const seal = session.pendingCompanion;
        if (!seal) return { applied: false, reason: 'no-companion' };
        if (session.actors.some(a => a.id === COMPANION_ACTOR_ID)) return { applied: false, reason: 'already-summoned' };
        const spot = towerNeighbors(actor.pos, session.map.width, session.map.height)
            .find(t => !isTileBlocked(session, t));
        if (spot === undefined) return { applied: false, reason: 'no-space' };
        session.actors.push(companionActor(seal, spot));
        session.pendingCompanion = undefined;
        session.turnQueue.splice(session.activeIndex + 1, 0, COMPANION_ACTOR_ID);
        session.log.push(`${actor.name} summons ${seal.name}!`);
        // PVE-gear perk: some collars heal the summoner as the pet lands.
        const healPct = companionHealOnSummonPct(seal.pveGearId);
        if (healPct > 0 && actor.hp > 0) {
            const heal = Math.max(1, Math.floor(actor.maxHp * (healPct / 100)));
            actor.hp = Math.min(actor.maxHp, actor.hp + heal);
            session.log.push(`${seal.name}'s bond restores ${heal} HP to ${actor.name}.`);
        }
        return { applied: true };
    }

    if (action.type === 'move') {
        if (!canAct(session, MOVE_AP)) return { applied: false, reason: 'cannot-act' };
        const w = session.map.width;
        if (hexDistance(actor.pos, action.tile, w) !== 1) return { applied: false, reason: 'not-adjacent' };
        if (isTileBlocked(session, action.tile, actor.id)) return { applied: false, reason: 'blocked' };
        actor.pos = action.tile;
        session.activeAp -= MOVE_AP;
        session.actionsThisTurn += 1;
        if (actor.side === 'squad' && floor.objective === 'reach-tile' && typeof floor.goalTile === 'number' && actor.pos === floor.goalTile) {
            session.objectiveState.reachedGoal = true;
        }
        checkTowerWinner(session, floor);
        return { applied: true };
    }

    // ── dash: relocate up to DASH_RANGE hexes to an open tile (PvP basic action) ──
    if (action.type === 'dash') {
        if (!canAct(session, DASH_AP)) return { applied: false, reason: 'cannot-act' };
        const w = session.map.width;
        const d = hexDistance(actor.pos, action.tile, w);
        if (d < 1 || d > DASH_RANGE) return { applied: false, reason: 'out-of-range' };
        if (isTileBlocked(session, action.tile, actor.id)) return { applied: false, reason: 'blocked' };
        actor.pos = action.tile;
        session.activeAp -= DASH_AP;
        session.actionsThisTurn += 1;
        if (actor.side === 'squad' && floor.objective === 'reach-tile' && typeof floor.goalTile === 'number' && actor.pos === floor.goalTile) {
            session.objectiveState.reachedGoal = true;
        }
        checkTowerWinner(session, floor);
        return { applied: true };
    }

    // ── heal: restore HEAL_PCT of max HP for chakra (PvP basic action; on cooldown) ──
    if (action.type === 'heal') {
        if ((actor.cooldowns['basicHeal'] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
        if (actor.chakra < HEAL_CHAKRA) return { applied: false, reason: 'no-chakra' };
        if (!canAct(session, HEAL_AP)) return { applied: false, reason: 'cannot-act' };
        // Basic Heal restores HP DIRECTLY (not via runJutsu), so the Endless Spire heal-cut
        // keystone must be applied here too — otherwise a squad could dodge Withering Aura by
        // spamming Basic Heal. Story runs have no modifierStack → cut is 0, unchanged.
        let healAmt = Math.max(1, Math.floor(actor.maxHp * HEAL_PCT));
        if (actor.side === 'squad') {
            const cut = healcutPct(session);
            if (cut > 0) healAmt = Math.max(0, Math.floor(healAmt * (1 - cut / 100)));
        }
        actor.hp = Math.min(actor.maxHp, actor.hp + healAmt);
        actor.chakra = Math.max(0, actor.chakra - HEAL_CHAKRA);
        actor.cooldowns['basicHeal'] = HEAL_CD;
        session.activeAp -= HEAL_AP;
        session.actionsThisTurn += 1;
        session.log.push(`${actor.name} uses Basic Heal, restoring ${healAmt} HP.`);
        return { applied: true };
    }

    // ── cleanse: strip the actor's own negative statuses (debuffs / DoTs) ──
    if (action.type === 'cleanse') {
        if ((actor.cooldowns['cleanse'] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
        if (!canAct(session, CLEANSE_AP)) return { applied: false, reason: 'cannot-act' };
        if (hasActiveStatus(actor, 'Cleanse Prevent', session.round)) {
            session.log.push(`${actor.name}'s Cleanse Prevent blocks the cleanse.`);
        } else {
            const removed = actor.statuses.filter(s => s.kind === 'negative').map(s => s.name);
            actor.statuses = actor.statuses.filter(s => s.kind !== 'negative');
            session.log.push(`Cleanse: removed ${removed.length ? removed.join(', ') : 'no negative effects'} from ${actor.name}.`);
        }
        actor.cooldowns['cleanse'] = CLEANSE_CD;
        session.activeAp -= CLEANSE_AP;
        session.actionsThisTurn += 1;
        return { applied: true };
    }

    // ── clear: strip a hostile target's positive statuses (buffs) ──
    if (action.type === 'clear') {
        if ((actor.cooldowns['clear'] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
        if (!canAct(session, CLEAR_AP)) return { applied: false, reason: 'cannot-act' };
        const cTarget = getActor(session, action.targetId);
        if (!cTarget || cTarget.hp <= 0) return { applied: false, reason: 'no-target' };
        if (!hostileSidesFor(actor.side).includes(cTarget.side)) return { applied: false, reason: 'friendly-fire' };
        if (hasActiveStatus(cTarget, 'Clear Prevent', session.round)) {
            session.log.push(`${cTarget.name}'s Clear Prevent blocks the clear.`);
        } else {
            const removed = cTarget.statuses.filter(s => s.kind === 'positive').map(s => s.name);
            cTarget.statuses = cTarget.statuses.filter(s => s.kind !== 'positive');
            session.log.push(`Clear: removed ${removed.length ? removed.join(', ') : 'no positive effects'} from ${cTarget.name}.`);
        }
        actor.cooldowns['clear'] = CLEAR_CD;
        session.activeAp -= CLEAR_AP;
        session.actionsThisTurn += 1;
        return { applied: true };
    }

    // ── weapon: a hit from the equipped hand/thrown weapon (real weaponEp/range/AP) ──
    if (action.type === 'weapon') {
        const item = equippedItem(actor, action.itemId);
        const slot = item ? normalizeSlot(item.slot) : '';
        if (!item || !['hand', 'thrown'].includes(slot)) return { applied: false, reason: 'no-weapon' };
        const wCost = Math.max(0, Number(item.apCost ?? BASIC_ATTACK_AP));
        if (!canAct(session, wCost)) return { applied: false, reason: 'cannot-act' };
        const wTarget = getActor(session, action.targetId);
        if (!wTarget || wTarget.hp <= 0) return { applied: false, reason: 'no-target' };
        if (!hostileSidesFor(actor.side).includes(wTarget.side)) return { applied: false, reason: 'friendly-fire' };
        const wRange = Math.max(1, Number(item.weaponRange ?? (slot === 'thrown' ? 4 : 1)));
        if (hexDistance(actor.pos, wTarget.pos, session.map.width) > wRange) return { applied: false, reason: 'out-of-range' };
        const wCdKey = item.id ?? item.name ?? 'weapon';
        const wCdTurns = Math.max(0, Math.floor(Number(item.weaponCooldown ?? 5)));
        if (wCdTurns > 0 && (actor.cooldowns[wCdKey] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
        // Thrown weapons spend from the sealed charge budget; hand weapons are reusable.
        if (slot === 'thrown') {
            if (!spendItemCharge(actor, item.id ?? '')) return { applied: false, reason: 'out-of-ammo' };
        }
        const weaponTags = Array.isArray(item.weaponTags) ? [...item.weaponTags] : [];
        if (item.weaponEffect && !weaponTags.some(t => (t as { name?: unknown })?.name === item.weaponEffect)) {
            weaponTags.push({ name: item.weaponEffect, percent: Number(item.weaponEffectValue ?? 0) });
        }
        const weaponJutsu: JutsuLike = {
            id: 'weapon', name: item.name ?? 'Weapon', type: 'Bukijutsu',
            isUtility: false, effectPower: Number(item.weaponEp ?? 15), ap: wCost, range: wRange,
            // Elemental-weapon gate (parity with PvP): the swing rides the wielder's
            // bloodline damage multiplier only when the weapon's element is one the
            // wielder has awakened. No element → no boost.
            suppressBloodline: !characterOwnsElement(actor.character, item.weaponElement),
            ...(weaponTags.length ? { tags: weaponTags } : {}),
        };
        resolveHit(session, floor, actor, wTarget, weaponJutsu, wCost);
        if (wCdTurns > 0) setSafeRecordValue(actor.cooldowns, wCdKey, wCdTurns);
        return { applied: true };
    }

    // ── self-cast jutsu (target: SELF) — heals/buffs resolve on the caster, no foe needed ──
    if (action.type === 'jutsu') {
        const jSelf = findJutsu(actor, action.jutsuId);
        if (jSelf && String((jSelf as { target?: string }).target) === 'SELF') {
            const cost = Number(jSelf.ap ?? 40);
            const ck = Math.max(0, Number(jSelf.chakraCost ?? 0));
            const st = Math.max(0, Number(jSelf.staminaCost ?? 0));
            if ((actor.cooldowns[action.jutsuId] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
            if (ck > 0 && actor.chakra < ck) return { applied: false, reason: 'no-chakra' };
            if (st > 0 && actor.stamina < st) return { applied: false, reason: 'no-stamina' };
            if (!canAct(session, cost)) return { applied: false, reason: 'cannot-act' };
            resolveHit(session, floor, actor, actor, jSelf, cost);
            actor.chakra = Math.max(0, actor.chakra - ck);
            actor.stamina = Math.max(0, actor.stamina - st);
            spendPoison(session, actor, ck, st, session.round);
            if (Number(jSelf.cooldown ?? 0) > 0) setSafeRecordValue(actor.cooldowns, action.jutsuId, Number(jSelf.cooldown));
            return { applied: true };
        }
    }

    // ── movement jutsu (Move tag) — relocate the caster to an open tile in range ──
    // The Move tag is resolved BEFORE the ground-zone path (mirrors PvP move.ts):
    // a body-flicker (Flicker / Tempest Step) repositions the user. Otherwise these
    // fall through to layGroundZone and bounce as `no-ground-tags` — Move is not a
    // ground-effect tag. AOE_SPIRAL dashes additionally erupt a ground nova on landing.
    if (action.type === 'jutsu' && action.tile !== undefined) {
        const jm = findJutsu(actor, action.jutsuId);
        const hasMoveTag = !!jm && Array.isArray(jm.tags)
            && (jm.tags as Array<{ name?: string }>).some(t => t?.name && canonicalTagName(t.name) === 'Move');
        if (jm && hasMoveTag) {
            const tile = Math.floor(action.tile);
            const w = session.map.width;
            if (tile < 0 || tile >= w * session.map.height) return { applied: false, reason: 'bad-tile' };
            if (tile === actor.pos) return { applied: false, reason: 'bad-tile' };
            const range = Math.max(1, Number(jm.range ?? 5));
            if (hexDistance(actor.pos, tile, w) > range) return { applied: false, reason: 'out-of-range' };
            if (isTileBlocked(session, tile, actor.id)) return { applied: false, reason: 'blocked' };
            const cost = Number(jm.ap ?? 20);
            const ck = Math.max(0, Number(jm.chakraCost ?? 0));
            const st = Math.max(0, Number(jm.staminaCost ?? 0));
            if ((actor.cooldowns[action.jutsuId] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
            if (ck > 0 && actor.chakra < ck) return { applied: false, reason: 'no-chakra' };
            if (st > 0 && actor.stamina < st) return { applied: false, reason: 'no-stamina' };
            if (!canAct(session, cost)) return { applied: false, reason: 'cannot-act' };
            actor.pos = tile;
            actor.chakra = Math.max(0, actor.chakra - ck);
            actor.stamina = Math.max(0, actor.stamina - st);
            spendPoison(session, actor, ck, st, session.round);
            if (Number(jm.cooldown ?? 0) > 0) setSafeRecordValue(actor.cooldowns, action.jutsuId, Number(jm.cooldown));
            session.activeAp -= cost;
            session.actionsThisTurn += 1;
            session.log.push(`${actor.name} uses ${jm.name ?? 'a body flicker'} — flickers to hex ${tile}.`);
            // Spiral dash: erupt a ground nova on the landing tile (best-effort — a
            // pure Move jutsu carries no ground tags, so this no-ops for Flicker).
            if (String(jm.method ?? 'SINGLE') === 'AOE_SPIRAL') layGroundZone(session, actor, action.jutsuId, jm, tile);
            if (actor.side === 'squad' && floor.objective === 'reach-tile' && typeof floor.goalTile === 'number' && actor.pos === floor.goalTile) {
                session.objectiveState.reachedGoal = true;
            }
            tickBossPhases(session);
            checkTowerWinner(session, floor);
            return { applied: true };
        }
    }

    // ── ground-target jutsu (target: EMPTY_GROUND, non-Move) — resolve on the tile ──
    if (action.type === 'jutsu' && action.tile !== undefined) {
        const jg = findJutsu(actor, action.jutsuId);
        if (jg && String((jg as { target?: string }).target) === 'EMPTY_GROUND') {
            const tile = Math.floor(action.tile);
            if (tile < 0 || tile >= session.map.width * session.map.height) return { applied: false, reason: 'bad-tile' };
            if (session.map.blockedTiles.includes(tile)) return { applied: false, reason: 'blocked' };
            const range = Math.max(1, Number(jg.range ?? 1));
            if (hexDistance(actor.pos, tile, session.map.width) > range) return { applied: false, reason: 'out-of-range' };
            const cost = Number(jg.ap ?? 40);
            const ck = Math.max(0, Number(jg.chakraCost ?? 0));
            const st = Math.max(0, Number(jg.staminaCost ?? 0));
            if ((actor.cooldowns[action.jutsuId] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
            if (ck > 0 && actor.chakra < ck) return { applied: false, reason: 'no-chakra' };
            if (st > 0 && actor.stamina < st) return { applied: false, reason: 'no-stamina' };
            if (!canAct(session, cost)) return { applied: false, reason: 'cannot-act' };
            // Ground-tagged (Poison / Recoil / Decrease Damage Given) → lay a persistent
            // zone, exactly as before (it bites units standing in it on cast + each round).
            // Otherwise resolve as a DIRECT strike on any hostile caught ON the target tile
            // (and its ring for AOE_CIRCLE / INSTANT_EFFECT) — mirrors the PvE Arena's
            // groundTargetCatchesEnemy, so a damage ground jutsu (e.g. a custom "Ambush")
            // hits instead of bouncing on `no-ground-tags`. An empty tile whiffs harmlessly
            // (still costs AP). This branch never hard-rejects for missing ground tags.
            if (layGroundZone(session, actor, action.jutsuId, jg, tile)) {
                session.activeAp -= cost;
                session.actionsThisTurn += 1;
                tickBossPhases(session);
                checkTowerWinner(session, floor);
            } else {
                const method = String(jg.method ?? 'SINGLE');
                const ringHit = method === 'AOE_CIRCLE' || method === 'INSTANT_EFFECT';
                const area = new Set(ringHit ? groundZoneTiles(tile, session.map.width, session.map.height) : [tile]);
                const primary = session.actors
                    .filter(a => a.hp > 0 && hostileSidesFor(actor.side).includes(a.side) && area.has(a.pos))
                    .sort((a, b) => (a.pos === tile ? -1 : b.pos === tile ? 1 : 0) || (a.pos - b.pos) || (a.id < b.id ? -1 : 1))[0];
                if (primary) {
                    resolveHit(session, floor, actor, primary, jg, cost); // damage + tags + AOE splash + AP + win-check
                } else {
                    session.log.push(`${actor.name} places ${jg.name ?? 'a ground jutsu'} on hex ${tile}, but it catches no one.`);
                    session.activeAp -= cost;
                    session.actionsThisTurn += 1;
                    tickBossPhases(session);
                    checkTowerWinner(session, floor);
                }
            }
            actor.chakra = Math.max(0, actor.chakra - ck);
            actor.stamina = Math.max(0, actor.stamina - st);
            spendPoison(session, actor, ck, st, session.round);
            if (Number(jg.cooldown ?? 0) > 0) setSafeRecordValue(actor.cooldowns, action.jutsuId, Number(jg.cooldown));
            return { applied: true };
        }
    }

    // ── item: a self-targeted consumable (potion / combat item). Restore-only potions
    // refill chakra/stamina directly; everything else (Heal potions, self-buffs, smoke)
    // synthesizes a SELF jutsu and resolves through the PvP engine. Mirrors move.ts. ──
    if (action.type === 'item') {
        const item = equippedItem(actor, action.itemId);
        const slot = item ? normalizeSlot(item.slot) : '';
        if (!item || ['hand', 'thrown'].includes(slot)) return { applied: false, reason: 'no-item' };
        const iCost = Math.max(0, Number(item.apCost ?? 35));
        if (!canAct(session, iCost)) return { applied: false, reason: 'cannot-act' };
        const iCdKey = item.id ?? item.name ?? 'item';
        const iCdTurns = Math.max(0, Math.floor(Number(item.weaponCooldown ?? 0)));
        if (iCdTurns > 0 && (actor.cooldowns[iCdKey] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
        if (!spendItemCharge(actor, item.id ?? '')) return { applied: false, reason: 'out-of-item' };
        const restoreCk = Math.max(0, Number(item.restoreChakra ?? 0));
        const restoreSt = Math.max(0, Number(item.restoreStamina ?? 0));
        const itemTags: Array<{ name: string; percent?: number }> | null =
            Array.isArray(item.weaponTags) && item.weaponTags.length ? item.weaponTags as Array<{ name: string; percent?: number }>
            : item.weaponEffect ? [{ name: item.weaponEffect, percent: Number(item.weaponEffectValue ?? 0) }]
            : null;
        if ((restoreCk > 0 || restoreSt > 0) && !itemTags) {
            // Pure restore potion — refill directly (skip the synth so it never heals HP via a default Heal tag).
            actor.chakra = Math.min(actor.maxChakra, actor.chakra + restoreCk);
            actor.stamina = Math.min(actor.maxStamina, actor.stamina + restoreSt);
            session.log.push(`${actor.name} uses ${item.name ?? 'a potion'} — restores ${restoreCk} chakra, ${restoreSt} stamina.`);
        } else if (canonicalTagName(String(item.weaponEffect ?? '')) === 'Decrease Damage Given') {
            // Smoke Bomb-style combat items are field debuffs: the enemy side is always
            // weakened, and weaponEffectTarget="both" also weakens the user.
            const pct = Math.max(0, Number(item.weaponEffectValue ?? 0));
            const status: PvpStatus = { name: 'Decrease Damage Given', rounds: 1, percent: pct, kind: 'negative' };
            const affected: string[] = [];
            for (const foe of session.actors) {
                if (foe.hp <= 0 || !hostileSidesFor(actor.side).includes(foe.side)) continue;
                if (hasActiveStatus(foe, 'Debuff Prevent', session.round)) continue;
                addTowerStatus(foe, status);
                affected.push(foe.name);
            }
            if (item.weaponEffectTarget === 'both') {
                addTowerStatus(actor, status);
                affected.unshift(actor.name);
            }
            session.log.push(`${actor.name} uses ${item.name ?? 'an item'} — smoke weakens ${affected.length ? affected.join(', ') : 'no one'}.`);
        } else {
            // Heal / self-buff consumable → self-cast jutsu (id 'item-' exempts the 40-AP utility rule).
            const itemJutsu: JutsuLike = {
                id: `item-${item.id}`, name: item.name ?? 'Item', type: 'Ninjutsu', target: 'SELF',
                effectPower: Number(item.weaponEp ?? 10), ap: iCost, range: 0,
                tags: (itemTags ?? [{ name: 'Heal' }]) as unknown[],
            };
            session.log.push(`${actor.name} uses ${item.name ?? 'an item'}.`);
            runJutsu(session, actor, actor, itemJutsu, 1);
        }
        if (iCdTurns > 0) setSafeRecordValue(actor.cooldowns, iCdKey, iCdTurns);
        session.activeAp -= iCost;
        session.actionsThisTurn += 1;
        checkTowerWinner(session, floor);
        return { applied: true };
    }

    // attack / jutsu — need a living, hostile, in-range target
    const target = getActor(session, action.targetId ?? '');
    if (!target || target.hp <= 0) return { applied: false, reason: 'no-target' };
    if (!hostileSidesFor(actor.side).includes(target.side)) return { applied: false, reason: 'friendly-fire' };
    const dist = hexDistance(actor.pos, target.pos, session.map.width);

    let jutsu: JutsuLike;
    let cost: number;
    let chakraCost = 0;
    let staminaCost = 0;
    if (action.type === 'attack') {
        // Basic attack stays resource-free (the always-available fallback; matches the AI's reliance on it).
        jutsu = { id: 'basic-attack', effectPower: 10, type: actorSpecialty(actor), ap: BASIC_ATTACK_AP, range: 1 };
        cost = BASIC_ATTACK_AP;
        if (dist > 1) return { applied: false, reason: 'out-of-range' };
    } else {
        const j = findJutsu(actor, action.jutsuId);
        if (!j) return { applied: false, reason: 'no-jutsu' };
        jutsu = j;
        cost = Number(j.ap ?? 40);
        chakraCost = Math.max(0, Number(j.chakraCost ?? 0));
        staminaCost = Math.max(0, Number(j.staminaCost ?? 0));
        const range = Math.max(1, Number(j.range ?? 1));
        if (dist > range) return { applied: false, reason: 'out-of-range' };
        // Resource + cooldown gating (real costs from the catalog jutsu — matches PvP).
        if ((actor.cooldowns[action.jutsuId] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
        if (chakraCost > 0 && actor.chakra < chakraCost) return { applied: false, reason: 'no-chakra' };
        if (staminaCost > 0 && actor.stamina < staminaCost) return { applied: false, reason: 'no-stamina' };
    }
    if (!canAct(session, cost)) return { applied: false, reason: 'cannot-act' };

    resolveHit(session, floor, actor, target, jutsu, cost);
    // Deduct chakra/stamina + arm the cooldown after a jutsu lands (basic attack is free).
    if (action.type === 'jutsu') {
        actor.chakra = Math.max(0, actor.chakra - chakraCost);
        actor.stamina = Math.max(0, actor.stamina - staminaCost);
        spendPoison(session, actor, chakraCost, staminaCost, session.round);
        if (Number(jutsu.cooldown ?? 0) > 0) setSafeRecordValue(actor.cooldowns, action.jutsuId, Number(jutsu.cooldown));
    }
    return { applied: true };
}

// ─── Turn advance ────────────────────────────────────────────────────────────
export function endTurn(session: TowerSession, floor: TowerFloor): void {
    if (session.status !== 'active') return;
    let idx = session.activeIndex + 1;
    while (idx < session.turnQueue.length) {
        const a = getActor(session, session.turnQueue[idx]!);
        if (a && a.hp > 0) break;
        idx++;
    }
    if (idx < session.turnQueue.length) {
        session.activeIndex = idx;
        refreshAp(session);
        return;
    }
    // round complete
    session.objectiveState.roundsSurvived = (session.objectiveState.roundsSurvived ?? 0) + 1;
    applyRoundGroundEffects(session); // re-apply persistent ground zones to units standing in them, then tick
    applyRoundStatusTicks(session); // bleed Wound/Poison/Drain + expire statuses (PvP DoT math)
    applyRoundHazards(session); // chip anyone standing on a hazard tile at round end
    applyBossStrikeAndRing(session); // detonate the telegraphed boss strike + closing-ring chip
    applyRoundDynamicHazards(session); // erupt any geyser vents scheduled for this round
    applyRoundFonts(session);   // fonts restore whoever holds them (capped; heal-cut honoured)
    applyBossRegen(session);    // a 'regen' boss heals each round
    checkTowerWinner(session, floor);
    if (session.status !== 'active') return;
    // Endless Spire seals a per-floor roundCap (<= MAX_ROUNDS) as the real clear deadline;
    // story runs leave it unset → the MAX_ROUNDS engine cap, unchanged.
    if (session.round >= Math.min(MAX_ROUNDS, Number(session.roundCap ?? MAX_ROUNDS))) {
        // hard timeout: failed to clear in time (survive floors win above before reaching here)
        session.status = 'done';
        session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Round limit reached — floor failed.');
        return;
    }
    session.round += 1;
    startRound(session);
}

// ─── Deterministic AI policy (v1 — nearest-target; richer policy = P1.A3) ─────
function bestAffordableJutsu(session: TowerSession, actor: TowerActor, dist: number): JutsuLike | undefined {
    const list = actor.character.jutsu;
    if (!Array.isArray(list)) return undefined;
    const opts = (list as JutsuLike[])
        .filter(j => j && typeof j.id === 'string')
        .filter(j => Math.max(1, Number(j.range ?? 1)) >= dist)
        .filter(j => canAct(session, Number(j.ap ?? 40)))
        // affordable: not on cooldown, enough chakra + stamina (mirrors the human gates)
        .filter(j => (actor.cooldowns[String(j.id)] ?? 0) <= 0)
        .filter(j => actor.chakra >= Math.max(0, Number(j.chakraCost ?? 0)) && actor.stamina >= Math.max(0, Number(j.staminaCost ?? 0)))
        // skip zero-damage utility + ground-placed jutsu — the AI casts straightforward damage
        .filter(j => Number(j.effectPower ?? 0) > 0 && String((j as { target?: string }).target ?? '') !== 'EMPTY_GROUND')
        // deterministic: highest effectPower, ties by id
        .sort((a, b) => (Number(b.effectPower ?? 0) - Number(a.effectPower ?? 0)) || (String(a.id) < String(b.id) ? -1 : 1));
    return opts[0];
}
// ─── Focus-fire target selection (deterministic; opt-in via character.aiTargetMode) ──
// A boss/enemy carrying an authored aiTargetMode chooses its victim by PRIORITY instead
// of the generic nearest-opponent. Every key is an integer (hp / defense composite /
// sustain-jutsu count / hex distance) with an id tie-break, so the pick is a pure function
// of session state — settle recompute reproduces it byte-for-byte, and an actor with no
// aiTargetMode never reaches this code (nearest-opponent, unchanged). See _floor-catalog
// TOWER_TARGET_MODES.
const FOCUS_SUPPORT_TAGS = new Set(['Heal', 'Lifesteal', 'Siphon', 'Shield', 'Absorb', 'Reflect']);
function actorSupportScore(actor: TowerActor): number {
    const list = actor.character.jutsu;
    if (!Array.isArray(list)) return 0;
    let n = 0;
    for (const j of list as Array<{ tags?: unknown[] }>) {
        if (!j || !Array.isArray(j.tags)) continue;
        if ((j.tags as Array<{ name?: unknown }>).some(t => typeof t?.name === 'string' && FOCUS_SUPPORT_TAGS.has(canonicalTagName(t.name)))) n++;
    }
    return n;
}
function actorDefComposite(actor: TowerActor): number {
    const s = (actor.character.stats as Record<string, number>) ?? {};
    return (Number(s.taijutsuDefense) || 0) + (Number(s.bukijutsuDefense) || 0)
        + (Number(s.genjutsuDefense) || 0) + (Number(s.ninjutsuDefense) || 0);
}
/** True when `attacker` could actually strike `opp` THIS turn — an affordable in-range jutsu
 *  or an adjacent basic attack. Used so a focusing boss never walks past a reachable kill to
 *  chase a far-off priority target. */
function canHitThisTurn(session: TowerSession, attacker: TowerActor, opp: TowerActor): boolean {
    const d = hexDistance(attacker.pos, opp.pos, session.map.width);
    if (d <= 1 && canAct(session, BASIC_ATTACK_AP)) return true;
    return !!bestAffordableJutsu(session, attacker, d);
}
function pickFocusTarget(session: TowerSession, actor: TowerActor, mode: TowerTargetMode): TowerActor | undefined {
    const w = session.map.width;
    const opps = opponentsOf(session, actor);
    if (opps.length === 0) return undefined;
    // Prefer targets the actor can hit now; only advance on the global priority pick when none.
    const hittable = opps.filter(o => canHitThisTurn(session, actor, o));
    const pool = hittable.length ? hittable : opps;
    const dist = (o: TowerActor) => hexDistance(actor.pos, o.pos, w);
    const idcmp = (a: TowerActor, b: TowerActor) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    let cmp: (a: TowerActor, b: TowerActor) => number;
    if (mode === 'squishiest') cmp = (a, b) => (actorDefComposite(a) - actorDefComposite(b)) || (a.hp - b.hp) || (dist(a) - dist(b)) || idcmp(a, b);
    else if (mode === 'support') cmp = (a, b) => (actorSupportScore(b) - actorSupportScore(a)) || (a.hp - b.hp) || (dist(a) - dist(b)) || idcmp(a, b);
    else cmp = (a, b) => (a.hp - b.hp) || (dist(a) - dist(b)) || idcmp(a, b); // 'lowest-hp'
    return [...pool].sort(cmp)[0];
}

// ─── AI board-awareness: seek beneficial objects, avoid detrimental tiles ─────
// A light overlay on the move decision so AI actors (enemies, async allies, AFK humans) walk
// TOWARD board objects worth holding and AROUND tiles that would hurt them. Deterministic (pure
// over session state — no RNG/wall-clock), and a strict NO-OP on a floor with no board objects,
// no hazard features, no telegraph and no ground zones → the AI is byte-identical to the plain
// nearest-opponent policy there. Combat stays primary: this only runs when the actor can't attack
// this turn (the move branch of pickAiAction).
const AI_SEEK_RANGE = 6; // don't abandon the fight to chase a distant object

/** Tiles that would DAMAGE `actor` if it ends the round on them: feature hazards (any side), the
 *  squad-targeted telegraph (boss strikes / closing ring / spire hazards — squad only), and the
 *  hostile-owned persistent ground zones. Mirrors who each source actually chips. */
function aiDangerTiles(session: TowerSession, actor: TowerActor): Set<number> {
    const danger = new Set<number>();
    for (const f of session.map.features ?? []) if (f.kind === 'hazard') for (const t of f.tiles) danger.add(t);
    for (const t of dynamicHazardTiles(session, session.round)) danger.add(t); // geysers erupt on both sides
    if (actor.side === 'squad') for (const t of session.map.nextRoundHazardTiles ?? []) danger.add(t);
    for (const z of session.groundEffects ?? []) {
        const bitesMe = z.owner === 'p1' ? actor.side === 'enemy' : (actor.side === 'squad' || actor.side === 'npc');
        if (bitesMe) for (const t of z.tiles) danger.add(t);
    }
    return danger;
}
/** True when `actor` stands on a shrine its own team benefits from holding (so it should hold). */
function aiOnHeldShrine(session: TowerSession, actor: TowerActor): boolean {
    for (const o of session.map.boardObjects ?? []) {
        if (o.kind === 'shrine' && (o.tiles ?? []).includes(actor.pos)) return true;
    }
    return false;
}
/** The tile of the most worthwhile beneficial object for `actor` to head toward (or undefined):
 *  a shrine its team does NOT already hold (contest it), or a font for a resource it's low on.
 *  Only within AI_SEEK_RANGE. Deterministic (integer score, then distance, then tile-id). */
function aiBeneficialGoal(session: TowerSession, actor: TowerActor): number | undefined {
    const objects = session.map.boardObjects;
    if (!objects || objects.length === 0) return undefined;
    const w = session.map.width;
    let bestTile: number | undefined;
    let bestScore = 0, bestDist = Infinity;
    for (const o of objects) {
        const tile = (o.tiles ?? [])[0];
        if (tile === undefined || tile === actor.pos) continue;
        let score = 0;
        if (o.kind === 'shrine') {
            const heldByMyTeam = session.actors.some(a => a.hp > 0 && a.side === actor.side && a.pos === tile);
            if (!heldByMyTeam) score = 3;
        } else { // font — want it when low on that resource; an urgent low-hp need ranks up with shrines
            const frac = o.resource === 'hp' ? actor.hp / Math.max(1, actor.maxHp)
                : o.resource === 'chakra' ? actor.chakra / Math.max(1, actor.maxChakra)
                : actor.stamina / Math.max(1, actor.maxStamina);
            if (frac < 0.6) score = (o.resource === 'hp' && frac < 0.35) ? 3 : 2;
        }
        if (score === 0) continue;
        const d = hexDistance(actor.pos, tile, w);
        if (d > AI_SEEK_RANGE) continue;
        if (score > bestScore
            || (score === bestScore && d < bestDist)
            || (score === bestScore && d === bestDist && bestTile !== undefined && tile < bestTile)) {
            bestTile = tile; bestScore = score; bestDist = d;
        }
    }
    return bestTile;
}
/** One step toward `dest` that avoids `actor`'s danger tiles when it can; a unit standing IN danger
 *  flees to a safe neighbour even off-route. Falls back to the terrain-aware nextStepToward when no
 *  danger applies, so danger-free floors are byte-identical. */
function aiSafeStepToward(session: TowerSession, actor: TowerActor, dest: number, danger: Set<number>): number {
    const from = actor.pos;
    const base = nextStepToward(session, from, dest, actor.id);
    if (danger.size === 0) return base; // fast path — unchanged policy
    if (base !== from && !danger.has(base)) return base; // the natural step is already safe
    const w = session.map.width, h = session.map.height;
    const here = hexDistance(from, dest, w);
    const free = towerNeighbors(from, w, h).filter(n => !isTileBlocked(session, n, actor.id)).sort((a, b) => a - b);
    const safeProgress = free.find(n => !danger.has(n) && hexDistance(n, dest, w) < here);
    if (safeProgress !== undefined) return safeProgress;      // safe step that still gets closer
    if (danger.has(from)) {                                    // in danger + no safe progress → flee anywhere safe
        const anySafe = free.find(n => !danger.has(n));
        if (anySafe !== undefined) return anySafe;
    }
    if (!danger.has(from)) return from;                        // safe now → hold rather than step into danger
    return base;                                               // last resort: progress through danger
}

export function pickAiAction(session: TowerSession, actor: TowerActor, rng: () => number): TowerAction {
    void rng;
    // A boss/enemy with an authored aiTargetMode focus-fires by priority; everyone else keeps
    // the nearest-opponent policy → floors that set no targetMode are byte-identical.
    const focusMode = actor.side === 'enemy'
        ? String((actor.character as { aiTargetMode?: unknown }).aiTargetMode ?? '')
        : '';
    const target = (focusMode ? pickFocusTarget(session, actor, focusMode as TowerTargetMode) : undefined)
        ?? nearestOpponent(session, actor);
    if (!target) return { actorId: actor.id, type: 'wait' };
    const dist = hexDistance(actor.pos, target.pos, session.map.width);
    // Combat first: attack if we possibly can this turn.
    const j = bestAffordableJutsu(session, actor, dist);
    if (j && j.id) return { actorId: actor.id, type: 'jutsu', jutsuId: j.id, targetId: target.id };
    if (dist <= 1 && canAct(session, BASIC_ATTACK_AP)) return { actorId: actor.id, type: 'attack', targetId: target.id };
    if (canAct(session, MOVE_AP)) {
        // Can't attack → move. Head for a board object worth holding (or hold a shrine we're on),
        // else approach the target — and step there while dodging danger tiles.
        const danger = aiDangerTiles(session, actor);
        let dest = target.pos;
        if (!danger.has(actor.pos) && aiOnHeldShrine(session, actor)) {
            dest = actor.pos; // hold contested ground instead of wandering off it
        } else {
            const boon = aiBeneficialGoal(session, actor);
            if (boon !== undefined) dest = boon;
        }
        const step = aiSafeStepToward(session, actor, dest, danger);
        if (step !== actor.pos) return { actorId: actor.id, type: 'move', tile: step };
    }
    return { actorId: actor.id, type: 'wait' };
}

// ─── Party scaling ───────────────────────────────────────────────────────────
// Scale enemy HP for a party smaller than the floor's balance baseline. Called by the
// encounter builder (start.ts, P1.B1) after enemies are built. Squad/npc untouched.
export function applyPartyScaling(session: TowerSession, floor: TowerFloor): void {
    const factor = partyScaleFactor(session.partySize, getFloorBalanceFor(floor));
    if (factor >= 1) return;
    for (const a of session.actors) {
        if (a.side !== 'enemy') continue;
        // Idempotency guard: never double-scale (a settle recompute or accidental second
        // call must not weaken enemies further). towerDmgScale is the "already scaled" mark.
        if (a.character.towerDmgScale != null) continue;
        a.maxHp = scaleEnemyStat(a.maxHp, factor);
        a.hp = Math.min(a.hp, a.maxHp);
        // Enemy outgoing damage scales by the same factor (read by computeDamage).
        a.character.towerDmgScale = factor;
    }
}

// Safety net for the auto-run drivers: if the guard ever trips with the session still
// 'active' (should be unreachable — endTurn always advances and MAX_ROUNDS resolves), the
// turn queue is wedged. Force a timeout loss so a LIVE run can never freeze on an active,
// unrecoverable board (deterministic; no RNG/clock).
function forceTimeoutResolve(session: TowerSession, floor: TowerFloor): void {
    checkTowerWinner(session, floor);
    if (session.status === 'active') {
        session.status = 'done';
        session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Floor resolution stalled — floor failed.');
    }
}

// ─── Deterministic auto-run (async resolution + settle recompute) ────────────
// Drives every actor via the AI policy to a terminal state. Used when the whole floor
// is AI-resolved (async squads) and by settle.ts to recompute the clear from the seed.
export function runTowerFloor(session: TowerSession, floor: TowerFloor, rng: () => number): TowerSession {
    if (session.turnQueue.length === 0) startRound(session);
    const GUARD = (MAX_ROUNDS + 2) * (session.actors.length + 2) * (MAX_ACTIONS + 2) + 256;
    let guard = 0;
    while (session.status === 'active' && guard++ < GUARD) {
        const actor = activeActor(session);
        if (!actor || actor.hp <= 0 || actor.side === 'npc') { endTurn(session, floor); continue; }
        // A summoned pet runs its own PetJutsu turn, not the generic action AI.
        if (isCompanionActor(actor)) {
            runCompanionTurn(session, floor, actor, rng);
            if (session.status === 'active') endTurn(session, floor);
            continue;
        }
        let safety = 0;
        while (session.status === 'active' && safety++ <= MAX_ACTIONS) {
            const action = pickAiAction(session, actor, rng);
            if (action.type === 'wait') break;
            const res = applyAction(session, floor, action, rng);
            if (!res.applied) break;
        }
        if (session.status === 'active') endTurn(session, floor);
    }
    forceTimeoutResolve(session, floor); // no human stop here → any remaining 'active' is a stall
    return session;
}

// Live-mode driver: advance AI actors' turns until it is a HUMAN's turn (ai === false) or
// the floor resolves. Used by api/towers/action.ts after a human submits a turn-ending
// action, so the human only ever sees their own turns. Deterministic (seeded rng).
// ─── Summoned companion turn ─────────────────────────────────────────────────
// The pet does NOT go through pickAiAction/applyAction: its kit is PetJutsu kinds
// (heal/shield/dot/stun/…), not TowerActions. This runs its whole turn instead,
// mirroring the Arena's petTakeAction — self-support when hurt, else its best
// offensive move, else close the distance — and folding each PetJutsu kind onto
// the tower's own status primitives so ticking/cleanse/HUD all work for free.
// Fully deterministic: the only roll is obedience, off the engine's seeded rng.
function companionSelfBuffMult(actor: TowerActor): number {
    const inc = (actor.statuses ?? [])
        .filter(s => s.name === 'Increase Damage Given')
        .reduce((a, s) => a + Number((s as { percent?: number }).percent ?? 0), 0);
    return 1 + Math.min(60, inc) / 100;
}

/** The pet's owner — the real (non-companion) squad fighter it was summoned by. */
function companionOwner(session: TowerSession): TowerActor | undefined {
    return session.actors.find(a => a.side === 'squad' && !isCompanionActor(a));
}

/** Apply the pet's damage for this move: flat base × kind scale, lifted by the pet's
 *  own buffs and its equipped PVE gear (summon-damage / execute / avenger), then
 *  capped at a fraction of the target's max HP. Gear lifesteal heals the OWNER.
 *  Returns damage dealt. */
function companionDealDamage(session: TowerSession, actor: TowerActor, target: TowerActor, move: CompanionMove | null): number {
    const base = Number(actor.character.companionDamage ?? 0);
    const owner = companionOwner(session);
    const gearId = String(actor.character.companionPveGear ?? '');
    const enemyHpPct = target.maxHp > 0 ? (target.hp / target.maxHp) * 100 : 100;
    const ownerHpPct = owner && owner.maxHp > 0 ? (owner.hp / owner.maxHp) * 100 : 100;
    const raw = companionMoveDamage(base, move)
        * companionSelfBuffMult(actor)
        * companionGearDamageMult(gearId, enemyHpPct, ownerHpPct);
    if (raw <= 0) return 0;
    const cap = Math.max(1, Math.floor(target.maxHp * COMPANION_MAX_DAMAGE_FRAC));
    const dealt = Math.max(0, Math.min(Math.floor(raw), cap));
    target.hp = Math.max(0, target.hp - dealt);
    // Loyal Hunter-style gear bleeds part of the pet's damage back to its owner.
    const lifestealPct = companionOwnerLifestealPct(gearId);
    if (dealt > 0 && lifestealPct > 0 && owner && owner.hp > 0) {
        const heal = Math.max(1, Math.floor(dealt * (lifestealPct / 100)));
        owner.hp = Math.min(owner.maxHp, owner.hp + heal);
        session.log.push(`${owner.name} draws ${heal} HP from ${actor.name}'s strike.`);
    }
    return dealt;
}

function runCompanionTurn(session: TowerSession, floor: TowerFloor, actor: TowerActor, rng: () => number): void {
    const c = actor.character;
    if (!companionObeys(Number(c.companionHappiness ?? 0), c.companionLoyal === true, rng())) {
        session.log.push(`${actor.name} ignores your command and holds its position.`);
        return;
    }
    // The pet takes a PLAYER-SHAPED turn: the same 100 AP budget the engine hands
    // every actor, 40 AP per strike/cast and 30 AP per step, capped at MAX_ACTIONS —
    // so it chains a couple of actions per turn exactly like any other fighter
    // rather than getting one scripted move.
    let ap = Math.max(0, Number(session.activeAp ?? 0));
    let acted = 0;
    while (acted < MAX_ACTIONS && session.status === 'active' && actor.hp > 0) {
        const target = nearestOpponent(session, actor);
        if (!target) break;
        const moves = (Array.isArray(c.companionMoves) ? c.companionMoves : []) as CompanionMove[];
        const hpFrac = actor.maxHp > 0 ? actor.hp / actor.maxHp : 1;
        const move = pickCompanionMove(moves, (actor.cooldowns ?? {}) as Record<string, number>, hpFrac);
        const selfCast = !!move && companionMoveDamage(1, move) === 0;
        // Out of reach for anything offensive → spend a step closing the distance.
        if (!selfCast && hexDistance(actor.pos, target.pos, session.map.width) > COMPANION_RANGE) {
            if (ap < MOVE_AP) break;
            const step = nextStepToward(session, actor.pos, target.pos, actor.id);
            if (step === actor.pos || isTileBlocked(session, step, actor.id)) break;
            actor.pos = step; ap -= MOVE_AP; acted++;
            session.log.push(`${actor.name} closes in on ${target.name}.`);
            continue;
        }
        if (ap < BASIC_ATTACK_AP) break;
        companionCast(session, floor, actor, target, move);
        ap -= BASIC_ATTACK_AP; acted++;
    }
    session.activeAp = ap;
}

/** One companion action — a strike, an offensive cast, or a self-support move. */
function companionCast(
    session: TowerSession, floor: TowerFloor, actor: TowerActor, target: TowerActor, move: CompanionMove | null,
): void {
    if (move) actor.cooldowns = { ...(actor.cooldowns ?? {}), [move.name]: Math.max(1, move.cooldown) };
    const rounds = move?.rounds ?? 2;
    const kind = move?.kind ?? 'damage';
    const label = move ? ` uses ${move.name}` : ' strikes';

    // Pure-support kinds never damage; everything else lands its scaled hit first.
    switch (kind) {
        case 'heal': {
            const heal = Math.max(1, Math.floor(actor.maxHp * 0.25 + (move?.power ?? 0) * 0.5));
            actor.hp = Math.min(actor.maxHp, actor.hp + heal);
            session.log.push(`${actor.name}${label} and recovers ${heal} HP.`);
            return;
        }
        case 'shield': case 'barrier': {
            const amt = Math.max(1, Math.floor(actor.maxHp * 0.2));
            actor.shield = Math.max(0, Number(actor.shield ?? 0)) + amt;
            session.log.push(`${actor.name}${label} and raises a ${amt} HP shield.`);
            return;
        }
        case 'buff': case 'haste': {
            addTowerStatus(actor, { name: 'Increase Damage Given', rounds, percent: 25, kind: 'positive' } as never);
            session.log.push(`${actor.name}${label} and steels itself (+25% damage).`);
            return;
        }
        case 'absorb': {
            addTowerStatus(actor, { name: 'Absorb', rounds, percent: 30, kind: 'positive' } as never);
            session.log.push(`${actor.name}${label} and hardens.`);
            return;
        }
        case 'taunt': {
            addTowerStatus(actor, { name: 'Decrease Damage Taken', rounds, percent: 25, kind: 'positive' } as never);
            session.log.push(`${actor.name}${label} and braces (−25% damage taken).`);
            return;
        }
        case 'move': {
            const step = nextStepToward(session, actor.pos, target.pos, actor.id);
            if (step !== actor.pos && !isTileBlocked(session, step, actor.id)) actor.pos = step;
            session.log.push(`${actor.name}${label} and repositions.`);
            return;
        }
        default: break;
    }

    const dealt = companionDealDamage(session, actor, target, move);
    session.log.push(`${actor.name}${label} → ${target.name} for ${dealt}.`);
    switch (kind) {
        case 'stun': case 'freeze': case 'movelock':
            addTowerStatus(target, { name: 'Stun', rounds: 1, kind: 'negative' } as never); break;
        case 'wound':
            addTowerStatus(target, { name: 'Wound', rounds, amount: Math.max(1, Math.floor(dealt * 0.4)), kind: 'negative' } as never); break;
        case 'dot': case 'burn':
            addTowerStatus(target, { name: 'Poison', rounds, percent: 8, kind: 'negative' } as never);
            if (kind === 'burn') addTowerStatus(target, { name: 'Decrease Damage Given', rounds, percent: 15, kind: 'negative' } as never);
            break;
        case 'crush':
            addTowerStatus(target, { name: 'Decrease Damage Given', rounds, percent: 25, kind: 'negative' } as never); break;
        case 'confuse': case 'debuff': case 'slow':
            addTowerStatus(target, { name: 'Decrease Damage Given', rounds, percent: kind === 'confuse' ? 40 : 25, kind: 'negative' } as never); break;
        case 'mark':
            // The Arena's bespoke "Mark" is consumed by its own damage path; the
            // tower's equivalent is the shared incoming-damage amp.
            addTowerStatus(target, { name: 'Increase Damage Taken', rounds, percent: 20, kind: 'negative' } as never); break;
        case 'lifesteal':
            if (dealt > 0) actor.hp = Math.min(actor.maxHp, actor.hp + Math.max(1, Math.floor(dealt * 0.5)));
            break;
        case 'push':
            pushAwayFrom(session, target, actor.pos, 1); break;
        case 'pull': {
            const step = nextStepToward(session, target.pos, actor.pos, target.id);
            if (step !== target.pos && !isTileBlocked(session, step, target.id)) target.pos = step;
            break;
        }
        default: break;
    }
    // The pet can land the killing blow, so the phase ladder + win-check must run
    // here (it never passes through resolveHit's bookkeeping).
    tickBossPhases(session);
    checkTowerWinner(session, floor);
}

export function runAiUntilHuman(session: TowerSession, floor: TowerFloor, rng: () => number): void {
    if (session.turnQueue.length === 0) startRound(session);
    const GUARD = (MAX_ROUNDS + 2) * (session.actors.length + 2) * (MAX_ACTIONS + 2) + 256;
    let guard = 0;
    let stoppedAtHuman = false;
    while (session.status === 'active' && guard++ < GUARD) {
        const actor = activeActor(session);
        if (actor && actor.ai === false && actor.hp > 0) { stoppedAtHuman = true; break; } // a live human's turn — stop
        if (!actor || actor.hp <= 0 || actor.side === 'npc') { endTurn(session, floor); continue; }
        // A summoned pet runs its own PetJutsu turn, not the generic action AI.
        if (isCompanionActor(actor)) {
            runCompanionTurn(session, floor, actor, rng);
            if (session.status === 'active') endTurn(session, floor);
            continue;
        }
        let safety = 0;
        while (session.status === 'active' && safety++ <= MAX_ACTIONS) {
            const a = pickAiAction(session, actor, rng);
            if (a.type === 'wait') break;
            if (!applyAction(session, floor, a, rng).applied) break;
        }
        if (session.status === 'active') endTurn(session, floor);
    }
    // Still active but we did NOT stop at a live human → the guard tripped on a wedged queue.
    if (session.status === 'active' && !stoppedAtHuman) forceTimeoutResolve(session, floor);
}
