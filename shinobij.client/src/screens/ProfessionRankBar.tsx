import type { CSSProperties } from "react";
import type { Character, Profession } from "../App";
import { professionThresholds, PROFESSION_MAX_RANK } from "../App";

const LABELS: Record<Profession, string> = {
    healer: "Healer",
    vanguard: "Vanguard",
    petTamer: "Pet Tamer",
};

const ACCENTS: Record<Profession, string> = {
    healer: "#22d3ee",
    vanguard: "#f97316",
    petTamer: "#84cc16",
};

const ICONS: Record<Profession, string> = {
    healer: "✚",
    vanguard: "⚔",
    petTamer: "🐾",
};

export function ProfessionRankBar({
    character,
    compact = false,
}: {
    character: Character;
    compact?: boolean;
}) {
    if (!character.profession) return null;
    const profession = character.profession;
    const rank = Math.max(1, Math.min(PROFESSION_MAX_RANK, character.professionRank ?? 1));
    const xp = character.professionXp ?? 0;
    const thresholds = professionThresholds(profession);

    // Threshold index N is the XP required to *reach the rank after N*.
    // Rank 1 therefore starts at zero and advances at thresholds[1].
    const currentRankXp = thresholds[Math.max(0, rank - 1)] ?? 0;
    const nextRankXp = rank >= PROFESSION_MAX_RANK ? null : (thresholds[rank] ?? null);
    const xpIntoRank = Math.max(0, xp - currentRankXp);
    const xpForNextRank = nextRankXp === null ? 0 : Math.max(1, nextRankXp - currentRankXp);
    const pct = nextRankXp === null
        ? 100
        : Math.max(0, Math.min(100, Math.round((xpIntoRank / xpForNextRank) * 100)));

    const accent = ACCENTS[profession];
    const label = LABELS[profession];
    const icon = ICONS[profession];

    if (compact) {
        return (
            <div className="profession-rank-compact" style={{ display: "flex", alignItems: "center", gap: 8, "--profession-accent": accent } as CSSProperties}>
                <span style={{ color: accent, fontWeight: 600 }}>{icon} {label}</span>
                <span className="hint" style={{ fontSize: "0.78rem" }}>
                    Rank {rank}{nextRankXp !== null && ` · ${xpIntoRank.toLocaleString()} / ${xpForNextRank.toLocaleString()} XP`}
                    {nextRankXp === null && " · MAX"}
                </span>
                <div style={{ flex: 1, height: 6, background: "rgba(148,163,184,0.2)", borderRadius: 3, overflow: "hidden", maxWidth: 200 }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: accent, transition: "width 200ms" }} />
                </div>
            </div>
        );
    }

    return (
        <section className="summary-box profession-rank-card" aria-label={`${label} profession progress`} style={{ background: `linear-gradient(180deg, ${accent}15, rgba(8,10,22,0.4))`, border: `1px solid ${accent}55`, "--profession-accent": accent } as CSSProperties}>
            <div className="profession-rank-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <strong style={{ color: accent, fontSize: "1.05rem" }}>{icon} {label}</strong>
                <span className="hint">
                    Rank <strong style={{ color: accent }}>{rank}</strong>
                    {rank >= PROFESSION_MAX_RANK && <span style={{ marginLeft: 6, color: accent }}>· MAX</span>}
                </span>
            </div>
            <div className="profession-rank-progress" style={{ marginTop: 8 }}>
                <div className="profession-progress-labels" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: 4 }}>
                    <span className="hint">Total XP: {xp.toLocaleString()}</span>
                    {nextRankXp !== null && (
                        <span className="hint">
                            {xpIntoRank.toLocaleString()} / {xpForNextRank.toLocaleString()} to Rank {rank + 1}
                        </span>
                    )}
                </div>
                <div className="profession-progress-track" role="progressbar" aria-label={`${label} rank progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 8, background: "rgba(148,163,184,0.2)", borderRadius: 4, overflow: "hidden" }}>
                    <div className="profession-progress-fill" style={{ width: `${pct}%`, height: "100%", background: accent, transition: "width 300ms" }} />
                </div>
            </div>
        </section>
    );
}
