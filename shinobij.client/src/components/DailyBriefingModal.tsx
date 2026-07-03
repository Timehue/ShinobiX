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
import { currentLogbookObjective } from "../lib/logbook-objectives";
import { fetchAnnouncements, fetchEras, fetchLegacyStatus, isLegacyEnabled, type AnnouncementView, type EraView } from "../lib/legacy";
import { nextUnseenRumorMilestone, markLevelRumorSeen, recordRumorHeard, rumorForCategory } from "../lib/legacy-rumors";
import { loadVillageState } from "../lib/world-state";
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
// Cover new players from level 1: the briefing's recommendation engine already
// special-cases the onboarding step, and gating at 5 meant levels 1–4 got NO
// daily login reward and no "what next" surface — exactly who needs both most.
const MIN_LEVEL = 1;

export function DailyBriefingModal({
    character,
    updateCharacter,
    navigate,
    activeTraining,
    activeJutsuTraining,
}: {
    character: Character;
    updateCharacter: (c: Character | ((prev: Character | null) => Character | null)) => void;
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

    // World news (Legacy system): the top high/mythic moments in the login
    // briefing (handoff §Server Announcements: "Login news panel"). Empty and
    // invisible while the server flag is off (endpoint returns []).
    const [worldNews, setWorldNews] = useState<AnnouncementView[]>([]);
    // Era V server-effort strip: world events live or die on ambient
    // visibility (depth-audit finding) — one line of collective progress.
    const [activeEra, setActiveEra] = useState<EraView | null>(null);
    useEffect(() => {
        if (!shouldShow || !isLegacyEnabled()) return;
        let alive = true;
        void fetchAnnouncements(15).then((r) => {
            if (!alive || !r) return;
            setWorldNews(r.announcements.filter((a) => a.importance === "high" || a.importance === "mythic").slice(0, 4));
        });
        void fetchEras().then((r) => {
            if (!alive || !r) return;
            setActiveEra(r.eras.find((e) => e.status === "milestone_active" && e.milestones.length > 0) ?? null);
        });
        return () => { alive = false; };
    }, [shouldShow]);

    // Pre-50 rumor: a map-avoider might never open the world map, so the Legacy
    // discovery arc would never reach them. Surface the next unheard milestone
    // here too — the SEEN_KEY dedupes with the world-map whisper, so a player
    // never hears the same beat twice across surfaces.
    const [rumor, setRumor] = useState<{ milestone: number; text: string } | null>(null);
    useEffect(() => {
        if (!shouldShow || !isLegacyEnabled()) return;
        if (character.level >= 50 || character.legacy) return;
        const milestone = nextUnseenRumorMilestone(character.level);
        if (milestone == null) return;
        let alive = true;
        void fetchLegacyStatus(character.name).then((s) => {
            if (!alive) return;
            const top = s?.strongest?.[0];
            const text = rumorForCategory(top?.category, milestone, { playerName: character.name, tier: top?.tier });
            setRumor({ milestone, text });
            markLevelRumorSeen(milestone);
            recordRumorHeard(milestone, text);
        });
        return () => { alive = false; };
    }, [shouldShow, character.level, character.name, character.legacy]);

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
                updateCharacter((prev) => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        ryo: prev.ryo + res.granted.ryo,
                        fateShards: (prev.fateShards ?? 0) + res.granted.fateShards,
                        loginStreak: res.streak,
                        lastLoginRewardDate: today,
                    };
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

    // The rank exam / Academy checklist the player is currently working toward.
    // Kage standing (Special Jonin) is the only env fact the pure helper needs;
    // the rest of the requirement progress comes straight off the save.
    const objective = currentLogbookObjective(character, {
        isKage: character.level >= 80
            && loadVillageState(character.village).seatedKage?.toLowerCase() === character.name.toLowerCase(),
    });
    const objIncomplete = objective ? objective.requirements.filter((r) => r.progress < r.target) : [];
    const objDone = objective ? objective.requirements.length - objIncomplete.length : 0;
    const objTotal = objective ? objective.requirements.length : 0;
    const objPct = objTotal ? Math.round((objDone / objTotal) * 100) : 0;

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

                            {/* ── Current logbook objective ─────────────────── */}
                            {objective && (
                                <section className="db-section">
                                    <h3>Logbook</h3>
                                    <div className="db-objective">
                                        <div className="db-objective-head">
                                            <span className="db-objective-title">{objective.title}</span>
                                            <span className="db-objective-count">{objDone}/{objTotal} done</span>
                                        </div>
                                        <div className="mission-progress db-objective-bar"><span style={{ width: `${objPct}%` }} /></div>
                                        {objIncomplete.length === 0 ? (
                                            <p className="db-objective-ready">
                                                {objective.kind === "academy"
                                                    ? "✓ All goals met — claim your reward in the Logbook"
                                                    : "✓ All requirements met — pass it in your Logbook"}
                                            </p>
                                        ) : (
                                            <ul className="db-list db-objective-reqs">
                                                {objIncomplete.slice(0, 3).map((r) => (
                                                    <li className="db-list-row" key={r.label}>
                                                        <span className="db-list-key">○ {r.label}</span>
                                                        <span className="db-list-val">
                                                            {r.target === 1 ? "To do" : `${Math.min(r.progress, r.target)}/${r.target}`}
                                                        </span>
                                                    </li>
                                                ))}
                                                {objIncomplete.length > 3 && (
                                                    <li className="db-list-row"><span className="db-list-key">+{objIncomplete.length - 3} more</span></li>
                                                )}
                                            </ul>
                                        )}
                                        <button type="button" className="db-list-go db-objective-cta" onClick={() => go("logbook")}>
                                            View in Logbook ›
                                        </button>
                                    </div>
                                </section>
                            )}

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

                            {/* ── Era effort strip (server-wide progress at a glance) ── */}
                            {activeEra && (() => {
                                const total = activeEra.milestones.reduce((s, m) => s + m.required, 0);
                                const done = activeEra.milestones.reduce((s, m) => s + Math.min(m.current, m.required), 0);
                                const pct = Math.min(100, Math.round((done / Math.max(1, total)) * 100));
                                const nextUp = activeEra.milestones.find((m) => !m.done);
                                return (
                                    <section className="db-section">
                                        <h3>{activeEra.name}</h3>
                                        <button
                                            type="button" className="db-war"
                                            onClick={() => {
                                                try { window.sessionStorage?.setItem("hall.initialTab", "eras"); } catch { /* best-effort */ }
                                                go("hallOfLegends");
                                            }}
                                        >
                                            <span className="db-war-tag db-war-clan">{pct}%</span>
                                            <span className="db-war-vs">The world pushes toward the next age</span>
                                            <span className="db-war-note">
                                                {nextUp
                                                    ? `${nextUp.label}: ${nextUp.current.toLocaleString()} / ${nextUp.required.toLocaleString()} — the world needs you`
                                                    : "Milestones complete — the final trigger awaits"}
                                            </span>
                                        </button>
                                    </section>
                                );
                            })()}

                            {/* ── World news (Legacy system: high/mythic moments) ── */}
                            {worldNews.length > 0 && (
                                <section className="db-section">
                                    <h3>World news</h3>
                                    <ul className="db-wars">
                                        {worldNews.map((n) => (
                                            <li key={n.id}>
                                                <button
                                                    type="button" className="db-war"
                                                    onClick={() => {
                                                        // Land on the News tab, not the Ranked table
                                                        // (one-shot hint read by HallOfLegends).
                                                        try { window.sessionStorage?.setItem("hall.initialTab", "news"); } catch { /* best-effort */ }
                                                        go("hallOfLegends");
                                                    }}
                                                >
                                                    <span className={`db-war-tag db-war-${n.importance === "mythic" ? "clan" : "village"}`}>
                                                        {n.importance === "mythic" ? "Mythic" : "News"}
                                                    </span>
                                                    <span className="db-war-vs">{n.title}</span>
                                                    <span className="db-war-note">{n.message.length > 90 ? `${n.message.slice(0, 90).replace(/\s+\S*$/, "")}…` : n.message}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}

                            {/* ── Legacy rumor (pre-50 discovery arc, map-avoider safety) ── */}
                            {rumor && (
                                <section className="db-section">
                                    <h3>A whisper on the wind</h3>
                                    <p style={{ margin: 0, fontSize: ".84rem", color: "#c4b5fd", fontStyle: "italic", lineHeight: 1.5 }}>
                                        “{rumor.text}”
                                    </p>
                                    <p style={{ margin: "5px 0 0", fontSize: ".72rem", color: "#6b7280" }}>
                                        The paths are watching. Reach level 50, and one may open to you.
                                    </p>
                                </section>
                            )}

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
