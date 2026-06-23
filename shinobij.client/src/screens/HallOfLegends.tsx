// Relative-time display reads Date.now() in render by design; verbatim-moved from App.tsx (rule disabled file-wide there).
/* eslint-disable react-hooks/purity */
import { useEffect, useState } from "react";
import {
    type Character,
    type LbTab,
    type PlayerRecord,
    type Profession,
    type Screen,
    PROFESSION_MAX_RANK,
    professionThresholds,
} from "../App";
import { loadArenaTournament, loadWarStandings, type WarStandingRecord } from "../lib/world-state";
import { WORLD_STATE_API } from "../constants/game";
import { fetchBountyBoard, placeBounty, type BountyEntry } from "../lib/pvp-bounty";
import { fetchGauntletLeaderboard, type GauntletLbRow } from "../lib/pet-gauntlet-api";

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
function HallOfLegends({ character, setScreen, playerRoster, updateCharacter }: { character: Character; setScreen: (s: Screen) => void; playerRoster: PlayerRecord[]; updateCharacter: (c: Character) => void }) {
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
    // Village W/L war records. Seed from the polled world-state cache for an
    // instant render, then refresh directly on tab open so it's current even if
    // the global poller hasn't run yet.
    const [warStandings, setWarStandings] = useState<WarStandingRecord[]>(() => loadWarStandings());
    useEffect(() => {
        if (tab !== "villageWars") return;
        let alive = true;
        fetch(WORLD_STATE_API).then(r => r.json()).then(data => {
            if (alive && Array.isArray(data.standings)) setWarStandings(data.standings as WarStandingRecord[]);
        }).catch(() => {});
        return () => { alive = false; };
    }, [tab]);
    // Ranked season clock + last season's champions (for the ranked tab header).
    type SeasonArchiveRow = { name: string; village?: string; rating: number; rank: number };
    type SeasonInfo = {
        current: { id: number; startedAt: number; endsAt: number } | null;
        lastSeason: { id: number; endedAt: number; player: SeasonArchiveRow[]; pet: SeasonArchiveRow[] } | null;
    };
    const [season, setSeason] = useState<SeasonInfo | null>(null);
    // Global Pet Ladder Top-10 boards (Coliseum 1v1 + Tactical 4v4 positional ladders).
    type PetLadderRow = { rank: number; name: string; village?: string; record: { wins: number; losses: number; defended: number; defeated: number } };
    const [petLadders, setPetLadders] = useState<{ coliseum: PetLadderRow[]; tactical: PetLadderRow[] } | null>(null);
    useEffect(() => {
        if (tab !== "ranked") return;
        let alive = true;
        const grab = (mode: string) => fetch(`/api/pet-ladder?mode=${mode}&top=10`).then(r => r.ok ? r.json() : { ladder: [] }).catch(() => ({ ladder: [] }));
        Promise.all([grab("coliseum"), grab("tactical")]).then(([c, t]) => {
            if (alive) setPetLadders({ coliseum: (c.ladder ?? []) as PetLadderRow[], tactical: (t.ladder ?? []) as PetLadderRow[] });
        });
        return () => { alive = false; };
    }, [tab]);
    useEffect(() => {
        if (tab !== "ranked") return;
        let alive = true;
        fetch("/api/ranked-season").then(r => r.json()).then(data => { if (alive) setSeason(data as SeasonInfo); }).catch(() => {});
        return () => { alive = false; };
    }, [tab]);
    // Weekly Pet Gauntlet board (shared-seed run; server-validated reward token).
    const [gauntletLb, setGauntletLb] = useState<{ weekKey: string; rows: GauntletLbRow[] } | null>(null);
    useEffect(() => {
        if (tab !== "gauntlet") return;
        let alive = true;
        fetchGauntletLeaderboard(25).then(({ weekKey, leaderboard }) => { if (alive) setGauntletLb({ weekKey, rows: leaderboard }); });
        return () => { alive = false; };
    }, [tab]);
    const [bounties, setBounties] = useState<BountyEntry[]>([]);
    const [bountyTarget, setBountyTarget] = useState("");
    const [bountyAmount, setBountyAmount] = useState(5000);
    useEffect(() => {
        if (tab !== "bounties") return;
        let alive = true;
        fetchBountyBoard().then(list => { if (alive) setBounties(list); });
        return () => { alive = false; };
    }, [tab]);
    async function submitBounty() {
        const target = bountyTarget.trim();
        if (!target) return alert("Choose a player to put a bounty on.");
        if (target.toLowerCase() === character.name.toLowerCase()) return alert("You can't bounty yourself.");
        if (bountyAmount < 1000) return alert("Minimum bounty is 1,000 ryo.");
        if ((character.ryo ?? 0) < bountyAmount) return alert("You don't have enough ryo.");
        const res = await placeBounty(character.name, target, bountyAmount);
        if (!res.ok) return alert(res.error || "Could not place the bounty.");
        updateCharacter({ ...character, ryo: (character.ryo ?? 0) - bountyAmount });
        if (res.bounties) setBounties(res.bounties);
        setBountyTarget("");
        alert(`Bounty placed: ${bountyAmount.toLocaleString()} ryo on ${target}'s head.`);
    }

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
        { id: "gauntlet",    label: "Gauntlet",      icon: "🗡" },
        { id: "endless",     label: "Endless",       icon: "🌀" },
        { id: "villageWars", label: "Village Wars",  icon: "⚔" },
        { id: "weeklyBoss",  label: "Weekly Boss",   icon: "👹" },
        { id: "tournament",  label: "Tournament",    icon: "🏆" },
        { id: "professions", label: "Professions",   icon: "🧑‍⚕️" },
        { id: "bounties",    label: "Bounties",      icon: "💰" },
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
                        {season?.current && (() => {
                            const ms = Math.max(0, season.current.endsAt - Date.now());
                            const d = Math.floor(ms / 86_400_000);
                            const h = Math.floor((ms % 86_400_000) / 3_600_000);
                            return (
                                <div style={{ padding: "10px 14px", marginBottom: "0.8rem", borderRadius: 10, background: "rgba(120,53,15,0.35)", border: "1px solid rgba(250,204,21,0.5)" }}>
                                    <strong style={{ color: "#facc15" }}>🏆 Ranked Season {season.current.id}</strong>
                                    <span style={{ color: "#e7d9b0" }}> · {ms > 0 ? `ends in ${d}d ${h}h` : "ending soon"}</span>
                                    <p className="hint" style={{ margin: "4px 0 0", fontSize: "0.76rem" }}>At season end the top 3 of each ladder are rewarded (champion: Warforged Relic + aura stones) and ratings soft-reset toward 1000.</p>
                                </div>
                            );
                        })()}
                        <p className="hol-board-label">⚔ Ranked Battle Rating (Elo)</p>
                        {sortedTop(c => c.rankedRating ?? 1000).map((c, i) => (
                            <Row key={c.name} rank={i+1} name={c.name} value={c.rankedRating ?? 1000} suffix=" Elo" village={c.village} />
                        ))}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}>🐾 Pet Ranked Rating (Elo)</p>
                        {sortedTop(c => c.petRankedRating ?? 1000).map((c, i) => (
                            <Row key={`pet-${c.name}`} rank={i+1} name={c.name} value={c.petRankedRating ?? 1000} suffix=" Elo" village={c.village} />
                        ))}
                        <p className="hint" style={{ marginTop: "1rem", marginBottom: "0.2rem", opacity: 0.75 }}>🪜 Global Pet Ladders — climb by beating the player ranked above you. All-time standings; no season reset.</p>
                        <p className="hol-board-label">🏆 Pet Coliseum Ladder — Top 10</p>
                        {petLadders?.coliseum.length
                            ? petLadders.coliseum.map((e) => <Row key={`plc-${e.rank}`} rank={e.rank} name={e.name} value={`${e.record.wins}W ${e.record.losses}L`} village={e.village} />)
                            : <p className="hol-empty">No challengers ranked yet.</p>}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}>🛡 Pet Tactical Ladder — Top 10</p>
                        {petLadders?.tactical.length
                            ? petLadders.tactical.map((e) => <Row key={`plt-${e.rank}`} rank={e.rank} name={e.name} value={`${e.record.wins}W ${e.record.losses}L`} village={e.village} />)
                            : <p className="hol-empty">No squads ranked yet.</p>}
                        {season?.lastSeason && (() => {
                            const champs = [
                                season.lastSeason.player[0] ? { ...season.lastSeason.player[0], mode: "PvP" } : null,
                                season.lastSeason.pet[0] ? { ...season.lastSeason.pet[0], mode: "Pet" } : null,
                            ].filter(Boolean) as (SeasonArchiveRow & { mode: string })[];
                            return (
                                <>
                                    <p className="hol-board-label" style={{ marginTop: "1rem" }}>👑 Season {season.lastSeason.id} Champions</p>
                                    {champs.length === 0
                                        ? <p className="hol-empty">No champions crowned last season.</p>
                                        : champs.map((ch) => (
                                            <Row key={ch.mode} rank={1} name={ch.name} value={`${ch.rating} Elo`} suffix={` · ${ch.mode}`} village={ch.village} />
                                        ))}
                                </>
                            );
                        })()}
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
                        <p className="hol-board-label">Pet Coliseum Wins</p>
                        {sortedTop(c => c.totalPetWins ?? 0).map((c, i) => (
                            <Row key={c.name} rank={i+1} name={c.name} value={c.totalPetWins ?? 0} suffix=" wins" village={c.village} />
                        ))}
                    </>
                )}
                {tab === "gauntlet" && (
                    <>
                        <p className="hint" style={{ margin: "0 0 0.5rem" }}>🗡 Pet Gauntlet — this week's best runs. Each run is a randomized draft + enemy gauntlet; ranked by rounds cleared, then hearts left. Rewards pay Ryo (server-validated).</p>
                        <p className="hol-board-label">🏆 Weekly Gauntlet — Top 25{gauntletLb?.weekKey ? ` · ${gauntletLb.weekKey}` : ""}</p>
                        {!gauntletLb
                            ? <p className="hol-empty">Loading this week's board…</p>
                            : gauntletLb.rows.length === 0
                                ? <p className="hol-empty">No runs submitted yet this week — be the first to set the pace.</p>
                                : gauntletLb.rows.map((e) => (
                                    <Row key={`g-${e.rank}`} rank={e.rank} name={e.name} value={`${e.roundsCleared}/10 rounds`} suffix={` · ${e.heartsLeft}❤`} village={e.village} />
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
                        {/* Per-village W/L record from the server (api/world-state
                            standings). Ranked by win differential, then wins. */}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}>🏯 Village War Records</p>
                        {(() => {
                            const rows = [...warStandings]
                                .filter(s => s && s.village && ((s.wins ?? 0) + (s.losses ?? 0)) > 0)
                                .sort((a, b) => ((b.wins - b.losses) - (a.wins - a.losses)) || (b.wins - a.wins));
                            return rows.length === 0
                                ? <p className="hol-empty">No village war records yet.</p>
                                : rows.map((s, i) => (
                                    <Row
                                        key={`standing-${s.village}`}
                                        rank={i+1}
                                        name={s.village}
                                        value={`${s.wins}W – ${s.losses}L`}
                                        suffix={s.lastResult ? (s.lastResult === "win" ? " · last: won" : " · last: lost") : ""}
                                    />
                                ));
                        })()}
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
                {tab === "bounties" && (
                    <>
                        <p className="hol-board-label">💰 Active Bounties — defeat the target in a duel to claim the pool</p>
                        <div className="summary-box" style={{ marginBottom: 10 }}>
                            <p className="hint">Stake ryo on a player's head; whoever beats them in a duel claims it. Your ryo: {(character.ryo ?? 0).toLocaleString()}.</p>
                            <input list="bounty-target-options" value={bountyTarget} onChange={e => setBountyTarget(e.target.value)} placeholder="Player name" />
                            <datalist id="bounty-target-options">{playerRoster.filter(p => p.name.toLowerCase() !== character.name.toLowerCase()).map(p => <option key={p.name} value={p.name} />)}</datalist>
                            <input type="number" min={1000} step={1000} value={bountyAmount} onChange={e => setBountyAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                            <div className="menu"><button onClick={() => void submitBounty()}>Place Bounty</button></div>
                        </div>
                        {bounties.length === 0
                            ? <p className="hol-empty">No bounties on anyone's head yet.</p>
                            : [...bounties].sort((a, b) => b.amount - a.amount).map((b, i) => (
                                <Row key={b.target} rank={i + 1} name={b.target} value={b.amount} suffix=" ryo" />
                            ))}
                    </>
                )}
            </div>
        </div>
    );
}
