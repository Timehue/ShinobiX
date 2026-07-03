// Relative-time display reads Date.now() in render by design; verbatim-moved from App.tsx (rule disabled file-wide there).
/* eslint-disable react-hooks/purity */
import { useEffect, useState, type ReactNode } from "react";
// Fantasy chrome glyphs (game-icons.net, CC BY 3.0 — attributed in the About guide).
import {
    GiRank3, GiDaggers, GiUpgrade, GiBlackFlag, GiPawPrint, GiGauntlet, GiVortex,
    GiCrossedSwords, GiOgre, GiTrophy, GiAnvil, GiTwoCoins, GiHealing, GiColiseum,
    GiShield, GiCrown, GiPunchBlast, GiCastle,
} from "react-icons/gi";
const HOL_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
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
import { RankBadge } from "../components/RankBadge";
import { fetchHallOfLegends, fetchAnnouncements, fetchEras, isLegacyEnabled, type HallEntryView, type AnnouncementView, type EraView } from "../lib/legacy";

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
function HallOfLegends({ character, setScreen, playerRoster, updateCharacter }: { character: Character; setScreen: (s: Screen) => void; playerRoster: PlayerRecord[]; updateCharacter: React.Dispatch<React.SetStateAction<Character | null>> }) {
    // Deep-link support: the Daily Briefing's "World news" teaser (and any
    // other surface) can land the player on a specific tab via a one-shot
    // sessionStorage hint — previously a mythic headline opened the Ranked
    // Elo table (depth-audit finding).
    const [tab, setTab] = useState<LbTab>(() => {
        try {
            const hint = window.sessionStorage?.getItem("hall.initialTab");
            if (hint) {
                window.sessionStorage.removeItem("hall.initialTab");
                if (hint === "news" || hint === "legends" || hint === "eras") return hint as LbTab;
            }
        } catch { /* private mode */ }
        return "ranked";
    });
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
    // Legacy system: permanent server history + the world news feed + eras.
    // null = still loading, so the tabs show a loading line instead of flashing
    // the permanent empty-state copy mid-fetch (polish-audit finding).
    const [hallEntries, setHallEntries] = useState<HallEntryView[] | null>(null);
    const [worldNews, setWorldNews] = useState<AnnouncementView[] | null>(null);
    const [eraViews, setEraViews] = useState<EraView[] | null>(null);
    useEffect(() => {
        if (tab !== "legends" && tab !== "news" && tab !== "eras") return;
        let alive = true;
        if (tab === "legends") void fetchHallOfLegends().then(r => { if (alive) setHallEntries(r?.entries ?? []); });
        else if (tab === "news") void fetchAnnouncements(30).then(r => { if (alive) setWorldNews(r?.announcements ?? []); });
        else {
            // Eras also pull the Hall entries so each unlocked age can show the
            // "Legends of this Age" that were forged inside its time window.
            void fetchEras().then(r => { if (alive) setEraViews(r?.eras ?? []); });
            void fetchHallOfLegends().then(r => { if (alive) setHallEntries(r?.entries ?? []); });
        }
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
        updateCharacter((prev) => prev ? ({ ...prev, ryo: (prev.ryo ?? 0) - bountyAmount }) : prev);
        if (res.bounties) setBounties(res.bounties);
        setBountyTarget("");
        alert(`Bounty placed: ${bountyAmount.toLocaleString()} ryo on ${target}'s head.`);
    }

    const all = playerRoster.length > 0
        ? playerRoster.map(p => p.character)
        : [character];
    const me = character.name;

    function Row({ rank, name, value, suffix = "", village, tier = false }: { rank: number; name: string; value: number | string; suffix?: string; village?: string; tier?: boolean }) {
        const isMe = name === me;
        return (
            <div className={`hol-row ${isMe ? "hol-row-me" : ""}`}>
                <span className="hol-rank-num">{rank <= 3 ? ["🥇","🥈","🥉"][rank-1] : `#${rank}`}</span>
                <span className="hol-name">{name}{village ? <span className="hol-village"> · {village}</span> : null}{tier && typeof value === "number" ? <> <RankBadge rating={value} size="xs" /></> : null}</span>
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

    // "Legends of this Age": Hall entries forged inside an unlocked era's reign.
    // An era's window runs from when IT began (unlockedAt; the genesis era has
    // none → 0) up to when the NEXT unlocked era took over (or now, for the
    // current age). Only unlocked eras have a reign; the milestone_active era is
    // the age not yet begun.
    function legendsOfEra(era: EraView, allEras: EraView[], entries: HallEntryView[]): HallEntryView[] {
        if (era.status !== "unlocked") return [];
        const start = era.unlockedAt ?? 0;
        const next = [...allEras]
            .filter((e) => e.number > era.number && e.status === "unlocked" && (e.unlockedAt ?? 0) > start)
            .sort((a, b) => (a.unlockedAt ?? 0) - (b.unlockedAt ?? 0))[0];
        const end = next?.unlockedAt ?? Infinity;
        return entries
            .filter((en) => en.status !== "revoked" && en.status !== "hidden" && en.ts >= start && en.ts < end)
            .sort((a, b) => b.ts - a.ts);
    }

    const tabs: { id: LbTab; label: string; icon: ReactNode }[] = [
        { id: "ranked",      label: "Ranked",       icon: <GiRank3 /> },
        { id: "kills",       label: "Kill Streaks",  icon: <GiDaggers /> },
        { id: "xp",          label: "Most XP",       icon: <GiUpgrade /> },
        { id: "clans",       label: "Top Clans",     icon: <GiBlackFlag /> },
        { id: "pets",        label: "Pet Wins",      icon: <GiPawPrint /> },
        { id: "gauntlet",    label: "Gauntlet",      icon: <GiGauntlet /> },
        { id: "endless",     label: "Endless",       icon: <GiVortex /> },
        { id: "villageWars", label: "Village Wars",  icon: <GiCrossedSwords /> },
        { id: "weeklyBoss",  label: "Weekly Boss",   icon: <GiOgre /> },
        { id: "tournament",  label: "Tournament",    icon: <GiTrophy /> },
        { id: "professions", label: "Professions",   icon: <GiAnvil /> },
        { id: "bounties",    label: "Bounties",      icon: <GiTwoCoins /> },
        ...(isLegacyEnabled() ? [
            { id: "legends" as const, label: "Legends",    icon: <GiCrown /> },
            { id: "news" as const,    label: "World News", icon: <GiCastle /> },
            { id: "eras" as const,    label: "World Eras", icon: <GiShield /> },
        ] : []),
    ];

    // Profession leaderboard helpers. XP keeps accruing past the Rank 10
    // threshold (rank just clamps at 10), so a maxed Healer who keeps healing
    // shows higher than one who just hit max — leaderboards stay meaningful.
    const professionTabs: { id: Profession; label: string; accent: string; icon: ReactNode }[] = [
        { id: "healer", label: "Healer", accent: "#22d3ee", icon: <GiHealing /> },
        { id: "vanguard", label: "Vanguard", accent: "#f97316", icon: <GiCrossedSwords /> },
        { id: "petTamer", label: "Pet Tamer", accent: "#84cc16", icon: <GiPawPrint /> },
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
                    <h2><GiTrophy style={HOL_ICON} />Hall of Legends</h2>
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
                                    <strong style={{ color: "#facc15" }}><GiTrophy style={HOL_ICON} />Ranked Season {season.current.id}</strong>
                                    <span style={{ color: "#e7d9b0" }}> · {ms > 0 ? `ends in ${d}d ${h}h` : "ending soon"}</span>
                                    <p className="hint" style={{ margin: "4px 0 0", fontSize: "0.76rem" }}>At season end the top 3 of each ladder are rewarded (champion: Warforged Relic + aura stones) and ratings soft-reset toward 1000.</p>
                                </div>
                            );
                        })()}
                        <p className="hol-board-label"><GiCrossedSwords style={HOL_ICON} />Ranked Battle Rating (Elo)</p>
                        {sortedTop(c => c.rankedRating ?? 1000).map((c, i) => (
                            <Row key={c.name} rank={i+1} name={c.name} value={c.rankedRating ?? 1000} suffix=" Elo" village={c.village} tier />
                        ))}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}><GiPawPrint style={HOL_ICON} />Pet Ranked Rating (Elo)</p>
                        {sortedTop(c => c.petRankedRating ?? 1000).map((c, i) => (
                            <Row key={`pet-${c.name}`} rank={i+1} name={c.name} value={c.petRankedRating ?? 1000} suffix=" Elo" village={c.village} tier />
                        ))}
                        <p className="hint" style={{ marginTop: "1rem", marginBottom: "0.2rem", opacity: 0.75 }}>🪜 Global Pet Ladders — climb by beating the player ranked above you. All-time standings; no season reset.</p>
                        <p className="hol-board-label"><GiColiseum style={HOL_ICON} />Pet Coliseum Ladder — Top 10</p>
                        {petLadders?.coliseum.length
                            ? petLadders.coliseum.map((e) => <Row key={`plc-${e.rank}`} rank={e.rank} name={e.name} value={`${e.record.wins}W ${e.record.losses}L`} village={e.village} />)
                            : <p className="hol-empty">No challengers ranked yet.</p>}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}><GiShield style={HOL_ICON} />Pet Tactical Ladder — Top 10</p>
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
                                    <p className="hol-board-label" style={{ marginTop: "1rem" }}><GiCrown style={HOL_ICON} />Season {season.lastSeason.id} Champions</p>
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
                        <p className="hint" style={{ margin: "0 0 0.5rem" }}><GiGauntlet style={HOL_ICON} />Pet Gauntlet — this week's best runs. Each run is a randomized draft + enemy gauntlet; ranked by rounds cleared, then hearts left. Rewards pay Ryo (server-validated).</p>
                        <p className="hol-board-label"><GiTrophy style={HOL_ICON} />Weekly Gauntlet — Top 25{gauntletLb?.weekKey ? ` · ${gauntletLb.weekKey}` : ""}</p>
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
                        <p className="hol-board-label"><GiTrophy style={HOL_ICON} />Wars Won</p>
                        {(() => {
                            const top = sortedTop(c => c.warsWon ?? 0).filter(c => (c.warsWon ?? 0) > 0);
                            return top.length === 0
                                ? <p className="hol-empty">No village war victories recorded yet.</p>
                                : top.map((c, i) => (
                                    <Row key={`won-${c.name}`} rank={i+1} name={c.name} value={c.warsWon ?? 0} suffix={` win${(c.warsWon ?? 0) === 1 ? "" : "s"}`} village={c.village} />
                                ));
                        })()}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}><GiCrown style={HOL_ICON} />MVP Wall</p>
                        {(() => {
                            const top = sortedTop(c => c.warMvpCount ?? 0).filter(c => (c.warMvpCount ?? 0) > 0);
                            return top.length === 0
                                ? <p className="hol-empty">No war MVPs crowned yet.</p>
                                : top.map((c, i) => (
                                    <Row key={`mvp-${c.name}`} rank={i+1} name={c.name} value={c.warMvpCount ?? 0} suffix={` MVP${(c.warMvpCount ?? 0) === 1 ? "" : "s"}`} village={c.village} />
                                ));
                        })()}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}><GiPunchBlast style={HOL_ICON} />All-Time War Damage</p>
                        {(() => {
                            const top = sortedTop(c => c.lifetimeWarDamage ?? 0).filter(c => (c.lifetimeWarDamage ?? 0) > 0);
                            return top.length === 0
                                ? <p className="hol-empty">No war damage tallied yet.</p>
                                : top.map((c, i) => (
                                    <Row key={`dmg-${c.name}`} rank={i+1} name={c.name} value={c.lifetimeWarDamage ?? 0} suffix=" HP" village={c.village} />
                                ));
                        })()}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}><GiCrossedSwords style={HOL_ICON} />Raids Completed</p>
                        {sortedTop(c => c.totalVillageRaids ?? 0).map((c, i) => (
                            <Row key={`raid-${c.name}`} rank={i+1} name={c.name} value={c.totalVillageRaids ?? 0} suffix=" raids" village={c.village} />
                        ))}
                        {/* Per-village W/L record from the server (api/world-state
                            standings). Ranked by win differential, then wins. */}
                        <p className="hol-board-label" style={{ marginTop: "1rem" }}><GiCastle style={HOL_ICON} />Village War Records</p>
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
                        <p className="hol-board-label"><GiTwoCoins style={HOL_ICON} />Active Bounties — defeat the target in a duel to claim the pool</p>
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
                {tab === "legends" && (
                    /* Hall banner — generated header art (docs/legacy-assets.md),
                       same cover treatment as the era cards. */
                    <img
                        src="/legacy/hall-of-legends-banner.webp" alt=""
                        style={{ width: "100%", maxHeight: 120, objectFit: "cover", display: "block", borderRadius: 10, marginBottom: 10 }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                )}
                {tab === "legends" && (
                    hallEntries === null
                        ? <p className="hol-empty">Opening the great book…</p>
                        : hallEntries.length === 0
                        ? <p className="hol-empty">No legends have been written yet. The first mythic awakening, era unlock, or server-first lands here — forever.</p>
                        : hallEntries.map((e) => (
                            <div key={e.id} className="card" style={{ padding: "10px 12px", marginBottom: 8, opacity: e.status === "revoked" ? 0.55 : 1 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                                    <b style={{ color: "#e2e8f0", textDecoration: e.status === "revoked" ? "line-through" : "none" }}>{e.title}</b>
                                    <span style={{ fontSize: ".7rem", color: "#9aa3b2" }}>{new Date(e.ts).toLocaleDateString()}</span>
                                </div>
                                <p style={{ margin: "4px 0 0", fontSize: ".78rem", color: "#cbd5e1" }}>{e.description}</p>
                                {e.status === "revoked" && <p style={{ margin: "4px 0 0", fontSize: ".7rem", color: "#f87171" }}>Revoked{e.correctionNote ? ` — ${e.correctionNote}` : ""}</p>}
                                {e.status === "corrected" && e.correctionNote && <p style={{ margin: "4px 0 0", fontSize: ".7rem", color: "#fbbf24" }}>Corrected — {e.correctionNote}</p>}
                            </div>
                        ))
                )}
                {tab === "eras" && (
                    eraViews === null
                        ? <p className="hol-empty">Turning back the chapters…</p>
                        : eraViews.length === 0
                        ? <p className="hol-empty">The chapters of this world have not been written yet.</p>
                        : eraViews.map((e) => (
                            <div key={e.id} className="card" style={{ padding: 0, marginBottom: 12, overflow: "hidden", opacity: e.status === "locked" ? 0.55 : 1 }}>
                                <div style={{ position: "relative" }}>
                                    <img src={e.banner} alt={e.name} style={{ width: "100%", maxHeight: 130, objectFit: "cover", display: "block", filter: e.status === "unlocked" ? "none" : "saturate(.35) brightness(.7)" }} onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                    <div style={{ position: "absolute", left: 12, bottom: 8, textShadow: "0 1px 6px rgba(0,0,0,.9)" }}>
                                        <b style={{ fontSize: "1rem", color: e.status === "unlocked" ? "#fde68a" : "#cbd5e1" }}>{e.name}</b>
                                        <span style={{ marginLeft: 8, fontSize: ".7rem", color: e.status === "unlocked" ? "#86efac" : "#c084fc" }}>
                                            {e.status === "unlocked" ? "UNLOCKED" : e.status === "milestone_active" ? "IN PROGRESS" : "SEALED"}
                                        </span>
                                    </div>
                                </div>
                                <div style={{ padding: "10px 12px" }}>
                                    <p style={{ margin: 0, fontSize: ".78rem", color: "#cbd5e1" }}>{e.description}</p>
                                    <p style={{ margin: "4px 0 0", fontSize: ".72rem", color: "#9aa3b2", fontStyle: "italic" }}>{e.lore}</p>
                                    {(e.chronicle?.length ?? 0) > 0 && (
                                        <ul style={{ margin: "8px 0 0", paddingLeft: 16, display: "grid", gap: 3 }}>
                                            {e.chronicle!.map((line, i) => (
                                                <li key={i} style={{ fontSize: ".72rem", color: "#9aa3b2", lineHeight: 1.4 }}>{line}</li>
                                            ))}
                                        </ul>
                                    )}
                                    {e.unlockedBy && (
                                        <p style={{ margin: "6px 0 0", fontSize: ".72rem", color: "#c084fc" }}>
                                            Opened by <b>{e.unlockedBy}</b>{e.unlockedVillage ? ` of ${e.unlockedVillage}` : ""}{e.unlockedAt ? ` · ${new Date(e.unlockedAt).toLocaleDateString()}` : ""}
                                        </p>
                                    )}
                                    {/* Finisher memorial — the once-ever credited trigger stays on
                                        the card AFTER the age unlocks (the milestone view is gone by
                                        then). The most dramatic moment of the chapter, permanent. */}
                                    {e.status === "unlocked" && e.trigger?.fired && e.trigger.firedBy && (
                                        <p style={{ margin: "6px 0 0", fontSize: ".72rem", color: "#fbbf24" }}>
                                            ✦ The age turned when <b>{e.trigger.firedBy}</b>{e.trigger.firedByVillage ? ` of ${e.trigger.firedByVillage}` : ""} struck the final blow: {e.trigger.label}.
                                        </p>
                                    )}
                                    {e.status === "unlocked" && hallEntries !== null && (() => {
                                        // The legends forged during this age — pulled from the
                                        // Hall by time window (legendsOfEra). Silent when the age
                                        // has none yet, so it never renders an empty header.
                                        const legends = legendsOfEra(e, eraViews ?? [], hallEntries);
                                        if (legends.length === 0) return null;
                                        const shown = legends.slice(0, 6);
                                        const oldest = legends[legends.length - 1]; // legendsOfEra is newest-first
                                        return (
                                            <div style={{ marginTop: 8, borderTop: "1px solid rgba(148,163,184,.15)", paddingTop: 8 }}>
                                                <p style={{ margin: "0 0 2px", fontSize: ".66rem", letterSpacing: ".08em", textTransform: "uppercase", color: "#c084fc" }}>
                                                    ⚜ Legends of this Age <span style={{ color: "#9aa3b2" }}>· {legends.length}</span>
                                                </p>
                                                {oldest && (
                                                    <p style={{ margin: "0 0 5px", fontSize: ".68rem", color: "#9aa3b2", fontStyle: "italic" }}>
                                                        It opened with {oldest.player ? <b style={{ color: "#cbd5e1" }}>{oldest.player}</b> : "the first of them"} and the {oldest.title}.
                                                    </p>
                                                )}
                                                <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 2 }}>
                                                    {shown.map((l) => (
                                                        <li key={l.id} style={{ fontSize: ".72rem", color: "#cbd5e1", lineHeight: 1.35 }}>
                                                            <b style={{ color: "#e2e8f0" }}>{l.title}</b>{l.player ? ` — ${l.player}${l.village ? ` of ${l.village}` : ""}` : ""}
                                                        </li>
                                                    ))}
                                                </ul>
                                                {legends.length > shown.length && (
                                                    <button
                                                        onClick={() => setTab("legends")}
                                                        style={{ marginTop: 6, background: "transparent", border: "none", color: "#c084fc", fontSize: ".7rem", cursor: "pointer", padding: 0 }}
                                                    >
                                                        +{legends.length - shown.length} more in the Hall of Legends →
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })()}
                                    {e.status === "milestone_active" && e.milestones.length > 0 && (() => {
                                        // "How close to the next age" — a tonal synthesis of the
                                        // SAME public milestone fractions the bars below already
                                        // show. No new data, no rank/rarity, single violet.
                                        const pct = e.milestones.reduce((a, m) => a + Math.min(1, m.current / Math.max(1, m.required)), 0) / e.milestones.length;
                                        const met = e.milestones.filter((m) => m.done).length;
                                        const band = pct >= 0.85 ? "The next age is within reach — the world leans toward it."
                                            : pct >= 0.5 ? "The next age stirs; more than half its measures are met."
                                            : pct >= 0.15 ? "The next age is distant, but the world has begun to move."
                                            : "The next age sleeps — its first stirrings are only beginning.";
                                        return (
                                            <p style={{ margin: "4px 0 8px", fontSize: ".74rem", color: "#c4b5fd", fontStyle: "italic" }}>
                                                {band} <span style={{ color: "#9aa3b2", fontStyle: "normal" }}>({met}/{e.milestones.length} measures met)</span>
                                            </p>
                                        );
                                    })()}
                                    {e.status === "milestone_active" && e.milestones.map((m) => (
                                        <div key={m.metric} style={{ marginTop: 6 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".72rem", color: m.done ? "#86efac" : "#cbd5e1" }}>
                                                <span>{m.done ? "✓ " : ""}{m.label}</span>
                                                <span>{m.current.toLocaleString()} / {m.required.toLocaleString()}</span>
                                            </div>
                                            <div style={{ height: 6, borderRadius: 3, background: "rgba(148,163,184,.15)", overflow: "hidden" }}>
                                                <div style={{ height: "100%", width: `${Math.min(100, (m.current / Math.max(1, m.required)) * 100)}%`, background: m.done ? "#4ade80" : "#c084fc" }} />
                                            </div>
                                        </div>
                                    ))}
                                    {e.status === "milestone_active" && e.trigger && (
                                        <p style={{ margin: "8px 0 0", fontSize: ".72rem", color: e.trigger.fired ? "#86efac" : "#fbbf24" }}>
                                            {e.trigger.fired ? `✓ Final trigger struck by ${e.trigger.firedBy}` : `Final trigger: ${e.trigger.label}`}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ))
                )}
                {tab === "news" && (
                    worldNews === null
                        ? <p className="hol-empty">Listening for word from the roads…</p>
                        : worldNews.length === 0
                        ? <p className="hol-empty">The world is quiet. For now.</p>
                        : worldNews.map((a) => (
                            <div key={a.id} className="card" style={{ padding: "10px 12px", marginBottom: 8, borderLeft: `3px solid ${a.importance === "mythic" ? "#c084fc" : a.importance === "high" ? "#f59e0b" : "#475569"}` }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                                    <b style={{ color: a.importance === "mythic" ? "#c084fc" : a.importance === "high" ? "#f59e0b" : "#e2e8f0" }}>
                                        {/* Server-firsts are once-ever world history — mark them so the
                                            feed distinguishes "first EVER" from "another mythic moment". */}
                                        {a.type === "server_first" && <span style={{ fontSize: ".6rem", fontWeight: 800, letterSpacing: ".1em", color: "#c084fc", border: "1px solid #c084fc", borderRadius: 4, padding: "1px 5px", marginRight: 6, verticalAlign: "1px" }}>ONCE EVER</span>}
                                        {a.title}
                                    </b>
                                    <span style={{ fontSize: ".7rem", color: "#9aa3b2" }}>{new Date(a.ts).toLocaleString()}</span>
                                </div>
                                <p style={{ margin: "4px 0 0", fontSize: ".78rem", color: "#cbd5e1" }}>{a.message}</p>
                            </div>
                        ))
                )}
            </div>
        </div>
    );
}
