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
 *  - Rest recovers ~22% + 2 in total (Temtem: 20% + 1) and heals NOTHING.
 *  - OVERDRAFT (using a move costing more than remaining stamina): the move
 *    still fires, the pet takes HP damage proportional to the deficit, and
 *    it is winded (forced skip) next round — Temtem's overexertion, HP chip
 *    included.
 */
export const SHOWDOWN_STAMINA_REFERENCE = 100;
/** Scales the whole pool curve. At 1.0 the band was 80-125 (median 105) and a
 *  mid-tier technique bought FIVE consecutive casts against a 6.5-round fight —
 *  you could throw your best affordable move every round and only run dry on
 *  the last one, which is a resource that does not bind. Scaling (rather than
 *  re-deriving the curve) keeps the glass-cannon-to-war-tortoise spread exactly
 *  as tuned; only the absolute size moves. */
export const SHOWDOWN_STAMINA_POOL_SCALE = 0.74;
/** Regen fraction of MAX per round (+ the flat point), field or bench. */
export const SHOWDOWN_STAMINA_REGEN_PCT = 0.07;
export const SHOWDOWN_STAMINA_REGEN_FLAT = 2;
/** Rest's BONUS stamina, on top of the end-of-round passive regen a resting pet
 *  still collects. Temtem's exact figure: passive is 5%+1 and Rest adds 15% for
 *  a 20%+1 total; ours is a slightly kinder 7%+2 passive for a 22%+2 total.
 *
 *  Rest grants NO HEALING. It used to restore 4% of max HP, which Temtem never
 *  does — HP does not regenerate in combat there at all. That invented heal was
 *  also the thing that made mutual Rest a self-sustaining fixed point, and it
 *  quietly made stalling the strongest defensive line in the game. Rest is now
 *  what it is in Temtem: you give up your turn to buy stamina back. */
export const SHOWDOWN_REST_PCT = 0.15;
export const SHOWDOWN_REST_FLAT = 0;
/** HP damage per point of stamina deficit on an overdraft. */
export const SHOWDOWN_OVERDRAFT_HP_PER_POINT = 2;
export const SHOWDOWN_GUARD_COST = 8;
/** Guard halves incoming damage until the pet's next action. */
export const SHOWDOWN_GUARD_MULT = 0.5;

/*
 * Move stamina cost — PROPORTIONAL TO POWER, the Temtem shape.
 *
 * This replaced three coarse bands (18 / 32 / 52 at power <=120 / <=220 / >220)
 * that were calibrated for a power range the content never reaches. Measured
 * across all 160 catalog species: 83% of every kit move cost 14 or 18, the
 * heavy band was used by ZERO moves, and the medium band by 5 of 717. Worse,
 * the biggest damage move in a kit (power 142 at 18 EN) was also the most
 * stamina-EFFICIENT thing a pet owned — so the strongest option was also the
 * default option, every round, which is the textbook way to make a resource
 * decorative.
 *
 * Temtem prices techniques at a near-FLAT damage-per-stamina (Scratch 20/4,
 * Jaw Strike 60/9, Base Jump 100/22, Frond Whip 153/33 — all ~4.2-5.2 dmg per
 * point), which means an expensive technique is never more efficient, only
 * more IMMEDIATE. What you buy with the cost is tempo, and what you pay is the
 * next few rounds. That is the trade we want, so cost is now linear in power.
 *
 * Calibration against a ~105 pool with 7%+2 regen (Temtem runs 5%+1, so ours
 * is the more forgiving side of the same curve):
 *   jab   power  55 ->  10 EN  (10% of pool; net +1/round, sustainable forever)
 *   mid   power  90 ->  27 EN  (26%; ~3 casts before it bites)
 *   big   power 142 ->  43 EN  (41%)
 *   heavy power 200 ->  60 EN  (57%; roughly Temtem's 33/50 haymaker)
 */
export const SHOWDOWN_COST_PER_POWER = 0.36;
/** Nothing costs less than this, so a 0-power utility move is never free. */
export const SHOWDOWN_COST_MIN = 10;
/** Nothing costs more than this, so even the biggest haymaker is castable from
 *  a full pool rather than being a permanent overdraft. Sized against the
 *  SMALLEST pool in the catalog (88): 78 is 89% of it — brutal, but payable. */
export const SHOWDOWN_COST_MAX = 78;
/** The universal Swift Strike. Deliberately the cheapest thing in the game:
 *  its whole job is to be the play you can always afford. */
export const SHOWDOWN_COST_BASIC = 12;
/** Control and sustain are priced like haymakers whatever their listed power —
 *  a stolen turn or an undone round of damage outvalues most hits. */
export const SHOWDOWN_COST_CONTROL_FLOOR = 44;
export const SHOWDOWN_COST_SUSTAIN_FLOOR = 40;

/** Every kit's biggest damage move is promoted to that pet's HAYMAKER: this
 *  much more power, priced on the same flat curve (so efficiency is unchanged
 *  and only tempo moves), swinging last and unavailable on round one.
 *
 *  Deliberately a pure MULTIPLIER off the pet's own top move, never a flat
 *  floor. A floor was tried first (0.46 x the rarity power ceiling) and it gave
 *  every species of a rarity an identical haymaker — 147 power for every
 *  standard pet, whatever its kit. That erased the kit-power spread the
 *  per-element damage multipliers are balanced against, and Fire (which deals
 *  1.52x and takes 0.70x) ran away to a 79.5% element win rate in simulation.
 *  Scaling each pet off its OWN top move keeps species identity intact. */
export const SHOWDOWN_HEAVY_PROMOTE_MULT = 1.35;
/** ...and a premium ON TOP of the linear price. This is the one deliberate
 *  break from flat damage-per-stamina: the haymaker is the only move in the
 *  kit that is LESS efficient than the alternatives, which is what stops it
 *  becoming the default. You are paying for the whole hit landing in ONE
 *  round instead of two, and the bill lands at ~55% of a typical pool —
 *  Temtem's own haymaker sits at 33 STA out of a ~50 pool. */
export const SHOWDOWN_HEAVY_COST_PREMIUM = 1.3;

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

/*
 * NO ROUND LIMIT. A fight ends when a team is knocked out — never on a timer,
 * and there is no judge scoring HP% at a cap.
 *
 * But "delete the cap" cannot ship on its own. Measured with the cap lifted:
 * two pets that both Rest are a FIXED POINT (Rest heals 4% of max HP and costs
 * nothing at 0 stamina, so neither bar ever moves) — 20,000 rounds, still
 * unfinished. And it is not a degenerate case: an all-in-HP pet holding any of
 * the catalog's 40 heal moves out-sustains incoming damage outright above
 * ~1,700 x (atk/def) max HP, which never terminated in 87 of 100 real matchups
 * over 600 rounds. Stamina pressure cannot fix it either, because Guard and
 * Rest are the two actions that still work at an empty pool.
 *
 * ATTRITION is the replacement: from SHOWDOWN_ATTRITION_START, every living pet
 * bleeds a share of its own max HP at end of round, ramping each round, while
 * healing decays to nothing. It hits both sides equally, so it never picks the
 * winner — it just guarantees someone falls, and the fight is still decided by
 * who was ahead. It begins at the exact round the old cap used to fire, so the
 * 95.7% of fights that finish sooner play out completely unchanged; what used
 * to be an arbitrary ending is now the point where the fight starts closing.
 */
export const SHOWDOWN_ATTRITION_START = 14;
/** Bleed per attrition round, as a share of max HP, multiplied by how many
 *  rounds attrition has been running (round 14 = 2%, 15 = 4%, 16 = 6%, ...).
 *  Cumulative ~56% of a bar by round 20, so the tail is bounded near 22. */
export const SHOWDOWN_ATTRITION_BLEED_PCT = 0.02;
/** Healing multiplier decay per attrition round — heals are dead by round 17,
 *  which is what actually closes the sustain stall. */
export const SHOWDOWN_ATTRITION_HEAL_DECAY = 0.25;

/** Multiplier applied to all healing this round (1 before attrition starts). */
export function showdownHealScale(round: number): number {
    const steps = round - SHOWDOWN_ATTRITION_START + 1;
    if (steps <= 0) return 1;
    return Math.max(0, 1 - steps * SHOWDOWN_ATTRITION_HEAL_DECAY);
}

/** Share of max HP each living pet bleeds at the end of `round` (0 before). */
export function showdownAttritionPct(round: number): number {
    const steps = round - SHOWDOWN_ATTRITION_START + 1;
    return steps <= 0 ? 0 : steps * SHOWDOWN_ATTRITION_BLEED_PCT;
}

export const SHOWDOWN_FORMAT_SIZE: Readonly<Record<ShowdownFormat, number>> = Object.freeze({
    "1v1": 1,
    "2v2": 2,
    "3v3": 3,
});

/** Max pets on a team (field + bench). Every format allows a bench up to this
 *  cap — the switch is the prediction layer that replaces board movement. */
export const SHOWDOWN_MAX_TEAM = 3;

/** One command per living pet per round. Deliberately carries no execution
 *  input: the timing-needle grade that used to ride along here was removed in
 *  round 18, so a command is pure INTENT and the engine alone decides outcome. */
export type ShowdownCommand =
    | { kind: "move"; petId: string; moveIndex: number; targetId: string }
    | { kind: "super"; petId: string; targetId: string }
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
    /** Equipped battle consumable, for the HUD chip — present only while a
     *  charge remains, so the chip disappearing IS the spent indicator. */
    consumableName?: string;
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
    /** The round attrition begins — the fight's pressure cue, not a limit. */
    attritionAt: number;
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

/** Reactive battle-consumable effects. Structurally identical to
 *  `PetConsumableEffect` in api/_pet-sim/pet-config.ts and deliberately
 *  restated rather than imported: this file must stay dependency-free so the
 *  client bundle never pulls a server catalog in behind a type. */
export type PetConsumableEffectName =
    | "dodge" | "mitigate" | "endure" | "thorns" | "lifeline" | "cleanse";

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
        /** Presentation tier. The engine builds a real jab / technique /
         *  haymaker ladder, but none of it used to reach the wire, so a
         *  34-power poke and a 300-power finisher painted the identical burst
         *  at the identical scale. Derived server-side from the move itself. */
        weight: "light" | "normal" | "heavy";
        /** Full-meter signature cast — cinematic camera takeover. */
        super: boolean;
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
            /** Named trait/gear effects that fired on this hit ("Executioner's
             *  Talon", "Hollowborn"). Without these the procs silently mutate
             *  damage with nothing on screen to attribute it to. */
            procs?: string[];
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
        /** A reactive battle-consumable charge fired (api/_pet-sim/pet-config.ts
         *  `petConsumables`). Its own beat rather than a field on the action,
         *  because a charge also answers a DoT tick, an attrition bleed or a
         *  confusion self-hit — and because the reflect it can throw back lands
         *  on a pet the action never targeted. Always scripted AFTER the beat
         *  that triggered it. */
        t: "consumable";
        /** The pet whose equipped item fired. */
        petId: string;
        side: "player" | "enemy";
        effect: PetConsumableEffectName;
        /** Item name for the callout ("Thornmail Oil"). */
        itemName: string;
        /** Who the numbers below land on — the ATTACKER for a thorns reflect,
         *  the owner itself for everything else. */
        targetId: string;
        /** Reflected damage (thorns); 0 for every other effect. */
        damage: number;
        /** HP restored (lifeline); 0 for every other effect. */
        heal: number;
        /** The reflect finished its target. */
        ko: boolean;
        /** The save-side item was consumed by entering this battle. False in
         *  practice, where the charge still fires and nothing is burned. */
        spent: boolean;
    }
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
    | { t: "end"; outcome: ShowdownOutcome };

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
    /** True when the session was sealed reward-ineligible — the hand-picked-AI
     *  practice entry. Nothing was paid and NO counter moved, so the response
     *  carries no balances, no totalPetWins and no dailyPetWins either. */
    practice?: boolean;
    _saveVersion?: number;
    character?: unknown;
}

export interface ShowdownStartResponse {
    ok: boolean;
    state: ShowdownStateView;
}
