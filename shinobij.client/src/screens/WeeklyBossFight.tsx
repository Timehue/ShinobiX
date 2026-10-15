import { useCallback, useMemo } from "react";
import { createWeeklyBossSettlementCoordinator } from "../lib/weekly-boss-settlement";
import { MissionArenaFight } from "./MissionArenaFight";
import type { Character } from "../types/character";
import type { SoloPveSession } from "../lib/solo-pve-api";
import { soloPveArenaTransport, soloPveSessionForArena } from "../lib/solo-pve-arena-adapter";
import { useLiveCapabilities } from "../lib/live-capabilities-context";
import { capabilityAdmissionAllowed } from "../lib/live-capability-admission";
import { WeeklyBossResult } from "../components/WeeklyBossResult";

// Weekly Boss is a solo unlimited-health score attack,
// rendered on the normal Arena shell (MissionArenaFight) — the same format as
// PvE / missions / story. It replaced BattleTowerFight (the tower rail), so the
// fight no longer looks like a tower floor ("Floor 9200 …"). The fight is a
// server-authoritative SoloPveSession; every attack logs damage to the week's shared
// leaderboard. `settleOnAnyDone` banks that damage whether the player is knocked out
// or outlasts the round budget — the real reward is the leaderboard, shown back on
// the Weekly Boss arena screen once the player returns, so the in-fight result card
// stays deliberately simple.
//
// Both entry points mount this wrapper inside WeeklyBossArena: the roaming world-map
// "Stand & Fight" (staged through lib/weekly-boss-launch.ts) and the menu "Fight Boss"
// button. Both POST /api/weekly-boss {kind:"logFight"} to settle; the arena decides
// where onExit goes (back to the World Map for a roaming fight).
export function WeeklyBossFight({
    character,
    sharedImages,
    runId,
    initialSession,
    settleFn,
    onExit,
    exitLabel = "Return to the Arena",
}: {
    character: Character;
    sharedImages?: Record<string, string>;
    runId: string;
    initialSession: SoloPveSession;
    settleFn: (runId: string, playerName: string) => Promise<unknown>;
    onExit: () => void;
    exitLabel?: string;
}) {
    const settlementScope = useMemo(() => ({ runId, playerName: character.name, coordinate: createWeeklyBossSettlementCoordinator() }), [runId, character.name]);
    const settleOnce = useCallback((id: string, playerName: string) => {
        if (id !== settlementScope.runId || playerName !== settlementScope.playerName) return Promise.reject(new Error('This Weekly Boss settlement belongs to another attempt.'));
        return settlementScope.coordinate(() => settleFn(id, playerName));
    }, [settlementScope, settleFn]);
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
            settleFn={settleOnce}
            settleOnAnyDone
            // Weekly settlement atomically owns contribution, usage costs, and
            // physical HP/hospital state. Reusing it here also makes the
            // explicit leave/forfeit path wait for that durable settlement.
            outcomeFn={settleOnce}
            onExit={onExit}
            renderResult={({ settleState, settleResult, retry }) => <WeeklyBossResult settleState={settleState} settleResult={settleResult} onRetry={retry} onExit={onExit} exitLabel={exitLabel} />}
        />
    );
}
