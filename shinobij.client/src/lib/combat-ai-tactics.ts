/*
 * PvE combat-AI tactics — perception layer.
 *
 * buildPlayerRead() condenses the player's current combat STATE plus a short
 * rolling MEMORY of their recent actions into a single struct the enemy AI reads
 * each turn to "act accordingly". This is the data the band-competence gates in
 * pve-difficulty.ts (pveAiCompetence) turn into behaviour (Clear the player's
 * buffs, Cleanse self, punish a turtle, etc.).
 *
 * Pure + side-effect free so it is unit-testable in isolation. It deliberately
 * does NOT import Arena's local CombatStatus type (that type is declared inside
 * the Arena component); it accepts a structurally-compatible minimal shape, so
 * Arena can pass its CombatStatus[] straight in.
 */

export type PlayerActionKind =
    | "attack"   // basic attack or a damage jutsu
    | "heal"     // basic heal / heal jutsu
    | "shield"   // shield / defensive buff
    | "buff"     // offensive / utility self-buff
    | "debuff"   // applied a debuff to the enemy
    | "cleanse"  // removed own debuffs
    | "clear"    // removed enemy buffs
    | "move"     // move / dash / flicker
    | "item"     // consumable
    | "weapon"   // weapon strike
    | "wait";    // passed

export interface PlayerActionRecord {
    kind: PlayerActionKind;
    /** Battle turn the action was taken on (for windowing / recency). */
    turn: number;
}

/** Minimal status shape buildPlayerRead needs; Arena's CombatStatus is assignable. */
export interface ReadStatus {
    name: string;
    kind: "positive" | "negative";
    activeRound?: number;
    rounds?: number;
    percent?: number;
    amount?: number;
}

export interface PlayerReadInput {
    /** Current battle turn — used to window recent actions. */
    turn: number;
    hp: number;
    maxHp: number;
    ap: number;
    shield: number;
    /** ACTIVE player statuses (caller should pass activeStatuses(playerStatuses)). */
    statuses: ReadStatus[];
    /** Most-recent-LAST list of the player's actions this fight (caller caps it). */
    recentActions: PlayerActionRecord[];
}

export interface PlayerRead {
    hpFraction: number;
    /** HP at/under 35% — a finisher window. */
    lowHp: boolean;
    ap: number;
    /** AP under 50 — the player is throttled and can't fully answer. */
    lowAp: boolean;
    shielded: boolean;
    /** Count of ALL active positive statuses. */
    buffCount: number;
    /** Count of buffs worth spending a Clear on (amp/defensive/prevent), excludes trivia. */
    meaningfulBuffCount: number;
    /** Active offensive amp stacks on the player (IDG / Increase Heal / Overclock). */
    offensiveBuffs: number;
    /** Player has a defensive buff up (DDT / Absorb / Reflect / Shield status). */
    hasDefensiveBuff: boolean;
    /** Count of damage-over-time debuffs already on the player. */
    dotCount: number;
    stunned: boolean;
    sealed: boolean;
    lastAction?: PlayerActionKind;
    /** The player's previous action was defensive/setup (shield/buff/heal) — a wind-up. */
    justPoweredUp: boolean;
    /** 0..1 — fraction of windowed actions that were attacks (aggression read). */
    aggression: number;
    /** Player leans on sustain/defence (turtle) over the recent window. */
    favorsSustain: boolean;
}

// Buffs the AI considers worth a 60-AP Clear. Trivial / cosmetic positives are
// excluded so a single throwaway buff doesn't bait the AI into wasting a turn.
const MEANINGFUL_BUFFS = new Set<string>([
    "Increase Damage Given",
    "Decrease Damage Taken",
    "Absorb",
    "Reflect",
    "Lifesteal",
    "Increase Heal",
    "Overclock",
    "Debuff Prevent",
    "Stun Prevent",
    "Clear Prevent",
]);

const OFFENSIVE_BUFFS = new Set<string>(["Increase Damage Given", "Increase Heal", "Overclock"]);
const DEFENSIVE_BUFFS = new Set<string>(["Decrease Damage Taken", "Absorb", "Reflect", "Shield"]);
const DOT_NAMES = new Set<string>(["Wound", "Poison", "Drain"]);
const SUSTAIN_ACTIONS = new Set<PlayerActionKind>(["heal", "shield", "cleanse"]);
const SETUP_ACTIONS = new Set<PlayerActionKind>(["heal", "shield", "buff"]);

// How many of the most recent actions feed the aggression / sustain read.
const RECENT_WINDOW = 4;

export function buildPlayerRead(input: PlayerReadInput): PlayerRead {
    const maxHp = Math.max(1, input.maxHp);
    const hpFraction = Math.max(0, Math.min(1, input.hp / maxHp));
    const positives = input.statuses.filter((s) => s.kind === "positive");

    const meaningfulBuffCount = positives.filter((s) => MEANINGFUL_BUFFS.has(s.name)).length;
    const offensiveBuffs = positives.filter((s) => OFFENSIVE_BUFFS.has(s.name)).length;
    const hasDefensiveBuff = positives.some((s) => DEFENSIVE_BUFFS.has(s.name));
    const dotCount = input.statuses.filter((s) => s.kind === "negative" && DOT_NAMES.has(s.name)).length;
    const stunned = input.statuses.some((s) => s.name === "Stun");
    const sealed = input.statuses.some((s) => s.name === "Bloodline Seal" || s.name === "Seal" || s.name === "Elemental Seal");

    const window = input.recentActions.slice(-RECENT_WINDOW);
    const lastAction = window.length ? window[window.length - 1].kind : undefined;
    const justPoweredUp = lastAction != null && SETUP_ACTIONS.has(lastAction);
    const attacks = window.filter((r) => r.kind === "attack" || r.kind === "weapon").length;
    const sustains = window.filter((r) => SUSTAIN_ACTIONS.has(r.kind)).length;
    const aggression = window.length ? attacks / window.length : 0;
    // Turtle read: at least two sustain actions in the window and sustain >= attacks.
    const favorsSustain = sustains >= 2 && sustains >= attacks;

    return {
        hpFraction,
        lowHp: hpFraction <= 0.35,
        ap: input.ap,
        lowAp: input.ap < 50,
        shielded: input.shield > 0,
        buffCount: positives.length,
        meaningfulBuffCount,
        offensiveBuffs,
        hasDefensiveBuff,
        dotCount,
        stunned,
        sealed,
        lastAction,
        justPoweredUp,
        aggression,
        favorsSustain,
    };
}

// Map a spendAp actionId (jutsu id, "move"/"dash"/"clear"/"cleanse"/weapon id, …)
// to a coarse PlayerActionKind for the recent-action memory. The enemy only needs
// the broad shape of what the player did, not the exact id.
export function classifyPlayerAction(actionId: string, opts?: { isSelfSupport?: boolean; isWeapon?: boolean; isItem?: boolean; dealtDamage?: boolean }): PlayerActionKind {
    const id = actionId.toLowerCase();
    if (id === "clear") return "clear";
    if (id === "cleanse") return "cleanse";
    if (id === "basicheal" || id === "heal") return "heal";
    if (id === "move" || id === "dash" || id.includes("flicker")) return "move";
    if (id === "wait" || id === "flee") return "wait";
    if (opts?.isWeapon) return "weapon";
    if (opts?.isItem) return "item";
    if (opts?.isSelfSupport) return "shield";
    if (opts?.dealtDamage === false) return "buff";
    return "attack";
}
