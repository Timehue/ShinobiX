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
    const isHealer = character.profession === "healer";
    const healerRank = isHealer ? (character.professionRank ?? 1) : 0;
    const hospitalDiscount = getHospitalDiscountPercent(character);
    // Healers heal themselves for free — both the topUp HP refill and the
    // discharge action cost 0 ryo. Non-Healers pay a bumped 2,500 ryo to
    // discharge (or wait the 60-second free checkout) and can't topUp at all.
    const dischargeCost = isHealer ? 0 : discountCost(2500, hospitalDiscount);
    const topUpCost = isHealer ? 0 : discountCost(50, hospitalDiscount);
    const [elapsed, setElapsed] = useState(0);
    const [healMsg, setHealMsg] = useState<Record<string, string>>({});
    const [healed, setHealed] = useState<Set<string>>(new Set());
    const hasWorldwideVision = isHealer && healerRank >= 10;
    const [worldwideInjured, setWorldwideInjured] = useState<Array<{ name: string; level: number; hp: number; maxHp: number; hospitalized: boolean }>>([]);

    useEffect(() => {
        if (!hasWorldwideVision) {
            setWorldwideInjured([]);
            return;
        }
        let cancelled = false;
        async function fetchInjured() {
            try {
                const res = await fetch(`/api/player/injured-villagers?healerName=${encodeURIComponent(character.name)}`);
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (Array.isArray(data.injured)) setWorldwideInjured(data.injured);
            } catch { /* ignore */ }
        }
        void fetchInjured();
        const id = setInterval(fetchInjured, 20_000);
        return () => { cancelled = true; clearInterval(id); };
    }, [hasWorldwideVision, character.name]);

    useEffect(() => {
        if (!character.hospitalized || hospitalEntryTime === null) return;
        const id = setInterval(() => setElapsed(Math.floor((Date.now() - hospitalEntryTime) / 1000)), 1000);
        return () => clearInterval(id);
    }, [character.hospitalized, hospitalEntryTime]);

    const freeCheckoutReady = character.hospitalized && elapsed >= 60;
    const remaining = Math.max(0, 60 - elapsed);

    // Pay-skip discharge. Previously this was a client-only mutation that
    // deducted ryo + flipped hospitalized=false locally, but the save
    // validator reverts early discharge — so players paid ryo for nothing.
    // Now we POST to /api/player/heal with paySkip=true; the server charges
    // ryo AND performs the discharge in one atomic write, then we mirror
    // the post-charge state locally.
    async function discharge() {
        if (character.ryo < dischargeCost) return alert(`Not enough ryo. You need ${dischargeCost} ryo to be discharged.`);
        try {
            const res = await fetch('/api/player/heal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: character.name, paySkip: !isHealer }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.error ?? 'Failed to discharge.');
                return;
            }
            const chargedRyo = Number(data.chargedRyo ?? (isHealer ? 0 : dischargeCost));
            updateCharacter({
                ...character,
                ryo: Math.max(0, character.ryo - chargedRyo),
                hp: character.maxHp,
                chakra: character.maxChakra,
                stamina: character.maxStamina,
                hospitalized: false,
            });
            setScreen("village");
        } catch {
            alert('Network error — discharge failed.');
        }
    }

    // Free check-out after timer expires. Server still owns the discharge
    // decision (validator will reject if timer hasn't actually expired), so
    // we route through the same endpoint with paySkip=false.
    async function freeCheckout() {
        try {
            const res = await fetch('/api/player/heal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: character.name, paySkip: false }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.error ?? 'Failed to check out.');
                return;
            }
            updateCharacter({
                ...character,
                hp: character.maxHp,
                chakra: character.maxChakra,
                stamina: character.maxStamina,
                hospitalized: false,
            });
            setScreen("village");
        } catch {
            alert('Network error — check-out failed.');
        }
    }

    function topUp() {
        if (!isHealer) return alert("Only Healers can heal at the hospital. Non-Healers must wait the 60-second admission timer or pay the discharge fee.");
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
            const raidAssist = !!data.raidAssist;
            const missionsCompleted: Array<{ id: string; name: string; xpReward: number }> = Array.isArray(data.missionsCompleted) ? data.missionsCompleted : [];
            for (const m of missionsCompleted) {
                window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                    detail: { name: m.name, xp: m.xpReward, profession: 'healer' },
                }));
            }
            // Raid assist toast — distinct from regular heal so the player
            // notices the +50% bonus when it triggers.
            if (raidAssist && xpGained > 0) {
                window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                    detail: { name: '⚔ Raid Assist!', xp: xpGained, profession: 'healer' },
                }));
            }
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
            if (raidAssist) msg += ` ⚔ Raid Assist +50%`;
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
                    <span className="hospital-admitted-icon">🩹</span>
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
                    {isHealer
                        ? "✚ Free Self-Heal & Discharge (Healer)"
                        : `💰 Pay ${dischargeCost.toLocaleString()} ryo — Full Heal & Discharge`}
                </button>
                {freeCheckoutReady ? (
                    <button
                        onClick={freeCheckout}
                        style={{ background: "linear-gradient(#1e3a5f,#0c1f3d)", borderColor: "#60a5fa", width: "100%", animation: "pulse 1.5s infinite" }}
                    >
                        🚪 Check Out (Free — time served)
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
            {isHealer ? (
                <button onClick={topUp}>✚ Full Heal — Free (Healer)</button>
            ) : (
                <p className="hint" style={{ margin: "0.4rem 0", color: "#94a3b8" }}>
                    🚫 Only Healers can heal at the hospital. If admitted, wait the 60-second timer or pay the discharge fee.
                </p>
            )}
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
            {hasWorldwideVision && (
                <div style={{ marginTop: "1.5rem" }}>
                    <h4 style={{ marginBottom: "0.5rem", color: "#22d3ee" }}>
                        🌍 Injured Villagers — World-Wide (Rank 10)
                    </h4>
                    <p className="hint" style={{ marginTop: 0 }}>
                        Same-village shinobi anywhere in the world with HP below max. Sorted lowest HP first.
                    </p>
                    {worldwideInjured.filter(p => !healed.has(p.name)).length === 0 ? (
                        <p className="hint">All villagers are at full health.</p>
                    ) : (
                        worldwideInjured.filter(p => !healed.has(p.name)).map(p => {
                            const hpPct = Math.max(0, Math.min(100, Math.round((p.hp / p.maxHp) * 100)));
                            return (
                                <div key={p.name} className="summary-box" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                                    <div style={{ flex: 1 }}>
                                        <strong>{p.name}</strong>
                                        <span className="hint" style={{ marginLeft: 6 }}>Lv {p.level}</span>
                                        {p.hospitalized && <span style={{ marginLeft: 8, color: "#facc15", fontSize: "0.75rem" }}>🛏️ Admitted</span>}
                                        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                                            <div style={{ flex: 1, maxWidth: 200, height: 6, background: "rgba(148,163,184,0.2)", borderRadius: 3, overflow: "hidden" }}>
                                                <div style={{ width: `${hpPct}%`, height: "100%", background: hpPct < 30 ? "#f87171" : hpPct < 60 ? "#facc15" : "#84cc16" }} />
                                            </div>
                                            <span style={{ color: hpPct < 30 ? "#f87171" : "#94a3b8", fontSize: "0.78rem" }}>
                                                {p.hp}/{p.maxHp}
                                            </span>
                                        </div>
                                    </div>
                                    <button onClick={() => healPlayer(p.name)} style={{ background: "linear-gradient(#0e7490,#155e75)", borderColor: "#22d3ee" }}>
                                        ✚ Heal
                                    </button>
                                    {healMsg[p.name] && (
                                        <span className="hint" style={{ color: healMsg[p.name].startsWith("✅") ? "#22d3ee" : "#f87171" }}>
                                            {healMsg[p.name]}
                                        </span>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}
