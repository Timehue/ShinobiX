import { useEffect, useState } from "react";
import {
    type Character,
    type PlayerRecord,
    type Screen,
    discountCost,
    getHospitalDiscountPercent,
} from "../App";

export
function Hospital({ character, updateCharacter, setScreen, playerRoster, hospitalEntryTime }: { character: Character; updateCharacter: (character: Character) => void; setScreen: (s: Screen) => void; playerRoster: PlayerRecord[]; hospitalEntryTime: number | null }) {
    const hospitalDiscount = getHospitalDiscountPercent(character);
    const dischargeCost = discountCost(1000, hospitalDiscount);
    const topUpCost = discountCost(50, hospitalDiscount);
    const [elapsed, setElapsed] = useState(0);
    const [healMsg, setHealMsg] = useState<Record<string, string>>({});
    const [healed, setHealed] = useState<Set<string>>(new Set());

    const isHealer = character.profession === "healer";
    const healerRank = isHealer ? (character.professionRank ?? 1) : 0;

    useEffect(() => {
        if (!character.hospitalized || hospitalEntryTime === null) return;
        const id = setInterval(() => setElapsed(Math.floor((Date.now() - hospitalEntryTime) / 1000)), 1000);
        return () => clearInterval(id);
    }, [character.hospitalized, hospitalEntryTime]);

    const freeCheckoutReady = character.hospitalized && elapsed >= 60;
    const remaining = Math.max(0, 60 - elapsed);

    function discharge() {
        if (character.ryo < dischargeCost) return alert(`Not enough ryo. You need ${dischargeCost} ryo to be discharged.`);
        updateCharacter({ ...character, ryo: character.ryo - dischargeCost, hp: character.maxHp, chakra: character.maxChakra, stamina: character.maxStamina, hospitalized: false });
        setScreen("village");
    }

    function freeCheckout() {
        updateCharacter({ ...character, hospitalized: false });
        setScreen("village");
    }

    function topUp() {
        if (character.ryo < topUpCost) return alert("Not enough ryo.");
        updateCharacter({ ...character, ryo: character.ryo - topUpCost, hp: character.maxHp });
    }

    async function healPlayer(targetName: string) {
        setHealMsg(m => ({ ...m, [targetName]: "💚 Healing…" }));
        try {
            const res = await fetch('/api/player/heal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ healerName: character.name, targetName }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setHealMsg(m => ({ ...m, [targetName]: `❌ ${data.error ?? 'Failed'}` }));
                return;
            }
            const xpGained = Number(data.xpGained ?? 0);
            const missionXp = Number(data.missionXpAwarded ?? 0);
            const missionsCompleted: string[] = Array.isArray(data.missionsCompleted) ? data.missionsCompleted : [];
            const prevRank = character.professionRank ?? 1;
            // Server returns the authoritative post-credit XP/rank (mission XP included).
            const finalXp = Number(data.professionXp ?? (character.professionXp ?? 0) + xpGained);
            const finalRank = Number(data.professionRank ?? prevRank);
            updateCharacter({
                ...character,
                professionXp: finalXp,
                professionRank: finalRank,
            });
            const rankedUp = finalRank > prevRank;
            const totalXp = xpGained + missionXp;
            let msg = `✅ Healed! +${totalXp} XP`;
            if (missionsCompleted.length > 0) msg += ` (mission complete!)`;
            if (rankedUp) msg += ` — Rank ${finalRank}!`;
            setHealMsg(m => ({ ...m, [targetName]: msg }));
            // Hide the row locally until next roster refresh confirms.
            setHealed(s => new Set(s).add(targetName));
        } catch {
            setHealMsg(m => ({ ...m, [targetName]: "❌ Network error" }));
        }
    }

    // Ranks 1–9: see hospitalized players in your village.
    // Rank 10 (future): also see all injured villagers across the world.
    const hospitalizedPlayers = playerRoster.filter(p =>
        p.character.hospitalized
        && p.name.toLowerCase() !== character.name.toLowerCase()
        && !healed.has(p.name)
        && (!isHealer || p.character.village === character.village)
    );

    if (character.hospitalized) {
        return (
            <div className="card">
                <h2>🏥 Village Hospital</h2>
                <p className="hint">Town Hall Hospital Discount: <strong>{hospitalDiscount.toFixed(2)}%</strong></p>
                <div className="hospital-admitted-banner">
                    <span className="hospital-admitted-icon">??</span>
                    <div>
                        <strong>You are currently admitted</strong>
                        <p>You were knocked out in battle. Pay the discharge fee or wait for the free check-out.</p>
                    </div>
                </div>
                <div className="summary-box" style={{ marginBottom: "1rem" }}>
                    <span>HP: <strong style={{ color: "#f87171" }}>{character.hp}/{character.maxHp}</strong></span>
                    <span style={{ marginLeft: "1.5rem" }}>Ryo: <strong style={{ color: character.ryo >= dischargeCost ? "#4ade80" : "#f87171" }}>{character.ryo.toLocaleString()}</strong></span>
                </div>
                <button
                    onClick={discharge}
                    disabled={character.ryo < dischargeCost}
                    style={{ background: "linear-gradient(#14532d,#052e16)", borderColor: "#4ade80", opacity: character.ryo < dischargeCost ? 0.5 : 1, width: "100%", marginBottom: "0.5rem" }}
                >
                    ?? Pay {dischargeCost.toLocaleString()} ryo — Full Heal &amp; Discharge
                </button>
                {freeCheckoutReady ? (
                    <button
                        onClick={freeCheckout}
                        style={{ background: "linear-gradient(#1e3a5f,#0c1f3d)", borderColor: "#60a5fa", width: "100%", animation: "pulse 1.5s infinite" }}
                    >
                        ?? Check Out (Free — time served)
                    </button>
                ) : (
                    <p className="hint" style={{ textAlign: "center" }}>
                        Free check-out unlocks in <strong style={{ color: "#fcd34d" }}>{remaining}s</strong>
                    </p>
                )}
                {character.ryo < dischargeCost && !freeCheckoutReady && (
                    <p style={{ color: "#f87171", fontSize: "0.82rem", marginTop: "0.5rem", textAlign: "center" }}>
                        You need {(dischargeCost - character.ryo).toLocaleString()} more ryo, or wait {remaining}s for the free check-out.
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="card">
            <h2>🏥 Village Hospital</h2>
            <p style={{ color: "#94a3b8" }}>Rest, recover, and restore your vitals. Town Hall Hospital Discount: <strong>{hospitalDiscount.toFixed(2)}%</strong></p>
            {isHealer && (
                <div className="summary-box" style={{ background: "linear-gradient(180deg,rgba(34,211,238,0.12),rgba(8,10,22,0.4))", border: "1px solid rgba(34,211,238,0.45)", marginBottom: "1rem" }}>
                    <span style={{ color: "#22d3ee", fontWeight: 600 }}>✚ Healer</span>
                    <span style={{ marginLeft: 12, color: "#cbd5e1" }}>
                        Rank {healerRank} · {character.professionXp ?? 0} XP
                    </span>
                    <p className="hint" style={{ margin: "6px 0 0" }}>
                        You can heal hospitalized allies in <strong>{character.village}</strong>.
                        Each heal grants XP equal to the % of HP restored.
                        {healerRank >= 10 && " At Rank 10 you can also see injured villagers anywhere in the world."}
                    </p>
                </div>
            )}
            <div className="summary-box" style={{ marginBottom: "1rem" }}>
                <span>HP: <strong>{character.hp}/{character.maxHp}</strong></span>
                <span style={{ marginLeft: "1.5rem" }}>Ryo: <strong>{character.ryo.toLocaleString()}</strong></span>
            </div>
            <button onClick={topUp}>💚 Full Heal — {topUpCost} ryo{hospitalDiscount > 0 ? " discounted" : ""}</button>
            {hospitalizedPlayers.length > 0 && (
                <div style={{ marginTop: "1.5rem" }}>
                    <h4 style={{ marginBottom: "0.5rem" }}>🛏️ Admitted Players{isHealer ? ` — ${character.village}` : ""}</h4>
                    {hospitalizedPlayers.map(p => (
                        <div key={p.name} className="summary-box" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                            <div style={{ flex: 1 }}>
                                <strong>{p.name}</strong>
                                <span className="hint" style={{ marginLeft: 6 }}>Lv {p.level} · {p.village}</span>
                                <span style={{ marginLeft: 8, color: "#f87171", fontSize: "0.8rem" }}>
                                    HP {p.character.hp}/{p.character.maxHp}
                                </span>
                            </div>
                            {isHealer ? (
                                <button onClick={() => healPlayer(p.name)} style={{ background: "linear-gradient(#0e7490,#155e75)", borderColor: "#22d3ee" }}>
                                    ✚ Heal
                                </button>
                            ) : (
                                <span className="hint" style={{ color: "#64748b", fontSize: "0.78rem" }}>
                                    Healers only
                                </span>
                            )}
                            {healMsg[p.name] && (
                                <span className="hint" style={{ color: healMsg[p.name].startsWith("✅") ? "#22d3ee" : "#f87171" }}>
                                    {healMsg[p.name]}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
