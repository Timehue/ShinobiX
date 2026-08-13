/*
 * Pet Showdown — server-authoritative turn engine.
 *
 * This engine exists ONLY on the server (there is no client mirror, no parity
 * generator, no input-log replay). Each round the handler feeds it the player's
 * validated commands plus the AI's commands and it returns the TURN SCRIPT
 * (ShowdownEvent[]) the client plays back. All combat numbers originate here.
 *
 * Determinism: pure function of (session state, commands). Randomness comes
 * only from the session's own mulberry32 rng state, which advances inside the
 * session object — so a persisted session replays identically after a crash,
 * and no Math.random/Date ever runs in combat.
 */

import {
    SHOWDOWN_COST_BASIC,
    SHOWDOWN_COST_CONTROL_FLOOR,
    SHOWDOWN_COST_MAX,
    SHOWDOWN_COST_MIN,
    SHOWDOWN_COST_PER_POWER,
    SHOWDOWN_COST_SUSTAIN_FLOOR,
    SHOWDOWN_HEAVY_COST_PREMIUM,
    SHOWDOWN_HEAVY_PROMOTE_MULT,
    SHOWDOWN_ELEMENT_ADVANTAGE,
    SHOWDOWN_ELEMENT_BEATS,
    SHOWDOWN_ELEMENT_DISADVANTAGE,
    SHOWDOWN_FORMAT_SIZE,
    SHOWDOWN_GUARD_COST,
    SHOWDOWN_GUARD_MULT,
    SHOWDOWN_HOLD_HEAVY,
    SHOWDOWN_HOLD_SUPER,
    SHOWDOWN_MAX_TEAM,
    showdownAttritionPct,
    showdownHealScale,
    SHOWDOWN_ATTRITION_START,
    SHOWDOWN_OVERDRAFT_HP_PER_POINT,
    SHOWDOWN_PRIORITY_GUARD,
    SHOWDOWN_PRIORITY_HEAVY,
    SHOWDOWN_PRIORITY_LIGHT,
    SHOWDOWN_PRIORITY_NORMAL,
    SHOWDOWN_PRIORITY_REST,
    SHOWDOWN_PRIORITY_SUPER,
    SHOWDOWN_METER_MAX,
    SHOWDOWN_METER_ON_GUARDED_HIT,
    SHOWDOWN_METER_ON_HIT_DEALT,
    SHOWDOWN_METER_ON_HIT_TAKEN,
    SHOWDOWN_REST_FLAT,
    SHOWDOWN_REST_PCT,
    SHOWDOWN_STAMINA_POOL_SCALE,
    SHOWDOWN_STAMINA_REGEN_FLAT,
    SHOWDOWN_STAMINA_REGEN_PCT,
    SHOWDOWN_SUPER_POWER_MULT,
    SHOWDOWN_SUPER_SPLASH_SCALE,
    SHOWDOWN_SYNERGY_MULT,
    type ShowdownCommand,
    type ShowdownEvent,
    type ShowdownFormat,
    type ShowdownOutcome,
    type PetConsumableEffectName,
    type ShowdownPetView,
    type ShowdownStateView,
    type ShowdownTier,
} from '../../shared/pet-showdown-contract.js';
import { petJutsuPowerCeil, petStatCeil } from '../_pet-stat-ceil.js';
import { PET_CATALOG } from '../pet/_catalog.js';
import {
    applyPetPvpGear,
    petConsumableById,
    petConsumableCharges,
    petPvpGearById,
    PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT,
} from '../_pet-sim/pet-config.js';
import type { Pet } from '../_pet-sim/pet-types.js';

// ─── Internal state ──────────────────────────────────────────────────────────

export interface ShowdownStatus {
    kind: string;
    rounds: number;
    /** Multiplier magnitude for buffs/debuffs, absorb pool for shields. */
    magnitude: number;
    /** Round the status was applied — it must survive its birth round's upkeep
     *  so a stun/freeze landed mid-round still costs the target its NEXT turn. */
    bornRound: number;
}

export interface ShowdownMove {
    name: string;
    power: number;
    kind: string;
    cost: number;
    signature: boolean;
    /** Temtem-style turn-order multiplier for the round this move is chosen. */
    priority: number;
    /** Rounds in battle required before this move fires (Temtem Hold).
     *  NO COOLDOWNS — stamina and hold are the only gates (the Temtem model). */
    hold: number;
}

/** Combat procs carried from equipped PvP gear (pet-config.ts definitions). */
export interface ShowdownGear {
    name: string;
    shieldStartPctOfHp?: number;
    dotOnHitPctOfAtk?: number;
    dotRounds?: number;
    executeBelowPct?: number;
    executeBonusPct?: number;
    lastStandBelowPct?: number;
    lastStandReductionPct?: number;
    lifestealPctOfDamage?: number;
}

/*
 * Reactive charges from the equipped battle consumable (pet-config.ts
 * `petConsumables`). Sealed off the loadout alongside the PvP gear, and unlike
 * gear these are STATE: each field is spent down as its trigger fires, so a
 * charge is single-use inside the battle. `dodge`/`endure`/`cleanse` are
 * counts; `mitigate`/`thorns`/`lifeline` carry the item's percentage and zero
 * out once used.
 */
export interface ShowdownConsumable {
    id: string;
    name: string;
    dodge: number;
    mitigate: number;
    endure: number;
    thorns: number;
    lifeline: number;
    cleanse: number;
}

export interface ShowdownPet {
    id: string;
    name: string;
    element: string;
    role: string;
    rarity: string;
    templateId?: string;
    level: number;
    hp: number;
    maxHp: number;
    attack: number;
    defense: number;
    speed: number;
    stamina: number;
    /** Per-pet stamina pool — a stat derived from bulk (~85-120). */
    maxStamina: number;
    meter: number;
    ko: boolean;
    guarding: boolean;
    /** On the bench: cannot act or be targeted; statuses are frozen. */
    benched: boolean;
    winded: boolean;
    /** Rounds this pet has been in the battle — holds tick everywhere. */
    readiness: number;
    /** Trait riding into combat — in-combat effect applied by the engine. */
    trait?: string;
    /** Equipped PvP gear procs. */
    gear?: ShowdownGear;
    /** Equipped battle consumable's remaining reactive charges. */
    consumable?: ShowdownConsumable;
    /** The one-use item is burned by this battle and must be struck from the
     *  save. Only reward-eligible sessions commit it — see createShowdownSession
     *  and showdownConsumableSpends. */
    consumableSpent?: boolean;
    statuses: ShowdownStatus[];
    moves: ShowdownMove[];
    /** The full-meter finisher — excluded from the normal move list. */
    signatureMove: ShowdownMove;
}

export interface ShowdownSession {
    sessionId: string;
    playerName: string;
    format: ShowdownFormat;
    tier: ShowdownTier;
    round: number;
    rng: number;
    finished: boolean;
    outcome: ShowdownOutcome | null;
    /** Reward magnitude sealed at start — the opponent actually fought. */
    sealedOpponentLevel: number;
    /** Whether a win here may pay at all. Sealed at start; see
     *  createShowdownSession. False for the hand-picked-AI practice entry. */
    rewardEligible: boolean;
    /** Sealed at start: a live player-vs-player session. Turns the endpoint's
     *  45s command timer on (SHOWDOWN_PVP_TURN_SECONDS) — the engine itself
     *  never reads a clock, so the deadline bookkeeping lives endpoint-side
     *  (`turnDeadlineAt` below). False for every AI entry. */
    pvp: boolean;
    /** Endpoint-maintained epoch-ms deadline for the CURRENT round's orders.
     *  Only meaningful while `pvp`; the engine ignores it entirely. */
    turnDeadlineAt?: number;
    enemyTeamName: string;
    player: ShowdownPet[];
    enemy: ShowdownPet[];
    createdAt: number;
}

// ─── Seeded rng (integer-only mulberry32) ────────────────────────────────────
// Exported so ai.ts draws from the SAME implementation — a second copy of a
// determinism-critical PRNG is a silent-desync foot-gun.

export function nextRand(session: ShowdownSession): number {
    let t = (session.rng += 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    session.rng = session.rng | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ─── Pet sealing ─────────────────────────────────────────────────────────────

const clampInt = (n: unknown, lo: number, hi: number, fallback: number): number => {
    const v = Math.floor(Number(n));
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
};

/*
 * Pet identity arrives from player saves, so every string that indexes a
 * lookup table is untrusted. `??` does NOT protect these: an id/role/trait of
 * 'constructor' or '__proto__' resolves to an inherited Object.prototype
 * member — non-nullish, non-numeric — which propagated NaN through the damage
 * math until `hp <= 0` could never be true (an unkillable pet on a reward
 * path). Every table read goes through hasOwn/mult, and every identity field
 * is allowlisted below.
 */
const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

/** Own-property numeric table read; anything else falls back. */
const tableMult = (table: Record<string, number>, key: string, fallback = 1): number => {
    if (!hasOwn(table, key)) return fallback;
    const n = table[key];
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

/** The move list to seal from: an override kit, else the pet's own jutsus. */
function jutsuList(
    override: Array<{ name: string; power: number; kind: string; signature?: boolean }> | undefined,
    rawJutsus: unknown,
): Array<{ name?: unknown; power?: unknown; kind?: unknown; signature?: unknown }> {
    if (override) return override;
    if (!Array.isArray(rawJutsus)) return [];
    return rawJutsus.filter((j) => j && typeof j.name === 'string');
}

const ELEMENT_OK: ReadonlySet<string> = new Set([...Object.keys(SHOWDOWN_ELEMENT_BEATS), 'None']);

/** Turn-denial kinds: without cooldowns these chain into perma-lock, so they
 *  pay heavy stamina, carry a hold, and their victims gain brief immunity. */
const CONTROL_KINDS = new Set(['stun', 'freeze', 'confuse']);
/** Sustain kinds: an every-round heal is unbreakable (the genre's stall trap —
 *  an attacker under ~33%/turn never breaks a healer), so healing is priced
 *  near a haymaker and held one round. */
const SUSTAIN_KINDS = new Set(['heal']);

export function moveStaminaCost(power: number, kind = 'damage'): number {
    // Linear in power: damage-per-stamina stays flat across the whole ladder,
    // so an expensive move is never MORE efficient than a cheap one — it is
    // only more immediate. You buy tempo and you pay for it next round.
    const base = Math.max(
        SHOWDOWN_COST_MIN,
        Math.min(SHOWDOWN_COST_MAX, Math.round(power * SHOWDOWN_COST_PER_POWER)),
    );
    // Control and sustain are priced like haymakers no matter their listed
    // power — a stolen turn or an undone round of damage outvalues most hits.
    if (CONTROL_KINDS.has(kind)) return Math.max(base, SHOWDOWN_COST_CONTROL_FLOOR);
    if (SUSTAIN_KINDS.has(kind)) return Math.max(base, SHOWDOWN_COST_SUSTAIN_FLOOR);
    return base;
}

/** Kinds that can carry a kit's haymaker slot — only those whose value IS the
 *  immediate hit. Utility kinds are excluded because promoting a `slow` or a
 *  `taunt` would price a move that deals almost no damage like a finisher.
 *  `burn`/`dot` are excluded for the opposite reason: their value is spread
 *  over later rounds, so the haymaker framing does not fit and the round-one
 *  hold would be strictly bad — you want the burn ticking EARLY. */
const HEAVY_ELIGIBLE_KINDS = new Set(['damage', 'crush', 'wound', 'lifesteal']);

const KNOWN_KINDS = new Set([
    'damage', 'buff', 'heal', 'debuff', 'dot', 'move', 'barrier', 'movelock', 'lifesteal',
    'shield', 'absorb', 'burn', 'freeze', 'confuse', 'stun', 'crush', 'wound', 'mark',
    'slow', 'haste', 'taunt', 'push', 'pull',
]);

/*
 * KIND_FX — the single source of truth for what a move kind DOES.
 *
 * `mult` is the fraction of the listed power that lands as immediate damage.
 * This was previously a pile of inline literals in the resolution switch,
 * invisible to the player: a 168-power stun lands 84 damage while a 138-power
 * strike lands 138 — 39% less damage for 37% more stamina, with nothing on
 * screen explaining why. `blurb` is rendered on the move button so the
 * trade-off is legible. `store` is the status kind actually written (several
 * kinds are stored under a different name — see storedStatusKind).
 */
interface KindFx { mult: number; rounds: number; store?: string; blurb: string }
export const KIND_FX: Record<string, KindFx> = {
    damage:    { mult: 1.0,  rounds: 0, blurb: 'Straight damage' },
    crush:     { mult: 1.1,  rounds: 2, blurb: 'Heavy hit, lowers DEF 2 rounds' },
    lifesteal: { mult: 1.0,  rounds: 0, blurb: 'Heals you for half the damage' },
    push:      { mult: 0.85, rounds: 0, blurb: 'Hits and drains foe stamina' },
    pull:      { mult: 0.85, rounds: 0, blurb: 'Hits and drains foe stamina' },
    dot:       { mult: 0.82, rounds: 2, store: 'burn', blurb: 'Burns for 2 more rounds' },
    burn:      { mult: 0.82, rounds: 2, blurb: 'Burns for 2 more rounds' },
    wound:     { mult: 0.82, rounds: 2, blurb: 'Bleeds and halves foe healing' },
    stun:      { mult: 0.5,  rounds: 1, blurb: 'Steals the foe\'s next action' },
    freeze:    { mult: 0.6,  rounds: 1, blurb: 'Foe may lose its next action' },
    confuse:   { mult: 0.6,  rounds: 2, blurb: 'Foe may hit itself, 2 rounds' },
    debuff:    { mult: 0.4,  rounds: 2, blurb: 'Weakens foe ATK 2 rounds' },
    mark:      { mult: 0.4,  rounds: 3, blurb: 'Next hit on the foe hits harder' },
    slow:      { mult: 0.4,  rounds: 2, blurb: 'Slows the foe 2 rounds' },
    movelock:  { mult: 0.4,  rounds: 2, store: 'slow', blurb: 'Slows the foe 2 rounds' },
    buff:      { mult: 0,    rounds: 2, blurb: 'Raises your ATK' },
    haste:     { mult: 0,    rounds: 2, blurb: 'Raises your speed' },
    move:      { mult: 0,    rounds: 2, store: 'haste', blurb: 'Raises your speed' },
    shield:    { mult: 0,    rounds: 2, blurb: 'Absorbs incoming damage' },
    barrier:   { mult: 0,    rounds: 2, store: 'shield', blurb: 'Absorbs incoming damage' },
    absorb:    { mult: 0,    rounds: 2, store: 'shield', blurb: 'Absorbs incoming damage' },
    taunt:     { mult: 0,    rounds: 1, blurb: 'Draws the foes\' attacks to you' },
    heal:      { mult: 0,    rounds: 0, blurb: 'Restores HP' },
};

/**
 * The status kind a move actually STORES. Several kinds are written under a
 * different name (barrier/absorb -> shield, dot -> burn, move -> haste,
 * movelock -> slow), and taunt degenerates to a self-guard in solo formats.
 * Both the engine and the AI read this, so they cannot drift apart — the AI
 * previously checked for a 'barrier' status that the engine never writes,
 * which made its "already applied" penalty dead and turned barrier into 24.8%
 * of all its commands.
 */
export function storedStatusKind(kind: string, format?: ShowdownFormat, foeCount = 2): string {
    if (kind === 'taunt') return (foeCount > 1 || format !== '1v1') ? 'taunt' : 'tauntGuard';
    return (hasOwn(KIND_FX, kind) && KIND_FX[kind].store) || kind;
}

/** Server-authored effect line for the move button. Never computed client-side. */
export function moveEffectText(kind: string, power: number): string {
    if (!hasOwn(KIND_FX, kind)) return 'Straight damage';
    const fx = KIND_FX[kind];
    if (kind === 'heal') return `Restores ~${Math.round(Math.min(0.3, Math.max(60, power) / 700) * 100)}% max HP`;
    if (fx.mult === 0) return fx.blurb;
    if (fx.mult === 1) return fx.blurb;
    return `${fx.blurb} · ${Math.round(fx.mult * 100)}% hit`;
}

/*
 * Species stat-budget normalization. Same-rarity catalog species differ by up
 * to ~65% in raw stat budget (Black Cat 297hp/37atk vs Frost Cub 515hp/65atk,
 * both "standard") — the continuous sims priced that with behavior levers
 * (kiting ranges, moveRange, positioning) that a turn-based duel doesn't have,
 * so raw budget would simply decide fights. At seal time each pet's combat
 * stats are scaled by (rarityMedianBudget / speciesBudget)^BUDGET_DAMPING
 * computed from its CATALOG TEMPLATE — the damping keeps species personality
 * (fast-vs-tanky spreads survive) while compressing the innate budget gap, and
 * because the correction uses the template rather than the live stats, a
 * player's TRAINING gains keep their full value on top. Pets with no
 * resolvable template (admin-authored customs) are left untouched.
 *
 * RAISED 0.6 -> 0.78 on 2026-08-11, when the balance ratchet first simulated
 * legendary and mythic and first checked PER-SPECIES win rates: Armored Polar
 * Bear (1.33x its tier's median budget) beat its own-rarity peers 89.7% of the
 * time. Aggregate role/element numbers had looked fine the whole time, because
 * a species that dominates its tier is invisible once you average over the
 * tier. Raising the exponent is the blunt lever; the residual is still visible
 * (see the per-species band in scripts/showdown-balance.test.ts) and closing it
 * further needs per-species kit work rather than more damping, since damping
 * hard enough to erase it also erases what makes species differ at all.
 */
const BUDGET_DAMPING = 0.78;

function speciesBudget(stats: { hp: number; attack: number; defense: number; speed: number }): number {
    // Weighted to the RATIO damage model's marginal values: atk, def, and hp
    // are all elasticity ±1 (damage ∝ atk/def, durability ∝ hp·def), so a
    // point's worth is proportional to 1/typical-magnitude — atk and def
    // points are priced equally relative to their scales, hp per-point is
    // cheap because the pool is large, and speed only buys turn order.
    return stats.hp / 8 + stats.attack + stats.defense * 1.3 + stats.speed * 0.5;
}

let rarityMedianBudget: Map<string, number> | null = null;
function medianBudgetFor(rarity: string): number | null {
    if (!rarityMedianBudget) {
        const byRarity = new Map<string, number[]>();
        for (const tpl of Object.values(PET_CATALOG)) {
            const r = String(tpl.rarity ?? '');
            if (!r) continue;
            const budget = speciesBudget({
                hp: Number(tpl.hp) || 0, attack: Number(tpl.attack) || 0,
                defense: Number(tpl.defense) || 0, speed: Number(tpl.speed) || 0,
            });
            if (budget > 0) (byRarity.get(r) ?? byRarity.set(r, []).get(r)!).push(budget);
        }
        rarityMedianBudget = new Map();
        const all: number[] = [];
        for (const [r, list] of byRarity) {
            list.sort((a, b) => a - b);
            rarityMedianBudget.set(r, list[Math.floor(list.length / 2)]);
            all.push(...list);
        }
        all.sort((a, b) => a - b);
        if (all.length) rarityMedianBudget.set('__all__', all[Math.floor(all.length / 2)]);
    }
    return rarityMedianBudget.get(rarity) ?? null;
}

/** Kit-POWER normalization — the stat budget's sibling. Same-rarity kits vary
 *  wildly in authored move power (three mythic assassins carry 92-100-power
 *  kits in a 450-cap bracket and sat at 5-11% win rate), and power multiplies
 *  damage linearly. Each pet's moves scale toward its rarity's median kit
 *  power (cross-tier blended like the stat budget), damped and clamped so
 *  authored kit personality survives. */
let rarityMedianKitPower: Map<string, number> | null = null;
function medianKitPowerFor(rarity: string): number | null {
    if (!rarityMedianKitPower) {
        const byRarity = new Map<string, number[]>();
        const all: number[] = [];
        for (const tpl of Object.values(PET_CATALOG)) {
            const r = String(tpl.rarity ?? '');
            if (!r || !Array.isArray(tpl.jutsus)) continue;
            const powers = (tpl.jutsus as Array<{ power?: unknown }>)
                .map((j) => Number(j.power) || 0)
                .filter((p) => p > 0);
            if (!powers.length) continue;
            const avg = powers.reduce((s, p) => s + p, 0) / powers.length;
            (byRarity.get(r) ?? byRarity.set(r, []).get(r)!).push(avg);
            all.push(avg);
        }
        rarityMedianKitPower = new Map();
        for (const [r, list] of byRarity) {
            list.sort((a, b) => a - b);
            rarityMedianKitPower.set(r, list[Math.floor(list.length / 2)]);
        }
        all.sort((a, b) => a - b);
        if (all.length) rarityMedianKitPower.set('__all__', all[Math.floor(all.length / 2)]);
    }
    return rarityMedianKitPower.get(rarity) ?? null;
}

export function kitPowerNormalizationMult(templateId: string | undefined, petId: string, rarity: string): number {
    const canonical = String(templateId || petId).replace(/-\d{10,}$/, '').split(':')[0];
    const tpl = PET_CATALOG[canonical];
    // Own-rarity reference ONLY — no cross-tier blend here. Blending dragged
    // the mythic reference down toward the global median, which neutralized
    // the very fix this exists for (mythics with standard-power kits).
    // Cross-tier compression is the STAT blend's job.
    const median = medianKitPowerFor(rarity);
    if (!tpl || !median || String(tpl.rarity) !== rarity || !Array.isArray(tpl.jutsus)) return 1;
    const powers = (tpl.jutsus as Array<{ power?: unknown }>)
        .map((j) => Number(j.power) || 0)
        .filter((p) => p > 0);
    if (!powers.length) return 1;
    const avg = powers.reduce((s, p) => s + p, 0) / powers.length;
    return Math.max(0.8, Math.min(1.35, Math.pow(median / avg, 0.6)));
}

/** Cross-tier blend: the reference budget each pet is normalized toward is
 *  mostly its OWN rarity's median, pulled this fraction toward the global
 *  median. Compresses the standard→rare cliff (raw catalog gap gave rare a
 *  95% stomp rate over standard) toward the 65-80% ladder the other tier
 *  steps already sit at, while preserving the rarity progression. */
const CROSS_TIER_BLEND = 0.3;

export function speciesNormalizationMult(templateId: string | undefined, petId: string, rarity: string): number {
    const canonical = String(templateId || petId).replace(/-\d{10,}$/, '').split(':')[0];
    const tpl = PET_CATALOG[canonical];
    const median = medianBudgetFor(rarity);
    const globalMedian = medianBudgetFor('__all__');
    if (!tpl || !median || String(tpl.rarity) !== rarity) return 1;
    const budget = speciesBudget({
        hp: Number(tpl.hp) || 0, attack: Number(tpl.attack) || 0,
        defense: Number(tpl.defense) || 0, speed: Number(tpl.speed) || 0,
    });
    if (!(budget > 0)) return 1;
    const reference = globalMedian
        ? median * (1 - CROSS_TIER_BLEND) + globalMedian * CROSS_TIER_BLEND
        : median;
    return Math.pow(reference / budget, BUDGET_DAMPING);
}

/** Temtem-style per-move pacing: quick jabs resolve early, haymakers swing
 *  late and need a HOLD round before they come online. */
export function movePriority(power: number, kind: string): number {
    if (kind === 'guard') return SHOWDOWN_PRIORITY_GUARD;
    if (kind === 'rest') return SHOWDOWN_PRIORITY_REST;
    if (power > 220) return SHOWDOWN_PRIORITY_HEAVY;
    if (power > 0 && power <= 80) return SHOWDOWN_PRIORITY_LIGHT;
    return SHOWDOWN_PRIORITY_NORMAL;
}

export function moveHold(power: number, kind = 'damage'): number {
    if (CONTROL_KINDS.has(kind) || SUSTAIN_KINDS.has(kind)) return SHOWDOWN_HOLD_HEAVY;
    return power > 220 ? SHOWDOWN_HOLD_HEAVY : 0;
}

/** Every kit's biggest damage move becomes that pet's haymaker: raised to the
 *  heavy band so it swings last, holds a round, and costs a real fraction of
 *  the pool. Without this a kit is four interchangeable pokes — measured across
 *  the catalog, the strongest kit move was also the CHEAPEST-tier and therefore
 *  the most efficient, so nothing else was ever worth casting. */
export function promoteHeavy(moves: ShowdownMove[], rarity: string): ShowdownMove[] {
    let bestIdx = -1;
    // Start at 1: the universal Swift Strike at index 0 is NEVER promoted. It is
    // defined as the play you can always afford, and promoting it would give it
    // a round-one hold and heavy pricing. Three catalog species (the whole Water
    // starter line) carry kits of barrier + heal only, so they have no eligible
    // kit move — before this guard their basic was promoted and they opened
    // every battle with no attack available at all.
    for (let i = 1; i < moves.length; i++) {
        const m = moves[i];
        if (!HEAVY_ELIGIBLE_KINDS.has(m.kind) || m.power <= 0) continue;
        if (bestIdx < 0 || m.power > moves[bestIdx].power) bestIdx = i;
    }
    if (bestIdx < 0) return moves;
    const top = moves[bestIdx];
    const power = Math.min(
        petJutsuPowerCeil(rarity),
        Math.round(top.power * SHOWDOWN_HEAVY_PROMOTE_MULT),
    );
    const next = moves.slice();
    next[bestIdx] = {
        ...top,
        power,
        cost: Math.min(
            SHOWDOWN_COST_MAX,
            Math.round(moveStaminaCost(power, top.kind) * SHOWDOWN_HEAVY_COST_PREMIUM),
        ),
        // Flagged explicitly rather than inferred from a power threshold: the
        // haymaker is defined by its ROLE in the kit, not by clearing an
        // absolute number the authored content may never reach.
        priority: SHOWDOWN_PRIORITY_HEAVY,
        hold: SHOWDOWN_HOLD_HEAVY,
    };
    return next;
}

/** Universal cheap opener every pet gets, so low stamina never means no play. */
function basicStrike(): ShowdownMove {
    return {
        name: 'Swift Strike',
        power: 34,
        kind: 'damage',
        cost: SHOWDOWN_COST_BASIC,
        signature: false,
        priority: SHOWDOWN_PRIORITY_LIGHT,
        hold: 0,
    };
}

function synthesizedSignature(pet: { element?: string; name?: string }, rarity: string): ShowdownMove {
    const el = String(pet.element ?? 'None');
    return {
        name: el !== 'None' && el ? `${el} Overdrive` : 'Spirit Overdrive',
        // Scales with rarity (30% of the tier's jutsu-power cap = 96/108/122/135)
        // so a mythic's finisher outclasses a standard one.
        //
        // Was 72%, which made the signature deal ~177% of a full HP bar —
        // measured across the catalog, 159 of 160 species ONE-SHOT a full-health
        // mirror. That is not an ultimate, it is the win condition: it made the
        // first five rounds a loading bar for the meter and reduced every lever
        // the stamina ladder ships (the cost curve, the haymaker, its premium,
        // its hold, its late swing) to chip damage worth 15-45% of a bar while
        // one button dealt 177%. At 30% the signature lands ~74% of a bar —
        // 1.7x the haymaker, decisive but survivable from full, so it WINS a
        // fight you have already worked for instead of replacing it.
        power: Math.round(petJutsuPowerCeil(rarity) * 0.30),
        kind: 'damage',
        cost: 0,
        signature: true,
        priority: SHOWDOWN_PRIORITY_SUPER,
        hold: SHOWDOWN_HOLD_SUPER,
    };
}

/*
 * Showdown-side KIT OVERRIDES for catalog species whose authored move sets are
 * structurally broken for turn-based play. The shared catalog feeds the legacy
 * modes, so kits are corrected HERE at seal time rather than in the source
 * data. Each entry replaces the species' jutsu list wholesale (power values
 * still pass through kit normalization + rarity ceilings). Current entries:
 * the three mythic assassins that shipped standard-power kits (5-17% win rate
 * in the all-catalog sim) get proper mythic assassin kits — burst, mark
 * setups, and a lifesteal sustain valve.
 */
const SHOWDOWN_KIT_OVERRIDES: Record<string, Array<{ name: string; power: number; kind: string; signature?: boolean }>> = {
    'mythic-1': [   // Worldstorm Dragon — Lightning assassin
        { name: 'Stormfang Dive', power: 138, kind: 'damage' },
        { name: 'Static Brand', power: 96, kind: 'mark' },
        { name: 'Skybreaker Bolt', power: 168, kind: 'stun' },
        { name: 'Worldstorm Requiem', power: 300, kind: 'damage', signature: true },
    ],
    'mythic-4': [   // Abyssal Oni Hound — Earth assassin
        { name: 'Abyssal Rend', power: 142, kind: 'damage' },
        { name: 'Graveearth Jaws', power: 150, kind: 'crush' },
        { name: 'Hungering Maw', power: 128, kind: 'lifesteal' },
        { name: 'Oni Gate Requiem', power: 300, kind: 'lifesteal', signature: true },
    ],
    'mythic-8': [   // Stormgod Raijin — Lightning assassin
        { name: 'Raijin Claw', power: 140, kind: 'damage' },
        { name: 'Thundergod Brand', power: 98, kind: 'mark' },
        { name: 'Heavenly Piercer', power: 172, kind: 'stun' },
        { name: 'Stormgod Judgement', power: 300, kind: 'damage', signature: true },
    ],
};

/** Seal one save/catalog pet into showdown combat form, ceilings applied. */
export function sealShowdownPet(rawInput: Pet): ShowdownPet {
    // Equipped PvP gear stat mods apply to the LIVE stats before sealing —
    // an earned bonus the species normalization must not wash out (it
    // normalizes against the template, so the gear percentage survives).
    const raw = applyPetPvpGear(rawInput);
    const gearDef = petPvpGearById(raw.loadout?.pvp);
    // Reactive charges come from the SAME loadout, through pet-config's own
    // helper — the legacy sims read it at fighter-build time for exactly this
    // reason, and re-deriving the per-effect values here would let the two
    // drift the moment an item is repriced.
    const consumableDef = petConsumableById(raw.loadout?.consumable);
    const rarity = ['standard', 'rare', 'legendary', 'mythic'].includes(String(raw.rarity)) ? String(raw.rarity) : 'standard';
    const level = clampInt(raw.level, 1, 100, 1);
    const norm = speciesNormalizationMult(raw.templateId, String(raw.id), rarity);
    const overrideKeyEarly = String(raw.templateId || raw.id).replace(/-\d{10,}$/, '').split(':')[0];
    // hasOwnProperty, NOT a bare index: a pet id of 'constructor' or
    // '__proto__' otherwise resolves to an inherited Object.prototype member,
    // which reached `.filter` as a function and 500'd the start endpoint.
    const kitOverride = hasOwn(SHOWDOWN_KIT_OVERRIDES, overrideKeyEarly)
        ? SHOWDOWN_KIT_OVERRIDES[overrideKeyEarly]
        : undefined;
    // Overridden kits are authored at correct tier power — normalizing them
    // against the species' OLD broken catalog kit would double-correct.
    const kitNorm = kitOverride ? 1 : kitPowerNormalizationMult(raw.templateId, String(raw.id), rarity);
    const scaled = (value: unknown, fallback: number) => Math.max(1, Math.round((Number(value) || fallback) * norm));
    const maxHp = clampInt(scaled(raw.hp, 320), 1, petStatCeil(rarity, 'hp'), 320);
    const powerCeil = petJutsuPowerCeil(rarity);

    const sealMove = (j: { name?: unknown; power?: unknown; kind?: unknown; signature?: unknown }): ShowdownMove => {
        const power = clampInt(Math.round((Number(j.power) || 0) * kitNorm), 0, powerCeil, 0);
        const kind = KNOWN_KINDS.has(String(j.kind)) ? String(j.kind) : 'damage';
        return {
            name: String(j.name).slice(0, 48),
            power,
            kind,
            cost: moveStaminaCost(power, kind),
            signature: j.signature === true,
            priority: movePriority(power, kind),
            hold: moveHold(power, kind),
        };
    };

    // The authored signature is found on the FULL named list, never on a
    // sliced one: _catalog.ts authors the signature LAST, so an early
    // slice(0,5) silently dropped it for 87 of 140 species and replaced their
    // named finisher ("Lunar Eclipse: Ninetail Requiem") with a generic
    // "<Element> Overdrive".
    const named = jutsuList(kitOverride, raw.jutsus);
    const sigRaw = named.find((j) => j.signature === true);
    // The 'move' filter MUST run before the slice, or every rare/legendary
    // loses a kit slot (and its element move) to a mobility entry.
    const kit = named
        .filter((j) => j !== sigRaw && String(j.kind) !== 'move')
        .slice(0, 4)
        .map(sealMove);

    const synth = synthesizedSignature({ element: raw.element, name: raw.name }, rarity);
    const signatureMove: ShowdownMove = sigRaw
        ? {
            ...sealMove(sigRaw),
            // Signature power is TIER-DERIVED, full stop; the authored move
            // contributes its NAME (and its element flavour), not its number.
            // This was written as max(authored, synth) back when synth was
            // 230-324 and every authored raw (90-152) sat below it — the max
            // never bound, and the comment said so. Once the synth value came
            // down, the max inverted the intent: authored raws started binding
            // and produced a tail of species whose signature still one-shot a
            // full-HP mirror while everyone else's did not.
            power: synth.power,
            kind: 'damage',
            signature: true,
            priority: SHOWDOWN_PRIORITY_SUPER,
            hold: SHOWDOWN_HOLD_SUPER,
        }
        : synth;

    const defense = clampInt(scaled(raw.defense, 28), 1, petStatCeil(rarity, 'defense'), 28);
    // The stamina pool is a STAT (the Temtem model): bulk buys endurance.
    // ~65 for a glass cannon, ~78 mid, ~90 for a war tortoise.
    //
    // Resized from an 80-125 band. At the old size a mid-tier technique (26 EN)
    // bought FIVE consecutive casts against a 6.5-round fight — you could throw
    // your best affordable move every single round and only run dry on the last
    // one, which is the definition of a resource that does not bind. At this
    // size the same move buys three, the haymaker buys one at ~63% of the pool
    // (Temtem's own haymaker is 33 STA against a ~50 pool), and the jab stays
    // effectively unlimited because being always-affordable is its entire job.
    // Scaling the ORIGINAL curve (rather than inventing new divisors) keeps the
    // relative spread between a glass cannon and a war tortoise exactly as tuned.
    const maxStamina = Math.round(
        Math.max(80, Math.min(125, 55 + maxHp / 16 + defense / 6)) * SHOWDOWN_STAMINA_POOL_SCALE,
    );

    return {
        id: String(raw.id),
        name: String(raw.nickname || raw.name || 'Companion').slice(0, 32),
        ...(typeof raw.templateId === 'string' && raw.templateId ? { templateId: raw.templateId } : {}),
        element: ELEMENT_OK.has(String(raw.element)) ? String(raw.element) : 'None',
        role: ROLE_OK.has(String(raw.role)) ? String(raw.role) : 'defender',
        rarity,
        level,
        hp: maxHp,
        maxHp,
        attack: clampInt(scaled(raw.attack, 40), 1, petStatCeil(rarity, 'attack'), 40),
        defense,
        speed: clampInt(scaled(raw.speed, 30), 1, petStatCeil(rarity, 'speed'), 30),
        stamina: maxStamina,
        maxStamina,
        // Battleborn pets enter the arena with meter already burning.
        meter: tableMult(TRAIT_FX.startMeter, String(raw.trait ?? ''), 0),
        ko: false,
        guarding: false,
        benched: false,
        winded: false,
        readiness: 0,
        ...(TRAIT_OK.has(String(raw.trait)) ? { trait: String(raw.trait) } : {}),
        ...(gearDef ? {
            gear: {
                name: gearDef.name,
                ...(gearDef.shieldStartPctOfHp ? { shieldStartPctOfHp: gearDef.shieldStartPctOfHp } : {}),
                ...(gearDef.dotOnHitPctOfAtk ? { dotOnHitPctOfAtk: gearDef.dotOnHitPctOfAtk, dotRounds: gearDef.dotOnHitRounds ?? 2 } : {}),
                ...(gearDef.executeBelowPct ? { executeBelowPct: gearDef.executeBelowPct, executeBonusPct: gearDef.executeBonusPct ?? 0 } : {}),
                ...(gearDef.lastStandBelowPct ? { lastStandBelowPct: gearDef.lastStandBelowPct, lastStandReductionPct: gearDef.lastStandReductionPct ?? 0 } : {}),
                ...(gearDef.lifestealPctOfDamage ? { lifestealPctOfDamage: gearDef.lifestealPctOfDamage } : {}),
            },
        } : {}),
        ...(consumableDef ? {
            consumable: { id: consumableDef.id, name: consumableDef.name, ...petConsumableCharges(raw) },
        } : {}),
        statuses: [],
        moves: promoteHeavy([basicStrike(), ...kit], rarity),
        signatureMove: { ...signatureMove, cost: 0 },
    };
}

export function createShowdownSession(input: {
    sessionId: string;
    playerName: string;
    format: ShowdownFormat;
    tier: ShowdownTier;
    seed: number;
    playerPets: Pet[];
    enemyPets: Pet[];
    enemyTeamName: string;
    /** Whether a WIN from this session may pay. Sealed here at start so the
     *  payout can never be argued from anything the client sends later. Every
     *  caller today is the hand-picked-AI practice entry and passes false; the
     *  flag exists because the live entry points (Hollow Gate, sector ambush,
     *  clan/sector war) are slated to migrate onto this engine and those DO
     *  pay — at which point they set it true and nothing else has to move. */
    rewardEligible: boolean;
    /** Live player-vs-player. Arms the endpoint's 45s command timer; every
     *  caller today is an AI entry and omits it. */
    pvp?: boolean;
}): ShowdownSession {
    const size = SHOWDOWN_FORMAT_SIZE[input.format];
    const sealTeam = (pets: Pet[], commitConsumables: boolean): ShowdownPet[] =>
        pets.slice(0, SHOWDOWN_MAX_TEAM).map((raw, i) => {
            const sealed = { ...sealShowdownPet(raw), benched: i >= size };
            // Gear proc: Aegis-style start shields raise before round one.
            if (sealed.gear?.shieldStartPctOfHp) {
                sealed.statuses = [{
                    kind: 'shield', rounds: 99, bornRound: 0,
                    magnitude: Math.round(sealed.maxHp * sealed.gear.shieldStartPctOfHp / 100),
                }];
            }
            // Entering a fight that can PAY commits the one-use item, the same
            // way summoning into a PvE fight does (api/pet/_progress.ts). A
            // practice fight keeps it: the charges still fire, so a build can
            // be tested, but burning a 1,600-ryo item for a mode that pays
            // nothing would make equipping one strictly irrational.
            if (commitConsumables && sealed.consumable) sealed.consumableSpent = true;
            return sealed;
        });
    return {
        sessionId: input.sessionId,
        playerName: input.playerName,
        format: input.format,
        tier: input.tier,
        round: 0,
        rng: input.seed | 0,
        finished: false,
        outcome: null,
        sealedOpponentLevel: clampInt(Math.max(1, ...input.enemyPets.map((p) => Number(p.level) || 1)), 1, 100, 1),
        rewardEligible: input.rewardEligible === true,
        pvp: input.pvp === true,
        enemyTeamName: input.enemyTeamName,
        player: sealTeam(input.playerPets, input.rewardEligible === true),
        // AI pets are built from the catalog, not from a save, so there is no
        // inventory behind their loadout and nothing to burn.
        enemy: sealTeam(input.enemyPets, false),
        createdAt: Date.now(),
    };
}

/**
 * The player-side battle consumables this session COMMITTED — the pets whose
 * `loadout.consumable` must be struck from the save, exactly as
 * applyPetSummonCost does it for the PvE summon path (`delete
 * loadout.consumable`, reporting which id was spent).
 *
 * The engine is pure and never writes a save; the endpoint that owns the save
 * lock calls this and does the delete. It returns EMPTY today, because every
 * caller seals rewardEligible=false — the spend path activates with the first
 * reward-eligible caller (Hollow Gate, sector ambush, clan/sector war).
 */
export function showdownConsumableSpends(session: ShowdownSession): Array<{ petId: string; consumableId: string }> {
    return session.player
        .filter((pet): pet is ShowdownPet & { consumable: ShowdownConsumable } =>
            pet.consumableSpent === true && !!pet.consumable)
        .map((pet) => ({ petId: pet.id, consumableId: pet.consumable.id }));
}

// ─── Effective stats ─────────────────────────────────────────────────────────

function statusMult(pet: ShowdownPet, kinds: Record<string, number>): number {
    let mult = 1;
    for (const s of pet.statuses) {
        const m = kinds[s.kind];
        if (m !== undefined) mult *= m;
    }
    return mult;
}

/*
 * In-combat TRAIT effects. Trait stat bonuses are already baked into stored
 * stats at acquisition (applyOwnedPetTrait); these are the live-combat
 * behaviors on top — deterministic, one identity beat per trait. Ultras
 * (Fateweaver / Hollowborn / Boonbringer) get the bigger swings.
 */
const TRAIT_FX = {
    damageOut: { Aggressive: 1.06, Fateweaver: 1.08 } as Record<string, number>,
    meterGain: { Loyal: 1.2, Fateweaver: 1.1 } as Record<string, number>,
    speed: { Swift: 1.08 } as Record<string, number>,
    /** Guardian blocks harder than the standard guard. */
    guardMult: { Guardian: 0.42 } as Record<string, number>,
    /** Lucky shifts the damage roll window upward (+3%). */
    varianceShift: { Lucky: 0.03 } as Record<string, number>,
    /** Battleborn enters the arena with meter already burning. */
    startMeter: { Battleborn: 25 } as Record<string, number>,
    /** Hollowborn drinks a slice of every hit it lands. */
    lifedrainPct: { Hollowborn: 0.08 } as Record<string, number>,
    /** Boonbringer amplifies the ally-synergy bonus it benefits from. */
    synergyMult: { Boonbringer: 1.2 } as Record<string, number>,
};
/** Every trait the engine recognizes — the seal allowlist. */
const TRAIT_OK: ReadonlySet<string> = new Set(
    Object.values(TRAIT_FX).flatMap((table) => Object.keys(table)),
);
/** Roles come from the shared role taxonomy, never a hardcoded list. */
const ROLE_OK: ReadonlySet<string> = new Set(['defender', 'tracker', 'assassin', 'sage']);
const traitOf = (p: ShowdownPet): string => p.trait ?? '';

const effAttack = (p: ShowdownPet) => p.attack * statusMult(p, { buff: 1.25, debuff: 0.8, burn: 0.9 });
const effDefense = (p: ShowdownPet) => p.defense * statusMult(p, { crush: 0.8, tauntGuard: 1.2 });
const effSpeed = (p: ShowdownPet) => p.speed * statusMult(p, { haste: 1.25, slow: 0.75, movelock: 0.7 }) * tableMult(TRAIT_FX.speed, traitOf(p));

function elementMult(attacker: string, defender: string): number {
    if (SHOWDOWN_ELEMENT_BEATS[attacker] === defender) return SHOWDOWN_ELEMENT_ADVANTAGE;
    if (SHOWDOWN_ELEMENT_BEATS[defender] === attacker) return SHOWDOWN_ELEMENT_DISADVANTAGE;
    return 1;
}

// ─── Round resolution ────────────────────────────────────────────────────────

type Side = 'player' | 'enemy';


/** Living FIELD pets — the ones who can act and be targeted. */
function livingOf(session: ShowdownSession, side: Side): ShowdownPet[] {
    return (side === 'player' ? session.player : session.enemy).filter((p) => !p.ko && !p.benched);
}

/** Living team members including the bench — the defeat check counts these. */
function livingTeam(session: ShowdownSession, side: Side): ShowdownPet[] {
    return (side === 'player' ? session.player : session.enemy).filter((p) => !p.ko);
}

function hasStatus(pet: ShowdownPet, kind: string): boolean {
    return pet.statuses.some((s) => s.kind === kind);
}

const sideOf = (session: ShowdownSession, pet: ShowdownPet): Side =>
    session.player.includes(pet) ? 'player' : 'enemy';

/*
 * Reactive-charge beats. These are pushed into a REACTIONS list rather than
 * straight into the script, because the trigger's own event (the action, the
 * dot tick, the confusion hit) is written after its numbers are known — a
 * charge appended eagerly would narrate the save before the blow that needed
 * saving from. Every call site drains its reactions immediately after the beat
 * that produced them.
 */
function pushConsumableEvent(
    session: ShowdownSession,
    pet: ShowdownPet,
    effect: PetConsumableEffectName,
    reactions: ShowdownEvent[] | undefined,
    landed: { targetId?: string; damage?: number; heal?: number; ko?: boolean } = {},
): void {
    if (!reactions || !pet.consumable) return;
    reactions.push({
        t: 'consumable',
        petId: pet.id,
        side: sideOf(session, pet),
        effect,
        itemName: pet.consumable.name,
        targetId: landed.targetId ?? pet.id,
        damage: landed.damage ?? 0,
        heal: landed.heal ?? 0,
        ko: landed.ko === true,
        spent: pet.consumableSpent === true,
    });
}

/** What a Cleansing Incense answers: the poisons and burns, and the three
 *  turn-denial effects. Buffs and the steadfast immunity are untouched — the
 *  charge is a panic button, not a board wipe. */
const CLEANSABLE_STATUS = new Set(['burn', 'wound', 'freeze', 'confuse', 'stun']);

function addStatus(
    session: ShowdownSession,
    pet: ShowdownPet,
    kind: string,
    rounds: number,
    magnitude: number,
    reactions?: ShowdownEvent[],
): void {
    // CLEANSE charge: the first poison or control effect that would land is
    // burned off along with everything already stuck to the pet, and never
    // applies at all.
    const charges = pet.consumable;
    if (charges && charges.cleanse > 0 && CLEANSABLE_STATUS.has(kind)) {
        charges.cleanse -= 1;
        pet.statuses = pet.statuses.filter((s) => !CLEANSABLE_STATUS.has(s.kind));
        pushConsumableEvent(session, pet, 'cleanse', reactions);
        return;
    }
    const existing = pet.statuses.find((s) => s.kind === kind);
    if (existing) {
        existing.rounds = Math.max(existing.rounds, rounds);
        existing.magnitude = Math.max(existing.magnitude, magnitude);
        existing.bornRound = session.round;
    } else {
        pet.statuses.push({ kind, rounds, magnitude, bornRound: session.round });
    }
}

function gainMeter(pet: ShowdownPet, amount: number): void {
    if (pet.ko) return;
    const traitMult = tableMult(TRAIT_FX.meterGain, traitOf(pet));
    pet.meter = Math.min(SHOWDOWN_METER_MAX, Math.round(pet.meter + amount * traitMult));
}

/** Absorb pools (shield/barrier/absorb) soak damage first. Returns unabsorbed. */
function soakThroughShields(pet: ShowdownPet, damage: number): number {
    let remaining = damage;
    for (const s of pet.statuses) {
        if (remaining <= 0) break;
        if (s.kind === 'shield' || s.kind === 'barrier' || s.kind === 'absorb') {
            const soaked = Math.min(s.magnitude, remaining);
            s.magnitude -= soaked;
            remaining -= soaked;
        }
    }
    pet.statuses = pet.statuses.filter((s) => !((s.kind === 'shield' || s.kind === 'barrier' || s.kind === 'absorb') && s.magnitude <= 0));
    return remaining;
}

function applyDamage(
    session: ShowdownSession,
    target: ShowdownPet,
    amount: number,
    grantMeter = true,
    reactions?: ShowdownEvent[],
): { dealt: number; ko: boolean } {
    const soaked = soakThroughShields(target, Number.isFinite(amount) ? amount : 0);
    let dealt = Number.isFinite(soaked) ? Math.max(0, Math.round(soaked)) : 0;
    const charges = target.consumable;
    // ENDURE charge: one otherwise-lethal blow leaves the pet standing at 1 HP.
    // Sits AFTER the shield soak (a hit the shield ate was never lethal) and
    // trims `dealt` itself, so the figure on the wire is the figure the client
    // subtracts off the bar.
    if (charges && charges.endure > 0 && dealt >= target.hp && target.hp > 1) {
        dealt = target.hp - 1;
        charges.endure -= 1;
        pushConsumableEvent(session, target, 'endure', reactions);
    }
    target.hp = Math.max(0, target.hp - dealt);
    if (target.hp <= 0 && !target.ko) {
        target.ko = true;
        target.statuses = [];
        target.guarding = false;
    }
    // Self-inflicted overdraft chips pass grantMeter=false — bleeding by
    // choice must not FARM the super meter.
    if (dealt > 0 && grantMeter) {
        gainMeter(target, target.guarding ? SHOWDOWN_METER_ON_GUARDED_HIT : SHOWDOWN_METER_ON_HIT_TAKEN);
    }
    // LIFELINE charge: the first drop under the threshold pulls the pet back
    // up. Routed through applyHeal so the late-fight healing decay still binds
    // — an item that ignored attrition would reopen the stall it closes.
    if (charges && charges.lifeline > 0 && !target.ko
        && (target.hp / target.maxHp) * 100 < PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT) {
        const healed = applyHeal(target, target.maxHp * charges.lifeline / 100, session.round);
        charges.lifeline = 0;
        pushConsumableEvent(session, target, 'lifeline', reactions, { heal: healed });
    }
    return { dealt, ko: target.ko };
}

function applyHeal(target: ShowdownPet, amount: number, round = 0): number {
    if (target.ko) return 0;
    // Attrition damps healing toward zero. Without this the fight has no
    // termination guarantee at all: two pets that both Rest are a fixed point,
    // and a high-HP pet holding a heal move out-sustains any damage the game
    // can produce. Damage escalation alone does not close that — the heal has
    // to stop.
    const scaled = (Number.isFinite(amount) ? amount : 0) * showdownHealScale(round);
    const safe = scaled;
    const halved = hasStatus(target, 'wound') ? Math.round(safe * 0.5) : safe;
    const healed = Math.min(target.maxHp - target.hp, Math.max(0, Math.round(halved)));
    target.hp += healed;
    return healed;
}

/** Global damage pace. Tuned with scripts/showdown-balance.mjs: at 1.0 the
 * average same-rarity duel ran 12+ rounds and 56% of games timed out unresolved
 * (attrition meta — burst roles starved, chip roles dominated; this era had a
 * round-cap judge, since deleted). 2.2 lands the typical KO in 6-9 rounds. */
// Damage magnitude for the A/D RATIO formula below. History: the original
// atk²/(atk+def) shape gave attack ~3x the marginal value of defense, which
// made defense TRAINING a bad buy — switched to Pokémon's pure-ratio shape
// (damage ∝ atk/def) where attack, defense, and hp all carry equal marginal
// weight, so every training focus is a real choice. REF_DEF anchors the
// magnitude so a typical mid-game hit lands in the same range as before.
const DAMAGE_SCALE = 2.65;
const REF_DEF = 52;
/** Assassin execute instinct: bonus damage against bloodied targets — the
 * burst identity the role's glass-cannon statline pays for. */
const ASSASSIN_EXECUTE_HP = 0.4;
const ASSASSIN_EXECUTE_MULT = 1.15;

/** Role identity pricing. The catalog statlines were balanced for the
 * continuous sims, where a tracker paid for its superior hp/atk/speed with
 * kiting-range behavior and an assassin earned burst through positioning.
 * Turn-based combat has neither, so the engine restores the price mechanically:
 * trackers hit lighter per action, assassins hit far harder (plus the execute
 * below), sages swing harder and heal stronger (sageHealMult). Tuned against
 * scripts/showdown-balance.mjs until every role sits in the 40-60% band. */
// RE-FITTED 2026-08-11 against the current regime, and no longer expressed as a
// compression of the original table. Compressing toward neutral only exposed the
// raw statlines underneath: trackers carried the LOWEST damage multiplier in the
// table (0.82) and still won the most (59.4%), while assassins carried a neutral
// 1.02 and won the least (37.1%). That is the table failing at its actual job,
// which is to price the statline each role ships with — not a knob to soften.
//
// These values are fitted directly from measured win rates (mult_new =
// mult_old * (50 / winRate)^0.5, then rounded), because three separate changes
// this session — the signature nerf, the pool resize, and the removal of the
// timing multiplier — all lengthened fights, and every one of them taxed the
// glass role and paid the bulky one. Re-fit rather than nudge.
const ROLE_DAMAGE_MULT: Record<string, number> = {
    tracker: 0.91,
    assassin: 1.14,
    sage: 1.07,
    defender: 1.0,
};
const SAGE_HEAL_MULT = 1.15;

/** Element identity pricing, same reasoning as the role table: the catalog's
 * Earth/Lightning species carry ~15% higher statlines than Fire/Water (paid
 * for in the continuous sims by mechanics that no longer exist), and the
 * atk²-scaled formula amplifies the gap. Fire burns hotter, stone hits duller.
 * Tuned against scripts/showdown-balance.mjs. */
/** Explicit rarity-tier damage ladder. The RATIO damage formula cancels
 *  uniform stat inflation (a mythic's +11% to both atk and def leaves atk/def
 *  unchanged), so cross-tier superiority must be granted deliberately — this
 *  is the progression knob that keeps a mythic feeling mythic. */
const RARITY_DAMAGE_TIER: Record<string, number> = {
    standard: 1,
    rare: 1.06,
    legendary: 1.09,
    mythic: 1.18,
};

/* RE-FITTED 2026-08-11 from measured win rates, on the same reasoning as the
 * role table above: these are statline normalizations, and after the signature
 * nerf, the pool resize and the removal of the timing multiplier they were
 * pricing a game that no longer exists. Expressed as concrete values rather
 * than a compression factor so the next re-fit starts from what is actually
 * running.
 *
 * RE-FITTED AGAIN 2026-08-11 after BUDGET_DAMPING moved 0.6 -> 0.78: that
 * constant rescales every species' statline, so a table fitted against the old
 * damping was pricing the wrong stats and Fire came out at 60.6%. This pass
 * moved BOTH sides, because holding the taken side fixed is what let Fire
 * accumulate a double advantage in the first place — it had the highest damage
 * multiplier AND the lowest damage taken, so it hit hardest and was hit least.
 * Result: elements now span 47.6-53.4% (was 44.0-60.6%). */
const ELEMENT_DAMAGE_MULT: Record<string, number> = {
    Fire: 1.06,
    Water: 1.1,
    Wind: 1.05,
    Earth: 0.91,
    Lightning: 1.0,
};
/** Durability side of the same normalization — Fire/Water species carry the
 * lowest hp/def/speed lines, so out-damage alone can't level them. */
const ELEMENT_TAKEN_MULT: Record<string, number> = {
    Fire: 0.95,
    Water: 1.0,
    Wind: 1.01,
    Earth: 1.01,
    Lightning: 0.97,
};

function rawDamage(session: ShowdownSession, attacker: ShowdownPet, defender: ShowdownPet, power: number, extraMult = 1, procs?: string[]): number {
    const atk = effAttack(attacker);
    const def = effDefense(defender);
    const base = DAMAGE_SCALE * (power / 100) * REF_DEF * (atk / Math.max(1, def));
    // ±8% in 16 discrete steps — the genre-proven roll (Pokémon's 85-100 band):
    // wide enough that lethal isn't fully solvable, narrow enough to plan around.
    // Lucky shifts the whole window up.
    const variance = 0.92 + tableMult(TRAIT_FX.varianceShift, traitOf(attacker), 0) + Math.floor(nextRand(session) * 16) * 0.01;
    let mult = elementMult(attacker.element, defender.element) * variance * extraMult
        * tableMult(ROLE_DAMAGE_MULT, attacker.role)
        * tableMult(ELEMENT_DAMAGE_MULT, attacker.element)
        * tableMult(ELEMENT_TAKEN_MULT, defender.element)
        * tableMult(TRAIT_FX.damageOut, traitOf(attacker))
        * tableMult(RARITY_DAMAGE_TIER, attacker.rarity) / tableMult(RARITY_DAMAGE_TIER, defender.rarity);
    // Every named multiplier below is ATTRIBUTED into `procs` so the client can
    // say WHY a number was unusual instead of silently mutating it.
    if (attacker.role === 'assassin' && defender.hp / defender.maxHp < ASSASSIN_EXECUTE_HP) {
        mult *= ASSASSIN_EXECUTE_MULT;
        procs?.push('Execute');
    }
    if (tableMult(TRAIT_FX.damageOut, traitOf(attacker)) !== 1) procs?.push(traitOf(attacker));
    // Gear procs: execute bonus below the line; last-stand damage reduction.
    const gearA = attacker.gear;
    if (gearA?.executeBelowPct && gearA.executeBonusPct
        && defender.hp / defender.maxHp < gearA.executeBelowPct / 100) {
        mult *= 1 + gearA.executeBonusPct / 100;
        procs?.push(gearA.name);
    }
    const gearD = defender.gear;
    if (gearD?.lastStandBelowPct && gearD.lastStandReductionPct
        && defender.hp / defender.maxHp < gearD.lastStandBelowPct / 100) {
        mult *= 1 - gearD.lastStandReductionPct / 100;
        procs?.push(gearD.name);
    }
    // Mark: the stored bonus hit is consumed by the first damage that lands.
    const mark = defender.statuses.find((s) => s.kind === 'mark');
    if (mark) {
        mult *= 1.25;
        defender.statuses = defender.statuses.filter((s) => s !== mark);
        procs?.push('Mark');
    }
    // Guardian pets block harder than the standard guard.
    if (defender.guarding) {
        mult *= tableMult(TRAIT_FX.guardMult, traitOf(defender), SHOWDOWN_GUARD_MULT);
        if (tableMult(TRAIT_FX.guardMult, traitOf(defender), SHOWDOWN_GUARD_MULT) !== SHOWDOWN_GUARD_MULT) {
            procs?.push(traitOf(defender));
        }
    }
    const out = Math.round(base * mult);
    // Final NaN backstop: a non-finite result would make hp <= 0 unreachable.
    return Number.isFinite(out) ? Math.max(power > 0 ? 1 : 0, out) : 0;
}

/** Retarget through taunt: 2v2+ taunters drag single-target hostiles onto themselves. */
function resolveTarget(session: ShowdownSession, actorSide: Side, requestedId: string): ShowdownPet | null {
    const foes = livingOf(session, actorSide === 'player' ? 'enemy' : 'player');
    if (!foes.length) return null;
    const taunter = foes.find((p) => hasStatus(p, 'taunt'));
    if (taunter) return taunter;
    return foes.find((p) => p.id === requestedId) ?? foes[0];
}

function resolveAllyTarget(session: ShowdownSession, actorSide: Side, requestedId: string, actor: ShowdownPet): ShowdownPet {
    const allies = livingOf(session, actorSide);
    return allies.find((p) => p.id === requestedId) ?? actor;
}

/** Kinds whose status lands on the ACTOR, not the target. Exported so the AI
 *  checks the same pet the engine writes to. */
export const SELF_KINDS = new Set(['buff', 'haste', 'move', 'shield', 'barrier', 'absorb', 'taunt']);
const ALLY_KINDS = new Set(['heal']);

function deliveryFor(kind: string, role: string): 'melee' | 'ranged' | 'self' {
    if (SELF_KINDS.has(kind) || ALLY_KINDS.has(kind)) return 'self';
    if ((role === 'assassin' || role === 'defender') && (kind === 'damage' || kind === 'crush' || kind === 'lifesteal' || kind === 'push' || kind === 'pull')) {
        return 'melee';
    }
    return 'ranged';
}

interface ExecutedAction {
    move: ShowdownMove;
    superCast: boolean;
    targetId: string;
}

function executeMove(
    session: ShowdownSession,
    actor: ShowdownPet,
    actorSide: Side,
    action: ExecutedAction,
    events: ShowdownEvent[],
): void {
    const { move, superCast } = action;
    const kind = move.kind;
    const power = superCast ? Math.round(move.power * SHOWDOWN_SUPER_POWER_MULT) : move.power;
    // Reactive-item beats produced anywhere in this resolution, drained after
    // the action event so the script reads blow-then-save.
    const reactions: ShowdownEvent[] = [];

    // Costs and cooldowns — overexertion is allowed and priced the Temtem way:
    // the move fires, the pet pays HP for the deficit, and it is winded next
    // round. Push your luck, bleed for it.
    let overexerted = false;
    let overexertDamage = 0;
    if (superCast) {
        actor.meter = 0;
    } else {
        if (actor.stamina < move.cost) {
            overexerted = true;
            actor.winded = true;
            const deficit = move.cost - actor.stamina;
            actor.stamina = 0;
            // The chip can KO — overdrafting on your last legs is a real
            // gamble — but it never charges the actor's own super meter.
            //
            // Report what was DEALT, not what was rolled: applyDamage soaks
            // through shields first, so the raw figure was landing on the wire
            // whenever the actor had a barrier up. The client subtracts this
            // straight off the HP bar and derives a KO from it, so a shielded
            // overdraft used to drain the bar by damage that never happened and
            // fire the full KO treatment until the end-of-script reconcile
            // silently undid it. Every other number in this event is the dealt
            // amount; this one is now too.
            overexertDamage = applyDamage(
                session,
                actor,
                Math.round(deficit * SHOWDOWN_OVERDRAFT_HP_PER_POINT),
                false,
                reactions,
            ).dealt;
        } else {
            actor.stamina -= move.cost;
        }
    }
    actor.guarding = false;

    const targets: Extract<ShowdownEvent, { t: 'action' }>['targets'] = [];

    /** Returns false when the blow never landed, so the caller skips the
     *  on-hit rider (a dodged crush must not still lower DEF). */
    const applyOffensiveHit = (target: ShowdownPet, powerScale: number, applied?: string, splash = false): boolean => {
        const charges = target.consumable;
        // DODGE charge: the attack is negated outright — no damage, no rider,
        // and NO target entry, so the client paints the slip from the
        // consumable beat instead of narrating an absorbed hit that never was.
        if (charges && charges.dodge > 0) {
            charges.dodge -= 1;
            pushConsumableEvent(session, target, 'dodge', reactions);
            return false;
        }
        const guarded = target.guarding;
        // Temtem-style ally synergy: a LIVING teammate whose element beats the
        // target amplifies the hit (Boonbringers amplify it further). Solo
        // formats have no ally, so no bonus.
        const synergy = livingOf(session, actorSide)
            .some((ally) => ally !== actor && SHOWDOWN_ELEMENT_BEATS[ally.element] === target.element);
        const synergyMult = synergy ? tableMult(TRAIT_FX.synergyMult, traitOf(actor), SHOWDOWN_SYNERGY_MULT) : 1;
        const procs: string[] = [];
        let dmg = rawDamage(session, actor, target, Math.round(power * powerScale), synergyMult, procs);
        // MITIGATE charge: one softened blow. Applied to the finished roll (so
        // it discounts guard, element and every proc alike) and spent whether
        // or not the hit would have hurt.
        if (charges && charges.mitigate > 0) {
            dmg = Math.max(1, Math.round(dmg * (1 - charges.mitigate / 100)));
            charges.mitigate = 0;
            pushConsumableEvent(session, target, 'mitigate', reactions);
        }
        const { dealt, ko } = applyDamage(session, target, dmg, true, reactions);
        if (dealt > 0) gainMeter(actor, SHOWDOWN_METER_ON_HIT_DEALT);
        // Hollowborn drinks a slice of every hit it lands.
        const drain = tableMult(TRAIT_FX.lifedrainPct, traitOf(actor), 0);
        if (dealt > 0 && drain > 0) {
            applyHeal(actor, dealt * drain, session.round);
            procs.push(traitOf(actor));
        }
        // Gear procs on plain strikes: on-hit poison and gear lifesteal.
        const gear = actor.gear;
        if (dealt > 0 && !target.ko && gear?.dotOnHitPctOfAtk && kind === 'damage') {
            addStatus(session, target, 'wound', gear.dotRounds ?? 2, Math.max(1, Math.round(effAttack(actor) * gear.dotOnHitPctOfAtk / 100)), reactions);
            procs.push(gear.name);
        }
        if (dealt > 0 && gear?.lifestealPctOfDamage && kind === 'damage') {
            applyHeal(actor, dealt * gear.lifestealPctOfDamage / 100, session.round);
            procs.push(gear.name);
        }
        // THORNS charge: a slice of the blow comes straight back at whoever
        // threw it. Priced off what actually landed, not what was rolled.
        if (dealt > 0 && charges && charges.thorns > 0 && !actor.ko) {
            const reflect = Math.max(1, Math.round(dealt * charges.thorns / 100));
            charges.thorns = 0;
            const back = applyDamage(session, actor, reflect, false, reactions);
            pushConsumableEvent(session, target, 'thorns', reactions, {
                targetId: actor.id, damage: back.dealt, ko: back.ko,
            });
        }
        const eff = elementMult(actor.element, target.element);
        targets.push({
            id: target.id,
            damage: dealt,
            heal: 0,
            effectiveness: eff > 1 ? 'super' : eff < 1 ? 'weak' : 'neutral',
            guarded,
            ko,
            ...(applied ? { applied } : {}),
            ...(synergy && dealt > 0 ? { synergy: true } : {}),
            ...(splash ? { splash: true } : {}),
            ...(procs.length && dealt > 0 ? { procs: [...new Set(procs.filter(Boolean))] } : {}),
        });
        return true;
    };

    if (SELF_KINDS.has(kind)) {
        // Self moves: apply the status to the actor. The stored kind comes
        // from storedStatusKind so the engine and the AI cannot disagree.
        const foes = livingOf(session, actorSide === 'player' ? 'enemy' : 'player');
        const stored = storedStatusKind(kind, session.format, foes.length);
        switch (stored) {
            case 'buff': addStatus(session, actor, 'buff', move.power > 150 ? 3 : 2, 1.25); break;
            case 'haste': addStatus(session, actor, 'haste', 2, 1.25); break;
            case 'shield': addStatus(session, actor, 'shield', 2, Math.max(40, Math.round(power * 1.05))); break;
            case 'taunt': addStatus(session, actor, 'taunt', 1, 1); break;
            case 'tauntGuard': addStatus(session, actor, 'tauntGuard', 1, 1.2); break;
        }
        targets.push({ id: actor.id, damage: 0, heal: 0, effectiveness: 'neutral', guarded: false, ko: false, applied: stored });
    } else if (kind === 'heal') {
        const ally = resolveAllyTarget(session, actorSide, action.targetId, actor);
        // power 120 ≈ 17% maxHp, capped at 30% — meaningful against the 2.2x
        // damage pace without enabling heal-stall (attrition decays this to
        // zero in long fights; see applyHeal).
        const sageBonus = actor.role === 'sage' ? SAGE_HEAL_MULT : 1;
        const healed = applyHeal(ally, ally.maxHp * Math.min(0.3, (Math.max(60, power) / 700) * sageBonus), session.round);
        targets.push({ id: ally.id, damage: 0, heal: healed, effectiveness: 'neutral', guarded: false, ko: false, applied: 'heal' });
    } else {
        const target = resolveTarget(session, actorSide, action.targetId);
        if (target) {
            // Signature splash: in team formats the super also washes over every
            // OTHER living foe — collected before the primary hit can KO them.
            const splashTargets = superCast
                ? livingOf(session, actorSide === 'player' ? 'enemy' : 'player').filter((foe) => foe !== target)
                : [];
            switch (kind) {
                case 'damage':
                    applyOffensiveHit(target, 1);
                    break;
                case 'crush':
                    if (applyOffensiveHit(target, 1.1, 'crush') && !target.ko) {
                        addStatus(session, target, 'crush', 2, 0.8, reactions);
                    }
                    break;
                case 'lifesteal': {
                    const before = targets.length;
                    applyOffensiveHit(target, 1, 'lifesteal');
                    const dealt = targets[before]?.damage ?? 0;
                    const healed = applyHeal(actor, dealt * 0.5, session.round);
                    if (healed > 0) targets.push({ id: actor.id, damage: 0, heal: healed, effectiveness: 'neutral', guarded: false, ko: false });
                    break;
                }
                case 'dot':
                case 'burn':
                case 'wound': {
                    // 0.82 initial + 2 ticks of 24% ≈ 130% of a plain hit's power
                    // over three rounds — the kind-carrier analysis showed the
                    // old 0.75/0.20 premium still under-paid for the delay (dot
                    // carriers at ~30% win rate, burn ~43%).
                    if (applyOffensiveHit(target, 0.82, kind) && !target.ko) {
                        addStatus(session, target, storedStatusKind(kind), 2, Math.round(power * 0.24), reactions);
                    }
                    break;
                }
                case 'stun':
                    if (applyOffensiveHit(target, 0.5, 'stun') && !target.ko && !hasStatus(target, 'steadfast')) {
                        addStatus(session, target, 'stun', 1, 1, reactions);
                    }
                    break;
                case 'freeze':
                    if (applyOffensiveHit(target, 0.6, 'freeze') && !target.ko && !hasStatus(target, 'steadfast')) {
                        addStatus(session, target, 'freeze', 1, 1, reactions);
                    }
                    break;
                case 'confuse':
                    if (applyOffensiveHit(target, 0.6, 'confuse') && !target.ko && !hasStatus(target, 'steadfast')) {
                        addStatus(session, target, 'confuse', 2, 1, reactions);
                    }
                    break;
                case 'debuff':
                    if (applyOffensiveHit(target, 0.4, 'debuff') && !target.ko) {
                        addStatus(session, target, 'debuff', 2, 0.8, reactions);
                    }
                    break;
                case 'mark':
                    if (applyOffensiveHit(target, 0.4, 'mark') && !target.ko) {
                        addStatus(session, target, 'mark', 3, 1.25, reactions);
                    }
                    break;
                case 'slow':
                case 'movelock':
                    if (applyOffensiveHit(target, 0.4, 'slow') && !target.ko) {
                        addStatus(session, target, storedStatusKind(kind), 2, 0.75, reactions);
                    }
                    break;
                case 'push':
                case 'pull':
                    if (applyOffensiveHit(target, 0.85, kind)) {
                        target.stamina = Math.max(0, target.stamina - 16);
                    }
                    break;
                default:
                    applyOffensiveHit(target, 1);
                    break;
            }
            for (const foe of splashTargets) {
                if (!foe.ko) applyOffensiveHit(foe, SHOWDOWN_SUPER_SPLASH_SCALE, undefined, true);
            }
        }
    }

    events.push({
        t: 'action',
        actorId: actor.id,
        actorSide,
        moveName: move.name,
        moveKind: kind,
        element: actor.element,
        delivery: deliveryFor(kind, actor.role),
        // The haymaker is exactly the move promoteHeavy stamped with a hold and
        // the heavy priority; a jab is the cheap always-affordable opener.
        weight: move.hold > 0 || move.priority <= SHOWDOWN_PRIORITY_HEAVY
            ? 'heavy'
            : move.priority >= SHOWDOWN_PRIORITY_LIGHT ? 'light' : 'normal',
        super: superCast,
        targets,
        staminaAfter: Math.round(actor.stamina),
        meterAfter: Math.round(actor.meter),
        overexerted,
        ...(overexertDamage > 0 ? { overexertDamage } : {}),
    });
    // ...and only now the charges that answered it.
    for (const reaction of reactions) events.push(reaction);
}

function sideDefeated(session: ShowdownSession, side: Side): boolean {
    // The BENCH counts: a wiped field with reserves is a reinforcement moment,
    // not a loss.
    return livingTeam(session, side).length === 0;
}


function finish(session: ShowdownSession, outcome: ShowdownOutcome, events: ShowdownEvent[]): void {
    session.finished = true;
    session.outcome = outcome;
    events.push({ t: 'end', outcome });
}

/**
 * Resolve one full round: both sides' commands execute in speed order, then
 * end-of-round upkeep (DoTs, status decay, stamina regen).
 */
export function resolveShowdownRound(
    session: ShowdownSession,
    playerCommands: ShowdownCommand[],
    enemyCommands: ShowdownCommand[],
): ShowdownEvent[] {
    const events: ShowdownEvent[] = [];
    if (session.finished) return events;
    session.round += 1;
    events.push({ t: 'roundStart', round: session.round });

    const commandFor = (pet: ShowdownPet, side: Side): ShowdownCommand => {
        const list = side === 'player' ? playerCommands : enemyCommands;
        const found = list.find((c) => c.petId === pet.id);
        return found ?? { kind: 'guard', petId: pet.id };
    };

    // ── Switch phase: Pokémon priority — ALL switches resolve before any
    // attack, so a read on the incoming pet is a real prediction play. ──────
    const switchedIn = new Set<string>();
    for (const side of ['player', 'enemy'] as Side[]) {
        const commands = side === 'player' ? playerCommands : enemyCommands;
        for (const command of commands) {
            if (command.kind !== 'switch') continue;
            const team = side === 'player' ? session.player : session.enemy;
            // A winded pet cannot switch out — the overdraft's stolen turn
            // must be PAID, not dodged by rotating to the bench.
            const out = team.find((p) => p.id === command.petId && !p.ko && !p.benched && !p.winded);
            const inbound = team.find((p) => p.id === command.benchPetId && !p.ko && p.benched);
            if (!out || !inbound) continue;
            out.benched = true;
            out.guarding = false;
            // Field-presence effects end when the body leaves the arena.
            out.statuses = out.statuses.filter((s) => s.kind !== 'taunt' && s.kind !== 'tauntGuard');
            inbound.benched = false;
            switchedIn.add(inbound.id);
            events.push({ t: 'switch', side, outId: out.id, inId: inbound.id, reinforcement: false });
        }
    }

    // Temtem-style order: pet speed × the CHOSEN move's priority, seeded
    // tiebreak, snapshot after switches. A guard resolves fast, a haymaker
    // swings late — the round order is itself a consequence of the commands.
    // Freshly switched-in pets spent their action arriving.
    const priorityFor = (pet: ShowdownPet, command: ShowdownCommand): number => {
        if (command.kind === 'guard') return SHOWDOWN_PRIORITY_GUARD;
        if (command.kind === 'rest') return SHOWDOWN_PRIORITY_REST;
        if (command.kind === 'super') return pet.signatureMove.priority;
        if (command.kind === 'move') return pet.moves[command.moveIndex]?.priority ?? SHOWDOWN_PRIORITY_NORMAL;
        return SHOWDOWN_PRIORITY_NORMAL;
    };
    // Sanitize EXACTLY ONCE, here, and carry the decision into the action
    // loop. Sanitizing twice (sort time, then act time against mutated state)
    // was exploitable: a super submitted at meter 82-99 sanitized to `guard`
    // for the sort — buying the 1.5x guard priority slot — then topped its
    // meter up from damage taken mid-round and fired the super early, ahead
    // of every enemy Guard.
    const order = [
        ...session.player.filter((p) => !p.ko && !p.benched).map((pet) => ({ pet, side: 'player' as Side })),
        ...session.enemy.filter((p) => !p.ko && !p.benched).map((pet) => ({ pet, side: 'enemy' as Side })),
    ]
        .filter(({ pet }) => !switchedIn.has(pet.id))
        .map((entry) => {
            const command = sanitizeCommand(session, entry.pet, commandFor(entry.pet, entry.side));
            return {
                ...entry,
                command,
                sortKey: effSpeed(entry.pet) * priorityFor(entry.pet, command) + nextRand(session) * 0.5,
            };
        })
        .sort((a, b) => b.sortKey - a.sortKey);

    for (const { pet, side, command } of order) {
        if (session.finished) break;
        if (pet.ko || pet.benched) continue;

        // Skips: overexertion wind, stun, freeze coin.
        if (pet.winded) {
            pet.winded = false;
            events.push({ t: 'skip', actorId: pet.id, actorSide: side, reason: 'winded' });
            continue;
        }
        if (hasStatus(pet, 'stun')) {
            pet.statuses = pet.statuses.filter((s) => s.kind !== 'stun');
            // Paying the stolen turn grants brief immunity — control cannot
            // chain into a perma-lock (the Sleep Clause of this engine).
            addStatus(session, pet, 'steadfast', 2, 1);
            events.push({ t: 'skip', actorId: pet.id, actorSide: side, reason: 'stun' });
            continue;
        }
        if (hasStatus(pet, 'freeze') && nextRand(session) < 0.5) {
            pet.statuses = pet.statuses.filter((s) => s.kind !== 'freeze');
            addStatus(session, pet, 'steadfast', 2, 1);
            events.push({ t: 'skip', actorId: pet.id, actorSide: side, reason: 'freeze' });
            continue;
        }

        // Confusion: half chance the action becomes a self-hit.
        if (hasStatus(pet, 'confuse') && command.kind !== 'guard' && command.kind !== 'rest' && nextRand(session) < 0.5) {
            const selfDmg = Math.max(1, Math.round((effAttack(pet) * 0.55 * (0.95 + nextRand(session) * 0.1))));
            const reactions: ShowdownEvent[] = [];
            const { ko } = applyDamage(session, pet, selfDmg, true, reactions);
            events.push({ t: 'confused', actorId: pet.id, actorSide: side, selfDamage: selfDmg, ko });
            for (const reaction of reactions) events.push(reaction);
        } else if (command.kind === 'guard') {
            pet.guarding = true;
            pet.stamina = Math.max(0, pet.stamina - SHOWDOWN_GUARD_COST);
            events.push({
                t: 'action', actorId: pet.id, actorSide: side, moveName: 'Guard', moveKind: 'guard',
                element: pet.element, delivery: 'self', weight: 'light', super: false,
                targets: [{ id: pet.id, damage: 0, heal: 0, effectiveness: 'neutral', guarded: false, ko: false, applied: 'guard' }],
                staminaAfter: Math.round(pet.stamina), meterAfter: Math.round(pet.meter), overexerted: false,
            });
        } else if (command.kind === 'rest') {
            pet.stamina = Math.min(pet.maxStamina, pet.stamina + Math.round(pet.maxStamina * SHOWDOWN_REST_PCT) + SHOWDOWN_REST_FLAT);
            pet.guarding = false;
            events.push({
                t: 'action', actorId: pet.id, actorSide: side, moveName: 'Catch Breath', moveKind: 'rest',
                element: pet.element, delivery: 'self', weight: 'light', super: false,
                targets: [{ id: pet.id, damage: 0, heal: 0, effectiveness: 'neutral', guarded: false, ko: false, applied: 'rest' }],
                staminaAfter: Math.round(pet.stamina), meterAfter: Math.round(pet.meter), overexerted: false,
            });
        } else if (command.kind === 'super') {
            executeMove(session, pet, side, {
                move: pet.signatureMove, superCast: true, targetId: command.targetId,
            }, events);
        } else if (command.kind === 'move') {
            executeMove(session, pet, side, {
                move: pet.moves[command.moveIndex], superCast: false, targetId: command.targetId,
            }, events);
        }
        // ('switch' never reaches here: successful swaps left the order, and
        // sanitizeCommand downgrades a failed swap to guard above.)

        if (sideDefeated(session, 'enemy')) { finish(session, 'win', events); }
        else if (sideDefeated(session, 'player')) { finish(session, 'loss', events); }
    }

    // ── End-of-round upkeep ──────────────────────────────────────────────────
    if (!session.finished) {
        for (const side of ['player', 'enemy'] as Side[]) {
            // Field pets: DoTs tick, statuses decay, cooldowns and stamina turn.
            for (const pet of livingOf(session, side)) {
                // Side defeat from a tick is detected after upkeep, so both
                // sides always take their full end-of-round damage.
                for (const s of pet.statuses) {
                    if ((s.kind === 'burn' || s.kind === 'wound') && s.magnitude > 0) {
                        const reactions: ShowdownEvent[] = [];
                        const { dealt, ko } = applyDamage(session, pet, s.magnitude, true, reactions);
                        if (dealt > 0) events.push({ t: 'dot', targetId: pet.id, targetSide: side, kind: s.kind, damage: dealt, ko });
                        for (const reaction of reactions) events.push(reaction);
                    }
                }
                if (pet.ko) continue;
                // Status decay + regen. A status born THIS round is exempt
                // from this round's decay — a stun landed mid-round must
                // still cost the target its next-round action.
                pet.statuses = pet.statuses
                    .map((s) => (s.bornRound < session.round ? { ...s, rounds: s.rounds - 1 } : s))
                    .filter((s) => s.rounds > 0);
                pet.stamina = Math.min(pet.maxStamina, pet.stamina + Math.round(pet.maxStamina * SHOWDOWN_STAMINA_REGEN_PCT) + SHOWDOWN_STAMINA_REGEN_FLAT);
            }
            // Bench pets rest: stamina recovers, statuses stay frozen (no
            // ticks, no decay — you can't wait out a burn from the bench).
            for (const pet of livingTeam(session, side).filter((p) => p.benched)) {
                pet.stamina = Math.min(pet.maxStamina, pet.stamina + Math.round(pet.maxStamina * SHOWDOWN_STAMINA_REGEN_PCT) + SHOWDOWN_STAMINA_REGEN_FLAT);
            }
            // Hold timers tick for EVERYONE, field or bench (the Temtem rule).
            for (const pet of livingTeam(session, side)) pet.readiness += 1;
        }
        if (sideDefeated(session, 'enemy')) finish(session, 'win', events);
        else if (sideDefeated(session, 'player')) finish(session, 'loss', events);
    }

    // ── Reinforcements: the bench fills empty field slots at round end ──────
    if (!session.finished) {
        const fieldSize = SHOWDOWN_FORMAT_SIZE[session.format];
        for (const side of ['player', 'enemy'] as Side[]) {
            const team = side === 'player' ? session.player : session.enemy;
            let fielded = livingOf(session, side).length;
            for (const pet of team) {
                if (fielded >= fieldSize) break;
                if (pet.ko || !pet.benched) continue;
                pet.benched = false;
                fielded += 1;
                const fallen = team.find((p) => p.ko && !p.benched);
                events.push({ t: 'switch', side, outId: fallen?.id ?? pet.id, inId: pet.id, reinforcement: true });
            }
        }
    }

    // ── Attrition ───────────────────────────────────────────────────────────
    // There is NO round cap and no judge: a fight ends when a team falls. What
    // stops it running forever is this — from SHOWDOWN_ATTRITION_START every
    // living pet bleeds a ramping share of its own max HP, and healing has
    // already decayed (see applyHeal). It hits both sides equally, so it never
    // decides the winner; it just guarantees there is one. It begins at the
    // round the old cap used to fire, so the ~96% of fights that finish sooner
    // are completely unaffected.
    if (!session.finished) {
        const pct = showdownAttritionPct(session.round);
        if (pct > 0) {
            for (const side of ['player', 'enemy'] as const) {
                for (const pet of session[side]) {
                    if (pet.ko || pet.benched) continue;
                    const bleed = Math.max(1, Math.round(pet.maxHp * pct));
                    const reactions: ShowdownEvent[] = [];
                    const { dealt, ko } = applyDamage(session, pet, bleed, false, reactions);
                    if (dealt > 0) {
                        events.push({ t: 'dot', targetId: pet.id, targetSide: side, kind: 'attrition', damage: dealt, ko });
                    }
                    for (const reaction of reactions) events.push(reaction);
                }
            }
            if (sideDefeated(session, 'enemy')) finish(session, 'win', events);
            else if (sideDefeated(session, 'player')) finish(session, 'loss', events);
        }
    }

    events.push({ t: 'roundEnd', round: session.round });
    return events;
}

/** Downgrade any illegal command to a safe Guard — never fail the whole turn. */
export function sanitizeCommand(session: ShowdownSession, pet: ShowdownPet, command: ShowdownCommand): ShowdownCommand {
    if (command.kind === 'guard' || command.kind === 'rest') return command;
    // Switch legality is enforced in the switch phase itself (an invalid swap
    // is simply skipped); by the time the action loop runs, any pet still
    // holding a switch command had its swap rejected — it guards instead.
    if (command.kind === 'switch') return { kind: 'guard', petId: pet.id };
    if (command.kind === 'super') {
        if (pet.meter >= SHOWDOWN_METER_MAX && pet.readiness >= pet.signatureMove.hold) return command;
        return { kind: 'guard', petId: pet.id };
    }
    const move = pet.moves[command.moveIndex];
    if (!move || pet.readiness < move.hold) return { kind: 'guard', petId: pet.id };
    return command;
}

// ─── Public view ─────────────────────────────────────────────────────────────

function petView(pet: ShowdownPet): ShowdownPetView {
    return {
        id: pet.id,
        name: pet.name,
        element: pet.element,
        role: pet.role,
        rarity: pet.rarity,
        ...(pet.templateId ? { templateId: pet.templateId } : {}),
        level: pet.level,
        hp: Math.round(pet.hp),
        maxHp: pet.maxHp,
        stamina: Math.round(pet.stamina),
        maxStamina: pet.maxStamina,
        meter: Math.round(pet.meter),
        ko: pet.ko,
        guarding: pet.guarding,
        benched: pet.benched,
        speed: Math.round(effSpeed(pet)),
        skipsNextAction: pet.winded || hasStatus(pet, 'stun'),
        // Mirrors the switch-phase predicate exactly, so the client cannot
        // offer a switch the engine will silently refuse.
        canSwitchOut: !pet.winded,
        statuses: pet.statuses
            .filter((s) => s.kind !== 'tauntGuard')
            .map((s) => ({ kind: s.kind, rounds: s.rounds, magnitude: Math.round(s.magnitude) })),
        readiness: pet.readiness,
        ...(pet.trait ? { trait: pet.trait } : {}),
        ...(pet.gear ? { gearName: pet.gear.name } : {}),
        // Published only while a charge remains: the chip vanishing when the
        // item fires is the whole spent indicator, no extra state needed.
        ...(pet.consumable && (pet.consumable.dodge > 0 || pet.consumable.mitigate > 0
            || pet.consumable.endure > 0 || pet.consumable.thorns > 0
            || pet.consumable.lifeline > 0 || pet.consumable.cleanse > 0)
            ? { consumableName: pet.consumable.name } : {}),
        moves: pet.moves.map((m) => ({
            name: m.name, power: m.power, kind: m.kind, cost: m.cost, signature: false,
            priority: m.priority, hold: m.hold, effect: moveEffectText(m.kind, m.power),
        })).concat([{
            name: pet.signatureMove.name, power: pet.signatureMove.power, kind: pet.signatureMove.kind,
            cost: 0, signature: true,
            priority: pet.signatureMove.priority, hold: pet.signatureMove.hold,
            effect: 'Spends the full meter — massive damage',
        }]),
    };
}

export function showdownStateView(session: ShowdownSession): ShowdownStateView {
    return {
        sessionId: session.sessionId,
        format: session.format,
        tier: session.tier,
        round: session.round,
        attritionAt: SHOWDOWN_ATTRITION_START,
        finished: session.finished,
        outcome: session.outcome,
        player: session.player.map(petView),
        enemy: session.enemy.map(petView),
        enemyTeamName: session.enemyTeamName,
        // Projected order for the NEXT round: current haste/slow effects
        // applied, the per-round rng jitter deliberately excluded — a preview,
        // not a promise (ties can still flip on the tiebreak roll).
        nextOrder: [...session.player, ...session.enemy]
            .filter((p) => !p.ko && !p.benched)
            .sort((a, b) => effSpeed(b) - effSpeed(a))
            .map((p) => p.id),
    };
}
