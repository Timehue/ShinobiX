import { useEffect, useState } from "react";
import type { Character } from "../types/character";
import { fetchTowerFloors, startTowerRun, type TowerFloorMeta, type TowerSession } from "../lib/towers-api";

// ─── Battle Towers Lobby ──────────────────────────────────────────────────────
// Curated 4-player squad tower (lives beside the Endless climb in the Celestial
// Tower). Pick a floor, assemble the squad, and enter the fullscreen fight. v1 is
// solo + AI allies (async); allies are server-snapshotted from saves. onEnter hands
// the started runId + session to the fight shell.
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

    const bestFloor = character.battleTowerBestFloor ?? 0;
    const rating = character.battleTowerRating ?? 0;
    const cleared = new Set(character.battleTowerClearedFloors ?? []);

    useEffect(() => {
        let alive = true;
        fetchTowerFloors()
            .then(f => { if (alive) { setFloors(f); setSelected(f[0]?.id ?? null); } })
            .catch(e => { if (alive) setError(String(e?.message ?? e)); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    async function enterFloor() {
        if (selected == null || starting) return;
        setStarting(true);
        setError(null);
        try {
            const { runId, session } = await startTowerRun(character.name, selected, []);
            onEnter(runId, session);
        } catch (e) {
            setError(String((e as Error)?.message ?? e));
            setStarting(false);
        }
    }

    return (
        <div className="card" style={{ maxWidth: 760, margin: "1rem auto", padding: "1.4rem" }}>
            <h1 style={{ marginTop: 0 }}>⚔️ Battle Towers</h1>
            <p style={{ color: "#94a3b8", marginTop: 0 }}>
                Curated squad floors with objectives, gimmicks, and boss fights. Free to enter, unlimited
                retries — the gate is tactics, not stamina. First-clear rewards are one-time; clear a floor
                to climb the leaderboard.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem", margin: "1rem 0" }}>
                <div className="card" style={{ padding: "0.8rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Deepest floor</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#facc15" }}>{bestFloor}</div>
                </div>
                <div className="card" style={{ padding: "0.8rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Tower rating</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#a78bfa" }}>{rating.toLocaleString()}</div>
                </div>
            </div>

            {loading && <p className="hint">Loading floors…</p>}
            {error && <p style={{ color: "#f87171" }}>{error}</p>}

            {!loading && floors.length > 0 && (
                <div style={{ display: "grid", gap: "0.5rem", margin: "0.5rem 0 1rem" }}>
                    {floors.map(f => {
                        const isCleared = cleared.has(f.id);
                        const isSel = selected === f.id;
                        return (
                            <button
                                key={f.id}
                                onClick={() => setSelected(f.id)}
                                style={{
                                    display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                                    padding: "0.6rem 0.8rem", borderRadius: 8,
                                    border: `1px solid ${isSel ? "#60a5fa" : "#334155"}`,
                                    background: isSel ? "#15233b" : "#0b1220", cursor: "pointer",
                                }}
                            >
                                <span style={{ fontWeight: 700, color: f.isBoss ? "#f87171" : "#e2e8f0", minWidth: 28 }}>F{f.id}</span>
                                <span style={{ flex: 1 }}>
                                    <strong>{f.name}</strong>
                                    <span style={{ color: "#94a3b8", fontSize: "0.82rem" }}>
                                        {" "}· {OBJECTIVE_LABEL[f.objective] ?? f.objective} · {f.biome}
                                        {f.isBoss ? " · 👑 boss" : ""}{f.milestone ? " · ⭐ milestone" : ""}
                                    </span>
                                </span>
                                {isCleared && <span title="First-cleared" style={{ color: "#4ade80" }}>✓</span>}
                            </button>
                        );
                    })}
                </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.6rem", marginTop: "0.6rem" }}>
                <button
                    style={{ padding: "0.8rem 1rem", background: "linear-gradient(#1a3a1a,#0a2010)", borderColor: "#4ade80", fontWeight: 700 }}
                    onClick={enterFloor}
                    disabled={selected == null || starting || loading}
                >
                    {starting ? "Entering…" : selected != null ? `▶ Enter Floor ${selected}` : "Select a floor"}
                </button>
            </div>

            <button className="back-btn" style={{ marginTop: "0.6rem" }} onClick={onBack}>× Back to Central</button>
        </div>
    );
}
