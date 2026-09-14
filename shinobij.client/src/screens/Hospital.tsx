import { discountCost, getHospitalDiscountPercent } from "../lib/village-upgrades";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { VersionedCharacterCommit } from "../types/character";
import { HealerInjuredList } from "../components/HealerInjuredList";
import { clearSectorReopen } from "../lib/sector-return";
import {
    type Character,
    type PlayerRecord,
    type Screen
} from "../App";
import { gameToast } from "../components/GameToast";
import { adoptHospitalDischarge, hospitalDischargeMessage, type HospitalDischargeResponse } from "../lib/hospital-discharge";
import { FacilityHero } from "../components/FacilityHero";
import { serverNow } from "../lib/server-clock";
import { GameIcon } from "../components/icons/GameIcon";
import { normalizeOnboardingStep } from "../lib/onboarding-step";

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
    const academyRecoveryStep = normalizeOnboardingStep(character.onboardingStep) === "academySpar";
    const hpPercent = Math.max(0, Math.min(100, character.maxHp > 0 ? (character.hp / character.maxHp) * 100 : 0));
    // The persisted server admission stamp survives refreshes. Until it arrives,
    // show a pending state instead of inventing a local discharge deadline.
    const serverUntil = Number(character.hospitalizedUntil ?? 0);
    // null = the server stamp has not arrived yet, so there is NOTHING to count.
    // A local 60s guess could only ever run down to a check-out the server then
    // refuses (api/player/heal is the sole authority), and the stamp is
    // server-minted, so it is compared against the server's clock not the device's.
    const effectiveUntil: number | null = serverUntil > 0 ? serverUntil : null;
    const [now, setNow] = useState(() => serverNow());
    const [busy, setBusy] = useState(false);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);
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
    function applyDischargeAndLeave(data: HospitalDischargeResponse) {
        if (!adoptHospitalDischarge(data, onVersionedCharacter, (screen, authoritativeCharacter) => setScreen(screen, authoritativeCharacter))) return false;
        gameToast(hospitalDischargeMessage(data), { kind: "success" });
        return true;
    }

    async function discharge() {
        if (busyRef.current) return;
        if (character.ryo < dischargeCost) return alert(`Not enough ryo. You need ${dischargeCost} ryo to be discharged.`);
        busyRef.current = true;
        setBusy(true);
        setCheckoutError(null);
        try {
            const res = await fetch('/api/player/heal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: character.name, paySkip: !isHealer, hospitalizedAt: Number(character.hospitalizedAt ?? 0) }),
                signal: AbortSignal.timeout(12_000),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setCheckoutError(String(data.error ?? 'Discharge could not be confirmed. Try again.'));
                return;
            }
            if (!applyDischargeAndLeave(data)) {
                setCheckoutError("Your treatment status is still syncing. Refresh and try again.");
            }
        } catch {
            setCheckoutError('Discharge could not be confirmed. Retry the discharge to check its status; the same stay cannot be charged twice.');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    // Free check-out after timer expires. Server still owns the discharge
    // decision (validator will reject if timer hasn't actually expired), so
    // we route through the same endpoint with paySkip=false.
    async function freeCheckout() {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setCheckoutError(null);
        try {
            const res = await fetch('/api/player/heal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: character.name, paySkip: false, hospitalizedAt: Number(character.hospitalizedAt ?? 0) }),
                signal: AbortSignal.timeout(12_000),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setCheckoutError(`${String(data.error ?? 'Your discharge could not be confirmed.')} Choose Check out free to try again.`);
                return;
            }
            if (!applyDischargeAndLeave(data)) {
                setCheckoutError("Your treatment status is still syncing. Choose Check out free to try again.");
            }
        } catch {
            setCheckoutError("Connection lost while checking out. Choose Check out free to try again.");
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    // One automatic attempt per admission. Failures stay visible beside the
    // existing retry button instead of silently retrying every second.
    useEffect(() => {
        if (!character.hospitalized) { autoCheckoutStartedRef.current = false; return; }
        if (!freeCheckoutReady || isHealer || autoCheckoutStartedRef.current) return;
        autoCheckoutStartedRef.current = true;
        void freeCheckout();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character.hospitalized, freeCheckoutReady, isHealer]);

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
                    description="Your injuries prevent travel and combat until discharge. Treatment restores full HP and returns you to the village."
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
                                ? "Your healer training closes your own wounds and releases you at no cost. Chakra and stamina recover with rest, or instantly at the Cafeteria."
                                : "Your wounds are treated at discharge; chakra and stamina return with rest, or instantly at the Cafeteria. Pay for an immediate release or wait for the free checkout."}</p>
                        </div>
                    </div>
                    <div className="hospital-vitals-card">
                        <div className="hospital-vital-heading">
                            <span>HP recovery</span>
                            <strong>{character.hp.toLocaleString()} / {character.maxHp.toLocaleString()}</strong>
                        </div>
                        <div className="facility-resource-track facility-resource-track--hp"><span style={{ width: `${hpPercent}%` }} /></div>
                    </div>

                    {checkoutError && <p className="facility-inline-warning" role="alert">{checkoutError}</p>}
                    <div className="hospital-release-grid">
                        <article className="hospital-release-option hospital-release-option--priority">
                            <GameIcon name="sparkle" size={24} />
                            <div>
                                <span>Immediate release</span>
                                <strong>{isHealer ? "Free for Healers" : `${dischargeCost.toLocaleString()} ryo`}</strong>
                                <small>Full HP · return to village now</small>
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
                                    <small>No charge · full HP · return to village</small>
                                </div>
                                {freeCheckoutReady ? (
                                    <button
                                        className={`facility-secondary-action hospital-free-checkout${academyRecoveryStep ? " academy-click-target" : ""}`}
                                        data-academy-hint={academyRecoveryStep ? "Next · check out" : undefined}
                                        data-academy-autoscroll={academyRecoveryStep ? "true" : undefined}
                                        onClick={() => void freeCheckout()}
                                        disabled={busy}
                                    >
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
                                {busy ? "Closing wounds…" : hpPercent >= 100 ? "No wounds to treat" : "Close wounds · Free"}
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
