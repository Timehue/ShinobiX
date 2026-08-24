import { useMemo } from "react";
import { MissionArenaFight } from "./MissionArenaFight";
import type { Character } from "../types/character";
import type { SoloPveSession } from "../lib/solo-pve-api";
import { soloPveArenaTransport, soloPveSessionForArena } from "../lib/solo-pve-arena-adapter";
import { useLiveCapabilities } from "../lib/live-capabilities-context";
import { capabilityAdmissionAllowed } from "../lib/live-capability-admission";

// Weekly Boss = a SOLO fight against the server-shared WORLD boss (one HP pool;
// the encounter opens at the shared remaining HP, or a fixed floor once Broken),
// rendered on the normal Arena shell (MissionArenaFight) — the same format as
// PvE / missions / story. It replaced BattleTowerFight (the tower rail), so the
// fight no longer looks like a tower floor ("Floor 9200 …"). The fight is a
// server-authoritative SoloPveSession; every attack logs damage to the week's shared
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
    initialSession: SoloPveSession;
    settleFn: (runId: string, playerName: string) => Promise<unknown>;
    onExit: () => void;
}) {
    const { mutationAvailability, viewAvailability } = useLiveCapabilities();
    const guardedTransport = useMemo(() => ({
        ...soloPveArenaTransport,
        fetchState: (sessionId: string, playerName: string) => {
            if (!capabilityAdmissionAllowed(viewAvailability())) {
                return Promise.reject(new Error("Weekly Boss recovery status is temporarily unavailable."));
            }
            return soloPveArenaTransport.fetchState(sessionId, playerName);
        },
        submitAction: (...args: Parameters<typeof soloPveArenaTransport.submitAction>) => {
            if (!capabilityAdmissionAllowed(mutationAvailability())) {
                return Promise.reject(new Error("Weekly Boss combat actions are temporarily paused."));
            }
            return soloPveArenaTransport.submitAction(...args);
        },
    }), [mutationAvailability, viewAvailability]);
    return (
        <MissionArenaFight
            character={character}
            sharedImages={sharedImages}
            runId={runId}
            initialSession={soloPveSessionForArena(initialSession)}
            transport={guardedTransport}
            settleFn={settleFn}
            settleOnAnyDone
            // Weekly settlement atomically owns contribution, usage costs, and
            // physical HP/hospital state. Reusing it here also makes the
            // explicit leave/forfeit path wait for that durable settlement.
            outcomeFn={settleFn}
            onExit={onExit}
            renderResult={({ won, settleState, settleResult }) => {
                const dealt = (settleResult as { dealt?: number } | null)?.dealt;
                return (
                    <div className="battle-ended-overlay">
                        <div className="card battle-ended-card">
                            <h2>{won ? "The Boss Falters!" : "Assault Logged"}</h2>
                            {settleState === "settled" && typeof dealt === "number" ? (
                                <p>You dealt <strong>{dealt.toLocaleString()}</strong> damage this run — taken off the world&apos;s shared boss HP and banked to this week&apos;s leaderboard. Return to see where you rank.</p>
                            ) : settleState === "failed" ? (
                                <p>Your damage couldn&apos;t be logged to the leaderboard — return and try again.</p>
                            ) : (
                                <p>Taking your damage off the shared world boss and banking it to this week&apos;s leaderboard…</p>
                            )}
                            <button className="start-primary-btn" onClick={onExit}>Return to the Arena</button>
                        </div>
                    </div>
                );
            }}
        />
    );
}
