/*
 * UserView — read-only profile of another player.
 *
 * Two tabs: Overview (avatar + bloodline + elements + rank) and
 * Achievements (the subset of ACHIEVEMENTS predicates that pass for the
 * viewed character). Clicking an achievement opens a detail overlay.
 *
 * Pure leaf component — all data flows through props. Depends only on
 * extracted modules (types/, constants/achievements, lib/elements).
 *
 * Extracted from App.tsx.
 */

import { useState, useEffect } from "react";
import type { Character, ServerPlayerSummary, PlayerRecord } from "../types/character";
import type { SavedBloodline, Jutsu } from "../types/combat";
import { type Achievement, ACHIEVEMENTS } from "../constants/achievements";
import { getCharacterElements } from "../lib/elements";
import { sendStandardDuel } from "../lib/duel-challenge";
import { subscribeFollowing, follow, unfollow } from "../lib/friends";
import { NindoCard } from "../components/NindoCard";

export function UserView({
    viewingName,
    viewerCharacter,
    allServerPlayers,
    playerRoster,
    savedBloodlines,
    creatorJutsus,
    sharedImages,
    onMessage,
    onBack,
}: {
    viewingName: string;
    viewerCharacter: Character;
    allServerPlayers: ServerPlayerSummary[];
    playerRoster: PlayerRecord[];
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    sharedImages: Record<string, string>;
    onMessage: () => void;
    onBack: () => void;
}) {
    const lower = viewingName.toLowerCase();
    const rosterEntry = playerRoster.find(p => p.name.toLowerCase() === lower);
    const serverEntry = allServerPlayers.find(p => p.name.toLowerCase() === lower);
    const viewedCharacter: Character | null = rosterEntry?.character ?? serverEntry?.character ?? null;

    const [tab, setTab] = useState<'overview' | 'achievements'>('overview');
    const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);

    useEffect(() => {
        if (!selectedAchievement) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedAchievement(null); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selectedAchievement]);

    const [following, setFollowing] = useState<string[]>([]);
    const [challengeBusy, setChallengeBusy] = useState(false);
    useEffect(() => subscribeFollowing(viewerCharacter.name, setFollowing), [viewerCharacter.name]);

    if (!viewedCharacter) {
        return (
            <div className="card profile-page-card">
                <div className="profile-page-header"><div>
                    <h2>{viewingName}</h2>
                    <p>Profile not yet loaded. The player's full data has not been fetched yet.</p>
                </div></div>
                <button className="back-btn" onClick={onBack}>Back to Users</button>
            </div>
        );
    }

    const equippedBloodline = savedBloodlines.find(b => b.id === viewedCharacter.equippedBloodlineId);
    const ownedElements = getCharacterElements(viewedCharacter);
    const sharedAvatar = sharedImages['avatar:' + viewingName.toLowerCase()];
    const avatar = sharedAvatar || viewedCharacter.avatarImage || "";

    const isSelf = lower === viewerCharacter.name.toLowerCase();
    const isFollowed = following.some(f => f.toLowerCase() === lower);
    async function toggleFollow() {
        if (isFollowed) await unfollow(viewerCharacter.name, viewingName);
        else await follow(viewerCharacter.name, viewingName);
    }
    async function sendChallenge() {
        if (challengeBusy) return;
        setChallengeBusy(true);
        const r = await sendStandardDuel({ character: viewerCharacter, opponentName: viewingName, savedBloodlines, creatorJutsus });
        setChallengeBusy(false);
        alert(r.ok ? `Challenge sent to ${viewingName}.` : (r.error ?? "Challenge could not be sent."));
    }

    return (
        <div className="card profile-page-card">
            <nav className="profile-mobile-tabs">
                {([
                    { id: 'overview',     label: '👤 Profile' },
                    { id: 'achievements', label: '🏆 Achievements' },
                ] as const).map(({ id, label }) => (
                    <button
                        key={id}
                        className={`pmtab${tab === id ? ' pmtab-active' : ''}`}
                        onClick={() => setTab(id)}
                    >{label}</button>
                ))}
            </nav>

            {/* ── Overview ─────────────────────────────── */}
            <div className={tab !== 'overview' ? 'profile-tab-hidden' : ''}>
                <div className="profile-page-header">
                    <div>
                        <h2>{viewedCharacter.name}</h2>
                        <p>Viewing another shinobi's profile.</p>
                    </div>
                    <button className="back-btn" onClick={onBack}>Back to Users</button>
                </div>

                {!isSelf && (
                    <div className="profile-actions">
                        <button className="profile-action-btn" onClick={onMessage}>✉ Message</button>
                        <button className="profile-action-btn" disabled={challengeBusy} onClick={() => void sendChallenge()}>
                            {challengeBusy ? "Sending…" : "⚔ Challenge"}
                        </button>
                        <button
                            className={`profile-action-btn${isFollowed ? " following" : ""}`}
                            onClick={() => void toggleFollow()}
                        >{isFollowed ? "★ Following" : "☆ Follow"}</button>
                    </div>
                )}

                <section className="profile-overview-panel">
                    <div className="profile-avatar-upload-box">
                        <div className="profile-big-avatar">
                            {avatar
                                ? <img src={avatar} alt={viewedCharacter.name} />
                                : <span>{viewedCharacter.name.slice(0, 2).toUpperCase()}</span>}
                        </div>
                    </div>

                    <div className="profile-info-grid">
                        <div>
                            <h3>General</h3>
                            <p><strong>Name:</strong> {viewedCharacter.name}</p>
                            <p><strong>Village:</strong> {viewedCharacter.village}</p>
                            <p><strong>Rank:</strong> {viewedCharacter.rankTitle}</p>
                            {viewedCharacter.customTitle && <p><strong>Title:</strong> <span style={{ color: "#facc15" }}>{viewedCharacter.customTitle}</span></p>}
                            <p><strong>Level:</strong> {viewedCharacter.level}/100</p>
                            <p><strong>Bloodline:</strong> {equippedBloodline?.name || viewedCharacter.bloodline}</p>
                            <p><strong>Elements:</strong> {ownedElements.length ? ownedElements.join(" / ") : "Not awakened"}</p>
                        </div>
                    </div>
                </section>

                <NindoCard nindo={viewedCharacter.nindo} nindoBg={viewedCharacter.nindoBg} />
            </div>

            {/* ── Achievements ─────────────────────────── */}
            <div className={tab !== 'achievements' ? 'profile-tab-hidden' : ''}>
                <section className="achievements-panel">
                    <div className="achievements-heading">
                        <h3>Achievements</h3>
                        <span className="achievements-count">
                            {ACHIEVEMENTS.filter(a => a.check(viewedCharacter)).length}/{ACHIEVEMENTS.length} unlocked
                        </span>
                    </div>
                    {(() => {
                        const unlocked = ACHIEVEMENTS.filter(a => a.check(viewedCharacter));
                        if (unlocked.length === 0) {
                            return <p className="hint">This shinobi hasn't unlocked any achievements yet.</p>;
                        }
                        return (
                            <div className="achievements-grid">
                                {unlocked.map(a => {
                                    const unlockedAt = viewedCharacter.achievementUnlockedAt?.[a.id];
                                    const unlockedAtLabel = unlockedAt ? new Date(unlockedAt).toLocaleDateString() : null;
                                    const classes = [
                                        "achievement-badge",
                                        "unlocked",
                                        a.hidden ? "is-secret" : "",
                                    ].filter(Boolean).join(" ");
                                    return (
                                        <button
                                            key={a.id}
                                            type="button"
                                            className={classes}
                                            onClick={() => setSelectedAchievement(a)}
                                            title={`${a.name} — click for details`}
                                        >
                                            <div className="achievement-icon">
                                                <img
                                                    src={`/badges/${a.id}.png`}
                                                    alt=""
                                                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                                                />
                                                <span className="achievement-emoji" aria-hidden>{a.icon}</span>
                                            </div>
                                            <div className="achievement-meta">
                                                <strong>{a.name}</strong>
                                                <small>{a.desc}</small>
                                                {unlockedAtLabel && <small className="achievement-unlocked-at">Unlocked {unlockedAtLabel}</small>}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })()}
                </section>
            </div>

            {selectedAchievement && (
                <div className="achievement-detail-overlay" onClick={() => setSelectedAchievement(null)}>
                    <div
                        className={`achievement-detail-card ${selectedAchievement.hidden ? "is-secret" : ""}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            className="achievement-detail-close"
                            type="button"
                            onClick={() => setSelectedAchievement(null)}
                            aria-label="Close"
                        >×</button>
                        <div className="achievement-detail-badge">
                            <img
                                src={`/badges/${selectedAchievement.id}.png`}
                                alt=""
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                            />
                            <span className="achievement-detail-emoji" aria-hidden>{selectedAchievement.icon}</span>
                        </div>
                        <p className="achievement-detail-category">
                            {selectedAchievement.hidden ? "Secret · " : ""}{selectedAchievement.category}
                        </p>
                        <h2 className="achievement-detail-name">{selectedAchievement.name}</h2>
                        <p className="achievement-detail-desc">{selectedAchievement.desc}</p>
                        {(() => {
                            const at = viewedCharacter.achievementUnlockedAt?.[selectedAchievement.id];
                            return at ? (
                                <p className="achievement-detail-date">
                                    Unlocked {new Date(at).toLocaleString()}
                                </p>
                            ) : null;
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
}
