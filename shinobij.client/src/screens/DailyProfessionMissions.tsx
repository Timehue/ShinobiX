import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { visiblePoll } from "../lib/poll";
import { LoadingState } from "../components/ui/LoadingState";
import { readDailyMissionCache, writeDailyMissionCache } from "../lib/daily-mission-cache";
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
    xpReward?: number;   // profession track
    ryoReward?: number;  // new-shinobi track
    completedAt: number | null;
    claimed?: boolean;
};

type Response = {
    profession: Profession | null;
    track?: 'newbie';
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
    const [data, setData] = useState<Response | null>(() => readDailyMissionCache(character.name, character.profession ?? null) as Response | null);
    const [loading, setLoading] = useState(() => !readDailyMissionCache(character.name, character.profession ?? null));
    const [error, setError] = useState<string | null>(null);
    // Track which mission IDs we've already seen as completed so we don't
    // double-toast on subsequent polls.
    const seenCompletedRef = useRef<Set<string>>(new Set());
    // Whether the first poll for this profession/name has completed. Used to
    // decide if a completion is pre-existing (seed silently) vs newly earned
    // (toast). A ref — not `data` — so the long-lived poll closure observes the
    // real seeded state rather than the stale `data === null` captured at
    // effect-creation time.
    const seededRef = useRef(false);

    useEffect(() => {
        // Fetch for everyone — players without a profession get the new-shinobi
        // daily set from the same endpoint (so the early game isn't a dead zone).
        // Reset the "already toasted" set whenever profession or player
        // name changes. Otherwise the set carries stale ids from a
        // previous profession (or a different account on the same device)
        // and new completions silently fail to toast because they're
        // marked as "already seen".
        seenCompletedRef.current = new Set();
        seededRef.current = false;
        let cancelled = false;
        // Show the same player's last server-confirmed daily state immediately
        // (per tab and UTC date), then still refresh from the server below.
        // This removes the blank 3-5s panel on repeat navigation without ever
        // using cached data to grant rewards or authorize an action.
        const cached = readDailyMissionCache(character.name, character.profession ?? null);
        // Hydrate after the effect's synchronous setup so the cache state does
        // not trigger a cascading render from inside the effect body.
        queueMicrotask(() => {
            if (cancelled) return;
            if (cached) {
                setData(cached as Response);
                setLoading(false);
                seededRef.current = true;
                for (const mission of cached.missions as DailyMission[]) {
                    if (mission.completedAt) seenCompletedRef.current.add(mission.id);
                }
            } else {
                setData(null);
                setLoading(true);
            }
            setError(null);
        });
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
                const isFirstPoll = !seededRef.current;
                for (const m of incoming) {
                    if (!m.completedAt) continue;
                    if (seenCompletedRef.current.has(m.id)) continue;
                    seenCompletedRef.current.add(m.id);
                    if (!isFirstPoll && json.profession) {
                        window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                            detail: { name: m.name, xp: m.xpReward ?? 0, profession: json.profession },
                        }));
                    }
                }
                seededRef.current = true;
                setData(json);
                writeDailyMissionCache(character.name, character.profession ?? null, json);
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
        const stop = visiblePoll(() => void fetchMissions(), 30_000);
        return () => { cancelled = true; stop(); };
    }, [character.profession, character.name]);

    const prof = character.profession;
    const isNewbie = !prof;
    const accent = prof ? PROFESSION_ACCENT[prof] : "var(--gold)";
    const label = prof ? PROFESSION_LABEL[prof] : "New Shinobi";
    // Guard against a 200 response that omits `missions` — render off a safe
    // local so a partial payload can't throw `.length`/`.map` during render.
    const missions = data?.missions ?? [];

    return (
        <section className="card profession-daily-card" aria-labelledby="profession-daily-heading" style={{ border: `1px solid ${accent}55`, marginBottom: "1rem", "--profession-accent": accent } as CSSProperties}>
            <h3 id="profession-daily-heading" style={{ marginTop: 0, color: accent }}>
                {isNewbie ? "📜 Daily Missions" : `📜 Daily ${label} Missions`}
            </h3>
            {loading && <LoadingState />}
            {error && <p style={{ color: "var(--red-400)" }}>{error}</p>}
            {!loading && data && missions.length === 0 && (
                <p className="hint" style={{ margin: 0 }}>
                    No daily missions available right now.
                </p>
            )}
            {!loading && data && missions.length > 0 && (
                <div className="profession-mission-list" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {missions.map(m => {
                        const pct = Math.min(100, Math.round((m.progress / m.target) * 100));
                        const done = m.completedAt !== null;
                        return (
                            <article
                                key={m.id}
                                className={`profession-mission-card${done ? " is-complete" : ""}`}
                                style={{
                                    background: done ? `${accent}22` : "rgba(15,18,34,0.55)",
                                    border: `1px solid ${done ? accent : "rgba(148,163,184,0.25)"}`,
                                    borderRadius: 8,
                                    padding: 10,
                                }}
                            >
                                <div className="profession-mission-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                                    <strong style={{ color: done ? accent : "var(--slate-200)" }}>
                                        {done && "✓ "}{m.name}
                                    </strong>
                                    <span className="hint" style={{ fontSize: "0.75rem" }}>
                                        {isNewbie ? `+${m.ryoReward ?? 0} ryo` : `+${m.xpReward ?? 0} ${label} XP`}
                                    </span>
                                </div>
                                <p className="hint" style={{ margin: "4px 0 6px", fontSize: "0.8rem" }}>
                                    {m.description}
                                </p>
                                <div className="profession-mission-progress" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div className="profession-progress-track" role="progressbar" aria-label={`${m.name} progress`} aria-valuemin={0} aria-valuemax={m.target} aria-valuenow={m.progress} style={{ flex: 1, height: 6, background: "rgba(148,163,184,0.2)", borderRadius: 3, overflow: "hidden" }}>
                                        <div style={{ width: `${pct}%`, height: "100%", background: accent, transition: "width 200ms" }} />
                                    </div>
                                    <span className="hint" style={{ fontSize: "0.75rem", minWidth: 50, textAlign: "right" }}>
                                        {m.progress} / {m.target}
                                    </span>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
            <p className="hint" style={{ margin: "8px 0 0", fontSize: "0.72rem", opacity: 0.7 }}>
                Resets daily at midnight UTC. Rewards auto-grant on completion.
            </p>
        </section>
    );
}
