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

import { useState, useEffect, type CSSProperties } from "react";
import type { Character, ServerPlayerSummary, PlayerRecord } from "../types/character";
import type { SavedBloodline, Jutsu } from "../types/combat";
import { type Achievement, ACHIEVEMENTS } from "../constants/achievements";
import { getCharacterElements } from "../lib/elements";
import { sendStandardDuel } from "../lib/duel-challenge";
import { RankBadge } from "../components/RankBadge";
import { subscribeFollowing, follow, unfollow } from "../lib/friends";
import { NindoCard } from "../components/NindoCard";

const ELEMENT_COLORS: Record<string, string> = {
    fire: "#f87171", water: "#60a5fa", earth: "#d4a574", lightning: "#fbbf24",
    wind: "#5eead4", ice: "#a5f3fc", wood: "#86efac", lava: "#fb923c",
    storm: "#818cf8", sand: "#e7c08b", crystal: "#c4b5fd", shadow: "#a78bfa",
    light: "#fde68a", dark: "#a78bfa",
};
const RARITY_COLORS: Record<string, string> = {
    common: "#94a3b8", uncommon: "#86efac", rare: "#60a5fa",
    epic: "#c084fc", legendary: "#fbbf24", mythic: "#f472b6",
};
const PROFESSION_LABEL: Record<string, string> = {
    healer: "✚ Healer", vanguard: "⚔ Vanguard", petTamer: "🐾 Pet Tamer",
};
const elementColor = (el: string) => ELEMENT_COLORS[el.toLowerCase()] ?? "#cbd5e1";
const rarityColor = (r: string) => RARITY_COLORS[(r ?? "").toLowerCase()] ?? "#94a3b8";
function chipStyle(accent: string): CSSProperties {
    return {
        display: "inline-flex", alignItems: "center", gap: 4,
        background: `${accent}1f`, color: accent, border: `1px solid ${accent}55`,
        borderRadius: 999, padding: "4px 10px", fontSize: "0.82rem", fontWeight: 600,
    };
}

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

    const bloodlineName = equippedBloodline?.name || viewedCharacter.bloodline;
    const professionLabel = viewedCharacter.profession ? PROFESSION_LABEL[viewedCharacter.profession] : "";
    const pets = viewedCharacter.pets ?? [];
    const metrics: { label: string; value: string | number }[] = [
        { label: "Ranked Rating", value: viewedCharacter.rankedRating ?? 0 },
        { label: "PvP Kills", value: viewedCharacter.totalPvpKills ?? 0 },
        { label: "Battle Tower", value: (viewedCharacter.battleTowerBestFloor ?? 0) > 0 ? `Floor ${viewedCharacter.battleTowerBestFloor}` : "—" },
        { label: "Pets", value: pets.length },
    ];
    if (((viewedCharacter.rankedWins ?? 0) + (viewedCharacter.rankedLosses ?? 0)) > 0)
        metrics.push({ label: "Ranked W/L", value: `${viewedCharacter.rankedWins ?? 0}–${viewedCharacter.rankedLosses ?? 0}` });
    if ((viewedCharacter.warsWon ?? 0) > 0) metrics.push({ label: "Wars Won", value: viewedCharacter.warsWon ?? 0 });
    if ((viewedCharacter.totalVillageRaids ?? 0) > 0) metrics.push({ label: "Village Raids", value: viewedCharacter.totalVillageRaids ?? 0 });
    if ((viewedCharacter.totalTournamentsCompleted ?? 0) > 0) metrics.push({ label: "Tournaments", value: viewedCharacter.totalTournamentsCompleted ?? 0 });
    if ((viewedCharacter.loginStreak ?? 0) > 0) metrics.push({ label: "Login Streak", value: `${viewedCharacter.loginStreak}d` });

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

                <section className="profile-build-panel" style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ width: 110, height: 110, borderRadius: "50%", border: "3px solid #facc15", boxShadow: "0 0 0 3px rgba(250,204,21,0.15)", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.3)" }}>
                        {avatar
                            ? <img src={avatar} alt={viewedCharacter.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <span style={{ fontSize: "2rem", fontWeight: 700, color: "#facc15" }}>{viewedCharacter.name.slice(0, 2).toUpperCase()}</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <span style={{ fontSize: "1.7rem", fontWeight: 700, color: "#f8fafc" }}>{viewedCharacter.name}</span>
                            {viewedCharacter.customTitle && <span style={{ color: "#facc15", fontWeight: 700, fontSize: "0.95rem" }}>«{viewedCharacter.customTitle}»</span>}
                            {((viewedCharacter.rankedWins ?? 0) + (viewedCharacter.rankedLosses ?? 0)) > 0 && (
                                <RankBadge rating={viewedCharacter.rankedRating ?? 1000} showRating />
                            )}
                        </div>
                        <div style={{ color: "#94a3b8", marginTop: 4, fontSize: "0.95rem" }}>
                            {viewedCharacter.village} · {viewedCharacter.rankTitle} · Lv {viewedCharacter.level}/100
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                            <span style={chipStyle("#a78bfa")}>🩸 {bloodlineName}</span>
                            {ownedElements.map((el) => <span key={el} style={chipStyle(elementColor(el))}>{el}</span>)}
                            {viewedCharacter.clan && <span style={chipStyle("#facc15")}>🏳 {viewedCharacter.clan}{viewedCharacter.clanFounder ? " · Leader" : ""}</span>}
                            {professionLabel && <span style={chipStyle("#38bdf8")}>{professionLabel}{viewedCharacter.professionRank ? ` · R${viewedCharacter.professionRank}` : ""}</span>}
                        </div>
                    </div>
                </section>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 12 }}>
                    {metrics.map((m) => (
                        <div key={m.label} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(250,204,21,0.18)", borderRadius: 10, padding: "12px 14px" }}>
                            <div style={{ color: "#94a3b8", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
                            <div style={{ color: "#f8fafc", fontSize: "1.3rem", fontWeight: 700, marginTop: 2 }}>{m.value}</div>
                        </div>
                    ))}
                </div>

                {pets.length > 0 && (
                    <section className="profile-build-panel" style={{ marginTop: 12 }}>
                        <h3 style={{ margin: "0 0 10px" }}>Pets</h3>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                            {pets.slice(0, 8).map((p) => {
                                const petImg = sharedImages['pet:' + String(p.id).toLowerCase()] || p.image || "";
                                return (
                                    <div key={String(p.id)} style={{ display: "flex", gap: 10, alignItems: "center", background: "rgba(15,23,42,0.7)", border: `1px solid ${rarityColor(p.rarity)}55`, borderRadius: 10, padding: 8 }}>
                                        <div style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            {petImg ? <img src={petImg} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: "1.2rem" }}>🐾</span>}
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ color: "#f8fafc", fontWeight: 600, fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                                            <div style={{ color: rarityColor(p.rarity), fontSize: "0.76rem" }}>{p.rarity} · Lv {p.level}{p.element ? ` · ${p.element}` : ""}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                <NindoCard nindo={viewedCharacter.nindo} nindoBg={viewedCharacter.nindoBg} ownerName={viewedCharacter.name} />
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
