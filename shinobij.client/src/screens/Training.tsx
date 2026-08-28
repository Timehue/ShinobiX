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
import "../styles/jutsu-training-skin.css";
import { gameConfirm } from "../components/GameAlert";
import { JutsuDropdownList } from "../components/JutsuDropdownList";
import { JutsuEffectCards } from "../components/JutsuEffectCards";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { Modal } from "../components/ui/Modal";
// Compact local stat and duration glyphs shared with the rest of the game.
import {
    GiBiceps, GiSprint, GiBrain, GiBrainstorm, GiSwirlString, GiWaterSplash,
    GiPunchBlast, GiBlackBelt, GiEyeball, GiMoon, GiCrossedSwords, GiShield,
    GiStopwatch, GiAlarmClock, GiSandsOfTime, GiNightSleep,
    GiRibbonMedal, GiFastForwardButton,
} from "../components/icons/LightweightGameIcons";
import { getJutsuMastery, jutsuXpNeeded, scaleJutsuByLevel, jutsuResourceDisplay } from "../lib/jutsu-scaling";
import { jutsuRyoTrainCap } from "../lib/jutsu-training-queue";
import { describeJutsuEffects, jutsuDisplayAtLevel, jutsuTargetingLabel } from "../lib/jutsu-effects";
import { getJutsuTrainingSpeedBonus, getTrainingXpBonus } from "../lib/village-upgrades";
import { formatStatName, earnedStatPoints, levelForEarned } from "../lib/stats";
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
import { TRAINING_TIERS, trainingStatGain, rookieStatMultiplier } from "../lib/training-config";
import type { Character, VersionedCharacterCommit } from "../types/character";
import type { Jutsu, JutsuMastery, Stats, SavedBloodline, ActiveTraining, ActiveJutsuTraining } from "../types/combat";

// "2h 14m 03s" / "14m 03s" countdown for the Active Training box.
function formatTrainingRemaining(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h > 0 ? `${h}h ` : ""}${h > 0 ? m.toString().padStart(2, "0") : m}m ${s.toString().padStart(2, "0")}s`;
}

export function Training({ character, onVersionedCharacter, activeTraining, setActiveTraining, onBack }: { character: Character; onVersionedCharacter: VersionedCharacterCommit; activeTraining: ActiveTraining | null; setActiveTraining: (training: ActiveTraining | null) => void; onBack: () => void }) {
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
    // The level the earned-points ledger supports, ignoring exam holds — this is
    // what the server feeds the rookie multiplier, so the preview must use it too.
    const ledgerLevel = levelForEarned(earnedStatPoints(character));
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
            const data = await res.json().catch(() => ({})) as { token?: string; character?: Character; activeTraining?: ActiveTraining; _saveVersion?: number; error?: string };
            if (!res.ok || !data?.token || !data?.character || !data?.activeTraining) throw new Error(String(data?.error ?? 'Training could not be started.'));
            if (!onVersionedCharacter(data.character, data._saveVersion)) return;
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
            const data = await res.json().catch(() => ({})) as { granted?: boolean; character?: Character; activeTraining?: ActiveTraining | null; _saveVersion?: number; applied?: number; overflow?: number; error?: string };
            if (!res.ok || !data?.granted || !data?.character) throw new Error(String(data?.error ?? 'Training could not be cancelled.'));
            if (!onVersionedCharacter(data.character, data._saveVersion)) return;
            setActiveTraining(data.activeTraining ?? null);
            const applied = Math.max(0, Math.floor(Number(data.applied) || 0));
            const overflow = Math.max(0, Math.floor(Number(data.overflow) || 0));
            const pooled = overflow > 0 ? ` +${overflow} to your unspent pool.` : "";
            alert(`Training cancelled. ${applied > 0 ? `+${applied} ${formatStatName(activeTraining.stat)} banked.` : "Not enough progress to bank a stat point."}${pooled}`);
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
            const data = await res.json().catch(() => ({})) as { granted?: boolean; character?: Character; activeTraining?: ActiveTraining | null; _saveVersion?: number; applied?: number; overflow?: number; cap?: number; error?: string };
            if (!res.ok || !data?.granted || !data?.character) throw new Error(String(data?.error ?? 'Training could not be collected.'));
            if (!onVersionedCharacter(data.character, data._saveVersion)) return;
            setActiveTraining(data.activeTraining ?? null);
            const applied = Math.max(0, Math.floor(Number(data.applied) || 0));
            const cap = Math.max(0, Math.floor(Number(data.cap) || 0));
            // Points past the rank cap are NOT lost — applyTrainingGrant rolls
            // them into the unspent pool. Say so: early-game sessions routinely
            // out-earn the Academy cap, and silence reads as "my points vanished".
            const overflow = Math.max(0, Math.floor(Number(data.overflow) || 0));
            const pooled = overflow > 0 ? ` +${overflow} to your unspent pool (${formatStatName(activeTraining.stat)} is at its rank cap of ${cap}) — spend it on any stat.` : "";
            alert(`${activeTraining.label} complete. ${applied > 0 ? `+${applied} ${formatStatName(activeTraining.stat)}.` : `${formatStatName(activeTraining.stat)} is already at your rank cap (${cap}).`}${pooled}`);
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
        <div className="card training-screen" aria-labelledby="training-ground-title">
            <BackToVillageButton onClick={onBack} label="← Back" />
            <h2 id="training-ground-title">Training Grounds</h2>
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
                    // with the save-derived bonus, then the rookie multiplier as
                    // its own factor, exactly as trustedTrainingRewards does; no
                    // client-only multipliers). The multiplier reads the
                    // LEDGER-derived level, not character.level — they diverge
                    // under an exam hold, and the server seals from the ledger.
                    const gain = Math.max(0, Math.round(
                        trainingStatGain(timer, timer.ms, trainingXpBonus) * rookieStatMultiplier(ledgerLevel),
                    ));
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
                            className={`location-button${showAcademyTrainingHint ? " academy-timer-target academy-click-target" : ""}`}
                            data-academy-hint={showAcademyTrainingHint ? "Next · start a timer" : undefined}
                            data-academy-autoscroll={showAcademyTrainingHint && timer === timers[0] ? "true" : undefined}
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
    onVersionedCharacter,
    savedBloodlines,
    creatorJutsus,
    activeJutsuTraining,
    setActiveJutsuTraining,
    onBack,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    onVersionedCharacter: VersionedCharacterCommit;
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
    const academyJutsuStep = normalizeOnboardingStep(character.onboardingStep) === "jutsu";
    const academyUntrainedJutsuId = availableJutsus.find((jutsu) => getJutsuMastery(character, jutsu.id).level < 1)?.id ?? "";
    const [selectedJutsuId, setSelectedJutsuId] = useState(
        (academyJutsuStep ? academyUntrainedJutsuId : "") || availableJutsus[0]?.id || "",
    );
    const [now, setNow] = useState(Date.now());
    const [jutsuAction, setJutsuAction] = useState<string | null>(null);
    const [jutsuNotice, setJutsuNotice] = useState<JutsuHallNotice | null>(null);
    const [mobileJutsuInfoId, setMobileJutsuInfoId] = useState<string | null>(null);
    const jutsuActionRef = useRef(false);
    // Village war morale, for DISPLAY only. The server applies it itself as a
    // separate duration multiplier (api/_war-morale.ts → api/training/jutsu-ryo.ts),
    // so it must NOT be folded into the bonus we send or it would count twice.
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

    function beginJutsuAction(action: string): boolean {
        if (jutsuActionRef.current) return false;
        jutsuActionRef.current = true;
        setJutsuAction(action);
        setJutsuNotice(null);
        return true;
    }

    function endJutsuAction(): void {
        jutsuActionRef.current = false;
        setJutsuAction(null);
    }

    function rejectJutsuAction(error: string | undefined): void {
        setJutsuNotice({ tone: "error", message: friendlyJutsuTrainingError(error) });
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
        if (!beginJutsuAction("start")) return;
        try {
            const result = await mutateJutsuRyoTraining(character.name, 'start', { jutsuId: selectedJutsu.id, label: selectedJutsu.name, bonusPct: jutsuTrainingBonus });
            if (!result.character) return rejectJutsuAction(result.error);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            setActiveJutsuTraining(result.activeJutsuTraining ?? null);
            setJutsuNotice({
                tone: "success",
                message: mastery.level === 0
                    ? `${selectedJutsu.name} unlocked at level 1.`
                    : `${selectedJutsu.name} training started. Your ryo payment is saved.`,
            });
        } finally {
            endJutsuAction();
        }
    }

    async function completePaidJutsuTraining() {
        if (!requireServerSettlement("timedJutsuTraining")) return;
        if (!activeJutsuTraining) return;
        if (serverNow() < activeJutsuTraining.endsAt) {
            alert(`Training still has ${formatTrainingTime(activeJutsuTraining.endsAt - serverNow())} left.`);
            return;
        }

        // A pre-modern lease has no serverToken. Refusing it here (rather than
        // letting the server settle it from its own sealed fields) is what left
        // these sessions un-collectible AND un-cancellable — a permanent block on
        // starting any new jutsu training. The server admits exactly this case now.
        if (!beginJutsuAction("claim")) return;
        try {
            const result = await mutateJutsuRyoTraining(character.name, 'complete', { serverToken: activeJutsuTraining.serverToken ?? '' });
            if (!result.character) return rejectJutsuAction(result.error);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            setJutsuNotice({ tone: "success", message: `${activeJutsuTraining.label} reached level ${activeJutsuTraining.toLevel}.` });
            setActiveJutsuTraining(result.activeJutsuTraining ?? null);
        } finally {
            endJutsuAction();
        }
    }

    // Cancellation/refund is derived from the server-sealed active session.
    async function cancelPaidJutsuTraining() {
        if (!requireServerSettlement("timedJutsuTraining")) return;
        if (!activeJutsuTraining) return;
        const refund = Math.floor(activeJutsuTraining.ryoCost * 0.5);
        if (!(await gameConfirm(`Cancel ${activeJutsuTraining.label} training? You'll get ${refund} ryo back (50% of ${activeJutsuTraining.ryoCost}) and forfeit the training progress.`))) return;
        if (!beginJutsuAction("cancel")) return;
        try {
            const result = await mutateJutsuRyoTraining(character.name, 'cancel', { serverToken: activeJutsuTraining.serverToken ?? '' });
            if (!result.character) return rejectJutsuAction(result.error);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            setActiveJutsuTraining(result.activeJutsuTraining ?? null);
            setJutsuNotice({ tone: "success", message: `Training cancelled. ${result.refund ?? refund} ryo returned.` });
        } finally {
            endJutsuAction();
        }
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
        if (!activeJutsuTraining.serverToken) return rejectJutsuAction('invalid-or-legacy-jutsu-training');
        if (!beginJutsuAction("finish")) return;
        try {
            const result = await mutateJutsuRyoTraining(character.name, 'finish', { serverToken: activeJutsuTraining.serverToken });
            if (!result.character) return rejectJutsuAction(result.error);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            setActiveJutsuTraining(result.activeJutsuTraining ?? null);
            setJutsuNotice({ tone: "success", message: `${activeJutsuTraining.label} reached level ${activeJutsuTraining.toLevel}.` });
        } finally {
            endJutsuAction();
        }
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
        if (!activeJutsuTraining.serverToken) return rejectJutsuAction('invalid-or-legacy-jutsu-training');
        if (!beginJutsuAction("queue")) return;
        try {
            const result = await mutateJutsuRyoTraining(character.name, 'queue', {
                serverToken: activeJutsuTraining.serverToken,
                jutsuId: selectedJutsu.id,
                label: selectedJutsu.name,
                trainingBonusPct: jutsuTrainingBonus,
            });
            if (!result.character) return rejectJutsuAction(result.error);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            setActiveJutsuTraining(result.activeJutsuTraining ?? null);
            setJutsuNotice({ tone: "success", message: `${selectedJutsu.name} is queued and already paid for.` });
        } finally {
            endJutsuAction();
        }
    }

    // Remove the queued 2nd training before it starts — full ryo refund (it never ran).
    async function cancelQueuedJutsuTraining() {
        if (!requireServerSettlement("timedJutsuTrainingQueue")) return;
        if (!activeJutsuTraining?.next) return;
        const queued = activeJutsuTraining.next;
        if (!(await gameConfirm(`Remove the queued ${queued.label} training? You'll get all ${queued.ryoCost} ryo back — it hasn't started.`))) return;
        if (!activeJutsuTraining.serverToken) return rejectJutsuAction('invalid-or-legacy-jutsu-training');
        if (!beginJutsuAction("cancel-queue")) return;
        try {
            const result = await mutateJutsuRyoTraining(character.name, 'cancel-queue', { serverToken: activeJutsuTraining.serverToken });
            if (!result.character) return rejectJutsuAction(result.error);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            setActiveJutsuTraining(result.activeJutsuTraining ?? null);
            setJutsuNotice({ tone: "success", message: `Queued lesson removed. ${result.refund ?? queued.ryoCost} ryo returned.` });
        } finally {
            endJutsuAction();
        }
    }

    const selectedJutsu = allJutsus.find((jutsu) => jutsu.id === selectedJutsuId);
    const selectedMastery = selectedJutsu ? getJutsuMastery(character, selectedJutsu.id) : null;
    const selectedCost = selectedMastery ? jutsuTrainingCost(selectedMastery.level) : 0;
    const selectedDuration = selectedMastery ? jutsuTrainingDuration(selectedMastery.level) : 0;
    const activeRemaining = activeJutsuTraining ? activeJutsuTraining.endsAt - now : 0;
    const activeDuration = activeJutsuTraining ? Math.max(1, activeJutsuTraining.endsAt - activeJutsuTraining.startedAt) : 1;
    const activeProgress = activeJutsuTraining
        ? Math.max(0, Math.min(100, ((now - activeJutsuTraining.startedAt) / activeDuration) * 100))
        : 0;
    const tagLensDiscipline = playerLensDiscipline(character);
    const mobileInfoJutsu = availableJutsus.find((jutsu) => jutsu.id === mobileJutsuInfoId) ?? null;
    const mobileInfoMastery = mobileInfoJutsu ? getJutsuMastery(character, mobileInfoJutsu.id) : null;
    const mobileInfoCost = mobileInfoMastery ? jutsuTrainingCost(mobileInfoMastery.level) : 0;
    const mobileInfoAtCap = !!mobileInfoMastery && mobileInfoMastery.level >= ryoTrainCap;
    const mobileInfoInsufficientRyo = !!mobileInfoMastery && mobileInfoMastery.level > 0 && character.ryo < mobileInfoCost;

    function renderJutsuDetails(jutsu: Jutsu) {
        const mastery = getJutsuMastery(character, jutsu.id);
        const scaled = scaleJutsuByLevel(jutsu, mastery.level);
        const cost = jutsuTrainingCost(mastery.level);
        const duration = jutsuTrainingDuration(mastery.level);
        const displayJutsu = jutsuDisplayAtLevel(jutsu, mastery.level);
        const targeting = jutsuTargetingLabel(jutsu);
        return (
            <div className="jutsu-detail-stack">
                <div className="jutsu-detail-badges"><span>Lv {mastery.level}/50</span><span>{jutsu.type}</span><span>{jutsu.element}</span></div>
                <p className="jutsu-detail-description">{jutsu.description || jutsu.battleDescription}</p>
                <div className="jutsu-detail-metrics">
                    <span><small>Mastery XP</small><strong>{mastery.xp}/{mastery.level >= 50 ? "MAX" : jutsuXpNeeded(mastery.level)}</strong></span>
                    <span><small>Action points</small><strong>{jutsu.ap}</strong></span>
                    <span><small>Range</small><strong>{jutsu.range}</strong></span>
                    <span><small>Effect power</small><strong>{scaled.scaledEffectPower}</strong></span>
                </div>
                <p><strong>Targeting · {targeting.short}</strong><br />{targeting.detail}</p>
                <p><strong>Resource cost</strong><br />{jutsuResourceDisplay(jutsu, "chakra", character.level, character.specialty, mastery.level)} chakra · {jutsuResourceDisplay(jutsu, "stamina", character.level, character.specialty, mastery.level)} stamina</p>
                <p><strong>Tags</strong><br />{displayJutsu.tags.map((tag) => `${tag.name}${tag.percent ? ` ${tag.percent}%` : ""}`).join(", ") || "None"}</p>
                <p><strong>Training route</strong><br />{mastery.level === 0 ? "Free, instant level 1 unlock" : mastery.level < ryoTrainCap ? `${cost.toLocaleString()} ryo · ${duration / 60000} min · +1 level` : "Battle-earned mastery"}</p>
                <p><strong>Effects</strong><br />{describeJutsuEffects(jutsu, mastery.level, tagLensDiscipline)}</p>
                <JutsuEffectCards jutsu={jutsu} scaledEffectPower={scaled.scaledEffectPower} masteryLevel={mastery.level} lensDiscipline={tagLensDiscipline} />
            </div>
        );
    }

    const showAcademyJutsuHint = academyJutsuStep;
    const queued = activeJutsuTraining?.next ?? null;
    const moraleName = String(warMorale.morale);
    const moralePercent = Math.max(0, Math.round(Math.abs(1 - warMorale.jutsuTimeMult) * 100));
    const moraleIsPositive = warMorale.jutsuTimeMult <= 1;
    const moraleMessage = moraleName === "rallying"
        ? `Rallying comeback: your village trains jutsu ${moralePercent}% faster until ${new Date(warMorale.until).toLocaleDateString()}.`
        : moraleName === "triumphant"
            ? `Victorious: your village carries the pride of its last war until ${new Date(warMorale.until).toLocaleDateString()}.`
            : `Village morale changes jutsu training speed by ${moralePercent}% until ${new Date(warMorale.until).toLocaleDateString()}.`;
    const activeTrainingPanel = activeJutsuTraining ? (
        <section className={`jutsu-session-card${activeRemaining <= 0 ? " is-ready" : ""}`} aria-labelledby="active-jutsu-title">
            <div className="jutsu-panel-title-row">
                <div>
                    <span className="jutsu-eyebrow">Active lesson</span>
                    <h3 id="active-jutsu-title">{activeJutsuTraining.label}</h3>
                </div>
                <span className={`jutsu-status-chip${activeRemaining <= 0 ? " ready" : ""}`}>
                    {activeRemaining <= 0 ? "Ready" : "In progress"}
                </span>
            </div>
            <div className="jutsu-level-route" aria-label={`Level ${activeJutsuTraining.fromLevel} to level ${activeJutsuTraining.toLevel}`}>
                <strong>Lv {activeJutsuTraining.fromLevel}</strong>
                <div className="jutsu-progress-track" aria-hidden="true"><span style={{ width: `${activeProgress}%` }} /></div>
                <strong>Lv {activeJutsuTraining.toLevel}</strong>
            </div>
            <div className="jutsu-session-metrics">
                <span><small>Time remaining</small><strong>{activeRemaining > 0 ? formatTrainingTime(activeRemaining) : "Complete"}</strong></span>
                <span><small>Ryo paid</small><strong>{activeJutsuTraining.ryoCost.toLocaleString()}</strong></span>
            </div>
            <p className="jutsu-session-message">
                {activeRemaining > 0
                    ? "Your lesson is sealed on the server. You can leave this page safely."
                    : queued
                        ? "Complete — the queued lesson is being promoted."
                        : activeJutsuTraining.autoClaim
                            ? "Complete — claiming your new level."
                            : "Lesson complete. Claim the level when ready."}
            </p>
            <div className="jutsu-action-row">
                {!queued && !activeJutsuTraining.autoClaim && (
                    <button className="jutsu-primary-action" type="button" onClick={completePaidJutsuTraining} disabled={activeRemaining > 0 || !!jutsuAction}>
                        {jutsuAction === "claim" ? "Claiming…" : activeRemaining > 0 ? "Claim when ready" : "Claim jutsu level"}
                    </button>
                )}
                {activeRemaining > 0 && !queued && (
                    <button className="jutsu-secondary-action" type="button" onClick={cancelPaidJutsuTraining} disabled={!!jutsuAction}>Cancel · 50% refund</button>
                )}
                {activeRemaining > 0 && (
                    <button className="jutsu-finish-action" type="button" onClick={finishWithRyo} disabled={!!jutsuAction || character.ryo < jutsuRyoFinishCost(activeRemaining)}>
                        {jutsuAction === "finish" ? "Finishing…" : `Finish now · ${jutsuRyoFinishCost(activeRemaining).toLocaleString()} ryo`}
                    </button>
                )}
            </div>
            {queued ? (
                <div className="jutsu-queue-card">
                    <div><span className="jutsu-eyebrow"><GiFastForwardButton /> Up next</span><strong>{queued.label}</strong></div>
                    <span>Lv {queued.fromLevel} → {queued.toLevel}</span>
                    <span>{queued.ryoCost.toLocaleString()} ryo paid · ~{Math.round(queued.durationMs / 60000)} min</span>
                    <button type="button" onClick={cancelQueuedJutsuTraining} disabled={!!jutsuAction}>{jutsuAction === "cancel-queue" ? "Removing…" : "Remove · full refund"}</button>
                </div>
            ) : (
                <div className="jutsu-queue-empty">
                    <div><span className="jutsu-eyebrow">Queue slot</span><p>Select a technique below, then reserve its next lesson now.</p></div>
                    <button type="button" onClick={queueNextJutsuTraining} disabled={!selectedJutsu || !!jutsuAction}>
                        {jutsuAction === "queue" ? "Saving queue…" : `Queue ${selectedJutsu ? selectedJutsu.name : "selected jutsu"}`}
                    </button>
                </div>
            )}
        </section>
    ) : showAcademyJutsuHint ? (
        <div className="academy-inline-callout academy-jutsu-callout">
            <strong>Academy Training:</strong> your bloodline gave you starter jutsu. Unlock one more here, then equip it from Profile so it appears in your battle loadout.
        </div>
    ) : null;

    const selectedAtCap = !!selectedMastery && selectedMastery.level >= ryoTrainCap;
    const selectedInsufficientRyo = !!selectedMastery && selectedMastery.level > 0 && character.ryo < selectedCost;

    return (
        <div className="card jutsu-training-screen">
            <BackToVillageButton onClick={onBack} label="← Back" />

            <header className="jutsu-hall-hero">
                <span className="jutsu-eyebrow">Technique development</span>
                <h2>Jutsu Training Hall</h2>
                <p>Study techniques with ryo through level 30. Advanced mastery from levels 31–50 is earned in battle.</p>
                <div className="jutsu-hall-stats" aria-label="Training hall status">
                    <span><small>Hall cap</small><strong>Lv {ryoTrainCap}</strong></span>
                    <span><small>Available ryo</small><strong>{character.ryo.toLocaleString()}</strong></span>
                    <span><small>Elements</small><strong>{ownedElements.length ? ownedElements.join(" · ") : "None awakened"}</strong></span>
                    <span><small>Speed bonus</small><strong>+{jutsuTrainingBonus.toFixed(2)}%</strong></span>
                </div>
            </header>

            {jutsuNotice && (
                <div className={`jutsu-notice ${jutsuNotice.tone}`} role={jutsuNotice.tone === "error" ? "alert" : "status"} aria-live="polite">
                    <strong>{jutsuNotice.tone === "error" ? "Training not saved" : jutsuNotice.tone === "success" ? "Hall updated" : "Training note"}</strong>
                    <span>{jutsuNotice.message}</span>
                    <button type="button" aria-label="Dismiss training notice" onClick={() => setJutsuNotice(null)}>×</button>
                </div>
            )}

            {(warMorale.morale !== "none" || lockedElementCount > 0) && (
                <div className="jutsu-hall-alerts">
                    {warMorale.morale !== "none" && <p className={moraleIsPositive ? "positive" : "negative"}>{moraleMessage}</p>}
                    {lockedElementCount > 0 && <p>{lockedElementCount} techniques remain hidden until their element is awakened.</p>}
                </div>
            )}

            <div className={`jutsu-training-dashboard${activeJutsuTraining ? " has-session" : ""}`}>
                {activeTrainingPanel}
                <section className="jutsu-plan-card" aria-labelledby="jutsu-plan-title">
                    <div className="jutsu-panel-title-row">
                        <div>
                            <span className="jutsu-eyebrow">Selected curriculum</span>
                            <h3 id="jutsu-plan-title">{selectedJutsu?.name ?? "Choose a technique"}</h3>
                        </div>
                        {selectedMastery && <span className="jutsu-status-chip">Lv {selectedMastery.level}</span>}
                    </div>
                    {selectedJutsu && selectedMastery ? (
                        <>
                            <div className="jutsu-plan-preview">
                                <span className="jutsu-plan-art">{selectedJutsu.image ? <img src={selectedJutsu.image} alt="" /> : selectedJutsu.type.slice(0, 3).toUpperCase()}</span>
                                <div>
                                    <span>{selectedJutsu.type} · {selectedJutsu.element}</span>
                                    <strong>Level {selectedMastery.level} → {Math.min(ryoTrainCap, selectedMastery.level + 1)}</strong>
                                    <small>{selectedAtCap ? "Battle-earned mastery from here" : "One complete mastery level"}</small>
                                </div>
                            </div>
                            <div className="jutsu-plan-metrics">
                                <span><small>Tuition</small><strong>{selectedMastery.level === 0 ? "Free" : `${selectedCost.toLocaleString()} ryo`}</strong></span>
                                <span><small>Duration</small><strong>{selectedMastery.level === 0 ? "Instant" : `${selectedDuration / 60000} min`}</strong></span>
                                <span><small>Reward</small><strong>+1 level</strong></span>
                            </div>
                            <button
                                className={`jutsu-primary-action jutsu-start-action${showAcademyJutsuHint && selectedMastery.level === 0 ? " academy-click-target" : ""}`}
                                data-academy-hint={showAcademyJutsuHint && selectedMastery.level === 0 ? "Next · unlock this" : undefined}
                                data-academy-autoscroll={showAcademyJutsuHint && selectedMastery.level === 0 ? "true" : undefined}
                                type="button"
                                onClick={startPaidJutsuTraining}
                                disabled={!!jutsuAction || !!activeJutsuTraining || selectedAtCap || selectedInsufficientRyo}
                            >
                                {jutsuAction === "start"
                                    ? "Saving lesson…"
                                    : activeJutsuTraining
                                        ? "Another lesson is active"
                                        : selectedAtCap
                                            ? "Battle training required"
                                            : selectedInsufficientRyo
                                                ? `Need ${(selectedCost - character.ryo).toLocaleString()} more ryo`
                                                : selectedMastery.level === 0
                                                    ? "Unlock level 1 · free"
                                                    : `Pay ${selectedCost.toLocaleString()} ryo & train`}
                            </button>
                            <p className="jutsu-plan-footnote">Payments and mastery claims are settled against your server save.</p>
                        </>
                    ) : <p className="jutsu-plan-empty">Choose a technique from the library below to preview its next lesson.</p>}
                </section>
            </div>

            <div className="jutsu-seal-wrap">
                <JutsuSealPanel character={character} updateCharacter={updateCharacter} selectedJutsu={selectedJutsu ?? null} selectedMastery={selectedMastery} activeJutsuTraining={activeJutsuTraining} setActiveJutsuTraining={setActiveJutsuTraining} />
            </div>

            <section className="jutsu-library" aria-labelledby="jutsu-library-title">
                <div className="jutsu-library-heading">
                    <div><span className="jutsu-eyebrow">Technique archive</span><h3 id="jutsu-library-title">Choose your next jutsu</h3></div>
                    <p>Select a card to update the curriculum panel. Use the filters to narrow a large collection.</p>
                </div>
                <JutsuDropdownList
                    jutsus={availableJutsus}
                    label="Jutsu library"
                    emptyText={ownedElements.length ? "No jutsu match your awakened elements." : "Awaken an element at the Awakening Stone before training elemental jutsu."}
                    selectedJutsuId={selectedJutsuId}
                    highlightJutsuId={showAcademyJutsuHint && selectedMastery?.level !== 0 ? academyUntrainedJutsuId : undefined}
                    renderDetails={renderJutsuDetails}
                    onSelectJutsu={(jutsu) => {
                        setSelectedJutsuId(jutsu.id);
                        if (typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches) {
                            setMobileJutsuInfoId(jutsu.id);
                        }
                    }}
                />
            </section>

            <Modal
                open={mobileInfoJutsu !== null}
                onClose={() => setMobileJutsuInfoId(null)}
                title={mobileInfoJutsu?.name ?? "Jutsu information"}
                size="md"
                className="jutsu-mobile-info-modal"
            >
                {mobileInfoJutsu && mobileInfoMastery && (
                    <div className="jutsu-mobile-info-content">
                        <div className="jutsu-mobile-info-hero">
                            <span>{mobileInfoJutsu.image ? <img src={mobileInfoJutsu.image} alt="" /> : mobileInfoJutsu.type.slice(0, 3).toUpperCase()}</span>
                            <div><strong>{mobileInfoJutsu.name}</strong><small>{mobileInfoJutsu.type} · {mobileInfoJutsu.element} · Level {mobileInfoMastery.level}</small></div>
                        </div>
                        {renderJutsuDetails(mobileInfoJutsu)}
                        <button
                            className={`jutsu-mobile-train-action${showAcademyJutsuHint && mobileInfoMastery.level === 0 ? " academy-click-target" : ""}`}
                            data-academy-hint={showAcademyJutsuHint && mobileInfoMastery.level === 0 ? "Next · unlock this" : undefined}
                            type="button"
                            disabled={!!jutsuAction || !!activeJutsuTraining || mobileInfoAtCap || mobileInfoInsufficientRyo}
                            onClick={() => {
                                setMobileJutsuInfoId(null);
                                void startPaidJutsuTraining();
                            }}
                        >
                            {jutsuAction === "start"
                                ? "Saving lesson…"
                                : activeJutsuTraining
                                    ? "Another lesson is active"
                                    : mobileInfoAtCap
                                        ? "Battle training required"
                                        : mobileInfoInsufficientRyo
                                            ? `Need ${(mobileInfoCost - character.ryo).toLocaleString()} more ryo`
                                            : mobileInfoMastery.level === 0
                                                ? "Unlock level 1 · free"
                                                : `Train · ${mobileInfoCost.toLocaleString()} ryo`}
                        </button>
                    </div>
                )}
            </Modal>
        </div>
    );
}

type JutsuHallNotice = { tone: "success" | "error" | "info"; message: string };

function friendlyJutsuTrainingError(error: string | undefined): string {
    const messages: Record<string, string> = {
        "jutsu-training-already-active": "A jutsu session is already active. Refresh the hall if it is not shown here.",
        "invalid-or-legacy-jutsu-training": "This training session is out of date. Refresh the game before trying again.",
        "training-not-finished": "That lesson is still in progress.",
        "not-enough-ryo": "You do not have enough ryo for that lesson.",
        "jutsu-at-training-cap": "That jutsu has reached its current Training Hall cap.",
        "jutsu-training-queue-full": "The training queue already has a second lesson.",
        "unknown-or-unowned-jutsu": "That jutsu is no longer available to this character.",
        "bloodline-required": "Equip the bloodline that grants this jutsu before training it.",
    };
    return messages[String(error ?? "")] ?? error ?? "Jutsu training could not be saved. Please retry.";
}
