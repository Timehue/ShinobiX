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
            setHealMsg(m => ({ ...m, [targetName]: res.ok ? "✅ Healed!" : "❌ Failed" }));
        } catch {
            setHealMsg(m => ({ ...m, [targetName]: "❌ Network error" }));
        }
    }

    const hospitalizedPlayers = playerRoster.filter(p => p.character.hospitalized && p.name.toLowerCase() !== character.name.toLowerCase());

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
            <div className="summary-box" style={{ marginBottom: "1rem" }}>
                <span>HP: <strong>{character.hp}/{character.maxHp}</strong></span>
                <span style={{ marginLeft: "1.5rem" }}>Ryo: <strong>{character.ryo.toLocaleString()}</strong></span>
            </div>
            <button onClick={topUp}>💚 Full Heal — {topUpCost} ryo{hospitalDiscount > 0 ? " discounted" : ""}</button>
            {hospitalizedPlayers.length > 0 && (
                <div style={{ marginTop: "1.5rem" }}>
                    <h4 style={{ marginBottom: "0.5rem" }}>🛏️ Admitted Players</h4>
                    {hospitalizedPlayers.map(p => (
                        <div key={p.name} className="summary-box" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                            <div style={{ flex: 1 }}>
                                <strong>{p.name}</strong>
                                <span className="hint" style={{ marginLeft: 6 }}>Lv {p.level} · {p.village}</span>
                                <span style={{ marginLeft: 8, color: "#f87171", fontSize: "0.8rem" }}>
                                    HP {p.character.hp}/{p.character.maxHp}
                                </span>
                            </div>
                            <button onClick={() => healPlayer(p.name)} style={{ background: "linear-gradient(#14532d,#052e16)", borderColor: "#4ade80" }}>
                                💚 Heal
                            </button>
                            {healMsg[p.name] && <span className="hint" style={{ color: healMsg[p.name].startsWith("✅") ? "#4ade80" : "#f87171" }}>{healMsg[p.name]}</span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
