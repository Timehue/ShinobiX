/*
 * Battle-history store helpers — build a compact, capped `BattleHistoryEntry`
 * from either engine's log and safely append it to the player's rolling last-N
 * list (persisted in the character save; see types/character.ts). Pure +
 * dependency-light so it's testable and cheap.
 *
 * The stored log reuses groupBattleLogActions (lib/battle-log-format) so the
 * reflection view (Profile → Battles) renders identically to the live log.
 */
import { groupBattleLogActions } from "./battle-log-format";
import type { BattleHistoryAction, BattleHistoryActorRole, BattleHistoryEntry } from "../types/character";

// Keep the save lean: bound both the number of battles kept and the size of
// each stored log. A 40-round slugfest is truncated (oldest actions dropped)
// rather than bloating every save write. The server re-clamps MAX_BATTLES.
export const MAX_BATTLES = 10;
const MAX_ACTIONS_PER_BATTLE = 80;
const MAX_EFFECT_LINES = 12;
const MAX_STR = 240;

function clampStr(s: string): string {
    const t = (s ?? "").toString();
    return t.length > MAX_STR ? t.slice(0, MAX_STR) : t;
}

function normalizeRole(role: unknown): BattleHistoryActorRole {
    return role === "player" || role === "enemy" ? role : "system";
}

/** Trim a single action to the stored caps. */
function capAction(a: BattleHistoryAction): BattleHistoryAction {
    return {
        round: Math.max(1, Math.floor(a.round || 1)),
        role: normalizeRole(a.role),
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

/**
 * Convert the PvE arena's structured `battleHistory` entries (newest-first,
 * each a `{ round, actor, actorRole, description, actionNumber }` with a
 * possibly multiline `description`) into stored actions in chronological order.
 */
export function buildActionsFromPveHistory(
    entries: ReadonlyArray<{ round: number; actor: string; actorRole?: string; description?: string; actionNumber?: number }>,
): BattleHistoryAction[] {
    const chronological = [...entries].reverse();
    return capBattleActions(chronological.map((e) => {
        const [head, ...rest] = (e.description ?? "").split("\n");
        return {
            round: e.round,
            role: normalizeRole(e.actorRole),
            actor: e.actor ?? "",
            ...(typeof e.actionNumber === "number" ? { actionNumber: e.actionNumber } : {}),
            headline: (head ?? "").trim(),
            effectLines: rest.map((s) => s.trim()).filter(Boolean),
        };
    }));
}

/**
 * Convert the PvP server log (a flat `string[]` with `--- Round N ---` markers)
 * into stored, round-tagged actions. Returns the derived round count too.
 */
export function buildActionsFromPvpLog(
    log: ReadonlyArray<string>,
    selfName: string,
    oppName: string,
): { actions: BattleHistoryAction[]; rounds: number } {
    const out: BattleHistoryAction[] = [];
    let round = 1;
    let maxRound = 1;
    let act = 0;
    let buffer: string[] = [];

    const flush = () => {
        if (!buffer.length) return;
        const { actions, nextActionNumber } = groupBattleLogActions(buffer, selfName, oppName, act);
        act = nextActionNumber;
        for (const a of actions) out.push({ round, ...a });
        buffer = [];
    };

    for (const line of log) {
        const m = line.match(/^--- Round (\d+) ---$/);
        if (m) {
            flush();
            round = parseInt(m[1]!, 10) || round;
            maxRound = Math.max(maxRound, round);
            continue;
        }
        buffer.push(line);
    }
    flush();
    return { actions: capBattleActions(out), rounds: maxRound };
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
