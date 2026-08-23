import { useCallback, useEffect, useState } from "react";
import "../styles/battle-skin.css";
import type { Character, BattleHistoryEntry, VersionedCharacterCommit } from "../types/character";
import { BattleTowersLobby } from "./BattleTowersLobby";
import { BattleTowerFight } from "./BattleTowerFight";
import { fetchTowerState, TowerStateApiError, type TowerSession, type TowerHostLoadout } from "../lib/towers-api";
import { setTowerFightRunId, towerPvpMatchIdFromRunKey, TOWER_RUN_KEY } from "../lib/screen-guards";
import {
} from "../lib/tower-pvp-api";
import { gameConfirm } from "../components/GameAlert";

// ─── Battle Towers (combined lobby ↔ fight, refresh-resumable) ─────────────────
// One screen wrapping the lobby and the fullscreen fight, so App.tsx only wires a
// single "battleTowers" screen.
//
// Refresh resume: the tower run is fully server-authoritative — the session lives
// in tower:<runId> (durable, 30-min TTL renewed on every action). So unlike the
// arena/endless fights (which snapshot React combat state + a server battle-lock),
// the ONLY thing this screen persists across a refresh is the runId. While a fight
// is on the board we store it under TOWER_RUN_KEY; on a reload the screen itself is
// restored (screen-guards' RESTORABLE_SCREENS) and this component re-fetches the
// live session by that id and drops the player straight back into the fight or its
// completed result. Transient recovery failures preserve the run id for retry; only
// an explicit recovery stop or confirmed result exit clears it.
//
// Presence of the key also IS the "in a fight" signal the nav lock reads
// (hasActiveTowerFight). lib can't import from screens, so screen-guards keeps a
// duplicate of this exact key string — keep the two in sync.
export { TOWER_RUN_KEY };
export const TOWER_RECOVERY_RUN_KEY = "shinobix:towerRecoveryRunId:v1";

type View =
    | { phase: "checking"; runId: string }                       // resuming a persisted run
    | { phase: "resumeError"; runId: string; message: string; terminal?: boolean }
    | { phase: "lobby" }                                         // pick a floor
    | { phase: "fight"; runId: string; session: TowerSession }  // on the board

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

// Bound on the resume probe. A proxy can accept then silently hold a request; the
// timeout enters a recoverable error state without deleting the saved run id.
const RESUME_TIMEOUT_MS = 12_000;

export function BattleTowers({ character, updateCharacter, onVersionedCharacter, sharedImages, hostLoadout, onExit, onRecordBattle }: { character: Character; updateCharacter: (c: Character) => void; onVersionedCharacter: VersionedCharacterCommit; sharedImages?: Record<string, string>; hostLoadout?: TowerHostLoadout; onExit: () => void; onRecordBattle?: (entry: BattleHistoryEntry) => void }) {
    // If a runId survived a refresh, start by checking the server; otherwise the
    // lobby shows immediately (no resume flash on a fresh entry).
    const [view, setView] = useState<View>(() => {
        try {
            const saved = localStorage.getItem(TOWER_RUN_KEY) ?? localStorage.getItem(TOWER_RECOVERY_RUN_KEY);
            // A Team Arena key belongs to the Battle Arena now; never treat it
            // as a Tower run to resume.
            if (towerPvpMatchIdFromRunKey(saved)) return { phase: "lobby" };
            return saved ? { phase: "checking", runId: saved } : { phase: "lobby" };
        } catch {
            return { phase: "lobby" };
        }
    });

    // Resume active and completed sessions from the persisted run id. The latch
    // resolves fetch-vs-timeout races; the AbortController rejects late requests.
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
                        ? "The server completed recovery and released this run. You can safely return to the Tower lobby."
                        : "This run is no longer available. Its stale recovery link can be cleared safely.")
                    : String((error as Error)?.message || "The run could not be recovered yet."), unavailable);
            });
        return () => { settled = true; controller.abort(); clearTimeout(timer); };
    }, [checkingRunId, character.name]);

    // Preserve the run id through checking, recoverable errors, and the result view.
    // Only a confirmed result exit or explicit recovery stop clears it.
    useEffect(() => {
        try {
            if (view.phase === "checking" || view.phase === "resumeError" || view.phase === "fight") {
                setTowerFightRunId(view.runId);
                writeRecoveryKey(view.runId);
            } else clearRunKeys();
        } catch { /* storage disabled */ }
    }, [view]);

    // Stable identity on purpose. The Ready Room's poll effect depends on this
    // through its own enterActiveRoom callback, so an inline arrow here made that
    // effect tear down and re-issue fetchTowerParty on EVERY App re-render.
    const enterRun = useCallback((runId: string, session: TowerSession) => {
        setTowerFightRunId(runId);
        writeRecoveryKey(runId);
        setView({ phase: "fight", runId, session });
    }, []);

    if (view.phase === "checking") {
        return (
            <div className="arena-fullscreen" role="status" aria-live="polite" aria-busy="true"
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, minHeight: "100dvh", color: "var(--slate-300)" }}>
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
                onVersionedCharacter={onVersionedCharacter}
                sharedImages={sharedImages}
                hostLoadout={hostLoadout}
                runId={view.runId}
                initialSession={view.session}
                onRecordBattle={onRecordBattle}
                settleOnAnyDone
                onLeaveActive={() => {
                    // Leaving the view is not a server abandon. Unlock navigation but
                    // preserve an independent reconnect breadcrumb for this MPvE run.
                    clearFightKey();
                    writeRecoveryKey(view.runId);
                    onExit();
                }}
                onExit={() => { clearRunKeys(); setView({ phase: "lobby" }); onExit(); }}
            />
        );
    }
    return (
        <BattleTowersLobby
            character={character}
            updateCharacter={updateCharacter}
            hostLoadout={hostLoadout}
            onEnter={enterRun}
            onBack={onExit}
        />
    );
}
