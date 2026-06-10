import type { Character } from "../types/character";
import { endlessWaveReward } from "../lib/endless-tower";

// ─── Endless Tower Lobby ──────────────────────────────────────────────────────
// Shows run state (current wave, banked rewards, best wave) and lets the player
// start a fresh run, resume the existing one, or retreat to bank rewards.
export function EndlessTowerLobby({
    character,
    onEnter,
    onBank,
    onBack,
}: {
    character: Character;
    onEnter: () => void;
    onBank: () => void;
    onBack: () => void;
}) {
    const run = character.endlessTowerRun;
    const inProgress = !!run && run.wave > 1;
    const nextWave = run?.wave ?? 1;
    const preview = endlessWaveReward(nextWave, character.level ?? 1);
    return (
        <div className="card" style={{ maxWidth: 720, margin: "1rem auto", padding: "1.4rem" }}>
            <h1 style={{ marginTop: 0 }}>🗼 Endless Tower</h1>
            <p style={{ color: "#94a3b8", marginTop: 0 }}>
                Each wave is harder than the last. Every 5th floor is a milestone (×2 rewards); every 10th is a boss floor (×3).
                Banked rewards are lost if you die — retreat to bank what you've earned.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem", margin: "1rem 0" }}>
                <div className="card" style={{ padding: "0.8rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Best floor</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#facc15" }}>{character.endlessTowerBestWave ?? 0}</div>
                </div>
                <div className="card" style={{ padding: "0.8rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Lifetime clears</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#4ade80" }}>{character.totalEndlessTowerWins ?? 0}</div>
                </div>
            </div>
            {inProgress && run ? (
                <div className="card" style={{ padding: "0.9rem", background: "linear-gradient(#1a1a2e,#0a0a1a)", border: "1px solid #4ade80" }}>
                    <div style={{ color: "#4ade80", fontWeight: 700, marginBottom: "0.3rem" }}>Run in progress</div>
                    <div style={{ fontSize: "0.95rem" }}>Floor: <strong>{run.wave}</strong></div>
                    <div style={{ fontSize: "0.95rem" }}>Banked ryo: <strong style={{ color: "#facc15" }}>{run.bankedRyo.toLocaleString()}</strong></div>
                    <div style={{ fontSize: "0.95rem" }}>Banked xp: <strong style={{ color: "#a78bfa" }}>{run.bankedXp.toLocaleString()}</strong></div>
                </div>
            ) : (
                <div style={{ color: "#94a3b8", fontStyle: "italic", padding: "0.6rem 0" }}>No active run.</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: inProgress ? "1fr 1fr" : "1fr", gap: "0.6rem", marginTop: "1rem" }}>
                <button
                    style={{ padding: "0.8rem 1rem", background: "linear-gradient(#1a3a1a,#0a2010)", borderColor: "#4ade80", fontWeight: 700 }}
                    onClick={onEnter}
                >
                    {inProgress ? `▶ Resume — Floor ${nextWave}` : "▶ Enter Tower (Floor 1)"}
                </button>
                {inProgress && (
                    <button
                        style={{ padding: "0.8rem 1rem", background: "linear-gradient(#3a3a1a,#201a0a)", borderColor: "#facc15", fontWeight: 700 }}
                        onClick={onBank}
                    >
                        💰 Retreat &amp; Bank
                    </button>
                )}
            </div>
            <p style={{ color: "#64748b", fontSize: "0.8rem", marginTop: "0.8rem" }}>
                Next reward preview: {preview.ryo.toLocaleString()} ryo, {preview.xp.toLocaleString()} xp{preview.isMilestone ? " (milestone!)" : ""}.
            </p>
            <button className="back-btn" style={{ marginTop: "0.6rem" }} onClick={onBack}>× Back to Central</button>
        </div>
    );
}
