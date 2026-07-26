/*
 * Detail panel for one selected action in a durable battle record.
 *
 * Shows exactly what the server recorded: the narrative in the order the engine
 * emitted it, AP spent, and the vital deltas for both fighters. Narrative lines
 * go through the shared BattleLogLine so a historical replay is coloured the
 * same as the live log — and, importantly, is rendered as TEXT. Receipt content
 * is never injected as HTML.
 */
import { memo } from "react";
import { BattleLogLine } from "./BattleLogLine";
import { interpolateFlavor } from "../lib/battle-log-format";
import type { ActionVitalsDelta, DurableActionReceipt } from "../types/battle-log";
import { actionCategory, actionLabel } from "../types/battle-log";

const VITALS: Array<{ key: keyof ActionVitalsDelta; label: string }> = [
    { key: "hp", label: "HP" },
    { key: "chakra", label: "Chakra" },
    { key: "stamina", label: "Stamina" },
    { key: "shield", label: "Shield" },
    { key: "pos", label: "Position" },
];

function DeltaRow({ who, delta }: { who: string; delta: ActionVitalsDelta | undefined }) {
    const moved = VITALS.filter(({ key }) => typeof delta?.[key] === "number" && delta[key] !== 0);
    if (!moved.length) return null;
    return (
        <div className="bad-delta-group">
            <h4>{who}</h4>
            <ul className="bad-delta-list">
                {moved.map(({ key, label }) => {
                    const value = delta![key] as number;
                    const positive = value > 0;
                    return (
                        <li key={key} className={`bad-delta bad-delta-${positive ? "up" : "down"}`}>
                            <span className="bad-delta-label">{label}</span>
                            {/* Sign carries the meaning, not just the colour. */}
                            <span className="bad-delta-value">{positive ? "+" : ""}{value}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

export const BattleActionDetails = memo(function BattleActionDetails({
    entry,
    selfName,
    oppName,
    myRole,
}: {
    entry: DurableActionReceipt | null;
    selfName: string;
    oppName: string;
    myRole: "p1" | "p2" | null;
}) {
    if (!entry) {
        return (
            <section className="battle-action-details bad-empty" aria-live="polite">
                <p>Select an action from the timeline to see what it did.</p>
            </section>
        );
    }

    const mine = myRole ? entry.actorRole === myRole : false;
    const actor = entry.actorName || (mine ? selfName : oppName);
    const target = entry.targetName || (mine ? oppName : selfName);
    const label = actionLabel(entry);
    const category = actionCategory(entry);
    const terminal = entry.result === "battle_end";

    return (
        <section className="battle-action-details" aria-live="polite">
            <header className="bad-head">
                <span className={`bl-actor-chip bl-actor-${mine ? "player" : "enemy"}`}>{actor}</span>
                <h3 className="bad-title">{label}</h3>
                <span className="bad-tags">
                    <span className="bad-tag">{category}</span>
                    {entry.display?.element && <span className="bad-tag">{entry.display.element}</span>}
                    {entry.display?.discipline && <span className="bad-tag">{entry.display.discipline}</span>}
                </span>
            </header>

            <dl className="bad-facts">
                <div><dt>Round</dt><dd>{entry.round}</dd></div>
                <div><dt>Action</dt><dd>#{entry.seq}</dd></div>
                <div><dt>Target</dt><dd>{target || "—"}</dd></div>
                {typeof entry.apSpent === "number" && entry.apSpent > 0 && (
                    <div><dt>AP spent</dt><dd>{entry.apSpent}</dd></div>
                )}
            </dl>

            {terminal && (
                <p className="bad-terminal">
                    {entry.winner === "draw" || entry.winner == null
                        ? "This action ended the battle in a draw."
                        : `This action ended the battle — ${entry.winner === myRole ? selfName : oppName} won.`}
                </p>
            )}

            {entry.summaryLines.length > 0 && (
                <div className="bad-narrative combat-timeline">
                    {/* Server order preserved: flavour/cast line first, then effects. */}
                    {entry.summaryLines.map((line, i) => (
                        <BattleLogLine key={i} line={interpolateFlavor(line, selfName, oppName)} />
                    ))}
                </div>
            )}

            <div className="bad-deltas">
                <DeltaRow who={actor} delta={entry.actorDelta} />
                <DeltaRow who={target} delta={entry.targetDelta} />
            </div>
        </section>
    );
});
