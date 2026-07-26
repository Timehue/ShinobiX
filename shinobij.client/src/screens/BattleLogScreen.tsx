/*
 * Read-only battle record for one finished fight.
 *
 * Sourced entirely from durable server receipts, so a battle stays readable long
 * after its 15-minute live session expired — and from any device, because the
 * record follows the account rather than the tab that fought it.
 *
 * Nothing here polls: a finished battle does not change. The live fight keeps
 * its own low-latency log in PvpBattleScreen; this screen is the archive.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../styles/battle-skin.css";
import { BattleActionTimeline, type TimelineActorFilter } from "../components/BattleActionTimeline";
import { BattleActionDetails } from "../components/BattleActionDetails";
import { DurableBattleRoundLog } from "../components/DurableBattleRoundLog";
import { BattleLogLine } from "../components/BattleLogLine";
import { fetchBattleLog, isAbort, type ApiFailureKind } from "../lib/pvp-combat-log-api";
import type { DurableActionReceipt, DurableBattleReceipt } from "../types/battle-log";

const OUTCOME_COPY: Record<string, string> = {
    win: "Victory",
    loss: "Defeat",
    draw: "Draw",
    flee: "Fled",
};

function formatWhen(ts: number): string {
    if (!ts) return "";
    return new Date(ts).toLocaleString([], {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
}

/** Which side the viewer fought on, derived from the receipt (never trusted input). */
function resolveMyRole(battle: DurableBattleReceipt | null, myName: string): "p1" | "p2" | null {
    if (!battle || !myName) return null;
    const me = myName.trim().toLowerCase();
    if (String(battle.p1?.name ?? "").trim().toLowerCase() === me) return "p1";
    if (String(battle.p2?.name ?? "").trim().toLowerCase() === me) return "p2";
    return null;
}

export function BattleLogScreen({
    battleId,
    playerName,
    onBack,
}: {
    battleId: string;
    playerName: string;
    onBack: () => void;
}) {
    const [battle, setBattle] = useState<DurableBattleReceipt | null>(null);
    const [entries, setEntries] = useState<DurableActionReceipt[]>([]);
    const [legacyLog, setLegacyLog] = useState<string[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<{ kind: ApiFailureKind; message: string } | null>(null);
    const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
    const [actorFilter, setActorFilter] = useState<TimelineActorFilter>("all");
    const [hideBasic, setHideBasic] = useState(false);
    const [reloadNonce, setReloadNonce] = useState(0);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        // No synchronous setState here: `loading` starts true and retry() flips it
        // in its own handler, so every state write below happens after an await.
        (async () => {
            try {
                const res = await fetchBattleLog(battleId, { signal: ac.signal });
                if (ac.signal.aborted) return;
                if (!res.ok) {
                    // Keep whatever is already on screen — a failed refresh must
                    // not blank a record the player is reading.
                    setError({ kind: res.kind, message: res.message });
                    setLoading(false);
                    return;
                }
                setError(null);
                setBattle(res.battle);
                setEntries(res.entries);
                setLegacyLog(res.source === "legacy-final-log" ? (res.legacyLog ?? []) : null);
                setSelectedSeq((prev) => prev ?? res.entries[res.entries.length - 1]?.seq ?? null);
                setLoading(false);
            } catch (err) {
                if (isAbort(err)) return;
                setError({ kind: "network", message: "Could not load this battle. Try again." });
                setLoading(false);
            }
        })();
        return () => ac.abort();
    }, [battleId, reloadNonce]);

    const myRole = useMemo(() => resolveMyRole(battle, playerName), [battle, playerName]);
    const selfName = myRole === "p2" ? (battle?.p2?.name ?? playerName) : (battle?.p1?.name ?? playerName);
    const oppName = myRole === "p2" ? (battle?.p1?.name ?? "") : (battle?.p2?.name ?? "");

    const outcome = useMemo(() => {
        if (!battle) return "";
        if (battle.fleedBy && battle.fleedBy === myRole) return "flee";
        if (!battle.winner || battle.winner === "draw") return "draw";
        return battle.winner === myRole ? "win" : "loss";
    }, [battle, myRole]);

    const selected = useMemo(
        () => entries.find((e) => e.seq === selectedSeq) ?? null,
        [entries, selectedSeq],
    );

    const retry = useCallback(() => { setLoading(true); setError(null); setReloadNonce((n) => n + 1); }, []);

    return (
        <div className="battle-log-screen">
            <header className="bls-header">
                <button type="button" className="bls-back" onClick={onBack}>← Back</button>
                <div className="bls-title-block">
                    <h1 className={`bls-outcome bls-outcome-${outcome || "unknown"}`}>
                        {OUTCOME_COPY[outcome] ?? "Battle Record"}
                    </h1>
                    {battle && (
                        <p className="bls-subtitle">
                            vs <strong>{oppName || "—"}</strong>
                            <span className="bls-dot">·</span>
                            {battle.ranked ? "Ranked" : "PvP"}
                            <span className="bls-dot">·</span>
                            {battle.rounds} round{battle.rounds === 1 ? "" : "s"}
                            <span className="bls-dot">·</span>
                            {formatWhen(battle.endedAt)}
                        </p>
                    )}
                    {/* Secondary detail, not the headline — useful for support tickets. */}
                    <p className="bls-battle-id">
                        <span>Battle ID</span> <code>{battleId}</code>
                    </p>
                </div>
            </header>

            {loading && entries.length === 0 && (
                <p className="bls-state" role="status">Loading battle record…</p>
            )}

            {error && (
                <div className="bls-state bls-error" role="alert">
                    <p>{error.message}</p>
                    {/* 403/404 are terminal; a retry would just fail again. */}
                    {(error.kind === "network" || error.kind === "server") && (
                        <button type="button" className="bls-retry" onClick={retry}>Retry</button>
                    )}
                </div>
            )}

            {!loading && !error && entries.length === 0 && !legacyLog && (
                <p className="bls-state">No actions were recorded for this battle.</p>
            )}

            {/* Battles that predate per-action receipts still have their final log
                on the battle receipt — show it rather than claiming nothing happened. */}
            {legacyLog && legacyLog.length > 0 && (
                <section className="bls-legacy combat-timeline">
                    <h2>Battle Log</h2>
                    <p className="bls-legacy-note">
                        This battle was fought before per-action records existed, so only its
                        final log was kept.
                    </p>
                    {legacyLog.map((line, i) => <BattleLogLine key={i} line={line} />)}
                </section>
            )}

            {entries.length > 0 && (
                <>
                    <BattleActionTimeline
                        entries={entries}
                        myRole={myRole}
                        selectedSeq={selectedSeq}
                        onSelect={setSelectedSeq}
                        actorFilter={actorFilter}
                        onActorFilter={setActorFilter}
                        hideBasic={hideBasic}
                        onHideBasic={setHideBasic}
                    />
                    <BattleActionDetails
                        entry={selected}
                        selfName={selfName}
                        oppName={oppName}
                        myRole={myRole}
                    />
                    <section className="bls-detailed">
                        <h2>Detailed Battle Log</h2>
                        <DurableBattleRoundLog
                            entries={entries}
                            selfName={selfName}
                            oppName={oppName}
                            myRole={myRole}
                            selectedSeq={selectedSeq}
                            onSelectAction={setSelectedSeq}
                        />
                    </section>
                </>
            )}
        </div>
    );
}

export default BattleLogScreen;
