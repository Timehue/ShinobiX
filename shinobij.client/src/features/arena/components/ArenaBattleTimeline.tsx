import type { RefObject } from "react";
import { BattleActionBlock } from "../../../components/BattleActionBlock";
import { CombatBattleLogPanel } from "../../../components/CombatHudLayout";
import type { ArenaBattleActionEntry, ArenaBattleActor } from "../types";

type ArenaBattleTimelineProps = {
    combatLogRef: RefObject<HTMLDivElement | null>;
    activeActor: ArenaBattleActor;
    playerName: string;
    opponentName: string;
    battleHistory: ArenaBattleActionEntry[];
    logRoundOverrides: Record<number, boolean>;
    onToggleRound: (round: number, currentlyOpen: boolean) => void;
    formatEntryTime: (createdAt?: number) => string;
    battleStarted: boolean;
    battleEnded: boolean;
};

export function ArenaBattleTimeline({
    combatLogRef,
    activeActor,
    playerName,
    opponentName,
    battleHistory,
    logRoundOverrides,
    onToggleRound,
    formatEntryTime,
    battleStarted,
    battleEnded,
}: ArenaBattleTimelineProps) {
    const timelineRounds = battleHistory.reduce<{ round: number; entries: ArenaBattleActionEntry[] }[]>((groups, entry) => {
        const group = groups.find((candidate) => candidate.round === entry.round);
        if (group) group.entries.push(entry);
        else groups.push({ round: entry.round, entries: [entry] });
        return groups;
    }, []);

    return (
        <>
            <CombatBattleLogPanel
                className="combat-timeline"
                ref={combatLogRef}
                turnLabel={activeActor === "player" ? `${playerName}'s turn` : `${opponentName}'s turn`}
            >
                {battleHistory.length === 0 ? (
                    <p>No entries yet.</p>
                ) : (
                    timelineRounds.map((roundGroup) => {
                        const maxLogRound = timelineRounds[timelineRounds.length - 1]?.round ?? 0;
                        const roundOpen = logRoundOverrides[roundGroup.round] ?? (roundGroup.round >= maxLogRound - 1);
                        return (
                            <section className={`timeline-round${roundOpen ? " open" : " collapsed"}`} key={roundGroup.round}>
                                <button type="button" className="timeline-round-header timeline-round-toggle" aria-expanded={roundOpen}
                                    onClick={() => onToggleRound(roundGroup.round, roundOpen)}>
                                    <span className="timeline-round-chevron" aria-hidden="true">▾</span>
                                    <span>Round {roundGroup.round}</span>
                                    <small>{formatEntryTime(roundGroup.entries[0]?.createdAt)}</small>
                                    <span className="timeline-round-count">{roundGroup.entries.length}</span>
                                </button>
                                {roundOpen && roundGroup.entries.map((entry) => {
                                    const [headLine, ...effectLines] = entry.description.split("\n");
                                    const role = entry.actorRole === "player" ? "player" : entry.actorRole === "enemy" ? "enemy" : "system";
                                    return (
                                        <BattleActionBlock
                                            key={`${entry.round}-${entry.actionId}-${entry.actionNumber}`}
                                            action={{ role, actor: entry.actor, actionNumber: entry.actionNumber, headline: headLine ?? "", effectLines }}
                                            selfName={playerName}
                                            oppName={opponentName}
                                        />
                                    );
                                })}
                            </section>
                        );
                    })
                )}
            </CombatBattleLogPanel>
            {battleStarted && !battleEnded && (
                <div className={`combat-turn-banner${activeActor === "player" ? " ctb-player" : " ctb-enemy"}`} aria-hidden="true">
                    <span className="ctb-name">{activeActor === "player" ? playerName : opponentName}</span>
                    <span className="ctb-suffix">'s Turn</span>
                </div>
            )}
        </>
    );
}
