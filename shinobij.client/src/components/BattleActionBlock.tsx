/*
 * One owner-attributed action in a battle log: a colored actor chip (blue = you,
 * red = opponent) + the action name, with its resulting effect lines grouped
 * beneath it. This is the shared "who did what" unit used by the PvE arena, the
 * PvP battle screen, and the profile Battle-Logs reflection view, so every log
 * reads the same and the actor is unmistakable. See lib/battle-log-format
 * (groupBattleLogActions) for turning raw server lines into these.
 */
import { memo } from "react";
import { BattleLogLine } from "./BattleLogLine";
import {
    classifyBattleLogLine,
    interpolateFlavor,
    tokenizeBattleLogLine,
    type BattleLogAction,
} from "../lib/battle-log-format";

export const BattleActionBlock = memo(function BattleActionBlock({
    action,
    selfName,
    oppName,
}: {
    action: BattleLogAction;
    selfName: string;
    oppName: string;
}) {
    const { role, actor, actionNumber, headline, effectLines } = action;
    const head = interpolateFlavor(headline, selfName, oppName).trim();
    const headCategory = classifyBattleLogLine(head);
    const headClassName = headCategory === "effect"
        ? "bl-head-text"
        : `bl-head-text battle-log-${headCategory}`;
    // Ownerless narration (round end, "X wins!", "X ends their turn.", movement)
    // has no cast — render it as a slim line colored by side, not a chip'd block.
    if (!actor) {
        return head ? <p className={`timeline-entry-head timeline-${role}`}>{head}</p> : null;
    }
    return (
        <div className={`timeline-entry timeline-${role}`}>
            <p className="timeline-entry-head">
                {typeof actionNumber === "number" && (
                    <span className="bl-act-num" aria-hidden="true">#{actionNumber}</span>
                )}
                <span className={`bl-actor-chip bl-actor-${role}`}>{actor}</span>
                {head && (
                    <span className={headClassName}>
                        {tokenizeBattleLogLine(head).map((segment, index) =>
                            segment.isNumber
                                ? <span className="bl-num" key={index}>{segment.text}</span>
                                : <span key={index}>{segment.text}</span>,
                        )}
                    </span>
                )}
            </p>
            {effectLines.map((line, i) => (
                <BattleLogLine line={interpolateFlavor(line, selfName, oppName)} key={i} />
            ))}
        </div>
    );
});
