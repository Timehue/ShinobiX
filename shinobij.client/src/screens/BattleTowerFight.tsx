import { useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "../types/character";
import {
    submitTowerAction, settleTowerRun, fetchTowerState,
    type TowerSession, type TowerActor, type TowerSettleResponse,
} from "../lib/towers-api";
import {
    towerHexPixel, towerLayerSize, towerHexDistance, towerNeighbors, towerTilesInRange, HEX_W, HEX_H,
} from "../lib/tower-grid";
import chamberBg from "../assets/towers/chamber.webp";

// ─── Battle Tower Fight (fullscreen pop-out combat shell) ─────────────────────
// Renders the server-authoritative tower:<runId> session: a hex board, squad +
// enemy status, an action bar for the human's turn, the combat log, and the
// objective tracker. The human controls their own actor; allies + enemies are AI,
// advanced server-side. On a squad clear it auto-settles rewards. See
// docs/battle-towers-plan.md §11.

type Mode = "idle" | "move" | "attack" | "jutsu";
type JutsuLike = { id?: string; name?: string; type?: string; ap?: number; range?: number; effectPower?: number };

const SIDE_COLOR: Record<string, string> = { squad: "#4ade80", enemy: "#f87171", npc: "#facc15" };

export function BattleTowerFight({
    character,
    runId,
    initialSession,
    onExit,
}: {
    character: Character;
    runId: string;
    initialSession: TowerSession;
    onExit: () => void;
}) {
    const [session, setSession] = useState<TowerSession>(initialSession);
    const [mode, setMode] = useState<Mode>("idle");
    const [selJutsu, setSelJutsu] = useState<JutsuLike | null>(null);
    const [busy, setBusy] = useState(false);
    const [reject, setReject] = useState<string | null>(null);
    const [settle, setSettle] = useState<TowerSettleResponse | null>(null);
    const settledRef = useRef(false);

    const me = character.name;
    const w = session.map.width, h = session.map.height;
    const layer = useMemo(() => towerLayerSize(w, h), [w, h]);

    const activeId = session.turnQueue[session.activeIndex];
    const activeActor = session.actors.find(a => a.id === activeId);
    const myTurn = session.status === "active" && !!activeActor && activeActor.ai === false && activeActor.ownerSlug === me && activeActor.hp > 0;
    const myActor = activeActor && activeActor.ownerSlug === me ? activeActor : null;

    // Reconnect: if mounted without a fresh session (or to recover), pull the latest once.
    useEffect(() => {
        if (initialSession.status === "active") return;
        fetchTowerState(runId, me).then(setSession).catch(() => {});
    }, [runId, me, initialSession.status]);

    // Auto-settle once on a squad clear.
    useEffect(() => {
        if (session.status === "done" && session.winner === "squad" && !settledRef.current) {
            settledRef.current = true;
            settleTowerRun(runId, me).then(setSettle).catch(() => {});
        }
    }, [session.status, session.winner, runId, me]);

    // Valid target/move sets for the current mode.
    const myPos = myActor?.pos ?? -1;
    const enemiesInRange = useMemo(() => {
        if (!myActor) return new Set<string>();
        const out = new Set<string>();
        const range = mode === "jutsu" ? Math.max(1, Number(selJutsu?.range ?? 1)) : 1;
        for (const a of session.actors) {
            if (a.hp <= 0 || (a.side !== "enemy")) continue;
            if (towerHexDistance(myPos, a.pos, w) <= range) out.add(a.id);
        }
        return out;
    }, [myActor, mode, selJutsu, session.actors, myPos, w]);

    const moveTiles = useMemo(() => {
        if (mode !== "move" || !myActor) return new Set<number>();
        const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
        const blocked = new Set(session.map.blockedTiles);
        return new Set(towerNeighbors(myPos, w, h).filter(t => !occupied.has(t) && !blocked.has(t)));
    }, [mode, myActor, session.actors, session.map.blockedTiles, myPos, w, h]);

    const jutsuRangeTiles = useMemo(() => {
        if (mode !== "jutsu" || !myActor) return new Set<number>();
        return towerTilesInRange(myPos, Math.max(1, Number(selJutsu?.range ?? 1)), w, h);
    }, [mode, myActor, selJutsu, myPos, w, h]);

    async function send(action: Parameters<typeof submitTowerAction>[2]) {
        if (busy) return;
        setBusy(true); setReject(null);
        try {
            const res = await submitTowerAction(runId, me, action);
            setSession(res.session);
            if (!res.applied) setReject(res.reason ?? "Invalid action");
        } catch (e) {
            setReject(String((e as Error)?.message ?? e));
        } finally {
            setBusy(false);
            setMode("idle"); setSelJutsu(null);
        }
    }

    function onTileClick(tile: number) {
        if (!myTurn || busy) return;
        if (mode === "move" && moveTiles.has(tile)) { void send({ type: "move", tile }); return; }
        const occ = session.actors.find(a => a.hp > 0 && a.pos === tile);
        if (occ && occ.side === "enemy" && enemiesInRange.has(occ.id)) {
            if (mode === "attack") void send({ type: "attack", targetId: occ.id });
            else if (mode === "jutsu" && selJutsu?.id) void send({ type: "jutsu", jutsuId: selJutsu.id, targetId: occ.id });
        }
    }

    const myJutsu: JutsuLike[] = Array.isArray(myActor?.character?.jutsu) ? (myActor!.character.jutsu as JutsuLike[]) : [];
    const objective = session.objectiveState.kind;
    const squad = session.actors.filter(a => a.side === "squad");
    const enemies = session.actors.filter(a => a.side === "enemy");

    return (
        <div className="arena-fullscreen screen-battleTowerFight" style={{ position: "relative", minHeight: "100dvh", color: "#e2e8f0" }}>
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(rgba(4,8,18,0.55),rgba(4,8,18,0.85)), url(${chamberBg}) center/cover`, zIndex: 0 }} />
            <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "210px minmax(0,1fr) 230px", gap: 12, padding: 12, minHeight: "100dvh" }}>

                {/* Squad rail */}
                <aside>
                    <h3 style={{ margin: "0 0 8px" }}>🛡 Squad</h3>
                    {squad.map(a => <ActorCard key={a.id} actor={a} highlight={a.id === activeId} />)}
                </aside>

                {/* Board */}
                <main style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                        <strong>Floor {session.floor} · {objective.replace(/-/g, " ")}</strong>
                        <span style={{ color: "#94a3b8", flex: 1, textAlign: "right" }}>Round {session.round}{myTurn ? " · your turn" : ""}</span>
                        {session.status === "active" && (
                            // Free, penalty-free abandon — the run lives server-side and floors have
                            // unlimited retries, so leaving just drops back to Central (no loss credited).
                            <button
                                style={{ padding: "4px 10px", fontSize: "0.8rem", borderColor: "#475569", color: "#cbd5e1" }}
                                onClick={() => { if (window.confirm("Leave this floor? Your run won't be saved — floors have unlimited retries.")) onExit(); }}
                            >Leave</button>
                        )}
                    </div>
                    <div style={{ overflow: "auto", border: "1px solid #1e293b", borderRadius: 8, background: "rgba(0,0,0,0.25)", flex: 1 }}>
                        <div style={{ position: "relative", width: layer.width, height: layer.height, margin: "8px auto" }}>
                            {Array.from({ length: w * h }, (_, pos) => {
                                const { left, top } = towerHexPixel(pos, w);
                                const isMove = moveTiles.has(pos);
                                const inJ = mode === "jutsu" && jutsuRangeTiles.has(pos);
                                const isGoal = session.map.objectiveTiles.includes(pos);
                                const isBlocked = session.map.blockedTiles.includes(pos);
                                return (
                                    <button key={pos} onClick={() => onTileClick(pos)}
                                        style={{
                                            position: "absolute", left, top, width: HEX_W, height: HEX_H, padding: 0,
                                            borderRadius: 6, cursor: myTurn ? "pointer" : "default",
                                            border: `1px solid ${isMove ? "#4ade80" : inJ ? "#60a5fa" : "rgba(148,163,184,0.18)"}`,
                                            background: isGoal ? "rgba(250,204,21,0.18)" : isBlocked ? "rgba(100,116,139,0.4)" : isMove ? "rgba(74,222,128,0.14)" : "rgba(15,23,42,0.25)",
                                        }} />
                                );
                            })}
                            {session.actors.filter(a => a.hp > 0).map(a => {
                                const { left, top } = towerHexPixel(a.pos, w);
                                const targetable = enemiesInRange.has(a.id) && (mode === "attack" || (mode === "jutsu" && !!selJutsu));
                                return (
                                    <div key={a.id} onClick={() => onTileClick(a.pos)}
                                        title={`${a.name} ${a.hp}/${a.maxHp}`}
                                        style={{
                                            position: "absolute", left: left + HEX_W / 2 - 16, top: top + HEX_H / 2 - 16, width: 32, height: 32,
                                            borderRadius: "50%", background: SIDE_COLOR[a.side] ?? "#94a3b8",
                                            border: `2px solid ${a.id === activeId ? "#fff" : targetable ? "#fca5a5" : "rgba(0,0,0,0.5)"}`,
                                            boxShadow: targetable ? "0 0 10px #f87171" : "0 2px 4px rgba(0,0,0,0.6)",
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            fontSize: 11, fontWeight: 700, color: "#0b1220", cursor: targetable ? "pointer" : "default",
                                        }}>
                                        {a.side === "enemy" ? "✦" : a.name.slice(0, 1).toUpperCase()}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Action bar */}
                    <div style={{ marginTop: 8, minHeight: 56 }}>
                        {myTurn ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                <span style={{ color: "#facc15", fontWeight: 700 }}>{session.activeAp} AP</span>
                                <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>{session.actionsThisTurn}/5</span>
                                <ActBtn label="Move (30)" on={mode === "move"} onClick={() => setMode(m => m === "move" ? "idle" : "move")} disabled={busy} />
                                <ActBtn label="Attack (40)" on={mode === "attack"} onClick={() => setMode(m => m === "attack" ? "idle" : "attack")} disabled={busy} />
                                {myJutsu.length > 0 && (
                                    <select value={selJutsu?.id ?? ""} disabled={busy}
                                        onChange={e => { const j = myJutsu.find(x => x.id === e.target.value) ?? null; setSelJutsu(j); setMode(j ? "jutsu" : "idle"); }}
                                        style={{ padding: "0.35rem", borderRadius: 6, background: "#0b1220", color: "#e2e8f0", border: "1px solid #334155" }}>
                                        <option value="">Jutsu…</option>
                                        {myJutsu.map(j => <option key={j.id} value={j.id}>{j.name ?? j.id} ({j.ap ?? 40} AP)</option>)}
                                    </select>
                                )}
                                <ActBtn label="End turn" on={false} onClick={() => void send({ type: "wait" })} disabled={busy} />
                                {reject && <span style={{ color: "#f87171", fontSize: "0.8rem" }}>⚠ {reject}</span>}
                            </div>
                        ) : (
                            <p className="hint" style={{ margin: 0 }}>{session.status === "active" ? "Allies & enemies are acting…" : ""}</p>
                        )}
                    </div>
                </main>

                {/* Enemy + log rail */}
                <aside style={{ minWidth: 0 }}>
                    <h3 style={{ margin: "0 0 8px" }}>👹 Enemies</h3>
                    {enemies.map(a => <ActorCard key={a.id} actor={a} highlight={a.id === activeId} />)}
                    <h4 style={{ margin: "12px 0 4px" }}>Log</h4>
                    <div style={{ maxHeight: 220, overflow: "auto", fontSize: "0.78rem", color: "#cbd5e1", background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: 6 }}>
                        {session.log.slice(-30).map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                </aside>
            </div>

            {/* Result overlay */}
            {session.status === "done" && (
                <div style={{ position: "absolute", inset: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(2,6,14,0.82)" }}>
                    <div className="card" style={{ textAlign: "center", padding: "1.6rem", maxWidth: 420 }}>
                        <h1 style={{ marginTop: 0, color: session.winner === "squad" ? "#4ade80" : "#f87171" }}>
                            {session.winner === "squad" ? "🏆 Floor Cleared!" : "💀 Floor Failed"}
                        </h1>
                        {session.winner === "squad" && (
                            settle ? <p>Rewards settled. {settle.results[me]?.score ? `Score +${settle.results[me]!.score}` : ""}</p> : <p className="hint">Settling rewards…</p>
                        )}
                        <button style={{ marginTop: 12, padding: "0.7rem 1.4rem" }} onClick={onExit}>Return to the Tower</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function ActorCard({ actor, highlight }: { actor: TowerActor; highlight: boolean }) {
    const pct = Math.max(0, Math.min(100, (actor.hp / Math.max(1, actor.maxHp)) * 100));
    const dead = actor.hp <= 0;
    return (
        <div style={{ padding: "6px 8px", marginBottom: 6, borderRadius: 6, background: highlight ? "#15233b" : "rgba(11,18,32,0.7)", border: `1px solid ${highlight ? "#60a5fa" : "#1e293b"}`, opacity: dead ? 0.45 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}>
                <strong>{actor.name}</strong>
                <span style={{ color: "#94a3b8" }}>{Math.max(0, actor.hp)}/{actor.maxHp}</span>
            </div>
            <div style={{ height: 5, background: "#0b1220", borderRadius: 3, marginTop: 3 }}>
                <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: dead ? "#475569" : SIDE_COLOR[actor.side] }} />
            </div>
        </div>
    );
}

function ActBtn({ label, on, onClick, disabled }: { label: string; on: boolean; onClick: () => void; disabled: boolean }) {
    return (
        <button onClick={onClick} disabled={disabled}
            style={{ padding: "0.4rem 0.7rem", borderRadius: 6, fontWeight: 600, cursor: "pointer", border: `1px solid ${on ? "#60a5fa" : "#334155"}`, background: on ? "#15233b" : "#0b1220", color: "#e2e8f0" }}>
            {label}
        </button>
    );
}
