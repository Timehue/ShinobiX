/**
 * Training screens — stat training (Training), jutsu seal/paid training
 * (JutsuSealPanel, JutsuTrainingHall) and the previewSealCost helper.
 * Prop-driven, extracted verbatim from App.tsx with no behavior change
 * (training timers, costs, durations, XP/stat formulas unchanged). The
 * file-wide eslint-disable mirrors App.tsx for the verbatim-moved logic.
 */
/* eslint-disable react-hooks/purity */
import type React from "react";
import { serverNow } from "../lib/server-clock";
import { useState, useEffect, useRef } from "react";
import "../styles/training-skin.css";
import "../styles/hub-screens-skin.css";
import { gameConfirm } from "../components/GameAlert";
import { JutsuDropdownList } from "../components/JutsuDropdownList";
import { JutsuEffectCards } from "../components/JutsuEffectCards";
import { BackToVillageButton } from "../components/BackToVillageButton";
// Fantasy stat/duration glyphs (game-icons.net, CC BY 3.0 — attributed in the About guide).
import {
    GiBiceps, GiSprint, GiBrain, GiBrainstorm, GiSwirlString, GiWaterSplash,
    GiPunchBlast, GiBlackBelt, GiEyeball, GiMoon, GiCrossedSwords, GiShield,
    GiStopwatch, GiAlarmClock, GiSandsOfTime, GiNightSleep,
    GiRibbonMedal, GiFastForwardButton,
} from "react-icons/gi";
import { getJutsuMastery, jutsuXpNeeded, scaleJutsuByLevel, jutsuResourceDisplay } from "../lib/jutsu-scaling";
import { jutsuRyoTrainCap } from "../lib/jutsu-training-queue";
import { describeJutsuEffects, jutsuDisplayAtLevel, jutsuTargetingLabel } from "../lib/jutsu-effects";
import { getJutsuTrainingSpeedBonus, getTrainingXpBonus } from "../lib/village-upgrades";
import { formatStatName } from "../lib/stats";
import { canEquipElementJutsu } from "../lib/bloodline";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { getCharacterElements } from "../lib/elements";
import { useVillageWarMorale } from "../lib/war-debuff";
import { normalizeOnboardingStep } from "../lib/onboarding-step";
import { mutateJutsuRyoTraining } from "../lib/jutsu-ryo-api";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { AMBIGUOUS_ACTION_MESSAGE } from "../lib/ambiguous-action";
import { JUTSU_TRAINING_CAP } from "../constants/game";
import { getAllJutsus, playerLensDiscipline } from "../App";
import { TRAINING_TIERS, trainingStatGain } from "../lib/training-config";
import type { Character } from "../types/character";
import type { Jutsu, JutsuMastery, Stats, SavedBloodline, ActiveTraining, ActiveJutsuTraining } from "../types/combat";

// "2h 14m 03s" / "14m 03s" countdown for the Active Training box.
function formatTrainingRemaining(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h > 0 ? `${h}h ` : ""}${h > 0 ? m.toString().padStart(2, "0") : m}m ${s.toString().padStart(2, "0")}s`;
}

export function Training({ character, updateCharacter, activeTraining, setActiveTraining, onBack }: { character: Character; updateCharacter: (character: Character) => void; activeTraining: ActiveTraining | null; setActiveTraining: (training: ActiveTraining | null) => void; onBack: () => void }) {
    const [selectedStat, setSelectedStat] = useState<keyof Stats>("strength");
    const [trainingBusy, setTrainingBusy] = useState(false);
    const trainingBusyRef = useRef(false);
    // Live 1s tick so the Active Training box shows a real countdown (not a static
    // end-time) and the Collect button unlocks the moment training is ready.
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);
    const STAT_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
        strength:         { label: "Strength",      icon: <GiBiceps /> },
        speed:            { label: "Speed",          icon: <GiSprint /> },
        intelligence:     { label: "Intelligence",   icon: <GiBrain /> },
        willpower:        { label: "Willpower",      icon: <GiBrainstorm /> },
        ninjutsuOffense:  { label: "Ninjutsu Off.",  icon: <GiSwirlString /> },
        ninjutsuDefense:  { label: "Ninjutsu Def.",  icon: <GiWaterSplash /> },
        taijutsuOffense:  { label: "Taijutsu Off.",  icon: <GiPunchBlast /> },
        taijutsuDefense:  { label: "Taijutsu Def.",  icon: <GiBlackBelt /> },
        genjutsuOffense:  { label: "Genjutsu Off.",  icon: <GiEyeball /> },
        genjutsuDefense:  { label: "Genjutsu Def.",  icon: <GiMoon /> },
        bukijutsuOffense: { label: "Bukijutsu Off.", icon: <GiCrossedSwords /> },
        bukijutsuDefense: { label: "Bukijutsu Def.", icon: <GiShield /> },
    };
    const statGroups = [
        { title: "General", description: "Core stats used across combat and progression.", stats: ["strength", "speed", "intelligence", "willpower"] as (keyof Stats)[] },
        { title: "Offense", description: "Damage scaling by jutsu style.", stats: ["ninjutsuOffense", "taijutsuOffense", "genjutsuOffense", "bukijutsuOffense"] as (keyof Stats)[] },
        { title: "Defense", description: "Damage resistance by incoming style.", stats: ["ninjutsuDefense", "taijutsuDefense", "genjutsuDefense", "bukijutsuDefense"] as (keyof Stats)[] },
    ];
    // Timer tiers come from lib/training-config (per-hour rates + XP trickle +
    // stamina), decorated with the duration glyph for display.
    const TIMER_ICONS: Record<string, React.ReactNode> = { "15m": <GiStopwatch />, "1h": <GiAlarmClock />, "4h": <GiSandsOfTime />, "8h": <GiNightSleep /> };
    const timers = TRAINING_TIERS.map((tier) => ({ ...tier, icon: TIMER_ICONS[tier.id] }));
    const trainingXpBonus = getTrainingXpBonus(character);
    const showAcademyTrainingHint = normalizeOnboardingStep(character.onboardingStep) === "training" && !activeTraining;
    const selectedStatLabel = STAT_LABELS[selectedStat]?.label ?? formatStatName(selectedStat);
    // Two-axis training: the server seals the reward, debits stamina, persists
    // the active session, and later credits the stored character on redemption.
    async function startTraining(timer: typeof timers[number]) {
        if (trainingBusyRef.current) return;
        if (activeTraining) return alert("You are already training.");
        if (character.stamina < timer.staminaCost) return alert("Not enough stamina.");
        trainingBusyRef.current = true;
        setTrainingBusy(true);
        try {
            const res = await fetch('/api/training/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: character.name, stat: selectedStat, tierId: timer.id }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.token || !data?.character || !data?.activeTraining) throw new Error(String(data?.error ?? 'Training could not be started.'));
            updateCharacter(data.character as Character);
            setActiveTraining(data.activeTraining as ActiveTraining);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Training could not be started. Please retry.');
        } finally {
            trainingBusyRef.current = false;
            setTrainingBusy(false);
        }
    }
    // Cancel an in-progress stat training and bank the prorated reward (server
    // consumes the token and credits the prorated grant. Stamina is not refunded.
    async function cancelTraining() {
        if (trainingBusyRef.current) return;
        if (!activeTraining) return;
        trainingBusyRef.current = true;
        setTrainingBusy(true);
        const totalMs = activeTraining.durationMs ?? timers.find((t) => activeTraining.label.startsWith(t.label))?.ms ?? 0;
        const remaining = Math.max(0, activeTraining.endsAt - serverNow());
        const progress = totalMs > 0 ? Math.min(1, Math.max(0, 1 - remaining / totalMs)) : 1;
        const proratedGain = Math.floor(activeTraining.statGain * progress);
        try {
            if (!(await gameConfirm(`Cancel ${activeTraining.label}? You'll keep ${Math.round(progress * 100)}% of the progress (+${proratedGain} ${formatStatName(activeTraining.stat)}). Stamina already spent is not refunded.`))) return;
            const res = await fetch('/api/training/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: character.name, token: activeTraining.token, legacy: !activeTraining.token, cancel: true }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.granted || !data?.character) throw new Error(String(data?.error ?? 'Training could not be cancelled.'));
            setActiveTraining(data.activeTraining ?? null);
            updateCharacter({ ...character, ...data.character });
            const applied = Math.max(0, Math.floor(Number(data.applied) || 0));
            alert(`Training cancelled. ${applied > 0 ? `+${applied} ${formatStatName(activeTraining.stat)} banked.` : "Not enough progress to bank a stat point."}`);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Training could not be cancelled. Please retry.');
        } finally {
            trainingBusyRef.current = false;
            setTrainingBusy(false);
        }
    }
    // Collect a finished training. Token sessions are credited server-side;
    // tokenless sessions are retained only for pre-migration save compatibility.
    async function completeTraining() {
        if (trainingBusyRef.current) return;
        if (!activeTraining) return;
        if (serverNow() < activeTraining.endsAt) return alert(`Training still has ${Math.ceil((activeTraining.endsAt - serverNow()) / 1000)} seconds left.`);
        trainingBusyRef.current = true;
        setTrainingBusy(true);
        try {
            const res = await fetch('/api/training/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: character.name, token: activeTraining.token, legacy: !activeTraining.token }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.granted || !data?.character) throw new Error(String(data?.error ?? 'Training could not be collected.'));
            setActiveTraining(data.activeTraining ?? null);
            updateCharacter({ ...character, ...data.character });
            const applied = Math.max(0, Math.floor(Number(data.applied) || 0));
            const cap = Math.max(0, Math.floor(Number(data.cap) || 0));
            alert(`${activeTraining.label} complete. ${applied > 0 ? `+${applied} ${formatStatName(activeTraining.stat)}.` : `${formatStatName(activeTraining.stat)} is already at your rank cap (${cap}). Rank up to train it higher.`}`);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Training could not be collected. Please retry.');
        } finally {
            trainingBusyRef.current = false;
            setTrainingBusy(false);
        }
    }
    const remainingMs = activeTraining ? Math.max(0, activeTraining.endsAt - now) : 0;
    const trainingReady = !!activeTraining && remainingMs <= 0;
    return (
        <div className="card">
            <BackToVillageButton onClick={onBack} label="← Back" />
            <h2>Training Grounds</h2>
            <p>Stamina: {character.stamina}/{character.maxStamina} · Growth Bonus: <strong>{trainingXpBonus.toFixed(2)}%</strong></p>

            <div className="training-guide-panel">
                <strong>Training Plan</strong>
                <ul>
                    <li>Training raises the selected stat directly — and every point you earn counts toward your next level.</li>
                    <li>Start with Strength or Speed if you want a simple first pick.</li>
                    <li>Choose 15m while learning; longer timers run longer and show their exact gain below.</li>
                    <li>You can return to the village while training runs, then come back to collect.</li>
                </ul>
            </div>

            {activeTraining && (
                <div className="summary-box">
                    <h3>Active Training</h3>
                    <p>{activeTraining.label}</p>
                    <p>{trainingReady
                        ? <strong style={{ color: "#4ade80" }}>Ready to collect!</strong>
                        : <>Time remaining: <strong>{formatTrainingRemaining(remainingMs)}</strong> · ends {new Date(activeTraining.endsAt).toLocaleTimeString()}</>}</p>
                    <p className="hint">Next: collect this training, then spend your new strength on an E-Rank Drill or rookie mission.</p>
                    <button onClick={completeTraining} disabled={!trainingReady || trainingBusy}>{trainingBusy ? "Settling…" : trainingReady ? "Collect Training" : "Training…"}</button>
                    <button onClick={cancelTraining} disabled={trainingBusy} style={{ marginLeft: 8 }}>Cancel (keep prorated stats)</button>
                </div>
            )}

            {showAcademyTrainingHint && (
                <div className="academy-inline-callout academy-training-callout">
                    <strong>Academy Training:</strong> pick any stat and any timer. Short timers are best while learning.
                </div>
            )}

            <h3>Choose Stat</h3>
            <div className="stat-group-list">
                {statGroups.map((group) => (
                    <section className="stat-group" key={group.title}>
                        <div className="stat-group-heading">
                            <h3>{group.title}</h3>
                            <span>{group.description}</span>
                        </div>
                        <div className="stat-grid">
                            {group.stats.map((stat) => {
                                const info = STAT_LABELS[stat];
                                return (
                                    <button
                                        key={stat}
                                        className={`location-button${selectedStat === stat ? " selected" : ""}`}
                                        onClick={() => setSelectedStat(stat)}
                                        aria-pressed={selectedStat === stat}
                                        title={`${info?.label ?? stat}: train this stat next.`}
                                    >
                                        <span className="tile-icon">{info?.icon ?? "?"}</span>
                                        <span>{info?.label ?? stat}</span>
                                        <small>{selectedStat === stat ? "Selected" : "Click to select"}</small>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>

            <h3>Choose Timer</h3>
            <div className="location-grid">
                {timers.map((timer) => {
                    // XP retired — the growth bonus now boosts the STAT gain
                    // itself. Mirror the server seal exactly (trainingStatGain
                    // with the save-derived bonus; no client-only multipliers).
                    const gain = Math.max(0, Math.round(trainingStatGain(timer, timer.ms, trainingXpBonus)));
                    const disabledReason = trainingBusy
                        ? "Training action is being saved."
                        : activeTraining
                            ? "A training session is already active."
                            : character.stamina < timer.staminaCost
                            ? `Need ${timer.staminaCost} stamina.`
                            : "";
                    return (
                        <button
                            key={timer.label}
                            className={`location-button${showAcademyTrainingHint ? " academy-timer-target" : ""}`}
                            onClick={() => startTraining(timer)}
                            disabled={!!disabledReason}
                            title={disabledReason || `Start ${timer.label} ${selectedStatLabel} training.`}
                        >
                            <span className="tile-icon">{timer.icon}</span>
                            <span>{trainingBusy ? "Saving…" : `Start ${timer.label}`}</span>
                            <small>+{gain} {formatStatName(selectedStat)}</small>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// Honor Seal sinks: Vanguards (and clan-donated recipients later) spend Seals
// to (1) level a jutsu from 30→40 without grinding PvP, and (2) skip jutsu
// training time. Both endpoints live in api/jutsu/ and apply the Vanguard
// Rank 8+ 10% discount server-side. Server is source of truth for Seal
// debits and jutsu levels; client mirrors locally on success.
const SEAL_COST_BY_FROM_LEVEL: Record<number, number> = {
    30: 20, 31: 25, 32: 30, 33: 35, 34: 40,
    35: 45, 36: 50, 37: 55, 38: 60, 39: 65,
};

function previewSealCost(fromLevel: number, character: Character): number {
    const base = SEAL_COST_BY_FROM_LEVEL[fromLevel] ?? 0;
    if (base === 0) return 0;
    if (character.profession === "vanguard" && (character.professionRank ?? 0) >= 8) {
        return Math.ceil(base * 0.9);
    }
    return base;
}

function JutsuSealPanel({
    character,
    updateCharacter,
    selectedJutsu,
    selectedMastery,
    activeJutsuTraining,
    setActiveJutsuTraining,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    selectedJutsu: Jutsu | null;
    selectedMastery: JutsuMastery | null;
    activeJutsuTraining: ActiveJutsuTraining | null;
    setActiveJutsuTraining: (training: ActiveJutsuTraining | null) => void;
}) {
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [msg, setMsg] = useState<string | null>(null);

    const hasDiscount = character.profession === "vanguard" && (character.professionRank ?? 0) >= 8;
    const fromLevel = selectedMastery?.level ?? 0;
    const eligibleForSealLevel = !!selectedJutsu && fromLevel >= 30 && fromLevel < 40;
    const sealLevelCost = eligibleForSealLevel ? previewSealCost(fromLevel, character) : 0;
    const balance = character.honorSeals ?? 0;

    async function trainWithSeals() {
        if (!selectedJutsu || !eligibleForSealLevel || busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setMsg(null);
        try {
            const res = await fetch('/api/jutsu/train-with-seals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: character.name, jutsuId: selectedJutsu.id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(`❌ ${data.error ?? 'Failed'}`);
                return;
            }
            // Mirror server-side mutations locally. Functional updater: the
            // write lands after an await, so merge onto the latest state to
            // avoid clobbering a concurrent setState (regen tick, hydration).
            updateCharacter(prev => {
                if (!prev) return prev;
                const existing = prev.jutsuMastery?.length ? prev.jutsuMastery : [];
                const newMastery = [
                    ...existing.filter(m => m.jutsuId !== selectedJutsu.id),
                    { jutsuId: selectedJutsu.id, level: Number(data.newLevel), xp: 0 },
                ];
                return {
                    ...prev,
                    honorSeals: Number(data.honorSealsRemaining),
                    jutsuMastery: newMastery,
                };
            });
            setMsg(`✅ ${selectedJutsu.name} → Lv ${data.newLevel} (spent ${data.sealsSpent} Seals)`);
        } catch {
            setMsg(`❌ ${AMBIGUOUS_ACTION_MESSAGE}`);
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    async function speedUp(sealsRequested: number) {
        if (!activeJutsuTraining || busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setMsg(null);
        try {
            const res = await fetch('/api/jutsu/speedup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: character.name, seals: sealsRequested }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(`❌ ${data.error ?? 'Failed'}`);
                return;
            }
            const minutesReduced: number = Number(data.minutesReduced ?? 0);
            const reductionMs = minutesReduced * 60 * 1000;
            setActiveJutsuTraining({
                ...activeJutsuTraining,
                endsAt: Math.max(serverNow(), activeJutsuTraining.endsAt - reductionMs),
            });
            updateCharacter(prev => prev ? ({ ...prev, honorSeals: Number(data.honorSealsRemaining) }) : prev);
            setMsg(`✅ -${minutesReduced} min (spent ${data.sealsSpent} Seals)`);
        } catch {
            setMsg(`❌ ${AMBIGUOUS_ACTION_MESSAGE}`);
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    return (
        <div className="summary-box" style={{ background: "linear-gradient(180deg, rgba(250,204,21,0.10), rgba(8,10,22,0.4))", border: "1px solid rgba(250,204,21,0.45)", marginBottom: "0.75rem" }}>
            <strong style={{ color: "#facc15" }}><GiRibbonMedal style={{ verticalAlign: "-0.12em", marginRight: "0.3rem" }} />Honor Seal Training</strong>
            <span className="hint" style={{ marginLeft: 10 }}>
                Balance: <strong style={{ color: "#facc15" }}>{balance.toLocaleString()}</strong>
                {hasDiscount && <span style={{ marginLeft: 8, color: "#f97316" }}> · Vanguard 10% off</span>}
            </span>
            <p className="hint" style={{ margin: "6px 0 8px", fontSize: "0.8rem" }}>
                Skip the PvP grind for jutsu levels 30→40, or shave time off active training.
                Levels 40+ still require PvP.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {selectedJutsu && eligibleForSealLevel ? (
                    <button
                        onClick={() => void trainWithSeals()}
                        disabled={busy || balance < sealLevelCost}
                        style={{ background: "linear-gradient(#854d0e,#422006)", borderColor: "#facc15" }}
                    >
                        {busy ? "…" : `Pay ${sealLevelCost} Seals → Lv ${fromLevel + 1}`}
                    </button>
                ) : (
                    <span className="hint" style={{ fontSize: "0.78rem" }}>
                        {selectedJutsu
                            ? (fromLevel < 30
                                ? `Selected jutsu is Lv ${fromLevel} — train it to Lv 30 with ryo first.`
                                : `Selected jutsu is at the Seal-training cap (Lv 40). PvP from here.`)
                            : "Select a jutsu to see Seal training cost."}
                    </span>
                )}
                {activeJutsuTraining && serverNow() < activeJutsuTraining.endsAt && (
                    <>
                        <button onClick={() => void speedUp(1)} disabled={busy || balance < (hasDiscount ? 1 : 1)} style={{ background: "linear-gradient(#422006,#1c1006)", borderColor: "#fde68a" }}>
                            {busy ? "…" : "−10 min (1 Seal)"}
                        </button>
                        <button onClick={() => void speedUp(10)} disabled={busy || balance < (hasDiscount ? 9 : 10)} style={{ background: "linear-gradient(#422006,#1c1006)", borderColor: "#fde68a" }}>
                            {busy ? "…" : `Finish now (${hasDiscount ? 9 : 10} Seals)`}
                        </button>
                    </>
                )}
            </div>
            {msg && <p className="hint" style={{ margin: "8px 0 0", color: msg.startsWith("✅") ? "#facc15" : "#f87171" }}>{msg}</p>}
        </div>
    );
}

export function JutsuTrainingHall({
    character,
    updateCharacter,
    savedBloodlines,
    creatorJutsus,
    activeJutsuTraining,
    setActiveJutsuTraining,
    onBack,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    activeJutsuTraining: ActiveJutsuTraining | null;
    setActiveJutsuTraining: (training: ActiveJutsuTraining | null) => void;
    onBack: () => void;
}) {
    const ownedElements = getCharacterElements(character);
    const allJutsus = getAllJutsus(savedBloodlines, creatorJutsus, character);
    const availableJutsus = allJutsus.filter((jutsu) => canEquipElementJutsu(character, jutsu, savedBloodlines));
    const lockedElementCount = allJutsus.length - availableJutsus.length;
    const [selectedJutsuId, setSelectedJutsuId] = useState(availableJutsus[0]?.id ?? "");
    const [now, setNow] = useState(Date.now());
    // Village war morale: a loss slows jutsu training, a WIN speeds it up. The
    // same multiplier carries both — jutsuTimeMult is >1 when demoralized and <1
    // when triumphant, so the bonus arithmetic below is unchanged.
    const warMorale = useVillageWarMorale(character.village);
    const jutsuTrainingBonus = getJutsuTrainingSpeedBonus(character) + getActiveAuraSphereBonuses(character).jutsuTrainingSpeedPercent + getActiveAuraSphereBonuses(character).jutsuXpPercent;
    // Ryo training tops out at the Hall cap (30) but never above the player's rank
    // jutsu cap — Academy 10 / Genin 20 / Chunin+ 30 (= the Hall cap).
    const ryoTrainCap = jutsuRyoTrainCap(character.level);

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    function jutsuTrainingDuration(level: number) {
        return level < 10 ? 10 * 60 * 1000 : 30 * 60 * 1000;
    }

    function jutsuTrainingCost(level: number) {
        return level < 10
            ? 2500 + Math.max(0, level) * 500
            : 8000 + Math.max(0, level - 10) * 1200;
    }

    // Ryo "finish now": 500 ryo per remaining minute (prorated, so a near-done
    // training closes out cheap and a fresh 30-min one costs ~15k). A pure ryo
    // sink — buys time, not power (the trained level is still rank-capped).
    // Client-authoritative like the rest of ryo training; the Honor-Seal speedup
    // stays the alternate currency path.
    function jutsuRyoFinishCost(remainingMs: number) {
        return Math.max(0, Math.ceil(remainingMs / 60000)) * 500;
    }

    function formatTrainingTime(ms: number) {
        const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
    }

    async function startPaidJutsuTraining() {
        if (!requireServerSettlement("timedJutsuTraining")) return;
        if (activeJutsuTraining) return alert("You are already training a jutsu.");
        if (!selectedJutsuId) return alert("Pick a jutsu first.");

        const selectedJutsu = allJutsus.find((jutsu) => jutsu.id === selectedJutsuId);
        if (!selectedJutsu || !canEquipElementJutsu(character, selectedJutsu, savedBloodlines)) {
            return alert(`You need the ${selectedJutsu?.element ?? "required"} element to train this jutsu.`);
        }

        const mastery = getJutsuMastery(character, selectedJutsuId);
        if (mastery.level >= ryoTrainCap) {
            return alert(mastery.level >= JUTSU_TRAINING_CAP
                ? "Training Hall can only train jutsu to level 30. Levels 31-50 must be earned from battles."
                : "That jutsu is at your rank's training cap. Rank up to train it further.");
        }

        const cost = jutsuTrainingCost(mastery.level);
        if (mastery.level > 0 && character.ryo < cost) return alert(`Not enough ryo. You need ${cost}.`);
        const result = await mutateJutsuRyoTraining(character.name, 'start', { jutsuId: selectedJutsu.id, label: selectedJutsu.name, bonusPct: Math.max(0, jutsuTrainingBonus + (1 - warMorale.jutsuTimeMult) * 100) });
        if (!result.character) return alert(result.error || 'Jutsu training could not be started.');
        updateCharacter(result.character);
        setActiveJutsuTraining(result.activeJutsuTraining ?? null);
        if (mastery.level === 0) alert(`${selectedJutsu.name} unlocked at level 1 for free!`);
    }

    async function completePaidJutsuTraining() {
        if (!requireServerSettlement("timedJutsuTraining")) return;
        if (!activeJutsuTraining) return;
        if (serverNow() < activeJutsuTraining.endsAt) {
            alert(`Training still has ${formatTrainingTime(activeJutsuTraining.endsAt - serverNow())} left.`);
            return;
        }

        if (!activeJutsuTraining.serverToken) return alert('This legacy training cannot be claimed safely.');
        const result = await mutateJutsuRyoTraining(character.name, 'complete', { serverToken: activeJutsuTraining.serverToken });
        if (!result.character) return alert(result.error || 'Jutsu training could not be claimed.');
        updateCharacter(result.character);
        alert(`${activeJutsuTraining.label} reached level ${activeJutsuTraining.toLevel}.`);
        setActiveJutsuTraining(result.activeJutsuTraining ?? null);
    }

    // Cancellation/refund is derived from the server-sealed active session.
    async function cancelPaidJutsuTraining() {
        if (!requireServerSettlement("timedJutsuTraining")) return;
        if (!activeJutsuTraining) return;
        const refund = Math.floor(activeJutsuTraining.ryoCost * 0.5);
        if (!(await gameConfirm(`Cancel ${activeJutsuTraining.label} training? You'll get ${refund} ryo back (50% of ${activeJutsuTraining.ryoCost}) and forfeit the training progress.`))) return;
        if (!activeJutsuTraining.serverToken) return alert('This legacy training cannot be refunded safely.');
        const result = await mutateJutsuRyoTraining(character.name, 'cancel', { serverToken: activeJutsuTraining.serverToken });
        if (!result.character) return alert(result.error || 'Jutsu training could not be cancelled.');
        updateCharacter(result.character);
        setActiveJutsuTraining(result.activeJutsuTraining ?? null);
        alert(`Training cancelled. Refunded ${result.refund ?? refund} ryo.`);
    }

    // The server derives remaining time, debits ryo, and grants the level atomically.
    async function finishWithRyo() {
        if (!requireServerSettlement("timedJutsuTraining")) return;
        if (!activeJutsuTraining) return;
        const remainingMs = activeJutsuTraining.endsAt - serverNow();
        if (remainingMs <= 0) return;
        const cost = jutsuRyoFinishCost(remainingMs);
        if (character.ryo < cost) return alert(`Not enough ryo. You need ${cost.toLocaleString()} ryo to finish instantly.`);
        if (!(await gameConfirm(`Finish ${activeJutsuTraining.label} training now for ${cost.toLocaleString()} ryo?`))) return;
        if (!activeJutsuTraining.serverToken) return alert('This legacy training cannot be finished safely.');
        const result = await mutateJutsuRyoTraining(character.name, 'finish', { serverToken: activeJutsuTraining.serverToken });
        if (!result.character) return alert(result.error || 'Jutsu training could not be finished.');
        updateCharacter(result.character);
        setActiveJutsuTraining(result.activeJutsuTraining ?? null);
        alert(`${activeJutsuTraining.label} reached level ${activeJutsuTraining.toLevel}.`);
    }

    // Queue a 2nd jutsu training behind the active one. Ryo is paid + the duration
    // locked NOW; the global runner (lib/jutsu-training-queue) promotes it the moment
    // the active training completes. Stored on activeJutsuTraining.next.
    async function queueNextJutsuTraining() {
        if (!requireServerSettlement("timedJutsuTrainingQueue")) return;
        if (!activeJutsuTraining) return alert("Start a training first, then queue the next one.");
        if (activeJutsuTraining.next) return alert("A 2nd jutsu is already queued.");
        const selectedJutsu = allJutsus.find((jutsu) => jutsu.id === selectedJutsuId);
        if (!selectedJutsu || !canEquipElementJutsu(character, selectedJutsu, savedBloodlines)) return alert("Choose an eligible jutsu first.");
        const fromLevel = selectedJutsu.id === activeJutsuTraining.jutsuId
            ? activeJutsuTraining.toLevel
            : getJutsuMastery(character, selectedJutsu.id).level;
        if (fromLevel >= ryoTrainCap) return alert("That jutsu is already at its Training Hall cap.");
        if (fromLevel === 0) return alert("Train a level 0 jutsu directly to unlock it for free.");
        const cost = jutsuTrainingCost(fromLevel);
        if (character.ryo < cost) return alert(`Not enough ryo to queue. You need ${cost}.`);
        if (!activeJutsuTraining.serverToken) return alert('This legacy training cannot accept a secure queue.');
        const result = await mutateJutsuRyoTraining(character.name, 'queue', {
            serverToken: activeJutsuTraining.serverToken,
            jutsuId: selectedJutsu.id,
            label: selectedJutsu.name,
            trainingBonusPct: Math.max(0, jutsuTrainingBonus + (1 - warMorale.jutsuTimeMult) * 100),
        });
        if (!result.character) return alert(result.error || 'The jutsu queue could not be saved.');
        updateCharacter(result.character);
        setActiveJutsuTraining(result.activeJutsuTraining ?? null);
    }

    // Remove the queued 2nd training before it starts — full ryo refund (it never ran).
    async function cancelQueuedJutsuTraining() {
        if (!requireServerSettlement("timedJutsuTrainingQueue")) return;
        if (!activeJutsuTraining?.next) return;
        const queued = activeJutsuTraining.next;
        if (!(await gameConfirm(`Remove the queued ${queued.label} training? You'll get all ${queued.ryoCost} ryo back — it hasn't started.`))) return;
        if (!activeJutsuTraining.serverToken) return alert('This legacy queue cannot be refunded safely.');
        const result = await mutateJutsuRyoTraining(character.name, 'cancel-queue', { serverToken: activeJutsuTraining.serverToken });
        if (!result.character) return alert(result.error || 'The queued training could not be removed.');
        updateCharacter(result.character);
        setActiveJutsuTraining(result.activeJutsuTraining ?? null);
        alert(`Queued training removed. Refunded ${result.refund ?? queued.ryoCost} ryo.`);
    }

    const selectedJutsu = allJutsus.find((jutsu) => jutsu.id === selectedJutsuId);
    const selectedMastery = selectedJutsu ? getJutsuMastery(character, selectedJutsu.id) : null;
    const selectedCost = selectedMastery ? jutsuTrainingCost(selectedMastery.level) : 0;
    const selectedDuration = selectedMastery ? jutsuTrainingDuration(selectedMastery.level) : 0;
    const activeRemaining = activeJutsuTraining ? activeJutsuTraining.endsAt - now : 0;
    const tagLensDiscipline = playerLensDiscipline(character);
    const showAcademyJutsuHint = normalizeOnboardingStep(character.onboardingStep) === "jutsu";
    const queued = activeJutsuTraining?.next ?? null;
    const activeTrainingPanel = activeJutsuTraining ? (
        <div className="summary-box">
            <h3>Active Jutsu Training</h3>
            <p><strong>{activeJutsuTraining.label}</strong>: Level {activeJutsuTraining.fromLevel} → {activeJutsuTraining.toLevel}</p>
            <p>Cost paid: {activeJutsuTraining.ryoCost} ryo</p>
            <p>{activeRemaining > 0 ? `Time remaining: ${formatTrainingTime(activeRemaining)}` : (queued ? "Complete — starting the queued jutsu…" : activeJutsuTraining.autoClaim ? "Complete — claiming your level…" : "Training complete. Claim your level.")}</p>
            {!queued && !activeJutsuTraining.autoClaim && <button onClick={completePaidJutsuTraining}>{activeRemaining > 0 ? "Check Training" : "Claim Jutsu Level"}</button>}
            {activeRemaining > 0 && !queued && <button onClick={cancelPaidJutsuTraining} style={{ marginLeft: 8 }}>Cancel (50% ryo back)</button>}
            {activeRemaining > 0 && <button onClick={finishWithRyo} disabled={character.ryo < jutsuRyoFinishCost(activeRemaining)} style={{ marginLeft: 8, background: "linear-gradient(#14532d,#052e16)", borderColor: "#4ade80" }}>💰 Finish now ({jutsuRyoFinishCost(activeRemaining).toLocaleString()} ryo)</button>}
            {queued ? (
                <div className="summary-box" style={{ marginTop: 8, borderColor: "rgba(96,165,250,0.5)" }}>
                    <strong style={{ color: "#60a5fa" }}><GiFastForwardButton style={{ verticalAlign: "-0.12em", marginRight: "0.3rem" }} />Up next:</strong> {queued.label} — Level {queued.fromLevel} → {queued.toLevel} <span className="hint">({queued.ryoCost} ryo paid · ~{Math.round(queued.durationMs / 60000)} min)</span>
                    <p className="hint" style={{ margin: "4px 0 6px", fontSize: "0.78rem" }}>Auto-starts the moment the current training finishes.</p>
                    <button onClick={cancelQueuedJutsuTraining}>Remove from queue (full refund)</button>
                </div>
            ) : (
                <div style={{ marginTop: 8 }}>
                    <button onClick={queueNextJutsuTraining} disabled={!selectedJutsu}>＋ Queue {selectedJutsu ? selectedJutsu.name : "a jutsu"} next</button>
                    <p className="hint" style={{ margin: "4px 0 0", fontSize: "0.78rem" }}>Line up a 2nd training (ryo paid now) — it auto-starts when this one ends.</p>
                </div>
            )}
        </div>
    ) : showAcademyJutsuHint ? (
        <div className="academy-inline-callout academy-jutsu-callout">
            <strong>Academy Training:</strong> your bloodline gave you starter jutsu. Unlock one more here, then equip it from Profile so it appears in your battle loadout.
        </div>
    ) : null;

    return <div className="card jutsu-training-screen"><BackToVillageButton onClick={onBack} label="← Back" /><JutsuSealPanel character={character} updateCharacter={updateCharacter} selectedJutsu={selectedJutsu ?? null} selectedMastery={selectedMastery} activeJutsuTraining={activeJutsuTraining} setActiveJutsuTraining={setActiveJutsuTraining} /><h2>Jutsu Training Hall</h2><p>Train jutsu to <strong>Level 30</strong> with ryo. Levels <strong>31-50</strong> must be earned from battles. Your elements: <strong>{ownedElements.length ? ownedElements.join(" / ") : "None awakened"}</strong>. Town Hall + Aura training bonus: <strong>{jutsuTrainingBonus.toFixed(2)}%</strong>.</p>{warMorale.morale !== "none" && <p className="hint" style={{ color: warMorale.morale === "triumphant" ? "#4ade80" : "#f87171" }}>{warMorale.morale === "triumphant" ? `🏯 Victorious — your village trains jutsu ${Math.round((1 - warMorale.jutsuTimeMult) * 100)}% faster until ${new Date(warMorale.until).toLocaleDateString()}.` : `🏯 Demoralized — your village trains jutsu ${Math.round((warMorale.jutsuTimeMult - 1) * 100)}% slower until ${new Date(warMorale.until).toLocaleDateString()}.`}</p>}{lockedElementCount > 0 && <p className="hint">{lockedElementCount} jutsu locked until you awaken their element.</p>}{activeTrainingPanel}<h3>Paid Ryo Training</h3><div className="summary-box"><p>{selectedJutsu ? <><strong>{selectedJutsu.name}</strong> will train from level {selectedMastery?.level ?? 0} to {Math.min(ryoTrainCap, (selectedMastery?.level ?? 0) + 1)}.</> : "Choose a jutsu to train."}</p><p>{selectedMastery?.level === 0 ? <><strong>Free & Instant</strong> — Level 0 → 1</> : <>Cost: <strong>{selectedCost}</strong> ryo | Time: <strong>{selectedDuration / 60000}</strong> minutes | Reward: <strong>1 full jutsu level</strong></>}</p><button onClick={startPaidJutsuTraining} disabled={!selectedJutsu || !!activeJutsuTraining || !selectedMastery || selectedMastery.level >= ryoTrainCap || (selectedMastery.level > 0 && character.ryo < selectedCost)}>{activeJutsuTraining ? "Training In Progress" : selectedMastery && selectedMastery.level >= ryoTrainCap ? "Battle Training Required" : selectedMastery?.level === 0 ? "Unlock Level 1 (Free)" : `Pay ${selectedCost} Ryo & Train`}</button></div><JutsuDropdownList jutsus={availableJutsus} label="Choose Jutsu" emptyText={ownedElements.length ? "No jutsu match your awakened elements." : "Awaken an element at the Awakening Stone before training elemental jutsu."} renderDetails={(jutsu) => { const mastery = getJutsuMastery(character, jutsu.id); const scaled = scaleJutsuByLevel(jutsu, mastery.level); const cost = jutsuTrainingCost(mastery.level); const duration = jutsuTrainingDuration(mastery.level); const displayJutsu = jutsuDisplayAtLevel(jutsu, mastery.level); return <><p>Level: {mastery.level}/50 | XP: {mastery.xp}/{mastery.level >= 50 ? "MAX" : jutsuXpNeeded(mastery.level)}</p><p>Type: {jutsu.type} | Element: {jutsu.element} | AP: {jutsu.ap} | Range: {jutsu.range}</p>{(() => { const t = jutsuTargetingLabel(jutsu); return <p><strong style={{ color: "#c084fc" }}>🎯 Targeting: {t.short}</strong> — {t.detail}</p>; })()}<p>Scaled EP: {scaled.scaledEffectPower} | Chakra Cost: {jutsuResourceDisplay(jutsu, "chakra", character.level, character.specialty, mastery.level)} | Stamina Cost: {jutsuResourceDisplay(jutsu, "stamina", character.level, character.specialty, mastery.level)}</p><p>Tags: {displayJutsu.tags.map((tag) => `${tag.name}${tag.percent ? ` ${tag.percent}%` : ""}`).join(", ") || "None"}</p><p><strong>Paid Training:</strong> {mastery.level === 0 ? "Free & Instant — unlocks Level 1" : mastery.level < ryoTrainCap ? `${cost} ryo | ${duration / 60000} minutes | +1 full level` : "Battle only from here"}</p><p><strong>Effects:</strong> {describeJutsuEffects(jutsu, mastery.level, tagLensDiscipline)}</p><JutsuEffectCards jutsu={jutsu} scaledEffectPower={scaled.scaledEffectPower} masteryLevel={mastery.level} lensDiscipline={tagLensDiscipline} /><p>{selectedJutsuId === jutsu.id ? "Selected for paid training." : mastery.level < 30 ? "Training Hall available." : mastery.level < 50 ? "Battle only." : "Mastered."}</p></>; }} onSelectJutsu={(jutsu) => setSelectedJutsuId(jutsu.id)} /></div>;
}
