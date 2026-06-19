import { useEffect, useState } from "react";
import type { Character } from "../types/character";
import { fetchTowerFloors, startTowerRun, fetchMyRun, type TowerFloorMeta, type TowerSession } from "../lib/towers-api";
import { subscribeFollowing } from "../lib/friends";
import spireBanner from "../assets/towers/spire.webp";

const MAX_ALLIES = 3; // you + up to 3 = a 4-player squad

// ─── Battle Towers Lobby ──────────────────────────────────────────────────────
// Curated squad tower (lives beside the Endless climb in the Celestial Tower).
// Pick a floor and enter the fullscreen fight. onEnter hands the started runId +
// session to the fight shell.
const OBJECTIVE_LABEL: Record<string, string> = {
    "defeat-all": "Defeat all",
    "defeat-boss": "Defeat the boss",
    "defeat-all-then-boss": "Clear, then the boss",
    "protect-npc": "Protect the ally",
    "kill-escort": "Escort",
    "reach-tile": "Reach the goal",
    "break-objective": "Break the objective",
    "survive": "Survive",
    "kill-adds-first": "Kill the adds first",
};
const BIOME: Record<string, { color: string; icon: string }> = {
    forest: { color: "#4ade80", icon: "🌲" },
    snow: { color: "#93c5fd", icon: "❄️" },
    volcano: { color: "#fb7185", icon: "🌋" },
    central: { color: "#cbd5e1", icon: "🏛️" },
    shadow: { color: "#a78bfa", icon: "🌑" },
};

export function BattleTowersLobby({
    character,
    onEnter,
    onBack,
}: {
    character: Character;
    onEnter: (runId: string, session: TowerSession) => void;
    onBack: () => void;
}) {
    const [floors, setFloors] = useState<TowerFloorMeta[]>([]);
    const [selected, setSelected] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [allies, setAllies] = useState<string[]>([]);
    const [following, setFollowing] = useState<string[]>([]);
    const [pendingRun, setPendingRun] = useState<{ runId: string; session: TowerSession } | null>(null);

    const bestFloor = character.battleTowerBestFloor ?? 0;
    const rating = character.battleTowerRating ?? 0;
    const cleared = new Set(character.battleTowerClearedFloors ?? []);
    const me = character.name;
    const availableAllies = following.filter(f =>
        f.toLowerCase() !== me.toLowerCase() && !allies.some(a => a.toLowerCase() === f.toLowerCase()));

    useEffect(() => {
        let alive = true;
        fetchTowerFloors()
            .then(f => { if (alive) { setFloors(f); setSelected(f[0]?.id ?? null); } })
            .catch(e => { if (alive) setError(String(e?.message ?? e)); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    // Recruitable allies = the players you follow.
    useEffect(() => subscribeFollowing(me, setFollowing), [me]);

    // Co-op: poll for an active run a host invited us into, so we can JOIN it. Re-checks
    // every few seconds so the banner appears shortly after a friend starts the run.
    useEffect(() => {
        let alive = true;
        const check = () => fetchMyRun(me).then(r => { if (alive) setPendingRun(r); }).catch(() => {});
        check();
        const id = setInterval(check, 4000);
        return () => { alive = false; clearInterval(id); };
    }, [me]);

    async function enterFloor() {
        if (selected == null || starting) return;
        setStarting(true);
        setError(null);
        try {
            const { runId, session } = await startTowerRun(me, selected, allies);
            onEnter(runId, session);
        } catch (e) {
            setError(String((e as Error)?.message ?? e));
            setStarting(false);
        }
    }

    const selFloor = floors.find(f => f.id === selected);

    return (
        <div style={{ maxWidth: 880, margin: "1rem auto", padding: "0 0.8rem 1.5rem", color: "#e2e8f0" }}>
            {/* Hero banner */}
            <div style={{
                position: "relative", borderRadius: 14, overflow: "hidden", marginBottom: 14,
                border: "1px solid #334155", boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                background: `linear-gradient(180deg, rgba(8,12,24,0.25) 0%, rgba(8,12,24,0.92) 100%), url(${spireBanner}) center 30%/cover no-repeat`,
                minHeight: 168, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "1.1rem 1.3rem",
            }}>
                <h1 style={{ margin: 0, fontSize: "2.1rem", letterSpacing: 0.5, textShadow: "0 3px 12px rgba(0,0,0,0.9)" }}>⚔️ Battle Towers</h1>
                <p style={{ margin: "4px 0 0", color: "#cbd5e1", maxWidth: 620, fontSize: "0.9rem", textShadow: "0 2px 6px rgba(0,0,0,0.9)" }}>
                    Curated squad floors — objectives, battlefield gimmicks, and bosses with signature mechanics.
                    Free to enter, unlimited retries; the gate is tactics, not stamina.
                </p>
            </div>

            {/* Co-op join banner — appears when a host has invited you into their run */}
            {pendingRun && (
                <button onClick={() => onEnter(pendingRun.runId, pendingRun.session)}
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%",
                        padding: "0.85rem", marginBottom: 14, borderRadius: 12, fontWeight: 800, fontSize: "0.98rem",
                        cursor: "pointer", color: "#dbeafe", background: "linear-gradient(180deg,#1e3a8a,#172554)",
                        border: "1px solid #60a5fa", boxShadow: "0 0 18px rgba(96,165,250,0.45)",
                    }}>
                    ⚔️ You've been called to a squad run — Floor {pendingRun.session.floor} · Join now ▶
                </button>
            )}

            {/* Stat chips */}
            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <Stat label="Deepest floor" value={String(bestFloor)} color="#facc15" />
                <Stat label="Tower rating" value={rating.toLocaleString()} color="#a78bfa" />
                <Stat label="Floors cleared" value={`${cleared.size}/${floors.length || "—"}`} color="#4ade80" />
            </div>

            {/* Squad assembly */}
            <div style={{ padding: "0.8rem 0.9rem", borderRadius: 12, border: "1px solid #293548", background: "linear-gradient(180deg,#0e1626,#0a111f)", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "0.98rem" }}>🛡 Your Squad <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: "0.8rem" }}>· you + up to {MAX_ALLIES} allies</span></strong>
                    <span style={{ color: "#64748b", fontSize: "0.76rem" }}>Allies join as AI-controlled snapshots of their characters</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <SquadChip name={me} you />
                    {allies.map(a => <SquadChip key={a} name={a} onRemove={() => setAllies(allies.filter(x => x !== a))} />)}
                    {allies.length < MAX_ALLIES && (
                        availableAllies.length > 0
                            ? (
                                <select value="" onChange={e => { if (e.target.value) setAllies([...allies, e.target.value]); }}
                                    style={{ padding: "0.45rem 0.6rem", borderRadius: 20, background: "#0b1220", color: "#cbd5e1", border: "1px dashed #475569", cursor: "pointer", fontSize: "0.82rem" }}>
                                    <option value="">+ Add ally…</option>
                                    {availableAllies.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                            )
                            : allies.length === 0 && <span style={{ color: "#64748b", fontSize: "0.8rem" }}>Follow players from their profile to recruit them as allies.</span>
                    )}
                </div>
            </div>

            {loading && <p className="hint">Loading floors…</p>}
            {error && <p style={{ color: "#f87171" }}>{error}</p>}

            {!loading && floors.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginBottom: 16 }}>
                    {floors.map(f => {
                        const isCleared = cleared.has(f.id);
                        const isSel = selected === f.id;
                        const b = BIOME[f.biome] ?? { color: "#94a3b8", icon: "🗺️" };
                        return (
                            <button
                                key={f.id}
                                onClick={() => setSelected(f.id)}
                                style={{
                                    position: "relative", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                                    padding: "0.7rem 0.8rem 0.7rem 0.9rem", borderRadius: 10, overflow: "hidden",
                                    border: `1px solid ${isSel ? "#60a5fa" : "#293548"}`,
                                    background: isSel ? "linear-gradient(180deg,#16263f,#0d1830)" : "linear-gradient(180deg,#0e1626,#0a111f)",
                                    boxShadow: isSel ? "0 0 0 1px #60a5fa, 0 6px 18px rgba(37,99,235,0.25)" : "0 2px 8px rgba(0,0,0,0.4)",
                                    cursor: "pointer", color: "#e2e8f0",
                                }}
                            >
                                {/* biome color stripe */}
                                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: b.color }} />
                                <span style={{ fontSize: 22, width: 34, textAlign: "center", flexShrink: 0 }}>{f.isBoss ? "👑" : b.icon}</span>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <strong style={{ color: b.color, fontSize: "0.78rem", letterSpacing: 0.5 }}>F{f.id}</strong>
                                        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</strong>
                                        {f.milestone && <span title="Milestone" style={{ fontSize: 13 }}>⭐</span>}
                                    </span>
                                    <span style={{ display: "block", color: "#94a3b8", fontSize: "0.78rem", marginTop: 2 }}>
                                        {OBJECTIVE_LABEL[f.objective] ?? f.objective} · {f.biome}{f.isBoss ? " · boss" : ""}
                                    </span>
                                </span>
                                {isCleared && <span title="First-cleared" style={{ color: "#4ade80", fontWeight: 800, flexShrink: 0 }}>✓</span>}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Enter / back */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button
                    style={{
                        flex: "1 1 240px", padding: "0.85rem 1rem", borderRadius: 10, fontWeight: 800, fontSize: "1rem",
                        cursor: selected != null ? "pointer" : "not-allowed", color: "#dcfce7",
                        background: "linear-gradient(180deg,#16803a,#0c5226)", border: "1px solid #4ade80",
                        boxShadow: "0 4px 16px rgba(34,197,94,0.3)", opacity: selected == null || loading ? 0.5 : 1,
                    }}
                    onClick={enterFloor}
                    disabled={selected == null || starting || loading}
                >
                    {starting ? "Entering…" : selFloor ? `▶ Enter Floor ${selFloor.id} — ${selFloor.name}${allies.length ? ` · ${allies.length + 1}-player squad` : ""}` : "Select a floor"}
                </button>
                <button className="back-btn" onClick={onBack}>× Back to Central</button>
            </div>
        </div>
    );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div style={{ flex: "1 1 140px", padding: "0.7rem 0.9rem", borderRadius: 10, background: "linear-gradient(180deg,#0e1626,#0a111f)", border: "1px solid #293548" }}>
            <div style={{ color: "#94a3b8", fontSize: "0.78rem" }}>{label}</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color }}>{value}</div>
        </div>
    );
}

function SquadChip({ name, you, onRemove }: { name: string; you?: boolean; onRemove?: () => void }) {
    return (
        <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "0.35rem 0.7rem", borderRadius: 20, fontSize: "0.84rem",
            background: you ? "linear-gradient(180deg,#15301f,#0d2014)" : "linear-gradient(180deg,#142036,#0d1830)",
            border: `1px solid ${you ? "#4ade80" : "#3b5278"}`, color: "#e2e8f0",
        }}>
            <span style={{ fontSize: 14 }}>{you ? "🥷" : "🤝"}</span>
            <strong style={{ fontWeight: 700, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</strong>
            {you
                ? <span style={{ color: "#86efac", fontSize: "0.72rem" }}>you</span>
                : onRemove && <button onClick={onRemove} title="Remove" style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>}
        </span>
    );
}
