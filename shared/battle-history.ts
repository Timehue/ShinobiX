// Shared existing battle-history formatting and caps; no combat rules live here.
import type { BattleHistoryAction, BattleHistoryActorRole, BattleHistoryEntry } from "./battle-history-types.js";

export const MAX_BATTLES = 10;
const MAX_ACTIONS_PER_BATTLE = 80;
const MAX_EFFECT_LINES = 12;
const MAX_STR = 240;

function clampStr(s: string): string {
    const t = (s ?? "").toString();
    return t.length > MAX_STR ? t.slice(0, MAX_STR) : t;
}

export function normalizeBattleHistoryRole(role: unknown): BattleHistoryActorRole {
    return role === "player" || role === "enemy" ? role : "system";
}

/** Trim a single action to the stored caps. */
function capAction(a: BattleHistoryAction): BattleHistoryAction {
    return {
        round: Math.max(1, Math.floor(a.round || 1)),
        role: normalizeBattleHistoryRole(a.role),
        actor: clampStr(a.actor ?? ""),
        ...(typeof a.actionNumber === "number" ? { actionNumber: a.actionNumber } : {}),
        headline: clampStr(a.headline ?? ""),
        effectLines: (a.effectLines ?? []).slice(0, MAX_EFFECT_LINES).map(clampStr),
    };
}

/**
 * Cap a battle's action list. When a fight overflows, keep the MOST RECENT
 * actions (the end of the fight is what a player reflects on) but preserve
 * chronological order.
 */
export function capBattleActions(actions: BattleHistoryAction[]): BattleHistoryAction[] {
    const tail = actions.length > MAX_ACTIONS_PER_BATTLE ? actions.slice(-MAX_ACTIONS_PER_BATTLE) : actions;
    return tail.map(capAction);
}

// True when `text` begins with `name` followed by a word boundary — so "Rai"
// doesn't match "Raijin" but "Bandit" matches "Bandit's" / "Bandit strikes".
function startsWithFighterName(text: string, name: string): boolean {
    if (!name || !text.startsWith(name)) return false;
    const next = text.charAt(name.length);
    return next === "" || !/[A-Za-z0-9]/.test(next);
}

/**
 * Convert a Battle Towers squad log (a flat `string[]` naming MANY fighters —
 * squad members, allied npcs, and enemies) into owner-attributed actions.
 * Unlike the 1v1 grouper, side is decided by matching each line's leading
 * fighter name against the ally / enemy name lists; lines that name no known
 * fighter (objective/floor narration) become ownerless system lines. The tower
 * log has no round markers, so everything is tagged round 1.
 */
export function buildActionsFromTowerLog(
    log: ReadonlyArray<string>,
    allyNames: ReadonlyArray<string>,
    enemyNames: ReadonlyArray<string>,
): BattleHistoryAction[] {
    // Longest names first so a short name that prefixes a longer one can't win.
    const allies = [...new Set(allyNames.filter(Boolean))].sort((a, b) => b.length - a.length);
    const enemies = [...new Set(enemyNames.filter(Boolean))].sort((a, b) => b.length - a.length);
    const actions: BattleHistoryAction[] = [];
    for (const raw of log) {
        const text = (raw ?? "").trim();
        if (!text) continue;
        const ally = allies.find((n) => startsWithFighterName(text, n));
        const enemy = ally ? undefined : enemies.find((n) => startsWithFighterName(text, n));
        const name = ally ?? enemy ?? "";
        if (name) {
            actions.push({
                round: 1,
                role: ally ? "player" : "enemy",
                actor: name,
                headline: text.slice(name.length).replace(/^[\s:—-]+/, ""),
                effectLines: [],
            });
        } else {
            actions.push({ round: 1, role: "system", actor: "", headline: text, effectLines: [] });
        }
    }
    return capBattleActions(actions);
}

/** Assemble a capped battle entry ready to append. */
export function makeBattleEntry(input: {
    id: string;
    ts: number;
    mode: string;
    opponent: string;
    outcome: BattleHistoryEntry["outcome"];
    rounds: number;
    self: string;
    actions: BattleHistoryAction[];
}): BattleHistoryEntry {
    return {
        id: input.id,
        ts: input.ts,
        mode: clampStr(input.mode),
        opponent: clampStr(input.opponent),
        outcome: input.outcome,
        rounds: Math.max(1, Math.floor(input.rounds || 1)),
        self: clampStr(input.self),
        actions: capBattleActions(input.actions),
    };
}

/**
 * Prepend a battle to the rolling history (newest-first), de-duplicating by id
 * (so a refresh on the result screen re-recording the same battle is a no-op)
 * and capping to MAX_BATTLES.
 */
export function appendBattleHistory(
    existing: ReadonlyArray<BattleHistoryEntry> | undefined,
    entry: BattleHistoryEntry,
): BattleHistoryEntry[] {
    const prior = (existing ?? []).filter((b) => b && b.id !== entry.id);
    return [entry, ...prior].slice(0, MAX_BATTLES);
}
