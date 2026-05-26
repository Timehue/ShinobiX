import { useEffect, useRef, useState } from "react";
import type { Character, Profession } from "../App";

type DailyMission = {
    id: string;
    templateId: string;
    kind: string;
    name: string;
    description: string;
    target: number;
    progress: number;
    uniqueTargets?: string[];
    xpReward: number;
    completedAt: number | null;
    claimed: boolean;
};

type Response = {
    profession: Profession | null;
    date?: string;
    missions: DailyMission[];
};

const PROFESSION_LABEL: Record<Profession, string> = {
    healer: "Healer",
    vanguard: "Vanguard",
    petTamer: "Pet Tamer",
};

const PROFESSION_ACCENT: Record<Profession, string> = {
    healer: "#22d3ee",
    vanguard: "#f97316",
    petTamer: "#84cc16",
};

export function DailyProfessionMissions({ character }: { character: Character }) {
    const [data, setData] = useState<Response | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Track which mission IDs we've already seen as completed so we don't
    // double-toast on subsequent polls.
    const seenCompletedRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!character.profession) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        async function fetchMissions() {
            try {
                const res = await fetch(`/api/missions/daily?playerName=${encodeURIComponent(character.name)}`);
                const json: Response = await res.json().catch(() => ({} as Response));
                if (cancelled) return;
                if (!res.ok) {
                    setError((json as { error?: string }).error ?? `Failed to load missions (${res.status})`);
                    setLoading(false);
                    return;
                }
                // Detect newly-completed missions vs prior view and toast.
                // First poll seeds the ref so existing completions don't fire.
                const incoming = json.missions ?? [];
                const isFirstPoll = seenCompletedRef.current.size === 0 && !data;
                for (const m of incoming) {
                    if (!m.completedAt) continue;
                    if (seenCompletedRef.current.has(m.id)) continue;
                    seenCompletedRef.current.add(m.id);
                    if (!isFirstPoll) {
                        window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                            detail: { name: m.name, xp: m.xpReward, profession: json.profession ?? undefined },
                        }));
                    }
                }
                setData(json);
                setLoading(false);
            } catch {
                if (!cancelled) {
                    setError("Network error");
                    setLoading(false);
                }
            }
        }
        void fetchMissions();
        // Re-poll every 30s so progress from server-side hooks (heal, kill)
        // shows up without requiring a full screen refresh.
        const id = setInterval(() => void fetchMissions(), 30_000);
        return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character.profession, character.name]);

    if (!character.profession) return null;
    const accent = PROFESSION_ACCENT[character.profession];
    const label = PROFESSION_LABEL[character.profession];

    return (
        <div className="card" style={{ border: `1px solid ${accent}55`, marginBottom: "1rem" }}>
            <h3 style={{ marginTop: 0, color: accent }}>
                📜 Daily {label} Missions
            </h3>
            {loading && <p className="hint">Loading…</p>}
            {error && <p style={{ color: "#f87171" }}>{error}</p>}
            {!loading && !error && data && data.missions.length === 0 && (
                <p className="hint" style={{ margin: 0 }}>
                    No daily missions available right now.
                </p>
            )}
            {!loading && !error && data && data.missions.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {data.missions.map(m => {
                        const pct = Math.min(100, Math.round((m.progress / m.target) * 100));
                        const done = m.completedAt !== null;
                        return (
                            <div
                                key={m.id}
                                style={{
                                    background: done ? `${accent}22` : "rgba(15,18,34,0.55)",
                                    border: `1px solid ${done ? accent : "rgba(148,163,184,0.25)"}`,
                                    borderRadius: 8,
                                    padding: 10,
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                                    <strong style={{ color: done ? accent : "#e2e8f0" }}>
                                        {done && "✓ "}{m.name}
                                    </strong>
                                    <span className="hint" style={{ fontSize: "0.75rem" }}>
                                        +{m.xpReward} {label} XP
                                    </span>
                                </div>
                                <p className="hint" style={{ margin: "4px 0 6px", fontSize: "0.8rem" }}>
                                    {m.description}
                                </p>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ flex: 1, height: 6, background: "rgba(148,163,184,0.2)", borderRadius: 3, overflow: "hidden" }}>
                                        <div style={{ width: `${pct}%`, height: "100%", background: accent, transition: "width 200ms" }} />
                                    </div>
                                    <span className="hint" style={{ fontSize: "0.75rem", minWidth: 50, textAlign: "right" }}>
                                        {m.progress} / {m.target}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            <p className="hint" style={{ margin: "8px 0 0", fontSize: "0.72rem", opacity: 0.7 }}>
                Resets daily at midnight UTC. Rewards auto-grant on completion.
            </p>
        </div>
    );
}
