/*
 * One color-coded battle-log effect line. Classifies the line into a semantic
 * category (heal / damage / dmgmod / …) and emphasizes the numeric tokens so
 * players can read effects and values by color. Shared by the PvE arena and the
 * PvP battle screen so both logs color identically. See lib/battle-log-format.
 */
import { classifyBattleLogLine, tokenizeBattleLogLine } from "../lib/battle-log-format";

export function BattleLogLine({ line, prefix = "· " }: { line: string; prefix?: string }) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const category = classifyBattleLogLine(trimmed);
    const segments = tokenizeBattleLogLine(trimmed);
    return (
        <p className={`timeline-fx battle-log-line battle-log-${category}`}>
            {prefix}
            {segments.map((seg, i) =>
                seg.isNumber
                    ? <span className="bl-num" key={i}>{seg.text}</span>
                    : <span key={i}>{seg.text}</span>,
            )}
        </p>
    );
}
