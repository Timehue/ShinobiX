import { playerLensDiscipline } from "../lib/player-lens-discipline";
import { getAllJutsus } from "../lib/jutsu-loadout";
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
import { describeJutsuEffects, jutsuDetailDescription, jutsuDisplayAtLevel, jutsuTargetingLabel } from "../lib/jutsu-effects";
import { getJutsuTrainingSpeedBonus, getTrainingXpBonus } from "../lib/village-upgrades";
import { formatStatName, earnedStatPoints, levelForEarned } from "../lib/stats";
import { canEquipElementJutsu, getCharacterBloodlines } from "../lib/bloodline";
import { bloodlineNamesByJutsuId, hasBloodlineMarker } from "../lib/bloodline-marker";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { getCharacterElements } from "../lib/elements";
import { useVillageWarMorale } from "../lib/war-debuff";
import { normalizeOnboardingStep } from "../lib/onboarding-step";
import { mutateJutsuRyoTraining } from "../lib/jutsu-ryo-api";
import { friendlyJutsuTrainingError, jutsuHallNoticeTitle, trainingResponseError, type JutsuHallNotice } from "../lib/training-feedback";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { AMBIGUOUS_ACTION_MESSAGE } from "../lib/ambiguous-action";
import { JUTSU_TRAINING_CAP, jutsuLevelCapForLevel } from "../constants/game";
import { masteryBonus, masteryHasCapstone } from "../lib/profession-mastery";

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
    const [trainingNotice, setTrainingNotice] = useState<string | null>(null);
    const trainingBusyRef = useRef(false);
    // Live 1s tick so the Active Training box shows a real countdown (not a static
    // end-time) and the Collect button unlocks the moment training is ready.
    const [now, setNow] = useState(() => serverNow());
    useEffect(() => {
        const id = setInterval(() => setNow(serverNow()), 1000);
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
        setTrainingNotice(null);
        try {
            const res = await fetch('/api/training/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: character.name, stat: selectedStat, tierId: timer.id }) });
            const data = await res.json().catch(() => ({})) as { token?: string; character?: Character; activeTraining?: ActiveTraining; _saveVersion?: number; error?: string };
            if (!res.ok || !data?.token || !data?.character || !data?.activeTraining) return alert(trainingResponseError(res.status, data?.error, 'Training could not be started.'));
            if (!onVersionedCharacter(data.character, data._saveVersion)) return alert(AMBIGUOUS_ACTION_MESSAGE);
            setActiveTraining(data.activeTraining as ActiveTraining);
            setTrainingNotice(`${data.activeTraining.label} started. You can keep playing while it runs.`);
        } catch {
            alert(AMBIGUOUS_ACTION_MESSAGE);
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
            if (!res.ok || !data?.granted || !data?.character) return alert(trainingResponseError(res.status, data?.error, 'Training could not be cancelled.'));
            if (!onVersionedCharacter(data.character, data._saveVersion)) return alert(AMBIGUOUS_ACTION_MESSAGE);
            setActiveTraining(data.activeTraining ?? null);
            const applied = Math.max(0, Math.floor(Number(data.applied) || 0));
            const overflow = Math.max(0, Math.floor(Number(data.overflow) || 0));
            const pooled = overflow > 0 ? ` +${overflow} to your unspent pool.` : "";
            setTrainingNotice(`Training cancelled. ${applied > 0 ? `+${applied} ${formatStatName(activeTraining.stat)} banked.` : "Not enough progress to bank a stat point."}${pooled} Stamina spent was not refunded.`);
        } catch {
            alert(AMBIGUOUS_ACTION_MESSAGE);
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
            if (!res.ok || !data?.granted || !data?.character) return alert(trainingResponseError(res.status, data?.error, 'Training could not be collected.'));
            if (!onVersionedCharacter(data.character, data._saveVersion)) return alert(AMBIGUOUS_ACTION_MESSAGE);
            setActiveTraining(data.activeTraining ?? null);
            const applied = Math.max(0, Math.floor(Number(data.applied) || 0));
            const cap = Math.max(0, Math.floor(Number(data.cap) || 0));
            // Points past the rank cap are NOT lost — applyTrainingGrant rolls
            // them into the unspent pool. Say so: early-game sessions routinely
            // out-earn the Academy cap, and silence reads as "my points vanished".
            const overflow = Math.max(0, Math.floor(Number(data.overflow) || 0));
            const pooled = overflow > 0 ? ` +${overflow} to your unspent pool (${formatStatName(activeTraining.stat)} is at its rank cap of ${cap}) — spend it on any stat.` : "";
            setTrainingNotice(`${activeTraining.label} complete. ${applied > 0 ? `+${applied} ${formatStatName(activeTraining.stat)}.` : `${formatStatName(activeTraining.stat)} is already at your rank cap (${cap}).`}${pooled}`);
        } catch {
            alert(AMBIGUOUS_ACTION_MESSAGE);
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
            {trainingNotice && <p className="training-feedback" role="status">{trainingNotice}</p>}

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
                    <p className="hint">{trainingReady
                        ? "Collect your stat points, then start another session or return to your next activity."
                        : "Training continues while you play or log out. Return when it is ready to collect."}</p>
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
                            <small>{timer.staminaCost} stamina{character.stamina < timer.staminaCost ? ` · need ${timer.staminaCost - character.stamina} more` : ""}</small>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// Honor Seals train jutsu Lv 30→40 as TIMED LESSONS — the same 30-minute
// lesson and the same two slots as ryo training, bought from the curriculum
// card (api/training/jutsu-ryo.ts, payWith: "honorSeals"). This panel shows
// the balance and the Seal speed-ups, which work on any active lesson. The
// server prices every lesson (Vanguard discounts included); this is a preview.
const SEAL_COST_BY_FROM_LEVEL: Record<number, number> = {
    30: 20, 31: 25, 32: 30, 33: 35, 34: 40,
    35: 45, 36: 50, 37: 55, 38: 60, 39: 65,
};

/** Same arithmetic as the server's jutsuSealTrainingCost (api/training/_jutsu-ryo.ts). */
function previewSealCost(fromLevel: number, character: Character): number {
    let cost = SEAL_COST_BY_FROM_LEVEL[fromLevel] ?? 0;
    if (cost === 0) return 0;
    if (character.profession === "vanguard" && (character.professionRank ?? 0) >= 8) cost *= 0.9;
    // Vanguard mastery (Quartermaster → Efficient Forging) stacks, capped at 50%.
    const masteryPct = Math.min(50, masteryBonus(character, "sealTrainCostPct"));
    if (masteryPct > 0) cost *= 1 - masteryPct / 100;
    return Math.max(1, Math.ceil(cost));
}

/** Seal lessons run from Lv 30 up to 40, never past the player's rank cap. */
const SEAL_LESSON_MIN_LEVEL = 30;
function sealLessonCap(character: Character): number {
    return Math.min(40, jutsuLevelCapForLevel(Number(character.level) || 1));
}

/** The Seal lesson that would train a jutsu FROM `fromLevel`, or null when Seals can't. */
function sealLessonFrom(fromLevel: number, character: Character): { cost: number } | null {
    if (fromLevel < SEAL_LESSON_MIN_LEVEL || fromLevel >= sealLessonCap(character)) return null;
    const cost = previewSealCost(fromLevel, character);
    return cost > 0 ? { cost } : null;
}

/** "150 ryo" or "20 Honor Seals" — what a lesson was paid with. */
function lessonPrice(lesson: { currency?: string; ryoCost: number; sealCost?: number }, share = 1): string {
    return lesson.currency === "honorSeals"
        ? `${Math.floor((lesson.sealCost ?? 0) * share).toLocaleString()} Honor Seals`
        : `${Math.floor(lesson.ryoCost * share).toLocaleString()} ryo`;
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
    // A throttled speed-up gets a visible wait instead of a bare "Rate limit exceeded."
    const [speedUpReadyAt, setSpeedUpReadyAt] = useState(0);
    const [clock, setClock] = useState(() => Date.now());
    const cooling = clock < speedUpReadyAt;
    useEffect(() => {
        if (!cooling) return;
        const id = setInterval(() => setClock(Date.now()), 500);
        return () => clearInterval(id);
    }, [cooling]);
    const speedUpWaitSec = Math.ceil(Math.max(0, speedUpReadyAt - clock) / 1000);
    const throttledMessage = (retryAfterMs: unknown) => {
        const ms = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 5_000;
        const now = Date.now();
        setClock(now);
        setSpeedUpReadyAt(now + ms);
        return `⏳ Your Seals need a moment to settle. Try again in ${Math.ceil(ms / 1000)}s.`;
    };

    const hasDiscount = character.profession === "vanguard" && (character.professionRank ?? 0) >= 8;
    const fromLevel = selectedMastery?.level ?? 0;
    const sealLesson = selectedJutsu ? sealLessonFrom(fromLevel, character) : null;
    const balance = character.honorSeals ?? 0;
    // "Finish now" buys exactly the 10-minute blocks left (api/jutsu/speedup.ts
    // sells at most that many). A flat 10 Seals asked for 100 minutes and was
    // refused on every 30-minute lesson.
    // 2s of margin so a request landing just past a 10-minute boundary is not
    // over the server's count (at worst a second or two remains, which completes).
    const remainingMinutes = activeJutsuTraining ? Math.max(0, Math.ceil((activeJutsuTraining.endsAt - serverNow() - 2_000) / 60_000)) : 0;
    const finishSeals = Math.max(1, Math.min(20, Math.ceil(remainingMinutes / 10)));
    // Same arithmetic as the server's effectiveSpeedupCost (api/jutsu/speedup.ts):
    // Vanguard Rank 8+ pays 90%, and the Quartermaster "Stockpile" node stacks.
    const stockpilePct = Math.min(50, masteryBonus(character, "sealSpeedupCostPct"));
    const speedupCost = (seals: number) =>
        Math.max(1, Math.ceil(seals * (hasDiscount ? 0.9 : 1) * (1 - stockpilePct / 100)));
    const finishCost = speedupCost(finishSeals);

    // Quartermaster "Logistician" capstone: one free Finish-now per week. The
    // server owns the weekly usage; ask it whether this week's is still unused.
    const ownsLogistician = masteryHasCapstone(character, "logistician");
    const [freeSpeedup, setFreeSpeedup] = useState<{ available: boolean; resetsAt: number } | null>(null);
    // Bumped after a refused free finish so the status is re-read from the server.
    const [freeCheck, setFreeCheck] = useState(0);
    useEffect(() => {
        if (!ownsLogistician) return;
        let cancelled = false;
        void fetch(`/api/jutsu/speedup?playerName=${encodeURIComponent(character.name)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { logistician?: { available?: boolean; resetsAt?: number } } | null) => {
                if (cancelled || !data?.logistician) return;
                setFreeSpeedup({ available: data.logistician.available === true, resetsAt: Number(data.logistician.resetsAt) || 0 });
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [ownsLogistician, character.name, activeJutsuTraining?.serverToken, freeCheck]);
    // Come back at the weekly reset (Monday 00:00 UTC) without leaving the screen.
    useEffect(() => {
        if (!ownsLogistician || !freeSpeedup?.resetsAt || freeSpeedup.available) return;
        const wait = freeSpeedup.resetsAt - Date.now() + 1_000;
        if (wait > 24 * 60 * 60 * 1000) return;
        const id = window.setTimeout(() => setFreeCheck((n) => n + 1), Math.max(1_000, wait));
        return () => window.clearTimeout(id);
    }, [ownsLogistician, freeSpeedup]);

    // Replies patch the lesson the panel sees NOW, never the copy captured when
    // the request left — a queue, advance or cancel may have landed meanwhile.
    const lessonRef = useRef(activeJutsuTraining);
    useEffect(() => { lessonRef.current = activeJutsuTraining; });
    const patchLessonEndsAt = (serverToken: string | undefined, endsAt: number) => {
        const latest = lessonRef.current;
        if (!latest || latest.serverToken !== serverToken || !Number.isFinite(endsAt)) return;
        setActiveJutsuTraining({ ...latest, endsAt: Math.min(latest.endsAt, endsAt) });
    };

    async function freeFinish() {
        if (!activeJutsuTraining || busyRef.current || !freeSpeedup?.available) return;
        const lessonToken = activeJutsuTraining.serverToken;
        busyRef.current = true;
        setBusy(true);
        setMsg(null);
        try {
            const res = await fetch('/api/jutsu/speedup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: character.name, free: true }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 409) setFreeSpeedup((prev) => prev ? { ...prev, available: false } : prev);
                if (res.status === 403 || res.status === 409) setFreeCheck((n) => n + 1);
                setMsg(res.status === 429 ? throttledMessage(data.retryAfterMs) : `❌ ${data.error ?? 'Failed'}`);
                return;
            }
            patchLessonEndsAt(lessonToken, Number(data.newEndsAt));
            setFreeSpeedup((prev) => ({ available: false, resetsAt: Number(data.freeResetsAt) || prev?.resetsAt || 0 }));
            setMsg(`✅ Logistician: lesson finished for free. Your next free speedup comes back next week.`);
        } catch {
            setMsg(`❌ ${AMBIGUOUS_ACTION_MESSAGE}`);
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    async function speedUp(sealsRequested: number) {
        if (!activeJutsuTraining || busyRef.current || Date.now() < speedUpReadyAt) return;
        const lessonToken = activeJutsuTraining.serverToken;
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
            if (res.status === 429) {
                setMsg(throttledMessage(data.retryAfterMs));
                return;
            }
            if (!res.ok) {
                setMsg(`❌ ${data.error ?? 'Failed'}`);
                return;
            }
            const minutesReduced: number = Number(data.minutesReduced ?? 0);
            // The server's own new end time, applied to the lesson as it is now.
            patchLessonEndsAt(lessonToken, Number(data.newEndsAt));
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
                {stockpilePct > 0 && <span style={{ marginLeft: 8, color: "#f97316" }}> · Stockpile −{stockpilePct}% speed-ups</span>}
            </span>
            <p className="hint" style={{ margin: "6px 0 8px", fontSize: "0.8rem" }}>
                Past level 30, jutsu lessons are paid in Honor Seals up to level 40 — the same
                30-minute lessons, started from the curriculum card above. Seals can also shave
                time off an active lesson. Levels 40+ still require PvP.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="hint" style={{ fontSize: "0.78rem" }}>
                    {!selectedJutsu
                        ? "Select a jutsu to see its Seal lesson."
                        : sealLesson
                            ? `Next Seal lesson: Lv ${fromLevel} → ${fromLevel + 1} for ${sealLesson.cost} Seals.`
                            : fromLevel < SEAL_LESSON_MIN_LEVEL
                                ? `Selected jutsu is Lv ${fromLevel} — train it to Lv 30 with ryo first.`
                                : fromLevel >= 40
                                    ? "Selected jutsu is past the Seal lessons (Lv 40). PvP from here."
                                    : "Your rank caps this jutsu here. Rank up to keep training it."}
                </span>
                {activeJutsuTraining && serverNow() < activeJutsuTraining.endsAt && (
                    <>
                        <button onClick={() => void speedUp(1)} disabled={busy || balance < speedupCost(1) || speedUpWaitSec > 0} style={{ background: "linear-gradient(#422006,#1c1006)", borderColor: "#fde68a" }}>
                            {busy ? "…" : speedUpWaitSec > 0 ? `Ready in ${speedUpWaitSec}s` : "−10 min (1 Seal)"}
                        </button>
                        <button onClick={() => void speedUp(finishSeals)} disabled={busy || balance < finishCost || speedUpWaitSec > 0} style={{ background: "linear-gradient(#422006,#1c1006)", borderColor: "#fde68a" }}>
                            {busy ? "…" : `Finish now (${finishCost} Seal${finishCost === 1 ? "" : "s"})`}
                        </button>
                        {ownsLogistician && freeSpeedup?.available && remainingMinutes >= 2 && (
                            <button onClick={() => void freeFinish()} disabled={busy} style={{ background: "linear-gradient(#14532d,#052e16)", borderColor: "#86efac" }}>
                                {busy ? "…" : "Finish now · free (Logistician, weekly)"}
                            </button>
                        )}
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
    // Jutsu id -> granting bloodline name, for the violet bloodline marker. The
    // same rule as the Profile Jutsu tab (lib/bloodline-marker).
    const bloodlineJutsuNames = bloodlineNamesByJutsuId(getCharacterBloodlines(character, savedBloodlines));
    const bloodlineLabel = (jutsu: Jutsu) => {
        if (!hasBloodlineMarker(jutsu, bloodlineJutsuNames)) return "";
        const name = bloodlineJutsuNames.get(jutsu.id);
        return name ? `◆ Bloodline · ${name}` : "◆ Bloodline";
    };
    const academyJutsuStep = normalizeOnboardingStep(character.onboardingStep) === "jutsu";
    const academyUntrainedJutsuId = availableJutsus.find((jutsu) => getJutsuMastery(character, jutsu.id).level < 1)?.id ?? "";
    const [selectedJutsuId, setSelectedJutsuId] = useState(
        (academyJutsuStep ? academyUntrainedJutsuId : "") || availableJutsus[0]?.id || "",
    );
    const [now, setNow] = useState(() => serverNow());
    const [jutsuAction, setJutsuAction] = useState<string | null>(null);
    const [jutsuNotice, setJutsuNotice] = useState<JutsuHallNotice | null>(null);
    const jutsuNoticeRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (jutsuNotice?.tone !== "error") return;
        const frame = requestAnimationFrame(() => {
            jutsuNoticeRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
        });
        return () => cancelAnimationFrame(frame);
    }, [jutsuNotice]);
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
        const interval = setInterval(() => setNow(serverNow()), 1000);
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
        // Past the ryo cap, Lv 30→40 is the same timed lesson paid in Honor Seals.
        const sealLesson = mastery.level >= ryoTrainCap ? sealLessonFrom(mastery.level, character) : null;
        if (mastery.level >= ryoTrainCap && !sealLesson) {
            return alert(mastery.level >= 40
                ? "Honor Seal lessons stop at level 40. Levels 41-50 must be earned from battles."
                : mastery.level >= JUTSU_TRAINING_CAP
                    ? "Your rank caps this jutsu here. Rank up to keep training it."
                    : "That jutsu is at your rank's training cap. Rank up to train it further.");
        }
        if (sealLesson && (character.honorSeals ?? 0) < sealLesson.cost) return alert(`Not enough Honor Seals. You need ${sealLesson.cost}.`);

        const cost = jutsuTrainingCost(mastery.level);
        if (!sealLesson && mastery.level > 0 && character.ryo < cost) return alert(`Not enough ryo. You need ${cost}.`);
        if (!beginJutsuAction("start")) return;
        try {
            const result = await mutateJutsuRyoTraining(character.name, 'start', {
                jutsuId: selectedJutsu.id, label: selectedJutsu.name, bonusPct: jutsuTrainingBonus,
                ...(sealLesson ? { payWith: "honorSeals" } : {}),
            });
            if (!result.character) return rejectJutsuAction(result.error);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return rejectJutsuAction(AMBIGUOUS_ACTION_MESSAGE);
            setActiveJutsuTraining(result.activeJutsuTraining ?? null);
            setJutsuNotice({
                tone: "success",
                message: mastery.level === 0
                    ? `${selectedJutsu.name} unlocked at level 1.`
                    : `${selectedJutsu.name} training started. Your ${sealLesson ? "Honor Seal" : "ryo"} payment is saved.`,
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
            if (!onVersionedCharacter(result.character, result._saveVersion)) return rejectJutsuAction(AMBIGUOUS_ACTION_MESSAGE);
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
        const refund = lessonPrice(activeJutsuTraining, 0.5);
        if (!(await gameConfirm(`Cancel ${activeJutsuTraining.label} training? You'll get ${refund} back (50% of ${lessonPrice(activeJutsuTraining)}) and forfeit the training progress.`))) return;
        if (!beginJutsuAction("cancel")) return;
        try {
            const result = await mutateJutsuRyoTraining(character.name, 'cancel', { serverToken: activeJutsuTraining.serverToken ?? '' });
            if (!result.character) return rejectJutsuAction(result.error);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return rejectJutsuAction(AMBIGUOUS_ACTION_MESSAGE);
            setActiveJutsuTraining(result.activeJutsuTraining ?? null);
            setJutsuNotice({ tone: "success", message: `Training cancelled. ${refund} returned.` });
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
            if (!onVersionedCharacter(result.character, result._saveVersion)) return rejectJutsuAction(AMBIGUOUS_ACTION_MESSAGE);
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
        const sealLesson = fromLevel >= ryoTrainCap ? sealLessonFrom(fromLevel, character) : null;
        if (fromLevel >= ryoTrainCap && !sealLesson) return alert("That jutsu has no further lesson to queue at your rank.");
        if (fromLevel === 0) return alert("Train a level 0 jutsu directly to unlock it for free.");
        if (sealLesson && (character.honorSeals ?? 0) < sealLesson.cost) return alert(`Not enough Honor Seals to queue. You need ${sealLesson.cost}.`);
        const cost = jutsuTrainingCost(fromLevel);
        if (!sealLesson && character.ryo < cost) return alert(`Not enough ryo to queue. You need ${cost}.`);
        if (!activeJutsuTraining.serverToken) return rejectJutsuAction('invalid-or-legacy-jutsu-training');
        if (!beginJutsuAction("queue")) return;
        try {
            const result = await mutateJutsuRyoTraining(character.name, 'queue', {
                serverToken: activeJutsuTraining.serverToken,
                jutsuId: selectedJutsu.id,
                label: selectedJutsu.name,
                trainingBonusPct: jutsuTrainingBonus,
                ...(sealLesson ? { payWith: "honorSeals" } : {}),
            });
            if (!result.character) return rejectJutsuAction(result.error);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return rejectJutsuAction(AMBIGUOUS_ACTION_MESSAGE);
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
        if (!(await gameConfirm(`Remove the queued ${queued.label} training? You'll get all ${lessonPrice(queued)} back — it hasn't started.`))) return;
        if (!activeJutsuTraining.serverToken) return rejectJutsuAction('invalid-or-legacy-jutsu-training');
        if (!beginJutsuAction("cancel-queue")) return;
        try {
            const result = await mutateJutsuRyoTraining(character.name, 'cancel-queue', { serverToken: activeJutsuTraining.serverToken });
            if (!result.character) return rejectJutsuAction(result.error);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return rejectJutsuAction(AMBIGUOUS_ACTION_MESSAGE);
            setActiveJutsuTraining(result.activeJutsuTraining ?? null);
            setJutsuNotice({ tone: "success", message: `Queued lesson removed. ${lessonPrice(queued)} returned.` });
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
    const mobileInfoSealLesson = mobileInfoMastery && mobileInfoMastery.level >= ryoTrainCap ? sealLessonFrom(mobileInfoMastery.level, character) : null;
    const mobileInfoAtCap = !!mobileInfoMastery && mobileInfoMastery.level >= ryoTrainCap && !mobileInfoSealLesson;
    const mobileInfoInsufficientRyo = mobileInfoSealLesson
        ? (character.honorSeals ?? 0) < mobileInfoSealLesson.cost
        : !!mobileInfoMastery && mobileInfoMastery.level > 0 && character.ryo < mobileInfoCost;

    function renderJutsuDetails(jutsu: Jutsu) {
        const mastery = getJutsuMastery(character, jutsu.id);
        const scaled = scaleJutsuByLevel(jutsu, mastery.level);
        const cost = jutsuTrainingCost(mastery.level);
        const duration = jutsuTrainingDuration(mastery.level);
        const displayJutsu = jutsuDisplayAtLevel(jutsu, mastery.level);
        const targeting = jutsuTargetingLabel(jutsu);
        const bloodline = bloodlineLabel(jutsu);
        return (
            <div className="jutsu-detail-stack">
                <div className="jutsu-detail-badges"><span>Lv {mastery.level}/50</span><span>{jutsu.type}</span><span>{jutsu.element}</span>{bloodline && <span className="is-bloodline">{bloodline}</span>}</div>
                <p className="jutsu-detail-description">{jutsuDetailDescription(jutsu)}</p>
                <div className="jutsu-detail-metrics">
                    <span><small>Mastery XP</small><strong>{mastery.xp}/{mastery.level >= 50 ? "MAX" : jutsuXpNeeded(mastery.level)}</strong></span>
                    <span><small>Action points</small><strong>{jutsu.ap}</strong></span>
                    <span><small>Range</small><strong>{jutsu.range}</strong></span>
                    <span><small>Effect power</small><strong>{scaled.scaledEffectPower}</strong></span>
                </div>
                <p><strong>Targeting · {targeting.short}</strong><br />{targeting.detail}</p>
                <p><strong>Resource cost</strong><br />{jutsuResourceDisplay(jutsu, "chakra", character.level, character.specialty, mastery.level)} chakra · {jutsuResourceDisplay(jutsu, "stamina", character.level, character.specialty, mastery.level)} stamina</p>
                <p><strong>Tags</strong><br />{displayJutsu.tags.map((tag) => `${tag.name}${tag.percent ? ` ${tag.percent}%` : ""}`).join(", ") || "None"}</p>
                <p><strong>Training route</strong><br />{mastery.level === 0
                    ? "Free, instant level 1 unlock"
                    : mastery.level < ryoTrainCap
                        ? `${cost.toLocaleString()} ryo · ${duration / 60000} min · +1 level`
                        : sealLessonFrom(mastery.level, character)
                            ? `${sealLessonFrom(mastery.level, character)!.cost} Honor Seals · ${duration / 60000} min · +1 level`
                            : "Battle-earned mastery"}</p>
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
                <span><small>Paid</small><strong>{lessonPrice(activeJutsuTraining)}</strong></span>
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
                    <span>{lessonPrice(queued)} paid · ~{Math.round(queued.durationMs / 60000)} min</span>
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

    // Past the ryo cap the next lesson (if any) is a Seal lesson; with none, the
    // card says so instead of pricing a ryo lesson that can't exist.
    const selectedSealLesson = selectedMastery && selectedMastery.level >= ryoTrainCap ? sealLessonFrom(selectedMastery.level, character) : null;
    const selectedAtCap = !!selectedMastery && selectedMastery.level >= ryoTrainCap && !selectedSealLesson;
    // Capped by RANK rather than by the lesson ladder: battles can't raise it
    // either (mastery XP stops at the rank cap), so the way forward is ranking up.
    const rankCapped = (level: number) => level < 40 && level >= jutsuLevelCapForLevel(Number(character.level) || 1);
    const selectedRankCapped = selectedAtCap && rankCapped(selectedMastery!.level);
    const selectedInsufficientRyo = selectedSealLesson
        ? (character.honorSeals ?? 0) < selectedSealLesson.cost
        : !!selectedMastery && selectedMastery.level > 0 && character.ryo < selectedCost;

    return (
        <div className="card jutsu-training-screen">
            <BackToVillageButton onClick={onBack} label="← Back" />

            <header className="jutsu-hall-hero">
                <span className="jutsu-eyebrow">Technique development</span>
                <h2>Jutsu Training Hall</h2>
                <p>Study techniques with ryo through level 30, then with Honor Seals through level 40. Mastery from levels 41–50 is earned in battle.</p>
                <div className="jutsu-hall-stats" aria-label="Training hall status">
                    <span><small>Hall cap</small><strong>Lv {ryoTrainCap}</strong></span>
                    <span><small>Available ryo</small><strong>{character.ryo.toLocaleString()}</strong></span>
                    <span><small>Elements</small><strong>{ownedElements.length ? ownedElements.join(" · ") : "None awakened"}</strong></span>
                    <span><small>Speed bonus</small><strong>+{jutsuTrainingBonus.toFixed(2)}%</strong></span>
                </div>
            </header>

            {jutsuNotice && (
                <div ref={jutsuNoticeRef} className={`jutsu-notice ${jutsuNotice.tone}`} role={jutsuNotice.tone === "error" ? "alert" : "status"} aria-live="polite">
                    <strong>{jutsuHallNoticeTitle(jutsuNotice.tone)}</strong>
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
                                    <span>{selectedJutsu.type} · {selectedJutsu.element}{bloodlineLabel(selectedJutsu) && <em className="jutsu-plan-bloodline"> · {bloodlineLabel(selectedJutsu)}</em>}</span>
                                    <strong>{selectedAtCap ? `Level ${selectedMastery.level}` : `Level ${selectedMastery.level} → ${selectedMastery.level + 1}`}</strong>
                                    <small>{selectedRankCapped ? "Your rank caps this jutsu — rank up to keep training" : selectedAtCap ? "Battle-earned mastery from here" : selectedSealLesson ? "Honor Seal lesson · one mastery level" : "One complete mastery level"}</small>
                                </div>
                            </div>
                            {!selectedAtCap && (
                                <div className="jutsu-plan-metrics">
                                    <span><small>Tuition</small><strong>{selectedMastery.level === 0 ? "Free" : selectedSealLesson ? `${selectedSealLesson.cost} Honor Seals` : `${selectedCost.toLocaleString()} ryo`}</strong></span>
                                    <span><small>Duration</small><strong>{selectedMastery.level === 0 ? "Instant" : `${selectedDuration / 60000} min`}</strong></span>
                                    <span><small>Reward</small><strong>+1 level</strong></span>
                                </div>
                            )}
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
                                            ? selectedRankCapped ? "Rank up to train further" : "Battle training required"
                                            : selectedSealLesson
                                                ? selectedInsufficientRyo
                                                    ? `Need ${(selectedSealLesson.cost - (character.honorSeals ?? 0)).toLocaleString()} more Honor Seals`
                                                    : `Pay ${selectedSealLesson.cost} Honor Seals & train`
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
                    bloodlineJutsuNames={bloodlineJutsuNames}
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
                                        ? rankCapped(mobileInfoMastery.level) ? "Rank up to train further" : "Battle training required"
                                        : mobileInfoSealLesson
                                            ? mobileInfoInsufficientRyo
                                                ? `Need ${(mobileInfoSealLesson.cost - (character.honorSeals ?? 0)).toLocaleString()} more Honor Seals`
                                                : `Train · ${mobileInfoSealLesson.cost} Honor Seals`
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
