/*
 * First-fight coaching — the in-battle guidance for a brand-new shinobi's
 * first authored fights (docs/first-five-fights-onboarding.md):
 *
 *   academySpar  — the Academy training dummy: how a turn works, and that a
 *                  40 AP action and a 60 AP action are different commitments.
 *   eRankDrill   — the sparring partner who holds at four tiles: range,
 *                  positioning, and why a cheap 40 is not a weak 60.
 *   storyFirst   — the chapter-1 guardian: read a braced enemy, set up, commit.
 *   dRankErrand  — the Mist Sentinel's net: a status worth answering.
 *
 * Pure: turn state in, at most one line out. The arena screen renders `band`
 * lines in the existing combat feedback slot (short, control-level, persistent
 * while the condition holds) and `bubble` lines once each through the ally
 * bark bubble, in the companion's voice. Guidance thins across the four fights
 * and nothing here gates an action: the player can always ignore the advice.
 * The wild (explore ambushes, hunts, wanderers) is the exam and gets no coach.
 *
 * COPY BUDGETS (battle-skin.css): on a phone the feedback band is a single
 * 10px line, 18px tall, `white-space: nowrap` with an ellipsis, so a band line
 * must stay under ~55 characters or its ending is cut off. The bubble clamps at
 * three lines of 12px across ~360px, so keep bubbles under ~120 characters.
 * first-fight-coach.test.ts pins both budgets.
 */
import type { Character } from "../types/character";
import { activeCarriedPets } from "./entitlements";
import { rankFromLevel } from "./stats";

export const BAND_LINE_MAX_CHARS = 55;
export const BUBBLE_LINE_MAX_CHARS = 120;

export type FirstFightLesson = "academySpar" | "eRankDrill" | "storyFirst" | "dRankErrand";

export type FirstFightCoachHistory = {
    /** Authoritative successes only (never intent): see MissionArenaFight.send. */
    attacked: boolean;
    casted: boolean;
    castedSixty: boolean;
    /** A heavy cast landed while the player carried Poison. */
    castedSixtyWhilePoisoned: boolean;
    /** A heavy cast went into an enemy shield that covered most of it. */
    castedSixtyIntoShield: boolean;
    cleansed: boolean;
    /** The enemy has shown a shield at some point this fight. */
    enemyShieldSeen: boolean;
};

export type FirstFightCoachState = {
    lesson: FirstFightLesson;
    round: number;
    myTurn: boolean;
    myAp: number;
    outOfActions: boolean;
    /** Hex distance between the player and the enemy (-1 when unknown). */
    distance: number;
    enemyInMelee: boolean;
    enemyHp: number;
    enemyMaxHp: number;
    enemyShield: number;
    /** Names of the player's ACTIVE negative statuses this round. */
    myDebuffs: readonly string[];
    canAttack: boolean;
    canMove: boolean;
    canCastJutsu: boolean;
    hasFlicker: boolean;
    /** A ranged weapon swing is on the bar (the starter Rustfang Kunai). */
    hasKunai: boolean;
    /** The player's equipped 40 AP utility technique, if any; `ready` when it
     *  is off cooldown and affordable right now. */
    fortyJutsu?: { name: string; selfOnly: boolean; ready: boolean };
    cleanseReady: boolean;
    history: FirstFightCoachHistory;
};

export type FirstFightCoachLine = {
    /** Stable id; bubble lines fire once per id per fight. */
    id: string;
    text: string;
    surface: "band" | "bubble";
};

export const EMPTY_FIRST_FIGHT_HISTORY: FirstFightCoachHistory = {
    attacked: false,
    casted: false,
    castedSixty: false,
    castedSixtyWhilePoisoned: false,
    castedSixtyIntoShield: false,
    cleansed: false,
    enemyShieldSeen: false,
};

const band = (id: string, text: string): FirstFightCoachLine => ({ id, text, surface: "band" });
const bubble = (id: string, text: string): FirstFightCoachLine => ({ id, text, surface: "bubble" });

function has(list: readonly string[], name: string): boolean {
    return list.some((entry) => entry === name);
}

/**
 * The one line to show right now, or null. `seen` holds the bubble ids already
 * shown this fight so a once-only line yields to the next candidate.
 */
export function firstFightCoachLine(state: FirstFightCoachState, seen: ReadonlySet<string> = new Set()): FirstFightCoachLine | null {
    if (state.enemyHp <= 0) return null;
    const unseen = (line: FirstFightCoachLine | null): FirstFightCoachLine | null =>
        line && line.surface === "bubble" && seen.has(line.id) ? null : line;
    switch (state.lesson) {
        case "academySpar": return sparLine(state);
        case "eRankDrill": return unseen(drillBubble(state, seen)) ?? drillBand(state);
        case "storyFirst": return unseen(storyBubble(state, seen));
        case "dRankErrand": return unseen(errandBubble(state, seen));
        default: return null;
    }
}

// ── Fight 1: the Academy dummy (band, moderate guidance) ────────────────────
// Control-level hints in the feedback band, like the original spar coach, plus
// the AP lesson: Attack costs 40, a jutsu 60, and the bar shows what is left.
function sparLine(state: FirstFightCoachState): FirstFightCoachLine {
    const { history, enemyHp, enemyMaxHp } = state;
    if (!state.myTurn) return band("spar-wait-turn", "Dummy's turn. Your AP refills next turn.");
    if (state.outOfActions || (!state.canAttack && !state.canMove && !state.canCastJutsu)) {
        return band("spar-end-turn", "Tap Wait to end your turn and recover AP.");
    }
    if (!history.attacked && !state.enemyInMelee && state.canMove) {
        return band("spar-move", "Move → tap a lit tile toward the dummy.");
    }
    if (!history.attacked && state.canAttack) {
        return band("spar-attack", "Tap Attack. It costs 40 of your 100 AP.");
    }
    if (history.attacked && !history.casted && state.canCastJutsu) {
        return band("spar-jutsu", "Attack cost 40. A jutsu costs 60. Pick one.");
    }
    if (history.attacked && !history.casted && state.myAp > 0 && state.myAp < 60) {
        return band("spar-low-ap", `${state.myAp} AP left. Tap Wait; AP refills next turn.`);
    }
    if (!state.enemyInMelee && state.canMove) return band("spar-move", "Move → tap a lit tile toward the dummy.");
    if (state.canAttack && enemyMaxHp > 0 && enemyHp <= enemyMaxHp * 0.25) {
        return band("spar-finish", state.canCastJutsu ? "Finish the dummy with Attack or a jutsu." : "Finish the dummy with Attack.");
    }
    return band("spar-default", state.canAttack ? "Tap Attack. Wait ends your turn." : "Tap Wait to end your turn and recover AP.");
}

// ── Fight 2: the sparring partner at range (band + one bubble, lighter) ─────
function drillBand(state: FirstFightCoachState): FirstFightCoachLine | null {
    if (!state.myTurn) return null;
    const { history } = state;
    if (state.round === 1 && !history.attacked && !history.casted && state.distance > 4) {
        return band("drill-range", state.hasFlicker
            ? "It hangs back. Flicker in for 20, or let it come."
            : "It hangs back. Step in, or let it come to you.");
    }
    if (state.distance > 4 && !state.enemyInMelee) return band("drill-out-of-reach", "Out of reach. Step in, or let it close.");
    if (state.distance >= 0 && state.distance <= 4 && !history.casted) {
        return band("drill-in-range", state.hasKunai
            ? "In range. Jutsu 60, kunai 40. Watch the AP bar."
            : "In range. A jutsu is 60 AP. Watch the bar.");
    }
    // The payoff of the whole 40/60 design, made tangible: a heavy cast leaves
    // exactly 40 AP, and the cheap technique is lit. Say it once per turn.
    if (history.castedSixty && state.myAp >= 40 && state.myAp < 60 && state.fortyJutsu?.ready) {
        return band("drill-forty-fits", `${state.fortyJutsu.name} fits your ${state.myAp} AP. Or Wait.`);
    }
    return null;
}

function drillBubble(state: FirstFightCoachState, seen: ReadonlySet<string>): FirstFightCoachLine | null {
    if (seen.has("drill-hexed") || !has(state.myDebuffs, "Decrease Damage Given")) return null;
    const forty = state.fortyJutsu;
    if (!forty || (forty.selfOnly && !forty.ready)) {
        return bubble("drill-hexed", "It hexed your strikes; that fades in two turns. Cheap moves change a fight, heavy ones finish it.");
    }
    if (!forty.ready) {
        // The player already spent the cheap technique on it, so it sits on
        // cooldown: never point at a card that cannot be pressed. Name the
        // mirror instead, which is the lesson anyway.
        return bubble("drill-hexed", `It hexed your strikes, the way your ${forty.name} hexed it. Forty each way; it fades in two turns.`);
    }
    return bubble("drill-hexed", forty.selfOnly
        ? `It hexed your strikes. Your ${forty.name} costs forty and steadies you. Cheap moves change a fight, heavy ones finish it.`
        : `It hexed your strikes. Your ${forty.name} does the same to it for forty, and still leaves you sixty.`);
}

// ── Fight 3: the braced guardian (bubble only, light) ───────────────────────
function storyBubble(state: FirstFightCoachState, seen: ReadonlySet<string>): FirstFightCoachLine | null {
    const { history } = state;
    if (!seen.has("story-braced") && state.enemyShield > 0) {
        return bubble("story-braced", "It's braced. That shield absorbs a heavy technique completely. Break it with something cheap first, then commit.");
    }
    if (!seen.has("story-wasted") && history.castedSixtyIntoShield && state.enemyShield > 0) {
        return bubble("story-wasted", "Most of that went into the shield. Break the guard with cheap hits; save the big one for underneath.");
    }
    if (!seen.has("story-open") && history.enemyShieldSeen && state.enemyShield <= 0 && state.myTurn) {
        return bubble("story-open", "Guard's down. Now the heavy one.");
    }
    return null;
}

// ── Fight 4: the sentinel's net (bubble only, very light) ───────────────────
function errandBubble(state: FirstFightCoachState, seen: ReadonlySet<string>): FirstFightCoachLine | null {
    const poisoned = has(state.myDebuffs, "Poison");
    if (!seen.has("errand-poisoned") && poisoned) {
        return bubble("errand-poisoned", "That net poisoned you. Every technique you pay for now bites back. Cleanse clears it, or end this fast. Your call.");
    }
    if (!seen.has("errand-bite") && poisoned && state.history.castedSixtyWhilePoisoned && state.myTurn && state.cleanseReady) {
        return bubble("errand-bite", "Felt that? Poison taxes the heavy casts hardest. Cleanse costs sixty AP and nothing else.");
    }
    return null;
}

// ── Who gets coached ────────────────────────────────────────────────────────
// Only Academy-rank characters meeting an opponent for the FIRST time. Repeats
// of the same mission and every veteran save are left alone: the lessons live
// in the encounters themselves, and a second run through the Drill is play.

function academyRank(character: Pick<Character, "level">): boolean {
    return rankFromLevel(Number(character.level) || 1) === "Academy Student";
}

function metBefore(character: Pick<Character, "defeatedAiIds">, aiProfileId: string): boolean {
    return (character.defeatedAiIds ?? []).includes(aiProfileId);
}

/** The lesson a combat mission carries for this character, if it is their first take. */
export function firstFightLessonForMission(
    mission: { key: string; aiProfileId: string },
    character: Pick<Character, "level" | "defeatedAiIds">,
): FirstFightLesson | undefined {
    if (!academyRank(character) || metBefore(character, mission.aiProfileId)) return undefined;
    if (mission.key === "combat-e-drill") return "eRankDrill";
    if (mission.key === "combat-d-errand") return "dRankErrand";
    return undefined;
}

/** The lesson the current story milestone carries: only the first chapter, only for a rookie. */
export function firstFightLessonForStory(
    character: Pick<Character, "level" | "storyProgress">,
): FirstFightLesson | undefined {
    return academyRank(character) && Math.max(0, Math.floor(Number(character.storyProgress) || 0)) === 0
        ? "storyFirst"
        : undefined;
}

/** The companion pet's name — the voice of every Academy coaching line. */
export function companionCoachName(character: Character): string {
    const name = activeCarriedPets<{ id?: string; name?: string }>(character)[0]?.name;
    return typeof name === "string" && name.trim() ? name.trim() : "Companion";
}
