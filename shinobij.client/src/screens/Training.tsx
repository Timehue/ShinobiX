/**
 * Training screens — stat training (Training), jutsu seal/paid training
 * (JutsuSealPanel, JutsuTrainingHall) and the previewSealCost helper.
 * Prop-driven, extracted verbatim from App.tsx with no behavior change
 * (training timers, costs, durations, XP/stat formulas unchanged). The
 * file-wide eslint-disable mirrors App.tsx for the verbatim-moved logic.
 */
/* eslint-disable react-hooks/purity */
import type React from "react";
import { useState, useEffect } from "react";
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
import { getJutsuMastery, jutsuXpNeeded, scaleJutsuByLevel } from "../lib/jutsu-scaling";
import { applyJutsuTrainingLevel, jutsuRyoTrainCap } from "../lib/jutsu-training-queue";
import { describeJutsuEffects, jutsuDisplayAtLevel } from "../lib/jutsu-effects";
import { boostAmount, getJutsuTrainingSpeedBonus, getTrainingXpBonus } from "../lib/village-upgrades";
import { capStat, formatStatName } from "../lib/stats";
import { canEquipElementJutsu } from "../lib/bloodline";
import { effectiveCharacterXpGain } from "../lib/progression";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { getCharacterElements } from "../lib/elements";
import { useWarLossDebuff } from "../lib/war-debuff";
import { CHARACTER_XP_GAIN_MULTIPLIER, JUTSU_TRAINING_CAP, MAX_STAT } from "../constants/game";
import { gainXp, getAllJutsus, playerLensDiscipline, statPointsEarnedFromXp } from "../App";
import type { Character } from "../types/character";
import type { Jutsu, JutsuMastery, Stats, SavedBloodline, ActiveTraining, ActiveJutsuTraining } from "../types/combat";

export function Training({ character, updateCharacter, activeTraining, setActiveTraining, onBack }: { character: Character; updateCharacter: (character: Character) => void; activeTraining: ActiveTraining | null; setActiveTraining: (training: ActiveTraining | null) => void; onBack: () => void }) {
    const [selectedStat, setSelectedStat] = useState<keyof Stats>("strength");
    // -10% stat-training XP while the village is "demoralized" from a war loss.
    const warDebuff = useWarLossDebuff(character.village);
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
    const timers = [
        { label: "15 Minutes", icon: <GiStopwatch />, ms: 15 * 60 * 1000, xp: 20, statGain: 1, staminaCost: 5 },
        { label: "1 Hour",     icon: <GiAlarmClock />, ms: 60 * 60 * 1000, xp: 70, statGain: 3, staminaCost: 15 },
        { label: "4 Hours",    icon: <GiSandsOfTime />, ms: 4 * 60 * 60 * 1000, xp: 220, statGain: 8, staminaCost: 35 },
        { label: "8 Hours",    icon: <GiNightSleep />, ms: 8 * 60 * 60 * 1000, xp: 375, statGain: 14, staminaCost: 60 },
    ];
    const trainingXpBonus = getTrainingXpBonus(character);
    function startTraining(timer: typeof timers[number]) { if (activeTraining) return alert("You are already training."); if (character.stamina < timer.staminaCost) return alert("Not enough stamina."); const boostedXp = Math.max(0, Math.round(boostAmount(timer.xp, trainingXpBonus) * warDebuff.xpMult)); updateCharacter({ ...character, stamina: character.stamina - timer.staminaCost }); setActiveTraining({ label: `${timer.label} ${selectedStat} Training`, stat: selectedStat, xp: boostedXp, statGain: statPointsEarnedFromXp(character, boostedXp), staminaCost: timer.staminaCost, endsAt: Date.now() + timer.ms, durationMs: timer.ms }); }
    // Cancel an in-progress stat training and keep the prorated reward — the XP
    // (and the stat points it yields) scaled by the fraction of time elapsed.
    // Runs the exact completion logic on the prorated XP so leveling, stat caps
    // and unspent-point limits behave identically to a full claim. Stamina spent
    // to start is not refunded.
    function cancelTraining() {
        if (!activeTraining) return;
        const totalMs = activeTraining.durationMs ?? timers.find((t) => activeTraining.label.startsWith(t.label))?.ms ?? 0;
        const remaining = Math.max(0, activeTraining.endsAt - Date.now());
        const progress = totalMs > 0 ? Math.min(1, Math.max(0, 1 - remaining / totalMs)) : 1;
        const proratedXp = Math.floor(activeTraining.xp * progress);
        if (!confirm(`Cancel ${activeTraining.label}? You'll keep ${Math.round(progress * 100)}% of the progress (${proratedXp} XP) and the stat points it earns. Stamina already spent is not refunded.`)) return;
        const earnedStatPoints = statPointsEarnedFromXp(character, proratedXp);
        const leveled = gainXp(character, proratedXp);
        const focusedGain = Math.min(earnedStatPoints, leveled.unspentStats, MAX_STAT - leveled.stats[activeTraining.stat]);
        updateCharacter({ ...leveled, unspentStats: leveled.unspentStats - focusedGain, totalStatsTrained: (leveled.totalStatsTrained ?? 0) + focusedGain, stats: { ...leveled.stats, [activeTraining.stat]: capStat(leveled.stats[activeTraining.stat] + focusedGain) } });
        alert(`Training cancelled. ${focusedGain > 0 ? `${focusedGain} prorated stat point${focusedGain !== 1 ? "s" : ""} went into ${formatStatName(activeTraining.stat)}.` : "Not enough progress to earn a stat point."}`);
        setActiveTraining(null);
    }
    function completeTraining() { if (!activeTraining) return; if (Date.now() < activeTraining.endsAt) return alert(`Training still has ${Math.ceil((activeTraining.endsAt - Date.now()) / 1000)} seconds left.`); const earnedStatPoints = statPointsEarnedFromXp(character, activeTraining.xp); const leveled = gainXp(character, activeTraining.xp); const focusedGain = Math.min(earnedStatPoints, leveled.unspentStats, MAX_STAT - leveled.stats[activeTraining.stat]); updateCharacter({ ...leveled, unspentStats: leveled.unspentStats - focusedGain, totalStatsTrained: (leveled.totalStatsTrained ?? 0) + focusedGain, stats: { ...leveled.stats, [activeTraining.stat]: capStat(leveled.stats[activeTraining.stat] + focusedGain) } }); alert(`${activeTraining.label} complete. ${focusedGain > 0 ? `${focusedGain} earned stat point${focusedGain !== 1 ? "s" : ""} went into ${formatStatName(activeTraining.stat)}.` : "No new stat point was earned from this XP tick."}`); setActiveTraining(null); }
    return (
        <div className="card">
            <BackToVillageButton onClick={onBack} label="← Back" />
            <h2>Training Grounds</h2>
            <p>Stamina: {character.stamina}/{character.maxStamina} · Town Hall XP Bonus: <strong>{trainingXpBonus.toFixed(2)}%</strong>{CHARACTER_XP_GAIN_MULTIPLIER !== 1 ? <> · Testing XP: <strong>{CHARACTER_XP_GAIN_MULTIPLIER}x</strong></> : null}</p>

            {activeTraining && (
                <div className="summary-box">
                    <h3>Active Training</h3>
                    <p>{activeTraining.label}</p>
                    <p>Ends: {new Date(activeTraining.endsAt).toLocaleTimeString()}</p>
                    <button onClick={completeTraining}>Complete Training</button>
                    <button onClick={cancelTraining} style={{ marginLeft: 8 }}>Cancel (keep prorated stats)</button>
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
                    const boostedXp = Math.max(0, Math.round(boostAmount(timer.xp, trainingXpBonus) * warDebuff.xpMult));
                    const effectiveXp = effectiveCharacterXpGain(character, boostedXp);
                    const earnedPoints = statPointsEarnedFromXp(character, boostedXp);
                    return (
                        <button key={timer.label} className="location-button" onClick={() => startTraining(timer)}>
                            <span className="tile-icon">{timer.icon}</span>
                            <span>{timer.label}</span>
                            <small>+{effectiveXp} XP / ~{earnedPoints} stat point{earnedPoints !== 1 ? "s" : ""}</small>
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
    const [msg, setMsg] = useState<string | null>(null);

    const hasDiscount = character.profession === "vanguard" && (character.professionRank ?? 0) >= 8;
    const fromLevel = selectedMastery?.level ?? 0;
    const eligibleForSealLevel = !!selectedJutsu && fromLevel >= 30 && fromLevel < 40;
    const sealLevelCost = eligibleForSealLevel ? previewSealCost(fromLevel, character) : 0;
    const balance = character.honorSeals ?? 0;

    async function trainWithSeals() {
        if (!selectedJutsu || !eligibleForSealLevel || busy) return;
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
                setBusy(false);
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
            setMsg('❌ Network error');
        }
        setBusy(false);
    }

    async function speedUp(sealsRequested: number) {
        if (!activeJutsuTraining || busy) return;
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
                setBusy(false);
                return;
            }
            const minutesReduced: number = Number(data.minutesReduced ?? 0);
            const reductionMs = minutesReduced * 60 * 1000;
            setActiveJutsuTraining({
                ...activeJutsuTraining,
                endsAt: Math.max(Date.now(), activeJutsuTraining.endsAt - reductionMs),
            });
            updateCharacter(prev => prev ? ({ ...prev, honorSeals: Number(data.honorSealsRemaining) }) : prev);
            setMsg(`✅ -${minutesReduced} min (spent ${data.sealsSpent} Seals)`);
        } catch {
            setMsg('❌ Network error');
        }
        setBusy(false);
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
                {activeJutsuTraining && Date.now() < activeJutsuTraining.endsAt && (
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
    const warDebuff = useWarLossDebuff(character.village);
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

    function setJutsuMasteryLevel(jutsuId: string, level: number): Character {
        // Rank-capped + never-downgrading (lib/jutsu-training-queue): ryo training
        // now respects the player's rank jutsu cap, not only the Hall's level-30 cap.
        return applyJutsuTrainingLevel(character, jutsuId, level);
    }

    function startPaidJutsuTraining() {
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

        // First level is always free and instant
        if (mastery.level === 0) {
            updateCharacter(setJutsuMasteryLevel(selectedJutsu.id, 1));
            alert(`${selectedJutsu.name} unlocked at level 1 for free!`);
            return;
        }

        const cost = jutsuTrainingCost(mastery.level);
        if (character.ryo < cost) return alert(`Not enough ryo. You need ${cost}.`);

        const baseDuration = jutsuTrainingDuration(mastery.level);
        // +20% jutsu training time while the village is "demoralized" from a war loss.
        const duration = Math.max(60_000, Math.floor(baseDuration * Math.max(0.1, 1 - jutsuTrainingBonus / 100) * warDebuff.jutsuTimeMult));
        updateCharacter({ ...character, ryo: character.ryo - cost });
        setActiveJutsuTraining({
            jutsuId: selectedJutsu.id,
            label: selectedJutsu.name,
            fromLevel: mastery.level,
            toLevel: Math.min(ryoTrainCap, mastery.level + 1),
            ryoCost: cost,
            startedAt: Date.now(),
            endsAt: Date.now() + duration,
        });
    }

    function completePaidJutsuTraining() {
        if (!activeJutsuTraining) return;
        if (Date.now() < activeJutsuTraining.endsAt) {
            alert(`Training still has ${formatTrainingTime(activeJutsuTraining.endsAt - Date.now())} left.`);
            return;
        }

        updateCharacter(setJutsuMasteryLevel(activeJutsuTraining.jutsuId, activeJutsuTraining.toLevel));
        alert(`${activeJutsuTraining.label} reached level ${activeJutsuTraining.toLevel}.`);
        setActiveJutsuTraining(null);
    }

    // Cancel an in-progress jutsu training and refund 50% of the ryo paid. The
    // training level is not granted and the progress is forfeited. Ryo training
    // is client-authoritative (the debit on start has no server endpoint), so
    // the symmetric refund stays client-side too.
    function cancelPaidJutsuTraining() {
        if (!activeJutsuTraining) return;
        const refund = Math.floor(activeJutsuTraining.ryoCost * 0.5);
        if (!confirm(`Cancel ${activeJutsuTraining.label} training? You'll get ${refund} ryo back (50% of ${activeJutsuTraining.ryoCost}) and forfeit the training progress.`)) return;
        updateCharacter({ ...character, ryo: character.ryo + refund });
        setActiveJutsuTraining(null);
        alert(`Training cancelled. Refunded ${refund} ryo.`);
    }

    // Pay ryo to finish the ACTIVE training instantly. Debits ryo client-side
    // (mirrors the start-cost debit — no server endpoint) and zeroes the timer;
    // the existing claim button / queue-runner then grants the level (and promotes
    // any queued 2nd training) exactly as a natural completion would.
    function finishWithRyo() {
        if (!activeJutsuTraining) return;
        const remainingMs = activeJutsuTraining.endsAt - Date.now();
        if (remainingMs <= 0) return;
        const cost = jutsuRyoFinishCost(remainingMs);
        if (character.ryo < cost) return alert(`Not enough ryo. You need ${cost.toLocaleString()} ryo to finish instantly.`);
        if (!confirm(`Finish ${activeJutsuTraining.label} training now for ${cost.toLocaleString()} ryo?`)) return;
        updateCharacter({ ...character, ryo: character.ryo - cost });
        setActiveJutsuTraining({ ...activeJutsuTraining, endsAt: Date.now() });
    }

    // Queue a 2nd jutsu training behind the active one. Ryo is paid + the duration
    // locked NOW; the global runner (lib/jutsu-training-queue) promotes it the moment
    // the active training completes. Stored on activeJutsuTraining.next.
    function queueNextJutsuTraining() {
        if (!activeJutsuTraining) return alert("Start a training first, then queue the next one.");
        if (activeJutsuTraining.next) return alert("A 2nd jutsu is already queued.");
        const selectedJutsu = allJutsus.find((jutsu) => jutsu.id === selectedJutsuId);
        if (!selectedJutsu || !canEquipElementJutsu(character, selectedJutsu, savedBloodlines)) {
            return alert(`You need the ${selectedJutsu?.element ?? "required"} element to train this jutsu.`);
        }
        // If the SAME jutsu is currently training, the queued run starts from the
        // level it's about to reach; otherwise from the jutsu's stored level.
        const fromLevel = selectedJutsu.id === activeJutsuTraining.jutsuId
            ? activeJutsuTraining.toLevel
            : getJutsuMastery(character, selectedJutsu.id).level;
        if (fromLevel >= ryoTrainCap) {
            return alert(fromLevel >= JUTSU_TRAINING_CAP
                ? "That jutsu would be at the Hall cap (Lv 30) — higher levels come from battles."
                : "That jutsu would be at your rank's training cap. Rank up to train it further.");
        }
        if (fromLevel === 0) return alert("Level 0 → 1 is free & instant — just train it directly, no need to queue.");
        const cost = jutsuTrainingCost(fromLevel);
        if (character.ryo < cost) return alert(`Not enough ryo to queue. You need ${cost}.`);
        const baseDuration = jutsuTrainingDuration(fromLevel);
        const durationMs = Math.max(60_000, Math.floor(baseDuration * Math.max(0.1, 1 - jutsuTrainingBonus / 100) * warDebuff.jutsuTimeMult));
        updateCharacter({ ...character, ryo: character.ryo - cost });
        setActiveJutsuTraining({
            ...activeJutsuTraining,
            next: {
                jutsuId: selectedJutsu.id,
                label: selectedJutsu.name,
                fromLevel,
                toLevel: Math.min(ryoTrainCap, fromLevel + 1),
                ryoCost: cost,
                durationMs,
            },
        });
    }

    // Remove the queued 2nd training before it starts — full ryo refund (it never ran).
    function cancelQueuedJutsuTraining() {
        if (!activeJutsuTraining?.next) return;
        const queued = activeJutsuTraining.next;
        if (!confirm(`Remove the queued ${queued.label} training? You'll get all ${queued.ryoCost} ryo back — it hasn't started.`)) return;
        updateCharacter({ ...character, ryo: character.ryo + queued.ryoCost });
        setActiveJutsuTraining({ ...activeJutsuTraining, next: null });
        alert(`Queued training removed. Refunded ${queued.ryoCost} ryo.`);
    }

    const selectedJutsu = allJutsus.find((jutsu) => jutsu.id === selectedJutsuId);
    const selectedMastery = selectedJutsu ? getJutsuMastery(character, selectedJutsu.id) : null;
    const selectedCost = selectedMastery ? jutsuTrainingCost(selectedMastery.level) : 0;
    const selectedDuration = selectedMastery ? jutsuTrainingDuration(selectedMastery.level) : 0;
    const activeRemaining = activeJutsuTraining ? activeJutsuTraining.endsAt - now : 0;
    const tagLensDiscipline = playerLensDiscipline(character);
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
    ) : null;

    return <div className="card jutsu-training-screen"><BackToVillageButton onClick={onBack} label="← Back" /><JutsuSealPanel character={character} updateCharacter={updateCharacter} selectedJutsu={selectedJutsu ?? null} selectedMastery={selectedMastery} activeJutsuTraining={activeJutsuTraining} setActiveJutsuTraining={setActiveJutsuTraining} /><h2>Jutsu Training Hall</h2><p>Train jutsu to <strong>Level 30</strong> with ryo. Levels <strong>31-50</strong> must be earned from battles. Your elements: <strong>{ownedElements.length ? ownedElements.join(" / ") : "None awakened"}</strong>. Town Hall + Aura training bonus: <strong>{jutsuTrainingBonus.toFixed(2)}%</strong>.</p>{lockedElementCount > 0 && <p className="hint">{lockedElementCount} jutsu locked until you awaken their element.</p>}{activeTrainingPanel}<h3>Paid Ryo Training</h3><div className="summary-box"><p>{selectedJutsu ? <><strong>{selectedJutsu.name}</strong> will train from level {selectedMastery?.level ?? 0} to {Math.min(ryoTrainCap, (selectedMastery?.level ?? 0) + 1)}.</> : "Choose a jutsu to train."}</p><p>{selectedMastery?.level === 0 ? <><strong>Free & Instant</strong> — Level 0 → 1</> : <>Cost: <strong>{selectedCost}</strong> ryo | Time: <strong>{selectedDuration / 60000}</strong> minutes | Reward: <strong>1 full jutsu level</strong></>}</p><button onClick={startPaidJutsuTraining} disabled={!selectedJutsu || !!activeJutsuTraining || !selectedMastery || selectedMastery.level >= ryoTrainCap || (selectedMastery.level > 0 && character.ryo < selectedCost)}>{activeJutsuTraining ? "Training In Progress" : selectedMastery && selectedMastery.level >= ryoTrainCap ? "Battle Training Required" : selectedMastery?.level === 0 ? "Unlock Level 1 (Free)" : `Pay ${selectedCost} Ryo & Train`}</button></div><JutsuDropdownList jutsus={availableJutsus} label="Choose Jutsu" emptyText={ownedElements.length ? "No jutsu match your awakened elements." : "Awaken an element at the Awakening Stone before training elemental jutsu."} renderDetails={(jutsu) => { const mastery = getJutsuMastery(character, jutsu.id); const scaled = scaleJutsuByLevel(jutsu, mastery.level); const cost = jutsuTrainingCost(mastery.level); const duration = jutsuTrainingDuration(mastery.level); const displayJutsu = jutsuDisplayAtLevel(jutsu, mastery.level); return <><p>Level: {mastery.level}/50 | XP: {mastery.xp}/{mastery.level >= 50 ? "MAX" : jutsuXpNeeded(mastery.level)}</p><p>Type: {jutsu.type} | Element: {jutsu.element} | AP: {jutsu.ap} | Range: {jutsu.range}</p><p>Scaled EP: {scaled.scaledEffectPower} | Chakra Cost: {scaled.chakraCost}% | Stamina Cost: {scaled.staminaCost}%</p><p>Tags: {displayJutsu.tags.map((tag) => `${tag.name}${tag.percent ? ` ${tag.percent}%` : ""}`).join(", ") || "None"}</p><p><strong>Paid Training:</strong> {mastery.level === 0 ? "Free & Instant — unlocks Level 1" : mastery.level < ryoTrainCap ? `${cost} ryo | ${duration / 60000} minutes | +1 full level` : "Battle only from here"}</p><p><strong>Effects:</strong> {describeJutsuEffects(jutsu, mastery.level, tagLensDiscipline)}</p><JutsuEffectCards jutsu={jutsu} scaledEffectPower={scaled.scaledEffectPower} masteryLevel={mastery.level} lensDiscipline={tagLensDiscipline} /><p>{selectedJutsuId === jutsu.id ? "Selected for paid training." : mastery.level < 30 ? "Training Hall available." : mastery.level < 50 ? "Battle only." : "Mastered."}</p></>; }} onSelectJutsu={(jutsu) => setSelectedJutsuId(jutsu.id)} /></div>;
}
