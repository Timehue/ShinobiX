/*
 * The combat resolution order, written down as data.
 *
 * The order in which a jutsu's effects resolve is load-bearing: every heal is
 * clamped at max HP and every hit is clamped at zero, so running the same
 * steps in a different order produces different numbers. It used to live only
 * in comments, and those comments had drifted from the code (they placed
 * Siphon after Lifesteal; the engine has always run it before Recoil).
 *
 * These lists describe what the engine DOES. They are not read by the engine:
 * resolution-order.test.ts checks them against the source of api/pvp/move.ts
 * and api/combat-core/resolveJutsu.ts, and against real applyJutsu output, so
 * a reorder in the engine fails a test that names the step it moved. Changing
 * the order is a balance change — update the list, the engine and the
 * characterization snapshots (api/pvp/_applyjutsu-characterization.test.ts)
 * together, deliberately.
 *
 * PvP, Solo PvE, Towers and the Clan Boss all resolve casts through
 * applyJutsu (api/pvp/move.ts), so this is the order for every jutsu-based
 * mode. Pet duels and card duels have their own engines.
 */

/** One cast, from api/combat-core/resolveJutsu.ts `resolveJutsu`. */
export const JUTSU_RESOLUTION_PHASES = [
    /** EP scaling, stat factor, terrain/weather/bloodline multipliers, and the
     *  defender's DR pool. Reads the fighters as they were BEFORE this cast. */
    'resolveBaseDamage',
    /** Walks the jutsu's tags in authored order: applies or blocks statuses
     *  (deferred to next round), resolves Push/Pull, and collects the pending
     *  Heal/Shield plus Barrier/Pierce outcomes. */
    'resolveTagStatuses',
    /** Pierce true damage, or base × (1 − DR) × amp, then guard/elder mitigation
     *  and the attack/defense pill factors. Also reads the pre-cast fighters. */
    'resolveDamageNumber',
    /** Optional ceiling a mode can pass (Towers). Absent everywhere else. */
    'damageCap',
    /** Only when damage > 0: see POST_DAMAGE_ORDER. */
    'resolvePostDamage',
    /** The caster's pending Heal from this cast, clamped at max HP. */
    'applyHealing',
    /** The caster's pending Shield from this cast, clamped at the live cap. */
    'applyShield',
] as const;

/** Inside `resolvePostDamage` (api/pvp/move.ts). Every step reads the final
 *  post-shield damage, and each post-damage amount is capped at 60% of it.
 *  Pierce skips shield block, reflect and absorb. */
export const POST_DAMAGE_ORDER = [
    /** Defender's shield soaks first; the rest comes off HP. */
    'shieldBlock',
    /** Defender heals a % of the hit (status Absorb), unless the hit was lethal. */
    'absorb',
    /** Defender's armor absorb passive, same rule. */
    'itemAbsorb',
    /** Attacker takes a % back (status Reflect). */
    'reflect',
    /** Attacker takes a % back from the defender's armor passive. */
    'itemReflect',
    /** Attacker's armor lifesteal passive. */
    'itemLifesteal',
    /** Wound (bleed on the defender) and Siphon (heal on the attacker) fire
     *  here, in the order the jutsu lists them. */
    'woundAndSiphon',
    /** Attacker takes self-damage from an active Recoil status. */
    'recoil',
    /** Attacker heals from active Lifesteal stacks. */
    'lifesteal',
] as const;

/** `endTurn` (api/pvp/move.ts): what happens between one fighter's turn and
 *  the next. */
export const TURN_HANDOFF_ORDER = [
    /** The fighter who just acted: Wound, Poison and Drain ticks, after they had the
     *  whole turn to Cleanse (owner ruling 2026-10-05). A lethal tick ends the fight. */
    'applyDoTs',
    /** Past the round cap, the fight ends before anyone gets another turn. */
    'roundCapCheck',
    /** On a new round only: both fighters' statuses and ground effects age. */
    'tickStatusesAndGround',
    /** The fighter who just acted: cooldowns tick down. */
    'tickCooldowns',
    /** The fighter about to act: ground zones they stand in pulse. */
    'applyGroundEffects',
    /** The fighter about to act: queued Push/Pull movement lands. */
    'applyQueuedMovement',
    /** The fighter about to act: chakra/stamina regen. */
    'resourceRegen',
    /** A fighter at 0 HP now loses. */
    'checkWinner',
    /** Stun costs the new turn a flat AP penalty and is consumed. */
    'stunPenalty',
] as const;

export type JutsuResolutionPhase = typeof JUTSU_RESOLUTION_PHASES[number];
export type PostDamageStep = typeof POST_DAMAGE_ORDER[number];
export type TurnHandoffStep = typeof TURN_HANDOFF_ORDER[number];
