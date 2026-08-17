/*
 * Battle Towers — N-actor combat ENGINE (Phase 1, P1.A2).
 *
 * The generalization of api/pvp/move.ts from 2 fighters (p1/p2) to N actors across
 * sides. It owns: the turn scheduler, explicit-target action resolution, the faithful
 * (ported) deterministic damage formula, team/last-standing win-check, party scaling,
 * and a deterministic auto-run used for async resolution + the settle recompute.
 *
 * DETERMINISM (Decision 2): no Math.random / Date.now anywhere. Damage is a pure function of
 * stats (matching PvP, which has no damage RNG); companion obedience is salted from
 * authoritative turn identity so request-scoped play and uninterrupted recompute stay equal.
 *
 * CURRENT SCOPE: N-actor targeted/AOE combat, canonical PvP tags/resources/cooldowns,
 * tactical movement, fields/hazards/objects, waves, objective gates, boss phases/strikes,
 * companions, and party scaling. Interleaved boss-interrupt turns remain additive future
 * work; all rules here are Tower-session policy and leave shared PvP behavior untouched.
 */
import { hexDistance, filledDiskTiles } from '../pvp/_aoe.js';
import { applyJutsu as applyPvpJutsu, applyDoTs, tickStatuses, applyGroundEffectToFighter, tickGroundEffects, characterOwnsElement } from '../pvp/move.js';
import { resolveTowerPlayerJutsu, towerJutsuToCombatJutsu } from '../combat-adapters/clanBossAdapter.js';
import { TOWER_PVP_TOWER_ID } from './_pvp-session.js';
import { weatherMultiplier } from '../combat-core/formulas.js';
import { reduceNTargetCast, type NTargetCastHooks } from '../combat-core/cast-reducer.js';
import {
    actorId,
    controllerId,
    createCombatRules,
    normalizeAbilityTargetRule,
    planAbilityTargets,
    teamId,
    type ActorId,
    type CombatActorRef,
    type TargetPlan,
} from '../combat-core/n-actor.js';
import {
    COMPANION_ACTOR_ID, COMPANION_MAX_DAMAGE_FRAC, COMPANION_RANGE, companionActor, companionGearDamageMult,
    companionHealOnSummonPct, companionMoveDamage, companionObeys, companionOwnerLifestealPct,
    isCompanionActor, pickCompanionMove, type CompanionMove,
} from './_companion.js';
import { directDamageBaseFormula, JUTSU_MAX_LEVEL, jutsuLevelCapForLevel } from '../combat-core/formulas.js';
import { deleteSafeRecordValue, setSafeRecordValue } from '../_utils.js';
import { GROUND_EFFECT_TAGS, OPPONENT_AFFECTING_TAGS, STACKABLE_STATUS, canonicalTagName } from '../pvp/_tags.js';
import {
    pveAiCompetence,
    pveAiMasteryForLevel,
    pveEasyBandAllowsLethal,
    pveEasyBandHoldsBurst,
    pveGuardedEnemyHit,
    pveIsBurstJutsuAp,
} from '../_pve-difficulty.js';
import { pveMeaningfulBuffCount } from '../_pve-ai-tactics.js';
import { activeCombatStatuses } from '../combat-core/statuses.js';
import { adjustedApCost } from '../combat-core/resources.js';
import { MAX_COMBAT_VFX_TILES, canonicalJutsuTagNames, semanticJutsuVfx } from '../combat-core/jutsu-vfx.js';
import type { PvpFighter, PvpGroundEffect, PvpStatus } from '../pvp/session.js';
import type { EnemyTemplate } from './_enemy-templates.js';
import { partyScaleFactor, scaleEnemyStat, getFloorBalanceFor, type TowerFloor, type TowerTargetMode } from './_floor-catalog.js';
import {
    type TowerSession,
    type TowerActor,
    type TowerSide,
    type TowerVfxEvent,
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
    /** deterministic Tower-AI authoring hints; ignored by the shared resolver */
    aiPriority?: number;
    aiHpBelowPct?: number;
    aiHpAbovePct?: number;
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
const TOWER_BARRIER_SOURCE_PREFIX = 'tower-grid:';
/**
 * Barrier amounts emitted by the shared resolver are PvP-grid coordinates.  Only
 * statuses stamped by the Tower's own placement policy are board authority here.
 */
function towerBarrierTiles(session: TowerSession): Set<number> {
    const limit = session.map.width * session.map.height;
    const out = new Set<number>();
    for (const actor of session.actors) {
        for (const status of activeCombatStatuses(actor.statuses, session.round)) {
            const tile = status.amount;
            if (status.rounds <= 0 || canonicalTagName(status.name) !== 'Barrier'
                || !status.source?.startsWith(TOWER_BARRIER_SOURCE_PREFIX)
                || !Number.isInteger(tile) || tile! < 0 || tile! >= limit) continue;
            out.add(tile!);
        }
    }
    return out;
}
function tickDefeatedActorBarriers(actor: TowerActor, round: number): void {
    actor.statuses = actor.statuses.flatMap(status => {
        const towerBarrier = canonicalTagName(status.name) === 'Barrier'
            && status.source?.startsWith(TOWER_BARRIER_SOURCE_PREFIX);
        if (!towerBarrier || (status.activeRound !== undefined && status.activeRound > round)) return [status];
        const rounds = status.rounds - 1;
        return rounds > 0 ? [{ ...status, rounds }] : [];
    });
}
function isTileBlocked(session: TowerSession, tile: number, ignoreId?: string): boolean {
    if (session.map.blockedTiles.includes(tile)) return true;
    if (towerBarrierTiles(session).has(tile)) return true;
    return !!occupantAt(session, tile, ignoreId);
}

// One-step move toward `to`, avoiding blocked/occupied tiles. Deterministic (ties broken
// by lowest tile index). Returns `from` if no step gets closer.
// When the floor has NO static terrain (blockedTiles empty — every shipped story / spire /
// clan floor), this is the ORIGINAL greedy step, byte-for-byte, so those runs recompute
// identically. Only floors that scatter terrain fall through to the BFS path, which routes
// AROUND walls/dead-ends the single-step greedy would stall on (a stall would time the floor
// out and score it as a squad loss — an unfair, non-combat lockout).
export function nextStepToward(session: TowerSession, from: number, to: number, ignoreId?: string): number {
    const w = session.map.width;
    if (session.map.blockedTiles.length === 0 && towerBarrierTiles(session).size === 0) {
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
    // DELIBERATE cross-engine difference: the +10% home-village terrain buff is
    // a PvP-territory perk (sealed at pvp/session create from server-verified
    // clan ownership of the fight's sector). Tower-engine fights happen inside
    // instanced content (towers/spire/clan boss/missions/hollow gate) where no
    // one "owns" the ground, so the seal strips homeTerrainType here — do NOT
    // "fix" this to match PvP. Biome terrain + weather DO apply in both engines.
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
            if (a.hp <= 0 || !f.tiles.includes(a.pos) || objectiveBossDamageLocked(session, a)) continue;
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
/** Spawn the boss's reinforcements near it (summon mechanic).
 *
 * Players cannot suppress a phase by boxing the six adjacent hexes: the portal expands to the
 * nearest legal ring, and a completely saturated arena keeps the sealed actors in a pending wave
 * instead of deleting them. Summoned actors retain the authored template's complete role/jutsu/
 * focus/resources/armor contract; a phase add is the same combatant as a catalog pod add. */
function summonAdds(session: TowerSession): void {
    const id = session.phaseState.bossId;
    const boss = id ? getActor(session, id) : undefined;
    if (!boss) return;
    const tpl = boss.character.summonTemplate as EnemyTemplate | undefined;
    if (!tpl) return;
    const count = Math.max(1, Number(boss.character.summonCount ?? 2));
    const w = session.map.width, h = session.map.height;
    const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
    const forbidden = new Set([...session.map.blockedTiles, ...towerBarrierTiles(session)]);
    for (const tile of session.map.objectiveTiles) forbidden.add(tile);
    for (const feature of session.map.features ?? []) for (const tile of feature.tiles) forbidden.add(tile);
    for (const object of session.map.boardObjects ?? []) for (const tile of object.tiles ?? []) forbidden.add(tile);
    for (const hazard of session.map.dynamicHazards ?? []) for (const tile of hazard.tiles) forbidden.add(tile);
    const scale = Math.max(0, Number(boss.character.towerDmgScale ?? 1)); // adds inherit the boss's party scaling
    const allActorIds = [
        ...session.actors.map(a => a.id),
        ...(session.pendingEnemyWaves ?? []).flatMap(wave => wave.actors.map(a => a.id)),
    ];
    let n = allActorIds.reduce((highest, actorIdValue) => {
        const match = /^add-(\d+)$/.exec(actorIdValue);
        return match ? Math.max(highest, Number(match[1]) + 1) : highest;
    }, 0);
    const immediate = towerNeighbors(boss.pos, w, h);
    const immediateSet = new Set(immediate);
    const expanded = Array.from({ length: w * h }, (_, tile) => tile)
        .filter(tile => !immediateSet.has(tile))
        .sort((a, b) => hexDistance(a, boss.pos, w) - hexDistance(b, boss.pos, w) || a - b);
    const candidates = [...immediate, ...expanded];
    const makeAdd = (id: string, pos: number): TowerActor => {
        const hp = Math.max(1, Math.round(Number(tpl.hp ?? 300) * (scale < 1 ? scale : 1)));
        const maxChakra = Math.max(1, Math.floor(Number(tpl.maxChakra ?? 100)));
        const maxStamina = Math.max(1, Math.floor(Number(tpl.maxStamina ?? 100)));
        return {
            id, side: 'enemy', name: tpl.name ?? 'Add', ownerSlug: null, ai: true,
            hp, maxHp: hp, chakra: maxChakra, maxChakra, stamina: maxStamina, maxStamina,
            shield: 0, statuses: [], cooldowns: {}, pos,
            character: {
                level: Math.max(1, Math.floor(Number(tpl.level ?? 40))),
                specialty: tpl.specialty ?? 'Taijutsu',
                stats: { ...(tpl.stats ?? {}) },
                visual: tpl.visual ?? 'bandit',
                ...(tpl.role ? { combatRole: tpl.role } : {}),
                ...(tpl.targetMode ? { aiTargetMode: tpl.targetMode } : {}),
                ...(tpl.armorRawDR != null ? { armorRawDR: tpl.armorRawDR } : {}),
                ...(tpl.jutsu ? { jutsu: tpl.jutsu.map(jutsu => structuredClone(jutsu)) } : {}),
                ...(scale < 1 ? { towerDmgScale: scale } : {}),
            },
        };
    };
    let added = 0;
    const deferred: TowerActor[] = [];
    for (let summonIndex = 0; summonIndex < count; summonIndex++) {
        const idValue = `add-${n++}`;
        const tile = candidates.find(candidate => !occupied.has(candidate) && !forbidden.has(candidate));
        if (tile === undefined) {
            deferred.push(makeAdd(idValue, boss.pos));
            continue;
        }
        session.actors.push(makeAdd(idValue, tile));
        occupied.add(tile);
        added++;
    }
    if (deferred.length > 0) {
        const dueRound = session.round + 1;
        const existing = (session.pendingEnemyWaves ?? []).find(wave => wave.round === dueRound);
        if (existing) existing.actors.push(...deferred);
        else session.pendingEnemyWaves = [
            ...(session.pendingEnemyWaves ?? []),
            { round: dueRound, actors: deferred },
        ].sort((a, b) => a.round - b.round);
    }
    const called = added + deferred.length;
    if (called > 0) session.log.push(`${boss.name} summons ${called} reinforcement${called !== 1 ? 's' : ''}!`);
    if (deferred.length > 0) session.log.push(`${deferred.length} reinforcement${deferred.length !== 1 ? 's' : ''} await a clear portal.`);
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
    const barrierTiles = towerBarrierTiles(session);
    const reserved = new Set<number>();
    for (const t of session.map.objectiveTiles) { reserved.add(t); for (const nb of towerNeighbors(t, w, h)) reserved.add(nb); }
    for (const f of session.map.features ?? []) for (const t of f.tiles) reserved.add(t);
    // never bury a board object (a shrine/font must stay reachable + visible)
    for (const o of session.map.boardObjects ?? []) for (const t of o.tiles ?? []) reserved.add(t);
    // Never bury a recurring vent. A pillar on a geyser tile makes the telegraph point
    // at impassable ground and silently removes authored arena pressure for the rest of
    // the fight. Initial terrain already reserves vents by placement order; phase terrain
    // must maintain the same no-overlap contract after the arena starts reshaping.
    for (const hazard of session.map.dynamicHazards ?? []) for (const t of hazard.tiles) reserved.add(t);
    // Preserve an already-promised strike footprint for the rest of this round. The
    // telegraph is a server guarantee, so a phase transition must not replace marked
    // blast tiles with impassable pillars before the detonation resolves.
    for (const t of session.bossStrike?.tiles ?? []) reserved.add(t);
    // A temporary Barrier is still authoritative impassable terrain for this phase.
    // Never overwrite it with a permanent pillar or grow a touching wall beside it.
    for (const t of barrierTiles) reserved.add(t);
    const living = session.actors.filter(a => a.hp > 0);
    const occupied = new Set(living.map(a => a.pos));
    const freeNeighbors = (pos: number, minus: number) =>
        towerNeighbors(pos, w, h).filter(t => t !== minus && !blocked.has(t) && !barrierTiles.has(t) && !occupied.has(t)).length;
    let s = (((session.seed >>> 0) ^ 0x27d4eb2f ^ Math.imul(session.phaseState.triggeredPhases.length, 0x9e3779b9)) >>> 0) || 1;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
    let added = 0;
    for (let attempt = 0; attempt < 200 && added < want && blocked.size < maxBlocked; attempt++) {
        const cx = 1 + Math.floor(rnd() * Math.max(1, w - 2));
        const cy = 1 + Math.floor(rnd() * Math.max(1, h - 2));
        const t = cy * w + cx;
        if (blocked.has(t) || occupied.has(t) || reserved.has(t)) continue;
        if (towerNeighbors(t, w, h).some(nb => blocked.has(nb) || barrierTiles.has(nb))) continue; // non-adjacency invariant
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
            if (a.hp <= 0 || !tiles.has(a.pos) || objectiveBossDamageLocked(session, a)) continue;
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
    return session.actors.filter(a =>
        a.hp > 0 && sides.includes(a.side)
        && !(actor.side === 'squad' && objectiveBossDamageLocked(session, a)));
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
    // TOWER grid by applyDisplacement; Barrier is replaced by placeTowerBarrier below.
}
// ─── Standard-PvE difficulty guard (api/_pve-difficulty.ts) ──────────────────
// Only sessions that sealed `pveGuard` run this; every other mode is untouched.
// The state mirrors Arena.tsx's enemyTurnStartHpRef / enemyTurnDealtRef.

/** Snapshot squad HP and clear the damage tally — called at the start of an
 *  ENEMY actor's turn, the unit the per-turn cap and mercy floor are scoped to. */
function resetPveGuardTurn(session: TowerSession): void {
    const guard = session.pveGuard;
    if (!guard) return;
    guard.turnStartHp = {};
    guard.dealtThisTurn = {};
    for (const a of session.actors) {
        if (a.side !== 'squad') continue;
        guard.turnStartHp[a.id] = a.hp;
        guard.dealtThisTurn[a.id] = 0;
    }
}

/** The ceiling for one enemy→squad cast, or undefined when the guard does not
 *  apply (no seal, squad attacker, self-cast, or a non-squad target). */
function pveHitCapFor(session: TowerSession, actor: TowerActor, target: TowerActor, selfCast: boolean): number | undefined {
    const guard = session.pveGuard;
    if (!guard || selfCast) return undefined;
    if (actor.side !== 'enemy' || target.side !== 'squad') return undefined;
    const capped = pveGuardedEnemyHit(Number.MAX_SAFE_INTEGER, {
        enemyLevel: guard.enemyLevel,
        playerMaxHp: target.maxHp,
        playerHpTurnStart: guard.turnStartHp[target.id] ?? target.hp,
        dealtThisTurn: guard.dealtThisTurn[target.id] ?? 0,
    });
    // The peer band is uncapped by design — pveGuardedEnemyHit hands back the
    // raw input there, so treat a saturated result as "no ceiling" and skip the
    // cap entirely rather than clamping at MAX_SAFE_INTEGER.
    return capped >= Number.MAX_SAFE_INTEGER ? undefined : capped;
}

/** Add applied damage to the current enemy turn's tally for `target`. */
function notePveGuardDamage(session: TowerSession, target: TowerActor, dealt: number): void {
    const guard = session.pveGuard;
    if (!guard || target.side !== 'squad' || !(dealt > 0)) return;
    guard.dealtThisTurn[target.id] = (guard.dealtThisTurn[target.id] ?? 0) + Math.max(0, Math.floor(dealt));
}

function jutsuHasTag(jutsu: JutsuLike, name: string): boolean {
    return Array.isArray(jutsu.tags) && (jutsu.tags as Array<{ name?: unknown }>)
        .some(tag => canonicalTagName(String(tag?.name ?? '')) === name);
}
function towerJutsuAffectsOpponent(jutsu: JutsuLike): boolean {
    return Number(jutsu.effectPower ?? 0) > 0
        || (Array.isArray(jutsu.tags) && (jutsu.tags as Array<{ name?: unknown }>)
            .some(tag => OPPONENT_AFFECTING_TAGS.has(canonicalTagName(String(tag?.name ?? '')))));
}
/**
 * Mirrors canonical PvP targeting for legacy utility records: non-positional
 * zero-damage techniques with no opponent-affecting tag resolve on the caster
 * even when an old record says OPPONENT or omits target entirely.
 */
function towerJutsuTargetsSelf(jutsu: JutsuLike): boolean {
    return !jutsuHasTag(jutsu, 'Move')
        && String(jutsu.target ?? '') !== 'EMPTY_GROUND'
        && (String(jutsu.target ?? '') === 'SELF' || !towerJutsuAffectsOpponent(jutsu));
}
function towerResolverLines(lines: readonly string[], jutsu: JutsuLike): string[] {
    // A shared Barrier line contains a PvP-grid coordinate. The Tower emits its
    // authoritative coordinate after its own deterministic placement below.
    return jutsuHasTag(jutsu, 'Barrier') ? lines.filter(line => !line.startsWith('Barrier:')) : [...lines];
}
function placeTowerBarrier(session: TowerSession, caster: TowerActor, target: TowerActor, jutsu: JutsuLike): void {
    if (!jutsuHasTag(jutsu, 'Barrier')) return;

    // Never retain the shared PvP tile. Recasting also replaces the caster's old
    // wall, matching Barrier's non-stackable canonical status contract.
    caster.statuses = caster.statuses.filter(status => canonicalTagName(status.name) !== 'Barrier');
    const anchor = target.id === caster.id ? nearestOpponent(session, caster) : target;
    const w = session.map.width, h = session.map.height;
    const candidates = towerNeighbors(caster.pos, w, h)
        .filter(tile => tile !== caster.pos && !isTileBlocked(session, tile, caster.id))
        .sort((a, b) => {
            const ad = anchor ? hexDistance(a, anchor.pos, w) : 0;
            const bd = anchor ? hexDistance(b, anchor.pos, w) : 0;
            return (ad - bd) || (a - b);
        });
    const tile = candidates[0];
    if (tile === undefined) {
        session.log.push('Barrier: no room to place a Tower wall.');
        return;
    }
    addTowerStatus(caster, {
        name: 'Barrier',
        source: `${TOWER_BARRIER_SOURCE_PREFIX}${String(jutsu.id ?? jutsu.name ?? 'barrier')}`,
        rounds: 2,
        amount: tile,
        kind: 'positive',
    });
    session.log.push(`Barrier: ${caster.name} blocks Tower hex ${tile} for 2 turns.`);
}

/** Resolve one jutsu/weapon/attack from `actor` onto `target` (target===actor for a
 *  self-cast buff/heal) through the PvP resolver, with the tower env multiplier folded in. */
function runJutsu(session: TowerSession, actor: TowerActor, target: TowerActor, jutsu: JutsuLike, wMult: number): void {
    const selfCast = actor.id === target.id;
    // Defense in depth for every Tower-only cast path. applyAction rejects an explicit
    // locked-boss intent before spending anything; splash/companions also filter it.
    if (!selfCast && actor.side === 'squad' && rejectObjectiveLockedBoss(session, actor, target)) return;
    // Reflect/Recoil can mutate the caster through the shared resolver. A gated boss is
    // protected from those indirect HP losses too while its reinforcements remain.
    const protectedCasterHp = objectiveBossDamageLocked(session, actor) ? actor.hp : undefined;
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
    // Standard-PvE hit guard: a sealed pveGuard caps what an ENEMY cast may deal
    // to a squad member (per-hit / per-turn / easy-band mercy). Passed as a
    // damageCap so the clamp lands PRE-shield — where the client applies it —
    // rather than on the post-shield HP delta. Absent for every mode that did
    // not seal a guard, and never applied to the squad's own casts.
    const cap = pveHitCapFor(session, actor, target, selfCast);
    const res = resolveTowerPlayerJutsu({
        session,
        actor,
        target: selfCast ? actor : target,
        jutsu: jutsu as Parameters<typeof applyPvpJutsu>[2],
        wMult,
        resolver: applyPvpJutsu,
        damageCap: cap,
    });
    writeBackFighter(actor, res.self);
    if (!selfCast) writeBackFighter(target, res.opponent);
    if (protectedCasterHp !== undefined && actor.hp < protectedCasterHp) actor.hp = protectedCasterHp;
    // Meter the per-turn budget with the damage the resolver actually applied
    // (post-cap). An HP delta would be post-shield and would let a shielded
    // player absorb far more than the band intends across a chained turn.
    if (cap !== undefined) notePveGuardDamage(session, target, res.metadata?.damage ?? 0);
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
    session.log.push(...towerResolverLines(res.lines, jutsu));
    placeTowerBarrier(session, actor, target, jutsu);
}
// Area radius for an AOE / ground / displacement jutsu (0 = single-target). Bloodline/
// creator and authored Tower jutsu carry these methods. Ground-target
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
// Tags that mutate/setup the caster are CAST-scoped. Everything else stays on the
// per-defender hit path (including Pierce, Wound, Siphon and every hostile status).
const TOWER_CAST_SCOPED_TAGS = new Set([
    'Heal', 'Shield', 'Barrier', 'Absorb', 'Reflect', 'Lifesteal',
    'Increase Damage Given', 'Decrease Damage Taken', 'Debuff Prevent',
    'Clear Prevent', 'Stun Prevent', 'Copy', 'Overclock', 'Increase Heal',
    'Increase Generals', 'Increase Discipline',
]);
// Only BARRIER zeroes a cast. Heal/Shield are payloads that ride on top of a
// damaging cast (owner ruling 2026-08-16) — this set is the towers-side twin of
// resolveTagStatuses in api/pvp/move.ts and MUST track it, or an AOE damage jutsu
// that also heals would land for full in PvP and for nothing in a tower.
// The 40-AP utility split is unaffected: a utility cast already carries scaledEp 0.
const TOWER_ZERO_DAMAGE_CAST_TAGS = new Set(['Barrier']);

function splitAoeJutsu(jutsu: JutsuLike): {
    setup: JutsuLike;
    perHit: JutsuLike;
    setupTags: unknown[];
    suppressDamage: boolean;
} {
    const tags = Array.isArray(jutsu.tags) ? jutsu.tags : [];
    const setupTags = tags.filter(tag => TOWER_CAST_SCOPED_TAGS.has(canonicalTagName(String((tag as { name?: unknown })?.name ?? ''))));
    const hitTags = tags.filter(tag => !TOWER_CAST_SCOPED_TAGS.has(canonicalTagName(String((tag as { name?: unknown })?.name ?? ''))));
    // Barrier zeroes unconditionally, exactly as in move.ts — it is board control,
    // and weapons cannot carry it at all (stripped by sanitizePvpItems at the seal).
    const suppressDamage = tags.some(
        tag => TOWER_ZERO_DAMAGE_CAST_TAGS.has(canonicalTagName(String((tag as { name?: unknown })?.name ?? ''))),
    );
    return {
        setup: { ...jutsu, tags: setupTags },
        perHit: { ...jutsu, tags: hitTags },
        setupTags,
        suppressDamage,
    };
}

function resolveAoeFighters(
    session: TowerSession,
    self: PvpFighter,
    opponent: PvpFighter,
    jutsu: JutsuLike,
    wMult: number,
    damageCap?: number,
): ReturnType<typeof applyPvpJutsu> {
    const normalized = towerJutsuToCombatJutsu(
        jutsu as Parameters<typeof towerJutsuToCombatJutsu>[0],
    ) as Parameters<typeof applyPvpJutsu>[2];
    return applyPvpJutsu(
        self,
        opponent,
        normalized,
        wMult,
        String(session.map.biome ?? 'central'),
        session.round,
        damageCap,
    );
}

function towerControllerId(actor: TowerActor) {
    return controllerId(actor.ownerSlug ? `player:${actor.ownerSlug}` : `server:${actor.id}`);
}

/** Server-derived identity/order facts; array insertion order is never gameplay authority. */
function towerCombatRoster(session: TowerSession): CombatActorRef[] {
    const order = new Map(
        [...session.actors].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
            .map((entry, index) => [entry.id, index] as const),
    );
    return session.actors.map(entry => ({
        actorId: actorId(entry.id),
        teamId: teamId(entry.side),
        controllerId: towerControllerId(entry),
        rosterOrder: order.get(entry.id)!,
        state: entry.hp > 0 ? 'active' : 'defeated',
    }));
}

type TowerAoeCastState = Readonly<{
    fighters: Readonly<Record<string, PvpFighter>>;
}>;
type TowerAoeMutation = Readonly<{ actorId: ActorId; fighter: PvpFighter }>;
type TowerAoeEvent = Readonly<{ lines: readonly string[] }>;
type TowerAoeHitOutput = Readonly<{
    lines: readonly string[];
    damage: number;
}>;

/**
 * Resolve a committed Tower AOE through the generic N-actor planner/reducer.
 * Tower policy is explicitly atomic: defender reactions may defeat the caster,
 * but every target in the committed cast still resolves in canonical order.
 */
function runAoeJutsu(
    session: TowerSession,
    actor: TowerActor,
    primary: TowerActor,
    jutsu: JutsuLike,
    wMult: number,
    radius: number,
    protectedBossId?: string,
): string[] {
    const actorById = new Map(session.actors.map(entry => [entry.id, entry] as const));
    const roster = towerCombatRoster(session);
    const area = new Set(filledDiskTiles(primary.pos, radius, session.map.width, session.map.height));
    const footprint = session.actors
        .filter(entry => entry.hp > 0 && area.has(entry.pos) && hostileSidesFor(actor.side).includes(entry.side))
        .map(entry => actorId(entry.id));
    const rules = createCombatRules({
        continueCastAfterCasterDefeat: true,
        targetDefeatedDuringCast: 'skip',
        relationBetweenTeams: () => 'enemy',
        canTargetActor: ({ caster, target }) => {
            const source = actorById.get(caster.actorId);
            const victim = actorById.get(target.actorId);
            return !!source && !!victim
                && hostileSidesFor(source.side).includes(victim.side)
                && target.actorId !== protectedBossId;
        },
    });
    const planned = planAbilityTargets({
        intent: {
            type: 'ability',
            actorId: actorId(actor.id),
            controllerId: towerControllerId(actor),
            abilityId: String(jutsu.id ?? 'tower-aoe'),
            target: { kind: 'actor', actorId: actorId(primary.id) },
        },
        rule: normalizeAbilityTargetRule({
            kind: 'actor', relations: ['enemy'], minTargets: 1,
            maxTargets: 'all', primary: 'required',
        }),
        roster,
        expandedActorIds: footprint,
        rules,
    });
    if (!planned.accepted || planned.plan.kind !== 'actors') {
        throw new Error(`Tower AOE target planning failed: ${planned.accepted ? 'non-actor-plan' : planned.rejection}`);
    }
    const plan: TargetPlan = planned.plan;
    const split = splitAoeJutsu(jutsu);
    const primaryCap = pveHitCapFor(session, actor, primary, false);
    // Reference receipt preserves the exact existing primary-hit log ordering.
    const primaryReference = resolveAoeFighters(
        session, actorToFighter(actor), actorToFighter(primary), jutsu, wMult, primaryCap,
    );
    const initialHp = actor.hp;
    const protectedCasterHp = objectiveBossDamageLocked(session, actor) ? actor.hp : undefined;
    const initial: TowerAoeCastState = {
        fighters: Object.fromEntries(session.actors.map(entry => [entry.id, actorToFighter(entry)])),
    };
    const hooks: NTargetCastHooks<TowerAoeCastState, TowerAoeMutation, TowerAoeEvent, TowerAoeHitOutput> = {
        applyMutation: (state, mutation) => ({
            fighters: { ...state.fighters, [mutation.actorId]: mutation.fighter },
        }),
        beginCast: ({ state }) => {
            if (split.setupTags.length === 0) return {};
            const setupResult = resolveAoeFighters(
                session,
                state.fighters[actor.id]!,
                state.fighters[primary.id]!,
                split.setup,
                wMult,
                0,
            );
            return {
                mutations: [{ actorId: actorId(actor.id), fighter: setupResult.self }],
                events: setupResult.lines.length ? [{ lines: setupResult.lines }] : [],
            };
        },
        resolveHit: ({ state, target }) => {
            const victim = actorById.get(target.actorId)!;
            const cap = split.suppressDamage ? 0 : pveHitCapFor(session, actor, victim, false);
            const resolved = resolveAoeFighters(
                session,
                state.fighters[actor.id]!,
                state.fighters[target.actorId]!,
                split.perHit,
                wMult,
                cap,
            );
            return {
                mutations: [
                    { actorId: actorId(actor.id), fighter: resolved.self },
                    { actorId: target.actorId, fighter: resolved.opponent },
                ],
                events: resolved.lines.length ? [{ lines: resolved.lines }] : [],
                output: { lines: resolved.lines, damage: resolved.metadata.damage },
            };
        },
        isActorDefeated: (state, id) => (state.fighters[id]?.hp ?? 0) <= 0,
    };
    const reduced = reduceNTargetCast({ state: initial, plan, hooks, rules });

    writeBackFighter(actor, reduced.state.fighters[actor.id]!);
    if (protectedCasterHp !== undefined && actor.hp < protectedCasterHp) actor.hp = protectedCasterHp;
    if (actor.side === 'squad') {
        const cut = healcutPct(session);
        const gained = actor.hp - initialHp;
        if (cut > 0 && gained > 0) {
            const removed = gained - Math.floor(gained * (1 - cut / 100));
            actor.hp = Math.max(0, actor.hp - removed);
        }
    }
    for (const target of plan.targets) {
        const victim = actorById.get(target.actorId)!;
        writeBackFighter(victim, reduced.state.fighters[target.actorId]!);
    }
    for (const hit of reduced.resolvedHits) {
        const victim = actorById.get(hit.targetId)!;
        if (session.pveGuard) notePveGuardDamage(session, victim, hit.output?.damage ?? 0);
    }

    // Keep the primary receipt byte-identical to the old two-actor path. Secondary
    // receipts are additive because their reactions now mutate the caster correctly.
    session.log.push(...towerResolverLines(primaryReference.lines, jutsu));
    const secondary = reduced.resolvedHits.filter(hit => hit.targetId !== primary.id);
    for (const hit of secondary) session.log.push(...(hit.output?.lines ?? []));
    placeTowerBarrier(session, actor, primary, jutsu);
    return secondary.map(hit => actorById.get(hit.targetId)!.name);
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
function groundZoneTiles(center: number, w: number, h: number, method?: string): number[] {
    return String(method ?? 'SINGLE') === 'AOE_SPIRAL'
        ? filledDiskTiles(center, 2, w, h)
        : [center, ...towerNeighbors(center, w, h)];
}
/** Living actors a zone affects — the HOSTILES of the side that cast it (squad→'p1'). */
function groundZoneTargets(session: TowerSession, effect: PvpGroundEffect): TowerActor[] {
    const victimSides: TowerSide[] = effect.owner === 'p1' ? ['enemy'] : ['squad', 'npc'];
    return session.actors.filter(a =>
        a.hp > 0 && victimSides.includes(a.side)
        && !(effect.owner === 'p1' && objectiveBossDamageLocked(session, a)));
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
        tiles: groundZoneTiles(tile, session.map.width, session.map.height, jutsu.method),
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

/**
 * A genuine AI combatant — engine-driven AND unowned. The `ai` flag alone is not
 * enough: an AFK human is flagged `ai` but keeps its ownerSlug, and tower PvP
 * seats a live human team on side 'enemy'. Requiring ownerSlug === null means a
 * PvE-only bonus can never apply in a fight where a human is on the other end.
 */
function isAiCombatant(actor: TowerActor): boolean {
    return actor.ai === true && actor.ownerSlug == null;
}

/** PvE-only relic multipliers, sealed by hydrateCharacterFromSave (already clamped). */
function pveRelicDealtMult(actor: TowerActor): number {
    return 1 + Math.max(0, Number(actor.character?.pveDamagePct) || 0) / 100;
}
function pveRelicTakenMult(target: TowerActor): number {
    return Math.max(0.25, 1 - Math.max(0, Number(target.character?.pveDamageTakenPct) || 0) / 100);
}

function resolveHit(
    session: TowerSession, floor: TowerFloor, actor: TowerActor, target: TowerActor,
    jutsu: JutsuLike, cost: number, deferWinnerCheck = false,
): void {
    const selfCast = actor.id === target.id;
    // Snapshot before tags resolve: an Overclock cast cannot discount itself, and
    // clearing Lag cannot retroactively erase this action's surcharge.
    const committedApCost = towerAdjustedApCost(session, actor, cost);
    const protectedBossId = !selfCast && actor.side === 'squad' && isAddsGateObjective(session)
        && objectiveAddsRemaining(session) > 0 ? session.phaseState.bossId : undefined;
    // Endless Spire: enemy attackers hit harder by the sealed ascension dmgMult (the tier's
    // outgoing-damage spine). Story runs leave session.dmgMult unset → ×1, unchanged.
    const ascensionDmgMult = actor.side === 'enemy' ? Math.max(1, Number(session.dmgMult ?? 1)) : 1;
    // Endless Spire vulnerability: a squad target takes MORE damage per the sealed 'debuff'
    // keystones. Orthogonal to ascensionDmgMult (which scales the ENEMY attacker's output);
    // this scales what a SQUAD DEFENDER receives, and is capped inside debuffTakenMult so the
    // combined enrage × dmgMult × debuff product stays under the one-shot ceiling. ×1 for story.
    const incomingDebuffMult = (!selfCast && target.side === 'squad') ? debuffTakenMult(session, target) : 1;
    // PvE-only relic power. Gated on the COUNTERPARTY being a genuine AI, never on
    // `side` — tower PvP seats the opposing HUMAN team on side 'enemy'
    // (api/towers/_pvp-session.ts), so a side-based gate would hand one human team
    // a damage bonus against another. isAiCombatant fails closed: an AFK-driven
    // human still carries an ownerSlug, so no human-vs-human fight ever qualifies.
    // Two independent gates, because one alone is not enough:
    //   • session-level — a human-vs-human tower match never grants PvE power at
    //     all. The per-target check below reads the PRIMARY target, so an AOE
    //     aimed at an NPC could otherwise splash a human with the bonus attached.
    //   • per-target — inside a PvE session, the counterparty must still be a real
    //     AI, so an async/AFK human ally or opponent never feeds it.
    const pveSession = session.towerId !== TOWER_PVP_TOWER_ID;
    const relicDealtMult = (pveSession && !selfCast && isAiCombatant(target)) ? pveRelicDealtMult(actor) : 1;
    const relicTakenMult = (pveSession && !selfCast && isAiCombatant(actor)) ? pveRelicTakenMult(target) : 1;
    const wMult = selfCast ? 1 : (
        pylonAttackMult(session, actor, jutsu) * wardDefendMult(session, target)
        * attackerEnrageMult(session, actor) * bulwarkMult(session, target)
        * shrineAttackMult(session, actor)
        * Math.max(0, Number(actor.character.towerDmgScale ?? 1))
        * ascensionDmgMult * incomingDebuffMult
        * relicDealtMult * relicTakenMult
        * weatherMult(session, jutsu)
    );
    const verb = jutsu.id === 'basic-attack' ? 'attacks'
        : jutsu.id === 'weapon' ? `strikes with ${jutsu.name ?? 'a weapon'}`
        : `uses ${jutsu.name ?? 'a jutsu'}`;
    session.log.push(selfCast ? `${actor.name} ${verb}.` : `${actor.name} ${verb} → ${target.name}.`);
    // Multi-target casts resolve through the canonical planner/reducer below.
    // AOE / ground / Move jutsu also strike the other hostiles in the blast radius.
    const radius = selfCast ? 0 : jutsuAreaRadius(jutsu);
    if (radius > 0) {
        const caught = runAoeJutsu(session, actor, target, jutsu, wMult, radius, protectedBossId);
        if (caught.length) session.log.push(`The blast also catches ${caught.join(', ')}.`);
    } else runJutsu(session, actor, target, jutsu, wMult);
    // Push/Pull displacement resolves AFTER the hit + splash (so the blast still centred on the
    // struck tile) — moves the primary target on the tower grid to parity with PvP.
    if (!selfCast) applyDisplacement(session, actor, target, jutsu);
    session.activeAp = Math.max(0, session.activeAp - committedApCost);
    session.actionsThisTurn += 1;
    tickBossPhases(session);
    if (!deferWinnerCheck) checkTowerWinner(session, floor);
}
// Round-end: tick Wound/Poison/Drain DoTs and expire statuses for every living actor,
// reusing the EXACT PvP helpers so timing/mitigation match the live game.
function applyRoundStatusTicks(session: TowerSession): void {
    const roundPlates: TowerVfxEvent[] = [];
    for (const a of session.actors) {
        if (a.hp <= 0) {
            // N-actor policy: a defeated caster's wall survives for the remaining
            // cast duration, but defeated actors otherwise keep their frozen receipt.
            tickDefeatedActorBarriers(a, session.round);
            continue;
        }
        if (objectiveBossDamageLocked(session, a)) {
            // Let status durations advance, but do not let a pre-lock DoT bypass the barrier.
            a.statuses = tickStatuses(actorToFighter(a), session.round).statuses;
            continue;
        }
        const hpBefore = a.hp;
        const dot = applyDoTs(actorToFighter(a), session.round);
        a.hp = Math.max(0, Math.min(a.maxHp, Math.floor(dot.fighter.hp)));
        // A bleed must not slip a squad member under the easy-band mercy floor,
        // and it spends the same per-turn budget (the client counts the player's
        // DoT tick in endEnemyTurn, Arena.tsx:4964). Round end follows the enemy
        // turn, so the tally in flight is the right one to charge.
        if (session.pveGuard && a.side === 'squad') {
            const dealt = hpBefore - a.hp;
            if (dealt > 0) {
                const allowed = pveGuardedEnemyHit(dealt, {
                    enemyLevel: session.pveGuard.enemyLevel,
                    playerMaxHp: a.maxHp,
                    playerHpTurnStart: session.pveGuard.turnStartHp[a.id] ?? hpBefore,
                    dealtThisTurn: session.pveGuard.dealtThisTurn[a.id] ?? 0,
                });
                if (allowed < dealt) a.hp = Math.max(0, Math.min(a.maxHp, hpBefore - allowed));
                notePveGuardDamage(session, a, allowed);
            }
        }
        a.chakra = Math.max(0, Math.floor(dot.fighter.chakra));
        if (dot.lines.length) session.log.push(...dot.lines);
        // The shared PvP helper already authored this tick's plates; they were
        // being dropped on the floor here. A DoT only ever ticks the fighter it
        // belongs to, so `self` resolves to this actor and `opp` cannot occur.
        for (const plate of dot.vfx) {
            if (plate.who !== 'self') continue;
            roundPlates.push({
                key: String(plate.key),
                target: a.id,
                anchor: plate.anchor,
                ...(plate.persistent ? { persistent: true } : {}),
            });
        }
        a.statuses = tickStatuses(actorToFighter(a), session.round).statuses;
    }
    publishTowerVfx(session, roundPlates);
}

// ─── Turn scheduler (side-based rounds; interleaved boss-interrupt is Phase 3) ─
function rebuildTurnQueue(session: TowerSession): void {
    const byId = (a: TowerActor, b: TowerActor) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const squad = livingOnSide(session, 'squad').sort(byId).map(a => a.id);
    const enemy = livingOnSide(session, 'enemy').sort(byId).map(a => a.id);
    session.turnQueue = [...squad, ...enemy]; // npc actors are passive in v1 (protect targets)
}

function reinforcementForbiddenTiles(session: TowerSession): Set<number> {
    const out = new Set<number>(session.map.blockedTiles);
    for (const tile of towerBarrierTiles(session)) out.add(tile);
    for (const a of session.actors) if (a.hp > 0) out.add(a.pos);
    for (const t of session.map.objectiveTiles) out.add(t);
    for (const feature of session.map.features ?? []) for (const t of feature.tiles) out.add(t);
    for (const object of session.map.boardObjects ?? []) for (const t of object.tiles ?? []) out.add(t);
    for (const hazard of session.map.dynamicHazards ?? []) for (const t of hazard.tiles) out.add(t);
    return out;
}

/** Pick a deterministic legal entry tile on the enemy half of the board. */
function reinforcementEntryTile(session: TowerSession, preferred: number, forbidden: Set<number>): number | undefined {
    const { width, height } = session.map;
    const mid = Math.floor(width / 2);
    const legal = (tile: number) => tile >= 0 && tile < width * height && (tile % width) >= mid && !forbidden.has(tile);
    if (legal(preferred)) return preferred;
    let best: number | undefined;
    let bestDistance = Infinity;
    for (let tile = 0; tile < width * height; tile++) {
        if (!legal(tile)) continue;
        const distance = hexDistance(preferred, tile, width);
        if (distance < bestDistance || (distance === bestDistance && (best === undefined || tile < best))) {
            best = tile;
            bestDistance = distance;
        }
    }
    return best;
}

/** Deploy all sealed waves due this round before the queue is constructed. */
function deployPendingEnemyWaves(session: TowerSession): void {
    const waves = session.pendingEnemyWaves;
    if (!waves?.length) return;
    const due = waves.filter(wave => wave.round <= session.round).sort((a, b) => a.round - b.round);
    if (!due.length) return;
    const forbidden = reinforcementForbiddenTiles(session);
    let deployed = 0;
    const retained: typeof waves = [];
    for (const wave of due) {
        const waiting: typeof wave.actors = [];
        for (const sealed of wave.actors) {
            const tile = reinforcementEntryTile(session, sealed.pos, forbidden);
            if (tile === undefined) {
                // Fail closed: a saturated/hostile board cannot erase an authored wave and
                // unlock an adds-gated objective. Retry from the sealed preferred tile next round.
                waiting.push(sealed);
                continue;
            }
            const actor = structuredClone(sealed);
            actor.pos = tile;
            session.actors.push(actor);
            forbidden.add(tile);
            deployed++;
        }
        if (waiting.length > 0) retained.push({ round: wave.round, actors: waiting });
    }
    session.pendingEnemyWaves = [
        ...retained,
        ...waves.filter(wave => wave.round > session.round),
    ].sort((a, b) => a.round - b.round);
    if (session.pendingEnemyWaves.length === 0) delete session.pendingEnemyWaves;
    if (deployed > 0) session.log.push(`${deployed} reinforcement${deployed === 1 ? '' : 's'} enter the battlefield.`);
    const waiting = retained.reduce((sum, wave) => sum + wave.actors.length, 0);
    if (waiting > 0) session.log.push(`${waiting} reinforcement${waiting === 1 ? '' : 's'} await a clear entry tile.`);
}

/**
 * Reassert the sealed floor affix at round start using the same canonical statuses
 * consumed by PvP/Solo/Tower damage and DoT formulas. Clear/Cleanse may suppress it
 * for the remainder of a round, but the field returns next round while the encounter
 * remains active.
 */
function applyFieldRuleAtRoundStart(session: TowerSession): void {
    const rule = session.map.fieldRule;
    if (!rule || rule.kind === 'none') return;
    const tag = canonicalTagName(rule.tag);
    const percent = Math.max(0, Math.min(100, Number(rule.percent ?? 0)));
    let applied = 0;
    for (const actor of session.actors) {
        if (actor.hp <= 0) continue;
        // Floor affixes are viewer-facing encounter modifiers, not global weather:
        // boons help the player's team while debuffs/hazards are the floor's
        // challenge. Applying a boon to every enemy made the authored "buff"
        // floors harder in direct proportion to enemy count and obscured the UI
        // promise. NPC escorts intentionally stay neutral to both variants.
        if (rule.kind === 'buff' && actor.side !== 'squad') continue;
        if ((rule.kind === 'debuff' || rule.kind === 'hazard') && actor.side !== 'squad') continue;
        if (rule.kind === 'buff' && tag === 'Increase Damage Given') {
            addTowerStatus(actor, {
                name: tag, rounds: 1, percent, kind: 'positive', source: 'tower-field', activeRound: session.round,
            });
            applied++;
        } else if (rule.kind === 'debuff' && tag === 'Increase Damage Taken') {
            addTowerStatus(actor, {
                name: tag, rounds: 1, percent, kind: 'negative', source: 'tower-field', activeRound: session.round,
            });
            applied++;
        } else if (rule.kind === 'hazard' && tag === 'Drain') {
            // Drain is the shared HP+chakra tick. Scale its flat amount from the
            // smaller resource pool so a field cannot erase a full chakra bar at once.
            const basis = Math.min(actor.maxHp, Math.max(1, actor.maxChakra));
            addTowerStatus(actor, {
                name: tag, rounds: 1, amount: Math.max(1, Math.floor(basis * (percent / 100))),
                kind: 'negative', source: 'tower-field', activeRound: session.round,
            });
            applied++;
        }
    }
    if (applied > 0) session.log.push(`Field rule: ${rule.tag}${percent > 0 ? ` ${percent}%` : ''}.`);
}
function actionStatusPercent(actor: TowerActor, name: string, round: number): number | null {
    const matching = activeCombatStatuses(actor.statuses, round)
        .filter(status => canonicalTagName(status.name) === name);
    if (!matching.length) return null;
    return matching.reduce((sum, status) => sum + Number(status.percent ?? 20), 0);
}

/** One AP authority for validation and commitment across every paid Tower action. */
function towerAdjustedApCost(session: TowerSession, actor: TowerActor, base: number): number {
    return adjustedApCost(base, {
        lagPct: actionStatusPercent(actor, 'Lag', session.round),
        overclockPct: actionStatusPercent(actor, 'Overclock', session.round),
    });
}
function canAct(session: TowerSession, baseCost: number, actingActor?: TowerActor): boolean {
    const actor = actingActor ?? activeActor(session);
    return !!actor
        && session.activeAp >= towerAdjustedApCost(session, actor, baseCost)
        && session.actionsThisTurn < MAX_ACTIONS;
}
function spendActionAp(session: TowerSession, actor: TowerActor, baseCost: number): void {
    session.activeAp = Math.max(0, session.activeAp - towerAdjustedApCost(session, actor, baseCost));
}

const BASIC_JUTSU_ELEMENTS = new Set(['Earth', 'Wind', 'Water', 'Lightning', 'Fire']);
function isElementallySealed(session: TowerSession, actor: TowerActor, jutsu: JutsuLike): boolean {
    return BASIC_JUTSU_ELEMENTS.has(String(jutsu.element ?? ''))
        && activeCombatStatuses(actor.statuses, session.round)
            .some(status => canonicalTagName(status.name) === 'Elemental Seal');
}
function rejectElementallySealed(session: TowerSession, actor: TowerActor, jutsu: JutsuLike): boolean {
    if (!isElementallySealed(session, actor, jutsu)) return false;
    session.log.push(`${actor.name} is Elementally Sealed — cannot use ${jutsu.name ?? 'that jutsu'} (${jutsu.element}).`);
    return true;
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
    if (objectiveBossDamageLocked(session, actor)) return;
    const pct = activeCombatStatuses(actor.statuses, round)
        .filter(s => canonicalTagName(s.name) === 'Poison')
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
    // An ENEMY actor taking the field starts a fresh guard window: snapshot squad
    // HP (the mercy floor reads it) and clear the per-turn damage tally. This is
    // the one hook that runs at every turn start (startRound + endTurn).
    if (actor && actor.side === 'enemy') resetPveGuardTurn(session);
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
    deployPendingEnemyWaves(session);
    refreshObjectiveProgress(session);
    applyFieldRuleAtRoundStart(session);
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
const ADDS_GATE_OBJECTIVES = new Set(['defeat-all-then-boss', 'kill-adds-first']);

function isAddsGateObjective(session: TowerSession): boolean {
    return ADDS_GATE_OBJECTIVES.has(session.objectiveState.kind);
}

/** Every living non-boss enemy counts, including actors sealed in a future wave. */
function objectiveAddsRemaining(session: TowerSession): number {
    const bossId = session.phaseState.bossId;
    const deployed = session.actors.filter(a => a.side === 'enemy' && a.id !== bossId && a.hp > 0).length;
    const scheduled = (session.pendingEnemyWaves ?? []).reduce((sum, wave) =>
        sum + wave.actors.filter(a => a.side === 'enemy' && a.id !== bossId && a.hp > 0).length, 0);
    return deployed + scheduled;
}

function objectiveBossName(session: TowerSession): string {
    const id = session.phaseState.bossId;
    return (id ? getActor(session, id)?.name : undefined) ?? 'Boss';
}

/**
 * Refresh the client-visible objective projection from authoritative combat state.
 * Win checks never trust these projection fields; they re-read actors/waves/phaseState.
 */
function refreshObjectiveProgress(session: TowerSession): void {
    const state = session.objectiveState;
    if (isAddsGateObjective(session)) {
        const remaining = objectiveAddsRemaining(session);
        const unlocked = remaining === 0;
        const previous = state.bossUnlocked;
        state.addsRemaining = remaining;
        state.bossUnlocked = unlocked;
        if (previous === undefined) {
            session.log.push(unlocked
                ? `Objective unlocked: ${objectiveBossName(session)} is vulnerable.`
                : `Objective barrier active: ${objectiveBossName(session)} cannot be damaged while ${remaining} reinforcement${remaining === 1 ? '' : 's'} remain.`);
        } else if (previous !== unlocked) {
            session.log.push(unlocked
                ? `Objective unlocked: all reinforcements are defeated; ${objectiveBossName(session)} is vulnerable.`
                : `Objective barrier restored: ${objectiveBossName(session)} is protected while ${remaining} reinforcement${remaining === 1 ? '' : 's'} remain.`);
        }
        return;
    }

    if (state.kind === 'break-objective') {
        const completed = session.phaseState.triggeredPhases.length;
        const total = completed + session.phaseState.pendingPhases.length;
        const previous = state.breakStagesCompleted;
        state.breakStagesCompleted = completed;
        state.breakStagesTotal = total;
        if (previous === undefined) {
            session.log.push(total > 0
                ? `Break objective armed: destroy ${total} phase seal${total === 1 ? '' : 's'}.`
                : 'Break objective unavailable: no boss phase gates are configured.');
        } else if (completed > previous) {
            session.log.push(`Break objective progress: ${completed}/${total} phase seals destroyed.`);
        }
    }
}

/** True only for the two adds-gated objectives and their configured boss actor. */
function objectiveBossDamageLocked(session: TowerSession, target: TowerActor): boolean {
    if (!isAddsGateObjective(session) || target.id !== session.phaseState.bossId) return false;
    refreshObjectiveProgress(session);
    return objectiveAddsRemaining(session) > 0;
}

function rejectObjectiveLockedBoss(session: TowerSession, actor: TowerActor, target: TowerActor): boolean {
    if (!objectiveBossDamageLocked(session, target)) return false;
    const remaining = session.objectiveState.addsRemaining ?? objectiveAddsRemaining(session);
    session.log.push(`${actor.name} cannot target ${target.name}: defeat ${remaining} reinforcement${remaining === 1 ? '' : 's'} first.`);
    return true;
}

function bossDead(session: TowerSession): boolean {
    const id = session.phaseState.bossId;
    if (!id) return false;
    const boss = getActor(session, id);
    return !!boss && boss.hp <= 0;
}
function squadWinsByObjective(session: TowerSession, floor: TowerFloor): boolean {
    const enemiesStillScheduled = (session.pendingEnemyWaves ?? []).some(wave => wave.actors.length > 0);
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
            // A defense is a timed hold, not a renamed escort clear. Authored future waves stay
            // pressure, while the sole clear authority is the NPC surviving the round budget.
            return (session.objectiveState.roundsSurvived ?? 0) >= floor.roundBudget
                && isSideAlive(session, 'npc');
        case 'kill-escort':
            return !enemiesStillScheduled && !isSideAlive(session, 'enemy') && isSideAlive(session, 'npc');
        case 'defeat-all-then-boss':
        case 'kill-adds-first':
            // Strictly require the authored boss. The catalog validates this, and a broken
            // configuration must never silently degrade into an ordinary wipe objective.
            return !!session.phaseState.bossId && objectiveAddsRemaining(session) === 0 && bossDead(session);
        case 'break-objective': {
            // A break clear is the configured phase ladder, not enemy HP=0 and not a
            // client-supplied counter. Zero configured gates is invalid/incomplete.
            const total = session.phaseState.triggeredPhases.length + session.phaseState.pendingPhases.length;
            return !!session.phaseState.bossId && total > 0 && session.phaseState.pendingPhases.length === 0;
        }
        // defeat-all
        default:
            return !enemiesStillScheduled && !isSideAlive(session, 'enemy');
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
    // HP gates are authoritative combat state, regardless of whether the crossing came
    // from a direct cast, a companion, a DoT, or neutral arena damage. This defensive
    // tick is intentionally objective-agnostic: otherwise lethal round-end damage can
    // clear an adds-gated boss before its authored phase court has a chance to re-lock it.
    tickBossPhases(session);
    refreshObjectiveProgress(session);
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

// Move crossed boss HP-phase thresholds from pending → triggered.
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
        // For break-objective these server-authored HP gates ARE the staged objective.
        // Refresh after phase mechanics so a summon can also restore an adds barrier.
        refreshObjectiveProgress(session);
    }
}

// ─── Action application ──────────────────────────────────────────────────────
/** Replace the session's VFX plates and bump the sequence the client watches. */
function publishTowerVfx(session: TowerSession, plates: TowerVfxEvent[]): void {
    if (!plates.length) return;
    session.vfx = plates.slice(0, MAX_COMBAT_VFX_TILES);
    session.vfxSeq = (session.vfxSeq ?? 0) + 1;
}

/**
 * Author the cosmetic plates for one resolved action.
 *
 * Deliberately derived from the action + the actor's own jutsu entry, never from
 * damage numbers: this runs AFTER the action resolved and must not be able to
 * influence it. `ko` upgrades the plate to the finisher art, matching solo-PvE.
 */
function towerActionVfx(session: TowerSession, actor: TowerActor, action: TowerAction, ko: boolean): TowerVfxEvent[] {
    const foe = 'targetId' in action && action.targetId ? action.targetId : undefined;
    switch (action.type) {
        case 'move': case 'dash':
            return [{ key: 'move', anchor: 'tile', tiles: [action.tile] }];
        case 'attack':
            return foe ? [{ key: ko ? 'ko' : 'impact', target: foe, anchor: 'target' }] : [];
        case 'weapon':
            return foe ? [{ key: ko ? 'ko' : 'weapon', target: foe, anchor: 'target' }] : [];
        case 'heal':
            return [{ key: 'heal', target: actor.id, anchor: 'caster' }];
        case 'cleanse':
            return [{ key: 'cleanse', target: actor.id, anchor: 'caster' }];
        case 'clear':
            return foe ? [{ key: 'cleanse', target: foe, anchor: 'target' }] : [];
        case 'item':
            return [{ key: 'item', target: actor.id, anchor: 'caster' }];
        case 'summon':
            return [{ key: 'summon', target: actor.id, anchor: 'caster' }];
        case 'jutsu': {
            const jutsu = findJutsu(actor, action.jutsuId);
            if (!jutsu) return [];
            const names = canonicalJutsuTagNames(
                (jutsu.tags as Array<{ name?: string }> | undefined)
                    ?.filter((tag): tag is { name: string } => typeof tag?.name === 'string'),
            );
            // A pure repositioning jutsu already emits the movement plate below.
            if (names.length && names.every(name => name === 'Move')) {
                return action.tile === undefined ? [] : [{ key: 'move', anchor: 'tile', tiles: [action.tile] }];
            }
            const radius = jutsuAreaRadius(jutsu);
            const method = String(jutsu.method ?? 'SINGLE');
            const ground = method === 'INSTANT_EFFECT' || method === 'AOE_SPIRAL' || String(jutsu.target ?? '') === 'EMPTY_GROUND';
            const semantic = semanticJutsuVfx(jutsu as Parameters<typeof semanticJutsuVfx>[0], {
                ...(ground ? { ground: true } : {}),
                ...(radius > 0 ? { area: true } : {}),
                ...(ko ? { ko: true } : {}),
            });
            // Anchor on the struck tile when the cast named one, otherwise on the
            // victim (or the caster for a self-cast).
            const centre = action.tile ?? session.actors.find(a => a.id === foe)?.pos;
            const tiles = centre === undefined
                ? undefined
                : radius > 0
                    ? filledDiskTiles(centre, radius, session.map.width, session.map.height)
                    : [centre];
            const target = semantic.anchor === 'caster' ? actor.id : foe;
            return [{
                key: semantic.key,
                ...(target ? { target } : {}),
                anchor: semantic.anchor,
                ...(tiles ? { tiles: tiles.slice(0, MAX_COMBAT_VFX_TILES) } : {}),
                ...(ground ? { persistent: true } : {}),
            }];
        }
        default:
            return [];
    }
}

/**
 * Thin cosmetic wrapper around the resolver. It snapshots the actors' HP, runs
 * the UNCHANGED resolution below, then authors the plates for what happened.
 * Kept as a wrapper (rather than emission scattered through the resolver's many
 * early returns) so the combat path itself is byte-for-byte what it was.
 */
export function applyAction(session: TowerSession, floor: TowerFloor, action: TowerAction, rng: () => number): ActionResult {
    const hpBefore = new Map(session.actors.map(a => [a.id, a.hp]));
    const result = applyResolvedAction(session, floor, action, rng);
    if (!result.applied) return result;
    const actor = session.actors.find(a => a.id === action.actorId);
    if (actor) {
        const ko = session.actors.some(a => a.hp <= 0 && (hpBefore.get(a.id) ?? 0) > 0);
        publishTowerVfx(session, towerActionVfx(session, actor, action, ko));
    }
    return result;
}

function applyResolvedAction(session: TowerSession, floor: TowerFloor, action: TowerAction, rng: () => number): ActionResult {
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
        if (!Number.isSafeInteger(action.tile) || action.tile < 0 || action.tile >= w * session.map.height) {
            return { applied: false, reason: 'bad-tile' };
        }
        if (hexDistance(actor.pos, action.tile, w) !== 1) return { applied: false, reason: 'not-adjacent' };
        if (isTileBlocked(session, action.tile, actor.id)) return { applied: false, reason: 'blocked' };
        actor.pos = action.tile;
        spendActionAp(session, actor, MOVE_AP);
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
        if (!Number.isSafeInteger(action.tile) || action.tile < 0 || action.tile >= w * session.map.height) {
            return { applied: false, reason: 'bad-tile' };
        }
        const d = hexDistance(actor.pos, action.tile, w);
        if (d < 1 || d > DASH_RANGE) return { applied: false, reason: 'out-of-range' };
        if (isTileBlocked(session, action.tile, actor.id)) return { applied: false, reason: 'blocked' };
        actor.pos = action.tile;
        spendActionAp(session, actor, DASH_AP);
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
        spendActionAp(session, actor, HEAL_AP);
        session.actionsThisTurn += 1;
        session.log.push(`${actor.name} uses Basic Heal, restoring ${healAmt} HP.`);
        return { applied: true };
    }

    // ── cleanse: strip the actor's own negative statuses (debuffs / DoTs) ──
    if (action.type === 'cleanse') {
        if ((actor.cooldowns['cleanse'] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
        if (!canAct(session, CLEANSE_AP)) return { applied: false, reason: 'cannot-act' };
        const committedApCost = towerAdjustedApCost(session, actor, CLEANSE_AP);
        if (hasActiveStatus(actor, 'Cleanse Prevent', session.round)) {
            session.log.push(`${actor.name}'s Cleanse Prevent blocks the cleanse.`);
        } else {
            const removed = actor.statuses.filter(s => s.kind === 'negative').map(s => s.name);
            actor.statuses = actor.statuses.filter(s => s.kind !== 'negative');
            session.log.push(`Cleanse: removed ${removed.length ? removed.join(', ') : 'no negative effects'} from ${actor.name}.`);
        }
        actor.cooldowns['cleanse'] = CLEANSE_CD;
        session.activeAp = Math.max(0, session.activeAp - committedApCost);
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
        spendActionAp(session, actor, CLEAR_AP);
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
        if (actor.side === 'squad' && rejectObjectiveLockedBoss(session, actor, wTarget)) {
            return { applied: false, reason: 'objective-locked' };
        }
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
        if (jSelf && towerJutsuTargetsSelf(jSelf)) {
            if (rejectElementallySealed(session, actor, jSelf)) return { applied: false, reason: 'elementally-sealed' };
            const cost = Number(jSelf.ap ?? 40);
            const ck = Math.max(0, Number(jSelf.chakraCost ?? 0));
            const st = Math.max(0, Number(jSelf.staminaCost ?? 0));
            if ((actor.cooldowns[action.jutsuId] ?? 0) > 0) return { applied: false, reason: 'on-cooldown' };
            if (ck > 0 && actor.chakra < ck) return { applied: false, reason: 'no-chakra' };
            if (st > 0 && actor.stamina < st) return { applied: false, reason: 'no-stamina' };
            if (!canAct(session, cost)) return { applied: false, reason: 'cannot-act' };
            resolveHit(session, floor, actor, actor, jSelf, cost, true);
            actor.chakra = Math.max(0, actor.chakra - ck);
            actor.stamina = Math.max(0, actor.stamina - st);
            spendPoison(session, actor, ck, st, session.round);
            if (Number(jSelf.cooldown ?? 0) > 0) setSafeRecordValue(actor.cooldowns, action.jutsuId, Number(jSelf.cooldown));
            tickBossPhases(session);
            checkTowerWinner(session, floor);
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
            if (rejectElementallySealed(session, actor, jm)) return { applied: false, reason: 'elementally-sealed' };
            const tile = Math.floor(action.tile);
            const w = session.map.width;
            if (!Number.isSafeInteger(action.tile) || tile < 0 || tile >= w * session.map.height) return { applied: false, reason: 'bad-tile' };
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
            spendActionAp(session, actor, cost);
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
            if (rejectElementallySealed(session, actor, jg)) return { applied: false, reason: 'elementally-sealed' };
            const tile = Math.floor(action.tile);
            if (!Number.isSafeInteger(action.tile) || tile < 0 || tile >= session.map.width * session.map.height) {
                return { applied: false, reason: 'bad-tile' };
            }
            // Tower ground strikes may intentionally target an occupied hostile tile,
            // but never static terrain or a live server-authored Barrier wall.
            if (session.map.blockedTiles.includes(tile) || towerBarrierTiles(session).has(tile)) {
                return { applied: false, reason: 'blocked' };
            }
            const range = Math.max(1, Number(jg.range ?? 1));
            if (hexDistance(actor.pos, tile, session.map.width) > range) return { applied: false, reason: 'out-of-range' };
            const centeredTarget = session.actors.find(a =>
                a.hp > 0 && a.pos === tile && hostileSidesFor(actor.side).includes(a.side));
            if (centeredTarget && actor.side === 'squad' && rejectObjectiveLockedBoss(session, actor, centeredTarget)) {
                return { applied: false, reason: 'objective-locked' };
            }
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
                spendActionAp(session, actor, cost);
                session.actionsThisTurn += 1;
                tickBossPhases(session);
            } else {
                const method = String(jg.method ?? 'SINGLE');
                const ringHit = method === 'AOE_CIRCLE' || method === 'INSTANT_EFFECT';
                const area = new Set(ringHit ? groundZoneTiles(tile, session.map.width, session.map.height) : [tile]);
                const primary = session.actors
                    .filter(a => a.hp > 0 && hostileSidesFor(actor.side).includes(a.side) && area.has(a.pos)
                        && !(actor.side === 'squad' && objectiveBossDamageLocked(session, a)))
                    .sort((a, b) => (a.pos === tile ? -1 : b.pos === tile ? 1 : 0) || (a.pos - b.pos) || (a.id < b.id ? -1 : 1))[0];
                if (primary) {
                    resolveHit(session, floor, actor, primary, jg, cost, true); // winner waits for resource-spend Poison
                } else {
                    session.log.push(`${actor.name} places ${jg.name ?? 'a ground jutsu'} on hex ${tile}, but it catches no one.`);
                    spendActionAp(session, actor, cost);
                    session.actionsThisTurn += 1;
                    tickBossPhases(session);
                }
            }
            actor.chakra = Math.max(0, actor.chakra - ck);
            actor.stamina = Math.max(0, actor.stamina - st);
            spendPoison(session, actor, ck, st, session.round);
            if (Number(jg.cooldown ?? 0) > 0) setSafeRecordValue(actor.cooldowns, action.jutsuId, Number(jg.cooldown));
            tickBossPhases(session);
            checkTowerWinner(session, floor);
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
        const committedApCost = towerAdjustedApCost(session, actor, iCost);
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
        session.activeAp = Math.max(0, session.activeAp - committedApCost);
        session.actionsThisTurn += 1;
        checkTowerWinner(session, floor);
        return { applied: true };
    }

    // attack / jutsu — need a living, hostile, in-range target
    const target = getActor(session, action.targetId ?? '');
    if (!target || target.hp <= 0) return { applied: false, reason: 'no-target' };
    if (!hostileSidesFor(actor.side).includes(target.side)) return { applied: false, reason: 'friendly-fire' };
    if (actor.side === 'squad' && rejectObjectiveLockedBoss(session, actor, target)) {
        return { applied: false, reason: 'objective-locked' };
    }
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
        if (rejectElementallySealed(session, actor, j)) return { applied: false, reason: 'elementally-sealed' };
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

    resolveHit(session, floor, actor, target, jutsu, cost, action.type === 'jutsu');
    // Deduct chakra/stamina + arm the cooldown after a jutsu lands (basic attack is free).
    if (action.type === 'jutsu') {
        actor.chakra = Math.max(0, actor.chakra - chakraCost);
        actor.stamina = Math.max(0, actor.stamina - staminaCost);
        spendPoison(session, actor, chakraCost, staminaCost, session.round);
        if (Number(jutsu.cooldown ?? 0) > 0) setSafeRecordValue(actor.cooldowns, action.jutsuId, Number(jutsu.cooldown));
        tickBossPhases(session);
        checkTowerWinner(session, floor);
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
    // Resolve every HP gate before fonts/regen can heal the boss back above a threshold.
    // checkTowerWinner also ticks defensively, but that later call is deliberately after
    // healing and cannot prove that a transient round-end crossing actually occurred.
    tickBossPhases(session);
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

// ─── Easy-band AI pacing (api/_pve-difficulty.ts behaviour helpers) ──────────
// The band-competence layer the client applies at Arena.tsx:780 (burst hold),
// :4019 (lethal intent) and :4812 (clear / cleanse). Gated on a SEALED
// `session.pveGuard` AND `side === 'enemy'`, so squad AI (async allies, AFK
// humans) and every mode that seals no guard are byte-identical.

/** The band inputs for `actor`, or undefined when the band AI does not apply. */
function pveBandFor(session: TowerSession, actor: TowerActor): { enemyLevel: number } | undefined {
    const guard = session.pveGuard;
    if (!guard || actor.side !== 'enemy') return undefined;
    // The ENCOUNTER's sealed level, same input the hit guard bands on — the
    // client reads `opponentLevel` at each of the call sites above.
    return { enemyLevel: guard.enemyLevel };
}

/** Effective mastery for `actor`'s cast of `jutsu` — the same lookup applyJutsu
 *  performs (sealed per-jutsu entry, rank-capped), falling back to the band's
 *  level-derived mastery when the template carries no array. Estimate only. */
function aiMasteryFor(actor: TowerActor, jutsu: JutsuLike): number {
    const level = Number(actor.character.level) || 1;
    const entries = actor.character.jutsuMastery as Array<{ jutsuId?: unknown; level?: unknown }> | null | undefined;
    if (Array.isArray(entries)) {
        const hit = entries.find(m => String(m?.jutsuId ?? '') === String(jutsu.id ?? ''));
        if (hit) return Math.max(0, Math.min(JUTSU_MAX_LEVEL, Number(hit.level) || 0, jutsuLevelCapForLevel(level)));
    }
    return pveAiMasteryForLevel(level);
}

/**
 * Rough damage `jutsu` would land on `target`, for the lethal-intent gate only.
 * It is an ESTIMATE — computeDamage is the base-damage port, while the real cast
 * goes through applyPvpJutsu (statuses, tags, terrain) — exactly as the client's
 * `estimateAiJutsuDamage` is an estimate of its own resolver.
 *
 * DELIBERATELY UNCAPPED: this is the RAW hit, not what survives the PvE guard,
 * mirroring the client — which scans with `estimateAiJutsuDamage` and applies
 * `pveGuardedEnemyHit` separately at resolution. Folding the cap in here would
 * make the gate dead code rather than conservative: the easy-band per-hit cap is
 * 20% of max HP while the gate only engages above 25%, so a capped estimate can
 * never reach the KO threshold and every jutsu would read as non-lethal.
 */
function estimateAiHit(actor: TowerActor, target: TowerActor, jutsu: JutsuLike): number {
    return computeDamage(actor, target, jutsu, aiMasteryFor(actor, jutsu));
}

function aiJutsuHealthGate(actor: TowerActor, jutsu: JutsuLike): boolean {
    const hpPct = actor.maxHp > 0 ? (actor.hp / actor.maxHp) * 100 : 0;
    if (typeof jutsu.aiHpBelowPct === 'number' && hpPct > jutsu.aiHpBelowPct) return false;
    if (typeof jutsu.aiHpAbovePct === 'number' && hpPct < jutsu.aiHpAbovePct) return false;
    return true;
}

function aiJutsuReady(session: TowerSession, actor: TowerActor, jutsu: JutsuLike): boolean {
    if (!jutsu || typeof jutsu.id !== 'string' || !aiJutsuHealthGate(actor, jutsu)) return false;
    if (isElementallySealed(session, actor, jutsu)) return false;
    if (!canAct(session, Math.max(1, Number(jutsu.ap ?? 40)), actor)) return false;
    if ((actor.cooldowns[String(jutsu.id)] ?? 0) > 0) return false;
    return actor.chakra >= Math.max(0, Number(jutsu.chakraCost ?? 0))
        && actor.stamina >= Math.max(0, Number(jutsu.staminaCost ?? 0));
}

function aiTagNames(jutsu: JutsuLike): Set<string> {
    const names = new Set<string>();
    if (!Array.isArray(jutsu.tags)) return names;
    for (const raw of jutsu.tags as Array<{ name?: unknown }>) {
        if (typeof raw?.name === 'string') names.add(canonicalTagName(raw.name));
    }
    return names;
}

/** Defensive/self-sustain techniques are conditional instead of blindly spammed. */
function bestSelfUtilityJutsu(session: TowerSession, actor: TowerActor): JutsuLike | undefined {
    const list = actor.character.jutsu;
    if (!Array.isArray(list)) return undefined;
    const hpFrac = actor.maxHp > 0 ? actor.hp / actor.maxHp : 0;
    const useful = (list as JutsuLike[])
        .filter(j => towerJutsuTargetsSelf(j) && aiJutsuReady(session, actor, j))
        .filter(j => {
            const tags = aiTagNames(j);
            if (tags.has('Heal')) return hpFrac <= 0.65;
            if (tags.has('Shield')) return actor.shield < actor.maxHp * 0.12;
            if (tags.has('Absorb')) return !hasActiveStatus(actor, 'Absorb', session.round);
            if (tags.has('Reflect')) return !hasActiveStatus(actor, 'Reflect', session.round);
            if (tags.has('Increase Damage Given')) return !hasActiveStatus(actor, 'Increase Damage Given', session.round);
            if (tags.has('Decrease Damage Taken')) return !hasActiveStatus(actor, 'Decrease Damage Taken', session.round);
            return false;
        });
    return useful.sort((a, b) => (Number(b.aiPriority ?? 0) - Number(a.aiPriority ?? 0))
        || (String(a.id) < String(b.id) ? -1 : 1))[0];
}

/** Ground control is aimed at the selected opponent's current tile. */
function bestGroundJutsu(session: TowerSession, actor: TowerActor, target: TowerActor): JutsuLike | undefined {
    const list = actor.character.jutsu;
    if (!Array.isArray(list)) return undefined;
    const dist = hexDistance(actor.pos, target.pos, session.map.width);
    return (list as JutsuLike[])
        .filter(j => String(j.target ?? '') === 'EMPTY_GROUND' && !aiTagNames(j).has('Move'))
        .filter(j => aiJutsuReady(session, actor, j))
        .filter(j => Math.max(1, Number(j.range ?? 1)) >= dist)
        .sort((a, b) => (Number(b.aiPriority ?? 0) - Number(a.aiPriority ?? 0))
            || (Number(b.effectPower ?? 0) - Number(a.effectPower ?? 0))
            || (String(a.id) < String(b.id) ? -1 : 1))[0];
}

// ─── Deterministic AI policy (v1 — nearest-target; richer policy = P1.A3) ─────
function bestAffordableJutsu(session: TowerSession, actor: TowerActor, dist: number, target?: TowerActor): JutsuLike | undefined {
    const list = actor.character.jutsu;
    if (!Array.isArray(list)) return undefined;
    const band = pveBandFor(session, actor);
    // "Teach, don't ambush": an easy-band foe holds its 60+ AP burst jutsu for
    // the opening rounds, so a new player meets the weaker attacks first.
    // Mirrors Arena.tsx's applyEasyBurstHold; a strict no-op elsewhere.
    const holdsBurst = !!band && pveEasyBandHoldsBurst(band.enemyLevel, session.round);
    const opts = (list as JutsuLike[])
        .filter(j => j && typeof j.id === 'string')
        .filter(j => aiJutsuHealthGate(actor, j))
        .filter(j => Math.max(1, Number(j.range ?? 1)) >= dist)
        .filter(j => !isElementallySealed(session, actor, j))
        .filter(j => canAct(session, Number(j.ap ?? 40), actor))
        // affordable: not on cooldown, enough chakra + stamina (mirrors the human gates)
        .filter(j => (actor.cooldowns[String(j.id)] ?? 0) <= 0)
        .filter(j => actor.chakra >= Math.max(0, Number(j.chakraCost ?? 0)) && actor.stamina >= Math.max(0, Number(j.staminaCost ?? 0)))
        // skip zero-damage utility + ground-placed jutsu — the AI casts straightforward damage
        .filter(j => Number(j.effectPower ?? 0) > 0 && !['EMPTY_GROUND', 'SELF'].includes(String(j.target ?? '')))
        .filter(j => !holdsBurst || !pveIsBurstJutsuAp(Number(j.ap ?? 40)))
        // deterministic: highest effectPower, ties by id
        .sort((a, b) => (Number(b.aiPriority ?? 0) - Number(a.aiPriority ?? 0))
            || (Number(b.effectPower ?? 0) - Number(a.effectPower ?? 0))
            || (String(a.id) < String(b.id) ? -1 : 1));
    // Lethal intent: in the easy band the AI does not deliberately reach for the
    // kill until the player is already very low. Like the client this only
    // DEPRIORITIZES — it prefers the strongest non-lethal option and still casts
    // the best available one when every option would finish them, so the AI is
    // never disarmed into passivity and an incidental kill remains possible.
    if (band && target && opts.length > 1
        && !pveEasyBandAllowsLethal(band.enemyLevel, target.hp / Math.max(1, target.maxHp))) {
        const ko = target.hp + Math.max(0, target.shield);
        const spared = opts.find(j => estimateAiHit(actor, target, j) < ko);
        if (spared) return spared;
    }
    return opts[0];
}

type AiAoeChoice = { jutsu: JutsuLike; target: TowerActor; caught: number };

/** Pick the legal primary that makes an authored targeted AOE tactically meaningful.
 * Locked objective bosses are absent from opponentsOf, so scoring cannot use an add as a
 * back door to splash the barrier. Ties preserve the authored focus victim, then use
 * distance/id for replay-stable ordering. */
function bestTargetedAoe(
    session: TowerSession,
    actor: TowerActor,
    preferredTarget: TowerActor,
): AiAoeChoice | undefined {
    const w = session.map.width;
    const opponents = opponentsOf(session, actor);
    const choices: AiAoeChoice[] = [];
    for (const candidate of opponents) {
        const dist = hexDistance(actor.pos, candidate.pos, w);
        const jutsu = bestAffordableJutsu(session, actor, dist, candidate);
        if (!jutsu) continue;
        const radius = jutsuAreaRadius(jutsu);
        if (radius <= 0 || ['EMPTY_GROUND', 'SELF'].includes(String(jutsu.target ?? ''))) continue;
        const caught = opponents.filter(other => hexDistance(candidate.pos, other.pos, w) <= radius).length;
        choices.push({ jutsu, target: candidate, caught });
    }
    return choices.sort((a, b) => (b.caught - a.caught)
        || (Number(b.target.id === preferredTarget.id) - Number(a.target.id === preferredTarget.id))
        || (hexDistance(actor.pos, a.target.pos, w) - hexDistance(actor.pos, b.target.pos, w))
        || (a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0)
        || (String(a.jutsu.id) < String(b.jutsu.id) ? -1 : 1))[0];
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
    if (d <= 1 && canAct(session, BASIC_ATTACK_AP, attacker)) return true;
    return !!bestAffordableJutsu(session, attacker, d, opp);
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

/**
 * Deliberately limited Story recruit policy. It takes at most one action, never
 * evaluates roles, AOE clusters, buffs, cleansing, fonts, shrines, or telegraphs,
 * and occasionally hesitates. Terrain pathing remains legal so the helper cannot
 * wedge a run, but it is visibly less competent than authored enemies or players.
 */
function pickNoviceRecruitAction(session: TowerSession, actor: TowerActor): TowerAction {
    if (session.actionsThisTurn > 0) return { actorId: actor.id, type: 'wait' };
    const target = nearestOpponent(session, actor);
    if (!target) return { actorId: actor.id, type: 'wait' };
    const hesitation = ((session.seed >>> 0)
        ^ stableTextHash(actor.id)
        ^ Math.imul(Math.max(1, session.round), 0x9e3779b9)) >>> 0;
    if (hesitation % 5 === 0) return { actorId: actor.id, type: 'wait' };
    const distance = hexDistance(actor.pos, target.pos, session.map.width);
    if (distance <= 1 && canAct(session, BASIC_ATTACK_AP, actor)) {
        return { actorId: actor.id, type: 'attack', targetId: target.id };
    }
    const technique = bestAffordableJutsu(session, actor, distance, target);
    if (distance <= 2 && technique?.id) {
        return { actorId: actor.id, type: 'jutsu', jutsuId: technique.id, targetId: target.id };
    }
    if (canAct(session, MOVE_AP, actor)) {
        const step = nextStepToward(session, actor.pos, target.pos, actor.id);
        if (step !== actor.pos) return { actorId: actor.id, type: 'move', tile: step };
    }
    return { actorId: actor.id, type: 'wait' };
}

export function pickAiAction(session: TowerSession, actor: TowerActor, rng: () => number): TowerAction {
    void rng;
    if (actor.character.towerGenericAiProfile === 'story-recruit-v1') {
        return pickNoviceRecruitAction(session, actor);
    }
    // A boss/enemy with an authored aiTargetMode focus-fires by priority; everyone else keeps
    // the nearest-opponent policy → floors that set no targetMode are byte-identical.
    const focusMode = actor.side === 'enemy'
        ? String((actor.character as { aiTargetMode?: unknown }).aiTargetMode ?? '')
        : '';
    const target = (focusMode ? pickFocusTarget(session, actor, focusMode as TowerTargetMode) : undefined)
        ?? nearestOpponent(session, actor);
    if (!target) return { actorId: actor.id, type: 'wait' };
    const dist = hexDistance(actor.pos, target.pos, session.map.width);
    // Band competence (standard PvE only): strip the player's stacked buffs, or
    // shed our own debuffs, before committing the turn to damage. Mirrors the
    // client's order — Arena.tsx runs this block ahead of the jutsu pick. Easy
    // band leaves both thresholds Infinity, so a new player is never answered
    // by a Clear. The cooldown check matters: the AI loop re-enters pickAiAction
    // after each applied action, and cooldowns['clear'] is what stops a repeat.
    const band = pveBandFor(session, actor);
    if (band) {
        const comp = pveAiCompetence(band.enemyLevel);
        if (Number.isFinite(comp.clearBuffThreshold)
            && canAct(session, CLEAR_AP, actor) && (actor.cooldowns['clear'] ?? 0) <= 0
            && pveMeaningfulBuffCount(activeCombatStatuses(target.statuses, session.round)) >= comp.clearBuffThreshold) {
            return { actorId: actor.id, type: 'clear', targetId: target.id };
        }
        if (Number.isFinite(comp.cleanseSelfThreshold)
            && canAct(session, CLEANSE_AP, actor) && (actor.cooldowns['cleanse'] ?? 0) <= 0) {
            const debuffs = activeCombatStatuses(actor.statuses, session.round).filter(s => s.kind === 'negative').length;
            if (debuffs >= comp.cleanseSelfThreshold) return { actorId: actor.id, type: 'cleanse' };
        }
    }
    // Authored tactical kit: conditional self-defense first, then ground control.
    // Both emit ordinary actions and resolve through the same authoritative gates
    // as a player's cast; AI never mutates combat state directly.
    const selfUtility = bestSelfUtilityJutsu(session, actor);
    if (selfUtility?.id) return { actorId: actor.id, type: 'jutsu', jutsuId: selfUtility.id };
    const ground = bestGroundJutsu(session, actor, target);
    if (ground?.id) return { actorId: actor.id, type: 'jutsu', jutsuId: ground.id, tile: target.pos };
    const aoe = bestTargetedAoe(session, actor, target);
    if (aoe?.jutsu.id) {
        return { actorId: actor.id, type: 'jutsu', jutsuId: aoe.jutsu.id, targetId: aoe.target.id };
    }
    // Combat first: attack if we possibly can this turn.
    const j = bestAffordableJutsu(session, actor, dist, target);
    if (j && j.id) return { actorId: actor.id, type: 'jutsu', jutsuId: j.id, targetId: target.id };
    if (dist <= 1 && canAct(session, BASIC_ATTACK_AP, actor)) return { actorId: actor.id, type: 'attack', targetId: target.id };
    if (canAct(session, MOVE_AP, actor)) {
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
    const actors = [
        ...session.actors,
        ...(session.pendingEnemyWaves ?? []).flatMap(wave => wave.actors),
    ];
    for (const a of actors) {
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
            runCompanionTurn(session, floor, actor);
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
// Fully deterministic: the only roll is obedience. It is salted from authoritative turn
// identity rather than a caller-owned RNG cursor, so a live request that reconstructs an RNG
// cannot diverge from an uninterrupted auto-run / settlement recompute.
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
    if (objectiveBossDamageLocked(session, target)) return 0;
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

function stableTextHash(value: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
    return h >>> 0;
}

/** Pure, replay-stable companion obedience roll for one authoritative actor turn. */
export function companionObedienceRoll(session: Pick<TowerSession, 'seed' | 'round'>, actorIdValue: string): number {
    let h = ((session.seed >>> 0) ^ stableTextHash(actorIdValue)
        ^ Math.imul(Math.max(1, Math.floor(session.round)), 0x9e3779b9) ^ 0xa5a5a5a5) >>> 0;
    // Murmur-style finalizer gives adjacent rounds unrelated-looking, stable unit values.
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return (h >>> 0) / 0x100000000;
}

function runCompanionTurn(session: TowerSession, floor: TowerFloor, actor: TowerActor): void {
    const c = actor.character;
    if (!companionObeys(
        Number(c.companionHappiness ?? 0),
        c.companionLoyal === true,
        companionObedienceRoll(session, actor.id),
    )) {
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
        const danger = aiDangerTiles(session, actor);
        // A pet is a field actor, not a disposable projectile. If it begins an action on a
        // telegraphed/hazard tile, spend one legal step escaping before choosing its cast.
        if (danger.has(actor.pos)) {
            const moveCost = towerAdjustedApCost(session, actor, MOVE_AP);
            if (ap >= moveCost) {
                const safe = aiSafeStepToward(session, actor, target.pos, danger);
                if (safe !== actor.pos && !isTileBlocked(session, safe, actor.id)) {
                    actor.pos = safe; ap -= moveCost; acted++;
                    session.log.push(`${actor.name} evades the marked ground.`);
                    continue;
                }
            }
        }
        const moves = (Array.isArray(c.companionMoves) ? c.companionMoves : []) as CompanionMove[];
        const hpFrac = actor.maxHp > 0 ? actor.hp / actor.maxHp : 1;
        const move = pickCompanionMove(moves, (actor.cooldowns ?? {}) as Record<string, number>, hpFrac);
        const selfCast = !!move && companionMoveDamage(1, move) === 0;
        // Out of reach for anything offensive → spend a step closing the distance.
        if (!selfCast && hexDistance(actor.pos, target.pos, session.map.width) > COMPANION_RANGE) {
            const moveCost = towerAdjustedApCost(session, actor, MOVE_AP);
            if (ap < moveCost) break;
            const step = aiSafeStepToward(session, actor, target.pos, danger);
            if (step === actor.pos || isTileBlocked(session, step, actor.id)) break;
            actor.pos = step; ap -= moveCost; acted++;
            session.log.push(`${actor.name} closes in on ${target.name}.`);
            continue;
        }
        const castCost = towerAdjustedApCost(session, actor, BASIC_ATTACK_AP);
        if (ap < castCost) break;
        companionCast(session, floor, actor, target, move);
        ap -= castCost; acted++;
    }
    session.activeAp = ap;
}

/** One companion action — a strike, an offensive cast, or a self-support move. */
function companionCast(
    session: TowerSession, floor: TowerFloor, actor: TowerActor, target: TowerActor, move: CompanionMove | null,
): void {
    if (rejectObjectiveLockedBoss(session, actor, target)) return;
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
            runCompanionTurn(session, floor, actor);
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
