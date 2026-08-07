/*
 * Daily Briefing — a once-per-day "notice board" modal shown to level-5+ players
 * when they return for the day. It:
 *   • auto-collects the server-authoritative login-streak reward (ryo daily,
 *     +5 Fate Shards every 7th consecutive day) and shows what was granted,
 *   • presents one server-authored four-horizon Activity Spine,
 *   • reports every active war in the world (village + clan), even ones the
 *     player isn't part of, click-through to the relevant screen,
 *   • preserves collective world context without duplicating the Logbook.
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
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { currentDateKey } from "../lib/utils";
import { normalizeOnboardingStep } from "../lib/onboarding-step";
import { useSharedNow } from "../lib/use-shared-now";
import { claimDailyLogin, type DailyLoginResult } from "../lib/daily-login-api";
import { fetchAnnouncements, fetchEras, fetchLegacyStatus, useLegacyAvailability, type AnnouncementView, type EraView } from "../lib/legacy";
import { nextUnseenRumorMilestone, markLevelRumorSeen, recordRumorHeard, rumorForCategory } from "../lib/legacy-rumors";
import { worldReport } from "../lib/daily-briefing";
import { dailyLoginRyo, STREAK_SHARD_INTERVAL, STREAK_SHARD_REWARD } from "../lib/daily-login-preview";
import briefingBg from "../assets/daily-briefing.webp";
import { Modal } from "./ui/Modal";
import { ActivitySpine } from "./ActivitySpine";

const SEEN_KEY = "dailyBriefing.seen.v1";
// Hold the briefing until level 5. Levels 1–4 are the guided tutorial/onboarding
// flow, and popping the full "notice board" over it on the first login buries the
// tutorial and overwhelms brand-new players. By level 5 onboarding has settled and
// the recommendation engine / daily login reward land as intended.
const MIN_LEVEL = 5;

export function DailyBriefingModal({
    character,
    updateCharacter,
    navigate,
}: {
    character: Character;
    updateCharacter: (c: Character | ((prev: Character | null) => Character | null)) => void;
    navigate: (s: Screen) => void;
}) {
    const now = useSharedNow(); // ticks once a second so the training countdowns stay live
    const legacyAvailable = useLegacyAvailability();
    const today = currentDateKey();
    const [dismissed, setDismissed] = useState(() => {
        try { return localStorage.getItem(SEEN_KEY) === today; } catch { return false; }
    });
    // Held back during the Academy tutorial: a brand-new player finishing the
    // intro cinematic shouldn't be greeted with "Welcome back" over the
    // companion's first instruction. It shows right after the tutorial ends
    // (same day), so no login reward is lost.
    const tutorialDone = normalizeOnboardingStep(character.onboardingStep) === "done";
    const shouldShow = character.level >= MIN_LEVEL && !dismissed && tutorialDone;

    // The login reward is collected by an explicit Claim button (not auto-granted).
    // `claim` holds the server result once collected this session; the save's
    // lastLoginRewardDate tells us if it was already collected earlier today.
    const [claim, setClaim] = useState<DailyLoginResult | null>(null);
    const [claiming, setClaiming] = useState(false);
    const claimingRef = useRef(false);

    // World news (Legacy system): the top high/mythic moments in the login
    // briefing (handoff §Server Announcements: "Login news panel"). Empty and
    // invisible while the server flag is off (endpoint returns []).
    const [worldNews, setWorldNews] = useState<AnnouncementView[]>([]);
    // Era V server-effort strip: world events live or die on ambient
    // visibility (depth-audit finding) — one line of collective progress.
    const [activeEra, setActiveEra] = useState<EraView | null>(null);
    useEffect(() => {
        if (!shouldShow || !legacyAvailable) return;
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
    }, [shouldShow, legacyAvailable]);

    // Pre-50 rumor: a map-avoider might never open the world map, so the Legacy
    // discovery arc would never reach them. Surface the next unheard milestone
    // here too — the SEEN_KEY dedupes with the world-map whisper, so a player
    // never hears the same beat twice across surfaces.
    const [rumor, setRumor] = useState<{ milestone: number; text: string } | null>(null);
    useEffect(() => {
        if (!shouldShow || !legacyAvailable) return;
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
    }, [shouldShow, legacyAvailable, character.level, character.name, character.legacy]);

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
                        ryo: res.balances.ryo,
                        fateShards: res.balances.fateShards,
                        loginStreak: res.streak,
                        lastLoginRewardDate: today,
                    };
                });
            }
        });
    };

    // Only burn the day's SEEN_KEY once the login reward is actually settled.
    // Marking it seen on any close meant a player who dismissed the briefing
    // before hitting Claim never got another chance that day — and a missed day
    // breaks the login streak, which is the whole point of the panel. An
    // unclaimed close now dismisses for THIS session only, so the briefing (and
    // the claim) comes back on the next load.
    const rewardSettled = alreadyClaimedToday || Boolean(claim);
    const close = () => {
        if (rewardSettled) {
            try { localStorage.setItem(SEEN_KEY, today); } catch { /* ignore */ }
        }
        setDismissed(true);
        window.dispatchEvent(new CustomEvent("shinobix:daily-briefing-closed"));
    };
    const go = (screen: Screen) => { close(); navigate(screen); };

    const previewRyo = dailyLoginRyo(character.level);
    const streak = claim?.streak ?? character.loginStreak ?? 0;
    const shardCountdown = claim
        ? claim.daysUntilShardBonus
        : (STREAK_SHARD_INTERVAL - (streak % STREAK_SHARD_INTERVAL)) % STREAK_SHARD_INTERVAL;

    const wars = worldReport(now);

    return (
        <Modal open={shouldShow} onClose={close} bare ariaLabel="Daily Briefing" size="lg" className="daily-briefing-modal-shell">
            <div
                className="daily-briefing-card"
                style={{ backgroundImage: `linear-gradient(180deg, rgba(8,12,24,0.42), rgba(8,12,24,0.86) 46%, rgba(8,12,24,0.95)), url(${briefingBg})` }}
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

                            <ActivitySpine character={character} updateCharacter={updateCharacter} onNavigate={go} />

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
        </Modal>
    );
}
