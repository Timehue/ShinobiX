import { useEffect, useState } from "react";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { HealerInjuredList } from "../components/HealerInjuredList";
import {
    type Character,
    type PlayerRecord,
    type Screen,
    discountCost,
    getHospitalDiscountPercent,
} from "../App";

export
function Hospital({ character, updateCharacter, setScreen, playerRoster }: { character: Character; updateCharacter: (character: Character) => void; setScreen: (s: Screen) => void; playerRoster: PlayerRecord[] }) {
    const isHealer = character.profession === "healer";
    const healerRank = isHealer ? (character.professionRank ?? 1) : 0;
    const hospitalDiscount = getHospitalDiscountPercent(character);
    // Healers heal themselves for free — both the topUp HP refill and the
    // discharge action cost 0 ryo. Non-Healers pay a bumped 2,500 ryo to
    // discharge (or wait the 60-second free checkout) and can't topUp at all.
    const dischargeCost = isHealer ? 0 : discountCost(2500, hospitalDiscount);
    const topUpCost = isHealer ? 0 : discountCost(50, hospitalDiscount);
    // Free-checkout timer is driven by the SERVER-stamped hospitalizedUntil
    // (persisted in the save), so it survives a page refresh — the old client-
    // only entry-time was lost on reload and the free-checkout button never
    // reappeared, trapping admitted players in a refresh loop. When the stamp
    // hasn't reached the client yet (a fresh in-session KO, before the save
    // round-trips), we fall back to a DISPLAY-ONLY 60s count from when the
    // screen opened. This fallback never writes to the server, so it can't
    // accidentally re-hospitalize a player the server already discharged; the
    // discharge endpoint remains the sole authority on whether the timer is up.
    const serverUntil = Number(character.hospitalizedUntil ?? 0);
    const [mountTime] = useState(() => Date.now());
    const effectiveUntil = serverUntil > 0 ? serverUntil : mountTime + 60_000;
    const [now, setNow] = useState(() => Date.now());
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!character.hospitalized) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [character.hospitalized]);

    const freeCheckoutReady = character.hospitalized && now >= effectiveUntil;
    const remaining = Math.max(0, Math.ceil((effectiveUntil - now) / 1000));

    // Pay-skip discharge. Previously this was a client-only mutation that
    // deducted ryo + flipped hospitalized=false locally, but the save
    // validator reverts early discharge — so players paid ryo for nothing.
    // Now we POST to /api/player/heal with paySkip=true; the server charges
    // ryo AND performs the discharge in one atomic write, then we mirror
    // the post-charge state locally.
    // Mirror a successful (or already-applied) discharge into local state and
    // leave for the village. Clears the hospital stamps too so a later re-open
    // can't read a stale timer.
    function applyDischargeAndLeave(chargedRyo: number) {
        updateCharacter({
            ...character,
            ryo: Math.max(0, character.ryo - chargedRyo),
            hp: character.maxHp,
            chakra: character.maxChakra,
            stamina: character.maxStamina,
            hospitalized: false,
            hospitalizedUntil: 0,
            hospitalizedAt: 0,
        });
        setScreen("village");
    }

    async function discharge() {
        if (busy) return;
        if (character.ryo < dischargeCost) return alert(`Not enough ryo. You need ${dischargeCost} ryo to be discharged.`);
        setBusy(true);
        try {
            const res = await fetch('/api/player/heal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: character.name, paySkip: !isHealer }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                // The server already shows us as discharged (local state was stale
                // — the classic "client says admitted, server says free" deadlock
                // that previously forced a refresh). Treat it as success and leave.
                if (res.status === 400 && /not hospitalized/i.test(String(data.error ?? ''))) {
                    applyDischargeAndLeave(0);
                    return;
                }
                alert(data.error ?? 'Failed to discharge.');
                return;
            }
            applyDischargeAndLeave(Number(data.chargedRyo ?? (isHealer ? 0 : dischargeCost)));
        } catch {
            alert('Network error — discharge failed.');
        } finally {
            setBusy(false);
        }
    }

    // Free check-out after timer expires. Server still owns the discharge
    // decision (validator will reject if timer hasn't actually expired), so
    // we route through the same endpoint with paySkip=false.
    async function freeCheckout() {
        if (busy) return;
        setBusy(true);
        try {
            const res = await fetch('/api/player/heal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: character.name, paySkip: false }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                // Already discharged server-side → leave instead of trapping them.
                if (res.status === 400 && /not hospitalized/i.test(String(data.error ?? ''))) {
                    applyDischargeAndLeave(0);
                    return;
                }
                alert(data.error ?? 'Failed to check out.');
                return;
            }
            applyDischargeAndLeave(0);
        } catch {
            alert('Network error — check-out failed.');
        } finally {
            setBusy(false);
        }
    }

    function topUp() {
        if (!isHealer) return alert("Only Healers can heal at the hospital. Non-Healers must wait the 60-second admission timer or pay the discharge fee.");
        if (character.ryo < topUpCost) return alert("Not enough ryo.");
        updateCharacter({ ...character, ryo: character.ryo - topUpCost, hp: character.maxHp });
    }

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
                    disabled={busy || character.ryo < dischargeCost}
                    style={{ background: "linear-gradient(#14532d,#052e16)", borderColor: "#4ade80", opacity: (busy || character.ryo < dischargeCost) ? 0.5 : 1, width: "100%", marginBottom: "0.5rem" }}
                >
                    {busy ? "…" : isHealer
                        ? "✚ Free Self-Heal & Discharge (Healer)"
                        : `💰 Pay ${dischargeCost.toLocaleString()} ryo — Full Heal & Discharge`}
                </button>
                {freeCheckoutReady ? (
                    <button
                        onClick={freeCheckout}
                        disabled={busy}
                        style={{ background: "linear-gradient(#1e3a5f,#0c1f3d)", borderColor: "#60a5fa", width: "100%", animation: "pulse 1.5s infinite", opacity: busy ? 0.5 : 1 }}
                    >
                        {busy ? "…" : "🚪 Check Out (Free — time served)"}
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
            <BackToVillageButton onClick={() => setScreen("village")} />
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
            <HealerInjuredList character={character} updateCharacter={updateCharacter} playerRoster={playerRoster} />
        </div>
    );
}
