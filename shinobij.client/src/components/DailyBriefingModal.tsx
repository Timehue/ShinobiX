/*
 * Daily Briefing — a once-per-day "notice board" modal shown to level-5+ players
 * when they return for the day. It:
 *   • auto-collects the server-authoritative login-streak reward (ryo daily,
 *     +5 Fate Shards every 7th consecutive day) and shows what was granted,
 *   • recommends the most impactful next action (smart priority engine),
 *   • reminds the player of their stat / jutsu / pet training timers,
 *   • reports every active war in the world (village + clan), even ones the
 *     player isn't part of, click-through to the relevant screen,
 *   • surfaces today's daily-mission/hunt slots and unread mail.
 *
 * Dismiss (✕ / backdrop / "Enter the village") hides it until the next UTC day
 * via a localStorage date stamp. Renders nothing when there's nothing to show
 * (below level 5, or already dismissed today).
 *
 * Hosted by LeftProfileCard (which already has character + training props) and
 * rendered through a portal to <body>, so it shows full-screen on desktop AND
 * mobile regardless of the host's CSS — without touching App.tsx's line budget.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import type { ActiveTraining, ActiveJutsuTraining } from "../types/combat";
import { currentDateKey, formatPetTimer } from "../lib/utils";
import { dailyMissionsCompleted, hasDailyMissionSlot, dailyHuntsCompleted } from "../lib/character-progress";
import { DAILY_MISSION_LIMIT, DAILY_HUNT_LIMIT } from "../constants/game";
import { normalizeOnboardingStep } from "../lib/onboarding-step";
import { getUnreadMail, subscribeUnreadMail } from "../lib/mail-unread";
import { useSharedNow } from "../lib/use-shared-now";
import { petDisplayName } from "../lib/pet";
import { claimDailyLogin, type DailyLoginResult } from "../lib/daily-login-api";
import {
    buildRecommendations,
    recommendedMission,
    worldReport,
    dailyLoginRyo,
    STREAK_SHARD_INTERVAL,
    STREAK_SHARD_REWARD,
} from "../lib/daily-briefing";
import briefingBg from "../assets/daily-briefing.webp";

const SEEN_KEY = "dailyBriefing.seen.v1";
const MIN_LEVEL = 5;

export function DailyBriefingModal({
    character,
    updateCharacter,
    navigate,
    activeTraining,
    activeJutsuTraining,
}: {
    character: Character;
    updateCharacter: (c: Character) => void;
    navigate: (s: Screen) => void;
    activeTraining: ActiveTraining | null;
    activeJutsuTraining: ActiveJutsuTraining | null;
}) {
    const now = useSharedNow(); // ticks once a second so the training countdowns stay live
    const today = currentDateKey();
    const [dismissed, setDismissed] = useState(() => {
        try { return localStorage.getItem(SEEN_KEY) === today; } catch { return false; }
    });
    const shouldShow = character.level >= MIN_LEVEL && !dismissed;

    // The login reward is collected by an explicit Claim button (not auto-granted).
    // `claim` holds the server result once collected this session; the save's
    // lastLoginRewardDate tells us if it was already collected earlier today.
    const [claim, setClaim] = useState<DailyLoginResult | null>(null);
    const [claiming, setClaiming] = useState(false);
    const [unread, setUnread] = useState(getUnreadMail());
    const claimingRef = useRef(false);

    useEffect(() => subscribeUnreadMail(setUnread), []);

    if (!shouldShow) return null;

    const alreadyClaimedToday = character.lastLoginRewardDate === today;

    const claimReward = () => {
        if (claimingRef.current || claim || alreadyClaimedToday) return;
        claimingRef.current = true;
        setClaiming(true);
        void claimDailyLogin(character.name).then((res) => {
            setClaiming(false);
            if (!res) { claimingRef.current = false; return; } // let the player retry on error
            setClaim(res);
            if (!res.alreadyClaimed && (res.granted.ryo || res.granted.fateShards)) {
                updateCharacter({
                    ...character,
                    ryo: character.ryo + res.granted.ryo,
                    fateShards: (character.fateShards ?? 0) + res.granted.fateShards,
                    loginStreak: res.streak,
                    lastLoginRewardDate: today,
                });
            }
        });
    };

    const close = () => {
        try { localStorage.setItem(SEEN_KEY, today); } catch { /* ignore */ }
        setDismissed(true);
    };
    const go = (screen: Screen) => { close(); navigate(screen); };

    const previewRyo = dailyLoginRyo(character.level);
    const streak = claim?.streak ?? character.loginStreak ?? 0;
    const shardCountdown = claim
        ? claim.daysUntilShardBonus
        : (STREAK_SHARD_INTERVAL - (streak % STREAK_SHARD_INTERVAL)) % STREAK_SHARD_INTERVAL;

    const statTimer = activeTraining && now < activeTraining.endsAt ? activeTraining : null;
    const jutsuTimer = activeJutsuTraining && now < activeJutsuTraining.endsAt ? activeJutsuTraining : null;
    const petTimers = (character.pets ?? []).filter((p) => p.training && now < p.training.endsAt);

    const recMission = recommendedMission(character.level);
    const recos = buildRecommendations({
        hospitalized: !!character.hospitalized,
        onboardingStep: normalizeOnboardingStep(character.onboardingStep),
        unspentStats: character.unspentStats ?? 0,
        level: character.level,
        hasMissionSlot: hasDailyMissionSlot(character),
        missionsDone: dailyMissionsCompleted(character),
        missionCap: DAILY_MISSION_LIMIT,
        recommendedMissionName: recMission?.name,
        hasProfession: !!character.profession,
        trainingIdle: !statTimer,
        jutsuTrainingIdle: !jutsuTimer,
        hasJutsu: (character.jutsuMastery?.length ?? 0) > 0,
        petTrainingIdle: petTimers.length === 0,
        hasPets: (character.pets?.length ?? 0) > 0,
    }).slice(0, 3);

    const wars = worldReport(now);

    return createPortal(
        <div className="daily-briefing-backdrop" role="dialog" aria-modal="true" aria-label="Daily Briefing" onClick={close}>
            <div
                className="daily-briefing-card"
                style={{ backgroundImage: `linear-gradient(180deg, rgba(8,12,24,0.42), rgba(8,12,24,0.86) 46%, rgba(8,12,24,0.95)), url(${briefingBg})` }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="daily-briefing-header">
                    <div className="daily-briefing-titles">
                        <h2>Daily Briefing</h2>
                        <p>Welcome back, {character.name} · Lv {character.level} {character.rankTitle}</p>
                    </div>
                    <button className="daily-briefing-close" aria-label="Close briefing" onClick={close}>✕</button>
                </div>

                <div className="daily-briefing-body">
                            {/* ── Login reward ──────────────────────────────── */}
                            <div className="db-reward">
                                <div className="db-reward-main">
                                    {claim && (claim.granted.ryo || claim.granted.fateShards) ? (
                                        <>
                                            <span className="db-reward-amt">🎁 +{claim.granted.ryo.toLocaleString()} ryo</span>
                                            {claim.granted.fateShards > 0 && (
                                                <span className="db-reward-shards">+{claim.granted.fateShards} Fate Shards!</span>
                                            )}
                                            <span className="db-reward-sub">Daily login reward collected</span>
                                        </>
                                    ) : claim || alreadyClaimedToday ? (
                                        <span className="db-reward-sub">✓ Today's login reward already collected</span>
                                    ) : (
                                        <button type="button" className="db-claim-btn" onClick={claimReward} disabled={claiming}>
                                            {claiming ? "Claiming…" : `🎁 Claim +${previewRyo.toLocaleString()} ryo`}
                                        </button>
                                    )}
                                </div>
                                <div className="db-streak">
                                    <span className="db-streak-flame">{streak > 0 ? `🔥 ${streak}-day streak` : "🔥 Start your streak"}</span>
                                    <span className="db-streak-next">
                                        {claim && shardCountdown === 0
                                            ? `+${STREAK_SHARD_REWARD} Fate Shards today!`
                                            : (claim || alreadyClaimedToday)
                                                ? `${shardCountdown} day${shardCountdown === 1 ? "" : "s"} to ${STREAK_SHARD_REWARD} Fate Shards`
                                                : "Claim to extend your streak"}
                                    </span>
                                </div>
                            </div>

                            {/* ── Recommendations ───────────────────────────── */}
                            <section className="db-section">
                                <h3>Recommended for you</h3>
                                <div className="db-recos">
                                    {recos.map((r) => (
                                        <button key={r.id} type="button" className="db-reco" onClick={() => go(r.screen)}>
                                            <span className="db-reco-icon" aria-hidden="true">{r.icon}</span>
                                            <span className="db-reco-text">
                                                <span className="db-reco-title">{r.title}</span>
                                                <span className="db-reco-detail">{r.detail}</span>
                                            </span>
                                            <span className="db-reco-cta">{r.cta} ›</span>
                                        </button>
                                    ))}
                                </div>
                            </section>

                            <div className="db-grid">
                                {/* ── Training timers ───────────────────────── */}
                                <section className="db-section">
                                    <h3>Your training</h3>
                                    <ul className="db-list">
                                        <li className="db-list-row">
                                            <span className="db-list-key">💪 Stats</span>
                                            {statTimer
                                                ? <span className="db-list-val">{formatPetTimer(statTimer.endsAt - now)}</span>
                                                : <button type="button" className="db-list-go" onClick={() => go("training")}>Idle — start ›</button>}
                                        </li>
                                        <li className="db-list-row">
                                            <span className="db-list-key">⚡ Jutsu</span>
                                            {jutsuTimer
                                                ? <span className="db-list-val">{formatPetTimer(jutsuTimer.endsAt - now)}</span>
                                                : <button type="button" className="db-list-go" onClick={() => go("jutsuTraining")}>Idle — start ›</button>}
                                        </li>
                                        <li className="db-list-row">
                                            <span className="db-list-key">🐾 Pets</span>
                                            {petTimers.length
                                                ? <span className="db-list-val">{petTimers.length === 1
                                                    ? `${petDisplayName(petTimers[0])} · ${formatPetTimer(petTimers[0].training!.endsAt - now)}`
                                                    : `${petTimers.length} training`}</span>
                                                : <button type="button" className="db-list-go" onClick={() => go("pets")}>
                                                    {(character.pets?.length ?? 0) ? "Idle — start ›" : "Get a pet ›"}
                                                  </button>}
                                        </li>
                                    </ul>
                                </section>

                                {/* ── Today ─────────────────────────────────── */}
                                <section className="db-section">
                                    <h3>Today</h3>
                                    <ul className="db-list">
                                        <li className="db-list-row">
                                            <span className="db-list-key">📜 Missions</span>
                                            <button type="button" className="db-list-go" onClick={() => go("missions")}>
                                                {dailyMissionsCompleted(character)}/{DAILY_MISSION_LIMIT} ›
                                            </button>
                                        </li>
                                        <li className="db-list-row">
                                            <span className="db-list-key">🎯 Hunts</span>
                                            <button type="button" className="db-list-go" onClick={() => go("hunting")}>
                                                {dailyHuntsCompleted(character)}/{DAILY_HUNT_LIMIT} ›
                                            </button>
                                        </li>
                                        <li className="db-list-row">
                                            <span className="db-list-key">📬 Mail</span>
                                            <button type="button" className="db-list-go" onClick={() => go("messages")}>
                                                {unread > 0 ? `${unread} unread ›` : "Inbox ›"}
                                            </button>
                                        </li>
                                    </ul>
                                </section>
                            </div>

                            {/* ── World report ──────────────────────────────── */}
                            <section className="db-section">
                                <h3>World report</h3>
                                {wars.length ? (
                                    <ul className="db-wars">
                                        {wars.map((w) => (
                                            <li key={w.id}>
                                                <button type="button" className="db-war" onClick={() => go(w.kind === "clan" ? "clan" : "villageWar")}>
                                                    <span className={`db-war-tag db-war-${w.kind}`}>{w.kind === "clan" ? "Clan War" : "Village War"}</span>
                                                    <span className="db-war-vs">{w.left} <em>vs</em> {w.right}</span>
                                                    {w.note && <span className="db-war-note">{w.note}</span>}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="db-empty">The world is at peace — for now.</p>
                                )}
                            </section>
                </div>

                <div className="daily-briefing-footer">
                    <button type="button" className="db-dismiss" onClick={close}>Enter the village →</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
