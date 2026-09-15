/* Existing client entry point; shared core also serves authoritative outcome receipts. */
import { groupBattleLogActions } from "./battle-log-format";
import type { BattleHistoryAction } from "../types/character";
import { capBattleActions, normalizeBattleHistoryRole } from "../../../shared/battle-history";
export { MAX_BATTLES, capBattleActions, buildActionsFromTowerLog, makeBattleEntry, appendBattleHistory } from "../../../shared/battle-history";

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
            role: normalizeBattleHistoryRole(e.actorRole),
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
