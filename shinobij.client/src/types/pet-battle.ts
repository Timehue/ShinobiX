/*
 * Pet-battle PRESENTATION types — the sprite-mode + animation-event-queue
 * layer that sits on top of the deterministic simulator (runPetArenaBattle).
 *
 * These describe how a battle is DRAWN, never how it is resolved. The
 * simulator (App.tsx) stays the single source of truth for outcomes; this
 * layer is a pure transform of the frames it produces, so it can't change
 * balance, odds, or ranked-replay determinism.
 *
 * Phase 1 — sprite modes:
 *   A pet is drawn either as the legacy circular portrait (clipped into a
 *   disc, "UI icon" styling) or, when a transparent full-body PNG exists, as
 *   an un-clipped full-body battle sprite. Both modes consume the SAME
 *   PetVisualState poses below, so animation work is written once.
 *
 * Phase 2 — animation event queue:
 *   Every visible combat beat (windup, lunge, ranged cast, projectile,
 *   impact, recoil, guard, dodge, charge, KO, victory) is expressed as a
 *   PetBattleAnimationEvent. The renderer plays the queue instead of sliding
 *   one avatar into the other.
 */

/** How a pet is rendered on the battlefield. */
export type PetSpriteMode =
    | "circleFallback"
    | "fullBodySprite";

/** The visual pose an individual pet sprite is holding on a given tick. */
export type PetVisualState =
    | "idle"
    | "windup"
    | "lunge"
    | "rangedCast"
    | "projectileFire"
    | "hit"
    | "recoil"
    | "guard"
    | "dodge"
    | "charge"
    | "ko"
    | "victory";

/** The kind of choreography beat an animation event represents. */
export type PetBattleAnimationEventType =
    | "moveCallout"
    | "idle"
    | "windup"
    | "lunge"
    | "rangedCast"
    | "projectile"
    | "beam"
    | "impact"
    | "recoil"
    | "guard"
    | "block"
    | "dodge"
    | "charge"
    | "statusApply"
    | "damageNumber"
    | "healNumber"
    | "shieldNumber"
    | "screenShake"
    | "ko"
    | "victory";

/** Element / flavor tint that drives VFX colors for an event. */
export type PetVfxKey =
    | "fire"
    | "shadow"
    | "lightning"
    | "ice"
    | "poison"
    | "wind"
    | "earth"
    | "chakra"
    | "blood"
    | "water"
    | "none";

/** One beat in a frame's animation queue. */
export type PetBattleAnimationEvent = {
    id: string;
    actorId: string;
    targetId?: string;
    type: PetBattleAnimationEventType;
    durationMs: number;
    text?: string;
    amount?: number;
    vfxKey?: PetVfxKey;
};

// ── Phase 7-9: move model, base actions, status effects ──────────────────────

/** What a move DOES, tactically — drives AI, range, and animation choice. A
 *  single move can carry several tags (e.g. a ranged DoT, or a melee execute). */
export type PetMoveTag =
    | "melee" | "ranged" | "aoe" | "dot" | "shield" | "heal" | "buff" | "debuff"
    | "push" | "pull" | "root" | "slow" | "stun" | "pierce" | "reflect"
    | "counter" | "lifesteal" | "execute" | "charge" | "multiHit";

/** How a move is staged on the battlefield (picked by the animation queue). */
export type PetAnimationType =
    | "melee_lunge" | "ranged_projectile" | "beam" | "ground_impact"
    | "self_buff" | "shield" | "heal" | "roar" | "dash"
    | "counter" | "dodge" | "guard";

/** A coarse hint the AI uses to slot a move into its decision tree. */
export type PetAiHint =
    | "damage" | "execute" | "defense" | "kite" | "control" | "heal" | "buff" | "debuff";

/** Who/what a move can target — drives 2v2 targeting + multi-target resolution. */
export type PetMoveTargetType =
    | "singleEnemy"
    | "singleAlly"
    | "self"
    | "allEnemies"
    | "allAllies"
    | "allPets"
    | "area";

/** The rich, descriptor form of a pet move — derived from the persisted
 *  PetJutsu via jutsuToPetMove(). Moves are no longer all basic contact hits:
 *  each declares its range band, tags, animation, VFX, and AI intent. */
export type PetMove = {
    id: string;
    name: string;
    description: string;
    power: number;
    accuracy: number;       // 0-100 hit chance
    cooldown: number;
    range: { min: number; max: number };  // tile band the move can be used at
    tags: PetMoveTag[];
    animationType: PetAnimationType;
    vfxKey: PetVfxKey;
    aiHint: PetAiHint;
    targetType: PetMoveTargetType;
};

/** Turn choices available to every pet — it does NOT have to attack each turn. */
export type PetBaseAction =
    | "move"
    | "basicAttack"
    | "guard"
    | "evade"
    | "focus"
    | "brace"
    | "useMove";

/** The canonical set of visible combat statuses. */
export type BattleStatusId =
    | "burn" | "poison" | "wound" | "slow" | "haste" | "root" | "stun"
    | "guarding" | "shielded" | "focused" | "marked" | "blinded"
    | "taunted" | "armorBroken" | "countering" | "reflecting";

export type BattleStatusKind = "dot" | "control" | "debuff" | "buff" | "shield";

/** Display + rules metadata for a status (icon shown near the HP bar). */
export type BattleStatusDef = {
    id: BattleStatusId;
    icon: string;
    label: string;
    kind: BattleStatusKind;
    description: string;
};

/** An active status on an actor, for UI (icon + remaining rounds). */
export type ActiveBattleStatus = { id: BattleStatusId; rounds: number };
