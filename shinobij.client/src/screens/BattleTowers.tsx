import { useEffect, useState } from "react";
import type { Character } from "../types/character";
import { BattleTowersLobby } from "./BattleTowersLobby";
import { BattleTowerFight } from "./BattleTowerFight";
import { fetchTowerState, type TowerSession, type TowerHostLoadout } from "../lib/towers-api";

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
// live session by that id and drops the player straight back into the fight. If the
// run is gone/finished/expired we just fall to the lobby — the tower is penalty-free
// (unlimited retries), so there's no loss to apply on refresh.
//
// Presence of the key also IS the "in a fight" signal the nav lock reads
// (hasActiveTowerFight). lib can't import from screens, so screen-guards keeps a
// duplicate of this exact key string — keep the two in sync.
export const TOWER_RUN_KEY = "shinobix:towerRunId";

type View =
    | { phase: "checking"; runId: string }                       // resuming a persisted run
    | { phase: "lobby" }                                         // pick a floor
    | { phase: "fight"; runId: string; session: TowerSession };  // on the board

function clearRunKey() {
    try { localStorage.removeItem(TOWER_RUN_KEY); } catch { /* storage disabled */ }
}

// Bound on the resume probe. fetchTowerState rejects fast for the normal failure
// modes (offline / 404 / 403), but a proxy that accepts then silently holds the
// connection could hang forever — and the "checking" screen is nav-locked, so
// without this the player would have no way out. On timeout we treat it as
// "couldn't resume" and fall to the (penalty-free) lobby.
const RESUME_TIMEOUT_MS = 12_000;

export function BattleTowers({ character, sharedImages, hostLoadout, onExit }: { character: Character; sharedImages?: Record<string, string>; hostLoadout?: TowerHostLoadout; onExit: () => void }) {
    // If a runId survived a refresh, start by checking the server; otherwise the
    // lobby shows immediately (no resume flash on a fresh entry).
    const [view, setView] = useState<View>(() => {
        try {
            const saved = localStorage.getItem(TOWER_RUN_KEY);
            return saved ? { phase: "checking", runId: saved } : { phase: "lobby" };
        } catch {
            return { phase: "lobby" };
        }
    });

    // Resume a fight that was in progress before a refresh: re-fetch the server
    // session by its persisted runId. Active → back into the fight; done / expired /
    // forbidden / timed-out → clear the key and fall to the lobby. A single `settled`
    // latch resolves the fetch-vs-timeout race and ignores a late result after the
    // effect is torn down (unmount / dep change).
    const checkingRunId = view.phase === "checking" ? view.runId : null;
    useEffect(() => {
        if (checkingRunId == null) return;
        let settled = false;
        const toLobby = () => { if (settled) return; settled = true; clearRunKey(); setView({ phase: "lobby" }); };
        const toFight = (session: TowerSession) => { if (settled) return; settled = true; setView({ phase: "fight", runId: checkingRunId, session }); };
        const timer = setTimeout(toLobby, RESUME_TIMEOUT_MS);
        fetchTowerState(checkingRunId, character.name)
            .then(session => { if (session.status === "active") toFight(session); else toLobby(); })
            .catch(toLobby);
        return () => { settled = true; clearTimeout(timer); };
    }, [checkingRunId, character.name]);

    // Persist the active runId while a fight is live so a refresh can resume it; a
    // hard refresh skips this write, leaving the id for the resume effect above.
    // Clean exits clear the key directly (onExit / resume-fail / Cancel) so it can't
    // linger. Skipped while "checking" so the resume probe can't have its id cleared
    // out from under it.
    useEffect(() => {
        if (view.phase === "checking") return;
        try {
            if (view.phase === "fight") localStorage.setItem(TOWER_RUN_KEY, view.runId);
            else localStorage.removeItem(TOWER_RUN_KEY);
        } catch { /* storage disabled */ }
    }, [view]);

    if (view.phase === "checking") {
        return (
            <div className="arena-fullscreen" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, minHeight: "100dvh", color: "#cbd5e1" }}>
                <p className="hint" style={{ margin: 0 }}>Resuming your tower run…</p>
                {/* Escape hatch: the screen is nav-locked while checking, so give the
                    player a way out if the resume probe is slow/stuck. */}
                <button style={{ padding: "0.5rem 1rem", borderColor: "#475569", color: "#cbd5e1" }}
                    onClick={() => { clearRunKey(); setView({ phase: "lobby" }); }}>
                    Cancel — back to the lobby
                </button>
            </div>
        );
    }
    if (view.phase === "fight") {
        return (
            <BattleTowerFight
                character={character}
                sharedImages={sharedImages}
                hostLoadout={hostLoadout}
                runId={view.runId}
                initialSession={view.session}
                // Clear the runId synchronously here: the parent's onExit unmounts this
                // component before the persistence effect could clear it, so without this
                // the key would linger and trigger a stray "Resuming…" flash next visit.
                onExit={() => { clearRunKey(); setView({ phase: "lobby" }); onExit(); }}
            />
        );
    }
    return (
        <BattleTowersLobby
            character={character}
            hostLoadout={hostLoadout}
            onEnter={(runId, session) => setView({ phase: "fight", runId, session })}
            onBack={onExit}
        />
    );
}
