import { useCallback, useEffect, useState } from "react";
import "../styles/battle-skin.css";
import type { Character, BattleHistoryEntry } from "../types/character";
import { BattleTowersLobby } from "./BattleTowersLobby";
import { BattleTowerFight } from "./BattleTowerFight";
import { fetchTowerState, TowerStateApiError, type TowerSession, type TowerHostLoadout } from "../lib/towers-api";
import { setTowerFightRunId, setTowerPvpMatchId, towerPvpMatchIdFromRunKey, TOWER_RUN_KEY } from "../lib/screen-guards";
import {
    fetchTowerPvpSession,
    settleAndLeaveTowerPvp,
    submitTowerPvpActionWithLostResponseRetry,
    type TowerPvpMatch,
} from "../lib/tower-pvp-api";
import { gameConfirm } from "../components/GameAlert";

// ─── Battle Towers (combined lobby ↔ fight, refresh-resumable) ─────────────────
// One screen wrapping the lobby and the fullscreen fight, so App.tsx only wires a
// single "battleTowers" screen.
//
// Refresh resume: the tower run is fully server-authoritative — the session lives
// in tower:<runId> (durable, 30-min TTL renewed on every action). So unlike the
// arena/endless fights (which snapshot React combat state + a server battle-lock),
// The only thing this screen persists across a refresh is the runId. While a fight
// is on the board we store it under TOWER_RUN_KEY; a separate recovery breadcrumb
// survives an explicit "leave view" so the server run can still be reopened later.
// On a reload the screen itself is
// restored (screen-guards' RESTORABLE_SCREENS) and this component re-fetches the
// live session by that id and drops the player straight back into the fight or its
// completed result. Transient recovery failures preserve the run id for retry; only
// an explicit abandon or clean result exit clears the recovery breadcrumb.
//
// Presence of the key also IS the "in a fight" signal the nav lock reads.
// screen-guards owns both the key and the same-tab change event.
export { TOWER_RUN_KEY };
export const TOWER_RECOVERY_RUN_KEY = "shinobix:towerRecoveryRunId:v1";

type View =
    | { phase: "checking"; runId: string }                       // resuming a persisted run
    | { phase: "resumeError"; runId: string; message: string; terminal?: boolean }
    | { phase: "lobby"; pvpMatchId?: string }                     // pick a floor / resume queue
    | { phase: "fight"; runId: string; session: TowerSession }   // on the Story/Spire board
    | { phase: "pvpFight"; match: TowerPvpMatch };                // public exact-2v2 board

function clearFightKey() {
    setTowerFightRunId(null);
}

function writeRecoveryKey(runId: string) {
    try { localStorage.setItem(TOWER_RECOVERY_RUN_KEY, runId); } catch { /* storage disabled */ }
}

function clearRecoveryKey() {
    try { localStorage.removeItem(TOWER_RECOVERY_RUN_KEY); } catch { /* storage disabled */ }
}

function clearRunKeys() {
    clearFightKey();
    clearRecoveryKey();
}

// Bound on the resume probe. fetchTowerState rejects fast for the normal failure
// modes (offline / 404 / 403), but a proxy that accepts then silently holds the
// connection could hang forever — and the "checking" screen is nav-locked, so
// without this the player would have no way out. On timeout we surface a retryable
// recovery state and keep the persisted run id intact.
const RESUME_TIMEOUT_MS = 12_000;

export function BattleTowers({ character, updateCharacter, sharedImages, hostLoadout, onExit, onRecordBattle }: { character: Character; updateCharacter: (c: Character) => void; sharedImages?: Record<string, string>; hostLoadout?: TowerHostLoadout; onExit: () => void; onRecordBattle?: (entry: BattleHistoryEntry) => void }) {
    // If a runId survived a refresh, start by checking the server; otherwise the
    // lobby shows immediately (no resume flash on a fresh entry).
    const [view, setView] = useState<View>(() => {
        try {
            const saved = localStorage.getItem(TOWER_RUN_KEY) ?? localStorage.getItem(TOWER_RECOVERY_RUN_KEY);
            const pvpMatchId = towerPvpMatchIdFromRunKey(saved);
            if (pvpMatchId) return { phase: "lobby", pvpMatchId };
            return saved ? { phase: "checking", runId: saved } : { phase: "lobby" };
        } catch {
            return { phase: "lobby" };
        }
    });

    // Resume a fight that was in progress before a refresh: re-fetch the server
    // session by its persisted runId. Active and completed sessions both reopen the
    // fight/result screen; failures enter a retryable state without discarding the
    // breadcrumb. A single `settled` latch resolves the fetch-vs-timeout race and
    // ignores a late result after the effect is torn down (unmount / dep change).
    const checkingRunId = view.phase === "checking" ? view.runId : null;
    useEffect(() => {
        if (checkingRunId == null) return;
        let settled = false;
        const controller = new AbortController();
        const toFight = (session: TowerSession) => { if (settled) return; settled = true; setView({ phase: "fight", runId: checkingRunId, session }); };
        const toError = (message: string, terminal = false) => {
            if (settled) return;
            settled = true;
            setView({ phase: "resumeError", runId: checkingRunId, message, terminal });
        };
        const timer = setTimeout(() => {
            controller.abort();
            toError("The Tower server did not answer in time. Your run is still saved.");
        }, RESUME_TIMEOUT_MS);
        fetchTowerState(checkingRunId, character.name, controller.signal)
            .then(toFight)
            .catch((error: unknown) => {
                if (error instanceof TowerStateApiError && error.errorCode === "run-publication-pending") {
                    toError("The server is still republishing this battlefield. Your run remains reserved; retry in a moment.");
                    return;
                }
                const unavailable = error instanceof TowerStateApiError && error.errorCode === "run-unavailable";
                toError(unavailable
                    ? (error.leaseReleased
                        ? "The server completed exact recovery and released this run. You can safely return to the Tower lobby."
                        : "This run is no longer available. Its stale recovery link can be cleared safely.")
                    : String((error as Error)?.message || "The run could not be recovered yet."), unavailable);
            });
        return () => { settled = true; controller.abort(); clearTimeout(timer); };
    }, [checkingRunId, character.name]);

    // Persist the active runId while a fight is live so a refresh can resume it; a
    // hard refresh skips this write, leaving the id for the resume effect above.
    // Clean exits clear the key directly so it can't linger. Recovery phases skip
    // this synchronization so the resume probe cannot lose its id before retry.
    useEffect(() => {
        if (view.phase === "pvpFight") {
            clearRecoveryKey();
            setTowerPvpMatchId(view.match.matchId);
            return;
        }
        if (view.phase === "lobby" && view.pvpMatchId) {
            clearRecoveryKey();
            setTowerPvpMatchId(view.pvpMatchId);
            return;
        }
        if (view.phase === "checking" || view.phase === "resumeError" || view.phase === "fight") {
            setTowerFightRunId(view.runId);
            writeRecoveryKey(view.runId);
            return;
        }
        clearRunKeys();
    }, [view]);

    const enterPvpMatch = useCallback((match: TowerPvpMatch) => {
        setTowerPvpMatchId(match.matchId);
        clearRecoveryKey();
        setView({ phase: "pvpFight", match });
    }, []);

    const updatePvpMatchLock = useCallback((matchId: string | null) => {
        if (matchId) setTowerPvpMatchId(matchId);
        else clearFightKey();
        setView(current => current.phase === "lobby"
            ? matchId ? { phase: "lobby", pvpMatchId: matchId } : { phase: "lobby" }
            : current);
    }, []);

    if (view.phase === "checking") {
        return (
            <div className="arena-fullscreen" role="status" aria-live="polite" aria-busy="true" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, minHeight: "100dvh", color: "var(--slate-300)" }}>
                <p className="hint" style={{ margin: 0 }}>Resuming your tower run…</p>
                {/* Escape hatch: the screen is nav-locked while checking, so give the
                    player a way out if the resume probe is slow/stuck. */}
                <button style={{ padding: "0.5rem 1rem", borderColor: "var(--slate-600)", color: "var(--slate-300)" }}
                    onClick={() => setView({ phase: "resumeError", runId: view.runId, message: "Recovery was paused. Your run is still saved." })}>
                    Stop waiting
                </button>
            </div>
        );
    }
    if (view.phase === "resumeError") {
        return (
            <div className="arena-fullscreen" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, minHeight: "100dvh", padding: 24, color: "var(--slate-300)" }}>
                <div role="alert" style={{ display: "grid", gap: 8, justifyItems: "center" }}>
                    <strong style={{ color: "var(--gold-400)" }}>{view.terminal ? "This Tower run has closed" : "Your Tower run is still recoverable"}</strong>
                    <p className="hint" style={{ margin: 0, maxWidth: 480, textAlign: "center" }}>{view.message}</p>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    {!view.terminal && <button style={{ padding: "0.6rem 1rem" }} onClick={() => setView({ phase: "checking", runId: view.runId })}>Retry recovery</button>}
                    <button style={{ padding: "0.6rem 1rem", borderColor: "var(--slate-600)", color: "var(--slate-300)" }}
                        onClick={() => { void (async () => {
                            if (view.terminal) {
                                clearRunKeys();
                                setView({ phase: "lobby" });
                                return;
                            }
                            const confirmed = await gameConfirm("Stop recovering this Tower run? This clears this device's recovery link; the server run may remain until it expires, and an unsettled result could be harder to recover.");
                            if (!confirmed) return;
                            clearRunKeys();
                            setView({ phase: "lobby" });
                        })(); }}>
                        {view.terminal ? "Return to the Tower lobby" : "Stop recovery and return to lobby"}
                    </button>
                </div>
            </div>
        );
    }
    if (view.phase === "fight") {
        return (
            <BattleTowerFight
                character={character}
                updateCharacter={updateCharacter}
                sharedImages={sharedImages}
                hostLoadout={hostLoadout}
                runId={view.runId}
                initialSession={view.session}
                onRecordBattle={onRecordBattle}
                settleOnAnyDone
                // Clear the runId synchronously here: the parent's onExit unmounts this
                // component before the persistence effect could clear it, so without this
                // the key would linger and trigger a stray "Resuming…" flash next visit.
                onLeaveActive={() => {
                    // Leaving the view is not a server abandon. Unlock global navigation
                    // but keep the independent breadcrumb so reopening Towers reconnects.
                    clearFightKey();
                    writeRecoveryKey(view.runId);
                    onExit();
                }}
                onExit={() => { clearRunKeys(); setView({ phase: "lobby" }); onExit(); }}
            />
        );
    }
    if (view.phase === "pvpFight") {
        return (
            <BattleTowerFight
                character={character}
                sharedImages={sharedImages}
                runId={view.match.matchId}
                initialSession={view.match.combat}
                stateFn={fetchTowerPvpSession}
                actionRetryFn={submitTowerPvpActionWithLostResponseRetry}
                settleFn={settleAndLeaveTowerPvp}
                settleOnAnyDone
                variant="team-pvp"
                onExit={() => {
                    setTowerPvpMatchId(null);
                    setView({ phase: "lobby" });
                }}
            />
        );
    }
    return (
        <BattleTowersLobby
            character={character}
            updateCharacter={updateCharacter}
            hostLoadout={hostLoadout}
            onEnter={(runId, session) => {
                // Lock global navigation in the same event turn as the lobby action.
                setTowerFightRunId(runId);
                writeRecoveryKey(runId);
                setView({ phase: "fight", runId, session });
            }}
            onEnterPvp={enterPvpMatch}
            onPvpMatchChange={updatePvpMatchLock}
            onBack={onExit}
        />
    );
}
