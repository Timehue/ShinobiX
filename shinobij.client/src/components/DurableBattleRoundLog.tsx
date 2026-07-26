/*
 * Round-by-round accordion over a durable battle record.
 *
 * Complements the timeline: the timeline is for scrubbing, this is for reading.
 * The latest two rounds open by default — enough to see how the fight ended
 * without unrolling a 20-round wall of text.
 *
 * Each action renders through the shared BattleActionBlock, so a historical
 * replay is laid out and coloured exactly like the live log.
 */
import { memo, useMemo, useState } from "react";
import { BattleActionBlock } from "./BattleActionBlock";
import type { BattleLogAction } from "../lib/battle-log-format";
import type { DurableActionReceipt } from "../types/battle-log";
import { actionLabel } from "../types/battle-log";

export interface RoundGroup {
    round: number;
    entries: DurableActionReceipt[];
}

/** Group ascending-seq entries into ascending rounds. Exported for testing. */
export function groupEntriesByRound(entries: DurableActionReceipt[]): RoundGroup[] {
    const byRound = new Map<number, DurableActionReceipt[]>();
    for (const e of entries) {
        const r = Number(e.round) || 0;
        const list = byRound.get(r);
        if (list) list.push(e);
        else byRound.set(r, [e]);
    }
    return [...byRound.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([round, list]) => ({ round, entries: [...list].sort((a, b) => a.seq - b.seq) }));
}

/** Rounds open on first render: the most recent two. Exported for testing. */
export function defaultOpenRounds(groups: RoundGroup[]): Set<number> {
    return new Set(groups.slice(-2).map((g) => g.round));
}

/** Adapt a durable receipt to the shared live-log action shape. */
function toLogAction(entry: DurableActionReceipt, myRole: "p1" | "p2" | null): BattleLogAction {
    const mine = myRole ? entry.actorRole === myRole : entry.actorRole === "p1";
    const [head, ...rest] = entry.summaryLines;
    return {
        role: mine ? "player" : "enemy",
        actor: entry.actorName || "",
        actionNumber: entry.seq,
        // Prefer the server's narrative; fall back to the label so an action with
        // no recorded lines still reads as something rather than blank.
        headline: head ?? actionLabel(entry),
        effectLines: rest,
    };
}

export const DurableBattleRoundLog = memo(function DurableBattleRoundLog({
    entries,
    selfName,
    oppName,
    myRole,
    onSelectAction,
    selectedSeq,
}: {
    entries: DurableActionReceipt[];
    selfName: string;
    oppName: string;
    myRole: "p1" | "p2" | null;
    onSelectAction?: (seq: number) => void;
    selectedSeq?: number | null;
}) {
    const groups = useMemo(() => groupEntriesByRound(entries), [entries]);
    // Per-round overrides layered over the default so re-fetching (which grows
    // `groups`) never yanks a round the player deliberately opened or closed.
    const [overrides, setOverrides] = useState<Record<number, boolean>>({});
    const defaultOpen = useMemo(() => defaultOpenRounds(groups), [groups]);

    if (groups.length === 0) {
        return <p className="dbrl-empty">No actions were recorded for this battle.</p>;
    }

    return (
        <div className="durable-round-log combat-timeline">
            {groups.map((group) => {
                const open = overrides[group.round] ?? defaultOpen.has(group.round);
                return (
                    <section className={`timeline-round${open ? " open" : " collapsed"}`} key={group.round}>
                        <button
                            type="button"
                            className="timeline-round-header timeline-round-toggle"
                            aria-expanded={open}
                            onClick={() => setOverrides((prev) => ({ ...prev, [group.round]: !open }))}
                        >
                            <span className="timeline-round-chevron" aria-hidden="true">▾</span>
                            <span>Round {group.round}</span>
                            <span className="timeline-round-count">{group.entries.length}</span>
                        </button>
                        {open && group.entries.map((entry) => (
                            <div
                                key={entry.seq}
                                className={`dbrl-action${selectedSeq === entry.seq ? " dbrl-selected" : ""}`}
                                onClick={onSelectAction ? () => onSelectAction(entry.seq) : undefined}
                            >
                                <BattleActionBlock
                                    action={toLogAction(entry, myRole)}
                                    selfName={selfName}
                                    oppName={oppName}
                                />
                            </div>
                        ))}
                    </section>
                );
            })}
        </div>
    );
});
