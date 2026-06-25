/*
 * Vanguard profession hub — the screen the right-menu "⚔ Vanguard" button opens
 * once a player has chosen the Vanguard profession. A frontline war-room: it
 * surfaces the Honor Seal economy, the per-rank seals-per-kill table, today's
 * daily-cap progress, and quick links into the PvP / raid / arena loops where
 * Vanguards actually earn.
 *
 * Read-only over existing character fields — no new endpoints. The real reward
 * math (caps, level-gap, anti-alt) stays server-side in api/pvp + missions.
 */
import vanguardBg from "../../assets/professions/vanguard.webp";
import { BackToVillageButton } from "../../components/BackToVillageButton";
import { ProfessionHero } from "../../components/ProfessionHero";
import { MasteryPanel } from "../../components/MasteryPanel";
import { ProfessionRankBar } from "../ProfessionRankBar";
import { DailyProfessionMissions } from "../DailyProfessionMissions";
import {
    VANGUARD_SEALS_PER_KILL,
    VANGUARD_DAILY_SEAL_CAP,
    VANGUARD_PER_TARGET_DAILY_CAP,
    PROFESSION_MAX_RANK,
} from "../../constants/profession";
import type { Character, Screen } from "../../App";

const ACCENT = "#f97316";

export function VanguardHub({
    character,
    updateCharacter,
    setScreen,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    setScreen: (s: Screen) => void;
}) {
    const rank = Math.max(1, Math.min(PROFESSION_MAX_RANK, character.professionRank ?? 1));
    const sealsToday = character.dailyHonorSealsEarned ?? 0;
    const sealsTodayPct = Math.max(0, Math.min(100, Math.round((sealsToday / VANGUARD_DAILY_SEAL_CAP) * 100)));

    return (
        <div className="card">
            <BackToVillageButton onClick={() => setScreen("village")} />
            <ProfessionHero image={vanguardBg} icon="⚔" title="Vanguard" tagline="Lead the charge." accent={ACCENT} />

            <ProfessionRankBar character={character} />

            {/* Honor Seal economy */}
            <div className="summary-box" style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", margin: "1rem 0" }}>
                <span>🪙 Honor Seals: <strong style={{ color: ACCENT }}>{(character.honorSeals ?? 0).toLocaleString()}</strong></span>
                <span style={{ color: "#94a3b8" }}>·</span>
                <span>This kill: <strong style={{ color: ACCENT }}>{VANGUARD_SEALS_PER_KILL[rank]} Seal{VANGUARD_SEALS_PER_KILL[rank] === 1 ? "" : "s"}</strong></span>
            </div>

            <div className="summary-box" style={{ margin: "0 0 1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: 4 }}>
                    <span className="hint">Seals earned today</span>
                    <span className="hint">{sealsToday} / {VANGUARD_DAILY_SEAL_CAP} daily cap</span>
                </div>
                <div style={{ height: 8, background: "rgba(148,163,184,0.2)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${sealsTodayPct}%`, height: "100%", background: ACCENT, transition: "width 300ms" }} />
                </div>
                <p className="hint" style={{ margin: "8px 0 0", fontSize: "0.75rem" }}>
                    Up to {VANGUARD_PER_TARGET_DAILY_CAP} Seals per target per day · only real-player kills count · resets daily.
                </p>
            </div>

            {/* Seals-per-kill by rank */}
            <h4 style={{ margin: "0 0 0.5rem" }}>⚔ Seals per Kill by Rank</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(46px, 1fr))", gap: 4, marginBottom: "1rem" }}>
                {Array.from({ length: PROFESSION_MAX_RANK }, (_, i) => i + 1).map(r => (
                    <div
                        key={r}
                        style={{
                            textAlign: "center",
                            padding: "6px 2px",
                            borderRadius: 6,
                            border: r === rank ? `1px solid ${ACCENT}` : "1px solid rgba(148,163,184,0.2)",
                            background: r === rank ? `${ACCENT}22` : "rgba(15,18,34,0.5)",
                        }}
                    >
                        <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>R{r}</div>
                        <div style={{ fontWeight: 700, color: r === rank ? ACCENT : "#e2e8f0" }}>{VANGUARD_SEALS_PER_KILL[r]}</div>
                    </div>
                ))}
            </div>

            {/* Where to earn */}
            <h4 style={{ margin: "0 0 0.5rem" }}>Take the Field</h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "1.5rem" }}>
                <button onClick={() => setScreen("userHub")} style={{ background: `linear-gradient(${ACCENT}cc,${ACCENT}88)`, borderColor: ACCENT, color: "#1a0a02" }}>
                    🎯 Find a Target
                </button>
                <button onClick={() => setScreen("villageWar")} style={{ borderColor: ACCENT }}>
                    🔥 Raid a Village
                </button>
                <button onClick={() => setScreen("arenaDistrict")} style={{ borderColor: ACCENT }}>
                    🏟️ Arena District
                </button>
            </div>

            <DailyProfessionMissions character={character} />
            <MasteryPanel character={character} updateCharacter={updateCharacter} />
        </div>
    );
}
