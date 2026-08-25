import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { VersionedCharacterCommit } from "../types/character";
import { HealerInjuredList } from "../components/HealerInjuredList";
import { clearSectorReopen } from "../lib/sector-return";
import {
    type Character,
    type PlayerRecord,
    type Screen,
    discountCost,
    getHospitalDiscountPercent,
} from "../App";
import { gameToast } from "../components/GameToast";
import { adoptHospitalDischarge, type HospitalDischargeResponse } from "../lib/hospital-discharge";
import { FacilityHero } from "../components/FacilityHero";
import { serverNow } from "../lib/server-clock";
import { GameIcon } from "../components/icons/GameIcon";

export
function Hospital({ character, updateCharacter, setScreen, playerRoster, onServerVersion, onVersionedCharacter }: { character: Character; updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>; setScreen: (s: Screen, authoritativeCharacter?: Character) => void; playerRoster: PlayerRecord[]; onServerVersion: (version: unknown) => boolean; onVersionedCharacter: VersionedCharacterCommit }) {
    const isHealer = character.profession === "healer";
    const healerRank = isHealer ? (character.professionRank ?? 1) : 0;
    const hospitalDiscount = getHospitalDiscountPercent(character);
    // Healers heal themselves for free — both the server-backed topUp vitals refill and the
    // discharge action cost 0 ryo. Non-Healers pay a bumped 2,500 ryo to
    // discharge (or wait the 60-second free checkout) and can't topUp at all.
    const dischargeCost = isHealer ? 0 : discountCost(2500, hospitalDiscount);
    const topUpCost = isHealer ? 0 : discountCost(50, hospitalDiscount);
    const hpPercent = Math.max(0, Math.min(100, character.maxHp > 0 ? (character.hp / character.maxHp) * 100 : 0));
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
    // null = the server stamp has not arrived yet, so there is NOTHING to count.
    // A local 60s guess could only ever run down to a check-out the server then
    // refuses (api/player/heal is the sole authority), and the stamp is
    // server-minted, so it is compared against the server's clock not the device's.
    const effectiveUntil: number | null = serverUntil > 0 ? serverUntil : null;
    const [now, setNow] = useState(() => serverNow());
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const autoCheckoutStartedRef = useRef(false);

    // Arriving at the hospital means a KO (or a normal visit). Either way, drop
    // any pending "return to the sector you were exploring" latch (set before an
    // ambush fight) so the next Travel opens the world-map overview, not the
    // sector the player was just knocked out in. The win path never passes
    // through here, so this can't cancel a legitimate sector reopen.
    useEffect(() => { clearSectorReopen(); }, []);

    useEffect(() => {
        if (!character.hospitalized) return;
        const id = setInterval(() => setNow(serverNow()), 1000);
        return () => clearInterval(id);
    }, [character.hospitalized]);

    const freeCheckoutReady = character.hospitalized && effectiveUntil != null && now >= effectiveUntil;
    const remaining: number | null = effectiveUntil == null ? null : Math.max(0, Math.ceil((effectiveUntil - now) / 1000));

    // Pay-skip discharge. Previously this was a client-only mutation that
    // deducted ryo + flipped hospitalized=false locally, but the save
    // validator reverts early discharge — so players paid ryo for nothing.
    // Now we POST to /api/player/heal with paySkip=true; the server charges
    // ryo AND performs the discharge in one atomic write, then we mirror
    // the post-charge state locally.
    // Mirror a successful (or already-applied) discharge into local state and
    // leave for the village. Clears the hospital stamps too so a later re-open
    // can't read a stale timer.
    function applyDischargeAndLeave(data: HospitalDischargeResponse, chargedRyo: number) {
        if (!adoptHospitalDischarge(data, onVersionedCharacter, (screen, authoritativeCharacter) => setScreen(screen, authoritativeCharacter))) return false;
        // Confirm a paid discharge (chargedRyo > 0). Free checkouts and Healer
        // self-discharges (chargedRyo === 0) leave silently as before.
        if (chargedRyo > 0) {
            gameToast(`💰 You paid ${chargedRyo.toLocaleString()} ryo and were released — fully healed and discharged.`);
        }
        return true;
    }

    async function discharge() {
        if (busyRef.current) return;
        if (character.ryo < dischargeCost) return alert(`Not enough ryo. You need ${dischargeCost} ryo to be discharged.`);
        busyRef.current = true;
        setBusy(true);
        try {
            // Up to two attempts. A 400 "not hospitalized" immediately after a fresh KO
            // can mean the admission save just hasn't reached the server yet (the client
            // flips hospitalized:true and flushes it a beat later). If we simply left
            // here, that in-flight admission save would re-admit us on the next refresh.
            // So when we still believe we're admitted, wait briefly and retry once so the
            // discharge actually lands. A second "not hospitalized" means we are genuinely
            // free (server already discharged us, or we were never admitted) → leave.
            for (let attempt = 0; attempt < 2; attempt++) {
                const res = await fetch('/api/player/heal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetName: character.name, paySkip: !isHealer }),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    if (!applyDischargeAndLeave(data, Number(data.chargedRyo ?? (isHealer ? 0 : dischargeCost)))) {
                        alert("The server did not return an accepted discharge state. Refresh and try again.");
                    }
                    return;
                }
                if (res.status === 400 && /not hospitalized/i.test(String(data.error ?? ''))) {
                    if (attempt === 0 && character.hospitalized) {
                        await new Promise(resolve => setTimeout(resolve, 700)); // let the KO admission save land
                        continue;
                    }
                    alert("The server did not return the authoritative discharge state. Refresh and try again."); return;
                }
                alert(data.error ?? 'Failed to discharge.');
                return;
            }
        } catch {
            alert('Network error — discharge failed.');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    // Free check-out after timer expires. Server still owns the discharge
    // decision (validator will reject if timer hasn't actually expired), so
    // we route through the same endpoint with paySkip=false.
    async function freeCheckout(automatic = false) {
        if (busyRef.current) {
            if (automatic) autoCheckoutStartedRef.current = false;
            return;
        }
        busyRef.current = true;
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
                    if (automatic) autoCheckoutStartedRef.current = false;
                    else alert("Your discharge state changed. Refresh to load the server record.");
                    return;
                }
                if (automatic) autoCheckoutStartedRef.current = false;
                else alert(data.error ?? 'Failed to check out.');
                return;
            }
            if (!applyDischargeAndLeave(data, 0)) {
                if (automatic) autoCheckoutStartedRef.current = false;
                else alert("The server did not return an accepted discharge state. Refresh and try again.");
            }
        } catch {
            if (automatic) autoCheckoutStartedRef.current = false;
            else alert('Network error — check-out failed.');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    // Waiting out the admission timer should release the player automatically;
    // the free button below remains as a fallback if the request ever fails.
    useEffect(() => {
        if (!freeCheckoutReady || isHealer || autoCheckoutStartedRef.current) return;
        autoCheckoutStartedRef.current = true;
        void freeCheckout(true);
        // `now` intentionally provides a once-per-second retry opportunity after
        // a transient network/server failure resets autoCheckoutStartedRef.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [freeCheckoutReady, isHealer, now]);

    async function topUp() {
        if (busyRef.current) return;
        if (!isHealer) return alert("Only Healers can heal at the hospital. Non-Healers must wait the 60-second admission timer or pay the discharge fee.");
        if (character.ryo < topUpCost) return alert("Not enough ryo.");
        busyRef.current = true;
        setBusy(true);
        try {
            const res = await fetch('/api/player/heal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: character.name, topUp: true }),
            });
            const data = await res.json().catch(() => ({})) as { error?: string; chargedRyo?: number; hp?: number; chakra?: number; stamina?: number; _saveVersion?: number };
            if (!res.ok) {
                alert(data.error ?? 'Failed to heal.');
                return;
            }
            if (!onServerVersion(data._saveVersion)) return;
            const chargedRyo = Number(data.chargedRyo ?? topUpCost);
            updateCharacter(prev => prev && prev.name.trim().toLowerCase() === character.name.trim().toLowerCase() ? ({
                ...prev,
                ryo: Math.max(0, prev.ryo - chargedRyo),
                hp: Number(data.hp ?? prev.maxHp),
                chakra: Number(data.chakra ?? prev.maxChakra),
                stamina: Number(data.stamina ?? prev.maxStamina),
            }) : prev);
        } catch {
            alert('Network error - heal failed.');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    if (character.hospitalized) {
        return (
            <div className="card civic-facility-screen hospital-screen hospital-screen--admitted">
                <FacilityHero
                    facility="hospital"
                    eyebrow={`${character.village} · Emergency Ward`}
                    title="Village Hospital"
                    description="You are stable and under medical watch. Choose an immediate release or wait for complimentary discharge."
                    metrics={[
                        { label: "Patient status", value: "Admitted", tone: "warning" },
                        { label: "Vital condition", value: `${character.hp} / ${character.maxHp} HP`, tone: "warning" },
                        { label: "Village discount", value: `${hospitalDiscount.toFixed(2)}%`, tone: hospitalDiscount > 0 ? "good" : "default" },
                    ]}
                />

                <section className="facility-panel hospital-admission-panel">
                    <div className="hospital-status-line">
                        <span className="hospital-status-icon"><GameIcon name="hp" size={28} /></span>
                        <div>
                            <p className="facility-eyebrow">Recovery in progress</p>
                            <h3>You are currently admitted</h3>
                            <p>{isHealer
                                ? "Your healer training allows you to restore your own vitals and leave immediately at no cost."
                                : "Your vitals will be fully restored at discharge. Pay for an immediate release or wait for the free checkout."}</p>
                        </div>
                    </div>
                    <div className="hospital-vitals-card">
                        <div className="hospital-vital-heading">
                            <span>HP recovery</span>
                            <strong>{character.hp.toLocaleString()} / {character.maxHp.toLocaleString()}</strong>
                        </div>
                        <div className="facility-resource-track facility-resource-track--hp"><span style={{ width: `${hpPercent}%` }} /></div>
                    </div>

                    <div className="hospital-release-grid">
                        <article className="hospital-release-option hospital-release-option--priority">
                            <GameIcon name="sparkle" size={24} />
                            <div>
                                <span>Immediate release</span>
                                <strong>{isHealer ? "Free for Healers" : `${dischargeCost.toLocaleString()} ryo`}</strong>
                                <small>Full restoration · leave now</small>
                            </div>
                            <button className="facility-primary-action" onClick={discharge} disabled={busy || character.ryo < dischargeCost}>
                                {busy ? "Processing…" : isHealer ? "Self-heal & discharge" : "Pay & discharge"}
                            </button>
                        </article>

                        {!isHealer && (
                            <article className="hospital-release-option">
                                <GameIcon name="clock" size={24} />
                                <div>
                                    <span>Complimentary release</span>
                                    <strong>{freeCheckoutReady ? "Ready now" : remaining == null ? "Awaiting the server’s admission timer…" : `${remaining}s remaining`}</strong>
                                    <small>No charge · full restoration</small>
                                </div>
                                {freeCheckoutReady ? (
                                    <button className="facility-secondary-action hospital-free-checkout" onClick={() => void freeCheckout(false)} disabled={busy}>
                                        {busy ? "Checking out…" : "Check out free"}
                                    </button>
                                ) : (
                                    <div className="hospital-countdown" aria-label={remaining == null ? "Awaiting the server’s admission timer" : `${remaining} seconds until free checkout`}>
                                        <span style={{ width: `${remaining == null ? 0 : Math.max(0, Math.min(100, (1 - remaining / 60) * 100))}%` }} />
                                    </div>
                                )}
                            </article>
                        )}
                    </div>

                    {character.ryo < dischargeCost && !freeCheckoutReady && (
                        <p className="facility-inline-warning">
                            Your wallet is short {(dischargeCost - character.ryo).toLocaleString()} ryo. Free checkout unlocks {remaining == null ? "once the server’s admission timer arrives" : `in ${remaining}s`}.
                        </p>
                    )}
                </section>
            </div>
        );
    }

    return (
        <div className="card civic-facility-screen hospital-screen">
            <FacilityHero
                facility="hospital"
                eyebrow={`${character.village} · Medical Quarter`}
                title="Village Hospital"
                description="A quiet ward for recovery, triage, and the village healer corps."
                onBack={() => setScreen("village")}
                metrics={[
                    { label: "Current HP", value: `${character.hp.toLocaleString()} / ${character.maxHp.toLocaleString()}`, tone: hpPercent >= 75 ? "good" : "warning" },
                    { label: "Wallet", value: `${character.ryo.toLocaleString()} ryo` },
                    { label: "Hospital discount", value: `${hospitalDiscount.toFixed(2)}%`, tone: hospitalDiscount > 0 ? "good" : "default" },
                ]}
            />

            <div className="facility-content-grid hospital-workspace">
                <section className="facility-panel hospital-care-panel">
                    <div className="facility-panel-heading">
                        <span className="facility-panel-icon"><GameIcon name="hp" size={24} /></span>
                        <div>
                            <p className="facility-eyebrow">Personal care</p>
                            <h3>Vital condition</h3>
                        </div>
                    </div>
                    <div className="hospital-vitals-card">
                        <div className="hospital-vital-heading">
                            <span>Hit points</span>
                            <strong>{Math.round(hpPercent)}%</strong>
                        </div>
                        <div className="facility-resource-track facility-resource-track--hp"><span style={{ width: `${hpPercent}%` }} /></div>
                    </div>
                    {isHealer ? (
                        <>
                            <div className="hospital-healer-badge">
                                <GameIcon name="sparkle" size={22} />
                                <div><span>Healer privileges active</span><strong>Rank {healerRank} · {(character.professionXp ?? 0).toLocaleString()} XP</strong></div>
                            </div>
                            <button className="facility-primary-action" onClick={topUp} disabled={busy || hpPercent >= 100}>
                                {busy ? "Restoring vitals…" : hpPercent >= 100 ? "Vitals already full" : "Restore all vitals · Free"}
                            </button>
                        </>
                    ) : (
                        <div className="facility-access-note">
                            <GameIcon name="shield" size={22} />
                            <p>Walk-in restoration is reserved for the Healer profession. After a knockout, the ward offers a timed free discharge or an immediate paid release.</p>
                        </div>
                    )}
                    <p className="facility-fine-print">Your Town Hall hospital upgrade currently reduces eligible treatment costs by {hospitalDiscount.toFixed(2)}%.</p>
                </section>

                <section className="facility-panel hospital-roster-panel">
                    <div className="facility-panel-heading">
                        <span className="facility-panel-icon"><GameIcon name="person" size={24} /></span>
                        <div>
                            <p className="facility-eyebrow">Healer corps</p>
                            <h3>Injured villagers</h3>
                        </div>
                    </div>
                    {isHealer && <p className="facility-panel-intro">Treat hospitalized allies in {character.village}. Each heal grants profession XP equal to the percentage restored.{healerRank >= 10 && " Rank 10 expands your reach beyond village borders."}</p>}
                    <HealerInjuredList character={character} updateCharacter={updateCharacter} playerRoster={playerRoster} onServerVersion={onServerVersion} />
                </section>
            </div>
        </div>
    );
}
