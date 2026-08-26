import { groupBattleLogActions, type BattleLogAction } from "./battle-log-format";

const ROUND_LOG_LINE = /^--- Round (\d+) ---$/i;
const HIDDEN_AUTOMATION_LINE = /has no legal actions remaining and ends the turn automatically\.?$/i;

export type PlainCombatLogRound = {
    round: number;
    lineCount: number;
    actions: Array<BattleLogAction & { renderKey: string }>;
};

/** Convert the server's flat, marker-delimited log into readable action groups. */
export function groupPlainCombatLog(
    lines: readonly string[],
    selfName: string,
    oppName: string,
): PlainCombatLogRound[] {
    let firstRoundNumber = 0;
    for (const line of lines) {
        const marker = line.trim().match(ROUND_LOG_LINE);
        if (!marker) continue;
        firstRoundNumber = Number(marker[1]) || 0;
        break;
    }
    let round = firstRoundNumber > 0 ? Math.max(1, firstRoundNumber - 1) : 1;
    let actionNumber = 0;
    let buffer: string[] = [];
    const rounds: PlainCombatLogRound[] = [];

    const flush = () => {
        if (buffer.length === 0) return;
        const grouped = groupBattleLogActions(buffer, selfName, oppName, actionNumber);
        actionNumber = grouped.nextActionNumber;
        rounds.push({
            round,
            lineCount: buffer.length,
            actions: grouped.actions.map((action, index) => ({
                ...action,
                renderKey: `${round}-${action.actionNumber ?? `system-${index}`}`,
            })),
        });
        buffer = [];
    };

    for (const rawLine of lines) {
        const line = (rawLine ?? "").trim();
        if (!line || HIDDEN_AUTOMATION_LINE.test(line)) continue;
        const marker = line.match(ROUND_LOG_LINE);
        if (marker) {
            flush();
            round = Math.max(1, Number(marker[1]) || round);
            continue;
        }
        buffer.push(line);
    }
    flush();
    return rounds;
}
