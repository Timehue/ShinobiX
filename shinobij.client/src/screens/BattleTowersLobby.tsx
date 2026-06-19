import { useEffect, useState } from "react";
import type { Character } from "../types/character";
import { fetchTowerFloors, startTowerRun, type TowerFloorMeta, type TowerSession } from "../lib/towers-api";
import spireBanner from "../assets/towers/spire.webp";

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

            {/* Stat chips */}
            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <Stat label="Deepest floor" value={String(bestFloor)} color="#facc15" />
                <Stat label="Tower rating" value={rating.toLocaleString()} color="#a78bfa" />
                <Stat label="Floors cleared" value={`${cleared.size}/${floors.length || "—"}`} color="#4ade80" />
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
                    {starting ? "Entering…" : selFloor ? `▶ Enter Floor ${selFloor.id} — ${selFloor.name}` : "Select a floor"}
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
