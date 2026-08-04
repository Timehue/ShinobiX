import { MissionArenaFight } from "./MissionArenaFight";
import type { Character } from "../types/character";
import type { TowerSession } from "../lib/towers-api";
import { reportPveFightOutcome } from "../lib/pve-outcome-api";
import { towerArenaTransport, towerSessionForArena } from "../lib/tower-arena-adapter";

// Weekly Boss = a SOLO score-attack against an unkillable, server-shared boss,
// rendered on the normal Arena shell (MissionArenaFight) — the same format as
// PvE / missions / story. It replaced BattleTowerFight (the tower rail), so the
// fight no longer looks like a tower floor ("Floor 9200 …"). The fight is a
// server-authoritative TowerSession; every attack logs damage to the week's shared
// leaderboard. `settleOnAnyDone` banks that damage whether the player is knocked out
// or outlasts the round budget — the real reward is the leaderboard, shown back on
// the Weekly Boss arena screen once the player returns, so the in-fight result card
// stays deliberately simple.
//
// Both entry points share this wrapper: the roaming world-map challenge (App) and the
// menu "Fight Boss" button (WeeklyBossArena). Each passes its own settleFn (both POST
// /api/weekly-boss {kind:"logFight"}) and onExit.
export function WeeklyBossFight({
    character,
    sharedImages,
    runId,
    initialSession,
    settleFn,
    onExit,
}: {
    character: Character;
    sharedImages?: Record<string, string>;
    runId: string;
    initialSession: TowerSession;
    settleFn: (runId: string, playerName: string) => Promise<unknown>;
    onExit: () => void;
}) {
    // Being knocked out by the boss costs the same as being knocked out by
    // anything else. This is safe here precisely because the hospital keys off
    // the player being DOWN, not off losing: outlasting the round budget is the
    // GOOD ending of a weekly assault and must not be punished, and a player who
    // walks out simply keeps the HP they walked out with.
    async function reportOutcome(fightRunId: string, playerName: string) {
        return reportPveFightOutcome(fightRunId, playerName);
    }
    return (
        <MissionArenaFight
            character={character}
            sharedImages={sharedImages}
            runId={runId}
            initialSession={towerSessionForArena(initialSession)}
            transport={towerArenaTransport}
            settleFn={settleFn}
            settleOnAnyDone
            outcomeFn={reportOutcome}
            onExit={onExit}
            renderResult={({ won, settleState, settleResult }) => {
                const dealt = (settleResult as { dealt?: number } | null)?.dealt;
                return (
                    <div className="battle-ended-overlay">
                        <div className="card battle-ended-card">
                            <h2>{won ? "You Outlasted the Boss!" : "Assault Logged"}</h2>
                            {settleState === "settled" && typeof dealt === "number" ? (
                                <p>You dealt <strong>{dealt.toLocaleString()}</strong> damage this run — banked to this week&apos;s shared leaderboard. Return to see where you rank.</p>
                            ) : settleState === "failed" ? (
                                <p>Your damage couldn&apos;t be logged to the leaderboard — return and try again.</p>
                            ) : (
                                <p>The Weekly Boss has no HP cap. Banking your damage to this week&apos;s shared leaderboard…</p>
                            )}
                            <button className="start-primary-btn" onClick={onExit}>Return to the Arena</button>
                        </div>
                    </div>
                );
            }}
        />
    );
}
