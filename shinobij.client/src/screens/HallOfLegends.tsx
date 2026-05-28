import { useEffect, useState } from "react";
import {
    type Character,
    type LbTab,
    type PlayerRecord,
    type Profession,
    type Screen,
    PROFESSION_MAX_RANK,
    loadArenaTournament,
    professionThresholds,
} from "../App";

type WeeklyBossLb = {
    weekKey: string;
    bossName?: string;
    hpRemaining: number;
    hpMax: number;
    damageByPlayer?: Record<string, number>;
    startedAt?: number;
    expiresAt?: number;
    rewardsDistributed?: boolean;
};

export 
function HallOfLegends({ character, setScreen, playerRoster }: { character: Character; setScreen: (s: Screen) => void; playerRoster: PlayerRecord[] }) {
    const [tab, setTab] = useState<LbTab>("ranked");
    const [professionFilter, setProfessionFilter] = useState<Profession>("healer");
    const [weeklyBoss, setWeeklyBoss] = useState<WeeklyBossLb | null>(null);
    useEffect(() => {
        if (tab !== "weeklyBoss") return;
        let alive = true;
        fetch("/api/weekly-boss").then(r => r.json()).then(data => {
            if (alive) setWeeklyBoss(data.boss ?? null);
        }).catch(() => {});
        return () => { alive = false; };
    }, [tab]);

    const all = playerRoster.length > 0
        ? playerRoster.map(p => p.character)
        : [character];
    const me = character.name;

    function Row({ rank, name, value, suffix = "", village }: { rank: number; name: string; value: number | string; suffix?: string; village?: string }) {
        const isMe = name === me;
        return (
            <div className={`hol-row ${isMe ? "hol-row-me" : ""}`}>
                <span className="hol-rank-num">{rank <= 3 ? ["🥇","🥈","🥉"][rank-1] : `#${rank}`}</span>
                <span className="hol-name">{name}{village ? <span className="hol-village"> · {village}</span> : null}</span>
                <span className="hol-value">{typeof value === "number" ? value.toLocaleString() : value}{suffix}</span>
            </div>
        );
    }

    function sortedTop(field: (c: Character) => number, n = 10) {
        return [...all].sort((a, b) => field(b) - field(a)).slice(0, n);
    }

    // Clan aggregation
    const clanMap = new Map<string, { score: number; members: number; topVillage: string }>();
    for (const p of playerRoster) {
        const c = p.character;
        if (!c.clan) continue;
        const existing = clanMap.get(c.clan) ?? { score: 0, members: 0, topVillage: p.village };
        clanMap.set(c.clan, {
            score: existing.score + (c.rankedWins ?? 0) + (c.totalPvpKills ?? 0),
            members: existing.members + 1,
            topVillage: existing.topVillage,
        });
    }
    const topClans = [...clanMap.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 10);

    // Tournament
    const tournament = loadArenaTournament();

    const tabs: { id: LbTab; label: string; icon: string }[] = [
        { id: "ranked",      label: "Ranked",       icon: "🎖" },
        { id: "kills",       label: "Kill Streaks",  icon: "🗡" },
        { id: "xp",          label: "Most XP",       icon: "📈" },
        { id: "clans",       label: "Top Clans",     icon: "🏴" },
        { id: "pets",        label: "Pet Wins",      icon: "🐾" },
        { id: "endless",     label: "Endless",       icon: "🌀" },
        { id: "villageWars", label: "Village Wars",  icon: "⚔" },
        { id: "weeklyBoss",  label: "Weekly Boss",   icon: "👹" },
        { id: "tournament",  label: "Tournament",    icon: "🏆" },
        { id: "professions", label: "Professions",   icon: "🧑‍⚕️" },
    ];

    // Profession leaderboard helpers. XP keeps accruing past the Rank 10
    // threshold (rank just clamps at 10), so a maxed Healer who keeps healing
    // shows higher than one who just hit max — leaderboards stay meaningful.
    const professionTabs: { id: Profession; label: string; accent: string; icon: string }[] = [
        { id: "healer", label: "Healer", accent: "#22d3ee", icon: "✚" },
        { id: "vanguard", label: "Vanguard", accent: "#f97316", icon: "⚔" },
        { id: "petTamer", label: "Pet Tamer", accent: "#84cc16", icon: "🐾" },
    ];
    function topByProfession(p: Profession, n = 10) {
        return all
            .filter(c => c.profession === p)
            .sort((a, b) => (b.professionXp ?? 0) - (a.professionXp ?? 0))
            .slice(0, n);
    }
    function rankLabel(c: Character): string {
        const rank = Math.max(1, Math.min(PROFESSION_MAX_RANK, c.professionRank ?? 1));
        const xp = c.professionXp ?? 0;
        const thresholds = c.profession ? professionThresholds(c.profession) : [];
        const maxXp = thresholds[PROFESSION_MAX_RANK] ?? 0;
        if (rank >= PROFESSION_MAX_RANK && xp > maxXp) {
            return `R${PROFESSION_MAX_RANK}+${Math.floor((xp - maxXp) / 1000)}k`;
        }
        return `R${rank}`;
    }

    return (
        <div className="card hol-screen">
            <div className="hol-header">
                <button className="back-button" onClick={() => setScreen("centralHub")}>← Central Hub</button>
                <div>
                    <h2>🏆 Hall of Legends</h2>
                    <p className="hol-subtitle">Eternal records of the world's greatest shinobi.</p>
                </div>
            </div>

            <div className="hol-tabs">
                {tabs.map(t => (
                    <button key={t.id} className={`hol-tab ${tab === t.id ? "hol-tab-active" : ""}`} onClick={() => setTab(t.id)}>
                        {t.icon} {t.label}
                    </button>
                ))}
            </div>

            <div className="hol-board">
                {tab === "ranked" && (
                    <>
                        <p className="hol-board-label">Ranked Battle Rating (Elo)</p>
                        {sortedTop(c => c.rankedRating ?? 1000).map((c, i) => (
                            <Row key={c.name} rank={i+1} name={c.name} value={c.rankedRating ?? 1000} suffix=" Elo" village={c.village} />
                        ))}
                    </>
                )}
                {tab === "kills" && (
                    <>
                        <p className="hol-board-label">Total PvP Kills</p>
                        {sortedTop(c => c.totalPvpKills ?? 0).map((c, i) => (
                            <Row key={c.name} rank={i+1} name={c.name} value={c.totalPvpKills ?? 0} suffix=" kills" village={c.village} />
                        ))}
                    </>
                )}
                {tab === "xp" && (
                    <>
                        <p className="hol-board-label">Total XP Earned</p>
                        {sortedTop(c => c.xp).map((c, i) => (
                            <Row key={c.name} rank={i+1} name={c.name} value={c.xp} suffix=" XP" village={c.village} />
                        ))}
                    </>
                )}
                {tab === "clans" && (
                    <>
                        <p className="hol-board-label">Clan Power (Ranked Wins + PvP Kills)</p>
                        {topClans.length === 0
                            ? <p className="hol-empty">No clan data available yet.</p>
                            : topClans.map(([clan, data], i) => (
                                <div key={clan} className={`hol-row ${character.clan === clan ? "hol-row-me" : ""}`}>
                                    <span className="hol-rank-num">{i <= 2 ? ["🥇","🥈","🥉"][i] : `#${i+1}`}</span>
                                    <span className="hol-name">{clan}<span className="hol-village"> · {data.members} member{data.members !== 1 ? "s" : ""}</span></span>
                                    <span className="hol-value">{data.score.toLocaleString()} pts</span>
                                </div>
                            ))
                        }
                    </>
                )}
                {tab === "pets" && (
                    <>
                        <p className="hol-board-label">Pet Arena Wins</p>
                        {sortedTop(c => c.totalPetWins ?? 0).map((c, i) => (
                            <Row key={c.name} rank={i+1} name={c.name} value={c.totalPetWins ?? 0} suffix=" wins" village={c.village} />
                        ))}
                    </>
                )}
                {tab === "endless" && (
                    <>
                        <p className="hol-board-label">Endless Tower — Waves Survived</p>
                        {sortedTop(c => c.totalEndlessTowerWins ?? 0).map((c, i) => (
                            <Row key={c.name} rank={i+1} name={c.name} value={c.totalEndlessTowerWins ?? 0} suffix=" waves" village={c.village} />
                        ))}
                    </>
                )}
                {tab === "villageWars" && (
                    <>
                        {/* Four small boards under one tab: wars won, MVP wall,
                            lifetime damage, raid count. All four read from
                            character fields populated by claimPendingWarCrates
                            at war-end time. */}
                        <p className="hol-board-label">🏆 Wars Won</p>
                        {(() => {
                            const top = sortedTop(c => c.warsWon ?? 0).filter(c => (c.warsWon ?? 0) > 0);
                            return top.length === 0
                                ? <p className="hol-empty">No village war victories recorded yet.</p>
                                : top.map((c, i) => (
                                    <Row key={`won-${c.name}`} rank={i+1} name={c.name} value={c.warsWon ?? 0} suffix={` win${(c.warsWon ?? 0) === 1 ? "" : "s"}`} village={c.village} />
                                ));
                        })()}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}>👑 MVP Wall</p>
                        {(() => {
                            const top = sortedTop(c => c.warMvpCount ?? 0).filter(c => (c.warMvpCount ?? 0) > 0);
                            return top.length === 0
                                ? <p className="hol-empty">No war MVPs crowned yet.</p>
                                : top.map((c, i) => (
                                    <Row key={`mvp-${c.name}`} rank={i+1} name={c.name} value={c.warMvpCount ?? 0} suffix={` MVP${(c.warMvpCount ?? 0) === 1 ? "" : "s"}`} village={c.village} />
                                ));
                        })()}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}>💥 All-Time War Damage</p>
                        {(() => {
                            const top = sortedTop(c => c.lifetimeWarDamage ?? 0).filter(c => (c.lifetimeWarDamage ?? 0) > 0);
                            return top.length === 0
                                ? <p className="hol-empty">No war damage tallied yet.</p>
                                : top.map((c, i) => (
                                    <Row key={`dmg-${c.name}`} rank={i+1} name={c.name} value={c.lifetimeWarDamage ?? 0} suffix=" HP" village={c.village} />
                                ));
                        })()}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}>⚔ Raids Completed</p>
                        {sortedTop(c => c.totalVillageRaids ?? 0).map((c, i) => (
                            <Row key={`raid-${c.name}`} rank={i+1} name={c.name} value={c.totalVillageRaids ?? 0} suffix=" raids" village={c.village} />
                        ))}
                    </>
                )}
                {tab === "weeklyBoss" && (
                    <>
                        <p className="hol-board-label">Weekly Boss — Top 25 Damage Dealers</p>
                        {!weeklyBoss
                            ? <p className="hol-empty">Loading weekly boss…</p>
                            : (
                                <>
                                    <div style={{ marginBottom: "0.6rem", padding: "0.5rem", background: "#0a0a1a", borderRadius: 6 }}>
                                        <strong>{weeklyBoss.bossName ?? "Weekly Boss"}</strong> ({weeklyBoss.weekKey})
                                        {(() => {
                                            // Countdown to despawn (24h after spawn). Falls back
                                            // to startedAt+24h if expiresAt isn't set in legacy
                                            // payloads. Refreshes on tab visit (no interval) —
                                            // good enough for a leaderboard tab.
                                            const nowMs = Date.now();
                                            const expiresAt = weeklyBoss.expiresAt ?? ((weeklyBoss.startedAt ?? nowMs) + 24 * 60 * 60 * 1000);
                                            const ms = Math.max(0, expiresAt - nowMs);
                                            if (weeklyBoss.rewardsDistributed || ms <= 0) return <span style={{ marginLeft: 8, color: "#94a3b8" }}>· Despawned</span>;
                                            const h = Math.floor(ms / 3_600_000);
                                            const m = Math.floor((ms % 3_600_000) / 60_000);
                                            return <span style={{ marginLeft: 8, color: "#facc15" }}>· {h}h {m}m to despawn</span>;
                                        })()}
                                    </div>
                                    <p className="hint" style={{ fontSize: "0.78rem", margin: "0 0 0.4rem" }}>
                                        Top 10 receive a Weekly Boss Core · Top 25 receive a Dungeon Key · MVP also gets 2× ryo/XP.
                                    </p>
                                    {Object.entries(weeklyBoss.damageByPlayer ?? {})
                                        .sort(([, a], [, b]) => (b as number) - (a as number))
                                        .slice(0, 25)
                                        .map(([name, dmg], i) => {
                                            // damageByPlayer keys come from the server with mixed
                                            // casing; the prior compare missed every time and the
                                            // village suffix never rendered. Lowercase both sides.
                                            const playerChar = all.find(c => c.name.toLowerCase() === name.toLowerCase());
                                            const tierSuffix = i === 0
                                                ? " dmg · 👑 MVP"
                                                : i < 10
                                                    ? " dmg · 💠 core"
                                                    : " dmg · 🗝 key";
                                            return (
                                                <Row key={name} rank={i + 1} name={playerChar?.name ?? name} value={dmg as number} suffix={tierSuffix} village={playerChar?.village} />
                                            );
                                        })
                                    }
                                    {Object.keys(weeklyBoss.damageByPlayer ?? {}).length === 0 && <p className="hol-empty">No damage dealt yet this week.</p>}
                                </>
                            )
                        }
                    </>
                )}
                {tab === "tournament" && (
                    <>
                        <p className="hol-board-label">Last Tournament</p>
                        {!tournament
                            ? <p className="hol-empty">No tournament has been held yet.</p>
                            : (
                                <div className="hol-tournament-card">
                                    <h3>{tournament.name}</h3>
                                    <p><strong>Hosted by:</strong> {tournament.createdBy}</p>
                                    <p><strong>Participants ({tournament.participants?.length ?? 0}):</strong> {(tournament.participants ?? []).join(", ") || "—"}</p>
                                    {tournament.advancedPlayers?.length > 0 && (
                                        <p><strong>Advanced Players:</strong> {tournament.advancedPlayers.join(", ")}</p>
                                    )}
                                    <p className="hol-tournament-ended">Ended {new Date(tournament.endsAt).toLocaleDateString()}</p>
                                </div>
                            )
                        }
                    </>
                )}
                {tab === "professions" && (
                    <>
                        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                            {professionTabs.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => setProfessionFilter(p.id)}
                                    style={{
                                        background: professionFilter === p.id ? p.accent : "rgba(15,18,34,0.6)",
                                        color: professionFilter === p.id ? "#0a0a1a" : p.accent,
                                        border: `1px solid ${p.accent}88`,
                                        padding: "6px 12px",
                                        borderRadius: 4,
                                        fontWeight: 600,
                                        cursor: "pointer",
                                    }}
                                >
                                    {p.icon} {p.label}
                                </button>
                            ))}
                        </div>
                        <p className="hol-board-label">
                            Top {professionTabs.find(p => p.id === professionFilter)?.label}s by Profession XP
                        </p>
                        {(() => {
                            const top = topByProfession(professionFilter);
                            if (top.length === 0) {
                                return <p className="hol-empty">No {professionTabs.find(p => p.id === professionFilter)?.label}s in the world yet.</p>;
                            }
                            return top.map((c, i) => (
                                <Row
                                    key={c.name}
                                    rank={i + 1}
                                    name={`${c.name}  · ${rankLabel(c)}`}
                                    value={c.professionXp ?? 0}
                                    suffix=" XP"
                                    village={c.village}
                                />
                            ));
                        })()}
                        <p className="hint" style={{ marginTop: 8, fontSize: "0.78rem" }}>
                            Profession XP keeps accruing past Rank 10 — no more rank rewards, but the leaderboard stays competitive.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
