/*
 * Pet Showdown — the shared contract between the server-authoritative turn
 * engine (api/_pet-showdown/) and the client presentation layer
 * (shinobij.client/src/screens/PetShowdown.tsx + components/PetShowdownBattle.tsx).
 *
 * ARCHITECTURE (docs/pet-showdown-design.md): Showdown is a turn-based command
 * battle. The ENGINE LIVES ONLY ON THE SERVER — each round is one POST to
 * /api/pet/showdown and the server returns a TURN SCRIPT (an ordered list of
 * ShowdownEvent) that the client merely plays back cinematically. The client
 * never resolves combat, so there is no parity mirror, no lockstep, and no
 * input-log replay to maintain. This file holds only types and pure constants —
 * NO logic — so neither build can drift from the other.
 *
 * Determinism note: all numbers the client displays (damage, stamina, meter)
 * arrive inside events; the client must render them verbatim, never recompute.
 */

export type ShowdownFormat = "1v1" | "2v2" | "3v3";

export type ShowdownTier = "scrapper" | "warrior" | "champion";

export type ShowdownOutcome = "win" | "loss";

/** Element counter wheel (matches the live Pet Arena chart):
 *  Fire > Wind > Lightning > Earth > Water > Fire. */
export const SHOWDOWN_ELEMENT_BEATS: Readonly<Record<string, string>> = Object.freeze({
    Fire: "Wind",
    Wind: "Lightning",
    Lightning: "Earth",
    Earth: "Water",
    Water: "Fire",
});

// Tuned per the elemental-wheel research pass (docs/pet-showdown-design.md):
// with bench switching shipped as the counterplay, a gentle wheel underprices
// the switch (the matchup delta a swap captures must beat ~2 actions of cost).
// 1.5/0.75 (swing 2.0) sits between WoW pet battles' proven 1.5/0.66 and the
// fan-Naruto ±25% standard: a half-flip switch pays back in ~2.7 rounds, a
// full flip in ~1.3 — switching becomes the central decision without being
// forced every turn. The 0.75 floor (not the 0.66 reciprocal) is deliberate:
// single-element pets have no second type to hedge a bad matchup, and canon
// Naruto's wheel is explicitly power-can-overcome, not a hard counter.
// Cycle symmetry keeps AGGREGATE element win rates ~50% at any multiplier —
// this sharpens individual matchups, which the bench now answers.
export const SHOWDOWN_ELEMENT_ADVANTAGE = 1.5;
export const SHOWDOWN_ELEMENT_DISADVANTAGE = 0.75;

/*
 * Per-pet stamina economy — the FULL Temtem model:
 *  - The POOL IS A STAT: each pet's max stamina derives from its bulk
 *    (hp/defense), so a war tortoise casts longer than a glass kitsune.
 *    Range ~85-120 around the 100 reference.
 *  - Regen is LOW (Temtem: 5% + 1/turn): passive income sits an order of
 *    magnitude below nuke cost, so "spam your best move" is arithmetically
 *    self-terminating within 2-3 uses and Rest is a real rotation beat.
 *  - Rest recovers ~22% + 2 (Temtem: 20% + 1) plus a small heal.
 *  - OVERDRAFT (using a move costing more than remaining stamina): the move
 *    still fires, the pet takes HP damage proportional to the deficit, and
 *    it is winded (forced skip) next round — Temtem's overexertion, HP chip
 *    included.
 */
export const SHOWDOWN_STAMINA_REFERENCE = 100;
/** Regen fraction of MAX per round (+ the flat point), field or bench. */
export const SHOWDOWN_STAMINA_REGEN_PCT = 0.07;
export const SHOWDOWN_STAMINA_REGEN_FLAT = 2;
/** Rest recovery fraction of MAX (+ flat). */
export const SHOWDOWN_REST_PCT = 0.22;
export const SHOWDOWN_REST_FLAT = 2;
/** Rest also patches the pet up a little so it is a real decision, not a tax. */
export const SHOWDOWN_REST_HEAL_PCT = 0.04;
/** HP damage per point of stamina deficit on an overdraft. */
export const SHOWDOWN_OVERDRAFT_HP_PER_POINT = 2;
export const SHOWDOWN_GUARD_COST = 8;
/** Guard halves incoming damage until the pet's next action. */
export const SHOWDOWN_GUARD_MULT = 0.5;

/** Move stamina cost by power band (absolute — a bigger pool literally buys
 *  more casts, which IS the species identity). */
export const SHOWDOWN_COST_LIGHT = 18;   // power <= 120
export const SHOWDOWN_COST_MEDIUM = 32;  // power <= 220
export const SHOWDOWN_COST_HEAVY = 52;   // power > 220
export const SHOWDOWN_COST_BASIC = 14;   // the universal Swift Strike

/** Super meter: fills from combat, spent whole on the signature move. */
export const SHOWDOWN_METER_MAX = 100;
export const SHOWDOWN_METER_ON_HIT_DEALT = 10;
export const SHOWDOWN_METER_ON_HIT_TAKEN = 18;
export const SHOWDOWN_METER_ON_GUARDED_HIT = 14;
/** The signature/super cast multiplies move power by this. */
export const SHOWDOWN_SUPER_POWER_MULT = 1.6;
/** In 2v2/3v3 a signature also SPLASHES every other living foe at this rate —
 *  the ultimate is a screen-wide moment, not a single-target nuke. */
export const SHOWDOWN_SUPER_SPLASH_SCALE = 0.72;
/** Temtem-style ally synergy: in team formats, an offensive move gains this
 *  multiplier when a LIVING ally's element beats the target's element. */
export const SHOWDOWN_SYNERGY_MULT = 1.1;

/** Timing-needle grades (client-measured, server-CLAMPED — expression, not
 *  requirement; the ceiling bounds what a dishonest client can gain). */
export const SHOWDOWN_TIMING_MULTS: readonly number[] = Object.freeze([1.0, 1.1, 1.22]);

/** Temtem-style MULTIPLICATIVE move priority (order = pet speed × priority of
 *  the chosen action). Multiplicative — not absolute brackets — so a slow
 *  pet's quick jab still doesn't outrun a fast pet's. Guard is the defensive
 *  quick-action; heavy nukes and signatures swing LAST. */
export const SHOWDOWN_PRIORITY_GUARD = 1.5;
export const SHOWDOWN_PRIORITY_REST = 0.9;
export const SHOWDOWN_PRIORITY_LIGHT = 1.15;   // power ≤ 80 quick jabs
export const SHOWDOWN_PRIORITY_NORMAL = 1.0;
export const SHOWDOWN_PRIORITY_HEAVY = 0.8;    // power > 220 haymakers
export const SHOWDOWN_PRIORITY_SUPER = 0.75;   // signatures swing last

/** Heavy techniques HOLD: unusable until the pet has been in battle this many
 *  rounds (counts everywhere, field or bench — the Temtem rule). */
export const SHOWDOWN_HOLD_HEAVY = 1;   // power > 220
export const SHOWDOWN_HOLD_SUPER = 2;   // signatures

/** Hard round cap — at cap the judge scores remaining HP%; there are NO draws.
 *  A single KO averages ~7 rounds, so a flat 14 cannot resolve a team that
 *  fields its reserves one at a time: measured judge rates were 1v1+0 11.3%,
 *  1v1+1 49.1%, 1v1+2 **87.2%** — the format the lobby sells as "one on the
 *  field, two in reserve" was decided by the timer, not by combat. The cap
 *  therefore extends per RESERVE (bench depth), not per team size, which
 *  leaves 2v2/3v3 (which field everyone at once) exactly as tuned. */
export const SHOWDOWN_MAX_ROUNDS = 14;
export const SHOWDOWN_ROUNDS_PER_RESERVE = 5;

export function showdownRoundCap(teamSize: number, fieldSize: number): number {
    const reserves = Math.max(0, teamSize - fieldSize);
    return SHOWDOWN_MAX_ROUNDS + reserves * SHOWDOWN_ROUNDS_PER_RESERVE;
}

export const SHOWDOWN_FORMAT_SIZE: Readonly<Record<ShowdownFormat, number>> = Object.freeze({
    "1v1": 1,
    "2v2": 2,
    "3v3": 3,
});

/** Max pets on a team (field + bench). Every format allows a bench up to this
 *  cap — the switch is the prediction layer that replaces board movement. */
export const SHOWDOWN_MAX_TEAM = 3;

/** One command per living pet per round. `timing` is the needle grade index
 *  into SHOWDOWN_TIMING_MULTS (0 = untapped/miss, 2 = perfect). */
export type ShowdownCommand =
    | { kind: "move"; petId: string; moveIndex: number; targetId: string; timing?: number }
    | { kind: "super"; petId: string; targetId: string; timing?: number }
    | { kind: "guard"; petId: string }
    | { kind: "rest"; petId: string }
    /** Swap the field pet out for a living bench pet. Switches resolve BEFORE
     *  all attacks (Pokémon priority), and both pets forfeit their action. */
    | { kind: "switch"; petId: string; benchPetId: string };

/** Public per-pet combat state, mirrored to the client after every round. */
export interface ShowdownPetView {
    id: string;
    name: string;
    element: string;
    role: string;
    rarity: string;
    /** Catalog species id — lets the client resolve the 3D model for AI pets. */
    templateId?: string;
    level: number;
    hp: number;
    maxHp: number;
    stamina: number;
    /** Per-pet stamina pool — a stat derived from bulk, ~85-120. */
    maxStamina: number;
    meter: number;
    ko: boolean;
    guarding: boolean;
    /** On the bench (not fielded). Statuses are frozen while benched. */
    benched: boolean;
    /** Effective speed (haste/slow/movelock + trait applied) — the magnitude
     *  the turn-order strip sorts on. */
    speed: number;
    /** This pet will lose its next action (overdraft wind or stun). Freeze is
     *  NOT included — it is a coin flip resolved at act time. */
    skipsNextAction: boolean;
    /** Overdraft-winded pets may not switch out (the stolen turn must be
     *  paid); stunned pets still may. Mirrors the engine's switch predicate. */
    canSwitchOut: boolean;
    statuses: { kind: string; rounds: number; magnitude: number }[];
    /** Trait riding into combat (Loyal/Aggressive/Guardian/Swift/Lucky/
     *  Battleborn + ultras) — the engine applies its in-combat effect. */
    trait?: string;
    /** Equipped PvP gear name, for the HUD chip. */
    gearName?: string;
    moves: {
        name: string;
        power: number;
        kind: string;
        cost: number;
        signature: boolean;
        /** Server-authored plain-English effect line ("Burns: 24% of power
         *  per round for 2 rounds"). NEVER computed on the client — a client
         *  table drifts the moment a kind is retuned. */
        effect: string;
        /** Temtem-style turn-order multiplier for the round this move is
         *  chosen: >1 resolves early, <1 swings late. */
        priority: number;
        /** Rounds the pet must have been in battle before this fires (Temtem
         *  Hold). 0 = always ready. NO COOLDOWNS — stamina and hold are the
         *  only gates, exactly the Temtem model. */
        hold: number;
    }[];
    /** Rounds this pet has been in the battle (holds count down everywhere,
     *  field or bench — the Temtem rule). */
    readiness: number;
}

export interface ShowdownStateView {
    sessionId: string;
    format: ShowdownFormat;
    tier: ShowdownTier;
    round: number;
    maxRounds: number;
    finished: boolean;
    outcome: ShowdownOutcome | null;
    player: ShowdownPetView[];
    enemy: ShowdownPetView[];
    enemyTeamName: string;
    /** Projected next-round action order (pet ids, current speed effects
     *  applied, rng tiebreaks excluded) — the Temtem-style order strip. */
    nextOrder: string[];
}

/** Effectiveness callout the presentation layer banners on impact. */
export type ShowdownEffectiveness = "super" | "weak" | "neutral";

/** One beat of the turn script. The client plays these strictly in order. */
export type ShowdownEvent =
    | { t: "roundStart"; round: number }
    | {
        t: "action";
        actorId: string;
        actorSide: "player" | "enemy";
        moveName: string;
        moveKind: string;
        element: string;
        /** Melee actions lunge; ranged actions fire a projectile. */
        delivery: "melee" | "ranged" | "self";
        /** Full-meter signature cast — cinematic camera takeover. */
        super: boolean;
        timing: number;
        targets: {
            id: string;
            damage: number;
            heal: number;
            effectiveness: ShowdownEffectiveness;
            guarded: boolean;
            ko: boolean;
            /** Status applied by this hit, if any (burn/stun/...). */
            applied?: string;
            /** An ally's element beat this target — the Synergy bonus landed. */
            synergy?: boolean;
            /** This hit is a signature's splash onto a secondary foe. */
            splash?: boolean;
        }[];
        /** Actor resources after the action, for HUD sync mid-script. */
        staminaAfter: number;
        meterAfter: number;
        /** Set when the actor overexerted and will be winded next round. */
        overexerted: boolean;
        /** HP the actor paid for the overdraft (Temtem's overexertion chip). */
        overexertDamage?: number;
    }
    | { t: "skip"; actorId: string; actorSide: "player" | "enemy"; reason: "winded" | "stun" | "freeze" | "ko" }
    | {
        t: "switch";
        side: "player" | "enemy";
        outId: string;
        inId: string;
        /** True when the bench auto-fills a KO'd slot at round end. */
        reinforcement: boolean;
    }
    | { t: "confused"; actorId: string; actorSide: "player" | "enemy"; selfDamage: number; ko: boolean }
    | { t: "dot"; targetId: string; targetSide: "player" | "enemy"; kind: string; damage: number; ko: boolean }
    | { t: "roundEnd"; round: number }
    | { t: "end"; outcome: ShowdownOutcome; byJudge: boolean };

export interface ShowdownTurnResponse {
    ok: boolean;
    events: ShowdownEvent[];
    state: ShowdownStateView;
    /** Present only on the finishing turn. */
    reward?: number;
    balances?: { ryo: number };
    totalPetWins?: number;
    dailyPetWins?: number;
    capped?: boolean;
    _saveVersion?: number;
    character?: unknown;
}

export interface ShowdownStartResponse {
    ok: boolean;
    state: ShowdownStateView;
}
