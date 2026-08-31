/*
 * Pet happiness — the bond loop.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Happiness shipped as a number that only ever went UP (+10 per free "Pet"
 * interaction, +10 per treat, +5 per bond training) and was read in exactly two
 * places: a training-XP bonus and a single obedience cliff at 71. Nothing spent
 * it and nothing decayed it, so within a minute of owning a companion every pet
 * in the game sat pinned at 100 forever and the meter was decoration.
 *
 * This module makes it a real upkeep loop with three pieces:
 *
 *   1. DECAY — happiness drops PET_HAPPINESS_DAILY_DECAY points at every daily
 *      reset (UTC midnight, the same rollover `lastDailyReset` uses). Missing a
 *      day costs one tick; missing five costs five, floored at 0.
 *   2. A BUDGET on the free interaction — petting is free, so without a cap the
 *      decay is undone by one click and nothing changes. PET_HAPPINESS_DAILY_PET
 *      _BUDGET bounds how much happiness a day of free petting can restore.
 *      Treats and bond training are NOT budgeted: they already cost an item or a
 *      training slot.
 *   3. PENALTIES below the existing bands — see the tier table.
 *
 * ── The tiers ───────────────────────────────────────────────────────────────
 * Every band at 50+ behaves EXACTLY as it did before this module existed. The
 * new penalties bite only below 50, which is somewhere a maintained pet never
 * goes: the decay is 10/day and the free budget alone restores 50/day. A pet
 * pinned at 100 sits at 50 (still restless, still unpenalised) after five
 * ignored days; the first penalty lands on the SIXTH, at 40.
 *
 *   content    80-100  train x1.15   combat x1.00   disobey  0%   (unchanged)
 *   steady     71-79   train x1.05   combat x1.00   disobey  0%   (unchanged)
 *   restless   50-70   train x1.05   combat x1.00   disobey 35%   (unchanged)
 *   unhappy    25-49   train x1.00   combat x0.90   disobey 50%   (NEW malus)
 *   neglected   0-24   train x0.85   combat x0.80   disobey 65%   (NEW malus)
 *
 * The 71 obedience cliff is `COMPANION_OBEDIENT_HAPPINESS` in
 * api/combat-core/companion.ts and predates this file; it is mirrored here as
 * PET_HAPPINESS_OBEDIENT so the tier table and the combat engine cannot drift.
 *
 * ── Storage ─────────────────────────────────────────────────────────────────
 * Two server-owned fields ride alongside `happiness` on each pet:
 *   happinessDay   UTC day index (floor(ms / 86_400_000)) of the last settle.
 *   happinessPets  free-petting POINTS already spent on `happinessDay` (not a
 *                  click count — it moves in PET_HAPPINESS_PET_GAIN steps).
 * Both are registered as `pet-identity` in api/save/_state-ownership.ts, so a
 * generic client save can never write them — only the pet endpoints and the
 * read-settle can.
 *
 * A pet with NO `happinessDay` has never been settled (every pet in every save
 * written before this shipped). It is stamped, never retro-decayed: nobody logs
 * in after this deploy to find a companion at 0 because a field was missing.
 *
 * Pure — no clock, no I/O. Callers pass `now`.
 */

export const PET_HAPPINESS_MAX = 100;

/** Happiness a newly acquired companion starts with — see petStartingHappiness. */
export const PET_HAPPINESS_NEW_PET = 60;

/** Points lost per daily reset the pet went without care. */
export const PET_HAPPINESS_DAILY_DECAY = 10;

/** Happiness restored by one free "Pet" interaction. */
export const PET_HAPPINESS_PET_GAIN = 10;

/**
 * Free-interaction budget per UTC day, per pet, in POINTS (not clicks).
 *
 * FIVE pets a day at +10 each. Two constraints pin this number:
 *   - It must exceed PET_HAPPINESS_DAILY_DECAY, or the loop is unwinnable for a
 *     player with no treats. A player who opens the Pet Yard daily never loses
 *     ground; the pressure comes from SKIPPING days, not from a daily chore.
 *   - It must not be lower than 5 interactions. The breeding elemental-bond
 *     requirement (`elemental-bond:interaction:5` in _breeding-requirements.ts)
 *     asks for five pet interactions with a matching-element companion, and a
 *     player who owns exactly one such pet must still be able to clear it in a
 *     day — rationing petting harder would silently slow breeding down, which is
 *     not what this mechanic is for.
 */
export const PET_HAPPINESS_DAILY_PET_BUDGET = 50;

// ── Tier thresholds (inclusive lower bounds) ────────────────────────────────
export const PET_HAPPINESS_CONTENT = 80;
/** Mirrors COMPANION_OBEDIENT_HAPPINESS — at or above this a companion always obeys. */
export const PET_HAPPINESS_OBEDIENT = 71;
export const PET_HAPPINESS_RESTLESS = 50;
export const PET_HAPPINESS_UNHAPPY = 25;

const MS_PER_DAY = 86_400_000;

export type PetHappinessTier = 'content' | 'steady' | 'restless' | 'unhappy' | 'neglected';

/** The happiness-carrying subset of a pet. Structural so both the client `Pet`
 *  type and the server's raw `Record<string, unknown>` saves satisfy it. */
export type PetHappinessState = {
    happiness?: number;
    happinessDay?: number;
    happinessPets?: number;
};

function whole(value: unknown, fallback = 0): number {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? parsed : fallback;
}

/** Clamp any stored value into [0, 100]. */
export function clampHappiness(value: unknown): number {
    return Math.max(0, Math.min(PET_HAPPINESS_MAX, whole(value)));
}

/** UTC day index — days since the epoch. Rolls over at UTC midnight, the same
 *  instant `lastDailyReset` (`toISOString().slice(0, 10)`) does. */
export function utcDayIndex(now: number): number {
    return Math.floor(Math.max(0, now) / MS_PER_DAY);
}

export function petHappinessTier(happiness: number): PetHappinessTier {
    const value = clampHappiness(happiness);
    if (value >= PET_HAPPINESS_CONTENT) return 'content';
    if (value >= PET_HAPPINESS_OBEDIENT) return 'steady';
    if (value >= PET_HAPPINESS_RESTLESS) return 'restless';
    if (value >= PET_HAPPINESS_UNHAPPY) return 'unhappy';
    return 'neglected';
}

export const PET_HAPPINESS_TIER_LABEL: Readonly<Record<PetHappinessTier, string>> = {
    content: 'Content',
    steady: 'Steady',
    restless: 'Restless',
    unhappy: 'Unhappy',
    neglected: 'Neglected',
};

/**
 * Damage multiplier on the companion's sealed strike. 1 above the restless line,
 * so this is purely a malus for a neglected pet — no existing fight gets weaker
 * unless the pet was already being ignored.
 */
export function petHappinessCombatMult(happiness: number): number {
    switch (petHappinessTier(happiness)) {
        case 'unhappy': return 0.9;
        case 'neglected': return 0.8;
        default: return 1;
    }
}

/**
 * Chance [0, 1] that a summoned companion ignores its owner's command this
 * round. 35% below the 71 cliff is the pre-existing rule; the two lower bands
 * are new. A Loyal pet (or loyalty gear) bypasses the roll entirely — that check
 * lives in `companionObeys`.
 */
export function petHappinessDisobeyChance(happiness: number): number {
    switch (petHappinessTier(happiness)) {
        case 'content':
        case 'steady': return 0;
        case 'restless': return 0.35;
        case 'unhappy': return 0.5;
        case 'neglected': return 0.65;
    }
}

/**
 * Training-XP multiplier. The 1.15 / 1.05 / 1 ladder is the pre-existing rule
 * (`petHappiness >= 80 ? 1.15 : >= 50 ? 1.05 : 1`) restated over the tiers; only
 * the 0.85 on a neglected pet is new.
 */
export function petHappinessTrainingMult(happiness: number): number {
    switch (petHappinessTier(happiness)) {
        case 'content': return 1.15;
        case 'steady':
        case 'restless': return 1.05;
        case 'unhappy': return 1;
        case 'neglected': return 0.85;
    }
}

/**
 * One-line "what is this costing me?" for the Pet Yard. Empty above 50.
 * Deliberately does NOT restate the tier name — the UI already shows it.
 */
export function petHappinessPenaltyNote(happiness: number): string {
    const tier = petHappinessTier(happiness);
    if (tier === 'unhappy') return 'It ignores half your commands in battle and strikes for 10% less.';
    if (tier === 'neglected') return 'It ignores most commands in battle, strikes for 20% less, and trains 15% slower.';
    return '';
}

/** Happiness a freshly acquired companion is created with. */
export function petStartingHappiness(): number {
    return PET_HAPPINESS_NEW_PET;
}

// ── Decay settle ────────────────────────────────────────────────────────────

export type PetHappinessSettlement = {
    happiness: number;
    happinessDay: number;
    happinessPets: number;
    /** Points removed by this settle (0 when nothing was owed). */
    decayed: number;
    /** True when any of the three stored values differs from what came in. */
    changed: boolean;
};

/**
 * Bring a pet's happiness up to date at `now`.
 *
 * - Never settled (no `happinessDay`): stamp today, decay NOTHING. Every pet
 *   written before this shipped takes this path exactly once.
 * - Same UTC day: nothing owed; the spent-budget counter is preserved.
 * - N days elapsed: lose N * PET_HAPPINESS_DAILY_DECAY, floored at 0, and the
 *   free-interaction budget refills.
 * - Stamp in the FUTURE (a server clock stepped backwards): treat as today and
 *   pull the stamp back, so a skewed write cannot freeze decay indefinitely.
 */
export function settlePetHappinessState(state: PetHappinessState, now: number): PetHappinessSettlement {
    const today = utcDayIndex(now);
    const happiness = clampHappiness(state.happiness);
    const storedDay = state.happinessDay === undefined ? undefined : whole(state.happinessDay, today);
    const storedPets = Math.max(0, whole(state.happinessPets));

    if (storedDay === undefined || storedDay >= today) {
        const pets = Math.min(storedPets, PET_HAPPINESS_DAILY_PET_BUDGET);
        return {
            happiness,
            happinessDay: today,
            happinessPets: pets,
            decayed: 0,
            changed: storedDay !== today || pets !== state.happinessPets || happiness !== state.happiness,
        };
    }

    const missedDays = today - storedDay;
    const settled = Math.max(0, happiness - missedDays * PET_HAPPINESS_DAILY_DECAY);
    return {
        happiness: settled,
        happinessDay: today,
        happinessPets: 0,
        decayed: happiness - settled,
        changed: true,
    };
}

/** Points of free petting still available today, after settling to `now`. */
export function petHappinessBudgetRemaining(state: PetHappinessState, now: number): number {
    const settled = settlePetHappinessState(state, now);
    return Math.max(0, PET_HAPPINESS_DAILY_PET_BUDGET - settled.happinessPets);
}

/**
 * Apply one free "Pet" interaction. Returns null when today's budget is spent —
 * the caller turns that into a 409 rather than silently no-op'ing, so the player
 * is told why the button did nothing.
 *
 * A pet already at 100 still consumes budget: the gain is what is budgeted, not
 * the net change, and refunding the overflow would let a player bank free pets
 * by topping off a maxed companion.
 */
export function applyFreePetInteraction(state: PetHappinessState, now: number): PetHappinessSettlement | null {
    const settled = settlePetHappinessState(state, now);
    if (settled.happinessPets >= PET_HAPPINESS_DAILY_PET_BUDGET) return null;
    return {
        ...settled,
        happiness: Math.min(PET_HAPPINESS_MAX, settled.happiness + PET_HAPPINESS_PET_GAIN),
        happinessPets: settled.happinessPets + PET_HAPPINESS_PET_GAIN,
        changed: true,
    };
}

/**
 * Apply an UNBUDGETED gain (a treat, a completed bond training). These already
 * cost the player an item or a training slot, so they are not rationed — but
 * they still settle the pending decay first, so a treat can never be used to
 * skip a missed day.
 */
export function applyPetHappinessGain(state: PetHappinessState, amount: number, now: number): PetHappinessSettlement {
    const settled = settlePetHappinessState(state, now);
    return {
        ...settled,
        happiness: Math.min(PET_HAPPINESS_MAX, settled.happiness + Math.max(0, whole(amount))),
        changed: true,
    };
}
