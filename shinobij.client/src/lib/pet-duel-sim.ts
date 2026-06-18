// ─────────────────────────────────────────────────────────────────────────────
// pet-duel-sim.ts — the pet-combat redesign engine (docs/pet-combat-redesign-plan.md).
//
// A CONTINUOUS-feel, fixed-timestep, DETERMINISTIC duel. Pets fight in real (sim)
// time on two teams (1v1 OR 2v2): they approach, dash in, telegraph a wind-up,
// strike/cast (hit, whiff, or a homing elemental projectile), recover, get
// staggered/interrupted, reactively dodge, suffer DoTs/stuns/slows, raise shields,
// heal allies, and unleash signature ultimates — instead of resolving discrete
// rounds. The renderer (Phase C) interpolates between tick snapshots for fully
// fluid visuals; this core stays bit-reproducible.
//
// DETERMINISM CONTRACT (load-bearing for ranked — see the plan §0/§6):
//   • The result is a pure function of (pets…, seed). Same inputs anywhere →
//     byte-identical snapshots + events. NO Math.random, NO Date / wall-clock,
//     NO non-IEEE transcendentals (sin/cos/atan2/pow/exp/log are BANNED — they
//     vary across JS engines). Only +,-,*,/,Math.sqrt/min/max/round/floor/abs
//     (all IEEE-correctly-rounded → cross-machine identical), plus a seeded LCG.
//   • State is QUANTIZED to 1/256 each tick so float error can never accumulate
//     or diverge between machines.
//   • Iteration order is FIXED: fighters step in build order (player team first,
//     by slot), projectiles in spawn order. Do not reorder.
//
// One core (`simulate`) drives BOTH `runPetDuel` (1v1) and `runPetPartyDuel`
// (2v2). NOT wired to anything live yet (PvE wiring is Phase C; ranked stays on
// the old engine until balance Phase D + server-validation Phase E). Consumes
// only persisted Pet fields (hp/attack/defense/speed/element/trait/jutsus) → zero
// save impact. Balance numbers here are PLACEHOLDERS to be tuned in Phase D.
// ─────────────────────────────────────────────────────────────────────────────
import type { Pet, PetJutsu } from "../types/pet";
import { WALK_MASK, WALK_COLS, WALK_ROWS } from "./pet-arena-walkmask";

export const DUEL_TPS = 30;                 // sim ticks per second
const MAX_TICKS = DUEL_TPS * 30;            // 30s hard cap
const Q = 256;                              // state quantization (1/256 unit)
const quant = (n: number) => Math.round(n * Q) / Q;
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

// Arena footprint (world units) — a BIG tactical battlefield: the pets spawn at
// opposite ends and TRAVERSE across the map to meet (small units on a big map,
// not two sprites bonking in a tight ring). The renderer frames the whole thing.
// Exported so the renderer can map sim field coords → the painted battle-map's
// battle-area rectangle (the diorama backdrop). Field is [-ARENA_X,ARENA_X] ×
// [-ARENA_Y,ARENA_Y]; the renderer projects it into the SpriteFlow spec rect.
export const ARENA_X = 14.0;
export const ARENA_Y = 7.5;

// Battlefield TERRAIN is now a baked WALKABILITY MASK (pet-arena-walkmask.ts,
// classified from the diorama art): pets path along stone/bridge tiles and treat
// everything else as solid. See the walkability grid section further down.

// Stamina economy — gates dashes / dodges / attacks so the fight breathes.
const STAM_MAX = 100;
const STAM_REGEN = 22 / DUEL_TPS;
const COST_BASIC = 12;
const COST_DASH = 24;
const COST_DODGE = 20;

const CRIT_CHANCE = 0.12;
// Damage scale — atk × DMG_SCALE × (ability power/100) before element/crit/mitigation.
// Tuned via scripts/pet-duel-balance.ts so fights resolve in KOs well under the 30s
// cap instead of timing out as HP-fraction draws (Phase D balance, plan §5).
const DMG_SCALE = 1.5;
const BASIC_REACH = 1.2;                    // melee contact distance (center-to-center)
const MIN_SEP = BASIC_REACH * 0.9;          // bodies never overlap closer than this
const MELEE_RANGE = 1.6;                    // melee-ability range
const RANGED_RANGE = 4.8;                   // ranged-ability / projectile range

// Element type chart: Fire > Wind > Lightning > Earth > Water > Fire.
const ELEMENT_BEATS: Record<string, string> = {
    Fire: "Wind", Wind: "Lightning", Lightning: "Earth", Earth: "Water", Water: "Fire",
};
function elementMult(att?: string | null, def?: string | null): number {
    if (!att || !def || att === "None" || def === "None") return 1;
    if (ELEMENT_BEATS[att] === def) return 1.15;   // +15% super-effective (was 25%)
    if (ELEMENT_BEATS[def] === att) return 0.85;   // −15% resisted
    return 1;
}

/** Deterministic LCG — same constants as the old engine. Seed is the match seed. */
function makeRng(seed: number): () => number {
    let s = (Math.max(1, Math.floor(seed)) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

// ── Abilities (PetJutsu → real-time ability) ─────────────────────────────────
type AbilityClass = "melee" | "ranged" | "support";
function abilityClass(kind: PetJutsu["kind"]): AbilityClass {
    if (kind === "heal" || kind === "buff" || kind === "shield" || kind === "barrier" || kind === "absorb" || kind === "haste") return "support";
    if (kind === "damage" || kind === "crush" || kind === "lifesteal") return "melee";
    return "ranged"; // burn/freeze/confuse/stun/dot/wound/mark/slow/debuff/move/movelock/taunt/push/pull
}

interface Ability {
    name: string;
    kind: PetJutsu["kind"];
    cls: AbilityClass;
    power: number;
    signature: boolean;
    aoe: boolean;
    range: number;
    castTicks: number;
    cdTicks: number;
    cdLeft: number;
    cost: number;
}

function buildAbility(j: PetJutsu): Ability {
    const cls = abilityClass(j.kind);
    const base = Math.max(Math.round(DUEL_TPS * 0.8), Math.round((j.cooldown || 0) * 1.2 * DUEL_TPS));
    return {
        name: j.name,
        kind: j.kind,
        cls,
        power: Math.max(1, j.power || 1),
        signature: !!j.signature,
        aoe: !!j.aoe,
        range: cls === "support" ? 999 : cls === "ranged" ? RANGED_RANGE : MELEE_RANGE,
        castTicks: Math.round(DUEL_TPS * (j.signature ? 0.5 : cls === "support" ? 0.25 : 0.3)),
        cdTicks: base + (j.signature ? Math.round(DUEL_TPS * 1.5) : 0),
        cdLeft: j.signature ? Math.round(DUEL_TPS * 2.5) : Math.round(DUEL_TPS * 0.5), // initial gate
        cost: j.signature ? 40 : cls === "support" ? 16 : 22,
    };
}

function statusTicks(ab: Ability, rounds?: number): number {
    return Math.round(DUEL_TPS * (rounds && rounds > 0 ? rounds * 0.8 : ab.signature ? 1.4 : 1.0));
}

// ── Fighter ──────────────────────────────────────────────────────────────────
export type DuelState = "idle" | "dash" | "windup" | "strike" | "recover" | "stagger" | "dodge" | "dead";

interface Statuses {
    burnLeft: number; burnDmg: number; halfHeal: boolean;
    stunLeft: number;
    slowLeft: number; hasteLeft: number;
    rootLeft: number;
    shieldHp: number;
    buffLeft: number; buffMag: number;       // ATK multiplier delta (can be negative)
    marked: boolean;
    tauntById: string | null;
}
function emptyStatuses(): Statuses {
    return { burnLeft: 0, burnDmg: 0, halfHeal: false, stunLeft: 0, slowLeft: 0, hasteLeft: 0, rootLeft: 0, shieldHp: 0, buffLeft: 0, buffMag: 0, marked: false, tauntById: null };
}

interface Fighter {
    id: string;
    team: "player" | "enemy";
    slot: number;
    pet: Pet;
    element?: string | null;
    x: number; y: number;
    faceX: number; faceY: number;
    hp: number; maxHp: number;
    reviveLeft: number; // PvE-only Alpha Bond mastery: revives left (0 normally)
    atk: number; def: number;
    stamina: number;
    moveSpeed: number; dashSpeed: number;
    reach: number;
    state: DuelState; stateLeft: number;
    basicCdLeft: number; basicCdT: number;
    windT: number; recovT: number; staggerT: number; dashT: number; dodgeT: number;
    dodgeChance: number; critChance: number;
    role: "melee" | "ranged" | "tank";       // drives spacing + behavior
    neutralRange: number;                    // the distance it holds between attacks (engagement bubble)
    strafeDir: number;                       // +1/-1 circling direction (deterministic)
    basicRanged: boolean;                    // ranged role pokes with a projectile basic
    abilities: Ability[];
    pendingIdx: number;                      // -1 basic, >=0 ability index, -2 none
    pendingTargetId: string | null;
    statuses: Statuses;
    moveDx: number; moveDy: number;          // stored dir for dash/dodge
    targetId: string | null;
    repositionLeft: number;                  // hit-and-reposition: hold neutral for a beat after attacking
}

function buildFighter(pet: Pet, team: "player" | "enemy", slot: number, x: number, y: number, atkMult = 1, hpMult = 1, reviveOnce = false): Fighter {
    const speed = Math.max(0, pet.speed || 0);
    // hpMult applies the PvE-only Toughened Hide mastery; enemies always pass 1.
    const maxHp = Math.max(1, Math.round((pet.hp || 1) * hpMult));
    const trait = pet.trait;
    const moveSpeed = clamp(2.8 + speed * 0.018, 2.8, 6.2) / DUEL_TPS;   // deliberate traversal — they MOVE across the map, not teleport
    const abilities = (pet.jutsus || []).slice(0, 4).map(buildAbility);
    const hasMelee = abilities.some((a) => a.cls === "melee");
    const hasRanged = abilities.some((a) => a.cls === "ranged");
    const tanky = trait === "Guardian" || abilities.some((a) => a.kind === "shield" || a.kind === "barrier" || a.kind === "absorb" || a.kind === "taunt");
    const role: Fighter["role"] = hasRanged && !hasMelee ? "ranged" : tanky ? "tank" : "melee";
    // Anyone with a ranged ability SKIRMISHES — pokes from distance (basic =
    // projectile) and holds a wider neutral — so hybrids fight at range and only
    // dash in for melee abilities, instead of gluing themselves to the foe.
    const skirmisher = hasRanged;
    const neutralRange = role === "ranged" ? 5.2 : role === "tank" ? 2.5 : skirmisher ? 4.0 : 3.0;
    return {
        id: `${team}-${slot}`, team, slot, pet, element: pet.element,
        x, y, faceX: team === "player" ? 1 : -1, faceY: 0,
        hp: maxHp, maxHp,
        reviveLeft: reviveOnce ? 1 : 0,
        // atkMult applies the PvE damage modifier (e.g. the Pet-Tamer profession
        // bonus); it's a pure scalar input so the sim stays deterministic in
        // (pets, seed, mult). Enemy fighters always pass 1 (no bonus).
        atk: Math.max(0, (pet.attack || 0) * atkMult),
        def: Math.max(0, pet.defense || 0),
        stamina: STAM_MAX,
        moveSpeed, dashSpeed: moveSpeed * 3.2,
        reach: BASIC_REACH,
        state: "idle", stateLeft: 0,
        basicCdLeft: 0, basicCdT: Math.round(DUEL_TPS * 0.5),
        windT: Math.round(DUEL_TPS * clamp(0.42 - speed * 0.0012, 0.16, 0.42)),
        recovT: Math.round(DUEL_TPS * clamp(0.46 - speed * 0.0010, 0.20, 0.46)),
        staggerT: Math.round(DUEL_TPS * 0.35),
        dashT: 7, dodgeT: 6,
        dodgeChance: clamp(0.12 + speed * 0.0008 + (trait === "Swift" ? 0.12 : 0), 0.12, 0.6),
        critChance: CRIT_CHANCE + (trait === "Lucky" ? 0.1 : 0),
        role, neutralRange,
        // Deterministic circling direction: lead/reserve orbit opposite ways,
        // and the two sides counter-rotate, so they wheel around each other.
        strafeDir: (slot % 2 === 0 ? 1 : -1) * (team === "player" ? 1 : -1),
        basicRanged: skirmisher,
        abilities,
        pendingIdx: -2, pendingTargetId: null,
        statuses: emptyStatuses(),
        moveDx: 0, moveDy: 0, targetId: null, repositionLeft: 0,
    };
}

// ── Projectiles ──────────────────────────────────────────────────────────────
interface Projectile {
    id: number;
    ownerId: string;
    team: "player" | "enemy";
    targetId: string;
    abilityIdx: number;
    x: number; y: number;
    speed: number;
    ttl: number;
    element?: string | null;
    kind: PetJutsu["kind"];
}

// ── Output ───────────────────────────────────────────────────────────────────
export interface DuelActorSnap {
    id: string; team: "player" | "enemy"; slot: number;
    x: number; y: number; faceX: number; faceY: number;
    hp: number; maxHp: number; stamina: number; state: DuelState; statuses: string[];
}
export interface DuelProjSnap { id: number; x: number; y: number; team: "player" | "enemy"; kind: PetJutsu["kind"]; element?: string | null; }
export interface DuelSnapshot { t: number; actors: DuelActorSnap[]; projectiles: DuelProjSnap[]; }

export type DuelEventType = "dash" | "dodge" | "windup" | "cast" | "hit" | "whiff" | "stagger" | "heal" | "shield" | "buff" | "ultimate" | "ko";
export interface DuelEvent { t: number; type: DuelEventType; side: "player" | "enemy"; actorId: string; targetId?: string; dmg?: number; crit?: boolean; element?: string | null; kind?: PetJutsu["kind"]; }

export interface DuelResult {
    result: "win" | "loss" | "draw";   // from the PLAYER team's perspective
    winner: "player" | "enemy" | null;
    ticks: number;
    snapshots: DuelSnapshot[];
    events: DuelEvent[];
}

function statusFlags(s: Statuses): string[] {
    const out: string[] = [];
    if (s.burnLeft > 0) out.push("burn");
    if (s.stunLeft > 0) out.push("stun");
    if (s.slowLeft > 0) out.push("slow");
    if (s.hasteLeft > 0) out.push("haste");
    if (s.rootLeft > 0) out.push("root");
    if (s.shieldHp > 0) out.push("shield");
    if (s.buffLeft > 0 && s.buffMag > 0) out.push("buff");
    if (s.buffLeft > 0 && s.buffMag < 0) out.push("debuff");
    if (s.marked) out.push("mark");
    return out;
}
function snap(t: number, fighters: Fighter[], projectiles: Projectile[]): DuelSnapshot {
    return {
        t,
        actors: fighters.map((f) => ({
            id: f.id, team: f.team, slot: f.slot,
            x: f.x, y: f.y, faceX: f.faceX, faceY: f.faceY,
            hp: Math.max(0, f.hp), maxHp: f.maxHp, stamina: f.stamina, state: f.state, statuses: statusFlags(f.statuses),
        })),
        projectiles: projectiles.map((p) => ({ id: p.id, x: p.x, y: p.y, team: p.team, kind: p.kind, element: p.element })),
    };
}

// ── Targeting ────────────────────────────────────────────────────────────────
function dist2(a: Fighter, bx: number, by: number): number {
    const dx = bx - a.x, dy = by - a.y; return dx * dx + dy * dy;
}
function pickTarget(f: Fighter, fighters: Fighter[]): Fighter | null {
    // Taunt override (2v2): forced to the taunter while it lives.
    if (f.statuses.tauntById) {
        const t = fighters.find((g) => g.id === f.statuses.tauntById && g.hp > 0);
        if (t) return t;
    }
    // LANE DISCIPLINE (2v2): fight your OWN lane opponent (same slot) while it
    // lives, so the battle splits into two separate lane duels — top lane (lead
    // vs lead) and bottom lane (reserve vs reserve) — instead of all four piling
    // onto one target in a center scrum. Only when a lane opponent falls does the
    // pet collapse to help the other lane (the lowest-HP pick below).
    const laneFoe = fighters.find((g) => g.team !== f.team && g.slot === f.slot && g.hp > 0);
    if (laneFoe) return laneFoe;
    let best: Fighter | null = null, bestKey = Infinity;
    for (const g of fighters) {
        if (g.team === f.team || g.hp <= 0) continue;
        // Focus the lowest HP; tiebreak nearest; final tiebreak by id (stable).
        const key = g.hp * 1e6 + dist2(f, g.x, g.y);
        if (key < bestKey || (key === bestKey && best && g.id < best.id)) { bestKey = key; best = g; }
    }
    return best;
}
function pickAlly(f: Fighter, fighters: Fighter[]): Fighter {
    let best = f, bestFrac = f.hp / f.maxHp;
    for (const g of fighters) {
        if (g.team !== f.team || g.hp <= 0) continue;
        const frac = g.hp / g.maxHp;
        if (frac < bestFrac || (frac === bestFrac && g.id < best.id)) { bestFrac = frac; best = g; }
    }
    return best;
}
function teamAlive(fighters: Fighter[], team: "player" | "enemy"): boolean {
    return fighters.some((f) => f.team === team && f.hp > 0);
}

// ── Hit / cast resolution ────────────────────────────────────────────────────
function applyDamage(att: Fighter, tgt: Fighter, ab: Ability | null, rng: () => number, t: number, events: DuelEvent[], viaProjectile: boolean) {
    if (tgt.hp <= 0) return;
    const crit = rng() < att.critChance;
    const powerScale = ab ? ab.power / 100 : 1;
    const buff = att.statuses.buffLeft > 0 ? 1 + att.statuses.buffMag : 1;
    let mult = elementMult(att.element, tgt.element) * (crit ? 1.6 : 1) * Math.max(0.3, buff);
    if (tgt.statuses.marked) { mult *= 1.4; tgt.statuses.marked = false; }
    const mitigation = clamp(1 - tgt.def * 0.0012, 0.35, 1);
    const base = att.atk * DMG_SCALE * powerScale;
    let dmg = Math.max(1, Math.round(base * mult * mitigation));
    // Shield soak.
    if (tgt.statuses.shieldHp > 0) {
        const soak = Math.min(tgt.statuses.shieldHp, dmg);
        tgt.statuses.shieldHp = quant(tgt.statuses.shieldHp - soak);
        dmg -= soak;
    }
    tgt.hp -= dmg;
    events.push({ t, type: "hit", side: att.team, actorId: att.id, targetId: tgt.id, dmg, crit, element: att.element, kind: ab ? ab.kind : "damage" });

    // On-hit effects by ability kind.
    if (ab) applyOnHit(att, tgt, ab);

    // Lifesteal heal.
    if (ab && ab.kind === "lifesteal") att.hp = Math.min(att.maxHp, att.hp + Math.round(dmg * 0.5));

    // Knockback + interrupt — big enough to visibly reset the spacing after a
    // melee blow (projectiles shove lighter; push doubles it).
    const dx = tgt.x - att.x, dy = tgt.y - att.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const kb = (crit ? 1.7 : 1.1) * (viaProjectile ? 0.4 : 1) * (ab && ab.kind === "push" ? 2 : 1);
    if (d > 1e-6) { tgt.x += (dx / d) * kb; tgt.y += (dy / d) * kb; }
    if (ab && ab.kind === "pull" && d > 1e-6) { tgt.x -= (dx / d) * 1.2; tgt.y -= (dy / d) * 1.2; }
    if ((tgt.state === "idle" || tgt.state === "dash" || tgt.state === "windup") && tgt.statuses.stunLeft <= 0) {
        tgt.state = "stagger"; tgt.stateLeft = att.staggerT;
        events.push({ t, type: "stagger", side: tgt.team, actorId: tgt.id });
    }
}

function applyOnHit(att: Fighter, tgt: Fighter, ab: Ability) {
    const s = tgt.statuses;
    const dur = statusTicks(ab);
    switch (ab.kind) {
        case "burn": case "dot":
            s.burnLeft = Math.max(s.burnLeft, dur); s.burnDmg = Math.max(s.burnDmg, Math.max(1, Math.round(att.atk * 0.12 * (ab.power / 100)))); break;
        case "wound":
            s.burnLeft = Math.max(s.burnLeft, dur); s.burnDmg = Math.max(s.burnDmg, Math.max(1, Math.round(att.atk * 0.1))); s.halfHeal = true; break;
        case "freeze": case "stun": case "confuse":
            s.stunLeft = Math.max(s.stunLeft, ab.kind === "stun" ? dur : Math.round(dur * 0.7)); break;
        case "slow":
            s.slowLeft = Math.max(s.slowLeft, dur); break;
        case "mark":
            s.marked = true; break;
        case "crush": case "debuff":
            s.buffLeft = Math.max(s.buffLeft, dur); s.buffMag = Math.min(s.buffMag, -0.25); break;
        case "movelock":
            s.rootLeft = Math.max(s.rootLeft, dur); break;
        case "taunt":
            s.tauntById = att.id; break;
        default: break;
    }
}

function castSupport(f: Fighter, ab: Ability, fighters: Fighter[], t: number, events: DuelEvent[]) {
    const ally = pickAlly(f, fighters);
    if (ab.kind === "heal") {
        // Heal sustains a hurt ally. SOLO (1v1, or the partner is down) it's the
        // support pet's lifeline — boosted so a sage can outlast and win the
        // HP-fraction timeout instead of being dead weight (harness: lifted sage
        // 1v1 from ~17% toward ~30%). With a LIVING ally it stays at the
        // 2v2-balanced rate so team healers aren't oppressive — the 1v1 harness
        // can't see 2v2, so that path stays conservative. No persisted-stat change.
        const hasAlly = fighters.some((g) => g.team === f.team && g.id !== f.id && g.hp > 0);
        const healFrac = hasAlly ? 0.16 : 0.45;
        const heal = Math.round(f.maxHp * healFrac * (ab.power / 100)) * (ally.statuses.halfHeal ? 0.5 : 1);
        ally.hp = Math.min(ally.maxHp, ally.hp + Math.max(1, Math.round(heal)));
        events.push({ t, type: "heal", side: f.team, actorId: f.id, targetId: ally.id, dmg: Math.round(heal) });
    } else if (ab.kind === "shield" || ab.kind === "barrier" || ab.kind === "absorb") {
        ally.statuses.shieldHp = Math.max(ally.statuses.shieldHp, Math.round(ally.maxHp * 0.2 * (ab.power / 100)));
        events.push({ t, type: "shield", side: f.team, actorId: f.id, targetId: ally.id });
    } else if (ab.kind === "buff") {
        const tgt = f; // self-buff
        tgt.statuses.buffLeft = statusTicks(ab); tgt.statuses.buffMag = Math.max(tgt.statuses.buffMag, 0.25);
        events.push({ t, type: "buff", side: f.team, actorId: f.id, targetId: tgt.id });
    } else if (ab.kind === "haste") {
        f.statuses.hasteLeft = statusTicks(ab);
        events.push({ t, type: "buff", side: f.team, actorId: f.id, targetId: f.id });
    }
}

// ── Decision + motion ────────────────────────────────────────────────────────
function moveToward(f: Fighter, tx: number, ty: number, spd: number, stopAt: number) {
    const dx = tx - f.x, dy = ty - f.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 1e-6) return;
    f.faceX = dx / d; f.faceY = dy / d;
    const s = Math.min(spd, Math.max(0, d - stopAt));
    if (s <= 0) return;
    tryMove(f, f.x + (dx / d) * s, f.y + (dy / d) * s);
}

// ── Walkability grid — pets may only stand on STONE PATHS + WOODEN BRIDGES (the
// baked mask classified from the diorama art); grass/clumps, water, seals, walls,
// structures and shadow are SOLID. Pets BFS along the paths to reach the foe and
// SLIDE along edges, so they route the terrain instead of cutting through it.
// Sim-only + deterministic (static mask, fixed scan order).
const GCOLS = WALK_COLS, GROWS = WALK_ROWS;
const CELL_X = (ARENA_X * 2) / GCOLS;
const CELL_Y = (ARENA_Y * 2) / GROWS;
const cellOf = (x: number, y: number): [number, number] => [
    clamp(Math.floor((x + ARENA_X) / CELL_X), 0, GCOLS - 1),
    clamp(Math.floor((y + ARENA_Y) / CELL_Y), 0, GROWS - 1),
];
const cellCenter = (c: number, r: number): [number, number] => [(c + 0.5) * CELL_X - ARENA_X, (r + 0.5) * CELL_Y - ARENA_Y];
const maskAt = (c: number, r: number) => WALK_MASK.charCodeAt(r * GCOLS + c) === 49; // '1'
// FAIRNESS: the baked diorama mask is ~26% left-right asymmetric, which biased
// the fixed-spawn duel toward one side (the player is ALWAYS the left team in PvE,
// so an asymmetric map silently rigs the fight). We symmetrize the COLLISION the
// duel uses — a cell is walkable if it OR its mirror column is — so both fighters
// face identical terrain. Deterministic; the painted backdrop is unchanged (a pet
// may occasionally cross where art shows a rock on one side — a minor visual nit
// for an even fight). The tactical-arena mode keeps the raw asymmetric mask.
const cellWalkable = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < GCOLS && r < GROWS && (maskAt(c, r) || maskAt(GCOLS - 1 - c, r));
const cellBlocked = (c: number, r: number) => !cellWalkable(c, r);
/** Is (x,y) on a walkable path tile (and inside the arena)? */
function walkableAt(x: number, y: number): boolean {
    if (x < -ARENA_X || x > ARENA_X || y < -ARENA_Y || y > ARENA_Y) return false;
    return cellWalkable(Math.floor((x + ARENA_X) / CELL_X), Math.floor((y + ARENA_Y) / CELL_Y));
}
/** Step toward (nx,ny) but only onto walkable tiles — SLIDE along an edge if the
 *  diagonal is blocked, stay put if both axes are. Keeps pets ON the paths. */
function tryMove(f: Fighter, nx: number, ny: number) {
    if (walkableAt(nx, ny)) { f.x = nx; f.y = ny; }
    else if (walkableAt(nx, f.y)) { f.x = nx; }
    else if (walkableAt(f.x, ny)) { f.y = ny; }
}
/** Snap a fighter onto the nearest walkable tile (spawn placement + a backstop
 *  for dash / separation overshoot). Deterministic ring scan. */
function snapToWalkable(f: Fighter) {
    if (walkableAt(f.x, f.y)) return;
    const [c0, r0] = cellOf(f.x, f.y);
    for (let rad = 1; rad <= GCOLS + GROWS; rad++) {
        for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
            if (cellWalkable(c0 + dc, r0 + dr)) { const [wx, wy] = cellCenter(c0 + dc, r0 + dr); f.x = wx; f.y = wy; return; }
        }
    }
}
const BFS_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Next grid cell to step toward to reach (tc,tr) from (fc,fr), avoiding blocked
 *  cells. BFS outward from the TARGET so each visited cell records the neighbour
 *  one step closer to the goal; returns the step out of the source cell. */
function bfsNextStep(fc: number, fr: number, tc: number, tr: number): [number, number] | null {
    if (fc === tc && fr === tr) return null;
    const came = new Map<number, number>();
    const start = tr * GCOLS + tc;
    came.set(start, -1);
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
        const cur = queue[head++];
        const cc = cur % GCOLS, cr = (cur - cc) / GCOLS;
        if (cc === fc && cr === fr) { const nxt = came.get(cur); return nxt === undefined || nxt < 0 ? null : [nxt % GCOLS, (nxt - (nxt % GCOLS)) / GCOLS]; }
        for (const [dc, dr] of BFS_DIRS) {
            const nc = cc + dc, nr = cr + dr;
            if (cellBlocked(nc, nr)) continue;
            if (dc !== 0 && dr !== 0 && (cellBlocked(cc + dc, cr) || cellBlocked(cc, cr + dr))) continue; // no corner-cut
            const ni = nr * GCOLS + nc;
            if (!came.has(ni)) { came.set(ni, cur); queue.push(ni); }
        }
    }
    return null;
}

/** Is the straight line a→b clear of terrain? (drives "traverse the grid" vs
 *  "engage directly".) */
function hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax, dy = by - ay;
    const d = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(d / (CELL_X * 0.6));
    for (let i = 1; i < steps; i++) {
        const tt = i / steps;
        if (!walkableAt(ax + dx * tt, ay + dy * tt)) return false;   // a non-path tile blocks the shot
    }
    return true;
}

/** Run toward the foe along the grid (around terrain) until there's a clear shot. */
function traverseGrid(f: Fighter, target: Fighter, spd: number) {
    const [fc, fr] = cellOf(f.x, f.y);
    const [tc, tr] = cellOf(target.x, target.y);
    const nxt = bfsNextStep(fc, fr, tc, tr);
    if (!nxt) { moveToward(f, target.x, target.y, spd, 0); return; }
    const [wx, wy] = cellCenter(nxt[0], nxt[1]);
    moveToward(f, wx, wy, spd, 0.05);
    f.faceX = target.x - f.x; f.faceY = target.y - f.y;     // still face the foe while routing
    const fl = Math.sqrt(f.faceX * f.faceX + f.faceY * f.faceY) || 1;
    f.faceX /= fl; f.faceY /= fl;
}

function effMoveSpeed(f: Fighter): number {
    let s = f.moveSpeed;
    if (f.statuses.slowLeft > 0) s *= 0.6;
    if (f.statuses.hasteLeft > 0) s *= 1.4;
    return s;
}

/** Commit toward `target`, stopping `stopAt` short. The long traversal across
 *  the map is a free RUN (so the pet arrives with stamina for its abilities); a
 *  DASH is spent only for the final ~lunge into range — an explosive close, not
 *  a stamina-burning sprint the whole way. */
function commitApproach(f: Fighter, target: Fighter, dist: number, inv: number, stopAt: number, canDash: boolean, t: number, events: DuelEvent[]) {
    const gap = dist - stopAt;
    if (canDash && gap > 0.7 && gap < 4.5 && f.stamina >= COST_DASH && f.basicCdLeft <= 0) {
        f.moveDx = (target.x - f.x) * inv; f.moveDy = (target.y - f.y) * inv;
        f.stamina -= COST_DASH;
        f.state = "dash"; f.stateLeft = f.dashT;
        events.push({ t, type: "dash", side: f.team, actorId: f.id });
        return;
    }
    moveToward(f, target.x, target.y, effMoveSpeed(f), stopAt);
}

/** Hold the engagement bubble: correct toward the role's neutral distance and
 *  circle the target (the "sizing each other up" read). NOT a pile-in. */
function holdNeutral(f: Fighter, target: Fighter, dist: number, inv: number, dx: number, dy: number) {
    if (f.statuses.rootLeft > 0) { f.faceX = dx * inv; f.faceY = dy * inv; return; }
    const speed = effMoveSpeed(f);
    const err = dist - f.neutralRange;
    let mx = 0, my = 0;
    if (Math.abs(err) > 0.12) {                       // radial: toward if too far, away if too close
        const radial = err > 0 ? 1 : -1;
        mx += dx * inv * radial * speed;
        my += dy * inv * radial * speed;
    }
    const px = -dy * inv, py = dx * inv;              // tangential: circle the foe
    mx += px * speed * 0.55 * f.strafeDir;
    my += py * speed * 0.55 * f.strafeDir;
    mx += -f.x * 0.003;                               // gentle pull to keep the fight centered
    my += -f.y * 0.003;
    tryMove(f, f.x + mx, f.y + my);
    f.faceX = dx * inv; f.faceY = dy * inv;
}

/** Choose + begin an action for an idle fighter. The loop is: hold a neutral
 *  spacing while attacks recharge → commit a clear lunge/cast when one is ready
 *  → (after recover + cooldown) drop back to neutral. That cadence is what reads
 *  as fighting instead of a center-pile. */
function decide(f: Fighter, fighters: Fighter[], projectiles: Projectile[], rng: () => number, t: number, events: DuelEvent[]) {
    // Support first: heal a hurt ally, or buff/shield if not already. But when the
    // pet has NO living ally but itself (1v1, or its partner has fallen), it used
    // to over-invest in self-support and got out-DPS'd — the balance harness showed
    // support pets (sage) dealing ~37% less damage and timing out 2× as often. So
    // SOLO it heals/shields only when genuinely LOW, freeing turns to fight, while
    // with a real ally it keeps the proactive support (2v2 healer role intact). The
    // atk BUFF stays in both cases — it raises the solo pet's own damage.
    const hasAlly = fighters.some((g) => g.team === f.team && g.id !== f.id && g.hp > 0);
    const healThresh = hasAlly ? 0.55 : 0.4;
    const shieldThresh = hasAlly ? 0.7 : 0.45;
    for (let i = 0; i < f.abilities.length; i++) {
        const ab = f.abilities[i];
        if (ab.cls !== "support" || ab.cdLeft > 0 || f.stamina < ab.cost) continue;
        const ally = pickAlly(f, fighters);
        const wantHeal = ab.kind === "heal" && ally.hp / ally.maxHp < healThresh;
        const wantBuff = (ab.kind === "buff" || ab.kind === "haste") && f.statuses.buffLeft <= 0 && f.statuses.hasteLeft <= 0;
        const wantShield = (ab.kind === "shield" || ab.kind === "barrier" || ab.kind === "absorb") && ally.statuses.shieldHp <= 0 && ally.hp / ally.maxHp < shieldThresh;
        if (wantHeal || wantBuff || wantShield) { beginCast(f, i, f.id, t, events); return; }
    }

    const target = pickTarget(f, fighters);
    f.targetId = target ? target.id : null;
    if (!target) return;
    const dx = target.x - f.x, dy = target.y - f.y;
    const dist = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
    const inv = 1 / dist;

    // No clear shot (terrain in the way)? → TRAVERSE the grid around it. The pet
    // only enters the combat behaviour below once it has line of sight, so it
    // routes through the battlefield instead of fighting through a rock.
    if (!hasLineOfSight(f.x, f.y, target.x, target.y)) {
        if (f.statuses.rootLeft <= 0) traverseGrid(f, target, effMoveSpeed(f));
        return;
    }

    // Reactive dodge vs a telegraphed strike or an incoming projectile.
    const threatened = (target.state === "windup" && dist < f.reach + 0.9) || incomingProjectile(f, projectiles);
    if (threatened && f.stamina >= COST_DODGE && f.statuses.rootLeft <= 0 && rng() < f.dodgeChance) {
        let px = -dy * inv, py = dx * inv;
        if (f.y + py * 1.5 > ARENA_Y || f.y + py * 1.5 < -ARENA_Y) { px = -px; py = -py; }
        f.moveDx = px; f.moveDy = py; f.stamina -= COST_DODGE;
        f.state = "dodge"; f.stateLeft = f.dodgeT;
        events.push({ t, type: "dodge", side: f.team, actorId: f.id });
        return;
    }

    // SIGNATURE / ULTIMATE has priority: once it's off cooldown, commit to it —
    // and if the pet can't afford it yet, HOLD and bank stamina rather than
    // frittering it on basics (otherwise the cheap attack starves the ultimate
    // and it never fires). Makes the ultimate a real charged-up moment.
    const sigIdx = f.abilities.findIndex((a) => a.signature && a.cdLeft <= 0);
    if (sigIdx >= 0) {
        const ab = f.abilities[sigIdx];
        if (f.stamina >= ab.cost) {
            if (dist <= ab.range) { beginCast(f, sigIdx, target.id, t, events); return; }
            commitApproach(f, target, dist, inv, ab.range * 0.92, ab.cls === "melee", t, events);
            return;
        }
        holdNeutral(f, target, dist, inv, dx, dy);   // bank stamina for the unleash
        return;
    }

    // Hit-and-reposition: after attacking, don't re-LUNGE for a beat — but keep
    // poking with a ready ranged ability from the current spacing (kite + harass).
    // That's what makes the fight read as tactical (circle + strike) rather than a
    // glued face-smash, while still letting skirmishers harass at range.
    if (f.repositionLeft > 0) {
        f.repositionLeft--;
        for (let i = 0; i < f.abilities.length; i++) {
            const ab = f.abilities[i];
            if (ab.cls === "ranged" && ab.cdLeft <= 0 && f.stamina >= ab.cost && dist <= ab.range) { beginCast(f, i, target.id, t, events); return; }
        }
        holdNeutral(f, target, dist, inv, dx, dy);
        return;
    }

    // The best READY offensive ability (regardless of range — we'll close to it).
    let chosen = -1, chosenScore = -1;
    for (let i = 0; i < f.abilities.length; i++) {
        const ab = f.abilities[i];
        if (ab.cls === "support" || ab.cdLeft > 0 || f.stamina < ab.cost) continue;
        const score = (ab.signature ? 1000 : 0) + ab.power + (ab.cls === "ranged" ? 5 : 0);
        if (score > chosenScore) { chosenScore = score; chosen = i; }
    }
    if (chosen >= 0) {
        const ab = f.abilities[chosen];
        if (dist <= ab.range) { beginCast(f, chosen, target.id, t, events); return; }
        commitApproach(f, target, dist, inv, ab.range * 0.92, ab.cls === "melee", t, events);
        return;
    }

    // Basic attack ready → commit. Ranged role pokes from range; everyone else
    // lunges into melee. (Ranged never melee-lunges → it keeps kiting.)
    const basicRange = f.basicRanged ? RANGED_RANGE * 0.85 : f.reach + 0.05;
    if (f.basicCdLeft <= 0 && f.stamina >= COST_BASIC) {
        if (dist <= basicRange) { beginCast(f, -1, target.id, t, events); return; }
        if (!f.basicRanged) { commitApproach(f, target, dist, inv, f.reach * 0.9, true, t, events); return; }
        // ranged basic but out of poke range → step in a little, no lunge
        moveToward(f, target.x, target.y, effMoveSpeed(f), basicRange * 0.95);
        return;
    }

    // NEUTRAL: nothing ready → hold spacing + circle.
    holdNeutral(f, target, dist, inv, dx, dy);
}

function beginCast(f: Fighter, idx: number, targetId: string, t: number, events: DuelEvent[]) {
    f.pendingIdx = idx; f.pendingTargetId = targetId;
    f.state = "windup";
    f.stateLeft = idx >= 0 ? f.abilities[idx].castTicks : f.windT;
    if (idx >= 0 && f.abilities[idx].signature) events.push({ t, type: "ultimate", side: f.team, actorId: f.id });
    else if (idx >= 0 && f.abilities[idx].cls === "support") events.push({ t, type: "cast", side: f.team, actorId: f.id, kind: f.abilities[idx].kind });
    else events.push({ t, type: "windup", side: f.team, actorId: f.id, kind: idx >= 0 ? f.abilities[idx].kind : "damage" });
}

/** Resolve a wind-up that just finished. */
function resolveCast(f: Fighter, fighters: Fighter[], projectiles: Projectile[], nextProjId: { n: number }, rng: () => number, t: number, events: DuelEvent[]) {
    const idx = f.pendingIdx;
    const ab = idx >= 0 ? f.abilities[idx] : null;
    if (ab) { ab.cdLeft = ab.cdTicks; f.stamina -= ab.cost; } else { f.basicCdLeft = f.basicCdT; f.stamina -= COST_BASIC; }

    if (ab && ab.cls === "support") { castSupport(f, ab, fighters, t, events); return; }

    if (ab && ab.cls === "ranged") {
        // Spawn a homing projectile at each target (aoe → all enemies, else one).
        const targets = ab.aoe ? fighters.filter((g) => g.team !== f.team && g.hp > 0) : [fighters.find((g) => g.id === f.pendingTargetId && g.hp > 0)].filter(Boolean) as Fighter[];
        for (const tgt of targets) {
            projectiles.push({
                id: nextProjId.n++, ownerId: f.id, team: f.team, targetId: tgt.id, abilityIdx: idx,
                x: f.x, y: f.y, speed: 0.34, ttl: Math.round(DUEL_TPS * 3), element: f.element, kind: ab.kind,
            });
        }
        events.push({ t, type: "cast", side: f.team, actorId: f.id, kind: ab.kind });
        return;
    }

    // Ranged-role BASIC: a small poke projectile (abilityIdx -1 → plain damage).
    if (!ab && f.basicRanged) {
        const tgt = fighters.find((g) => g.id === f.pendingTargetId && g.hp > 0);
        if (tgt) {
            projectiles.push({ id: nextProjId.n++, ownerId: f.id, team: f.team, targetId: tgt.id, abilityIdx: -1, x: f.x, y: f.y, speed: 0.34, ttl: Math.round(DUEL_TPS * 3), element: f.element, kind: "damage" });
            events.push({ t, type: "cast", side: f.team, actorId: f.id, kind: "damage" });
        }
        return;
    }

    // Melee ability or basic: resolve at contact vs the pending target (+ aoe).
    const primary = fighters.find((g) => g.id === f.pendingTargetId);
    const hitList = ab && ab.aoe ? fighters.filter((g) => g.team !== f.team && g.hp > 0) : primary ? [primary] : [];
    let landed = false;
    for (const tgt of hitList) {
        const dx = tgt.x - f.x, dy = tgt.y - f.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const facingOK = f.faceX * dx + f.faceY * dy > 0;
        const range = ab ? ab.range : f.reach + 0.35;
        if (tgt.hp > 0 && d <= range + 0.35 && facingOK) { applyDamage(f, tgt, ab, rng, t, events, false); landed = true; }
    }
    if (!landed) events.push({ t, type: "whiff", side: f.team, actorId: f.id });
}

function incomingProjectile(f: Fighter, projectiles: Projectile[]): boolean {
    for (const p of projectiles) {
        if (p.team === f.team) continue;
        if (p.targetId !== f.id) continue;
        if (dist2(f, p.x, p.y) < 1.4 * 1.4) return true;
    }
    return false;
}

function stepProjectiles(fighters: Fighter[], projectiles: Projectile[], rng: () => number, t: number, events: DuelEvent[]) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        const owner = fighters.find((g) => g.id === p.ownerId)!;
        const tgt = fighters.find((g) => g.id === p.targetId && g.hp > 0);
        if (!tgt) { // target died → fizzle toward last heading; just expire
            if (--p.ttl <= 0) { projectiles.splice(i, 1); continue; }
        }
        if (tgt) {
            const dx = tgt.x - p.x, dy = tgt.y - p.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d <= 0.7) {
                const ab = owner.abilities[p.abilityIdx] ?? null;
                applyDamage(owner, tgt, ab, rng, t, events, true);
                projectiles.splice(i, 1); continue;
            }
            if (d > 1e-6) { p.x += (dx / d) * p.speed; p.y += (dy / d) * p.speed; }
        }
        p.x = quant(p.x); p.y = quant(p.y);
        if (--p.ttl <= 0) projectiles.splice(i, 1);
    }
}

function tickStatuses(f: Fighter) {
    const s = f.statuses;
    // Burn DoT ticks every ~0.4s. (taunt is honored only while the taunter
    // lives — see pickTarget — so it needs no explicit timer here.)
    if (s.burnLeft > 0) {
        if (s.burnLeft % Math.round(DUEL_TPS * 0.4) === 0) f.hp -= s.burnDmg;
        if (--s.burnLeft <= 0) { s.burnDmg = 0; s.halfHeal = false; }
    }
    if (s.stunLeft > 0) s.stunLeft--;
    if (s.slowLeft > 0) s.slowLeft--;
    if (s.hasteLeft > 0) s.hasteLeft--;
    if (s.rootLeft > 0) s.rootLeft--;
    if (s.buffLeft > 0 && --s.buffLeft <= 0) s.buffMag = 0;
}

function step(f: Fighter, fighters: Fighter[], projectiles: Projectile[], nextProjId: { n: number }, rng: () => number, t: number, events: DuelEvent[]) {
    if (f.state === "dead" || f.hp <= 0) return;
    if (f.basicCdLeft > 0) f.basicCdLeft--;
    for (const ab of f.abilities) if (ab.cdLeft > 0) ab.cdLeft--;
    if (f.stamina < STAM_MAX) f.stamina = Math.min(STAM_MAX, f.stamina + STAM_REGEN);

    // Stun freezes everything except status/cd ticks.
    if (f.statuses.stunLeft > 0) { f.x = clamp(f.x, -ARENA_X, ARENA_X); f.y = clamp(f.y, -ARENA_Y, ARENA_Y); return; }

    switch (f.state) {
        case "idle":
            decide(f, fighters, projectiles, rng, t, events);
            break;
        case "dash":
            tryMove(f, f.x + f.moveDx * f.dashSpeed, f.y + f.moveDy * f.dashSpeed); f.faceX = f.moveDx; f.faceY = f.moveDy;
            if (--f.stateLeft <= 0) f.state = "idle";
            break;
        case "dodge":
            tryMove(f, f.x + f.moveDx * f.dashSpeed * 0.85, f.y + f.moveDy * f.dashSpeed * 0.85);
            if (--f.stateLeft <= 0) f.state = "idle";
            break;
        case "windup":
            if (--f.stateLeft <= 0) { resolveCast(f, fighters, projectiles, nextProjId, rng, t, events); f.state = "strike"; f.stateLeft = 1; }
            break;
        case "strike":
            if (--f.stateLeft <= 0) { f.state = "recover"; f.stateLeft = f.recovT; }
            break;
        case "recover":
            if (--f.stateLeft <= 0) { f.state = "idle"; f.repositionLeft = Math.round(DUEL_TPS * 0.3); }
            break;
        case "stagger":
            if (--f.stateLeft <= 0) f.state = "idle";
            break;
    }
    f.x = clamp(f.x, -ARENA_X, ARENA_X);
    f.y = clamp(f.y, -ARENA_Y, ARENA_Y);
}

function separateAll(fighters: Fighter[]) {
    for (let i = 0; i < fighters.length; i++) {
        for (let j = i + 1; j < fighters.length; j++) {
            const a = fighters[i], b = fighters[j];
            if (a.hp <= 0 || b.hp <= 0) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d >= MIN_SEP) continue;
            const push = (MIN_SEP - d) / 2;
            if (d > 1e-6) { const ux = dx / d, uy = dy / d; a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push; }
            else { a.x -= push; b.x += push; }
            a.x = clamp(a.x, -ARENA_X, ARENA_X); a.y = clamp(a.y, -ARENA_Y, ARENA_Y);
            b.x = clamp(b.x, -ARENA_X, ARENA_X); b.y = clamp(b.y, -ARENA_Y, ARENA_Y);
        }
    }
}

function quantizeFighter(f: Fighter) {
    f.x = quant(f.x); f.y = quant(f.y); f.stamina = quant(f.stamina);
    f.faceX = quant(f.faceX); f.faceY = quant(f.faceY);
    f.statuses.shieldHp = quant(f.statuses.shieldHp);
}

/** The shared deterministic core. `fighters` must be in fixed build order. */
function simulate(fighters: Fighter[], seed: number): DuelResult {
    const rng = makeRng(seed);
    const projectiles: Projectile[] = [];
    const nextProjId = { n: 0 };
    const snapshots: DuelSnapshot[] = [];
    const events: DuelEvent[] = [];
    let ticks = 0;
    let winner: "player" | "enemy" | null = null;
    for (const f of fighters) snapToWalkable(f);   // every fighter starts on a walkable path tile

    for (let t = 0; t < MAX_TICKS; t++) {
        ticks = t + 1;
        for (const f of fighters) step(f, fighters, projectiles, nextProjId, rng, t, events);
        stepProjectiles(fighters, projectiles, rng, t, events);
        for (const f of fighters) tickStatuses(f);
        separateAll(fighters);
        for (const f of fighters) {
            // PvE-only Alpha Bond mastery: the lead pet revives once at 40% HP
            // instead of dying. Deterministic — reviveLeft is a sealed input.
            if (f.hp <= 0 && f.state !== "dead" && f.reviveLeft > 0) {
                f.reviveLeft -= 1;
                f.hp = Math.max(1, Math.round(f.maxHp * 0.4));
            }
            if (f.hp <= 0 && f.state !== "dead") f.state = "dead";
            snapToWalkable(f);
            quantizeFighter(f);
        }
        snapshots.push(snap(t, fighters, projectiles));

        const pAlive = teamAlive(fighters, "player"), eAlive = teamAlive(fighters, "enemy");
        if (!pAlive || !eAlive) {
            winner = pAlive && !eAlive ? "player" : eAlive && !pAlive ? "enemy" : null;
            events.push({ t, type: "ko", side: winner === "player" ? "enemy" : "player", actorId: "" });
            break;
        }
    }

    if (winner === null && teamAlive(fighters, "player") && teamAlive(fighters, "enemy")) {
        const frac = (team: "player" | "enemy") => {
            let hp = 0, max = 0;
            for (const f of fighters) if (f.team === team) { hp += Math.max(0, f.hp); max += f.maxHp; }
            return max > 0 ? hp / max : 0;
        };
        const pf = frac("player"), ef = frac("enemy");
        winner = Math.abs(pf - ef) < 1e-6 ? null : pf > ef ? "player" : "enemy";
    }

    const result: DuelResult["result"] = winner === "player" ? "win" : winner === "enemy" ? "loss" : "draw";
    return { result, winner, ticks, snapshots, events };
}

// ── Public entry points ──────────────────────────────────────────────────────

/** 1v1 — result from the player pet's perspective. Deterministic in (pets, seed).
 *  Spawned at opposite ends of the big map (near their team shrines) so the fight
 *  opens with a real traversal toward each other. */
export function runPetDuel(playerPet: Pet, enemyPet: Pet, seed: number, playerDamageMult = 1, playerHpMult = 1, playerReviveOnce = false): DuelResult {
    // Calibrated 1v1 spawns (map-space Blue[1] / Red[1]): blue on the left front
    // path, red on the right front path; they traverse inward — weaving the clump
    // band — to clash in the front-center of the arena.
    const fighters = [
        buildFighter(playerPet, "player", 0, -10.2, 2.8, playerDamageMult, playerHpMult, playerReviveOnce),
        buildFighter(enemyPet, "enemy", 0, 10.2, 2.8),
    ];
    return simulate(fighters, seed);
}

/** 2v2 — player lead+reserve vs enemy lead+reserve. Reserve may be null (→ 2v1).
 *  Deterministic in (pets, seed); result from the player team's perspective.
 *  Each side spawns spread across its end so the four converge from the corners. */
export function runPetPartyDuel(
    playerLead: Pet, playerReserve: Pet | null,
    enemyLead: Pet, enemyReserve: Pet | null,
    seed: number, playerDamageMult = 1, playerHpMult = 1, playerReviveOnce = false,
): DuelResult {
    // Two lane duels: the LEAD pair on the FRONT lane (map-space Blue[1]/Red[1]),
    // the RESERVE pair on the BACK lane (Blue[3]/Red[3]) — spread apart so the 2v2
    // reads as two duels, not a clump. Slot targeting pairs lead-v-lead, reserve-v-reserve.
    // Toughened Hide (hpMult) buffs both player pets; Alpha Bond (revive) only the lead.
    const fighters: Fighter[] = [buildFighter(playerLead, "player", 0, -10.2, 2.8, playerDamageMult, playerHpMult, playerReviveOnce)];
    if (playerReserve) fighters.push(buildFighter(playerReserve, "player", 1, -9.6, -3.0, playerDamageMult, playerHpMult, false));
    fighters.push(buildFighter(enemyLead, "enemy", 0, 10.2, 2.8));
    if (enemyReserve) fighters.push(buildFighter(enemyReserve, "enemy", 1, 9.6, -3.0));
    return simulate(fighters, seed);
}
